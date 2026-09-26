import { expect, test, type Page } from '@playwright/test';

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { parseClub } from '@src/shared/club-content';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * The club website's own chrome, and the fence around the pages that may not have it.
 *
 * ## Two jobs, and the second is the point of the file
 *
 * The first half asserts that the Direction A header, Menu and footer work — including with
 * scripting off, which is where they matter most.
 *
 * The second half is a **fence**. Until after Nightingale Nightmare on 1 November 2026, every
 * page that takes or handles money keeps today's chrome: the old banner sentence, the old
 * four-item bar, the old footer. Nothing in this change should be able to reach them, and
 * "should not be able to" is worth exactly as much as the test that says so. Without it, the
 * failure mode is silent — somebody adds `ClubHeader` to `Base.astro` to be helpful and the
 * entry form grows a second navigation two weeks before the race, with every existing test
 * still green because none of them asserts the *absence* of the new chrome.
 *
 * ## Nothing here is tagged `@requires-js` except the axe scan
 *
 * The Menu is a `<details>`, so it opens and closes with no script at all — and the
 * `no-javascript` project is where that has to be proved, because most of the people reading
 * this are on a phone on poor signal. Only `axeViolations` needs scripting, because axe-core
 * runs inside the page: with `javaScriptEnabled: false` it never starts and the call sits
 * there until Playwright's timeout, which reads as a hanging page rather than as a scanner
 * that cannot run.
 */

/** Wide enough for the full bar; the Menu is hidden above 62em. */
/**
 * The club's own facts, read the way the footer reads them.
 *
 * ⚠️ **Read from disk rather than `import`ed.** A bare `import club from '…/club.json'` works
 * in an Astro page, where Vite handles it, and fails in a Playwright spec with *"needs an
 * import attribute of type: json"*. `club-content.test.ts` already reads its fixtures this
 * way; copying that is cheaper than an import attribute the two module systems disagree about.
 */
const club = parseClub(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../src/content/club.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const DESKTOP = { width: 1280, height: 900 };
/** A real phone, and the width the club's own visitors mostly arrive at. */
const PHONE = { width: 390, height: 844 };

/**
 * The six sections, in the order the brief sets, and where each goes.
 *
 * ⚠️ **Account is `/account/`, not `/account/sign-in/`.** The club pages are static, so
 * nothing rendering this bar knows whether anybody is signed in; `/account/` branches for
 * itself, rendering the account page for a session and redirecting to sign-in without one.
 * A link straight at the sign-in form would show a signed-in member a form they do not need.
 */
const SECTIONS = [
  ['Run with us', '/run-with-us/'],
  ['Races and events', '/events/'],
  ['Membership', '/membership/'],
  ['News', '/news/'],
  ['About', '/about/'],
  ['Account', '/account/'],
] as const;

test.describe('the club header', () => {
  test('offers the six sections, in order, with the call to action last', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Southville Running Club' });
    await expect(nav).toBeVisible();

    for (const [label, href] of SECTIONS) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    }

    // **Order, not just presence.** A bar with the right six links in the wrong sequence
    // passes every per-link assertion above, and the sequence is the design.
    await expect(nav.getByRole('link')).toHaveText(SECTIONS.map(([label]) => label));

    // "Come for a run" is the header's call to action and it is not a section, which is why
    // it sits outside the `<nav>` rather than as a seventh item in it.
    const cta = page.getByRole('link', { name: 'Come for a run' }).first();
    await expect(cta).toHaveAttribute('href', '/run-with-us/');
  });

  /**
   * The wordmark is the Home link, so it is the thing that has to carry `aria-current` on `/`.
   *
   * Without this, somebody using a screen reader is told which section they are in everywhere
   * except the home page — the one page where the answer is unambiguous.
   */
  test('marks the home page through the wordmark, since that is the Home link', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    const mark = page.getByRole('link', { name: 'Southville Running Club, home' });
    await expect(mark).toHaveAttribute('href', '/');
    await expect(mark).toHaveAttribute('aria-current', 'page');

    // And only that one: a page cannot be two places at once.
    await expect(page.locator('header [aria-current="page"]')).toHaveCount(1);
  });

  test('carries the new banner sentence, not the money pages’ one', async ({ page }) => {
    await page.goto('/');

    const banner = page.locator('.club-banner');

    await expect(banner).toContainText(
      "Welcome to Southville Running Club's new website.",
    );
    await expect(banner).toContainText('Some pages are still on the old site');

    // ⚠️ The sentence it replaced. It is still true on `/nn/` and must not be here: the club's
    // own pages *are* the rest of the website, so saying the club only has one race reads as a
    // page that has not noticed itself.
    await expect(banner).not.toContainText('We just have Nightingale Nightmare for now');

    await expect(banner.getByRole('link', { name: 'the old site' })).toHaveAttribute(
      'href',
      'https://southvillerunningclub.co.uk',
    );
  });

  /**
   * ⚠️ The spacing trap, asserted because it is invisible in the markup.
   *
   * Astro compresses the newline between a tag and the text after it to nothing, so a
   * sentence written across a line break arrives as "…still onthe old site…". It looks fine
   * in the source and wrong on the page, and no other assertion here would see it.
   */
  test('keeps the spaces around the inline link', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.club-banner p')).toContainText(
      'Some pages are still on the old site while we move across.',
    );
  });
});

