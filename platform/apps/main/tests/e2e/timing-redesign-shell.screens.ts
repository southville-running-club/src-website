import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { TIMING_ADMIN_EMAIL, TIMING_MARSHAL_EMAIL } from '../admin-fixtures';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import { seedTimingFixtures } from '../timing-db';
import { RESULTS_EVENT_SLUG } from '../timing-fixtures';
import { expectStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * The timing redesign's app shell (ADR-054), photographed for review: each frame, as the people
 * who see it, at the brief's two widths.
 *
 *     ./dev e2e --config=playwright.config.screenshots.ts timing-redesign-shell
 *
 * **Written to `.dev/timing-redesign-shell/`, which is ignored, never committed.** These are
 * for the pull request a slice is reviewed in. The four committed pictures that must never change are
 * `timing-redesign-baseline.screens.ts`'s.
 */

// `.dev/` at the repository root, which is ignored. Not `test-results/`: Playwright empties
// that at the start of every run, so the next spec would delete these before anybody looked.
const OUT = path.join('..', '.dev', 'timing-redesign-shell');
const RACE = `/timing/events/${RESULTS_EVENT_SLUG}`;

const WIDTHS = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const;

const SHOTS: readonly (readonly [string, string, string | null])[] = [
  ['admin-timing-home', '/timing', TIMING_ADMIN_EMAIL],
  ['admin-race-overview', RACE, TIMING_ADMIN_EMAIL],
  ['admin-race-marshals', `${RACE}/marshals`, TIMING_ADMIN_EMAIL],
  ['marshal-timing-home', '/timing', TIMING_MARSHAL_EMAIL],
  ['signed-out-not-found', '/timing', null],
];

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

test.beforeAll(async () => {
  await seedTimingStaff();
  await seedTimingFixtures();
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
      if (email !== null) await signInAs(page, email);
      await page.goto(address);
      await expectStyledLayout(page, `${address} at ${width}`);
      await shoot(page, `${name}-${width}`);
    });
  }
}
