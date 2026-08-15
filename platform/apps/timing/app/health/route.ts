import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  buildHealthReport,
  createAnonClient,
  healthReportFromFailure,
  healthResponse,
  type SupabaseConfig,
} from '@src/shared';

/**
 * `GET /timing/health` — the timing application's half of the pipeline check.
 *
 * The same two round trips `apps/main` answers at `/health`, assembled by the same function
 * in `packages/shared`, so `scripts/smoke.mjs` parses one shape and the two applications
 * cannot drift within a release. What this one proves that the other cannot: **both**
 * applications reach **one** Supabase project, which is the arrangement ADR-002 chose and
 * the thing that would fail silently if a second project ever appeared.
 *
 * Until this existed, `/timing` proved it by rendering it — the whole page was a status
 * table under the heading "What this page proves", linked from the club's front door as
 * "live results and marshal screens". The check moved here and the page became a page.
 *
 * ## `app/health/`, not `app/_health/`
 *
 * **A leading underscore makes an App Router folder private**: Next opts it out of routing
 * entirely, so `app/_health/route.ts` would build cleanly, deploy cleanly, and 404 — with
 * nothing anywhere saying why. The underscore is the conventional spelling for exactly this
 * sort of endpoint on every other platform, which is what makes it worth a comment here
 * rather than a lesson later. It is in CLAUDE.md's traps for the same reason.
 *
 * `basePath: '/timing'` prefixes this like every other route, so the address is
 * `/timing/health` and no code here has to know that.
 */

// Never cached, never prerendered. A cached answer to "can you reach the database" is not an
// answer — and without this, `next build` would try to evaluate the route at build time,
// where there are no bindings at all.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return healthResponse(await buildHealthReport(createAnonClient(await config())));
  } catch (cause) {
    return healthResponse(healthReportFromFailure(cause));
  }
}

/**
 * Where the two Supabase variables come from, which is **not the same place in every
 * environment** — and getting it wrong is silent until something reads an error.
 *
 * Deployed, OpenNext puts the Worker's `vars` into `process.env`, so that alone would work.
 * Under `next dev` it does not: `wrangler.jsonc` vars are Worker configuration and Next reads
 * `.env` files. `getCloudflareContext()` is the bridge, and it is exactly what
 * `initOpenNextCloudflareForDev()` in `next.config.ts` exists to populate — so one code path
 * works in both, with no `.env` file to keep in step.
 */
async function config(): Promise<SupabaseConfig> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return {
      url: env.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL ?? '',
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
    };
  } catch {
    // No Cloudflare context — a plain Node render. `process.env` is the whole answer.
    return {
      url: process.env.PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
    };
  }
}
