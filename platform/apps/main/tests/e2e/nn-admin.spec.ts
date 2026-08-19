import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BOM } from '@src/shared';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import {
  ADMIN_EVENT_SLUG,
  ADMIN_PERSON_KEY,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
  CLEAN_EVENT_SLUG,
  CLEAN_PAID_LAST_NAME,
  MISSING_EA_LAST_NAME,
  PAID_EA_NUMBER,
  PAID_NON_ASCII_LAST_NAME,
} from '../admin-fixtures';

/**
 * `/nn/admin` in a real browser, including one with JavaScript turned off.
 *
 * ## What this layer adds that the Worker suite cannot
 *
 * The Miniflare run asserts what the Worker *answers*. This asserts what a person can actually
 * **do** with it: sign in by typing a key into a form and pressing a button, read a table on a
 * phone, tab to the things that need tabbing to, and get an export. Three of those are only
 * true if the page works with no script at all, which is a requirement here rather than a
 * nicety — and the surface has no script of its own, so **nothing in this file is tagged
 * `@requires-js` except axe**, which cannot run without one.
 *
 * The `no-js` project is what makes "works with scripting off" a fact rather than a claim: every
 * untagged test below runs three times, and one of those three has JavaScript disabled outright.
 *
 * ## The fixtures, and why they are this file's own
 *
 * Seeded here and removed afterwards, against **two fabricated events, each with its own race
 * slug**. Not `nn-2026`: `nn-entry.spec.ts` clears every purchase against the real event before
 * each of its tests, so a fixture there would vanish partway through a run — and a fixture
 * claiming to be a running of `nn` would change what `/nn/` resolves to for every other spec.
 *
 * **Two events rather than one, because the attention panel has to be proved absent as well as
 * present.** The flag is a column on a purchase, so there is no view of the oversold event in
 * which it is not set; the quiet event is the only way to see the page without it.
 *
 * The admin key's digest is installed by the same call and taken out in teardown, so a laptop is
 * never left with a working admin surface for a key written in a test file. The Worker's own key
 * comes from `apps/main`'s `preview` script, which passes the value `seed.sql` installs.
 *
 * ## Nothing here imports `race.json`, and nothing here reads a literal from the page
 *
 * The same rule the rest of this directory follows: an expectation read from the file the page
 * reads asserts nothing. Every string below is written out.
 */

const ADMIN = '/nn/admin/';

/** The oversold fixture — three paid, one flagged, one held, one expired, one refunded. */
const OVERSOLD = `${ADMIN}entries/${ADMIN_EVENT_SLUG}/`;

/** The quiet fixture — two entries against ten places, nothing wrong with it. */
const QUIET = `${ADMIN}entries/${CLEAN_EVENT_SLUG}/`;

/** What `apps/main`'s `preview` script binds, and what `seed.sql` installs the digest of. */
const LOCAL_GATE_KEY = 'local-development-only-not-a-real-key';

test.beforeAll(async () => {
  // **The local gate key, not the Miniflare one.** Playwright drives the `preview` Worker,
  // which is started with the key `seed.sql` installs the digest of — so that is the digest
  // this run has to leave in place. See the note on `seedAdminFixtures`.
  await seedAdminFixtures(LOCAL_GATE_KEY);
});

test.afterAll(async () => {
  // Put the local key back rather than nulling it: `./dev test --keep-up` leaves the site
  // running, and an admin surface that silently stopped existing after a test run would be a
  // puzzle with only `./dev reset` as its answer.
  await clearAdminFixtures(LOCAL_GATE_KEY);
});

/**
 * Sign in the way somebody does: a real form, a real submit, no script involved.
 *
 * **The Worker's key and the person's key are different things** and only the second is ever
 * typed. The first is bound on the Worker and matched by digest in the database; this types the
 * one issued to a person.
 *
 * The assertion is on something **only the signed-in page has**. The sign-in page carries the
 * same masthead, so asserting on that would have let a failed sign-in through — and every test
 * below would then have been asserting against a 401.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(ADMIN);
  await page.getByLabel('Your admin key').fill(ADMIN_PERSON_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/**
 * The document must not scroll sideways. Ever, at any width, on any of these pages.
 *
 * A pixel of tolerance, because a sub-pixel border on a fractional device ratio is not a layout
 * failure — but nothing above that, which is what caught the visually-hidden `<caption>` escaping
 * the old scroll region and dragging the whole page left under a thumb.
 */
