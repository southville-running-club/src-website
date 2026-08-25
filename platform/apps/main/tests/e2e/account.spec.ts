import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  type: 'signup' | 'recovery',
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

async function confirmationLinkFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  return verifyLinkFor(request, email, 'signup');
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
    const empty = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(empty.violations).toEqual([]);

    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(errored.violations).toEqual([]);
  });

  test('the sign-in form has zero axe violations, empty and in its error state', async ({
    page,
  }) => {
    await page.goto('/account/sign-in/');
    const empty = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(empty.violations).toEqual([]);

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(errored.violations).toEqual([]);
  });

  test('the reset-request form has zero axe violations, empty and in its error state', async ({
    page,
  }) => {
    await page.goto('/account/reset/');
    const empty = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(empty.violations).toEqual([]);

    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.locator('.notice-bad, .field-error').first()).toBeVisible();

    const errored = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(errored.violations).toEqual([]);
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
    const resetConfirmAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(resetConfirmAxe.violations).toEqual([]);

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
    const changePasswordEmptyAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(changePasswordEmptyAxe.violations).toEqual([]);

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

    const changePasswordErrorAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(changePasswordErrorAxe.violations).toEqual([]);

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
