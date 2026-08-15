/**
 * The `/timing` holding page.
 *
 * ## What this used to be
 *
 * A status table. `<h1>Race timing</h1>`, then "this page exists to prove the path it will
 * move onto", then "What this page proves", then a `<dl>` of the database timestamp, a
 * pipeline-check marker, the runtime it was served by and the name of the workspace
 * directory. It did prove those things, and it was linked from the club's front door as
 * "live results and marshal screens".
 *
 * **Somebody following that link is a runner, not a maintainer.** The two round trips moved
 * to `/timing/health`, where the smoke test reads them, and this became a page that says the
 * one thing its visitor came to find out.
 *
 * ## What it does not say
 *
 * No date, and no promise that results will appear *here*. The port is gated on the race
 * simulation and the existing deployment stays live until that passes
 * ([ADR-008](docs/architecture/decisions/adr-008-timing-port-before-the-race.md)) — so "results
 * for this year's race will be on this page" is a claim this repository is not in a position
 * to make. Where to look on the day is the club's to announce when it knows.
 *
 * Static, unlike its predecessor: with no database call left on the rendering path there is
 * nothing here to render per request, and a holding page is the most cacheable thing a site
 * has.
 */
export default function Page() {
  return (
    <>
      <h1>Race timing</h1>

      <p className="lede">
        This is where Southville Running Club&rsquo;s race timing will live — live results
        while a race is running, and the finish times afterwards.
      </p>

      <p>
        <strong>It is not open yet.</strong> The club is moving its timing system onto
        this address, and there is nothing to see here until that is finished. Nothing you
        are looking for is missing; it has not arrived.
      </p>

      <p>
        The club will say where to find results for a particular race when that race is
        announced.
      </p>

      <footer>
        <p>
          <a href="/nn/">Nightingale Nightmare</a> — the club&rsquo;s Halloween trail
          race.
        </p>
        <p>
          <a href="/">Southville Running Club</a>
        </p>
      </footer>
    </>
  );
}
