import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The worker tests for `/admin/` — the club's back office, and the only surface here that
 * returns real people.
 *
 * **A fifth config rather than a `beforeAll`**, for the three reasons the other four are
 * separate: `pg` cannot run inside `workerd`, the state these need is global, and the default
 * run asserts things that are only true of a database without these fixtures in it.
 *
 * **It used to have a fourth reason, and #58 removed it.** This was the only run in which
 * `ENTRIES_ADMIN_KEY` was bound, because the surface was opened by a Worker secret plus a key
 * per volunteer; every other run proved the other half for free, since with no key bound the
 * whole prefix declined and 404'd. There is no key any more. The way in is a Supabase session
 * plus a staff role, checked per request against `identity.my_roles()`, so what this run needs
 * from `globalSetup` is **three real accounts** rather than a digest — and the binding, along
 * with the long note that justified it, is gone rather than left behind to be believed.
 *
 * Nothing is bound here at all now, deliberately: the run should see exactly the Worker
 * `wrangler.jsonc` describes, including the local Supabase URL and the published Turnstile
 * testing site key that `[auth.captcha]`'s dummy secret is paired with. A binding that existed
 * on a laptop and not in CI is a test that proves different things in two places, which is
 * what the old note was really about.
 *
 * **`tests/worker/admin/**` must be in the default config's `exclude` list**, and it is. The
 * README records that forgetting it has cost half an hour twice.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/worker/admin/**/*.test.ts'],
    globalSetup: ['./tests/worker/admin/global-setup.ts'],
  },
});
