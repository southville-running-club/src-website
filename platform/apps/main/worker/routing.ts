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

/**
 * ## The year layer, and the one convention it rests on
 *
 * A **race** is the recurring thing; an **event** is one running of it in one year. The paths
 * say so:
 *
 *   /nn/            the race — evergreen, and it never names a year
 *   /nn/2026/       one running of it, and everything that is only true of that running
 *
 * **`/nn/<year>/` is the running whose event slug is `nn-<year>`**, and that convention is
 * the whole of the coupling between a URL and a database row. It is stated in one place —
 * `nnEventSlugForYearPath` and `nnYearPathForEventSlug`, which are inverses and are tested
 * as such — so nothing else in this Worker has to know it, and **nothing anywhere has to know
 * that this year is 2026**. Publishing 2027 is a row in `entries.events` and that year's own
 * content pages; no line here changes.
 *
 * The alternative was a lookup table in code mapping years to slugs, which is the same
 * coupling written down twice and left to drift. This way a `/nn/2027/` page with no matching
 * event row resolves to a slug that does not exist, `entry_state()` answers null, and the page
 * says entries are not open — which is the correct thing for a year somebody has published a
 * page for and not yet configured.
 */

/** Where the timing platform lives, on every hostname. */
export const TIMING_PREFIX = '/timing';

/** Where Nightingale Nightmare lives. */
export const NN_PREFIX = '/nn';

/** The recurring race, as `entries.events.race_slug` spells it. */
export const NN_RACE_SLUG = 'nn';

/**
 * `/nn/2026/` and `/nn/2026` — the page for one running, and nothing beneath it.
 *
 * Four digits exactly. `/nn/course/` and `/nn/privacy/` are evergreen pages that must never be
 * mistaken for a running, and `/nn/20261/` is not a year.
 */
const NN_YEAR_PATH = /^\/nn\/(\d{4})\/?$/;

/**
 * The event slug for a year path, or `null` if this is not one.
 *
 * **Both spellings, for the reason `isNnSignupPath` takes both**: the entry form posts to this
 * address, and a submission arriving at the other one must not be 404'd on its way in when the
 * person filled the form in either way.
 */
export function nnEventSlugForYearPath(pathname: string): string | null {
  const year = NN_YEAR_PATH.exec(pathname)?.[1];
  return year === undefined ? null : `${NN_RACE_SLUG}-${year}`;
}

/** True when this request is the page for one running of the race. */
export function isNnYearPath(pathname: string): boolean {
  return nnEventSlugForYearPath(pathname) !== null;
}

/**
 * The inverse: where the page for an event slug lives.
 *
 * `null` for a slug that is not a running of this race — which is what the Worker gets if
 * `entries.events` ever holds a running named some other way, and is why the caller has to
 * decide what to do rather than being handed a plausible path.
 */
export function nnYearPathForEventSlug(slug: string): string | null {
  const year = new RegExp(`^${NN_RACE_SLUG}-(\\d{4})$`).exec(slug)?.[1];
  return year === undefined ? null : `${NN_PREFIX}/${year}/`;
}

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
 * The Nightingale Nightmare pages that carry the navigation bar, and therefore the ones whose
 * year-bearing links the Worker has to paint.
 *
 * **Everything under `/nn` except two.** The webhook is not a page at all, and the return page
 * carries the wordmark without the links — somebody who has just paid should not be offered
 * four ways to wander off before reading what the club has recorded.
 *
 * Deliberately a path predicate rather than a list of the six pages that exist. A seventh page
 * added under `/nn/` gets the bar because it renders the masthead, and a predicate that had to
 * be edited to match would be the second place that fact was written down.
 */
export function isNnMastheadPath(pathname: string): boolean {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;

  if (!path.startsWith(`${NN_PREFIX}/`)) {
    return false;
  }

  return !isNnWebhookPath(pathname) && !isNnEntryCompletePath(pathname);
}

/**
 * Where the sign-up form posts — the race's own page, and it stays there.
 *
 * **`/nn` and `/nn/` are the same answer here, and that is deliberate.** Astro is
 * configured `trailingSlash: 'always'`, so the page itself only ever has one address — but
 * a form posting to the other one must not 404 the submission on its way in. Accepting
 * both costs nothing and the redirect afterwards is always to the canonical `/nn/`.
 *
 * **The interest form did not move with the year layer**, and that is the point of where it
 * sits: registering interest is a thing somebody does about *the race*, not about one running
 * of it, and the answer they get is an email whenever the next one opens. The **entry** form
 * is the one that belongs to a year, and it moved to `/nn/<year>/`.
 *
 * Nothing else beneath `/nn/` becomes a sign-up. `/nn/privacy/` is a page, not an endpoint,
 * and a POST to it should 404 exactly as it does today. The paths below are endpoints in
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
 * Where Stripe sends somebody back to afterwards — **under the running they entered**.
 *
 * A real page in `dist/`, unlike the webhook above — this predicate only decides whether the
 * Worker paints the recorded state onto it on the way past.
 *
 * **It moved below the year with everything else about one running**, and the reason is not
 * tidiness. A return page is where somebody who has just paid finds out whether the club knows
 * it, months later as well as minutes later; keeping it under the year means the 2027 page can
 * say something different from the 2026 one without either of them moving, and it means a
 * Checkout session's return URL names the thing it was for.
 */
const NN_ENTRY_COMPLETE_PATH = /^\/nn\/(\d{4})\/entry\/complete\/?$/;

export function isNnEntryCompletePath(pathname: string): boolean {
  return NN_ENTRY_COMPLETE_PATH.test(pathname);
}

/** Where the return page for one running lives. `/nn/2026/` → `/nn/2026/entry/complete/`. */
export function nnEntryCompletePath(yearPath: string): string {
  return `${yearPath}entry/complete/`;
}
