import { expect, test } from '@playwright/test';

/**
 * The Nightingale Nightmare privacy notice.
 *
 * **Nothing here is tagged `@requires-js`.** The page has no script of its own and nothing
 * on it is revealed by the Worker, so every assertion below runs in the `no-javascript`
 * project too — which is the project that matters most for a legal document somebody opens
 * on a phone before typing their name.
 *
 * ## What this file is really guarding
 *
 * One thing, in two directions. **A value the committee has not decided must render as the
 * marker, and a value it has decided must not.** The first failure publishes an invention;
 * the second publishes a shrug where a fact belongs, and quietly removes a claim the club
 * has already made. Counting the marker catches both — four, exactly, and the four settled
 * facts present in words.
 *
 * The 320px block is separate from `site.spec.ts`'s overflow check on purpose. That one
 * asserts the *document* does not scroll sideways; these assert the tables specifically,
 * because a table is the one element that can exceed its container while the page around it
 * still fits, and three of them landed on this page at once.
 *
 * ## Why nothing here imports `race.json`
 *
 * **A test that reads its expectation from the file the page reads asserts nothing.** Change
 * the registered office to somebody's home address and both sides move together, green. So
 * the settled facts are written out here as literals, exactly as `site.spec.ts` writes out
 * the race date — the second copy *is* the check, and it is the only kind of check a content
 * file can have. Editing `race.json` is meant to fail this file; that is the reminder to
 * confirm the new value was actually decided.
 */

/** What `orTbc` renders for a `null`. Held here so a reworded marker fails loudly, once. */
const MARKER = 'To be confirmed by the club';

/**
 * How many of `race.privacy`'s keys are still `null` — the contact, the entry retention, the
 * email retention and the photographs. **Filling one in is supposed to fail this file**: the
 * count drops to three, and updating it here is the moment somebody confirms the new value
 * came from the committee rather than from a hurry.
 */
const OPEN_DECISIONS = 4;

/** The five that are settled, as they must appear. A literal, for the reason in the header. */
const SETTLED = {
  controller: 'Southville Running Club Ltd',
  registeredOffice: '1 Hengrove Farm, Hengrove Farm Lane, Bristol BS14 9DD',
  companyNumber: 'ending 7549',
  medicalRetention: 'One month after the race',
  lastUpdated: '14 August 2026',
} as const;

