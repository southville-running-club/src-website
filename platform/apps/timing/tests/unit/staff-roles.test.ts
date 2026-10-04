import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, isStaff } from '../../lib/staff-roles';

/**
 * `lib/staff-roles.ts` is a copy of `apps/main/worker/admin-shell.ts`'s list, and this keeps it
 * one. The app header offers "Club admin" exactly when `/admin/`'s door would open, so a role
 * added there and not here would hide the link from somebody who may use it, and one removed
 * there would offer a link that answers 404.
 */

const original = readFileSync(
  fileURLToPath(new URL('../../../main/worker/admin-shell.ts', import.meta.url)),
  'utf8',
);

/** The string literals inside `export const STAFF_ROLES = [ … ]`, comments stripped. */
function rolesIn(source: string): string[] {
  const body = /export const STAFF_ROLES = \[([\s\S]*?)\] as const;/u.exec(source)?.[1];
  if (body === undefined) throw new Error('admin-shell.ts no longer exports STAFF_ROLES');
  const code = body.replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...code.matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '');
}

describe('the staff roles the app header asks about', () => {
  it('are exactly the roles that open /admin/', () => {
    expect([...STAFF_ROLES].sort()).toEqual(rolesIn(original).sort());
  });

  it('finds the original list, so the test above is not comparing two empty lists', () => {
    expect(rolesIn(original).length).toBeGreaterThan(2);
  });

  it('answers as the original does', () => {
    expect(isStaff(['registered', 'src-admin'])).toBe(true);
    expect(isStaff(['registered', 'timing-admin', 'timing-marshal'])).toBe(false);
    expect(isStaff(['nn-tester'])).toBe(false);
    expect(isStaff([])).toBe(false);
  });
});
