import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * `/nn/2026/terms/` — the entry terms and race rules.
 *
 * ## What this file is actually guarding
 *
 * The page is the race director's copy, published verbatim, with every fact that also appears
 * elsewhere on the site interpolated from `race.json`. So there are two different things to
 * assert and they fail in different directions:
 *
 *   1. **The words are on the page.** A prose assertion, pinned as a literal, because a
 *      transcription that quietly loses a clause is the failure a legal document has.
 *   2. **The facts track the data file.** Read out of `race.json` rather than written out,
 *      because a literal here would go on passing after the value moved — it would be
 *      asserting that two hard-coded strings match each other, which is not the claim. This is
 *      the same trap `nn-entry-complete.spec.ts` documents for leak assertions: a check
 *      written the convenient way goes vacuous silently.
 *
 *      **`site.spec.ts` pins its race facts as literals and this file does not**, which is a
 *      real disagreement rather than an oversight. That file is asserting *which* page a fact
 *      is allowed to appear on — the date belongs on the year page and must never reach `/nn/`
 *      — and a literal is right for that, because reading the value back would make the
 *      assertion self-referential. This file is asserting that a page *reads* the file rather
 *      than repeating it, and for that the literal is the wrong tool. Both guards exist for
 *      the permit number, in the two files, and they catch different things.
 *
 * **Neither half proves single-sourcing on its own**, and that is the point of the pair in
 * `tests/unit/terms-single-source.test.ts` alongside them: reading the file proves the page
 * renders *whatever the file says*, and the unit test proves the values are not **also** typed
 * into the markup. A page that hard-coded the permit number would pass every assertion in this
 * file.
 *
 * It runs in all three projects. Only the axe check is tagged `@requires-js`, because axe
 * works by injecting a script and cannot report on a page with scripting off.
 */

const TERMS = '/nn/2026/terms/';

/**
 * `race.json`, read off disk rather than imported.
 *
 * **Playwright loads a spec as Node ESM**, where a bare `import … from './x.json'` needs an
 * `with { type: 'json' }` attribute — the unit suite does not, because Vite transforms it
 * first. Rather than carry an attribute that means nothing to half the suite, this follows the
 * precedent already set by `packages/db/tests/entries-retention.test.ts`, which reads the same
 * file the same way for the same class of reason: it is the file that ships, read as a file.
 *
 * The narrow type is the point of the cast. Widening it to the whole document would make this
 * a second place the shape of `race.json` is written down.
 */
const RACE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../src/content/race.json', import.meta.url)),
    'utf8',
  ),
) as {
  date: string;
  dateShort: string;
  permit: string;
  hqName: string;
  transferDeadline: string;
  contact: string;
  privacy: { controller: string };
  schedule: ReadonlyArray<{ id: string; time: string; what: string }>;
};

/** The page's text with runs of whitespace squashed, which is how the rest of the suite
 *  matches prose. Astro's formatter reflows markup, so a sentence written across a line break
 *  arrives with a newline in the middle of it — the trap CLAUDE.md records for `worker/html.ts`
 *  and the one `{' '}` exists to work around. Squashing first means these assertions are about
 *  the words rather than about where Prettier put them. */
const squashed = async (page: import('@playwright/test').Page): Promise<string> => {
  await page.goto(TERMS);
  return ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
};

