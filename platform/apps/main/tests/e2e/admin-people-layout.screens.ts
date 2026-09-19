import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from '@playwright/test';

import { waitForStyledLayout } from '../sideways-scroll';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import { forgetSessions, signInAs } from './sign-in';
import { REGISTERED_EMAIL, SUPER_ADMIN_EMAIL } from '../admin-fixtures';

/**
 * `/admin/people/` at five widths, as pictures.
 *
 * ⚠️ **A `.screens.ts` rather than a `.spec.ts`, and that is the rule rather than a naming
 * whim.** `playwright.config.screenshots.ts` puts it plainly: *a screenshot run may never be
 * part of a gate*. The base config's `testMatch` ends in `.spec.ts`, so this file cannot be
 * collected into the ordinary suite however anybody later edits the configs — which is the half
 * of the separation that survives people.
 *
 * The assertions that hold this layout are in `admin.spec.ts`'s **people and roles** describe —
 * the file that owns these fixtures — and they are in the gate. **This file asserts nothing.**
 * It is what a reviewer looks at to see that the page is the shape the design asked for, and
 * what produced the before-and-after pair on the pull request that fixed the width.
 *
 * ⚠️ **The assertions were briefly a spec file of their own and that was a defect.**
 * `seedAdminFixtures()` writes one global set of people and events — only the two timing
 * addresses carry `TEST_PARALLEL_INDEX` — so `admin-fixtures.ts`'s own header assumes a single
 * owner per fixture set. A second spec seeding them raced the first across two workers and
 * produced `User already registered` and a foreign-key violation in teardown, on five tests in
 * three projects, none of which was about layout. **This file is safe for the same reason the
 * race-night one is**: the screenshots config runs `workers: 1`, which is the sequential
 * clear-then-create the fixtures were always written for.
 *
 * ## Running it
 *
 * ```sh
 * ./dev e2e --config=playwright.config.screenshots.ts
 * ```
 *
 * ⚠️ **Through `./dev e2e`, never a bare `npx playwright test`** — the sibling config's header
 * explains why: a scoped run needs the three Supabase variables `./dev` exports, and without
 * them the fixtures throw `supabaseKey is required` from a file the failing test never names.
 *
 * `SCREEN_DIR` chooses where the files land. It defaults **outside the repository**, unlike the
 * race-night screens which are runbook images and are committed: these are review artefacts for
 * one change, and a directory of PNGs of an admin page is not something this repository should
 * carry for ever. Set it to compare two runs:
 *
 * ```sh
 * SCREEN_DIR=/tmp/people-before ./dev e2e --config=playwright.config.screenshots.ts
 * ```
 *
 * ## Why full-page, and why both states
 *
 * The defect was a band and two panes laid out to the width of a paragraph inside a full-width
 * masthead, so the thing worth photographing is the **relationship between the chrome and the
 * content** — which a viewport-sized shot of the top of the page happens to show and a cropped
 * one does not. Both states because the list and the detail pane are separate arrangements
 * below 48rem: a picture of the list alone says nothing about the screen a volunteer actually
 * reads somebody's roles on.
 */

const WIDTHS = [1440, 1024, 768, 390, 320] as const;

const PEOPLE = '/admin/people/';

const OUT = process.env.SCREEN_DIR ?? '/tmp/src-people-screens';

async function shoot(bytes: Buffer, name: string): Promise<void> {
  const target = resolve(OUT, `${name}.png`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await seedAdminFixtures();
});

test.afterAll(async () => {
  await clearAdminFixtures();
  forgetSessions();
});

for (const width of WIDTHS) {
  test(`people and roles at ${width}px`, async ({ page }) => {
    await signInAs(page, SUPER_ADMIN_EMAIL);
    await page.setViewportSize({ width, height: 900 });

    await page.goto(PEOPLE);
    // The same wait every measurement in this suite takes. A screenshot of a bare document is
    // a picture of the absence of CSS, which is the failure `sideways-scroll.ts` was written
    // for — and it is far more convincing in a PNG than it is in a number.
    await waitForStyledLayout(page);
    await shoot(await page.screenshot({ fullPage: true }), `people-${width}`);

    await page.getByRole('link').filter({ hasText: REGISTERED_EMAIL }).first().click();
    await waitForStyledLayout(page);
    await shoot(await page.screenshot({ fullPage: true }), `person-${width}`);
  });
}
