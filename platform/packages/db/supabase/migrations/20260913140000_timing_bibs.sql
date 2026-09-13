-- ==========================================================================================
-- Bibs: assign a field, override one for a walk-in, and add the constraint the code believes in
-- ==========================================================================================
--
-- Issue #249. `planBibAssignment()`, `computeNextTeamNumber()` and `findBibCollision()` were
-- ported with their tests and had nowhere to land: no function wrote `team_number`, `bib_leg1`
-- or `bib_leg2`, and with row-level security on and no policy nothing else could.
--
-- ## ⚠️ The constraint two ported modules already say exists
--
-- `bib-assignment.ts` says *"`unique (event_id, team_number)` blocks in-leg dupes"* and
-- `pairing.ts` says the constraint *"makes it impossible for real rows"*. **It was not in
-- `20260911140000`.** Both modules were written against a database that had it and ported into
-- one that did not, so every guarantee they claim rested on nothing. That is the shape of
-- defect this repository keeps finding by reading a comment and checking it.
--
-- ⚠️ **#249 asks for it `NOT VALID` then validated, per the constraints runbook, and Postgres
-- will not do that**: `UNIQUE constraints cannot be marked NOT VALID`, in as many words. That
-- pattern is for `CHECK` and `FOREIGN KEY`, whose validation is a scan the runbook defers; a
-- unique constraint *is* an index, and building it is the validation. Attempted against a real
-- Postgres before writing this, rather than discovering it in CI.
--
-- **Nothing is lost by that.** The runbook's pattern exists because a validated `ADD
-- CONSTRAINT` fails the migration if one existing row disagrees and nobody here can see
-- production's. `timing.teams` is empty in production — no roster has been imported — so the
-- scan is over nothing and the risk the runbook manages does not exist yet. If that stops
-- being true before this deploys, the answer is `create unique index concurrently` outside a
-- transaction, which is a runbook step rather than a migration.
--
-- **Nulls do not collide**, which is what makes this safe on a field that is not yet numbered:
-- Postgres treats nulls as distinct in a unique constraint, so every team imported before
-- `assign_bibs()` runs coexists happily.

alter table timing.teams
  drop constraint if exists teams_event_team_number_unique;
alter table timing.teams
  add constraint teams_event_team_number_unique unique (event_id, team_number);

comment on constraint teams_event_team_number_unique on timing.teams is
  'The constraint bib-assignment.ts and pairing.ts were both already written against. Nulls '
  'are distinct, so teams imported before assign_bibs() runs do not collide.';

-- ------------------------------------------------------------------------------------------
-- effective_bib — `effectiveBib()` in SQL, and the reason parity is testable at all
-- ------------------------------------------------------------------------------------------
-- ⚠️ **One definition, used by the collision guard and asserted against TypeScript.**
-- `resolve_crossing_team_id()` in `20260911140000` inlines this same rule as a `coalesce`
-- chain, which is fine for a trigger doing one comparison and useless for a guard that needs
-- the value itself. Rather than write the rule a third time, it is named here — and
-- `timing-bibs.test.ts` asserts this function and `effectiveBib()` agree case for case, which
-- is the lockstep test #249 asks for.
--
-- `immutable` because it is pure: the same four arguments always give the same answer, which
-- is what lets it be used in a `where` clause without Postgres re-evaluating it per row.
--
-- **A bib is opaque and returned verbatim** — `'0311'` is not `'311'`.
-- ⚠️ **`p_leg` is `integer`, not `smallint`, and that is not cosmetic.** An unadorned `1` in
-- PL/pgSQL is an `integer`, so a `smallint` parameter meant every internal call read
-- `function timing.effective_bib(text, text, integer, text) does not exist` — a missing-function
-- error for a function that is right there, from a caller two lines below it. Widening the
-- parameter accepts both, since `smallint` widens to `integer` implicitly and nothing else does.
create or replace function timing.effective_bib(
  p_override text,
  p_team_number text,
  p_leg integer,
  p_format text
)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case
    -- An override wins, whatever it says. Empty is absent, matching `effectiveBib()`'s own
    -- safety net for a row that stored `''` rather than null.
    when nullif(btrim(coalesce(p_override, '')), '') is not null then p_override
    when p_team_number is null then null
    when p_format = 'solo' then p_team_number
    else p_leg::text || p_team_number
  end;
$$;

-- Granted to nobody: reachable from the definer functions below and from nothing else, which
-- is the shape `entries` uses for every helper that must not be callable in its own right.
revoke all on function timing.effective_bib(text, text, integer, text) from public;

-- ------------------------------------------------------------------------------------------
-- assign_bibs — number a field, once
-- ------------------------------------------------------------------------------------------
-- `planBibAssignment()`'s rules, in SQL: order the field, skip anybody who already has a
-- number, and carry on from the highest number already taken rather than from 1.
--
-- ⚠️ **Idempotent because it skips, not because it recomputes.** Running it twice must produce
-- the same numbers — somebody has pinned the first run's numbers to their vest. So the second
-- run assigns nothing and says so, and `import_from_entries()` and `import_registration()` both
-- already refuse to touch `team_number` for the same reason.
--
-- ⚠️ **`csv_row_index nulls last` is load-bearing now that a roster can arrive from `entries`.**
-- Only the CSV path sets that column; #248's import leaves it null, so ordering by it alone
-- would be ordering the whole Nightingale field by a column that is null for every row — which
-- Postgres is free to return in any order at all. `created_at, id` settles it deterministically,
-- and `created_at` for an `entries` roster is the order purchases were made.
create or replace function timing.assign_bibs(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_next integer;
  v_team record;
  v_assigned integer := 0;
  v_already integer := 0;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id into v_event_id from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- **Carry on from the highest number already taken.** A non-numeric `team_number` — the old
  -- application's smoke-test `"T1"` — counts as assigned and is ignored when finding the
  -- maximum, exactly as `planBibAssignment()` does; the unique constraint is on the literal
  -- text, so a new numeric assignment cannot collide with it.
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
    update timing.teams set team_number = v_next::text where id = v_team.id;
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
-- set_bib_override — the physical bib somebody was actually handed
-- ------------------------------------------------------------------------------------------
-- ⚠️ **`findBibCollision()`'s SQL twin, and the comparison is on the *effective* bib.** A
-- clash is not "two teams with the same override" — it is two teams whose **resolved** bibs
-- are equal, and one of them may be derived. Overriding team 12's leg 1 to `"13"` on a solo
-- race clashes with team 13, which has no override at all. Comparing overrides alone would
-- miss it and two runners would cross on one bib.
--
-- ⚠️ **A bib is opaque and compared verbatim.** `"0311"` is not `"311"` — the leading zero is
-- what is printed on the vest, and `bib.ts` says the same thing twice.
create or replace function timing.set_bib_override(
  p_event_slug text,
  p_team_id uuid,
  p_leg smallint,
  p_bib text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_team timing.teams%rowtype;
  v_bib text;
  v_leg1 text;
  v_leg2 text;
  v_eff1 text;
  v_eff2 text;
  v_clash record;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if p_leg not in (1, 2) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_leg');
  end if;

  -- ⚠️ **Leg 2 has no meaning on a solo race**, and `effectiveBib()` says so — refusing here
  -- stops an override being stored that nothing will ever resolve.
  if v_event.format = 'solo' and p_leg = 2 then
    return jsonb_build_object('ok', false, 'reason', 'no_such_leg');
  end if;

  select * into v_team from timing.teams where id = p_team_id and event_id = v_event.id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_team');
  end if;

  -- An empty override is stored as null, never as `''`. `effectiveBib()` treats both as absent
  -- and says the action layer stores null; this is that action layer.
  v_bib := nullif(btrim(coalesce(p_bib, '')), '');

  v_leg1 := case when p_leg = 1 then v_bib else v_team.bib_leg1 end;
  v_leg2 := case when p_leg = 2 then v_bib else v_team.bib_leg2 end;

  -- The target's proposed effective bibs, resolved once. ⚠️ **Held in variables rather than
  -- called inside the query**, so a null — a team with no number and no override — is compared
  -- explicitly with `is not null` instead of disappearing into an `in (…)` list, where a null
  -- makes the whole predicate null and the clash is silently not found.
  v_eff1 := timing.effective_bib(v_leg1, v_team.team_number, 1, v_event.format);
  v_eff2 := case
              when v_event.format = 'relay'
              then timing.effective_bib(v_leg2, v_team.team_number, 2, v_event.format)
              else null
            end;

  -- The target's own two legs must differ. On a solo race there is only one, so this cannot
  -- fire — which is why it is guarded rather than assumed.
  if v_eff1 is not null and v_eff1 = v_eff2 then
    return jsonb_build_object('ok', false, 'reason', 'bib_taken', 'same_team', true);
  end if;

  select t.id, t.team_number, t.name
    into v_clash
    from timing.teams t
   where t.event_id = v_event.id
     and t.id <> v_team.id
     and (
       (v_eff1 is not null
        and (timing.effective_bib(t.bib_leg1, t.team_number, 1, v_event.format) = v_eff1
             or (v_event.format = 'relay'
                 and timing.effective_bib(t.bib_leg2, t.team_number, 2, v_event.format) = v_eff1)))
       or
       (v_eff2 is not null
        and (timing.effective_bib(t.bib_leg1, t.team_number, 1, v_event.format) = v_eff2
             or (v_event.format = 'relay'
                 and timing.effective_bib(t.bib_leg2, t.team_number, 2, v_event.format) = v_eff2)))
     )
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'bib_taken',
      'same_team', false,
      'with_team_number', v_clash.team_number
    );
  end if;

  update timing.teams
     set bib_leg1 = v_leg1, bib_leg2 = v_leg2
   where id = v_team.id;

  -- ⚠️ **The trigger fires on a *crossing's* bib changing, not a *team's*.** A bib already
  -- captured under the old resolution still points at whoever it resolved to then, so a
  -- no-op update re-runs `resolve_crossing_team_id()` over this race. `bib` is named in the
  -- trigger's `update of` list, so assigning it to itself is what re-fires it.
  update timing.crossings set bib = bib where event_id = v_event.id;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'bib_override_set',
    jsonb_build_object('team_id', v_team.id, 'leg', p_leg, 'bib', v_bib)
  );

  return jsonb_build_object('ok', true, 'team_id', v_team.id, 'leg', p_leg, 'bib', v_bib);
end;
$$;

revoke all on function timing.set_bib_override(text, uuid, smallint, text) from public, anon;
grant execute on function timing.set_bib_override(text, uuid, smallint, text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- add_walk_in — somebody who turned up at the desk
-- ------------------------------------------------------------------------------------------
-- No `purchase_order_id`, because there is no purchase: a walk-in is not an entry that came
-- through `entries` and giving them a fabricated anchor would make them look like one — and
-- `import_from_entries()`'s removal sweep is scoped to anchors that *are* purchases of the
-- event, so a null keeps a walk-in safe from it.
--
-- **`email` stays null.** The old application stored `""`, which is a value that reads as an
-- address somebody has and is not one.
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
  v_team_id uuid;
  v_number integer;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id into v_event_id from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if nullif(btrim(coalesce(p_firstname, '')), '') is null
     or nullif(btrim(coalesce(p_lastname, '')), '') is null
  then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- `computeNextTeamNumber()`'s rule: the next number after the highest taken, so a walk-in
  -- never reuses a number that has been printed.
  select coalesce(max(t.team_number::integer), 0) + 1
    into v_number
    from timing.teams t
   where t.event_id = v_event_id
     and t.team_number ~ '^[0-9]+$';

  insert into timing.teams (event_id, team_number)
  values (v_event_id, v_number::text)
  returning id into v_team_id;

  insert into timing.runners (
    team_id, leg, firstname, lastname, gender, club_name, age_on_day, is_captain
  )
  values (
    v_team_id, 1, btrim(p_firstname), btrim(p_lastname),
    -- Normalised to `entries`' vocabulary the way every other writer is — ADR-039. A value
    -- nobody recognises becomes null, which reads back as no prize band rather than a guess.
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
    jsonb_build_object('team_id', v_team_id, 'team_number', v_number::text)
  );

  return jsonb_build_object(
    'ok', true, 'team_id', v_team_id, 'team_number', v_number::text
  );
end;
$$;

revoke all on function timing.add_walk_in(text, text, text, text, integer, text)
  from public, anon;
grant execute on function timing.add_walk_in(text, text, text, text, integer, text)
  to authenticated;
