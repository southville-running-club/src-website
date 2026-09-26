import { expect, test } from '@playwright/test';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * The four club pages the navigation links to.
 *
 * ⚠️ **`/events/` is deliberately not here.** It still carries the socials list and becomes
 * the races-and-events hub in the next change. `club-chrome.spec.ts` covers the header, Menu
 * and footer on every club page; this file is about what the pages themselves say.
 *
 * ## What it is actually guarding
 *
 * Half of these assert **absence**, which is the half that is easy to skip and expensive to
 * miss. The rule is *"never ship a placeholder"*, and a placeholder does not announce itself:
 * `[confirm]` reads as a tag somebody meant to leave, `undefined` reads as a gap, and a
 * plausible price reads as a fact. So each is named, at the built page, rather than trusted to
 * the schema that produced it.
 */

const PAGES = [
  ['Run with us', '/run-with-us/', 'Your first night at SRC'],
  ['Membership', '/membership/', 'Run for 50p. Join for £4.'],
  ['News', '/news/', 'Monthly newsletters'],
  ['About', '/about/', 'A friendly club since 2007'],
] as const;

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * The home page joins the four for everything that is about **what a page says** rather than
 * which nav item it marks.
 *
 * It is not in `PAGES` because the wordmark is its nav item, not a bar link — `club-chrome`
 * asserts that — so the "marks the section being read" loop does not apply to it.
 */
const ALL = [...PAGES.map(([, path]) => path), '/'] as const;

test.describe('each page renders and marks itself', () => {
  for (const [label, path, heading] of PAGES) {
    test(`${path} has its heading and one h1`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });

    test(`${path} marks ${label} as the section being read`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(path);

      const nav = page.getByRole('navigation', { name: 'Southville Running Club' });

      // `aria-current` and not a class alone: the underline tells a sighted reader where they
      // are, and without the attribute nobody else is told at all.
      await expect(nav.locator('[aria-current="page"]')).toHaveText(label);
    });
  }
});

