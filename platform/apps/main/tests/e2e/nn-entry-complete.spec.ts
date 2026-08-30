import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { clearPurchases, clearWebhookKey, seedPurchase } from '../entries-db';
import { expectNoSidewaysScroll } from '../sideways-scroll';
import {
  FIXTURE_AMOUNT_PENCE,
  FIXTURE_EMAIL,
  FIXTURE_FIRST_NAME,
  FIXTURE_LAST_NAME,
  LAPSED_PURCHASE_ID,
  LAPSED_SESSION_ID,
  PAID_PURCHASE_ID,
  PAID_SESSION_ID,
  PENDING_PURCHASE_ID,
  PENDING_SESSION_ID,
  UNKNOWN_SESSION_ID,
} from '../webhook-fixtures';

/**
 * `/nn/2026/entry/complete/` in a real browser, in every state it can be in.
 *
 * **Nothing here is tagged `@requires-js` except the axe checks**, and that is the point of the
 * file: the `no-javascript` project runs all of it with scripting turned off, so "this page
 * works without JavaScript" is asserted rather than asserted-about. There is no script on this
 * page at all — no polling, no auto-refresh — and these are what say so.
 *
 * ## The one sentence this whole slice exists to prevent
 *
 * Somebody pays. The webhook is delayed or lost. Their thirty-one minute hold lapses. They
 * refresh this page. **If it tells them nothing was charged, they enter again and pay twice.**
 * So the rule is that only `paid` makes a positive claim and no state ever makes a negative
 * one, and `never says nothing was charged` below is the guard on it.
 *
 * ## Why the fixtures are written rather than paid for
 *
 * Reaching `paid` through the real path would need a signed Stripe delivery from a browser
 * test, and the acceptance suite deliberately never drives Stripe. The transition is proved by
 * `packages/db/tests/entries-webhook.test.ts` and its wiring by
 * `apps/main/tests/worker/webhook/`. What is left for this layer — and what only this layer can
 * do — is whether the resulting page is readable, operable at 320px, free of axe violations,
 * and honest.
 *
 * **The webhook key digest is explicitly cleared here.** These fixtures are written directly,
 * so nothing in this file needs it — and a run that left one installed against the real event
 * row would leave a laptop confirmable by anybody who read a test file.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Which block the page is showing, named the way the markup names it. */
const block = (page: Page, view: 'paid' | 'no-record' | 'refunded') =>
  page.locator(`[data-complete="${view}"]`);

const confirming = (page: Page) => page.locator('[data-complete-confirming]');

