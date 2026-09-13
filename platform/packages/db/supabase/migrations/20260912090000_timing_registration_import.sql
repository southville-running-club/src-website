-- ==========================================================================================
-- An entry list can be imported into a timing event
-- ==========================================================================================
--
-- Issue #202, under
-- [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- The `timing` schema shipped with row-level security on and **no policy at all**, which is
-- the safe direction and also means nothing can write a row. This is the write path.
--
-- ## Three functions, and why an event creator is one of them
--
-- `20260911140000` created `timing.events` and nothing that could insert into it, so there was
-- no event for an entry list to be imported *into*. Importing without that is untestable and
-- unusable, so the two ship together.
--
-- **`security definer` functions rather than policies**, which is `entries`' pattern and is
-- here for its reasons: the permission check is written once in the function instead of
-- repeated in a policy per verb per table, and the tables stay refused to everybody so a
-- future `select` against them cannot quietly become the way in.
--
-- ## ⚠️ The minimisation boundary is upstream of this file, and that is the design
--
-- **Date of birth, address, phone, emergency contact and medical information never appear
-- here** — not as a parameter, not as a column, not as a key this reads. `parseRegistrationCsv`
-- in `packages/shared/src/timing/registration/parser.ts` drops them at the boundary and
-- computes `age_on_day` against the race date, and the CSV's own `AgeOnDay` column is ignored
-- in favour of computing it. That is
-- [C10](../../../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully) and it
-- is the same sentence as *personal data is minimised at the boundary*.
--
-- These functions read **named keys only**. A caller that posts `date_of_birth` straight at
-- PostgREST has it ignored rather than stored, and `packages/db/tests/timing-import.test.ts`
-- attempts exactly that bypass and asserts the column count is unchanged — the shape
-- `entries-rules.test.ts` established, where the test attempts the bypass rather than
-- asserting the constraint's text.
--
-- ## ⚠️ Re-importing may never overwrite a number somebody is already wearing
--
-- Re-importing the same file is a no-op, anchored on `unique (event_id, purchase_order_id)`.
-- **The sharp edge is which columns the conflict branch updates.** `team_number`, `bib_leg1`,
-- `bib_leg2`, `race_status` and `dnf_at` are deliberately **not** among them:
--
--   * `team_number` is what every bib derives from. Re-running an import after bibs were
--     assigned would renumber the field against the numbers already printed and pinned on.
--   * `bib_leg1` / `bib_leg2` are the overrides a desk wrote when it handed somebody a
--     physical bib, so they outrank anything a file says.
--   * `race_status` and `dnf_at` are race-day facts recorded by a human. An entry list has no
--     opinion about who did not finish.
--
-- What the conflict branch *does* update is what the file is actually authoritative about: the
-- team's name, its category, its entry type and its row index.

-- ------------------------------------------------------------------------------------------
-- create_event — there has to be something to import into
-- ------------------------------------------------------------------------------------------
create or replace function timing.create_event(
  p_slug text,
  p_name text,
  p_format text,
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
  v_id uuid;
begin
  -- `identity.has_permission` reads `auth.uid()` from the request's own token, which
  -- `security definer` does not change.
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_format is null or p_format not in ('relay', 'solo') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_format');
  end if;

  if p_slug is null or btrim(p_slug) = '' or p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- **Insert only, never an upsert on the slug.** `format` decides how every bib is derived
  -- and which prizes exist, so quietly changing it under an event that already has teams
  -- would rewrite the meaning of rows nobody re-checked. Editing a running is its own
  -- decision and its own function.
  insert into timing.events (slug, name, format, start_at, distance_m, course_notes)
  values (btrim(p_slug), btrim(p_name), p_format, p_start_at, p_distance_m, p_course_notes)
  on conflict (slug) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'event_exists');
  end if;

  return jsonb_build_object('ok', true, 'event_id', v_id, 'slug', btrim(p_slug));
end;
$$;

revoke all on function timing.create_event(text, text, text, timestamptz, integer, text)
  from public, anon;
grant execute on function timing.create_event(text, text, text, timestamptz, integer, text)
  to authenticated;

-- ------------------------------------------------------------------------------------------
-- import_registration — the entry list lands
-- ------------------------------------------------------------------------------------------
-- `p_rows` is what the parser produced, already minimised:
--
--   [{ "purchase_order_id": "...", "csv_row_index": 1, "name": "...", "category": "...",
--      "entry_type": "...",
--      "runners": [{ "leg": 1, "firstname": "...", "lastname": "...", "gender": "M",
--                    "email": "...", "club_name": "...", "age_on_day": 34,
--                    "is_captain": true }] }]
--
-- A row with no `purchase_order_id` is refused rather than guessed at: that column is the
-- idempotency anchor, and without it a second import would duplicate the whole field.
create or replace function timing.import_registration(p_event_slug text, p_rows jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_row jsonb;
  v_runner jsonb;
  v_team_id uuid;
  v_order_id text;
  v_inserted boolean;
  v_teams_created integer := 0;
  v_teams_updated integer := 0;
  v_runners_written integer := 0;
  v_runners_removed integer := 0;
  v_legs smallint[];
  v_removed integer;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'malformed');
  end if;

  select id into v_event_id from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_order_id := nullif(btrim(coalesce(v_row ->> 'purchase_order_id', '')), '');
    if v_order_id is null then
      -- The whole import is refused rather than partly applied: a half-imported field is
      -- worse than none, because nobody can tell by looking which half landed.
      return jsonb_build_object('ok', false, 'reason', 'missing_purchase_order_id');
    end if;

    -- See the header: the conflict branch updates what the file is authoritative about and
    -- deliberately leaves every number and every race-day fact alone.
    insert into timing.teams (
      event_id, purchase_order_id, csv_row_index, name, category, entry_type
    )
    values (
      v_event_id,
      v_order_id,
      (v_row ->> 'csv_row_index')::integer,
      v_row ->> 'name',
      v_row ->> 'category',
      v_row ->> 'entry_type'
    )
    on conflict (event_id, purchase_order_id) do update
      set csv_row_index = excluded.csv_row_index,
          name = excluded.name,
          category = excluded.category,
          entry_type = excluded.entry_type
    returning id, (xmax = 0) into v_team_id, v_inserted;

    if v_inserted then
      v_teams_created := v_teams_created + 1;
    else
      v_teams_updated := v_teams_updated + 1;
    end if;

    v_legs := array[]::smallint[];

    for v_runner in
      select * from jsonb_array_elements(coalesce(v_row -> 'runners', '[]'::jsonb))
    loop
      -- **Upsert on `(team_id, leg)` rather than delete-and-insert**, so a re-import that
      -- corrects a spelling keeps the runner's id rather than minting a new one.
      insert into timing.runners (
        team_id, leg, firstname, lastname, gender, email, club_name, age_on_day, is_captain
      )
      values (
        v_team_id,
        (v_runner ->> 'leg')::smallint,
        coalesce(v_runner ->> 'firstname', ''),
        coalesce(v_runner ->> 'lastname', ''),
        v_runner ->> 'gender',
        v_runner ->> 'email',
        v_runner ->> 'club_name',
        (v_runner ->> 'age_on_day')::integer,
        coalesce((v_runner ->> 'is_captain')::boolean, false)
      )
      on conflict (team_id, leg) do update
        set firstname = excluded.firstname,
            lastname = excluded.lastname,
            gender = excluded.gender,
            email = excluded.email,
            club_name = excluded.club_name,
            age_on_day = excluded.age_on_day,
            is_captain = excluded.is_captain;

      v_legs := v_legs || (v_runner ->> 'leg')::smallint;
      v_runners_written := v_runners_written + 1;
    end loop;

    -- A leg the file no longer carries is removed — a relay pair corrected down to a solo
    -- entry must not leave the second runner behind, still deriving a bib nobody is wearing.
    delete from timing.runners
    where team_id = v_team_id
      and not (leg = any (v_legs));
    get diagnostics v_removed = row_count;
    v_runners_removed := v_runners_removed + v_removed;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'teams_created', v_teams_created,
    'teams_updated', v_teams_updated,
    'runners_written', v_runners_written,
    'runners_removed', v_runners_removed
  );
end;
$$;

revoke all on function timing.import_registration(text, jsonb) from public, anon;
grant execute on function timing.import_registration(text, jsonb) to authenticated;

-- ------------------------------------------------------------------------------------------
-- event_roster — reading back what landed
-- ------------------------------------------------------------------------------------------
-- The post-import panel, and what the reconcile screen reads. `null` rather than an exception
-- for both "you may not" and "no such event", exactly as `timing.results_for_event()` does and
-- for the same reason: the two must be indistinguishable to somebody probing.
--
-- ⚠️ **This one carries `email` and `club_name` where the results read deliberately does
-- not.** They are different audiences: results are a table of times, and whoever is
-- reconciling an entry list against a start line is the person who has to ring somebody whose
-- row is wrong. It is behind `timing.registration.import`, which is a narrower door than
-- `nn.results.read`.
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
                'is_captain', r.is_captain
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
