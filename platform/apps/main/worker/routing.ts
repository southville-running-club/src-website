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
 * **Both spellings, and it matters here**: both of this page's forms post to this address, and
 * a submission arriving at the other spelling must not be 404'd on its way in when the person
 * filled the form in either way.
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
 * The machine-readable health report — **not a page, and it must never become one.**
 *
 * The two database round trips it reports used to be rendered into a "What this page proves"
 * block on `/nn/`, which put a build-in-progress diagnostic on the page somebody pays on.
 * They are worth running and worth watching; they are not worth showing to a runner. So they
 * moved here, where `scripts/smoke.mjs` reads them.
 *
 * **The underscore is the whole point, and `/health` was wrong for this club specifically.**
 *
 * An Astro page at `src/pages/health.astro` would serve at `/health/` — `trailingSlash` is
 * `'always'` — while this Worker keeps answering `/health`, because it matches before the
 * assets binding. Both would work, at addresses one character apart, and somebody typing
 * "health" would get a database report. Nothing errors, nothing fails CI, and the person who
 * added the page has no way to find out.
 *
 * That is not a hypothetical here. **This is a running club**, and training, injury and
 * wellbeing are exactly the pages `/health/` is for. A leading underscore cannot be an Astro
 * route, so the collision stops being unlikely and becomes impossible.
 *
 * **`apps/timing` cannot use this spelling**, and answers at `/timing/health` instead: a
 * leading underscore makes an App Router folder *private*, so `app/_health/route.ts` would
 * build, deploy, and 404. Two names is the honest cost of two frameworks. Both are named in
 * `scripts/smoke.mjs` and in `apps/main/README.md`, and CLAUDE.md carries the trap.
 *
 * **No trailing-slash variant, unlike every other predicate in this file.** The two above
 * accept both spellings because a human typed them into a form's `action` or a Stripe
 * dashboard once, and a mistyped slash there is a silent failure discovered by somebody who
 * paid. Nothing types this. One spelling, and `/_health/` 404s like any other address that is
 * not a page.
 */
export const HEALTH_PATH = '/_health';

export function isHealthPath(pathname: string): boolean {
  return pathname === HEALTH_PATH;
}

/**
 * Where the sign-up form posts.
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
 * The race's own page — evergreen, and the only thing the Worker does to it is paint.
 *
 * **`/nn` and `/nn/` are the same answer here**, because `trailingSlash: 'always'` gives the
 * page one address and a request for the other should still get the painted version rather
 * than a page with an empty panel on it.
 *
 * **No form posts here any more.** The interest form was on this page and moved to the running
 * it is an interest in — interest in what, the race in general or this year's? — so a POST to
 * `/nn/` now falls past every predicate to the assets binding, which answers **405**: the page
 * exists and the method does not apply to it. That is the same answer `/nn/privacy/` has always
 * given, and a better one than the 404 a missing page would get.
 */
export function isNnRacePath(pathname: string): boolean {
  return pathname === NN_PREFIX || pathname === `${NN_PREFIX}/`;
}

/**
 * Where Stripe posts a confirmed payment.
 *
 * **Not a page, and it must never become one.** There is nothing in `dist/` at this address:
 * it exists only as a POST handled before `env.ASSETS.fetch`, and a GET to it falls through to
 * the assets binding and 404s, which is the right answer to somebody who typed it.
 *
 * Both spellings, for the same reason `nnEventSlugForYearPath` takes both — except that here the
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

/**
 * Where the admin surface used to live — **now nothing but redirects**.
 *
 * #58 moved the whole surface to `/admin/nn/`, because the club's back office had become one
 * page about one race and there was nowhere to put anything else. Every address here is in a
 * published runbook, and **a runbook that 404s is worse than one that is out of date**, so all
 * of them keep resolving: `301` for a GET, `308` for a POST so the method and the body survive.
 *
 * **`/nn/admin.css` is deliberately not beneath this.** It is a real file in `dist/`, emitted by
 * `src/pages/nn/admin.css.ts` from the shared stylesheets, and it must reach the assets binding
 * like any other asset. That is why this matches `/nn/admin` exactly or `/nn/admin/` and beneath,
 * and never `/nn/admin` as a prefix of a longer segment — the difference between the two is one
 * character and a stylesheet that 404s.
 */
