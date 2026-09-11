/**
 * The names of the session cookies, and the one piece of reading both front doors need.
 *
 * ## Why this is shared
 *
 * `apps/main` mints and refreshes the session — `worker/session.ts` owns all of that, and still
 * does. `apps/timing` now has to *read* the same session, because `/timing` is staff-only and
 * Cloudflare dispatches `/timing/*` to the timing Worker at the edge, so `apps/main` never sees
 * those requests and cannot gate them for it.
 *
 * ⚠️ **These names are the contract between two Workers**, and that is the argument for having
 * one copy. If `apps/main` renamed `src_at` and `apps/timing` kept its own string, every staff
 * member would be refused `/timing` with nothing anywhere saying why — a 404 is exactly what a
 * wrong cookie name looks like. One definition makes that rename a compile-time event.
 *
 * Nothing else about the session moved. Minting, refreshing, the idle window and the
 * cross-check against the authentication time GoTrue signs into the token all stay in
 * `apps/main/worker/session.ts`, which is the only place that writes a session cookie.
 */

/** The access token. */
export const ACCESS_COOKIE = 'src_at';

/** The refresh token. Only `apps/main` ever reads it, because only `apps/main` refreshes. */
export const REFRESH_COOKIE = 'src_rt';

/** The absolute deadline, in epoch seconds — ADR-019's twelve hours, minted at sign-in. */
export const EXPIRY_COOKIE = 'src_ax';

/**
 * The `src_ax` cookie as a number, or `null` for anything that is not a run of digits.
 *
 * `null` is the safe answer and both callers treat it as "no session": `apps/main` ends a
 * session arriving without a readable deadline rather than granting it one, and `apps/timing`
 * refuses the page.
 *
 * Accepts `undefined` as well as `null`, because Next's cookie store answers `undefined` for a
 * cookie that is not there and a Worker's header parse answers `null`.
 */
export function parseSessionExpiry(raw: string | null | undefined): number | null {
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
}
