import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { expect, test, type Locator } from '@playwright/test';

import { parseMembership } from '@src/shared/club-content';
import { formatPriceWords } from '@src/shared/money';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * The four club pages the navigation links to.
 *
 * ⚠️ **`/events/` is deliberately not here, and it is a club page now.** It became the
 * races-and-events hub on 26 September 2026 — this comment predicted that change and is kept
 * because the reason it is still absent has changed: `events.spec.ts` owns it, since what that
 * page says is bound up with the two addresses on it that must never move.
 * `club-chrome.spec.ts` covers the header, Menu and footer on every club page; this file is
 * about what the pages themselves say.
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
  ['Membership', '/membership/', 'Run for 50p. Join when it suits you.'],
  ['News', '/news/', 'Monthly newsletters'],
  ['About', '/about/', 'A friendly club since 2007'],
] as const;

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * The membership comparison, read the way the page reads it.
 *
 * ⚠️ **Read from disk rather than `import`ed**, for the reason `club-chrome.spec.ts` gives:
 * a bare JSON import works in an Astro page, where Vite handles it, and fails in a Playwright
 * spec with *"needs an import attribute of type: json"*.
 */
const membership = parseMembership(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../src/content/membership.json', import.meta.url)),
      'utf8',
    ),
  ),
);

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
   * £23, £24 and £27 were all quoted on the club's old site. The club settled it — £27, of
   * which £23 is England Athletics' own registration fee — and **that figure is in
   * `membership.membership_types` rather than in this page**, so a fee rise is one `update`
   * and no deploy.
   *
   * What this asserts in a browser is that the price arrives *and* that the split arrives
   * with it. £27 beside £4 with no account of the difference is a number somebody argues
   * with; the sentence beneath it is what makes it explicable, and it is painted from
   * `ea_fee_pence` so the two cannot disagree. `tests/worker/membership.test.ts` owns the
   * markup-level half, including that no figure is in the built file at all.
   */
  test('quotes the England Athletics price and says which part is not the club’s', async ({
    page,
  }) => {
    await page.goto('/membership/');

    const card = page.locator('article').filter({ hasText: 'England Athletics licence' });

    await expect(card).toContainText('£27');
    await expect(card).toContainText(
      '£4 club membership plus £23 England Athletics registration',
    );
    await expect(card).not.toContainText('Price to be confirmed');
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
 * The comparison table on `/membership/`.
 *
 * ⚠️ **What this actually guards is that the table is the content file and not a copy of it.**
 * Sixteen benefits in five groups is the largest thing in `src/content/`, and the failure it
 * invites is the quiet one: a row that renders twice, a row that renders nowhere, or a row
 * whose four cells came out as three so every option after it reads one column to the left.
 * None of those looks wrong, and none of them is a schema error — the file is valid either
 * way, so only the built page can answer it.
 *
 * **Not tagged `@requires-js`**: none of it needs scripting, and the `no-javascript` project
 * is where the stacked presentation matters most.
 */
test.describe('what each option includes', () => {
  const groups = membership.comparison;
  const rows = groups.flatMap((group) => group.rows);

  /** The cell text the page must produce, from the one place the price is held. */
  const perRun = formatPriceWords(membership.payPerRunPence);

  test('renders every group from the content file, once each', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });

    for (const group of groups) {
      await expect(
        table.locator('th[scope="colgroup"]').filter({ hasText: group.group }),
        `${group.group} does not render exactly once`,
      ).toHaveCount(1);
    }

    await expect(table.locator('th[scope="colgroup"]')).toHaveCount(groups.length);
  });

  test('renders every row once, with four cells and no more', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });
    const bodyRows = table.locator('tbody tr:not(.club-row-group)');

    // ⚠️ **The count is compared against the file rather than written down**, because a row
    // dropped from the middle of the table is invisible to the eye and to every assertion
    // that names a benefit.
    await expect(bodyRows).toHaveCount(rows.length);

    // ⚠️ **Positional, which is what makes "exactly once" a real claim.** Matching each
    // benefit by its own text would pass a table that rendered one row twice and another not
    // at all, and would pass a table whose groups came out in a different order.
    const rendered = await bodyRows.locator('th[scope="row"]').allTextContents();

    rows.forEach((row, index) => {
      // A note is a `<span>` inside the row header, so it is part of that header's text, and
      // there is no separator between the two in the markup: the span is `display: block`,
      // which is where both a reader and the accessible-name algorithm take the break from.
      expect(squash(rendered[index] ?? ''), `row ${String(index + 1)}`).toBe(
        squash(`${row.benefit}${row.note ?? ''}`),
      );
    });

    // Four options, so four cells on every row. A row with three shifts every option after it
    // one column to the left, which reads as a benefit somebody does not get.
    for (const [index, row] of rows.entries()) {
      await expect(
        bodyRows.nth(index).locator('td'),
        `${row.benefit} has the wrong number of cells`,
      ).toHaveCount(4);
    }
  });

  /**
   * ⚠️ **A glyph is not a word, and colour is never the signal.** Each cell carries the tick
   * or the dash for a reader and "Included" / "Not included" for everybody else, so the table
   * means the same thing read aloud as it does read across.
   */
  test('says included and not included in words, not only in glyphs', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });

    const ticks = rows.flatMap((row) => row.cells).filter((cell) => cell === true).length;
    const dashes = rows
      .flatMap((row) => row.cells)
      .filter((cell) => cell === false).length;

    await expect(table.getByText('Included', { exact: true })).toHaveCount(ticks);
    await expect(table.getByText('Not included', { exact: true })).toHaveCount(dashes);
  });

  /**
   * ⚠️ **The price in a cell comes from `payPerRunPence` and is not written out.** Three cells
   * say it, and a cell holding the words would be a fourth place 50p is stated — agreeing on
   * the day it was typed. `comparisonText()` is what fills it; this is what says it arrived.
   */
  test('quotes the club’s own price rather than restating it', async ({ page }) => {
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });

    const cells = await table.locator('tbody td').allTextContents();

    expect(cells.filter((cell) => squash(cell) === `${perRun} each*`)).toHaveLength(2);
    expect(cells.filter((cell) => squash(cell) === `${perRun} each`)).toHaveLength(1);
    // And nothing reached the page still holding a token the page was meant to fill.
    expect(cells.filter((cell) => cell.includes('{'))).toEqual([]);
  });

  /**
   * ⚠️ **Five columns do not fit at 320px, so below 48em there are no columns.** Each cell
   * draws its column's name from `data-label` through `::before` — which is in the
   * accessibility tree, and is what replaces the `<th scope="col">` association once the
   * headings are `display: none`. Exactly one labelling mechanism is live at each width,
   * which is why the pseudo-element is `content: none` above the breakpoint.
   */
  test('stacks each row at 320px and is a table again at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });
    const headings = table.locator('thead');
    const firstCell = table.locator('tbody tr:not(.club-row-group) td').first();

    await expect(headings).toBeHidden();
    await expect(firstCell).toHaveCSS('display', 'block');

    // ⚠️ **The label is drawn by `::before`, which `textContent` cannot see** — that is what
    // this assertion was written as first, and it failed against a page behaving correctly.
    // What the two presentations have to guarantee is that exactly one labelling mechanism is
    // live at each width: the pseudo-element while the headings are hidden, and the headings
    // once they are back. `attr()` is resolved differently by the three engines, so this asks
    // whether the label is drawn rather than what it says — the attribute it draws is
    // asserted against the headings themselves in the test below.
    expect(await labelContent(firstCell)).not.toBe('none');

    await expectNoSidewaysScroll(page, '/membership/ comparison table at 320px');

    await page.setViewportSize({ width: 1440, height: 900 });

    await expect(headings).toBeVisible();
    await expect(firstCell).toHaveCSS('display', 'table-cell');
    // The heading is at the top of the column again, so the cell stops repeating it.
    expect(await labelContent(firstCell)).toBe('none');
  });

  /**
   * ⚠️ **A relationship rather than a list of four strings.** Below 48em the column headings
   * are `display: none` and each cell's `data-label` is all that says which option it belongs
   * to — so a label that disagreed with its column would be a lie nobody could see, because
   * the two presentations are never on screen at the same time. Comparing the page's own
   * headings against the page's own labels needs neither written down here.
   */
  test('labels every cell with the column it came from', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/membership/');

    const table = page.getByRole('region', { name: 'What each option includes' });

    // The first heading is the benefit column, which has no cells of its own to label.
    const columns = (await table.locator('thead th').allTextContents())
      .slice(1)
      .map(squash);

    expect(columns).toHaveLength(4);

    const bodyRows = table.locator('tbody tr:not(.club-row-group)');

    for (const [index, row] of rows.entries()) {
      const labels = await bodyRows
        .nth(index)
        .locator('td')
        .evaluateAll((cells) =>
          cells.map((cell) => cell.getAttribute('data-label') ?? ''),
        );

      expect(labels, `${row.benefit} is labelled wrongly`).toEqual(columns);
    }
  });
});

