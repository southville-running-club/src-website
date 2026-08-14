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

/**
 * Where the sign-up form posts.
 *
 * **`/nn` and `/nn/` are the same answer here, and that is deliberate.** Astro is
 * configured `trailingSlash: 'always'`, so the page itself only ever has one address — but
 * a form posting to the other one must not 404 the submission on its way in. Accepting
 * both costs nothing and the redirect afterwards is always to the canonical `/nn/`.
 *
 * Nothing else beneath `/nn/` becomes a sign-up. `/nn/privacy/` is a page, not an endpoint,
 * and a POST to it should 404 exactly as it does today. The two paths below are endpoints in
 * their own right and are matched by their own predicates, before this one is consulted.
 */
export function isNnSignupPath(pathname: string): boolean {
  return pathname === NN_PREFIX || pathname === `${NN_PREFIX}/`;
}

/**
 * Where Stripe posts a confirmed payment.
 *
 * **Not a page, and it must never become one.** There is nothing in `dist/` at this address:
 * it exists only as a POST handled before `env.ASSETS.fetch`, and a GET to it falls through to
 * the assets binding and 404s, which is the right answer to somebody who typed it.
 *
 * Both spellings, for the same reason `isNnSignupPath` takes both — except that here the
 * caller is Stripe, configured once by hand against a URL somebody typed into a dashboard.
 * **A trailing slash mistyped there would mean every payment confirmation posting into a
 * 404**, discovered only by a runner who paid and heard nothing. Accepting both costs one
 * comparison.
 */
export const NN_WEBHOOK_PATH = `${NN_PREFIX}/stripe-webhook`;

export function isNnWebhookPath(pathname: string): boolean {
  return pathname === NN_WEBHOOK_PATH || pathname === `${NN_WEBHOOK_PATH}/`;
}

/**
 * Where Stripe sends somebody back to afterwards.
 *
 * A real page in `dist/`, unlike the webhook above — this predicate only decides whether the
 * Worker paints the recorded state onto it on the way past.
 */
export const NN_ENTRY_COMPLETE_PATH = `${NN_PREFIX}/entry/complete/`;

export function isNnEntryCompletePath(pathname: string): boolean {
  return (
    pathname === NN_ENTRY_COMPLETE_PATH ||
    pathname === NN_ENTRY_COMPLETE_PATH.slice(0, -1)
  );
}
