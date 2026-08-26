import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BOM } from '@src/shared';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import {
  ADMIN_EVENT_SLUG,
  ADMIN_PASSWORD,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
  CLEAN_EVENT_SLUG,
  CLEAN_PAID_LAST_NAME,
  REGISTERED_EMAIL,
  MISSING_EA_LAST_NAME,
  NN_ADMIN_EMAIL,
  PAID_EA_NUMBER,
  PAID_NON_ASCII_LAST_NAME,
  PEOPLE_ADMIN_EMAIL,
  SUPER_ADMIN_EMAIL,
} from '../admin-fixtures';

/**
 * The club's back office in a real browser — `/admin/`, `/admin/nn/` and `/admin/people/`.
 *
 * ## What moved, and what this file kept
 *
 * This was `nn-admin.spec.ts`: one page about one race, entered by typing a key into a form.
 * #58 made it a back office with sections and #59 added the roles page, so it covers more
 * than Nightingale Nightmare and is named for what it covers. **Most of what is below is the
 * old file unchanged** — the figures, the filters, the medical panel, the start list and the
 * three exports are the same assertions about the same markup. What changed is the way in and
 * the addresses.
 *
 * ## The way in is an account, and every refusal is a 404
 *
 * There is no admin key and no key form. Somebody signs in at `/account/sign-in/` and the
 * roles they hold decide what exists: signed out, a plain member, the wrong role and an
 * address nobody built all get **the same 404**. That is #58's decision rather than an
 * omission — a 403 would tell anybody who can register exactly where the club's entry list
 * lives and that it is worth attacking — so the tests below assert the non-disclosure, not
 * only the status.
 *
 * ## Signing in without a script, and why that is not a cheat
 *
 * **The back office itself still has no JavaScript in it**, and that is the property the
 * `no-javascript` project exists to keep. The door in front of it now does: every
 * unauthenticated account form carries a Cloudflare Turnstile widget, which has no no-script
 * mode at all — #48's ADR accepted that for `/account/` and `account.spec.ts` documents it.
 *
 * Tagging this whole file `@requires-js` would have been the easy answer and it would have
 * quietly stopped proving the thing that matters: that a volunteer with scripting off can
 * still read a table, open a note and take an export. So `signInAs` posts the sign-in form
 * through `page.request`, which shares the browser context's cookies and needs no script in
 * the page — the same real form, the same CSRF token, the same Turnstile field, filled with
 * Cloudflare's own published dummy token that the local stack's dummy secret always passes.
 * **Every test below then exercises the surface itself with scripting genuinely off**, and
 * one `@requires-js` test drives the sign-in form by hand so the human door is covered too.
 *
 * `@requires-js` otherwise means what it means everywhere else in this directory: axe works
 * by injecting a script and cannot report on a page with scripting turned off.
 *
 * ## The fixtures
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
 * **One person per role set the door has to tell apart** — `admin-fixtures.ts` explains why
 * they are created through a real `signUp()`. The super-admin deliberately does *not* hold
 * `nn-admin` and the `people-admin` holds neither, which is what makes "granting a role is not
 * inheriting one" testable from both directions.
 *
 * ## Nothing here imports `race.json`, and the two rules about literals are different rules
 *
 * The same rule the rest of this directory follows: an expectation read from the file the page
 * reads asserts nothing, so every word the surface publishes is written out below rather than
 * imported from the content it is rendered from.
 *
 * **A value the fixture chose is the opposite case, and is always derived** — an address, a
 * surname, an event slug. A literal copy of one stops testing silently the moment the fixture
 * moves, which is the half of `CLAUDE.md`'s leak-assertion trap that fails towards passing.
 */

const ADMIN = '/admin/';
const NN = '/admin/nn/';
const PEOPLE = '/admin/people/';

/** The oversold fixture — three paid, one flagged, one held, one expired, one refunded. */
const OVERSOLD = `${NN}entries/${ADMIN_EVENT_SLUG}/`;

/** The quiet fixture — two entries against ten places, nothing wrong with it. */
const QUIET = `${NN}entries/${CLEAN_EVENT_SLUG}/`;

/**
 * What `apps/main`'s `preview` script binds, and what `seed.sql` installs the digest of.
 *
 * **It opens nothing any more.** #58 took the two keys out of the Worker; the digest is still
 * installed and restored so that the four key-gated database functions #63 removes keep
 * behaving as they are documented to until they are gone, and so that a laptop left running by
 * `./dev test --keep-up` is in the state `seed.sql` describes rather than in a state only a
 * test file explains.
 */
