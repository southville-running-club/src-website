import { describe, expect, it } from 'vitest';
import {
  correctedTime,
  parseRaceDate,
  parseTypedClock,
  raceDateValue,
  timeOnRaceDay,
  typedTimeOutcome,
} from '../../lib/typed-time';
import { anomalyOutcomeFor } from '../../lib/anomaly-outcomes';

/**
 * A time typed on the timing log — ADR-071. The conversion itself is `london-time.ts`'s and is
 * tested there; what is here is what a person can type, and when a typed time is left alone.
 */

describe('what a person can type', () => {
  it.each([
    ['11:47:32', { hour: 11, minute: 47, second: 32 }],
    ['11.47.32', { hour: 11, minute: 47, second: 32 }],
    ['11 47 32', { hour: 11, minute: 47, second: 32 }],
    // ⚠️ **The iPhone's number pad has no colon**, and these six digits are all it can type.
    ['114732', { hour: 11, minute: 47, second: 32 }],
    ['  9:05:00 ', { hour: 9, minute: 5, second: 0 }],
    ['11:47', { hour: 11, minute: 47, second: 0 }],
    ['1147', { hour: 11, minute: 47, second: 0 }],
  ])('reads %j', (typed, expected) => {
    expect(parseTypedClock(typed)).toEqual(expected);
  });

  it.each([
    ['24:00:00'],
    ['11:60:00'],
    ['11:47:60'],
    ['11:4:32'],
    ['eleven'],
    ['1147321'],
    [''],
  ])('refuses %j', (typed) => {
    expect(parseTypedClock(typed)).toBeNull();
  });
});

describe('the race date the page draws', () => {
  it('round-trips through the hidden field', () => {
    const date = { year: 2026, month: 11, day: 1 };
    expect(raceDateValue(date)).toBe('2026-11-01');
    expect(parseRaceDate(raceDateValue(date))).toEqual(date);
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(parseRaceDate('1/11/2026')).toBeNull();
    expect(parseRaceDate('')).toBeNull();
  });
});

describe('adding: a time on the race day', () => {
  it('is the instant that London clock names on that date', () => {
    expect(timeOnRaceDay('11:47:32', '2026-11-01')).toEqual({
      state: 'ok',
      instant: new Date('2026-11-01T11:47:32Z'),
    });
  });

  it('says which of the ways it went wrong', () => {
    expect(timeOnRaceDay('  ', '2026-11-01')).toEqual({ state: 'blank' });
    expect(timeOnRaceDay('half eleven', '2026-11-01')).toEqual({ state: 'unreadable' });
    expect(timeOnRaceDay('11:47:32', 'tomorrow')).toEqual({ state: 'unreadable' });
    expect(timeOnRaceDay('01:30:00', '2026-10-25')).toEqual({ state: 'ambiguous' });
    expect(timeOnRaceDay('01:30:00', '2026-03-29')).toEqual({ state: 'nonexistent' });
  });
});

describe('correcting: the drawn time, or a new one', () => {
  const NOW = new Date('2026-11-01T18:00:00Z');
  const DRAWN = '2026-11-01T11:32:00.123Z';

  /**
   * ⚠️ **The case every bib correction makes.** The edit form posts the time box exactly as it
   * was drawn, without its milliseconds. Re-deriving an instant from it would move the capture
   * by 123ms on every bib correction, and an elapsed time with it.
   */
  it('leaves a time nobody changed exactly as it was, milliseconds and all', () => {
    expect(
      correctedTime({
        typed: '11:32:00',
        drawn: DRAWN,
        raceDate: '2026-11-01',
        now: NOW,
      }),
    ).toEqual({ state: 'unchanged' });
  });

  it('leaves a capture alone when the form has no time box at all', () => {
    // A page the previously deployed Worker drew, posting during a deploy.
    expect(
      correctedTime({ typed: null, drawn: DRAWN, raceDate: '2026-11-01', now: NOW }),
    ).toEqual({ state: 'unchanged' });
  });

  it('moves a capture to a new time on the race day', () => {
    expect(
      correctedTime({
        typed: '11:33:15',
        drawn: DRAWN,
        raceDate: '2026-11-01',
        now: NOW,
      }),
    ).toEqual({ state: 'ok', instant: new Date('2026-11-01T11:33:15Z') });
  });

  /**
   * The phone-clock case the log's before-the-gun marker surfaces: a phone an hour out, and the
   * paper saying what the time actually was.
   */
  it('takes the date from the race, not from the capture being corrected', () => {
    expect(
      correctedTime({
        typed: '11:47:32',
        drawn: '2026-11-01T10:47:32Z',
        raceDate: '2026-11-01',
        now: NOW,
      }),
    ).toEqual({ state: 'ok', instant: new Date('2026-11-01T11:47:32Z') });
  });

  it('refuses a time cleared to nothing, rather than reading it as unchanged', () => {
    expect(
      correctedTime({ typed: '', drawn: DRAWN, raceDate: '2026-11-01', now: NOW }),
    ).toEqual({ state: 'blank' });
  });

  it('refuses a time that has not happened yet, with a minute of grace', () => {
    expect(
      correctedTime({
        typed: '18:00:59',
        drawn: DRAWN,
        raceDate: '2026-11-01',
        now: NOW,
      }),
    ).toMatchObject({ state: 'ok' });
    expect(
      correctedTime({
        typed: '18:05:00',
        drawn: DRAWN,
        raceDate: '2026-11-01',
        now: NOW,
      }),
    ).toEqual({ state: 'in_future' });
  });
});

describe('every refusal has words', () => {
  it.each([
    ['blank'],
    ['unreadable'],
    ['ambiguous'],
    ['nonexistent'],
    ['in_future'],
  ] as const)('%s is reported as an outcome the page can say', (state) => {
    expect(anomalyOutcomeFor(typedTimeOutcome(state))).not.toBeNull();
  });
});
