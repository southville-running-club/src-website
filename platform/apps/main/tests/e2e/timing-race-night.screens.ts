import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  NN_RESULTS_EMAIL,
  TIMING_ADMIN_EMAIL,
  TIMING_MARSHAL_EMAIL,
} from '../admin-fixtures';
import { clearAdminFixtures, seedAdminFixtures } from '../admin-db';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import {
  anomalyEventSlug,
  captureEventSlug,
  clearAnomalyEvent,
  clearCaptureEvent,
  clearPreviewEvent,
  clearResetEvent,
  clearRosterEvent,
  clearStartEvents,
  clearStatusEvent,
  clearTimingFixtures,
  previewEventSlug,
  resetEventSlug,
  rosterEventSlug,
  seedAnomalyCrossings,
  seedAnomalyEvent,
  seedCaptureEvent,
  seedPreviewEvent,
  seedResetEvent,
  seedRosterEvent,
  seedStartEvents,
  seedStatusEvent,
  seedTimingFixtures,
  startEventSlug,
  statusEventSlug,
} from '../timing-db';
import { PUBLISHED_PATH, RESULTS_PATH } from '../timing-fixtures';
import { forgetSessions, signInAs } from './sign-in';

/**
 * The pictures for [the race-night runbook](../../../../docs/delivery/runbooks/timing-race-night.md)
 * — [#256](https://github.com/southville-running-club/src-website/issues/256).
 *
 * ## ⚠️ This has never been run, and whoever runs it first owns what it produces
 *
 * It is committed unexecuted, deliberately: the runbook it serves had to land before the change
 * freeze and a screenshot run needs a local stack, which the session that wrote this could not
 * start. **Expect the first run to need corrections** — a selector that waits on the wrong
 * thing, a race that is in a different state than this file assumes. That is cheap to fix and
 * cheaper than a runbook that shipped late.
 *
 * ⚠️ **Through `./dev e2e`, from the worktree root — never `npx playwright test`.** A scoped
 * Playwright run needs the three Supabase variables `./dev` exports, and without them the
 * fixtures throw `supabaseKey is required` from `admin-db.ts`, a file the failing test never
 * mentions. `CLAUDE.md` carries the note; this file was written against the bare `npx` form, and
 * that form fails on the first screen with the other six never run.
 *
 * ```sh
 * ./dev e2e --config=playwright.config.screenshots.ts
 * ```
 *
 * **First run, 14 September 2026: seven tests green, nineteen files written**, so nothing about
 * the fixtures needed fixing after all.
 *
 * ## Why a script rather than ten pictures somebody took
 *
 * **Every screenshot here comes from the suite's own fabricated races and never from
 * production.** These screens carry named runners, their bibs and their categories; the entry
 * list and the status page carry a guide beside the runner they are guiding, which is Article 9
 * data about a real person. **A picture of a real start list is a disclosure that cannot be
 * taken back**, and the only reliable way to keep that true is for no human to be in the loop
 * with a screenshot key. The old repository's `kayleigh-screenshots.mjs` is the same idea; this
 * is that idea with this platform's fixtures under it.
 *
 * The second reason is staleness. A runbook full of photographs of an application that changes
 * weekly is a runbook that lies quietly — every other document here has the same problem and
 * pays for it with a `⚠️` paragraph. **Re-running this is the correction**, and it takes a
 * minute.
 *
 * ## Three properties this file must keep
 *
 * **It is not in the gate, and it must never become part of one.** `playwright.config.ts`
 * matches `*.spec.ts`; this is `*.screens.ts`, so the ordinary suite cannot collect it. It
 * writes files into `docs/`, which is not a thing a test may do.
 *
 * ⚠️ **Run it on its own.** It calls `seedAdminFixtures()`, which `admin.spec.ts` also calls,
 * and two processes signing the same address up answer `AuthApiError: User already registered`
 * — `timing-staff-db.ts`'s header carries the whole story. `CLAUDE.md`'s own note on a second
 * `./dev test` is the general form: **wait for the run that was dispatched.**
 *
 * ⚠️ **`nn-2026` is never published here.** The row itself is in the table by migration since
 * #288; what `timing-db.ts` keeps behind its own function is *publishing* it, because
 * `entries.current_entry_state('nn')` answers that running and a published one paints a Results
 * link onto `/nn/` and `/nn/2026/` for everything else in the run. The published public page
 * below is `nn-2095`, which reaches no page but its own.
 */

/** Where the pictures land. The runbook is the only thing that reads them. */
const OUT = path.join(
  '..',
  'docs',
  'delivery',
  'runbooks',
  'images',
  'timing-race-night',
);

/**
 * Playwright is always invoked from `platform/`, and the path above is relative to it.
 *
 * **Asserted rather than assumed**, because getting it wrong writes nineteen PNGs into some
 * other directory and reports success — the failure mode this repository calls *quietly
 * vacuous*.
 */