async function expectNoSidewaysScroll(page: Page, note: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, `${note} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

test.describe('the door', () => {
  test('shows a sign-in form and nothing behind it', async ({ page }) => {
    const response = await page.goto(OVERSOLD);

    expect(response?.status()).toBe(401);
    await expect(page.getByLabel('Your admin key')).toBeVisible();
    // Not one name from behind the door reaches an unauthenticated page.
    await expect(page.getByText(AWKWARD_LAST_NAME)).toHaveCount(0);
  });

  test('refuses a wrong key without saying which half was wrong', async ({ page }) => {
    await page.goto(ADMIN);
    await page.getByLabel('Your admin key').fill('not-a-key-anybody-has');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('That key was not recognised');
    await expect(page.getByLabel('Your admin key')).toBeVisible();
  });

  test('signs in and out with no JavaScript at all', async ({ page }) => {
    // **The whole surface, driven by two form submissions.** Progressive enhancement is the
    // primary path here rather than a fallback, and this is the project that proves it.
    await signIn(page);

    // **Signing in lands on the dashboard for the *current* running, not on this file's
    // fixture** — it asks `entries.current_entry_state('nn')` exactly as `/nn/` does, which is
    // what keeps the year out of the route. So the assertion is that it landed on the dashboard
    // at all rather than on which running: naming one here would pin a year into a test, which is
    // the thing the whole route split exists to avoid.
    await expect(page).toHaveURL(/\/nn\/admin\/$/);
    await expect(page.getByText('Where the race stands')).toBeVisible();

    // A redirect, so a refresh does not re-post a credential.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible();

    // And the session really is gone, rather than merely looking gone.
    const response = await page.goto(OVERSOLD);
    expect(response?.status()).toBe(401);
  });
});

test.describe('the masthead and the event bar', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
  });

  test('names the role that lands in the audit, not a person', async ({ page }) => {
    // **The handle, in the mono face.** `entries.admin_keys` constrains it to a slug and the
    // runbook holds the mapping to a human, because this is the string written into every row of
    // `entries.admin_audit`. Showing it is what makes the audit trail legible to the person
    // generating it.
    await expect(page.getByText('Signed in as')).toBeVisible();
    await expect(page.getByText('zz-worker', { exact: true })).toBeVisible();
  });

  test('says the closing time is undecided rather than inventing one', async ({
    page,
  }) => {
    // The approved design showed "Closes Friday 23 October, 20:00". That was invented, like every
    // other number on it — the 2026 entry open and close times are not confirmed, and a plausible
    // one here is a date a volunteer repeats to a runner.
    await expect(page.getByText('not decided yet')).toBeVisible();
    await expect(page.getByText('23 October')).toHaveCount(0);
  });
});

test.describe('anything needing a human', () => {
  test('is the first thing on the page when something is flagged', async ({ page }) => {
    await signIn(page);
    await page.goto(OVERSOLD);

    const panel = page.getByRole('region', {
      name: /arrived after|waiting for a person/,
    });
    await expect(panel).toBeVisible();
    await expect(page.getByText('Needs a human')).toBeVisible();

    // Ahead of the figures, because it is the only thing here with a person waiting on it.
    const panelBox = await panel.boundingBox();
    const figuresBox = await page
      .getByText('Where the race stands')
      .first()
      .boundingBox();

    expect(panelBox!.y).toBeLessThan(figuresBox!.y);
  });

  test('is not on the page at all when nothing is flagged', async ({ page }) => {
    await signIn(page);
    await page.goto(QUIET);

    // The quiet event really did render — otherwise the absence below proves nothing.
    await expect(
      page.getByRole('rowheader', { name: new RegExp(CLEAN_PAID_LAST_NAME) }),
    ).toBeVisible();

    // **No panel, no empty state and no zero badge.**
    await expect(page.getByText('Needs a human')).toHaveCount(0);
    await expect(page.getByText('Over capacity')).toHaveCount(0);
  });
});

test.describe('where the race stands', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
  });

  test('breaks the field down the way the seeded rows add up', async ({ page }) => {
    // Three paid, one over capacity, one live hold, one expired hold, one refund — arithmetic
    // somebody can check against `admin-db.ts` rather than a snapshot.
    // **Scoped to the legend by class rather than by role.** The filter links are list items too,
    // and one of them is labelled "Paid" — so `getByRole('listitem')` matches two elements and
    // fails strict mode on a page that is perfectly correct.
    //
    // **"expired and returned" rather than "holds expired and returned"**, because the legend
    // agrees with its own count: this fixture has one, so it reads "1 hold expired and returned".
    // Matching the part that does not inflect is what makes the assertion about the figure being
    // present rather than about how many there happen to be.
    for (const label of [
      'paid',
      'over capacity',
      'held right now',
      'expired and returned',
    ]) {
      await expect(
        page.locator('.admin-legend li').filter({ hasText: label }).first(),
      ).toBeVisible();
    }

    await expect(page.getByText('£45.00')).toBeVisible();
  });

  test('states a medical deletion date computed from the enforced retention', async ({
    page,
  }) => {
    // The fixture races on 6 December 2026 and the enforced interval is one month. This is
    // `event_date + medical_retention` out of the database, not a reading of the published
    // sentence in `race.json`.
    await expect(page.getByText('6 January 2027')).toBeVisible();
  });

  test('names the affiliated claim that gave no number', async ({ page }) => {
    await expect(page.getByText('without giving a number')).toBeVisible();
    await expect(
      page.getByRole('rowheader', { name: new RegExp(MISSING_EA_LAST_NAME) }),
    ).toBeVisible();
  });
});

/**
 * The table, and **why these assertions are on visible text rather than on cells.**
 *
 * The narrow layout puts five of the eight columns in two places: their own `<td>` for wide
 * screens, and a stack inside the runner cell for phones. Exactly one copy is displayed at any
 * width and the other is `display: none`, which is what keeps it out of the accessibility tree.
 *
 * That makes `getByRole('cell', …)` the wrong locator for any of the five: at 375px the `<td>` is
 * gone, so mobile-safari found nothing. And `getByText(…).first()` is worse than wrong — it matches
 * in DOM order, and the runner cell comes *before* the `<td>`, so at desktop width it selected the
 * **hidden** copy and failed on markup that was perfectly correct. Both cost a red run.
 *
 * `filter({ visible: true })` asks the question the test actually means: *is this fact on the
 * screen*, at whichever width this project is running.
 */
test.describe('the entries table', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
  });

  /** The visible copy of a value that the narrow layout renders in two places. */
  const shown = (page: Page, text: string) =>
    page.getByText(text).filter({ visible: true }).first();

  test('renders every entry, with a derived category and no date of birth', async ({
    page,
  }) => {
    await expect(shown(page, 'Vet 40')).toBeVisible();
    await expect(shown(page, 'Vet 60')).toBeVisible();
    await expect(page.getByText('1986-12-06')).toHaveCount(0);
  });

  test('shows an entrant’s name and club as characters rather than as markup', async ({
    page,
  }) => {
    // `Inés O'Rourke` and a club with a quote in it. If either arrived as markup, the row
    // would be missing rather than wrong — which is why this asserts the text is *there*.
    await expect(
      page.getByRole('rowheader', {
        name: new RegExp(`${AWKWARD_LAST_NAME}, ${AWKWARD_FIRST_NAME}`),
      }),
    ).toBeVisible();
    await expect(shown(page, 'Bristol & West AC, "the Bees"')).toBeVisible();
  });

  test('gives every status its own word, not only a colour', async ({ page }) => {
    // A printed list is black ink and a phone in November sunlight is close to monochrome.
    for (const word of ['Paid', 'Over capacity', 'Hold expired', 'Refunded']) {
      await expect(
        page.getByText(word, { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
    }
  });

  test('shows the England Athletics number for the £2 check', async ({ page }) => {
    await expect(shown(page, PAID_EA_NUMBER)).toBeVisible();
  });

  test('shows no email address anywhere on the page', async ({ page }) => {
    await expect(page.getByText('@example.com')).toHaveCount(0);
  });
});

/**
 * The filters, which are links.
 *
 * The first pass used a GET form with three `<select>`s and an Apply button. That worked with
 * scripting off too — but a link gives a filtered view a URL somebody can bookmark or send to the
 * other volunteer, and makes the back button behave the way it looks like it should.
 */
test.describe('the filters', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
  });

  test('filter by clicking a link, with no form and no script', async ({ page }) => {
    await page.getByRole('link', { name: 'Paid', exact: true }).click();

    await expect(page).toHaveURL(/status=paid/);
    await expect(page.getByRole('rowheader', { name: /Nwosu, Harriet/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Adjei, Kwame/ })).toHaveCount(0);
  });

  test('returns what "needs attention" claims', async ({ page }) => {
    await page.getByRole('link', { name: 'Needs attention' }).click();

    await expect(
      page.getByRole('rowheader', { name: new RegExp(PAID_NON_ASCII_LAST_NAME) }),
    ).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Nwosu, Harriet/ })).toHaveCount(0);
  });

  test('puts nothing personal in the address bar, or in any link it offers', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'Paid', exact: true }).click();

    // **Every href the page offers, not only the one that was followed.** A filter added later
    // that carried a name would fail here rather than at review.
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

    for (const value of [page.url(), ...hrefs]) {
      for (const personal of [
        AWKWARD_LAST_NAME,
        AWKWARD_FIRST_NAME,
        'Nwosu',
        'example.com',
        PAID_EA_NUMBER,
      ]) {
        expect(value, `${personal} must not be in ${value}`).not.toContain(personal);
      }
    }
  });
});

