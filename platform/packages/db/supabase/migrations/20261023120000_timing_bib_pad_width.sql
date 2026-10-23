-- ==========================================================================================
-- A race's printed numbers have a width, and the numbers this platform hands out match it
-- ==========================================================================================
--
-- **The Nightingale Nightmare race numbers are printed zero-padded, 001 to 250** — supplied by
-- a maintainer on 23 October 2026. A marshal types what is on the vest, so the runner wearing
-- 001 is captured as `'001'`. `assign_bibs()` numbered the field `'1'`, `'2'`, `'3'`, and a bib
-- is matched as exact text, so `'001'` resolved to nobody. Every runner from 001 to 099 would
-- have been an orphan on the Anomalies page, each one blocking publication. The marshal would
-- have had no warning at the line, because the capture screen never looks a bib up.
--
-- ## ⚠️ Padding where the number is made, never where it is matched
--
-- The other fix was to make the trigger ignore leading zeros. That breaks the contract ADR-034
-- names as one the rewrite may not break — a bib is an opaque string, and `'0311'` is not
-- `'311'` — and a walk-in handed pool bib `05` relies on it. So every comparison is untouched
-- and the stored `team_number` carries the width instead. The derived bib is then `'001'` in
-- `bib.ts`, in `effective_bib()` and in `resolve_crossing_team_id()` alike, and nothing in that
-- lockstep changes.
--
-- **This is the old application's behaviour, which the port dropped.** `planBibAssignment()`
-- in `packages/shared/src/timing/registration/bib-assignment.ts` was copied with a `padWidth`
-- option and its tests, and nothing here ever called it. `timing-bibs.test.ts` now asserts
-- this function and that one agree, which is the lockstep the rest of that file is about.
--
-- ## A column on the race rather than a constant
--
-- Pass the Buck is a relay whose bibs are leg-first, `101` and `201`. A width of three written
-- for everybody would make those `1001` and `2001`. The width is a fact about one running's
-- printed numbers, so it is `timing.events.bib_pad_width`, and **null pads nothing**, which is
-- every other race's behaviour unchanged. It is read only when a number is made.
--
-- ⚠️ **A number longer than the width is written in full, never cut.** Postgres' `lpad()`
-- truncates — `lpad('1000', 3, '0')` is `'100'` — so both functions below check the length
-- first. A thousandth runner on a three-digit race gets `'1000'`, not runner 100's number.
--
-- ## Expand only
--
-- One nullable column, and `assign_bibs()` and `add_walk_in()` replaced with their signatures
-- unchanged. The deployed Worker's calls work before and after, so nothing here has to be
-- sequenced against the Cloudflare deploy.

alter table timing.events
  add column if not exists bib_pad_width smallint;

alter table timing.events
  drop constraint if exists events_bib_pad_width_shaped;
alter table timing.events
  add constraint events_bib_pad_width_shaped
  check (bib_pad_width is null or bib_pad_width between 1 and 6);

comment on column timing.events.bib_pad_width is
  'How many digits this running''s printed race numbers have, zero-padded. assign_bibs() and '
  'add_walk_in() pad a new team_number to it, so the derived bib matches what a marshal types '
  'off the vest. Null pads nothing. A number longer than the width is stored in full.';

-- ------------------------------------------------------------------------------------------
-- assign_bibs — number a field, once, at the width its numbers are printed
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20260913140000` apart from the width. Every rule that file argues still holds:
-- it skips anybody already numbered, carries on from the highest number taken, and orders by
-- `csv_row_index nulls last, created_at, id`.
--
-- **`team_number::integer` already reads `'001'` as 1**, so the next number after a padded
-- field is computed exactly as before. Only the text written changes.

create or replace function timing.assign_bibs(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_width smallint;
  v_next integer;
  v_team record;
  v_assigned integer := 0;
  v_already integer := 0;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id, bib_pad_width into v_event_id, v_width
    from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  select coalesce(max(t.team_number::integer), 0) + 1
    into v_next
    from timing.teams t
   where t.event_id = v_event_id
     and t.team_number ~ '^[0-9]+$';

  select count(*) into v_already
    from timing.teams t
   where t.event_id = v_event_id and t.team_number is not null;

  for v_team in
    select t.id
      from timing.teams t
     where t.event_id = v_event_id
       and t.team_number is null
     order by t.csv_row_index nulls last, t.created_at, t.id
  loop
    -- ⚠️ Length first: `lpad()` would cut a number longer than the width. See the header.
    update timing.teams
       set team_number = case
             when v_width is null or length(v_next::text) >= v_width then v_next::text
             else lpad(v_next::text, v_width, '0')
           end
     where id = v_team.id;
    v_next := v_next + 1;
    v_assigned := v_assigned + 1;
  end loop;

  if v_assigned > 0 then
    insert into timing.admin_actions (event_id, actor_id, action, detail)
    values (
      v_event_id,
      auth.uid(),
      'bibs_assigned',
      jsonb_build_object('assigned', v_assigned, 'already_assigned', v_already)
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'assigned', v_assigned, 'already_assigned', v_already
  );
end;
$$;

revoke all on function timing.assign_bibs(text) from public, anon;
grant execute on function timing.assign_bibs(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- add_walk_in — somebody who turned up at the desk, numbered at the same width
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20260913140000` apart from the width. **A walk-in has to be padded too**, or
-- a race smaller than its printed range would hand the desk a `'42'` for a vest reading 042 —
-- the same orphan this migration exists to stop, arriving one runner at a time on race day.