test.describe('the Menu, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
  });

  /**
   * **No `@requires-js`, deliberately.** This is a `<details>` precisely so that it works in
   * the `no-javascript` project, and this is the test that proves it rather than assuming it.
   */
  test('opens and offers every section, with scripting off', async ({ page }) => {
    // **Located by class rather than by role.** `<details>` maps to the `group` role, which
    // is shared with `<fieldset>` and anything carrying `role="group"` — precise enough today
    // and not the sort of selector to hang a fence on.
    const menu = page.locator('.club-menu');
    const summary = page.locator('.club-menu > summary');

    // Shut to begin with, so the header is the wordmark and one control.
    for (const [label] of SECTIONS) {
      await expect(
        page
          .getByRole('navigation', { name: 'Southville Running Club, menu' })
          .getByRole('link', {
            name: label,
            exact: true,
          }),
      ).toBeHidden();
    }

    await summary.click();
    await expect(menu).toHaveAttribute('open', '');

    const panel = page.getByRole('navigation', { name: 'Southville Running Club, menu' });
    for (const [label, href] of SECTIONS) {
      await expect(panel.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    }

    // The call to action again at the foot of the panel: on a phone the header's own copy is
    // the first thing that runs out of room.
    await expect(panel.getByRole('link', { name: 'Come for a run' })).toHaveAttribute(
      'href',
      '/run-with-us/',
    );
  });

  test('closes again, so it does not cover the page permanently', async ({ page }) => {
    const menu = page.locator('.club-menu');
    const summary = page.locator('.club-menu > summary');

    await summary.click();
    await expect(menu).toHaveAttribute('open', '');

    await summary.click();
    await expect(menu).not.toHaveAttribute('open', '');
  });

  test('is operable from the keyboard', async ({ page }) => {
    const summary = page.locator('.club-menu > summary');

    await summary.focus();
    await page.keyboard.press('Enter');

    await expect(
      page
        .getByRole('navigation', { name: 'Southville Running Club, menu' })
        .getByRole('link', { name: 'Run with us', exact: true }),
    ).toBeVisible();
  });

  /**
   * ⚠️ **The defect this repository has already paid for twice.**
   *
   * An absolutely positioned panel whose containing block is the *page* is laid out against
   * the document, and a panel wider than the viewport then makes the whole page scroll
   * sideways — silently, with nothing looking wrong. It happened with a visually-hidden span
   * inside a scrolling admin table, and again with the Events submenu on the money pages.
   * `position: relative` on the `<details>` is what anchors it, and this is what says so.
   */
  test('does not make the page scroll sideways when it is open', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.locator('.club-menu > summary').click();

    await expectNoSidewaysScroll(page, 'the club header with the Menu open at 320px');
  });
});

