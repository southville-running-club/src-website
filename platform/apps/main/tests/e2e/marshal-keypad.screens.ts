import path from 'node:path';
import { expect, test } from '@playwright/test';
import { TIMING_MARSHAL_EMAIL } from '../admin-fixtures';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import { captureEventSlug, clearCaptureEvent, seedCaptureEvent } from '../timing-db';
import { expectStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * The marshal's bib keypad, photographed for review: a tap with no bib, then a bib typed, on a
 * phone and on a laptop.
 *
 *     ./dev e2e --config=playwright.config.screenshots.ts marshal-keypad
 *
 * Written to `.dev/marshal-keypad/`, which is ignored and never committed.
 */
const OUT = path.join('..', '.dev', 'marshal-keypad');
const PROJECT = 'screens';

const WIDTHS = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 900 }],
] as const;

test.beforeAll(async () => {
  await seedTimingStaff();
  await seedCaptureEvent(PROJECT, TIMING_MARSHAL_EMAIL);
  forgetSessions();
});

test.afterAll(async () => {
  await clearCaptureEvent(PROJECT);
  await clearTimingStaff();
  forgetSessions();
});

/** Real phones, photographed as the screen is — no full-page stitching. */
const PHONES = [
  ['iphone-15', { width: 393, height: 659 }],
  ['iphone-se', { width: 375, height: 553 }],
  ['android', { width: 412, height: 780 }],
] as const;

for (const [phone, viewport] of PHONES) {
  test(`the whole screen on ${phone}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(`/timing/marshal/${captureEventSlug(PROJECT)}`);
    await expectStyledLayout(page, `capture on ${phone}`);
    await page.screenshot({ path: path.join(OUT, `screen-${phone}-0-ready.png`) });

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await expect(page.getByText('No bib yet')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `screen-${phone}-1-tapped.png`) });

    for (const digit of '2145') {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.screenshot({ path: path.join(OUT, `screen-${phone}-2-typed.png`) });

    // Two more runners before the first bib is confirmed: one keypad, and a count.
    await page.getByRole('button', { name: 'Crossed now' }).click();
    await page.getByRole('button', { name: 'Crossed now' }).click();
    await page.screenshot({
      path: path.join(OUT, `screen-${phone}-3-three-waiting.png`),
    });

    await page.getByRole('button', { name: /^Confirm bib/ }).click();
    await page.screenshot({ path: path.join(OUT, `screen-${phone}-4-next-opens.png`) });
  });
}

for (const [width, viewport] of WIDTHS) {
  test(`the keypad at ${width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    await page.goto(`/timing/marshal/${captureEventSlug(PROJECT)}`);
    await expectStyledLayout(page, `capture at ${width}`);

    await page.getByRole('button', { name: 'Crossed now' }).click();
    await expect(page.getByText('No bib yet')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `empty-${width}.png`), fullPage: true });

    for (const digit of '2145') {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(page.getByText('Bib 2145', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `typed-${width}.png`), fullPage: true });
    // The queue scrolls inside its own box, so a full-page picture cuts the card off on a
    // phone. The card on its own is the thing being reviewed.
    await page.setViewportSize({ width: viewport.width, height: 1600 });
    await page
      .locator('.timing-qcard-entry')
      .screenshot({ path: path.join(OUT, `card-${width}.png`) });
  });
}
