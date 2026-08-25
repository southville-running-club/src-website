import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * `/admin/` to somebody who is not signed in — **which is what the internet is**, and the one
 * case nobody would think to give a run of its own.
 *
 * ## What this file used to be, and why it was kept rather than folded in
 *
 * It was `nn-admin-unconfigured.test.ts`, and its premise was that the admin surface is
 * switched on by a Worker secret nobody has installed on production: with no
 * `ENTRIES_ADMIN_KEY` bound, every address under `/nn/admin` declined, fell through to the
 * static-assets binding, and 404'd like one that was never built. **#58 removed the key**, so
 * that premise is gone — the way in is a Supabase session plus a staff role, and there is no
 * binding whose absence closes anything.
 *
 * The obvious move was to delete it and let `tests/worker/admin/admin.test.ts` cover the
 * signed-out case beside every other refusal, and that file does cover it. This one stays for
 * a reason that survived the rewrite: **it is the only run in which none of this exists.** The
 * admin run seeds three real accounts, one of them a super-admin, and its assertions are made
 * against a database that has been set up for them. This run has no fixture people, no staff
 * role anywhere, and no `globalSetup` that touches `identity` at all — which is the shape of a
 * database on the day the club deploys, and the shape somebody probing the site meets. A 404
 * proved there is worth more than the same 404 proved next to the accounts that would have
 * opened it.
 *
 * It also keeps the two stylesheet guards in a run that has nothing else invested in them.
 *
 * ## The redirects are not repeated here
 *
 * `/nn/admin/*` → `/admin/nn/*` is asserted in full — all eight addresses, 301 for a GET and
 * 308 for anything else — in `tests/worker/admin/admin.test.ts`, where the rest of the surface
 * is. One line of it is here only because it is the one thing under the old prefix that must
 * **not** answer 404, and this file is otherwise entirely about things that must.
 */

/** Every address the staff backend answers, and one nobody built. */
const ADDRESSES = [
  '/admin',
  '/admin/',
  '/admin/nn/',
  '/admin/nn/entries/',
  '/admin/nn/entries/nn-2026/',
  '/admin/nn/interest/',
  '/admin/people/',
  '/admin/nowhere/',
];

describe('with nobody signed in', () => {
  for (const address of ADDRESSES) {
    it(`answers ${address} exactly as an address nobody published`, async () => {
      const response = await SELF.fetch(`https://example.com${address}`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(404);

      const body = (await response.text()).replace(/\s+/g, ' ');

      // **404 rather than 403, and it is a decision.** A 403 discloses that the address
      // exists, which tells anybody who can register exactly where the club's entry list
      // lives and that it is worth attacking.
      expect(body).toContain('There is nothing at this address');
      // No sign-in form and no key box, so nothing says there is a door here at all.
      expect(body.toLowerCase()).not.toContain('admin key');
      expect(body.toLowerCase()).not.toContain('password');
      // And nothing is handed out on the way past.
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  }

  it('tells an address that exists apart from one that does not in no way', async () => {
    // Byte for byte. `/admin/people/` is a page and `/admin/nowhere/` is not, and a stranger
    // must not be able to learn which is which by asking.
    const built = await SELF.fetch('https://example.com/admin/people/', {
      redirect: 'manual',
    });
    const invented = await SELF.fetch('https://example.com/admin/nowhere/', {
      redirect: 'manual',
    });

    expect(built.status).toBe(invented.status);
    expect(await built.text()).toBe(await invented.text());
  });

  it('refuses the POST actions the same way, and builds no page', async () => {
    for (const address of [
      '/admin/nn/medical/',
      '/admin/nn/start-list/',
      '/admin/nn/export/',
      '/admin/people/',
    ]) {
      const response = await SELF.fetch(`https://example.com${address}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          entrantId: '00000000-0000-4000-8000-000000000000',
          action: 'grant',
          role: 'super-admin',
        }),
        redirect: 'manual',
      });

      expect(response.status, address).toBe(404);
      expect(response.headers.get('set-cookie'), address).toBeNull();
    }
  });

  it('still redirects the address the runbook names, rather than 404ing it', async () => {
    // The one thing under the old prefix that must not answer like the rest of this file. The
    // full redirect matrix is in `tests/worker/admin/admin.test.ts`.
    const response = await SELF.fetch('https://example.com/nn/admin/', {
      redirect: 'manual',
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/admin/nn/');
  });

  it('serves both stylesheets, which are files rather than parts of the surface', async () => {
    // `/nn/admin.css` and `/admin.css` are emitted into `dist/` by `src/pages/nn/admin.css.ts`
    // and `src/pages/admin.css.ts`. Neither is behind anything and neither may be: they hold
    // no data, and both route predicates are written so the Worker never answers them —
    // `/admin` and `/nn/admin` match exactly, or with a `/` after them, and never as the
    // prefix of a longer segment. A 404 here would mean a predicate had started matching a
    // stylesheet, and every admin page would render unstyled with nothing saying why.
    for (const address of ['/nn/admin.css', '/admin.css']) {
      const response = await SELF.fetch(`https://example.com${address}`);

      expect(response.status, address).toBe(200);
      expect(response.headers.get('content-type'), address).toContain('text/css');
    }
  });
});
