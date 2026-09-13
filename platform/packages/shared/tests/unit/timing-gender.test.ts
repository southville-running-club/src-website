import { describe, expect, it } from 'vitest';
import { normaliseTimingGender, placementFor } from '../../src/timing/gender';

/**
 * `timing.runners.gender` has one vocabulary and two spellings on disk — ADR-039.
 *
 * ⚠️ **The two halves of this file are testing opposite obligations**, and conflating them is
 * how the tolerance below turns into a permanent second vocabulary:
 *
 * - *reading* must accept the legacy `'M'` / `'F'` that Pass the Buck's archive is full of,
 *   because refusing it turns a whole race into "no prize band";
 * - *writing* must emit `entries`' vocabulary only, which is asserted where the writers are —
 *   `timing-parser.test.ts` for the CSV boundary and `packages/db/tests/timing.test.ts` for
 *   `import_from_entries()`.
 */

describe('reading a gender off a roster row', () => {
  it.each([
    ['female', 'female'],
    ['male', 'male'],
    ['non_binary', 'non_binary'],
  ])('takes %j, which is what entries writes', (raw, expected) => {
    expect(normaliseTimingGender(raw)).toBe(expected);
  });

  /**
   * ⚠️ **The expand step, and it is temporary.** Pass the Buck 2026's archive spells it this
   * way and #206 has not imported it yet. When no row spells it the old way, this branch and
   * these cases go — and a check constraint can take over, which is the contract step.
   */
  it.each([
    ['M', 'male'],
    ['F', 'female'],
    ['m', 'male'],
    ['f', 'female'],
    ['  F  ', 'female'],
  ])('still takes the legacy %j from the Full On Sport CSV', (raw, expected) => {
    expect(normaliseTimingGender(raw)).toBe(expected);
  });

  /**
   * **Unrecognised means no band rather than a guess.** Guessing puts somebody in the wrong
   * prize category, which is discovered at the presentation rather than in a test.
   */
  it.each([[''], ['  '], ['X'], ['other'], ['Male/Female'], ['nonbinary'], ['NB']])(
    '%j is no answer rather than a guess',
    (raw) => {
      expect(normaliseTimingGender(raw)).toBeNull();
    },
  );

  it('treats a missing value as no answer', () => {
    expect(normaliseTimingGender(null)).toBeNull();
    expect(normaliseTimingGender(undefined)).toBeNull();
  });

  /**
   * `'nonbinary'` and `'NB'` above are refused deliberately: they are spellings nobody writes.
   * Accepting them would be this file inventing a third vocabulary to be helpful, which is
   * exactly what its header forbids — every spelling accepted here is one the contract step
   * has to chase down.
   */
  it('accepts only the spellings a writer actually produces', () => {
    expect(normaliseTimingGender('non-binary')).toBeNull();
  });
});

describe('where a result is placed', () => {
  it('places a female or male runner in their own category', () => {
    expect(placementFor('female', null)).toBe('female');
    expect(placementFor('male', null)).toBe('male');
    expect(placementFor('F', null)).toBe('female');
  });

  /**
   * ⚠️ **The gap ADR-031 closed in `entries` and that this stops re-opening in `timing`.**
   * Before the placement was carried across, a non-binary runner had no band on the timing
   * side at all and fell to `null` — permanently "not confirmed", with no way to change it.
   */
  it('places a non-binary runner where they asked to be placed', () => {
    expect(placementFor('non_binary', 'female')).toBe('female');
    expect(placementFor('non_binary', 'male')).toBe('male');
  });

  /**
   * **A non-binary entrant who was asked and said neither, or was never asked, is not placed**
   * — and that is an answer rather than a failure. The race is run under two categories and
   * a genuine third is still the committee's decision.
   */
  it('does not place a non-binary runner who did not choose', () => {
    expect(placementFor('non_binary', null)).toBeNull();
  });

  /**
   * A placement on a female or male runner is refused by
   * `entrants_result_placement_only_non_binary` in the database, so it should not exist — but
   * if one ever arrived it must not override the gender somebody recorded.
   */
  it('ignores a placement on somebody who is not non-binary', () => {
    expect(placementFor('female', 'male')).toBe('female');
    expect(placementFor('male', 'female')).toBe('male');
  });

  it('places nobody it cannot read a gender for', () => {
    expect(placementFor('', null)).toBeNull();
    expect(placementFor('X', 'female')).toBeNull();
    expect(placementFor(null, 'male')).toBeNull();
  });
});
