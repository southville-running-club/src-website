import { describe, expect, it } from 'vitest';
import {
  isNnEntryCompletePath,
  isNnRacePath,
  isNnYearPath,
  isTimingPath,
  nnEntryCompletePath,
  nnEventSlugForYearPath,
  nnYearPathForEventSlug,
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
