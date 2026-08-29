import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * The Worker, in the real runtime, against the real build output.
 *
 * `tests/unit/routing.test.ts` proves the dispatch decision. This proves the Worker and
 * the static-assets binding actually combine to serve the site — the part that would still
 * be broken if `run_worker_first` were left off, with the unit tests entirely green.
 *
 * `/timing` is not exercised here: in this configuration it is forwarded to a second
 * Worker that is not running, and in production Cloudflare routes it away before this
 * Worker sees it. It is covered end to end by the E2E and smoke suites, where both
 * Workers are up.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

describe('the club website', () => {
  it('serves the holding page at the root', async () => {
    const response = await SELF.fetch(`${SITE}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toContain('Southville Running Club');
  });

  it('carries the banner, on the built output rather than in a browser', async () => {
    // The banner is in the layout, so every page gets it — including `/nn/`, and this is
    // the only layer that reads what the static-assets binding actually returns.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).toContain('Welcome to Southville Running Club');
    expect(page).toContain('href="https://southvillerunningclub.co.uk"');
  });

  it('serves the brand page, noindex like everything else', async () => {
    // Not linked from anywhere a visitor would find it — this only proves the route builds
    // and that its own `noindex` was not accidentally dropped, the way a page-specific
    // `<meta>` sometimes is.
    const response = await SELF.fetch(`${SITE}/brand/`);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain('name="robots" content="noindex"');
  });

  it('links to both of the things that already exist', async () => {
    const page = await (await SELF.fetch(`${SITE}/`)).text();

    expect(page).toContain('href="/nn/"');
    expect(page).toContain('href="/timing"');
  });

  it('serves the privacy notice, and reaches it from the footer of an ordinary page', async () => {
    // **The layer that proves the notice is actually reachable**, rather than that a
    // component renders a link: `privacy.spec.ts` drives a browser, and this reads what the
    // static-assets binding returns for the built page and for the footer that points at it.
    // A notice nobody can find is not a notice.
    const response = await SELF.fetch(`${SITE}/privacy/`);
    const notice = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    // It is the club's notice, so it says what it does not cover and points there.
    expect(notice).toContain('href="/nn/privacy/"');

    const home = await (await SELF.fetch(`${SITE}/`)).text();
    expect(home).toContain('href="/privacy/"');
  });
});

describe('Nightingale Nightmare', () => {
  it('is served at /nn/', async () => {
    const response = await SELF.fetch(`${SITE}/nn/`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('Nightingale Nightmare');
  });

  it('is the only address it has', async () => {
    // No subdomain, and no second path. At the Squarespace cutover the hostname changes
    // and this page does not move.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).toContain(
      'rel="canonical" href="https://new.southvillerunningclub.co.uk/nn/"',
    );
  });

  it('states the confirmed date on the running it belongs to, and not on the race', async () => {
    // The date is confirmed — Sunday 1 November 2026 — and it is a fact about **one running**,
    // so it is on the year page and not on the race page. The entry fee is `null` in
    // `race.json` for a different reason: it is the database's, and the Worker paints it on.
    // Inventing either here is a "stop and ask" trigger rather than a placeholder.
    //
    // **The price assertion is now year-page-only, and that is a rule that changed rather than
    // one that lapsed.** It used to forbid `£` on both pages while entries were shut. The
    // committee settled the fee on 24 August 2026, so the year page states it as a race fact —
    // see `nn-entry.test.ts`, which asserts the other half: the fee *cards* on the form stay
    // hidden and unpainted, because they are the control that takes money.
    //
    // **`/nn/` still quotes no price, and that half is untouched.** It is the evergreen page
    // and names no year; a fee belongs to one running, exactly as the date and the permit do.
    const year = await (await SELF.fetch(`${SITE}/nn/2026/`)).text();
    const race = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(year).toContain('Sunday 1 November 2026');
    expect(race).not.toContain('Sunday 1 November 2026');

    // Dearest first — `entry_state()` orders `by fee.price_pence desc`.
    expect(year).toContain('£20.00 unaffiliated · £18.00 affiliated');
    expect(race).not.toMatch(/£\s?\d/);
  });

  it('carries the ARC permit number into the built year page, and not into the race', async () => {
    // **The same rule the date follows, applied to the permit** — a permit is issued for one
    // running, so `ARC/26/0842` belongs on `/nn/2026/` and must not reach the evergreen page.
    // ADR-011.
    //
    // **This is the build-output half of the guard.** `site.spec.ts` asserts what a browser
    // renders and `nn-entry.spec.ts` asserts the form's copy is visible; this asserts the
    // number survives the Astro build into `dist/` at all. It is the cheapest of the three and
    // it fails first, which is what makes it worth having as well rather than instead.
    const year = await (await SELF.fetch(`${SITE}/nn/2026/`)).text();
    const race = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(year).toContain('ARC/26/0842');
    expect(race).not.toContain('ARC/26/0842');
  });

  it.each([
    // The race — evergreen, and it names no year. `/nn/` itself is asserted above, and
    // `/nn/course/` is no longer a page at all: the course and terrain are on `/nn/`, and
    // that address is a redirect now. See the block below, which is where it is asserted.
    '/nn/privacy/',
    // One running of it, and everything only true of that running.
    '/nn/2026/',
    '/nn/2026/race-day/',
    '/nn/2026/spectators/',
    '/nn/2026/entry/complete/',
  ])('serves %s from the same build', async (path) => {
    const response = await SELF.fetch(`${SITE}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it.each([
    // **The addresses these three pages used to have, and nothing answers at them.** Nothing
    // was ever published there — every page carries `noindex` and the only links were
    // internal — so no redirect was added, deliberately: a redirect map is a thing somebody
    // has to maintain and later remember to delete. A 404 is the honest answer for an
    // address that never had a reader.
    '/nn/race-day/',
    '/nn/spectators/',
    '/nn/entry/complete/',
  ])('404s %s, the address it used to have', async (path) => {
    const response = await SELF.fetch(`${SITE}${path}`);

    expect(response.status).toBe(404);
  });

  /**
   * `/nn/course/`, which is nothing but a redirect now.
   *
   * **The opposite case to the three 404s above, and what separates them is whether anybody
   * ever had the address.** Those three were never published. This one was: it was in the
   * navigation bar, linked from `/nn/`, and printed on things the club does not control. So it
   * keeps resolving, and it resolves to `/nn/` — which carries this page's copy **in full**
   * rather than a summary of it. The club supplied the whole of it as the wording `/nn/` should
   * say, so every section the old address answered is answered at the new one, in the same
   * words: where it goes, what it is like underfoot, and what is on the route.
   *
   * **Every request here passes `redirect: 'manual'`, and that is the whole reason this block
   * is worth anything.** `SELF.fetch` follows a redirect by default, so without it the response
   * under test is `/nn/`'s own 200: every assertion below would be about the destination, the
   * status assertions would fail loudly enough to be "fixed" to 200, and what remained would be
   * a block named after an address it had stopped visiting. That is the vacuous-guard shape
   * `CLAUDE.md` records, arriving through a redirect rather than through a bad matcher.
   *
   * **301 for a GET and a HEAD, 308 for anything else.** Nothing has ever posted to this
   * address, so on its own the 308 is theoretical — but `movedPermanently()` is shared with the
   * `/nn/admin/*` redirect, where three of the addresses do carry a body, and an edit made for
   * one of them lands on both. Asserting both statuses here is what makes that sharing safe.
   */
  describe('the address the course page used to live at', () => {
    // Both spellings, and here that is not the usual "somebody typed it either way". With
    // `dist/nn/course/index.html` gone, the 307 the assets binding used to give the unslashed
    // form is gone with it, so the Worker has to claim both or `/nn/course` 404s.
    const spellings = ['/nn/course/', '/nn/course'];

    for (const from of spellings) {
      it(`sends a GET of ${from} to /nn/, permanently`, async () => {
        const response = await SELF.fetch(`${SITE}${from}`, { redirect: 'manual' });

        expect(response.status, from).toBe(301);
        // `/nn/` and never `/nn` — `trailingSlash` is `'always'`, so the short form would
        // cost a second hop off the assets binding on the way.
        expect(response.headers.get('location'), from).toBe('/nn/');
        // A redirect for an address the club has retired is exactly the thing that should not
        // be pinned in an intermediary for a year.
        expect(response.headers.get('cache-control'), from).toBe('no-store');
        // The old address has no business competing with `/nn/` in a search result.
        expect(response.headers.get('x-robots-tag'), from).toBe('noindex, nofollow');
      });

      it(`treats a HEAD of ${from} as the GET it is`, async () => {
        // A HEAD is a GET without the body, so it takes the GET's 301. Getting this wrong is
        // invisible until a link checker reports the address broken.
        const response = await SELF.fetch(`${SITE}${from}`, {
          method: 'HEAD',
          redirect: 'manual',
        });

        expect(response.status, from).toBe(301);
        expect(response.headers.get('location'), from).toBe('/nn/');
      });

      it(`sends a POST of ${from} on without letting it become a GET`, async () => {
        // 308 rather than 301: a 301 permits a client to rewrite the method and drop the body,
        // and 301 does not promise otherwise.
        const response = await SELF.fetch(`${SITE}${from}`, {
          method: 'POST',
          redirect: 'manual',
        });

        expect(response.status, from).toBe(308);
        expect(response.headers.get('location'), from).toBe('/nn/');
      });
    }

    it('keeps the query string, so a poster campaign still arrives tagged', async () => {
      const response = await SELF.fetch(`${SITE}/nn/course/?from=poster`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/nn/?from=poster');
    });

    it('sends people to a page that answers what the old address answered', async () => {
      // **The half a status code cannot prove.** A redirect to an address that 404s, or to one
      // that no longer says anything about the course, is a redirect that has lost the reader
      // just as thoroughly as a 404 would have. Followed by hand rather than by letting the
      // runtime follow it, so the two hops stay separately visible.
      const redirected = await SELF.fetch(`${SITE}/nn/course/`, { redirect: 'manual' });
      const location = redirected.headers.get('location');
      // Asserted before it is used: a missing header would otherwise be fetched as the string
      // "null", and the assets binding's 404 for that would read as the destination failing.
      expect(location, 'the redirect named no destination').toBe('/nn/');

      const destination = await SELF.fetch(`${SITE}${location!}`);

      expect(destination.status).toBe(200);
      await expect(destination.text()).resolves.toContain('The course and terrain');
    });

    it('is exactly those two addresses and not a prefix', async () => {
      // `/nn/course-records/` is a page the club could legitimately want one day, and a
      // `startsWith` in `isNnCoursePath` would swallow it — silently, because a 301 to `/nn/`
      // looks like a working link. Nothing is built there, so the honest answer is the assets
      // binding's 404, and `redirect: 'manual'` is what makes a redirect visible instead of
      // followed.
      const response = await SELF.fetch(`${SITE}/nn/course-records/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  it("keeps the event theme off the club's own pages", async () => {
    // **The theme is imported by the pages that use it, never from `Base.astro`.** That is
    // what stops 94 kB of horror webfonts reaching the holding page and the 404 — and it is
    // the sort of thing a later "tidy up the imports" would undo without any page looking
    // wrong. The navigation is scoped the same way, and for the same reason.
    for (const path of ['/', '/404.html']) {
      const page = await (await SELF.fetch(`${SITE}${path}`)).text();

      expect(page).not.toContain('nn-theme');
      expect(page).not.toContain('theme-nn');
      expect(page).not.toContain('nn-nav');
    }
  });
});

describe('what does not exist', () => {
  it.each(['/membership/', '/results/', '/newsletter/2026-01/'])(
    '404s %s',
    async (path) => {
      const response = await SELF.fetch(`${SITE}${path}`);

      expect(response.status).toBe(404);
    },
  );
});

describe('the health endpoint', () => {
  // Whether it *reached* the database is a separate matter — the local stack may not be up
  // in every environment — so these assert the endpoint's contract, not the verdict. The
  // verdict is the smoke test's, against a real deploy.

  it('answers JSON, and never caches it', async () => {
    const response = await SELF.fetch(`${SITE}/_health`);

    expect(response.headers.get('content-type')).toContain('application/json');
    // A cached answer to "can you reach the database" is not an answer.
    expect(response.headers.get('cache-control')).toBe('no-store');
    // An endpoint, not a page. It has no business in a search result.
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('reports both round trips, and agrees with its own status code', async () => {
    const response = await SELF.fetch(`${SITE}/_health`);
    const report = (await response.json()) as {
      ok: boolean;
      database: { ok: boolean };
      pipeline: { ok: boolean };
    };

    expect(report).toHaveProperty('database.ok');
    expect(report).toHaveProperty('pipeline.ok');

    // **`ok` is the one field a monitor need read, so it has to mean what it says.** Both
    // halves, and the status code with it — a health endpoint answering 200 while its body
    // says `ok: false` is the shape that lets an outage sit behind a green tick.
    expect(report.ok).toBe(report.database.ok && report.pipeline.ok);
    expect(response.status).toBe(report.ok ? 200 : 503);
  });

  it('reports a failure rather than throwing one', async () => {
    // Whatever state the database is in, this endpoint answers. A 500 here would tell a
    // monitor that the check broke rather than that the thing being checked did.
    const response = await SELF.fetch(`${SITE}/_health`);

    expect([200, 503]).toContain(response.status);
  });

  it('is one address, and /_health/ is not a page', async () => {
    // Every other predicate in `worker/routing.ts` takes both spellings, because a human
    // typed those into a form action or a Stripe dashboard. Nothing types this one.
    const response = await SELF.fetch(`${SITE}/_health/`);

    expect(response.status).toBe(404);
  });

  it('is not something the assets binding will answer for a POST', async () => {
    const response = await SELF.fetch(`${SITE}/_health`, { method: 'POST' });

    expect(response.status).not.toBe(200);
  });

  it('leaves /health free for a page about running and health', async () => {
    // **The reason for the underscore, asserted rather than left as a comment.**
    //
    // This is a running club. `/health/` is a plausible content page — training, injury,
    // wellbeing — and at the old spelling the Worker answered `/health` before the assets
    // binding while a page served at `/health/`. Both worked, one character apart, and
    // somebody typing "health" got a database report. Nothing errored and nothing failed CI.
    //
    // Nothing is there today, so this asserts the endpoint has let go of the name: whatever
    // `/health` answers, it must not be this endpoint's JSON.
    const response = await SELF.fetch(`${SITE}/health`);

    expect(response.headers.get('content-type') ?? '').not.toContain('application/json');
  });
});

describe('the pages a runner sees', () => {
  // **The diagnostics came off `/nn/` deliberately, and this is what keeps them off.**
  //
  // The block said "What this page proves" and listed the database time, a pipeline-check
  // marker, the runtime and the workspace directory — directly below the form somebody hands
  // over £17 and an emergency contact on. The round trips still run; they answer at `/_health`
  // now. The failure this guards against is somebody re-adding a marker to a page because it
  // was convenient, which is how it got there the first time.
  it.each(['/nn/', '/nn/2026/', '/nn/2026/entry/complete/', '/'])(
    '%s says nothing about databases, runtimes or workspaces',
    async (path) => {
      const page = await (await SELF.fetch(`${SITE}${path}`)).text();

      expect(page).not.toContain('What this page proves');
      expect(page).not.toContain('data-health');
      expect(page).not.toContain('data-pipeline-check');
      expect(page).not.toContain('pipeline-ok');
      expect(page).not.toContain('Not fetched — the Worker did not run.');
    },
  );
});
