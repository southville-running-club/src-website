import { describe, expect, it } from 'vitest';
import {
  accountSegments,
  adminPathForNnAdminPath,
  adminSegments,
  isAccountPath,
  isAdminPath,
  isNnAdminPath,
  isNnEntryCompletePath,
  isNnRacePath,
  isNnYearPath,
  isTimingPath,
  nnAdminSegments,
  nnEntryCompletePath,
  nnEventSlugForYearPath,
  nnYearPathForEventSlug,
  ACCOUNT_PREFIX,
  NN_ADMIN_PREFIX,
  NN_PREFIX,
  NN_RACE_SLUG,
  TIMING_PREFIX,
} from '../../worker/routing';

/**
 * One hostname, three paths. The only decision this Worker makes is whether a request
 * belongs to the timing Worker instead.
 *
 * In production Cloudflare answers that at the edge, because a route carrying a path beats
 * a Custom Domain on the same hostname. This function is the local stand-in for that
 * dispatch — so it has to agree with the route pattern `new.<apex>/timing/*` exactly.
 */

describe('what belongs to the timing Worker', () => {
  it.each(['/timing', '/timing/', '/timing/live/nn-2026', '/timing/_next/static/x.css'])(
    'claims %s',
    (pathname) => {
      expect(isTimingPath(pathname)).toBe(true);
    },
  );

  it.each([
    '/',
    '/nn/',
    '/membership/',
    // The near-misses, and they matter: these are addresses a future website page could
    // legitimately want, and the route pattern must not swallow them.
    '/timings/',
    '/timing-results/',
    '/about/timing/',
  ])('leaves %s to the website', (pathname) => {
    expect(isTimingPath(pathname)).toBe(false);
  });
});

describe('the race page, which no form posts to any more', () => {
  it.each(['/nn', '/nn/'])('is recognised at %s', (pathname) => {
    // Both, deliberately. Astro insists on the trailing slash for the page, but a request for
    // the other spelling should still get the painted panel rather than an empty one.
    expect(isNnRacePath(pathname)).toBe(true);
  });

  it.each([
    '/',
    // A page, not an endpoint. A POST here should 404 exactly as it does today rather
    // than quietly become a sign-up.
    '/nn/privacy/',
    '/nn/signup/',
    // **Both forms' address.** They are on the running now — interest and entry, one shown at
    // a time — and the hidden `form` field is what tells them apart. This predicate is only
    // about which page gets the panel painted onto it.
    '/nn/2026/',
    '/nn/2026',
    // The near-misses, for the same reason `isTimingPath` has them: these are addresses a
    // future page could legitimately want, and this predicate must not swallow them.
    '/nnn/',
    '/nn-2026/',
    '/timing',
  ])('is not %s', (pathname) => {
    expect(isNnRacePath(pathname)).toBe(false);
  });

  it('never claims a path the timing Worker claims', () => {
    // Both predicates run against the same request, so an overlap would be a request two
    // handlers both believe is theirs.
    for (const pathname of ['/nn', '/nn/', '/timing', '/timing/live']) {
      expect(isNnRacePath(pathname) && isTimingPath(pathname)).toBe(false);
    }
  });
});

describe('where one running of the race lives', () => {
  // **This is the whole of the coupling between a URL and a database row**, and it is here
  // rather than anywhere else so that nothing has to know it twice. `/nn/<year>/` is the
  // event `nn-<year>`; publishing 2027 is a row plus that year's content pages and no line
  // of this Worker changes.

  it.each(['/nn/2026/', '/nn/2026', '/nn/2027/', '/nn/1999/'])(
    'claims %s',
    (pathname) => {
      expect(isNnYearPath(pathname)).toBe(true);
    },
  );

  it.each([
    '/nn/',
    '/nn',
    // The evergreen pages, and the reason the pattern is four digits rather than "anything".
    '/nn/course/',
    '/nn/privacy/',
    // Below a running rather than the running itself — these are content pages the Worker
    // does nothing to, and a POST to one must 404 rather than be read as an entry.
    '/nn/2026/race-day/',
    '/nn/2026/spectators/',
    '/nn/2026/entry/complete/',
    // Not years.
    '/nn/20261/',
    '/nn/202/',
    '/nn/twenty26/',
    '/timing',
  ])('refuses %s', (pathname) => {
    expect(isNnYearPath(pathname)).toBe(false);
  });

  it('resolves a year path to the event slug for that running', () => {
    expect(nnEventSlugForYearPath('/nn/2026/')).toBe('nn-2026');
    expect(nnEventSlugForYearPath('/nn/2026')).toBe('nn-2026');
    expect(nnEventSlugForYearPath('/nn/course/')).toBeNull();
  });

  it('round-trips a slug back to the page it belongs to', () => {
    // **Inverses, asserted as such.** Two functions each holding half of one convention is
    // exactly where a convention drifts, and the symptom would be a Stripe return URL that
    // 404s — discovered by somebody who had just paid.
    for (const year of ['2026', '2027', '2030']) {
      const path = `/nn/${year}/`;
      expect(nnYearPathForEventSlug(nnEventSlugForYearPath(path)!)).toBe(path);
    }
  });

  it('refuses to invent a page for a slug that is not a running of this race', () => {
    // The caller has to decide what to do rather than be handed a plausible path. A running
    // named some other way has no page, and linking to a guess is a 404 on the front door.
    expect(nnYearPathForEventSlug('nn-two-thousand')).toBeNull();
    expect(nnYearPathForEventSlug('ptb-2026')).toBeNull();
    expect(nnYearPathForEventSlug('nn-2026-b')).toBeNull();
  });
});