test.describe('the privacy notice', () => {
  test('is navigable by heading, in order', async ({ page }) => {
    // **Nine sections, and the numbers are load-bearing.** The notice refers to "section 1"
    // and "section 4" in its own text, so a heading reordered without the cross-references
    // being followed is a page that misdirects somebody looking for the contact address.
    await page.goto('/nn/privacy/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'What the club does with your details',
    );

    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();

    expect(headings).toEqual([
      '1. Who we are',
      '2. What we collect, and why',
      '3. What we are allowed to do with it, and why that is lawful',
      '4. Medical information — handled separately, on purpose',
      '5. Who else sees your information',
      '6. How long we keep it',
      '7. Your rights',
      '8. Photographs',
      '9. Changes to this notice',
    ]);
  });

  test('states consent as a basis, and says how to be removed', async ({ page }) => {
    // **"Removed" in those words, because that is what the links promise.** Both forms send
    // people here with "how to have it removed" in the link text; a page that only ever says
    // "delete" makes the link slightly untrue, and this is what holds the two together.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toMatch(/consent/i);
    expect(body).toMatch(/removed/i);
  });

  // -------------------------------------------------------------------------------------
  // The four open decisions, and the four settled facts
  // -------------------------------------------------------------------------------------

  test('renders every undecided value as the marker, and never as a blank', async ({
    page,
  }) => {
    // **This is the assertion that stops a placeholder quietly becoming a claim.** Four
    // `null`s in `race.json`, four markers on the page. Filling one in is a one-line edit
    // there and this count drops to three — which is the test failing *correctly*, and the
    // reminder to update it in the same commit.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body.split(MARKER).length - 1).toBe(OPEN_DECISIONS);
  });

  test('leaves no cell of any table empty', async ({ page }) => {
    // The other half of the same guard. A `null` reaching the page as `''` would render an
    // empty cell rather than the marker, the count above would still be whatever it was, and
    // the page would read as though nothing was collected for that row.
    await page.goto('/nn/privacy/');

    const empties = await page.evaluate(
      () =>
        [...document.querySelectorAll('.nn-prose th, .nn-prose td')].filter(
          (cell) => (cell.textContent ?? '').trim() === '',
        ).length,
    );

    expect(empties).toBe(0);
  });

  test('writes in the facts that are settled, rather than marking them open', async ({
    page,
  }) => {
    // The inverse failure, and the quieter one: a settled fact rendered as "to be confirmed"
    // withdraws a claim the club has already made in public, and nothing else would notice.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toContain(SETTLED.controller);
    expect(body).toContain(SETTLED.registeredOffice);
    expect(body).toContain(SETTLED.companyNumber);
    expect(body).toContain(SETTLED.medicalRetention);
    expect(body).toContain(SETTLED.lastUpdated);
  });

  test('keeps the space in front of every value it interpolates', async ({ page }) => {
    // **The trap this page met twice while it was being written.** A bare `{expression}` on a
    // line of its own has its surrounding newlines collapsed rather than kept as a space, so
    // "Contact about your data:" and its value ran together — and *Prettier is what moves the
    // expression onto its own line*, so a space typed in the source does not survive the next
    // format. `{' '}` does. Asserting the whole joined string is the only way this shows up:
    // every other test here matches on one side of the join or the other.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toContain(`Contact about your data: ${MARKER}`);
    expect(body).toContain(`Registered office: ${SETTLED.registeredOffice}`);
    expect(body).toContain(`company number ${SETTLED.companyNumber}`);
    expect(body).toContain(`How long we keep it: ${SETTLED.medicalRetention}.`);
    expect(body).toContain(`Last updated: ${SETTLED.lastUpdated}`);
  });

  test('invents no fee and no date nobody confirmed', async ({ page }) => {
    // Carried over from the page this replaced. The entry fees are real and live in
    // `entries.fees`; **none of them belongs on this page**, and a price appearing here would
    // mean somebody had hardcoded one rather than read it from the database.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).not.toMatch(/£\s?\d/);
    expect(body).not.toMatch(/\b(October|November)\s+\d{1,2}\b/);
  });

  // -------------------------------------------------------------------------------------
  // What it says is collected
  // -------------------------------------------------------------------------------------

  test('lists what the tables hold, not only what somebody types', async ({ page }) => {
    // **The four rows the approved draft did not have.** The draft listed the fourteen form
    // fields; `entries.entry_purchases` also holds the fee, the amount, Stripe's references,
    // the consents with their version, and three timestamps. Under-listing what a controller
    // processes is a defect in a notice, and this is the guard against the list drifting back.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toMatch(/entry type you chose, and what you paid/i);
    expect(body).toMatch(/payment reference from Stripe/i);
    expect(body).toMatch(/which boxes you ticked/i);
    expect(body).toMatch(/when you entered, and when your payment was confirmed/i);

    // The interest form's own timestamp, which the page this replaced disclosed and the
    // draft dropped. Losing it would be a regression against what was already published.
    expect(body).toMatch(/date and time you asked/i);
  });

  test('claims no card details and no confirmation email that does not exist', async ({
    page,
  }) => {
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toMatch(/We never see your card details/i);

    // **Resend is not wired up.** The draft carried the line with its own instruction to
    // remove it if the confirmation email was not in place for 2026, and it is not. Naming a
    // processor the club does not yet use is a claim about a data flow that does not happen.
    expect(body).not.toMatch(/Resend/i);
  });

  // -------------------------------------------------------------------------------------
  // Tabular data, as tables
  // -------------------------------------------------------------------------------------

  test('gives the three tables real headers in both directions', async ({ page }) => {
    // Column headers alone would leave somebody listening to the page able to ask "what
    // column is this" and not "what row". Both are what makes a table navigable rather than
    // a grid of unlabelled text — and it is why these are tables and not stacked divs.
    await page.goto('/nn/privacy/');

    const tables = page.locator('.nn-prose table');
    await expect(tables).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      const table = tables.nth(index);
      await expect(table.locator('thead th[scope="col"]')).toHaveCount(2);
      expect(await table.locator('tbody th[scope="row"]').count()).toBeGreaterThan(0);

      // Every body row carries its row header, so none is a cell that lost its label.
      const rows = await table.locator('tbody tr').count();
      await expect(table.locator('tbody th[scope="row"]')).toHaveCount(rows);
    }
  });

  // -------------------------------------------------------------------------------------
  // 320px
  // -------------------------------------------------------------------------------------

  test('keeps all three tables inside the card at 320px', async ({ page }) => {
    // **Twice, deliberately.** The 320px failure this repository has already met was
    // intermittent — an image laying out at its intrinsic width before the stylesheet
    // applied, about one run in four. A single pass is not evidence about layout at this
    // width, and a second reload costs a second.
    for (let pass = 0; pass < 2; pass += 1) {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto('/nn/privacy/');

      const measured = await page.evaluate(() => {
        const card = document.querySelector('.nn-prose');
        const tables = [...document.querySelectorAll('.nn-prose table')];

        return {
          cardWidth: card?.clientWidth ?? 0,
          // `scrollWidth`, not the bounding box: a table can overflow its own box without
          // the box being any wider, which is exactly the failure this is looking for.
          tableWidths: tables.map((table) => table.scrollWidth),
          documentOverflows:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          // The stack has to have engaged, or the assertion above passes for the wrong
          // reason — a two-column table that happens to fit is not what was designed here.
          rowsAreBlocks: tables.every((table) =>
            [...table.querySelectorAll('tbody tr')].every(
              (row) => getComputedStyle(row).display === 'block',
            ),
          ),
        };
      });

      expect(measured.documentOverflows, `pass ${pass}`).toBe(false);
      expect(measured.rowsAreBlocks, `pass ${pass}`).toBe(true);
      expect(measured.tableWidths, `pass ${pass}`).toHaveLength(3);

      for (const width of measured.tableWidths) {
        expect(width, `pass ${pass}`).toBeLessThanOrEqual(measured.cardWidth);
      }
    }
  });

  test('the way back to the race resolves', async ({ page, request }) => {
    await page.goto('/nn/privacy/');

    const back = page.getByRole('link', { name: 'Back to Nightingale Nightmare' });
    await expect(back).toHaveAttribute('href', '/nn/');
    expect((await request.get('/nn/')).status()).toBe(200);
  });
});
