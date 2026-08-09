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

  it('states no facts about the race', async () => {
    // The date, price and distance are unconfirmed, and inventing one is a "stop and ask"
    // trigger rather than a placeholder.
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).not.toMatch(/£\s?\d/);
    expect(page).not.toMatch(/\b(October|November)\s+\d{1,2}\b/);
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
