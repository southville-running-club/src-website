import { describe, expect, it } from 'vitest';
import {
  categoryFor,
  searchRoster,
  sortRoster,
  type DeskRunner,
} from '../../lib/desk-roster';

/**
 * The Roster page's rules — ADR-056. Invented runners, with the awkward ones a desk meets: an
 * apostrophe, an accent, a guide, a runner with no recorded age, a non-binary runner placed by
 * their own answer, and a bib that sorts badly as text.
 */
function runner(over: Partial<DeskRunner>): DeskRunner {
  return {
    runner_id: over.runner_id ?? over.lastname ?? 'x',
    team_id: 't',
    leg: 1,
    firstname: 'Jane',
    lastname: 'Smith',
    bib: '1',
    race_status: null,
    gender: 'female',
    result_placement: null,
    role: 'runner',
    age_on_day: 30,
    ...over,
  };
}

const FIELD: DeskRunner[] = [
  runner({ firstname: 'Jane', lastname: 'Smith', bib: '412', age_on_day: 41 }),
  runner({ firstname: 'Bernadette', lastname: "O'Dell", bib: '12', age_on_day: 30 }),
  runner({ firstname: 'Siân', lastname: 'Évans', bib: '9', gender: 'female' }),
  runner({
    firstname: 'Callum',
    lastname: 'Prydderch',
    bib: '10',
    gender: 'male',
    race_status: 'dns',
  }),
  runner({
    firstname: 'Dilys',
    lastname: 'Anwyl',
    bib: null,
    role: 'guide',
    gender: null,
  }),
];

describe('the category a row shows', () => {
  it('gives the full race category when there is an age', () => {
    expect(categoryFor(FIELD[0]!)).toBe("Women's Vet 40");
  });

  it('gives Women or Men when there is no age, which is every marshal', () => {
    expect(categoryFor(runner({ age_on_day: null }))).toBe('Women');
    expect(categoryFor(runner({ gender: 'male', age_on_day: null }))).toBe('Men');
  });

  it('places a non-binary runner where they asked to be placed', () => {
    expect(
      categoryFor(
        runner({ gender: 'non_binary', result_placement: 'male', age_on_day: null }),
      ),
    ).toBe('Men');
    expect(categoryFor(runner({ gender: 'non_binary', age_on_day: null }))).toBe('—');
  });

  it('names a guide rather than leaving the cell blank', () => {
    expect(categoryFor(FIELD[4]!)).toBe('Guide');
  });
});

describe('the search a desk volunteer types', () => {
  const names = (query: string) => searchRoster(FIELD, query).map((r) => r.lastname);

  it.each([
    ['smi', ['Smith']],
    ['Smith, J', ['Smith']],
    ['jane smith', ['Smith']],
    ['SMITH JANE', ['Smith']],
    ['412', ['Smith']],
    ["o'dell", ["O'Dell"]],
  ])('finds %s', (query, expected) => {
    expect(names(query)).toEqual(expected);
  });

  it('ignores accents both ways', () => {
    expect(names('evans')).toEqual(['Évans']);
    expect(names('sian')).toEqual(['Évans']);
  });

  it('puts an exact bib match first', () => {
    // "12" is Bernadette's bib exactly, and inside Jane's 412.
    expect(names('12')).toEqual(["O'Dell", 'Smith']);
  });

  it('is everybody for a blank search, and nobody for no match', () => {
    expect(searchRoster(FIELD, '  ')).toHaveLength(FIELD.length);
    expect(searchRoster(FIELD, 'zzz')).toEqual([]);
  });
});

describe('the order the table is in', () => {
  const lastnames = (rows: DeskRunner[]) => rows.map((r) => r.lastname);

  it('is surname by default, ignoring case and accents', () => {
    expect(lastnames(sortRoster(FIELD, 'name', 'asc'))).toEqual([
      'Anwyl',
      'Évans',
      "O'Dell",
      'Prydderch',
      'Smith',
    ]);
  });

  it('sorts bibs naturally, with a missing bib last either way round', () => {
    expect(sortRoster(FIELD, 'bib', 'asc').map((r) => r.bib)).toEqual([
      '9',
      '10',
      '12',
      '412',
      null,
    ]);
    expect(sortRoster(FIELD, 'bib', 'desc').map((r) => r.bib)).toEqual([
      '412',
      '12',
      '10',
      '9',
      null,
    ]);
  });

  it('puts normal before DNS, DNF and DQ', () => {
    expect(sortRoster(FIELD, 'status', 'asc').at(-1)?.lastname).toBe('Prydderch');
  });
});
