import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BOM } from '@src/shared';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import {
  ADMIN_EVENT_SLUG,
  ADMIN_PERSON_KEY,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
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
 * ## The fixtures, and why they are this file's own
 *
 * Seeded here and removed afterwards, against **a fabricated event with its own race slug**.
 * Not `nn-2026`: `nn-entry.spec.ts` clears every purchase against the real event before each of
 * its tests, so a fixture there would vanish partway through a run — and a fixture claiming to
 * be a running of `nn` would change what `/nn/` resolves to for every other spec.
 *
 * The admin key's digest is installed by the same call and taken out in teardown, so a laptop
 * is never left with a working admin surface for a key written in a test file. The Worker's own
 * key comes from `apps/main`'s `preview` script, which passes the value `seed.sql` installs.
 *
 * ## Nothing here imports `race.json`, and nothing here reads a literal from the page
 *
 * The same rule the rest of this directory follows: an expectation read from the file the page
 * reads asserts nothing. Every string below is written out.
 */

const ADMIN = '/nn/admin/';

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
 * same `<h1>`, so asserting on the heading would have let a failed sign-in through — and every
 * test below would then have been asserting against a 401.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(ADMIN);
  await page.getByLabel('Your admin key').fill(ADMIN_PERSON_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();
}

test.describe('the door', () => {
  test('shows a sign-in form and nothing behind it', async ({ page }) => {
    const response = await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);

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

    // **The nav link goes to the *current* running, not to this file's fixture** — it asks
    // `entries.current_entry_state('nn')` exactly as `/nn/` does, which is what keeps the year
    // out of the route. So the assertion is that it landed on an entries page at all, rather
    // than on which one: naming the running here would pin a year into a test, which is the
    // thing the whole route split exists to avoid.
    await page.getByRole('link', { name: 'Entries' }).first().click();
    await expect(page.getByText('places taken')).toBeVisible();
    await expect(page).toHaveURL(/\/nn\/admin\/entries\/$/);

    await page.getByRole('button', { name: /Sign out/ }).click();
    await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible();

    // And the session really is gone, rather than merely looking gone.
    const response = await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);
    expect(response?.status()).toBe(401);
  });
});

test.describe('the entries list', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);
  });

  test('renders every entry, with a derived category and no date of birth', async ({
    page,
  }) => {
    await expect(page.getByRole('cell', { name: 'Vet 40' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Vet 60' })).toBeVisible();
    await expect(page.getByText('1986-12-06')).toHaveCount(0);
  });

  test('shows an entrant’s name and club as characters rather than as markup', async ({
    page,
  }) => {
    // `Inés O'Rourke` and a club with a quote in it. If either arrived as markup, the row
    // would be missing rather than wrong — which is why this asserts the text is *there*.
    await expect(
      page.getByRole('rowheader', {
        name: `${AWKWARD_LAST_NAME}, ${AWKWARD_FIRST_NAME}`,
      }),
    ).toBeVisible();
    await expect(page.getByText('Bristol & West AC, "the Bees"')).toBeVisible();
  });

  test('makes an over-capacity payment unmissable in words, not in colour', async ({
    page,
  }) => {
    // **The one row that must reach somebody**, and the assertion is on the words for the
    // reason the words are there: a printed list is black ink.
    await expect(page.getByRole('alert').first()).toContainText('over its field');
    await expect(page.getByText('OVER CAPACITY').first()).toBeVisible();
  });

  test('shows the England Athletics number for the £2 check', async ({ page }) => {
    await expect(page.getByRole('cell', { name: PAID_EA_NUMBER })).toBeVisible();
  });

  test('filters without JavaScript, through a real GET form', async ({ page }) => {
    await page.getByLabel('Status').selectOption('paid');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/status=paid/);
    await expect(page.getByRole('rowheader', { name: 'Nwosu, Harriet' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'Adjei, Kwame' })).toHaveCount(0);
  });

  test('puts nothing personal in the address bar', async ({ page }) => {
    await page.getByLabel('Status').selectOption('paid');
    await page.getByRole('button', { name: 'Apply' }).click();

    const url = page.url();
    for (const personal of [
      AWKWARD_LAST_NAME,
      AWKWARD_FIRST_NAME,
      'Nwosu',
      'example.com',
      PAID_EA_NUMBER,
    ]) {
      expect(url, `${personal} must not be in the URL`).not.toContain(personal);
    }
  });

  test('shows no email address anywhere on the page', async ({ page }) => {
    await expect(page.getByText('@example.com')).toHaveCount(0);
  });
});

test.describe('a medical note', () => {
  test('is behind a deliberate action, and reachable with no JavaScript', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);

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
  test('shows who signed up and who must not be written to', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}interest/`);

    await expect(page.getByRole('rowheader', { name: 'Alice Fernsby' })).toBeVisible();
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
    await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);

    const response = page.waitForResponse((r) => r.url().endsWith('/nn/admin/export/'));
    await page.getByRole('button', { name: 'Start list' }).click();
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

test.describe('accessibility and small screens', () => {
  test('has no axe violations on the sign-in page @requires-js', async ({ page }) => {
    await page.goto(ADMIN);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('has no axe violations on the entries list @requires-js', async ({ page }) => {
    // **The page with a table, a filter form, a scrollable region and a sticky header on it.**
    // Zero, not few — a threshold above zero becomes the new normal within a month.
    await signIn(page);
    await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('has no axe violations on the interest list @requires-js', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}interest/`);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('is operable at 320px, and the page itself does not scroll sideways', async ({
    page,
  }) => {
    // **The table scrolls; the document must not.** A data table of eight columns cannot
    // reflow onto a phone and pretending otherwise makes a list nobody can scan across — so it
    // scrolls inside its own region, and this is the assertion that the region is doing it
    // rather than the body.
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await page.goto(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);

    const region = page.getByRole('region', { name: /Entries/ });
    await expect(region).toBeVisible();

    // A scrollable region has to be reachable by keyboard, which is what `tabindex="0"` in the
    // markup is for. axe checks this too; asserting it here says what the attribute is *for*.
    await expect(region).toHaveAttribute('tabindex', '0');
  });
});
