import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { expect, test } from '@playwright/test';

import { parseCommittee } from '@src/shared/club-content';

import { expectNoSidewaysScroll } from '../sideways-scroll';

/**
 * The committee section of `/about/`: who is on it, their faces, and the welfare panel.
 *
 * **What this owns and what it leaves to `club-pages.spec.ts`.** Axe — zero violations at
 * 1440 and 390 and in the dark scheme — and "no sideways scroll at 320, 390, 768 and 1440" are
 * already asserted for the whole of `/about/` there, so they are not repeated here. This file is
 * about what the section says and where each part of it sits.
 *
 * ⚠️ **Every expectation is derived from `committee.json` and `links.json`, never written as a
 * literal.** A role change at the AGM is an edit to that file, and a test that restated the
 * names would then fail on a correct page — or, worse, somebody would "fix" the test and not
 * the data. Read from disk rather than `import`ed, for the reason `club-pages.spec.ts` gives:
 * a bare JSON import fails in a Playwright spec.
 *
 * No test here is tagged `@requires-js`, so all of them run in the `no-javascript` project too.
 * The section has no script at all.
 */

const content = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../src/content/${name}`, import.meta.url)),
      'utf8',
    ),
  );

const { officers, volunteers, welfare } = parseCommittee(content('committee.json'));
const everybody = [...officers, ...volunteers, ...welfare];

test.describe('the committee on /about/', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about/');
  });

  test('names every person with their role', async ({ page }) => {
    const section = page.locator('section.club-committee');

    for (const person of everybody) {
      const card = section.locator('li').filter({
        has: page.getByRole('heading', { level: 4, name: person.name, exact: true }),
      });

      await expect(card, `${person.name} is not on the page once`).toHaveCount(1);
      await expect(card.locator('.club-role')).toHaveText(person.role);
    }
  });

  test('shows exactly one photograph per person, each sized before it loads', async ({
    page,
  }) => {
    const photos = page.locator('section.club-committee img');

    await expect(photos).toHaveCount(everybody.length);

    const sources = await photos.evaluateAll((images) =>
      images.map((image) => ({
        src: image.getAttribute('src'),
        alt: image.getAttribute('alt'),
        width: image.getAttribute('width'),
        height: image.getAttribute('height'),
      })),
    );

    expect(sources.map((s) => s.src).sort()).toEqual(
      everybody.map((p) => `/images/committee/${p.photo}`).sort(),
    );

    for (const photo of sources) {
      // The name is the heading beside the photograph; a descriptive alt would read it twice.
      expect(photo.alt, `${photo.src} has alt text`).toBe('');
      expect(Number(photo.width), `${photo.src} has no width`).toBeGreaterThan(0);
      expect(Number(photo.height), `${photo.src} has no height`).toBeGreaterThan(0);
    }
  });

  test('serves every photograph', async ({ page }) => {
    for (const person of everybody) {
      const response = await page.request.get(`/images/committee/${person.photo}`);

      expect(response.status(), `${person.photo} did not load`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/webp');
    }
  });

  test('puts the welfare panel after the volunteers, and the welfare officers only in it', async ({
    page,
  }) => {
    const volunteersHeading = page.getByRole('heading', {
      level: 3,
      name: 'Volunteers',
      exact: true,
    });
    const panel = page.locator('.club-welfare-panel');

    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(
      'Need to talk to someone?',
    );

    const after = await volunteersHeading.evaluate(
      (heading, panelElement) =>
        (heading.compareDocumentPosition(panelElement as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
      await panel.elementHandle(),
    );
    expect(after, 'the welfare panel comes before the volunteers').toBe(true);

    for (const person of welfare) {
      await expect(
        panel.getByRole('heading', { level: 4, name: person.name, exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('ul.club-people').getByText(person.name, { exact: true }),
        `${person.name} is in a grid as well as the panel`,
      ).toHaveCount(0);
    }

    await expect(panel.getByText('Talk to us in confidence')).toHaveCount(welfare.length);
  });

  test('gives the welfare email address, as a button and in words', async ({ page }) => {
    const button = page.getByRole('link', { name: 'Contact a welfare officer' });

    await expect(button).toHaveAttribute(
      'href',
      'mailto:welfare@southvillerunningclub.co.uk',
    );

    // WCAG 2.5.8 asks 24px; the club's own rule for a button is 48.
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    // Printed as well, for a machine with no mail client. `textContent` ignores the `<wbr>`s.
    const panel = page.locator('.club-welfare-panel');
    await expect(panel).toContainText(
      'Or email us at welfare@southvillerunningclub.co.uk.',
    );
    await expect(panel).not.toContainText('old site');
  });

  test("sends everything else to the club's general address", async ({ page }) => {
    const contact = page.locator('#contact');
    const link = contact.getByRole('link', { name: 'info@southvillerunningclub.co.uk' });

    await expect(link).toHaveAttribute('href', 'mailto:info@southvillerunningclub.co.uk');
    await expect(contact).not.toContainText('old site');
  });

  test('does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/about/');

    await expectNoSidewaysScroll(page, '/about/ committee at 320px');
  });
});
