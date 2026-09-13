-- ==========================================================================================
-- Turning a flagged capture into a fact: resolve, edit, discard, restore — each audited
-- ==========================================================================================
--
-- Issue [#252](https://github.com/southville-running-club/src-website/issues/252), under
-- [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- `timing.crossing.resolve` has existed since `20260911100000` and gated nothing. This is what
-- it opens.
--
-- ## ⚠️ The coherence check the issue says already exists does not, and this adds it
--
-- #252 reads *"the coherence check `(resolved_at is null) = (resolved_action is null)` already
-- exists"*. It does not — `20260911140000` declares `resolved_at` and `resolved_action` as two
-- bare nullable columns with no constraint between them and no value check on the second. A
-- reviewer going to look for it will not find it, so it is said here rather than left as a
-- discrepancy between an issue and a schema.
--
-- **Both constraints are added validated rather than `NOT VALID`.** The `entries` precedent
-- ships four `NOT VALID` because those tables hold live rows nobody here can see; `timing` has
-- **no timing data at all** — every table is empty in production, which is what the results page
-- says to the few people who can open it — so there is no row to disagree and nothing to defer.
-- The day that stops being true this is a runbook rather than a migration.
--
-- ## Compare-and-swap everywhere, because two volunteers resolve the same anomaly
--
-- The old application learned this the hard way and #252 says to reproduce it rather than
-- simplify it. **Two admins on the same triage list is the normal case**, not the edge one: a
-- race has one anomalies page and everybody free is looking at it.
--
-- So every write here is `update … where id = $1 and <expected state> returning …`, and **zero
-- rows returned is a distinct answer** — `already_resolved`, not a silent success and not a
-- crash. The page then says *somebody else got there first* and re-reads, which is the only
-- honest thing to tell the second person.
--
-- ⚠️ **The latch differs between the two surfaces and that is the whole reason `edit_crossing`
-- exists separately.** On the anomalies page the latch is `resolved_at is null`: an open anomaly
-- is open exactly once, and resolving it closes it. On the timing **log** that latch is useless
-- — a row that was never flagged has `resolved_at is null` for ever, so it would match every
-- time and two concurrent edits would both "succeed" with the last writer winning silently.
-- `edit_crossing` therefore swaps on the **values** the editor was looking at, which is the only
-- state that actually changed under them.
--
-- ## Update first, audit second
--
-- Every function writes `timing.admin_actions` **after** the update and only when the update
-- matched. An audit row claiming a change that did not happen is worse than no audit row: it is
-- what somebody disputing a result would be shown.
--
-- ## What is deliberately not built
--
-- **No `anomaly_kind` column.** #252 is explicit: the marshal-facing message *is* the reason
-- stored, so per-kind UI would mean re-parsing prose. That is a schema decision for after the
-- race, and adding it now to make a filter nicer is exactly the kind of thing that is cheap to
-- add and expensive to have been wrong about.
--
-- **Nothing recomputes an anomaly.** `anomaly_flag` and `anomaly_reason` are the marshal's
-- verdict at confirm time — `20260912120000`'s header carries the argument — and resolving one
-- records what a human decided about it rather than overwriting what was seen.

-- ------------------------------------------------------------------------------------------
-- The two constraints #252 assumed were already there
-- ------------------------------------------------------------------------------------------
alter table timing.crossings
  add constraint crossings_resolution_coherent
  check ((resolved_at is null) = (resolved_action is null));

alter table timing.crossings
  add constraint crossings_resolved_action_shaped
  check (
    resolved_action is null
    or resolved_action in ('marked_valid', 'edited', 'discarded')
  );

-- ------------------------------------------------------------------------------------------
-- open_anomalies — the triage list
-- ------------------------------------------------------------------------------------------
-- ⚠️ **A union of two populations, and the second is the one people forget.** A flagged capture
-- is the obvious half. The other is an **orphan**: a bib that matched no team, so the trigger
-- left `team_id` null. Nothing flags those — `record_crossing()` stores an unknown bib and never
-- refuses it, because a validator at the line loses the moment — so a page that showed only
-- `anomaly_flag` would show a clean list while a runner sat unmatched to anybody.
--
-- `bib is not null` narrows the orphan half deliberately: a crossing with no bib at all is a tap
-- whose marshal never typed one, which is not something an admin can resolve from a desk.
--
-- Oldest first, because triage is a queue and the earliest unresolved capture is the one most
-- likely to be blocking a result.
--
-- `null` for both "you may not" and "no such event", which is this schema's shape everywhere.
create or replace function timing.open_anomalies(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'bib', c.bib,
        'captured_at', c.captured_at,
        'anomaly_flag', c.anomaly_flag,
        -- The marshal's own words, verbatim. See the header: this is the reason, not a kind.
        'anomaly_reason', c.anomaly_reason,
        'source', c.source,
        -- What makes this row open: a flag, an unmatched bib, or both. Derived for the page
        -- rather than stored, because it is a statement about the row as it is now.
        'orphan', c.team_id is null,
        'team_number', t.team_number
      ) order by c.captured_at
    )
    from timing.crossings c
    left join timing.teams t on t.id = c.team_id
    where c.event_id = v_event.id
      and c.resolved_at is null
      and (c.anomaly_flag or (c.team_id is null and c.bib is not null))
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.open_anomalies(text) from public, anon;
grant execute on function timing.open_anomalies(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- crossing_log — every capture on a race, newest first, optionally searched
-- ------------------------------------------------------------------------------------------
-- The second surface. Unlike the triage list this shows **resolved rows too**, including
-- discarded ones — a log that hid what had been taken out would be a log nobody could audit
-- from, and restoring a discard is only possible if somebody can see it.
--
-- ⚠️ **The search is on the bib as text and on the team number, and on nothing else.** A runner's
-- name is on `timing.runners` and is not a fact this surface needs: an admin correcting a
-- capture is working from a bib. Widening it later is a decision about how much personal data a
-- correction screen carries.
create or replace function timing.crossing_log(
  p_event_slug text,
  p_search text default null,
  p_limit integer default 200
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_search text;
  v_limit integer;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  -- A blank search is no search. Trimmed first, because a box somebody tabbed through holds a
  -- space and `like '% %'` would quietly answer nothing.
  v_search := nullif(btrim(coalesce(p_search, '')), '');
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.captured_at desc)
    from (
      select
        c.id,
        c.bib,
        c.captured_at,
        c.anomaly_flag,
        c.anomaly_reason,
        c.resolved_at,
        c.resolved_action,
        c.source,
        t.team_number,
        -- ⚠️ **A soft warning, never a refusal.** A capture timed before the gun is almost
        -- always a phone with a wrong clock, and the old application found exactly that by
        -- rendering it as "—" and sorting it first. It is surfaced and left alone: the row is
        -- still a real crossing and deleting it is not this function's call.
        c.captured_at < coalesce(v_event.actually_started_at, v_event.start_at) as before_start
      from timing.crossings c
      left join timing.teams t on t.id = c.team_id
      where c.event_id = v_event.id
        and (
          v_search is null
          or c.bib = v_search
          or t.team_number = v_search
        )
      order by c.captured_at desc
      limit v_limit
    ) r
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.crossing_log(text, text, integer) from public, anon;
grant execute on function timing.crossing_log(text, text, integer) to authenticated;

-- ------------------------------------------------------------------------------------------
-- resolve_crossing — mark valid, edit the bib, or discard
-- ------------------------------------------------------------------------------------------
-- ⚠️ **One statement decides it.** `update … where id = $1 and resolved_at is null returning`
-- is the compare-and-swap: the second of two admins gets zero rows and is told, rather than
-- overwriting the first one's decision with their own.
--
-- **An edit sets the bib and lets the trigger re-derive `team_id`.** `resolve_crossing_team_id`
-- fires `before update of bib`, so nothing here resolves a team by hand — and an edit to a bib
-- that still matches nothing **legitimately stays an orphan**. That is not a failure: the admin
-- has recorded what they believe the bib was, and the roster is what has to change next.
create or replace function timing.resolve_crossing(
  p_id uuid,
  p_action text,
  p_new_bib text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_before timing.crossings%rowtype;
  v_after timing.crossings%rowtype;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_action is null or p_action not in ('marked_valid', 'edited', 'discarded') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  -- An edit with nothing to edit to is a mistake rather than a clearing: blanking a bib would
  -- turn a resolvable capture into one nobody can attribute, which is the opposite of resolving.
  if p_action = 'edited' and nullif(btrim(coalesce(p_new_bib, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'bib_required');
  end if;

  -- Read before, for the audit row. Not a lock and not a check — the `update` below is what
  -- decides, and anything read here can have changed by the time it runs.
  select * into v_before from timing.crossings where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_crossing');
  end if;

  update timing.crossings
     set bib = case when p_action = 'edited' then btrim(p_new_bib) else bib end,
         resolved_at = now(),
         resolved_action = p_action
   where id = p_id
     and resolved_at is null
  returning * into v_after;

  -- ⚠️ Zero rows is **somebody else got there first**, and it is a distinct answer. Treating it
  -- as success would tell the second admin their decision stands when the first one's does.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_resolved');
  end if;

  -- Audit second, and only now — see the header. `detail` carries before and after, because
  -- "the bib was changed" without saying from what is not something a dispute can be settled on.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_after.event_id,
    auth.uid(),
    'crossing_resolved',
    jsonb_build_object(
      'crossing_id', p_id,
      'resolution', p_action,
      'before', jsonb_build_object(
        'bib', v_before.bib,
        'team_id', v_before.team_id,
        'captured_at', v_before.captured_at
      ),
      'after', jsonb_build_object(
        'bib', v_after.bib,
        'team_id', v_after.team_id,
        'captured_at', v_after.captured_at
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'resolution', p_action,
    'bib', v_after.bib,
    -- The page says so out loud: an edited bib that still matches nothing is a decision the
    -- admin has to see, not a silent half-success.
    'orphan', v_after.team_id is null
  );
end;
$$;

revoke all on function timing.resolve_crossing(uuid, text, text) from public, anon;
grant execute on function timing.resolve_crossing(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- restore_crossing — undo a discard
-- ------------------------------------------------------------------------------------------
-- ⚠️ **Both columns are cleared together**, which is what the coherence check above demands and
-- is the reason it was worth adding: clearing one and leaving the other is a row the schema now
-- refuses outright rather than a row that quietly means nothing.
--
-- The swap is on `resolved_action = 'discarded'`, not merely on "resolved": restoring a capture
-- somebody **marked valid** would be undoing a different decision, and there is nothing to undo.
create or replace function timing.restore_crossing(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_after timing.crossings%rowtype;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  update timing.crossings
     set resolved_at = null,
         resolved_action = null
   where id = p_id
     and resolved_action = 'discarded'
  returning * into v_after;

  if not found then
    -- Not discarded, already restored, or no such crossing — one answer for all three, because
    -- the only thing the page can usefully say is "there is nothing to restore here now".
    return jsonb_build_object('ok', false, 'reason', 'not_discarded');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_after.event_id,
    auth.uid(),
    'crossing_restored',
    jsonb_build_object(
      'crossing_id', p_id,
      'bib', v_after.bib,
      'captured_at', v_after.captured_at
    )
  );

  return jsonb_build_object('ok', true, 'id', p_id, 'orphan', v_after.team_id is null);
end;
$$;

revoke all on function timing.restore_crossing(uuid) from public, anon;
grant execute on function timing.restore_crossing(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------
-- edit_crossing — the timing log's correction, swapped on the values that were on screen
-- ------------------------------------------------------------------------------------------
-- ⚠️ **This is not `resolve_crossing` with different arguments, and the difference is the latch.**
-- A row that was never flagged has `resolved_at is null` permanently, so the anomalies page's
-- latch matches every time and cannot see a competing edit at all: two admins correcting the
-- same row would both be told they succeeded and the later write would win in silence.
--
-- So the swap is on **what the editor was looking at**. If either value has moved since the page
-- was drawn, zero rows come back and the answer is `changed_elsewhere` — which is true, useful,
-- and the only thing that distinguishes this from the last write winning.
--
-- **`is not distinct from` rather than `=`**, because `bib` is nullable and `null = null` is
-- null, which would make every swap against an unbibbed capture fail for ever.
--
-- Resolving is untouched here: correcting a value in the log is not a statement about an
-- anomaly, and an edit that also closed one would resolve rows nobody had triaged.
create or replace function timing.edit_crossing(
  p_id uuid,
  p_bib text,
  p_captured_at timestamptz,
  p_expected_bib text,
  p_expected_captured_at timestamptz
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_before timing.crossings%rowtype;
  v_after timing.crossings%rowtype;
  v_bib text;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_captured_at is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- ⚠️ **Assigned to a variable rather than written inline in the `update`.** PL/pgSQL ends an
  -- `if` condition at the first `then` it meets, so a `case` inside one does not compile and the
  -- error names the `case` — a trap this repository has already paid a full apply-and-bisect
  -- cycle for. Keeping every `case` out of a condition is the habit that avoids it.
  v_bib := nullif(btrim(coalesce(p_bib, '')), '');

  select * into v_before from timing.crossings where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_crossing');
  end if;

  update timing.crossings
     set bib = v_bib,
         captured_at = p_captured_at
   where id = p_id
     and bib is not distinct from nullif(btrim(coalesce(p_expected_bib, '')), '')
     and captured_at = p_expected_captured_at
  returning * into v_after;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'changed_elsewhere');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_after.event_id,
    auth.uid(),
    'crossing_edited',
    jsonb_build_object(
      'crossing_id', p_id,
      'before', jsonb_build_object(
        'bib', v_before.bib,
        'captured_at', v_before.captured_at,
        'team_id', v_before.team_id
      ),
      'after', jsonb_build_object(
        'bib', v_after.bib,
        'captured_at', v_after.captured_at,
        'team_id', v_after.team_id
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'bib', v_after.bib,
    'orphan', v_after.team_id is null
  );
end;
$$;

revoke all on function timing.edit_crossing(uuid, text, timestamptz, text, timestamptz)
  from public, anon;
grant execute on function timing.edit_crossing(uuid, text, timestamptz, text, timestamptz)
  to authenticated;