test.describe('the club footer', () => {
  test('offers the club’s four profiles and the privacy notice', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('.club-footer');

    for (const name of ['Instagram', 'Facebook', 'X', 'TikTok']) {
      await expect(footer.getByRole('link', { name })).toBeVisible();
    }

    await expect(footer.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute(
      'href',
      '/privacy/',
    );
  });

  /**
   * ⚠️ **The meeting details are read out of `club.json`, not quoted here.**
   *
   * This test named the strings as literals and went red the moment the home page's facts
   * strip needed the fuller wording — "Meet 6.00pm for a 6.15pm start" rather than "Meet
   * 6.00pm, run 6.15pm". Nothing was broken: one fact had one string, the string improved,
   * and a test that had copied it disagreed.
   *
   * That is the drift this whole arrangement exists to prevent, reproduced inside the test
   * suite. Reading the same source the footer reads asserts the **wiring** — that the footer
   * renders these facts at all — and leaves the **wording** where it belongs, in the data.
   * A footer that rendered nothing, or the wrong field, still fails.
   */
  test('says where and when the club meets, from club.json', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('.club-footer');

    await expect(footer).toContainText(club.meet.days);
    await expect(footer).toContainText(club.meet.time);
    await expect(footer).toContainText(club.meet.venue);

    // ⚠️ **The whole town and postcode, with the space.** `BS3 1DB` alone passed against a
    // page that read `BristolBS3 1DB` — Prettier reflowed two adjacent expressions onto two
    // lines and Astro compressed the newline between them to nothing. The assertion has to
    // span the join or it cannot see the defect.
    await expect(footer).toContainText(`${club.meet.city} ${club.meet.postcode}`);
    await expect(footer.getByRole('link', { name: 'Open in maps' })).toBeVisible();
  });

  /**
   * ⚠️ **Found by the axe sweep on its first run, and named here so it fails specifically.**
   *
   * WCAG 2.2 AA 2.5.8 asks for 24×24px or 24px of clearance. "Privacy notice" is 0.875rem type
   * on one line — **90.8 × 17px**, 21px under the social icon row — so it failed on both halves
   * at once, on all three axe scans. "Open in maps" is the same shape and was one viewport from
   * the same failure.
   *
   * The sweep would catch a regression too. This exists because *"a named assertion beats a
   * rule that happens to cover it"*: a failure here says which link and how tall, where the
   * sweep says only that some target is too small.
   */
  test('gives every footer link a real tap target', async ({ page }) => {
    await page.goto('/');

    for (const name of ['Privacy notice', 'Open in maps']) {
      const box = await page
        .locator('.club-footer')
        .getByRole('link', { name })
        .boundingBox();

      expect(box, `${name} was not on the page`).not.toBeNull();
      // 44, not the required 24: most of the people reading this are on a phone, outdoors,
      // with cold hands.
      expect(box?.height ?? 0, `${name} is too short to tap`).toBeGreaterThanOrEqual(44);
    }
  });

  test('is the page’s one contentinfo landmark', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('contentinfo')).toHaveCount(1);
  });
});