export const NN_ADMIN_PREFIX = `${NN_PREFIX}/admin`;

export function isNnAdminPath(pathname: string): boolean {
  return pathname === NN_ADMIN_PREFIX || pathname.startsWith(`${NN_ADMIN_PREFIX}/`);
}

/**
 * The staff backend. `/admin/`, and everything the club runs from it.
 *
 * **A different surface from `/nn/admin` rather than a rename of it.** That prefix was one race's
 * entries; this one is the club's back office, with Nightingale Nightmare as its first section
 * rather than its whole extent — see #58.
 *
 * **`/admin.css` is deliberately not beneath this**, the same trap `isNnAdminPath` and
 * `isAccountPath` both document: it is a real file in `dist/`, emitted by
 * `src/pages/admin.css.ts`, and it must reach the assets binding. So this matches `/admin`
 * exactly or `/admin/` and below, and never `/admin` as a prefix of a longer segment —
 * `/admin.css` and a hypothetical `/administration/` both fall through untouched.
 * `tests/unit/routing.test.ts` pins the boundary.
 */
export const ADMIN_PREFIX = '/admin';

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}

/** The same segment split `nnAdminSegments` does, for the same reason. `/admin/` and `/admin`
 *  are both `[]`; `/admin/nn/entries/nn-2026/` is `['nn', 'entries', 'nn-2026']`. */
export function adminSegments(pathname: string): string[] {
  return pathname.slice(ADMIN_PREFIX.length).split('/').filter(Boolean);
}

/**
 * Where a `/nn/admin/...` address moved to.
 *
 * **A prefix rewrite rather than a table of seven**, and that is the point: a table would have
 * to be kept in step with the routes it names, and the one address nobody remembered to add is
 * the one in the runbook somebody is reading at nine on race morning. Everything beneath the old
 * prefix maps, including addresses that were never published.
 *
 * Inverse-ish of nothing — `/admin/nn/` is where the surface lives now, and this is a one-way
 * door. `/nn/admin.css` is not beneath the prefix (see `isNnAdminPath`) and never reaches here.
 */
export function adminPathForNnAdminPath(pathname: string): string {
  return `${ADMIN_PREFIX}${NN_PREFIX}${pathname.slice(NN_ADMIN_PREFIX.length)}`;
}

/**
 * What comes after the prefix, as a list of segments with the empty ones dropped.
 *
 * `/nn/admin/` and `/nn/admin` are both `[]` — the same address, because `trailingSlash` is
 * `'always'` for pages and a person typing this one into a bar will type it either way.
 * `/nn/admin/entries/nn-2026/` is `['entries', 'nn-2026']`.
 */
export function nnAdminSegments(pathname: string): string[] {
  return pathname.slice(NN_ADMIN_PREFIX.length).split('/').filter(Boolean);
}

/**
 * The account area — `/account/`, `/account/sign-up/`, `/account/sign-in/`,
 * `/account/sign-out/` and `/account/confirm/`. Built in the Worker exactly as `/nn/admin`
 * is, for the same reason: the pages are built from a variable, per-request answer
 * (`is anybody signed in`) rather than shipped as static HTML.
 *
 * **`/account.css` is deliberately not beneath this**, the same trap `isNnAdminPath`
 * documents for `/nn/admin.css`: it is a real file in `dist/`, emitted by
 * `src/pages/account.css.ts`, and it must reach the assets binding. This matches
 * `/account` exactly or `/account/` and below, never as a prefix of a longer segment — so
 * `/account.css` and a hypothetical `/accounts/` both fall through untouched.
 * `tests/unit/routing.test.ts` pins the boundary.
 */
export const ACCOUNT_PREFIX = '/account';

export function isAccountPath(pathname: string): boolean {
  return pathname === ACCOUNT_PREFIX || pathname.startsWith(`${ACCOUNT_PREFIX}/`);
}

/** The same segment split `nnAdminSegments` does, for the same reason. `/account/` and
 *  `/account` are both `[]`; `/account/sign-up/` is `['sign-up']`. */
export function accountSegments(pathname: string): string[] {
  return pathname.slice(ACCOUNT_PREFIX.length).split('/').filter(Boolean);
}
