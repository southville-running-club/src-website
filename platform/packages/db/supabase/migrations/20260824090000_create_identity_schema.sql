-- The `identity` schema — the person record, the three roles, and the one function every
-- other issue in this series calls.
--
-- `club` was created 8 August 2026 and has never held a table. `auth.users` exists and is
-- empty. So before this migration there is no row anywhere in this database that says who
-- anybody is, and no way for a policy to ask. Decision 005 and ADR-015 record why an
-- account system is being built at all; this is that decision, built.
--
-- =========================================================================================
-- Why `identity` and not `club`
-- =========================================================================================
-- ADR-002 settles this in one line — "the schema boundary is the blast radius" — and
-- config.toml gives the specific reason: `club` is deliberately absent from the exposed
-- schema list, and that absence is a layer of defence in its own right. A profile has to be
-- readable by its owner through PostgREST, so its schema has to be exposed. Exposing `club`
-- would expose the future membership list along with it. `identity` is exposed here, in the
-- same migration that creates it (see the `[api] schemas` change in config.toml); `club`
-- stays shut and empty for `club.members` later.
--
-- =========================================================================================
-- What this migration deliberately does NOT do
-- =========================================================================================
-- **`anon` gets nothing anywhere in this schema.** Not a grant, not a policy, not a
-- function. Every table below is reached either by `authenticated`, under a policy scoped
-- to the caller's own row, or by nobody at all — reachable only from the security definer
-- functions at the foot of this file. `tests/identity.test.ts` asserts the anonymous
-- refusal the same way `tests/entries.test.ts` does, by error code.
--
-- **The profile columns collect nothing.** `identity.people` ships with `name`, `gender`,
-- `date_of_birth` and `address`, all nullable, because principles.md is explicit that
-- adding a column that holds personal data is a committee decision and a form that fills
-- one is a data-protection decision — two different things. The columns ship here so the
-- schema is not redesigned twice; nothing writes to them until #61, which is blocked on the
-- privacy notice in #60.
--
-- =========================================================================================
-- Bootstrapping the super-admin
-- =========================================================================================
-- No seeded password, no manual SQL. `admin@southvillerunningclub.co.uk` becomes
-- super-admin by registering at `/account/sign-up/` like anybody else and confirming the
-- email at a mailbox the club already controls — the trigger at the foot of this file reads
-- `identity.reserved_grants` on every new signup and applies a matching row. That table is
-- a general mechanism, not a special case for one address: it is how a role is pre-assigned
-- to somebody who has not signed up yet, which is what the committee will want the first
-- time it adds a treasurer.
--
-- =========================================================================================
-- Watch for RLS recursion
-- =========================================================================================
-- `identity.has_role()` reads `identity.role_grants`, so a policy on `role_grants` that
-- called `has_role()` would recurse. `role_grants` therefore has no policy at all and no
-- grant to anybody — reached only through the security definer functions below, which run
-- as this schema's owner and so are not subject to row-level security on tables the owner
-- owns. `identity.reserved_grants` and `identity.audit` follow the same shape for the same
-- reason `entries.webhook_secrets` and `entries.admin_audit` do.
--
-- =========================================================================================
-- Expand, migrate, contract
-- =========================================================================================
-- A new schema, a new trigger on a table this repository does not own the rows of, and a
-- handful of functions nothing yet calls. Nothing existing changes shape:
--
--   * **Migration first, Worker later.** The deployed Worker has never heard of `identity`,
--     so a schema it never queries changes nothing for it. Exposing it in `[api] schemas`
--     routes PostgREST there; nothing calls the route until #53 exists.
--   * **Worker first, migration later.** Nothing yet in the Worker calls anything here — this
--     issue lands before any of the account pages do.
--
-- See docs/architecture/decisions/adr-015-member-accounts-on-supabase-auth.md.

create schema if not exists identity;

comment on schema identity is
  'The account: the person record, the three roles, and the grants between them. RLS on every table; anon reaches none of it. Owned by packages/db.';

-- `usage` to `authenticated` only — never `anon`. Naming an object here without it gets a
-- `42501` before row-level security is even consulted, the same two-lock shape `entries`
-- uses, just with one lock permanently shut for the role that was never meant to pass it.
grant usage on schema identity to authenticated;