const LOCAL_GATE_KEY = 'local-development-only-not-a-real-key';

/** `worker/csrf.ts`'s two names, written out rather than imported — see the file header. */
const CSRF_COOKIE = 'src_csrf';
const CSRF_FIELD = 'csrf_token';

/**
 * Cloudflare's own published dummy response token.
 *
 * Accepted because `[auth.captcha]`'s secret locally and in CI is the matching published
 * "always passes" dummy secret — see `packages/db/supabase/config.toml` and
 * developers.cloudflare.com/turnstile/troubleshooting/testing. It authenticates nothing and
 * means nothing anywhere else.
 */
const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** A well-formed uuid that names nobody, for the refusal the page has to say words about. */
const NOBODY_AT_ALL = '0b0b0b0b-0000-4000-8000-0000000000ff';

test.beforeAll(async () => {
  await seedAdminFixtures(LOCAL_GATE_KEY);
});

test.afterAll(async () => {
  // Put the local key back rather than nulling it, for the reason `LOCAL_GATE_KEY` gives.
  await clearAdminFixtures(LOCAL_GATE_KEY);
});

/**
 * One real sign-in per email, for the whole file — not one per test.
 *
 * **This file used to authenticate fresh in `beforeEach` and at nearly every call site**,
 * which is 36 real round trips through `/account/sign-in/` for 44 tests, each one a genuine
 * GoTrue password check — deliberately slow, because that is what resists a credential-
 * stuffing attempt. `workers: 1` runs the whole 699-test suite through one browser and one
 * `wrangler dev` process, so that cost does not parallelise away; it is sustained load on one
 * long-lived server, on top of everything the rest of the suite already asks of it. Two CI
 * runs, both on a fresh runner, both otherwise green through four full browser projects, died
 * mid-`mobile-safari` with the Worker unreachable — consistent with load finally outrunning a
 * resource ceiling `ci.yml`'s own comment already names as tight for this suite.
 *
 * **A cookie jar is not the account; it is the proof that one exists.** Reusing a captured
 * session across many tests is not the same shortcut a fabricated token would be — the sign-in
 * still goes through the real form, the real CSRF token and the real Turnstile field, once per
 * person, and every test after that is still exercising `/admin/`'s own session and role
 * check on every request, exactly as before. What stops happening is proving the door works
 * over and over on the way to testing something else entirely.
 */
/** `Cookie[]`, derived from `Page` rather than named — `playwright-core`'s own type is not
 *  re-exported from `@playwright/test`. */
type SessionCookies = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>;

const sessionCookies = new Map<string, Promise<SessionCookies>>();

/** The real round trip, run exactly once per email — see `signInAs` above it. */
async function realSignIn(page: Page, email: string): Promise<void> {
  // The GET is what mints the double-submit token and sets its cookie; the POST has to echo
  // the same value back, which is the whole of the CSRF control.
  const form = await page.request.get('/account/sign-in/');
  expect(form.status(), 'the sign-in page must be served').toBe(200);

  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === CSRF_COOKIE,
  )?.value;

  expect(token, 'the sign-in page must mint a CSRF token').toBeTruthy();

  const signedIn = await page.request.post('/account/sign-in/', {
    form: {
      [CSRF_FIELD]: token ?? '',
      email,
      password: ADMIN_PASSWORD,
      'cf-turnstile-response': DUMMY_TURNSTILE_TOKEN,
    },
  });

  expect(signedIn.status(), `signing in as ${email} was refused`).toBe(200);
  expect(new URL(signedIn.url()).pathname, `signing in as ${email} did not land`).toBe(
    '/account/',
  );
}

/**
 * Sign somebody in — for real, the first time this email is asked for; from the cache after
 * that.
 *
 * **The cookies are the browser context's**, so everything after this is that person until
 * the next call. The jar is cleared first so switching people mid-test — the two-context
 * grant test, and the "gives a role the same 404" test that signs in twice on one page —
 * cannot leave half of a previous session behind, cached session or fresh one alike.
 */
async function signInAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();

  const cached = sessionCookies.get(email);

  if (cached === undefined) {
    const captured = realSignIn(page, email).then(() => page.context().cookies());
    sessionCookies.set(email, captured);
    await captured;
    return;
  }

  await page.context().addCookies(await cached);
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

