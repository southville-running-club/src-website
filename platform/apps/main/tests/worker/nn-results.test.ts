import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * `/nn/<year>/results/` to somebody who is not signed in — **which is what the internet is.**
 *
 * A Nightingale Nightmare result is published by an explicit act after the race is finished —
 * #241 and ADR-042 — and **until that act the page is locked behind `nn.results.read` and
 * answers 404 to everybody else**, which is what every assertion here is about. ⚠️ **A
 * published race is not a case this file can reach, and that is now about the fixtures rather
 * than about the code**: since #242 a signed-out visitor is no longer refused before anything
 * is read, and this run has no `timing` rows at all — so `results_for_event()` answers `null`
 * for every address below, which is exactly the shape of the database somebody probing the
 * site meets. The published branch, cache headers and all, is in
 * `tests/worker/admin/nn-results.test.ts`, whose setup writes the rows with `pg`.
 *
 * This run is the right place to prove the locked half, for the reason
 * `admin-signed-out.test.ts` gives about itself: it
 * has no fixture people, no role granted anywhere and no `globalSetup` that touches
 * `identity` at all, which is the shape of the database somebody probing the site meets.
 *
 * ⚠️ **A 404 on its own proves almost nothing here, and that is the point of the page.** The
 * refusal is meant to be indistinguishable from an address that does not exist, so "it
 * answered 404" is equally true of a route that was never wired up — a test asserting only
 * the status would pass just as happily if `handleNnResults` were deleted. What separates
 * them is *who* answered: the Worker's own refusal links `/nn/results.css`, and the static
 * 404 from the assets binding does not. Same trick `scripts/smoke.mjs` uses to prove the
 * timing Worker rather than the club's side answered `/timing`.
 */
describe("one running's results, signed out", () => {
  const ADDRESSES = ['/nn/2026/results/', '/nn/2026/results', '/nn/2027/results/'];

  for (const address of ADDRESSES) {
    it(`answers 404 at ${address}, from the Worker rather than the assets binding`, async () => {
      const response = await SELF.fetch(`https://example.com${address}`);

      expect(response.status, address).toBe(404);

      const body = await response.text();
      // It was this page that refused, not a missing file.
      expect(body, address).toContain('/nn/results.css');
      // `admin-shell.ts`'s wording, word for word, so the two surfaces say the same sentence.
      expect(body, address).toContain('There is nothing at this address.');
      // And nothing about the race leaked into the refusal.
      expect(body, address).not.toContain('results-table');
    });
  }

  it('refuses a nonsense session exactly as it refuses none', async () => {
    // A cookie that is present and unreadable must not take a different path from no cookie
    // at all — the page reads a session and never mints one, so every uncertain case is the
    // same refusal.
    const response = await SELF.fetch('https://example.com/nn/2026/results/', {
      headers: { cookie: 'src_at=not-a-token; src_ax=not-a-number' },
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('There is nothing at this address.');
  });

  it('carries no link to the results, on either page that would paint one', async () => {
    // ⚠️ **A link to a 404 is a claim about a record** — #242. Nothing is published here, so
    // both anchors must still be hidden with the empty `href` they shipped with. The panel's
    // own copy of this lives in `nn-panel.test.ts`; this is the year page's.
    const response = await SELF.fetch('https://example.com/nn/2026/');
    const markup = (await response.text()).replace(/\s+/g, ' ');

    expect(markup).toMatch(/data-nn-results-link[^>]*hidden/);
    expect(markup).not.toContain('href="/nn/2026/results/"');
  });

  it('is not cached, and not indexed', async () => {
    // Rendered per viewer behind a permission: a shared cache holding it would hand one
    // volunteer's page to the next person, and a crawler indexing the address would publish
    // the fact that it exists.
    const response = await SELF.fetch('https://example.com/nn/2026/results/');

    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('leaves /nn/results.css alone, which is a real file in dist/', async () => {
    // **One character between a stylesheet and a 404**, the same guard `/nn/admin.css` and
    // `/account.css` each carry. If the predicate treated `/nn/` as a prefix the Worker would
    // answer this itself and every results page would render unstyled.
    const response = await SELF.fetch('https://example.com/nn/results.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });
});
