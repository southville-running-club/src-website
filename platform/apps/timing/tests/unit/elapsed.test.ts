import { describe, expect, it } from 'vitest';
import { formatDuration } from '../../lib/elapsed';
import { londonOffsetMinutes } from '@src/shared';

/**
 * The countdown and the elapsed clock, as strings — #250.
 *
 * ⚠️ **The clocks-change assertion at the foot of this file is the one that matters.** The
 * race is run on 1 November 2026, the weekend *after* the clocks go back on 25 October, and
 * this repository's standing foot-gun is an hour of drift. A **duration** is immune to it by
 * construction — it is UTC-millisecond arithmetic — and the point of asserting it is that
 * somebody "fixing" this module to be zone-aware would go red rather than quietly wrong.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('a length of time, rendered', () => {
  it.each([
    [0, '00:00:00'],
    [SECOND, '00:00:01'],
    [59 * SECOND, '00:00:59'],
    [MINUTE, '00:01:00'],
    [4 * MINUTE + 12 * SECOND, '00:04:12'],
    [59 * MINUTE + 59 * SECOND, '00:59:59'],
    [HOUR, '01:00:00'],
    [2 * HOUR + 3 * MINUTE + 4 * SECOND, '02:03:04'],
  ])('renders %d ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  /**
   * **Always three fields, even when there are no hours in it.** The clock ticks once a second
   * beside text; a string that gains a field as it crosses an hour changes width mid-race.
   */
  it('always carries an hours field, so the string does not change shape at 01:00:00', () => {
    expect(formatDuration(59 * MINUTE + 59 * SECOND)).toHaveLength(8);
    expect(formatDuration(HOUR)).toHaveLength(8);
  });

  it('grows a days field rather than an hours count in the hundreds', () => {
    expect(formatDuration(DAY)).toBe('1d 00:00:00');
    expect(formatDuration(3 * DAY + 7 * HOUR + 6 * MINUTE + 5 * SECOND)).toBe(
      '3d 07:06:05',
    );
  });

  /**
   * Truncated, not rounded. A clock that showed `00:00:01` while 1.9 seconds had passed would
   * be right; one that showed `00:00:02` would be claiming a second that has not happened.
   */
  it('truncates a part-second rather than rounding it up', () => {
    expect(formatDuration(1999)).toBe('00:00:01');
  });

  /**
   * ⚠️ **Negatives clamp rather than render a sign.** `-00:04:12` does not say whether the
   * start is coming or gone; the caller says that in words beside the clock, so this function
   * deliberately renders only a magnitude.
   */
  it('clamps a negative length to zero rather than rendering a sign', () => {
    expect(formatDuration(-1)).toBe('00:00:00');
    expect(formatDuration(-5 * MINUTE)).toBe('00:00:00');
  });

  it('renders something rather than NaN when handed one', () => {
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00:00');
  });
});

/**
 * ⚠️ **The clocks-change case, which is the one this platform is actually run across.**
 *
 * 25 October 2026 at 02:00 BST is 01:00 UTC, and London goes from `+01:00` to `+00:00`. An
 * hour of wall-clock 01:xx therefore happens twice. A duration spanning that hour is **one
 * hour of real time**, not two and not zero, because it is the difference between two instants
 * — and it is what a race started at 01:30 BST and still running at 01:30 GMT would show.
 */
describe('across the morning the clocks go back', () => {
  const BEFORE = Date.parse('2026-10-25T00:30:00Z');
  const AFTER = Date.parse('2026-10-25T01:30:00Z');

  it('is the fixture it claims to be: London really does change offset between the two', () => {
    // Without this the test below would pass on two instants in the same offset, which is a
    // test that has stopped testing. `london-time.ts` exports this for exactly that reason.
    expect(londonOffsetMinutes(BEFORE)).toBe(60);
    expect(londonOffsetMinutes(AFTER)).toBe(0);
  });

  it('renders one hour, not two and not none, across the repeated hour', () => {
    expect(formatDuration(AFTER - BEFORE)).toBe('01:00:00');
  });

  /**
   * And the race-day case itself: 1 November 2026, a start at 11:00 GMT and a runner home
   * fifty-two minutes later. One offset either side, and the answer is the plain one — which
   * is what makes the assertion above about the boundary rather than about arithmetic.
   */
  it('renders a race-day split from the start that was actually used', () => {
    const gun = Date.parse('2026-11-01T11:02:00Z');
    const home = Date.parse('2026-11-01T11:54:37Z');

    expect(formatDuration(home - gun)).toBe('00:52:37');
  });
});
