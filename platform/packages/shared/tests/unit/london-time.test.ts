import { describe, expect, it } from 'vitest';
import {
  formatLondon,
  formatLondonDate,
  formatLondonTime,
  isBritishSummerTime,
  londonOffsetMinutes,
  toUtcIso,
} from '../../src/london-time';

/**
 * The suite runs with `TZ=UTC` pinned (see vitest.config.ts), as the timing app's does.
 * That pinning is what makes these assertions mean anything: without it a bug that reads
 * the ambient zone passes on a machine set to London and fails on a CI runner set to UTC,
 * which is the least useful possible failure.
 */

// British Summer Time ends at 02:00 BST on Sunday 25 October 2026, when clocks go back to
// 01:00 GMT. Expressed in UTC, that instant is 01:00Z.
const BST_ENDS_UTC = '2026-10-25T01:00:00Z';

describe('the clocks change — 25 October 2026', () => {
  it('is still BST one minute before the change', () => {
    const justBefore = '2026-10-25T00:59:00Z';
    expect(londonOffsetMinutes(justBefore)).toBe(60);
    expect(isBritishSummerTime(justBefore)).toBe(true);
    // 00:59 UTC is 01:59 London while the clocks are still forward.
    expect(formatLondonTime(justBefore)).toBe('01:59');
  });

  it('is GMT one minute after the change', () => {
    const justAfter = '2026-10-25T01:01:00Z';
    expect(londonOffsetMinutes(justAfter)).toBe(0);
    expect(isBritishSummerTime(justAfter)).toBe(false);
    // 01:01 UTC is 01:01 London once the clocks have gone back — the hour repeats.
    expect(formatLondonTime(justAfter)).toBe('01:01');
  });

  it('renders the repeated hour as two different instants', () => {
    // The whole hazard in one assertion: 00:30Z and 01:30Z are an hour apart, and both
    // render as 01:30 London. Any code that reasons about local time alone loses that
    // hour, which is why UTC is what gets stored.
    expect(formatLondonTime('2026-10-25T00:30:00Z')).toBe('01:30');
    expect(formatLondonTime('2026-10-25T01:30:00Z')).toBe('01:30');
    expect(toUtcIso('2026-10-25T00:30:00Z')).not.toBe(toUtcIso('2026-10-25T01:30:00Z'));
  });

  it('changes at exactly 01:00 UTC, not before', () => {
    expect(londonOffsetMinutes(BST_ENDS_UTC)).toBe(0);
    expect(londonOffsetMinutes('2026-10-25T00:59:59.999Z')).toBe(60);
  });
});

describe('the clocks change the other way — 29 March 2026', () => {
  // BST begins at 01:00 GMT on Sunday 29 March 2026, when clocks go forward to 02:00 BST.
  it('is GMT one minute before the change', () => {
    expect(londonOffsetMinutes('2026-03-29T00:59:00Z')).toBe(0);
    expect(formatLondonTime('2026-03-29T00:59:00Z')).toBe('00:59');
  });

  it('is BST one minute after the change, and 01:00–01:59 London never happens', () => {
    expect(londonOffsetMinutes('2026-03-29T01:01:00Z')).toBe(60);
    // 01:01 UTC renders as 02:01 London. There is no 01:30 London on this date at all.
    expect(formatLondonTime('2026-03-29T01:01:00Z')).toBe('02:01');
  });
});

describe('race day — Nightingale Nightmare, the weekend after the change', () => {
  // The race is Sunday 1 November 2026, so it runs in GMT. 31 October is kept in the cases
  // below because it is the day either side of the one that was chosen, and the property
  // being asserted is that the whole weekend is past the change. This is the assertion that
  // would have caught an hour of drift on the day.
  it.each(['2026-10-31T09:00:00Z', '2026-11-01T09:00:00Z'])(
    'renders %s in GMT, with no offset applied',
    (instant) => {
      expect(londonOffsetMinutes(instant)).toBe(0);
      expect(formatLondonTime(instant)).toBe('09:00');
    },
  );

  it('formats a start time the way a runner would read it', () => {
    expect(formatLondon('2026-11-01T09:00:00Z')).toBe('1 November 2026 at 09:00 GMT');
  });

  it('formats a summer event with the BST label', () => {
    // Pass the Buck 2026, 19:00 BST — the timing app's own reference point.
    expect(formatLondon('2026-07-08T18:00:00Z')).toBe('8 July 2026 at 19:00 BST');
  });
});

describe('input handling', () => {
  it('accepts a Date, an ISO string and epoch milliseconds alike', () => {
    const iso = '2026-11-01T09:00:00Z';
    const expected = formatLondonDate(iso);
    expect(formatLondonDate(new Date(iso))).toBe(expected);
    expect(formatLondonDate(Date.parse(iso))).toBe(expected);
  });

  it('throws on something that is not an instant, rather than rendering nonsense', () => {
    expect(() => formatLondonDate('not a date')).toThrow(RangeError);
  });

  it('stores UTC regardless of how the instant arrived', () => {
    expect(toUtcIso('2026-11-01T09:00:00+00:00')).toBe('2026-11-01T09:00:00.000Z');
  });
});
