import { describe, expect, it } from 'vitest';
import {
  isGuide,
  resultCategoryLabel,
  soloAgeCategory,
  type CategoryRunner,
} from '../../src/timing/result-category';

/**
 * The Category column — #205.
 *
 * ⚠️ **The assertions worth having are the ones about a runner who is not in a band**, because
 * every one of them is a way to put somebody in the wrong prize category, and a wrong prize
 * category is discovered at the presentation rather than in a test.
 *
 * There are four such runners and they reach `null` by four different routes: a guide (ADR-022),
 * a runner with no recorded age, a non-binary runner who asked to be placed in neither list
 * (ADR-031), and a non-binary runner nobody asked. The last two are deliberately indistinguishable
 * downstream, which `age-category.ts` says in as many words.
 */

function runner(over: Partial<CategoryRunner> = {}): CategoryRunner {
  return {
    gender: 'female',
    result_placement: null,
    role: 'runner',
    age_on_day: 34,
    ...over,
  };
}

describe('resultCategoryLabel on a solo race', () => {
  it('names the club’s own band and gender', () => {
    expect(resultCategoryLabel([runner({ age_on_day: 41 })], 'solo')).toBe(
      "Women's Vet 40",
    );
    expect(
      resultCategoryLabel([runner({ gender: 'male', age_on_day: 62 })], 'solo'),
    ).toBe("Men's Vet 60");
  });

  it('reads the legacy F and M spelling, which Pass the Buck’s archive is full of', () => {
    expect(resultCategoryLabel([runner({ gender: 'F', age_on_day: 34 })], 'solo')).toBe(
      "Women's Senior",
    );
  });

  it('places a non-binary runner where they asked to be placed, and nowhere otherwise', () => {
    const asked = runner({
      gender: 'non_binary',
      result_placement: 'male',
      age_on_day: 51,
    });
    expect(resultCategoryLabel([asked], 'solo')).toBe("Men's Vet 50");

    // ⚠️ **No third branch**, which is what ADR-031 bought: said neither, or never asked, is the
    // same `null` — and the club still awards two lists.
    const neither = runner({ gender: 'non_binary', result_placement: null });
    expect(resultCategoryLabel([neither], 'solo')).toBeNull();
  });

  it('gives a guide no category at all', () => {
    const guide = runner({ role: 'guide', age_on_day: 41 });
    expect(isGuide(guide)).toBe(true);
    expect(resultCategoryLabel([guide], 'solo')).toBeNull();
    expect(soloAgeCategory(guide)).toBeNull();
  });

  it('gives a runner with no recorded age no category, rather than a guess', () => {
    expect(resultCategoryLabel([runner({ age_on_day: null })], 'solo')).toBeNull();
  });

  it('gives a runner under eighteen no category, and says which kind of nothing it is', () => {
    const young = runner({ age_on_day: 15 });
    expect(resultCategoryLabel([young], 'solo')).toBeNull();
    expect(soloAgeCategory(young)).toEqual({
      known: false,
      reason: 'younger-than-any-category',
      age: 15,
    });
  });

  it('falls back to a stored category and never prefers one', () => {
    // A walk-in desk's typing, or an archive import. Rendered when nothing can be derived.
    expect(
      resultCategoryLabel(
        [runner({ age_on_day: null })],
        'solo',
        'Whatever the desk typed',
      ),
    ).toBe('Whatever the desk typed');

    expect(
      resultCategoryLabel([runner({ age_on_day: 41 })], 'solo', 'Something else'),
    ).toBe("Women's Vet 40");
  });
});

describe('resultCategoryLabel on a relay', () => {
  it('derives the pair category from the two runners', () => {
    expect(resultCategoryLabel([runner(), runner({ gender: 'male' })], 'relay')).toBe(
      'Mixed Pair',
    );
    expect(resultCategoryLabel([runner(), runner()], 'relay')).toBe("Women's Pair");
  });

  it('gives a pair it cannot classify no category, not a fourth one', () => {
    // There are three pair categories and there is no fourth; ADR-031's placement is a solo
    // prize-band answer and reading it here would invent one the club does not award.
    expect(
      resultCategoryLabel([runner(), runner({ gender: 'non_binary' })], 'relay'),
    ).toBeNull();
    expect(resultCategoryLabel([runner()], 'relay')).toBeNull();
  });
});
