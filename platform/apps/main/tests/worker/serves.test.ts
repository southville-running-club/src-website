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
    await expect(response.text()).resolves.toContain('A new Southville Running Club');
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

  it('states the confirmed date, and none of what is still open', async () => {
    // The date is confirmed — Sunday 1 November 2026 — and the entry fee, the opening date
    // and the 2026 ARC permit number are not. Inventing one of those is a "stop and ask"
    // trigger rather than a placeholder, which is why they are `null` in `race.json` and
    // render as "To be confirmed" instead.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).toContain('Sunday 1 November 2026');
    expect(page).not.toMatch(/£\s?\d/);
  });

  it.each(['/nn/course/', '/nn/race-day/', '/nn/spectators/'])(
    'serves %s from the same build',
    async (path) => {
      const response = await SELF.fetch(`${SITE}${path}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    },
  );

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

describe('the health placeholder', () => {
  it('is rewritten by the Worker rather than left as the built-in text', async () => {
    // Proves the HTMLRewriter ran. Whether it reached the database is a separate matter —
    // the local stack may not be up in every environment — so this asserts the handler
    // replaced the content, not what it replaced it with.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).not.toContain('Not fetched — the Worker did not run.');
    expect(page).toMatch(/data-health="(ok|error)"/);
  });
});

describe('the pipeline-check placeholder', () => {
  it('is rewritten by the same Worker, via a second HTMLRewriter handler', async () => {
    // intake.ping() proves a migration added after health() reaches this page the same
    // way — a second handler on a second selector, not a special case of the first.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).toMatch(/data-pipeline-check="(ok|error)"/);
  });
});
