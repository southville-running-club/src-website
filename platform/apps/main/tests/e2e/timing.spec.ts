import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  anomalyCrossing,
  anomalyCrossingId,
  anomalyEventSlug,
  ANOMALY_ORPHAN_BIB,
  ANOMALY_REASON,
  ANOMALY_SECOND_TEAM_NUMBER,
  ANOMALY_TEAM_NUMBER,
  captureCrossings,
  captureEventSlug,
  clearAnomalyEvent,
  clearCaptureEvent,
  clearStatusEvent,
  addPreviewOrphan,
  clearPreviewEvent,
  clearResetEvent,
  clearRosterEvent,
  clearStartEvents,
  previewEventSlug,
  previewRaceState,
  PREVIEW_TEAMS,
  resetEventSlug,
  resetPreviewRace,
  resetRaceState,
  rosterEventSlug,
  resetStatusRace,
  seedAnomalyCrossings,
  seedAnomalyEvent,
  seedCaptureEvent,
  seedPreviewEvent,
  seedResetEvent,
  seedRosterEvent,
  seedStartEvents,
  seedStatusEvent,
  statusEventSlug,
  statusRaceState,
  STATUS_TEAMS,
  seedTimingFixtures,
  startEventSlug,
  CAPTURE_TEAM_NUMBER,
  START_FIXTURE_FINISHED_LONDON,
  START_FIXTURE_STARTED_LONDON,
  type StartFixtureState,
} from '../timing-db';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import { TIMING_ADMIN_EMAIL, TIMING_MARSHAL_EMAIL } from '../admin-fixtures';
import { RESULTS_EVENT_NAME, RESULTS_EVENT_SLUG } from '../timing-fixtures';
import { expectNoSidewaysScroll, waitForStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * `/timing`'s own pages, in a real browser — #247.
 *
 * `admin.spec.ts` asserts the club side is refused here; this file is the other half, the
 * people who may come in. It is a separate spec because it is a separate application: these
 * addresses are served by the timing Worker, which Cloudflare dispatches at the edge and
 * `apps/main` never sees.
 *
 * ⚠️ **This spec seeds its own people and never the club's, and CI is what proved it has to.**
 * The first version called `seedAdminFixtures()` like `admin.spec.ts` does, and the two files
 * then raced to sign the same addresses up: `AuthApiError: User already registered`, in a
 * `beforeAll`, on whichever shard ran them together. **One spec, one set of people it owns
 * outright** — `timing-staff-db.ts` creates exactly the two timing accounts and clears exactly
 * those two, and touches nothing `admin.spec.ts` depends on.
 *
 * The races come from `timing-db.ts`, which already fabricates two runnings for
 * `/nn/<year>/results/` and which no other spec seeds.
 *
 * ⚠️ **The two people hold timing roles and nothing else**, deliberately: granting a timing
 * role to one of the club-side fixtures would silently delete `admin.spec.ts`'s "different
 * doors" assertions, which are the other half of this boundary.
 */

const EVENTS = '/timing/events/';

/**
 * ⚠️ **No trailing slash, because that is what `next/link` generates.** `apps/main` is
 * `trailingSlash: 'always'` and `apps/timing` sets nothing, so a link built here lands on the
 * slashless spelling. Both resolve — `surfaceFor()` ignores a trailing slash and Next serves
 * either — and there is a test below that pins it, because a link written by hand elsewhere
 * will reach for the club's convention rather than this one.
 */
const EVENT = `/timing/events/${RESULTS_EVENT_SLUG}`;

/**
 * The roster tests write, so they get a running of their own **per Playwright project** —
 * `timing-db.ts`'s `rosterEventSlug` carries the argument. The short of it: two projects of
 * this file can be in flight at once, and a shared roster would make each occasionally assert
 * against the other's writes.
 */
const rosterPath = (project: string): string =>
  `/timing/events/${rosterEventSlug(project)}/marshals`;

/**
 * An address under `/timing` that has nothing to show — the body **and** the status.
 *
 * ⚠️ **There are two not-found answers here and they carry two different status codes**, which
 * is [ADR-044](../../../../../docs/architecture/decisions/adr-044-a-missing-race-under-timing-answers-200.md)
 * rather than an accident:
 *
 * | | | |
 * | --- | --- | --- |
 * | **A refusal** — no session, no permission, no roster row | `middleware.ts` rewrites to an address matching no route, so Next serves its *prerendered* not-found page | **404** |
 * | **A race that does not exist**, asked for by somebody who holds the permission | the request gets past the door, the page's own read answers `none`, and the page renders `app/not-found-body.tsx` | **200** |
 *
 * The 200 is the price of a measured constraint: `notFound()` thrown from a **dynamic** render
 * — and reading cookies makes every render there dynamic — returns a blank error shell rather
 * than the not-found page, which
 * [#243](https://github.com/southville-running-club/src-website/issues/243) measured and
 * `middleware.ts`'s header records. So a page that has nothing to show *renders*, and a render
 * is a 200.
 *
 * ⚠️ **The ten tests that meet this asserted the heading and not the status**, which is how the
 * live leaderboard's own test came to assert 404 and fail on all three engines —
 * [#291](https://github.com/southville-running-club/src-website/issues/291). They all come
 * through here now, so the status is a written-down expectation rather than whatever happens:
 * nine of them pass **200** and `/timing/marshal/<slug>/` passes **404**, because that is the
 * one address whose door already makes a read that answers existence — ADR-036's roster scope,
 * which it needs anyway.
 *
 * **The body is asserted in both cases and must never differ between them.** A refusal that
 * reads differently from a missing address is the disclosure the club's 404-rather-than-403
 * rule exists to prevent, and `apps/timing/app/not-found-body.tsx` is the one component both
 * paths render.
 */
async function expectNotFoundPage(
  page: Page,
  path: string,
  status: 200 | 404,
): Promise<void> {
  const response = await page.goto(path);

  expect(response?.status(), path).toBe(status);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  await expect(page.getByText('There is nothing at this address.')).toBeVisible();
}

/*
 * ⚠️ **`{}` is required by Playwright and rejected by ESLint, so the rule is turned off for
 * exactly these two lines.** Playwright reads the *source* of a hook to work out which
 * fixtures to set up, and refuses a first argument that is not a destructuring pattern —
 * `First argument must use the object destructuring pattern: _fixtures`, thrown while listing
 * tests, before anything runs. So the empty pattern is the API, not a style choice, and
 * renaming it to `_fixtures` does not work. `testInfo` is the second argument and is what
 * these hooks are actually after: the **project name**, which is what gives each Playwright
 * project a roster event of its own — see `timing-db.ts`'s `rosterEventSlug`.
 */
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  await seedTimingStaff();
  await seedTimingFixtures();
  await seedRosterEvent(rosterEventSlug(testInfo.project.name));
  // #250's five runnings, likewise one set per project — `seedStartEvents`' header carries
  // the argument, and why these are re-created rather than seeded idempotently.
  await seedStartEvents(testInfo.project.name);
  // #203's capture race. ⚠️ **After the staff**, because it looks the marshal up by address in
  // order to put them on the roster.
  await seedCaptureEvent(testInfo.project.name, TIMING_MARSHAL_EMAIL);
  // #252's race. Its captures are re-seeded per test — `seedAnomalyEvent`'s header says why.
  await seedAnomalyEvent(testInfo.project.name);
  // #253's race. Its labels are reset per test — `seedStatusEvent`'s header says why.
  await seedStatusEvent(testInfo.project.name);
  // #254's race. ⚠️ **After the staff**, because it rosters the marshal by address — and
  // re-seeded per test, because every test in that block wipes every row on it.
  await seedResetEvent(testInfo.project.name, TIMING_MARSHAL_EMAIL);
  // #205's race. Re-seeded per test, because publishing is a property of the race rather than
  // of a row — `seedPreviewEvent`'s header carries the argument.
  await seedPreviewEvent(testInfo.project.name);
  // The people were just re-created, so any jar cached by another spec names somebody who no
  // longer exists. See `forgetSessions`.
  forgetSessions();
});

/*
 * ⚠️ **`clearTimingFixtures()` is deliberately NOT called here**, and leaving it in was a real
 * failure rather than untidiness. This hook runs once **per project**, and two projects of
 * this file can be in flight at the same time — so the first to finish deleted the two
 * fabricated races out from under the one still reading them. It surfaced a long way from its
 * cause: a hub page rendered "Not found" and the test waiting on a link on it failed as a
 * ten-second timeout naming the link.
 *
 * `seedTimingFixtures()` is idempotent now and nothing here deletes those rows. They are two
 * runnings of years that will not happen, in a database `./dev up`, `./dev check` and
 * `./dev test` each rebuild from zero — and `tests/worker/admin/global-setup.ts`, which is
 * single-threaded, still clears them.
 *
 * The two below are safe because each is scoped to something this project owns outright: the
 * roster event carries the project name, and the staff accounts carry the worker slot.
 */
// eslint-disable-next-line no-empty-pattern
test.afterAll(async ({}, testInfo) => {
  await clearRosterEvent(rosterEventSlug(testInfo.project.name));
  await clearStartEvents(testInfo.project.name);
  await clearCaptureEvent(testInfo.project.name);
  await clearAnomalyEvent(testInfo.project.name);
  await clearStatusEvent(testInfo.project.name);
  await clearResetEvent(testInfo.project.name);
  await clearPreviewEvent(testInfo.project.name);
  await clearTimingStaff();
});

/**
 * ⚠️ **The assertions that would pass for the wrong reason if the table were deleted.**
 *
 * Every address under `/timing` 404s to somebody who may not open it — and an address that
 * does not exist also 404s. So a refusal test is only worth something next to a positive one
 * on the same address, which is why each of these sits beside a test proving the page renders
 * for somebody who may. `apps/timing/tests/unit/access.test.ts` covers the mapping itself.
 */
test.describe('who may open the events pages', () => {
  test('a timing-marshal is refused both, and gets the ordinary 404', async ({
    page,
  }) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    for (const path of [EVENTS, EVENT]) {
      const response = await page.goto(path);

      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
      // The same sentence a genuinely missing address gives, so the refusal discloses nothing.
      await expect(page.getByText('There is nothing at this address.')).toBeVisible();
    }
  });

  test('but reaches the landing page, which is what their permission opens', async ({
    page,
  }) => {
    // Without this the test above passes if the marshal were locked out of `/timing`
    // altogether — which is the mistake a too-eager permission table makes.
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    const response = await page.goto('/timing');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
  });

  test('a signed-out visitor is refused', async ({ page }) => {
    await page.context().clearCookies();

    expect((await page.goto(EVENTS))?.status()).toBe(404);
  });
});

