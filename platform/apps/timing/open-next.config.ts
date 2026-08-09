import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * How Next.js is adapted to run on Workers.
 *
 * `@opennextjs/cloudflare`, not `@cloudflare/next-on-pages` — the latter is deprecated
 * and Edge-runtime only, which the timing app cannot use.
 *
 * No incremental cache is configured. The timing app's pages are live by nature — a
 * leaderboard that serves a cached crossing is worse than one that is slow — and adding
 * an R2-backed cache before there is anything to cache would be guessing. It is a
 * one-line change here when the port makes the need real.
 *
 * ## ⚠️ Why `buildCommand` is set, when the default would do
 *
 * `opennextjs-cloudflare build` produces the Next.js output by **running one of this
 * package's own npm scripts** — by default `build`. Point `build` back at
 * `opennextjs-cloudflare build` and it invokes itself, and it does not stop: it recursed
 * **205 levels deep on 8 August 2026** and took the machine down with it.
 *
 * The comment alone is not the guard. `buildCommand` names a **dedicated script**,
 * `build:next`, which does nothing but run `next build`. That is deliberately redundant
 * with `build` — the redundancy is the point. Someone can now change `build` however they
 * like and the recursion still cannot form.
 *
 * The three scripts, and none of them should be merged:
 *
 *   `build`       next build          — what CI and the workspace root run
 *   `build:next`  next build          — what OpenNext runs. Never anything else
 *   `build:worker` opennextjs-cloudflare build — the deployable bundle
 *
 * See docs/delivery/phases.md#phase-4--the-timing-app-on-cloudflare
 */
const config = defineCloudflareConfig();

// Not part of `CloudflareOverrides` — it belongs to the OpenNext config this returns.
config.buildCommand = 'npm run build:next';

export default config;
