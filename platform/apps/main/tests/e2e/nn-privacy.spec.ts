import { expect, test } from '@playwright/test';
import { expectNoSidewaysScroll, waitForStyledLayout } from '../sideways-scroll';

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
 * How many values on this page render the marker. **It was four, then one, and it is zero
 * since 30 August 2026** — the club asked for the committee's privacy document to be published
 * word for word, and that document answers every question this page used to leave open. It
 * also stopped asking three of them: there is no per-item retention table on the page now, so
 * `race.json`'s `entryRetention` and `emailRetention` are no longer read here at all.
 *
 * **Zero is still worth asserting, and it is the direction that matters now.** The four values
 * the page still interpolates are settled; if one of them ever goes `null`, this page prints
 * "to be confirmed by the club" in the middle of a legal document that claims to be a
 * committee-approved text, and nothing else would notice.
 */
const OPEN_DECISIONS = 0;

/**
 * The four the page interpolates, as they must appear. Literals, for the reason in the header.
 *
 * **`registeredOffice`, `medicalRetention` and `entryRetention` are not here any more** —
 * `race.json` still holds all three and `/privacy/` still prints the first, but the committee's
 * document does not state them so this page does not either. `medicalRetention` in particular
 * is still tied to `entries.events.medical_retention` by
 * `packages/db/tests/entries-retention.test.ts`; that tie is now between the column and the
 * JSON, and no longer reaches anything a runner reads.
 */