test.describe('the events list', () => {
  test('lists the races a timing-admin may manage', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(EVENTS);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Races');
    await expect(page.getByRole('link', { name: RESULTS_EVENT_NAME })).toBeVisible();
  });

  test('links each race to its own page', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENTS);
    await page.getByRole('link', { name: RESULTS_EVENT_NAME }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(RESULTS_EVENT_NAME);
    expect(new URL(page.url()).pathname).toBe(EVENT);
  });

  /**
   * The club's side is `trailingSlash: 'always'` and this application sets nothing, so a link
   * written by hand elsewhere is likely to carry a slash this one's own links do not. Both
   * have to reach the page, or a correct-looking link 404s.
   */
  test('serves the same race with or without a trailing slash', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    expect((await page.goto(`${EVENT}/`))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(RESULTS_EVENT_NAME);
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENTS);

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(EVENTS);

    await expectNoSidewaysScroll(page, 'the timing events list at 320px');
  });
});

test.describe('one race', () => {
  test('shows the counts a volunteer is deciding from', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);

    await expect(
      page.getByRole('heading', { name: 'Where it has got to' }),
    ).toBeVisible();
    // `timing-db.ts`'s fixture running has a field on it, so these are not all zero — a page
    // of zeroes would render identically whether or not the counts were wired up.
    await expect(
      page
        .getByRole('definition')
        .filter({ hasText: /^[1-9]/ })
        .first(),
    ).toBeVisible();
  });

  /**
   * ⚠️ **The refusal and the missing race are the same answer, deliberately.**
   * `event_detail()` returns `null` for both, so a slug cannot be probed for existence — and
   * this page cannot tell them apart either, which is the point rather than a limitation.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/', 200);
  });

  /**
   * ⚠️ **The harm the 200 was actually worth worrying about, asserted rather than assumed** —
   * #291's own words: *"a cache that stores a 200 'Not found' for an address that later has a
   * race on it is a race-day failure nobody would diagnose quickly"*. It cannot, and this is
   * what says so: every page under `/timing` is `force-dynamic`, so the response forbids being
   * stored, and a slug that names nothing today is a race tomorrow the moment somebody creates
   * one.
   *
   * **Asserted once rather than on all nine.** It is a property of every dynamically rendered
   * response this application sends, not of this page — so a second copy would be a second
   * place for the same fact, and ADR-044 is where the argument lives.
   */
  test('and that 200 is not a response anything is allowed to store', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto('/timing/events/zz-no-such-race/');

    expect(response?.status()).toBe(200);
    // Next's dynamic default is `private, no-cache, no-store, max-age=0, must-revalidate`. Any
    // one of those four forbids a shared cache keeping it; the assertion is deliberately the
    // question — *may this be stored* — rather than the exact string, which is the framework's.
    expect(response?.headers()['cache-control'] ?? '').toMatch(
      /no-store|no-cache|private|max-age=0/,
    );
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(EVENT);

    await expectNoSidewaysScroll(page, 'one timing race at 320px');
  });
});

/**
 * The marshal roster — [#245](https://github.com/southville-running-club/src-website/issues/245),
 * under [ADR-036](../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
 *
 * ⚠️ **This is the first thing in `/timing` that changes anything**, so these are the first
 * tests here that are about a write. Two properties are worth more than the rest and are
 * asserted first: **the address the form posts to is gated exactly as the page is** — a POST
 * that opens more widely than the page it came from changes a race's roster rather than merely
 * disclosing one — and **every test in this block runs in the `no-javascript` project**, which
 * is what holds the choice of a plain `<form method="post">` over a Server Action honest.
 */
test.describe('who may open the marshal roster', () => {
  test('a timing-marshal is refused the page and the form it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = rosterPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The half a page test cannot reach.** `timing.marshal.assign` is what both demand,
    // and a marshal holds neither — but only the POST would actually change a roster, so it
    // is asserted directly rather than inferred from the page beside it.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign', person_id: '00000000-0000-4000-8000-000000000001' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('a signed-out visitor is refused both', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the *cached jars* this
    // whole file signs in from, which is a `beforeAll` concern and would make every test after
    // this one authenticate again. The sibling test above uses the same call for that reason.
    await page.context().clearCookies();
    const path = rosterPath(testInfo.project.name);

    expect((await page.goto(path))?.status()).toBe(404);

    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign', person_id: '00000000-0000-4000-8000-000000000001' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });
});

test.describe('the marshal roster', () => {
  test('opens to a timing-admin, and says nobody is on it yet', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(rosterPath(testInfo.project.name));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marshals');
    /*
     * ⚠️ **The empty roster says *why* it matters, and that sentence is load-bearing.**
     * ADR-036 checks the roster after the permission for everybody, so a `timing-admin` who
     * is going to stand at the line is not on it by holding the role — and the old
     * application's behaviour was the opposite. The first time anybody finds that out must
     * not be on a start line.
     */
    await expect(page.getByText(/Nobody is on this roster yet/)).toBeVisible();
    await expect(page.getByText(/adds themselves like anybody else/)).toBeVisible();
  });

  test("is linked from the race's own page", async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);
    await page.getByRole('link', { name: 'Marshals for this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marshals');
    expect(new URL(page.url()).pathname).toBe(`${EVENT}/marshals`);
  });

  /**
   * ⚠️ **One test for the whole round trip, deliberately.** Assigning and removing are two
   * tests' worth of assertions and one test's worth of state: split in two, the second would
   * depend on the first having run — which `fullyParallel` is free to stop being true — and
   * neither would prove the pair. The round trip is also what a volunteer actually does.
   */
  test('puts somebody on the roster, and takes them off again', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(rosterPath(testInfo.project.name));

    // The picker carries an address because `identity.people.name` is null for everybody
    // until #61 — the roster deliberately does not, so the person reads as "No name recorded"
    // once they are on it. `20260912110000`'s header argues both halves.
    await page.selectOption('#person_id', { label: TIMING_MARSHAL_EMAIL });
    await page.getByRole('button', { name: 'Add to this roster' }).click();

    await expect(page.getByText('They are on the roster for this race.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No name recorded' })).toBeVisible();

    /*
     * ⚠️ **ADR-036's rule, asserted where it is actually visible.** The person just added is
     * no longer offered — the picker subtracts the roster — and the `timing-admin` doing the
     * adding **still is**, because `timing-admin` carries `timing.crossing.record` and a
     * roster is checked after the permission for everybody. The old application let a global
     * admin bypass the roster entirely; if that ever comes back, this is the line that goes
     * red.
     */
    await expect(
      page.locator('#person_id option', { hasText: TIMING_MARSHAL_EMAIL }),
    ).toHaveCount(0);
    await expect(
      page.locator('#person_id option', { hasText: TIMING_ADMIN_EMAIL }),
    ).toHaveCount(1);

    await page.getByRole('button', { name: /^Remove No name recorded/ }).click();

    /*
     * The sentence that stops somebody being put on a start line who is not on it, and the
     * one `unassign_marshal()`'s own header promises: a roster change is not a deleted
     * person, and what they recorded is untouched.
     */
    await expect(page.getByText(/off the roster for this race/)).toBeVisible();
    await expect(page.getByText(/Anything they recorded is unchanged/)).toBeVisible();
    await expect(page.getByText(/Nobody is on this roster yet/)).toBeVisible();
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `roster_for_event()`
   * returns `null` for both so a slug cannot be probed for existence.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/marshals', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(rosterPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(rosterPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing marshal roster at 320px');
  });
});

/**
 * The start screen — [#250](https://github.com/southville-running-club/src-website/issues/250),
 * under [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 *
 * ⚠️ **This is the screen that decides what every result in the race is measured from**, so
 * two properties are asserted before any of the rendering: **the form's address is gated
 * exactly as the page is**, and **every test in this block runs in the `no-javascript`
 * project**. The second is not a box-tick here — a start line is a phone, outdoors, on a bad
 * connection, and a control that needed a script would fail in the one place there is no
 * second try. The countdown and the elapsed clock are the *only* things on this page that need
 * JavaScript, and each renders a true sentence without it.
 */
const startPath = (project: string, state: StartFixtureState): string =>
  `/timing/events/${startEventSlug(project, state)}/start`;

test.describe('who may open the start screen', () => {
  test('a timing-marshal is refused the page and the form it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = startPath(testInfo.project.name, 'pending');

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The half a page test cannot reach**, and the half that would actually start a race.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('a signed-out visitor is refused both', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this
    // whole file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();
    const path = startPath(testInfo.project.name, 'pending');

    expect((await page.goto(path))?.status()).toBe(404);

    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('leaves the race unstarted after both refusals', async ({ page }, testInfo) => {
    // Without this the two tests above pass if the POST 404'd *after* writing. Read back as
    // somebody who may, on the page that would say so.
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));

    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
  });
});

test.describe('a race that has not started', () => {
  test('counts down and offers the one button, with or without scripting', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(startPath(testInfo.project.name, 'pending'));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start');
    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toBeVisible();

    /*
     * ⚠️ **The migration's own rule, on the page.** A clock reaching zero starts nothing;
     * `start_event()` stores `now()` and never reads `start_at`. If this sentence ever goes,
     * somebody will build a screen that fires on a timer.
     */
    await expect(page.getByText(/A clock reaching zero starts nothing/)).toBeVisible();

    // And the sentence that stops a double press being read as a failure.
    await expect(
      page.getByText(/Pressing it twice does not move the clock/),
    ).toBeVisible();
  });

  test('is keyboard-operable, so the button can be reached without a pointer', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));

    // A real `<button type="submit">` in a real form, so this is the browser's own behaviour
    // rather than anything this page had to arrange — which is the assertion.
    const button = page.getByRole('button', { name: 'Start the race' });
    await button.focus();
    await expect(button).toBeFocused();
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = startEventSlug(testInfo.project.name, 'pending');

    await page.goto(`/timing/events/${slug}`);
    await page.getByRole('link', { name: 'Start this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start');
    expect(new URL(page.url()).pathname).toBe(`/timing/events/${slug}/start`);
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `event_detail()` returns
   * `null` for both so a slug cannot be probed for existence.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/start', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    // ⚠️ **The full-width button and a clock in `clamp(2rem, 12vw, 3rem)` are both new here**,
    // and a big number beside a long timezone name is exactly the shape that has pushed pages
    // sideways in this repository before.
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(startPath(testInfo.project.name, 'pending'));

    await expectNoSidewaysScroll(page, 'the timing start screen at 320px');
  });
});

test.describe('the gun', () => {
  /**
   * ⚠️ **One test for the whole thing, deliberately** — the roster's argument, and here it is
   * stronger: a race can only be started once, so a second test asserting the second press
   * would depend on the first having run, and `fullyParallel` is free to stop being true.
   *
   * The second press is made with `page.request.post` rather than by clicking, because there
   * **is no button to click** once the race is running — which is itself the point. That is the
   * losing device in the shape it actually arrives: a form re-posted from a page somebody's
   * browser was already holding.
   */
  test('starts the race, and a second press does not move the clock', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const path = startPath(testInfo.project.name, 'press');
    await page.goto(path);

    await page.getByRole('button', { name: 'Start the race' }).click();

    await expect(page.getByText(/The race has started/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();

    const started = await page.getByText(/^It started /).textContent();
    expect(started).toBeTruthy();

    // The button is gone, which is what makes the direct POST the honest way to press again.
    await expect(page.getByRole('button', { name: 'Start the race' })).toHaveCount(0);

    const again = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });

    // 303, so Back and Reload both do the harmless thing — and the outcome the losing device
    // is sent back with is the truthful one rather than an error.
    expect(again.status()).toBe(303);
    expect(again.headers()['location']).toContain('outcome=already_started');

    await page.goto(path);

    // ⚠️ **The assertion the whole issue exists for.** Every runner's time is measured from
    // this moment, and the second press did not move it.
    await expect(page.getByText(/^It started /)).toHaveText(started as string);
    await expect(page.getByText(/had already started/)).toHaveCount(0);
  });
});

