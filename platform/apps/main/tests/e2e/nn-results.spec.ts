import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectNoSidewaysScroll, waitForStyledLayout } from '../sideways-scroll';
import { seedTimingFixtures } from '../timing-db';
import {
  FINISHED_EVENT_NAME,
  FINISHED_PATH,
  LEAKED_CLUB,
  LEAKED_EMAIL_DOMAIN,
  PUBLISHED_EVENT_NAME,
  PUBLISHED_PATH,
  PUBLISHED_TEAMS,
  RESULTS_EVENT_NAME,
  RESULTS_PATH,
} from '../timing-fixtures';

/**
 * `/nn/<year>/results/` in a real browser, to somebody who is signed in to nothing — which is
 * what the internet is.
 *
 * ⚠️ **The negative test is the one that carries the club's rule**, and it is first for that
 * reason: *results are not open to the public until the race has finished, and finishing does
 * not publish them*. A race that has been captured, called finished and never published is the
 * ordinary not-found page here, exactly as it was the day before it was run.
 *
 * The positive half is the first page on this site a stranger may read that the club did not
 * write: a table of names and times, published by an explicit act — #241, #242 and
 * [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
 *
 * ## What this covers that the Worker run cannot
 *
 * `tests/worker/admin/nn-results.test.ts` asserts the markup, the categories, the cache headers
 * and the refusals, in `workerd`, against accounts it creates. This file is here for the three
 * things that need a browser: **axe over the published page**, **the layout at 320px**, and
 * **what is actually in the document** once the stylesheets and fonts have arrived.
 *
 * ## The fixtures
 *
 * `timing-db.ts`'s, seeded once under an advisory lock and shared with `timing.spec.ts` — see
 * that file's note on why they are read-only and idempotent rather than cleared per run. Four
 * runnings of years that will not happen: 2099 has a field and is unpublished, 2098 is empty,
 * **2096 is finished and unpublished** and **2095 is published**.
 */

test.beforeAll(async () => {
  await seedTimingFixtures();
});

