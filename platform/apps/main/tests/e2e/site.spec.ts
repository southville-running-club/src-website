import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The whole site, in a real browser, on one origin — exactly as the public will meet it.
 *
 * `/timing` is served by a different Worker. Locally `apps/main` forwards it; in
 * production Cloudflare's route does. Either way it is the same origin to the browser,
 * which is the property this arrangement exists to give.
 */

test.describe('the club website', () => {
  test('says a new site is coming, without promising when', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'A new Southville Running Club website',
    );

    // When the new site replaces the old one is a committee decision, and a date invented
    // here would be a factual claim nobody authorised.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/,
    );
  });

  test('links to both things that already exist', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('link', { name: /Nightingale Nightmare/ }),
    ).toHaveAttribute('href', '/nn/');
    await expect(page.getByRole('link', { name: /Race timing/ })).toHaveAttribute(
      'href',
      '/timing',
    );
  });
});

test.describe('Nightingale Nightmare, at /nn', () => {
  test('renders and shows a database timestamp fetched by the Worker', async ({
    page,
  }) => {
    await page.goto('/nn/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nightingale Nightmare',
    );

    const health = page.locator('[data-health]');
    await expect(health).toHaveAttribute('data-health', 'ok');
    await expect(health).toHaveText(/\d{1,2} \w+ \d{4} at \d{2}:\d{2} (GMT|BST)/);
  });

  test('states no facts about the race', async ({ page }) => {
    await page.goto('/nn/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).not.toMatch(/£\s?\d/);
    expect(body).not.toMatch(/\b\d+\s?(km|k|miles?)\b/i);
    expect(body).not.toMatch(/\b(October|November)\s+\d{1,2}\b/);
  });
});

test.describe('race timing, at /timing', () => {
  test('is reachable on the same origin as the website', async ({ page, baseURL }) => {
    // The assertion the whole path-based arrangement exists for: a second Worker,
    // answering on one hostname, with no cross-origin hop and no redirect away.
    await page.goto('/');
    const websiteOrigin = new URL(page.url()).origin;

    await page.getByRole('link', { name: /Race timing/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
    expect(new URL(page.url()).origin).toBe(websiteOrigin);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test('is styled, so basePath is doing its job', async ({ page }) => {
    // Without `basePath: '/timing'` the app serves but its assets 404, and it arrives
    // unstyled and half-broken — the failure that looks like a CSS bug and is not.
    await page.goto('/timing');

    const background = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('shows a database timestamp from the same project', async ({ page }) => {
    await page.goto('/timing');

    await expect(page.locator('[data-health]')).toHaveAttribute('data-health', 'ok');
  });
});

test.describe('accessibility', () => {
  for (const [name, path] of [
    ['the website', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['race timing', '/timing'],
  ] as const) {
    test(`${name} has zero axe violations @requires-js`, async ({ page }) => {
      // Zero, not "few". Any threshold above zero becomes the new normal within a month,
      // and 70% of visitors are on a phone.
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(violations).toEqual([]);
    });

    test(`${name} is operable at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});

test.describe('what does not exist', () => {
  test('404s a page that has not been built', async ({ page }) => {
    const response = await page.goto('/membership/');

    expect(response?.status()).toBe(404);
  });
});