test.describe('a race that is running', () => {
  /**
   * ⚠️ **The clocks-change assertion, and it is the reason this fixture exists.** The start is
   * `2026-10-25T00:30:00Z`, which is **01:30 BST** in London on the morning the clocks go back
   * — 01:30 happens twice that day and this is the first pass. A page rendering the UTC value
   * would say 00:30; one guessing the offset would say GMT. The race itself is the following
   * weekend, so an hour of drift here is an hour of drift there.
   */
  test('shows the start in London time, on the morning the clocks go back', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'running'));

    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();
    await expect(
      page.getByText(`It started ${START_FIXTURE_STARTED_LONDON}`),
    ).toBeVisible();
  });

  /**
   * The elapsed clock needs JavaScript and this suite includes a project without it, so the
   * fallback has to be a **true sentence naming the moment** rather than a placeholder. In the
   * scripted projects the clock replaces it, which is why this asserts the moment rather than
   * the wording.
   */
  test('says something true about the start whether or not the clock can tick', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'running'));

    await expect(page.getByText(START_FIXTURE_STARTED_LONDON).first()).toBeVisible();
  });

  test('refuses to clear the start once somebody has been timed', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const path = startPath(testInfo.project.name, 'running');
    await page.goto(path);

    // No button at all, and a sentence saying why — a refusal with no reason is what gets
    // worked around by somebody in a hurry.
    await expect(page.getByRole('button', { name: 'Clear the start' })).toHaveCount(0);
    await expect(page.getByText(/already been timed in this race/)).toBeVisible();

    // ⚠️ **And the database refuses it too**, which is the half the page cannot be trusted
    // for: the page not offering a control is not the same as the control being refused.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'clear' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(303);
    expect(posted.headers()['location']).toContain('outcome=crossings_exist');

    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();
  });

  test('clears a false start when nobody has been timed, and counts down again', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'clearable'));

    await page.getByRole('button', { name: 'Clear the start' }).click();

    await expect(page.getByText(/The start has been cleared/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toBeVisible();
  });
});

/**
 * ⚠️ **The old application's [#23](https://github.com/bindalshah/src-race-timing/issues/23),
 * and #250 puts fixing it in scope from the first version.** That screen went on showing a
 * start button and a running clock after the race had finished, and an inconsistent screen on
 * a start line is believed.
 */
test.describe('a race that has finished', () => {
  test('says so, and offers neither button', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'finished'));

    await expect(page.getByRole('heading', { name: 'Race finished' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear the start' })).toHaveCount(0);

    // Both instants in London time, either side of the change: 01:30 BST and 01:45 GMT, which
    // is fifteen minutes of real time and an hour apart on a naive reading.
    await expect(page.getByText(START_FIXTURE_STARTED_LONDON).first()).toBeVisible();
    await expect(page.getByText(START_FIXTURE_FINISHED_LONDON).first()).toBeVisible();
  });
});

/**
 * `/timing/events/<slug>/registration/` — the entry list, #202, carrying #249's page half.
 *
 * ⚠️ **These tests write to the same per-project running the roster tests use**, for the
 * reason `timing-db.ts`'s `rosterEventSlug` gives: two Playwright projects of this file can be
 * in flight at once, and a shared race would make each occasionally assert against the other's
 * writes. Within one project the tests run one at a time, so sharing the race with the marshal
 * roster is safe — a roster and an entry list touch different tables.
 *
 * **Every CSV below carries its own `PurchaseOrderId` values and its own invented surnames**,
 * so no test can be made to pass or fail by another having run first. That is the same rule
 * `entries` learned when a suite whose runners were all the same person stopped being able to
 * hold two places.
 */
const registrationPath = (project: string): string =>
  `/timing/events/${rosterEventSlug(project)}/registration`;

/**
 * A Full On Sport export, as small as the parser will accept one.
 *
 * The header is the real thing's, trailing comma and all — `KNOWN_COLUMNS` carries an empty
 * string entry for exactly that. **The `DOB` column is left empty**, deliberately: the fixture
 * races are dated 2099 and an age computed against one would be a hundred and something, which
 * reads as a defect in an assertion. The date of birth is dropped at the parser either way,
 * which is the property this slice exists for.
 */
function fullOnSportCsv(
  rows: { poId: string; first: string; last: string; gender: string }[],
): Buffer {
  const header =
    'EventName,EntryType,EntryPaid,EnteredBy,RaceNumber,ep_id,EA_URN,Title,Firstname,Lastname,DOB,Gender,Email,DateEntered,OwnerMember,ClubName,TeamName,AgeOnDay,AgeCategory,PurchaseOrderId,Address1,Address2,Address3,County,City,POSTCODE,PrimaryContactTel,SecondaryContactTel,EmergencyName,EmergencyTel,MedicalInformation,version,';

  const body = rows.map(
    (row) =>
      `zz Fixture Race,Solo,Yes,web,,,,,${row.first},${row.last},,${row.gender},` +
      `${row.first.toLowerCase()}@example.com,,${row.first} ${row.last},zz Fixture AC,,,,` +
      `${row.poId},,,,,,,,,,,,1,`,
  );

  return Buffer.from([header, ...body].join('\n'), 'utf-8');
}

const csvUpload = (buffer: Buffer) => ({
  name: 'entries.csv',
  mimeType: 'text/csv',
  buffer,
});

test.describe('who may open the entry list', () => {
  test('a timing-marshal is refused the page and both addresses it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = registrationPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    /*
     * ⚠️ **The half a page test cannot reach.** `timing.registration.import` is what all three
     * demand and a marshal holds none of it — but only the two POSTs would actually change an
     * entry list, so each is asserted directly rather than inferred from the page beside them.
     * This is also what keeps `EVENT_SECTION_ACTIONS`' "refused by omission" honest: a write
     * address is gated by the same table a page is.
     */
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign-bibs' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);

    const uploaded = await page.request.post(`${path}/import`, {
      multipart: {
        intent: 'import',
        file: csvUpload(
          fullOnSportCsv([
            { poId: 'ZZ-REFUSED-1', first: 'Refused', last: 'Zzquiller', gender: 'F' },
          ]),
        ),
      },
      maxRedirects: 0,
    });
    expect(uploaded.status()).toBe(404);
  });

  test('a signed-out visitor is refused all three', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this whole
    // file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();
    const path = registrationPath(testInfo.project.name);

    expect((await page.goto(path))?.status()).toBe(404);

    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign-bibs' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);

    const uploaded = await page.request.post(`${path}/import`, {
      multipart: {
        intent: 'import',
        file: csvUpload(
          fullOnSportCsv([
            { poId: 'ZZ-REFUSED-2', first: 'Refused', last: 'Zzquiller', gender: 'F' },
          ]),
        ),
      },
      maxRedirects: 0,
    });
    expect(uploaded.status()).toBe(404);
  });
});

test.describe('the entry list', () => {
  test('opens to a timing-admin and says nothing has been imported yet', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(registrationPath(testInfo.project.name));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entry list');

    /*
     * ⚠️ **Both ways in are on the page and the club's own entries come first**, because
     * ADR-039 made that the critical path and the CSV the archive one. If the order ever
     * inverts, somebody setting up Nightingale Nightmare reaches for a file that should not
     * exist — and making one would put a date of birth in it.
     */
    await expect(page.getByRole('button', { name: 'Import from entries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import this file' })).toBeVisible();

    /*
     * The transparency note the parser's own header asks for: a volunteer can see what is and
     * is not being kept, named column by column, before they upload anything.
     */
    await expect(page.getByText(/MedicalInformation/)).toBeVisible();
    await expect(page.getByText(/Nothing about the file itself is kept/)).toBeVisible();
  });

  test("is linked from the race's own page", async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);
    await page.getByRole('link', { name: 'Entry list for this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entry list');
    expect(new URL(page.url()).pathname).toBe(`${EVENT}/registration`);
  });

  test('imports a CSV and puts the runners on the start list', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-IMPORT-1', first: 'Aloysius', last: 'Zzimport', gender: 'M' },
          { poId: 'ZZ-IMPORT-2', first: 'Bernadette', last: 'Zzimport', gender: 'F' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/The entry list was imported/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aloysius Zzimport' })).toBeVisible();
    await expect(page.getByText('Bernadette Zzimport — Female')).toBeVisible();

    /*
     * ⚠️ **The leak assertion, and it is derived from the fixture rather than written as a
     * literal** — `nn-entry-complete.spec.ts`'s rule, learned when a guard matched a bare
     * number against markup full of SVG coordinates and could never have failed. What is
     * checked here is the **URL**: findings and outcomes cross the redirect in the query
     * string, and the parser's own messages name runners and quote their addresses. Nothing
     * off the file may appear there.
     */
    expect(page.url()).not.toContain('Zzimport');
    expect(page.url()).not.toContain('example.com');
  });

  /**
   * ⚠️ **Checking imports nothing, and that is the whole of the preview.** There is nowhere to
   * hold a parsed file between two requests — #202 leaves *whether the raw file is kept at
   * all* unanswered, so this path keeps nothing — which is why the preview is a second submit
   * of the same form rather than a stored result.
   */
  test('reads a file without importing it, and says which rows are wrong', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-CHECK-1', first: 'Cuthbert', last: 'Zzcheck', gender: 'M' },
          // No race category, which is one of the four fields every row must carry.
          { poId: 'ZZ-CHECK-2', first: 'Drusilla', last: 'Zzcheck', gender: '' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Check this file' }).click();

    await expect(page.getByText(/nothing was imported/)).toBeVisible();
    await expect(page.getByText(/Has to be fixed/)).toBeVisible();
    await expect(page.getByText(/Rows? 2/)).toBeVisible();

    // Nothing landed, so neither runner is on the start list — including the good row, because
    // the whole file is refused rather than half applied.
    await expect(page.getByRole('heading', { name: 'Cuthbert Zzcheck' })).toHaveCount(0);
    expect(page.url()).not.toContain('Zzcheck');
  });

  test('refuses to import a file with a row it cannot use', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-BLOCK-1', first: 'Eustace', last: 'Zzblock', gender: 'M' },
          { poId: '', first: 'Ffion', last: 'Zzblock', gender: 'F' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/Nothing was imported/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Eustace Zzblock' })).toHaveCount(0);
  });

  test('says so when the file is not a CSV at all', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles('#file', {
      name: 'entries.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 not a spreadsheet', 'utf-8'),
    });
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/does not look like a CSV/)).toBeVisible();
  });

  /**
   * ⚠️ **One test for the whole round trip, deliberately** — the roster tests' rule. Assigning
   * and then pressing again are two tests' worth of assertions and one test's worth of state,
   * and split in two the second would depend on the first having run.
   *
   * It imports its own entries first, so *"there was something unnumbered to number"* is true
   * whatever else has run in this project.
   */
  test('numbers a field once, and never renumbers it', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-BIBS-1', first: 'Gwendolyn', last: 'Zzbibs', gender: 'F' },
          { poId: 'ZZ-BIBS-2', first: 'Horatio', last: 'Zzbibs', gender: 'M' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();
    await expect(page.getByText(/The entry list was imported/)).toBeVisible();

    await page.getByRole('button', { name: 'Assign bibs' }).click();
    await expect(page.getByText(/Bibs were assigned/)).toBeVisible();

    /*
     * The sentence that stops somebody going looking for a problem that is not there.
     * `assign_bibs()` is idempotent **by skipping**, so a second press is meant to do nothing —
     * and "0 entries were numbered" reads as a failure.
     */
    await page.getByRole('button', { name: 'Assign bibs' }).click();
    await expect(page.getByText(/Every entry already has a number/)).toBeVisible();
  });

  /**
   * The desk path, end to end: somebody turns up, gets the next free number, and then gets
   * handed a physical bib that is not that number.
   */
  test('takes a walk-in at the desk, and the bib they were actually handed', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.fill('#firstname', 'Isambard');
    await page.fill('#lastname', 'Zzwalkin');
    await page.selectOption('#gender', 'male');
    await page.fill('#age_on_day', '41');
    await page.fill('#club_name', 'zz Fixture AC');
    await page.getByRole('button', { name: 'Add this walk-in' }).click();

    await expect(page.getByText(/That walk-in is on the start list/)).toBeVisible();
    await expect(
      page.getByText('Isambard Zzwalkin — Male, 41, zz Fixture AC'),
    ).toBeVisible();

    /*
     * ⚠️ **A bib written on beats the number the entry derives**, which is `effectiveBib()`'s
     * whole contract and the one thing ADR-034 says the rewrite may not break. `9081` is
     * invented and deliberately outside anything `assign_bibs()` hands out, so it cannot clash
     * with another test's field.
     */
    await page.getByLabel('Bib written on for Isambard Zzwalkin').fill('9081');
    await page
      .getByRole('button', { name: 'Save the bib for Isambard Zzwalkin' })
      .click();

    await expect(
      page.getByText(/That bib is recorded against the leg you chose/),
    ).toBeVisible();
    await expect(page.getByLabel('Bib written on for Isambard Zzwalkin')).toHaveValue(
      '9081',
    );
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `event_roster()` returns
   * `null` for both so a slug cannot be probed for existence.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/registration', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(registrationPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing entry list at 320px');
  });
});