test.describe('before anybody has published', () => {
  /**
   * ⚠️ **Finishing is not publishing, and this is the assertion that says so to the public.**
   * `finish_event()` is `timing.event.manage` and `publish_results()` is
   * `timing.result.publish`; the gap between the two acts is where somebody reads the table
   * before the internet does. A page that opened on `finished_at` would close that gap without
   * anybody deciding to.
   */
  test('a race that is finished and not published is the ordinary not-found page', async ({
    page,
  }) => {
    await page.goto(FINISHED_PATH);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    await expect(page.getByText('There is nothing at this address.')).toBeVisible();

    // ⚠️ **404, never 403** — the refusal has to be indistinguishable from an address that
    // does not exist, or it confirms to somebody probing the site which years are real. So
    // nothing about the race may be on the refusal either.
    expect(await page.content()).not.toContain(FINISHED_EVENT_NAME);
  });

  /** A race still being timed is the same answer, and so is a year with no race at all. */
  test('a race still being captured is refused the same way, as is a year with no race', async ({
    page,
  }) => {
    await page.goto(RESULTS_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    expect(await page.content()).not.toContain(RESULTS_EVENT_NAME);

    await page.goto('/nn/2097/results/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  });

  /**
   * **The link is painted only when there is somewhere for it to go**, and nothing in this
   * database publishes the current running — so neither page offers one. A link to a 404 is a
   * claim about a record: the club's own front door saying a race's results exist.
   *
   * The painted half is asserted in `tests/worker/admin/nn-results.test.ts`, whose setup
   * publishes `nn-2026` in a run whose blast radius is one Vitest project rather than this
   * whole suite — `seedPublishedCurrentRunning()` carries the argument.
   */
  test('neither /nn/ nor the year page offers a link to results nobody has published', async ({
    page,
  }) => {
    for (const path of ['/nn/', '/nn/2026/']) {
      await page.goto(path);
      await expect(
        page.locator('[data-nn-results-link]'),
        `${path} revealed a results link`,
      ).toBeHidden();
    }
  });
});

test.describe('a race whose results the club has published', () => {
  test('renders the table to somebody who is signed in to nothing', async ({ page }) => {
    await page.goto(PUBLISHED_PATH);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `${PUBLISHED_EVENT_NAME} — results`,
    );

    for (const team of PUBLISHED_TEAMS) {
      await expect(
        page.getByRole('cell', { name: `${team.firstName} ${team.lastName}` }),
        `${team.lastName} is not on the published table`,
      ).toBeVisible();
    }
  });

  /**
   * ⚠️ **Three categories, and the middle one is the whole of ADR-031.** Rhodri is `non_binary`
   * and asked to be placed with the men; a page resolving `gender` alone renders no category
   * for them however they answered, which is a silent wrong answer rather than a failure. Ozzy
   * has no gender recorded and is in no category, which the column says rather than guesses.
   *
   * **Read off the row rather than the document**, so a category belongs to the runner beside
   * it: `toContain('Men')` over a whole page would pass on a table that had put every runner
   * in the same list.
   */
  test('places every runner through the two questions ADR-031 asks, not by gender alone', async ({
    page,
  }) => {
    await page.goto(PUBLISHED_PATH);

    for (const team of PUBLISHED_TEAMS) {
      const row = page.getByRole('row').filter({ hasText: team.lastName });
      await expect(row, `${team.lastName}: row`).toHaveCount(1);
      await expect(
        row.getByRole('cell', { name: team.expectedCategory, exact: true }),
        `${team.lastName}: category`,
      ).toBeVisible();
    }
  });

  /**
   * **A published page can carry no row that is still being checked**, and it is publication
   * that guarantees it rather than this page: `publish_results()` refuses `open_anomalies`
   * while any crossing is on the triage list, so a race in this state has none by construction.
   * Asserted here anyway, because the guarantee is two files away and the wording — *"being
   * checked"* — is a hedge on a page that is supposed to be the club's answer.
   */
  test('says nothing on it is still being checked', async ({ page }) => {
    await page.goto(PUBLISHED_PATH);

    await expect(page.locator('.results-suspect')).toHaveCount(0);
    expect(await page.content()).not.toContain('being checked');
    // And no banner, because the claim it makes is no longer true: a published page saying
    // these results are not published states the opposite of what the club has just decided.
    expect(await page.content()).not.toContain('These results are not published');
  });

  /**
   * ⚠️ **The minimisation assertion, on the one page here the internet can read.**
   * `timing.runners` holds an email address and a club and `results_for_event()` promises
   * neither is in its answer; this proves the rendered document has neither either, which is a
   * separate failure — the runner rows are joined back on by id in the Worker and a template
   * could read a column the payload had simply stopped carrying.
   *
   * **The artwork comes out before anything is matched**, `nn-entry-complete.spec.ts`'s rule
   * and for its reason: every inline SVG on this site carries
   * `xmlns="http://www.w3.org/2000/svg"` and pages of arbitrary path coordinates under it, so
   * whether a literal collides with decoration is a matter of luck rather than of care.
   * Decoration cannot hold personal data, so removing it narrows this to the part of the
   * document that could.
   *
   * **And every expected value is derived from the fixture rather than written out**, because
   * a literal stops testing silently the moment the value it was copied from moves — which has
   * already happened once in this repository, to a leak test that went on passing against an
   * amount the page was never going to contain.
   */
  test('reveals no runner’s email address, club or exact age', async ({ page }) => {
    await page.goto(PUBLISHED_PATH);

    const html = (await page.content()).replace(/<svg[\s\S]*?<\/svg>/g, '');

    for (const team of PUBLISHED_TEAMS) {
      expect(html, `${team.lastName}: email address`).not.toContain(
        `${team.firstName.toLowerCase()}@${LEAKED_EMAIL_DOMAIN}`,
      );
    }

    expect(html).not.toContain(LEAKED_EMAIL_DOMAIN);
    expect(html).not.toContain(LEAKED_CLUB);

    /**
     * ⚠️ **The exact age, which #241's grant made reachable and ADR-043 withholds** — and it is
     * checked against the **table's cells** rather than against the document, stripped or not.
     * An age is a bare number: `not.toContain('62')` over rendered markup is the assertion this
     * repository has already paid for, and stripping the artwork narrows the collision without
     * removing it — a time, a bib or a place could carry the same two digits. A cell is
     * somewhere a number can only have got by being printed as a fact about somebody.
     */
    const cells = await page.locator('.results-table td').allInnerTexts();
    const printed = cells.join(' | ');

    for (const team of PUBLISHED_TEAMS) {
      expect(
        printed,
        `the exact age ${String(team.ageOnDay)} reached a cell`,
      ).not.toContain(String(team.ageOnDay));
      // And therefore no band derived from one: a published result carries a name, a category
      // and a time. Whether the club's four prize bands may join them is ADR-043's open
      // question, and it is the committee's rather than a build one.
      if (team.previewCategory === team.expectedCategory) continue;
      expect(printed, `${team.lastName}: the preview's band was published`).not.toContain(
        team.previewCategory,
      );
    }
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto(PUBLISHED_PATH);

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  /**
   * ⚠️ **Through `tests/sideways-scroll.ts`, and never measured straight off a visible
   * element.** `DOMContentLoaded` waits for scripts and not for `<link rel="stylesheet">`, and
   * reading a layout property is not gated on render-blocking — so a check written by hand
   * forces a synchronous layout of a bare document and fails about one run in three, naming an
   * element that is laying out at its intrinsic width because the stylesheet has not arrived.
   * The helper waits for a defined state instead, and names the offending element when it does
   * fail.
   *
   * **A results table is the page on this site most likely to overflow**: six columns of
   * arbitrary-length names, on a phone, in a car park.
   */
  test('does not push the page sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(PUBLISHED_PATH);

    await expectNoSidewaysScroll(page, 'the published results table at 320px');
  });
});
