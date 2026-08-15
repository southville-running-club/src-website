import { expect, test } from '@playwright/test';

/**
 * The page the interest form is on — the running it is an interest in.
 *
 * It was on `/nn/`, which was the wrong page: interest in what, the race in general or this
 * year's running? Pinned as a literal rather than read from `race.json`, as `site.spec.ts` does
 * with the race date.
 */
const YEAR = '/nn/2026/';
import AxeBuilder from '@axe-core/playwright';

/**
 * The sign-up form, in a real browser, exactly as somebody will meet it.
 *
 * **Nothing in this file is tagged `@requires-js` except the axe checks**, and that is the
 * point of the file. The `no-javascript` project runs everything else here with scripting
 * turned off, so "the form works with JavaScript disabled" is asserted rather than
 * asserted-about — it is the primary path, not a fallback, and runners are on phones on
 * poor signal.
 *
 * Only axe carries the tag, because it works by injecting a script and cannot report on a
 * page with scripting off.
 */

/** Invented, at the domain the IETF reserves, and one per browser project so that a run
 *  against a freshly seeded database exercises a genuine insert in each of them. */
function addressFor(project: string): string {
  return `e2e-${project}@example.com`;
}

/**
 * The interest form's half of `/nn/`.
 *
 * **Every locator has to say which form it means, now that the page carries two.** Both are
 * in the DOM on every request and the Worker reveals one; `hidden` does not take an element
 * out of `getByLabel`'s reach, so an unscoped `getByLabel('Email address')` matches this
 * form's box *and* the entry form's, and Playwright's strict mode rightly refuses to guess.
 * That is what this scoping is for, and it started failing the moment the entry form landed.
 */
const interest = (page: import('@playwright/test').Page) =>
  page.locator('[data-nn-interest]');

async function fillIn(
  page: import('@playwright/test').Page,
  fields: { name: string; email: string; consent?: boolean },
): Promise<void> {
  await interest(page).getByLabel('Your name').fill(fields.name);
  await interest(page).getByLabel('Email address').fill(fields.email);
  if (fields.consent !== false) {
    await interest(page)
      .getByLabel(/email me when entries open/i)
      .check();
  }
}

test.describe('registering interest', () => {
  test('goes through with JavaScript disabled', async ({ page }, testInfo) => {
    await page.goto(YEAR);

    await fillIn(page, {
      name: 'Grace Hopper',
      email: addressFor(testInfo.project.name),
    });
    await page.getByRole('button', { name: 'Register my interest' }).click();

    // POST/Redirect/GET: the address changes, so a refresh does not re-post.
    await expect(page).toHaveURL(/\/nn\/2026\/\?signup=ok$/);

    const acknowledgement = page.locator('[data-signup-ack]');
    await expect(acknowledgement).toBeVisible();
    await expect(acknowledgement).toContainText('your interest is registered');

    // **The acknowledgement holds focus.** With no JavaScript that is `autofocus` on an
    // element with `tabindex="-1"`, and it is what tells somebody using a screen reader
    // that anything happened at all.
    await expect(acknowledgement).toBeFocused();
  });

  test('answers a repeated address identically, disclosing nothing', async ({
    page,
  }, testInfo) => {
    // The second submission of the same address conflicts at the database. The person did
    // the right thing twice, and telling them the address is already on the list would
    // disclose membership of that list to anyone who can type an address into a form.
    const email = addressFor(testInfo.project.name);

    for (const attempt of [1, 2]) {
      await page.goto(YEAR);
      await fillIn(page, { name: `Grace Hopper ${attempt}`, email });
      await page.getByRole('button', { name: 'Register my interest' }).click();

      await expect(page).toHaveURL(/\/nn\/2026\/\?signup=ok$/);
      await expect(page.locator('[data-signup-ack]')).toBeVisible();
    }
  });
});