/**
 * The marshal capture screen — [#203](https://github.com/southville-running-club/src-website/issues/203),
 * under [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * and [ADR-036](../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
 *
 * ⚠️ **The one surface here that genuinely cannot work without JavaScript**, and the only
 * place on this platform where that is the answer rather than a defect: an offline queue in
 * IndexedDB has nothing to degrade to. So most of this block is `@requires-js` — and the first
 * test in it is the one that is *not*, because what a phone with no script is left with is the
 * thing a marshal would actually have to act on.
 *
 * The rules themselves are `apps/timing/tests/unit/queue-state.test.ts`, which can reach a
 * tenth retry in a millisecond. What is here is what only a browser can say: that a tap
 * records a time, that the time survives being offline, and that the door is checked on the
 * two addresses the screen calls as well as on the page.
 */
const capturePath = (project: string): string =>
  `/timing/marshal/${captureEventSlug(project)}`;

/**
 * ⚠️ **A bib per test, and no test asserts how many crossings the race has.**
 *
 * These tests share one race per project — they have to, because a crossing's anomaly is judged
 * against every other crossing on the same race — and Playwright is free to run them in any
 * order. The first version of this block had two order dependencies and CI found both: one test
 * recorded `147` and another asserted that `247` had **no handover recorded**, which is true
 * only while `147` is absent; and two tests counted the whole race's crossings.
 *
 * So each test owns a bib nothing else writes, and every assertion is about *that* bib. The
 * counting ones read a total before and after instead.
 *
 * `147` and `247` are leg 1 and leg 2 of the fixture's team, so they resolve to it. `299` is
 * leg 2 of a team that does not exist — which is what makes it permanently a *leg 2 with no
 * handover*, because no test writes `199` and none ever should. `288` is the same shape and is
 * the reload test's, so the two offline tests cannot see each other's card after a restore.
 */
const BIB_LANDS = `1${CAPTURE_TEAM_NUMBER}`;
const BIB_NO_HANDOVER = '299';
const BIB_OFFLINE = `2${CAPTURE_TEAM_NUMBER}`;
const BIB_RELOAD = '288';

/** The keypad, pressed a digit at a time — which is the only way a bib is typed on this screen. */
const typeBib = async (page: Page, bib: string): Promise<void> => {
  for (const digit of bib) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
};

test.describe('who may open the capture screen', () => {
  /**
   * ⚠️ **The assertion ADR-036 exists for, and the only one that can tell a roster check from
   * a permission check made twice.** `timing-admin` carries `timing.crossing.record` — so an
   * admin refused this race is refused *by the roster*, which the fixture deliberately leaves
   * them off. The old application let a global admin bypass it entirely.
   */
  test('a timing-admin who is not on this roster is refused, permission and all', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const path = capturePath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The half a page test cannot reach.** Only the POST records a crossing, and an
    // address the screen is the sole client of is an address nobody notices is open.
    const posted = await page.request.post(`${path}/sync`, {
      data: {
        crossings: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            bib: '147',
            capturedAt: '2026-10-25T01:00:00.000Z',
            anomalyFlag: false,
            anomalyReason: null,
          },
        ],
      },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);

    expect((await page.request.get(`${path}/known`)).status()).toBe(404);
  });

  test('a signed-out visitor is refused all three', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this whole
    // file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();
    const path = capturePath(testInfo.project.name);

    expect((await page.goto(path))?.status()).toBe(404);
    expect((await page.request.get(`${path}/known`)).status()).toBe(404);
    expect(
      (
        await page.request.post(`${path}/sync`, {
          data: { crossings: [] },
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(404);
  });

  /**
   * ⚠️ **The positive case the two above would pass without.** Every address under `/timing`
   * 404s to somebody who may not open it, and so does an address that does not exist — so a
   * refusal test is worth nothing without this beside it.
   */
  test('a rostered marshal opens it', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    const shown = await page.goto(capturePath(testInfo.project.name));
    expect(shown?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Capture fixture ${testInfo.project.name}`,
    );
  });

  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    // ⚠️ **404, and it is the only one of the ten that is** — ADR-044. This address is
    // `rosterScoped`, so the door calls `timing.marshal_event()`, which answers `null` for a
    // race that does not exist as well as for one this marshal is not on: the refusal happens
    // at the door and the page never renders. The existence check is free here because the
    // roster check pays for it, which is exactly why it is not free anywhere else.
    await expectNotFoundPage(page, '/timing/marshal/zz-no-such-race', 404);
  });
});

test.describe('the capture screen with no JavaScript', () => {
  /**
   * ⚠️ **The sentence has to be useful, not merely honest.** A marshal whose phone will not run
   * the screen still has a race to time, and the recoverable outcome is a bib and a time on
   * paper. "This needs JavaScript" on its own is of no use to somebody standing on a course.
   *
   * It runs in every project, deliberately: with scripting on it is what the server renders
   * before the queue mounts, so it is also the thing somebody sees on a slow connection.
   */
  test('says what to do instead, rather than only that it cannot run', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    // The race's own facts are server-rendered and are true whatever happens to the bundle.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Capture fixture ${testInfo.project.name}`,
    );
    await expect(page.getByText(/Started at 25 October 2026 at 01:30 BST/)).toBeVisible();
  });
});