test.describe('the page Stripe returns somebody to', () => {
  test.beforeAll(async () => {
    // Cleared before as well as after: a run that failed halfway leaves rows behind, and the
    // next run's assertions would be reading somebody else's.
    await clearPurchases();
    await clearWebhookKey();

    const common = {
      amountPence: FIXTURE_AMOUNT_PENCE,
      email: FIXTURE_EMAIL,
      firstName: FIXTURE_FIRST_NAME,
      lastName: FIXTURE_LAST_NAME,
    };

    await seedPurchase({
      ...common,
      id: PAID_PURCHASE_ID,
      sessionId: PAID_SESSION_ID,
      status: 'paid',
    });
    await seedPurchase({
      ...common,
      id: PENDING_PURCHASE_ID,
      sessionId: PENDING_SESSION_ID,
      status: 'pending',
    });
    await seedPurchase({
      ...common,
      id: LAPSED_PURCHASE_ID,
      sessionId: LAPSED_SESSION_ID,
      status: 'pending',
      holdMinutes: -4,
    });
  });

  test.afterAll(async () => {
    await clearPurchases();
    await clearWebhookKey();
  });

  // ---------------------------------------------------------------------------------------
  // The three states
  // ---------------------------------------------------------------------------------------

  test('confirms a payment the webhook has recorded', async ({ page }) => {
    await page.goto(`/nn/2026/entry/complete/?session=${PAID_SESSION_ID}`);

    await expect(block(page, 'paid')).toBeVisible();
    await expect(confirming(page)).toBeHidden();
    // Asserted on the block rather than with `getByText`, which matches both the paragraph and
    // the `<strong>` inside it and fails strict mode on a nesting that is nobody's mistake.
    await expect(block(page, 'paid')).toContainText('your place is booked');
  });

  test('says it is still confirming while the payment is pending', async ({ page }) => {
    await page.goto(`/nn/2026/entry/complete/?session=${PENDING_SESSION_ID}`);

    await expect(confirming(page)).toBeVisible();
    await expect(block(page, 'paid')).toBeHidden();
    await expect(block(page, 'no-record')).toBeHidden();
  });

  test('says it is still confirming when there is no session in the address', async ({
    page,
  }) => {
    // Somebody who typed the bare address has asked nothing, and "we have no record of your
    // payment" would be alarming and meaningless.
    await page.goto('/nn/2026/entry/complete/');

    await expect(confirming(page)).toBeVisible();
  });

  test('offers a plain link to check again rather than refreshing underneath somebody', async ({
    page,
  }) => {
    // **No `<meta http-equiv="refresh">`, and this is the replacement.** A delayed refresh
    // under twenty hours fails WCAG 2.2.1 and axe reports it under `wcag2a`; it is also hostile
    // on a phone, under somebody who has just paid and is reading. The link is the reader's
    // decision instead, it costs one tap, and it works with scripting off — which is the
    // project this test also runs in.
    await page.goto(`/nn/2026/entry/complete/?session=${PENDING_SESSION_ID}`);

    const again = confirming(page).getByRole('link', { name: 'Check again' });
    await expect(again).toBeVisible();

    await again.click();

    // **The session id survives the round trip.** `href=""` resolves to the current URL with
    // its query string, which is what lets a static page carry a parameter it cannot know.
    await expect(page).toHaveURL(new RegExp(`session=${PENDING_SESSION_ID}$`));
    await expect(confirming(page)).toBeVisible();
  });

  // ---------------------------------------------------------------------------------------
  // The sentence that would cost somebody a second entry fee
  // ---------------------------------------------------------------------------------------

  test('never says nothing was charged, whatever state it is in', async ({ page }) => {
    for (const session of [
      PAID_SESSION_ID,
      PENDING_SESSION_ID,
      LAPSED_SESSION_ID,
      UNKNOWN_SESSION_ID,
    ]) {
      await page.goto(`/nn/2026/entry/complete/?session=${session}`);

      const text = await page.locator('body').innerText();

      expect(text, session).not.toMatch(/nothing has been charged/i);
      expect(text, session).not.toMatch(/your payment (failed|did not)/i);
    }
  });

  test('tells somebody with a lapsed hold not to enter again', async ({ page }) => {
    // **The webhook may simply be late.** The hold running out says nothing about whether a
    // card was charged, and the page must not pretend otherwise.
    await page.goto(`/nn/2026/entry/complete/?session=${LAPSED_SESSION_ID}`);

    await expect(block(page, 'no-record')).toBeVisible();
    await expect(confirming(page)).toBeHidden();
    await expect(block(page, 'no-record')).toContainText('do not enter again');
  });

  // ---------------------------------------------------------------------------------------
  // A session id in a URL is not authentication
  // ---------------------------------------------------------------------------------------

  test('a made-up session id reveals nothing about anybody', async ({ page }) => {
    await page.goto(`/nn/2026/entry/complete/?session=${UNKNOWN_SESSION_ID}`);

    await expect(block(page, 'no-record')).toBeVisible();

    const html = await page.content();

    expect(html).not.toContain(FIXTURE_EMAIL);
    expect(html).not.toContain(FIXTURE_FIRST_NAME);
    expect(html).not.toContain(FIXTURE_LAST_NAME);
    expect(html).not.toContain('Margaret Hamilton');
    expect(html).not.toContain('0117 496 0000');
    expect(html).not.toContain('1986');
    // The purchase id is the write path's key. The read path is keyed on the session id
    // precisely so the first cannot hand anybody the second.
    expect(html).not.toContain(PAID_PURCHASE_ID);
  });

  test('a real session id reveals nothing about anybody either', async ({ page }) => {
    // **The stronger half.** Somebody holding a genuine session id — off a screenshot, out of
    // browser history, from a `Referer` header — learns one word and no more.
    await page.goto(`/nn/2026/entry/complete/?session=${PAID_SESSION_ID}`);

    // **The artwork comes out before anything is matched against the markup**, and it has to.
    // Every inline SVG on this site carries `xmlns="http://www.w3.org/2000/svg"`, so a bare
    // `not.toContain('2000')` can never pass on any page that renders the wordmark — and the
    // path coordinates below it are pages of arbitrary digits besides, so which amount collides
    // next is a matter of luck rather than of care. `'1700'` happened not to; `'2000'` always
    // does. Decoration cannot hold personal data, so removing it narrows this to the part of
    // the document that could.
    const html = (await page.content()).replace(/<svg[\s\S]*?<\/svg>/g, '');

    expect(html).not.toContain(FIXTURE_EMAIL);
    expect(html).not.toContain(FIXTURE_FIRST_NAME);
    expect(html).not.toContain('Margaret Hamilton');
    expect(html).not.toContain(PAID_PURCHASE_ID);
    // Not the amount either. Which of three published prices a named person paid says whether
    // they are affiliated, and minimisation applies to a confirmation page too.
    //
    // **Derived from the fixture rather than written out**, because a literal here stops
    // testing silently the moment the fee moves — and it did: this read `'£17'` and `'1700'`
    // while the fixture became £20, so it was asserting the page did not contain a number the
    // page was never going to contain. A leak test that cannot fail is worse than no leak test,
    // because the row above it still looks covered. See the note on the artwork above for why
    // deriving it is not sufficient on its own.
    expect(html).not.toContain(String(FIXTURE_AMOUNT_PENCE));
    expect(html).not.toContain(`£${Math.floor(FIXTURE_AMOUNT_PENCE / 100)}`);
  });

  test('an injected session id comes back as characters rather than as markup', async ({
    page,
  }) => {
    // The parameter reaches the Worker and is passed to Postgres as a bound argument; nothing
    // paints it onto the page. This is the assertion that says so.
    await page.goto(
      `/nn/2026/entry/complete/?session=${encodeURIComponent('"><script>window.__x=1</script>')}`,
    );

    await expect(block(page, 'no-record')).toBeVisible();
    expect(await page.content()).not.toContain('window.__x');
  });

  // ---------------------------------------------------------------------------------------
  // Readable, operable, and clean
  // ---------------------------------------------------------------------------------------

  test('is operable at 320px in every state', async ({ page }) => {
    // 70% of visitors are on a phone, and 320 is the narrowest that still has to work.
    await page.setViewportSize({ width: 320, height: 640 });

    for (const session of [PAID_SESSION_ID, PENDING_SESSION_ID, LAPSED_SESSION_ID]) {
      await page.goto(`/nn/2026/entry/complete/?session=${session}`);

      // Nothing overflows sideways. A horizontal scrollbar on a phone is how a card ends up
      // with half a sentence off the edge. A pixel of tolerance, because a sub-pixel border
      // on a fractional device ratio is not a layout failure.
      await expectNoSidewaysScroll(page, `the return page (${session}) at 320px`, 1);

      // The club's address is reachable in every state, because it is what somebody does next
      // when the page cannot help them.
      await expect(
        page.getByRole('link', { name: /nightingalenightmare/i }).first(),
      ).toBeVisible();
    }
  });

  test('carries no meta refresh and no script', async ({ page }) => {
    // Both are requirements rather than observations. The refresh would be an axe violation
    // under WCAG 2.2.1; a polling script would break the page this file runs against with
    // scripting off.
    for (const session of [PAID_SESSION_ID, PENDING_SESSION_ID, LAPSED_SESSION_ID]) {
      await page.goto(`/nn/2026/entry/complete/?session=${session}`);

      await expect(page.locator('meta[http-equiv="refresh" i]')).toHaveCount(0);
      await expect(page.locator('script')).toHaveCount(0);
    }
  });

  test('the confirmed state has zero axe violations @requires-js', async ({ page }) => {
    await page.goto(`/nn/2026/entry/complete/?session=${PAID_SESSION_ID}`);

    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    expect(violations).toEqual([]);
  });

  test('the pending state has zero axe violations @requires-js', async ({ page }) => {
    await page.goto(`/nn/2026/entry/complete/?session=${PENDING_SESSION_ID}`);

    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    expect(violations).toEqual([]);
  });

  test('the no-record state has zero axe violations @requires-js', async ({ page }) => {
    // **The state least likely to have been looked at, and the one somebody is most likely to
    // be struggling with**, which is the same argument the entry form's error state makes.
    await page.goto(`/nn/2026/entry/complete/?session=${LAPSED_SESSION_ID}`);

    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    expect(violations).toEqual([]);
  });

  test('has zero axe violations at 320px @requires-js', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/nn/2026/entry/complete/?session=${PAID_SESSION_ID}`);

    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    expect(violations).toEqual([]);
  });
});
