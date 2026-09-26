import { expect, test } from '@playwright/test';

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { axeViolations } from '../axe';

import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * The race's own facts, read the way the page reads them.
 *
 * ⚠️ **The same file the page reads, rather than the date typed out here.** A literal stops
 * testing silently the moment the value moves, and this repository has already shipped a leak
 * assertion that passed for months because its literal had gone stale.
 *
 * ⚠️ **Read from disk rather than `import`ed.** A bare `import race from '…/race.json'` works
 * in an Astro page, where Vite handles it, and fails in a Playwright spec with *"needs an
 * import attribute of type: json"*. `club-chrome.spec.ts` already reads `club.json` this way;
 * copying that is cheaper than an import attribute the two module systems disagree about.
 */
const race = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../src/content/race.json', import.meta.url)),
    'utf8',
  ),
) as { date: string; hqName: string };

/**
 * `/events/` — the races-and-events hub, and the Christmas party's page.
 *
 * ## Why the axe scans carry `@requires-js` and nothing else here does
 *
 * **axe-core runs inside the page.** With `javaScriptEnabled: false` it never starts, so
 * `AxeBuilder.analyze()` sits there until Playwright's 30-second timeout — which reads as a
 * hanging page rather than as a scanner that cannot run. That is the same shape as
 * `page.waitForFunction` installing its loop in the page, which this repository has already
 * paid for once in `sideways-scroll.ts`.
 *
 * The `no-javascript` project excludes `@requires-js` by `grepInvert`, and elsewhere in this
 * suite that tag means exactly "an axe scan". **Every other test in this file deliberately
 * runs with scripting off**, because that is where they matter most: the disabled-control
 * guard is HTML5 constraint validation, which has no JavaScript fix, and the page's honesty
 * about what is confirmed is server-rendered.
 *
 * **Almost every assertion here is about what the page does *not* say.** The 2026 details are
 * not confirmed and the tickets are not on sale, so the page's whole job today is to be honest
 * about both — and the expensive failure would be a page that quietly showed last year's date
 * or offered a form that cannot take money.
 */

/**
 * ⚠️ **Every address `/events/` served before it moved onto the club surface.**
 *
 * This is the most important assertion in the file, and the reason it is a list rather than a
 * handful of `toBeVisible()` calls. `/events/christmas-party-2026/` is where somebody buys a
 * ticket; `/nn/` is the way into an entry window with real money going through it. A redesign
 * that quietly renamed one, dropped a trailing slash, or pointed it at a prettier address
 * would break a live payment route and **look completely fine on the page**.
 *
 * So the rule this file enforces is: *nothing here may disappear and nothing may be
 * re-pointed.* The page is allowed to grow links — moving onto `ClubBase` brings the club's
 * own six sections, its call to action and the footer's map link, which is not optional once
 * the page wears that header — and it is not allowed to lose one.
 */
const PRESERVED = [
  '#main',
  '/',
  'https://southvillerunningclub.co.uk',
  '/nn/',
  '/events/',
  '/events/christmas-party-2026/',
  '/account/',
  '/privacy/',
  'https://www.instagram.com/southvillerunningclub/',
  'https://www.facebook.com/groups/22333122208',
  'https://twitter.com/SouthvilleRC',
  'https://www.tiktok.com/@southvillerunningclub',
] as const;

