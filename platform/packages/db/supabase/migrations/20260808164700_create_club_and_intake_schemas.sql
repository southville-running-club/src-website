-- Create the two schemas this repository owns, and one health function.
--
-- Scope, and why it is this small:
--
--   * `club`   — members, membership periods, EA registrations, benefits, documents.
--                **Never** anonymously readable or writable. Empty for now.
--   * `intake` — public form submissions. Anonymous INSERT only, when tables arrive.
--                Empty for now, apart from the health function below.
--
-- **Nothing here touches `public` or `private`.** Those belong to the timing platform and
-- are migrated from `src-race-timing`. Until that repository joins the monorepo, two
-- repositories share one Postgres and one migration history, so every diff and push from
-- here is scoped: `--schema club,intake`. `supabase db reset` is a local command and is
-- never run against the shared remote.
--
-- The schema boundary is the blast radius: an anonymous-insert policy that is wrong on
-- `intake` is a nuisance, and the same policy wrong on `club` is a personal-data incident.
--
-- See docs/architecture/decisions/adr-002-schema-layout.md

create schema if not exists club;
create schema if not exists intake;

comment on schema club is
  'Membership and club records. Never anonymously readable. Owned by packages/db.';
comment on schema intake is
  'Public form submissions. Anonymous insert only. Owned by packages/db.';

-- ---------------------------------------------------------------------------------------
-- club — closed, and closed by default
-- ---------------------------------------------------------------------------------------
-- There is no API tier between the browser and Postgres, so these grants and RLS are the
-- entire access control. `club` is not exposed through PostgREST at all (see
-- supabase/config.toml), and the grants below mean that if it ever were, exposing it would
-- still not be enough to read anything.

revoke all on schema club from public;
revoke all on schema club from anon, authenticated;

alter default privileges in schema club revoke all on tables from anon, authenticated;
alter default privileges in schema club revoke all on functions from anon, authenticated;
alter default privileges in schema club revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- intake — reachable, but only just
-- ---------------------------------------------------------------------------------------
-- `usage` on the schema lets a request name an object in it. It grants nothing on the
-- objects themselves: every future table starts with RLS enabled from its first migration
-- and no grant, and gets an explicit insert-only policy.

grant usage on schema intake to anon, authenticated;

alter default privileges in schema intake revoke all on tables from anon, authenticated;
alter default privileges in schema intake revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------
-- intake.health() — the skeleton's one database object
-- ---------------------------------------------------------------------------------------
-- Returns `now()`. It exists so a hello-world page can prove, in one call, that the
-- migration applied, the schema is exposed through PostgREST, the anon key is right, the
-- grant is right and the Worker can reach the network. It reads nothing and holds nothing.
--
-- `security invoker` because it needs no privileges of its own; `set search_path = ''`
-- and a fully-qualified `pg_catalog.now()` because an unpinned search_path on a function
-- is the standard Postgres foot-gun, and the timing platform already pins it on every
-- helper in its `private` schema.

create or replace function intake.health()
  returns timestamptz
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select pg_catalog.now();
$$;

comment on function intake.health() is
  'Connectivity check for the deployment skeleton. Returns now(). Reads no data.';

revoke all on function intake.health() from public;
grant execute on function intake.health() to anon, authenticated;
