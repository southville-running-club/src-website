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

      // **Vestigial, and pinned rather than removed.** This bound the empty string as an
      // assertion: `nn-admin-unconfigured.test.ts` proved that with no admin key the whole
      // `/nn/admin` surface declined and 404'd like an address nobody published, and left
      // unbound that test would have depended on `apps/main/.dev.vars`, **which the pool
      // silently loads** — a laptop with a key in it would have failed the run while CI passed.
      //
      // **#58 removed the key from the Worker.** Nothing reads `env.ENTRIES_ADMIN_KEY` any
      // more; the way in is a Supabase session plus a staff role, and the successor test is
      // `tests/worker/admin-signed-out.test.ts`, which asserts that every `/admin/*` address
      // 404s for somebody who is not signed in. The binding stays only because
      // `worker/index.ts` still declares the variable, and it goes with it in #63.
      miniflare: {
        bindings: {
          ENTRIES_ADMIN_KEY: '',
        },
      },
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
    exclude: [
      'tests/worker/entries-open/**',
      'tests/worker/sold-out/**',
      'tests/worker/webhook/**',
      'tests/worker/admin/**',
    ],

    // The seeded, closed state — **set rather than assumed**. Leaving it to whatever the
    // last run happened to do is how `serves.test.ts` starts failing on a laptop for
    // reasons that read as a bug in the page.
    globalSetup: ['./tests/worker/global-setup-closed.ts'],
  },
});
