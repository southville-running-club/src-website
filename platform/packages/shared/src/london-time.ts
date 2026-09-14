/**
 * The one path timezone conversion is allowed to take.
 *
 * Timestamps are stored UTC and displayed `Europe/London`. That is a correctness
 * requirement rather than a formatting preference: Nightingale Nightmare is raced on
 * **Sunday 1 November 2026 at 11:00**, the weekend *after* the clocks go back on 25
 * October, so a race-day time rendered through an ambient locale is an hour wrong exactly
 * when it matters most.
 *
 * The timing platform carries its own `lib/london-time.ts` for the same reason, and its
 * comment names the drift as the foot-gun. This module is the website's half of that,
 * and the two must not disagree.
 *
 * Nothing here reads the ambient timezone. Every function names `Europe/London`
 * explicitly, so the output does not depend on the machine it runs on. ESLint bans bare
 * `toLocale*String` calls repository-wide to keep it that way.
 *
 * @see docs/architecture/principles.md#timestamps-are-stored-utc-and-displayed-europelondon
 */

export const LONDON_TIME_ZONE = 'Europe/London';

/** An instant, however it arrived — a `Date`, an ISO string, or epoch milliseconds. */
export type Instant = Date | string | number;

function toDate(instant: Instant): Date {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a valid instant: ${String(instant)}`);
  }
  return date;
}

function londonFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // `en-GB` and the explicit zone are both deliberate. Neither is inferred.
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: LONDON_TIME_ZONE });
}

/** `1 November 2026` */
export function formatLondonDate(instant: Instant): string {
  return londonFormatter({ day: 'numeric', month: 'long', year: 'numeric' }).format(
    toDate(instant),
  );
}

/** `09:00` — 24-hour, because a race start time is not a matter of taste. */
export function formatLondonTime(instant: Instant): string {
  return londonFormatter({ hour: '2-digit', minute: '2-digit', hour12: false }).format(
    toDate(instant),
  );
}

/**
 * `19:17:42` — the same 24-hour clock, to the second.
 *
 * **Seconds because this one is for race timing.** A crossing is captured to the millisecond
 * and a marshal comparing a duplicate against the card in front of them needs more than the
 * minute; `formatLondonTime` is for a start time, where seconds would be noise.
 *
 * It lives here rather than beside its caller for the reason everything in this file does:
 * this is the one module permitted to convert, and ESLint bans a bare `toLocale*String`
 * everywhere else. The timing code arrived doing exactly that — see `timing/anomaly.ts`.
 */
export function formatLondonClock(instant: Instant): string {
  return londonFormatter({
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(toDate(instant));
}

/** `1 November 2026 at 09:00 GMT` — the form to show a runner. */
export function formatLondon(instant: Instant): string {
  return londonFormatter({
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  })
    .format(toDate(instant))
    .replace(', ', ' at ');
}

/**
 * `01092026` — the London day, month and year with nothing between them.
 *
 * **The tail of an entry reference and nothing else.** `NN2026-0042-01092026` is what a runner
 * quotes and a volunteer types into a search box, so the date in it has to be the day the club
 * would say the entry was made — which is the London day, not the UTC one. An entry taken at
 * 00:30 BST on 1 September is 23:30 UTC on 31 August, and a reference that said `31082026` would
 * disagree with the timestamp printed beside it on `/admin/nn/entry/`.
 *
 * `formatToParts` rather than a formatted string with the separators stripped: `en-GB` renders
 * `01/09/2026` today and this does not depend on it going on doing so.
 */
export function formatLondonCompactDate(instant: Instant): string {
  const parts = londonFormatter({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(toDate(instant));

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('day')}${part('month')}${part('year')}`;
}

/**
 * The London civil date at this instant, as three numbers: `{ year, month, day }`.
 *
 * **The answer to "what day is it?", which is not the same question as "what instant is
 * it?"** — and the one the rest of this file's functions all take a detour through a
 * formatted string to answer. `new Date().toISOString().slice(0, 10)` is the idiom this
 * exists to replace: it reads as "today" and means "today in UTC", so between midnight and
 * 01:00 on a British Summer Time morning it names **yesterday**. `account.ts`'s date-of-birth
 * validator did exactly that and told somebody typing today's date that it was in the future
 * — [#298](https://github.com/southville-running-club/src-website/issues/298).
 *
 * ⚠️ **ESLint's bare-`toLocale*String` ban does not catch that shape**, and the widened rule
 * beside it only catches the truncation. The guard that actually holds is this being the one
 * module permitted to convert at all: an instant becoming a civil date anywhere else is the
 * defect, whatever it is spelled as.
 *
 * Numbers rather than a string, because every caller here wants `CivilDate` — `toIsoDate()`
 * and `ageOn()` in `age-category.ts` both take one — and handing back `YYYY-MM-DD` would
 * mean a second parse to get them. The shape is structural on purpose: this module names no
 * type from `age-category.ts` and there is no import either way.
 *
 * `formatToParts` rather than a formatted string split on its separators, for
 * `formatLondonCompactDate`'s reason: `en-GB` renders `01/09/2026` today and nothing here
 * depends on it going on doing so.
 */
export function londonCivilDate(instant: Instant): {
  year: number;
  month: number;
  day: number;
} {
  const parts = londonFormatter({
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(toDate(instant));

  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    const parsed = Number(value);
    if (value === undefined || !Number.isInteger(parsed)) {
      throw new RangeError(`Intl gave no usable ${type}: ${String(value)}`);
    }
    return parsed;
  };

  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * Minutes London is ahead of UTC at this instant: `60` during British Summer Time, `0`
 * during Greenwich Mean Time.
 *
 * Exported because it is the thing worth *asserting* on. A test that checks a formatted
 * string can pass for the wrong reason; a test that checks the offset either side of
 * 02:00 on 25 October 2026 cannot.
 */
export function londonOffsetMinutes(instant: Instant): number {
  const parts = londonFormatter({ timeZoneName: 'longOffset' }).formatToParts(
    toDate(instant),
  );
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value;

  // `GMT` with no suffix during winter; `GMT+01:00` during summer.
  if (!offset || offset === 'GMT') return 0;

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) {
    throw new RangeError(`Unrecognised offset from Intl: ${offset}`);
  }
  const [, sign, hours, minutes] = match as unknown as [string, string, string, string];
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

/** True during British Summer Time. */
export function isBritishSummerTime(instant: Instant): boolean {
  return londonOffsetMinutes(instant) !== 0;
}

/**
 * The storage form. Always UTC, always ISO 8601 — what goes into Postgres, never what
 * goes onto a page.
 */
export function toUtcIso(instant: Instant): string {
  return toDate(instant).toISOString();
}
