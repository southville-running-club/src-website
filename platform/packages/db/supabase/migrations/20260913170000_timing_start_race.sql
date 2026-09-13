-- ==========================================================================================
-- The gun goes once: starting a race, and clearing a false start
-- ==========================================================================================
--
-- Issue [#250](https://github.com/southville-running-club/src-website/issues/250), under
-- [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- `timing.events.actually_started_at` has existed since `20260911140000` and nothing has ever
-- written it — `20260912100000` refuses `update_event()` once it is set, and every split is
-- measured against `coalesce(actually_started_at, start_at)`, so it is already load-bearing
-- for a column no surface can fill in.
--
-- ⚠️ **The old application wrote it from the client, as a conditional `UPDATE` under a table
-- policy.** There is no policy in this schema and there will not be one (ADR-035), so it is a
-- function — which is the better answer anyway, for the reason the next section gives.
--
-- ## ⚠️ Starting a race twice must not move the clock, and that is the whole design
--
-- Every runner's time in the race is measured from this one value. A second press — the
-- second volunteer on the second phone, the double tap of somebody's cold thumb, the browser
-- that retried a request it thought had failed — must **not** overwrite it, because the first
-- value is the one the gun actually went on and the second is however long it took somebody
-- to press again.
--
-- So the guard is not `if actually_started_at is not null then return` followed by an
-- `update`. **That is a check and a write with a gap between them**, and two callers can both
-- pass the check before either writes. The guard is in the `update`'s own `where` clause:
--
--     update timing.events
--        set actually_started_at = now()
--      where id = … and actually_started_at is null
--
-- Under `read committed` — Postgres's default, and what PostgREST gives every call here — the
-- second statement **blocks on the row lock the first is holding**, and when it is released it
-- re-evaluates its `where` against the *committed* new version of the row. `actually_started_at`
-- is no longer null, so it matches nothing and updates nothing. There is no window, and no
-- advisory lock is needed: the row itself is the lock, and there is exactly one row.
--
-- **The loser learns the truth rather than a failure.** `{ok: false, reason: 'already_started'}`
-- carries `actually_started_at` — the value that won — so the second device shows the same
-- moment as the first instead of a refusal it has to interpret. A start screen that said only
-- "that did not work" would send somebody looking for a button to press again.
--
-- ## A clock reaching zero starts nothing
--
-- Nothing here reads `start_at` at all. `now()` is what is stored, because the fact being
-- recorded is *when the race actually started*, and a scheduled time that has passed is not
-- that. A start before the scheduled time is likewise not refused: a race can go off early,
-- and a database that argued with a start line is a database that gets worked around.
--
-- ## clear_start — a false start, and the one thing that closes the door
--
-- A false start is a real thing and it happens before anybody has crossed anything. So
-- `clear_start()` puts `actually_started_at` back to null — which also makes the race editable
-- again, because `update_event()` reads the same column, and that is the correct consequence
-- rather than a side effect.
--
-- ⚠️ **It is refused the moment a single crossing exists**, and that is the line between this
-- function and the danger zone. A crossing's split is `captured_at - coalesce(actually_started_at,
-- start_at)`; clearing the start after one has landed silently re-times it against `start_at`,
-- for a row nobody re-checks. Un-timing a race that has begun being timed is a destructive act
-- on data somebody recorded, and destructive acts belong on the page that is labelled as one.
--
-- **`not_started` rather than `ok` for clearing a race that never started.** Answering "done"
-- to a request that changed nothing is the `unassign_marshal()` argument exactly: a page that
-- says it has cleared the start is a page somebody believes.
--
-- ## What is deliberately not guarded
--
-- **Neither function looks at `finished_at`.** Nothing writes that column yet —
-- [#253](https://github.com/southville-running-club/src-website/issues/253) owns finishing —
-- so a branch for it would be a rule about a state nothing can reach, which is the thing
-- `20260912100000`'s own header refused to do for `results_published_at`. A finished race has
-- `actually_started_at` set in every reachable ordering, so `already_started` is the honest
-- answer to starting one, and a finished race with crossings is already refused a clear. The
-- start *page* does render "Race finished", because a row can hold that value today whether or
-- not a function wrote it, and a page that ignored it would be wrong about the race in front of
-- somebody.
--
-- ## The audit trail
--
-- `timing.admin_actions` gains two actions, `race_started` and `start_cleared`, joining #245's
-- two. ⚠️ **Only the press that actually set the clock is audited**, which departs from
-- `assign_marshal()`'s "a repeat ask is still an ask". The reason is what this table is *for*
-- here: somebody arguing about a result goes to it to ask **when the race started**, and a
-- second row naming a second time and a second person is a second candidate answer to that
-- question. The losing caller is told the truth in its own return value and writes nothing.

-- ------------------------------------------------------------------------------------------
-- start_event — the gun
-- ------------------------------------------------------------------------------------------
-- `p_event_slug`, not `#250`'s `p_slug`: every other function in this schema names it that and
-- PostgREST calls are by argument name, so one odd spelling is one call site that has to
-- remember. The writer's `{ok, reason}` envelope rather than a raised error, because the
-- caller is a form and the person pressing it is owed words.
create or replace function timing.start_event(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_started timestamptz;
begin
  -- `identity.has_permission` reads `auth.uid()` from the request's own token, which
  -- `security definer` does not change.
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- See the header: the guard is the `where` clause and not a preceding `if`, so two
  -- concurrent callers cannot both pass a check before either writes.
  update timing.events
     set actually_started_at = now()
   where id = v_event.id
     and actually_started_at is null
  returning actually_started_at into v_started;

  if v_started is null then
    -- Nothing was updated, so somebody else's press is the one that counts. Re-read rather
    -- than trusting the row this transaction selected before the other one committed.
    select actually_started_at into v_started
      from timing.events
     where id = v_event.id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'already_started',
      -- The value that won, so the losing device shows the same moment as the winning one.
      'actually_started_at', v_started
    );
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'race_started',
    jsonb_build_object('event_slug', v_event.slug, 'actually_started_at', v_started)
  );

  return jsonb_build_object(
    'ok', true,
    'slug', v_event.slug,
    'actually_started_at', v_started
  );