create or replace function timing.add_walk_in(
  p_event_slug text,
  p_firstname text,
  p_lastname text,
  p_gender text default null,
  p_age_on_day integer default null,
  p_club_name text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_width smallint;
  v_team_id uuid;
  v_number integer;
  v_team_number text;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id, bib_pad_width into v_event_id, v_width
    from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if nullif(btrim(coalesce(p_firstname, '')), '') is null
     or nullif(btrim(coalesce(p_lastname, '')), '') is null
  then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  select coalesce(max(t.team_number::integer), 0) + 1
    into v_number
    from timing.teams t
   where t.event_id = v_event_id
     and t.team_number ~ '^[0-9]+$';

  -- ⚠️ Length first: `lpad()` would cut a number longer than the width. See the header.
  v_team_number := case
    when v_width is null or length(v_number::text) >= v_width then v_number::text
    else lpad(v_number::text, v_width, '0')
  end;

  insert into timing.teams (event_id, team_number)
  values (v_event_id, v_team_number)
  returning id into v_team_id;

  insert into timing.runners (
    team_id, leg, firstname, lastname, gender, club_name, age_on_day, is_captain
  )
  values (
    v_team_id, 1, btrim(p_firstname), btrim(p_lastname),
    case lower(btrim(coalesce(p_gender, '')))
      when 'female' then 'female'
      when 'f' then 'female'
      when 'male' then 'male'
      when 'm' then 'male'
      when 'non_binary' then 'non_binary'
      else null
    end,
    nullif(btrim(coalesce(p_club_name, '')), ''),
    p_age_on_day,
    true
  );

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event_id,
    auth.uid(),
    'walk_in_added',
    jsonb_build_object('team_id', v_team_id, 'team_number', v_team_number)
  );

  return jsonb_build_object(
    'ok', true, 'team_id', v_team_id, 'team_number', v_team_number
  );
end;
$$;

revoke all on function timing.add_walk_in(text, text, text, text, integer, text)
  from public, anon;
grant execute on function timing.add_walk_in(text, text, text, text, integer, text)
  to authenticated;

-- ------------------------------------------------------------------------------------------
-- nn-2026: three digits, and any number already given out re-padded rather than reassigned
-- ------------------------------------------------------------------------------------------
-- The width is the supplied fact. The `update` of teams is for a state nobody writing this
-- could see: production was not readable from the session that wrote it, so whether **Assign
-- bibs** had already been pressed on `nn-2026` was unknown.
--
-- **If it had, re-padding is the whole of the fix and changes nobody's number.** The runner
-- given `'1'` is the runner wearing 001. Padding the text changes which string matches them
-- and nothing about who wears what. If it had not, the `update` touches no row.
--
-- ⚠️ **Guarded three ways, because a refusal here would take the whole `db push` down** —
-- every migration after it unapplied, the trap the root `CLAUDE.md` records against #134:
--
--   * **only while the race has not started**, so nothing renumbers a field on the course;
--   * **only a number of one or two digits with no leading zero**, so `'01'` or a non-numeric
--     `'T1'` is left exactly as it was rather than guessed at;
--   * **never onto a number another team already holds**, which would raise 23505 on
--     `teams_event_team_number_unique`.
--
-- Then every crossing on the race is re-resolved, exactly as `set_bib_override()` does, because
-- the trigger fires on a crossing's bib changing and not on a team's. Before the race that is a
-- rehearsal's crossings at most, and a rehearsal crossing typed `'1'` correctly stops matching.

update timing.events
   set bib_pad_width = 3
 where slug = 'nn-2026';

update timing.teams t
   set team_number = lpad(t.team_number, 3, '0')
  from timing.events e
 where e.id = t.event_id
   and e.slug = 'nn-2026'
   and e.actually_started_at is null
   and t.team_number ~ '^[1-9][0-9]?$'
   and not exists (
     select 1
       from timing.teams o
      where o.event_id = t.event_id
        and o.team_number = lpad(t.team_number, 3, '0')
   );

update timing.crossings c
   set bib = c.bib
  from timing.events e
 where e.id = c.event_id
   and e.slug = 'nn-2026';
