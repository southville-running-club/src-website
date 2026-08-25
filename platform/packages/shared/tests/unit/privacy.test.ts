import { describe, expect, it } from 'vitest';
import { TO_BE_CONFIRMED, orTbc } from '../../src/privacy';

/**
 * The marker both notices print, and the two failures it exists to prevent.
 *
 * The acceptance suites are what count the markers on a rendered page. This is the layer
 * below: that a `null` becomes the sentence rather than the string `"null"`, and that an
 * empty string — which a content file can acquire by somebody deleting a value rather than
 * setting it to `null` — is *not* quietly treated as a fact.
 */
describe('the marker for a value the committee has not settled', () => {
  it('is words, not a blank', () => {
    // The whole point. `''` and `'—'` both read as "there is nothing here"; this reads as
    // "somebody has to decide this", which is what is actually true.
    expect(orTbc(null)).toBe(TO_BE_CONFIRMED);
    expect(TO_BE_CONFIRMED).toMatch(/confirmed by the club/i);
  });

  it('hands back a settled fact untouched', () => {
    // No trimming, no lower-casing, no full stop added. The sentences around it are written
    // to read correctly with whatever the content file holds — see section 4 of
    // `/nn/privacy/`, which stopped lower-casing what it was given for this reason.
    expect(orTbc('One month after the race')).toBe('One month after the race');
  });

  it('does not treat an empty string as an answer', () => {
    // **The failure this catches is the quiet one.** `??` only falls through on `null` and
    // `undefined`, so an empty string would render an empty cell — a notice that reads as
    // though nothing is collected for that row, with the marker count on the page unchanged
    // and every test still green. Stated here so the behaviour is a decision rather than an
    // accident of the operator: an empty value is not a fact, and it must not print as one.
    expect(orTbc('')).not.toBe('');
    expect(orTbc('')).toBe(TO_BE_CONFIRMED);
  });
});
