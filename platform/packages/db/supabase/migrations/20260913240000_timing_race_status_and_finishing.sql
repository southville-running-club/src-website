-- ==========================================================================================
-- A label that replaces a time, and a race the director can call finished
-- ==========================================================================================
--
-- Issue [#253](https://github.com/southville-running-club/src-website/issues/253), under
-- [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- `timing.teams.race_status` and `timing.events.finished_at` have both existed since
-- `20260911140000` and nothing has ever written either.
--
-- ## ⚠️ A status is a label on top of crossings and never a change to one
--
-- `teamRaceStatus()` and `sortResults()` already read it: DNS suppresses every derived time,
-- and **DNF and DQ keep leg A**, because a captured fact stays captured. Nothing in this
-- migration edits, hides or reorders a crossing, and nothing here should ever learn to — the
-- crossing is what a marshal saw, and the status is what the club decided afterwards.
--
-- ## ⚠️ The reversal is audited, and that is the whole point of auditing this at all
--
-- The old application audited setting a DQ and **not** undoing one, which is exactly backwards:
-- a runner disputing a disqualification is owed the record of it being lifted as much as the
-- record of it being applied. `set_race_status()` writes an audit row on every call that
-- changes anything, carrying the old value and the new — including `null` on either side.
--
-- ## Finishing is reversible, a label, and never a gate
--
-- `finish_event()` sets `finished_at = now()` and `reopen_event()` clears it. **Capture, edits
-- and status all keep working afterwards**, exactly as the old application treated it, because
-- the last runner's crossing arrives after the race director has called it. A `finished_at` that
-- refused anything would be a race that stopped accepting the thing it exists to record.
--
-- ## ⚠️ What #253 asks for and this does not build, deliberately
--
-- **`reopen_event()` is not refused while results are published.** #253 asks for that, and
-- `timing.events` has no `results_published_at` column — publication is
-- [#241](https://github.com/southville-running-club/src-website/issues/241), which owns both the
-- column and the state machine, and #253's own text calls that ordering *"the one ordering #241
-- enforces"*.
--
-- **Two migrations have already refused to invent it in almost these words.**
-- `20260912100000` declined to return the key from `event_detail()` because *"returning a key
-- that is always null would be a page rendering a lifecycle state nothing can reach"*, and
-- `20260913170000` declined a `finished_at` branch for the same reason, naming this issue as its
-- owner. Adding half of #241's state machine here to satisfy a checkbox would reverse a rule
-- this schema has applied twice — so the guard belongs in #241, in the same change that makes
-- publication reachable, and this header is the record of the decision rather than an omission.

-- ------------------------------------------------------------------------------------------
-- team_status_list — who is on this race, and what the club has decided about each
-- ------------------------------------------------------------------------------------------
-- ⚠️ **A read of its own rather than `event_roster()`.** That one is behind
-- `timing.registration.import` — the entry list's permission — and this page is behind
-- `timing.event.manage`. Reusing it would mean either widening a read or opening this page to a
-- permission it is not about; the two surfaces answer different questions to different people.
--
-- Searchable by bib and by name, because #253 says so and because a volunteer marking a DNF is
-- working from whichever of the two the runner gave them.
create or replace function timing.team_status_list(
  p_event_slug text,
  p_search text default null
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
begin
  if not identity.has_permission('timing.event.manage') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  -- A blank search is no search. Trimmed first, because a box somebody tabbed through holds a
  -- space and a `like '% %'` would quietly answer nothing.
  v_search := nullif(btrim(coalesce(p_search, '')), '');

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'team_id', t.id,
        'team_number', t.team_number,
        'name', t.name,
        'race_status', t.race_status,
        'bib_leg1', t.bib_leg1,
        'bib_leg2', t.bib_leg2,
        'runners', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'leg', r.leg,
              'firstname', r.firstname,
              'lastname', r.lastname,
              -- ⚠️ **A guide is marked and is still a runner.** They are in no category and
              -- never in a prize, and a status still applies to them — #253 says so, and a page
              -- that hid them would leave a person on the course nobody could mark.
              'role', r.role
            ) order by r.leg
          ), '[]'::jsonb)
          from timing.runners r where r.team_id = t.id
        )
      ) order by t.team_number
    )
    from timing.teams t
    where t.event_id = v_event.id
      and (
        v_search is null
        or t.team_number = v_search
        or t.bib_leg1 = v_search
        or t.bib_leg2 = v_search
        or exists (
          select 1 from timing.runners r
          where r.team_id = t.id
            and (r.firstname || ' ' || r.lastname) ilike '%' || v_search || '%'
        )
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.team_status_list(text, text) from public, anon;
grant execute on function timing.team_status_list(text, text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- set_race_status — DNS, DNF, DQ, or none of them
-- ------------------------------------------------------------------------------------------
-- `null` clears it, which is the reversal — and the reversal is audited exactly as the setting
-- is. See the header: the old application audited one and not the other.
create or replace function timing.set_race_status(
  p_event_slug text,
  p_team_id uuid,
  p_status text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_before text;
  v_after timing.teams%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_status is not null and p_status not in ('dns', 'dnf', 'dq') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- ⚠️ **Scoped to the event in the address as well as to the team id.** A team id alone would
  -- let a volunteer on one race's page change a team on another, and the page has no way to
  -- show that it happened.
  select race_status into v_before
    from timing.teams
   where id = p_team_id and event_id = v_event.id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_team');
  end if;

  update timing.teams
     set race_status = p_status
   where id = p_team_id
     and event_id = v_event.id
  returning * into v_after;

  -- Nothing changed, so there is nothing to record. Not a failure — pressing "clear" on a team
  -- that has no status is a perfectly ordinary thing to do twice.
  if v_before is not distinct from p_status then
    return jsonb_build_object(
      'ok', true,
      'team_id', p_team_id,
      'race_status', p_status,
      'changed', false
    );
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'race_status_set',
    jsonb_build_object(
      'team_id', p_team_id,
      'team_number', v_after.team_number,
      -- Both sides, both nullable. "The DQ was lifted" without saying what it was is not
      -- something a dispute can be settled on.
      'before', v_before,
      'after', p_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'team_id', p_team_id,
    'race_status', p_status,
    'changed', true
  );
end;
$$;

revoke all on function timing.set_race_status(text, uuid, text) from public, anon;
grant execute on function timing.set_race_status(text, uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- finish_event / reopen_event — a label the race director sets and can unset
-- ------------------------------------------------------------------------------------------
-- ⚠️ **Neither is a gate.** `record_crossing()`, the resolution functions and
-- `set_race_status()` are all untouched by `finished_at`, and the test file asserts that a
-- crossing still lands after a finish. The last runner's crossing arrives after somebody has
-- called the race, and a finish that refused it would lose exactly the result it was declaring.
create or replace function timing.finish_event(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  -- Idempotent by its own `where`, like `start_event()`: the second of two presses is answered
  -- with the time the first one set, so two devices agree rather than one seeing an error.
  update timing.events
     set finished_at = now()
   where slug = p_event_slug
     and finished_at is null
  returning * into v_event;

  if found then
    insert into timing.admin_actions (event_id, actor_id, action, detail)
    values (
      v_event.id,
      auth.uid(),
      'race_finished',
      jsonb_build_object('finished_at', v_event.finished_at)
    );

    return jsonb_build_object('ok', true, 'finished_at', v_event.finished_at);
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  return jsonb_build_object(
    'ok', false,
    'reason', 'already_finished',
    -- The winning time, so the losing device shows the same moment. `start_event()`'s rule.
    'finished_at', v_event.finished_at
  );
end;
$$;

revoke all on function timing.finish_event(text) from public, anon;
grant execute on function timing.finish_event(text) to authenticated;

create or replace function timing.reopen_event(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  -- ⚠️ **No `results_published_at` guard — see the header.** #241 owns that column and the
  -- ordering, and inventing it here would be a rule about a state nothing can reach.
  update timing.events
     set finished_at = null
   where slug = p_event_slug
     and finished_at is not null
  returning * into v_event;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_finished');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (v_event.id, auth.uid(), 'race_reopened', jsonb_build_object());

  return jsonb_build_object('ok', true, 'slug', v_event.slug);
end;
$$;

revoke all on function timing.reopen_event(text) from public, anon;
grant execute on function timing.reopen_event(text) to authenticated;
