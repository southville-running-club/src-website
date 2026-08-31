import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
// **Imported rather than restated**, so the binding and the digest the global setup installs
// cannot drift apart. This file runs in ordinary Node — only the *value* crosses into
// `workerd` — so importing a constants module here is safe where importing `pg` would not be.
import { ENTRY_KEY } from './tests/entry-key-fixture';

/**
 * The worker tests that need the entry window **open**, and a payment page to hand over to.
 *
 * A second config rather than a `beforeAll`, for two reasons that are both about the state
 * being global:
 *
 *   1. **`pg` cannot run inside `workerd`.** These tests execute in the real Workers runtime,
 *      which has no `node:net`. Vitest's `globalSetup` runs in the ordinary Node process
 *      before the pool starts, and is the one place here that can reach Postgres.
 *
 *   2. **`tests/worker/serves.test.ts` asserts that `/nn/` quotes no price**, which is true
 *      exactly while entries are not open. Toggling the window between files would make that
 *      assertion depend on run order. Two runs against two fixed states are deterministic;
 *      one run against a moving one is not.
 *
 * `npm run test:worker` runs three configs in sequence — this one, the default closed state,
 * and a sold-out event. Each needs `dist/` to exist and the local Supabase stack to be up.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },

      // ---------------------------------------------------------------------------------
      // Stripe, **injected by the test harness and never by application config**
      // ---------------------------------------------------------------------------------
      // `wrangler.jsonc` mentions Stripe nowhere, in either block, and
      // `tests/unit/worker-config.test.ts` asserts that. The key here is obviously not a key
      // and it authenticates to nothing: `scripts/stripe-stub.mjs` checks the *shape* of the
      // Authorization header so that "the Worker forgot to send it" fails, and never the
      // value.
      //
      // It is nonetheless shaped like a live one on purpose. `nn-entry.spec.ts` asserts that
      // no response body and no console line anywhere contains `sk_test_`, and a stub key
      // that did not match that pattern would make the assertion pass by not being findable.
      miniflare: {
        bindings: {
          STRIPE_SECRET_KEY: 'sk_test_STUB_NOT_A_REAL_KEY_0000000000',
          STRIPE_API_BASE: 'http://127.0.0.1:8789',
          // **The entry key, and it is the same constant the global setup installs the
          // digest of** — imported above rather than restated, because two literals that have
          // to agree are two literals that will not. Holding a place is refused without it
          // since ADR-029 — issue #178.
          ENTRIES_ENTRY_KEY: ENTRY_KEY,
        },
      },
    }),
  ],
  test: {
    include: ['tests/worker/entries-open/**/*.test.ts'],
    globalSetup: ['./tests/worker/entries-open/global-setup.ts'],
  },
});