/**
 * The page's markup with its decoration taken out.
 *
 * **Every inline SVG here carries `xmlns="http://www.w3.org/2000/svg"` and thousands of path
 * coordinates under it**, so matching a bare string against `page.content()` is unreliable in
 * both directions — and the direction it fails in is *towards passing*. Decoration cannot hold
 * personal data, so it is removed before anything is matched against it. The values matched are
 * derived from the fixtures rather than written out, for the same reason.
 */
async function undecoratedMarkup(page: Page): Promise<string> {
  return (await page.content()).replace(/<svg[\s\S]*?<\/svg>/g, '');
}

const axe = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

// -------------------------------------------------------------------------------------------
// The door
// -------------------------------------------------------------------------------------------

/**
 * **404 at every address, for every reason, and it is a decision.**
 *
 * Signed out, a plain member, the right session and the wrong role, an address nobody built —
 * one answer, and it discloses nothing. A 403 would tell anybody who can register exactly where
 * two hundred entrants' emergency contacts live.
 *
 * It is deliberately the back office's own bare 404 rather than the site's, which carries the
 * club navigation and the campaign theme: this must not link a signed-out stranger into
 * anything. See `worker/admin-shell.ts`.
 */
test.describe('the door', () => {
  test('answers a signed-out stranger with a 404 at every address', async ({ page }) => {
    for (const path of [ADMIN, NN, OVERSOLD, `${NN}interest/`, PEOPLE]) {
      const response = await page.goto(path);

      expect(response?.status(), `${path} signed out`).toBe(404);
      await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
      // Not one name from behind the door reaches it.
      await expect(page.getByText(AWKWARD_LAST_NAME)).toHaveCount(0);
    }
  });

  test('gives a plain registered account a 404 that does not say the address exists', async ({
    page,
  }) => {
    await signInAs(page, REGISTERED_EMAIL);

    const response = await page.goto(ADMIN);
    expect(response?.status()).toBe(404);

    // **The page must not disclose what it is refusing.** Nothing that names the back office,
    // nothing that names a section, and no word that reads as "you are not allowed" — which is
    // the sentence a 403 would have been.
    const markup = await undecoratedMarkup(page);

    for (const disclosure of [
      'Club admin',
      'Nightingale Nightmare',
      'People and roles',
      'permission',
      'Forbidden',
      'not authorised',
      REGISTERED_EMAIL,
    ]) {
      expect(markup, `the 404 must not contain ${disclosure}`).not.toContain(disclosure);
    }

    await expect(page.getByRole('navigation', { name: 'Club admin' })).toHaveCount(0);
  });

  test('gives a role the same 404 for the section it may not open', async ({ page }) => {
    // **The two staff roles do not inherit each other**, which is the whole reason the fixture
    // super-admin does not hold `nn-admin`.
    await signInAs(page, NN_ADMIN_EMAIL);
    expect((await page.goto(PEOPLE))?.status(), 'nn-admin at the roles page').toBe(404);
    expect(
      (await page.goto(`${ADMIN}nothing-here/`))?.status(),
      'an unbuilt address',
    ).toBe(404);

    await signInAs(page, SUPER_ADMIN_EMAIL);
    expect((await page.goto(NN))?.status(), 'super-admin at the race section').toBe(404);
    expect((await page.goto(OVERSOLD))?.status(), 'super-admin at a running').toBe(404);
  });

  test('lets somebody in through the sign-in form itself @requires-js', async ({
    page,
  }) => {
    // **The human door, driven by hand.** Everything else in this file posts the form through
    // `page.request` so the back office is exercised with scripting off; this is the one test
    // that proves the journey a volunteer actually makes, Turnstile widget and all.
    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(NN_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/$/);

    await page.goto(ADMIN);
    await expect(page.getByRole('heading', { name: 'Club admin' })).toBeVisible();
  });
});

// -------------------------------------------------------------------------------------------
// The shell
// -------------------------------------------------------------------------------------------

