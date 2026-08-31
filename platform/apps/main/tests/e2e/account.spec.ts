import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForStyledLayout } from '../sideways-scroll';

/**
 * Axe, run once the page is actually a styled page.
 *
 * ## Why the wait is here and not at each call site
 *
 * **An axe run on a bare document reports the absence of CSS as a design failure**, which is
 * the defect `sideways-scroll.ts` was written for, one assertion type along. `readyState`
 * reaches `interactive` before `<link rel="stylesheet">` has landed — DOMContentLoaded waits
 * for scripts, not sheets — so an outcome block the Worker has revealed is already *visible*,
 * `toBeVisible()` resolves, and axe then measures a document with no CSS on it.
 *
 * **`target-size` is the rule that catches it, and it caught CI on #182.** A link in the error
 * summary is 19px tall unstyled and comfortably past the 24px minimum once `base.css` applies,
 * so the bare page fails a rule the real page passes. That failure named an `account.spec.ts`
 * assertion **byte-identical to the one green on `main`**, in a run whose log also shows the
 * web server dying mid-run — runner pressure widening a race that was always there.
 *
 * **The fonts matter more here than they do for overflow.** A fallback face and the web font
 * give different line boxes, so a target measured mid-swap is measured at neither size.
 *
 * ## What this is not
 *
 * It waits for a **defined state** — sheets applied, fonts settled, layout stopped moving —
 * never for the violation list to come good. A page whose styled state really does violate a
 * rule fails exactly as before. Retrying until the answer is the wanted one is the other thing
 * entirely, and `sideways-scroll.ts`'s header is written against it.
 *
 * The tag list lived at nine call sites and is one thing now, so the five tags cannot drift
 * apart between the empty state and the error state of the same form.
 */
async function axeViolations(page: Page) {
  await waitForStyledLayout(page);

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  return violations;
}

/**
 * `/account/`, in a real browser, exactly as somebody will meet it.
 *
 * **Almost everything here is tagged `@requires-js`, and that is a broadened use of the
 * tag rather than a second one.** Elsewhere in this suite `@requires-js` means "an axe
 * check, which works by injecting a script" — `nn-signup.spec.ts`'s own header says so.
 * Here it also means "this page cannot be used at all with scripting off", because every
 * unauthenticated form carries a Cloudflare Turnstile widget and Turnstile has no
 * no-script mode. #48's ADR accepted that cost for this one area of the site; conflating
 * the two meanings is exactly how an exception like this gets forgotten, so it is written
 * down here and in `playwright.config.ts`.
 *
 * **The one untagged test in this file** asserts the honest fallback: with scripting off,
 * the widget never renders and the page says so plainly. That is the test the
 * `no-javascript` project actually runs.
 *
 * Confirmation mail is read through Mailpit's own API — `GET /api/v1/message/{id}` — rather
 * than through its web UI, which is faster and does not depend on Mailpit's own frontend
 * staying stable. Local Supabase's mail catcher; nothing here ever reaches a real mailbox.
 */

const MAILPIT = 'http://127.0.0.1:54324';

function addressFor(project: string): string {
  return `e2e-account-${project}-${Date.now()}@example.com`;
}

/**
 * Finds GoTrue's verify link in the mailbox for `email`, of the given `type`
 * (`signup` or `recovery`) — checking every message rather than trusting search-result
 * order, because a reset test's account already has one confirmation email sitting in the
 * same mailbox by the time the recovery one arrives, and Mailpit's own ordering is not a
 * contract this file should depend on.
 */
