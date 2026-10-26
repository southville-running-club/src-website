import { expect, test } from '@playwright/test';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';
import { seedRunnerPhotoFixtures } from '../photos-runner-db';
import {
  RUNNER_ADDRESS,
  RUNNER_BIB,
  RUNNER_FINISH_TIME,
  RUNNER_PHOTOS,
  REPLACED_TOKEN,
  UNPUBLISHED_YEAR,
  lostLinkPath,
  runnerPagePath,
} from '../photos-runner-fixtures';

/**
 * A runner's race photos, in three browsers (brief slice 4, ADR-068).
 *
 * The brief's browser list for this slice: **no-JavaScript journeys** for the private page and
 * one photo, **zero axe violations**, and **operable at 320px**. What a link may read and what
 * the image route answers are the database's and the Worker's to prove; this is the page in a
 * browser.
 *
 * ⚠️ **The fixtures are read-only and seeded once under an advisory lock**
 * (`photos-runner-db.ts`), because this file's three projects can run two at a time against
 * one database (CLAUDE.md). No test here writes a row, and none clears one.
 *
 * The images are not in the local bucket, so every `<img>` is a 404 here. Each carries its alt
 * text, which is what axe can see; the image route itself is `nn-photos.test.ts`'s.
 */

test.beforeAll(async () => {
  await seedRunnerPhotoFixtures();
});

test.describe("a runner's private page", () => {
  test('shows their bib, their time and their photos, with no script needed', async ({
    page,
  }) => {
    const response = await page.goto(runnerPagePath());

    expect(response?.status()).toBe(200);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Your photos' }),
    ).toBeVisible();
    await expect(page.getByText(RUNNER_BIB, { exact: true })).toBeVisible();
    await expect(page.getByText(RUNNER_FINISH_TIME, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: `Photo ${RUNNER_PHOTOS.mine.shortId}, at The finish`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Could be you' }),
    ).toBeVisible();
  });

  test('opens one photo and comes back, by links alone', async ({ page }) => {
    await page.goto(runnerPagePath());

    await page
      .getByRole('link', { name: `Photo ${RUNNER_PHOTOS.mine.shortId}, at The finish` })
      .click();

    await expect(page).toHaveURL(new RegExp(`${RUNNER_PHOTOS.mine.shortId}/$`));
    await expect(
      page.getByText(RUNNER_PHOTOS.mine.shortId, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download this photo' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to your photos' }).click();
    await expect(page).toHaveURL(new RegExp(`${runnerPagePath()}$`));
  });

  test('answers a replaced link with a page that says so', async ({ page }) => {
    const response = await page.goto(runnerPagePath(REPLACED_TOKEN));

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link is not working' }),
    ).toBeVisible();
  });

  test('does not scroll sideways, from a phone up', async ({ page }) => {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });

      await page.goto(runnerPagePath());
      await expectNoSidewaysScroll(page, `the private page at ${width}px`);

      await page.goto(`${runnerPagePath()}${RUNNER_PHOTOS.mine.shortId}/`);
      await expectNoSidewaysScroll(page, `one photo at ${width}px`);
    }
  });

  test('has no accessibility violations on any of its pages @requires-js', async ({
    page,
  }) => {
    for (const path of [
      runnerPagePath(),
      `${runnerPagePath()}${RUNNER_PHOTOS.mine.shortId}/`,
      `${runnerPagePath()}${RUNNER_PHOTOS.couldBe.shortId}/`,
      runnerPagePath(REPLACED_TOKEN),
    ]) {
      await page.goto(path);
      expect(await axeViolations(page), path).toEqual([]);
    }
  });
});

test.describe('the lost-link form (slice 5)', () => {
  test('asks for a new link and says one is on its way, with no script needed', async ({
    page,
  }) => {
    await page.goto(lostLinkPath());
    await page.getByLabel('The email you entered with').fill(RUNNER_ADDRESS);
    await page.getByRole('button', { name: 'Send me a new link' }).click();

    await expect(page).toHaveURL(`${lostLinkPath()}?sent=1`);
    await expect(page.getByRole('status')).toContainText('a new link is on its way');
    // The address is never put in the address bar.
    expect(page.url()).not.toContain('@');
  });

  test('is reached from a link that has stopped working', async ({ page }) => {
    await page.goto(runnerPagePath(REPLACED_TOKEN));
    await page.getByRole('link', { name: 'Get a new link' }).click();

    await expect(
      page.getByRole('heading', { level: 2, name: 'Get a new link to your photos' }),
    ).toBeVisible();
  });

  test('says the photos are not up yet before the links have gone, and asks for nothing', async ({
    page,
  }) => {
    await page.goto(lostLinkPath(UNPUBLISHED_YEAR));

    await expect(page.getByText("The photos aren't up yet.")).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('does not scroll sideways, from a phone up', async ({ page }) => {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });

      await page.goto(lostLinkPath());
      await expectNoSidewaysScroll(page, `the lost-link form at ${width}px`);

      await page.goto(`${lostLinkPath()}?sent=1`);
      await expectNoSidewaysScroll(page, `the lost-link confirmation at ${width}px`);
    }
  });

  test('has no accessibility violations, including when an address is not one @requires-js', async ({
    page,
  }) => {
    for (const path of [
      lostLinkPath(),
      `${lostLinkPath()}?sent=1`,
      lostLinkPath(UNPUBLISHED_YEAR),
    ]) {
      await page.goto(path);
      expect(await axeViolations(page), path).toEqual([]);
    }

    // The server's own refusal, which the browser's validation would otherwise get to first.
    await page.goto(lostLinkPath());
    await page.locator('form').evaluate((form) => form.setAttribute('novalidate', ''));
    await page.getByLabel('The email you entered with').fill('not an address');
    await page.getByRole('button', { name: 'Send me a new link' }).click();

    await expect(
      page.getByText('Enter an email address, like name@example.com.'),
    ).toBeVisible();
    await expect(page.getByLabel('The email you entered with')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(await axeViolations(page), 'the refused address').toEqual([]);
  });
});