test.describe('the navigation', () => {
  /** What the bar offers, as a screen reader would read it. */
  const sections = (page: Page) =>
    page.getByRole('navigation', { name: 'Club admin' }).getByRole('link');

  test('shows the race section to somebody who holds nn-admin, and not the roles page', async ({
    page,
  }) => {
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(ADMIN);

    await expect(sections(page)).toHaveText(['Dashboard', 'Nightingale Nightmare']);

    // **A link to a page that 404s is worse than no link**: it tells somebody the page exists
    // and refuses them, which is the exact disclosure the 404 rule exists to avoid.
    await expect(page.getByRole('link', { name: 'People and roles' })).toHaveCount(0);

    // The one way out, shown to everybody with a staff role. A back office you can get into
    // and not out of is a place people close the tab on.
    await expect(page.getByRole('link', { name: 'My account' })).toBeVisible();
  });

  test('shows the roles page to a super-admin, and not the race section', async ({
    page,
  }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);
    await page.goto(ADMIN);

    await expect(sections(page)).toHaveText(['Dashboard', 'People and roles']);
    await expect(page.getByRole('link', { name: 'Nightingale Nightmare' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'My account' })).toBeVisible();
  });

  test('names the account somebody is signed in as, not a handle', async ({ page }) => {
    // **A change from `/nn/admin`, which showed a slug out of `entries.admin_keys` because a
    // handle was the only identity it had and the runbook held the mapping to a human.** This
    // surface knows who somebody is, and showing them which account they are signed in as is
    // what stops a volunteer granting a role from the wrong one of two accounts.
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(ADMIN);

    await expect(page.getByText('Signed in as')).toBeVisible();
    await expect(page.getByText(NN_ADMIN_EMAIL)).toBeVisible();
  });
});

test.describe('the dashboard', () => {
  test('is a way in and offers only what this person may open', async ({ page }) => {
    // **Deliberately thin.** A figure here would be a second place the club's numbers are
    // stated and the first one to go stale; the race's own figures are computed by the
    // database in the same query that lists the entries.
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(ADMIN);

    await expect(page.getByRole('heading', { name: 'Club admin' })).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Nightingale Nightmare' }),
    ).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'People and roles' }),
    ).toHaveCount(0);
  });
});

// -------------------------------------------------------------------------------------------
// Where the surface used to live
// -------------------------------------------------------------------------------------------

/**
 * **Every `/nn/admin/*` address is in a published runbook, and a runbook that 404s is worse
 * than one that is out of date.** So all of them keep resolving: 301 for a GET, and 308 for a
 * POST so that the method and the body survive — three of the seven are POSTs carrying an
 * entrant id or an export kind, and a 301 permits a client to turn a POST into a GET.
 *
 * The statuses themselves are `routing.test.ts`'s and the Worker suite's. What this layer adds
 * is that the journey works: the old address lands on the new page with the content on it, and
 * **the old POST address still answers with the file** — which a downgraded method could not.
 */
test.describe('the addresses that moved', () => {
  test('follows an old GET address through to the page it moved to', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    const response = await page.goto('/nn/admin/interest/');

    await expect(page).toHaveURL(/\/admin\/nn\/interest\/$/);
    await expect(page.getByRole('rowheader', { name: /Alice Fernsby/ })).toBeVisible();

    const before = response?.request().redirectedFrom();
    expect(before, 'the old address must redirect rather than answer').toBeTruthy();
    expect((await before!.response())?.status()).toBe(301);
  });

  test('keeps the method and the body on an old POST address', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    const csv = await page.request.post('/nn/admin/export/', {
      form: { event: ADMIN_EVENT_SLUG, kind: 'start-list' },
    });

    // A 301 turned into a GET would have lost both the method and the two fields, and answered
    // 404. Getting the file back is the assertion.
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toContain(
      `filename="${ADMIN_EVENT_SLUG}-start-list.csv"`,
    );
  });
});

// -------------------------------------------------------------------------------------------
// Nightingale Nightmare — everything /nn/admin did
// -------------------------------------------------------------------------------------------

test.describe('the event bar', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(OVERSOLD);
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

  test('opens on the current running when no year is in the address', async ({
    page,
  }) => {
    // **`/admin/nn/` asks `entries.current_entry_state('nn')` exactly as `/nn/` does**, which is
    // what keeps the year out of the route. So the assertion is that it landed on the dashboard
    // at all rather than on which running: naming one here would pin a year into a test, which is
    // the thing the whole route split exists to avoid.
    await page.goto(NN);

    await expect(page).toHaveURL(/\/admin\/nn\/$/);
    await expect(page.getByText('Where the race stands')).toBeVisible();
  });
});

