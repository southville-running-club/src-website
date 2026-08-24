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

async function confirmationLinkFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  // Mailpit indexes messages within a moment of SMTP delivery; a short poll is cheaper and
  // less flaky than a fixed sleep, and the timeout is what actually fails a run that never
  // gets its email at all rather than one that was merely a little slow.
  const deadline = Date.now() + 15_000;
  let messageId: string | undefined;

  while (Date.now() < deadline && messageId === undefined) {
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    messageId = messages[0]?.ID;
    if (messageId === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (messageId === undefined) {
    throw new Error(`No confirmation mail arrived for ${email} within 15s`);
  }

  const message = await request.get(`${MAILPIT}/api/v1/message/${messageId}`);
  const { Text, HTML } = (await message.json()) as { Text: string; HTML: string };

  // GoTrue's confirmation link, wherever it appears in either body. `verify?` is specific
  // enough not to match a footer link or an unsubscribe address.
  const match = /https?:\/\/\S*\/auth\/v1\/verify\?\S+/.exec(`${Text}\n${HTML}`);
  if (match === null) {
    throw new Error('Confirmation mail arrived but carried no verify link');
  }

  // Mailpit's HTML body carries `&amp;` where the plain-text one carries `&`. Both parse to
  // the same URL once normalised.
  return match[0].replaceAll('&amp;', '&');
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
});
