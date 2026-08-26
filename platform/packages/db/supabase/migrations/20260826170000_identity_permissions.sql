-- Permissions behind the roles, and `nn-tester` as the first role granted through them.
--
-- =========================================================================================
-- What was wrong with the arrangement this replaces
-- =========================================================================================
-- `identity.roles` shipped with a check constraint — `slug in (...)` — and a comment saying
-- "a fourth is a migration and a decision". The decision half was right and stays. The
-- *mechanism* does not scale, and the reason is not the constraint: it is that a role's
-- meaning lives at every call site rather than in the database.
--
-- Today authorisation reads `identity.has_role('nn-admin')` in four `entries` functions and
-- `viewer.roles.includes('nn-admin')` in the Worker. So "who may read the entry list" is
-- answered in five places, and granting that same capability to a treasurer or a race
-- director means finding all five. The club will want those roles — C12 and the phases
-- document both say so — and each one added this way is a constraint edit, a new string
-- literal, and another `includes()`.
--
-- So: **a role is a bundle of permissions, and a permission is what code checks.** Adding a
-- role becomes an insert into two tables. Nothing in the Worker changes, and no function is
-- rewritten, because the question every call site asks stops naming a role at all.
--
-- =========================================================================================
-- The check constraint goes; the guard does not
-- =========================================================================================
-- Dropping it looks like removing a safety rail. It is not, because the rail was never the
-- thing doing the work — `packages/db/tests/identity-permissions.test.ts` now asserts the exact set of
-- roles *and* the exact set of permissions, which is the shape
-- `packages/db/tests/entries.test.ts` has used since the beginning for the functions `anon`
-- may execute. A fifth role still cannot arrive without somebody editing a test in a diff
-- that a human reads, which is all the constraint was ever buying.
--
-- What the constraint additionally cost is worth stating: it made the role set a property of
-- *DDL*, so `identity.grant_role()` could not be given a role the constraint had not been
-- taught, and a migration adding a role had to alter a table under load. The foreign key
-- from `role_grants.role` to `roles.slug` is the referential guarantee, and it is untouched.
--
-- =========================================================================================
-- Expand, migrate, contract — this is entirely the expand step
-- =========================================================================================
-- Nothing is removed that anything reads, and every existing object keeps its shape:
--
--   * **`identity.has_role()` stays, unchanged and still granted.** Four `entries` functions
--     and the deployed Worker call it. Removing it is a contraction for a later pull
--     request, once nothing does.
--   * **Migration first, Worker later.** Two new tables and one new function that the
--     deployed Worker has never heard of. `nn-tester` is a role nobody holds, so it grants
--     nobody anything until somebody is granted it at `/admin/people/`.
--   * **Worker first, migration later.** `identity.has_permission()` does not exist,
--     PostgREST answers `PGRST202`, and `worker/admin.ts` treats an unreadable role list as
--     "not staff" — which is the 404 everybody who is not staff already gets. The failure
--     direction is unchanged: towards refusing.
--
-- =========================================================================================
-- Watch for RLS recursion — the same trap `role_grants` has
-- =========================================================================================
-- `identity.has_permission()` reads `identity.role_permissions`, so a policy on that table
-- which called `has_permission()` would recurse. It therefore has **no policy at all and no
-- grant to anybody**, reached only through the security definer functions below. That is
-- exactly the shape `identity.role_grants`, `entries.webhook_secrets` and
-- `entries.admin_audit` already use, and for exactly the same reason.
--
-- `identity.permissions` is different and may be read: it is a catalogue of what the words
-- mean, holds no personal data and says nothing about who holds what. `identity.roles` is
-- already readable by anybody signed in on the same reasoning.
--
-- =========================================================================================
-- One wording note, because it looks like a style choice and is not
-- =========================================================================================
-- The seeded descriptions below say "before entries open to everybody else" rather than the
-- more natural "before entries open to the public". `scripts/check-migration-scope.mjs`
-- refuses any migration containing a schema-qualified `public.` reference, and a sentence
-- ending in the word *public* is indistinguishable from one to that regex. The guard is
-- right to be blunt — its own header explains that a false positive would train somebody to
-- stop reading its message — so the wording moves rather than the check.
--
-- See docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md.

