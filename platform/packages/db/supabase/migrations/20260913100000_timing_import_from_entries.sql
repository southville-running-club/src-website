-- ==========================================================================================
-- The Nightingale roster crosses from `entries` to `timing`, in the database
-- ==========================================================================================
--
-- Issue #248, under
-- [ADR-039](../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md).
-- The first function on this platform to read across two application schemas.
--
-- ## Why a function and not the CSV round trip
--
-- `parseRegistrationCsv()` reads a Full On Sport export — that is where Pass the Buck 2026's
-- roster came from. **Nightingale Nightmare 2026's roster is `entries.entrants`**, in this same
-- database, and there is no CSV unless somebody makes one. The deciding argument is the
-- **date of birth**: age on day is not in the start-list export today, and adding it would make
-- that file a new audience for Article-9-adjacent data. Here the date is read to compute an age
-- and discarded in the same expression — it never leaves `entries`.
--
-- ## ⚠️ Three schema additions this needs, and why each is not optional
--
-- 1. **`runners.result_placement`** — ADR-031's answer has nowhere to land, so a non-binary
--    entrant would fall to "not placed" on the timing side. That is the exact gap ADR-031
--    closed in `entries`, silently re-opened one schema along.
-- 2. **`runners.role`** — ADR-022's guide takes one of the 250, runs the course and wears a
--    bib, and is in **no category and no prize**. With no `role` a guide arrives as a runner
--    with a null gender and renders as *"no category yet"*, which is a different and wrong
--    statement.
-- 3. **One vocabulary in `runners.gender`, and it is `entries`'.** The column's comment
--    described `'M'` / `'F'` *"as the import found it"* — the CSV's shape, never a decision.
--    ⚠️ **A column with two vocabularies written by two importers is the restated-closed-list
--    trap in data form**: both writers are correct, both pass review, and whichever ran last
--    decides what the prize list says.
--
-- **There is deliberately no check constraint on `gender`**, and that is expand-migrate-
-- contract rather than an oversight. Pass the Buck 2026's archive is a whole race of `'M'` /
-- `'F'` rows waiting on #206; a constraint would refuse that import before it is written.
-- Writers are unified now — this function copies `entries.entrants.gender` unchanged and
-- `parseRegistrationCsv()` maps at the parser boundary — and reading goes through
-- `normaliseTimingGender()` in `packages/shared/src/timing/gender.ts`, which accepts both and
-- carries the argument for when the legacy branch may go.
--
-- ## ⚠️ Age is computed against `entries.events.event_date`, not `timing.events.start_at`
--
-- **A deliberate departure from ADR-039's wording, for a reason the ADR did not weigh.**
-- `start_at` is `timestamptz`; turning it into a calendar date in SQL needs a timezone, and
-- **Nightingale Nightmare is raced the weekend the clocks go back** — the one weekend where an
-- hour of drift can land on the wrong day. `entries.events.event_date` is already a civil
-- `date`, needs no conversion, and is **the same column the minimum-age rule reads**, so the
-- age recorded here is the age the entry form enforced rather than a second answer computed a
-- second way. The repository's rule that timezone conversion takes exactly one path is best
-- served by not converting at all.
--
-- The expression is `entries`' own, character for character:
-- `date_part('year', age(event_date, date_of_birth))` — completed years, so a birthday on race
-- day counts.
--
-- ## What it carries, and what it may not
--
-- Carried: first name, last name, gender, `result_placement`, `role`, club, and a **guide's
-- own email address**. Never: `date_of_birth` (read and discarded), `gender_identity` (ADR-020
-- puts it on `/admin/nn/` and nowhere else), `phone` (ADR-025 collected it to tell a runner
-- about a change to the race, which is not this), either emergency-contact field (somebody
-- else's personal data, given for one purpose) and the medical note (Article 9, its own table,
-- its own consent, its own published retention promise).
--
-- **A runner's email is deliberately not carried.** `entrants.email` is a guide's own address
-- and null for a runner; a runner is reachable through `purchaser_email`, which is a
-- **purchase** fact and does not belong on a roster row.
--
-- The rule, stated once so it is not re-derived per column: `timing` holds what is needed to
-- put somebody on a start line, time them, and place them in a prize band. Everything the club
-- holds *about* an entrant stays in `entries`, which is the schema with the privacy notice.

-- ------------------------------------------------------------------------------------------
-- The three schema additions
-- ------------------------------------------------------------------------------------------

alter table timing.runners
  add column if not exists result_placement text,
  -- `'runner'` or `'guide'`. Defaulted rather than nullable, because every row already in the
  -- table is a runner — a CSV roster has no such thing as a guide on it.
  add column if not exists role text not null default 'runner';

