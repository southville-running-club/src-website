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
    // so it is on the year page and not on the race page. The entry fee, the opening date and
    // the 2026 ARC permit number are not confirmed at all; inventing one of those is a "stop
    // and ask" trigger rather than a placeholder, which is why they are `null` in `race.json`
    // and render as "To be confirmed" instead.
    const year = await (await SELF.fetch(`${SITE}/nn/2026/`)).text();
    const race = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(year).toContain('Sunday 1 November 2026');
    expect(race).not.toContain('Sunday 1 November 2026');

    expect(year).not.toMatch(/£\s?\d/);
    expect(race).not.toMatch(/£\s?\d/);
  });

  it.each([
    // The race — evergreen, and none of these names a year.
    '/nn/course/',
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
