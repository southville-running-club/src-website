-- ==========================================================================================
-- A visually impaired runner's guide wears a race number of their own, on a solo race too
-- ==========================================================================================
--
-- [ADR-061](../../../../docs/architecture/decisions/adr-061-a-guide-wears-a-number-of-their-own.md).
-- **Supplied by a maintainer on 23 October 2026: a guide wears a race number of their own.**
--
-- `import_from_entries()` puts a guide on their runner's team as **leg 2** (ADR-022, ADR-039).
-- The bib rules were written before that, for a solo race where leg 2 "has no meaning". So on
-- Nightingale Nightmare:
--
--   * `effective_bib()` gave leg 2 the team's own number, so the Roster showed the guide wearing
--     their runner's bib;
--   * `set_bib_override()` refused leg 2 outright, so the desk could not record the number the
--     guide was actually wearing;
--   * and if the desk handed the guide the next vest, that number was the **next entry's**, so
--     the guide's crossing would have been credited to a different runner — possibly with the
--     guide's time — and the real runner's crossing flagged as a duplicate.
--
-- ## What changes
--
-- 1. **On a solo race, leg 2 derives no bib.** A guide's bib is the number written in for them
--    or nothing — never the runner's. `bib.ts`'s `derivedBib()` changes in step, and
--    `timing-bibs.test.ts` holds the two together.
-- 2. **`set_bib_override()` takes leg 2 on a solo race for a team that has a guide on it**, and
--    refuses the runner's own number for the guide (`bib_taken`, `same_team`). Its clash guard
--    now reads every team's leg 2 on both formats, so a guide's number cannot be handed to
--    anybody else and nobody else's can be handed to a guide.
-- 3. **`assign_bibs()` and `add_walk_in()` step past a number somebody is already wearing as an
--    override.** A guide's number sits in the same 001–250 range as everybody's, and the runbook
--    re-runs Assign bibs after late entries, so without this the next late entry would be given
--    the guide's number and both would resolve to whichever team the trigger met first. The same
--    was latent for a walk-in handed a spare vest; this closes both.
-- 4. **`event_roster()` says which runner is a guide**, so the registration page can label the
--    guide's box. The Roster already shows "(guide)" to the same staff.
--
-- ## What does not change
--
-- * **`resolve_crossing_team_id()`** already matches a leg-2 override on either format, so a
--   crossing on the guide's number resolves to their team without touching the trigger.
-- * **Results.** A solo result is timed from leg 1's bib alone (`buildResults()`), so the guide's
--   crossing lands on their team, is not an orphan, and times nothing. The leaderboard, the
--   exports and the published page read leg 1 on a solo race and are unchanged.
-- * **`team_number` and the overrides are still never touched by an import.**
--
-- ## Expand only
--
-- Five functions replaced with their signatures unchanged. `event_roster()` gains one key, which
-- the deployed page ignores. Nothing here has to be sequenced against the Cloudflare deploy.

-- ------------------------------------------------------------------------------------------
-- effective_bib — on a solo race, leg 2 derives nothing
-- ------------------------------------------------------------------------------------------
-- ⚠️ **One branch changes and it is the solo one.** An override still wins whatever it says, a
-- team with no number still derives nothing, and a relay leg is still `leg || team_number`. On a
-- solo race leg 1 is the team number, as before, and leg 2 — a guide — is null unless a number
-- has been written in for them.

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
    -- A guide on a solo race wears a number of their own or none — never their runner's.
    when p_format = 'solo' and p_leg = 2 then null
    when p_format = 'solo' then p_team_number
    else p_leg::text || p_team_number
  end;
$$;

-- Granted to nobody, as before: reachable from the definer functions and from nothing else.
revoke all on function timing.effective_bib(text, text, integer, text) from public;

