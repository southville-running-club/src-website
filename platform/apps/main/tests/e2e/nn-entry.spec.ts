import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { closeEntries, openEntries } from '../entries-window';
import { clearPurchases, purchases, restoreCapacity, sellOut } from '../entries-db';

/**
 * The entry form, in a real browser, exactly as somebody will meet it.
 *
 * **Nothing here is tagged `@requires-js` except the axe checks**, and that is the point of
 * the file. The `no-javascript` project runs everything else with scripting turned off, so
 * "the entry form is completable with JavaScript disabled" is asserted rather than
 * asserted-about. Only axe carries the tag: it works by injecting a script and cannot report
 * on a page with scripting off.
 *
 * **Both states of `/nn/` are covered**, and the switch under test is the real one — the
 * event row, moved by `entries-window.ts`, exactly as the committee will move it. See that
 * file for why the suite runs a single worker.
 *
 * ## Where this suite stops, and why
 *
 * **It drives the form up to the redirect, asserts where the redirect goes, and picks up
 * again at the return URL. It never drives Stripe Checkout.** That page is a third party's:
 * a test that types into it breaks when Stripe redesigns it, and would be asserting Stripe's
 * behaviour rather than the club's. What matters here is the handoff — that a valid entry
 * holds exactly one place and hands over to `checkout.stripe.com` rather than to anywhere
 * else — and that is what is asserted.
 *
 * The Stripe request itself never leaves the machine. `platform/scripts/stripe-stub.mjs`
 * answers it with a canned session, and `apps/main/tests/unit/stripe.test.ts` asserts field
 * by field what would have been sent to the real one.
 */

/**
 * The entry form's half of `/nn/`.
 *
 * **Every locator has to say which form it means, because the page carries two.** Both are
 * in the DOM on every request and the Worker reveals one; `hidden` does not take an element
 * out of `getByLabel`'s reach, so an unscoped `getByLabel('Email address')` matches this
 * form's box *and* the interest form's, and Playwright's strict mode rightly refuses to
 * guess. `nn-signup.spec.ts` carries the mirror image of this helper for the same reason.
 */
const entry = (page: Page) => page.locator('[data-nn-entry]');

/**
 * The page the entry form is on — one running of the race, addressed by its year.
 *
 * **Pinned as a literal rather than read from `race.json` or from the database.** An
 * expectation that reads the same source as the page under test asserts nothing; this is the
 * same rule `site.spec.ts` follows for the race date.
 */
const YEAR = '/nn/2026/';

/**
 * Everything a valid entry needs, filled the way somebody would fill it — **including the
 * entry-terms box and an entry type**.
 *
 * Those last two are not tidiness. `#entry-terms` carries `required`, so a submission with
 * it unticked **never leaves the browser**: no request is made, the server never answers,
 * and a test asserting on a server-rendered error would sit waiting for a page that was
 * never requested. Every test here that wants to see the *server* refuse something has to
 * get past the browser first, and whitespace in a text box is the classic way in — it
 * satisfies `required` and fails validation.
 *
 * Pass `entryTerms: 'skip'` to leave the box alone, for the one case that wants the browser
 * to do the refusing.
 *
 * **Overriding `email` moves the confirmation box with it**, unless a test says otherwise.
 * The two have to match to be valid, and leaving that to each caller cost half an hour: a
 * test that only wanted a distinct address per purchase got a 422 about the confirmation box
 * and read as though the payment handoff had broken.
 */
async function fillEntry(
  page: Page,
  overrides: Partial<Record<string, string>> = {},
): Promise<void> {
  const values: Record<string, string> = {
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'e2e-entry@example.com',
    emailConfirm: 'e2e-entry@example.com',
    dobDay: '9',
    dobMonth: '12',
    dobYear: '1986',
    emergencyName: 'Margaret Hamilton',
    emergencyPhone: '0117 496 0000',
    entryTerms: 'accept',
    ...overrides,
  };

  if (overrides.email !== undefined && overrides.emailConfirm === undefined) {
    values.emailConfirm = overrides.email;
  }

  const form = entry(page);

  await form.getByLabel('First name', { exact: true }).fill(values.firstName!);
  await form.getByLabel('Last name', { exact: true }).fill(values.lastName!);
  await form.getByLabel('Email address', { exact: true }).fill(values.email!);
  await form
    .getByLabel('Confirm your email address', { exact: true })
    .fill(values.emailConfirm!);
  await form.getByLabel('Day', { exact: true }).fill(values.dobDay!);
  await form.getByLabel('Month', { exact: true }).fill(values.dobMonth!);
  await form.getByLabel('Year', { exact: true }).fill(values.dobYear!);
  await form.getByLabel('Gender', { exact: true }).selectOption('female');
  await form.getByLabel('Contact name', { exact: true }).fill(values.emergencyName!);
  await form
    .getByLabel('Contact phone number', { exact: true })
    .fill(values.emergencyPhone!);

  if (values.entryTerms !== 'skip') {
    await form.getByLabel(/I accept the entry terms/).check();
  }
}

/**
 * Answer any navigation to Stripe locally, so the hosted page is never fetched.
 *
 * **Nothing in this suite makes a request to Stripe.** The browser really does follow the
 * 303 — that is the behaviour under test — and this is what stands in the way of the request
 * actually leaving the machine. The hosted page is never fetched, rendered, parsed or typed
 * into: it is a third party's, and a test that drove it would break the week they redesign
 * it.
 *
 * `page.route` works at the network layer, so this is as true in the `no-javascript` project
 * as anywhere else.
 */
function blockStripePage(page: Page): Promise<void> {
  return page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stripe stands here</title><p>Stripe stands here.</p>',
    }),
  );
}

