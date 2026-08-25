import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * The one pair of spec files that must never run at the same time as each other.
 *
 * ## Why this is a second config rather than a setting
 *
 * `/nn/` shows the entry form or the interest form according to
 * `entries.events.entries_open_at` — the real switch, read by the Worker per request, with no
 * preview flag that could reach production. `nn-entry.spec.ts` moves that row and
 * `nn-signup.spec.ts` needs it left alone; run them on different workers and they interleave,
 * each occasionally seeing the other's state.
 *
 * Until #58 the whole suite paid for that with `workers: 1` — every spec file, including ones
 * that share nothing with these two, serialised behind a race that is only ever between these
 * two. #58 added `admin.spec.ts`, real authentication traffic that grows with every test added
 * to it, and CI's own runner turned out not to have the margin to run a longer suite through
 * one worker inside `playwright.config.ts`'s `globalTimeout` — two runs on a fresh CI machine
 * died mid-suite with the Worker unreachable, both times after the suite had already run
 * comfortably past the point at which a shorter one used to finish.
 *
 * Splitting the two racy files into their own `workers: 1` config, and leaving everything else
 * — this file included — free to use more than one, is the alternative this repository's own
 * `playwright.config.ts` already named and did not take: *"a Postgres advisory lock shared by
 * both files. This costs a few seconds of CI and removes a class of intermittent instead of
 * managing one."* A second config costs the same shape of thing — a second `webServer` startup
 * — without touching the lock-free reasoning that already governs everything else here.
 *
 * ## Everything else is inherited, not re-decided
 *
 * `webServer`, `use`, `projects`, `timeout` and `globalTimeout` all come from
 * `playwright.config.ts` unchanged. If a setting needs to change for both suites, it belongs
 * in the base config, not duplicated here.
 *
 * **`testIgnore` is the one field that cannot simply be inherited.** The base config adds
 * `nn-entry.spec.ts` and `nn-signup.spec.ts` to its own `testIgnore` — that is what stops it
 * picking them up too — and `testIgnore` wins over `testMatch` when both apply. Spreading that
 * same array here would make this config ignore the only two files it exists to run, so it is
 * restated rather than inherited. Kept in step with the base config's build-artifact
 * exclusions by eye; there are only two lists in the repository and they rarely change.
 */
export default defineConfig({
  ...baseConfig,
  testMatch: ['**/nn-entry.spec.ts', '**/nn-signup.spec.ts'],
  testIgnore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.open-next/**',
    '**/.wrangler/**',
  ],
  workers: 1,
});