/** Whitespace in rendered markup is a build artefact; what a reader sees is not. */
function squash(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * The `content` of a cell's `::before` — `'none'` when the stacked label is not drawn.
 *
 * ⚠️ **`page.evaluate` and not `waitForFunction`**, which installs its loop *in* the page and
 * so never runs at all with `javaScriptEnabled: false`. This suite's `no-javascript` project
 * is exactly where the stacked presentation matters most.
 */
async function labelContent(cell: Locator): Promise<string> {
  return await cell.evaluate(
    (element) => globalThis.getComputedStyle(element, '::before').content,
  );
}

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

    // ⚠️ **This used to check the Join button, and Join is no longer outbound.** The club's
    // own application form replaced the Squarespace one, so the label lost "on our old site"
    // along with the destination — a button saying it leaves the site while staying on it
    // would be worse than either.
    //
    // Renew is the nearest action that genuinely still leaves, so it inherits the check:
    // somebody about to land on a different site should be told before they click, not by
    // the address bar afterwards.
    const renew = page.getByRole('link', { name: /Renew/ }).first();

    await expect(renew).toHaveAttribute(
      'href',
      'https://www.southvillerunningclub.co.uk/renew-membership',
    );

    // And the button that no longer leaves does not claim to.
    const join = page.getByRole('link', { name: 'Join the club' }).first();

    await expect(join).toHaveAttribute('href', '/membership/join/');
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
