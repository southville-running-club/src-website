-- Who may see a race's results before the public can, and the one read that shows them.
--
-- The club asked on 11 September 2026 for results on the race's own year page -
-- `/nn/<year>/results/` - **hidden behind `nn-results`** until they are published. That is
-- **an eighteenth permission and a ninth role**, both stop-and-asks in CLAUDE.md, taken here on
-- that instruction rather than inferred.
--
-- =========================================================================================
-- Why a permission and a role, and who holds the permission
-- =========================================================================================
-- ADR-017: a role is a bundle of permissions and **code checks the permission, never a role
-- name**. So the page asks for `nn.results.read` and the role `nn-results` is what carries it -
-- which is what lets the club later publish results by widening who holds the permission,
-- without anything in the Worker changing.
--
--   * **`nn-results` holds it**, and nothing else. It is a role for looking, and it opens no
--     back office - it is not on `STAFF_ROLES`, for the reason `timing-marshal` is not.
--   * **`src-admin` holds it**, as an explicit row rather than a wildcard. That is the design
--     doing its job: a wildcard would have handed directors this the moment it existed, and
--     this line is where somebody decided they should have it.
--   * **`timing-admin` does not**, deliberately. Running a race and seeing its results before
--     they are public are different things, and the club asked for the second to sit behind
--     its own role. A timing-admin who needs both is granted both.
--   * **`super-admin` does not**, for the reason it holds no `nn.*` permission: it grants
--     roles, and a super-admin who needs the results grants themselves `nn-results`, which
--     writes a row in `identity.audit`.
--
-- =========================================================================================
-- Why a function rather than a policy on the tables
-- =========================================================================================
-- `timing`'s six tables have RLS on and **no policy**, and they keep it. The results page
-- needs one shaped answer - the event, its teams with their runners, and its crossings - and a
-- `security definer` function that authorises inside itself gives exactly that, the way
-- `store.admin_social_list()` does. A table policy would have opened every column of every row
-- to anybody holding the permission, including the ones the page does not need.
--
-- ⚠️ **It returns only what a results table shows.** A runner's email address and club are in
-- `timing.runners` and **are not in this answer**: nothing on a results page needs them, and
-- data minimisation applies to reads as much as to storage.
--
-- It answers `null` rather than raising when the caller lacks the permission, and the Worker
-- gates before calling it anyway - `store`'s precedent, where an ungated page would otherwise
-- render an empty table stating something false about the club's records.
--
-- =========================================================================================
-- Exposing `timing` to PostgREST, while the race is selling
-- =========================================================================================
-- `config.toml` gains `timing` in `[api].schemas` in the same change, because a function in a
-- schema PostgREST does not expose cannot be called. **This is safe during the entry window,
-- and there is direct evidence for that rather than an argument**: `store` was added to the
-- same list on 5 September 2026, four days into the live window, and entries went on selling.
-- Every `timing` table still refuses both roles - RLS on, no policy, no table grant - so
-- exposing the schema routes a request to a table only for Postgres to answer `42501`.

-- Worded to avoid ending on "to the public" and a full stop: check-migration-scope.mjs strips
-- comments but reads string literals as SQL, and takes that for a schema-qualified reference.
insert into identity.permissions (slug, description) values
  ('nn.results.read',
   'See a race''s results and prize list on its year page before they are published.')
on conflict (slug) do nothing;

insert into identity.roles (slug, description) values
  ('nn-results',
   'Sees a race''s results and prize list on its year page before they are published. Opens nothing else.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('nn-results', 'nn.results.read'),
  ('src-admin', 'nn.results.read')
on conflict (role, permission) do nothing;

-- A function call needs USAGE on its schema. This lets `authenticated` *name* objects in
-- `timing`; it grants no table, and the tables still refuse it.
grant usage on schema timing to authenticated;

create or replace function timing.results_for_event(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  -- `null`, not an exception: see the header. `identity.has_permission` reads `auth.uid()`
  -- from the request's own token, which `security definer` does not change.
  if not identity.has_permission('nn.results.read') then
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
      'start_at', v_event.start_at,
      'actually_started_at', v_event.actually_started_at,
      'finished_at', v_event.finished_at
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'team_number', t.team_number,
          'name', t.name,
          'category', t.category,
          'bib_leg1', t.bib_leg1,
          'bib_leg2', t.bib_leg2,
          'race_status', t.race_status,
          'dnf_at', t.dnf_at,
          -- Names, gender and age - what a results table and a prize band need. Not email,
          -- not club: see the header.
          'runners', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'leg', r.leg,
                'firstname', r.firstname,
                'lastname', r.lastname,
                'gender', r.gender,
                'age_on_day', r.age_on_day
              ) order by r.leg
            )
            from timing.runners r
            where r.team_id = t.id
          ), '[]'::jsonb)
        ) order by t.team_number
      )
      from timing.teams t
      where t.event_id = v_event.id
    ), '[]'::jsonb),
    'crossings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bib', c.bib,
          'captured_at', c.captured_at,
          'anomaly_flag', c.anomaly_flag,
          'resolved_at', c.resolved_at,
          'resolved_action', c.resolved_action
        ) order by c.captured_at
      )
      from timing.crossings c
      where c.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function timing.results_for_event(text) from public, anon;
grant execute on function timing.results_for_event(text) to authenticated;

-- Defensive, and idempotent: the bib trigger from `20260911140000` revoked only `public`. If
-- this project's default privileges ever handed `anon` or `authenticated` EXECUTE on new
-- functions, this closes it - a trigger function is reachable from its trigger and nothing
-- else. `timing.test.ts` asserts that `results_for_event` is the only function either role
-- can call.
revoke all on function timing.resolve_crossing_team_id() from anon, authenticated;