test.describe('recording a crossing', () => {
  /**
   * ⚠️ **The whole point of the queue model, asserted as the sequence a marshal actually
   * performs.** The button records the time; the bib is typed afterwards. At the line the
   * scarce resource is the moment, not the marshal's attention — a screen that asked for a
   * number first would put a text field between a person and an event that is already over.
   */
  test('records the time on the tap and takes the bib afterwards @requires-js', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    await page.getByRole('button', { name: 'Crossed now' }).click();

    // A card exists, with a time on it, before any bib has been typed.
    await expect(page.getByText('No bib yet')).toBeVisible();
    await expect(page.getByText(/Crossed at \d\d:\d\d:\d\d/)).toBeVisible();

    await typeBib(page, BIB_LANDS);
    await expect(page.getByText(`Bib ${BIB_LANDS}`)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm bib' }).click();

    // The queue empties once the crossing has landed, which is the screen's own statement that
    // the club has it.
    await expect(page.getByRole('heading', { name: 'Nothing waiting' })).toBeVisible({
      timeout: 15_000,
    });

    const landed = (await captureCrossings(testInfo.project.name)).find(
      (c) => c.bib === BIB_LANDS,
    );
    expect(landed).toBeDefined();
    expect(landed?.anomaly_flag).toBe(false);
    // The bib resolved to the fixture's team, which is what `1` + team number means on a relay.
    expect(landed?.team_id).not.toBeNull();
  });

  /**
   * ⚠️ **An anomaly flags and never blocks.** ADR-034 names it as a decision rather than an
   * implementation detail, and it is the one a rewrite is most likely to "improve" by accident.
   * The marshal is told what the club will make of the crossing *and Confirm is still the
   * button*.
   */
  test('flags a leg-2 crossing with no handover, and records it anyway @requires-js', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await typeBib(page, BIB_NO_HANDOVER);

    await expect(page.getByText(/no handover recorded for team 99/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm bib' })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm bib' }).click();

    await expect(page.getByRole('heading', { name: 'Nothing waiting' })).toBeVisible({
      timeout: 15_000,
    });

    const flagged = (await captureCrossings(testInfo.project.name)).find(
      (c) => c.bib === BIB_NO_HANDOVER,
    );
    expect(flagged).toBeDefined();
    expect(flagged?.anomaly_flag).toBe(true);
    // ⚠️ **Stored with no team, and never refused.** An unknown bib is the marshal's to argue
    // with afterwards; a validator at the line loses the moment.
    expect(flagged?.team_id).toBeNull();
  });

  /**
   * ⚠️ **The reason the whole queue exists, and the one test that would be worth writing if
   * only one could be.** A marshal at Ashton Court with no signal is having an ordinary
   * morning: the tap records, the card says so without reading as an error, and the crossing
   * reaches the club when the signal does.
   *
   * ⚠️ **The wait after the signal returns has to be longer than the drain's own period, and
   * that is deliberate rather than slack.** Coming back online fires an `online` event and the
   * screen drains on it — but an *emulated* network's event delivery is the harness's
   * behaviour, not the product's, and a test that depended on it would be asserting Playwright.
   * The thirty-second drain is the guarantee the club actually ships, so the window is wide
   * enough for it and the test passes on whichever path gets there first.
   */
  test('keeps a crossing through a signal gap and sends it afterwards @requires-js', async ({
    page,
    context,
  }, testInfo) => {
    // Longer than the 30s default, because the assertion below deliberately waits out a
    // thirty-second drain. See the header.
    test.setTimeout(120_000);

    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));
    // The screen has to have mounted before the network goes: it is a page, and a page needs
    // one to arrive.
    await expect(page.getByRole('button', { name: 'Crossed now' })).toBeVisible();

    await context.setOffline(true);

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await typeBib(page, BIB_OFFLINE);
    await page.getByRole('button', { name: 'Confirm bib' }).click();

    // ⚠️ Not an error, and it must not read as one. The card says what being offline looks
    // like and that the phone will keep trying.
    await expect(page.getByText(/usually no signal/)).toBeVisible({ timeout: 15_000 });
    expect(
      (await captureCrossings(testInfo.project.name)).some((c) => c.bib === BIB_OFFLINE),
    ).toBe(false);

    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Nothing waiting' })).toBeVisible({
      timeout: 45_000,
    });

    expect(
      (await captureCrossings(testInfo.project.name)).some((c) => c.bib === BIB_OFFLINE),
    ).toBe(true);
  });

  /**
   * The service worker's half — [#203](https://github.com/southville-running-club/src-website/issues/203)
   * says to rehearse the upgrade path rather than assume it, and this is the part of it a
   * browser can assert.
   *
   * ⚠️ **A marshal whose tab reloads with no signal gets the browser's offline error page
   * unless something serves it**, with two hours of a race left to run — their crossings safe
   * and unreachable, which is not meaningfully better than losing them. So this asserts both
   * halves at once: the page comes back at all, and the queue comes back with it out of
   * IndexedDB, keyed to the origin rather than to a session (which is what
   * [#244](https://github.com/southville-running-club/src-website/issues/244) depends on).
   *
   * ⚠️ **Skipped on WebKit, and the reason is the harness rather than the product — but that
   * is not the same as knowing it works.** Playwright's WebKit answers `page.reload: WebKit
   * encountered an internal error` while the context is offline; it is a GTK/WPE build rather
   * than Safari, and whether a real iPhone does the same thing is **not known from here**.
   * Every marshal at this race will be holding a phone, so that is not a question to leave to
   * a test runner: it belongs in #207's checklist as a rehearsal on a real device, and this
   * comment is the honest half of it rather than a green tick.
   */
  test('comes back after a reload with no signal, queue and all @requires-js', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      "Playwright's WebKit errors on any reload while the context is offline — see the header; #207 rehearses this on a real device",
    );

    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    /*
     * ⚠️ **Waiting for the screen to say it is cached, rather than for a length of time.** A
     * service worker registered on *this* load did not intercept the navigation that carried
     * it, so nothing is in its cache until the page asks — and the first version of this test
     * reloaded before that had happened and got `net::ERR_FAILED`. That was the *code* being
     * wrong rather than the test: a marshal's second visit is the one that happens on a course.
     *
     * The line is not test scaffolding — it is what the screen tells a marshal before they walk
     * away from signal, and waiting on it is waiting on the thing the marshal is waiting on.
     */
    await expect(page.locator('[data-capture-offline-ready="yes"]')).toBeVisible({
      timeout: 20_000,
    });

    await context.setOffline(true);

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await typeBib(page, BIB_RELOAD);
    await page.getByRole('button', { name: 'Confirm bib' }).click();
    await expect(page.getByText(/usually no signal/)).toBeVisible({ timeout: 15_000 });

    await page.reload();

    // The page itself came back — that is the service worker — and so did the card.
    await expect(page.getByRole('button', { name: 'Crossed now' })).toBeVisible({
      timeout: 20_000,
    });
    // ⚠️ **`exact` because the anomaly note names the bib too**, which is what the next
    // assertion is about — the first version of this matched both and failed strict mode.
    await expect(page.getByText(`Bib ${BIB_RELOAD}`, { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    /*
     * ⚠️ **The anomaly came back with it, which is the half that is easy to lose.** The verdict
     * is frozen at confirm time and never recomputed — on the client or in the database — so a
     * card restored from IndexedDB has to carry the words the marshal was actually looking at.
     * A screen that re-derived it here would answer against a race that has moved on, and would
     * do it silently.
     */
    await expect(page.getByText(/no handover recorded for team 88/)).toBeVisible();
  });

  /**
   * A tap with no bib is a press nobody can attribute to a runner — two thumbs on one button,
   * or a phone in a pocket. ⚠️ **Discard is offered on that and on nothing else**: a card that
   * has a bib is a real time for a real runner, and cancelling a crossing is an admin's act on
   * a different surface behind a different permission.
   */
  test('discards a stray tap, and offers no way to discard a real one @requires-js', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    // A total before and after, rather than an absolute count: this race is shared with every
    // other test in this block and Playwright is free to run them in any order.
    const before = (await captureCrossings(testInfo.project.name)).length;

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await expect(page.getByText('No bib yet')).toBeVisible();
    await page.getByRole('button', { name: 'Discard this tap' }).click();

    await expect(page.getByRole('heading', { name: 'Nothing waiting' })).toBeVisible();
    expect(await captureCrossings(testInfo.project.name)).toHaveLength(before);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(capturePath(testInfo.project.name));

    // With a card open, so the keypad is on the page — the half a bare screen would not cover.
    await page.getByRole('button', { name: 'Crossed now' }).click();
    await expect(page.getByText('No bib yet')).toBeVisible();

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px @requires-js', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(capturePath(testInfo.project.name));

    // The keypad is the widest thing on this screen and its last key carries a word rather than
    // a digit — which is exactly the track that would push a 320px page sideways.
    await page.getByRole('button', { name: 'Crossed now' }).click();
    await expect(page.getByText('No bib yet')).toBeVisible();

    await expectNoSidewaysScroll(page, 'the timing capture screen at 320px');
  });
});

/**
 * Resolving an anomaly, and correcting the timing log —
 * [#252](https://github.com/southville-running-club/src-website/issues/252).
 *
 * ⚠️ **Every test here re-seeds its captures**, because every one of them writes a resolution
 * and a resolution cannot be made twice: the second attempt answers `already_resolved`, which
 * is correct and would make each test depend on which sibling ran first. That is the order
 * dependency the capture screen's block shipped with and CI caught; `seedAnomalyEvent`'s header
 * carries the argument.
 *
 * The **concurrency** rules — two volunteers resolving one capture, and the log's value-based
 * compare-and-swap — are `packages/db/tests/timing.test.ts`'s, where two committed writes can
 * actually race. What is here is what only a browser can say: that the door holds on both
 * pages and both write addresses, and that the round trip a volunteer performs works.
 */
const anomaliesPath = (project: string): string =>
  `/timing/events/${anomalyEventSlug(project)}/anomalies`;

const crossingsPath = (project: string): string =>
  `/timing/events/${anomalyEventSlug(project)}/crossings`;

test.describe('who may resolve an anomaly', () => {
  /**
   * ⚠️ **`timing-marshal` holds `timing.crossing.record` and not `timing.crossing.resolve`.**
   * Recording a crossing and deciding what one means are two different powers, and a marshal
   * who could quietly discard their own flagged capture is the thing this separation prevents.
   */
  test('a timing-marshal is refused both pages and both addresses they post to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    for (const path of [
      anomaliesPath(testInfo.project.name),
      crossingsPath(testInfo.project.name),
    ]) {
      const shown = await page.goto(path);
      expect(shown?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

      // The half a page test cannot reach: only the POST changes a record of who finished.
      const posted = await page.request.post(`${path}/update`, {
        form: {
          intent: 'discarded',
          crossing_id: anomalyCrossingId(testInfo.project.name, 'flagged'),
        },
        maxRedirects: 0,
      });
      expect(posted.status(), `${path}/update`).toBe(404);
    }

    // Nothing moved.
    expect(
      await anomalyCrossing(anomalyCrossingId(testInfo.project.name, 'flagged')),
    ).toMatchObject({
      resolved_action: null,
    });
  });

  test('a signed-out visitor is refused all four', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this whole
    // file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();

    for (const path of [
      anomaliesPath(testInfo.project.name),
      crossingsPath(testInfo.project.name),
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
      expect(
        (
          await page.request.post(`${path}/update`, {
            form: {
              intent: 'discarded',
              crossing_id: anomalyCrossingId(testInfo.project.name, 'flagged'),
            },
            maxRedirects: 0,
          })
        ).status(),
        `${path}/update`,
      ).toBe(404);
    }
  });
});

test.describe('the triage list', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await seedAnomalyCrossings(testInfo.project.name);
  });

  /**
   * ⚠️ **Two populations, and the orphan is the one a flag-only query would hide.**
   * `record_crossing()` stores a bib matching no team and never refuses it, because a validator
   * at the line loses the moment — so nothing marks it, and a page showing only `anomaly_flag`
   * would look finished while a runner sat unmatched to anybody.
   */
  test('shows the flagged capture and the orphan nothing flagged', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anomalies');
    await expect(
      page.getByRole('heading', { name: '2 captures are waiting' }),
    ).toBeVisible();

    // The marshal's own words, rendered as they were stored — there is no kind to switch on.
    await expect(page.getByText(ANOMALY_REASON)).toBeVisible();
    await expect(
      page.getByText(
        /matches no team on this race, so the capture counts towards nobody/,
      ),
    ).toBeVisible();

    /*
     * The clean capture is not a question and is not here — asserted as the number of cards
     * rather than as the number of times a bib appears.
     *
     * ⚠️ **`getByText('Bib 311')` matched twice and the second match was the anomaly's own
     * reason.** Playwright's `getByText` with a plain string is a **case-insensitive substring**
     * match, so it found the `Bib 311` on the card *and* the "Duplicate bib 311 — already
     * captured at 11:20:00" the marshal's screen wrote. Here that failed loudly; the direction
     * to worry about is the other one, where a substring assertion passes on markup that does
     * not say what the test thinks it says.
     */
    await expect(page.locator('.triage-card')).toHaveCount(2);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${anomalyEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Captures waiting to be resolved' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anomalies');
  });

  test('marks a capture valid, and it leaves the queue', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    // The flagged capture is the first card — `open_anomalies` is oldest first.
    await page.getByRole('button', { name: 'Mark valid' }).first().click();

    await expect(page.getByText(/Marked as valid/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '1 capture is waiting' }),
    ).toBeVisible();
    expect(
      await anomalyCrossing(anomalyCrossingId(testInfo.project.name, 'flagged')),
    ).toMatchObject({
      resolved_action: 'marked_valid',
    });
  });

  /**
   * The orphan's whole point: correcting the bib is what attaches the capture to a runner. The
   * trigger re-derives the team — nothing here resolves one by hand.
   */
  test('corrects an orphan’s bib and attaches it to a team', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    const orphanCard = page.locator('.triage-card', { hasText: ANOMALY_ORPHAN_BIB });
    await orphanCard.getByLabel('Corrected bib').fill(ANOMALY_TEAM_NUMBER);
    await orphanCard.getByRole('button', { name: 'Save corrected bib' }).click();

    await expect(page.getByText(/The bib has been corrected/)).toBeVisible();

    const after = await anomalyCrossing(
      anomalyCrossingId(testInfo.project.name, 'orphan'),
    );
    expect(after).toMatchObject({ bib: ANOMALY_TEAM_NUMBER, resolved_action: 'edited' });
    expect(after?.team_id).not.toBeNull();
  });

  /**
   * ⚠️ **Resolved and incomplete at once, and the page has to say both.** The admin has
   * recorded what they believe the bib was, and `record_crossing()` keeps an unknown bib
   * deliberately — but a screen that reported plain success would look like it had finished the
   * job, when what has to change next is the entry list.
   */
  test('says so when a corrected bib still matches no team', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    const orphanCard = page.locator('.triage-card', { hasText: ANOMALY_ORPHAN_BIB });
    await orphanCard.getByLabel('Corrected bib').fill('888');
    await orphanCard.getByRole('button', { name: 'Save corrected bib' }).click();

    await expect(page.getByText(/still matches no team on this race/)).toBeVisible();
    await expect(page.getByText(/check the entry list/)).toBeVisible();
  });

  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/anomalies', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(anomaliesPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing anomalies page at 320px');
  });
});

