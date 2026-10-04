/**
 * The roles that open the club's backend, `/admin/`, at all — copied from `apps/main`.
 *
 * The app header (ADR-054) offers "Club admin" exactly when `/admin/`'s door would open, and
 * that door asks `isStaff()` in `apps/main/worker/admin-shell.ts`. The timing app cannot import
 * from another app's Worker, and moving the list into `packages/shared` is a change under
 * `platform/packages/`, which also redeploys `apps/main` mid-entries — the same constraint that
 * made `app/styles/club-content.css` a copy (HALT 1, D10). So this is a copy, and
 * `tests/unit/staff-roles.test.ts` fails the moment it disagrees with the original.
 *
 * **Never a security boundary.** It decides whether a link is drawn; `/admin/` asks for itself.
 * After the race, move the original into `packages/shared` and import it from both apps
 * (`docs/delivery/phases.md`).
 */
export const STAFF_ROLES = [
  'nn-admin',
  'people-admin',
  'src-admin',
  'super-admin',
] as const;

export function isStaff(roles: readonly string[]): boolean {
  return roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role));
}
