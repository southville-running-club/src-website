/**
 * The one routing decision this Worker still makes.
 *
 * ## The shape it serves
 *
 * Everything the club owns sits on **one hostname**, `new.southvillerunningclub.co.uk`,
 * and is told apart by path:
 *
 *   /          the club website          apps/main   (this Worker)
 *   /nn        Nightingale Nightmare     apps/main   (this Worker)
 *   /timing    the race-timing platform  apps/timing (a different Worker)
 *
 * At the Squarespace cutover the hostname changes and nothing else does — `<apex>/nn`
 * and `<apex>/timing` are the same paths on a different name. That is the point of the
 * arrangement: **the new site can be built up around NN and timing without either of them
 * moving.**
 *
 * ## Why `/timing` is not this Worker's problem in production
 *
 * Cloudflare routes are matched most-specific-first, and a route with a path beats a
 * Custom Domain on the same hostname. So `new.<apex>/timing/*` is dispatched to the timing
 * Worker at the edge and **never reaches this code**.
 *
 * Locally there is no edge to do that, so this module does the same dispatch itself —
 * which is why `TIMING_ORIGIN` is set in local configuration and absent in production. It
 * is a stand-in for Cloudflare's router, not a difference in behaviour.
 *
 * See docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md
 */

/** Where the timing platform lives, on every hostname. */
export const TIMING_PREFIX = '/timing';

/** Where Nightingale Nightmare lives. */
export const NN_PREFIX = '/nn';

/**
 * True when this request belongs to the timing Worker rather than to this one.
 *
 * Matches `/timing` and anything beneath it, and nothing else — `/timings` and
 * `/timing-results` are this Worker's, which is the behaviour a future website page would
 * want.
 */
export function isTimingPath(pathname: string): boolean {
  return pathname === TIMING_PREFIX || pathname.startsWith(`${TIMING_PREFIX}/`);
}
