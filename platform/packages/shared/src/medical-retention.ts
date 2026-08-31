/**
 * The one place the enforced retention period and the published wording meet.
 *
 * ## The problem this exists for
 *
 * `/nn/privacy/` tells people, in the club's own words, how long a medical note is kept:
 * `race.json`'s `privacy.medicalRetention`, which today reads **"One month after the race"**.
 * `entries.events.medical_retention` is what the deletion job actually applies. **Nothing
 * connected the two**, so a club that edited the notice and not the schema would be publishing
 * a claim it did not keep, and a club that edited the schema and not the notice would be
 * deleting somebody's data sooner than it said it would. Neither shows up in a diff on its own,
 * and both are the kind of mistake that is only discovered by somebody asking a question the
 * club cannot answer well.
 *
 * So the published string is not written by hand any more: it is what this function produces
 * from the interval the database is enforcing. `packages/db/tests/entries-retention.test.ts`
 * reads the column out of Postgres, reads `race.json` off disk, and fails unless the second is
 * what the first generates. **Changing either one alone goes red.**
 *
 * ## Why a Postgres interval string rather than a number
 *
 * The column is an `interval` because "one month" is what was published, and a month is not
 * thirty days: `date '2026-11-01' + interval '1 month'` is 1 December, which is what somebody
 * reading the notice would work out on a calendar. Postgres renders that interval as the string
 * `1 mon`, and `supabase gen types` types the column as `string` for the same reason — so this
 * parses the handful of forms Postgres actually emits rather than pretending the value is a
 * number.
 *
 * **Anything it cannot read is `null`, and a null fails the test.** A retention period this
 * module cannot describe is one the notice cannot honestly describe either, and the right place
 * to find that out is a red test rather than a page that says "To be confirmed by the club"
 * about something that is very much confirmed.
 */

/** How Postgres writes the intervals this is willing to publish a sentence about. */
const MONTHS = /^(\d+)\s+mons?$/;
const YEARS = /^(\d+)\s+years?$/;
const DAYS = /^(\d+)\s+days?$/;

const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
] as const;

/**
 * Spelled out, or not published at all.
 *
 * Not a style preference: the notice says "One month after the race" today, and a retention
 * period is the kind of number that reads as a **decision** when it is a word and as a
 * **setting** when it is a digit. A notice that said "One month" last year and "18 months" this
 * year has changed register in the middle of a legal document.
 *
 * So above twelve this returns `undefined` and the caller answers `null`, which fails the drift
 * test rather than publishing a sentence nobody chose the shape of. **It costs nothing real** —
 * every plausible retention period is one, three or six months, or one or two years — and it
 * puts a club that wants eighteen months in front of the same decision every other unsayable
 * period gets: extend this module deliberately, in a diff.
 */
function count(n: number): string | undefined {
  return NUMBER_WORDS[n];
}

/** `Two months after the race`, or nothing if the number cannot be spelled. */
function phrase(raw: string | undefined, unit: string): string | null {
  if (raw === undefined) {
    return null;
  }

  const n = Number(raw);
  const word = n > 0 ? count(n) : undefined;

  return word === undefined
    ? null
    : `${word} ${unit}${n === 1 ? '' : 's'} after the race`;
}

/**
 * The sentence `/nn/privacy/` publishes, for the interval the database enforces.
 *
 * `null` when the interval is not one of the shapes above — a mixed interval like
 * `1 mon 15 days`, a zero, anything with a time component, **or a number above twelve**. Those
 * are all things the schema would accept and the notice could not describe in one clause and one
 * register, which is exactly the case worth failing on rather than approximating.
 */
export function medicalRetentionWording(interval: string): string | null {
  const value = interval.trim().toLowerCase();

  return (
    phrase(MONTHS.exec(value)?.[1], 'month') ??
    phrase(YEARS.exec(value)?.[1], 'year') ??
    phrase(DAYS.exec(value)?.[1], 'day')
  );
}

/**
 * The same sentence, lower-cased for the middle of one — `one month after the race`.
 *
 * **Three callers wanted this and two of them had written their own.** `/admin/nn/`'s
 * `retentionWords()` did the lower-casing inline; `/nn/2026/` and `/account/data/` did not call
 * this module at all and stated a hand-typed period instead, which is issue #172. A second
 * exported function rather than a third re-implementation, for the reason `formatPence()`
 * exists: the shape of a published value belongs to the one place that produces it.
 *
 * `null` for exactly the intervals `medicalRetentionWording` refuses, and every caller has to
 * say what it renders instead — which is the point. A period this module cannot describe is one
 * no page should be inventing words for.
 */
export function medicalRetentionClause(interval: string): string | null {
  const wording = medicalRetentionWording(interval);

  return wording === null ? null : wording.charAt(0).toLowerCase() + wording.slice(1);
}
