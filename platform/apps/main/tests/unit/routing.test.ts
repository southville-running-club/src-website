import { describe, expect, it } from 'vitest';
import {
  isNnSignupPath,
  isTimingPath,
  NN_PREFIX,
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

describe('where the sign-up form may post', () => {
  it.each(['/nn', '/nn/'])('accepts %s', (pathname) => {
    // Both, deliberately. Astro insists on the trailing slash for the page, but a form
    // posting to the other address must not have its submission 404'd on the way in — the
    // person filled it in either way.
    expect(isNnSignupPath(pathname)).toBe(true);
  });

  it.each([
    '/',
    // A page, not an endpoint. A POST here should 404 exactly as it does today rather
    // than quietly become a sign-up.
    '/nn/privacy/',
    '/nn/signup/',
    // The near-misses, for the same reason `isTimingPath` has them: these are addresses a
    // future page could legitimately want, and this predicate must not swallow them.
    '/nnn/',
    '/nn-2026/',
    '/timing',
  ])('refuses %s', (pathname) => {
    expect(isNnSignupPath(pathname)).toBe(false);
  });

  it('never claims a path the timing Worker claims', () => {
    // Both predicates run against the same request, so an overlap would be a request two
    // handlers both believe is theirs.
    for (const pathname of ['/nn', '/nn/', '/timing', '/timing/live']) {
      expect(isNnSignupPath(pathname) && isTimingPath(pathname)).toBe(false);
    }
  });
});

describe('the paths the club has committed to', () => {
  it('keeps them as paths rather than hostnames', () => {
    // Written down because the whole arrangement rests on it: at the Squarespace cutover
    // the hostname changes and these do not, so nothing that already works has to move.
    expect(NN_PREFIX).toBe('/nn');
    expect(TIMING_PREFIX).toBe('/timing');
  });
});
