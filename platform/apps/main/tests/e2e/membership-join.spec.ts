import { expect, test } from '@playwright/test';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * `/membership/join/` — the club's own new-member application, in a browser.
 *
 * ## ⚠️ This page is reachable and linked from nowhere, and that is the state under test
 *
 * **Nothing stores an application yet.** `membership.membership_applications` does not exist:
 * a table holding eighteen fields of personal data, a date of birth and a home address among
 * them, is a committee decision, and `/privacy/` says nothing about this collection or about
 * the England Athletics sharing. Until both land, the page is reached only by typing it.
 *
 * So one of the tests below asserts an **absence** — that no club page links here — and it is
 * the most valuable one in the file. "We'll link it when the table lands" is exactly the kind
 * of intention that survives one merge and not two, and a form somebody can find and fill in
 * that throws their answers away is worse than no form at all.
 *
 * ## What the rest of it is for
 *
 * A form is where an accessibility failure actually costs somebody something: a label that
 * does not associate, a radio group with no name, an error nobody is sent to. Every
 * assertion here is about the form being operable rather than about what it says — the words
 * are `tests/worker/membership.test.ts`'s job, at the layer that reads the markup.
 *
 * ⚠️ **Nothing here is scripted**, so every one of these runs identically in the
 * `no-javascript` project — **except the axe check**, which needs a script to run the check
 * rather than to work at all, and carries `@requires-js` for that reason alone. That is the
 * whole design of the form and is worth keeping true.
 */

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

test.describe('the application form', () => {
  test('renders with one h1 and the club’s own chrome', async ({ page }) => {
    await page.goto('/membership/join/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Join Southville Running Club' }),
    ).toBeVisible();

    // The fence between the two surfaces, in a browser. `club-chrome.spec.ts` owns the rest.
    await expect(page.locator('.club-header')).toBeVisible();
    await expect(page.locator('.site-banner')).toHaveCount(0);
  });

  /**
   * ⚠️ **`@requires-js` is about the checker, not about the page.**
   *
   * Everything else in this file runs in the `no-javascript` project, because the form is
   * plain HTML and behaves identically there — which is the whole design. **axe does not.**
   * It works by injecting a script and running it in the page, so with scripting off it
   * cannot report at all: the failure is `frame.evaluate: Resulting promise was garbage
   * collected`, which reads as a flaky test rather than as a checker that never ran, and
   * chromium stays green beside it.
   *
   * `playwright.config.ts` skips this tag in that project and says so in its own comment.
   * Conflating "needs a script to run the check" with "needs a script to work at all" is how
   * the exception gets forgotten, which is why it is spelled out here too.
   */
  test('has no accessibility violations @requires-js', async ({ page }) => {
    await page.goto('/membership/join/');

    expect(await axeViolations(page)).toEqual([]);
  });

  /**
   * ⚠️ **Every control is reached by its accessible name, never by a selector.**
   *
   * `getByLabel` fails when a `<label>`'s `for` does not match an `id`, when two controls
   * share an id, or when a legend is the only thing naming a radio group — each of which is a
   * real defect that `locator('#firstName')` would sail straight past. This is the cheapest
   * label audit there is and it is the one that catches a rename.
   */
  test('labels every box it asks about', async ({ page }) => {
    await page.goto('/membership/join/');

    for (const label of [
      'Title',
      'First name',
      'Last name',
      'Email address',
      'Phone number',
      'Date of birth',
      'Address line 1',
      'Town or city',
      'Postcode',
      'Country',
    ]) {
      await expect(page.getByLabel(label, { exact: false }).first(), label).toBeVisible();
    }
  });

  test('groups the radios so a screen reader hears the question', async ({ page }) => {
    await page.goto('/membership/join/');

    // A `<fieldset>` with a `<legend>` is a `group` with that legend as its name. Without
    // it, "Yes" and "No" are two radios that answer nothing in particular.
    await expect(
      page.getByRole('group', { name: /registered with England Athletics before/u }),
    ).toBeVisible();
    await expect(
      page.getByRole('group', { name: /set up your portal account/u }),
    ).toBeVisible();
  });

  /**
   * ⚠️ **The trap this repository has already paid for, asserted where it would bite.**
   *
   * A `required` control that is hidden and empty makes the browser refuse to submit the form
   * — silently, no request, no error on the page, the button simply does nothing. The
   * membership radios ship `hidden disabled` and the Worker removes both together once it has
   * read a price. If it ever removed only `hidden`, this form would be unsubmittable and
   * nothing else in the suite would notice.
   */
  test('offers a membership that can actually be chosen', async ({ page }) => {
    await page.goto('/membership/join/');

    const options = page.getByRole('radio', { name: /SRC membership/u });

    await expect(options).toHaveCount(2);
    await expect(options.first()).toBeEnabled();

    await options.first().check();
    await expect(options.first()).toBeChecked();
  });

  test('quotes what each membership costs, beside the thing being chosen', async ({
    page,
  }) => {
    await page.goto('/membership/join/');

    const group = page.getByRole('group', { name: 'Which membership' });

    await expect(group).toContainText('£4');
    await expect(group).toContainText('£27');
    await expect(group).not.toContainText('Price to be confirmed');
  });

  /**
   * The age bound is `membership.settings.minimum_age`, painted rather than written down, so
   * raising it is an `update` and no deploy. 18 is what the migration seeds, and it is the
   * same 18 the race enforces.
   */
  test('says how old somebody has to be, from the database', async ({ page }) => {
    await page.goto('/membership/join/');

    await expect(page.locator('main')).toContainText('You need to be 18 or over');
  });

  test('refuses an empty submission in the browser, before the server is asked', async ({
    page,
  }) => {
    await page.goto('/membership/join/');

    // ⚠️ **HTML5 constraint validation is the browser's, not JavaScript's**, so this holds in
    // the `no-javascript` project too — which is the half that matters, because the server
    // check is not written yet and this is the only guard a visitor meets today.
    const firstName = page.getByLabel('First name');

    await expect(firstName).toHaveAttribute('required', '');
    expect(
      await firstName.evaluate((input: HTMLInputElement) => input.checkValidity()),
    ).toBe(false);
  });
});

