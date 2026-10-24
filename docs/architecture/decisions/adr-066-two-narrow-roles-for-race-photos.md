# ADR-066: Two narrow roles for race photos

**Status:** Accepted
**Date:** 24 October 2026
**Records:** decision 12 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

The check page ([ADR-065](adr-065-unsure-photos-are-checked-together-on-the-website.md)) needs
people who may see photos before they are published and decide their bibs; somebody has to
publish them and, from slice 5, send the runners their links; and a runner who asks for a photo
to come down needs it gone whoever reads their email. None of that needs the entry list, its
emergency contacts or its medical notes, which is what `nn-admin` opens.

Since [ADR-017](adr-017-permissions-are-what-code-checks.md) a role is a bundle of permissions
and code checks the permission, never a role name.

## Decision

**Two roles, `nn-photo-checker` and `nn-photo-admin`, carrying four permissions between them,
and neither carrying any `nn.entry.*` permission.**

| Permission | Opens | Checker | Photo-admin |
| --- | --- | --- | --- |
| `nn.photo.read` | `/admin/photos/`, the progress figures | ✓ | ✓ |
| `nn.photo.check` | The check queue, its decisions, unpublished images | ✓ | |
| `nn.photo.hide` | Taking a photo down | ✓ | ✓ |
| `nn.photo.publish` | Publishing a running's photos | | ✓ |

- **Checkers** are the four who check (Bindal, Andrew, Adrian and Ross); **photo-admins** publish
  (Bindal, Mark). Mark publishes and does not check, which is why publishing and checking are
  apart.
- **Both are staff roles**: they are on `STAFF_ROLES`, because their pages are under `/admin/`,
  and in the Nightingale Nightmare group on `/admin/people/` (the `nn-` prefix), where they read
  as "Photo checker" and "Photo admin".
- **`src-admin` holds all four**, decided on 24 October 2026, as directors hold every other
  area's. **`super-admin` holds none**: it grants roles, and a super-admin who wants to check
  photos grants themselves `nn-photo-checker`, which writes an audit row.
- **There is no `nn.photo.send` yet.** Sending the links is slice 5, which adds it to the
  photo-admin; a permission guarding a door that has not been built is one nobody can reason
  about.
- **Every door asks its own permission and answers 404 without it**, as the rest of `/admin/`
  does: a photo-admin gets the ordinary not-found page at the check queue and its images, and a
  checker at the entry list.

## Consequences

- **Nine roles and nineteen permissions become eleven and twenty-three**, asserted exactly in
  `packages/db/tests/identity-permissions.test.ts`.
- **The volunteers checking photos are not more people holding the race's personal data.** A
  checker sees photos, bib numbers and photographers' credits; the `photos` schema holds no
  runner's name or address.
- **A takedown is open to both roles**, so a request in a runner's email never waits for a
  particular person. It deletes the photo from storage and cannot be undone, which is why the
  check page asks for a confirmation and the overview says so above the button.
- **`apps/timing` keeps a copy of `STAFF_ROLES`**, held to the original by its own test, so the
  two new roles are added there too.

## Alternatives considered

- **One photos role.** Rejected: Mark publishes and does not check, and checkers should not be
  able to publish before the photos are ready.
- **Reusing `nn-admin`.** Rejected: it opens the entry list, its emergency contacts and its
  medical notes, which no part of checking photos needs.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 12 and §10
- `platform/packages/db/supabase/migrations/20261024110000_identity_photo_roles.sql`
- `platform/apps/main/worker/admin-photos.ts`, `admin-shell.ts`
