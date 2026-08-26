-- `people-admin` — reading who has an account, without being able to change what they may do.
--
-- =========================================================================================
-- The gap this closes
-- =========================================================================================
-- `/admin/people/` answers two different questions in one table: **who has an account and
-- what may they do**, and **change it**. Until now those had one answer between them — you
-- were `super-admin` and could do both, or you could not see the page at all.
--
-- That is the wrong shape for the job the club actually has. A membership secretary checking
-- whether somebody has registered, or a volunteer coordinator working out who already holds
-- `nn-admin` before asking for a fourth, needs the first question and has no business with
-- the second. Handing them `super-admin` to answer it hands them the ability to grant
-- themselves the entry list — which is exactly the escalation
-- `tests/worker/admin/admin.test.ts`'s *"a grant is not an inheritance"* exists to prevent,
-- arrived at from the other direction.
--
-- =========================================================================================
-- This is ADR-017's mechanism working, not a change to it
-- =========================================================================================
-- ADR-017 said adding a role should be *"an insert into two tables"*, and predicted this
-- exact case — *"granting that same capability to a treasurer or a race director"*. So there
-- is no new ADR here: a fifth role and a seventh permission are a decision, and the decision
-- is made in this diff and in `packages/db/tests/identity-permissions.test.ts`, which asserts
-- both sets exactly and cannot pass without being edited.
--
-- =========================================================================================
-- identity.list_people() was still asking a role, and that is a defect ADR-017 missed
-- =========================================================================================
-- Every other gate on this surface moved to `identity.has_permission()` in #107. This one did
-- not — it still reads `identity.has_role('super-admin')`, which is the fifth string
-- comparison ADR-017 counted and then left behind. Moving it is not a favour to the new role;
-- it is the last of the migration ADR-017 described.
--
-- **`super-admin` gains `identity.person.read` in the same breath, and it is not an
-- inheritance.** Granting a role to somebody requires seeing them first — the page is a list
-- of people with a button beside each. A `super-admin` without the read would meet an empty
-- table and no way to grant anything at all, so reading here is a precondition of the power
-- they already hold rather than an extension of it. That is the whole difference from
-- `nn.entry.read`, which a super-admin still does not hold and still has to grant themselves.
--
-- =========================================================================================
-- Expand, migrate, contract
-- =========================================================================================
-- Two inserts, three role_permission rows, and two functions re-created with the same
-- signatures. Nothing changes shape and nothing is removed:
--
--   * **Migration first, Worker later.** `people-admin` is a role nobody holds, so it grants
--     nobody anything until somebody is granted it at `/admin/people/`. The deployed Worker
--     lets somebody through the door on `STAFF_ROLES` and gates the section on
--     `identity.role.grant`, both of which answer exactly as they did — a `super-admin` holds
--     the new permission and reaches the same page, and nobody else can reach the door.
--   * **Worker first, migration later.** The Worker asks `identity.my_permissions()` for a
--     word the database has never heard of, does not find it, and refuses — the 404 anybody
--     who is not staff already gets. The failure direction is unchanged: towards refusing.
--
-- See docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md.

-- -----------------------------------------------------------------------------------------
-- The seventh permission
-- -----------------------------------------------------------------------------------------
-- **`identity.person.read`, not `identity.people.read`.** `area.subject.verb`, and the
-- subject is one person — the same singular every other permission here uses (`role`,
-- `entry`), because a plural in a permission name reads as though there were a separate one
-- for reading a single record.
--
-- It says *the roles they hold* out loud. The email address travels with the list too, and
-- that is the disclosure worth naming: this permission is what makes somebody able to see
-- every registered address the club holds, which is why it is a role somebody is granted
-- rather than something every staff role carries.
insert into identity.permissions (slug, description) values
  ('identity.person.read',
   'Read the list of people with accounts, their email addresses and the roles they hold.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- The fifth role
-- -----------------------------------------------------------------------------------------
-- **It reads and it cannot change anything**, which the description has to carry because the
-- name does not: `nn-admin` means "can change things about this race" and this `-admin` does
-- not mean that. The name was chosen deliberately over `people-reader`, and the description
-- is where that choice is paid for — `/admin/people/`'s legend renders it, from this row.
--
-- It is staff, unlike `nn-tester`. It opens the door at `/admin/` because the page it is for
-- is behind that door, and `worker/admin-shell.ts`'s `STAFF_ROLES` gains it in the same pull
-- request. What it opens once inside is one table with no buttons on it.
insert into identity.roles (slug, description) values
  ('people-admin',
   'May see everybody with an account and the roles they hold. May not grant or revoke one, and may not read anything about a race.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('people-admin', 'identity.person.read'),

  -- **The precondition, not an inheritance** — see the header. A super-admin who cannot see
  -- the list cannot grant anything to anybody on it.
  ('super-admin', 'identity.person.read')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------------------
-- identity.list_people() — the same read, asked of a permission
-- -----------------------------------------------------------------------------------------
-- Byte-for-byte what #59 wrote apart from the gate, which is the point: this is not a new
-- disclosure with a new shape, it is the existing one with a second reader. A narrower answer
-- for the narrower role was considered and refused — two people share a name and nothing else
-- in the row tells them apart, so dropping the email would make the list unusable for the one
-- job the role exists to do.
create or replace function identity.list_people()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_permission('identity.person.read') then
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
  'Every person with an account, their roles and their email. Refuses unless the caller holds identity.person.read. #59''s read, moved off has_role(''super-admin'') by ADR-017''s mechanism.';

-- -----------------------------------------------------------------------------------------
-- identity.grantable_roles() — the catalogue, for reading as well as for granting
-- -----------------------------------------------------------------------------------------
-- **The name stays wrong on purpose, and the alternative was worse.** For somebody holding
-- only `identity.person.read` these roles are not grantable, so `role_catalogue()` would be
-- the honest name. Renaming it is a *contraction*: the deployed Worker calls
-- `grantable_roles`, and a migration that renames a function the running code calls breaks
-- every request between the `db push` and the Cloudflare deploy — which nothing here
-- sequences. It goes in a later pull request, once nothing calls the old name.
--
-- **Why a reader needs it at all.** `/admin/people/`'s roles column is a list of slugs, and
-- the legend above the table is the only thing that says what `nn-tester` means. A
-- `people-admin` reading that column without it is reading words they cannot resolve — the
-- read-only half of the complaint this function was written for, which was that granting from
-- a dropdown of bare slugs grants a capability nobody at the keyboard can see.
--
-- **It discloses nothing personal either way.** `identity.roles` is already readable by
-- anybody signed in, and `identity.permissions` by anybody signed in since #107. What this
-- adds is `role_permissions`, which says what a word means and nothing about who holds it.
create or replace function identity.grantable_roles()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_permission('identity.role.grant')
     and not identity.has_permission('identity.person.read') then
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
  'Every role, what it is for, and the permissions it carries. Refuses unless the caller holds identity.role.grant or identity.person.read — it is the catalogue /admin/people/ renders both its controls and its legend from. Says nothing about who holds what.';