test.describe('the club page itself', () => {
  for (const [name, size] of [
    ['320', { width: 320, height: 720 }],
    ['390', PHONE],
    ['768', { width: 768, height: 1024 }],
    ['1440', { width: 1440, height: 900 }],
  ] as const) {
    test(`does not scroll sideways at ${name}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');

      await expectNoSidewaysScroll(page, `the club home page at ${name}px`);
    });
  }

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    // Zero, not "few". Any threshold above zero becomes the new normal within a month.
    expect(await axeViolations(page)).toEqual([]);
  });

  test('has none on a phone either @requires-js', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    expect(await axeViolations(page)).toEqual([]);
  });

  test('has none in the dark scheme @requires-js', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize(PHONE);
    await page.goto('/');

    expect(await axeViolations(page)).toEqual([]);
  });

  /**
   * The webfont is the club's own and is served from the club's own origin.
   *
   * ⚠️ Google's CDN would send every visitor's IP address to a third party and would have to
   * be disclosed on `/privacy/`. This is cheap to reintroduce by pasting an `@import` from a
   * font page, and nothing else here would notice.
   */
  test('loads its webfont from this origin, never a font CDN', async ({
    page,
    baseURL,
  }) => {
    const offsite: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (baseURL !== undefined && url.startsWith(baseURL)) return;
      offsite.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('load');

    expect(offsite, 'the club pages fetched something from another origin').toEqual([]);

    // And the face itself is actually served, from where it is supposed to be.
    const font = await page.request.get('/fonts/bricolage-grotesque-800-latin.woff2');
    expect(font.status()).toBe(200);
  });
});

/**
 * The frozen addresses.
 *
 * These are live, shared and linked from elsewhere. They must keep answering **200 at exactly
 * these paths with no redirect**, and this is what stops a future refactor quietly breaking
 * them — a rename, a trailing-slash change, or a route added in front of one.
 *
 * ⚠️ **`/account/sign-in/` is here even though the bar links to `/account/`**, because it is
 * the address the club has actually shared. `/account/` is allowed to redirect; this one is
 * not.
 */
test.describe('the frozen addresses', () => {
  for (const path of [
    '/nn/',
    '/nn/2026/',
    '/events/christmas-party-2026/',
    '/account/sign-in/',
  ]) {
    test(`${path} answers 200, with no redirect`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response, `${path} produced no response at all`).not.toBeNull();
      expect(response?.status(), `${path} did not answer 200`).toBe(200);

      // **The URL, not just the status.** A 200 after a redirect is still a moved address,
      // and it is the shape a trailing-slash mistake takes.
      expect(new URL(page.url()).pathname, `${path} was redirected`).toBe(path);

      // `request().redirectedFrom()` is null when nothing redirected. A chain that happened
      // to land on the right path would still fail here.
      expect(
        response?.request().redirectedFrom(),
        `${path} was reached through a redirect`,
      ).toBeNull();
    });
  }
});

/**
 * ⚠️ **The fence: the money pages keep today's chrome until after the race.**
 *
 * Every assertion below is about the *absence* of this change. They are the reason somebody
 * can review the rest of this PR without checking the entry form by hand — and they are
 * written to fail loudly the day somebody wires the new chrome into `Base.astro` or
 * `worker/site-chrome.ts` to be helpful.
 *
 * **After the race these go**, in the change that moves the money pages across. They are
 * deliberately a separate describe block, with this comment on it, so that removing them is a
 * decision somebody takes rather than a tidy-up.
 */
test.describe('the pages that keep today’s chrome until after the race', () => {
  /** `/privacy/` and `/404` are club pages that are deliberately not in this change either. */
  const UNTOUCHED = [
    '/nn/',
    '/nn/2026/',
    '/events/christmas-party-2026/',
    '/account/sign-in/',
    '/privacy/',
  ] as const;

  async function expectNoClubChrome(page: Page, path: string): Promise<void> {
    await expect(
      page.locator('.club-header'),
      `${path} grew the club header`,
    ).toHaveCount(0);
    await expect(
      page.locator('.club-footer'),
      `${path} grew the club footer`,
    ).toHaveCount(0);
    await expect(page.locator('.club-menu'), `${path} grew the club Menu`).toHaveCount(0);
  }

  for (const path of UNTOUCHED) {
    test(`${path} renders none of the new chrome`, async ({ page }) => {
      await page.goto(path);
      await expectNoClubChrome(page, path);
    });
  }

  /**
   * The old banner sentence, on the pages that still say it.
   *
   * ⚠️ `/nn/*` carries `NnNav` and deliberately **no** `.site-nav` — ADR-014, and a club bar
   * above that sticky header puts every anchor and every keyboard focus behind it. So the bar
   * is asserted only where it actually belongs.
   */
  test('the money pages still say what they said before', async ({ page }) => {
    await page.goto('/nn/');

    await expect(page.locator('.site-banner')).toContainText(
      'We just have Nightingale Nightmare for now',
    );
  });

  test('the old four-item bar is untouched where it is rendered', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/privacy/');

    const nav = page.getByRole('navigation', { name: 'Southville Running Club' });

    // The money pages' bar, not the club's: four items, and "Home" rather than a wordmark.
    for (const [label, href] of [
      ['Home', '/'],
      ['Nightingale Nightmare', '/nn/'],
      ['Events', '/events/'],
      ['Account', '/account/'],
    ] as const) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    }
  });

  /**
   * ⚠️ **The stylesheets must not cross.**
   *
   * `club.css` is self-contained so that the club's palette cannot reach the entry form, and
   * `base.css` stays where it is so the money pages are unaffected. One `import` in the wrong
   * layout undoes both at once, and the page would still *look* right in the direction that
   * matters least.
   */
  test('the money pages load none of the club stylesheet', async ({ page }) => {
    await page.goto('/nn/2026/');

    const styled = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--club-background')
        .trim(),
    );

    expect(styled, 'the club palette reached a money page').toBe('');
  });

  test('the club pages load none of the money pages’ palette', async ({ page }) => {
    await page.goto('/');

    const styled = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--colour-background')
        .trim(),
    );

    expect(styled, 'the money pages’ palette reached a club page').toBe('');
  });
});
