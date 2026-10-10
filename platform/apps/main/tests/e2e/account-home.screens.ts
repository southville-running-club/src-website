import path from 'node:path';
import { test } from '@playwright/test';
import { TIMING_ADMIN_EMAIL, TIMING_MARSHAL_EMAIL } from '../admin-fixtures';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import { expectStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * The account home and one of its pages, photographed for review at two widths.
 *
 *     ./dev e2e --config=playwright.config.screenshots.ts account-home
 *
 * Written to `.dev/account-home/`, which is ignored and never committed.
 */
const OUT = path.join('..', '.dev', 'account-home');

const WIDTHS = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const;

const SHOTS = [
  ['timing-admin-home', '/account/', TIMING_ADMIN_EMAIL],
  ['marshal-home', '/account/', TIMING_MARSHAL_EMAIL],
  ['marshal-password', '/account/password/', TIMING_MARSHAL_EMAIL],
] as const;

test.beforeAll(async () => {
  await seedTimingStaff();
  forgetSessions();
});

test.afterAll(async () => {
  await clearTimingStaff();
  forgetSessions();
});

for (const [name, address, email] of SHOTS) {
  for (const [width, viewport] of WIDTHS) {
    test(`${name} at ${width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signInAs(page, email);
      await page.goto(address);
      await expectStyledLayout(page, `${address} at ${width}`);
      await page.screenshot({
        path: path.join(OUT, `${name}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
