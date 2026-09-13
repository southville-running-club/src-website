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
    // The form's target, not a page — #245. It demands the *section's* own permission, so
    // reading a roster and changing one cannot come apart by accident.
    ['/events/nn-2026/marshals/update', 'timing.marshal.assign'],
    // #250's write address, and the same rule: starting a race and reading the start screen
    // are both `timing.event.manage`, so they cannot come apart by accident.
    ['/events/nn-2026/start/update', 'timing.event.manage'],
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
    // ⚠️ **A fourth segment is only ever a write address that was written down.** `marshals`
    // has exactly one, and the section having *an* action must not open every spelling under
    // it — which is the way widening this table would most plausibly go wrong.
    ['/events/nn-2026/marshals/delete'],
    ['/events/nn-2026/marshals/update/again'],
    ['/events/nn-2026/registration/update'],
    // ⚠️ **`start` has exactly one action since #250**, and a second spelling under it is
    // still refused — which is the half that keeps the table from widening by section.
    ['/events/nn-2026/start/begin'],
    ['/events/nn-2026/start/update/again'],
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
    expect(canOpen(ADMIN, '/events/nn-2026/marshals/something-new')).toBe(false);
  });

  /**
   * ⚠️ **A defect that was in this table from #262 and was hidden by luck downstream.**
   *
   * The sections are object literals, so they inherit from `Object.prototype`:
   * `EVENT_SECTIONS['constructor']` is a *function*, not `undefined`. `surfaceFor` tested
   * `permission === undefined`, so `/events/nn-2026/constructor` answered a surface whose
   * permission was a function instead of the `null` this module promises.
   *
   * Nothing opened, because `holdsPermissionFor` asks `permissions.includes(...)` and no array
   * of slugs holds a function — but `middleware.ts` refuses on `surfaceFor(...) === null`
   * *before* it reads a session, and "a missing row refuses by itself" is the property the
   * whole table is argued from. It held only because the next function happened to disagree
   * with it. `lookup()` is the fix and these are what hold it.
   */
  it.each([
    ['/events/nn-2026/constructor'],
    ['/events/nn-2026/toString'],
    ['/events/nn-2026/__proto__'],
    ['/events/nn-2026/hasOwnProperty'],
    ['/events/nn-2026/marshals/constructor'],
    ['/events/nn-2026/marshals/__proto__'],
    ['/events/nn-2026/start/constructor'],
  ])('%s is not a row just because Object.prototype has one', (path) => {
    expect(surfaceFor(path)).toBeNull();
    expect(canOpen(ADMIN, path)).toBe(false);
  });

  /**
   * ⚠️ **The other half, so the fix above is not read as "reject that word everywhere".** In
   * `/events/constructor/marshals` the awkward word is the **event slug**, and a slug is free
   * text this table has no opinion about: the address is a perfectly ordinary roster page that
   * demands `timing.marshal.assign`, and whether such a race exists is the database's question
   * — `roster_for_event()` answers `null` and the page renders "Not found". Refusing it here
   * would be this module inventing a rule about names it does not own.
   */
  it('still resolves an address whose event slug happens to be an awkward word', () => {
    expect(surfaceFor('/events/constructor/marshals')?.permission).toBe(
      'timing.marshal.assign',
    );
    expect(surfaceFor('/events/__proto__')?.permission).toBe('timing.event.manage');
  });
});

/**
 * The addresses a form posts to — #245 is the first write in this application.
 *
 * ⚠️ **The reason these are worth their own block**: a write address is where the door being
 * open by omission costs the most. A page that opens too widely discloses; a POST that opens
 * too widely *changes a race's roster*. So the assertions below are the negative ones — that
 * the gate treats the form's target exactly as it treats the page, and that being allowed to
 * look is what being allowed to change is checked against.
 */
describe('the address a roster form posts to', () => {
  it('is gated, rather than being a hole beside a gated page', () => {
    expect(surfaceFor('/events/nn-2026/marshals/update')).not.toBeNull();
    expect(canOpen(MARSHAL, '/events/nn-2026/marshals/update')).toBe(false);
    expect(canOpen(NN_ADMIN, '/events/nn-2026/marshals/update')).toBe(false);
    expect(canOpen([], '/events/nn-2026/marshals/update')).toBe(false);
    expect(canOpen(ADMIN, '/events/nn-2026/marshals/update')).toBe(true);
  });

  it('demands exactly what the page it posts from demands', () => {
    expect(surfaceFor('/events/nn-2026/marshals/update')?.permission).toBe(
      surfaceFor('/events/nn-2026/marshals')?.permission,
    );
  });

  it('carries the event slug, so the gate and the function agree on which race', () => {
    expect(surfaceFor('/events/nn-2026/marshals/update')?.eventSlug).toBe('nn-2026');
  });

  it('resolves identically with the base path and with a trailing slash', () => {
    const bare = surfaceFor('/events/nn-2026/marshals/update');

    expect(surfaceFor('/timing/events/nn-2026/marshals/update')).toEqual(bare);
    expect(surfaceFor('/events/nn-2026/marshals/update/')).toEqual(bare);
  });
});

/**
 * The address the start screen posts to — #250, and the second write in this application.
 *
 * ⚠️ **This one changes the number every result in the race is derived from**, so the gate on
 * it matters more than the gate on the page beside it: reading a countdown discloses a start
 * time, and posting to this address decides it. The assertions are the same shape as the
 * roster's for that reason — what opens the page is exactly what opens the form.
 */
describe('the address the start form posts to', () => {
  it('is gated, rather than being a hole beside a gated page', () => {
    expect(surfaceFor('/events/nn-2026/start/update')).not.toBeNull();
    expect(canOpen(MARSHAL, '/events/nn-2026/start/update')).toBe(false);
    expect(canOpen(NN_ADMIN, '/events/nn-2026/start/update')).toBe(false);
    expect(canOpen([], '/events/nn-2026/start/update')).toBe(false);
    expect(canOpen(ADMIN, '/events/nn-2026/start/update')).toBe(true);
  });

  it('demands exactly what the page it posts from demands', () => {
    expect(surfaceFor('/events/nn-2026/start/update')?.permission).toBe(
      surfaceFor('/events/nn-2026/start')?.permission,
    );
  });

  it('carries the event slug, so the gate and the function agree on which race', () => {
    expect(surfaceFor('/events/nn-2026/start/update')?.eventSlug).toBe('nn-2026');
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
