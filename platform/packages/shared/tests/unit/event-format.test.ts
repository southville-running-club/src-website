import { describe, expect, it } from 'vitest';
import { formatEventDate, formatEventStartTime, parseIsoDate } from '../../src';

/**
 * Rendering an event's date and start time — **through the one formatter this repository has**.
 *
 * ## What this is closing
 *
 * `docs/architecture/decisions/adr-011-a-race-and-its-runnings.md` recorded a gap: `/nn/` stated
 * no date, because it could not use `race.json`'s (that belongs to the 2026 running) and
 * painting one from `entry_state()` looked like it meant a **second date formatter** — in a
 * repository whose entire timezone discipline is that there is exactly one, for a race run the
 * weekend after the clocks change.
 *
 * There is no second formatter. `formatEventDate` composes `toIsoDate` with `formatLondonDate`
 * and adds one `T00:00:00Z`; the argument for why that is safe is on the function, and these
 * are the assertions that hold it.
 *
 * ## The argument, and the dates that test it
 *
 * **London's offset from UTC is never negative** — `+00:00` in winter, `+01:00` in summer — so
 * an instant at `00:00Z` is either `00:00` or `01:00` on the *same* calendar day in London.
 * The day therefore survives the conversion for every date in the year.
 *
 * The dates below are the ones where that could break if it were going to: the two 2026
 * transitions, the day either side of each, and the race itself.
 */

const on = (iso: string): string => {
  const date = parseIsoDate(iso);
  if (date === null) throw new Error(`bad fixture: ${iso}`);
  return formatEventDate(date);
};

describe('an event date renders as the day it was published as', () => {
  it('renders the race itself', () => {
    // Sunday 1 November 2026, six days after the clocks go back. The weekday is not rendered:
    // `formatLondonDate` does not carry one, and adding one would be the second formatter.
    expect(on('2026-11-01')).toBe('1 November 2026');
  });

  it('survives the day the clocks go back', () => {
    // 25 October 2026, when 02:00 BST becomes 01:00 GMT. Midnight UTC that morning is 01:00
    // BST — still the 25th.
    expect(on('2026-10-24')).toBe('24 October 2026');
    expect(on('2026-10-25')).toBe('25 October 2026');
    expect(on('2026-10-26')).toBe('26 October 2026');
  });

  it('survives the day the clocks go forward', () => {
    // 29 March 2026, when 01:00 GMT becomes 02:00 BST.
    expect(on('2026-03-28')).toBe('28 March 2026');
    expect(on('2026-03-29')).toBe('29 March 2026');
    expect(on('2026-03-30')).toBe('30 March 2026');
  });

  it('renders midsummer and midwinter as themselves', () => {
    // The two extremes of the offset, so a date is never a day out in either direction.
    expect(on('2026-06-21')).toBe('21 June 2026');
    expect(on('2026-12-21')).toBe('21 December 2026');
  });

  it('never shifts a date by a day, on any day of a year', () => {
    // **The general claim rather than eight examples of it.** If `00:00Z` ever landed on the
    // previous day in London, the offset would have to be negative — which is the thing the
    // argument on `formatEventDate` rests on, asserted here across a whole year rather than
    // asserted about.
    for (let day = new Date(Date.UTC(2026, 0, 1)); day.getUTCFullYear() === 2026;) {
      const iso = day.toISOString().slice(0, 10);
      const expected = Number(iso.slice(8, 10));
      expect(on(iso).split(' ')[0], iso).toBe(String(expected));
      day = new Date(day.getTime() + 86_400_000);
    }
  });
});

describe('a start time is civil, and is never put through a timezone', () => {
  it('drops the seconds Postgres renders and nothing else', () => {
    // `11:00` is what the poster says and what the committee decided. It is **not an instant**,
    // and turning it into one to format it would mean choosing a date and an offset for a race
    // held six days after the clocks go back — precisely the conversion the storage-UTC rule
    // exists to keep away from. So this is a string operation and says so.
    expect(formatEventStartTime('11:00:00')).toBe('11:00');
    expect(formatEventStartTime('09:30:00')).toBe('09:30');
    expect(formatEventStartTime('23:59:59')).toBe('23:59');
  });

  it('leaves anything it does not recognise exactly as it found it', () => {
    // A shape this does not know is a shape it must not silently rewrite: showing the raw
    // value is how somebody notices, and inventing a plausible one is how nobody does.
    expect(formatEventStartTime('11:00')).toBe('11:00');
    expect(formatEventStartTime('')).toBe('');
    expect(formatEventStartTime('not a time')).toBe('not a time');
  });
});