test.describe('the timing log', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await seedAnomalyCrossings(testInfo.project.name);
  });

  /**
   * ⚠️ **A log that hid what had been taken out would be a log nobody could audit from** — and
   * restoring a discard is only possible if somebody can see it. So this shows resolved and
   * discarded rows, which is exactly what the triage list does not.
   */
  test('discards a capture and restores it again', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(anomaliesPath(testInfo.project.name));

    await page.getByRole('button', { name: 'Discard' }).first().click();
    await expect(page.getByText(/Discarded\./)).toBeVisible();
    expect(
      await anomalyCrossing(anomalyCrossingId(testInfo.project.name, 'flagged')),
    ).toMatchObject({
      resolved_action: 'discarded',
    });

    await page.goto(crossingsPath(testInfo.project.name));
    const discarded = page.locator('.triage-card', {
      hasText: 'Discarded — counts towards nothing',
    });
    await expect(discarded).toHaveCount(1);

    await discarded.getByRole('button', { name: 'Restore this capture' }).click();
    await expect(page.getByText(/Restored\./)).toBeVisible();

    // Both columns cleared together, which is what the coherence check demands.
    expect(
      await anomalyCrossing(anomalyCrossingId(testInfo.project.name, 'flagged')),
    ).toMatchObject({
      resolved_action: null,
    });
  });

  test('corrects a bib that was never flagged at all', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(crossingsPath(testInfo.project.name));

    // ⚠️ This row's `resolved_at` is null and always will be, which is why the log takes a
    // different compare-and-swap from the triage list. The database tests hold that; this holds
    // that a volunteer can actually do it.
    const clean = page.locator('.triage-card', { hasText: 'Recorded' }).first();
    await clean.getByLabel('Bib').fill(ANOMALY_SECOND_TEAM_NUMBER);
    await clean.getByRole('button', { name: 'Save this bib' }).click();

    // ⚠️ **Corrected onto the race's *other* team on purpose.** The first version typed a bib
    // no team carried, so the page correctly answered "still matches no team" and the test
    // asserted plain success — the assertion was wrong rather than the page.
    await expect(page.getByText('Saved.')).toBeVisible();
  });

  test('searches by bib, and the searched view is a URL somebody can send', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(crossingsPath(testInfo.project.name));

    await page.getByLabel('Search by bib or team number').fill(ANOMALY_ORPHAN_BIB);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(new RegExp(`q=${ANOMALY_ORPHAN_BIB}`));
    await expect(page.locator('.triage-card')).toHaveCount(1);
    await expect(page.getByText(`Bib ${ANOMALY_ORPHAN_BIB}`)).toBeVisible();
  });

  test('says so when nothing carries the bib somebody searched for', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`${crossingsPath(testInfo.project.name)}?q=4242`);

    // A claim about this race's record, not "no results" — the page says which bib it looked for.
    await expect(page.getByText(/No capture on this race carries the bib/)).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(crossingsPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(crossingsPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing log at 320px');
  });
});

/**
 * Race status, and finishing — [#253](https://github.com/southville-running-club/src-website/issues/253).
 *
 * ⚠️ **Every test resets the race**, because finishing is a property of the race rather than of
 * a row: one test calling it would change what every sibling sees. `seedStatusEvent`'s header
 * carries the argument.
 *
 * The audit rules live in `packages/db/tests/timing.test.ts`, where a committed write can be
 * read back. What is here is the door, and the round trip a volunteer performs.
 */
const statusPath = (project: string): string =>
  `/timing/events/${statusEventSlug(project)}/status`;

const finishPath = (project: string): string =>
  `/timing/events/${statusEventSlug(project)}/finish`;

test.describe('who may mark a runner or finish a race', () => {
  /**
   * ⚠️ **A `timing-marshal` records crossings and decides nothing about them.** Disqualifying a
   * runner and declaring a race over are `timing.event.manage`, and the separation is the point.
   */
  test('a timing-marshal is refused both pages and both addresses they post to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    for (const path of [
      statusPath(testInfo.project.name),
      finishPath(testInfo.project.name),
    ]) {
      const shown = await page.goto(path);
      expect(shown?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

      const posted = await page.request.post(`${path}/update`, {
        form: {
          intent: 'finish',
          status: 'dq',
          team_id: '00000000-0000-4000-8000-000000000001',
        },
        maxRedirects: 0,
      });
      expect(posted.status(), `${path}/update`).toBe(404);
    }

    const state = await statusRaceState(testInfo.project.name);
    expect(state.finished).toBe(false);
    expect(state.statuses[STATUS_TEAMS[0].number]).toBeNull();
  });

  test('a signed-out visitor is refused all four', async ({ page }, testInfo) => {
    await page.context().clearCookies();

    for (const path of [
      statusPath(testInfo.project.name),
      finishPath(testInfo.project.name),
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
      expect(
        (
          await page.request.post(`${path}/update`, {
            form: { intent: 'finish' },
            maxRedirects: 0,
          })
        ).status(),
        `${path}/update`,
      ).toBe(404);
    }
  });
});

test.describe('marking a runner', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await resetStatusRace(testInfo.project.name);
  });

  test('records a DNF and then lifts it', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(statusPath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race status');

    const card = page.locator('.triage-card', { hasText: STATUS_TEAMS[0].lastname });
    await card.getByRole('button', { name: 'Did not finish' }).click();

    // ⚠️ The wording says what happens to the result, not merely that it was recorded — and it
    // says the captured facts survive, which is the half people are surprised by.
    await expect(page.getByText(/Recorded as did not finish/)).toBeVisible();
    await expect(page.getByText(/stays captured/)).toBeVisible();

    expect(
      (await statusRaceState(testInfo.project.name)).statuses[STATUS_TEAMS[0].number],
    ).toBe('dnf');

    const marked = page.locator('.triage-card', { hasText: STATUS_TEAMS[0].lastname });
    await marked.getByRole('button', { name: /^Lift did not finish/ }).click();

    await expect(page.getByText(/That has been lifted/)).toBeVisible();
    expect(
      (await statusRaceState(testInfo.project.name)).statuses[STATUS_TEAMS[0].number],
    ).toBeNull();
  });

  /**
   * ⚠️ **Offered only when there is something to lift.** A "clear" beside an unmarked runner is
   * a button that does nothing, on a page where every other button changes a result.
   */
  test('offers no way to lift a status nobody has', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(statusPath(testInfo.project.name));

    await expect(page.getByRole('button', { name: /^Lift / })).toHaveCount(0);
  });

  test('leaves everybody else alone', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(statusPath(testInfo.project.name));

    await page
      .locator('.triage-card', { hasText: STATUS_TEAMS[0].lastname })
      .getByRole('button', { name: 'Disqualify' })
      .click();
    await expect(page.getByText(/Recorded as disqualified/)).toBeVisible();

    const state = await statusRaceState(testInfo.project.name);
    expect(state.statuses[STATUS_TEAMS[0].number]).toBe('dq');
    expect(state.statuses[STATUS_TEAMS[1].number]).toBeNull();
  });

  test('searches by name, and the searched view is a URL somebody can send', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(statusPath(testInfo.project.name));

    await page
      .getByLabel('Search by bib, team number or name')
      .fill(STATUS_TEAMS[1].lastname);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(new RegExp(`q=${STATUS_TEAMS[1].lastname}`));
    await expect(page.locator('.triage-card')).toHaveCount(1);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${statusEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Mark somebody DNS, DNF or DQ' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race status');
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(statusPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(statusPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing race-status page at 320px');
  });
});

test.describe('finishing a race', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await resetStatusRace(testInfo.project.name);
  });

  /**
   * ⚠️ **The sentence that stops somebody putting their phone away.** A volunteer who reads
   * "finished" as "closed" stops capturing, and the last runner's crossing arrives after the
   * race director has called it. It is asserted on the page *and* in the outcome.
   */
  test('finishes, and says in the same breath that crossings still work', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(finishPath(testInfo.project.name));

    await expect(page.getByText(/label, not a cut-off/)).toBeVisible();
    await page.getByRole('button', { name: 'Finish this race' }).click();

    await expect(page.getByText(/This race is finished/).first()).toBeVisible();
    await expect(page.getByText(/Crossings can still be recorded/).first()).toBeVisible();
    expect((await statusRaceState(testInfo.project.name)).finished).toBe(true);
  });

  test('takes it back again', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(finishPath(testInfo.project.name));

    await page.getByRole('button', { name: 'Finish this race' }).click();
    await page
      .getByRole('button', { name: 'This race is not finished after all' })
      .click();

    await expect(page.getByText(/no longer marked finished/)).toBeVisible();
    expect((await statusRaceState(testInfo.project.name)).finished).toBe(false);
  });

  test('offers one button at a time, never both', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(finishPath(testInfo.project.name));

    // Same rule as the start screen: there is never a page with two buttons on it, which is what
    // keeps a cold thumb from finding the wrong one.
    await expect(page.getByRole('button', { name: 'Finish this race' })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'This race is not finished after all' }),
    ).toHaveCount(0);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${statusEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Finish this race' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finish');
  });

  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/finish', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(finishPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(finishPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing finish page at 320px');
  });
});

/**
 * Wiping a rehearsal — [#254](https://github.com/southville-running-club/src-website/issues/254).
 *
 * ⚠️ **Every test here removes every row on its race**, so the fixture is rebuilt in a
 * `beforeEach` rather than shared. A test asserting against rows a sibling already wiped would
 * pass for the wrong reason: an empty table is also what a *broken* reset produces.
 */