test.describe('the events section', () => {
  /**
   * ⚠️ **The one that guards the money routes.**
   *
   * Read off the DOM rather than asserted link by link, so a destination that changed shape —
   * `/nn` for `/nn/`, an absolute URL for a root-relative one — fails here rather than passing
   * a `toBeVisible()` on whatever happens to carry the same words.
   */
  test('still serves every address it served before the redesign', async ({ page }) => {
    await page.goto('/events/');

    const hrefs = new Set(
      await page
        .locator('a[href]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '')),
    );

    for (const href of PRESERVED) {
      expect(hrefs, `${href} is no longer on /events/`).toContain(href);
    }
  });

  /**
   * The page itself is one of those addresses.
   *
   * `trailingSlash` is `'always'`, and a 200 reached *through a redirect* is still a moved
   * address — which is the shape a trailing-slash mistake takes and the shape that costs a
   * link somebody has already shared.
   */
  test('is still at /events/, with no redirect', async ({ page }) => {
    const response = await page.goto('/events/');

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/events/');
    expect(response?.request().redirectedFrom()).toBeNull();
  });

  test('is headed Races and events', async ({ page }) => {
    await page.goto('/events/');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Races and events' }),
    ).toBeVisible();
  });

  /**
   * ⚠️ **Located by class, not by role name.** The club header renders two navigations — the
   * bar and the Menu — whose accessible names are "Southville Running Club" and "Southville
   * Running Club, menu". `getByRole`'s `name` matches a **substring** by default, so the
   * obvious locator matches both and fails strict mode at any width where the Menu is in the
   * tree. `club-chrome.spec.ts` gets away with it only by setting a desktop viewport first.
   */
  test('marks itself as the section being read', async ({ page }) => {
    await page.goto('/events/');

    await expect(page.locator('.club-nav [aria-current="page"]')).toHaveText(
      'Races and events',
    );
  });

  /**
   * The two sections, and that the right race and the right party are in each.
   *
   * Scoped to the section rather than to the page: both links exist on the page whichever
   * section they are in, so an assertion that did not scope would pass with the two swapped.
   */
  test('files the race under Races and the party under Social events', async ({
    page,
  }) => {
    await page.goto('/events/');

    await expect(
      page.locator('#races').getByRole('link', { name: 'Nightingale Nightmare' }),
    ).toHaveAttribute('href', '/nn/');

    await expect(
      page.locator('#socials').getByRole('link', { name: 'SRC Christmas Party 2026' }),
    ).toHaveAttribute('href', '/events/christmas-party-2026/');

    // And the jump links reach them, which is the only thing this change adds to the page.
    await expect(page.getByRole('link', { name: 'Races', exact: true })).toHaveAttribute(
      'href',
      '#races',
    );
    await expect(
      page.getByRole('link', { name: 'Social events', exact: true }),
    ).toHaveAttribute('href', '#socials');
  });

  /**
   * ⚠️ **Two rows, two sources, and neither date is in this page's markup.**
   *
   * The race's comes from `race.json` at build time and is asserted as the *same string the
   * build read* — a literal stops testing silently the moment the value moves. The party's
   * comes from `store.socials` at request time, painted by `renderSocialRow()`, and is
   * asserted as literals for the reason the party's own page asserts them that way: this
   * passing is the proof the row is reading the database rather than carrying a date in a
   * template, which is the property that makes confirming one an `update` and no deploy.
   */
  test('shows both dates, and neither is in the markup', async ({ page }) => {
    await page.goto('/events/');

    const races = page.locator('#races');
    await expect(races).toContainText(race.date);
    await expect(races).toContainText(race.hqName);

    // Supplied by a club volunteer on 5 September 2026, and a `store.socials` column since.
    const socials = page.locator('#socials');
    await expect(socials).toContainText('Saturday 12 December 2026');
    await expect(socials).toContainText('The Cock & Tail');

    // The tile agrees with the sentence beneath it — they are split from one formatted string
    // precisely so they cannot drift.
    await expect(socials.locator('[data-social-day]')).toHaveText('12');
    await expect(socials.locator('[data-social-month]')).toHaveText('Dec');

    // And the placeholder it replaced is gone rather than merely covered.
    await expect(socials.locator('[data-social-tbc]')).toBeHidden();
    await expect(socials).not.toContainText('Details to be confirmed');
  });

  /**
   * A photograph per section, and each one actually decoded.
   *
   * ⚠️ **`naturalWidth` rather than `toBeVisible()`.** These slots carry
   * `background: var(--club-photo)` — the flat panel they replaced — so an `<img>` whose file
   * 404s, or whose name drifts after a rename, paints the *placeholder green* and is still
   * perfectly "visible" at the right size in the right place. Nothing else in this suite
   * could tell the difference, and neither could somebody glancing at the page. A decoded
   * image is the only thing that says the photograph is really there.
   *
   * The alt text is asserted as non-empty rather than by its words: it is a description
   * somebody will improve, and pinning the sentence would make improving it a test failure.
   * What must not happen is it going empty, which would make a photograph of the club's own
   * members decoration.
   */
  test('shows a photograph in each section, decoded and described', async ({ page }) => {
    await page.goto('/events/');

    for (const section of ['#races', '#socials']) {
      const photo = page.locator(`${section} img.club-photo`);

      await expect(photo, `${section} has no photograph`).toHaveCount(1);

      // ⚠️ **Scrolled to first, and this test failed on `mobile-safari` without it.** Both
      // images are `loading="lazy"`, so one below the fold is never fetched at all — on a
      // 390px phone the socials photograph is a long way down, `complete` stays false for
      // ever, and even a retrying assertion just waits out its timeout. The image was fine;
      // the test was asserting that an off-screen lazy image had loaded, which is the one
      // thing `loading="lazy"` exists to prevent. Scrolling to it is also what a reader does.
      await photo.scrollIntoViewIfNeeded();

      await expect(photo).toHaveJSProperty('complete', true);

      const decoded = await photo.evaluate(
        (img) => (img as HTMLImageElement).naturalWidth,
      );
      expect(decoded, `${section}'s photograph did not decode`).toBeGreaterThan(0);

      const alt = await photo.getAttribute('alt');
      expect(alt?.trim(), `${section}'s photograph has no alt text`).toBeTruthy();
    }
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto('/events/');

    // Zero, not "few". Any threshold above zero becomes the new normal within a month.
    const violations = await axeViolations(page);

    expect(violations).toEqual([]);
  });

  test('has none on a phone either @requires-js', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/events/');

    expect(await axeViolations(page)).toEqual([]);
  });

  for (const [name, size] of [
    ['320', { width: 320, height: 720 }],
    ['1440', { width: 1440, height: 900 }],
  ] as const) {
    test(`does not scroll sideways at ${name}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/events/');

      await expectNoSidewaysScroll(page, `/events/ at ${name}px`);
    });
  }

  /**
   * ⚠️ **44px, at the width where it matters.** The rows are the page's whole purpose and
   * they are read on a phone, outdoors. The club footer carries a named assertion of the same
   * floor for the same reason — *"a named assertion beats a rule that happens to cover it"*:
   * this says which link and how tall, where the axe sweep says only that some target is
   * too small.
   */
  test('gives every event link a real tap target', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/events/');

    for (const name of ['Nightingale Nightmare', 'SRC Christmas Party 2026']) {
      const box = await page
        .locator('.club-events')
        .getByRole('link', { name })
        .boundingBox();

      expect(box, `${name} was not on the page`).not.toBeNull();
      expect(box?.height ?? 0, `${name} is too short to tap`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('the Christmas party page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/christmas-party-2026/');
  });

  test('shows every fact the club has supplied, painted from the database', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'SRC Christmas Party 2026',
    );

    // Supplied by a club volunteer on 5 September 2026. **None of this is in the markup** —
    // this passing is proof the page is reading `store.socials` rather than carrying a date,
    // a time or a price in a template, which is the property that makes confirming any of
    // them an `update` and no deploy.
    await expect(page.getByText('Saturday 12 December 2026')).toBeVisible();
    await expect(page.getByText('7:30pm–1am')).toBeVisible();
    await expect(page.getByText('The Cock & Tail')).toBeVisible();
    await expect(page.getByText('£10.00')).toBeVisible();
    await expect(page.getByText('Entry requirements: 18+')).toBeVisible();
  });

  test('carries the club poster, described rather than transcribed', async ({ page }) => {
    const poster = page.getByRole('img', { name: /Christmas party poster/iu });

    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute('src', '/src-christmas-party-2026-1080.webp');

    // **Intrinsic dimensions, so the facts below do not jump down the page as it loads.**
    await expect(poster).toHaveAttribute('width', '1080');
    await expect(poster).toHaveAttribute('height', '1080');

    // **The alt says what the picture is, not what it says.** The date and the venue are in
    // real text directly below; repeating them here would read the party out twice to a
    // screen reader, and what is actually gained from this element is knowing it is a poster.
    const alt = (await poster.getAttribute('alt')) ?? '';

    expect(alt.length).toBeGreaterThan(20);
    expect(alt, 'the alt does not transcribe the date').not.toMatch(/12 December|Cock/iu);
  });

  test('takes its "to be confirmed" note down once there is nothing left to confirm', async ({
    page,
  }) => {
    // The note is revealed on `socialDetailsConfirmed()` being false — the date, the venue
    // *and* the start time all present. All three are, so it hides itself. It went stale once
    // by naming which details were missing; it names none now, so it cannot.
    await expect(page.getByText('still to be confirmed')).toBeHidden();
  });

  test('shows exactly one £, and never last year\u2019s date', async ({ page }) => {
    const body = await page.content();

    // ⚠️ A template that writes its own `£` beside a call to `formatPence()` renders
    // `££10.00`. This repository carried six instances of that pattern (issue #175, closed),
    // and the quantity picker's labels are the seventh place it could have arrived.
    expect(body.match(/££/gu), 'no doubled currency symbol').toBeNull();

    // The 2025 party was on the 6th. The venue and the price are legitimately last year's
    // now; the date is not, and a page showing it would be announcing the wrong Saturday.
    expect(body, 'last year\u2019s date must not appear').not.toContain('6 December');
  });

  test('says tickets are not on sale, and offers no form at all', async ({ page }) => {
    await expect(page.getByText('Tickets are not on sale yet')).toBeVisible();

    // The form ships hidden, and the Worker only reveals it when the window is open *and* a
    // price exists. Neither is true, so it must not be reachable.
    await expect(page.locator('[data-social-form]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Buy tickets' })).toBeHidden();
  });

  test('leaves every control disabled while the form is hidden', async ({ request }) => {
    // ⚠️ **`hidden` does not stop a control being validated.** A `required` input inside a
    // hidden container is still constrained, still empty and still invalid — so the browser
    // silently refuses to submit the form it is in, with no request and no visible error. That
    // took the live entry form down for every signed-in runner on 31 August 2026.
    //
    // Asserted on the served markup rather than through the DOM, because that is where the
    // attribute has to be: it is HTML5 constraint validation, so there is no JavaScript fix
    // and the `no-javascript` project meets it identically.
    const response = await request.get('/events/christmas-party-2026/');
    const html = await response.text();

    const form = html.slice(html.indexOf('data-social-form'), html.indexOf('</form>'));

    for (const control of ['purchaserName', 'email', 'emailConfirm', 'quantity']) {
      const at = form.indexOf(`id="${control}"`);
      expect(at, `${control} is in the form`).toBeGreaterThan(-1);

      // The tag holding this id has to carry `disabled` as well as sitting inside a hidden
      // container. Both, and never one alone.
      const tag = form.slice(form.lastIndexOf('<', at), form.indexOf('>', at));
      expect(tag, `${control} ships disabled`).toContain('disabled');
    }
  });

  test('refuses a POST rather than pretending to take an order', async ({ request }) => {
    const response = await request.post('/events/christmas-party-2026/', {
      form: {
        purchaserName: 'Alex Example',
        email: 'alex@example.com',
        emailConfirm: 'alex@example.com',
        quantity: '2',
        ticketCode: 'standard',
      },
      maxRedirects: 0,
    });

    // **Never a 303 to Stripe.** Nothing is on sale, no key is installed, and the failure
    // direction for a page attached to a card payment is towards taking no money. 409 says the
    // world moved; 503 says the club cannot take a payment right now. Either is honest.
    expect([409, 503]).toContain(response.status());
  });

  test('does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/events/christmas-party-2026/');

    // Through the shared helper, which waits for a *defined* state — every render-blocking
    // stylesheet applied, fonts settled, width stable across three samples — rather than for
    // the assertion to come good. Measuring straight off `toBeVisible()` measures a page with
    // no CSS on it, which failed about one run in three across two other specs.
    await expectNoSidewaysScroll(page, 'the Christmas party page at 320px');
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    const violations = await axeViolations(page);

    expect(violations).toEqual([]);
  });
});

test.describe('the page somebody lands on after paying', () => {
  test('claims nothing about the payment in either direction', async ({ page }) => {
    await page.goto('/events/christmas-party-2026/complete/');

    const body = await page.content();

    // ⚠️ **No negative claim, ever.** "Nothing was charged" while the webhook is merely late is
    // what sends somebody to pay a second time. The page reads no state at all, which is how
    // it is guaranteed not to say this.
    expect(body).not.toMatch(
      /not charged|nothing was taken|payment failed|was not paid/iu,
    );

    await expect(page.getByText('confirmation email is on its way')).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto('/events/christmas-party-2026/complete/');

    const violations = await axeViolations(page);

    expect(violations).toEqual([]);
  });
});
