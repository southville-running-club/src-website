import { describe, expect, it } from 'vitest';
import { deriveCategory, PAIR_CATEGORIES } from '../../src/timing/categories';

/**
 * Pair categories. **Written here rather than copied**, because the source repository had no
 * `categories.test.ts` — this module arrived untested, which is worth saying out loud given
 * everything else in the port came with its assertions.
 *
 * The cases below are the ones that decide whether a team is miscategorised or told the truth
 * that the club does not know: the three real answers, and every way of failing to determine
 * one.
 */
describe('deriveCategory', () => {
  it('names the three pair categories the prize-giving screen shows', () => {
    expect(deriveCategory([{ gender: 'M' }, { gender: 'M' }])).toBe("Men's Pair");
    expect(deriveCategory([{ gender: 'F' }, { gender: 'F' }])).toBe("Women's Pair");
    expect(deriveCategory([{ gender: 'M' }, { gender: 'F' }])).toBe('Mixed Pair');
  });

  it('does not care which leg the genders arrive in', () => {
    expect(deriveCategory([{ gender: 'F' }, { gender: 'M' }])).toBe('Mixed Pair');
  });

  it('tolerates the casing and padding a CSV brings', () => {
    expect(deriveCategory([{ gender: ' m ' }, { gender: 'f' }])).toBe('Mixed Pair');
  });

  /**
   * ⚠️ **The null cases are the point of the function.** A team with one runner, three
   * runners, or a gender the import did not recognise gets no category — and the caller
   * renders a placeholder. Guessing would put somebody in the wrong prize list, which is
   * found out at the presentation.
   */
  it('returns null rather than guessing when it cannot tell', () => {
    expect(deriveCategory([{ gender: 'M' }])).toBeNull();
    expect(deriveCategory([])).toBeNull();
    expect(
      deriveCategory([{ gender: 'M' }, { gender: 'M' }, { gender: 'F' }]),
    ).toBeNull();
    expect(deriveCategory([{ gender: 'X' }, { gender: 'F' }])).toBeNull();
    expect(deriveCategory([{ gender: '' }, { gender: 'F' }])).toBeNull();
  });

  it('lists exactly the three it can return', () => {
    expect([...PAIR_CATEGORIES]).toEqual(["Men's Pair", "Women's Pair", 'Mixed Pair']);
  });
});