alter default privileges in schema identity revoke all on tables from anon, authenticated;
alter default privileges in schema identity revoke execute on functions from public;

-- -----------------------------------------------------------------------------------------
-- identity.roles — three rows, and a fourth is a migration
-- -----------------------------------------------------------------------------------------
create table identity.roles (
  slug text primary key check (slug in ('super-admin', 'nn-admin', 'member')),
  description text not null check (length(trim(description)) between 1 and 200)
);

comment on table identity.roles is
  'Exactly three roles. A fourth is a migration and a decision, enforced by the check constraint on slug rather than left to convention.';

alter table identity.roles enable row level security;

create policy roles_readable_by_anyone_signed_in
  on identity.roles
  for select
  to authenticated
  using (true);

grant select on identity.roles to authenticated;

insert into identity.roles (slug, description) values
  ('super-admin', 'May grant and revoke every role.'),
  ('nn-admin', 'May read Nightingale Nightmare entries.'),
  ('member', 'Held by everyone with an account. Grants nothing on its own.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- identity.people — one row per account, keyed on auth.users, not a new identifier
-- -----------------------------------------------------------------------------------------
-- **The `id` is `auth.users.id`.** One identifier for a person across the whole platform,
-- and a foreign key that makes an orphaned profile impossible — `on delete cascade` so a
-- deleted auth account cannot leave a profile behind for a new signup to collide with.
--
-- **Never `insert`, never `delete`, granted to `authenticated`.** The trigger below does the
-- insert as this schema's owner; a delete is #62's function, later, once there is a reason
-- to think hard about what deleting an account has to also do to their entries.
create table identity.people (
  id uuid primary key references auth.users (id) on delete cascade,

  name text,
  gender text,
  date_of_birth date,
  address text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table identity.people is
  'The account: one row per auth.users row, created by the trigger on signup. Profile columns are nullable and nothing writes to them until #61 — see the migration header for why that split is deliberate.';

alter table identity.people enable row level security;

create policy people_read_own_row
  on identity.people
  for select
  to authenticated
  using (id = auth.uid());

create policy people_update_own_row
  on identity.people
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, update on identity.people to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.role_grants — who holds what, and no policy at all
-- -----------------------------------------------------------------------------------------
-- **No grant to anybody, and no policy.** `identity.has_role()` reads this table on every
-- authorisation check this platform will ever make; a policy on it that itself called
-- `has_role()` would recurse. Reached only through the security definer functions below.
--
-- The partial unique index is what makes "does this person hold this role" a single-row
-- question rather than a count: at most one *active* grant per (person, role) at a time,
-- with history kept by revoking rather than deleting.
create table identity.role_grants (
  id uuid primary key default gen_random_uuid(),

  person_id uuid not null references identity.people (id) on delete cascade,
  role text not null references identity.roles (slug),

  -- Null for a system grant — the signup trigger's own `member` grant, and a reserved-grant
  -- application. Set for anything a human did through `identity.grant_role()`.
  granted_by uuid references identity.people (id),
  granted_at timestamptz not null default now(),

  -- Not a delete. `identity.audit` names a grant by its row; removing the row would make
  -- that history unreadable, the same reasoning `entries.admin_keys.revoked_at` uses.
  revoked_at timestamptz
);

comment on table identity.role_grants is
  'Who holds what, and since when. No grant to anybody and no policy — reachable only from identity.has_role() and the grant/revoke functions, which run as this schema''s owner. A policy here that called has_role() would recurse.';

alter table identity.role_grants enable row level security;

create unique index role_grants_one_active_per_person_role_idx
  on identity.role_grants (person_id, role)
  where revoked_at is null;

create index role_grants_person_idx on identity.role_grants (person_id);

-- -----------------------------------------------------------------------------------------
-- identity.reserved_grants — a role pre-assigned to somebody who has not signed up yet
-- -----------------------------------------------------------------------------------------
-- **A general mechanism, not a special case for one address.** The one seeded row bootstraps
-- the super-admin; the same table is how the committee will pre-assign `nn-admin` to a new
-- volunteer's own email before they have registered, without a manual SQL step at the
-- moment they do.
create table identity.reserved_grants (
  email extensions.citext primary key,
  role text not null references identity.roles (slug)
);

comment on table identity.reserved_grants is
  'A role waiting for an email address to sign up and claim it. No grant to anybody — read only by the signup trigger. citext so a differently-cased address at signup still matches.';

alter table identity.reserved_grants enable row level security;

insert into identity.reserved_grants (email, role)
values ('admin@southvillerunningclub.co.uk', 'super-admin')
on conflict (email) do nothing;

-- -----------------------------------------------------------------------------------------
-- identity.audit — who granted or revoked a role, on whom, and when
-- -----------------------------------------------------------------------------------------
-- The same shape as `entries.admin_audit`, for the same reason: an audit trail the anon key
-- can write to is one anybody can forge, so this one is granted to nobody and written only
-- from inside `identity.grant_role()` and `identity.revoke_role()`, in the same transaction
-- as the change it records.
create table identity.audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),

  -- **Not a foreign key, on either column.** `entries.admin_audit.actor` is not one either,
  -- and for the same reason: a person may be deleted one day (#62) and these rows must
  -- outlive them. A `references ... on delete cascade` here would delete an account's whole
  -- audit history at the exact moment somebody removed the account — the opposite of what
  -- an audit trail is for. Null actor is a system grant — nobody granted it, the trigger did.
  actor uuid,
  action text not null check (action in ('grant_role', 'revoke_role')),
  subject uuid not null,

  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

comment on table identity.audit is
  'Who granted or revoked a role, on whom, and when. Granted to nobody — written only from inside grant_role/revoke_role, in the same transaction as the change, so a grant cannot happen unlogged. actor and subject are not foreign keys, deliberately: this history must outlive a deleted person.';

alter table identity.audit enable row level security;

create index audit_at_idx on identity.audit (at desc);

-- -----------------------------------------------------------------------------------------
-- identity.has_role() — the one authorisation primitive
-- -----------------------------------------------------------------------------------------
-- What every RLS policy elsewhere in this database and every Worker route ends up asking.
-- `stable`: it reads a table and does not read the clock.
create or replace function identity.has_role(p_role text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from identity.role_grants as g
     where g.person_id = auth.uid()
       and g.role = p_role
       and g.revoked_at is null
  );
$$;

comment on function identity.has_role(text) is
  'Whether the signed-in caller holds this role. The one authorisation primitive every policy and every Worker route ends up asking.';

revoke all on function identity.has_role(text) from public;
grant execute on function identity.has_role(text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.my_roles() — what the signed-in person may do
-- -----------------------------------------------------------------------------------------
create or replace function identity.my_roles()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(g.role order by g.role), '[]'::jsonb)
    from identity.role_grants as g
   where g.person_id = auth.uid()
     and g.revoked_at is null;
$$;

comment on function identity.my_roles() is
  'Every role the signed-in caller currently holds. #58 paints navigation from it.';

revoke all on function identity.my_roles() from public;
grant execute on function identity.my_roles() to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.record_identity_audit() — the audit write, and nobody may forge one
-- -----------------------------------------------------------------------------------------
create or replace function identity.record_identity_audit(
  p_actor uuid,
  p_action text,
  p_subject uuid,
  p_detail jsonb
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  insert into identity.audit (actor, action, subject, detail)
  values (p_actor, p_action, p_subject, coalesce(p_detail, '{}'::jsonb));
end;
$$;

comment on function identity.record_identity_audit(uuid, text, uuid, jsonb) is
  'Writes one audit row. Granted to nobody — reachable only from grant_role/revoke_role, inside the same transaction as the change it records.';

revoke all on function identity.record_identity_audit(uuid, text, uuid, jsonb) from public;

-- -----------------------------------------------------------------------------------------
-- identity.grant_role() — refuses unless the caller already holds super-admin
-- -----------------------------------------------------------------------------------------
create or replace function identity.grant_role(p_person uuid, p_role text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_role('super-admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if not exists (select 1 from identity.roles as role where role.slug = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;

  if not exists (select 1 from identity.people as person where person.id = p_person) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  if exists (
    select 1
      from identity.role_grants as g
     where g.person_id = p_person
       and g.role = p_role
       and g.revoked_at is null
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_granted');
  end if;

  insert into identity.role_grants (person_id, role, granted_by)
  values (p_person, p_role, auth.uid());

  perform identity.record_identity_audit(
    auth.uid(), 'grant_role', p_person, jsonb_build_object('role', p_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function identity.grant_role(uuid, text) is
  'Grants one role to one person. Refuses unless the caller already holds super-admin. Writes identity.audit in the same transaction, so a grant cannot happen unlogged.';

revoke all on function identity.grant_role(uuid, text) from public;
grant execute on function identity.grant_role(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.revoke_role() — and refuses to remove the last super-admin
-- -----------------------------------------------------------------------------------------
-- A club that has locked itself out of every super-admin account has no service-role key to
-- get back in with, so the last active super-admin grant cannot be revoked through this
-- function at all. The check is scoped to whether *this* revocation would be the one that
-- empties the role, not to whether `p_person` merely shares it with somebody else.
create or replace function identity.revoke_role(p_person uuid, p_role text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_role('super-admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if p_role = 'super-admin'
     and exists (
       select 1
         from identity.role_grants as g
        where g.person_id = p_person
          and g.role = 'super-admin'
          and g.revoked_at is null
     )
     and (
       select pg_catalog.count(*)
         from identity.role_grants as g
        where g.role = 'super-admin'
          and g.revoked_at is null
     ) <= 1
  then
    return jsonb_build_object('ok', false, 'reason', 'last_super_admin');
  end if;

  update identity.role_grants as g
     set revoked_at = pg_catalog.now()
   where g.person_id = p_person
     and g.role = p_role
     and g.revoked_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_granted');
  end if;

  perform identity.record_identity_audit(
    auth.uid(), 'revoke_role', p_person, jsonb_build_object('role', p_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function identity.revoke_role(uuid, text) is
  'Revokes one role from one person. Refuses unless the caller holds super-admin, and refuses to remove the last active super-admin grant — a club locked out of every super-admin account has no service-role key to get back in with.';

revoke all on function identity.revoke_role(uuid, text) from public;
grant execute on function identity.revoke_role(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.list_people() — #59's read
-- -----------------------------------------------------------------------------------------
-- The only function here that reads `auth.users` — for the email address, which is what
-- makes a person recognisable to whoever is granting a role. Safe to join without a grant
-- on `auth.users` anywhere: this function runs as this schema's owner, the same property
-- `entries.entry_state()` relies on to read tables the caller has no privilege on.
create or replace function identity.list_people()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_role('super-admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  return jsonb_build_object(
    'ok', true,
    'people', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', person.id,
            'email', account.email,
            'name', person.name,
            'roles', (
              select coalesce(jsonb_agg(g.role order by g.role), '[]'::jsonb)
                from identity.role_grants as g
               where g.person_id = person.id
                 and g.revoked_at is null
            )
          )
          order by account.email
        ),
        '[]'::jsonb
      )
      from identity.people as person
      join auth.users as account on account.id = person.id
    )
  );
end;
$$;

comment on function identity.list_people() is
  'Every person with an account, their roles and their email. Refuses unless the caller holds super-admin. #59''s read.';

revoke all on function identity.list_people() from public;
grant execute on function identity.list_people() to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.handle_new_user() — the trigger, and the only door into identity.people
-- -----------------------------------------------------------------------------------------
-- Runs after every insert into `auth.users`, whichever of the three sign-in routes created
-- it. Creates the profile row, grants `member` unconditionally, and applies a matching
-- `identity.reserved_grants` row if one exists — which is the entire mechanism that makes
-- `admin@southvillerunningclub.co.uk` become super-admin by registering like anybody else.
--
-- `security definer`, owned by this schema's owner, which is what lets a trigger on a table
-- this repository does not own the rows of still write into `identity`: the function runs
-- with the owner's privileges regardless of which role's insert into `auth.users` fired it.
create or replace function identity.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reserved_role text;
begin
  insert into identity.people (id) values (new.id);

  insert into identity.role_grants (person_id, role, granted_by)
  values (new.id, 'member', null);

  select reserved.role into v_reserved_role
    from identity.reserved_grants as reserved
   where reserved.email = new.email::extensions.citext;

  if v_reserved_role is not null then
    insert into identity.role_grants (person_id, role, granted_by)
    values (new.id, v_reserved_role, null);
  end if;

  return new;
end;
$$;

comment on function identity.handle_new_user() is
  'Creates the profile row and grants member on every signup, then applies any matching identity.reserved_grants row. The whole bootstrap mechanism for the super-admin: no seeded password, no manual SQL.';

revoke all on function identity.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function identity.handle_new_user();
