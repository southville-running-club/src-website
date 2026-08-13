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

    // **The other two states are separate runs, not separate files in this one.** Each needs
    // `entries.events` moved — the window for one, the capacity for the other — and that is
    // global state. `serves.test.ts` here asserts that `/nn/` quotes no price, which is true
    // exactly while entries are *not* open. Two runs against two fixed states are
    // deterministic; one run against a moving one is not.
    //
    // **This list has to grow when a directory does**, and it is the sort of thing that fails
    // confusingly rather than obviously: a sold-out test run against a closed window reports
    // "entries are not open" and reads as a bug in the notice rather than as a config that
    // collected a file it should not have. It has cost that half hour once already.
    exclude: ['tests/worker/entries-open/**', 'tests/worker/sold-out/**'],

    // The seeded, closed state — **set rather than assumed**. Leaving it to whatever the
    // last run happened to do is how `serves.test.ts` starts failing on a laptop for
    // reasons that read as a bug in the page.
    globalSetup: ['./tests/worker/global-setup-closed.ts'],
  },
});
