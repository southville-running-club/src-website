import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The whole site, in a real browser, on one origin — exactly as the public will meet it.
 *
 * `/timing` is served by a different Worker. Locally `apps/main` forwards it; in
 * production Cloudflare's route does. Either way it is the same origin to the browser,
 * which is the property this arrangement exists to give.
 */

test.describe('the club website', () => {
  test('says a new site is coming, without promising when', async ({ page }) => {
    await page.goto('/');

    // The heading is the club's name; the banner above it does the welcoming. What this
    // test is really guarding is the next assertion — that no date is promised anywhere.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Southville Running Club',
    );
    await expect(page.locator('main')).toContainText('being built here');

    // When the new site replaces the old one is a committee decision, and a date invented
    // here would be a factual claim nobody authorised.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/,
    );
  });

  test('links to both things that already exist', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('link', { name: /Nightingale Nightmare/ }),
    ).toHaveAttribute('href', '/nn/');
    await expect(page.getByRole('link', { name: /Race timing/ })).toHaveAttribute(
      'href',
      '/timing',
    );
  });
});

test.describe('the banner that says which site this is', () => {
  // Both pages, not just the home page. `/nn/` is the one somebody reaches from a shared
  // link with no idea the club has two sites, and a test that only covered `/` would pass
  // while that page was a dead end.
  for (const [name, path] of [
    ['the home page', '/'],
    ['Nightingale Nightmare', '/nn/'],
  ] as const) {
    test(`${name} says it is unfinished and links to the club website`, async ({
      page,
    }) => {
      await page.goto(path);

      // **`.site-banner`, not `getByRole('banner')`.** The bar is a `div` on purpose — the
      // Nightingale Nightmare masthead is the page's one `banner` landmark and a second
      // would be an axe violation. So there is no role to select it by, which is the
      // trade-off working as intended rather than a weaker assertion.
      const banner = page.locator('.site-banner');

      // Says what is here, so nobody concludes the club's information has vanished. It no
      // longer claims the timing app: `/timing` is a holding page that says it is not open.
      await expect(banner).toContainText('We just have Nightingale Nightmare for now');
      await expect(banner).not.toContainText('race timing app');

      // Named as a destination. "Click here" would pass every automated check and tell a
      // screen-reader user nothing.
      const link = banner.getByRole('link', { name: 'the old site' });
      await expect(link).toHaveAttribute('href', 'https://southvillerunningclub.co.uk');
      await expect(link).toBeVisible();
    });
  }

  test('comes before the page content, not after it', async ({ page }) => {
    // A signpost below the fold is not a signpost. This asserts document order, which is
    // also the order a screen reader and a keyboard will meet it in.
    await page.goto('/nn/');

    const bannerIsBeforeMain = await page.evaluate(() => {
      const banner = document.querySelector('.site-banner');
      const main = document.querySelector('main');
      if (!banner || !main) return false;
      return (
        (banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });

    expect(bannerIsBeforeMain).toBe(true);
  });

  test('does not give Nightingale Nightmare a second banner landmark', async ({
    page,
  }) => {
    // The reason the bar is a `div`. Five pages carry the masthead, and `<header>` outside
    // `<main>` is the `banner` landmark — two of them is `landmark-no-duplicate-banner`.
    await page.goto('/nn/');

    await expect(page.getByRole('banner')).toHaveCount(1);
  });

  test('reaches /timing too, from the same words', async ({ page }) => {
    // **The assertion that the two front doors have not drifted.** `apps/main` is Astro and
    // `apps/timing` is Next, so the bar is two components; only `SITE_BANNER` in
    // `@src/shared/brand` keeps them saying the same thing. Nothing but a test that visits
    // both can prove that, because each app builds green on its own.
    //
    // It matters most here: before this, `/timing` imported the stylesheet and nothing else,
    // so somebody landing on it from a search had the club's colours and no route back to
    // the club at all.
    await page.goto('/timing');

    const banner = page.locator('.site-banner');
    await expect(banner).toContainText('We just have Nightingale Nightmare for now');
    await expect(banner.getByRole('link', { name: 'the old site' })).toHaveAttribute(
      'href',
      'https://southvillerunningclub.co.uk',
    );
  });
});

test.describe('the club wordmark', () => {
  // **One piece of artwork, painted by whichever stylesheet is in charge.** It was
  // `<img src="/logo.svg">` with `fill:#fff` baked into the file, which is why it could only
  // ever appear on the Nightingale Nightmare hero and why `/` and `/timing` had no logo. It
  // is inline `<svg>` filled with `currentColor` now, and these tests are what stop it
  // quietly going back to a colour of its own.
  for (const [name, path] of [
    ['the home page', '/'],
    ['the brand page', '/brand/'],
    ['race timing', '/timing'],
  ] as const) {
    test(`${name} carries the wordmark in the club's green`, async ({ page }) => {
      await page.goto(path);

      const mark = page.locator('.site-banner .site-logo');
      await expect(mark).toBeVisible();

      // The computed `color` is what the paths inherit as their fill. `#00c85a` is the
      // race-timing app's brand green, adopted 16 August 2026 (see
      // docs/foundations/race-timing-brand-guidelines.md) — the literal is pinned
      // deliberately, because reading it from the stylesheet the page already loaded asserts
      // nothing.
      await expect(mark).toHaveCSS('color', 'rgb(0, 200, 90)');

      const fills = await mark
        .locator('path')
        .evaluateAll((paths) => paths.map((p) => p.getAttribute('fill')));
      expect(fills.length).toBeGreaterThan(0);
      expect(fills.every((f) => f === 'currentColor')).toBe(true);
    });

    test(`${name} carries the full lockup, not the monogram`, async ({ page }) => {
      // **The assertion that keeps the two marks where they belong.** For part of
      // 16 August 2026 every surface rendered the "SRC" monogram, favicon included, because
      // the argument for it — a wordmark at 16px is an illegible smear — was true about the
      // favicon and got applied to everything. Three initials are what a tab strip needs and
      // are not what a header needs: a visitor who has arrived from a search has never seen
      // them before and a header has room for the club's name.
      //
      // The viewBox is what tells them apart in rendered markup — 876x267 is the club's own
      // PNG, 412.236x215.679 is `logo_src.pdf` — and it is pinned as a literal, because
      // reading it from `brand.ts` would let the two swap and still pass.
      await page.goto(path);

      const mark = page.locator('.site-banner .site-logo');
      await expect(mark).toHaveAttribute('viewBox', '0 0 876 267');
      await expect(mark.locator('path')).toHaveCount(2);
    });
  }

  test('appears exactly once on a Nightingale Nightmare page', async ({ page }) => {
    // **The campaign masthead already carries it.** Two elements with the accessible name
    // "Southville Running Club", pointing at two different addresses, is the same redundancy
    // `NnMasthead.astro` removed from the hero — so the bar keeps its sentence there and
    // drops its mark. `display: none` takes it out of the accessibility tree and out of the
    // tab order, which is what makes this a real fix rather than a visual one.
    await page.goto('/nn/');

    await expect(page.locator('.site-banner .site-logo')).toBeHidden();
    await expect(page.locator('.nn-masthead .nn-logo')).toBeVisible();

    // And it is the lockup here too. The campaign has its own type, its own colours and its
    // own everything else; the one thing it does not get its own version of is the club.
    await expect(page.locator('.nn-masthead .nn-logo')).toHaveAttribute(
      'viewBox',
      '0 0 876 267',
    );
    await expect(page.getByRole('img', { name: 'Southville Running Club' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'Southville Running Club' })).toHaveCount(
      1,
    );
  });

  test('is bone on the campaign hero, from the same artwork', async ({ page }) => {
    // The point of `currentColor`: the identical paths render in the campaign's colour here
    // and the club's green everywhere else, with no second file to drift.
    await page.goto('/nn/');

    await expect(page.locator('.nn-masthead .nn-logo')).toHaveCSS(
      'color',
      'rgb(255, 246, 236)',
    );
  });
});

test.describe('the browser-tab icon', () => {
  // **One file, one hostname, three paths.** `/timing` is a second Worker but not a second
  // site, so it points at the club's `/favicon.svg` rather than shipping a copy under
  // `/timing/`. Nothing about that is enforced by a framework — `basePath: '/timing'`
  // prefixes `next/link` and leaves `metadata` alone — so these assertions are what say the
  // arrangement still holds.
  for (const [name, path] of [
    ['the home page', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['race timing', '/timing'],
  ] as const) {
    test(`${name} points at the club's one favicon`, async ({ page }) => {
      await page.goto(path);

      const icon = page.locator('link[rel="icon"]');
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute('href', '/favicon.svg');
    });
  }

  test('is the monogram, which is the only place the monogram appears', async ({
    request,
  }) => {
    // **The other half of "the header carries the lockup".** Three initials are exactly
    // right at 16px and wrong everywhere else; the wordmark is the reverse. The viewBox is
    // what distinguishes the artwork, and this is the one asset that may hold `logo_src.pdf`'s.
    const response = await request.get('/favicon.svg');
    expect(response.status()).toBe(200);

    const svg = await response.text();
    expect(svg).toContain('viewBox="0 0 412.236 215.679"');
    expect(svg.match(/<path\b/g)).toHaveLength(3);

    // A static file cannot read a custom property, so the brand green is baked in here and
    // nowhere the apps render inline.
    expect(svg).toContain('#00c85a');

    // The standalone wordmark is the other file, and it is not this one.
    const logo = await (await request.get('/logo.svg')).text();
    expect(logo).toContain('viewBox="0 0 876 267"');
  });
});

test.describe('the footer the whole site carries', () => {
  // **Added to `/timing` here.** The club's front door grew a social row and this app did
  // not, so somebody who landed on the timing page from a search had the club's colours, the
  // club's banner and no route to anywhere the club actually posts. Both apps render it from
  // `SOCIAL_LINKS` in `@src/shared/social`; only the tags differ.
  const PROFILES = ['Instagram', 'Facebook', 'X', 'TikTok'] as const;

  for (const [name, path] of [
    ['the home page', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['race timing', '/timing'],
  ] as const) {
    test(`${name} offers the club's four profiles`, async ({ page }) => {
      await page.goto(path);

      const footer = page.locator('.site-footer');
      await expect(footer).toBeVisible();

      for (const profile of PROFILES) {
        // **Named, not "graphic".** The link's `aria-label` is the only text a screen reader
        // gets — the mark inside it is `aria-hidden` — so a missing label turns the row into
        // four unlabelled links, which is how an icon footer usually fails.
        const link = footer.getByRole('link', { name: profile, exact: true });
        await expect(link, `${path} -> ${profile}`).toHaveCount(1);
        await expect(link).toHaveAttribute('href', /^https:\/\//);
      }

      // The artwork takes its colour from the footer, the same rule the wordmark follows.
      const fills = await footer
        .locator('svg path')
        .evaluateAll((paths) => paths.map((p) => p.getAttribute('fill')));
      expect(fills).toHaveLength(PROFILES.length);
      expect(fills.every((f) => f === 'currentColor')).toBe(true);
    });

    test(`${name} has exactly one contentinfo landmark`, async ({ page }) => {
      // A `<footer>` inside `main` is generic; outside it, it is `contentinfo`. Both the home
      // page and the timing page sign off with their own footer *inside* `<main>`, so this is
      // the assertion that says the global one did not become a second landmark next to it.
      await page.goto(path);

      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveClass(/site-footer/);
    });
  }

  test('the two front doors say it in the same words, from one list', async ({
    page,
  }) => {
    // Astro on one side of the hostname and Next on the other, so the markup is written
    // twice and only `@src/shared/social` keeps the two in step. Nothing but a test that
    // visits both can prove it, because each app builds green on its own.
    const hrefsOn = async (path: string) => {
      await page.goto(path);
      return page
        .locator('.site-footer-social a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    };

    expect(await hrefsOn('/timing')).toEqual(await hrefsOn('/'));
  });
});

test.describe('Nightingale Nightmare, at /nn', () => {
  test('renders, and names the running it is about', async ({ page }) => {
    // **The database markers were on this page and are gone from every page.** This branch
    // had moved them here with the forms; `main` took them off pages altogether, to
    // `/_health` — see "the health endpoints" at the foot of this file.
    await page.goto('/nn/2026/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nightingale Nightmare 2026',
    );
  });

  test('states what is true of the race, and names no year', async ({ page }) => {
    // **The race page lost the facts list to the year page, and this is the assertion that
    // says so.** The date, the start time and race HQ are facts about *one running*: a page
    // about the race that stated them would be describing this year and calling it the race,
    // which is exactly what makes publishing 2027 an edit rather than a row.
    //
    // The literals are pinned rather than read from `race.json` — an expectation that reads
    // the page's own source asserts nothing.
    await page.goto('/nn/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).toContain('Nightingale Nightmare');
    expect(body).toContain('10 km, off-road');
    expect(body).toContain('250 places');

    expect(body).not.toContain('Sunday 1 November 2026');
    expect(body).not.toContain('BS3 2JL');
    expect(body).not.toContain('ARC permit');
  });

  test('the year page states the confirmed facts of its own running', async ({
    page,
  }) => {
    // **This test used to assert the opposite**, and the change is the point of it. Until
    // the date was confirmed the page stated no race facts at all, and the test guarded
    // that. The date, the start time, the distance and the HQ are now supplied, so the
    // assertion moves to what it was always really about: the page says what is known —
    // and it is now the page whose subject those facts actually are.
    await page.goto('/nn/2026/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).toContain('Sunday 1 November 2026');
    expect(body).toContain('11:00');
    expect(body).toContain('10 km, off-road');
    expect(body).toContain('BS3 2JL');
  });

  test('invents none of the facts that are still open', async ({ page }) => {
    // The other half, and the half that still matters most. **The entry fee and the
    // opening date belong to `entries.events` and `entries.fees`** — this site does not
    // quote a figure it does not own, and the mockup's "from £15" and "7am, Tue 1 September"
    // are exactly the plausible-looking values that would get here by being copied rather
    // than by being confirmed.
    for (const path of ['/nn/', '/nn/2026/']) {
      await page.goto(path);
      const body = (await page.locator('body').textContent()) ?? '';

      expect(body, path).not.toMatch(/£\s?\d/);

      // Live capacity is the entries application's business too. 250 is how big the race is;
      // "238 of 250 remaining" is demo data from the mockup and must not follow it here.
      expect(body, path).toContain('250 places');
      expect(body, path).not.toMatch(/\bof 250\b|places remaining/i);
    }

    // **The 2026 ARC permit has not been issued.** A number here would be last year's, and
    // it would read as a claim that this year's race is permitted. It is on the year page,
    // because a permit belongs to one running.
    await page.goto('/nn/2026/');
    const permit = page.getByRole('term').filter({ hasText: 'ARC permit' });
    await expect(permit).toHaveCount(1);
    await expect(
      page.locator('dt', { hasText: 'ARC permit' }).locator('+ dd'),
    ).toHaveText('To be confirmed');
  });
});

test.describe('the Nightingale Nightmare content pages', () => {
  /**
   * **One bar, five controls, identical on every page that carries it.**
   *
   * The first version of this nav had two rows, the second appearing only beneath a year —
   * which was the *routes* leaking into the interface. A runner does not care that race day
   * lives inside a year directory; they care where race day is. So the bar is the same five
   * things wherever they are standing, and only the current-page marker moves.
   *
   * **Two of the five are painted by the Worker** from `entries.current_entry_state('nn')`,
   * on every one of these pages rather than only on `/nn/`. The years below are literals:
   * reading them from `race.json` or from the database would make the expectation and the
   * page read the same source, which asserts nothing.
   */
  const NAV_LINKS = ['/nn/', '/nn/course/', '/nn/2026/race-day/', '/nn/2026/spectators/'];

  const NN_PAGES = [
    ['/nn/', 'Race', 'Nightingale Nightmare'],
    ['/nn/course/', 'Course', 'Course and terrain'],
    ['/nn/2026/', null, 'Nightingale Nightmare 2026'],
    ['/nn/2026/race-day/', 'Race day', 'Race day'],
    ['/nn/2026/spectators/', 'Spectators', 'Watching the race'],
  ] as const;

  for (const [path, navLabel, heading] of NN_PAGES) {
    test(`${path} renders, and its nav marks it as the current page`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);

      const nav = page.getByRole('navigation', { name: 'Nightingale Nightmare' });
      await expect(nav).toBeVisible();

      if (navLabel === null) {
        // **The year page is reached by the button, which is not in the list.** So the four
        // links carry no marker there, and that is the one page where none is right.
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
        return;
      }

      // **Exactly one link is current, and it is this page's.** Two would be a copied
      // component that was never re-pointed; none would be a path that stopped matching
      // after a rename, and neither shows up as anything a person would notice.
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

      // `exact` matters here: an accessible name is matched as a substring by default, so
      // "Race" also selects "Race day" and the assertion fails on a strict-mode violation
      // rather than on anything being wrong with the page.
      await expect(
        nav.getByRole('link', { name: navLabel, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });
  }

  test('one navigation landmark, and one list inside it', async ({ page }) => {
    // Two `<nav>` elements would be two landmarks a screen-reader user has to tell apart, for
    // one navigation that happens to wrap onto two rows at 320px.
    for (const path of ['/nn/2026/race-day/', '/nn/course/']) {
      await page.goto(path);

      await expect(
        page.getByRole('navigation', { name: 'Nightingale Nightmare' }),
        path,
      ).toHaveCount(1);
      await expect(page.locator('.nn-nav > ul'), path).toHaveCount(1);
    }
  });

  test('the bar offers the same five things from every page', async ({
    page,
    request,
  }) => {
    // A nav is the one component where a broken link is invisible from the page it is on.
    for (const [from] of NN_PAGES) {
      await page.goto(from);

      const hrefs = await page
        .getByRole('navigation', { name: 'Nightingale Nightmare' })
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

      expect(hrefs, from).toEqual(NAV_LINKS);

      // The fifth control. It is outside the navigation landmark because at 320px it shares
      // the wordmark's row, which means it has to be the wordmark's sibling — see the note in
      // `NnMasthead.astro`.
      const cta = page.locator('[data-nn-nav-cta]');
      await expect(cta, from).toBeVisible();
      await expect(cta, from).toHaveAttribute('href', '/nn/2026/');

      for (const href of [...hrefs, '/nn/2026/']) {
        expect((await request.get(href)).status(), `${from} -> ${href}`).toBe(200);
      }
    }
  });

  test('the button says what the destination can actually do', async ({ page }) => {
    // **Entries are shut in this project's seeded state**, so "Enter" would be a promise the
    // site cannot keep. The interest form is on the year page, which is exactly what the
    // label offers. `nn-entry.spec.ts` carries the open-state half.
    await page.goto('/nn/');

    const cta = page.locator('[data-nn-nav-cta]');
    await expect(cta).toHaveAttribute('aria-label', 'Register interest');

    // WCAG 2.5.3: the visible label has to appear in the accessible name, at both widths.
    const visible = (await cta.innerText()).trim();
    expect('Register interest'.toLowerCase()).toContain(visible.toLowerCase());
  });

  test('the header scrolls away with the page @requires-js', async ({ page }) => {
    // **This assertion is the reverse of the one it replaces.** The bar was sticky for one
    // slice; it cost a broken measurement harness, arrow-keyed radios hidden at 320px in
    // WebKit, and 207px of a 568px phone held permanently on pages people read and scroll.
    // What replaces it is the guard that it does not come back.
    for (const [width, height] of [
      [1280, 800],
      [320, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/nn/2026/race-day/');

      // **Not `toBe(0)`.** The cross-site banner sits above the masthead, so the header
      // starts below it rather than at the very top of the viewport — which is a fact about
      // the banner, not about stickiness. What matters is that it starts *on screen*.
      const before = await page.evaluate(
        () => document.querySelector('.nn-masthead')!.getBoundingClientRect().top,
      );
      expect(before, `starts on screen at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(before, `starts above the fold at ${width}px`).toBeLessThan(height / 2);

      await page.evaluate(() => window.scrollTo(0, 1200));
      const after = await page.evaluate(
        () => document.querySelector('.nn-masthead')!.getBoundingClientRect().top,
      );
      expect(after, `scrolled away at ${width}px`).toBeLessThan(-100);
    }
  });

  test('an anchor lands where it was aimed, with no scroll-margin propping it up', async ({
    page,
  }) => {
    // The `scroll-margin-top: 168px` on every `[id]` in the theme existed only to keep
    // anchors clear of the sticky bar. With the bar gone the rule is gone, and this is what
    // says the anchors did not go with it.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/nn/2026/');

    const margin = await page.evaluate(
      () => getComputedStyle(document.querySelector('h1')!).scrollMarginTop,
    );
    expect(margin).toBe('0px');
  });

  // -------------------------------------------------------------------------------------
  // The masthead
  // -------------------------------------------------------------------------------------
  // The navigation used to sit in the page flow, below the hero's buttons. It is a header
  // at the top of the page now, and these are the four properties that were argued for
  // rather than the ones that were easy to assert.
  // -------------------------------------------------------------------------------------

  test('the masthead is on the six pages that get it, and not the seventh', async ({
    page,
  }) => {
    // **`/nn/entry/complete/` keeps the wordmark and loses the links**, deliberately:
    // somebody has just paid and wants to know whether the club knows it, and four ways to
    // wander off is not what that page is for.
    for (const path of [
      '/nn/',
      '/nn/course/',
      '/nn/privacy/',
      '/nn/2026/',
      '/nn/2026/race-day/',
      '/nn/2026/spectators/',
    ]) {
      await page.goto(path);
      await expect(page.locator('.nn-masthead')).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Nightingale Nightmare' }),
      ).toBeVisible();
    }

    await page.goto('/nn/2026/entry/complete/');
    await expect(page.locator('.nn-masthead')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Nightingale Nightmare' }),
    ).toHaveCount(0);
    // The button goes with the links, and for the same reason: somebody who has just paid is
    // reading one paragraph, not choosing where to go next.
    await expect(page.locator('[data-nn-nav-cta]')).toHaveCount(0);
  });

  test('the wordmark is a link home, and there is exactly one of it', async ({
    page,
  }) => {
    // It moved out of the hero rather than being copied into the header. Two would mean
    // every page announced the club's name twice to anybody listening to it.
    for (const path of [
      '/nn/',
      '/nn/course/',
      '/nn/privacy/',
      '/nn/2026/entry/complete/',
    ]) {
      await page.goto(path);

      const mark = page.getByRole('link', { name: 'Southville Running Club' });
      await expect(mark).toHaveCount(1);
      await expect(mark).toHaveAttribute('href', '/nn/');

      // **No longer `img[alt=…]`.** The mark is inline `<svg>` now, filled with
      // `currentColor` rather than a separate white-only file — see the note in
      // `ClubLogo.astro`. It carries `aria-hidden` and `labelled={false}` deliberately: the
      // link above already has the accessible name, and a second one on the artwork inside
      // it would be exactly the double announcement this test exists to catch. So "exactly
      // one of it" is now the wordmark's *visual* count, not an `alt` count.
      await expect(page.locator('.nn-masthead .nn-logo')).toHaveCount(1);
      await expect(
        page.getByRole('img', { name: 'Southville Running Club' }),
      ).toHaveCount(0);
    }
  });

  test('"Skip to content" is still first, and still lands past the navigation', async ({
    page,
  }) => {
    // **This is the assertion the header had to earn.** The skip link points at `#main` and
    // has done since the skeleton; putting a navigation *inside* `<main>` would have left
    // the one control that exists to jump past the links landing in front of them, and
    // nothing already here would have noticed. The header is rendered into a slot outside
    // `<main>` for exactly this reason — see `Base.astro`.
    for (const path of ['/nn/', '/nn/course/', '/nn/privacy/']) {
      await page.goto(path);

      const first = page.locator('a').first();
      await expect(first).toHaveText('Skip to content');
      await expect(first).toHaveAttribute('href', '#main');

      // The target exists, and the navigation genuinely precedes it in the document.
      const landsPastTheNav = await page.evaluate(() => {
        const target = document.querySelector('#main');
        const nav = document.querySelector('.nn-nav');
        if (!target || !nav) return null;
        return Boolean(
          nav.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(landsPastTheNav, path).toBe(true);
    }
  });

  test('the header is a banner landmark, and the hero is not a second one', async ({
    page,
  }) => {
    // `<header>` maps to `banner` only when it is not inside `main`, `article`, `aside`,
    // `nav` or `section`. The hero is inside `<main>` and is therefore generic; the
    // masthead is outside it and is the page's one banner. Two would be an axe violation
    // and, worse, two landmarks a screen-reader user has to tell apart.
    await page.goto('/nn/');

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.locator('main .nn-masthead')).toHaveCount(0);
  });

  test('the loudest control offers the only thing this site can do', async ({ page }) => {
    // **This is the assertion that keeps a payment link off a site with no payment.** The
    // mockup's primary button is "Enter the race — from £15" — an unconfirmed price on a
    // control that goes to a checkout.
    //
    // The loudest control on `/nn/` is the panel's action, and while entries are shut it goes
    // to this year's page rather than to anything that takes money. The seeded state is shut,
    // which is what production serves.
    await page.goto('/nn/');

    const primary = page.locator('[data-nn-panel-action]');
    await expect(primary).toHaveText('The 2026 race');
    await expect(primary).toHaveAttribute('href', '/nn/2026/');
    await expect(primary).toHaveClass(/nn-ghost/);

    // Nothing anywhere on the page may lead somewhere that takes money.
    const hrefs = await page
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    for (const href of hrefs) {
      expect(href).not.toMatch(/stripe|checkout|pay|entr(y|ies)\b.*\.(com|co\.uk)/i);
    }
  });

  test('the content pages end with a call to action, and /nn/ does not', async ({
    page,
  }) => {
    // The panel exists because course, race day and spectators otherwise end with nothing
    // to do. `/nn/` has the form on it, so a panel there would only scroll somebody back
    // up to something they already walked past.
    // **Each panel points up one level, and none of them says whether entries are open.**
    // That sentence used to be printed into all three, and it becomes false the morning
    // entries open — silently, on a static page somebody is reading to decide whether to
    // enter. Whether they are open is answered at serve time, on the page each of these
    // points at.
    for (const [path, target] of [
      ['/nn/course/', '/nn/'],
      ['/nn/2026/race-day/', '/nn/2026/'],
      ['/nn/2026/spectators/', '/nn/2026/'],
    ] as const) {
      await page.goto(path);

      const panel = page.locator('.nn-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('link')).toHaveAttribute('href', target);

      const text = (await panel.textContent()) ?? '';
      expect(text, path).not.toMatch(/entries are (not )?open/i);
      expect(text, path).not.toMatch(/dare to enter/i);
    }

    await page.goto('/nn/');
    await expect(page.locator('.nn-panel')).toHaveCount(0);
  });

  test('the prize grid highlights whatever race.json says to @requires-js', async ({
    page,
  }) => {
    // Which tile is yellow is data, not a class written into the page — so the committee
    // can move the emphasis without a CSS change. Exactly one, or the accent means nothing.
    await page.goto('/nn/2026/race-day/');

    await expect(page.locator('.nn-prize')).toHaveCount(4);
    await expect(page.locator('.nn-prize-highlight')).toHaveCount(1);
    await expect(page.locator('.nn-prize-highlight dt')).toHaveText('Fancy dress');

    // Four tiles in a three-wide grid leave an orphan, so the floor is set to make it a
    // 2x2. **The viewport is pinned**, because the answer is width-dependent by design:
    // one column on a phone is the same rule working, not a different one, and asserting
    // "2" from whatever viewport the project happens to use tests the device instead.
    await page.setViewportSize({ width: 1100, height: 900 });
    const wide = await page
      .locator('.nn-prizes')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(wide).toBe(2);

    // And the floor must not overflow a card narrower than itself — `min(240px, 100%)`.
    await page.setViewportSize({ width: 320, height: 640 });
    const narrow = await page
      .locator('.nn-prizes')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(narrow).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });

  test('the hero fog stops for anyone who asked for no motion @requires-js', async ({
    page,
  }) => {
    // **The fog stops rather than disappears**, which is the distinction worth asserting:
    // `animation: none` leaves the same wash at the same opacity, so a reader with the
    // preference set gets the same page rather than a different-looking one.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/nn/');

    const fog = await page.locator('.nn-hero').evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      return { animationName: style.animationName, opacity: style.opacity };
    });

    expect(fog.animationName).toBe('none');
    expect(fog.opacity).toBe('0.3');
  });

  test('the content pages state the facts they were given, and no others', async ({
    page,
  }) => {
    await page.goto('/nn/2026/race-day/');
    const raceDay = (await page.locator('body').textContent()) ?? '';

    // The schedule, which is the reason this page exists.
    for (const time of ['09:15', '10:15', '10:30', '10:45', '11:00']) {
      expect(raceDay).toContain(time);
    }
    expect(raceDay).toContain('BS3 2JL');

    await page.goto('/nn/2026/spectators/');
    const spectators = (await page.locator('body').textContent()) ?? '';
    expect(spectators).toContain('BS8 3PL');
    expect(spectators).toContain('Brunel Lock Road');

    await page.goto('/nn/course/');
    const course = (await page.locator('body').textContent()) ?? '';
    expect(course).toContain('No headphones of any type');
    expect(course).toContain('Trail shoes are recommended');

    // **The 2023 lines that are false for 2026, on every one of the three.** The clocks go
    // back on 25 October and this race is 1 November, a week later; the transfer deadline
    // and the entry-opening time are the entries application's and are unconfirmed anyway.
    for (const text of [raceDay, spectators, course]) {
      expect(text).not.toMatch(/clocks change/i);
      expect(text).not.toMatch(/£\s?\d/);
      expect(text).not.toMatch(/transfer/i);
      expect(text).not.toMatch(/sells out/i);
    }

    // **The 2023 copy was a pre-race email and this is not.** It opens "Commiserations on
    // entering" and signs off "next Sunday morning" — written to people who had already
    // entered, days out. These pages are read months out by somebody deciding whether to
    // enter at all, so nothing may assume either.
    for (const text of [raceDay, spectators, course]) {
      expect(text).not.toMatch(/commiserations/i);
      expect(text).not.toMatch(/next sunday/i);
      expect(text).not.toMatch(/\bwitching hour\b/i);
    }
  });

  test('the start is given as a place of its own, distinct from HQ', async ({ page }) => {
    // **The one fact somebody most needs on the morning**, and the club has published it
    // exactly once — as a `goo.gl` shortlink, which Google has been retiring. The
    // coordinates are `race.json`'s now and the link is built from them, so the answer
    // survives the shortener.
    await page.goto('/nn/2026/race-day/');

    const body = (await page.locator('body').textContent()) ?? '';

    // Both places are named, and the page says plainly that they are not the same one.
    expect(body).toContain('51.4468588, -2.6250503');
    expect(body).toContain('BS3 2JL');
    expect(body).toMatch(/not at race HQ/i);

    // The map link is generated from the stored coordinates, and is not a shortlink.
    const map = page.getByRole('link', { name: 'show it on a map' });
    await expect(map).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=51.4468588,-2.6250503',
    );

    // **No third-party map is embedded.** A link is somebody's choice to follow; an iframe
    // is an unassessed tracker on the page most likely to be opened on race morning.
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('a shortened map link never reaches a page', async ({ page }) => {
    // The failure this guards is a later edit pasting the convenient thing back in.
    for (const path of [
      '/nn/',
      '/nn/course/',
      '/nn/2026/',
      '/nn/2026/race-day/',
      '/nn/2026/spectators/',
    ]) {
      await page.goto(path);

      const hrefs = await page
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

      for (const href of hrefs) {
        expect(href, `${path} -> ${href}`).not.toMatch(
          /goo\.gl|maps\.app\.goo\.gl|bit\.ly|tinyurl/i,
        );
      }
    }
  });

  test('the facts recovered from the club’s own 2023 page are on the day plan', async ({
    page,
  }) => {
    // These are the club's words about things that do not change year to year, so they are
    // safe to state. Anything not on that list stays off the page — the entry price, the
    // deadline for passing a place on, and the 2026 permit number are all still open, and
    // the assertions above are what keep them off.
    await page.goto('/nn/2026/race-day/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).toMatch(/bag drop at HQ and another one at the start/i);
    expect(body).toMatch(/changing areas/i);
    expect(body).toMatch(/lift-share/i);
    expect(body).toMatch(/no on-street parking/i);
    expect(body).toMatch(/upstairs at HQ/i); // the fancy-dress photograph
    expect(body).toMatch(/hot chocolate/i);
    expect(body).toMatch(/baked\s+by club volunteers/i);
    expect(body).toMatch(/donation tin/i);
    expect(body).toMatch(/warm and dry/i);
  });
});

test.describe('race timing, at /timing', () => {
  test('is reachable on the same origin as the website', async ({ page, baseURL }) => {
    // The assertion the whole path-based arrangement exists for: a second Worker,
    // answering on one hostname, with no cross-origin hop and no redirect away.
    await page.goto('/');
    const websiteOrigin = new URL(page.url()).origin;

    await page.getByRole('link', { name: /Race timing/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
    expect(new URL(page.url()).origin).toBe(websiteOrigin);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test('is styled, so basePath is doing its job', async ({ page }) => {
    // Without `basePath: '/timing'` the app serves but its assets 404, and it arrives
    // unstyled and half-broken — the failure that looks like a CSS bug and is not.
    await page.goto('/timing');

    const background = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('the health endpoints', () => {
  // **Both round trips, still checked, at an address no runner is ever sent to.**
  //
  // `intake.health()` says a Worker can reach Supabase at all. `intake.ping()` was added
  // *after* the first deploy, so it says a migration went through the whole path — CI's scope
  // guard, `supabase db push` on merge, and a deploy of both applications. Checking both from
  // both applications is what proves the two are talking to **one** project, which is the
  // arrangement ADR-002 chose and the thing that would fail silently if a second appeared.
  //
  // `request` rather than `page`: these are endpoints, and going through a browser would only
  // add a renderer to something that answers JSON. It also means they run in the
  // scripting-disabled project unchanged.
  for (const [name, path] of [
    ['the website', '/_health'],
    ['race timing', '/timing/health'],
  ] as const) {
    test(`${name} reports both database round trips`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');

      expect(await response.json()).toMatchObject({
        ok: true,
        database: { ok: true },
        pipeline: { ok: true, value: 'pipeline-ok' },
      });
    });

    test(`${name} reports the hour in Europe/London`, async ({ request }) => {
      // The one assertion worth making about the *content* of the timestamp. Nightingale
      // Nightmare is raced the weekend after the clocks go back, and an endpoint reporting
      // UTC as though it were local is the drift this repository has a whole module to stop.
      const { database } = await (await request.get(path)).json();

      expect(database.at).toMatch(/Z$/);
      expect(database.formatted).toMatch(/\d{1,2} \w+ \d{4} at \d{2}:\d{2} (GMT|BST)/);
    });
  }
});

test.describe('accessibility', () => {
  for (const [name, path] of [
    ['the website', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['the course page', '/nn/course/'],
    ['the privacy notice', '/nn/privacy/'],
    ['the 2026 race', '/nn/2026/'],
    ['the race-day page', '/nn/2026/race-day/'],
    ['the spectators page', '/nn/2026/spectators/'],
    ['the return page', '/nn/2026/entry/complete/'],
    ['race timing', '/timing'],
    // **The brand page earns its place in this list more than any other page here.** It is
    // the only one that renders every token, on every surface, at body size — so a colour
    // that fails is caught by axe whether or not any real page happens to use it yet.
    ['the brand page', '/brand/'],
  ] as const) {
    test(`${name} has zero axe violations @requires-js`, async ({ page }) => {
      // Zero, not "few". Any threshold above zero becomes the new normal within a month,
      // and 70% of visitors are on a phone.
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(violations).toEqual([]);
    });

    test(`${name} is operable at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});

test.describe('what does not exist', () => {
  test('404s a page that has not been built', async ({ page }) => {
    const response = await page.goto('/membership/');

    expect(response?.status()).toBe(404);
  });
});