test.describe('anything needing a human', () => {
  test('is the first thing on the page when something is flagged', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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

  test('shows no entrant’s email address, and only the reader’s own', async ({
    page,
  }) => {
    // **This was `getByText('@example.com')).toHaveCount(0)` and it could no longer pass**: the
    // masthead now names the account somebody is signed in as, which is an address, and the
    // fixtures are all at `example.com`. The claim the old line was making — *no entrant's
    // address is on this page* — is still the one that matters, so it is made directly.
    //
    // The markup is stripped of decoration first and the expected address is derived from the
    // fixture, per the two rules in `CLAUDE.md`: a literal stops testing silently the moment the
    // value moves, and a bare match against undecorated markup collides with SVG path data.
    const markup = await undecoratedMarkup(page);
    const addresses = new Set(
      markup.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [],
    );

    expect([...addresses]).toEqual([NN_ADMIN_EMAIL]);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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
    expect(page.url()).toContain('/admin/nn/medical/');
    expect(page.url()).not.toContain('entrantId');
  });
});

test.describe('the interest list', () => {
  test('is a count on the dashboard and addresses only on its own page', async ({
    page,
  }) => {
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(OVERSOLD);

    // The dashboard says how many are waiting and does not show one of their addresses. Scoped
    // to the main region, because the masthead names the reader's own account.
    await expect(page.getByText('People waiting to hear')).toBeVisible();
    await expect(page.getByRole('main').getByText('@example.com')).toHaveCount(0);

    await page.getByRole('link', { name: /Open the interest list/ }).click();

    await expect(page.getByRole('rowheader', { name: /Alice Fernsby/ })).toBeVisible();
    await expect(page.getByText('No — do not write').first()).toBeVisible();
  });
});

/**
 * The exports, asserted on **the response rather than on a download event**.
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
 *     times out, and the page navigates to the endpoint with the CSV as its body.
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
 * where the whole file can be read. This one proves a person can get them.
 */
test.describe('the exports', () => {
  test('answer a real form submission with a CSV attachment, with no JavaScript', async ({
    page,
  }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    // **All three, each behind its own button on its own panel**, because each is a different
    // disclosure: the England Athletics check list, race morning's start list, and the medical
    // sheet, which is special category data and is taken on purpose.
    for (const [button, kind] of [
      ['Download as CSV', 'start-list'],
      ['Download the check list', 'ea'],
      ['Take the medical sheet', 'medical'],
    ] as const) {
      await page.goto(OVERSOLD);

      const response = page.waitForResponse((r) => r.url().endsWith('/admin/nn/export/'));
      await page.getByRole('button', { name: button }).click();
      const csv = await response;

      expect(csv.status(), button).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
      expect(csv.headers()['content-disposition']).toContain(
        `filename="${ADMIN_EVENT_SLUG}-${kind}.csv"`,
      );
      // Nothing between the Worker and the person may keep a copy of a file of entrants.
      expect(csv.headers()['cache-control']).toBe('no-store');
    }
  });

  test('send bytes Excel can read, with the awkward club escaped', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    // `page.request` carries the context's cookies, so this is the same session the click
    // above uses — and unlike a download, its body is readable in every engine.
    const csv = await page.request.post(`${NN}export/`, {
      form: { event: ADMIN_EVENT_SLUG, kind: 'start-list' },
    });

    expect(csv.status()).toBe(200);

    const bytes = await csv.body();
    const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(
      bytes,
    );

    // The byte-order mark, on the bytes. Without it Excel opens `Sørensen` as mojibake, and
    // `TextDecoder` strips a leading U+FEFF by default — so a test that decoded first would
    // report a mark that is on the wire as missing.
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
    await signInAs(page, NN_ADMIN_EMAIL);
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

// -------------------------------------------------------------------------------------------
// People and roles — #59
// -------------------------------------------------------------------------------------------

/**
 * `/admin/people/`, and the two acts that change who may open what.
 *
 * **Only the CSRF token is this page's own rule.** That only a super-admin may grant, that the
 * last super-admin grant cannot be revoked, and that every change is audited in the same
 * transaction are all `identity.grant_role()`'s and `identity.revoke_role()`'s —
 * `packages/db/tests/identity.test.ts` re-attempts each bypass with an authenticated client and
 * asserts the specific refusal, exactly as `entries-rules.test.ts` does for Slice G's nine.
 * Zod, and a form, are never where a rule lives.
 */
test.describe('people and roles', () => {
  test('names the person on every grant and revoke control', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);
    await page.goto(PEOPLE);

    // **#59's requirement, and not a nicety**: without the person in the accessible name a
    // screen reader meets four buttons all called "Grant" and has to infer from the table which
    // row it is standing in. The visible label stays short because the column is narrow at
    // 320px, so the name is carried by a visually hidden span.
    await expect(
      page.getByRole('button', { name: `Grant nn-admin for ${REGISTERED_EMAIL}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Grant super-admin for ${REGISTERED_EMAIL}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Revoke nn-admin for ${NN_ADMIN_EMAIL}` }),
    ).toBeVisible();

    // And the other half of the claim: no control anywhere is named by its verb alone.
    for (const bare of ['Grant', 'Revoke', 'Grant nn-admin', 'Revoke nn-admin']) {
      await expect(
        page.getByRole('button', { name: bare, exact: true }),
        `no button may be called just "${bare}"`,
      ).toHaveCount(0);
    }
  });

  test('is a roles page rather than a member list', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);
    await page.goto(PEOPLE);

    // **Three columns, and the assertion is about the columns rather than about the values.**
    // The fixture people have no date of birth or address recorded at all, so asserting that
    // one is absent from the markup would pass whatever the page did — the vacuous half of the
    // trap in `CLAUDE.md`. What the page *can* be held to is that it offers nowhere to put one.
    await expect(page.getByRole('columnheader')).toHaveText([
      'Person',
      'Roles',
      'Change',
    ]);

    // **By row rather than by text**, because the address is in three places in that row — the
    // Person cell, and the hidden half of both of its buttons' names — so `getByText` matches
    // all three and fails strict mode on a page that is exactly right.
    await expect(
      page.getByRole('row').filter({ hasText: REGISTERED_EMAIL }),
    ).toBeVisible();
  });

  test('is the same page with no controls to somebody who may only read it', async ({
    page,
  }) => {
    // **Two columns rather than three**, which is the whole of `people-admin`. The column is
    // removed rather than filled with disabled buttons: a disabled control is a thing somebody
    // keeps trying, and it would still name a person and a role in its accessible name.
    await signInAs(page, PEOPLE_ADMIN_EMAIL);
    await page.goto(PEOPLE);

    await expect(page.getByRole('columnheader')).toHaveText(['Person', 'Roles']);

    // **`locator` rather than `getByRole('button')`**, and that is not a style choice: the
    // three engines do not agree on what a `<summary>` is in the accessibility tree — the
    // roles legend above the table is one — so a role query here would assert something about
    // the browser rather than about the page. The claim is that there is no control, and no
    // `<button>` and no `<form>` is exactly that claim.
    await expect(page.locator('button')).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);

    // They can still see everybody and what everybody holds — that is what they are for.
    await expect(
      page.getByRole('row').filter({ hasText: REGISTERED_EMAIL }),
    ).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: SUPER_ADMIN_EMAIL }),
    ).toBeVisible();

    // And the page says which of its two readings this is, rather than leaving a gap that
    // reads as a table which failed to load. **`toContainText` on `main` rather than
    // `getByText`**, because the sentence is inside a `<strong>` inside a `<p>` and both
    // contain it — two matches, and strict mode fails on a page that is exactly right.
    await expect(page.getByRole('main')).toContainText(
      'You can see who holds what, and not change it',
    );
  });

  test('refuses that reader the race section entirely', async ({ page }) => {
    // The third corner of *a grant is not an inheritance*: reading who has an account and
    // reading two hundred entrants' emergency contacts are different decisions, and holding
    // one must never be a way to reach the other.
    await signInAs(page, PEOPLE_ADMIN_EMAIL);

    expect((await page.goto(NN))?.status(), 'people-admin at the race section').toBe(404);
  });

  test('grants a role that takes effect on the next request, and takes it back', async ({
    page,
    browser,
  }) => {
    // **Two browser contexts, because this is a claim about two people at once**: the member is
    // signed in throughout and never signs in again, which is what "takes effect on the next
    // request" means. There is no session to end and nothing for them to do.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    try {
      await signInAs(memberPage, REGISTERED_EMAIL);
      expect(
        (await memberPage.goto(NN))?.status(),
        'a plain registered account before the grant',
      ).toBe(404);

      await signInAs(page, SUPER_ADMIN_EMAIL);
      await page.goto(PEOPLE);
      await page
        .getByRole('button', { name: `Grant nn-admin for ${REGISTERED_EMAIL}` })
        .click();

      // A 303 back to the list, so a reload does not repeat the act.
      await expect(page).toHaveURL(/\/admin\/people\/$/);
      await expect(
        page.getByRole('button', { name: `Revoke nn-admin for ${REGISTERED_EMAIL}` }),
      ).toBeVisible();

      const opened = await memberPage.goto(NN);
      expect(opened?.status(), 'the same session, one request later').toBe(200);
      await expect(memberPage.getByText('Where the race stands')).toBeVisible();

      await page.goto(PEOPLE);
      await page
        .getByRole('button', { name: `Revoke nn-admin for ${REGISTERED_EMAIL}` })
        .click();
      await expect(
        page.getByRole('button', { name: `Grant nn-admin for ${REGISTERED_EMAIL}` }),
      ).toBeVisible();

      expect(
        (await memberPage.goto(NN))?.status(),
        'and gone again on the next request',
      ).toBe(404);
    } finally {
      // **The fixture goes back whatever happened**, so the run is repeatable and so that
      // nothing after this file sees a member holding a staff role. `revoke_role` is idempotent
      // by state — a role that is not held answers `not_granted` and changes nothing — so this
      // is safe to run after a failure part-way through.
      await page.goto(PEOPLE);
      const revoke = page.getByRole('button', {
        name: `Revoke nn-admin for ${REGISTERED_EMAIL}`,
      });
      if ((await revoke.count()) > 0) {
        await revoke.click();
      }

      await memberContext.close();
    }
  });
});