/**
 * Post the form without following what comes back.
 *
 * **The one way to read the `Location` header that works in every engine.** Catching the 303
 * off `page.on('response')` reads well and is not portable: WebKit does not surface an
 * intermediate redirect response the way Chromium does, so the assertion passed on two
 * engines and silently saw `null` on the third — a test passing for the wrong reason, which
 * is worse than no test.
 *
 * `maxRedirects: 0` is also the brief's instruction taken literally: assert where the
 * redirect goes, and do not go there.
 */
function postEntry(page: Page, fields: Record<string, string>) {
  // **Both forms are on this page**, one shown at a time, so the hidden field is what says
  // which this is — the same field the real form carries. Inferring it from the entry window
  // would read an interest submission as an entry if entries opened between the page loading
  // and the button being pressed.
  return page.request.post(YEAR, {
    form: { form: 'entry', ...fields },
    maxRedirects: 0,
  });
}

/**
 * Every console line and page error the browser produced, for the leak assertions.
 *
 * **A key in a console line is a key in anybody's devtools**, and it is the sort of thing
 * that gets added to debug a payment failure at the worst possible moment. Collected rather
 * than asserted here, so each test can check its own.
 */
function collectOutput(page: Page): string[] {
  const lines: string[] = [];

  page.on('console', (message) => lines.push(message.text()));
  page.on('pageerror', (error) => lines.push(String(error)));

  return lines;
}

/**
 * Written as separated fragments so this file does not itself contain a string a secret
 * scanner would flag, and so an assertion cannot pass by matching its own source.
 */
const KEY_PREFIXES = ['sk_' + 'test_', 'sk_' + 'live_', 'rk_' + 'test_', 'rk_' + 'live_'];

function expectNoKeys(text: string): void {
  for (const prefix of KEY_PREFIXES) {
    expect(text).not.toContain(prefix);
  }
}

// -----------------------------------------------------------------------------------------
// Entries not open — the state production is in today
// -----------------------------------------------------------------------------------------

