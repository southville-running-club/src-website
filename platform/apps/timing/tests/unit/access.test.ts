import { describe, expect, it } from 'vitest';
import {
  ANY_TIMING_PERMISSION,
  canOpen,
  holdsPermissionFor,
  surfaceFor,
} from '../../lib/access';

/**
 * `lib/access.ts` is what `middleware.ts` refuses from, and it is the only place in this
 * application that knows which permission an address demands — so these are the tests that
 * stand in for the per-page checks a Next page here provably cannot make.
 *
 * ⚠️ **They test the table, not the pages, and that is on purpose.** Only `/timing/` is
 * served today; `/timing/events/` and the rest arrive with #245 and #247. An acceptance test
 * asserting that a marshal gets 404 at `/timing/events/` would pass right now because there is
 * no such route, and would go on passing if this table were deleted — *"a test that passes
 * because the table does not exist yet is a test that has stopped testing"*. The table is the
 * thing that exists, so the table is what is asserted.
 */

const MARSHAL = ['timing.crossing.record'];
const ADMIN = [
  'timing.crossing.record',
  'timing.crossing.resolve',
  'timing.event.manage',
  'timing.marshal.assign',
  'timing.registration.import',
  'timing.result.publish',
];
/** Staff on the club's side, holding nothing here. `nn-admin`'s slugs. */
const NN_ADMIN = ['nn.entry.read', 'nn.entry.cancel', 'nn.results.read'];

describe('what each address demands', () => {
  it.each([
    ['/', ANY_TIMING_PERMISSION],
    ['/events', 'timing.event.manage'],
    ['/events/nn-2026', 'timing.event.manage'],
    ['/events/nn-2026/registration', 'timing.registration.import'],
    ['/events/nn-2026/marshals', 'timing.marshal.assign'],
    ['/events/nn-2026/start', 'timing.event.manage'],
    ['/events/nn-2026/finish', 'timing.event.manage'],
    ['/events/nn-2026/status', 'timing.event.manage'],
    ['/events/nn-2026/danger-zone', 'timing.event.manage'],
    ['/events/nn-2026/anomalies', 'timing.crossing.resolve'],
    ['/events/nn-2026/crossings', 'timing.crossing.resolve'],
    ['/events/nn-2026/results', 'timing.result.publish'],
    ['/marshal/nn-2026', 'timing.crossing.record'],
  ])('%s demands %s', (path, permission) => {
    expect(surfaceFor(path)?.permission).toBe(permission);
  });

  it('carries the event slug where the address names one, and null where it does not', () => {
    expect(surfaceFor('/events/nn-2026/start')?.eventSlug).toBe('nn-2026');
    expect(surfaceFor('/marshal/ptb-2026')?.eventSlug).toBe('ptb-2026');
    expect(surfaceFor('/events')?.eventSlug).toBeNull();
    expect(surfaceFor('/')?.eventSlug).toBeNull();
  });

  /**
   * ⚠️ **Both spellings, and this is the assertion that stops the application 404ing to its
   * own staff.** Next strips `basePath` from `nextUrl.pathname` before middleware sees it —
   * which is why `middleware.ts`'s matcher is written `'/'` rather than `'/timing'` — but that
   * interaction is undocumented and this repository has already been bitten by it once, in
   * that matcher's own comment. If the prefix ever arrives and nothing strips it, every row
   * above misses and every address refuses everybody.
   */
  it('resolves identically with and without the /timing base path', () => {
    for (const tail of [
      '/',
      '/events',
      '/events/nn-2026',
      '/events/nn-2026/results',
      '/marshal/nn-2026',
    ]) {
      expect(surfaceFor(`/timing${tail}`), tail).toEqual(surfaceFor(tail));
    }

    // And bare `/timing`, which is the address people actually visit — the case that sailed
    // past the matcher before `'/'` was added to it as a separate entry.
    expect(surfaceFor('/timing')).toEqual(surfaceFor('/'));
  });

  it('ignores a trailing slash', () => {
    expect(surfaceFor('/events/nn-2026/start/')).toEqual(
      surfaceFor('/events/nn-2026/start'),
    );
  });
});

