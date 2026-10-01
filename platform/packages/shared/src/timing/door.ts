/**
 * Whether somebody may open `/timing/` at all — the one question both sides of the hostname ask.
 *
 * ## Why this is shared rather than written twice
 *
 * `apps/timing/lib/access.ts` answers it at the door: the landing page's rule is _"any `timing.*`
 * permission"_. `apps/main` answers it when it decides whether to draw a link to that page — on
 * `/account/` for anybody holding a timing role, since #235 took the public link down. **A link
 * and the door behind it have to agree**, which is `admin-shell.ts`'s own rule for its
 * navigation: a link to a page that 404s tells somebody the page exists and refuses them, which
 * is the disclosure the 404 exists to avoid. Two copies of a one-line predicate are two answers
 * to one question, and the day they disagree is the day a marshal taps a link into a 404 — or,
 * the other way round, is never shown the way in to a page they may open.
 *
 * So both apps import this, and neither spells `'timing.'` itself.
 *
 * ## Why a prefix rather than a list
 *
 * The door asks for a prefix, and a list here would be a second place a new `timing.*`
 * permission had to be written down — which is exactly how the two sides would drift. The
 * prefix includes the trailing dot on purpose: a permission that merely _starts_ with the word
 * would not be a timing permission, and `nn.results.read` is the reminder that the namespace is
 * the part before the first dot, not a substring anywhere in the slug.
 */
export const TIMING_PERMISSION_PREFIX = 'timing.';

/** Whether any of these permissions opens `/timing/`. */
export function holdsAnyTimingPermission(permissions: readonly string[]): boolean {
  return permissions.some((slug) => slug.startsWith(TIMING_PERMISSION_PREFIX));
}
