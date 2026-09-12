-- ==========================================================================================
-- An event can be listed, read in full, and corrected before it starts
-- ==========================================================================================
--
-- Issue #247, under
-- [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- `20260912090000` added `create_event()` and said, in its own comment, that editing a running
-- "is its own decision and its own function". This is that function, and the two reads the
-- events hub needs before it can show anything at all.
--
-- ## Why a list and a detail rather than one function
--
-- They answer different questions and they will have different audiences the moment there is
-- more than one race. `list_events()` is "what is there", cheap enough to render a page from;
-- `event_detail()` is one running with the counts a volunteer is deciding from. Folding the
-- counts into the list would make the index pay for the detail page on every view, and folding
-- the detail into the list would make the caller pick a row out of an array it did not ask for.
--
-- ## ⚠️ What `update_event` may not change, and why each is refused
--
-- **`format` is not a parameter.** It decides how every bib is derived and which prizes exist.
-- `create_event()` refuses to upsert it for that reason, and an update function that took it
-- would be the same hole through a different door. Changing a race from relay to solo after it
-- has teams is a new event, not an edit.
--
-- **`slug` is not a parameter either.** It is how `worker/routing.ts` finds the event behind
-- `/nn/<year>/results/`, and it is the idempotency anchor an entry-list import is keyed on.
-- Renaming it silently orphans both.
--
-- ⚠️ **And the whole function is refused once `actually_started_at` is set.** Every split and
-- every finish time is measured against `coalesce(actually_started_at, start_at)`, so moving
-- the start after the gun rewrites every derived time in the race, for rows nobody re-checks.
-- The refusal is deliberately for the *whole* update rather than for `start_at` alone: a
-- function that quietly applied four of its five arguments and dropped the fifth is the kind
-- of partial success that reads as a bug at a finish line, where nobody has time to work out
-- which half landed. A typo in the name after the gun is fixed by a human with SQL, and that
-- is the right amount of friction for the two occasions a year it happens.
--
-- ## What is deliberately not here
--
-- **No `results_published_at`.** #247 asks `event_detail` to carry it and **the column does not
-- exist** — publication is [#241](https://github.com/southville-running-club/src-website/issues/241),
-- which owns both the column and the state machine. Returning a key that is always null would
-- be a page rendering a lifecycle state nothing can reach. `event_detail` carries
-- `actually_started_at` and `finished_at`, which do exist, and #241 adds the third.
--
-- **Nothing writes `timing.admin_actions` yet.** It is still a table with no writer;
-- [#245](https://github.com/southville-running-club/src-website/issues/245) is specified to be
-- its first, for assigning and unassigning a marshal. `create_event()` audits nothing and this
-- follows it: the row existing is the evidence that somebody made it. Whether an edit deserves
-- an audit row is a real question and it is #245's to open, not this migration's to answer on
-- the way past.

-- ------------------------------------------------------------------------------------------
-- list_events — what races exist, and roughly where each has got to
-- ------------------------------------------------------------------------------------------
-- `null` rather than an exception when refused, exactly as `event_roster()` and
-- `results_for_event()` do. There is no "no such event" case for a list: an empty array is a
-- true answer and `[]` is what an admin with no races sees.
create or replace function timing.list_events()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
begin
  -- `identity.has_permission` reads `auth.uid()` from the request's own token, which
  -- `security definer` does not change.
  if not identity.has_permission('timing.event.manage') then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'slug', e.slug,
        'name', e.name,
        'format', e.format,
        'start_at', e.start_at,
        'actually_started_at', e.actually_started_at,
        'finished_at', e.finished_at,
        -- Enough to sort the list by how much work is outstanding, and no more. The detail
        -- read is where a number is worth a query of its own.
        'teams', (select count(*)::int from timing.teams t where t.event_id = e.id),
        'open_anomalies', (
          select count(*)::int
            from timing.crossings c
           where c.event_id = e.id
             and c.anomaly_flag
             and c.resolved_at is null
        )
      ) order by e.start_at desc
    )
    from timing.events e
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.list_events() from public, anon;
grant execute on function timing.list_events() to authenticated;

-- ------------------------------------------------------------------------------------------
-- event_detail — one running, with the figures somebody is deciding from
-- ------------------------------------------------------------------------------------------
-- `null` for both "you may not" and "no such event", deliberately indistinguishable, so a
-- slug cannot be probed for existence by somebody who holds nothing.
create or replace function timing.event_detail(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v_event.slug,
    'name', v_event.name,
    'format', v_event.format,
    'start_at', v_event.start_at,
    'actually_started_at', v_event.actually_started_at,
    'finished_at', v_event.finished_at,
    'distance_m', v_event.distance_m,
    'course_notes', v_event.course_notes,
    'created_at', v_event.created_at,
    -- **`editable` is answered here rather than re-derived by every caller.** The page, the
    -- form and `update_event` must agree about whether the race has started, and a rule
    -- restated in three places is one that drifts in two of them.
    'editable', v_event.actually_started_at is null,
    'counts', jsonb_build_object(
      'teams', (select count(*)::int from timing.teams t where t.event_id = v_event.id),
      'runners', (
        select count(*)::int
          from timing.runners r
          join timing.teams t on t.id = r.team_id
         where t.event_id = v_event.id
      ),
      'crossings', (
        select count(*)::int from timing.crossings c where c.event_id = v_event.id
      ),
      'open_anomalies', (
        select count(*)::int
          from timing.crossings c
         where c.event_id = v_event.id
           and c.anomaly_flag
           and c.resolved_at is null
      ),
      'marshals', (
        select count(*)::int from timing.marshals m where m.event_id = v_event.id
      )
    )
  );
end;
$$;

revoke all on function timing.event_detail(text) from public, anon;
grant execute on function timing.event_detail(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- update_event — correcting a race before it is run
-- ------------------------------------------------------------------------------------------
-- A writer, so the `{ok, reason}` envelope rather than `null` — the caller is a form and the
-- person filling it in is owed words about why it was refused.
--
-- ⚠️ **Every argument is applied, including the two that may be null.** `p_distance_m` and
-- `p_course_notes` are set to whatever is passed, so clearing a course note is passing null
-- rather than a second "please clear it" flag. That makes this a whole-record update and the
-- form has to send every field back — which is what a form that rendered the record does
-- anyway, and it is the version with no way to half-apply.
create or replace function timing.update_event(
  p_event_slug text,
  p_name text,
  p_start_at timestamptz,
  p_distance_m integer default null,
  p_course_notes text default null
)
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

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- See the header: the start has gone, so every derived time is measured from it.
  if v_event.actually_started_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_started');
  end if;

  if p_name is null or btrim(p_name) = '' or p_start_at is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- The table's own check already refuses a non-positive distance; saying it here is what
  -- turns a raised exception into words a form can print.
  if p_distance_m is not null and p_distance_m <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_distance');
  end if;

  update timing.events
     set name = btrim(p_name),
         start_at = p_start_at,
         distance_m = p_distance_m,
         course_notes = p_course_notes
   where id = v_event.id;

  return jsonb_build_object('ok', true, 'slug', v_event.slug);
end;
$$;

revoke all on function timing.update_event(text, text, timestamptz, integer, text)
  from public, anon;
grant execute on function timing.update_event(text, text, timestamptz, integer, text)
  to authenticated;
