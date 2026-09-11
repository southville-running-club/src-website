/**
 * The not-found page for everything under `/timing`, including every page a person may not
 * see.
 *
 * ⚠️ **The wording is `apps/main`'s, word for word** — *"There is nothing at this address."* —
 * because a refused `/timing` has to be indistinguishable from an address that does not exist.
 * A different sentence here would tell somebody probing the site that this one is a door, which
 * is the disclosure the club's 404-rather-than-403 rule exists to prevent.
 *
 * Rendered inside the root layout, so the banner, the footer and the privacy notice link are
 * all still on it.
 */
export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>There is nothing at this address.</p>
    </>
  );
}
