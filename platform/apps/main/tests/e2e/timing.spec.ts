import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { clearTimingFixtures, seedTimingFixtures } from '../timing-db';
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

test.beforeAll(async () => {
  await seedTimingStaff();
  await seedTimingFixtures();
  // The people were just re-created, so any jar cached by another spec names somebody who no
  // longer exists. See `forgetSessions`.
  forgetSessions();
});

test.afterAll(async () => {
  await clearTimingFixtures();
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
    await page.goto('/timing/events/zz-no-such-race/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    await expect(page.getByText('There is nothing at this address.')).toBeVisible();
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