test.describe('a medical note', () => {
  test('is behind a deliberate action, and reachable with no JavaScript', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);

    // Not on the list.
    await expect(page.getByText('inhaler')).toHaveCount(0);

    await page
      .getByRole('button', { name: /Show note/ })
      .first()
      .click();

    await expect(page.getByRole('heading', { name: 'Medical note' })).toBeVisible();
    await expect(page.getByText('inhaler')).toBeVisible();
    await expect(page.getByText('special category data')).toBeVisible();

    // **A POST, so the entrant id never lands in the address bar.**
    expect(page.url()).toContain('/nn/admin/medical/');
    expect(page.url()).not.toContain('entrantId');
  });
});

test.describe('the interest list', () => {
  test('is a count on the dashboard and addresses only on its own page', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);

    // The dashboard says how many are waiting and does not show one address.
    await expect(page.getByText('People waiting to hear')).toBeVisible();
    await expect(page.getByText('@example.com')).toHaveCount(0);

    await page.getByRole('link', { name: /Open the interest list/ }).click();

    await expect(page.getByRole('rowheader', { name: /Alice Fernsby/ })).toBeVisible();
    await expect(page.getByText('No — do not write').first()).toBeVisible();
  });
});

/**
 * The export, asserted on **the response rather than on a download event**.
 *
 * ## Why not `waitForEvent('download')`, which is the obvious thing
 *
 * **The three engines do not agree on what an attachment is, and one of them only disagrees on
 * Linux.** Given `content-type: text/csv` and `content-disposition: attachment`:
 *
 *   * Chromium turns it into a download. The `download` event fires; `response.body()` is
 *     **unreadable**, because the bytes went to the downloads directory rather than to the page.
 *   * WebKit on macOS turns it into a download too — which is why this passed locally, nine runs
 *     in a row.
 *   * **WebKit on Linux renders it in the tab.** No download event ever fires, `waitForEvent`
 *     times out, and the page navigates to `/nn/admin/export/` with the CSV as its body.
 *
 * That is the same shape as the radio-focus trap CLAUDE.md already records: the GTK/WPE WebKit
 * that `playwright install webkit` puts on a Linux runner is not the WebKit on a laptop, and CI
 * is the only place that sees it. It cost a red pipeline.
 *
 * **The response is the part that is actually specified**, and every engine agrees on it. What
 * a browser then chooses to do with a correctly-formed attachment is the browser's business —
 * and the volunteers use Chrome and desktop Safari, both of which download it.
 *
 * ## So it is asserted in two halves, and neither is the download machinery
 *
 *   1. **The journey**, driven by a real click with no JavaScript: the form posts and the answer
 *      is a CSV attachment with the right filename.
 *   2. **The bytes**, through `page.request`, which shares the context's cookies and hands back
 *      a readable body in every engine. The byte-order mark cannot be checked any other way —
 *      Chromium will not give a download's body back, and `Response.text()` strips the mark
 *      anyway (see `packages/shared/src/csv.ts`).
 *
 * The columns, the escaping and the paid-only rule are the Worker suite's to prove, at the layer
 * where the whole file can be read. This one proves a person can get it.
 */
