-- ==========================================================================================
-- A crossing nobody captured, added from the timing log by somebody who may correct it
-- ==========================================================================================
--
-- [ADR-071](../../../../docs/architecture/decisions/adr-071-a-crossing-can-be-added-and-retimed-from-the-log.md).
-- Written on race day, 1 November 2026, after the race: finishers who reached the line while
-- no phone recorded them are on the marshals' paper, and the only way into `timing.crossings`
-- was `record_crossing()` — which stamps a tap, checks the caller is on the race's roster, and
-- cannot be told a time from a sheet of paper after the event.
--
-- ## Why not `record_crossing()` with `p_source => 'manual'`
--
-- That function is the capture screen's contract, and three things about it are wrong here:
--
-- 1. **It asks the marshal permission and the roster.** ADR-036 checks the roster for
--    everybody, an admin included, which is right for a phone at the line and wrong for a desk
--    copying times off paper. This asks `timing.crossing.resolve` — the same power that already
--    lets somebody re-bib and discard captures on the log, so it hands nobody anything new.
-- 2. **It never refuses anything.** At the line, an anomaly flags and never blocks, because the
--    moment is the scarce resource. At a desk it is the other way round: there is time to be
--    right, and a typo in a bib or an hour should be refused while the person who made it is
--    still looking at the paper.
-- 3. **It writes no audit row.** A capture is the marshal's own record; an added one is a
--    volunteer's claim about somebody's result, and a runner disputing it is owed the record of
--    who made it and when.
--
-- ## What it refuses, and in what order
--
-- `refused` and `no_such_event` first, in this schema's usual order. Then, because the form
-- is a desk rather than a finish line:
--
-- * **`bib_required`** — a crossing nobody can be matched to is not worth adding by hand.
-- * **`published`** — a correction after publication is *unpublish, fix, publish* (ADR-042),
--   and the same refusal `reset_event()` and `reopen_event()` already give. ⚠️ **`edit_crossing()`
--   does not refuse it**, and this migration does not change that function: that is a gap
--   recorded in ADR-071 rather than one closed in passing on race night.
-- * **`before_start`** — a typed time before the gun is a typo. The log *marks* a captured one
--   rather than refusing it, because a phone with a wrong clock still recorded a real crossing;
--   a person typing has no such excuse.
-- * **`in_future`** — later than now, give or take a minute for two clocks disagreeing.
-- * **`already_captured`** — this bib already has a crossing that counts. The answer is to
--   correct that one's time on the log, not to add a second, and the page sends the person to
--   it. Discarded captures do not count, so a discard-and-add is still possible.
-- * **`unknown_bib`** — no team on this race carries the bib. ⚠️ **Decided by the bib trigger
--   itself, never by a copy of its predicate**: the row is inserted inside a sub-block, and if
--   `crossings_resolve_team` left `team_id` null the sub-block raises and rolls the insert
--   back. A second statement of how a bib becomes a team is exactly the lockstep ADR-034 says
--   the rewrite may not break.
--
-- ## Idempotent on the form's own id, under a per-race lock
--
-- The page draws a fresh uuid into each add form, so a double click or a re-sent POST presents
-- the same id twice and the second answers `ok` without writing — `record_crossing()`'s
-- `on conflict (id) do nothing` reasoning, made explicit here because the replay has to be
-- recognised **before** the duplicate check, or the second press would be told the bib was
-- already captured by the first. The advisory lock is what stops two volunteers adding the same
-- bib off two copies of the same paper in the same second.
--
-- `marshal_id` is `auth.uid()` — who added it — and `source` is `'manual'`, which the column
-- has allowed since `20260911140000` and nothing has written until now.

create or replace function timing.add_crossing(
  p_id uuid,
  p_event_slug text,
  p_bib text,
  p_captured_at timestamptz
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_existing timing.crossings%rowtype;
  v_after timing.crossings%rowtype;
  v_bib text;
  v_start timestamptz;
begin
  if not identity.has_permission('timing.crossing.resolve') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if p_id is null or p_captured_at is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  v_bib := nullif(btrim(coalesce(p_bib, '')), '');
  if v_bib is null then
    return jsonb_build_object('ok', false, 'reason', 'bib_required');
  end if;

  -- One add at a time per race. Two keys rather than one hashed string, so this lock cannot
  -- collide with any other single-key advisory lock taken anywhere in the database.
  perform pg_advisory_xact_lock(hashtext('timing.add_crossing'), hashtext(v_event.id::text));

  -- The replay of an add that already landed — see the header.
  select * into v_existing from timing.crossings where id = p_id;
  if found then
    if v_existing.event_id <> v_event.id then
      return jsonb_build_object('ok', false, 'reason', 'incomplete');
    end if;

    return jsonb_build_object('ok', true, 'id', p_id, 'bib', v_existing.bib, 'replayed', true);
  end if;

  if v_event.results_published_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'published');
  end if;

  v_start := coalesce(v_event.actually_started_at, v_event.start_at);
  if p_captured_at < v_start then
    return jsonb_build_object('ok', false, 'reason', 'before_start');
  end if;

  if p_captured_at > now() + interval '1 minute' then
    return jsonb_build_object('ok', false, 'reason', 'in_future');
  end if;

  if exists (
    select 1 from timing.crossings c
     where c.event_id = v_event.id
       and c.bib = v_bib
       and c.resolved_action is distinct from 'discarded'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_captured');
  end if;

  begin
    insert into timing.crossings (id, event_id, marshal_id, bib, captured_at, source)
    values (p_id, v_event.id, auth.uid(), v_bib, p_captured_at, 'manual')
    returning * into v_after;

    -- The trigger has already run, and its answer is the only statement of whether this bib
    -- belongs to anybody. Raising here rolls the insert back to the start of this block.
    if v_after.team_id is null then
      raise exception 'unknown_bib' using errcode = 'P0001';
    end if;
  exception
    when raise_exception then
      return jsonb_build_object('ok', false, 'reason', 'unknown_bib');
  end;

  -- After the write and only when it happened — `20260913220000`'s rule.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'crossing_added',
    jsonb_build_object(
      'crossing_id', p_id,
      'bib', v_after.bib,
      'captured_at', v_after.captured_at,
      'team_id', v_after.team_id
    )
  );

  return jsonb_build_object('ok', true, 'id', p_id, 'bib', v_after.bib);
end;
$$;

revoke all on function timing.add_crossing(uuid, text, text, timestamptz) from public, anon;
grant execute on function timing.add_crossing(uuid, text, text, timestamptz) to authenticated;