test.describe('a submission the server refuses', () => {
  test('keeps what was typed and puts focus on the reason', async ({ page }) => {
    // **Whitespace passes an HTML `required` attribute**, so this is a submission the
    // browser lets through and the server has to catch — which is the whole argument for
    // server-side validation never being optional.
    await page.goto(YEAR);
    await fillIn(page, { name: '   ', email: 'e2e-invalid@example.com' });
    await page.getByRole('button', { name: 'Register my interest' }).click();

    const summary = page.locator('[data-signup-summary]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('There is a problem');
    await expect(summary).toBeFocused();

    // The message is attached to the field it belongs to, not only listed at the top.
    await expect(page.locator('[data-signup-error="name"]')).toContainText(
      'Enter your name.',
    );
    await expect(interest(page).getByLabel('Your name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // **Nothing was lost.** On a phone on bad signal this is the difference between one
    // more tap and giving up.
    await expect(interest(page).getByLabel('Your name')).toHaveValue('   ');
    await expect(interest(page).getByLabel('Email address')).toHaveValue(
      'e2e-invalid@example.com',
    );
    await expect(interest(page).getByLabel(/email me when entries open/i)).toBeChecked();

    // Still on the form's own address, so correcting the name and pressing the button
    // again is all that is left to do.
    await expect(page).toHaveURL(/\/nn\/2026\/$/);
  });

  test('links from the summary to the field it is about', async ({ page }) => {
    await page.goto(YEAR);
    await fillIn(page, { name: '   ', email: 'e2e-invalid@example.com' });
    await page.getByRole('button', { name: 'Register my interest' }).click();

    await page.locator('[data-signup-summary-link="name"]').click();

    await expect(interest(page).getByLabel('Your name')).toBeFocused();
  });
});

test.describe('accessibility of the form', () => {
  test('the error state has zero axe violations @requires-js', async ({ page }) => {
    // The state a page is in when something has gone wrong is the state least likely to
    // have been checked, and the one somebody is most likely to be struggling with.
    // A well-formed address with a whitespace name: the browser's own `type="email"` and
    // `required` checks both pass, so the submission actually reaches the server, which is
    // the only thing that can reject it. An address the *browser* refuses never leaves the
    // page and there is no error state to check.
    await page.goto(YEAR);
    await fillIn(page, { name: '   ', email: 'e2e-axe@example.com' });
    await page.getByRole('button', { name: 'Register my interest' }).click();

    await expect(page.locator('[data-signup-summary]')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('the acknowledgement has zero axe violations @requires-js', async ({ page }) => {
    // The one state carrying markup no other page has: the event theme draws a tick as an
    // inline SVG inside the acknowledgement, which is a live region. It ships hidden and is
    // revealed by the Worker, so the axe run over `/nn/` in site.spec.ts never sees it.
    //
    // Reached by the query string alone rather than by submitting, because the Worker
    // reveals it on `?signup=ok` — which is also what a person meets after the 303.
    await page.goto(`${YEAR}?signup=ok`);

    await expect(page.locator('[data-signup-ack]')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('the error state is operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(YEAR);
    await fillIn(page, { name: '   ', email: 'e2e-invalid@example.com' });
    await page.getByRole('button', { name: 'Register my interest' }).click();

    await expect(page.locator('[data-signup-summary]')).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('every control can be reached and used from the keyboard', async ({ page }) => {
    // Keyboard-operable throughout, and worth asserting rather than assuming: the consent
    // box is the one people rebuild as a styled `div` and leave unreachable.
    await page.goto(YEAR);

    await interest(page).getByLabel('Your name').focus();
    await page.keyboard.type('Ada Lovelace');
    await page.keyboard.press('Tab');
    await expect(interest(page).getByLabel('Email address')).toBeFocused();
    await page.keyboard.type('e2e-keyboard@example.com');

    // Focused directly rather than tabbed to. **WebKit on macOS leaves checkboxes and
    // buttons out of the tab order** unless Safari's "Press Tab to highlight each item"
    // preference is switched on, and that is a browser setting rather than anything this
    // page controls. What the page is answerable for is that the control is a real
    // focusable input the keyboard can operate — which is exactly what a `div` dressed up
    // as a checkbox would fail.
    const consent = interest(page).getByLabel(/email me when entries open/i);
    await consent.focus();
    await expect(consent).toBeFocused();
    await page.keyboard.press('Space');
    await expect(consent).toBeChecked();

    // And it can be sent without ever reaching for a mouse: pressing Enter in a text field
    // submits a form that has a submit button, in every engine.
    await interest(page).getByLabel('Email address').focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/nn\/2026\/\?signup=ok$/);
  });
});

test.describe('the privacy notice', () => {
  // **The notice's own content is `nn-privacy.spec.ts`'s**, and it moved there when the page
  // grew from three fields to the whole entry. What stays here is the one assertion that
  // belongs to *this* form: that the link out of it goes where it says it goes. That test
  // needs the interest form on the page, which is this file's state to depend on.
  test('is linked from the form and says what is held', async ({ page }) => {
    await page.goto(YEAR);

    await interest(page)
      .getByRole('link', { name: /What the club does with this/i })
      .click();

    await expect(page).toHaveURL(/\/nn\/privacy\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'What the club does with your details',
    );

    // The link promises two things — what is held, and how to have it removed. Both have to
    // be true of the page it lands on, or the promise is the thing that is wrong.
    const body = (await page.locator('.nn-prose').textContent()) ?? '';
    expect(body).toMatch(/what we collect/i);
    expect(body).toMatch(/removed/i);
  });
});
