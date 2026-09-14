import { describe, expect, it } from 'vitest';

import { contrastRatio, formatRatio, ratioLabel } from '../../src/contrast.js';

/**
 * How a contrast ratio is written down, asserted rather than assumed.
 *
 * `contrastRatio()` itself is exercised all over `brand.test.ts`, `admin-contrast.test.ts` and
 * `nn-contrast.test.ts`, which is why there was no file here. **The formatter had no test at
 * all** — and it is what `/brand/` publishes and what four failure messages in
 * `admin-contrast.test.ts` used to re-implement by hand. Issue
 * [#175](https://github.com/southville-running-club/src-website/issues/175).
 */
describe('formatRatio', () => {
  it('is two decimal places and a ":1"', () => {
    expect(formatRatio(4.5)).toBe('4.50:1');
    expect(formatRatio(21)).toBe('21.00:1');
    expect(formatRatio(1)).toBe('1.00:1');
  });

  it('rounds rather than truncating, and keeps the second place when it is a zero', () => {
    // The trailing zero matters: a column of ratios is read down, and "7:1" beside "4.53:1"
    // reads as a different kind of number.
    expect(formatRatio(4.567)).toBe('4.57:1');
    expect(formatRatio(9.004)).toBe('9.00:1');
  });
});

describe('ratioLabel', () => {
  it('is formatRatio over the measured pair, and not a second implementation of it', () => {
    // The property the four failure messages now rely on: one formatter, whether the caller
    // holds the two colours or the number they produced.
    expect(ratioLabel('#000000', '#ffffff')).toBe('21.00:1');
    expect(ratioLabel('#ffffff', '#ffffff')).toBe('1.00:1');

    const green = '#00c85a';
    const paper = '#ffffff';
    expect(ratioLabel(green, paper)).toBe(formatRatio(contrastRatio(green, paper)));
  });
});