-- -----------------------------------------------------------------------------------------
-- identity.permissions — what may be done, and the vocabulary for saying it
-- -----------------------------------------------------------------------------------------
-- **`area.subject.verb`, and the format is enforced.** A permission set that drifts into
-- `nnEntryRead`, `read-entries` and `entries:read` is one nobody can grep, and this table is
-- about to become the vocabulary every authorisation check in the platform is written in.
-- The constraint costs one line and buys the naming discipline permanently.
create table identity.permissions (
  slug text primary key check (slug ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$'),
  description text not null check (length(trim(description)) between 1 and 200)
);

comment on table identity.permissions is
  'What may be done, named area.subject.verb. The vocabulary every authorisation check is written in — code names a permission, never a role. packages/db/tests/identity-permissions.test.ts asserts the exact set, which is what makes adding one a decision in a diff.';

alter table identity.permissions enable row level security;

create policy permissions_readable_by_anyone_signed_in
  on identity.permissions
  for select
  to authenticated
  using (true);

grant select on identity.permissions to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.role_permissions — which roles may do what, and no policy at all
-- -----------------------------------------------------------------------------------------
-- **No grant to anybody, and no policy**, for the recursion reason in the header. This is
-- the table `has_permission()` reads on every authorisation check the platform makes.
--
-- `on delete cascade` from both sides: a role that no longer exists cannot keep permissions,
-- and a permission that has been withdrawn cannot keep being granted. Neither deletion is
-- something a running system does — both are migrations — and leaving orphans behind would
-- make `has_permission()` answer for words that no longer mean anything.
create table identity.role_permissions (
  role text not null references identity.roles (slug) on delete cascade,
  permission text not null references identity.permissions (slug) on delete cascade,

  primary key (role, permission)
);

comment on table identity.role_permissions is
  'Which roles hold which permissions. No grant to anybody and no policy — reachable only from identity.has_permission() and the catalogue function, which run as this schema''s owner. A policy here that called has_permission() would recurse, exactly as one on role_grants calling has_role() would.';

create index role_permissions_permission_idx on identity.role_permissions (permission);

-- -----------------------------------------------------------------------------------------
-- The check constraint on roles.slug — dropped, by lookup rather than by name
-- -----------------------------------------------------------------------------------------
-- **Found in `pg_constraint` rather than guessed.** #106 rewrote this constraint days ago to
-- drop `member`, and whether that landed before or after this migration decides what it is
-- currently called and what it currently says. Naming it here would make this migration fail
-- on one of the two orderings — and a migration that depends on the review order of an
-- unrelated pull request is a migration that will fail in production and not on a laptop.
--
-- The `where contype = 'c'` is what keeps this from touching the primary key or the foreign
-- keys that point at this table. Those are the referential guarantees and they stay.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_class as rel on rel.oid = con.conrelid
      join pg_catalog.pg_namespace as nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'identity'
       and rel.relname = 'roles'
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) like '%slug%'
  loop
    execute pg_catalog.format(
      'alter table identity.roles drop constraint %I', v_name
    );
  end loop;
end;
$$;

comment on table identity.roles is
  'The roles this club has. A role is a bundle of permissions and nothing else — identity.role_permissions says which. Adding one is an insert here plus the rows that give it meaning, and packages/db/tests/identity-permissions.test.ts asserts the exact set so it stays a decision somebody takes in a diff.';