test.describe('the form at the widths people fill it in at', () => {
  for (const [label, size] of [
    ['a phone', PHONE],
    ['a desktop', DESKTOP],
  ] as const) {
    test(`does not scroll sideways on ${label}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/membership/join/');

      // ⚠️ **A `<fieldset>` refuses to shrink below its widest child by UA default**, which
      // is how a long legend or a wide select stops a column narrowing and slides the whole
      // page left under a thumb. `min-width: 0` in `club.css` is what stops it, and nothing
      // looks wrong at desktop width.
      await expectNoSidewaysScroll(page, `/membership/join/ at ${label}`);
    });
  }

  test('keeps every control big enough to hit', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/membership/join/');

    // WCAG 2.2's target floor is 24px; this design's controls are built to 44 and up. axe
    // checks the rule, and this checks the one that carries the most taps.
    const button = page.getByRole('button', { name: 'Send my application' });
    const box = await button.boundingBox();

    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe('nothing leads anybody here yet', () => {
  /**
   * ⚠️ **The most valuable test in this file.**
   *
   * The form stores nothing, so a visitor who finds it, fills in eighteen fields and presses
   * the button gets nowhere — and there is no wording anywhere that would tell them so. The
   * page exists to be built against and reviewed, not to be used, and that stays true only
   * while nothing links to it.
   *
   * **Delete this test when the table lands, in the same change.** Not before.
   */
  test('no club page links to the application form', async ({ page }) => {
    for (const path of ['/', '/membership/', '/run-with-us/', '/about/', '/news/']) {
      await page.goto(path);

      await expect(
        page.locator('a[href="/membership/join/"]'),
        `${path} links to the application form`,
      ).toHaveCount(0);
    }
  });

  test('the navigation does not offer it', async ({ page }) => {
    await page.goto('/membership/');

    // ⚠️ A CSS locator rather than `getByRole('navigation')`, which matches both the bar and
    // the Menu's own nav and would fail strict mode on the page rather than on the assertion.
    await expect(page.locator('nav a[href*="/membership/join/"]')).toHaveCount(0);
  });
});
