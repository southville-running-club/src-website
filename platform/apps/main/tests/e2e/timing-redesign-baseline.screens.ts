import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NN_ADMIN_EMAIL } from '../admin-fixtures';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import { expectStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * The timing redesign's baseline: four pages outside `/timing` that it must never change.
 *
 * `docs/timing/nn-timing-redesign-brief.md` §2.1.11. The redesign is presentation-only and lives in
 * `apps/timing`, but the two apps share a hostname and a workspace, so "nothing else changed" is
 * a claim worth a picture. These are taken before the first slice, and every later slice retakes
 * them and compares:
 *
 *     ./dev e2e --config=playwright.config.screenshots.ts timing-redesign-baseline
 *
 * The four are the brief's: the club home page, the race's entry page (which takes money until
 * 30 October), the sign-in page timing sends people to, and one admin page. Each at the brief's
 * two widths.
 *
 * ⚠️ **These are local pictures, not production's.** The entry page shows the local database's
 * places remaining and the admin list shows invented fixtures, so a retake is comparable only
 * against a retake on the same local data. A difference there is a question, not a verdict:
 * look at it.
 */

const OUT = path.join('..', 'docs', 'timing', 'baseline');

const WIDTHS = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const;

const PAGES = [
  ['home', '/', false],
  ['nn-2026', '/nn/2026/', false],
  ['account-sign-in', '/account/sign-in/', false],
  ['admin-nn', '/admin/nn/', true],
] as const;

function outDir(): string {
  const cwd = process.cwd();
  expect(
    path.basename(cwd),
    'this must be run from platform/, so that the output path resolves into docs/',
  ).toBe('platform');
  return path.join(cwd, OUT);
}

test.beforeAll(async () => {
  await mkdir(outDir(), { recursive: true });
  await seedAdminFixtures();
});

test.afterAll(async () => {
  await clearAdminFixtures();
  forgetSessions();
});

for (const [name, address, signedIn] of PAGES) {
  for (const [width, viewport] of WIDTHS) {
    test(`${name} at ${width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if (signedIn) await signInAs(page, NN_ADMIN_EMAIL);

      await page.goto(address);
      await expectStyledLayout(page, `${address} at ${width}`);

      await page.screenshot({
        path: path.join(outDir(), `${name}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}
