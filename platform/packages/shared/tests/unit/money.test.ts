import { describe, expect, it } from 'vitest';

import { formatPence, formatPriceWords } from '../../src/money.js';

/**
 * `money.ts` had no test file of its own.
 *
 * `formatPence` was covered incidentally — `entry-reference.test.ts`, `events.test.ts` and
 * `admin-events.test.ts` all assert strings it produced — but nothing asserted the function
 * directly, so its two branches were only ever exercised through a caller. Adding a second
 * renderer beside it is the moment that stops being good enough: the whole risk of this change
 * is that the two are confused for one another, and the only thing that can say they are not
 * is a test that states both rules side by side.
 */

describe('formatPence', () => {
  /**
   * ⚠️ **These assertions exist to fail if `formatPence` is "tidied" to match its new
   * neighbour.** It is the money path's renderer: an entry fee, a refund notice, a receipt,
   * an admin column. Uniform two-decimal output is the property those want, and `50p` in a
   * column of `£18.00`s is the defect.
   */
  it('renders pounds and pence, always with both decimals', () => {
    expect(formatPence(1800)).toBe('£18.00');
    expect(formatPence(2000)).toBe('£20.00');
    expect(formatPence(250)).toBe('£2.50');
    expect(formatPence(50)).toBe('£0.50');
    expect(formatPence(5)).toBe('£0.05');
  });

  /** Zero is a price of nothing, which is what a visually impaired guide's place is. */
  it('renders zero as Free', () => {
    expect(formatPence(0)).toBe('Free');
  });

  /** The `£` belongs to this function. A template that writes its own renders `££18.00`. */
  it('carries the pound sign itself', () => {
    expect(formatPence(400).startsWith('£')).toBe(true);
  });
});

describe('formatPriceWords', () => {
  /**
   * The club's own voice, for the club's own pages.
   *
   * The membership page's heading is *"Run for 50p. Join for £4."* Through `formatPence` that
   * reads *"Run for £0.50. Join for £4.00."*, which is not a formatting preference but a
   * different sentence.
   */
  it('says pence in pence', () => {
    expect(formatPriceWords(50)).toBe('50p');
    expect(formatPriceWords(99)).toBe('99p');
    expect(formatPriceWords(5)).toBe('5p');
  });

  it('drops the decimals from a whole number of pounds', () => {
    expect(formatPriceWords(400)).toBe('£4');
    expect(formatPriceWords(2300)).toBe('£23');
    expect(formatPriceWords(1800)).toBe('£18');
  });

  it('keeps them when there is something after the point', () => {
    expect(formatPriceWords(250)).toBe('£2.50');
    expect(formatPriceWords(2350)).toBe('£23.50');
    expect(formatPriceWords(105)).toBe('£1.05');
  });

  /** The one place the two agree, and deliberately so: zero is `Free` on both surfaces. */
  it('agrees with formatPence about zero', () => {
    expect(formatPriceWords(0)).toBe('Free');
    expect(formatPriceWords(0)).toBe(formatPence(0));
  });

  /**
   * ⚠️ **The boundary, which is the only interesting arithmetic here.**
   *
   * 99 and 100 are a pence string and a pounds string, and an off-by-one in either direction
   * gives `100p` or `£0.99` — both of which look plausible enough in a diff to survive review.
   */
  it('turns over at a pound', () => {
    expect(formatPriceWords(99)).toBe('99p');
    expect(formatPriceWords(100)).toBe('£1');
    expect(formatPriceWords(101)).toBe('£1.01');
  });

  /**
   * The two renderers must not converge.
   *
   * If somebody later "simplifies" `formatPriceWords` into a call to `formatPence`, every
   * assertion above still has to fail — but this one says *why* in one line, at the level of
   * the decision rather than of a string.
   */
  it('is a different rendering from formatPence wherever it matters', () => {
    for (const pence of [50, 400, 2300]) {
      expect(formatPriceWords(pence)).not.toBe(formatPence(pence));
    }
  });
});
