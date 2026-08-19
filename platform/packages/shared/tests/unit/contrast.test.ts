import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  contrastVerdict,
  luminance,
  parseHex,
  ratioLabel,
} from '../../src/contrast.js';

/**
 * The two functions that turn a ratio into a claim.
 *
 * `admin-contrast.test.ts` asserts the ratios of the admin surface's own washes, and
 * `brand.test.ts` asserts the palette's. Both use `contrastRatio`. **Neither touches the two
 * functions that decide what a ratio is good for** — and those are what `/brand/` renders: the
 * page prints `ratioLabel` beside every swatch and `contrastVerdict` beneath it, so a wrong
 * boundary here is a page telling a volunteer that a colour passes AA when it does not.
 *
 * The thresholds are WCAG 2.2's, and the interesting values are the four boundaries
 * themselves — 3, 4.5 and 7 — because a `>` written where a `>=` belongs is invisible
 * everywhere else.
 */

describe('the ratio as it is written down', () => {
  it('rounds to two places and names the unit', () => {
    // The form the ratios are written in on `/brand/` and in every comment that quotes one.
    expect(ratioLabel('#000000', '#ffffff')).toBe('21.00:1');
    expect(ratioLabel('#ffffff', '#ffffff')).toBe('1.00:1');
  });

  it('does not care which way round the two colours are given', () => {
    // The formula takes the lighter over the darker, so a caller cannot get a ratio below 1 by
    // passing them in the order the design happens to describe them.
    expect(ratioLabel('#ffffff', '#000000')).toBe(ratioLabel('#000000', '#ffffff'));
  });

  it('agrees with the ratio it is a label for', () => {
    // Written as a relationship rather than a second constant, so the two cannot drift.
    const ratio = contrastRatio('#1a1a1a', '#f5f5f5');
    expect(ratioLabel('#1a1a1a', '#f5f5f5')).toBe(`${ratio.toFixed(2)}:1`);
  });
});

describe('what a ratio is good for', () => {
  it('calls 7:1 and above AAA', () => {
    expect(contrastVerdict(7)).toBe('AAA');
    expect(contrastVerdict(21)).toBe('AAA');
  });

  it('calls 4.5:1 up to 7:1 AA', () => {
    expect(contrastVerdict(4.5)).toBe('AA');
    expect(contrastVerdict(6.99)).toBe('AA');
  });

  it('calls 3:1 up to 4.5:1 large text only', () => {
    // 3:1 is also the threshold for non-text UI — a focus ring, a border that carries meaning.
    expect(contrastVerdict(3)).toBe('large only');
    expect(contrastVerdict(4.49)).toBe('large only');
  });

  it('fails anything below 3:1', () => {
    expect(contrastVerdict(2.99)).toBe('fails');
    expect(contrastVerdict(1)).toBe('fails');
  });

  it('puts each boundary on the passing side, which is where WCAG puts it', () => {
    // **The assertion this file exists for.** WCAG says "at least", so exactly 4.5:1 passes AA.
    // A `>` where a `>=` belongs would show up nowhere else: every real colour in the palette
    // is comfortably clear of a boundary, so the page would go on looking right.
    expect(contrastVerdict(3)).not.toBe('fails');
    expect(contrastVerdict(4.5)).not.toBe('large only');
    expect(contrastVerdict(7)).not.toBe('AA');
  });
});

describe('reading a colour', () => {
  it('takes the short form, the long form, and either with or without the hash', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
    expect(parseHex('  #0a0b0c  ')).toEqual([10, 11, 12]);
  });

  it('throws on anything that is not a colour, rather than computing a ratio for it', () => {
    // A silent zero here would be a contrast figure rendered on `/brand/` for a token that does
    // not exist — a number that looks computed and means nothing.
    expect(() => parseHex('#gggggg')).toThrow('Not a hex colour');
    expect(() => parseHex('rebeccapurple')).toThrow('Not a hex colour');
    expect(() => parseHex('#ffff')).toThrow('Not a hex colour');
    expect(() => parseHex('')).toThrow('Not a hex colour');
  });

  it('takes both sides of the luminance curve', () => {
    // The formula has a linear segment below 0.04045 and a power curve above it, and the two
    // are easy to write the wrong way round. Black and white pin the ends; `#0a0a0a` sits on
    // the linear side and `#808080` on the curved one.
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
    expect(luminance('#0a0a0a')).toBeGreaterThan(0);
    expect(luminance('#0a0a0a')).toBeLessThan(luminance('#808080'));
  });
});
