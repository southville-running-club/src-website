/**
 * Age categories, derived rather than stored.
 *
 * **The category is never a column.** `entries.entrants` holds a date of birth and a
 * gender and no category at all, because a stored category is wrong the moment a birthday
 * passes or an event date moves — and wrong silently, which is the expensive kind. This
 * module is the one place the derivation lives, so the form's live preview, a future
 * confirmation email and a future results page cannot disagree about what somebody runs as.
 * The timing platform derives its categories the same way, for the same reason.
 *
 * ## Civil dates, not instants
 *
 * A date of birth and a race date are **civil dates**: 1 November 2026 is 1 November 2026
 * wherever the person reading it happens to be. Neither is a moment in time, so neither is a
 * `Date` here — a `Date` carries a timezone, and "was this person 40 yet" computed through
 * one is a question that changes its answer at midnight in a country nobody is in.
 * `packages/shared/src/london-time.ts` is for the other kind, where an instant really is
 * being displayed and Europe/London really is the zone.
 *
 * ## `gender` here is the race category, and it is not the whole question
 *
 * The `Gender` below is the **closed set the club can award prizes and publish results in**,
 * which is why it is three values and not more — it names the categories that exist, not the
 * genders that do. The open question is `gender_identity` on the same table, free text and
 * optional, which nothing in this module reads and no result is ever grouped by. Splitting
 * the two is the recognised way round the trap of a closed list standing in for an identity —
 * ADR-020 has the reasoning, and the entry form asks them as two separate questions.
 *
 * ## What is confirmed, and what is not
 *
 * The four bands and their boundaries are the club's, from the prize list on `/nn/`:
 * **Senior 18–39, Vet 40–49, Vet 50–59, Vet 60+**, awarded to female and male runners.
 *
 * Two gaps are real and neither is filled by guessing:
 *
 *   * **Non-binary.** There is still no non-binary category, and this module still invents
 *     none — that is still the committee's decision, not a build one. What changed with
 *     ADR-031 is that a non-binary entrant is now asked directly which of the two existing
 *     categories, if either, their result should count in — `gender` and the new
 *     `result_placement` resolve through `effectiveCategory()` below, and `known` is `false`
 *     only for the entrant who was asked and said neither, or was never asked at all.
 *   * **Under 18.** The youngest band starts at 18, so a 17-year-old has no category. That
 *     is still *not* the same as a minimum age, even though Nightingale Nightmare's is now
 *     18 as well. The committee confirmed that separately on 13 August 2026 and it lives in
 *     `entries.events.minimum_age`; this file would keep saying "younger than any category"
 *     for a race that admitted juniors, because a prize band and an entry rule are two
 *     different decisions that happen to have agreed once.
 */

/**
 * A date with no timezone attached — the year, month and day somebody would write down.
 * `month` is 1–12 rather than JavaScript's 0–11, because this type is read by people.
 */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The race categories, which is a smaller question than a person's gender and deliberately
 * so. See the note at the top of this file and ADR-020: what somebody is asked to pick here
 * decides which prize list and which results table they appear in, and `gender_identity`
 * beside it is where the club records how they describe themselves.
 */
export type Gender = 'female' | 'male' | 'non_binary';

/** The four bands, in the order the prize list gives them. */
export const AGE_CATEGORY_CODES = ['senior', 'vet40', 'vet50', 'vet60'] as const;

export type AgeCategoryCode = (typeof AGE_CATEGORY_CODES)[number];

/**
 * Why a category could not be worked out.
 *
 * **`not-placed` covers two different facts now, deliberately merged.** A female or male
 * runner is never in this state at all; a non-binary runner reaches it either by explicitly
 * choosing "do not place me in either" or — for anywhere still reading `gender` without
 * `result_placement`, or an old row from before ADR-031 — by not having answered. Both are
 * "no band, no prize eligibility" to everything downstream, and the wording shown to a person
 * has to say the true one of the two rather than guess.
 */
export type NoCategoryReason = 'not-placed' | 'younger-than-any-category';

export type AgeCategory =
  | { known: true; code: AgeCategoryCode; label: string; age: number }
  | { known: false; reason: NoCategoryReason; age: number };

const CATEGORY_LABELS: Record<AgeCategoryCode, string> = {
  senior: 'Senior',
  vet40: 'Vet 40',
  vet50: 'Vet 50',
  vet60: 'Vet 60',
};

/** The label the club puts on a band — "Vet 40", as the prize list and the mockup say. */
export function ageCategoryLabel(code: AgeCategoryCode): string {
  return CATEGORY_LABELS[code];
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Proleptic Gregorian, which is what a birth year in living memory will always be. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    return 0;
  }
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

/**
 * Whether these three numbers are a day that existed.
 *
 * Written out rather than delegated to `new Date(y, m, d)`, which **rolls over instead of
 * refusing**: 31 February becomes 3 March and a form that trusted it would accept a birth
 * date nobody has.
 */
