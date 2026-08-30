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
 *
 * ## This is one of two configs, and this one runs second
 *
 * `nn-entry.spec.ts` and `nn-signup.spec.ts` share one row —
 * `entries.events.entries_open_at` — and run on different workers they interleave and each
 * occasionally sees the other's state. Every other file here shares nothing with them. Until
 * #58 all of them paid for that race with one worker anyway; `playwright.config.serial.ts`
 * carves the two racy files out into their own `workers: 1` run, and this config is
 * everything else — free to use more than one, because nothing left in it needs the lock
 * `entries_open_at` effectively is.
 *
 * `npm run test:e2e`, `./dev test` and `ci.yml`'s Acceptance tests step all run **both**
 * configs. See `playwright.config.serial.ts`'s own header for why a second config rather
 * than a lock or a `workers` setting scoped some other way.
 */
export default defineConfig({
  testDir: './apps',
  testMatch: '**/tests/e2e/**/*.spec.ts',

  // Build output contains copies of application files. Without this, Playwright can
  // collect specs out of a bundle and run them twice.
  //
  // `nn-entry.spec.ts` and `nn-signup.spec.ts` are ignored here for a different reason —
  // `playwright.config.serial.ts` runs them instead, on their own worker. See this file's
  // header.
  testIgnore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.open-next/**',
    '**/.wrangler/**',
    '**/nn-entry.spec.ts',
    '**/nn-signup.spec.ts',
  ],

  // **`fullyParallel` was `true`, and it was never actually doing anything until this file's
  // own `workers` went above one.** At `workers: 1` there was only ever one worker slot to
  // hand a test to, so "each test may run on any worker" degenerated to "everything still
  // runs one at a time" — the setting was live in name and inert in practice. The first CI
  // run after `workers` went to two proved it is not inert now: `admin.spec.ts`'s
  // `beforeAll` signs three fixed-email fixture people up through the real form, and with
  // `fullyParallel: true` Playwright is free to split *that file's own tests* across both
  // workers — two processes calling `signUp()` for the same address at once, which is the
  // same shape of race `entries_open_at` was, just discovered a second time, inside one file
  // rather than between two. `nn-entry-complete.spec.ts` seeds fixed-id purchases in its own
  // `beforeAll` and has the identical exposure, undetected only because nothing had split it
  // yet either.
  //
  // `fullyParallel: false` is Playwright's own default, and it is the right shape for a
  // suite full of files like these: a file's tests still run in one worker, in order, so a
  // `beforeAll` that seeds fixed state is safe by construction — while *different* files
  // still land on different workers, which is the actual parallelism this config exists to
  // get. Turning it off protects every file with this shape, present or future, rather than
  // annotating each one that happens to be found.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,

  // **No retries, anywhere, and that is a decision rather than a default.**
  //
  // This was `process.env.CI ? 1 : 0`, and [#125] is the issue that says what it cost: a test
  // that fails intermittently passes on its retry and the run goes green, with nothing in the
  // pull request, the checks list or the run summary saying a retry happened. At a 1-in-3
  // failure rate a single retry converts roughly two failing runs in three into green, so
  // twelve consecutive green runs is entirely consistent with a fault present for weeks —
  // which is exactly what the `no-javascript` failures turned out to be.
  //
  // **The trade is accepted deliberately: a genuine flake now goes red.** That is the point. A
  // suite that hides its own unreliability is worse than one that stops, because the hiding is
  // silent and the cost lands on whoever is next to trust it.
  //
  // It also makes CI and a laptop agree, which is the other half of why this changed. Local
  // was already `0`; CI was not, so the two could not be compared and "green on my machine"
  // meant something different from "green in CI".
  //
  // [#125]: https://github.com/southville-running-club/src-website/issues/125
  retries: 0,

  // **A dead web server should stop the run, not be re-discovered six hundred times.**
  //
  // `webServer` does not restart what it started, so once `wrangler dev` exits — which it
  // does, mid-run, see the note in `ci.yml` — every remaining test fails on
  // `Could not connect to localhost: Connection refused`, and `retries: 1` means each fails
  // twice. Run 32867934746 spent its whole budget that way: **578 connection failures**, none
  // of them information, one dead process observed 578 times.
  //
  // That is not merely slow. The retry in `ci.yml` is a fresh `webServer` and the one thing
  // that could actually recover the run, and it starts only once all of that is paid for — so
  // the grind is what turns a recoverable crash into a red pull request.
  //
  // Twenty is past any plausible genuine cluster and a small fraction of either config. The
  // trade is real and worth stating: a change that legitimately breaks more than twenty tests
  // reports the first twenty and stops, so the first run after a broad regression
  // under-reports. That costs one re-run of an already-red suite, against an outcome where the
  // cause is buried in six hundred identical connection errors.
  maxFailures: process.env.CI ? 20 : 0,
  // `github` annotates the diff; the JSON alongside it is what `tools/suite-timing.py` reads
  // to say where the time went, per file and per project. A file rather than a second console
  // reporter, because two writing to one stream interleave — and `ci.yml` overrides the name
  // per config through `PLAYWRIGHT_JSON_OUTPUT_NAME`, so the second run does not land on the
  // first's report. `playwright.config.serial.ts` spreads this config and inherits it.
  reporter: process.env.CI
    ? [['github'], ['json', { outputFile: 'playwright-report/results.json' }]]
    : 'list',

  // **Two, not one, and not unbounded.** Two servers plus three browser engines is already a
  // lot of processes for a shared CI runner, which is the ceiling this number has always been
  // choosing against — see the note at the top of this file. It went to one, unconditionally,
  // when `nn-entry.spec.ts` and `nn-signup.spec.ts` turned out to race on
  // `entries.events.entries_open_at`; #58 moved those two into `playwright.config.serial.ts`
  // instead, so this file no longer has that race to protect against and two is the number
  // this repository already validated for the constraint that remains.
  workers: 2,

  timeout: 30_000,
  // A hung run should fail in minutes rather than sit there looking like progress.
  globalTimeout: 10 * 60_000,

  use: {
    // One origin for the whole site, exactly as in production. `/timing` is a different
    // Worker — forwarded by `apps/main` locally, dispatched by a Cloudflare route live —
    // but the browser cannot tell, which is the point.
    // **`PW_BASE_URL` is how `./dev e2e --linux` reaches the site**, and it is the only reason
    // this is not a literal. That mode runs the browsers inside CI's own Linux image while the
    // Workers and the database stay on the host, so the container addresses them as
    // `host.docker.internal` rather than `localhost`. Everything else leaves it unset.
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:8787',
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
  // **`PW_NO_WEBSERVER` is set by `./dev e2e --linux` and nothing else.** In that mode the
  // servers are already running on the host — this process is inside a container and could
  // neither start them nor bind their ports. Everywhere else Playwright owns their lifecycle,
  // which is what makes a plain `npx playwright test` work at all.
  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : [
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
