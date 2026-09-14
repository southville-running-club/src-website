import { NotFoundBody } from './not-found-body';

/**
 * The not-found page for everything under `/timing`, including every page a person may not
 * see.
 *
 * ⚠️ **The wording is `apps/main`'s, word for word** — *"There is nothing at this address."* —
 * because a refused `/timing` has to be indistinguishable from an address that does not exist.
 * A different sentence here would tell somebody probing the site that this one is a door, which
 * is the disclosure the club's 404-rather-than-403 rule exists to prevent. It is
 * {@link NotFoundBody} rather than two elements written out here, so the thirteen pages that
 * render the same answer cannot drift from it — one of them already had.
 *
 * ⚠️ **This page is the *prerendered* one, and that is what makes it a real 404.**
 * `middleware.ts` rewrites a refused request to an address matching no route, and Next serves
 * this with status 404 — server-rendered HTML, banner, footer and privacy link included. A
 * page that renders {@link NotFoundBody} itself is a **200**, deliberately and for a measured
 * reason: see ADR-044, linked from that component.
 *
 * Rendered inside the root layout, so the banner, the footer and the privacy notice link are
 * all still on it.
 */
export default function NotFound() {
  return <NotFoundBody />;
}
