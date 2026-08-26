-- =========================================================================================
-- `registered` replaces `member` as the role every account gets — ADR-016
-- =========================================================================================
-- **`member` meant "has an account", and at a running club that is not what the word means.**
-- A member is somebody the club has recorded as current: joined, paid, not lapsed, on the
-- England Athletics register. That is [C12](docs/foundations/requirements.md#c12--maintain-membership-records),
-- it is a question the platform must eventually answer, and the authoritative record lives in
-- EA's portal rather than here.
--
-- So the role that means *nothing more than having signed up* was holding the one word the club
-- will need for the thing that matters. `identity.roles` said as much in its own description —
-- "Held by everyone with an account. Grants nothing on its own" — and the glossary papered over
-- the collision with a qualifier, "in the accounts sense... not yet the same thing as a club
-- member on the EA register". A word that needs a disclaimer every time it is used is the wrong
-- word.
--
-- `registered` says what actually happened: somebody registered. It grants nothing, exactly as
-- its predecessor granted nothing, and it leaves `member` free for the day membership is real.
--
-- =========================================================================================
-- Why this is safe today and would not be next week
-- =========================================================================================
-- [Expand, migrate, contract](docs/architecture/principles.md#expand-migrate-contract) asks
-- that every schema change keep the previously deployed code working, because nothing
-- sequences a migration against the Cloudflare deploy. This one narrows a check constraint, so
-- a Worker still carrying `member` in `admin-people.ts`'s list would fail if somebody used it
-- to grant that role between this migration landing and the new Worker going out.
--
-- **Nobody can reach that path.** `/admin/people/` requires `super-admin`, `super-admin` is
-- held by nobody, and `admin@southvillerunningclub.co.uk` has not registered yet — so
-- `identity.grant_role()` is unreachable by every actual caller for the whole window.
--
-- **That stops being true the moment the super-admin registers**, which is why this lands now
-- rather than after. Doing it later means an expand and a contract across two deploys, and
-- rows to migrate rather than none.
--
-- =========================================================================================
-- What is deliberately not rewritten
-- =========================================================================================
-- **`identity.audit`.** Its `detail` column records what was granted at the time, and a grant
-- of `member` in August was a grant of `member`. An audit trail is not tidied up — the same
-- reasoning `entries.admin_audit` carries, and the reason `role_grants` revokes rather than
-- deletes. A reader of that history should see the word the system actually used.
-- =========================================================================================

-- -----------------------------------------------------------------------------------------
-- Expand: allow both, so the update below has somewhere to land
-- -----------------------------------------------------------------------------------------
-- `role_grants.role` and `reserved_grants.role` are foreign keys onto `identity.roles (slug)`,
-- so the new row has to exist before any grant can point at it.
alter table identity.roles
  drop constraint roles_slug_check;

alter table identity.roles
  add constraint roles_slug_check
  check (slug in ('super-admin', 'nn-admin', 'member', 'registered'));

insert into identity.roles (slug, description) values
  ('registered', 'Held by everyone with an account. Grants nothing on its own.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- Migrate: move every grant, held or revoked
-- -----------------------------------------------------------------------------------------
-- **Revoked rows too, and not by oversight.** A revoked grant is history rather than a live
-- permission, but it is history about *this* role, and leaving it pointing at a slug that no
-- longer exists would break the foreign key. The audit trail above is where the original word
-- survives.
update identity.role_grants
   set role = 'registered'
 where role = 'member';

update identity.reserved_grants
   set role = 'registered'
 where role = 'member';

-- -----------------------------------------------------------------------------------------
-- The signup trigger, which is the only thing that granted it
-- -----------------------------------------------------------------------------------------
-- Replaced whole rather than patched, because `create or replace function` is the only way to
-- change a body and this one has moved once already — 20260825140000 added the name from the
-- signup metadata. Carried forward unchanged apart from the role.
create or replace function identity.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reserved_role text;
begin
  insert into identity.people (id, name) values (new.id, new.raw_user_meta_data->>'name');

  insert into identity.role_grants (person_id, role, granted_by)
  values (new.id, 'registered', null);

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
  'Creates the profile row and grants registered on every signup, then applies any matching identity.reserved_grants row. The whole bootstrap mechanism for the super-admin: no seeded password, no manual SQL.';

-- -----------------------------------------------------------------------------------------
-- Contract: three roles again, and `member` is free
-- -----------------------------------------------------------------------------------------
-- **Deleted rather than left in place as a spare.** A grantable `member` that nothing verifies
-- would let a super-admin record a claim the system cannot back — that somebody has paid and
-- is current — with no join date, no lapse date and no link to the EA register. When
-- membership is built it will bring its own record, and this row should be created by the
-- migration that means it.
delete from identity.roles where slug = 'member';

alter table identity.roles
  drop constraint roles_slug_check;

alter table identity.roles
  add constraint roles_slug_check
  check (slug in ('super-admin', 'nn-admin', 'registered'));

comment on table identity.roles is
  'Exactly three roles. A fourth is a migration and a decision, enforced by the check constraint on slug rather than left to convention. `member` is deliberately not one of them — see ADR-016.';
