import { londonClock, londonWallClockInstant, type LondonClock } from '@src/shared';

/**
 * A time somebody typed on the timing log, and the instant it names on the race's own day —
 * [ADR-071](../../../../docs/architecture/decisions/adr-071-a-crossing-can-be-added-and-retimed-from-the-log.md).
 *
 * ## ⚠️ The date is the race's, never today's and never the browser's
 *
 * The box asks for a **time** and nothing else, because the paper a marshal wrote on says
 * `11:47:32` and not a date. The date comes from the race — the London day its gun went —
 * which the page draws into the form. **Today's date would be wrong the morning after**, which
 * is exactly when results get checked: a finish typed then would land a day late and read as a
 * 24-hour run. And the browser's own zone is never asked, because a `datetime-local` is a wall
 * clock with no zone and this race is run the weekend the clocks go back.
 *
 * ## What `unchanged` is for
 *
 * The log's edit form carries the bib and the time together, so saving a bib correction also
 * posts the time box exactly as it was drawn. Re-deriving an instant from that would quietly
 * drop the capture's milliseconds — and move it to the race's date if the phone that took it
 * had the wrong day. **A time nobody touched is carried through as the instant it already
 * was**, and only a time that differs from what was drawn is converted.
 */

export type TypedTime =
  | { state: 'ok'; instant: Date }
  | { state: 'unchanged' }
  | { state: 'blank' }
  | { state: 'unreadable' }
  | { state: 'ambiguous' }
  | { state: 'nonexistent' }
  | { state: 'in_future' };

/**
 * `11:47:32`, `11.47.32`, `11 47 32`, `114732`, or any of them without the seconds.
 *
 * ⚠️ **A text box rather than `type="time"`, and the separators are the reason this is loose.**
 * The iPhone's time picker has no seconds, and a finish on paper is to the second — so the box
 * is plain text, and a phone's number pad, which has no colon, has to be able to fill it. The
 * six digits alone are what that pad can type; the full stop is what iOS's decimal pad offers.
 */
export function parseTypedClock(text: string): LondonClock | null {
  const trimmed = text.trim();
  const match =
    /^(\d{1,2})[:. ](\d{2})(?:[:. ](\d{2}))?$/.exec(trimmed) ??
    /^(\d{2})(\d{2})(\d{2})?$/.exec(trimmed);
  if (match === null) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);

  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return { hour, minute, second };
}

/** `2026-11-01`, as the page draws it, or `null` for anything else. */
export function parseRaceDate(
  text: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (match === null) {
    return null;
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `YYYY-MM-DD` for a London civil date — what the page draws into the form's hidden field. */
export function raceDateValue(date: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * The instant a typed time names on the race's day. What the **add** form needs: there is no
 * drawn value to compare against, and `timing.add_crossing()` is what refuses a time before the
 * gun or after now, in one place, against the database's own clock.
 */
export function timeOnRaceDay(typed: string, raceDate: string): TypedTime {
  if (typed.trim() === '') {
    return { state: 'blank' };
  }

  const clock = parseTypedClock(typed);
  const date = parseRaceDate(raceDate);
  if (clock === null || date === null) {
    return { state: 'unreadable' };
  }

  const answer = londonWallClockInstant(date, clock);
  if (answer.state === 'invalid') {
    return { state: 'unreadable' };
  }

  return answer;
}

/**
 * What the **edit** form's time box means: the drawn instant unchanged, or a new one.
 *
 * ⚠️ **A form with no time box at all is `unchanged`, not `blank`.** That is a page drawn by the
 * previously deployed Worker, posting during a deploy — expand, migrate, contract, applied to a
 * form field — and it must go on correcting bibs exactly as it did.
 *
 * `in_future` is decided here rather than in the database because `edit_crossing()` is the
 * deployed Worker's contract and this change leaves it alone; ADR-071 records that.
 */
export function correctedTime(input: {
  typed: string | null;
  drawn: string;
  raceDate: string;
  now: Date;
}): TypedTime {
  if (input.typed === null) {
    return { state: 'unchanged' };
  }

  if (input.typed.trim() === '') {
    return { state: 'blank' };
  }

  const clock = parseTypedClock(input.typed);
  if (clock === null) {
    return { state: 'unreadable' };
  }

  const drawn = new Date(input.drawn);
  if (!Number.isNaN(drawn.getTime())) {
    const was = londonClock(drawn);
    if (
      was.hour === clock.hour &&
      was.minute === clock.minute &&
      was.second === clock.second
    ) {
      return { state: 'unchanged' };
    }
  }

  const answer = timeOnRaceDay(input.typed, input.raceDate);
  if (answer.state !== 'ok') {
    return answer;
  }

  // A minute's grace for two clocks disagreeing — the same allowance the database gives an add.
  if (answer.instant.getTime() > input.now.getTime() + 60_000) {
    return { state: 'in_future' };
  }

  return answer;
}

/** The `?outcome=` each refusal above is reported as — `lib/anomaly-outcomes.ts` words them. */
export function typedTimeOutcome(
  state: Exclude<TypedTime['state'], 'ok' | 'unchanged'>,
): string {
  return {
    blank: 'time_required',
    unreadable: 'time_unreadable',
    ambiguous: 'time_ambiguous',
    nonexistent: 'time_nonexistent',
    in_future: 'in_future',
  }[state];
}