const SETTLED = {
  controller: 'Southville Running Club Ltd',
  companyNumber: '09437549',
  contact: 'info@southvillerunningclub.co.uk',
  // **The page's own revision date, and it stopped being the committee document's on 30 August
  // 2026.** Section 9 promises a revision date that moves when the page changes, so this
  // tracks the page: the collection-list deletion of 31 August moved it. See the page's own
  // header, and issue #179 item 3.
  lastUpdated: '31 August 2026',
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

    // **The titles are the committee's own, transcribed from the document they supplied on
    // 30 August 2026.** They are not the ones this page carried before, and the medical
    // section is the one to notice: there was a section 4 devoted to it, and there is not now.
    // What it said is in sections 2, 4 and 6 instead — what is collected, that explicit
    // consent is its basis, and how long it is kept — so the substance survives the
    // reorganisation even though the heading does not.
    expect(headings).toEqual([
      '1. Who we are',
      '2. Information we collect',
      '3. How We Use Your Information',
      '4. Legal Basis For Processing',
      '5. Data Sharing',
      '6. Data Retention',
      '7. Your rights',
      '8. Photographs',
      '9. Changes to this policy',
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

  test('leaves no list item or cell empty', async ({ page }) => {
    // The other half of the same guard. A `null` reaching the page as `''` would render an
    // empty item rather than the marker, the count above would still be whatever it was, and
    // the page would read as though nothing applied to that line.
    //
    // **This counted table cells until 30 August 2026**, when the committee's document
    // replaced the three what/why tables with lists. The elements changed and the failure it
    // catches did not, so it counts both — and it keeps `th, td` so that a table returning to
    // this page is covered on the day it does rather than the day somebody remembers.
    await page.goto('/nn/privacy/');

    const empties = await page.evaluate(
      () =>
        [...document.querySelectorAll('.nn-prose li, .nn-prose th, .nn-prose td')].filter(
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
    expect(body).toContain(SETTLED.companyNumber);
    expect(body).toContain(SETTLED.contact);
    expect(body).toContain(SETTLED.lastUpdated);

    // **The photographs paragraph is prose rather than an interpolated value**, so it has no
    // `race.json` key to go missing — but it is a committee answer that replaced a marker, and
    // a page that lost it would read as though nothing had been decided.
    expect(body).toMatch(/Photographs will be taken throughout the event/i);
    expect(body).toMatch(/if you prefer not to be photographed/i);
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

    expect(body).toContain(`Companies House company no. ${SETTLED.companyNumber} (SRC)`);
    expect(body).toContain(`please contact us at ${SETTLED.contact}.`);
    expect(body).toContain(`Please contact ${SETTLED.contact}.`);
    expect(body).toContain(`Last updated: ${SETTLED.lastUpdated}`);

    // **`{race.name}` is interpolated mid-sentence twice in section 1**, which is the join
    // most likely to close up unnoticed: it is inside a long paragraph rather than after a
    // label, so the result reads as a typo rather than as a missing value.
    expect(body).toContain(`or entering ${'Nightingale Nightmare'},`);
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
  // The committee's document, word for word
  // -------------------------------------------------------------------------------------

  test("carries the committee's document, in its own words", async ({ page }) => {
    // **On 30 August 2026 the club asked for the committee's privacy document to be published
    // verbatim**, and this test replaced three that asserted the opposite. What went, and why
    // it is written down rather than quietly deleted:
    //
    //   *"lists what the tables hold, not only what somebody types"* asserted the fee, the
    //   amount, the payment reference, the consents with their version, the timestamps, the
    //   cancellation reason, and — added the same week — the medical box, the visually
    //   impaired declaration and the guide. **None of those is in the document**, so the notice
    //   no longer says the club holds them. It does hold them: see `NN_ENTRY_FIELDS`, and the
    //   first two of the last three are special category data under Article 9.
    //
    //   *"lists the race category and the gender question as two separate things"* enforced
    //   ADR-020's promise that `gender_identity` is never published and never used to derive a
    //   category. The document says "gender" once and "chosen race category" once, and makes
    //   neither promise. **The promise still holds in the code** — `admin.spec.ts` asserts the
    //   field is absent from every export — it is simply no longer stated to the person it is
    //   about.
    //
    //   *"claims no card details and no confirmation email that does not exist"* asserted
    //   "We never see your card details" and, since #73, that Resend is named. The document
    //   says "we do not store full card details" and names no processor.
    //
    // **This test is what is left, and it is a fidelity check rather than a coverage one.** It
    // asserts the document's own sentences so that a later edit "improving" one of them fails
    // here — which is the only guard a page like this can have.
    //
    // ⚠️ **The page stopped being verbatim later the same day — issue #168.** The club took
    // the collection list's edits itself: two things it does not collect came out, four it
    // does went in, and **no sentence was rewritten, restyled or reordered**. That is the line
    // this test now holds. Every assertion below is still one of the committee's own
    // sentences; the `not.toContain`s and the insertions are the diff, and anything beyond
    // that shape is the committee's to supply. See the header of
    // `apps/main/src/pages/nn/privacy.astro`.
    //
    // ⚠️ **The shape widened once, on 31 August 2026 — #179 items 4 and 5.** Until then an
    // insertion meant an item in *the collection list*. Two of the commitments #179 left open
    // could not live there: the affiliation reservation decision 007 requires on both notices,
    // and an Article 9 condition for the health data section 2 already lists. Both went in as
    // **list items in their own list's shape** — one in section 2, one in section 4 — and no
    // sentence on the page was rewritten, restyled or reordered. So the line this test holds
    // is now "an item in a list, in that list's voice"; the prose is still untouchable.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toContain(
      'We collect the following types of information to manage race registration and event logistics:',
    );
    expect(body).toContain('Personal Identification: Name, date of birth, gender,');
    expect(body).toContain('Contact Details: Email address, phone number.');

    // **The two claims that came out on 30 August 2026 — issue #168.** Neither was ever
    // collected: `NN_ENTRY_FIELDS` has never had a postal address or an expected finish time
    // on it, and no column in `entries` holds either. Asserted as absent rather than simply
    // not asserted as present, because "we hold your address" is the kind of sentence that
    // gets pasted back in from an older draft.
    expect(body).not.toContain('postal address');
    expect(body).not.toContain('expected finish time');

    // **And the four that went in, which is the half that mattered.** All four are collected —
    // see `NN_ENTRY_FIELDS` — and two of them are special category data under Article 9. The
    // guide is the one to hold hardest: a second person whose data is collected through
    // somebody else's form, and who may never read this page because they did not do the
    // entering.
    expect(body).toContain('Health Information:');
    expect(body).toContain('medical information you choose to give us');
    expect(body).toContain('you are visually impaired');
    expect(body).toContain("Your Guide's Details:");
    expect(body).toContain(
      'their name, date of birth, email address and emergency contact',
    );
    expect(body).toContain('how you describe your gender');
    expect(body).toContain('we do not store full card details');

    // **Photographs and video, added 31 August 2026.** The entry terms have said since version
    // 1 that a runner's name and photographic or video footage may be used to publicise the
    // race and the club, and this notice said nothing about images at all — a category of data
    // Article 13 makes mandatory information. Asserted here for the reason the four #168
    // insertions are: what the club holds and does not say it holds is the expensive direction.
    expect(body).toContain('Photographs and Video:');
    expect(body).toContain('publicise the race and the club');

    // **Asserted absent, and it is the only claim on this page that was ever untrue.** The
    // collection list told 250 entrants the club runs analytics on them. There is no analytics
    // code in `apps/main` — no gtag, no Plausible, no Fathom — and `GET /nn/2026/` sets no
    // cookie, which is what `/privacy/` tells account holders. Deleted on 31 August 2026,
    // issue #179 item 1, and asserted the way the postal address above is: a sentence that
    // came out of a legal document is exactly the kind that gets pasted back from an older
    // draft.
    expect(body).not.toContain('analytics');
    expect(body).not.toContain('IP address');

    expect(body).toContain('We do not sell your data to third parties.');

    // ⚠️ **The two 31 August insertions are matched against whitespace-squashed text, and the
    // assertions above deliberately are not.** `textContent` returns the source's own newlines
    // and indentation, so a phrase Prettier happens to wrap arrives with a line break in the
    // middle of it — the trap `worker/html.ts` documents, one framework along. Every assertion
    // above survives only because no committee sentence currently straddles a break, and the
    // next reformat can move that. **The sentences below are the ones this change owns**, so
    // they are matched the robust way rather than the lucky way: `\s+` collapses to a single
    // space, the words still have to be exact, and nothing about the fidelity check weakens.
    const flowed = body.replace(/\s+/g, ' ');

    // **The affiliation reservation, added 31 August 2026 — issue #179 item 5 and #167.**
    // Decision 007 stopped the club asking for England Athletics numbers and made this
    // sentence a requirement of the decision rather than a nicety, on **both** notices; it was
    // on `/privacy/` only. These are that page's words, carried across rather than rewritten,
    // which is why nothing here is new wording. It is a collection-list item because its first
    // half is a statement about what the club does not collect.
    expect(flowed).toContain('Running Club Affiliation:');
    expect(flowed).toContain('we do not ask for your England Athletics number');
    expect(flowed).toContain(
      'produce your registration number, or other evidence that you are affiliated',
    );

    // **The Article 9 condition, added the same day — issue #179 item 4.** Section 2 lists two
    // categories of special category data and section 4 named no condition for either, so a
    // reader of the legal bases would conclude consent covered only marketing. The heading
    // test above has claimed since 30 August that this section says explicit consent is the
    // basis for the medical data. It did not, until this change.
    //
    // **Asserted with the section-2 cross-reference in it**, because the condition is only
    // meaningful attached to the data it is a condition for — a bare "explicit consent" bullet
    // would pass this and tell a reader nothing about which processing it covers.
    expect(flowed).toContain(
      'Explicit consent (Article 9(2)(a)): For the health information in section 2',
    );
    expect(flowed).toContain('telling us you are visually impaired');
    expect(flowed).toContain('you can withdraw at any time');

    expect(body).toContain(
      'Contractual necessity: To register you for the race and deliver event services',
    );
    expect(body).toContain('Our race is run under an ARC permit');
    expect(body).toContain(
      'We retain information only for as long as reasonably necessary',
    );
    expect(body).toContain('We may update this Privacy Policy periodically.');

    // **"You can have the right to" is the document's, and it stays as written.** It reads
    // oddly and it is not this file's to correct — a copy edit to a legal instrument is a
    // silent amendment to it. Asserted at exactly that wording so a tidy-up fails.
    expect(body).toContain('You can have the right to');
  });

  test('says how to be removed, because both forms link here promising it', async ({
    page,
  }) => {
    // **"Removed" in those words, and it survives the rewrite by luck rather than design.**
    // `NnEntryForm.astro` and `nn/index.astro` both send people here with "how to have it
    // removed" in the link text, so a page that only ever said "delete" would make the link
    // that brought somebody here slightly untrue. The committee's own sentence happens to use
    // the word. **If a future draft does not, the link text has to change with it** — that is
    // what this holds together, and it is why it is asserted separately from the fidelity
    // check above rather than folded into it.
    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';

    expect(body).toContain(
      'If you request data deletion, your information will be removed and your race entry will be cancelled.',
    );
  });

  // -------------------------------------------------------------------------------------
  // Structure: lists, where this page used to hold tables
  // -------------------------------------------------------------------------------------

  test('presents its lists as real lists, and holds any returning table to real headers', async ({
    page,
  }) => {
    // **This page carried three what/why tables until 30 August 2026**, and asserted that each
    // gave both column and row headers — because column headers alone leave somebody listening
    // able to ask "what column is this" and not "what row". The committee's document is prose
    // and bullets throughout, so the tables are gone and that assertion had nothing to run
    // against.
    //
    // **Both halves are kept rather than one deleted.** The count is asserted at zero, so a
    // table arriving back here fails and whoever adds it reads this note; and the header loop
    // is kept beneath it so that when one does return it is covered on the day, not on the day
    // somebody remembers. The lists are asserted to be real `ul`/`li` for the reason the
    // tables were asserted to be real tables: a list marked up as paragraphs tells a screen
    // reader nothing about how many items there are.
    await page.goto('/nn/privacy/');

    const lists = page.locator('.nn-prose ul');
    expect(await lists.count()).toBeGreaterThan(0);

    const strays = await page.evaluate(
      () =>
        [...document.querySelectorAll('.nn-prose ul')].filter(
          (list) => list.querySelectorAll(':scope > li').length === 0,
        ).length,
    );
    expect(strays, 'a list with no items in it').toBe(0);

    const tables = page.locator('.nn-prose table');
    await expect(tables).toHaveCount(0);

    for (let index = 0; index < (await tables.count()); index += 1) {
      const table = tables.nth(index);
      await expect(table.locator('thead th[scope="col"]')).toHaveCount(2);

      // Every body row carries its row header, so none is a cell that lost its label.
      const rows = await table.locator('tbody tr').count();
      await expect(table.locator('tbody th[scope="row"]')).toHaveCount(rows);
    }
  });

  // -------------------------------------------------------------------------------------
  // 320px
  // -------------------------------------------------------------------------------------

  test('keeps every block inside the card at 320px', async ({ page }) => {
    // **Once, now that the wait is a real one.** This used to run twice, against the
    // intermittent it named as *"an element laying out at its intrinsic width before the
    // stylesheet applied, about one run in four"* — the right diagnosis, and a re-run for a
    // fix. `waitForStyledLayout` waits for the sheets to be applied, the fonts to settle and
    // the width to stop moving, so one pass is evidence now, and every reading below needs it
    // rather than only the overflow one.
    //
    // **It measured the three tables until 30 August 2026**, because a table is the element
    // that can exceed its container while the page around it still fits. There are no tables
    // now, so it measures every child of the card instead — which covers the tables if they
    // come back, and covers the long committee paragraphs and the ARC and ICO links that
    // replaced them. `code` in section 5 is the one to watch: a monospace run does not wrap on
    // its own.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/nn/privacy/');
    await waitForStyledLayout(page);

    const measured = await page.evaluate(() => {
      const card = document.querySelector('.nn-prose');
      const blocks = [...(card?.children ?? [])];

      return {
        cardWidth: card?.clientWidth ?? 0,
        // `scrollWidth`, not the bounding box: a block can overflow its own box without the
        // box being any wider, which is exactly the failure this is looking for.
        widest: blocks.reduce(
          (worst, block) =>
            block.scrollWidth > worst.width
              ? { width: block.scrollWidth, tag: block.tagName.toLowerCase() }
              : worst,
          { width: 0, tag: 'none' },
        ),
        blocks: blocks.length,
      };
    });

    await expectNoSidewaysScroll(page, 'the privacy notice at 320px');

    // A card with nothing in it would pass the width check by having nothing to measure.
    expect(measured.blocks).toBeGreaterThan(20);

    expect(
      measured.widest.width,
      `<${measured.widest.tag}> is wider than the card`,
    ).toBeLessThanOrEqual(measured.cardWidth);
  });

  test('the way back to the race resolves', async ({ page, request }) => {
    await page.goto('/nn/privacy/');

    const back = page.getByRole('link', { name: 'Back to Nightingale Nightmare' });
    await expect(back).toHaveAttribute('href', '/nn/');
    expect((await request.get('/nn/')).status()).toBe(200);
  });
});