async function verifyLinkFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  // **No `signup` here since #101** — that email has its own shape and its own helper below.
  // Leaving it in the union would let a future caller ask for a link this function can no
  // longer find, and get a fifteen-second timeout instead of a type error.
  type: 'recovery' | 'magiclink',
): Promise<string> {
  const linkPattern = new RegExp(
    `https?:\\/\\/\\S*\\/auth\\/v1\\/verify\\?\\S*type=${type}\\S*`,
  );

  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };

    for (const { ID } of messages) {
      const response = await request.get(`${MAILPIT}/api/v1/message/${ID}`);
      const { Text, HTML } = (await response.json()) as { Text: string; HTML: string };
      const match = linkPattern.exec(`${Text}\n${HTML}`);
      if (match !== null) {
        // Mailpit's HTML body carries `&amp;` where the plain-text one carries `&`. Both
        // parse to the same URL once normalised.
        return match[0].replaceAll('&amp;', '&');
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No ${type} mail with a verify link arrived for ${email} within 15s`);
}

/**
 * The confirmation link, which since #101 is **not** the shape the three above are.
 *
 * `verifyLinkFor` looks for GoTrue's own `/auth/v1/verify` address. The confirmation email is
 * rendered from `packages/db/supabase/templates/confirmation.html` now and points at the club's
 * own `/account/confirm/` with a `token_hash`, because asking a member to prove who they are by
 * clicking `<project>.supabase.co` is the shape of a phishing email.
 *
 * ⚠️ **The host in that link comes from `emailRedirectTo`, which is why this stays local.** The
 * template deliberately does not build the URL from `site_url` — that is the club's real
 * hostname in every environment, so this test would navigate to the live site. If this ever
 * starts returning a `southvillerunningclub.co.uk` address on a laptop, the template has
 * regressed to the fallback branch and **that is the bug**, not this helper.
 */
async function confirmationLinkFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  const linkPattern = /https?:\/\/\S*\/account\/confirm\/?\?\S*type=signup/;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };

    for (const { ID } of messages) {
      const response = await request.get(`${MAILPIT}/api/v1/message/${ID}`);
      const { Text, HTML } = (await response.json()) as { Text: string; HTML: string };
      const match = linkPattern.exec(`${Text}\n${HTML}`);
      if (match !== null) return match[0].replaceAll('&amp;', '&');
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `No confirmation mail with a /account/confirm/ link arrived for ${email}`,
  );
}

/**
 * Waits for Cloudflare's dummy widget to put a response token in the form.
 *
 * The same wait the first test in this file spells out inline; extracted because #55 and #62
 * added five more forms that need it and five more copies would be five more places to get
 * the timeout wrong. **The `.first()` matters now** — `/account/sign-in/` carries two
 * widgets, one per form.
 *
 * @param formSelector scopes the wait to one form's widget when a page has more than one.
 */
async function settleTurnstile(
  page: import('@playwright/test').Page,
  formSelector?: string,
): Promise<void> {
  await page.waitForSelector('.cf-turnstile iframe', { timeout: 15_000 }).catch(() => {
    // Some renders never need an iframe for the dummy key — the response field below is
    // what actually matters.
  });

  const field =
    formSelector === undefined
      ? page.locator('[name="cf-turnstile-response"]').first()
      : page.locator(`${formSelector} [name="cf-turnstile-response"]`).first();

  await expect.poll(async () => field.inputValue(), { timeout: 15_000 }).not.toBe('');
}

test.describe('the account area, with scripting off', () => {
  test('says plainly that this page needs JavaScript', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'no-javascript',
      'Only runs on no-javascript project with scripting disabled',
    );

    await page.goto('/account/sign-up/');

    // The widget's own script tag never runs; the noscript fallback is what a person on a
    // script-blocking browser or extension actually sees.
    await expect(page.getByText(/needs JavaScript/i)).toBeVisible();
  });
});

test.describe('registering, confirming, signing in and out @requires-js', () => {
  test('goes all the way through', async ({ page, request }, testInfo) => {
    const email = addressFor(testInfo.project.name);
    const password = 'a-perfectly-good-password';

    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill('Grace Hopper');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);

    // Cloudflare's own dummy testing widget — `TURNSTILE_SITE_KEY` is the published
    // always-passes key locally, so the widget renders and completes on its own without
    // solving anything, exactly as it does in CI.
    await page.waitForSelector('.cf-turnstile iframe', { timeout: 15_000 }).catch(() => {
      // Some Turnstile renders never need an iframe for the dummy key — the response
      // field is what actually matters, checked next.
    });
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/account\/sign-up\/\?done=ok$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const link = await confirmationLinkFor(request, email);
    await page.goto(link);

    await expect(page.getByRole('heading', { name: /confirmed/i })).toBeVisible();

    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\/$/);

    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\/$/);

    // Signed out for real: the account page redirects again rather than showing stale
    // content from a cookie the browser forgot to drop.
    await page.goto('/account/');
    await expect(page).toHaveURL(/\/account\/sign-in\/$/);
  });

  test('an unconfirmed account cannot sign in, and is told to check its inbox', async ({
    page,
  }, testInfo) => {
    const email = addressFor(`${testInfo.project.name}-unconfirmed`);

    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill('Ada Lovelace');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('another-good-password');
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\?done=ok$/);

    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('another-good-password');
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // **Says to check the inbox, not that the password is wrong.** The password was right;
    // only the confirmation is missing, and the message has to say which.
    await expect(page.getByText(/check your inbox/i)).toBeVisible();
  });
});

test.describe('accessibility @requires-js', () => {
  test('the sign-up form has zero axe violations, empty and in its error state', async ({
    page,
  }) => {
    await page.goto('/account/sign-up/');
    const empty = await axeViolations(page);
    expect(empty).toEqual([]);

    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await axeViolations(page);
    expect(errored).toEqual([]);
  });

  test('the sign-in form has zero axe violations, empty and in its error state', async ({
    page,
  }) => {
    await page.goto('/account/sign-in/');
    const empty = await axeViolations(page);
    expect(empty).toEqual([]);

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await axeViolations(page);
    expect(errored).toEqual([]);
  });

  test('the reset-request form has zero axe violations, empty and in its error state', async ({
    page,
  }) => {
    await page.goto('/account/reset/');
    const empty = await axeViolations(page);
    expect(empty).toEqual([]);

    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await axeViolations(page);
    expect(errored).toEqual([]);
  });
});

/**
 * The error summary — #152, filed from #145's second defect.
 *
 * **The account forms already announced their errors**, so this was never a zero-violations
 * breach. What was missing is the *navigable* summary: the list of links at the top of the
 * form that takes somebody straight to the field that is wrong, which the Nightingale
 * Nightmare forms have had since they were written.
 *
 * It matters most for the people this area is for — in #56's words, the members most likely to
 * *"use the site once a year and forget they ever had one"*, who are also the most likely to
 * get a password wrong and the least likely to hunt a page for the reason.
 *
 * ⚠️ **The link test deliberately does not carry `@requires-js`**, and that is the whole point
 * of it. A CSS `@view-transition` swallows the click on a summary link with JavaScript
 * disabled — silently, so the person simply finds that nothing happens — and it passes with
 * scripting *on*, which is what makes it easy to ship. `nn-signup.spec.ts`'s own summary-link
 * test is the guard on that side; this is the guard on this one.
 */
test.describe('the error summary on the account forms', () => {
  test('lists every problem and links to the field it is about', async ({ page }) => {
    // An empty submission, which is the state somebody actually arrives in: three empty
    // boxes and, with scripting off, no captcha token either.
    await page.goto('/account/sign-up/');
    await page.getByRole('button', { name: 'Create account' }).click();

    const summary = page.locator('form[action="/account/sign-up/"] .notice-bad');

    await expect(summary).toBeVisible();
    await expect(
      summary.getByRole('heading', { name: 'There is a problem' }),
    ).toBeVisible();

    // **The link text is the message, not the field's label.** Somebody scanning a list of
    // three wants to know what is wrong; "Email address" three times over says nothing.
    const links = summary.getByRole('link');
    await expect(links.first()).toBeVisible();

    // Following it lands on the field, with no JavaScript anywhere in the path.
    await links.first().click();
    await expect(page).toHaveURL(/#account-name$/);
  });

  test('reads down the page rather than in whatever order an object enumerates', async ({
    page,
  }) => {
    // **The order is load-bearing**, the same reason `NN_ENTRY_FIELDS` is walked rather than
    // `Object.keys`: a summary that jumps about is worse than no summary for somebody working
    // through a form one field at a time.
    await page.goto('/account/sign-up/');
    await page.getByRole('button', { name: 'Create account' }).click();

    const hrefs = await page
      .locator('form[action="/account/sign-up/"] .notice-bad a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

    expect(hrefs.slice(0, 3)).toEqual([
      '#account-name',
      '#account-email',
      '#account-password',
    ]);
  });

  test('belongs to the form it is about, and the sign-in page has two forms', async ({
    page,
  }) => {
    // **A container's message belongs to that container**, which this repository has paid for
    // twice on the entry form — once badly enough that the entry type could not be changed at
    // all. `/account/sign-in/` carries a password form and a magic-link form with separate
    // error objects, deliberately, so a bad address in one must not mark up the other.
    await page.goto('/account/sign-in/');
    await page.getByRole('button', { name: 'Email me a link' }).click();

    await expect(page.locator('form[action="/account/link/"] .notice-bad')).toBeVisible();
    await expect(
      page.locator('form[action="/account/sign-in/"] .notice-bad'),
    ).toHaveCount(0);
  });

  test('the summary state has zero axe violations @requires-js', async ({ page }) => {
    // The state a page is in when something has gone wrong is the state least likely to have
    // been checked, and the one somebody is most likely to be struggling with.
    await page.goto('/account/password/');
    await page.goto('/account/sign-up/');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page.locator('form[action="/account/sign-up/"] .notice-bad'),
    ).toBeVisible();

    const violations = await axeViolations(page);

    expect(violations).toEqual([]);
  });
});

test.describe('resetting a forgotten password @requires-js', () => {
  test('goes all the way through, and the old password stops working', async ({
    page,
    request,
  }, testInfo) => {
    const email = addressFor(`${testInfo.project.name}-reset`);
    const oldPassword = 'the-original-good-password';
    const newPassword = 'a-different-good-password';

    // Register and confirm first — resetting a password needs an account to reset.
    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill('Katherine Johnson');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\?done=ok$/);
    await page.goto(await confirmationLinkFor(request, email));

    // Ask for a reset link.
    await page.goto('/account/reset/');
    await page.getByLabel('Email address').fill(email);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page).toHaveURL(/\/account\/reset\/\?done=ok$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    // Follow the link, set a new password.
    const link = await verifyLinkFor(request, email, 'recovery');
    await page.goto(link);
    await expect(
      page.getByRole('heading', { name: 'Choose a new password' }),
    ).toBeVisible();

    await expect
      .poll(async () => page.locator('[data-reset-form]').isHidden(), { timeout: 5_000 })
      .toBe(false);

    // The one state of this page a fixed axe test could never reach: revealed by the
    // inline script only once a real recovery link is followed.
    const resetConfirmAxe = await axeViolations(page);
    expect(resetConfirmAxe).toEqual([]);

    await page.getByLabel('New password').fill(newPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Set new password' }).click();

    // Signed in automatically — proving ownership of the mailbox is the whole point.
    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    // The old password no longer works; the new one does.
    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/not recognised/i)).toBeVisible();

    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(newPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/$/);
  });

  test('a reset request for an unknown address shows the same acknowledgement', async ({
    page,
  }) => {
    await page.goto('/account/reset/');
    await page.getByLabel('Email address').fill('nobody-at-all@example.com');
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Send reset link' }).click();

    await expect(page).toHaveURL(/\/account\/reset\/\?done=ok$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });
});

test.describe('changing a password from inside an account @requires-js', () => {
  test('requires the current password, and ends other sessions', async ({
    page,
    browser,
  }, testInfo) => {
    const email = addressFor(`${testInfo.project.name}-change`);
    const oldPassword = 'the-original-good-password';
    const newPassword = 'a-different-good-password';

    // A second, independent browser context — a second device signed in as the same
    // person, exactly what "ends other sessions" is claiming about.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    async function signIn(target: import('@playwright/test').Page, password: string) {
      await target.goto('/account/sign-in/');
      await target.getByLabel('Email address').fill(email);
      await target.getByLabel('Password', { exact: true }).fill(password);
      await expect
        .poll(
          async () =>
            target.locator('[name="cf-turnstile-response"]').first().inputValue(),
          { timeout: 15_000 },
        )
        .not.toBe('');
      await target.getByRole('button', { name: 'Sign in' }).click();
    }

    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill('Dorothy Vaughan');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.goto(await confirmationLinkFor(page.context().request, email));

    await signIn(page, oldPassword);
    await expect(page).toHaveURL(/\/account\/$/);

    // A second device signs in too, before the change.
    await signIn(otherPage, oldPassword);
    await expect(otherPage).toHaveURL(/\/account\/$/);

    await page.goto('/account/password/');
    const changePasswordEmptyAxe = await axeViolations(page);
    expect(changePasswordEmptyAxe).toEqual([]);

    await page.getByLabel('Current password').fill('the-wrong-password');
    await page.getByLabel('New password').fill(newPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/current password was not right/i)).toBeVisible();

    const changePasswordErrorAxe = await axeViolations(page);
    expect(changePasswordErrorAxe).toEqual([]);

    await page.getByLabel('Current password').fill(oldPassword);
    await page.getByLabel('New password').fill(newPassword);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/account\/$/);

    // The other device's session is dead — its next navigation bounces to sign-in.
    await otherPage.goto('/account/');
    await expect(otherPage).toHaveURL(/\/account\/sign-in\/$/);

    await otherContext.close();
  });
});

test.describe('the profile — name, email, gender, date of birth, address @requires-js', () => {
  test('saves every field, round-trips an apostrophe, and clears what is left blank', async ({
    page,
  }, testInfo) => {
    const email = addressFor(`${testInfo.project.name}-details`);
    const password = 'a-perfectly-good-password';

    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill("D'Arcy O'Malley");
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.goto(await confirmationLinkFor(page.context().request, email));

    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/$/);

    await page.goto('/account/details/');

    // The name sign-up collected has already reached this page — #61's migration and
    // trigger, made visible rather than merely asserted at the database.
    await expect(page.getByLabel('Your name')).toHaveValue("D'Arcy O'Malley");
    await expect(page.getByLabel('Email address')).toHaveValue(email);

    const emptyAxe = await axeViolations(page);
    expect(emptyAxe).toEqual([]);

    await page.getByLabel('Gender').fill('non-binary');
    await page.getByLabel('Day').fill('15');
    await page.getByLabel('Month').fill('6');
    await page.getByLabel('Year').fill('1990');
    await page.getByLabel('Address', { exact: true }).fill('1 Analytical Engine Way');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/account\/details\/\?done=ok$/);
    // No email change was submitted, so the acknowledgement says nothing about confirming
    // two inboxes — the case-insensitive "unchanged" comparison working end to end.
    await expect(page.getByText(/confirmation link/i)).toHaveCount(0);

    await page.goto('/account/details/');
    await expect(page.getByLabel('Gender')).toHaveValue('non-binary');
    await expect(page.getByLabel('Day')).toHaveValue('15');
    await expect(page.getByLabel('Month')).toHaveValue('6');
    await expect(page.getByLabel('Year')).toHaveValue('1990');
    await expect(page.getByLabel('Address', { exact: true })).toHaveValue(
      '1 Analytical Engine Way',
    );

    // A date of birth that is not a real day — the cross-field error, and its own axe pass.
    await page.getByLabel('Day').fill('31');
    await page.getByLabel('Month').fill('2');
    await page.getByRole('button', { name: 'Save changes' }).click();

    // **The message is on the page twice now, and that is the point rather than a fault.**
    // #152 put an error summary at the top of this form, and a summary repeats each message as
    // the text of the link that goes to the field — a label like "Date of birth" three times
    // over would tell a reader nothing. So this asks for the field's own message by its id,
    // and the line below asks for the summary's link separately.
    await expect(page.locator('#account-dob-error')).toBeVisible();
    await expect(
      page.locator('form[action="/account/details/"] .notice-bad').getByRole('link', {
        name: /enter a real date/i,
      }),
    ).toHaveAttribute('href', '#account-dob-day');

    const errorAxe = await axeViolations(page);
    expect(errorAxe).toEqual([]);

    // Clearing every optional field, date of birth included — the previous step left a
    // real day (31 February is invalid) in place of last one; this proves a filled-in
    // field can be taken back out again, boxes and all.
    await page.getByLabel('Day').fill('');
    await page.getByLabel('Month').fill('');
    await page.getByLabel('Year').fill('');
    await page.getByLabel('Gender').fill('');
    await page.getByLabel('Address', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/account\/details\/\?done=ok$/);

    await page.goto('/account/details/');
    await expect(page.getByLabel('Gender')).toHaveValue('');
    await expect(page.getByLabel('Address', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Day')).toHaveValue('');
    await expect(page.getByLabel('Month')).toHaveValue('');
    await expect(page.getByLabel('Year')).toHaveValue('');
  });

  test('changing the email address asks for confirmation from both addresses', async ({
    page,
  }, testInfo) => {
    const email = addressFor(`${testInfo.project.name}-email-change`);
    const newEmail = addressFor(`${testInfo.project.name}-email-change-new`);
    const password = 'a-perfectly-good-password';

    await page.goto('/account/sign-up/');
    await page.getByLabel('Your name').fill('Grace Hopper');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.goto(await confirmationLinkFor(page.context().request, email));

    await page.goto('/account/sign-in/');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect
      .poll(
        async () => page.locator('[name="cf-turnstile-response"]').first().inputValue(),
        { timeout: 15_000 },
      )
      .not.toBe('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/$/);

    await page.goto('/account/details/');
    await page.getByLabel('Email address').fill(newEmail);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(/\/account\/details\/\?done=ok&email=pending$/);
    // `site.spec.ts`'s own pattern for matching a sentence rather than an element —
    // whitespace squashed first, checked as plain substrings rather than through
    // `getByText`, which this exact paragraph resolves inconsistently for reasons that did
    // not reproduce under inspection even though the accessibility snapshot at the moment
    // of an earlier failure showed the text was there all along.
    const acknowledgement = ((await page.locator('body').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );
    expect(acknowledgement).toContain('confirmation link');
    expect(acknowledgement).toContain('current email address');
    expect(acknowledgement).toContain('your new one');
  });
});

/**
 * #55 and #62 — the journeys, and the one thing they have in common.
 *
 * **Each of these costs a whole account before it can begin**: a sign-up, a Turnstile, a poll
 * of Mailpit for the confirmation, a click through the confirm link, and a sign-in. The
 * existing tests in this file pay that too, and fit inside the config's 30-second budget — but
 * they stop where these start, and #55's link journey polls Mailpit a *second* time for the
 * magic link itself.
 *
 * **They passed on a laptop and timed out on a CI runner**, which is the whole reason the
 * budget is stated here rather than left to be discovered again: exactly these tests, on
 * exactly the two projects that run `@requires-js`, with `settleTurnstile` reported as the
 * failure because that is simply where the clock ran out. Nothing was flaky about them.
 *
 * **90 seconds, and the axe checks moved into the journeys that already own an account.** Both
 * halves matter: a longer budget alone would still have paid for three sign-ups where one
 * would do, and this file runs serially inside its own worker, so every one of them is wall
 * clock the whole suite waits on.
 *
 * **The two email fields on `/account/sign-in/` are labelled differently on purpose**, and it
 * is a testability decision as much as a copy one: Playwright's `getByLabel` matches by
 * substring, so a second field labelled "Your email address" would have been just as
 * ambiguous as one labelled "Email address". "Where to send the link" is unambiguous to a
 * locator and clearer to a person, which is the happy case.
 */

/** A registered, confirmed, signed-in account — the preamble every journey below pays for. */
async function registeredAndSignedIn(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await page.goto('/account/sign-up/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await settleTurnstile(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account\/sign-up\/\?done=ok$/);

  await page.goto(await confirmationLinkFor(request, email));

  await page.goto('/account/sign-in/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await settleTurnstile(page, 'form[action="/account/sign-in/"]');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account\/$/);
}

test.describe('signing in with a link @requires-js', () => {
  test('sends one, signs in with it, and refuses it the second time', async ({
    page,
    request,
  }, testInfo) => {
    // Two Mailpit polls and a full registration before the thing under test — see the note
    // above this describe for why the budget is stated rather than inherited.
    test.setTimeout(90_000);

    const email = addressFor(testInfo.project.name);

    // An account has to exist: a magic link never creates one.
    await registeredAndSignedIn(
      page,
      request,
      email,
      'a-perfectly-good-password',
      'Ada Lovelace',
    );
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\/$/);

    await page.getByLabel('Where to send the link').fill(email);
    await settleTurnstile(page, 'form[action="/account/link/"]');
    await page.getByRole('button', { name: 'Email me a link' }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\/\?sent=ok$/);
    await expect(page.getByText(/we have sent it a link/i)).toBeVisible();

    const link = await verifyLinkFor(request, email, 'magiclink');
    await page.goto(link);

    // Landed signed in, on the account page rather than back at the form.
    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

    // **Once, and it says so.** A second use must not fail blankly — somebody tapping a dead
    // link repeatedly with no explanation is the failure this guards.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: /did not work/i })).toBeVisible();
  });

  /** Cheap on purpose: no account, so no registration preamble and no raised budget. */
  test('acknowledges an address with no account identically', async ({
    page,
  }, testInfo) => {
    await page.goto('/account/sign-in/');
    await page
      .getByLabel('Where to send the link')
      .fill(`nobody-${testInfo.project.name}@example.com`);
    await settleTurnstile(page, 'form[action="/account/link/"]');
    await page.getByRole('button', { name: 'Email me a link' }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\/\?sent=ok$/);
    await expect(page.getByText(/we have sent it a link/i)).toBeVisible();
  });

  test('the sign-in page has zero axe violations with all three ways in on it', async ({
    page,
  }) => {
    await page.goto('/account/sign-in/');

    // Two email fields and two Turnstile widgets on one page: the thing most likely to go
    // wrong here is a duplicate id, which is why `textField` grew an override.
    // Settled first, for the reason `axeViolations` above is written out in full.
    // The default rule set is kept here rather than the five WCAG tags — routing
    // these through that helper would quietly change what they assert.
    await waitForStyledLayout(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByLabel('Where to send the link').fill('not-an-address');
    await settleTurnstile(page, 'form[action="/account/link/"]');
    await page.getByRole('button', { name: 'Email me a link' }).click();

    // Settled first, for the reason `axeViolations` above is written out in full.
    // The default rule set is kept here rather than the five WCAG tags — routing
    // these through that helper would quietly change what they assert.
    await waitForStyledLayout(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

/**
 * #62 — the data page.
 *
 * **One account, one journey, and the axe checks taken along the way.** The deletion is
 * destructive, so the account belongs to this test and nobody else; and having paid for one,
 * scanning the page while we are standing on it costs a second rather than another
 * registration.
 */
test.describe('downloading and deleting an account @requires-js', () => {
  test('downloads everything held, scans clean, then deletes the account', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);

    const email = addressFor(testInfo.project.name);
    const password = 'a-perfectly-good-password';

    await registeredAndSignedIn(page, request, email, password, "D'Arcy O'Malley");

    // **`/account/entries/` scanned on the way past**, for the reason this whole journey
    // exists: the account is already paid for, and standing on the page costs a second where
    // another registration costs thirty. It is the empty state — this person has entered
    // nothing — which is the state every account starts in and the one whose *wording* is the
    // risk. "You have no entries" would be a claim the page cannot make: they may have entered
    // with a different address.
    await page.goto('/account/entries/');
    await expect(page.getByText(/Nothing is showing here yet/i)).toBeVisible();
    await expect(page.getByText(/entered with this email address/i)).toBeVisible();

    // Settled first, for the reason `axeViolations` above is written out in full.
    // The default rule set is kept here rather than the five WCAG tags — routing
    // these through that helper would quietly change what they assert.
    await waitForStyledLayout(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.goto('/account/data/');

    // The promise, before the button.
    await expect(page.getByText(/race entry you have paid for/i)).toBeVisible();
    await expect(page.getByText(/still be on the start list/i)).toBeVisible();

    // **The medical retention period, read rather than typed — issue #172.** This page said
    // "a month after the race" as a constant, while `/nn/2026/` said "one month" about the same
    // interval, and neither could go red if `entries.events.medical_retention` moved. It comes
    // off `current_entry_state()` now, through the one module allowed to put an interval into
    // words. Asserted as the *whole clause* rather than as the two words, so a page that lost
    // the sentence and kept the period would fail.
    //
    // **Squashed first, which is the house pattern and not a workaround.** The clause is
    // written across three source lines and Prettier reflows the `html` template around the
    // interpolation, so the rendered text carries newlines in the middle of the sentence — the
    // same trap `CLAUDE.md` records for `worker/html.ts` and that `nn-terms.spec.ts` handles
    // the same way. Matching the words rather than where Prettier put them.
    const dataText = ((await page.locator('main').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );

    expect(dataText).toContain('deleted automatically one month after the race');

    // Settled first, for the reason `axeViolations` above is written out in full.
    // The default rule set is kept here rather than the five WCAG tags — routing
    // these through that helper would quietly change what they assert.
    await waitForStyledLayout(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // **Assert the attachment on the response, never on a download event.** The three browser
    // engines disagree about what an attachment is, and WebKit on a Linux runner renders one
    // in the tab where macOS WebKit downloads it — so this uses `page.request`, which shares
    // the context's cookies and hands back a readable body everywhere.
    const csrf = await page
      .locator('form[action="/account/data/export/"] input[name="csrf_token"]')
      .inputValue();
    const exported = await page.request.post('/account/data/export/', {
      form: { csrf_token: csrf },
    });

    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-type']).toContain('application/json');
    expect(exported.headers()['content-disposition']).toContain('attachment');

    const payload = JSON.parse(await exported.text()) as {
      ok: boolean;
      account: { email: string };
      profile: { name: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.account.email).toBe(email);
    expect(payload.profile.name).toBe("D'Arcy O'Malley");

    // Deleting needs the word typed — not reachable by one keystroke. The refusal is also the
    // page's error state, so it is scanned here rather than by a second account.
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByText(/Type DELETE in the box/i)).toBeVisible();

    // Settled first, for the reason `axeViolations` above is written out in full.
    // The default rule set is kept here rather than the five WCAG tags — routing
    // these through that helper would quietly change what they assert.
    await waitForStyledLayout(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByLabel(/Type .*DELETE.* to confirm/i).fill('DELETE');
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\/\?deleted=ok$/);
    await expect(page.getByText(/still on the start list/i)).toBeVisible();

    // Signed out everywhere: the account page is no longer reachable.
    await page.goto('/account/');
    await expect(page).toHaveURL(/\/account\/sign-in\/$/);

    // And the old password no longer signs anybody in.
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await settleTurnstile(page, 'form[action="/account/sign-in/"]');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/was not recognised|confirm your email/i)).toBeVisible();
  });
});