function outDir(): string {
  const cwd = process.cwd();

  expect(
    path.basename(cwd),
    'this must be run from platform/, so that the output path resolves into docs/',
  ).toBe('platform');

  return path.join(cwd, OUT);
}

/**
 * One screen, full page, at a width a laptop actually has.
 *
 * **`fullPage`** because these pages are long and the half a viewport cuts off is the half
 * carrying the button. **`animations: 'disabled'`** so two runs of the same screen produce the
 * same bytes and a re-run is a no-op in the diff rather than nineteen changed files.
 */
async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(outDir(), `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

/** The project name every fixture slug is scoped by — see `timing-db.ts`. */
function project(testInfo: TestInfo): string {
  return testInfo.project.name;
}

test.beforeAll(async () => {
  await mkdir(outDir(), { recursive: true });
});

test.describe('the screens a volunteer meets on race night', () => {
  // Sequential, and the file is one `describe` for that reason: the fixtures are per project
  // rather than per test, and seeding them once is both faster and the only way the results
  // preview and the prize screen can be shot against the same field.
  test.describe.configure({ mode: 'serial' });

  /*
   * ⚠️ **`{}` is required by Playwright and rejected by ESLint**, so the rule is off for this
   * line and the one below it. Playwright reads a hook's source to work out which fixtures to
   * set up and refuses a first argument that is not a destructuring pattern, thrown while
   * listing tests; `timing.spec.ts` carries the longer note and does the same thing.
   */
  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    const slot = project(testInfo);

    await seedAdminFixtures();
    await seedTimingStaff();
    await seedTimingFixtures();
    await seedRosterEvent(rosterEventSlug(slot));
    await seedStartEvents(slot);
    await seedCaptureEvent(slot, TIMING_MARSHAL_EMAIL);
    await seedAnomalyEvent(slot);
    await seedAnomalyCrossings(slot);
    await seedStatusEvent(slot);
    await seedPreviewEvent(slot);
    await seedResetEvent(slot, TIMING_MARSHAL_EMAIL);
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    const slot = project(testInfo);

    await clearResetEvent(slot);
    await clearPreviewEvent(slot);
    await clearStatusEvent(slot);
    await clearAnomalyEvent(slot);
    await clearCaptureEvent(slot);
    await clearStartEvents(slot);
    await clearRosterEvent(rosterEventSlug(slot));
    await clearTimingFixtures();
    await clearTimingStaff();
    await clearAdminFixtures();
    forgetSessions();
  });

  test('phase 1 — the week before', async ({ page }, testInfo) => {
    const slot = project(testInfo);

    await signInAs(page, TIMING_ADMIN_EMAIL);

    await page.goto('/timing/events/');
    await expect(page.getByRole('heading', { level: 1, name: 'Races' })).toBeVisible();
    await shoot(page, '01-every-race');

    await page.goto(`/timing/events/${previewEventSlug(slot)}/`);
    await expect(page.getByRole('heading', { level: 2, name: 'Set up' })).toBeVisible();
    await shoot(page, '02-one-race');

    await page.goto(`/timing/events/${previewEventSlug(slot)}/registration/`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Entry list' }),
    ).toBeVisible();
    await shoot(page, '03-entry-list');

    await page.goto(`/timing/events/${rosterEventSlug(slot)}/marshals/`);
    await shoot(page, '04-the-roster');
  });

  test('phase 2 — the start', async ({ page }, testInfo) => {
    const slot = project(testInfo);

    await signInAs(page, TIMING_ADMIN_EMAIL);

    // The countdown, with the button that has not been pressed. `pending` is the state the
    // start screen is opened in on race morning.
    await page.goto(`/timing/events/${startEventSlug(slot, 'pending')}/start/`);
    await expect(page.getByRole('button', { name: 'Start the race' })).toBeVisible();
    await shoot(page, '05-before-the-gun');

    // Started, with the elapsed clock and no way to clear it — `clearable` is the other half,
    // and the pair is what makes "pressing again does not move it" legible in a picture.
    await page.goto(`/timing/events/${startEventSlug(slot, 'running')}/start/`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'The race is running' }),
    ).toBeVisible();
    await shoot(page, '06-after-the-gun');
  });

  test.describe('phase 3 — the marshal', () => {
    // A phone, because that is the only device this screen is ever held on. The capture screen
    // is the one surface here that needs JavaScript, so this block cannot be shot in a
    // `javaScriptEnabled: false` project — which is why the config below runs one project.
    test.use({ viewport: { width: 390, height: 844 } });

    test('the capture screen, empty and holding a card', async ({ page }, testInfo) => {
      const slot = project(testInfo);

      await signInAs(page, TIMING_MARSHAL_EMAIL);

      await page.goto(`/timing/marshal/${captureEventSlug(slot)}/`);
      await expect(page.getByRole('button', { name: 'Crossed now' })).toBeVisible();
      // The line that says whether the screen survives a reload without signal. It is what
      // step 1.4 of the runbook asks a marshal to wait for, so it has to be in the picture.
      await expect(page.locator('[data-capture-offline-ready]')).toBeVisible();
      await shoot(page, '07-nothing-waiting');

      // One tap, so the keypad and "Crossed at" are on the page. The bib is left untyped: the
      // runbook's point is that the time is recorded before anybody thinks about a number.
      await page.getByRole('button', { name: 'Crossed now' }).click();
      await expect(page.getByText('No bib yet')).toBeVisible();
      await shoot(page, '08-a-tap-with-no-bib-yet');

      // Confirmed, so the card carries a state a marshal has to be able to read. Which state
      // depends on whether the drain has run, which is exactly the ambiguity the runbook's
      // table resolves — so the picture is taken of whatever it says rather than waited into
      // one particular state.
      await page
        .getByRole('button', { name: /^[0-9]$/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Confirm bib' }).click();
      await shoot(page, '09-a-card-on-the-phone');
    });
  });

  test('phase 3 — what race control watches', async ({ page }, testInfo) => {
    const slot = project(testInfo);

    await signInAs(page, TIMING_ADMIN_EMAIL);

    await page.goto(`/timing/events/${anomalyEventSlug(slot)}/anomalies/`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Anomalies' }),
    ).toBeVisible();
    await shoot(page, '10-the-triage-list');

    await page.goto(`/timing/events/${anomalyEventSlug(slot)}/crossings/`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Timing log' }),
    ).toBeVisible();
    await shoot(page, '11-the-timing-log');
  });

  test('phase 4 — finishing, the statuses and the preview', async ({
    page,
  }, testInfo) => {
    const slot = project(testInfo);

    await signInAs(page, TIMING_ADMIN_EMAIL);

    // `running` rather than `finished`, because the picture wanted is the one with the button
    // and the sentence under it — "finishing is a label, not a cut-off".
    await page.goto(`/timing/events/${startEventSlug(slot, 'running')}/finish/`);
    await expect(page.getByRole('button', { name: 'Finish this race' })).toBeVisible();
    await shoot(page, '12-finishing-is-a-label');

    await page.goto(`/timing/events/${statusEventSlug(slot)}/status/`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Race status' }),
    ).toBeVisible();
    await shoot(page, '13-did-not-start-finish-or-qualify');

    // Finished and not published, which is the one state the publish button is live in.
    await page.goto(`/timing/events/${previewEventSlug(slot)}/results/`);
    await expect(
      page.getByRole('button', { name: 'Publish these results' }),
    ).toBeVisible();
    await shoot(page, '14-the-preview-and-the-publish-button');

    await page.goto(`/timing/events/${previewEventSlug(slot)}/prizes/`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Prize giving' }),
    ).toBeVisible();
    await shoot(page, '15-prize-giving');
  });

  test('phase 5 and the danger zone', async ({ page }, testInfo) => {
    const slot = project(testInfo);

    await signInAs(page, TIMING_ADMIN_EMAIL);

    // ⚠️ **Published through the application rather than seeded published**, because the
    // picture wanted is the one a volunteer sees *after* pressing the button: "Anybody can read
    // them now, signed in or not." Nothing else in this file presses a button that changes a
    // race, and this one is undone by `clearPreviewEvent` in `afterAll`.
    await page.goto(`/timing/events/${previewEventSlug(slot)}/results/`);
    await page.getByRole('button', { name: 'Publish these results' }).click();
    await expect(
      page.getByRole('button', { name: 'Unpublish these results' }),
    ).toBeVisible();
    await shoot(page, '16-published-and-how-to-correct-it');

    await page.goto(`/timing/events/${resetEventSlug(slot)}/danger-zone/`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'What would be removed' }),
    ).toBeVisible();
    await shoot(page, '17-the-danger-zone');
  });

  test('what the club side shows, before and after publication', async ({ page }) => {
    // The preview, to somebody holding `nn-results` and no timing role at all. This is the one
    // read that exists so that a race is checked by somebody who did not capture it.
    await signInAs(page, NN_RESULTS_EMAIL);
    await page.goto(RESULTS_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shoot(page, '18-the-preview-on-the-club-site');

    // ⚠️ **Signed out, and that is the assertion as much as the picture.** `nn-2095` is
    // published, so this address is public and permanent — the only page in this file a
    // stranger may read.
    await page.context().clearCookies();
    await page.goto(PUBLISHED_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shoot(page, '19-published-to-the-public');
  });
});
