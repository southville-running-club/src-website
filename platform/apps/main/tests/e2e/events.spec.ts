import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * `/events/` — the club's socials, and the Christmas party's page.
 *
 * ## Why the axe scans carry `@requires-js` and nothing else here does
 *
 * **axe-core runs inside the page.** With `javaScriptEnabled: false` it never starts, so
 * `AxeBuilder.analyze()` sits there until Playwright's 30-second timeout — which reads as a
 * hanging page rather than as a scanner that cannot run. That is the same shape as
 * `page.waitForFunction` installing its loop in the page, which this repository has already
 * paid for once in `sideways-scroll.ts`.
 *
 * The `no-javascript` project excludes `@requires-js` by `grepInvert`, and elsewhere in this
 * suite that tag means exactly "an axe scan". **Every other test in this file deliberately
 * runs with scripting off**, because that is where they matter most: the disabled-control
 * guard is HTML5 constraint validation, which has no JavaScript fix, and the page's honesty
 * about what is confirmed is server-rendered.
 *
 * **Almost every assertion here is about what the page does *not* say.** The 2026 details are
 * not confirmed and the tickets are not on sale, so the page's whole job today is to be honest
 * about both — and the expensive failure would be a page that quietly showed last year's date
 * or offered a form that cannot take money.
 */

