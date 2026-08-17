import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The worker tests for `/nn/admin` — the first read path in this platform that returns people.
 *
 * **A fifth config rather than a `beforeAll`**, for the three reasons the other four are
 * separate — `pg` cannot run inside `workerd`, the state these need is global, and the default
 * run asserts things that are only true of a database without these fixtures in it — plus one of
 * its own: **this is the only run in which `ENTRIES_ADMIN_KEY` is bound at all**. Every other run
 * therefore proves the other half of the arrangement for free, because with no key bound the
 * whole surface declines and 404s, which is the deployed state.
 *
 * **`tests/worker/admin/**` must be in the default config's `exclude` list**, and it is. The
 * README records that forgetting it has cost half an hour twice.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },

      // ---------------------------------------------------------------------------------
      // The key, **injected by the test harness and never by application config**
      // ---------------------------------------------------------------------------------
      // `wrangler.jsonc` does not mention it in either block, for the same reason it mentions
      // neither Stripe secret: it is a Worker secret, set by hand with `wrangler secret put`.
      // Bound here rather than left to `apps/main/.dev.vars` — which the pool silently loads —
      // because a binding that exists on a laptop and not in CI is a test that proves different
      // things in two places.
      //
      // It authenticates to nothing. Its digest is installed into the local Docker Postgres by
      // `global-setup.ts` and taken out again in teardown.
      //
      // **Written out here and again in `tests/admin-fixtures.ts`**, the same duplication the
      // webhook config carries and for the same reason: a Vite config that imports a local
      // module has to name it with an extension the rest of the workspace does not use. The
      // duplication is safe because a mismatch fails loudly — the digest installed from the
      // fixtures module would stop matching the key bound here, and the first sign-in in the
      // file would be refused.
      miniflare: {
        bindings: {
          ENTRIES_ADMIN_KEY: 'zz-admin-worker-gate-key-not-a-real-one',
        },
      },
    }),
  ],
  test: {
    include: ['tests/worker/admin/**/*.test.ts'],
    globalSetup: ['./tests/worker/admin/global-setup.ts'],
  },
});