test.describe('nothing unfinished reaches the page', () => {
  for (const path of ALL) {
    test(`${path} carries no placeholder`, async ({ page }) => {
      await page.goto(path);

      const text = (await page.locator('body').textContent()) ?? '';

      for (const marker of [
        '[confirm]',
        '[placeholder',
        '[Photo:',
        '[Name]',
        '[company number]',
        '[Offer',
        '[First line',
        'undefined',
        'NaN',
        'null',
      ]) {
        expect(text, `${path} contains ${marker}`).not.toContain(marker);
      }

      // The stripe-patterned box the mockup used for a missing photograph. A flat panel with
      // no text is what ships; this catches the pattern coming back with its caption.
      expect(text).not.toMatch(/Photo placeholder/iu);
    });
  }

  /**
   * ⚠️ **The England Athletics licence, which is the sharpest case on the site.**
   *
   * £23, £24 and £27 are all quoted on the club's old site and the club has not said which is
   * right. So the card says so — and still links to Join, because it is the price that is
   * unknown rather than the route.
   */
  test('says the England Athletics price is unconfirmed, and guesses none of the three', async ({
    page,
  }) => {
    await page.goto('/membership/');

    const card = page.locator('article').filter({ hasText: 'England Athletics licence' });

    await expect(card).toContainText('Price to be confirmed');
    for (const guess of ['£23', '£24', '£27']) {
      await expect(card, `the card quotes ${guess}`).not.toContainText(guess);
    }
  });

  test('names nobody on the committee until the club supplies names', async ({
    page,
  }) => {
    await page.goto('/about/');

    // Roles are here; people are not. A volunteer's name is personal data the club publishes
    // about them, and the club has not supplied the list.
    await expect(
      page.getByRole('heading', { name: 'Lead Welfare Officer' }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('[Name]');
  });
});

/**
 * ⚠️ **Club kit is out of scope for this build, and this is what says so in a diff.**
 *
 * Without it, the kit section is the single most likely thing to be re-added by somebody
 * working from the mockup, which still has the order window, the stock table and the
 * collection point in it.
 */
test.describe('club kit is absent', () => {
  for (const path of ALL) {
    test(`${path} says nothing about kit`, async ({ page }) => {
      await page.goto(path);

      const text = (await page.locator('body').textContent()) ?? '';

      for (const phrase of [
        'Order kit',
        'In stock now',
        'Quartermaster to buy',
        'order window',
        'Hi-viz vest',
        'technical vest',
      ]) {
        expect(text, `${path} mentions ${phrase}`).not.toContain(phrase);
      }

      // ⚠️ **"Kinisi Run Hub" is deliberately not in that list, and it was to begin with.**
      // It is where uncollected kit orders wait — and it is also a running shop that gives
      // members a discount, so it is a legitimate partner on `/membership/`. The test failed
      // on the partner, not on a kit section: a name that appears in two contexts cannot
      // stand in for one of them. The phrases above are ones only a kit section would use.
    });
  }
});

test.describe('the pages work at every width', () => {
  for (const path of ALL) {
    for (const [name, size] of [
      ['320', { width: 320, height: 720 }],
      ['390', PHONE],
      ['768', { width: 768, height: 1024 }],
      ['1440', { width: 1440, height: 900 }],
    ] as const) {
      test(`${path} does not scroll sideways at ${name}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.goto(path);

        await expectNoSidewaysScroll(page, `${path} at ${name}px`);
      });
    }
  }
});

/**
 * The wide tables scroll inside their own wrapper rather than taking the page with them.
 *
 * **Focusable and labelled**, because a region somebody can only reach with a mouse is a
 * region some people cannot reach — WCAG 2.1.1 and 4.1.2.
 */
test.describe('wide tables scroll inside themselves', () => {
  for (const [path, label] of [
    ['/run-with-us/', 'Pace guide'],
    ['/membership/', 'What each option includes'],
  ] as const) {
    test(`${path} keeps ${label} in its own scroller`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(path);

      const region = page.getByRole('region', { name: label });
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('tabindex', '0');

      await expectNoSidewaysScroll(page, `${path} with ${label} at 320px`);
    });
  }
});

/**
 * The accordions are `<details>`, so they open with no script at all.
 *
 * **Not tagged `@requires-js`, deliberately** — the `no-javascript` project is where this
 * matters, and it is why they are `<details>` rather than a scripted disclosure.
 */
test.describe('accordions open without JavaScript', () => {
  test('the FAQs open and close', async ({ page }) => {
    await page.goto('/run-with-us/');

    const faq = page
      .locator('details')
      .filter({ hasText: 'Which night is best for beginners?' });

    await expect(faq).not.toHaveAttribute('open', '');
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(page.getByText("It's our busiest night")).toBeVisible();
  });

  test("the WhatsApp community's rules open", async ({ page }) => {
    await page.goto('/membership/');

    const rules = page.locator('details').filter({ hasText: "The community's 12 rules" });

    await rules.locator('summary').click();
    await expect(rules.getByRole('listitem')).toHaveCount(12);
  });
});

/**
 * Every address that leaves for the old site comes from `links.json`.
 *
 * ⚠️ **This is what makes the cutover a data change.** When a sign-up page is rebuilt here,
 * editing `href` and `where` on one key moves every page that offers the action — and this
 * asserts the property that makes that true: no page writes an old-site address into its own
 * markup.
 */
test.describe('outbound links', () => {
  test('say they leave the site, in visible text', async ({ page }) => {
    await page.goto('/membership/');

    // Somebody about to leave for a different site should be told before they click, not by
    // the address bar afterwards.
    const join = page.getByRole('link', { name: /Join the club on our old site/ });

    await expect(join).toHaveAttribute(
      'href',
      'https://www.southvillerunningclub.co.uk/new-members',
    );
  });

  test('point at the old site only where one is expected', async ({ page }) => {
    for (const path of ALL) {
      await page.goto(path);

      const offsite = await page
        .locator('a[href^="http"]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

      for (const href of offsite) {
        // The club's own old site, the map, or a social profile from `SOCIAL_LINKS`. Anything
        // else on a club page is a link nobody decided to add.
        expect(href, `${path} links somewhere unexpected: ${href}`).toMatch(
          /^https:\/\/(www\.)?(southvillerunningclub\.co\.uk|google\.com\/maps|www\.instagram\.com|www\.facebook\.com|twitter\.com|www\.tiktok\.com)/u,
        );
      }
    }
  });
});

test.describe('accessibility', () => {
  for (const path of ALL) {
    test(`${path} has no violations at 1440 @requires-js`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);

      // Zero, not "few". Any threshold above zero becomes the new normal within a month.
      expect(await axeViolations(page)).toEqual([]);
    });

    test(`${path} has no violations at 390 @requires-js`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(path);

      expect(await axeViolations(page)).toEqual([]);
    });

    test(`${path} has no violations in the dark scheme @requires-js`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.setViewportSize(PHONE);
      await page.goto(path);

      expect(await axeViolations(page)).toEqual([]);
    });
  }
});

/**
 * The home page.
 *
 * Its chrome is `club-chrome.spec.ts`'s; this is about the promises the page itself makes.
 */
test.describe('the home page', () => {
  test('leads with the club, and both buttons go somewhere', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Come and run with us',
    );

    const hero = page.locator('.club-hero');
    await expect(hero.getByRole('link', { name: 'Come for a run' })).toHaveAttribute(
      'href',
      '/run-with-us/',
    );
    await expect(hero.getByRole('link', { name: 'Join the club' })).toHaveAttribute(
      'href',
      '/membership/',
    );
  });

  /**
   * ⚠️ **The measurement the whole hero layout is built around.**
   *
   * Somebody who has just been told about the club wants to know when it meets — so the
   * when/where/cost strip has to be on the first screen of a 390×844 phone, and that is what
   * hiding the hero photograph below 62em buys. Measured, it lands with about 35px to spare,
   * which is tight enough that a test is the only thing that will keep it true.
   */
  test('puts the facts strip inside the first screen at 390×844', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    const measured = await page.evaluate(() => {
      const strip = document.querySelector('.club-facts');
      if (strip === null) return null;
      const box = strip.getBoundingClientRect();
      return { bottom: box.bottom, viewport: window.innerHeight };
    });

    expect(measured, 'the facts strip is not on the page').not.toBeNull();
    expect(
      measured?.bottom ?? Infinity,
      `the facts strip ends at ${String(measured?.bottom)}px in a ${String(measured?.viewport)}px screen`,
    ).toBeLessThanOrEqual(measured?.viewport ?? 0);
  });

  test('hides the hero photograph on a phone and shows it on a desktop', async ({
    page,
  }) => {
    await page.goto('/');

    await page.setViewportSize(PHONE);
    await expect(page.locator('.club-hero-photo')).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.club-hero-photo')).toBeVisible();
  });

  test('states when, where and what it costs', async ({ page }) => {
    await page.goto('/');

    const facts = page.locator('.club-facts');

    await expect(facts).toContainText('Tuesdays and Thursdays');
    await expect(facts).toContainText('Meet 6.00pm for a 6.15pm start');
    // ⚠️ **The space before "Map" is asserted, because it has gone missing three times.**
    // Prettier reflows two adjacent expressions onto separate lines and Astro compresses the
    // newline between them to nothing, so this rendered "BS3 1DB.Map". An assertion that
    // stops at the postcode passes against that, which is how it survived twice.
    await expect(facts).toContainText('Southbank Club, Dean Lane, BS3 1DB. Map');
    await expect(facts).toContainText('50p a run');
    await expect(facts).toContainText('All abilities, 18+');
    await expect(facts.getByRole('link', { name: 'Map' })).toBeVisible();
  });

  /**
   * ⚠️ **`/nn/`, the evergreen address, and the date read from `race.json`.**
   *
   * `/nn/` paints on whichever running is current, so this link keeps working when 2027 is
   * published — and the entry journey from there is untouched by this change. The date is
   * asserted because the card reading it rather than restating it is the property that stops
   * the front page advertising last year's race.
   */
  test('sends people to the race at its evergreen address', async ({ page }) => {
    await page.goto('/');

    const card = page.locator('article').filter({ hasText: 'Nightingale Nightmare' });

    await expect(card.getByRole('link', { name: 'Race details' })).toHaveAttribute(
      'href',
      '/nn/',
    );
    await expect(card).toContainText('Sunday 1 November 2026');
  });

  /**
   * ⚠️ **"What members say" is absent, and that is the assertion.**
   *
   * The mockup has three quotes attributed to "[Member name]". A testimonial is a real person
   * saying a real thing with their consent; until the club supplies one, the honest page is
   * the one without the section. This fails if somebody reinstates it from the mockup.
   */
  test('publishes no testimonial until there is a real one', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'What members say' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Member name');
    await expect(page.locator('body')).not.toContainText('joined 2025');
  });

  test('offers the pace groups and the full guide', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('link', { name: 'See the full pace guide' }),
    ).toHaveAttribute('href', '/run-with-us/#pace');
  });
});
