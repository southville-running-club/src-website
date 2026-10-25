-- Who may check the race photos, and who may publish them.
--
-- Race photos brief, slice 3, decision 12: **two roles, kept narrow**, and ADR-066. A
-- photo-checker checks the unsure bib reads and takes a photo down; a photo-admin publishes
-- the photos and, from slice 5, sends the runners their links. Nine roles and nineteen
-- permissions become eleven and twenty-three.
--
-- =========================================================================================
-- Four permissions, because the page has four doors
-- =========================================================================================
-- Since ADR-017 code checks a permission, never a role name, so each act the two roles split
-- between them is its own permission:
--
--   * `nn.photo.read` opens `/admin/photos/` — the progress figures — and both roles hold it.
--     It is the read the section is gated on, the way `nn.email.read` opens `/admin/emails/`.
--   * `nn.photo.check` opens the check queue, its decisions and the unpublished images. The
--     checker holds it and the photo-admin does not: publishing and checking are different
--     people's jobs (Mark publishes and does not check).
--   * `nn.photo.hide` takes a photo down, and both roles hold it. A takedown request can
--     reach either of them, and it is the one act that should never wait for the other.
--   * `nn.photo.publish` publishes a running's photos. Only the photo-admin holds it.
--
-- **There is deliberately no `nn.photo.send` yet.** Sending the runners their links is slice
-- 5, and a permission guarding a door that has not been built is one nobody can reason about
-- — `store.ticket.cancel`'s precedent. Slice 5 adds it to the photo-admin.
--
-- =========================================================================================
-- Neither role reads an entry, and that is the point of having them
-- =========================================================================================
-- **Neither carries any `nn.entry.*` permission** (brief §10). A checker sees photos and bib
-- numbers, never the entry list, its emergency contacts or its medical notes — so the four
-- volunteers checking photos are not four more people holding the race's personal data.
--
-- Both are staff roles: `STAFF_ROLES` in `apps/main/worker/admin-shell.ts` opens `/admin/` to
-- them, since that is where their pages are. That is a line in the Worker, not a row here.
--
-- =========================================================================================
-- `src-admin` gets all four; `super-admin` gets none
-- =========================================================================================
-- The club's master role holds its permissions as explicit rows, so every new one is a
-- decision rather than an inheritance: **directors get all four**, agreed on 24 October 2026,
-- as they hold every other area's. `identity-permissions.test.ts` fails until this file says
-- so, which is the recurring cost working as intended.
--
-- `super-admin` gets **none**, for the reason it holds no `nn.*` permission at all: it is the
-- role that grants roles, and a super-admin who wants to check photos grants themselves
-- `nn-photo-checker`, which writes a row in `identity.audit` (brief §10).

-- -----------------------------------------------------------------------------------------
-- The four permissions
-- -----------------------------------------------------------------------------------------
-- The descriptions are what `/admin/people/` shows beside a role, and the only place a
-- volunteer granting one sees what they are handing over, so each says what it opens.
insert into identity.permissions (slug, description) values
  ('nn.photo.read',
   'See how the race photos are going: how many are tagged, waiting to be checked, or published.'),
  ('nn.photo.check',
   'Check the race photos whose bib numbers the laptop was unsure of, and see photos before they are published.'),
  ('nn.photo.hide',
   'Take a race photo down, which deletes it from storage for good.'),
  ('nn.photo.publish',
   'Publish a race''s photos, so runners can see them. Only once every unsure photo has been checked.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- The two roles
-- -----------------------------------------------------------------------------------------
-- **An `nn-` prefix**, which is what puts them in the Nightingale Nightmare group on
-- `/admin/people/` (`ROLE_GROUPS` in `packages/shared/src/people-roles.ts`), and what renders
-- them there as "Photo checker" and "Photo admin".
insert into identity.roles (slug, description) values
  ('nn-photo-checker',
   'Check the race photos the laptop was unsure of, and take a photo down. Sees photos and bib numbers, never the entry list.'),
  ('nn-photo-admin',
   'Publish the race photos and take a photo down. Sees photos and bib numbers, never the entry list.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('nn-photo-checker', 'nn.photo.read'),
  ('nn-photo-checker', 'nn.photo.check'),
  ('nn-photo-checker', 'nn.photo.hide'),
  ('nn-photo-admin', 'nn.photo.read'),
  ('nn-photo-admin', 'nn.photo.hide'),
  ('nn-photo-admin', 'nn.photo.publish'),
  ('src-admin', 'nn.photo.read'),
  ('src-admin', 'nn.photo.check'),
  ('src-admin', 'nn.photo.hide'),
  ('src-admin', 'nn.photo.publish')
on conflict (role, permission) do nothing;
