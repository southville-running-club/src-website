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
  },
});