describe('where Stripe sends somebody back to', () => {
  it.each([
    '/nn/2026/entry/complete/',
    '/nn/2026/entry/complete',
    '/nn/2027/entry/complete/',
  ])('claims %s', (pathname) => {
    expect(isNnEntryCompletePath(pathname)).toBe(true);
  });

  it.each([
    // **The old address, and it is nobody's now.** It was `/nn/entry/complete/` before the
    // year layer; nothing was ever published there, and a predicate that still answered for
    // it would be a second live address for one page.
    '/nn/entry/complete/',
    '/nn/2026/entry/',
    '/nn/2026/',
    '/nn/complete/',
  ])('refuses %s', (pathname) => {
    expect(isNnEntryCompletePath(pathname)).toBe(false);
  });

  it('builds the return path from the year page it belongs to', () => {
    expect(nnEntryCompletePath('/nn/2026/')).toBe('/nn/2026/entry/complete/');
    expect(isNnEntryCompletePath(nnEntryCompletePath('/nn/2026/'))).toBe(true);
  });
});

describe('the paths the club has committed to', () => {
  it('keeps them as paths rather than hostnames', () => {
    // Written down because the whole arrangement rests on it: at the Squarespace cutover
    // the hostname changes and these do not, so nothing that already works has to move.
    expect(NN_PREFIX).toBe('/nn');
    expect(TIMING_PREFIX).toBe('/timing');
  });

  it('spells the race the same way the events table does', () => {
    // `entries.events.race_slug` is `nn` for every running of this race, and the path prefix
    // is `/nn`. They agree, and this is the line that says the agreement is deliberate.
    expect(NN_RACE_SLUG).toBe('nn');
    expect(`/${NN_RACE_SLUG}`).toBe(NN_PREFIX);
  });
});

describe('the admin surface, and the one character that decides where it starts', () => {
  it('matches the prefix itself and everything beneath it', () => {
    expect(isNnAdminPath('/nn/admin')).toBe(true);
    expect(isNnAdminPath('/nn/admin/')).toBe(true);
    expect(isNnAdminPath('/nn/admin/entries/')).toBe(true);
    expect(isNnAdminPath('/nn/admin/entries/nn-2026/')).toBe(true);
  });

  it('does not match the stylesheet that sits beside it', () => {
    // **The character that matters.** `/nn/admin.css` is a real file in `dist/`, emitted by
    // `src/pages/nn/admin.css.ts` from the shared stylesheets. If this predicate treated
    // `/nn/admin` as a plain prefix, the Worker would answer the stylesheet request itself —
    // with a sign-in page or a 404 — and every admin page would render unstyled, with nothing
    // failing anywhere to say why.
    expect(isNnAdminPath('/nn/admin.css')).toBe(false);
  });

  it('does not match another page that happens to start with the same letters', () => {
    expect(isNnAdminPath('/nn/administration/')).toBe(false);
    expect(isNnAdminPath('/nn/admin-guide/')).toBe(false);
  });

  it('does not match the pages a runner reads', () => {
    expect(isNnAdminPath('/nn/')).toBe(false);
    expect(isNnAdminPath('/nn/2026/')).toBe(false);
    expect(isNnAdminPath('/nn/privacy/')).toBe(false);
    expect(isNnAdminPath('/admin/')).toBe(false);
  });

  it('reads the two spellings of the front door as the same address', () => {
    // `trailingSlash` is `'always'` for pages and somebody typing this into a bar will type
    // it either way. Both are the index, which is `[]`.
    expect(nnAdminSegments('/nn/admin')).toEqual([]);
    expect(nnAdminSegments('/nn/admin/')).toEqual([]);
  });

  it('splits what comes after the prefix', () => {
    expect(nnAdminSegments('/nn/admin/entries/')).toEqual(['entries']);
    expect(nnAdminSegments('/nn/admin/entries/nn-2026/')).toEqual(['entries', 'nn-2026']);
    expect(nnAdminSegments('/nn/admin/export/')).toEqual(['export']);
  });

  it('keeps the prefix under the race rather than at the root', () => {
    // Under `/nn` with everything else, so the Squarespace cutover moves the hostname and
    // not this — the same property ADR-007 buys for every other address here.
    expect(NN_ADMIN_PREFIX).toBe('/nn/admin');
    expect(NN_ADMIN_PREFIX.startsWith(NN_PREFIX)).toBe(true);
  });
});

