import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
// Imported rather than restated, so the binding and the digest `openEntries()` installs
// cannot drift apart. This file runs in ordinary Node; only the value crosses into `workerd`.
import { ENTRY_KEY } from './tests/entry-key-fixture';

/**
 * The worker tests that need the race to be **full**.
 *
 * A third config, and the reason is the one the other two already established: capacity is
 * global state and the state has to be fixed for a whole run. A sold-out event inside the
 * entries-open run would make every other assertion in that run depend on whether it had
 * happened yet, and Playwright's own history on this branch is that shared state plus
 * ordering is where the intermittents come from.
 *
 * **No Stripe stub is started, deliberately.** `worker/nn-entry.ts` calls
 * `entries.create_pending_purchase()` before it goes anywhere near a payment page, so a
 * sold-out event never reaches Stripe — and a run that needed the stub to prove that would
 * be proving the wrong thing. The key binding is still set, because without it the Worker
 * stops one step earlier with "payment is not connected" and this run would be asserting
 * that instead.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          STRIPE_SECRET_KEY: 'sk_test_STUB_NOT_A_REAL_KEY_0000000000',
          // Pointed at a port nothing is listening on. If a sold-out submission ever did
          // reach Stripe, this run would fail rather than quietly succeed against a stub —
          // which is the assertion "the database refuses before any money is involved" is
          // actually made of.
          STRIPE_API_BASE: 'http://127.0.0.1:8799',
          // **Bound for the same reason the Stripe key is: so the refusal under test is the
          // one this file is named after.** Without it the Worker stops at "not connected
          // yet" — a 503 — before it ever asks the database, and the sold-out assertion below
          // would pass on a submission that never reached capacity at all. The digest is
          // installed by `openEntries()` in this run's global setup. ADR-026, issue #178.
          ENTRIES_ENTRY_KEY: ENTRY_KEY,
        },
      },
    }),
  ],
  test: {
    include: ['tests/worker/sold-out/**/*.test.ts'],
    globalSetup: ['./tests/worker/sold-out/global-setup.ts'],
  },
});
