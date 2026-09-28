import { describe, expect, it } from 'vitest';
import { canOpen, surfaceFor } from '../../../timing/lib/access';
import { ADMIN_SECTIONS, masthead, type AdminViewer } from '../../worker/admin-shell';

/**
 * The admin bar's one link out of this Worker — "Race timing", into `apps/timing`.
 *
 * **Why a unit test and not the Miniflare layer.** The link is drawn for a staff member who
 * also holds `timing.event.manage`, and no account in `admin-fixtures.ts` is both: the two
 * timing addresses are owned by `timing.spec.ts` and deliberately hold no staff role, and
 * adding a seventh person to the admin fixture set is the multi-spec race `CLAUDE.md` records.
 * `masthead()` is a pure function of the viewer, so the viewer is made up here and the
 * Miniflare suite keeps the negative half against its real accounts.
 */

function viewer(permissions: string[]): AdminViewer {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    label: 'someone@example.com',
    roles: ['src-admin'],
    permissions,
    accessToken: 'not-a-real-token',
  };
}

describe('the Race timing link in the admin bar', () => {
  it('is drawn for somebody who may open the races list', () => {
    const bar = masthead(viewer(['timing.event.manage'])).toString();

    expect(bar).toContain('href="/timing/events"');
    expect(bar).toContain('Race timing');
  });

  it('is not drawn for staff without the permission, even holding another timing one', () => {
    // `timing.crossing.record` opens the landing page and not the races list, so a link here
    // would be a link to a 404 — the disclosure the whole bar is painted to avoid.
    for (const permissions of [
      ['nn.entry.read', 'nn.email.read'],
      ['identity.person.read', 'identity.role.grant'],
      ['timing.crossing.record'],
    ]) {
      expect(masthead(viewer(permissions)).toString(), permissions.join()).not.toContain(
        '/timing/',
      );
    }
  });

  it('names the permission the timing app’s own door asks for that address', () => {
    // The link lives in `apps/main` and the door in `apps/timing`, so nothing but this test
    // stops the two drifting. `surfaceFor` is the table `middleware.ts` enforces.
    const section = ADMIN_SECTIONS.find((s) => s.href.startsWith('/timing'));

    expect(section).toBeDefined();
    expect(surfaceFor(section!.href)?.permission).toBe(section!.permission);
    expect(canOpen([section!.permission!], section!.href)).toBe(true);
  });
});