describe('the account area, and the same character that decides where it starts', () => {
  it('matches the prefix itself and everything beneath it', () => {
    expect(isAccountPath('/account')).toBe(true);
    expect(isAccountPath('/account/')).toBe(true);
    expect(isAccountPath('/account/sign-up/')).toBe(true);
    expect(isAccountPath('/account/sign-in/')).toBe(true);
    expect(isAccountPath('/account/sign-out/')).toBe(true);
    expect(isAccountPath('/account/confirm/')).toBe(true);
  });

  it('does not match the stylesheet that sits beside it', () => {
    // The same trap `isNnAdminPath` documents for `/nn/admin.css`: `/account.css` is a real
    // file in `dist/`, emitted by `src/pages/account.css.ts`. Treating `/account` as a plain
    // prefix would mean the Worker answers this request itself and every account page
    // renders unstyled.
    expect(isAccountPath('/account.css')).toBe(false);
  });

  it('does not match another page that happens to start with the same letters', () => {
    expect(isAccountPath('/accounts/')).toBe(false);
    expect(isAccountPath('/accountability/')).toBe(false);
  });

  it('does not match the pages a runner reads', () => {
    expect(isAccountPath('/nn/')).toBe(false);
    expect(isAccountPath('/nn/admin/')).toBe(false);
    expect(isAccountPath('/')).toBe(false);
  });

  it('segments the same way nnAdminSegments does', () => {
    expect(accountSegments(ACCOUNT_PREFIX)).toEqual([]);
    expect(accountSegments(`${ACCOUNT_PREFIX}/`)).toEqual([]);
    expect(accountSegments(`${ACCOUNT_PREFIX}/sign-up/`)).toEqual(['sign-up']);
  });
});

// -----------------------------------------------------------------------------------------
// The staff backend, and the addresses that moved to it
// -----------------------------------------------------------------------------------------

describe('isAdminPath', () => {
  it('matches the prefix itself and everything beneath it', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/nn/')).toBe(true);
    expect(isAdminPath('/admin/nn/entries/nn-2026/')).toBe(true);
    expect(isAdminPath('/admin/people/')).toBe(true);
  });

  it('does not swallow /admin.css, which is a real file in dist/', () => {
    // **One character between a stylesheet and a 404**, and the same trap `/nn/admin.css` and
    // `/account.css` both carry. The Worker answers this whole prefix before the assets
    // binding, so a predicate that matched `/admin` as a *prefix of a longer segment* would
    // take the request away from the binding and the admin surface would render unstyled.
    expect(isAdminPath('/admin.css')).toBe(false);
    expect(isAdminPath('/administration/')).toBe(false);
    expect(isAdminPath('/admins/')).toBe(false);
  });

  it('leaves the rest of the site alone', () => {
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/nn/')).toBe(false);
    expect(isAdminPath('/nn/admin/')).toBe(false);
    expect(isAdminPath('/account/')).toBe(false);
  });
});

describe('adminSegments', () => {
  it('treats the prefix with and without its slash as the same address', () => {
    expect(adminSegments('/admin')).toEqual([]);
    expect(adminSegments('/admin/')).toEqual([]);
  });

  it('drops the empty segments, so a trailing slash never becomes one', () => {
    expect(adminSegments('/admin/nn/')).toEqual(['nn']);
    expect(adminSegments('/admin/nn/entries/nn-2026/')).toEqual([
      'nn',
      'entries',
      'nn-2026',
    ]);
    expect(adminSegments('/admin/people/')).toEqual(['people']);
  });
});

describe('adminPathForNnAdminPath', () => {
  // **The addresses in the runbook**, which is the reason this function exists: they are
  // published, and a runbook that 404s is worse than one that is out of date.
  it.each([
    ['/nn/admin/', '/admin/nn/'],
    ['/nn/admin', '/admin/nn'],
    ['/nn/admin/entries/nn-2026/', '/admin/nn/entries/nn-2026/'],
    ['/nn/admin/interest/', '/admin/nn/interest/'],
    ['/nn/admin/medical/', '/admin/nn/medical/'],
    ['/nn/admin/start-list/', '/admin/nn/start-list/'],
    ['/nn/admin/export/', '/admin/nn/export/'],
  ])('moves %s to %s', (from, to) => {
    expect(adminPathForNnAdminPath(from)).toBe(to);
  });

  it('moves an address nobody published, because it is a rewrite and not a table', () => {
    // A table of seven would have to be kept in step with the routes it names, and the entry
    // nobody remembered to add is the one somebody is reading at nine on race morning.
    expect(adminPathForNnAdminPath('/nn/admin/something/nobody/built/')).toBe(
      '/admin/nn/something/nobody/built/',
    );
  });

  it('lands every one of them inside the new prefix', () => {
    // The property rather than the examples: whatever went in, what comes out is an address
    // the staff backend actually owns. A rewrite that produced something outside the prefix
    // would redirect a runbook address into the assets binding.
    const moved = [
      '/nn/admin',
      '/nn/admin/',
      '/nn/admin/interest/',
      '/nn/admin/entries/nn-2026/',
    ].map(adminPathForNnAdminPath);

    expect(moved.every((path) => isAdminPath(path))).toBe(true);
    expect(moved.every((path) => adminSegments(path)[0] === 'nn')).toBe(true);
  });
});
