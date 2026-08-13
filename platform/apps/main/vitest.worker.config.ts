import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests that run **inside** the Workers runtime, via Miniflare — not a mock of it.
 *
 * They need `dist/` to exist, because the static-assets binding serves from it, so
 * `npm run build` comes first. That is why they are a separate command rather than part
 * of `npm test`.
 *
 * One caveat from Cloudflare's own documentation, worth knowing before trusting a green
 * run: `vitest-pool-workers` enables `nodejs_compat` by default in tests, so a Worker can
 * pass here while using a Node API it would not have in production.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/worker/**/*.test.ts'],

    // **The entries-open tests are a separate run, not a separate file in this one.** They
    // need `entries.events.entries_open_at` moved, which is global state, and
    // `serves.test.ts` here asserts that `/nn/` quotes no price — true exactly while entries
    // are *not* open. Two runs against two fixed states are deterministic; one run against a
    // moving one is not. See `vitest.worker.entries-open.config.ts`.
    exclude: ['tests/worker/entries-open/**'],

    // The seeded, closed state — **set rather than assumed**. Leaving it to whatever the
    // last run happened to do is how `serves.test.ts` starts failing on a laptop for
    // reasons that read as a bug in the page.
    globalSetup: ['./tests/worker/global-setup-closed.ts'],
  },
});