-- Mirrors `entrants_result_placement_only_non_binary` and `..._shaped` in `entries`, and for
-- the same reason: a placement on somebody who is not non-binary is not a fact about them.
alter table timing.runners
  drop constraint if exists runners_result_placement_shaped;
alter table timing.runners
  add constraint runners_result_placement_shaped
  check (result_placement is null or result_placement in ('female', 'male'));

alter table timing.runners
  drop constraint if exists runners_role_shaped;
alter table timing.runners
  add constraint runners_role_shaped
  check (role in ('runner', 'guide'));

comment on column timing.runners.gender is
  'entries'' vocabulary — ''female'', ''male'', ''non_binary'' (ADR-039). Rows written before '
  'that decision spell it ''M'' / ''F''; read it through normaliseTimingGender() in '
  'packages/shared/src/timing/gender.ts, never by comparing strings. There is no check '
  'constraint on purpose — Pass the Buck''s archive (#206) is still to be imported.';

comment on column timing.runners.result_placement is
  'ADR-031: where a non-binary entrant asked for their result to count. Null for everybody '
  'else and null for a roster that arrived by CSV, which has no such question on it.';

comment on column timing.runners.role is
  'ADR-022: a visually impaired runner''s guide takes one of the 250, runs the course and '
  'wears a bib, and is in no category and no prize. awards.ts excludes them.';