/**
 * **The half that matters.** Everything above says what opens; this says what does not, and an
 * address with no row is the case that decides whether forgetting to add one is safe.
 */
describe('an address nobody has written a rule for', () => {
  it.each([
    ['/events/nn-2026/whatever-comes-next'],
    ['/events/nn-2026/results/leg-2'],
    ['/marshal'],
    ['/marshal/nn-2026/extra'],
    ['/leaderboard/nn-2026'],
    ['/admin'],
    ['/live/nn-2026'],
  ])('%s is refused rather than opened', (path) => {
    expect(surfaceFor(path)).toBeNull();
    expect(canOpen(ADMIN, path)).toBe(false);
  });

  /**
   * The property in one line: **a `timing-admin` holding every permission there is still
   * cannot open an address that is not in the table.** If this ever inverts, a page added
   * without a row would be open to anybody who got through the door.
   */
  it('is refused even to somebody holding all six permissions', () => {
    expect(canOpen(ADMIN, '/events/nn-2026/something-new')).toBe(false);
  });
});

describe('who may open what', () => {
  /**
   * ⚠️ **The regression this whole change exists for.** A `timing-marshal` holds exactly one
   * permission and, before #243, the door admitted any `timing.*` — so they reached every
   * admin address there was.
   */
  it.each([
    ['/events'],
    ['/events/nn-2026'],
    ['/events/nn-2026/registration'],
    ['/events/nn-2026/marshals'],
    ['/events/nn-2026/start'],
    ['/events/nn-2026/finish'],
    ['/events/nn-2026/status'],
    ['/events/nn-2026/danger-zone'],
    ['/events/nn-2026/anomalies'],
    ['/events/nn-2026/crossings'],
    ['/events/nn-2026/results'],
  ])('a marshal may not open %s', (path) => {
    expect(canOpen(MARSHAL, path)).toBe(false);
    expect(canOpen(ADMIN, path), 'but an admin may').toBe(true);
  });

  /**
   * And the other direction, which is the one a too-eager table breaks: the landing page is
   * the marshal's way in, so locking it to `timing.event.manage` would shut the only page
   * that is actually served to the only role that needs it.
   */
  it('lets a marshal open the landing page', () => {
    expect(canOpen(MARSHAL, '/')).toBe(true);
    expect(canOpen(MARSHAL, '/timing')).toBe(true);
  });

  it('refuses club staff who hold no timing permission at all', () => {
    for (const path of ['/', '/events', '/events/nn-2026/results']) {
      expect(canOpen(NN_ADMIN, path), path).toBe(false);
      expect(canOpen([], path), `${path}, holding nothing`).toBe(false);
    }
  });

  /**
   * `nn.results.read` starts with `nn.` and ends in `.read`, and the landing page's rule is a
   * prefix test — so this pins that the prefix is `timing.` and not something looser. It would
   * pass by luck with `includes('timing')` and fail the day a permission named
   * `store.timing.something` existed.
   */
  it('does not mistake a permission that merely mentions timing', () => {
    expect(canOpen(['nn.timing.read'], '/')).toBe(false);
    expect(canOpen(['timings.event.manage'], '/')).toBe(false);
  });
});

describe('the roster scope', () => {
  it('is flagged on the marshal capture screen and nowhere else', () => {
    expect(surfaceFor('/marshal/nn-2026')?.rosterScoped).toBe(true);

    for (const path of ['/', '/events', '/events/nn-2026/crossings']) {
      expect(surfaceFor(path)?.rosterScoped, path).toBe(false);
    }
  });

  /**
   * ADR-036: the roster is a scope checked **after** the permission, never instead of it. So
   * `holdsPermissionFor` answers the permission question alone and says nothing about the
   * roster — a function that quietly answered both is how an unimplemented check hides.
   */
  it('is not answered by the permission check', () => {
    const surface = surfaceFor('/marshal/nn-2026');

    expect(surface).not.toBeNull();
    expect(holdsPermissionFor(MARSHAL, surface!)).toBe(true);
    expect(surface!.rosterScoped).toBe(true);
  });
});
