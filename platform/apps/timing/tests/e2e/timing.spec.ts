import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The timing front door, under `wrangler dev` — Next.js bundled by
 * `@opennextjs/cloudflare` and running in the real Workers runtime.
 *
 * This is the half of Phase 4 worth proving early. Once these pass, every later failure
 * in the port is application code rather than deployment, which is exactly the split that
 * makes a mid-October deadline survivable.
 *
 * Absolute URLs, because this app is on its own port rather than the config's `baseURL`.
 */

const TIMING = 'http://timing.localhost:8788';

test.describe('the timing skeleton', () => {
  test('renders under OpenNext in the Workers runtime', async ({ page }) => {
    await page.goto(TIMING);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
  });

  test('shows a database timestamp fetched server-side', async ({ page }) => {
    await page.goto(TIMING);

    const health = page.locator('[data-health]');
    await expect(health).toHaveAttribute('data-health', 'ok');
    await expect(health).toHaveText(/\d{1,2} \w+ \d{4} at \d{2}:\d{2} (GMT|BST)/);
  });

  test('is server-rendered on every request, not cached', async ({ page }) => {
    // `force-dynamic`, asserted rather than assumed. A cached answer to "can you reach
    // the database" is not an answer, and on race night a cached crossing is worse than
    // a slow one.
    // Compared on the `datetime` attribute rather than the visible text: the text is
    // rendered to the minute, so two genuinely different requests inside the same minute
    // would look identical and the test would pass for the wrong reason.
    await page.goto(TIMING);
    const first = await page.locator('[data-health]').getAttribute('datetime');

    await page.reload();
    const second = await page.locator('[data-health]').getAttribute('datetime');

    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto(TIMING);

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('is operable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(TIMING);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