const dangerZonePath = (project: string): string =>
  `/timing/events/${resetEventSlug(project)}/danger-zone`;

test.describe('who may wipe a race', () => {
  /**
   * ⚠️ **The refusal that matters most on this platform.** A POST to this address removes every
   * crossing and every entry on a race, and a `timing-marshal` holds `timing.crossing.record`
   * and nothing else. The door refuses before the function is ever asked.
   */
  test('a timing-marshal is refused the page and the address it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    const path = dangerZonePath(testInfo.project.name);
    const shown = await page.goto(path);
    expect(shown?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **Posting the correct phrase**, so the refusal is the door's rather than the
    // confirmation's. A wrong phrase here would have been refused either way, and the test would
    // then prove nothing about the permission.
    const posted = await page.request.post(`${path}/update`, {
      form: { confirmation: resetEventSlug(testInfo.project.name) },
      maxRedirects: 0,
    });
    expect(posted.status(), `${path}/update`).toBe(404);

    const state = await resetRaceState(testInfo.project.name);
    expect(state.crossings, 'nothing was wiped').toBe(3);
    expect(state.teams).toBe(2);
  });

  test('a signed-out visitor is refused both', async ({ page }, testInfo) => {
    await page.context().clearCookies();

    const path = dangerZonePath(testInfo.project.name);
    expect((await page.goto(path))?.status(), path).toBe(404);
    expect(
      (
        await page.request.post(`${path}/update`, {
          form: { confirmation: resetEventSlug(testInfo.project.name) },
          maxRedirects: 0,
        })
      ).status(),
      `${path}/update`,
    ).toBe(404);

    expect((await resetRaceState(testInfo.project.name)).crossings).toBe(3);
  });
});

test.describe('the danger zone', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await seedResetEvent(testInfo.project.name, TIMING_MARSHAL_EMAIL);
  });

  /**
   * ⚠️ **The blast radius is read from the database rather than described in prose**, which is
   * the whole argument for asking somebody to type a phrase: a confirmation is worth something
   * only if what is being confirmed is on the screen and checkable.
   */
  test('shows what would go and what would stay', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(dangerZonePath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Danger zone');

    const removed = page.locator('dl').first();
    await expect(removed.getByText('Crossings recorded')).toBeVisible();
    await expect(removed.locator('dd').nth(2)).toHaveText('3');

    // What survives is on the page beside what does not, because "danger zone" reads as
    // "delete the race" and the next thing this volunteer does is look for it.
    await expect(page.getByRole('heading', { name: 'What would be kept' })).toBeVisible();
    await expect(page.getByText('Marshals rostered')).toBeVisible();
  });

  /**
   * ⚠️ **The typing is the modal**, and it is checked in the database as well as here — so this
   * asserts the sentence a volunteer reads, not the mechanism. `packages/db/tests/timing.test.ts`
   * re-attempts the same phrase straight at the function.
   */
  test('refuses a phrase that is not the race’s slug, and removes nothing', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(dangerZonePath(testInfo.project.name));

    await page.getByLabel(/^Type /).fill('nn-2026');
    await page.getByRole('button', { name: 'Wipe this race' }).click();

    await expect(page.getByText(/you have to type its slug/)).toBeVisible();

    const state = await resetRaceState(testInfo.project.name);
    expect(state.crossings).toBe(3);
    expect(state.teams).toBe(2);
  });

  /**
   * ⚠️ **The whole of what #207 needs, in one test.** Crossings and entries gone, the race no
   * longer marked started or finished — the old function left it finished — and the roster still
   * there, because re-rostering every marshal between two runs of a rehearsal is the cost this
   * exists to avoid.
   */
  test('wipes the field, clears the start and the finish, and keeps the roster', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(dangerZonePath(testInfo.project.name));

    await page.getByLabel(/^Type /).fill(resetEventSlug(testInfo.project.name));
    await page.getByRole('button', { name: 'Wipe this race' }).click();

    await expect(page.getByText(/This race has been wiped/)).toBeVisible();

    const state = await resetRaceState(testInfo.project.name);
    expect(state.crossings).toBe(0);
    expect(state.teams).toBe(0);
    expect(state.runners).toBe(0);
    expect(state.started, 'the actual start is cleared').toBe(false);
    expect(state.finished, 'and so is the finish — the old function left this set').toBe(
      false,
    );
    expect(state.marshals, 'the roster is not part of the blast radius').toBe(1);
    expect(state.auditRows, 'and the reset is recorded').toBe(1);
  });

  /** Zeros and an audit row: the intent is the auditable fact, empty race or not. */
  test('can be done twice, and records both', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = resetEventSlug(testInfo.project.name);

    for (const pass of [1, 2]) {
      await page.goto(dangerZonePath(testInfo.project.name));
      await page.getByLabel(/^Type /).fill(slug);
      await page.getByRole('button', { name: 'Wipe this race' }).click();
      await expect(
        page.getByText(/This race has been wiped/),
        `pass ${pass}`,
      ).toBeVisible();
    }

    const state = await resetRaceState(testInfo.project.name);
    expect(state.crossings).toBe(0);
    expect(state.auditRows).toBe(2);
  });

  /**
   * ⚠️ **No confirm dialog on top of the typed phrase**, deliberately — the typing *is* the
   * modal. A `window.confirm` is a reflex and, worse here, is a scripted control: every
   * Playwright project in this suite runs with JavaScript off in at least one of them, and a
   * volunteer there would be handed a button with no guard at all in front of it.
   */
  test('asks for the phrase and nothing else on top of it', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });

    await page.goto(dangerZonePath(testInfo.project.name));
    await page.getByLabel(/^Type /).fill(resetEventSlug(testInfo.project.name));
    await page.getByRole('button', { name: 'Wipe this race' }).click();

    await expect(page.getByText(/This race has been wiped/)).toBeVisible();
    expect(dialogs, 'the typing is the modal').toBe(0);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${resetEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Wipe this race and start again' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Danger zone');
  });

  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/danger-zone', 200);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(dangerZonePath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(dangerZonePath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing danger-zone page at 320px');
  });
});

/**
 * The results preview, and the act of publishing —
 * [#205](https://github.com/southville-running-club/src-website/issues/205), calling
 * [#241](https://github.com/southville-running-club/src-website/issues/241)'s two functions.
 *
 * ⚠️ **This is the one press on this platform whose effect leaves the club**, so the assertions
 * that matter most are about what a volunteer is *told* rather than about what a button does:
 * publishing has to say "public" and unpublishing has to say the page has gone. The wording is
 * unit-tested in `apps/timing/tests/unit/results-outcomes.test.ts`; what is here is that the
 * right one arrives after the right press, and that the database agrees.
 *
 * ⚠️ **Both exports are asserted on the response and never on a download event.** The three
 * engines disagree about what an attachment is and WebKit on a Linux runner renders a CSV in
 * the tab, firing no download at all — `CLAUDE.md` carries the trap, and
 * `nn-admin.spec.ts`'s two export tests are the shape copied here: the status, the content type
 * and the filename, with `page.request` for the bytes.
 */