// -------------------------------------------------------------------------------------------
// Accessibility and small screens
// -------------------------------------------------------------------------------------------

test.describe('accessibility and small screens', () => {
  test('has no axe violations on the dashboard or the roles page @requires-js', async ({
    page,
  }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);

    for (const path of [ADMIN, PEOPLE]) {
      await page.goto(path);
      expect((await axe(page)).violations, path).toEqual([]);
    }
  });

  test('has no axe violations on the roles page read by a people-admin @requires-js', async ({
    page,
  }) => {
    // **Its own pass, because it is a different table.** Two columns instead of three, no
    // forms, and a different sentence above it — a page whose markup differs is a page axe has
    // not seen, however close it looks to one that passed.
    await signInAs(page, PEOPLE_ADMIN_EMAIL);

    for (const path of [ADMIN, PEOPLE]) {
      await page.goto(path);
      expect((await axe(page)).violations, path).toEqual([]);
    }
  });

  test('has no axe violations on the race section @requires-js', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    // **The page with the attention panel, the capacity bar, four kinds of chip, the filter links
    // and the table on it**, then the same page without the panel — a conditional section is a
    // different document, and the second is the one an organiser sees on every day but two. Then
    // the interest list. Zero, not few — a threshold above zero becomes the new normal within a
    // month.
    for (const path of [OVERSOLD, QUIET, `${NN}interest/`]) {
      await page.goto(path);
      expect((await axe(page)).violations, path).toEqual([]);
    }
  });

  test('has no axe violations on the printable start list @requires-js', async ({
    page,
  }) => {
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(OVERSOLD);
    await page.getByRole('button', { name: 'Print the start list' }).click();
    await expect(page.getByRole('heading', { name: /Start list/ })).toBeVisible();

    expect((await axe(page)).violations).toEqual([]);
  });

  test('has no axe violations on the 404 a registered account gets @requires-js', async ({
    page,
  }) => {
    // The most-served page on this surface, and the one nobody looks at.
    await signInAs(page, REGISTERED_EMAIL);
    await page.goto(ADMIN);

    expect((await axe(page)).violations).toEqual([]);
  });

  /**
   * A refused grant, which is a state no navigation can reach.
   *
   * The three refusals a person can actually meet are the database's — not a super-admin any
   * more, the last super-admin grant, a role or a person that has gone — and every one of them
   * either changes something or depends on the state of the whole `role_grants` table. **The
   * last-super-admin refusal is the tempting one and it is a trap**: if this database ever held
   * a second super-admin the click would succeed, and the fixture's own super-admin would be
   * gone in the middle of a run with nothing able to grant it back.
   *
   * So the refusal is provoked with a form built in the page — the same method, the same action,
   * the same CSRF token the real controls carry, naming a person who does not exist. It writes
   * nothing, changes nothing, and is refused by `identity.grant_role()` rather than by the
   * Worker, which is what makes it the rendered error state rather than another 404.
   */
  test('has no axe violations when a change is refused @requires-js', async ({
    page,
  }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);
    await page.goto(PEOPLE);

    const token = (await page.context().cookies()).find(
      (cookie) => cookie.name === CSRF_COOKIE,
    )?.value;

    expect(token, 'the roles page must mint a CSRF token').toBeTruthy();

    await page.evaluate(
      ({ fields }) => {
        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/admin/people/';

        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.append(input);
        }

        document.body.append(form);
        // Out of this turn, so the evaluate resolves before the navigation destroys its context.
        setTimeout(() => form.submit(), 0);
      },
      {
        fields: {
          [CSRF_FIELD]: token ?? '',
          action: 'grant',
          person: NOBODY_AT_ALL,
          role: 'nn-admin',
        },
      },
    );

    // Announced, in the words the person reading needs rather than the database's.
    await expect(page.getByRole('alert')).toContainText('no longer has an account');

    expect((await axe(page)).violations).toEqual([]);
  });

  /**
   * 320px, and **the tables no longer scroll sideways** — they restructure.
   *
   * The first pass scrolled the entries table inside a focusable region, because eight columns do
   * not reflow onto a phone. That worked and cost a second scrolling region inside a page that
   * already scrolls, on a surface where 70% of visitors are on a phone. Below 48rem the table now
   * drops to three columns and the five it drops reappear inside the runner cell.
   *
   * **Checked at four widths, and the whole test runs in all three projects** — so it is asserted
   * with JavaScript on and off. The overflow bug this replaces was invisible: the table scrolled
   * correctly, the hidden text stayed hidden, and the only symptom was a page that slid left
   * under a thumb.
   */
  test('no page in the race section scrolls sideways at any width', async ({ page }) => {
    await signInAs(page, NN_ADMIN_EMAIL);

    for (const width of [320, 360, 414, 768]) {
      await page.setViewportSize({ width, height: 640 });

      for (const [path, name] of [
        [ADMIN, 'the back office dashboard'],
        [OVERSOLD, 'the race dashboard with a flag'],
        [QUIET, 'the race dashboard with nothing flagged'],
        [`${NN}interest/`, 'the interest list'],
      ] as const) {
        await page.goto(path);
        await expectNoSidewaysScroll(page, `${name} at ${width}px`);
      }
    }
  });

  /**
   * The roles page at 320px, which has **exactly the shape the trap in `CLAUDE.md` describes**.
   *
   * A table of email addresses and buttons, and on every one of those buttons an absolutely
   * positioned `.admin-visually-hidden` span carrying "for <address>" — the thing that made the
   * whole document slide left under a thumb the first time, while the table itself scrolled
   * perfectly and the spans stayed invisible. `overflow` only clips a descendant whose containing
   * block is inside the clipping box, so the span needs a positioned ancestor to be clipped by.
   *
   * Its own test rather than another entry in the loop above, because it is a different person's
   * page and because the failure it guards against is this specific one.
   */
  test('the roles page does not scroll sideways at 320px', async ({ page }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);

    for (const width of [320, 360, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(PEOPLE);
      await expectNoSidewaysScroll(page, `the roles page at ${width}px`);
    }

    /**
     * **And again at 300px, which is narrower than any phone.**
     *
     * Not a real device — a margin check. The same assertion passed at 320px on a laptop and
     * failed by 4px on a Linux runner, because there `clientWidth` is about fifteen pixels
     * smaller: a classic vertical scrollbar takes its width out of the viewport, and the font
     * metrics are a shade wider.
     */
    await page.setViewportSize({ width: 300, height: 900 });
    await page.goto(PEOPLE);
    await expectNoSidewaysScroll(page, 'the roles page at 300px');
  });

  test('folds the entries table into three columns on a phone, and shows the rest in the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
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

    // And again at 300px, a margin check rather than a device. See the roles page's note.
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
    await signInAs(page, NN_ADMIN_EMAIL);
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
    await signInAs(page, NN_ADMIN_EMAIL);
    await page.goto(OVERSOLD);

    for (const column of ['Club', 'Category', 'Entry', 'EA number', 'Paid']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
    }
  });
});
