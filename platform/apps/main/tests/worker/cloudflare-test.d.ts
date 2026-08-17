/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * The types for `cloudflare:test`, which is a virtual module the Miniflare pool provides at
 * run time and TypeScript cannot otherwise see.
 *
 * It is here because **the Worker was not typechecked at all until this slice**, and the reason
 * is one line: `worker/tsconfig.json` has named `@cloudflare/workers-types` since the skeleton
 * and nothing ever installed it, so `tsc -p worker` failed at the first import and no script
 * ever ran it. `astro check` — which is what `npm run typecheck` calls for this app — excludes
 * `worker/` by its own tsconfig, so nothing covered the code that takes the money.
 *
 * Turning it on found a real defect in the admin surface on the first run, which is the whole
 * argument for it. `apps/main`'s `typecheck` script now runs both.
 */