test.describe('the events section', () => {
  test('is offered from the club bar and lists the party', async ({ page }) => {
    await page.goto('/events/');

    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'SRC Christmas Party 2026' }),
    ).toBeVisible();
  });

  test('marks itself as the section being read', async ({ page }) => {
    await page.goto('/events/');

    const nav = page.getByRole('navigation', { name: 'Southville Running Club' });

    await expect(nav.locator('[aria-current="page"]')).toHaveText('Events');
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto('/events/');

    // Zero, not "few". Any threshold above zero becomes the new normal within a month.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('the Christmas party page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/christmas-party-2026/');
  });

  test('shows every fact the club has supplied, painted from the database', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'SRC Christmas Party 2026',
    );

    // Supplied by a club volunteer on 5 September 2026. **None of this is in the markup** —
    // this passing is proof the page is reading `store.socials` rather than carrying a date,
    // a time or a price in a template, which is the property that makes confirming any of
    // them an `update` and no deploy.
    await expect(page.getByText('Saturday 12 December 2026')).toBeVisible();
    await expect(page.getByText('7:30pm–1am')).toBeVisible();
    await expect(page.getByText('The Cock & Tail')).toBeVisible();
    await expect(page.getByText('£10.00')).toBeVisible();
    await expect(page.getByText('Entry requirements: 18+')).toBeVisible();
  });

  test('carries the club poster, described rather than transcribed', async ({ page }) => {
    const poster = page.getByRole('img', { name: /Christmas party poster/iu });

    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute('src', '/src-christmas-party-2026-1080.webp');

    // **Intrinsic dimensions, so the facts below do not jump down the page as it loads.**
    await expect(poster).toHaveAttribute('width', '1080');
    await expect(poster).toHaveAttribute('height', '1080');

    // **The alt says what the picture is, not what it says.** The date and the venue are in
    // real text directly below; repeating them here would read the party out twice to a
    // screen reader, and what is actually gained from this element is knowing it is a poster.
    const alt = (await poster.getAttribute('alt')) ?? '';

    expect(alt.length).toBeGreaterThan(20);
    expect(alt, 'the alt does not transcribe the date').not.toMatch(/12 December|Cock/iu);
  });

  test('takes its "to be confirmed" note down once there is nothing left to confirm', async ({
    page,
  }) => {
    // The note is revealed on `socialDetailsConfirmed()` being false — the date, the venue
    // *and* the start time all present. All three are, so it hides itself. It went stale once
    // by naming which details were missing; it names none now, so it cannot.
    await expect(page.getByText('still to be confirmed')).toBeHidden();
  });

  test('shows exactly one £, and never last year\u2019s date', async ({ page }) => {
    const body = await page.content();

    // ⚠️ A template that writes its own `£` beside a call to `formatPence()` renders
    // `££10.00`. This repository already carries six instances of that pattern (issue #175),
    // and the quantity picker's labels are the seventh place it could have arrived.
    expect(body.match(/££/gu), 'no doubled currency symbol').toBeNull();

    // The 2025 party was on the 6th. The venue and the price are legitimately last year's
    // now; the date is not, and a page showing it would be announcing the wrong Saturday.
    expect(body, 'last year\u2019s date must not appear').not.toContain('6 December');
  });

  test('says tickets are not on sale, and offers no form at all', async ({ page }) => {
    await expect(page.getByText('Tickets are not on sale yet')).toBeVisible();

    // The form ships hidden, and the Worker only reveals it when the window is open *and* a
    // price exists. Neither is true, so it must not be reachable.
    await expect(page.locator('[data-social-form]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Buy tickets' })).toBeHidden();
  });

  test('leaves every control disabled while the form is hidden', async ({ request }) => {
    // ⚠️ **`hidden` does not stop a control being validated.** A `required` input inside a
    // hidden container is still constrained, still empty and still invalid — so the browser
    // silently refuses to submit the form it is in, with no request and no visible error. That
    // took the live entry form down for every signed-in runner on 31 August 2026.
    //
    // Asserted on the served markup rather than through the DOM, because that is where the
    // attribute has to be: it is HTML5 constraint validation, so there is no JavaScript fix
    // and the `no-javascript` project meets it identically.
    const response = await request.get('/events/christmas-party-2026/');
    const html = await response.text();

    const form = html.slice(html.indexOf('data-social-form'), html.indexOf('</form>'));

    for (const control of ['purchaserName', 'email', 'emailConfirm', 'quantity']) {
      const at = form.indexOf(`id="${control}"`);
      expect(at, `${control} is in the form`).toBeGreaterThan(-1);

      // The tag holding this id has to carry `disabled` as well as sitting inside a hidden
      // container. Both, and never one alone.
      const tag = form.slice(form.lastIndexOf('<', at), form.indexOf('>', at));
      expect(tag, `${control} ships disabled`).toContain('disabled');
    }
  });

  test('refuses a POST rather than pretending to take an order', async ({ request }) => {
    const response = await request.post('/events/christmas-party-2026/', {
      form: {
        purchaserName: 'Alex Example',
        email: 'alex@example.com',
        emailConfirm: 'alex@example.com',
        quantity: '2',
        ticketCode: 'standard',
      },
      maxRedirects: 0,
    });

    // **Never a 303 to Stripe.** Nothing is on sale, no key is installed, and the failure
    // direction for a page attached to a card payment is towards taking no money. 409 says the
    // world moved; 503 says the club cannot take a payment right now. Either is honest.
    expect([409, 503]).toContain(response.status());
  });

  test('does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/events/christmas-party-2026/');

    // Through the shared helper, which waits for a *defined* state — every render-blocking
    // stylesheet applied, fonts settled, width stable across three samples — rather than for
    // the assertion to come good. Measuring straight off `toBeVisible()` measures a page with
    // no CSS on it, which failed about one run in three across two other specs.
    await expectNoSidewaysScroll(page, 'the Christmas party page at 320px');
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe('the page somebody lands on after paying', () => {
  test('claims nothing about the payment in either direction', async ({ page }) => {
    await page.goto('/events/christmas-party-2026/complete/');

    const body = await page.content();

    // ⚠️ **No negative claim, ever.** "Nothing was charged" while the webhook is merely late is
    // what sends somebody to pay a second time. The page reads no state at all, which is how
    // it is guaranteed not to say this.
    expect(body).not.toMatch(
      /not charged|nothing was taken|payment failed|was not paid/iu,
    );

    await expect(page.getByText('confirmation email is on its way')).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto('/events/christmas-party-2026/complete/');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
