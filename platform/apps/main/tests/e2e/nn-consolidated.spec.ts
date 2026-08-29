import { expect, test } from '@playwright/test';

/**
 * The consolidated `/nn/2026/` page — its structure, its jump-nav, and the half of it that has
 * to work with the enhancement script removed.
 *
 * ## Nothing here is tagged `@requires-js`, deliberately
 *
 * The whole claim of this page is that the script is enhancement: with it removed the anchors
 * jump, the jump-nav's `<details>` opens, the entry rail and its button are present, and every
 * call to action is reachable. The `no-javascript` project runs this file with scripting off,
 * so that claim is asserted rather than asserted-about.
 *
 * The two things the script does that cannot be tested without it — moving focus on a jump, and
 * revealing the entry bar — are in the file's second half and carry the tag.
 *
 * ## What is deliberately not here yet
 *
 * **Every assertion that needs a measurement.** Whether a heading clears the masthead, whether
 * the page is operable at 320px, whether the sticky rail stays scrollable at a real window
 * height, and whether releasing the masthead actually removes the doubled chrome are all
 * properties of a rendered layout that has never been through a browser. Written blind they
 * would be guesses that fail for mechanical reasons and get "fixed" by loosening them, which is
 * worse than not having them. They land once this file has run once.
 *
 * `site.spec.ts` already carries the nine-width sweep those would extend.
 */

const YEAR = '/nn/2026/';

/** The four the jump-nav offers, and the sections each points at. */
const SECTIONS = [
  ['Race', 'race'],
  ['Course', 'course'],
  ['Race info', 'race-info'],
  ['Spooktators', 'spooktators'],
] as const;

test.describe('the shape of the page', () => {
  test('carries every section the jump-nav points at', async ({ page }) => {
    await page.goto(YEAR);

    // **The ids are the contract.** The jump-nav links to them, and a section renamed without
    // its link is a control that scrolls nowhere — silently, because a fragment that matches
    // nothing is not an error.
    for (const [, id] of SECTIONS) {
      await expect(page.locator(`#${id}`), id).toHaveCount(1);
    }

    await expect(page.locator('#top')).toHaveCount(1);
    await expect(page.locator('#entry')).toHaveCount(1);
    await expect(page.locator('#footer')).toHaveCount(1);
  });

  test('offers exactly the four jump links, pointing at those sections', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const links = page.locator('.nn-jump-links a');
    await expect(links).toHaveCount(SECTIONS.length);

    for (const [index, [label, id]] of SECTIONS.entries()) {
      await expect(links.nth(index)).toHaveText(label);
      await expect(links.nth(index)).toHaveAttribute('href', `#${id}`);
    }
  });

  /**
   * **One `h1`, and the year is in it at every width.**
   *
   * The demo hides the year below 860px on the grounds that the display face closes up. That
   * removes it from the accessibility tree as well as from the screen, so a screen-reader user
   * on a phone would get "Nightingale Nightmare" with no year — on a page whose entire identity
   * is one running of a recurring race, on most of the visits it will ever get.
   */
  test('has one first-level heading and it names the year', async ({ page }) => {
    await page.goto(YEAR);

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Nightingale Nightmare 2026');
  });

  /**
   * The heading outline, which axe cannot check on its own.
   *
   * Axe reports a skipped level; it does not report a page whose sections are `h3` because
   * somebody nested them one deep by accident. Asserting the sections are all `h2` is what
   * keeps the outline flat where it should be flat.
   */
  test('gives every section a second-level heading', async ({ page }) => {
    await page.goto(YEAR);

    for (const [, id] of SECTIONS) {
      await expect(
        page.locator(`#${id}`).getByRole('heading', { level: 2 }),
        id,
      ).toHaveCount(1);
    }
  });
});

