import { describe, expect, it } from 'vitest';
import {
  ageCategoryFor,
  ageOn,
  compareCivilDates,
  daysInMonth,
  deriveAgeCategory,
  isLeapYear,
  isRealDate,
  parseIsoDate,
  toIsoDate,
  type CivilDate,
} from '../../src/age-category';

/**
 * The category derivation, which is never stored and therefore has to be right every time it
 * is asked.
 *
 * Race day is **Sunday 1 November 2026**, confirmed. Every fixture below is anchored to it,
 * because "at race date" is what the club's categories say and an age computed against today
 * would be a different answer every time the suite ran.
 */
const RACE_DAY: CivilDate = { year: 2026, month: 11, day: 1 };

describe('the calendar, before anything is derived from it', () => {
  it('knows which years are leap years, including the century rule', () => {
    // 1900 is not a leap year and 2000 is. A form taking a birth year forty years back will
    // meet both, and the naive "divisible by four" version is wrong about one of them.
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });

  it('gives February its extra day only when it has one', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('refuses a date that never happened, rather than rolling it over', () => {
    // **This is the reason the module does not use `new Date(y, m, d)`.** That constructor
    // turns 31 February into 3 March and reports no problem at all, so a form built on it
    // accepts a birth date nobody has.
    expect(isRealDate({ year: 2026, month: 2, day: 31 })).toBe(false);
    expect(isRealDate({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isRealDate({ year: 2024, month: 2, day: 29 })).toBe(true);
    expect(isRealDate({ year: 2026, month: 13, day: 1 })).toBe(false);
    expect(isRealDate({ year: 2026, month: 0, day: 1 })).toBe(false);
    expect(isRealDate({ year: 2026, month: 4, day: 31 })).toBe(false);
    expect(isRealDate({ year: 2026, month: 11, day: 0 })).toBe(false);
  });

  it('round-trips the format Postgres speaks', () => {
    expect(toIsoDate({ year: 1986, month: 3, day: 7 })).toBe('1986-03-07');
    expect(parseIsoDate('1986-03-07')).toEqual({ year: 1986, month: 3, day: 7 });
    expect(parseIsoDate('2026-11-01')).toEqual(RACE_DAY);
  });

  it('rejects an ISO date that is well-formed and impossible', () => {
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('not a date')).toBeNull();
    expect(parseIsoDate('1986-3-7')).toBeNull();
  });

  it('orders two civil dates', () => {
    expect(compareCivilDates({ year: 2026, month: 1, day: 1 }, RACE_DAY)).toBe(-1);
    expect(compareCivilDates(RACE_DAY, RACE_DAY)).toBe(0);
    expect(compareCivilDates({ year: 2027, month: 1, day: 1 }, RACE_DAY)).toBe(1);
  });
});

describe('age on race day', () => {
  it('counts completed years', () => {
    expect(ageOn({ year: 1986, month: 3, day: 7 }, RACE_DAY)).toBe(40);
  });

  it('counts a birthday that falls on race day as having happened', () => {
    // The club's categories are "at race date". 1 November is the day somebody becomes a
    // Vet 40, not the day after — and this is the boundary somebody will write in to argue
    // about, so it is asserted rather than assumed.
    expect(ageOn({ year: 1986, month: 11, day: 1 }, RACE_DAY)).toBe(40);
  });

  it('does not count a birthday one day later', () => {
    expect(ageOn({ year: 1986, month: 11, day: 2 }, RACE_DAY)).toBe(39);
  });

  it('handles a 29 February birthday in a non-leap race year', () => {
    // Born 29 February 2000, race day 1 November 2026: the birthday month has passed either
    // way, so the answer does not depend on what a non-existent 29 February 2026 would be.
    expect(ageOn({ year: 2000, month: 2, day: 29 }, RACE_DAY)).toBe(26);
  });
});

describe('which category somebody runs in', () => {
  const on = (year: number, month: number, day: number, gender: 'female' | 'male') =>
    deriveAgeCategory({ year, month, day }, gender, RACE_DAY);

  it('puts an 18-year-old in Senior, on the day they turn 18', () => {
    const category = on(2008, 11, 1, 'female');
    expect(category).toEqual({ known: true, code: 'senior', label: 'Senior', age: 18 });
  });

  it('keeps a 39-year-old in Senior — one day short of Vet 40', () => {
    // Born the day after race day in 1986, so the fortieth birthday is 24 hours away.
    expect(on(1986, 11, 2, 'male')).toMatchObject({ code: 'senior', age: 39 });
  });

  it('moves somebody to Vet 40 on their fortieth birthday', () => {
    expect(on(1986, 11, 1, 'male')).toMatchObject({
      known: true,
      code: 'vet40',
      label: 'Vet 40',
      age: 40,
    });
  });

  it('holds the boundaries at 50 and 60, from both sides', () => {
    expect(on(1976, 11, 2, 'female')).toMatchObject({ code: 'vet40', age: 49 });
    expect(on(1976, 11, 1, 'female')).toMatchObject({ code: 'vet50', age: 50 });
    expect(on(1966, 11, 2, 'male')).toMatchObject({ code: 'vet50', age: 59 });
    expect(on(1966, 11, 1, 'male')).toMatchObject({ code: 'vet60', age: 60 });
  });

  it('keeps everybody older than 60 in Vet 60, because it is the last band', () => {
    expect(on(1940, 1, 1, 'female')).toMatchObject({ code: 'vet60', age: 86 });
  });

  it('is the same set of bands for female and male runners', () => {
    const female = on(1986, 3, 7, 'female');
    const male = on(1986, 3, 7, 'male');
    expect(female).toEqual(male);
  });
});

describe('the two gaps, which are the club’s and are not filled by guessing', () => {
  it('has no category for a non-binary runner, and says so rather than picking one', () => {
    // A non-binary option existed on the 2023 form and there were no non-binary categories
    // to receive it. That gap is unresolved and it is the committee's to resolve; inventing
    // a structure here would be a decision taken on their behalf.
    const category = deriveAgeCategory(
      { year: 1986, month: 3, day: 7 },
      'non_binary',
      RACE_DAY,
    );

    expect(category).toEqual({
      known: false,
      reason: 'gender-has-no-categories',
      age: 40,
    });
  });

  it('reports the gender gap ahead of the age one, for a young non-binary runner', () => {
    // "Too young for a category" would be the wrong reason and a worse thing to be told:
    // the club has no categories for this runner at any age, and the two must not be
    // confused in the wording somebody actually reads.
    const category = deriveAgeCategory(
      { year: 2015, month: 1, day: 1 },
      'non_binary',
      RACE_DAY,
    );

    expect(category).toMatchObject({ known: false, reason: 'gender-has-no-categories' });
  });

  it('has no category below 18, which is not the same as a minimum age', () => {
    // The youngest band starts at 18, so a 17-year-old has no category. **That is not a
    // rule that they cannot enter** — `entries.events.minimum_age` is null for NN 2026
    // because no minimum has been confirmed, and inferring one from where a prize band
    // happens to start is exactly the inference this refuses to make.
    const category = deriveAgeCategory(
      { year: 2008, month: 11, day: 2 },
      'female',
      RACE_DAY,
    );

    expect(category).toEqual({
      known: false,
      reason: 'younger-than-any-category',
      age: 17,
    });
  });
});

describe('ageCategoryFor — the same answer, from an age that has already been worked out', () => {
  // **This exists so a date of birth does not have to travel to reach a category.** The admin
  // list gets an age computed in Postgres — by the identical expression
  // `entries.create_pending_purchase()` enforces the minimum age with — and names the band
  // here, so a date of birth never leaves the database.

  it('agrees with deriveAgeCategory at every band boundary', () => {
    // The assertion that keeps the two from becoming two rules. `deriveAgeCategory` delegates
    // to this, and if a future edit ever un-delegated it, these are the pairs that would
    // disagree first.
    const raceDay = { year: 2026, month: 11, day: 1 };

    for (const age of [17, 18, 39, 40, 49, 50, 59, 60, 61]) {
      for (const gender of ['female', 'male', 'non_binary'] as const) {
        const birthday = { year: 2026 - age, month: 11, day: 1 };

        expect(ageCategoryFor(age, gender), `age ${age}, ${gender}`).toEqual(
          deriveAgeCategory(birthday, gender, raceDay),
        );
      }
    }
  });

  it('names the four bands', () => {
    expect(ageCategoryFor(18, 'female')).toMatchObject({
      code: 'senior',
      label: 'Senior',
    });
    expect(ageCategoryFor(40, 'male')).toMatchObject({ code: 'vet40', label: 'Vet 40' });
    expect(ageCategoryFor(50, 'female')).toMatchObject({
      code: 'vet50',
      label: 'Vet 50',
    });
    expect(ageCategoryFor(60, 'male')).toMatchObject({ code: 'vet60', label: 'Vet 60' });
  });

  it('keeps the club’s two unfinished decisions apart', () => {
    // A non-binary runner has no category at any age, which is not the same fact as being too
    // young for one — and saying the wrong one of those two would be worse than saying nothing.
    expect(ageCategoryFor(12, 'non_binary')).toEqual({
      known: false,
      reason: 'gender-has-no-categories',
      age: 12,
    });
    expect(ageCategoryFor(12, 'female')).toEqual({
      known: false,
      reason: 'younger-than-any-category',
      age: 12,
    });
  });
});
