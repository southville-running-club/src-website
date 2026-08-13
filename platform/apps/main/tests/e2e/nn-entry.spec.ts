import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { closeEntries, openEntries } from '../entries-window';

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

// -----------------------------------------------------------------------------------------
// Entries not open — the state production is in today
// -----------------------------------------------------------------------------------------

test.describe('before entries open', () => {
  test.beforeAll(async () => {
    await closeEntries();
  });

  test('shows the interest form and not the entry form', async ({ page }) => {
    // `entries.events.entries_open_at` is null for NN 2026 because the opening time has not
    // been decided. To somebody looking at the page that means the same thing as "not yet",
    // and the interest form is what they get — which is what they got before this slice.
    await page.goto('/nn/');

    await expect(
      page.getByRole('heading', { name: 'Register your interest' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enter the race' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Register my interest' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeHidden();
  });

  test('offers the interest form from the hero, not an entry', async ({ page }) => {
    await page.goto('/nn/');

    const cta = page.locator('[data-nn-cta]');
    await expect(cta).toHaveText('Register your interest');
    await expect(cta).toHaveAttribute('href', '#register');
  });

  test('quotes no price, because prices belong to an open entry', async ({ page }) => {
    // The three fee cards are in the DOM and stay hidden, with their prices unpainted. A
    // price on a page that cannot take an entry is a claim about a race nobody can enter.
    await page.goto('/nn/');

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(/£\s?\d/);
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto('/nn/');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// Entries open
// -----------------------------------------------------------------------------------------

test.describe('once entries are open', () => {
  test.beforeAll(async () => {
    await openEntries();
  });

  // Put back to the seeded state whatever happened above, so a failed run does not leave a
  // laptop showing an entry form that should not be there.
  test.afterAll(async () => {
    await closeEntries();
  });

  test('shows the entry form and not the interest form', async ({ page }) => {
    await page.goto('/nn/');

    await expect(page.getByRole('heading', { name: 'Enter the race' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Register your interest' }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();
  });

  test('takes its prices from the database, not from the markup', async ({ page }) => {
    // £15, £17 and a free guide's place. The numbers live in `entries.fees.price_pence` and
    // reach the page through the Worker; nothing in `dist/` knows them.
    await page.goto('/nn/');

    await expect(page.locator('[data-entry-fee-price="affiliated"]')).toHaveText(
      '£15.00',
    );
    await expect(page.locator('[data-entry-fee-price="unaffiliated"]')).toHaveText(
      '£17.00',
    );
    await expect(page.locator('[data-entry-fee-price="vi_guide"]')).toHaveText('Free');
  });

  test('points the hero button at the entry form', async ({ page }) => {
    await page.goto('/nn/');

    const cta = page.locator('[data-nn-cta]');
    await expect(cta).toHaveText('Enter the race');
    await expect(cta).toHaveAttribute('href', '#enter');
  });

  test('is completable with JavaScript disabled, and says plainly that it is not finished', async ({
    page,
  }) => {
    // **The whole argument of this site, on its longest form.** Fourteen fields, no
    // scripting, a real POST — and an honest answer at the end of it. Slice A has no
    // payment, so a valid entry is *not* acknowledged as an entry; it is told, in words,
    // that nothing was stored and nothing was charged.
    await page.goto('/nn/');

    await fillEntry(page);
    await entry(page)
      .getByLabel(/^Unaffiliated/)
      .check();

    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const notice = page.locator('[data-entry-unavailable]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('payment is not connected yet');
    await expect(notice).toContainText(
      'nothing has been stored and nothing has been charged',
    );

    // It holds focus, which with no JavaScript is `autofocus` on an element carrying
    // `tabindex="-1"` — and is what tells somebody using a screen reader anything happened.
    await expect(notice).toBeFocused();
  });

  test('keeps every value when the server refuses it', async ({ page }) => {
    // **The failure that actually matters on a form this long.** Losing fourteen fields on a
    // phone on bad signal is the difference between one more tap and giving up.
    await page.goto('/nn/');

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
    await expect(page).toHaveURL(/\/nn\/$/);
  });

  test('attaches each message to the field it is about', async ({ page }) => {
    await page.goto('/nn/');

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
    await page.goto('/nn/');

    await fillEntry(page, { firstName: '   ' });
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await page.locator('[data-entry-summary-link="firstName"]').click();

    await expect(entry(page).getByLabel('First name', { exact: true })).toBeFocused();
  });

  test('marks the date of birth as one question, not three', async ({ page }) => {
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('is still operable at 320px with every error showing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/nn/');

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

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto('/nn/');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('the error state has zero axe violations @requires-js', async ({ page }) => {
    // The state a page is in when something has gone wrong is the state least likely to have
    // been checked, and the one somebody is most likely to be struggling with.
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

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
    await page.goto('/nn/');

    const total = page.locator('[data-entry-total]');
    await expect(total).toBeHidden();

    await entry(page)
      .getByLabel(/^Affiliated/)
      .check();
    await expect(total).toHaveText('Total to pay: £15.00');

    await entry(page)
      .getByLabel(/^VI guide/)
      .check();
    await expect(total).toHaveText('Total to pay: Free');
  });

  test('validates inline without ever blocking a submission', async ({ page }) => {
    await page.goto('/nn/');

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
    await page.goto('/nn/');

    await entry(page).getByLabel('First name', { exact: true }).fill('Grace');
    await entry(page).getByLabel('Last name', { exact: true }).focus();

    await expect(page.locator('[data-entry-error="emergencyName"]')).toBeHidden();
    await expect(page.locator('[data-entry-error="entryTerms"]')).toBeHidden();
  });
});
