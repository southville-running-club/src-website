import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * The race-night runbook's pictures — [#256](https://github.com/southville-running-club/src-website/issues/256).
 *
 * `apps/main/tests/e2e/timing-race-night.screens.ts` drives the real application against the
 * suite's own fabricated races and writes a PNG per screen into
 * `docs/delivery/runbooks/images/timing-race-night/`. **It has never been run**; that file's
 * header says what to expect of the first attempt.
 *
 * ```sh
 * cd platform
 * npx playwright test --config=playwright.config.screenshots.ts
 * ```
 *
 * ## Why this is a third config rather than a tag
 *
 * ⚠️ **A screenshot run may never be part of a gate**, and a tag inside the ordinary suite is
 * one `grep` away from becoming part of one. It writes files into `docs/`, which is not a thing
 * a test does; it presses **Publish these results**, which is not a thing a gate should do
 * sixteen times a day; and it is slow in a way nobody should pay for on a pull request that
 * changed a stylesheet.
 *
 * **The separation is in two places and both are load-bearing.** The base config's `testMatch`
 * ends in `.spec.ts`, so a file named `.screens.ts` cannot be collected by it at all — that is
 * the property that survives somebody editing this file. `testMatch` here is the other half,
 * naming the one file this config exists to run.
 *
 * `playwright.config.serial.ts` is the precedent for the shape: spread the base config, change
 * the two fields that have to differ, and re-decide nothing else. `webServer`, `use`, `timeout`
 * and `globalTimeout` all come from there — a screenshot of a page served differently from the
 * page the suite tests would be a picture of something that does not exist.
 *
 * ## One project, and the reason it is not three
 *
 * The base config runs `chromium`, `mobile-safari` and `no-javascript`. Three projects here
 * would mean three sets of the same nineteen files racing to the same paths, and the last writer
 * winning — and **the `no-javascript` one would photograph the capture screen's paper
 * fallback**, which is a real screen and not the one a marshal is being shown how to use.
 *
 * So: one desktop project, named `screens` because the fixture slugs are scoped by project name
 * and the name therefore ends up in the database. The marshal screen sets a phone viewport for
 * itself, in the spec, where the reason for it is next to the code that needs it.
 */
export default defineConfig({
  ...baseConfig,
  testMatch: ['**/timing-race-night.screens.ts'],
  testIgnore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.open-next/**',
    '**/.wrangler/**',
  ],
  // One at a time. The fixtures are shared and the file presses buttons that change a race.
  workers: 1,
  // `list`, even in CI, because there is no CI run of this config — and a `github` reporter
  // annotating a diff with nineteen screenshots nobody asked for is noise.
  reporter: 'list',
  projects: [{ name: 'screens', use: { ...devices['Desktop Chrome'] } }],
});