-- ------------------------------------------------------------------------------------------
-- import_from_entries — the roster, from the schema that already holds it
-- ------------------------------------------------------------------------------------------
-- ⚠️ **A `security definer` function reading across schemas sees rows its caller cannot, and
-- that is both the point and the whole risk.** The permission check is the only thing standing
-- between `timing.registration.import` and every entrant the club holds, so it is first, before
-- anything is read, and it returns `{ok: false, reason: 'refused'}` rather than raising —
-- `import_registration()`'s shape.
--
-- `search_path` is `timing, pg_catalog` like its neighbours, and **every `entries` identifier
-- is schema-qualified** regardless; `entries.read_interest_list()` reading `intake.nn_interest`
-- is the existing precedent for the shape.
create or replace function timing.import_from_entries(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_entries_event_id uuid;
  v_event_date date;
  v_purchase record;
  v_entrant record;
  v_team_id uuid;
  v_inserted boolean;
  v_leg smallint;
  v_legs smallint[];
  v_teams_created integer := 0;
  v_teams_updated integer := 0;
  v_runners_written integer := 0;
  v_runners_removed integer := 0;
  v_teams_removed integer := 0;
  v_removed integer;
  v_seen text[] := array[]::text[];
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id into v_event_id from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- **The two schemas are joined on the slug**, which is the convention `/nn/<year>/` already
  -- relies on: `worker/routing.ts` turns an address into `nn-<year>` and both schemas name the
  -- running that way. A `timing` event with no matching `entries` event is not an error the
  -- caller can act on by retrying, so it is named rather than raised.
  select id, event_date into v_entries_event_id, v_event_date
    from entries.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entries_event');
  end if;

  for v_purchase in
    select p.id, p.purchaser_email
      from entries.entry_purchases p
     where p.event_id = v_entries_event_id
       and p.status = 'paid'
     order by p.created_at
  loop
    -- **The anchor is `entry_purchases.id`, cast to text.** Not `entry_no`: ADR-030 made that
    -- the expand step, so a purchase from before 31 August 2026 has none, and an anchor that
    -- is sometimes null is not an anchor.
    --
    -- ⚠️ **The `do update` assigns the conflict key to itself, and that is not a mistake.**
    -- There is nothing on a team row this import is authoritative about: `name`, `category`
    -- and `entry_type` are the CSV's vocabulary, and `team_number`, both bib overrides,
    -- `race_status` and `dnf_at` are things this function must never touch — re-running after
    -- bibs are assigned would renumber a field against numbers already printed and pinned on.
    -- `on conflict do nothing` would be the honest shape and it returns no row, so `returning`
    -- could not give back the id or say whether it was new. The self-assignment is the
    -- standard way to keep `RETURNING` working on an upsert that updates nothing.
    insert into timing.teams (event_id, purchase_order_id)
    values (v_event_id, v_purchase.id::text)
    on conflict (event_id, purchase_order_id) do update
      set purchase_order_id = excluded.purchase_order_id
    returning id, (xmax = 0) into v_team_id, v_inserted;

    if v_inserted then
      v_teams_created := v_teams_created + 1;
    else
      v_teams_updated := v_teams_updated + 1;
    end if;

    v_seen := v_seen || v_purchase.id::text;
    v_legs := array[]::smallint[];

    -- ⚠️ **A guide is leg 2, and the ordering is what makes that stable.** ADR-022 puts a
    -- visually impaired runner and their guide on one entry, so a purchase can carry two
    -- entrants; `runners.leg` is `check (leg in (1, 2))` and unique per team, and the bib
    -- overrides are per leg.
    --
    -- ⚠️ **`order by e.role` is the wrong sort and reads like the right one** — `'guide'`
    -- sorts *before* `'runner'`, so it handed the guide leg 1 and the runner they are guiding
    -- leg 2. Caught by the test that asserts which leg each takes; the guide would have worn
    -- the runner's bib. The predicate says what is meant instead of relying on the alphabet.
    for v_entrant in
      select e.first_name,
             e.last_name,
             e.gender,
             e.result_placement,
             e.role,
             e.club,
             e.email,
             e.date_of_birth
        from entries.entrants e
       where e.purchase_id = v_purchase.id
       order by (e.role = 'guide'), e.created_at, e.id
    loop
      v_leg := coalesce(array_length(v_legs, 1), 0) + 1;

      -- A third person on one entry has no leg to take. Refusing the whole import is the
      -- `import_registration()` rule: a half-imported field is worse than none, because
      -- nobody can tell by looking which half landed.
      if v_leg > 2 then
        return jsonb_build_object('ok', false, 'reason', 'too_many_entrants');
      end if;

      insert into timing.runners (
        team_id, leg, firstname, lastname, gender, result_placement, role,
        email, club_name, age_on_day, is_captain
      )
      values (
        v_team_id,
        v_leg,
        v_entrant.first_name,
        v_entrant.last_name,
        -- Copied unchanged. See the header: this is one of the two writers, and they agree.
        v_entrant.gender,
        v_entrant.result_placement,
        v_entrant.role,
        -- ⚠️ **A guide's own address only.** `entrants.email` is null for a runner, who is
        -- reachable through `purchaser_email` — a purchase fact, not a roster one.
        case when v_entrant.role = 'guide' then v_entrant.email::text else null end,
        v_entrant.club,
        -- ⚠️ **The date of birth is read here and discarded in the same expression.** There is
        -- no date-of-birth column in `timing` and there is not going to be one. See the header
        -- for why the civil `event_date` is the right operand.
        pg_catalog.date_part(
          'year',
          pg_catalog.age(v_event_date::timestamp, v_entrant.date_of_birth::timestamp)
        )::integer,
        v_leg = 1
      )
      on conflict (team_id, leg) do update
        set firstname = excluded.firstname,
            lastname = excluded.lastname,
            gender = excluded.gender,
            result_placement = excluded.result_placement,
            role = excluded.role,
            email = excluded.email,
            club_name = excluded.club_name,
            age_on_day = excluded.age_on_day,
            is_captain = excluded.is_captain;

      v_legs := v_legs || v_leg;
      v_runners_written := v_runners_written + 1;
    end loop;

    -- A leg this entry no longer carries is removed — a visually impaired runner whose guide
    -- withdrew must not leave a second runner behind, still deriving a bib nobody is wearing.
    delete from timing.runners
     where team_id = v_team_id
       and not (leg = any (v_legs));
    get diagnostics v_removed = row_count;
    v_runners_removed := v_runners_removed + v_removed;
  end loop;

  -- ⚠️ **A refunded entry's team is removed, and the `in (select …)` is what keeps that safe.**
  -- `cancel_entry()` deletes the entrants and sets the purchase to `refunded`, so the loop
  -- above simply does not reach it — but a team imported on a previous run would linger, still
  -- holding a place on the start list for somebody who is not running.
  --
  -- **Scoped to teams whose anchor is a purchase of this `entries` event**, so a roster that
  -- arrived by CSV — whose `purchase_order_id` is the file's own reference and not one of these
  -- uuids — is untouched. A blanket "delete what I did not just write" would empty Pass the
  -- Buck's field the first time somebody ran this on the wrong slug.
  delete from timing.teams t
   where t.event_id = v_event_id
     and not (t.purchase_order_id = any (v_seen))
     and t.purchase_order_id in (
       select p.id::text from entries.entry_purchases p where p.event_id = v_entries_event_id
     );
  get diagnostics v_teams_removed = row_count;

  return jsonb_build_object(
    'ok', true,
    'teams_created', v_teams_created,
    'teams_updated', v_teams_updated,
    'teams_removed', v_teams_removed,
    'runners_written', v_runners_written,
    'runners_removed', v_runners_removed
  );
end;
$$;

revoke all on function timing.import_from_entries(text) from public, anon;
grant execute on function timing.import_from_entries(text) to authenticated;

comment on function timing.import_from_entries(text) is
  'ADR-039: the Nightingale roster crosses from entries to timing in one transaction. Behind '
  'timing.registration.import. Re-runnable: a transfer replaces the runner, a refund removes '
  'the team, and team_number and both bib overrides are never touched.';
