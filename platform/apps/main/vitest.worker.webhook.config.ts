import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The worker tests for `POST /nn/stripe-webhook` and the page Stripe returns somebody to.
 *
 * **A fourth config rather than a `beforeAll`**, for the same two reasons the other three are
 * separate — `pg` cannot run inside `workerd`, and the state these need is global — plus one
 * of its own: this is the only run in which **the webhook key digest is installed**. Leaving it
 * installed for the other runs would mean a laptop sitting there with the real event row
 * confirmable by anybody who read a test file.
 *
 * **`tests/worker/webhook/**` must be in the default config's `exclude` list**, and it is. The
 * README records that forgetting it has cost half an hour twice: the closed-window run collects
 * the directory, and the failure reports as "entries are not open" and reads like a bug in the
 * notice rather than a config that picked up a file it should not have.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },

      // ---------------------------------------------------------------------------------
      // Both secrets, **injected by the test harness and never by application config**
      // ---------------------------------------------------------------------------------
      // `wrangler.jsonc` mentions neither, in either block, and
      // `tests/unit/worker-config.test.ts` asserts that. Bound here rather than left to
      // `apps/main/.dev.vars` — which the pool silently loads — because a binding that exists
      // on a laptop and not in CI is a test that proves different things in two places.
      //
      // Both are obviously not real and authenticate to nothing: the signing secret is only
      // ever HMAC'd against a payload this suite signed itself, and the webhook key's digest
      // is installed into the local database by `global-setup.ts` and removed afterwards.
      //
      // The signing secret is nonetheless *shaped* like a live one on purpose, the same way
      // the Stripe stub key is: `nn-entry.spec.ts` asserts that no response body and no console
      // line anywhere contains `whsec_`, and a value that did not match would make the
      // assertion pass by not being findable.
      //
      // **Written out here and again in `tests/webhook-fixtures.ts`**, which is the same
      // duplication `vitest.worker.entries-open.config.ts` carries for the Stripe stub key, and
      // for the same reason: a Vite config that imports a local module has to name it with an
      // extension the rest of the workspace does not use. The duplication is safe because a
      // mismatch fails loudly rather than quietly — the digest installed from the fixtures
      // module would stop matching the key bound here, and every delivery would answer
      // `unauthorised` on the first test in the file.
      miniflare: {
        bindings: {
          STRIPE_WEBHOOK_SECRET: 'whsec_TEST_NOT_A_REAL_SIGNING_SECRET_000000',
          ENTRIES_WEBHOOK_KEY: 'zz-worker-test-key-not-a-real-one',
        },
      },
    }),
  ],
  test: {
    include: ['tests/worker/webhook/**/*.test.ts'],
    globalSetup: ['./tests/worker/webhook/global-setup.ts'],
  },
});
