import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * `/nn/admin` when no key is bound — **which is the deployed state, and the one nobody would
 * think to test.**
 *
 * The admin surface is switched on by a Worker secret that nobody has installed on production
 * and nobody may install from this repository. Until they do, the correct behaviour is not "an
 * error page", not "a sign-in form nobody can use" and certainly not "an empty list": it is that
 * the address behaves exactly as one that was never built. `handleNnAdmin` returns `null`, the
 * request continues to the static-assets binding, and the binding 404s.
 *
 * That is what makes an admin surface whose key is not installed **indistinguishable from an
 * absent one** to anybody probing for it, and it is asserted here rather than inferred from the
 * other four runs not having bound the key.
 *
 * The absence is pinned in this config's `miniflare.bindings` rather than left to chance,
 * because the pool silently loads `apps/main/.dev.vars` and a laptop with a key in it would
 * otherwise fail this run while CI passed.
 */

const ADDRESSES = [
  '/nn/admin',
  '/nn/admin/',
  '/nn/admin/entries/',
  '/nn/admin/entries/nn-2026/',
  '/nn/admin/interest/',
  '/nn/admin/accounts/',
];

describe('with no ENTRIES_ADMIN_KEY bound', () => {
  for (const address of ADDRESSES) {
    it(`answers ${address} exactly as an address nobody published`, async () => {
      const response = await SELF.fetch(`https://example.com${address}`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(404);

      const body = await response.text();
      // No sign-in form, so nothing says there is a door here at all.
      expect(body).not.toContain('Your admin key');
      expect(body).not.toContain('admin key');
    });
  }

  it('refuses the two POST actions the same way', async () => {
    for (const address of ['/nn/admin/', '/nn/admin/medical/', '/nn/admin/export/']) {
      const response = await SELF.fetch(`https://example.com${address}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: 'anything', entrantId: 'anything' }),
        redirect: 'manual',
      });

      // 405 from the assets binding for a POST to an address it knows, 404 for one it does not.
      // Either is "nothing here"; what matters is that no page is built and no cookie is set.
      expect([404, 405], address).toContain(response.status);
      expect(response.headers.get('set-cookie'), address).toBeNull();
    }
  });

  it('still serves the stylesheet, which is a file rather than part of the surface', async () => {
    // `/nn/admin.css` is emitted by `src/pages/nn/admin.css.ts` into `dist/`. It is not behind
    // the key and must not be — it holds no data, and the route predicate is written so the
    // Worker never answers it. A 404 here would mean the predicate had started matching it.
    const response = await SELF.fetch('https://example.com/nn/admin.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });
});
