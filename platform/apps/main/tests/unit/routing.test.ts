import { describe, expect, it } from 'vitest';
import { isTimingPath, NN_PREFIX, TIMING_PREFIX } from '../../worker/routing';

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

describe('the paths the club has committed to', () => {
  it('keeps them as paths rather than hostnames', () => {
    // Written down because the whole arrangement rests on it: at the Squarespace cutover
    // the hostname changes and these do not, so nothing that already works has to move.
    expect(NN_PREFIX).toBe('/nn');
    expect(TIMING_PREFIX).toBe('/timing');
  });
});
