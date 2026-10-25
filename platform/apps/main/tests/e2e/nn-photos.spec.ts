import { expect, test } from '@playwright/test';

import { axeViolations } from '../axe';
import { expectNoSidewaysScroll } from '../sideways-scroll';
import { seedRunnerPhotoFixtures } from '../photos-runner-db';
import {
  RUNNER_BIB,
  RUNNER_FINISH_TIME,
  RUNNER_PHOTOS,
  REPLACED_TOKEN,
  runnerPagePath,
} from '../photos-runner-fixtures';

/**
 * A runner's race photos, in three browsers (brief slice 4, ADR-067).
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
