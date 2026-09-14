/**
 * The two elements every "nothing here" answer under `/timing` renders — the one wording,
 * in one place.
 *
 * ## Why this is a component and not thirteen copies of two lines
 *
 * ⚠️ **A refusal has to be indistinguishable from an address that does not exist**, which is
 * the club's 404-rather-than-403 rule applied to a body rather than to a status. Thirteen
 * pages each wrote these two elements out, every one of them carrying a comment saying *"word
 * for word `app/not-found.tsx`"* — and by the time
 * [#291](https://github.com/southville-running-club/src-website/issues/291) counted them, one
 * of the thirteen was not: `app/marshal/<slug>/page.tsx` said *"There is no race at this
 * address."* against everybody else's *"There is nothing at this address."*. It was
 * unreachable — the door refuses a marshal's missing race before the page renders — and it was
 * still a sentence that told somebody which of the two answers they had hit. A comment asking
 * every future page to copy a string correctly is not a mechanism; this is.
 *
 * ## ⚠️ Why it is rendered inline rather than thrown
 *
 * `notFound()` during a **dynamic** render — and reading cookies makes every render here
 * dynamic — returns an empty `<html id="__next_error__">` shell with the page only in the
 * streamed RSC payload: no `<h1>`, no banner, no footer, and a blank page with JavaScript off,
 * which is a whole Playwright project here.
 * [#243](https://github.com/southville-running-club/src-website/issues/243) measured that and
 * `middleware.ts`'s header records it. So a page that has nothing to show renders this, and
 * the response it renders into is a **200**.
 *
 * ⚠️ **That 200 is a decision and not an accident** —
 * [ADR-044](../../../../docs/architecture/decisions/adr-044-a-missing-race-under-timing-answers-200.md).
 * The other not-found answer under `/timing`, a refusal at the door, is a **404**: the
 * middleware rewrites to an address matching no route and Next serves its *prerendered*
 * not-found page. The two statuses differ; the two bodies may not, and this component is what
 * holds that. Ten Playwright tests assert both halves.
 */
export function NotFoundBody() {
  return (
    <>
      <h1>Not found</h1>
      <p>There is nothing at this address.</p>
    </>
  );
}
