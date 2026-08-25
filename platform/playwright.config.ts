import { defineConfig, devices } from '@playwright/test';

/**
 * Acceptance tests, against both front doors under the real Workers runtime.
 *
 * ## Read this before changing the server or worker settings
 *
 * This suite drives two `workerd` servers and up to three browser projects at once —
 * Chromium, WebKit, and Chromium again with JavaScript off — so it is the heaviest thing
 * in the repository by a wide margin. Two rules keep it from taking a laptop down, and
 * both have been broken once already:
 *
 * 1. **The servers must not build.** `npm run test:e2e` builds first, then starts
 *    `preview` on an existing build. A `webServer` command that builds turns every run
 *    into a full OpenNext bundle, and a slow start makes Playwright look hung.
 * 2. **Workers are capped.** Unbounded, Playwright takes half the machine's cores and
 *    each one launches a browser against two workerd instances.
 *
 * See also `apps/timing/next.config.ts`, where `initOpenNextCloudflareForDev()` is guarded
 * to `next dev` — unguarded it spawns a workerd instance per build worker.
 */
export default defineConfig({
  testDir: './apps',
  testMatch: '**/tests/e2e/**/*.spec.ts',

  // Build output contains copies of application files. Without this, Playwright can
  // collect specs out of a bundle and run them twice.
  testIgnore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.open-next/**',
    '**/.wrangler/**',
  ],

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // `github` annotates the diff; the JSON alongside it is what `tools/suite-timing.py` reads
  // to say where the ten minutes went. It is written in CI only, and it is a file rather than
  // a second console reporter because two reporters writing to the same stream interleave.
  reporter: process.env.CI
    ? [['github'], ['json', { outputFile: 'playwright-report/results.json' }]]
    : 'list',

  // **One worker everywhere, and the reason changed.** It was capped at two in CI because
  // two servers plus three engines is already a lot of processes; it is now capped at one
  // because spec files own the same row.
  //
  // `/nn/` shows the entry form or the interest form according to
  // `entries.events.entries_open_at` — the real switch, read by the Worker per request, with
  // no preview flag that could reach production. `nn-entry.spec.ts` moves that row and
  // `nn-signup.spec.ts` needs it left alone. Playwright parallelises across files, so with
  // two workers those two interleave and each occasionally sees the other's state.
  //
  // The alternative was a Postgres advisory lock shared by both files. This costs a few
  // seconds of CI and removes a class of intermittent instead of managing one, which is the
  // trade this repository has already made twice — see the 320px note in nn-theme.css.
  //
  // ---
  //
  // **The paragraph above named two files, and the real set is four. Read this before
  // raising the number.** It is the sentence "`nn-entry.spec.ts` moves that row and
  // `nn-signup.spec.ts` needs it left alone" that is load-bearing, and it was an
  // under-count — enough of one that `workers: 2` looks safe from here and is not:
  //
  //   * **`site.spec.ts`** reads the same switch and is the larger of the two readers, not
  //     the smaller. It asserts the closed-window rendering — the nav call to action, and
  //     `#register` visible on `/nn/2026/` — across its nine-width sweep. `nn-entry.spec.ts`
  //     opening the window mid-sweep is the same defect as the `nn-signup.spec.ts` one, in
  //     roughly five times as many tests.
  //   * **`nn-entry-complete.spec.ts`** collides on a different table. Both it and
  //     `nn-entry.spec.ts` own `entries.entry_purchases` for `nn-2026`, and each one's
  //     `beforeAll` clears what the other is relying on.
  //   * **`nn-entry.spec.ts` asserts global counts**, not its own rows: `purchases()` selects
  //     every purchase against `nn-2026` with no filter, and four assertions expect exactly
  //     one. A concurrent insert from any other file fails them. Its sold-out block also sets
  //     `capacity = 1` on the shared row, which changes the capacity predicate for everybody.
  //
  // `nn-admin.spec.ts` is the counter-example worth copying: it fabricates its own
  // `zz-admin-worker` / `zz-admin-clean` events and scopes every write to them, so it
  // conflicts with nothing. `account.spec.ts`, `privacy.spec.ts` and `nn-privacy.spec.ts` are
  // clean too — `account.spec.ts` generates unique addresses and writes only to `auth`.
  //
  // So the partition is `{nn-entry, nn-entry-complete, nn-signup, site}` serialised against
  // each other — about two thirds of the suite — with the other four free to overlap. A bare
  // `workers: 2` does not express that and would interleave the four. Getting the number up
  // needs the advisory lock the paragraph above already proposed, held across all four rather
  // than two; the ceiling that buys is roughly a third off the suite, because the contended
  // group is most of it.
  workers: 1,

  timeout: 30_000,
  // A hung run should fail in minutes rather than sit there looking like progress.
  //
  // **Twenty minutes, because ten was the suite's own running time.** This was `10 * 60_000`
  // and the suite grew into it exactly: CI run 32862836535 reported `645 passed (10.0m)`,
  // `20 did not run` and `Timed out waiting 600s for the test suite to run`. Nothing was
  // broken and no test failed — the run was cut off with a fifth of the projects' work still
  // queued, and the whole 667 were then re-run by the retry in `ci.yml`, which the job's own
  // budget could not fit. A green suite spending 100% of its ceiling is not a ceiling.
  //
  // It cannot be bought back with parallelism: `workers` is pinned at 1 above for a
  // correctness reason, so the only thing standing between this number and a spurious red on
  // every pull request is headroom. Two minutes of it would be eaten by one slow runner.
  //
  // **This number, `ci.yml`'s `timeout-minutes` and the retry there are one decision in three
  // places, and the arithmetic is the reviewable part.** Setup to the end of `Install
  // browsers` measures ~8 minutes and the suite ~10, so the job's 45 covers the two paths that
  // actually occur: a timed-out run that is now not retried (8 + 20 = 28) and a failed run
  // that is (8 + 10 + 10 = 28). It does **not** cover the pathological 8 + 20 + 20, where a
  // run fails on its merits at the ceiling and is retried — deliberately, because buying that
  // case means carrying a 50-minute ceiling on a job that normally takes 18, and a hung run
  // then bills for all of it against a 2,000-minute monthly allowance this repository is
  // already on course to spend. Change one of the three and redo this sum.
  globalTimeout: 20 * 60_000,

  use: {
    // One origin for the whole site, exactly as in production. `/timing` is a different
    // Worker — forwarded by `apps/main` locally, dispatched by a Cloudflare route live —
    // but the browser cannot tell, which is the point.
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
    // Europe/London, so the browser sees what a club member's phone sees. The *unit*
    // suite pins UTC; this one deliberately does not.
    timezoneId: 'Europe/London',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      // 70% of visitors are on a phone, and iOS Safari is most of that. WebKit is a
      // second browser download in CI and it is worth it — it is the engine that will
      // actually be holding the page at the finish line.
      name: 'mobile-safari',
      use: { ...devices['iPhone SE'] },
    },
    {
      // Progressive enhancement is a requirement, not a preference: a real
      // `<form method="post">` that works with JavaScript disabled, enhanced afterwards.
      // Nothing in the skeleton has a form yet, but the project exists so the Phase 3
      // test has somewhere to go — and so the server-rendered health timestamp is proven
      // to be server-rendered.
      //
      // Tests tagged `@requires-js` are skipped here. Until #53 that always meant "an axe
      // check" — axe works by injecting a script, so it cannot report on a page with
      // scripting turned off. `account.spec.ts` broadens the meaning rather than adding a
      // second tag: `/account/`'s forms carry a Cloudflare Turnstile widget, which has no
      // no-script mode at all, so most of that file is tagged too. Conflating "needs a
      // script to run the check" with "needs a script to work at all" is exactly how this
      // exception gets forgotten, which is why it is written down here and in that file's
      // own header rather than left to be inferred from the grep pattern below.
      name: 'no-javascript',
      use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
      grepInvert: /@requires-js/,
    },
  ],

  // Both front doors under `wrangler dev` — the real Workers runtime, not a framework dev
  // server. **Neither command builds**; `npm run test:e2e` does that first.
  webServer: [
    {
      // **A fake Stripe, and the reason the entry suite can run at all.** This repository
      // holds no Stripe credentials and never will, so `apps/main`'s `preview` script points
      // `STRIPE_API_BASE` here and this answers `POST /v1/checkout/sessions` with a canned
      // session on `checkout.stripe.com`. The suite asserts **where** the Worker redirects
      // and never follows it: Stripe's hosted page is a third party's, and a test that types
      // into it is a test that breaks when they redesign it.
      //
      // Started before the website, because `apps/main` is what calls it.
      command: 'npm run stripe:stub',
      url: 'http://127.0.0.1:8789/__stub/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run preview --workspace=apps/main',
      url: 'http://localhost:8787',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run preview --workspace=apps/timing',
      url: 'http://localhost:8788/timing',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