end;
$$;

revoke all on function timing.start_event(text) from public, anon;
grant execute on function timing.start_event(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- clear_start — a false start, and only before anything has been timed
-- ------------------------------------------------------------------------------------------
create or replace function timing.clear_start(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_cleared timestamptz;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if v_event.actually_started_at is null then
    -- Not an error and not a success: nothing was cleared, and a page saying otherwise is a
    -- page somebody believes. `unassign_marshal()`'s `not_on_roster` is the same shape.
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;

  -- ⚠️ **The line between this and the danger zone.** A split is measured against
  -- `coalesce(actually_started_at, start_at)`, so clearing the start after a crossing has
  -- landed silently re-times it — for rows nobody re-checks.
  if exists (select 1 from timing.crossings c where c.event_id = v_event.id) then
    return jsonb_build_object('ok', false, 'reason', 'crossings_exist');
  end if;

  -- Guarded in the `where` clause for `start_event()`'s reason, so a clear racing a start
  -- cannot un-set a value that arrived in between.
  update timing.events
     set actually_started_at = null
   where id = v_event.id
     and actually_started_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;

  v_cleared := v_event.actually_started_at;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'start_cleared',
    -- The value that was thrown away, because the audit trail is the only place it now
    -- exists — the column it came out of is null.
    jsonb_build_object('event_slug', v_event.slug, 'was_started_at', v_cleared)
  );

  return jsonb_build_object('ok', true, 'slug', v_event.slug);
end;
$$;

revoke all on function timing.clear_start(text) from public, anon;
grant execute on function timing.clear_start(text) to authenticated;