test.describe('an export', () => {
  test('answers a real form submission with a CSV attachment, with no JavaScript', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);

    const response = page.waitForResponse((r) => r.url().endsWith('/nn/admin/export/'));
    await page.getByRole('button', { name: 'Download as CSV' }).click();
    const csv = await response;

    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toContain(
      `filename="${ADMIN_EVENT_SLUG}-start-list.csv"`,
    );
    // Nothing between the Worker and the person may keep a copy of a file of entrants.
    expect(csv.headers()['cache-control']).toBe('no-store');
  });

  test('sends bytes Excel can read, with the awkward club escaped', async ({ page }) => {
    await signIn(page);

    // `page.request` carries the context's cookies, so this is the same session the click
    // above uses — and unlike a download, its body is readable in every engine.
    const csv = await page.request.post(`${ADMIN}export/`, {
      form: { event: ADMIN_EVENT_SLUG, kind: 'start-list' },
    });

    expect(csv.status()).toBe(200);

    const bytes = await csv.body();
    const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(
      bytes,
    );

    // The byte-order mark, on the bytes. Without it Excel opens `Sørensen` as mojibake.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.startsWith(BOM)).toBe(true);
    expect(text).toContain(PAID_NON_ASCII_LAST_NAME);
    expect(text).toContain('"Bristol & West AC, ""the Bees"""');
  });
});