-- ------------------------------------------------------------------------------------------
-- set_bib_override — a guide's own number, on a solo race
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20260913140000` apart from three things, each marked below:
--
--   * leg 2 on a solo race is taken **for a team with a guide on it**, and cleared for any team
--     — so a number left behind by a guide who has since come off the entry can still be
--     removed;
--   * the target's leg-2 bib is resolved on both formats, so a guide's number equal to their
--     runner's is the same-team clash a relay's two legs already were;
--   * the cross-team guard reads every other team's leg 2 on both formats. `effective_bib()`
--     answers null for a solo leg 2 with nothing written in, so a team without a guide adds
--     nothing to the comparison.

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

  select * into v_team from timing.teams where id = p_team_id and event_id = v_event.id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_team');
  end if;

  -- An empty override is stored as null, never as `''`. `effectiveBib()` treats both as absent
  -- and says the action layer stores null; this is that action layer.
  v_bib := nullif(btrim(coalesce(p_bib, '')), '');

  -- ⚠️ **Changed: leg 2 on a solo race is a guide's, and only a guide's** (ADR-061). Setting one
  -- needs a guide on that leg; clearing one never does, so nothing can be stranded.
  if v_event.format = 'solo' and p_leg = 2 and v_bib is not null
     and not exists (
       select 1
         from timing.runners r
        where r.team_id = v_team.id and r.leg = 2 and r.role = 'guide'
     )
  then
    return jsonb_build_object('ok', false, 'reason', 'no_such_leg');
  end if;

  v_leg1 := case when p_leg = 1 then v_bib else v_team.bib_leg1 end;
  v_leg2 := case when p_leg = 2 then v_bib else v_team.bib_leg2 end;

  -- The target's proposed effective bibs, resolved once. ⚠️ **Held in variables rather than
  -- called inside the query**, so a null — a team with no number and no override — is compared
  -- explicitly with `is not null` instead of disappearing into an `in (…)` list, where a null
  -- makes the whole predicate null and the clash is silently not found.
  --
  -- ⚠️ **Changed: leg 2 is resolved on both formats.** On a solo race it is the guide's written
  -- number or null, which is exactly what `effective_bib()` now answers.
  v_eff1 := timing.effective_bib(v_leg1, v_team.team_number, 1, v_event.format);
  v_eff2 := timing.effective_bib(v_leg2, v_team.team_number, 2, v_event.format);

  -- The target's own two legs must differ: a relay's two runners, or a runner and their guide.
  if v_eff1 is not null and v_eff1 = v_eff2 then
    return jsonb_build_object('ok', false, 'reason', 'bib_taken', 'same_team', true);
  end if;

  -- ⚠️ **Changed: every other team's leg 2 is read on both formats.** It used to be relay only,
  -- which on a solo race would have let a guide's number be handed to a second entry.
  select t.id, t.team_number, t.name
    into v_clash
    from timing.teams t
   where t.event_id = v_event.id
     and t.id <> v_team.id
     and (
       (v_eff1 is not null
        and (timing.effective_bib(t.bib_leg1, t.team_number, 1, v_event.format) = v_eff1
             or timing.effective_bib(t.bib_leg2, t.team_number, 2, v_event.format) = v_eff1))
       or
       (v_eff2 is not null
        and (timing.effective_bib(t.bib_leg1, t.team_number, 1, v_event.format) = v_eff2
             or timing.effective_bib(t.bib_leg2, t.team_number, 2, v_event.format) = v_eff2))
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
-- assign_bibs — never hand out a number somebody is already wearing
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20261023120000` apart from the step marked below. ⚠️ **The padding stays**:
-- this restates that migration's function, not `20260913140000`'s, so dropping it here would
-- silently undo the 001–250 fix.
--
-- **A number is skipped when any team on the race holds it as an override**, on either leg:
-- the candidate's own derived bib on a solo race, and its two leg-first bibs on a relay. Other
-- teams' *derived* bibs cannot collide, because the next number is always above every number
-- already taken and `team_number` is unique per race.