-- -----------------------------------------------------------------------------------------
-- The vocabulary
-- -----------------------------------------------------------------------------------------
-- Six permissions, and every one of them names something that is already true today except
-- the last two. **This migration changes nobody's access.** `super-admin` and `nn-admin` end
-- it able to do exactly what they could before, said in a different vocabulary.
insert into identity.permissions (slug, description) values
  ('identity.role.grant',
   'Grant and revoke roles, at /admin/people/.'),
  ('nn.entry.read',
   'Read the Nightingale Nightmare entry list and the interest sign-ups.'),
  ('nn.entry.read_medical',
   'Read one entrant''s medical note, one at a time and audited.'),
  ('nn.entry.export',
   'Export the entries, the interest list and the start list as CSV.'),
  ('nn.entry.cancel',
   'Cancel a purchase, refund it, and delete the entrant it was for.'),
  ('nn.entry.before_open',
   'Enter Nightingale Nightmare before entries open to everybody else.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- nn-tester — the fourth role, and the first one that is a bundle rather than a name
-- -----------------------------------------------------------------------------------------
-- **It holds one permission and reads nothing.** A tester may enter before the public can.
-- They may not read the entry list, may not see a medical note, may not export anything and
-- may not grant a role — which is what makes handing it out cheap enough to be useful.
--
-- It is deliberately not staff. `worker/admin-shell.ts`'s `STAFF_ROLES` is unchanged, so a
-- tester gets the same 404 at `/admin/` as everybody else who is not `nn-admin` or
-- `super-admin`. The whole surface it opens is one form on `/nn/2026/`.
insert into identity.roles (slug, description) values
  ('nn-tester', 'May enter Nightingale Nightmare before entries open to everybody else.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  -- **`super-admin` holds one permission, and that is not an oversight.**
  --
  -- The obvious seeding gives it everything. It must not, because this repository has already
  -- decided otherwise and tests for it — `tests/worker/admin/admin.test.ts`'s *"a grant is not
  -- an inheritance"*: *"Being the person who hands roles out is not being the person who may
  -- read two hundred entrants' emergency contacts, and if it were, `/admin/people/` would be a
  -- way to give yourself the entry list without leaving a grant behind."*
  --
  -- A super-admin who needs the entry list grants themselves `nn-admin`, which writes a row in
  -- `identity.audit`. That visibility is the whole point.
  ('super-admin', 'identity.role.grant'),

  ('nn-admin', 'nn.entry.read'),
  ('nn-admin', 'nn.entry.read_medical'),
  ('nn-admin', 'nn.entry.export'),
  -- **Cancelling sits with reading, and the alternative was worse.** Putting it on
  -- `super-admin` alone reads as the more careful choice until you notice that a super-admin
  -- cannot see the entry list — so it would have meant granting them `nn.entry.read` as well,
  -- which is exactly the inheritance the line above refuses. A narrower control bought by
  -- widening a wider one is not narrower.
  --
  -- `nn-admin` already reads every entrant's emergency contact and every medical note and can
  -- export the lot. Cancelling one entry is not the larger power; it is the louder one, and it
  -- is made loud by the confirmation page, the audit row and ADR-018 rather than by the grant.
  ('nn-admin', 'nn.entry.cancel'),

  ('nn-tester', 'nn.entry.before_open')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------------------
-- identity.has_permission() — the one primitive, replacing has_role() at every call site
-- -----------------------------------------------------------------------------------------
-- One join more than `has_role()` and the same shape otherwise: `security definer` so it can
-- read tables the caller has no privilege on, `set search_path = ''` because an unpinned
-- search_path on a definer function is the standard Postgres escalation, `stable` because it
-- reads tables.
--
-- **Null-safe by construction.** `auth.uid()` is null for an anonymous caller, no row joins,
-- and the answer is false — which is the direction every authorisation check here fails in.
create or replace function identity.has_permission(p_permission text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from identity.role_grants as g
      join identity.role_permissions as rp on rp.role = g.role
     where g.person_id = auth.uid()
       and g.revoked_at is null
       and rp.permission = p_permission
  );
$$;

comment on function identity.has_permission(text) is
  'Whether the signed-in caller holds this permission through any role they hold. The one authorisation primitive — code names a permission, never a role. False for an anonymous caller, because auth.uid() is null and nothing joins.';

revoke all on function identity.has_permission(text) from public;
grant execute on function identity.has_permission(text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.my_permissions() — what the signed-in person may do, for painting a page with
-- -----------------------------------------------------------------------------------------
-- `my_roles()`' counterpart, and the thing `/admin/` should render navigation from. A section
-- that appears because somebody holds a role, while the door behind it checks a permission,
-- is two answers to one question — and the day they disagree is the day a volunteer clicks a
-- link into a 404.
create or replace function identity.my_permissions()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct rp.permission order by rp.permission), '[]'::jsonb)
    from identity.role_grants as g
    join identity.role_permissions as rp on rp.role = g.role
   where g.person_id = auth.uid()
     and g.revoked_at is null;
$$;

comment on function identity.my_permissions() is
  'Every permission the signed-in caller holds, through every role they hold. What a page paints its navigation from, so the link and the door behind it cannot disagree.';

revoke all on function identity.my_permissions() from public;
grant execute on function identity.my_permissions() to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.grantable_roles() — the roles page stops hard-coding the list
-- -----------------------------------------------------------------------------------------
-- `worker/admin-people.ts` holds a `ROLES` array, spelled by hand, with a comment saying it
-- matches the check constraint. That constraint no longer exists, and a hand-maintained copy
-- of a list the database owns is the thing this whole migration is about removing.
--
-- **It returns what each role means, not only its name.** Granting somebody a role from a
-- dropdown of bare slugs is granting a capability nobody at the keyboard can see; the
-- permission list is what makes `nn-tester` legible as "can enter early, can read nothing".
--
-- Refuses unless the caller may actually grant roles, for the ordering discipline
-- `admin_key_ok()` established: refuse before anything is resolved and before a row is read.
create or replace function identity.grantable_roles()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_permission('identity.role.grant') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  return jsonb_build_object(
    'ok', true,
    'roles', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'slug', role.slug,
            'description', role.description,
            'permissions', (
              select coalesce(jsonb_agg(rp.permission order by rp.permission), '[]'::jsonb)
                from identity.role_permissions as rp
               where rp.role = role.slug
            )
          )
          order by role.slug
        ),
        '[]'::jsonb
      )
      from identity.roles as role
    )
  );
end;
$$;

comment on function identity.grantable_roles() is
  'Every role, what it is for, and the permissions it carries. Refuses unless the caller holds identity.role.grant. What /admin/people/ renders its controls from, so adding a role is a migration rather than a migration plus a deploy.';

revoke all on function identity.grantable_roles() from public;
grant execute on function identity.grantable_roles() to authenticated;