test.describe('what survives without the script', () => {
  /**
   * **The entry rail is the page's one inline call to action on a phone**, and it is markup
   * rather than anything the script builds. If this fails with scripting off, the rail is not
   * the thing it was argued to be.
   */
  test('presents the entry rail, its fee and its button', async ({ page }) => {
    await page.goto(YEAR);

    const rail = page.locator('#entry');
    await expect(rail).toBeVisible();
    await expect(rail.locator('[data-nn-fee]')).toHaveCount(1);
    await expect(rail.getByRole('link')).toHaveCount(1);
  });

  /**
   * **Every call to action goes somewhere that exists.**
   *
   * This is the assertion that would have caught the defect this branch introduced and then
   * fixed: two buttons carried a static `href="#register"`, and `#register` is the id of a
   * heading inside the block the Worker hides the moment entries open. A fragment pointing at
   * nothing is a control that looks live, takes focus and does nothing.
   */
  test('points every call to action at a target on the page', async ({ page }) => {
    await page.goto(YEAR);

    const ctas = page.locator('[data-nn-cta]');
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const href = await ctas.nth(index).getAttribute('href');
      expect(href, `cta ${index}`).toMatch(/^#/);
      await expect(page.locator(`[id="${href?.slice(1)}"]`), href ?? '').toHaveCount(1);
    }
  });

  /**
   * **The jump-nav's menu opens without JavaScript**, because it is a `<details>` and nothing
   * else. Asserted by opening it rather than by reading the markup: `display: contents` on the
   * `<details>` is what makes the same element inline links on a wide screen and a menu on a
   * narrow one, and that is a browser behaviour rather than a specified one.
   */
  test('opens its section menu, whatever the engine does with display: contents', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const menu = page.locator('.nn-jump-menu');
    await expect(menu).toHaveCount(1);

    // Either the links are already shown — the wide presentation — or the summary opens them.
    const links = page.locator('.nn-jump-links a').first();
    if (!(await links.isVisible())) {
      await menu.locator('summary').click();
    }

    await expect(links).toBeVisible();
  });

  test('reaches the terms and the privacy notice from the footer', async ({ page }) => {
    await page.goto(YEAR);

    const footer = page.locator('#footer');
    await expect(footer.getByRole('link', { name: /terms/i })).toHaveAttribute(
      'href',
      '/nn/2026/terms/',
    );
    await expect(footer.getByRole('link', { name: /details/i })).toHaveAttribute(
      'href',
      '/nn/privacy/',
    );
  });

  /**
   * **The schedule is in the flow and never behind a disclosure.** It is the one thing on this
   * page somebody reads under time pressure, and content inside a collapsed `<details>` is not
   * reliably reachable by find-in-page on iOS Safari.
   */
  test('shows the whole race-morning schedule without interaction', async ({ page }) => {
    await page.goto(YEAR);

    const rows = page.locator('#race-info .nn-schedule-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('#race-info details')).toHaveCount(0);
  });

  /**
   * The consolidation is of one *entry point*, not one page — so each summary section has to
   * actually lead somewhere. A summary with no link out is a page that has absorbed its
   * subject without saying so.
   */
  test('links each summary section to the page it summarises', async ({ page }) => {
    await page.goto(YEAR);

    for (const [id, href] of [
      ['course', '/nn/course/'],
      ['race-info', '/nn/2026/race-day/'],
      ['spooktators', '/nn/2026/spectators/'],
    ] as const) {
      await expect(
        page.locator(`#${id}`).getByRole('link', { name: /in full/i }),
        id,
      ).toHaveAttribute('href', href);
    }
  });
});

test.describe('what the script adds', () => {
  /**
   * **The jump that moves the keyboard, not only the page.**
   *
   * A bare fragment link scrolls and leaves focus where it was, so the next Tab returns the
   * reader to the top — silently, and axe passes either way. This is the assertion that holds
   * the handler in place; there is nothing else that can.
   */
  for (const [label, id] of SECTIONS) {
    test(`moves focus to ${id} when "${label}" is followed @requires-js`, async ({
      page,
    }) => {
      await page.goto(YEAR);

      await page.locator('.nn-jump-links a', { hasText: label }).click();

      await expect(page.locator(`#${id}`)).toBeFocused();
    });
  }

  /**
   * **The bar is not in the tab order while it is off screen.** A fixed control that is
   * visually gone but still tabbable is a focus stop that lands nowhere.
   */
  test('keeps the entry bar out of reach until it is shown @requires-js', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const bar = page.locator('[data-nn-entry-bar]');
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await expect(bar.getByRole('link')).toHaveAttribute('tabindex', '-1');
  });
});