create or replace function timing.assign_bibs(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_format text;
  v_width smallint;
  v_next integer;
  v_candidate text;
  v_team record;
  v_assigned integer := 0;
  v_already integer := 0;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id, format, bib_pad_width into v_event_id, v_format, v_width
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
    -- ⚠️ **New: step past a number held as an override** — a guide's, or a walk-in's spare.
    loop
      -- ⚠️ Length first: `lpad()` would cut a number longer than the width.
      v_candidate := case
        when v_width is null or length(v_next::text) >= v_width then v_next::text
        else lpad(v_next::text, v_width, '0')
      end;

      exit when not exists (
        select 1
          from timing.teams o
         where o.event_id = v_event_id
           and (
             (v_format = 'solo'
              and (o.bib_leg1 = v_candidate or o.bib_leg2 = v_candidate))
             or
             (v_format = 'relay'
              and (o.bib_leg1 in ('1' || v_candidate, '2' || v_candidate)
                   or o.bib_leg2 in ('1' || v_candidate, '2' || v_candidate)))
           )
      );

      v_next := v_next + 1;
    end loop;

    update timing.teams set team_number = v_candidate where id = v_team.id;
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
-- add_walk_in — the same step, for somebody at the desk
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20261023120000` apart from the step marked below, and keeping its padding.

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
  v_format text;
  v_width smallint;
  v_team_id uuid;
  v_number integer;
  v_team_number text;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id, format, bib_pad_width into v_event_id, v_format, v_width
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

  -- ⚠️ **New: step past a number held as an override** — a guide's, or a walk-in's spare.
  loop
    -- ⚠️ Length first: `lpad()` would cut a number longer than the width.
    v_team_number := case
      when v_width is null or length(v_number::text) >= v_width then v_number::text
      else lpad(v_number::text, v_width, '0')
    end;

    exit when not exists (
      select 1
        from timing.teams o
       where o.event_id = v_event_id
         and (
           (v_format = 'solo'
            and (o.bib_leg1 = v_team_number or o.bib_leg2 = v_team_number))
           or
           (v_format = 'relay'
            and (o.bib_leg1 in ('1' || v_team_number, '2' || v_team_number)
                 or o.bib_leg2 in ('1' || v_team_number, '2' || v_team_number)))
         )
    );

    v_number := v_number + 1;
  end loop;

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
-- event_roster — which runner on an entry is a guide
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20260912090000` apart from `role` on each runner. The registration page needs
-- it to put a guide's box beside the guide rather than leave a second unlabelled number on an
-- entry. **It is behind `timing.registration.import`**, a narrower audience than the Roster's
-- `timing.roster.read`, which already shows "(guide)". So no new reader learns anything; the
-- published results still never say who is a guide (ADR-043).

create or replace function timing.event_roster(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.registration.import') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'name', v_event.name,
      'format', v_event.format,
      'start_at', v_event.start_at
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'team_number', t.team_number,
          'name', t.name,
          'category', t.category,
          'entry_type', t.entry_type,
          'purchase_order_id', t.purchase_order_id,
          'csv_row_index', t.csv_row_index,
          'bib_leg1', t.bib_leg1,
          'bib_leg2', t.bib_leg2,
          'runners', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'leg', r.leg,
                'firstname', r.firstname,
                'lastname', r.lastname,
                'gender', r.gender,
                'email', r.email,
                'club_name', r.club_name,
                'age_on_day', r.age_on_day,
                'is_captain', r.is_captain,
                -- ⚠️ New: `'runner'` or `'guide'`, ADR-022's column.
                'role', r.role
              ) order by r.leg
            )
            from timing.runners r
            where r.team_id = t.id
          ), '[]'::jsonb)
        ) order by t.csv_row_index nulls last, t.purchase_order_id
      )
      from timing.teams t
      where t.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function timing.event_roster(text) from public, anon;
grant execute on function timing.event_roster(text) to authenticated;
