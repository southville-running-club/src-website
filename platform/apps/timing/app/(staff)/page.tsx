/**
 * `/timing`, for the people allowed to see it.
 *
 * ## What changed
 *
 * This was a public holding page, linked from the club's front door and the navigation bar. It
 * is behind `(staff)/layout.tsx` now, so everybody else receives an ordinary 404 and the links
 * to it are gone — `/timing` is where race-day tools will live, and a runner has no use for a
 * page that exists only to say they are not ready.
 *
 * So this page is written for somebody holding a `timing.*` permission, and it tells them the
 * truth: they are in the right place, and the tools are being built here.
 *
 * ## What it still does not say
 *
 * No date, and no promise about when capture or results will work. The rewrite is gated on a
 * full manual race simulation —
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * — and a date written here before that passes is a claim this repository is not in a position
 * to make.
 */
export default function Page() {
  return (
    <>
      <h1>Race timing</h1>

      <p className="lede">
        You are signed in with access to the club&rsquo;s race-timing system.
      </p>

      <p>
        The race-day tools &mdash; importing an entry list, capturing runners at the line,
        and publishing results &mdash; are being built here. Nothing on this page records
        or changes anything yet.
      </p>

      <p>
        <a href="/">Southville Running Club</a>
      </p>
    </>
  );
}
