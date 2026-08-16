/**
 * WCAG 2.2 relative luminance and contrast ratio.
 *
 * **This exists so no contrast figure in this repository is typed by hand.** `/brand/`
 * renders the palette with the ratios computed at build time, and `tests/brand.test.ts`
 * asserts the thresholds with the same function — so a colour cannot be changed without
 * either the page telling the truth about it or the test going red. Before this, every ratio
 * was a comment somebody had worked out once, and a comment is exactly the kind of thing that
 * survives a colour change.
 *
 * The formula is the one in WCAG 2.2 section 1.4.3, not an approximation of it.
 */

/** `#rgb` or `#rrggbb`, with or without the hash. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rounded the way the ratios are written in comments and rendered on `/brand/`. */
export function ratioLabel(a: string, b: string): string {
  return `${contrastRatio(a, b).toFixed(2)}:1`;
}

/**
 * What a ratio is good for.
 *
 * The thresholds are WCAG's: 4.5:1 for body text, 3:1 for large text and for non-text UI,
 * 7:1 for AAA. **A logotype has no threshold at all** — WCAG 1.4.3 exempts "text that is part
 * of a logo or brand name" — which is what lets the club's wordmark be the undiluted brand
 * green on the banner while nothing else on the page may be.
 */
export function contrastVerdict(ratio: number): 'AAA' | 'AA' | 'large only' | 'fails' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'large only';
  return 'fails';
}