test.describe('the results preview', () => {
  const previewPath = (project: string): string =>
    `/timing/events/${previewEventSlug(project)}/results`;

  /*
   * ⚠️ `{}` is required by Playwright and rejected by ESLint — see this file's note above
   * `test.beforeAll`: Playwright reads the source of a hook to work out its fixtures and
   * refuses a first argument that is not a destructuring pattern. `testInfo` is what this is
   * after, because the fixture race is per project.
   */
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await resetPreviewRace(testInfo.project.name);
  });

  test('is refused to a marshal, like every other admin address', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const response = await page.goto(previewPath(testInfo.project.name));

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  });

  test('shows the field, the category and who is still out', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(previewPath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results');
    await expect(page.getByText('Finished, not published')).toBeVisible();

    const table = page.getByRole('table');
    await expect(table.getByText('Grace Hopper')).toBeVisible();
    // ⚠️ The band comes from `effectiveCategory()` and `ageCategoryFor()` — never from a
    // stored column, and never from a third branch.
    await expect(table.getByText("Men's Vet 50")).toBeVisible();
    // ⚠️ A guide is on the start line and in no category — ADR-022. The preview says so rather
    // than leaving a blank cell somebody would go looking behind.
    await expect(table.getByText('Guide')).toBeVisible();
    // The runner marked DNF keeps their row and loses their time.
    await expect(table.getByText('Did not finish')).toBeVisible();
  });

  test('publishes, says it is public, and records it', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(previewPath(testInfo.project.name));

    await page.getByRole('button', { name: 'Publish these results' }).click();

    // ⚠️ **"Anybody can read them"**, in as many words: a volunteer who read this as an
    // internal confirmation has just put a table of names on the open internet.
    //
    // The page says it **twice** and deliberately — the outcome of the press, and the state
    // the race is now in — so each is asserted by its own half of the sentence. Matching the
    // shared phrase alone is a strict-mode violation rather than a stronger assertion.
    await expect(
      page.getByText(/Anybody can read them now, signed in or not/),
    ).toBeVisible();
    await expect(page.getByText(/Anybody can read them at the race/)).toBeVisible();
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

    const state = await previewRaceState(testInfo.project.name);
    expect(state.published).toBe(true);
    expect(state.auditActions).toContain('results_published');
  });

  test('takes them down again and says the page has gone', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(previewPath(testInfo.project.name));

    await page.getByRole('button', { name: 'Publish these results' }).click();
    await page.getByRole('button', { name: 'Unpublish these results' }).click();

    await expect(page.getByText(/gone back to not found/)).toBeVisible();

    const state = await previewRaceState(testInfo.project.name);
    expect(state.published).toBe(false);
    // ⚠️ Audited as loudly as the publishing was — the old application recorded the act and not
    // its reversal, which is backwards for anybody asking why a result they saw is gone.
    expect(state.auditActions).toContain('results_unpublished');
  });

  /**
   * ⚠️ **The count is shown before the press, which is the half that did not exist.** Until this
   * page the only way to find out publication was blocked was to press the button.
   */
  test('refuses while a capture is unresolved, and says so before the press', async ({
    page,
  }, testInfo) => {
    await addPreviewOrphan(testInfo.project.name);

    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(previewPath(testInfo.project.name));

    await expect(page.getByText(/1 capture still to be resolved/)).toBeVisible();

    await page.getByRole('button', { name: 'Publish these results' }).click();
    await expect(page.getByText(/were not published/)).toBeVisible();

    expect((await previewRaceState(testInfo.project.name)).published).toBe(false);
  });

  test('hands back a results CSV as an attachment', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = previewEventSlug(testInfo.project.name);

    // ⚠️ **`page.request`, not a download event.** It shares the context's cookies and hands
    // back a readable body on every engine, which `waitForEvent('download')` does not.
    const response = await page.request.post(`/timing/events/${slug}/results/export`, {
      form: { format: 'csv' },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="${slug}-results.csv"`,
    );

    // ⚠️ **The mark is asserted on the bytes.** `response.text()` decodes with `TextDecoder`,
    // which strips a leading U+FEFF and would report a mark that is present as absent.
    const bytes = new Uint8Array(await response.body());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csv).toContain('Grace Hopper');

    // ⚠️ **The fourth preview team is marked DNF, so the file carries them** — terminal
    // statuses are exported with no position, which is the rule right beside "pending teams
    // absent" and the opposite half of it. This assertion read `not.toContain` and contradicted
    // the fixture it was written against; the fixture is what the preview-table test above
    // needs, so the expectation is what was wrong.
    //
    // **Pending-absent is guarded where it can be stated exactly** — `timing-result-export`'s
    // "ranks finishers and leaves a team still on the course out entirely", which builds a
    // runner with no crossing at all. There is no such team in this fixture to assert it on.
    expect(csv).toContain(PREVIEW_TEAMS[3].lastname);
  });

  test('hands back a workbook whose cells are text', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = previewEventSlug(testInfo.project.name);

    const response = await page.request.post(`/timing/events/${slug}/results/export`, {
      form: { format: 'xlsx' },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="${slug}-results.xlsx"`,
    );

    // A ZIP, which is what an `.xlsx` is. `PK\x03\x04`.
    const bytes = new Uint8Array(await response.body());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  test('hands back the prize list the presenter is showing', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = previewEventSlug(testInfo.project.name);

    const response = await page.request.post(`/timing/events/${slug}/prizes/export`, {
      form: { format: 'csv' },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="${slug}-prizes.csv"`,
    );

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      new Uint8Array(await response.body()),
    );
    expect(csv).toContain('1st Place Overall');
    expect(csv).toContain('Grace Hopper');
  });

  test('refuses a format nobody wrote down rather than picking one', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = previewEventSlug(testInfo.project.name);

    const response = await page.request.post(`/timing/events/${slug}/results/export`, {
      form: { format: 'pdf' },
      maxRedirects: 0,
    });

    // Back to the page with an outcome, rather than a file of the wrong kind.
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toContain('outcome=incomplete');
  });

  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/results', 200);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${previewEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Results for this race' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results');
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(previewPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(previewPath(testInfo.project.name));

    // ⚠️ Through the shared helper, which waits for a defined state rather than for the
    // assertion to come good — `apps/main/tests/sideways-scroll.ts` carries the whole trap.
    await expectNoSidewaysScroll(page, 'the timing results preview at 320px');
  });
});

/**
 * The prize presenter — #205.
 *
 * ⚠️ **The property under test is that a choice survives a reload**, which is the defect #205
 * names: the old application held "pass to next" in component state and a refresh lost it
 * mid-ceremony. Here it is in the address, so following a link and coming back is the test.
 */
test.describe('the prize presenter', () => {
  const prizePath = (project: string): string =>
    `/timing/events/${previewEventSlug(project)}/prizes`;

  /*
   * ⚠️ `{}` is required by Playwright and rejected by ESLint — see this file's note above
   * `test.beforeAll`: Playwright reads the source of a hook to work out its fixtures and
   * refuses a first argument that is not a destructuring pattern. `testInfo` is what this is
   * after, because the fixture race is per project.
   */
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await resetPreviewRace(testInfo.project.name);
  });

  test('is refused to a marshal', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const response = await page.goto(prizePath(testInfo.project.name));

    expect(response?.status()).toBe(404);
  });

  test('reads the prizes out in order, with the winner under each', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(prizePath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prize giving');
    await expect(page.getByText('1st Place Overall')).toBeVisible();
    await expect(page.getByText('Grace Hopper').first()).toBeVisible();
  });

  /**
   * ⚠️ **Passing a team takes them out of *every* prize**, which is what somebody means by it —
   * an exclusion that only skipped one line would leave the same people winning everything
   * else. And the choice is in the URL, so it survives the navigation.
   */
  test('keeps a passed-over team excluded across a reload', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(prizePath(testInfo.project.name));

    await page.getByRole('link', { name: 'Not here — pass to the next' }).first().click();

    await expect(page.getByText(/passed over/)).toBeVisible();
    const url = page.url();

    await page.reload();
    await expect(page.getByText(/passed over/)).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(prizePath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(prizePath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing prize presenter at 320px');
  });
});

/**
 * The live leaderboard — [#204](https://github.com/southville-running-club/src-website/issues/204),
 * on Durable Objects per
 * [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * and staff-only per
 * [ADR-038](../../../../docs/architecture/decisions/adr-038-the-leaderboard-is-staff-only-in-2026.md).
 *
 * ⚠️ **Nothing here asserts that the board updates itself, and that is deliberate rather than a
 * gap being hidden.** Three reasons, in descending order of how much they matter:
 *
 *   1. **The transport is the slice ADR-034 cuts if the race simulation fails**, so the suite must
 *      not be written in a way that goes red when it is cut. What is asserted is the board — the
 *      derivation, the permission and the rendering — every bit of which survives the cut.
 *   2. **The derivation is already proved where it can be proved properly**, in
 *      `packages/shared/tests/unit/timing-leaderboard.test.ts` with no browser at all. Re-asserting
 *      a split through a browser would be slower and weaker.
 *   3. ⚠️ **A WebSocket upgrade may not cross `apps/main`'s local stand-in for Cloudflare's edge
 *      router**, which is what these tests reach on :8787. In production `/timing/*` is dispatched
 *      at the edge and that branch does not run — so a socket assertion here could fail on a
 *      laptop for a reason that cannot exist in production, which is the worst kind of test this
 *      repository has. `worker/index.ts` carries the note, and the page never claims to have
 *      "stopped updating" on a socket that never connected.
 *
 * **What the socket costs if it is never delivered is therefore nothing a runner or a volunteer
 * loses**: the board is server-rendered, so the `no-javascript` project reads a correct table, and
 * that is exactly what a JavaScript-enabled browser reads before the first nudge arrives.
 */
test.describe('the live leaderboard', () => {
  const boardPath = (project: string): string =>
    `/timing/events/${previewEventSlug(project)}/leaderboard`;

  /*
   * ⚠️ `{}` is required by Playwright and rejected by ESLint — see this file's note above
   * `test.beforeAll`. `testInfo` is what this is after, because the fixture race is per project.
   */
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await resetPreviewRace(testInfo.project.name);
  });

  test('is refused to a marshal, and so is the snapshot it re-reads', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = boardPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The address the board calls is gated by the same table the page is**, so a marshal who
    // guessed it is refused there too. Asserted on the response rather than through the page,
    // because nothing in the browser will call it for somebody who cannot open the page.
    const snapshot = await page.request.get(`${path}/snapshot`);
    expect(snapshot.status()).toBe(404);
  });

  test('is refused to a signed-out visitor, page and snapshot alike', async ({
    page,
  }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this whole
    // file signs in from, which is a `beforeAll` concern. The siblings above use the same call.
    await page.context().clearCookies();
    const path = boardPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);

    const snapshot = await page.request.get(`${path}/snapshot`);
    expect(snapshot.status()).toBe(404);
  });

  test('shows the field in time order, with the leader first', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(boardPath(testInfo.project.name));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leaderboard');

    // The fixture's three captures are forty, forty-five and forty-six minutes after a recorded
    // start, so the order is 701, 702, 703 — and 704, who is marked DNF, sorts behind all of them
    // whatever the column says. `previewEventSlug`'s header describes the field.
    const rows = page.locator('table.results-table tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('701');
    await expect(rows.nth(0)).toContainText('40:00');
    await expect(rows.nth(3)).toContainText('Did not finish');
  });

  /**
   * #204's *"display of a single-crossing finish"*. The fixture is a **solo** race, so there is no
   * handover to split at — and two permanently empty columns beside every time would send a
   * volunteer looking for captures that were never going to exist.
   */
  test('gives a solo race one time column rather than three', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(boardPath(testInfo.project.name));

    const headers = page.locator('table.results-table thead th');
    await expect(headers.filter({ hasText: 'Total' })).toHaveCount(1);
    await expect(headers.filter({ hasText: 'Leg 1' })).toHaveCount(0);
    await expect(headers.filter({ hasText: 'Leg 2' })).toHaveCount(0);
  });

  /**
   * ⚠️ **ADR-022: a guide is in no category and no prize**, and on a solo race they share a team
   * with the runner they guide — so a board that did not say which was which would print a guide
   * as though they had a result of their own. This is a fact the staff board may show and the
   * published page may not (ADR-043).
   */
  test('says which runner on a row is a guide', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(boardPath(testInfo.project.name));

    await expect(page.locator('table.results-table tbody')).toContainText('(guide)');
  });

  /**
   * ⚠️ **The board is a correct table with scripting off**, which is this surface's whole
   * no-JavaScript answer and is deliberately unlike the capture screen's — that one degrades to a
   * *sentence* telling a marshal to use paper, because an offline IndexedDB queue has nothing to
   * degrade to. A board that does not move is still a board.
   *
   * Untagged, so it runs in the `no-javascript` project as well as the others: the same assertion
   * is what proves the server rendered it and what proves a browser has something to hydrate.
   */
  test('renders the whole board server-side', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(boardPath(testInfo.project.name));

    await expect(page.locator('table.results-table tbody tr')).toHaveCount(4);
    await expect(page.locator('table.results-table caption')).toContainText('4 entries');
  });

  /**
   * The ordering is a query parameter for `/admin/nn/`'s reason — it works with scripting off, and
   * a board sorted a particular way is a URL somebody can send to the other volunteer.
   *
   * ⚠️ **The position column stays the overall standing.** Sorted by number the rows come out in a
   * different order, and numbering them down the page would tell a volunteer the wrong person is
   * winning.
   */
  test('sorts by a query parameter and keeps the overall positions', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`${boardPath(testInfo.project.name)}?sort=teamNumber`);

    const rows = page.locator('table.results-table tbody tr');
    await expect(rows.nth(0)).toContainText('701');
    // 701 is both first by number and the fastest, so the assertion that matters is the row that
    // would move: 704 is DNF and sorts last under every key.
    await expect(rows.nth(3)).toContainText('Did not finish');
  });

  /**
   * ⚠️ **This is the test that found the inconsistency #291 is about.** It was written asserting
   * the **404** a refusal gives and failed on all three engines, because the leaderboard is a
   * page like the other nine rather than an exception to them: a race that does not exist gets
   * past the door and the page renders, and a render is a 200. See `expectNotFoundPage` at the
   * head of this file for both answers and why they differ — ADR-044 is what settled that the
   * 200 stays.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    await expectNotFoundPage(page, '/timing/events/zz-no-such-race/leaderboard', 200);
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(`/timing/events/${previewEventSlug(testInfo.project.name)}`);

    await page.getByRole('link', { name: 'Live leaderboard' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leaderboard');
  });

  /**
   * ⚠️ **`scrollable-region-focusable` is why the table carries `tabIndex`, `role="region"` and a
   * caption as its accessible name**, and it is only ever seen on mobile-safari — the table does
   * not overflow at desktop width, and a region that does not scroll is not a scrollable region.
   * Three pages here had already met it; this is the fourth.
   */
  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(boardPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(boardPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing leaderboard at 320px');
  });
});
