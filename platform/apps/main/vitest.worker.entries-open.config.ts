import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The worker tests that need the entry window **open**.
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
 * `npm run test:worker` runs both configs in sequence. Like the default one, this needs
 * `dist/` to exist and the local Supabase stack to be up.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/worker/entries-open/**/*.test.ts'],
    globalSetup: ['./tests/worker/entries-open/global-setup.ts'],
  },
});
