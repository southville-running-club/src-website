import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectNoSidewaysScroll } from '../sideways-scroll';

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

    // **Scoped to `main`, since the navigation arrived.** These two links are also in the
    // bar now, so an unscoped `getByRole` matches twice and Playwright refuses in strict
    // mode. Narrowing to the page's own content is the right answer rather than picking a
    // `.first()`: this test is about what the home page *says*, and the bar has its own.
    const content = page.locator('main');

    await expect(
      content.getByRole('link', { name: /Nightingale Nightmare/ }),
    ).toHaveAttribute('href', '/nn/');
    await expect(content.getByRole('link', { name: /Race timing/ })).toHaveAttribute(
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

/**
 * The bar between the parts of this site.
 *
 * **The rule worth guarding is where it is *not*.** Nightingale Nightmare's pages carry their
 * own bar, stuck to the top, whose height is paid for by a hand-written `scroll-padding-top`
 * token per breakpoint — [ADR-014]. A second bar above it moves every anchor and every keyboard
 * focus behind the header at every width, with nothing visibly wrong, which is the defect that
 * record exists to answer. `Base.astro` keys the club bar off `theme`, and the test below is
 * what says so out loud.
 *
 * The bar-height sweep further down this file is the other half: it measures the campaign bar
 * against its token at nine widths, and would go red if anything here reached those pages.
 */
test.describe('the bar between the parts of this site', () => {
  const SECTIONS = [
    ['Home', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['Race timing', '/timing'],
    ['Account', '/account/'],
  ] as const;

  for (const [name, path] of [
    ['the home page', '/'],
    ['the privacy notice', '/privacy/'],
  ] as const) {
    test(`${name} offers every part of the site`, async ({ page }) => {
      await page.goto(path);

      const nav = page.getByRole('navigation', { name: 'Southville Running Club' });
      await expect(nav).toBeVisible();

      for (const [label, href] of SECTIONS) {
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'href',
          href,
        );
      }
    });
  }

  test('marks the section being read, and only that one', async ({ page }) => {
    await page.goto('/privacy/');

    const nav = page.getByRole('navigation', { name: 'Southville Running Club' });

    // `aria-current` rather than a class alone: the underline tells a sighted reader where
    // they are, and without the attribute nobody else is told at all.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

    await page.goto('/');
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Home');
  });

  test('**stays off the campaign pages**, which have their own bar', async ({ page }) => {
    // The ADR-014 rule, asserted where somebody would break it. A club bar here is not a
    // cosmetic mistake — it is 40-odd pixels above a sticky header whose inset is a
    // hand-written constant, so every anchor on the page lands behind it.
    for (const path of ['/nn/', '/nn/privacy/', '/nn/2026/']) {
      await page.goto(path);

      await expect(page.locator('.site-nav')).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Nightingale Nightmare' }),
      ).toBeVisible();

      // And they are not stranded by that: the wordmark has been the route home since the
      // masthead was written, which is why no tab is needed and no height is spent.
      await expect(page.locator('.nn-masthead-mark')).toHaveAttribute('href', '/');
    }
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

    // **The number as well as the label, now that there is a number.** Asserting the label
    // alone was enough while `race.json`'s `permit` was `null` — there was nothing to leak.
    // A permit belongs to one running exactly as the date does, so a year's number reaching
    // this evergreen page would be the same defect as the date reaching it, and the label
    // check would miss it the moment somebody quoted the number in a sentence instead of a
    // `<dt>`. See ADR-011.
    expect(body).not.toContain('ARC/26/0842');
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

  test('invents none of the facts that are still open', async ({ page }, testInfo) => {
    // The other half, and the half that still matters most. **The entry fee belongs to
    // `entries.fees`** — this site does not quote a figure it does not own, and the mockup's
    // "from £15" and "7am, Tue 1 September" are exactly the plausible-looking values that
    // would get here by being copied rather than by being confirmed.
    //
    // **That principle is unchanged; the assertion enforcing it got sharper.** It used to
    // forbid `£` on both pages outright, which was right while the fee was unsettled. Now the
    // committee has settled it, the year page states it — so this asserts the figure shown is
    // **exactly** the one the database produced, which is a tighter guard than "no figure at
    // all": an invented price fails this, and so does a stale one, whereas the old assertion
    // would have passed just as happily on a page that had lost the fee entirely.
    for (const path of ['/nn/', '/nn/2026/']) {
      await page.goto(path);
      const body = (await page.locator('body').textContent()) ?? '';

      // 250 is how big the race is, on both pages, always.
      expect(body, path).toContain('250 places');

      if (path === '/nn/') {
        // **Still true on the evergreen page, and only there.** No live count, because a
        // page that names no year has no one running's capacity to count against — the same
        // rule the date and the ARC permit follow — and because a stale cached copy of this
        // page is exactly the "wrong within a day, cached at the edge" claim the entry
        // year's own page accepts for a good reason and this one still does not.
        expect(body, path).not.toMatch(/\bof 250\b|places (remaining|left)/i);
        expect(body, path).not.toMatch(/£\s?\d/);
        continue;
      }

      // Dearest first, straight from `entry_state()`'s `order by fee.price_pence desc`. The
      // £0 guide's place is absent because `feeLine` drops free places.
      expect(body, path).toContain('£20.00 unaffiliated · £18.00 affiliated');
      expect(body, path).not.toMatch(/£15|£17|from £/);

      // **The one live count on the site, and only on the entry form.** Fetched by the
      // enhancement script rather than rendered by the Worker, so this waits for it rather
      // than reading the DOM synchronously the way the rest of this test does — a fixed
      // number here would be exactly the fragile literal `nn-entry-complete.spec.ts`'s own
      // "a real session id reveals nothing" test warns against, and the shape is the thing
      // that is actually being promised.
      // **Guarded rather than tagged, because the rest of this test is worth running with
      // scripting off.** The element ships `hidden` and empty in the markup and is filled by
      // a `fetch` in `NnEntryForm.astro`'s island — the Worker deliberately does not render
      // it, so that the year page stays cacheable and only the figure is fetched per viewer.
      // With `javaScriptEnabled: false` that fetch never runs, so this assertion cannot pass
      // in the `no-javascript` project rather than merely being slow there. Tagging the whole
      // test `@requires-js` would have been the smaller diff and would have taken the fee and
      // "250 places" assertions above out of the one project whose whole point is that they
      // hold without scripting.
      if (testInfo.project.name !== 'no-javascript') {
        await expect(page.locator('[data-entry-places-remaining]')).toContainText(
          /^\d+ places? left$/,
        );
      }
    }
  });

  test('quotes the ARC permit number on the running it was issued for', async ({
    page,
  }) => {
    // **This test used to assert the opposite, and that is the whole of what changed.** The
    // permit was `null` and the assertion here was that the page said "To be confirmed";
    // ARC/26/0842 was issued on 27 August 2026, so the assertion becomes what it was always
    // really guarding — that the page states the number it is required to state.
    //
    // **A permit number that silently stops rendering is a compliance defect that looks like
    // nothing on the page**, which is why this is pinned rather than hoped for. ARC print the
    // requirement on the permit itself: "Please quote Permit Number on race entry forms and
    // advertising material." This is the advertising half; `nn-entry.spec.ts` has the form
    // half, and the two together are what satisfy it.
    //
    // The literal is pinned rather than read from `race.json` — an expectation that reads the
    // page's own source asserts nothing, which is the same rule the race date follows above.
    await page.goto('/nn/2026/');

    const permit = page.getByRole('term').filter({ hasText: 'ARC permit' });
    await expect(permit).toHaveCount(1);
    await expect(
      page.locator('dt', { hasText: 'ARC permit' }).locator('+ dd'),
    ).toHaveText('ARC/26/0842');
  });

  test('states the entry fee from the database, with entries still shut', async ({
    page,
  }) => {
    // **The cell ships as "To be confirmed" and the Worker paints over it**, so this asserts
    // the wiring rather than the markup: `race.json`'s `price` is `null` and must stay null,
    // because `entries.fees.price_pence` is what `create_pending_purchase()` actually charges
    // and a second copy in the page is how the two start disagreeing.
    //
    // **Asserted while the window is shut**, which is the state production is in and the state
    // this fixes. The fee is a fact about the race, not a property of the form — somebody
    // deciding whether to come in the months before entries open is exactly who needs it, and
    // "To be confirmed" was wrong for them from the day the committee settled £18 and £20.
    //
    // The £0 guide's place is deliberately absent: `feeLine` drops free places, because "Free"
    // beside two prices reads as an offer anybody can take.
    await page.goto('/nn/2026/');

    const fee = page.locator('dt', { hasText: 'Entry fee' }).locator('+ dd');

    // **Dearest first**, which is `entry_state()`'s `order by fee.price_pence desc` reaching
    // the page unchanged — `feeLine` keeps the order it is handed rather than imposing one.
    await expect(fee).toHaveText('£20.00 unaffiliated · £18.00 affiliated');
    await expect(fee).not.toHaveText(/To be confirmed/);
    await expect(fee).not.toContainText('Free');
  });
});

test.describe('the Nightingale Nightmare content pages', () => {
  /**
   * **One bar, three controls, identical on every page that carries it.**
   *
   * The first version of this nav had two rows, the second appearing only beneath a year —
   * which was the *routes* leaking into the interface. A runner does not care that race day
   * lives inside a year directory; they care where race day is. So the bar is the same things
   * wherever they are standing, and only the current-page marker moves.
   *
   * **It was six, then five, and it is three.** `Course` came out with the page it pointed at;
   * `Race info` and `Spooktators` came out on request. What is left inside the `<nav>` is the
   * two evergreen links below, plus the masthead's button — which is now the **only** painted
   * control in the header and the only one anywhere in it that names a year.
   *
   * **So this array no longer says anything about the Worker's painting, and that is a loss
   * rather than a simplification.** It used to hold two hrefs that ship empty and are filled in
   * from `entries.current_entry_state('nn')`, so an unpainted year link failed here loudly. Both
   * hard-coded links survive a database that cannot be reached, which means everything below
   * would pass with the painting broken. What still covers it: `nn-nav.test.ts` walks every href
   * in the bar looking for a year that arrived without being painted, and the button's own href
   * is asserted in the round trip below. `NnNav.astro`'s `running` list is still there and still
   * empty, so putting a link back is one entry there and one row here.
   *
   * **A `Course` entry put back into this list would *pass* everything below it.** The course
   * and terrain are on `/nn/` itself now and `/nn/course/` 301s there, and Playwright follows
   * redirects: the href fetched at the foot of the round-trip test would answer 200, and the bar
   * would simply be offering `/nn/` twice under two labels. The test that refuses it is "the bar
   * no longer offers the course page", which matches on the label and the href rather than on a
   * status.
   *
   * **`Privacy` is the last of them and the newest — ADR-014.** It is last rather than first
   * because the race links read as a set and a legal notice dropped into the middle of that set
   * breaks it. That set is one link now, so the ordering argument has less to bite on than it
   * did — but the order is still the decision, and `NAV_LINKS` is order-sensitive so it is
   * asserted here rather than merely intended.
   */
  const NAV_LINKS = ['/nn/', '/nn/privacy/'];

  const NN_PAGES = [
    ['/nn/', 'Race', 'Nightingale Nightmare'],
    ['/nn/2026/', null, 'Nightingale Nightmare 2026'],
    // **A `null` label means the bar has no entry for this page**, and three of these five rows
    // are that now. `Race info` and `Spooktators` came out of the bar on request, so
    // `/nn/2026/race-day/` and `/nn/2026/spectators/` are pages the bar cannot mark: there is no
    // link in it for `aria-current` to sit on, and putting one on `Race` would be marking a page
    // the reader is not on.
    //
    // **The rows stay rather than coming out**, because what they buy is not the marker. Both
    // pages still answer 200, both still carry the bar, and both are still rendered here and
    // swept by axe below. Dropping them would have stopped exercising the two pages whose chrome
    // changed most, on the argument that the chrome stopped naming them.
    //
    // **`/nn/2026/spectators/` is linked from nowhere at all now** — its content was absorbed
    // into `/nn/2026/` as an on-page `#spooktators` section — so this row and the axe row are
    // the only things that open the page. The address still resolves and is still the one
    // anybody has linked to; that it has no inbound link is recorded in `NnNav.astro` as a
    // decision somebody should take deliberately rather than a defect to fix here.
    //
    // The heading is still worth pinning on both: the race director renamed the pages and
    // neither address moved, so `race-day` is headed **"Race instructions"** and `spectators`
    // **"Spooktators"**. The bar/heading split that used to be asserted by the middle column is
    // documented in `NnNav.astro`, and there is no bar label left here to drift from it.
    ['/nn/2026/race-day/', null, 'Race instructions'],
    ['/nn/2026/spectators/', null, 'Spooktators'],
    // **The notice is a content page of the campaign now, and it is tested as one.** It was
    // absent from this list for as long as the bar did not link to it — so the one page whose
    // header could not say where you were was also the one page whose header nothing here
    // asserted. Both halves of that are fixed by the same line.
    ['/nn/privacy/', 'Privacy', 'What the club does with your details'],
  ] as const;

  for (const [path, navLabel, heading] of NN_PAGES) {
    // **The title names which of the two cases this row is.** Three of the five are now the
    // case where nothing is marked, and one title claiming otherwise for all five would read
    // as three failures somebody had not got round to.
    const title =
      navLabel === null
        ? `${path} renders, and its nav marks nothing`
        : `${path} renders, and its nav marks it as the current page`;

    test(title, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);

      const nav = page.getByRole('navigation', { name: 'Nightingale Nightmare' });
      await expect(nav).toBeVisible();

      if (navLabel === null) {
        // **Nothing in the bar is about this page, so nothing in it may be marked.** For
        // `/nn/2026/` that has always been true — it is reached by the button, which is not in
        // the list. For the two pages after it, it is true since `Race info` and `Spooktators`
        // came out: the pages are still here and still carry the bar, and the bar simply no
        // longer names them. A marker appearing on any of the three would be a link about
        // somewhere else claiming to be where the reader is standing.
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
        return;
      }

      // **Exactly one link is current, and it is this page's.** Two would be a copied
      // component that was never re-pointed; none would be a path that stopped matching
      // after a rename, and neither shows up as anything a person would notice.
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

      // `exact` is kept although nothing left in the bar collides with either name. An
      // accessible name is matched as a substring by default, and "Race" selected "Race info"
      // for as long as that label was here — the assertion then failed on a strict-mode
      // violation rather than on anything being wrong with the page. A label put back beside
      // "Race" would re-create that, and this is the line that would report it.
      await expect(
        nav.getByRole('link', { name: navLabel, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });
  }

  test('one navigation landmark, and one list inside it', async ({ page }) => {
    // Two `<nav>` elements would be two landmarks a screen-reader user has to tell apart, for
    // one navigation that happens to wrap onto two rows at 320px.
    for (const path of ['/nn/2026/race-day/', '/nn/privacy/']) {
      await page.goto(path);

      await expect(
        page.getByRole('navigation', { name: 'Nightingale Nightmare' }),
        path,
      ).toHaveCount(1);
      await expect(page.locator('.nn-nav > ul'), path).toHaveCount(1);
    }
  });

  test('the bar offers the same three things from every page', async ({
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

      // The third control, and since the two year links came out it is the only one in the
      // header that is painted and the only one that names a year — so this is the whole of
      // what the round trip still proves about the Worker. It is outside the navigation
      // landmark because at 320px it shares the wordmark's row, which means it has to be the
      // wordmark's sibling — see the note in `NnMasthead.astro`.
      const cta = page.locator('[data-nn-nav-cta]');
      await expect(cta, from).toBeVisible();
      await expect(cta, from).toHaveAttribute('href', '/nn/2026/');

      for (const href of [...hrefs, '/nn/2026/']) {
        expect((await request.get(href)).status(), `${from} -> ${href}`).toBe(200);
      }
    }

    // **And the plainest statement of what the bar now is, said once and by name.** The loop
    // above is about hrefs and proves they are the same everywhere; nothing in it says what a
    // reader is actually offered, which is two links called Race and Privacy. Asserted on
    // `/nn/` because the loop is what proves the bar is one component rendered identically.
    //
    // **By accessible name and by position, not by `href`.** The names are what a reader hears
    // and are the half `NAV_LINKS` cannot see, and the count is what refuses a third link
    // arriving without anybody arguing for the row it might cost — the bar's height is
    // `scroll-padding-top`'s problem, and that inset is a hand-written number per breakpoint.
    await page.goto('/nn/');

    const bar = page
      .getByRole('navigation', { name: 'Nightingale Nightmare' })
      .getByRole('link');

    await expect(bar).toHaveCount(2);
    await expect(bar.nth(0)).toHaveAccessibleName('Race');
    await expect(bar.nth(1)).toHaveAccessibleName('Privacy');
  });

  test('the bar no longer offers the course page', async ({ page }) => {
    // **The assertion the round trip above cannot make.** `/nn/course/` answers 301 to `/nn/`,
    // and every check in this file that follows an href follows that redirect: the fetch at the
    // foot of the test above would report 200, `toEqual(NAV_LINKS)` would only notice because
    // the array is written out by hand, and a browser sent there would land on a page that
    // renders perfectly. A `Course` entry put back into the bar is therefore not a broken link —
    // it is a second door to the page you are already on, which is exactly the kind of defect
    // nothing goes red for.
    //
    // So this matches on the two things the redirect cannot launder: the label a reader sees and
    // the href in the markup. Scoped to the bar and asserted on `/nn/` alone because the bar is
    // the same component everywhere and the test above is what proves that.
    await page.goto('/nn/');

    const nav = page.getByRole('navigation', { name: 'Nightingale Nightmare' });

    await expect(nav.getByRole('link', { name: 'Course', exact: true })).toHaveCount(0);
    await expect(nav.locator('a[href="/nn/course/"]')).toHaveCount(0);

    // And not from the masthead's button either, which is the one control in the header that is
    // outside the navigation landmark.
    await expect(page.locator('[data-nn-nav-cta]')).not.toHaveAttribute(
      'href',
      '/nn/course/',
    );
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

  test('the header stays on screen once the page is scrolled @requires-js', async ({
    page,
  }) => {
    // **This assertion has now been written in both directions, and the history is the reason
    // it is worth reading.** The bar was sticky; ADR-012 unstuck it and this test asserted it
    // scrolled away; ADR-014 sticks it back because reaching the navigation from anywhere on a
    // long page is the requirement. The three defects ADR-012 recorded are paid for rather than
    // disputed — the note at the head of the masthead section in `nn-theme.css` says how — and
    // the two tests below are two of the three payments.
    for (const [width, height] of [
      [1280, 800],
      [320, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/nn/2026/race-day/');

      // **Not `toBe(0)`.** The cross-site banner sits above the masthead, so the header starts
      // below it rather than at the very top of the viewport — which is a fact about the
      // banner, not about stickiness.
      const before = await page.evaluate(
        () => document.querySelector('.nn-masthead')!.getBoundingClientRect().top,
      );
      expect(before, `starts on screen at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(before, `starts above the fold at ${width}px`).toBeLessThan(height / 2);

      // **Past the end, and polled rather than read once.** The bar is sticky *below* the
      // cross-site banner, so until the banner has scrolled away the bar sits at the banner's
      // height — 92px — which is correct behaviour and indistinguishable from "not sticky" if
      // the scroll fell short. A literal 1200 assumed every engine had that much page: mobile
      // safari on a Linux runner did not, landed short, and reported the bar at 92 as though
      // stickiness had broken.
      //
      // A large number rather than `documentElement.scrollHeight`, because which element
      // reports the scrollable height differs on a touch-emulating context and reading the
      // wrong one scrolls nowhere. The browser clamps to its own maximum, so overshooting is
      // exact. Polled because `scrollTo` returns before the position has settled.
      const bannerHeight = await page.evaluate(
        () => document.querySelector('.site-banner')?.getBoundingClientRect().height ?? 0,
      );

      await page.evaluate(() => window.scrollTo(0, 1_000_000));

      // And this says so when it is the scroll that failed rather than the bar. Without it the
      // failure reads as a stickiness bug on a page that simply never moved.
      await expect
        .poll(() => page.evaluate(() => window.scrollY), {
          message: `${width}px: the page scrolled past its ${bannerHeight}px banner`,
        })
        .toBeGreaterThan(bannerHeight);

      const after = await page.evaluate(
        () => document.querySelector('.nn-masthead')!.getBoundingClientRect().top,
      );
      expect(after, `pinned to the top at ${width}px`).toBeLessThanOrEqual(1);
      expect(after, `still on screen at ${width}px`).toBeGreaterThanOrEqual(-1);

      // **And the links are still usable, not merely still in the layout.** A bar pinned under
      // the cross-site banner, or clipped to nothing, would satisfy the arithmetic above.
      const race = page
        .getByRole('navigation', { name: 'Nightingale Nightmare' })
        .getByRole('link', { name: 'Race', exact: true });
      await expect(race, `reachable at ${width}px`).toBeInViewport();
    }
  });

  test('the stuck bar never covers what a scroll was aimed at, at any width', async ({
    page,
  }) => {
    // **Defect 2 of ADR-012's three, and the rule that pays for it.** The bar being stuck means
    // anything the browser scrolls into view can land underneath it — a fragment target, or the
    // radio that focus has just moved to with an arrow key. `scroll-margin-top` on every `[id]`
    // was the previous attempt and could only ever help the first of those. `scroll-padding-top`
    // on the **scrollport** covers both, which is why the theme sets it on `<html>`.
    //
    // **A sweep rather than two widths, and that is the point of this test.** The inset is a
    // hand-written number per breakpoint, and the bar has three heights: one row, two rows
    // where the mark, the five links and the button cannot share a line, and three rows below
    // 480px where the button lifts. The 480px boundary was measured for *four* links, so a
    // token that stepped straight from the one-row value to the three-row one would have been
    // too small across a band of tablet widths — with nothing visibly wrong, and every anchor
    // on those screens landing under the header. Checking 1280 and 320 would have passed.
    //
    // **Two properties over two different sets of widths, and the second set is measured rather
    // than reasoned about.** Clearing the bar has to hold *everywhere*. Tracking it closely can
    // only be asked at the widths where the bar is as tall as its regime ever gets, because the
    // token is one number per regime and the wrap points inside a regime are font metrics rather
    // than anything this repository sets.
    //
    // The heights, re-measured on chromium and webkit at seventeen widths after #147 took the
    // bar to four controls, are what pick this set:
    //
    //   width   bar      token   note
    //   -----------------------------------------------------------------------------
    //   1280    62.5px   64px    one row — the regime's tallest
    //   900     62.5px   64px    one row
    //   768     62.5px   64px    one row
    //   700     62.5px   64px    one row
    //   640     62.5px   64px    one row
    //   560     62.5px   64px    one row — and the last width before the compact layout
    //   480    105.3px  136px    compact — 101.2px on mobile-safari. Slack, deliberately
    //   400    105.3px  136px    compact — slack
    //   320    105.3px  136px    compact — 100.1px on mobile-safari. Slack, and not tracked
    //
    // **The middle regime is gone, and that is the change.** With five labels the bar wrapped to
    // two rows somewhere between 640px and 700px, which is what `--nn-masthead-height`'s 112px
    // value and its `max-width: 768px` block existed for. Four labels share one line all the way
    // down to 480px, so there is now no width at which the bar is ~110px — and the block was
    // still reserving 112px across that whole span, giving a 120px inset against a 62.5px bar.
    // It cleared, and tracked nothing, which is exactly what the second property below catches.
    //
    // **The compact regime has one height now, not two — but its token stays at 136px, and
    // 320px is no longer tracked.** It had two heights because five labels fit one row at 400px
    // and wrapped at 320px; four fit at every compact width, so 105.3px holds from 480px down
    // and 136px is now ~31px of slack.
    //
    // Tightening it is not available. That inset is also what gives the entry form's fee cards
    // room to shift without leaving the screen, and 112px moved the chosen card 3.4px off the
    // top at 320px on CI's Linux chromium — `nn-entry.spec.ts`'s "keeps the entry type that was
    // chosen in view" caught it. The two requirements pull opposite ways and the bar is not the
    // one that decides, so this width is asserted to *clear* and no longer to *track*.
    //
    // A fifth control brings both regimes back. Re-measure rather than restoring these numbers:
    // where labels wrap is a font metric, not something this repository sets.
    const TIGHT = new Set([1280, 900, 640, 560]);

    await page.goto('/nn/2026/race-day/');

    for (const width of [1280, 900, 768, 700, 640, 560, 480, 400, 320]) {
      await page.setViewportSize({ width, height: 640 });

      const measured = await page.evaluate(() => {
        const bar = document.querySelector('.nn-masthead')!;
        return {
          barHeight: bar.getBoundingClientRect().height,
          padding: Number.parseFloat(
            getComputedStyle(document.documentElement).scrollPaddingTop,
          ),
        };
      });

      // The safety property. Under the bar's height is the defect.
      expect(
        measured.padding,
        `${width}px: scroll-padding-top ${measured.padding} must clear a ${measured.barHeight}px bar`,
      ).toBeGreaterThanOrEqual(measured.barHeight);

      // And the tightness, at the widths that are deep inside a regime. A number that is merely
      // generous everywhere stops tracking the bar, and then nothing notices when the bar
      // changes. 40px is one link row plus the 8px the focus ring needs — enough headroom for
      // the three engines to disagree about a line box, not enough to hide a missing breakpoint.
      if (TIGHT.has(width)) {
        expect(
          measured.padding,
          `${width}px: scroll-padding-top ${measured.padding} still tracks a ${measured.barHeight}px bar`,
        ).toBeLessThanOrEqual(measured.barHeight + 40);
      }

      // **And the bar is bounded.** ADR-012's loudest number was 207px of a 568px phone — 36%
      // of it, held for the whole page. A quarter of the viewport is the ceiling this slice
      // accepts: enough for three rows at 320px, and it fails rather than creeps if a seventh
      // control is added without the height being argued again.
      expect(
        measured.barHeight,
        `${width}px: the stuck bar is at most a quarter of a 640px viewport`,
      ).toBeLessThanOrEqual(160);
    }
  });

  test('an anchor lands clear of the bar rather than under it', async ({ page }) => {
    // The other half of the same payment, end to end rather than by arithmetic. `#register` is
    // a real fragment on a real page — the hero points at it while entries are shut — so this
    // follows the link somebody actually follows.
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await page.goto('/nn/2026/#register');

      // The interest form ships visible in the seeded, closed window — which is what production
      // serves. Asserting it before measuring means a page that stopped rendering it fails here,
      // saying so, rather than in the arithmetic below on a rectangle of zeroes.
      await expect(page.locator('#register'), `${width}px`).toBeVisible();

      // **Wait for the fragment jump to land before measuring it.** A `goto` with a hash
      // returns once the document is ready, not once the browser has finished scrolling to the
      // target — so reading `scrollY` on the next line races it and sometimes reads 0. CI had
      // already flagged this test flaky on mobile-safari for that reason; measured locally the
      // scroll settles at 1913px (1280) and 1063px (320), so the poll below waits for a real
      // value rather than sleeping a guessed number of milliseconds.
      await expect
        .poll(() => page.evaluate(() => window.scrollY), {
          message: `${width}px: the fragment jump never moved the page`,
        })
        .toBeGreaterThan(0);

      const landed = await page.evaluate(() => {
        const bar = document.querySelector('.nn-masthead')!.getBoundingClientRect();
        const heading = document.querySelector('#register')!.getBoundingClientRect();
        return {
          barBottom: bar.bottom,
          headingTop: heading.top,
          scrolled: window.scrollY,
        };
      });

      // The page has to have scrolled, or the assertion below passes on a heading that was
      // already on screen and proves nothing about the bar.
      expect(
        landed.scrolled,
        `${width}px: the page scrolled to the fragment`,
      ).toBeGreaterThan(0);
      expect(
        landed.headingTop,
        `${width}px: the heading landed below the stuck bar, not under it`,
      ).toBeGreaterThanOrEqual(landed.barBottom - 1);
    }
  });

  // -------------------------------------------------------------------------------------
  // The masthead
  // -------------------------------------------------------------------------------------
  // The navigation used to sit in the page flow, below the hero's buttons. It is a header
  // at the top of the page now, and these are the four properties that were argued for
  // rather than the ones that were easy to assert.
  // -------------------------------------------------------------------------------------

  test('the masthead is on the five pages that get it, and not the sixth', async ({
    page,
  }) => {
    // **`/nn/entry/complete/` keeps the wordmark and loses the links**, deliberately:
    // somebody has just paid and wants to know whether the club knows it, and a row of ways to
    // wander off is not what that page is for. The bar is two links and a button now rather
    // than the five this was written against, and the argument is unchanged by the count.
    for (const path of [
      '/nn/',
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
    for (const path of ['/nn/', '/nn/privacy/', '/nn/2026/entry/complete/']) {
      await page.goto(path);

      const mark = page.getByRole('link', { name: 'Southville Running Club' });
      await expect(mark).toHaveCount(1);

      // **`/`, the club — not `/nn/`.** A wordmark in the top-left corner conventionally
      // means home, and it used to mean "the page the first link in the bar already goes
      // to". That left the campaign with no route out to the club: the cross-site banner
      // drops its own mark on these pages precisely because this one is here.
      await expect(mark, path).toHaveAttribute('href', '/');

      // And the name says where it goes, because "Southville Running Club" read out of a
      // link list is the club's name rather than a destination.
      await expect(mark, path).toHaveAccessibleName('Southville Running Club, home');

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
    for (const path of ['/nn/', '/nn/privacy/', '/nn/2026/']) {
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

  test('the panel’s action looks like a button on the aubergine', async ({ page }) => {
    // **A ghost button has no fill, so its border is the whole of what identifies it.** This
    // test was written when the year panel was a white `.nn-card` and the button was drawing
    // that border in bone at 1.06:1 — a legible label with no visible edge, WCAG 1.4.11.
    //
    // **The card is the campaign's aubergine now and the button is pus**, asked for as a colour
    // that complements the purple. So the pairing this pins has changed twice and the reason has
    // not: bone was wrong on white at 1.06:1, blood is wrong on aubergine at 1.72:1, and pus is
    // 9.37:1 on it — the same measured token the panel's note already uses. `.nn-ghost`'s own
    // rule stays bone, because it is drawn on the gradient for the hero; this is scoped to
    // `.nn-panel-year` so recolouring one cannot break the other, which is the trap the
    // stylesheet records beside both.
    //
    // **This is here rather than in the accessibility sweep because axe cannot see it.**
    // `color-contrast` inspects text, and the text was never the problem. `/nn/` reported zero
    // violations for as long as the button was invisible, so zero violations is not the guard —
    // this is. `nn-contrast.test.ts` guards the same pairing from the stylesheet's side.
    await page.goto('/nn/');

    const action = page.locator('[data-nn-panel-action]');

    // `#f2c41d` — the campaign's pus, at 9.37:1 on the aubergine for the edge and the label
    // alike. The literal is pinned rather than read from the stylesheet the page already loaded,
    // because an expectation that reads its own subject asserts nothing.
    await expect(action).toHaveCSS('border-top-color', 'rgb(242, 196, 29)');
    await expect(action).toHaveCSS('color', 'rgb(242, 196, 29)');

    // And it is still an *outline* rather than a fill, which is what keeps the two states of
    // this panel different in weight. A filled action here would say "enter" on a page where
    // entries are shut — the dishonesty the test above exists to prevent, in colour.
    const filled = await action.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(filled);

    // The border is thick enough to be the signal it is being asked to be.
    await expect(action).toHaveCSS('border-top-width', '2px');
  });

  test('the hero’s ghost button keeps the colour the gradient needs', async ({
    page,
  }) => {
    // **The other half of the fix, and the reason it is scoped to `.nn-card` rather than to
    // `.nn-ghost`.** Recolouring the class outright would have made this one blood-on-blood —
    // the identical defect facing the other way, on the page that takes the money.
    await page.goto('/nn/2026/');

    // **Scoped to the hero, and left scoped deliberately.** The button read "Race-day plan" and
    // was unique on this page; it is "Race instructions" since the rename, which is also the
    // race-day page's heading. It happens to be unique here again — the bar used to say "Race
    // info" beside it and says nothing about race day at all now — but this test is about the
    // gradient behind *this* button, and a locator that only works while nothing else on the
    // page carries the same name is one an unrelated copy edit turns into a strict-mode failure
    // that reads as a styling bug.
    const ghost = page
      .locator('.nn-herobtns')
      .getByRole('link', { name: 'Race instructions' });
    await expect(ghost).toHaveCSS('border-top-color', 'rgb(255, 246, 236)');
    await expect(ghost).toHaveCSS('color', 'rgb(255, 246, 236)');
  });

  test('the content pages end with a call to action, and /nn/ does not', async ({
    page,
  }) => {
    // The panel exists because race day and spectators otherwise end with nothing to do.
    // **Each panel points up one level, and neither of them says whether entries are open.**
    // That sentence used to be printed into both, and it becomes false the morning
    // entries open — silently, on a static page somebody is reading to decide whether to
    // enter. Whether they are open is answered at serve time, on the page each of these
    // points at.
    //
    // **There were three, and the course page was the one that pointed at `/nn/`.** Its panel
    // went with it: the course and terrain are a section of `/nn/` now, and a call to action at
    // the foot of a page inviting somebody up to the page they are already on is the "anchor to
    // nothing" defect one step along.
    for (const [path, target] of [
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

    // **`/nn/` has no closing panel, and it can no longer be asserted by counting `.nn-panel`.**
    // A card at the foot of this page briefly existed and was taken out again: the year panel
    // answers the same question with the date attached, so the two were one destination twice
    // on one page, in one colour, a screen apart.
    //
    // **The count is one rather than zero because the year panel now carries `.nn-panel`
    // itself.** It moved off the white `.nn-card` onto the campaign's aubergine, which is the
    // same surface these closing panels use — so `toHaveCount(0)`, which is what this test
    // asserted for most of its life, would now fail on a page that is correct. What is actually
    // meant is "the only panel here is the year panel", and that is what is asserted: one
    // `.nn-panel`, and it is the one carrying `.nn-panel-year`.
    await page.goto('/nn/');
    await expect(page.locator('.nn-panel')).toHaveCount(1);
    await expect(page.locator('.nn-panel')).toHaveClass(/nn-panel-year/);
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
    await expectNoSidewaysScroll(page, 'the prize grid at 320px');
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

    // **The schedule, which is the reason this page exists — each time against the thing it
    // labels.** This was five `toContain`s on bare time strings, and a bare string proves only
    // that the characters are somewhere in the page: `10:30` passed whether it labelled the
    // briefing or the walk, and it would have passed with the two **swapped**. On the one page
    // somebody reads on the morning to find out whether they are late, a row pointing at the
    // wrong event is the defect that would actually cost somebody their race — and it was the
    // defect this assertion could not see.
    //
    // **`nth` rather than a lookup, so the order is asserted too.** The morning is a sequence
    // and the page reads down it; a schedule with the right pairs in the wrong order is still
    // wrong. The literals are pinned rather than read from `race.json`, because an expectation
    // that reads its own subject asserts nothing.
    const SCHEDULE = [
      ['09:15', /Registration opens at HQ/],
      ['10:30', /Race briefing at HQ/],
      ['10:40', /Walk to the start together/],
      ['10:50', /Group warm-up at the start/],
      ['11:00', /The race starts/],
      ['Afterwards', /Prizegiving at HQ once the last finisher is in/],
    ] as const;

    const rows = page.locator('.nn-schedule-row');
    await expect(rows).toHaveCount(SCHEDULE.length);

    for (const [index, [time, what]] of SCHEDULE.entries()) {
      await expect(rows.nth(index).locator('dt'), time).toHaveText(time);
      await expect(rows.nth(index).locator('dd'), time).toContainText(what);
    }

    expect(raceDay).toContain('BS3 2JL');

    await page.goto('/nn/2026/spectators/');
    const spectators = (await page.locator('body').textContent()) ?? '';
    expect(spectators).toContain('BS8 3PL');
    expect(spectators).toContain('Brunel Lock Road');

    // **There was a third page here and it was the course page**, asserted on the headphone
    // rule and on "Trail shoes are recommended". Both sentences moved to `/nn/` on 29 August
    // 2026 and both assertions moved with them — the club supplied that page's copy in full as
    // the wording `/nn/` should carry, so nothing was summarised and nothing was left behind.
    // They are below, in "the safety facts survive the race director's copy" and "the course
    // page's copy is on /nn/ in full, and each sentence once".
    //
    // **The shoe line is the one worth naming here.** `NnRaceSummary`'s bullet said "Trail
    // shoes recommended" and the course page said "Trail shoes are recommended" — one word
    // apart, and while both pages existed the component was what stopped them meeting. The
    // supplied copy is the course page's spelling, the summary is rendered on no page at all
    // now, and the guard below is that the bullet's spelling has not come back beside it.

    // **The 2023 lines that are false for 2026, on both of them.** The clocks go back on
    // 25 October and this race is 1 November, a week later; the transfer deadline and the
    // entry-opening time are the entries application's and are unconfirmed anyway.
    for (const text of [raceDay, spectators]) {
      expect(text).not.toMatch(/clocks change/i);
      expect(text).not.toMatch(/£\s?\d/);
      expect(text).not.toMatch(/transfer/i);
      expect(text).not.toMatch(/sells out/i);
    }

    // **The 2023 copy was a pre-race email and this is not.** It opens "Commiserations on
    // entering" and signs off "next Sunday morning" — written to people who had already
    // entered, days out. These pages are read months out by somebody deciding whether to
    // enter at all, so nothing may assume either.
    for (const text of [raceDay, spectators]) {
      expect(text).not.toMatch(/commiserations/i);
      expect(text).not.toMatch(/next sunday/i);
      expect(text).not.toMatch(/\bwitching hour\b/i);
    }
  });

  /**
   * Whitespace, squashed, because these assertions match sentences rather than elements.
   *
   * Prettier wraps markup at the print width and `compressHTML` collapses what is left, so a
   * sentence written across two source lines arrives with a newline in the middle of it. A
   * `toContain` on the raw `textContent` then fails on copy that is perfectly correct — the same
   * trap `admin-html.test.ts` squashes for, one framework along.
   */
  const squashed = async (page: Page, path: string): Promise<string> => {
    await page.goto(path);
    return ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  };

  test('the safety facts survive the race director’s copy, and sit under it', async ({
    page,
  }) => {
    // **This is the assertion the copy slice was written around.** The brief it came from asked
    // for two paragraphs of the race director's prose *instead of* the section that carries the
    // headphone rule, the trail-shoe advice, the climb, the water station and "the start is not
    // at race HQ". Doing that would have stripped five safety-relevant facts off `/nn/` silently.
    //
    // **The section under her copy has changed three times, and on 30 August 2026 two of the
    // five facts changed with it.** It was "Know what you are in for" and `NnRaceSummary`'s five
    // bullets; then, from 29 August 2026, the course page's own prose in full; now the club's
    // rewrite of that. This test does not know or care which is rendering — it asserts the
    // facts, in the wording the page actually carries, which is what it was always for.
    //
    // **What moved, so a later reader can tell a shortening from a regression.** The climb was
    // "Nightingale Valley is the climb."; it is "plenty of elevation" now, and the valley is
    // named once on the page — in the race director's paragraph — rather than twice. The water
    // station was two, one at halfway and one at the finish, and the finish one is not in the
    // new wording. Both were the club's own edits rather than losses to be quietly restored, and
    // putting either back is a change to the page and to this test together.
    //
    // **The headphone rule is not decoration.** ARC's rules carry no headphone provision, but
    // Rule 81 lets an organiser make additional rules binding on competitors as though they were
    // ARC's own — on a course Rule 83(3) shares with the public. It is the club's rule, it is
    // enforceable, and it does not come off a page in a copy edit. **The 30 August wording asks
    // where the previous one forbade** — "please do not wear headphones" against "No headphones
    // of any type during the race" — which changes how it is put, not whether it binds.
    const body = await squashed(page, '/nn/');

    // Her two paragraphs, in her spelling — "10km off road" unhyphenated, an ampersand, and
    // "spooktators" lower case here and capitalised as a page name in the bar.
    expect(body).toContain("'Spooktacular' Nightingale Nightmare Halloween Run is back!");
    expect(body).toContain('tricked & treated');
    expect(body).toContain('Halloween fancy dress is strongly encouraged!');

    // And all five facts, four of which the brief would have taken with the heading. Each is
    // matched at the length the page states it, so a further shortening fails here rather than
    // sliding under a substring that happens to survive it.
    expect(body).toContain('Trail shoes are a good option if you have them.');
    expect(body).toContain('plenty of elevation');
    expect(body).toContain('please do not wear headphones of any type during race.');
    expect(body).toContain('a water station approximately half way through');
    expect(body).toContain('The start/finish line is not at the HQ.');

    // **A welcome first, then the five things that are true whether or not anybody is pleased
    // about them.** Order is asserted because the argument for keeping both was that they do
    // different jobs; landing the warning above the greeting would mean neither did. An absent
    // headphone rule gives `-1` here, which fails rather than passing vacuously.
    expect(body.indexOf('is back!')).toBeLessThan(body.indexOf('do not wear headphones'));
  });

  test("the club's course copy is on /nn/, and each sentence once", async ({ page }) => {
    // **`/nn/course/` was absorbed into this page on 29 August 2026; the club supplied the whole
    // of that page as the wording `/nn/` should carry, and on 30 August 2026 replaced it with a
    // shorter rewrite.** The history is worth keeping straight, because this test has asserted
    // three different wordings now: first the *remainder* the five bullets did not already
    // state, then the course page's prose in full, now the club's rewrite of it. Each time the
    // words changed and the job of the test did not.
    //
    // **The rewrite is shorter, and the shortening is the club's.** "Where it goes" and "What it
    // is like underfoot" are gone as headings, the route sentence with them; the marshals' prize
    // and the water station at the finish are not restated. That is theirs to decide. What this
    // test still refuses is a sentence appearing *twice*.
    //
    // **The counting is the part to keep if anything here is ever trimmed again.** Putting
    // `NnRaceSummary` back above this section — one line, and it would look like restoring a
    // summary rather than duplicating a warning — prints the headphone rule and the climb a
    // second time, ten lines apart, and every `toContain` in this file goes on passing. A
    // duplicate satisfies a `toContain`; it is only ever visible to a count.
    const body = await squashed(page, '/nn/');

    const occurrences = (text: string): number => body.split(text).length - 1;

    // The opening claim, and the ground under it, in the supplied wording.
    expect(body).toContain('This is a tough off-road run with plenty of elevation.');
    expect(body).toContain(
      'The ground is uneven with rocks and roots and can be slippery if there has been rainfall.',
    );

    // Both shoe sentences. The second is the one a summary would flatten away.
    expect(body).toContain('Trail shoes are a good option if you have them.');
    expect(body).toContain('Road shoes will be fine too.');

    // The marshalling and the water station are one sentence in this wording, where they were
    // two bullets before — so it is matched whole rather than as two halves that could drift.
    expect(body).toContain(
      'The route is fully marshalled with a water station approximately half way through.',
    );

    // **The line that stops somebody driving to the wrong place on the morning.** It has been
    // `NnRaceSummary`'s bullet, the course page's sentence and now the club's, and it has never
    // once been absent — which is why it is asserted in both tests rather than only this one.
    expect(body).toContain('The start/finish line is not at the HQ.');

    // And the two a restored summary would print a second copy of.
    expect(occurrences('please do not wear headphones of any type during race.')).toBe(1);

    // **Nightingale Valley is named once on this page now, and the count is the whole point.**
    // It used to be twice — the race director's paragraph and the course copy's route sentence,
    // a duplication this file argued about and then accepted. The rewrite drops the second, so
    // hers is the only one; a restored summary, or a route sentence written back in, takes this
    // to two and fails here rather than passing quietly.
    expect(occurrences('Nightingale Valley')).toBe(1);

    // **The shoe line is the near miss, and the wordings are a word apart.** The page carries
    // "Trail shoes are a good option if you have them."; the bullet's is "Trail shoes
    // recommended, road shoes acceptable." and the superseded course copy's was "Trail shoes are
    // recommended." Matching the bullet's comma is what tells them apart — a bare "Trail shoes
    // recommended" is a substring of neither sentence on the page, so it would read as a guard
    // and assert nothing about which wording is there.
    expect(occurrences('Trail shoes are a good option')).toBe(1);
    expect(body).not.toContain('Trail shoes recommended,');
    expect(body).not.toContain('Trail shoes are recommended.');

    // **The 2023 provenance guards, inherited from the course page's leg of "the content pages
    // state the facts they were given, and no others".** That copy is on this page now, so the
    // assertions that kept its assumptions off follow it here rather than being dropped with the
    // page. The clocks go back a week before this race; the transfer deadline and the entry
    // window belong to one running and to the entries application.
    expect(body).not.toMatch(/clocks change/i);
    expect(body).not.toMatch(/transfer/i);
    expect(body).not.toMatch(/sells out/i);
    expect(body).not.toMatch(/commiserations/i);
    expect(body).not.toMatch(/next sunday/i);
    expect(body).not.toMatch(/\bwitching hour\b/i);
  });

  test('the climb is stated to somebody about to enter, not one tap away', async ({
    page,
  }) => {
    // **The shape of the course is what a runner decides on, and it was on one page.**
    // `/nn/course/` said Nightingale Valley is the climb; `/nn/2026/`, which carries the entry
    // form, said what the ground is like and what shoes to wear and nothing about the hill. So
    // somebody could read every word in front of the form and not know the race climbs a valley.
    //
    // **`/nn/2026/` left on 29 August 2026.** It was here because the summary card on that page
    // carried `NnRaceSummary`'s bullets; the race director's full instructions replaced that
    // card, and her copy describes a tough course with plenty of elevation without naming the
    // valley as the climb. **So the page with the entry form on it no longer says the race
    // climbs a valley** — which is the gap this test was written to close, reopened deliberately
    // rather than by accident. Two sentences from her would shut it again and the path comes
    // back.
    //
    // **And `/nn/course/` left the same day, because it is not a page any more.** It 301s here,
    // so leaving it in this list would have run every assertion below against `/nn/` twice under
    // a name that says otherwise — which is the vacuous kind of green, not the red kind. A list
    // of one is kept rather than unrolled because what left and when is the readable part.
    //
    // **The 30 August 2026 rewrite weakened what this test protects, and that is the club's
    // call rather than a regression to repair.** Three sentences it asserted are in the
    // shortening and none survives on the page: "Nightingale Valley is the climb.", "There is no
    // clever way to run it — go up steadily", and "It is Bristol, in November. Plan for wet." —
    // the last being the line that made the shoe advice advice rather than trivia. What is
    // asserted below is what the page actually states, so this stays a guard with teeth instead
    // of being deleted along with the sentences it named.
    for (const path of ['/nn/']) {
      const body = await squashed(page, path);

      // The club's wording of the climb, which is now a general claim rather than a named one.
      expect(body, path).toContain('plenty of elevation');

      // **And the valley is still named on the page — in the race director's paragraph, not in
      // a sentence calling it the climb.** Across the two a reader still learns that the route
      // goes up it and that there is plenty of elevation, which is the fact this test exists
      // for; it is stated in two paragraphs now rather than in one sentence. If that stops
      // being true, this is where it shows.
      expect(body, path).toContain('up Nightingale Valley');
    }
  });

  test("/nn/ says where the race goes, once, in the race director's wording", async ({
    page,
  }) => {
    // **This guard has now reversed twice, and both reversals were decisions rather than
    // repairs. The history is the valuable part, so none of it is tidied away.**
    //
    // It began as "one route, one spelling per page": the race director's own paragraph names
    // the towpath, Nightingale Valley and Leigh Woods, so when `/nn/course/` was absorbed on
    // 29 August 2026 its "Where it goes" sentence was the one line chosen not to come with it,
    // and this test was what stopped a later paste putting it back.
    //
    // **Then the club supplied the course page's copy in full and asked for it as it stands**,
    // route sentence included — so for one day `/nn/` stated the route twice, in two wordings,
    // on purpose. That was not the rule being forgotten but the rule being overruled by the
    // people whose copy it is, which is the only thing that may overrule it.
    //
    // **The 30 August 2026 rewrite drops that section's route sentence**, so the page is back to
    // one wording and this test is back to its original shape. Asserting the absence is what
    // makes the withdrawal recorded rather than accidental: the next person to write a route
    // sentence into that section finds out here that the duplication was tried deliberately and
    // then taken out again.
    //
    // **The gap the old note named is still open.** `/nn/2026/` carries the entry form and
    // states the ground, the shoes, the water and the start, and not the route — so the page
    // somebody pays from still does not say where the race goes.
    const race = await squashed(page, '/nn/');

    // Hers, in her spelling: "10km off road" unhyphenated, no comma before "up".
    expect(race).toContain(
      'A 10km off road run along the towpath, up Nightingale Valley and through Leigh Woods.',
    );

    // And the club's second wording of the same route, which is not on the page any more.
    expect(race).not.toContain(
      'The route runs along the towpath, turns up Nightingale Valley, and carries on through Leigh Woods.',
    );
  });

  test('the water station says where it is, wherever it is mentioned', async ({
    page,
  }) => {
    // **The fact somebody rations a bottle against.** It read "one water station on the route"
    // with no location on every page that stated it; approximately halfway is the race
    // director's confirmation. It was on three pages and this asserted all three at once, which
    // is what stopped them drifting.
    //
    // **`/nn/2026/` left on 29 August 2026.** The race director's copy says there is one water
    // station on the route and another at the finish; it does not say where. "Approximately
    // halfway" was her own confirmation and it is the number somebody rations a bottle against,
    // so its absence from the entry page is a loss rather than a tidy-up.
    //
    // **The course page left the same day, and it is the reason there is nothing left to drift
    // against.** Its copy is a section of `/nn/` now, so that section is the only place on the
    // site this sentence is stated and the one page below is every page that states it. Left as
    // a list because the shrinking is the history — and `/nn/course/` could not stay in it: it
    // 301s to `/nn/`, so it would have asserted this page twice.
    //
    // **The 30 August 2026 rewrite changed both halves of this sentence and kept the fact.** It
    // read "One water station on the route at approximately halfway, and one at the finish."; it
    // is "a water station approximately half way through" now, run together with the marshalling
    // into one sentence. Two things moved with it: the station at the finish is no longer
    // stated, and "halfway" is two words. **The location is what this test is named for**, and
    // it survives — so what is matched below is that half, at the new spelling.
    for (const path of ['/nn/']) {
      const body = await squashed(page, path);

      expect(body, path).toContain('water station approximately half way through');
    }
  });

  test('/nn/ has one footer, and it is the club’s', async ({ page }) => {
    // The page's own footer read "each year's running has its own, linked above", and the link
    // it meant is the year panel — which ships `hidden` and is revealed only when the Worker can
    // reach the database. On the failure path the sentence pointed at nothing, in prose, on the
    // front door. **The panel is the wayfinding**, and prose describing a link that may not be
    // there is worse than no prose: a reader who cannot find it assumes the fault is theirs.
    const body = await squashed(page, '/nn/');
    expect(body).not.toContain('linked above');

    // **The rest of that footer has gone into the club's, which reverses the line below it.**
    // This asserted `toContain('Southville Running Club.')` on the argument that the attribution
    // is what every footer on this site opens with. `/nn/2026/` made the same move first and the
    // same argument went with it: the club's name is the masthead's wordmark above and the club
    // footer's own subject below, so a third statement of it sat between two others. The page
    // now has exactly one `<footer>` — it had two stacked, which is the thing that move removed.
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.locator('footer.site-footer')).toBeVisible();

    // The race's own links, grouped under its name so the race's privacy notice is not a second
    // link called almost the same thing as the club's.
    const group = page.locator('.site-footer-links');
    await expect(
      group.getByRole('link', { name: 'What the club does with your details' }),
    ).toHaveAttribute('href', '/nn/privacy/');
    await expect(group.getByRole('link', { name: /@/ })).toHaveAttribute(
      'href',
      /^mailto:/,
    );

    // **Two links here where `/nn/2026/` has three, and that is the point of the optional
    // prop.** The entry terms are at `/nn/<year>/terms/` and this page may not name a year, so
    // it passes no `terms` and the row renders without it. A year reaching this markup is the
    // failure `nn-nav.test.ts` and `nn-entry.test.ts` guard from their own angles.
    await expect(
      group.getByRole('link', { name: 'Entry terms and race rules' }),
    ).toHaveCount(0);
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
      '/nn/privacy/',
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
    // safe to state. Anything not on that list stays off the page — the entry price is the
    // database's rather than this file's, and the deadline for passing a place on is still
    // open, and the assertions above are what keep them off. **The 2026 permit number is no
    // longer on that list**: it was issued on 27 August 2026 and it is quoted on the year
    // page and on the entry form, which is where ARC ask for it. It is still off this page,
    // because race-day instructions are neither of those things.
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

// -------------------------------------------------------------------------------------------
// Where the course page used to live
// -------------------------------------------------------------------------------------------

/**
 * **`/nn/course/` has been published since the race pages were written, and a printed address
 * that 404s is worse than one that is out of date.** The course and terrain are a section of
 * `/nn/` now — the club supplied that page's copy in full as the wording `/nn/` should carry,
 * so the reader arrives at the whole of what they clicked for rather than a summary of it — and
 * the address keeps resolving, as a 301.
 *
 * The status, both spellings, the headers and the query string are the Worker suite's, in
 * `tests/worker/serves.test.ts`, and the predicate's letters are `tests/unit/routing.test.ts`'s.
 * **What only a browser can say is that the journey ends somewhere useful**: that a reader who
 * followed a link off a poster lands on a page with the course on it, rather than on a redirect
 * that resolves and drops them somewhere that no longer answers what they clicked for.
 *
 * The same shape as `admin.spec.ts`'s "the addresses that moved", for the same reason.
 */
test.describe('the address the course page used to live at', () => {
  test('follows an old link through to the section it moved into', async ({ page }) => {
    const response = await page.goto('/nn/course/');

    // **The final URL, and it is `/nn/` rather than `/nn`.** `trailingSlash` is `'always'`, so a
    // redirect to the unslashed form would resolve too — via a second hop from the assets
    // binding, which is a hop this Worker can spend nothing on and a reader pays for.
    await expect(page).toHaveURL(/\/nn\/$/);

    // **That it redirected rather than answered**, which is the assertion the URL alone cannot
    // make: a `dist/nn/course/index.html` that quietly came back would satisfy everything else
    // here and put a second copy of this content on the site.
    const before = response?.request().redirectedFrom();
    expect(before, 'the old address must redirect rather than answer').toBeTruthy();
    expect((await before!.response())?.status()).toBe(301);

    // And it lands on the content, not merely on a page that renders. A redirect to `/nn/` from
    // which the course section had been dropped would be a reader delivered to nothing.
    await expect(
      page.getByRole('heading', { name: 'The course and terrain' }),
    ).toBeVisible();
  });
});

test.describe('race timing, at /timing', () => {
  test('is reachable on the same origin as the website', async ({ page, baseURL }) => {
    // The assertion the whole path-based arrangement exists for: a second Worker,
    // answering on one hostname, with no cross-origin hop and no redirect away.
    await page.goto('/');
    const websiteOrigin = new URL(page.url()).origin;

    // Scoped to `main` since the navigation arrived — the bar carries this link too, and an
    // unscoped match is two elements. The bar's own link is covered by its own test; this one
    // is about the hop between two Workers on one origin, so either would do and the page's
    // own content is the one that was always meant.
    await page
      .locator('main')
      .getByRole('link', { name: /Race timing/ })
      .click();

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
  // **The course page was here and is not replaced.** It 301s to `/nn/` since 29 August 2026, so
  // a row for it would run axe against `/nn/` a second time under a name that says otherwise —
  // and the page it now redirects to is the row above. Every other Nightingale Nightmare page
  // that carries the campaign chrome is still in this list, and `/nn/2026/terms/` has the same
  // two checks in `nn-terms.spec.ts`.
  for (const [name, path] of [
    ['the website', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['the club privacy notice', '/privacy/'],
    ['the race privacy notice', '/nn/privacy/'],
    ['the 2026 race', '/nn/2026/'],
    ['the race instructions', '/nn/2026/race-day/'],
    ['the spooktators page', '/nn/2026/spectators/'],
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

      await expectNoSidewaysScroll(page, `${name} at 320px`);
    });
  }
});

test.describe('what does not exist', () => {
  test('404s a page that has not been built', async ({ page }) => {
    const response = await page.goto('/membership/');

    expect(response?.status()).toBe(404);
  });
});