export function isRealDate(date: CivilDate): boolean {
  const { year, month, day } = date;

  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** `YYYY-MM-DD` — what Postgres returns for a `date` column, and what it accepts back. */
export function toIsoDate(date: CivilDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD`. Returns null for anything that is not one, including 2026-02-31. */
export function parseIsoDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };

  return isRealDate(date) ? date : null;
}

/**
 * Completed years between two civil dates.
 *
 * Somebody whose birthday falls **on** race day has had it: the club's categories are "at
 * race date", so 1 November is the day you become a Vet 40 rather than the day after.
 * `compareCivilDates` does the same day-and-month comparison the rest of the world does on
 * paper, which is the point of not going near a `Date`.
 */
export function ageOn(dateOfBirth: CivilDate, on: CivilDate): number {
  let age = on.year - dateOfBirth.year;

  const hasHadBirthday =
    on.month > dateOfBirth.month ||
    (on.month === dateOfBirth.month && on.day >= dateOfBirth.day);

  if (!hasHadBirthday) {
    age -= 1;
  }

  return age;
}

/** -1, 0 or 1, so a caller can say "not yet born" without reimplementing the comparison. */
export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

/**
 * Where a non-binary entrant's result counts, if anywhere — the follow-up ADR-031 adds.
 *
 * Null for two different reasons that this type does not distinguish, deliberately: "never
 * asked" (a female or male entrant) and "asked, chose neither" (a non-binary entrant who
 * opted out) resolve to the identical downstream fact — no band, no prize eligibility — and a
 * caller that needs to tell the two apart already has `gender` beside this to do it.
 */
export type ResultPlacement = 'female' | 'male' | null;

/**
 * The two-valued-or-null category a result actually counts in — the one thing age-category
 * derivation, the admin surface and every export need, resolved once rather than by each of
 * them re-deriving the same branch.
 *
 * **A female or male entrant's own answer, unchanged.** They were not asked the follow-up,
 * because `gender` alone already says which of the two categories they are in.
 *
 * **A non-binary entrant's `placement`, whatever it is.** `'female'`, `'male'`, or `null` for
 * "do not place me in either" — which is the same null a category-less answer always was, now
 * arrived at by an explicit choice rather than by the club never having asked.
 */
export function effectiveCategory(
  gender: Gender,
  placement: ResultPlacement,
): 'female' | 'male' | null {
  return gender === 'non_binary' ? placement : gender;
}

/**
 * Which band a runner falls in on race day, or an honest reason there is not one.
 *
 * The age is returned either way, because it is the useful half of the answer when the
 * category is missing: somebody with no category should still be told the club has their age
 * right.
 */
export function deriveAgeCategory(
  dateOfBirth: CivilDate,
  gender: Gender,
  placement: ResultPlacement,
  eventDate: CivilDate,
): AgeCategory {
  return ageCategoryFor(
    ageOn(dateOfBirth, eventDate),
    effectiveCategory(gender, placement),
  );
}

/**
 * The same answer, from an age that has already been worked out.
 *
 * **This exists so that a date of birth does not have to travel to reach a category**, and it
 * is the half of `deriveAgeCategory` that is only about the bands. The admin surface reads
 * `entries.admin_entry_list()`, which computes completed years at `event_date` in SQL — with
 * the identical expression `entries.create_pending_purchase()` enforces the minimum age with —
 * and hands back an age, a gender and a placement. A date of birth is a far stronger
 * identifier than a number of years and an entries list has no use for one, so it never
 * leaves the database.
 *
 * `deriveAgeCategory` delegates here rather than repeating the bands, which is what keeps the
 * two answers the same answer: the form's live preview and the organiser's list cannot
 * disagree about what somebody runs as.
 *
 * **Takes the resolved category, not raw `gender`.** Every caller with a `gender` and a
 * `placement` calls `effectiveCategory()` first — `deriveAgeCategory` above does exactly that
 * — so this function itself needs no opinion about non-binary at all, which is the "no third
 * branch" ADR-031 asks for.
 */
export function ageCategoryFor(
  age: number,
  category: 'female' | 'male' | null,
): AgeCategory {
  // Checked before the age bands, deliberately. Somebody with no category at age 12 is not
  // "too young for a category" — there is no category for them to be too young for — and
  // saying the wrong one of those two things would be worse than saying nothing.
  if (category === null) {
    return { known: false, reason: 'not-placed', age };
  }

  if (age < 18) {
    return { known: false, reason: 'younger-than-any-category', age };
  }

  const code: AgeCategoryCode =
    age >= 60 ? 'vet60' : age >= 50 ? 'vet50' : age >= 40 ? 'vet40' : 'senior';

  return { known: true, code, label: CATEGORY_LABELS[code], age };
}