test.describe('before entries open', () => {
  test.beforeAll(async () => {
    await closeEntries();
  });

  test('the year page shows the interest form and hides the entry form', async ({
    page,
  }) => {
    // `entries.events.entries_open_at` is null for NN 2026 because the opening time has not
    // been decided. To somebody looking at the page that means the same thing as "not yet" —
    // and what they get is the form that takes no money, on the running it is an interest in.
    await page.goto(YEAR);

    await expect(
      page.getByRole('heading', { name: 'Register your interest' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Register my interest' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enter the race' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeHidden();
  });

  test('both of the year page’s forms say which one they are', async ({ page }) => {
    // **The address cannot tell them apart** — they are on one page, one at a time — so the
    // body does. Not the window state, which would read an interest submission as an entry if
    // entries opened between the page loading and the button being pressed.
    await page.goto(YEAR);

    const kinds = await page
      .locator('input[name="form"]')
      .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value).sort());

    expect(kinds).toEqual(['entry', 'interest']);
  });

  test('has exactly one #enter on the page, in either state', async ({ page }) => {
    // **Two elements sharing one id is invalid HTML and an ambiguous fragment.** A "not open"
    // block once carried `#enter` alongside the form's own heading, and the hero's painted
    // link would have landed on whichever the browser found first — the sort of defect that
    // works on one engine and not the next. The block is gone; the guard is not.
    await page.goto(YEAR);

    await expect(page.locator('#enter')).toHaveCount(1);

    // And it is the form's own heading, so a painted `#enter` lands on the thing it names
    // rather than on the notice that happens to sit above it.
    await expect(page.locator('[data-nn-entry] #enter')).toHaveCount(1);
  });

  test('the race page keeps a route to the forms, which is the panel’s button', async ({
    page,
    request,
  }) => {
    await page.goto('/nn/');

    const action = page.locator('[data-nn-panel-action]');
    await expect(action).toHaveAttribute('href', YEAR);
    expect((await request.get(YEAR)).status()).toBe(200);
  });

  test('the race page carries neither form', async ({ page }) => {
    // **Both forms are on the running now.** Interest in what — the race in general, or this
    // year's? It is this year's, and the front door links to it rather than duplicating it.
    await page.goto('/nn/');

    await expect(page.locator('[data-entry-form]')).toHaveCount(0);
    await expect(page.locator('[data-nn-interest]')).toHaveCount(0);
  });

  test('offers the interest form from the year page hero, not an entry', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const cta = page.locator('[data-nn-cta]');
    await expect(cta).toHaveText('Register your interest');
    await expect(cta).toHaveAttribute('href', '#register');
  });

  test('the year panel answers when it is, and whether you can enter', async ({
    page,
  }) => {
    // **Two questions, in the order somebody arriving from a shared link has them.** The date
    // is the largest thing in the panel; whether they can enter is the button under it.
    await page.goto('/nn/');

    const panel = page.locator('[data-nn-panel]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('The next race')).toBeVisible();

    // Pinned as a literal, as `site.spec.ts` does with the race date — reading `race.json`
    // here would make the expectation and the page read the same source.
    await expect(panel.locator('[data-nn-panel-date]')).toHaveText('1 November 2026');
    await expect(panel.locator('[data-nn-panel-time]')).toHaveText('11:00');

    // The date is the biggest thing in it, and that is the design rather than a side effect.
    const sizes = await panel.evaluate((el) => ({
      date: parseFloat(
        getComputedStyle(el.querySelector('[data-nn-panel-date]')!).fontSize,
      ),
      facts: parseFloat(getComputedStyle(el.querySelector('.nn-panel-facts')!).fontSize),
      label: parseFloat(getComputedStyle(el.querySelector('.nn-panel-label')!).fontSize),
    }));
    expect(sizes.date).toBeGreaterThan(sizes.facts);
    expect(sizes.date).toBeGreaterThan(sizes.label);
  });

  test('the panel is quiet while entries are shut, and names no month', async ({
    page,
  }) => {
    // **The entry open and close times are unconfirmed and may not appear anywhere.**
    // "Entries open in September" would be a claim nobody has authorised.
    await page.goto('/nn/');

    const panel = page.locator('[data-nn-panel]');
    await expect(panel.locator('[data-nn-panel-action]')).toHaveClass(/nn-ghost/);
    await expect(panel).toContainText('Entries are not open yet');
    await expect(panel.locator('[data-nn-panel-open]')).toBeHidden();

    expect(await panel.textContent()).not.toMatch(
      /January|February|March|April|May|June|July|August|September|October|December/,
    );
  });

  test('the previous-years row is not rendered at all', async ({ page }) => {
    // **No heading, no empty container, no blank pills.** There is one running of this race
    // and it is the current one, so the row has nothing to show and shows nothing.
    await page.goto('/nn/');

    await expect(page.locator('[data-nn-previous]')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Previous years' })).toBeHidden();
  });

  test('the race page still links to this year, painted from the event row', async ({
    page,
    request,
  }) => {
    // **A front door, not a dead end.** The links are there whether or not entries are open,
    // and not one of them is written into the markup — which is what makes 2027 a row in
    // `entries.events` rather than an edit to a page.
    await page.goto('/nn/');

    const panel = page.locator('[data-nn-panel]');
    await expect(panel).toBeVisible();

    const hrefs = await panel
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

    expect(hrefs).toEqual(['/nn/2026/', '/nn/2026/race-day/', '/nn/2026/spectators/']);

    for (const href of hrefs) {
      expect((await request.get(href)).status()).toBe(200);
    }
  });

  test('the race page makes no claim that entries are open', async ({ page }) => {
    await page.goto('/nn/');

    await expect(page.locator('[data-nn-entries-open]')).toBeHidden();
  });

  test('quotes no price, because prices belong to an open entry', async ({ page }) => {
    // The three fee cards are in the DOM and stay hidden, with their prices unpainted. A
    // price on a page that cannot take an entry is a claim about a race nobody can enter.
    for (const path of ['/nn/', YEAR]) {
      await page.goto(path);

      const body = (await page.locator('body').textContent()) ?? '';
      expect(body, path).not.toMatch(/£\s?\d/);
    }
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    for (const path of ['/nn/', YEAR]) {
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(violations, path).toEqual([]);
    }
  });
});

// -----------------------------------------------------------------------------------------
// Entries open
// -----------------------------------------------------------------------------------------

test.describe('once entries are open', () => {
  test.beforeAll(async () => {
    // **Cleared as well as opened.** A run that failed halfway leaves purchases behind, and
    // "exactly one pending purchase" would then be counting somebody else's — the same lesson
    // the entry window taught during Slice A, one table along.
    await clearPurchases();
    await openEntries();
  });

  // Put back to the seeded state whatever happened above, so a failed run does not leave a
  // laptop showing an entry form that should not be there, or a laptop's database holding
  // fabricated entries against a real event.
  test.afterAll(async () => {
    await clearPurchases();
    await closeEntries();
  });

  test('the year page shows the entry form and drops the "not open" notice', async ({
    page,
  }) => {
    await page.goto(YEAR);

    await expect(page.getByRole('heading', { name: 'Enter the race' })).toBeVisible();
    await expect(page.locator('[data-nn-not-open]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();
  });

  test('a guide is told before the fourteen fields, not after them', async ({ page }) => {
    // **Issue #22, and step 0.4 of `docs/delivery/runbooks/entries-open.md`.** Stripe refuses a
    // zero-total Checkout session, so a visually impaired runner's guide cannot finish this
    // form — and the notice saying so ships `hidden`, revealed by the Worker only once a
    // submission has already been refused. The one person on the page who could not complete it
    // was the last to be told.
    //
    // **This copy is unconditional and it is above the form.** Asserted visible on a page where
    // nothing has gone wrong, asserted to carry a real way out, and asserted to come before the
    // form element — which is the whole of what 0.4 asks for. The `data-entry-free` stop in
    // `worker/nn-entry.ts` is deliberately untouched: this is copy in front of a backstop, not a
    // replacement for one.
    await page.goto(YEAR);

    const guide = entry(page).locator('[data-entry-guide]');

    await expect(guide).toBeVisible();
    await expect(guide).toContainText('that person enters free');
    await expect(guide).toContainText('cannot be booked through this form');

    // A literal rather than `race.json`'s value, for the reason `YEAR` is a literal: an
    // expectation that reads the page's own source asserts nothing.
    await expect(guide.getByRole('link', { name: 'contact us' })).toHaveAttribute(
      'href',
      'mailto:nightingalenightmare@southvillerunningclub.co.uk',
    );

    // **Before the form, not merely on the page.** Landing it anywhere below the first input
    // would be the same defect in a new place.
    const beforeTheForm = await page.evaluate(() => {
      const note = document.querySelector('[data-entry-guide]');
      const form = document.querySelector('[data-entry-form]');
      if (!note || !form) return null;
      return Boolean(
        note.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(beforeTheForm).toBe(true);
  });

  test('the panel changes weight, and the page adds no banner', async ({ page }) => {
    // **The difference in prominence is the message.** The action goes from a quiet outline to
    // the filled button every other primary control on this site uses, and the fee line
    // appears. Nothing else moves, and nothing announces the state in words.
    await page.goto('/nn/');

    const panel = page.locator('[data-nn-panel]');
    const action = panel.locator('[data-nn-panel-action]');

    await expect(action).toHaveClass(/nn-cta/);
    await expect(action).toHaveAttribute('href', '/nn/2026/#enter');
    await expect(action).toHaveText('Enter the race');
    await expect(panel.locator('[data-nn-panel-fees]')).toHaveText(
      '£20.00 unaffiliated · £18.00 affiliated',
    );
    await expect(panel.locator('[data-nn-panel-shut]')).toBeHidden();

    expect((await panel.textContent())?.toLowerCase()).not.toContain('entries are open');

    await expect(page.locator('[data-nn-interest]')).toBeHidden();
    await expect(page.locator('[data-entry-form]')).toHaveCount(0);
  });

  test('the panel keeps its shape across the two states', async ({ page }) => {
    // **The layout must not move when entries open**, so nobody has to relearn the page at the
    // one moment they are trying to do something. The date, the fact line and the two links
    // are where they were; only the action's weight and the note under it differ.
    await page.goto('/nn/');

    const panel = page.locator('[data-nn-panel]');
    await expect(panel.locator('[data-nn-panel-date]')).toHaveText('1 November 2026');
    await expect(panel.locator('[data-nn-panel-time]')).toHaveText('11:00');
    await expect(panel.getByRole('link', { name: 'Race instructions' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Spooktators' })).toBeVisible();
  });

  test('the panel’s action leads to the form, on the other page', async ({ page }) => {
    // **There is no button in the race page's hero any more.** It pointed at `#register`, and
    // that form moved to the running — an anchor to nothing looks like a control, is reached
    // by keyboard, and does nothing. The panel is the action, and the navigation carries one
    // too; a third in between was the copy furthest from anything it was about.
    await page.goto('/nn/');

    await expect(page.locator('[data-nn-cta]')).toHaveCount(0);

    const action = page.locator('[data-nn-panel-action]');
    await expect(action).toHaveText('Enter the race');
    await expect(action).toHaveAttribute('href', '/nn/2026/#enter');

    await action.click();
    await expect(page).toHaveURL(/\/nn\/2026\/#enter$/);
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();
  });

  test('takes its prices from the database, not from the markup', async ({ page }) => {
    // £18, £20 and a free guide's place — repriced from £15/£17 on 24 August 2026, decision
    // 006. The numbers live in `entries.fees.price_pence` and reach the page through the
    // Worker; nothing in `dist/` knows them, which is what `serves.test.ts` asserts by refusing
    // any `£` figure in the build at all.
    await page.goto(YEAR);

    await expect(page.locator('[data-entry-fee-price="affiliated"]')).toHaveText(
      '£18.00',
    );
    await expect(page.locator('[data-entry-fee-price="unaffiliated"]')).toHaveText(
      '£20.00',
    );
    await expect(page.locator('[data-entry-fee-price="vi_guide"]')).toHaveText('Free');
  });

  test('points the year page hero button at the form below it', async ({ page }) => {
    await page.goto(YEAR);

    const cta = page.locator('[data-nn-cta]');
    await expect(cta).toHaveText('Enter the race');
    await expect(cta).toHaveAttribute('href', '#enter');
  });

  test('links the agreements section to a notice that covers the entry', async ({
    page,
    request,
  }) => {
    // **The link has to be true of the page it lands on**, and it was not: it pointed at a
    // notice describing a three-field interest form while this form collects fourteen fields
    // and takes a payment. The notice covers both now, and this is what says so.
    await page.goto(YEAR);

    const agreements = entry(page).getByRole('group', { name: 'Agreements' });
    await expect(
      agreements.getByRole('link', { name: 'the privacy notice' }),
    ).toHaveAttribute('href', '/nn/privacy/');
    expect((await request.get('/nn/privacy/')).status()).toBe(200);

    await page.goto('/nn/privacy/');
    const body = (await page.locator('.nn-prose').textContent()) ?? '';
    expect(body).toMatch(/If you enter the race/i);
    expect(body).toMatch(/medical box/i);
  });

  test('leaves the entry terms unlinked, and says why', async ({ page }) => {
    // **The entry terms are a separate document and still do not exist.** A consent control
    // pointing at a page that is not there is worse than an honest absence, so the box has a
    // hint instead of a link — and the agreements section has exactly one link in it, which
    // is the privacy notice above. This fails the moment somebody links the terms to
    // something plausible rather than to something written.
    await page.goto(YEAR);

    const agreements = entry(page).getByRole('group', { name: 'Agreements' });

    await expect(
      agreements.getByText(/full entry terms are still to be confirmed/i),
    ).toBeVisible();

    const hrefs = await agreements
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

    expect(hrefs).toEqual(['/nn/privacy/']);
  });

  test('is completable with JavaScript disabled, and hands over to Stripe', async ({
    page,
  }) => {
    // **The whole argument of this site, on its longest form.** Fourteen fields, no
    // scripting, a real POST — and a real payment page at the end of it. Nothing here is
    // tagged `@requires-js`, so this runs in the `no-javascript` project too, which is what
    // makes "the primary path" a claim somebody has checked rather than an intention.
    await clearPurchases();

    await blockStripePage(page);
    const output = collectOutput(page);

    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-stripe@example.com' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    // **Where it went, not what is on the page it went to.** Stripe's hosted page is answered
    // locally with a placeholder, so nothing in this suite ever reaches Stripe. The `Location`
    // header itself is asserted by the test below, which does not follow it at all.
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

    // **Exactly one place held, at the price the database says.** £20.00 lives in
    // `entries.fees.price_pence` and nowhere else, and the anon key this page carries cannot
    // read this table at all — which is why the assertion needs a privileged connection.
    const held = await purchases();

    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      status: 'pending',
      amountPence: 2000,
      feeCode: 'unaffiliated',
      purchaserEmail: 'e2e-stripe@example.com',
    });
    expect(held[0]?.entrants).toEqual([
      { firstName: 'Grace', lastName: 'Hopper', club: null },
    ]);
    // No medical consent was given, so there is nothing to hold — the absence of a row *is*
    // the record of the withheld consent.
    expect(held[0]?.medicalNotes).toEqual([]);
    // The Checkout session was written back, which is what a reconciliation reads.
    expect(held[0]?.sessionId).toMatch(/^cs_test_/);

    expectNoKeys(output.join('\n'));
  });

  test('answers the POST itself with a 303 to Stripe, and no body', async ({ page }) => {
    // **The redirect asserted without being followed**, which is the only way to read the
    // header in every engine — and the only way to be sure nothing was rendered on the way.
    // The response carries no body at all, so nothing about the entry travels in one.
    await clearPurchases();

    const response = await postEntry(page, {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'e2e-raw@example.com',
      emailConfirm: 'e2e-raw@example.com',
      dobDay: '9',
      dobMonth: '12',
      dobYear: '1986',
      gender: 'female',
      feeCode: 'unaffiliated',
      emergencyName: 'Margaret Hamilton',
      emergencyPhone: '0117 496 0000',
      entryTerms: 'on',
    });

    expect(response.status()).toBe(303);
    expect(response.headers().location).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    // The page is one person's payment and nothing in front of it may hold a copy.
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.text()).toBe('');
    expectNoKeys(await response.text());

    const held = await purchases();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ status: 'pending', amountPence: 2000 });
  });

  test('holds exactly one place per press, not one per attempt', async ({ page }) => {
    // Somebody on bad signal presses the button, sees nothing happen, and presses it again.
    // Each press is a separate submission and holds its own place — which is correct, and
    // which is why the hold is short. What must **not** happen is one press producing two.
    await clearPurchases();

    await blockStripePage(page);
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-once@example.com' });
    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await entry(page)
      .getByLabel(/^England Athletics number/)
      .fill('1234567');

    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

    const held = await purchases();
    expect(held).toHaveLength(1);
    // **The affiliated price, and the £2 gap is ARC's rather than a discount.** Rule 21(2)(b)
    // makes the promoter impose the Unattached Runner Levy on a runner who is not a member of
    // an ARC- or UK Athletics-affiliated club, and 21(2)(c) makes the club remit it to ARC
    // within 30 days with the entry list — so the club nets £18 either way. The number comes
    // from the fees table; nothing here or in `dist/` knows it.
    expect(held[0]?.amountPence).toBe(1800);
  });

  test('keeps medical notes only where the consent was given', async ({ page }) => {
    // Special category data under UK GDPR Article 9, end to end: typed into a real form in a
    // real browser, and landing in its own table because the box beside it was ticked.
    await clearPurchases();

    await blockStripePage(page);
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-medical@example.com' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await entry(page)
      .getByLabel('Medical information (optional)', { exact: true })
      .fill('Type 1 diabetic.');
    await entry(page)
      .getByLabel(/I agree to the club holding/)
      .check();

    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

    const held = await purchases();
    expect(held[0]?.medicalNotes).toEqual(['Type 1 diabetic.']);
  });

  test('refuses a free guide’s place rather than holding one it cannot charge for', async ({
    page,
  }) => {
    // A payment page cannot take a payment of nothing, and completing a free entry would mean
    // deciding here that an unpaid entry counts as paid. It says so, gives the race address,
    // and **writes nothing**.
    await clearPurchases();
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-guide@example.com' });
    await entry(page)
      .getByLabel(/^VI guide/)
      .check();

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const notice = page.locator('[data-entry-free]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Nothing has been charged.');
    // It holds focus, which with no JavaScript is `autofocus` on an element carrying
    // `tabindex="-1"` — and is what tells somebody using a screen reader anything happened.
    await expect(notice).toBeFocused();

    expect(await purchases()).toEqual([]);
  });

  test('never renders a Stripe key into the page, on any path through it', async ({
    page,
  }) => {
    // **A key in rendered HTML is the failure nobody notices until it is public.** Checked on
    // the form, on a refusal and on the return page, because an error path is exactly where a
    // "print it so we can debug it" would go in.
    const output = collectOutput(page);

    await page.goto(YEAR);
    expectNoKeys((await page.content()) ?? '');

    await fillEntry(page, { firstName: '   ' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.locator('[data-entry-summary]')).toBeVisible();
    expectNoKeys(await page.content());

    await page.goto('/nn/2026/entry/complete/?session=cs_test_notreal');
    expectNoKeys(await page.content());

    expectNoKeys(output.join('\n'));
  });

  test('keeps every value when the server refuses it', async ({ page }) => {
    // **The failure that actually matters on a form this long.** Losing fourteen fields on a
    // phone on bad signal is the difference between one more tap and giving up.
    await page.goto(YEAR);

    await fillEntry(page, { firstName: '   ', emailConfirm: 'wrong@example.com' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await entry(page)
      .getByLabel(/^Running club/)
      .fill("O'Sullivan Runners");
    await entry(page)
      .getByLabel('Medical information (optional)', { exact: true })
      .fill('Type 1 diabetic.');

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const summary = page.locator('[data-entry-summary]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('There is a problem');
    await expect(summary).toBeFocused();

    // Nothing lost — including the apostrophe, the textarea and the radio.
    await expect(entry(page).getByLabel('First name', { exact: true })).toHaveValue(
      '   ',
    );
    await expect(entry(page).getByLabel('Last name', { exact: true })).toHaveValue(
      'Hopper',
    );
    await expect(
      entry(page).getByLabel('Confirm your email address', { exact: true }),
    ).toHaveValue('wrong@example.com');
    await expect(entry(page).getByLabel('Day', { exact: true })).toHaveValue('9');
    await expect(entry(page).getByLabel('Year', { exact: true })).toHaveValue('1986');
    await expect(entry(page).getByLabel('Gender', { exact: true })).toHaveValue('female');
    await expect(entry(page).getByLabel(/^Running club/)).toHaveValue(
      "O'Sullivan Runners",
    );
    await expect(entry(page).getByLabel(/^Unaffiliated/)).toBeChecked();
    await expect(
      entry(page).getByLabel('Medical information (optional)', { exact: true }),
    ).toHaveValue('Type 1 diabetic.');

    // Still on the form's own address, so correcting and pressing again is all that is left.
    await expect(page).toHaveURL(/\/nn\/2026\/$/);
  });

  test('attaches each message to the field it is about', async ({ page }) => {
    await page.goto(YEAR);

    await fillEntry(page, { firstName: '   ' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page.locator('[data-entry-error="firstName"]')).toContainText(
      'Enter your first name.',
    );
    await expect(entry(page).getByLabel('First name', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // Never colour alone: the summary names the field, the message is an instruction, and
    // the stylesheet prefixes it with the word "Error".
    await expect(page.locator('[data-entry-error="feeCode"]')).toContainText(
      'Choose an entry type.',
    );
  });

  test('links from the summary to the field it is about', async ({ page }) => {
    // The same guard the interest form carries, and the one that caught the view-transition
    // overlay swallowing clicks with scripting off. See the foot of nn-theme.css.
    await page.goto(YEAR);

    await fillEntry(page, { firstName: '   ' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await page.locator('[data-entry-summary-link="firstName"]').click();

    await expect(entry(page).getByLabel('First name', { exact: true })).toBeFocused();
  });

  test('marks the date of birth as one question, not three', async ({ page }) => {
    await page.goto(YEAR);

    await fillEntry(page, { dobDay: '31', dobMonth: '2' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page.locator('[data-entry-error="dateOfBirth"]')).toContainText(
      'That is not a date.',
    );

    // All three boxes are marked, because the question is wrong rather than one third of it.
    for (const part of ['Day', 'Month', 'Year']) {
      await expect(entry(page).getByLabel(part, { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    }
  });

  test('asks for an England Athletics number only when affiliated is chosen', async ({
    page,
  }) => {
    // **The England Athletics box is in the DOM whatever is selected**, so this works with
    // scripting off: the server is what decides whether it had to be filled in.
    await page.goto(YEAR);

    await fillEntry(page);
    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page.locator('[data-entry-error="eaNumber"]')).toContainText(
      'Enter your England Athletics number',
    );
  });

  test('refuses medical notes written without the separate consent', async ({ page }) => {
    // Special category data under UK GDPR Article 9. Ticking the entry terms is not consent
    // to hold it, and the form does not quietly bin what somebody wrote either.
    await page.goto(YEAR);

    await fillEntry(page);
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await entry(page)
      .getByLabel('Medical information (optional)', { exact: true })
      .fill('Asthma. Carries an inhaler.');

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page.locator('[data-entry-error="medicalConsent"]')).toContainText(
      'Tick the box to let the club hold it',
    );
  });

  test('never lets a typed value come back as markup', async ({ page }) => {
    await page.goto(YEAR);

    await fillEntry(page, { firstName: '"><script>window.__xss = 1</script>' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(entry(page).getByLabel('First name', { exact: true })).toHaveValue(
      '"><script>window.__xss = 1</script>',
    );
  });

  test('is operable at 320px', async ({ page }) => {
    // Run more than once by the suite's own repetition, and worth the paranoia: a one-in-four
    // intermittent was caught at this width when the hands artwork was an `<img>`.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(YEAR);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('is still operable at 320px with every error showing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(YEAR);

    // **Filled, not empty.** An empty form never leaves the browser: `required` on the text
    // inputs means the submit is refused client-side and no error state is ever reached, so
    // a test that clicked straight through would silently assert nothing. Whitespace is what
    // gets past `required` and is refused by the server — the same trick the interest form's
    // suite uses, and the reason server-side validation is never optional.
    await fillEntry(page, { firstName: '   ', emailConfirm: 'wrong@example.com' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.locator('[data-entry-summary]')).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('keeps the entry type that was chosen in view when the fee changes', async ({
    page,
  }) => {
    // **Choosing something must not throw it off the screen.** The England Athletics box used
    // to live *inside* the affiliated card, so picking anything else collapsed 277px from
    // above the other two cards: at 320px the card that had just been chosen went from y=271
    // to y=-7, and the feedback for somebody's own tap was the page jumping somewhere else.
    // The box sits under all three cards now, where hiding it moves only what is below.
    //
    // Asserted in every project, including `no-javascript` — where the box never collapses at
    // all, so the card must not move by so much as a pixel.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(YEAR);

    const cardPosition = () =>
      page.evaluate(() => {
        const card = document.querySelector('[data-entry-fee="vi_guide"]');

        if (card === null) {
          throw new Error('the VI guide card is not in the page');
        }

        const { top, bottom } = card.getBoundingClientRect();
        return { top, bottom, viewport: window.innerHeight };
      });

    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();

    await page.locator('[data-entry-fee="vi_guide"]').scrollIntoViewIfNeeded();
    const before = await cardPosition();

    await entry(page)
      .getByLabel(/^VI guide/)
      .check();

    const after = await cardPosition();

    // On the screen, both edges of it.
    expect(after.top).toBeGreaterThanOrEqual(0);
    expect(after.bottom).toBeLessThanOrEqual(after.viewport);
    // And within a line of where it was left, rather than merely somewhere on the page.
    expect(Math.abs(after.top - before.top)).toBeLessThan(24);
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto(YEAR);

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('the error state has zero axe violations @requires-js', async ({ page }) => {
    // The state a page is in when something has gone wrong is the state least likely to have
    // been checked, and the one somebody is most likely to be struggling with.
    await page.goto(YEAR);

    await fillEntry(page, { firstName: '   ' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.locator('[data-entry-summary]')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// The enhancement, which is only ever an enhancement
// -----------------------------------------------------------------------------------------

test.describe('what JavaScript adds @requires-js', () => {
  test.beforeAll(async () => {
    await openEntries();
  });

  test.afterAll(async () => {
    await closeEntries();
  });

  test('shows the age category as the date of birth and gender are typed', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const category = page.locator('[data-entry-category]');
    await expect(category).toBeHidden();

    await entry(page).getByLabel('Day', { exact: true }).fill('1');
    await entry(page).getByLabel('Month', { exact: true }).fill('11');
    await entry(page).getByLabel('Year', { exact: true }).fill('1986');
    await entry(page).getByLabel('Gender', { exact: true }).selectOption('male');

    // Born 1 November 1986, race day 1 November 2026 — forty **on** race day, which is the
    // boundary somebody will write in to argue about.
    await expect(category).toContainText('Age on race day: 40');
    await expect(category).toContainText('Vet 40');
  });

  test('says plainly that non-binary categories are undecided rather than inventing one', async ({
    page,
  }) => {
    await page.goto(YEAR);

    await entry(page).getByLabel('Day', { exact: true }).fill('9');
    await entry(page).getByLabel('Month', { exact: true }).fill('12');
    await entry(page).getByLabel('Year', { exact: true }).fill('1986');
    await entry(page).getByLabel('Gender', { exact: true }).selectOption('non_binary');

    const category = page.locator('[data-entry-category]');
    await expect(category).toContainText(
      'has not confirmed age categories for non-binary',
    );
  });

  test('hides the England Athletics box unless affiliated is chosen', async ({
    page,
  }) => {
    await page.goto(YEAR);

    const eaField = page.locator('[data-entry-ea-field]');

    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await expect(eaField).toBeHidden();

    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await expect(eaField).toBeVisible();
  });

  test('shows a running total once an entry type is chosen', async ({ page }) => {
    await page.goto(YEAR);

    const total = page.locator('[data-entry-total]');
    await expect(total).toBeHidden();

    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await expect(total).toHaveText('Total to pay: £18.00');

    await entry(page)
      .getByLabel(/^VI guide/)
      .check();
    await expect(total).toHaveText('Total to pay: Free');
  });

  test('validates inline without ever blocking a submission', async ({ page }) => {
    await page.goto(YEAR);

    await entry(page)
      .getByLabel('Email address', { exact: true })
      .fill('grace@example.com');
    await entry(page)
      .getByLabel('Confirm your email address', { exact: true })
      .fill('grace@exampel.com');
    // Leaving the field is what asks for a verdict — not the second keystroke.
    await entry(page).getByLabel('First name', { exact: true }).focus();

    await expect(page.locator('[data-entry-error="emailConfirm"]')).toContainText(
      'do not match',
    );

    // And it clears itself once put right, rather than waiting for a round trip.
    await entry(page)
      .getByLabel('Confirm your email address', { exact: true })
      .fill('grace@example.com');
    await expect(page.locator('[data-entry-error="emailConfirm"]')).toBeHidden();
  });

  test('says nothing about fields nobody has touched yet', async ({ page }) => {
    // Walking down a form lighting up every box ahead of the person is the version of this
    // that makes a long form feel hostile.
    await page.goto(YEAR);

    await entry(page).getByLabel('First name', { exact: true }).fill('Grace');
    await entry(page).getByLabel('Last name', { exact: true }).focus();

    await expect(page.locator('[data-entry-error="emergencyName"]')).toBeHidden();
    await expect(page.locator('[data-entry-error="entryTerms"]')).toBeHidden();
  });

  test('choosing an entry type says nothing about the England Athletics box', async ({
    page,
  }) => {
    // The specific path behind the test above, and the one that got through it. Leaving the
    // entry-type radio is not leaving the England Athletics box, and it was read as exactly
    // that: the box complained about a number nobody had reached, and because the message
    // appeared between the press and the release of the click that caused it, it moved the
    // other two cards out from under the pointer and the entry type could not be changed.
    await page.goto(YEAR);

    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();

    // WebKit leaves a radio unfocused when it is clicked and every other engine focuses it,
    // which is why this was invisible on a laptop and deterministic in CI. A keyboard user is
    // holding the radio either way, and Tab is what they press next.
    await entry(page)
      .getByLabel(/^Affiliated/)
      .focus();
    await page.keyboard.press('Tab');

    await expect(page.locator('[data-entry-error="eaNumber"]')).toBeHidden();
  });
});

// -----------------------------------------------------------------------------------------
// Sold out
// -----------------------------------------------------------------------------------------

test.describe('when the race is full', () => {
  // **The case where losing somebody's typing hurts most.** They have filled in fourteen
  // fields and are being told the race went while they were doing it; handing them an empty
  // form afterwards is what turns a disappointment into a grievance, and it is the one moment
  // somebody might want to write and ask about a waiting list.

  test.beforeAll(async () => {
    await restoreCapacity();
    await openEntries();
    await sellOut();
  });

  test.afterAll(async () => {
    // Back to 250 places and no purchases whatever happened, so a failed run does not leave a
    // laptop where the next entry sells the race out.
    await restoreCapacity();
    await closeEntries();
  });

  test('says so plainly, and keeps every value that was typed', async ({ page }) => {
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-soldout@example.com' });
    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await entry(page)
      .getByLabel(/^England Athletics number/)
      .fill('1234567');
    await entry(page)
      .getByLabel(/^Running club/)
      .fill("O'Sullivan Runners");
    await entry(page)
      .getByLabel('Medical information (optional)', { exact: true })
      .fill('Type 1 diabetic.');
    await entry(page)
      .getByLabel(/I agree to the club holding/)
      .check();

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const notice = page.locator('[data-entry-soldout]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('The race is full.');
    await expect(notice).toContainText('Nothing has been charged');
    await expect(notice).toBeFocused();

    // **Everything, including the three that a naive re-render drops**: the date of birth is
    // three inputs for one question, the entry type is a radio rather than a value, and the
    // medical notes are a textarea whose content is not an attribute.
    await expect(entry(page).getByLabel('First name', { exact: true })).toHaveValue(
      'Grace',
    );
    await expect(entry(page).getByLabel('Day', { exact: true })).toHaveValue('9');
    await expect(entry(page).getByLabel('Month', { exact: true })).toHaveValue('12');
    await expect(entry(page).getByLabel('Year', { exact: true })).toHaveValue('1986');
    await expect(entry(page).getByLabel('Gender', { exact: true })).toHaveValue('female');
    await expect(entry(page).getByLabel(/^Affiliated/)).toBeChecked();
    await expect(entry(page).getByLabel(/^England Athletics number/)).toHaveValue(
      '1234567',
    );
    await expect(entry(page).getByLabel(/^Running club/)).toHaveValue(
      "O'Sullivan Runners",
    );
    await expect(
      entry(page).getByLabel('Medical information (optional)', { exact: true }),
    ).toHaveValue('Type 1 diabetic.');
    await expect(entry(page).getByLabel(/I agree to the club holding/)).toBeChecked();

    // Still on the form's own address, so asking about a waiting list costs one more tap.
    await expect(page).toHaveURL(/\/nn\/2026\/$/);
  });

  test('never sends anybody to a payment page for a place that has gone', async ({
    page,
  }) => {
    // **The capacity check comes before the payment page**, so there is no redirect at all
    // rather than one that is later regretted. Asserted on the response itself rather than by
    // watching for a navigation that does not happen, which is the difference between proving
    // something and waiting for it.
    const response = await postEntry(page, {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'e2e-soldout-2@example.com',
      emailConfirm: 'e2e-soldout-2@example.com',
      dobDay: '9',
      dobMonth: '12',
      dobYear: '1986',
      gender: 'female',
      feeCode: 'unaffiliated',
      emergencyName: 'Margaret Hamilton',
      emergencyPhone: '0117 496 0000',
      entryTerms: 'on',
    });

    expect(response.status()).toBe(409);
    expect(response.headers().location).toBeUndefined();
    expect(await response.text()).toContain('The race is full.');
  });

  test('is operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-soldout-320@example.com' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.locator('[data-entry-soldout]')).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    // The state a page is in when something has gone wrong is the state least likely to have
    // been checked, and the one somebody is most likely to be struggling with.
    await page.goto(YEAR);

    await fillEntry(page, { email: 'e2e-soldout-axe@example.com' });
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.locator('[data-entry-soldout]')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// The page Stripe sends people back to
// -----------------------------------------------------------------------------------------

test.describe('the return page', () => {
  // **A URL somebody can type is not evidence of payment**, and this page must never behave
  // as though it were. It is reached by a redirect that fires in the person's browser — one
  // closed tab and it never fires at all — so what it renders is what the *webhook* has
  // recorded, looked up by Checkout session id, and never the fact of having arrived here.
  //
  // **The page grew three more states in Slice C and they live in
  // `nn-entry-complete.spec.ts`.** What stays here is the pair that belongs to the handoff:
  // that the end of the entry journey is reachable and that it claims nothing it cannot
  // support. Reachable in every window state, so this block moves nothing.

  test('renders the honest state for a session that matches nothing', async ({
    page,
  }) => {
    const response = await page.goto('/nn/2026/entry/complete/?session=cs_test_notreal');

    // Not an error. Somebody who has genuinely just paid must not meet a 500 because the
    // session id in their URL means nothing to the club's records.
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();

    // **"The club has not recorded a payment" and never "nothing was charged".** A session
    // that matches nothing may still be one somebody has genuinely paid for — the webhook may
    // be late, or the session id may not have been written back yet — and telling them
    // otherwise is how they pay a second time.
    const noRecord = page.locator('[data-complete="no-record"]');
    await expect(noRecord).toBeVisible();
    await expect(noRecord).toContainText('has not recorded a payment');
    await expect(noRecord).toContainText('do not enter again');
  });

  test('claims nothing about an entry having succeeded', async ({ page }) => {
    // The wording is the whole feature. A tick, a "thank you", or the word "confirmed" for a
    // session the club has no record of would be a confirmation for an entry that may not
    // exist — the one failure on this page worth more than every other put together.
    await page.goto('/nn/2026/entry/complete/?session=cs_test_notreal');

    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).not.toMatch(/you(’|')?re entered/i);
    expect(body).not.toMatch(/entry confirmed/i);
    expect(body).not.toMatch(/payment (received|successful|complete)/i);
    expect(body).not.toMatch(/thank you/i);
    // And the other direction, which Slice C added: no negative claim either.
    expect(body).not.toMatch(/nothing has been charged/i);
  });

  test('is reachable with no session parameter at all', async ({ page }) => {
    const response = await page.goto('/nn/2026/entry/complete/');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();

    // Somebody who typed the bare address has asked nothing, so the page says the club is
    // confirming rather than that it has no record of a payment they never mentioned.
    await expect(page.locator('[data-complete-confirming]')).toBeVisible();
  });

  test('is operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/nn/2026/entry/complete/?session=cs_test_notreal');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto('/nn/2026/entry/complete/?session=cs_test_notreal');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });
});
