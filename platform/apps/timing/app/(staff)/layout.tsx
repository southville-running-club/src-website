import { getCloudflareContext } from '@opennextjs/cloudflare';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { createUserClient } from '@src/shared';
import {
  ACCESS_COOKIE,
  EXPIRY_COOKIE,
  parseSessionExpiry,
} from '@src/shared/session-cookies';

/**
 * The door to `/timing`: staff with a timing permission, and a 404 for everybody else.
 *
 * ## Why it is here and not in `apps/main`
 *
 * Cloudflare dispatches `/timing/*` to this Worker **at the edge** —
 * [ADR-007](../../../../../docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md)
 * — so `apps/main` never sees these requests and cannot gate them. This application has to
 * read the session itself. The cookies are on the same hostname, so it can.
 *
 * ## Why a route-group layout rather than a check in each page
 *
 * Every page under `(staff)` renders inside this layout, so a page added later is gated by
 * being put here — it cannot forget to call anything. That is the same argument that moved the
 * axe wait inside `admin.spec.ts`'s helper: a check each caller has to remember is a check the
 * next caller does not.
 *
 * `app/health/route.ts` is a route handler outside the group and stays public on purpose —
 * `scripts/smoke.mjs` reads it daily against production, and Playwright waits on it before
 * running anything.
 *
 * ## What it reads, and what it deliberately does not do
 *
 * It **reads** the session and **never writes one**. `apps/main/worker/session.ts` mints,
 * refreshes and slides the idle window; this refuses anything it is not sure of:
 *
 *   * no access token → refused;
 *   * no readable `src_ax`, or one already past → refused — ADR-019's twelve-hour deadline,
 *     and the same "ended rather than given one" rule `apps/main` applies;
 *   * `identity.my_permissions()` failing, or answering with no `timing.*` permission →
 *     refused. Supabase validates the access token on that call, so an expired or forged one
 *     is refused there rather than here.
 *
 * ⚠️ **It never refreshes**, so it can never extend a session. A signed-in volunteer whose
 * access token has lapsed after thirty idle minutes is refused here and put right by opening
 * any page on the club's side, which refreshes it. That is a small cost on the safe side, and
 * it keeps the only code that writes a session cookie in one file.
 *
 * ## A 404, rendered through the layout
 *
 * `notFound()` rather than a bare response from middleware, so the refusal renders inside the
 * banner and footer like every other page. That is what keeps three things true at once: the
 * club's rule that a gated address answers 404 rather than disclosing itself with a 403; the
 * privacy notice being reachable from the footer of every page; and the smoke test's check
 * that this Worker's own stylesheet resolves under `/timing/_next/`.
 */

// Per request, never cached: the answer depends on who is asking.
export const dynamic = 'force-dynamic';

async function holdsATimingPermission(): Promise<boolean> {
  const jar = await cookies();

  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return false;
  }

  const deadline = parseSessionExpiry(jar.get(EXPIRY_COOKIE)?.value);
  if (deadline === null || deadline <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const { env } = getCloudflareContext();
  const asPerson = createUserClient(
    { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
    accessToken,
  );

  const { data, error } = await asPerson.rpc('my_permissions');
  if (error) {
    // A code and a message, never a row - the same discipline `apps/main/worker/admin.ts`
    // keeps, because a log line is somewhere a volunteer's data must not end up.
    console.error(
      `timing: permission read unavailable - ${error.code}: ${error.message}`,
    );
    return false;
  }

  // **Any** `timing.*` permission opens the door. Which parts of `/timing` a person may then
  // use is each page's own question, asked against the specific permission - ADR-017: code
  // checks the permission, never a role name.
  return (
    Array.isArray(data) &&
    data.some((p) => typeof p === 'string' && p.startsWith('timing.'))
  );
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  if (!(await holdsATimingPermission())) {
    notFound();
  }

  return children;
}
