import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * End-to-end, in a real browser, against `wrangler dev` — the real Workers runtime
 * serving the real build.
 *
 * Note what the base URL is actually serving. `wrangler dev` presents every request as
 * the configured custom domain, so `/` here is `nn.southvillerunningclub.co.uk/`, which
 * the Worker maps to `/nn/`. The build's own index page is unreachable in this
 * configuration; hostname routing is covered by `tests/worker/serves.test.ts` instead.
 */

test.describe('the Nightingale Nightmare page', () => {
  test('renders, and says what it is', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nightingale Nightmare',
    );
    await expect(page).toHaveTitle(/Nightingale Nightmare/);
  });

  test('shows a database timestamp fetched by the Worker', async ({ page }) => {
    await page.goto('/');

    const health = page.locator('[data-health]');
    // The placeholder text means the Worker did not run at all.
    await expect(health).not.toHaveText('Not fetched — the Worker did not run.');
    await expect(health).toHaveAttribute('data-health', 'ok');
    // Rendered Europe/London, as a person would read it.
    await expect(health).toHaveText(/\d{1,2} \w+ \d{4} at \d{2}:\d{2} (GMT|BST)/);
  });

  test('states no facts about the race', async ({ page }) => {
    // The date, price and distance are unconfirmed, and inventing one is a "stop and ask"
    // trigger rather than a placeholder. This asserts the skeleton has not quietly
    // acquired one.
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).not.toMatch(/£\s?\d/);
    expect(body).not.toMatch(/\b\d+\s?(km|k|miles?)\b/i);
    expect(body).not.toMatch(/\b(October|November)\s+\d{1,2}\b/);
  });
});

test.describe('accessibility', () => {
  test('has zero axe violations @requires-js', async ({ page }) => {
    // Zero, not "few". Any threshold above zero becomes the new normal within a month,
    // and 70% of visitors are on a phone.
    await page.goto('/');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('is operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');

    // Nothing may push the page sideways. A horizontal scrollbar at 320px is the usual
    // symptom of a fixed width or an unwrapped long string.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('offers a skip link as the first thing a keyboard reaches', async ({
    page,
    browserName,
  }) => {
    // Not a page defect: WebKit's Tab key moves between form controls only unless the
    // user turns on "Press Tab to highlight each item", so the assertion cannot hold
    // there. The link is present and reachable in the accessibility tree on every engine,
    // which is what the axe check covers.
    test.skip(
      browserName === 'webkit',
      'WebKit does not tab to links unless full keyboard access is enabled',
    );

    await page.goto('/');
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});

test.describe('the race hostname serves nothing but the race', () => {
  test('404s a club-website path', async ({ page }) => {
    // The leak test, through a browser. From Phase 5 the unfinished club website is in
    // this same build.
    const response = await page.goto('/membership/');

    expect(response?.status()).toBe(404);
  });
});
