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
 * Spelled out up to twelve, and digits above it.
 *
 * Not a style preference: the notice says "One month after the race" today, and a retention
 * period is the kind of number that reads as a decision when it is a word and as a setting when
 * it is a digit. Twelve is where the words stop being shorter than the digits.
 */
function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * The sentence `/nn/privacy/` publishes, for the interval the database enforces.
 *
 * `null` when the interval is not one of the shapes above — a mixed interval like
 * `1 mon 15 days`, a zero, or anything with a time component. Those are all things the schema
 * would accept and the notice could not describe in one clause, which is exactly the case worth
 * failing on rather than approximating.
 */
export function medicalRetentionWording(interval: string): string | null {
  const value = interval.trim().toLowerCase();

  const months = MONTHS.exec(value)?.[1];
  if (months !== undefined && Number(months) > 0) {
    return `${count(Number(months))} month${Number(months) === 1 ? '' : 's'} after the race`;
  }

  const years = YEARS.exec(value)?.[1];
  if (years !== undefined && Number(years) > 0) {
    return `${count(Number(years))} year${Number(years) === 1 ? '' : 's'} after the race`;
  }

  const days = DAYS.exec(value)?.[1];
  if (days !== undefined && Number(days) > 0) {
    return `${count(Number(days))} day${Number(days) === 1 ? '' : 's'} after the race`;
  }

  return null;
}
