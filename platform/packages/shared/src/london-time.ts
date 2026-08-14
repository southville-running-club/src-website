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