test.describe('the printable start list', () => {
  test('is a page a person can get to and print, with no JavaScript', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);

    await page.getByRole('button', { name: 'Print the start list' }).click();

    await expect(page.getByRole('heading', { name: /Start list/ })).toBeVisible();
    // The emergency contact is the reason this sheet exists, and the reason it is a separate act.
    // Filtered to the visible copy: it is a column at this width and a line in the stack at 320px,
    // and both are in the markup with one of them always `display: none`.
    await expect(
      page.getByText('Kin Nwosu').filter({ visible: true }).first(),
    ).toBeVisible();
    // Paid entries only. A lapsed hold is not a runner, and a bib set out for one is wasted.
    await expect(page.getByRole('rowheader', { name: /Adjei, Kwame/ })).toHaveCount(0);
    // And never the notes, which are their own sheet.
    await expect(page.getByText('inhaler')).toHaveCount(0);

    // **No print button, and that is deliberate**: it would need a script, and there is none on
    // any page this Worker builds. The browser's own command does the same job everywhere.
    await expect(page.getByText(/print command/)).toBeVisible();
  });
});

test.describe('accessibility and small screens', () => {
  const axe = (page: Page) =>
    new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

  test('has no axe violations on the sign-in page @requires-js', async ({ page }) => {
    await page.goto(ADMIN);

    expect((await axe(page)).violations).toEqual([]);
  });

  test('has no axe violations on the dashboard, with something flagged @requires-js', async ({
    page,
  }) => {
    // **The page with the attention panel, the capacity bar, four kinds of chip, the filter links
    // and the table on it.** Zero, not few — a threshold above zero becomes the new normal within
    // a month.
    await signIn(page);
    await page.goto(OVERSOLD);

    expect((await axe(page)).violations).toEqual([]);
  });

  test('has no axe violations on the dashboard with nothing flagged @requires-js', async ({
    page,
  }) => {
    // The same page without the panel. A conditional section is a different document, and this is
    // the one an organiser sees on every day but two.
    await signIn(page);
    await page.goto(QUIET);

    expect((await axe(page)).violations).toEqual([]);
  });

  test('has no axe violations on the interest list @requires-js', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}interest/`);

    expect((await axe(page)).violations).toEqual([]);
  });

  test('has no axe violations on the printable start list @requires-js', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
    await page.getByRole('button', { name: 'Print the start list' }).click();
    await expect(page.getByRole('heading', { name: /Start list/ })).toBeVisible();

    expect((await axe(page)).violations).toEqual([]);
  });

  /**
   * 320px, and **the table no longer scrolls sideways** — it restructures.
   *
   * The first pass scrolled it inside a focusable region, because eight columns do not reflow onto
   * a phone. That worked and cost a second scrolling region inside a page that already scrolls, on
   * a surface where 70% of visitors are on a phone. Below 48rem the table now drops to three
   * columns and the five it drops reappear inside the runner cell, so nothing scrolls at all.
   *
   * **Checked at four widths and on three pages, and the whole test runs in all three projects** —
   * so it is asserted with JavaScript on and off. The overflow bug this replaces was invisible:
   * the table scrolled correctly, the hidden text stayed hidden, and the only symptom was a page
   * that slid left under a thumb.
   */
  test('is operable at 320px, and no page scrolls sideways at any width', async ({
    page,
  }) => {
    await signIn(page);

    for (const width of [320, 360, 414, 768]) {
      await page.setViewportSize({ width, height: 640 });

      for (const [path, name] of [
        [OVERSOLD, 'the dashboard with a flag'],
        [QUIET, 'the dashboard with nothing flagged'],
        [`${ADMIN}interest/`, 'the interest list'],
      ] as const) {
        await page.goto(path);
        await expectNoSidewaysScroll(page, `${name} at ${width}px`);
      }
    }
  });

  test('folds the table into three columns on a phone, and shows the rest in the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await page.goto(OVERSOLD);

    // The five wide columns are gone rather than clipped — `display: none`, so they are out of
    // the accessibility tree too and nothing is announced twice.
    await expect(page.getByRole('columnheader', { name: 'Club' })).toBeHidden();
    await expect(page.getByRole('columnheader', { name: 'EA number' })).toBeHidden();

    // The three that remain, and the runner cell now carrying what the others dropped. Filtered to
    // the visible copy for the reason the table's own describe block explains — at this width the
    // `<td>` is the hidden one and the stack is the real one.
    await expect(page.getByRole('columnheader', { name: 'Runner' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(
      page.getByText('Southville Running Club').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Vet 40').filter({ visible: true }).first(),
    ).toBeVisible();

    // And the thing somebody is at the desk to do still works at this width.
    await expect(page.getByRole('button', { name: /Show note/ }).first()).toBeVisible();
  });

  /**
   * The start list at 320px, which is the page this most matters on.
   *
   * It is reached by a `POST`, so it cannot be navigated to — it has to be clicked through, which
   * is why it is a test of its own rather than another entry in the loop above. **It was missed for
   * exactly that reason**: the loop covered the pages with a URL, and the registration-desk
   * document is the one somebody actually opens on a phone at the desk.
   */
  test('does not scroll sideways on the printable start list at 320px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await signIn(page);
    await page.goto(OVERSOLD);
    await page.getByRole('button', { name: 'Print the start list' }).click();
    await expect(page.getByRole('heading', { name: /Start list/ })).toBeVisible();

    await expectNoSidewaysScroll(page, 'the start list at 320px');

    // **Folded to two columns — the runner and the tick box.** The emergency contact folds with the
    // rest, which is what took this from seven pixels of headroom to about a hundred and thirty. It
    // is still on screen, as a line in the stack rather than as a column.
    await expect(page.getByRole('columnheader', { name: 'Club' })).toBeHidden();
    await expect(
      page.getByRole('columnheader', { name: 'Emergency contact' }),
    ).toBeHidden();
    await expect(page.getByRole('columnheader', { name: 'Collected' })).toBeVisible();
    await expect(page.getByText('Kin Nwosu').filter({ visible: true })).toBeVisible();

    /**
     * **And again at 300px, which is narrower than any phone.**
     *
     * Not a real device — a margin check. This test passed at 320px on a laptop and failed by 4px
     * on a Linux runner, because there `clientWidth` is about fifteen pixels smaller: a classic
     * vertical scrollbar takes its width out of the viewport, and the font metrics are a shade
     * wider. Asserting at 300px means the layout has to hold with that margin already spent, so the
     * next platform difference of a few pixels is absorbed instead of turning the pipeline red.
     */
    await page.setViewportSize({ width: 300, height: 900 });
    await expectNoSidewaysScroll(page, 'the start list at 300px');
  });

  /**
   * The printed sheet, which is what this page is for.
   *
   * **The duplication that makes the narrow layout work is a hazard on paper**: `@media print`
   * has to restore all five columns *and* hide the stack, or every value prints twice. Nothing
   * else in the suite looks at print, and a sheet that printed each club and category twice would
   * reach a registration desk before anybody noticed.
   */
  test('prints as five columns with nothing duplicated @requires-js', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(OVERSOLD);
    await page.getByRole('button', { name: 'Print the start list' }).click();
    await expect(page.getByRole('heading', { name: /Start list/ })).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    for (const column of ['Club', 'Category', 'Emergency contact', 'Collected']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
    }

    // Exactly one copy of the club on paper, not the column plus the stacked line.
    await expect(
      page.getByText('Southville Running Club').filter({ visible: true }),
    ).toHaveCount(1);

    await page.emulateMedia({ media: 'screen' });
  });

  test('keeps every wide column when the screen is wide enough for them', async ({
    page,
  }) => {
    // The other half of the pair. Without this, hiding the columns at *every* width would pass.
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await page.goto(OVERSOLD);

    for (const column of ['Club', 'Category', 'Entry', 'EA number', 'Paid']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
    }
  });
});