test.describe('the entry terms page', () => {
  test('serves at its own address, and answers 200', async ({ page }) => {
    const response = await page.goto(TERMS);

    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('text/html');
  });

  test('is one heading, then two sections, each a real list', async ({ page }) => {
    await page.goto(TERMS);

    // **Real list semantics, not paragraphs with bullets in front of them.** A screen reader
    // says "list, thirteen items" and gives somebody skimming a thirteen-clause contract the
    // same shape a sighted reader gets. Asserting the counts pins the transcription too: a
    // dropped clause changes a number here.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nightingale Nightmare Entry Terms and Conditions',
    );

    const sections = page.getByRole('heading', { level: 2 });
    await expect(sections).toHaveText(['Entry Terms and Conditions', 'Race Rules']);

    const lists = page.locator('.nn-prose ul');
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(0).locator('> li')).toHaveCount(13);
    await expect(lists.nth(1).locator('> li')).toHaveCount(7);
  });

  // ---------------------------------------------------------------------------------------
  // The facts, derived from race.json rather than written out
  // ---------------------------------------------------------------------------------------

  test('states the race date, the permit and the deadline from the data file', async ({
    page,
  }) => {
    const body = await squashed(page);

    // Every expected value comes from the file. Change `race.json` and this test changes with
    // it — which is the single-source claim, stated as an assertion.
    expect(body).toContain(RACE.date);
    expect(body).toContain(RACE.permit);
    expect(body).toContain(RACE.transferDeadline);
    expect(body).toContain(RACE.hqName);
    expect(body).toContain(RACE.dateShort);
    expect(body).toContain(RACE.privacy.controller);

    // The collection time is the schedule's registration row and nothing else — the whole
    // reason that row grew an `id`. Reading it the same way the page does means a reordered
    // schedule cannot make this pass for the wrong reason.
    const registration = RACE.schedule.find((row) => row.id === 'registration');
    expect(registration).toBeDefined();
    expect(body).toContain(`from ${registration?.time} onwards`);
  });

  test('renders the contact address twice, both as tappable mailto links', async ({
    page,
  }) => {
    await page.goto(TERMS);

    // **The address is its own link text, on both.** Somebody on a phone at the point of entry
    // taps it; somebody on a screen reader hears the address rather than the word "here". Both
    // occurrences come from one value in `race.json`, which is what stops the transfer address
    // and the refund address drifting apart.
    const links = page.locator(`.nn-prose a[href="mailto:${RACE.contact}"]`);

    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText(RACE.contact);
    await expect(links.nth(1)).toHaveText(RACE.contact);
  });

  // ---------------------------------------------------------------------------------------
  // The copy itself, pinned as literals
  // ---------------------------------------------------------------------------------------

  test('carries the supplied copy, including the clauses easiest to lose', async ({
    page,
  }) => {
    const body = await squashed(page);

    // The clauses somebody would be most tempted to "fix", and the ones a runner is most
    // likely to be relying on. Her wording, including "thereby" and "in/attendance at".
    expect(body).toContain(
      'Participation in/attendance at the Event is personal to you and you thereby declare yourself medically fit to participate.',
    );
    expect(body).toContain(
      'In accordance with UKA Rule 240 the wearing of headphones or similar devices (other than those medically prescribed) is not permitted.',
    );
    expect(body).toContain('Entrants must be 18 or over on race day.');
    expect(body).toContain('This event is not suitable for wheelchair athletes.');
    expect(body).toContain('Stay on the marked route, and take your litter with you.');
    expect(body).toContain(
      'These Terms & Conditions and Race Rules are subject to change by the Race Organisers.',
    );
  });

  test('says which version it is, and claims no committee ratification', async ({
    page,
  }) => {
    const body = await squashed(page);

    // **The date is load-bearing** — the document's own last sentence says it is subject to
    // change, so somebody entering on 1 September has to be able to say which version they
    // read. The provenance is the race director's, and the committee has not ratified these
    // terms: a claim that it had would be a false statement on a legal document, so the
    // negative is asserted as hard as the positive.
    expect(body).toContain(
      'Version 1 — published 28 August 2026. Supplied by the race director.',
    );
    expect(body).not.toContain('committee');
    expect(body).not.toContain('ratified');
  });

  // ---------------------------------------------------------------------------------------
  // Reachable from the form it binds, and operable where it is read
  // ---------------------------------------------------------------------------------------

  test('is linked from the entry form, and the link resolves', async ({ page }) => {
    // The terms are what the entry checkbox commits somebody to, so the link has to be beside
    // it. `/nn/2026/` serves the interest form until `entries_open_at` is set, so the hint is
    // asserted from the built markup rather than by driving the form — the block ships hidden
    // and the Worker reveals it.
    await page.goto('/nn/2026/');

    const hint = page.locator('#entry-terms-hint a');
    await expect(hint).toHaveAttribute('href', TERMS);
    await expect(hint).toHaveText('Read the full entry terms and race rules.');

    // `trailingSlash: 'always'`, so there is exactly one address. Following the link has to
    // land on a 200 without a redirect hop.
    const response = await page.goto(TERMS);
    expect(response?.status()).toBe(200);
  });

  test('the slashless address is not a second live page', async ({ page }) => {
    // `trailingSlash: 'always'` means `/nn/2026/terms` and `/nn/2026/terms/` must not be two
    // answers. The trap this repository already paid for is the opposite spelling — `/health`
    // and `/health/` both live, one character apart, with nothing failing. Whether the
    // slashless form redirects or 404s is the assets binding's business; what matters is that
    // it does not serve the page a second time at a second address.
    const response = await page.goto('/nn/2026/terms');

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(TERMS);
  });

  test('is legible and operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(TERMS);

    // **The document must not scroll sideways.** A long legal document at the narrowest width
    // is exactly where an overflowing element hides — and this repository has already had a
    // page slide left under a thumb because an absolutely positioned span inside a scroller
    // took the page as its containing block. The assertion is on the document, not on a
    // component, because that is where the symptom appeared.
    await expectNoSidewaysScroll(page, 'the entry terms at 320px');

    // The two facts somebody skims for on a phone are both visible without interaction.
    await expect(page.getByText(RACE.permit)).toBeVisible();
    await expect(page.getByText(RACE.transferDeadline)).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto(TERMS);

    // Zero, not "few" — any threshold above zero becomes the new normal within a month. The
    // tag set matches the rest of the suite.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
