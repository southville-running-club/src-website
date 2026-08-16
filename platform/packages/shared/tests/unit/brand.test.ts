import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CLUB_LOGO, SITE_BANNER } from '../../src/brand.js';
import { contrastRatio } from '../../src/contrast.js';
import tokens from '../../design-tokens.json' with { type: 'json' };

/**
 * The brand, held to what it claims about itself.
 *
 * Three separate things could drift apart here, and each one fails silently in a way nobody
 * would notice from looking at a page:
 *
 *   1. `tokens.css` and `design-tokens.json` are the same palette written twice — the CSS is
 *      what ships, the JSON is what `/brand/` renders and what can be diffed against
 *      `bindalshah/src-race-timing`. A value changed in one and not the other means the page
 *      documenting the brand is lying about the brand.
 *   2. The **contrast ratios**. Every one of them used to be a number somebody had worked out
 *      once and typed into a comment, which is exactly the kind of thing that survives the
 *      colour change that made it false. These are recomputed from the values themselves.
 *   3. `logo.svg` and `brand.ts` are the same artwork twice — the standalone asset served at
 *      `/logo.svg`, and the geometry both apps render inline.
 *
 * The negative cases matter more than the positive ones here. That the brand green *fails*
 * as body text is the fact that decided the whole palette's shape, so it is asserted rather
 * than assumed: if somebody later "fixes" it by making `--src-green` darker, the token stops
 * being the club's colour and this test is what says so.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const tokensCss = read('../../styles/tokens.css');
const baseCss = read('../../styles/base.css');
const logoSvg = read('../../../../apps/main/public/logo.svg');

/** Every `--src-*: value;` declaration in `tokens.css`, as a map. */
function cssTokens(): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tokensCss.matchAll(/(--src-[a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

const CSS = cssTokens();

/** The pairs that carry text, and the floor each has to clear. */
const TEXT_PAIRS: Array<[string, string, string, number]> = [
  ['body text on the page', tokens.color.ink.value, tokens.color.paper.value, 7],
  ['muted text on the page', tokens.color.slate.value, tokens.color.paper.value, 7],
  ['links on the page', tokens.color.greenText.value, tokens.color.paper.value, 7],
  ['errors on the page', tokens.color.error.value, tokens.color.paper.value, 7],
  ['banner text', tokens.color.ink.value, tokens.color.band.value, 7],
  ['banner links', tokens.color.greenText.value, tokens.color.band.value, 7],
  ['white on a filled button', '#ffffff', tokens.color.greenText.value, 7],
  ['body text, dark', '#f2f2f0', tokens.color.paperDark.value, 7],
  ['muted text, dark', tokens.color.slateDark.value, tokens.color.paperDark.value, 7],
  ['links, dark', tokens.color.greenTextDark.value, tokens.color.paperDark.value, 7],
  ['errors, dark', tokens.color.errorDark.value, tokens.color.paperDark.value, 7],
  [
    'banner links, dark',
    tokens.color.greenTextDark.value,
    tokens.color.bandDark.value,
    7,
  ],
];

describe('the token layer', () => {
  it('says the same thing in CSS as it does in JSON', () => {
    // The JSON key is the CSS name without its prefix, camelCased: `--src-green-text` is
    // `color.greenText`. Spelled out rather than derived, so a rename has to be made in a
    // diff rather than silently absorbed by a clever regex.
    const pairs: Array<[string, string]> = [
      ['--src-green', tokens.color.green.value],
      ['--src-green-text', tokens.color.greenText.value],
      ['--src-green-text-dark', tokens.color.greenTextDark.value],
      ['--src-ink', tokens.color.ink.value],
      ['--src-slate', tokens.color.slate.value],
      ['--src-slate-dark', tokens.color.slateDark.value],
      ['--src-error', tokens.color.error.value],
      ['--src-error-dark', tokens.color.errorDark.value],
      ['--src-paper', tokens.color.paper.value],
      ['--src-paper-dark', tokens.color.paperDark.value],
      ['--src-band', tokens.color.band.value],
      ['--src-band-dark', tokens.color.bandDark.value],
      ['--src-rule', tokens.color.rule.value],
      ['--src-rule-dark', tokens.color.ruleDark.value],
      ['--src-radius-button', tokens.radius.button.value],
      ['--src-radius-card', tokens.radius.card.value],
    ];

    for (const [cssName, jsonValue] of pairs) {
      expect(CSS.get(cssName), `${cssName} is missing from tokens.css`).toBeDefined();
      expect(
        CSS.get(cssName)!.toLowerCase(),
        `${cssName} disagrees with design-tokens.json`,
      ).toBe(jsonValue.toLowerCase());
    }
  });

  it('is what base.css builds its semantic names out of', () => {
    // The two-layer split is the thing that keeps a colour decision in one place. A page
    // reaching past the semantic names for `--src-green` would be a page deciding for itself
    // that a green belongs there, which is exactly what this arrangement is meant to prevent.
    expect(baseCss).toContain("@import './tokens.css'");
    expect(baseCss).toContain('--colour-accent: var(--src-green-text)');
    expect(baseCss).toContain('--colour-banner-mark: var(--src-green)');
    expect(baseCss).toContain('--colour-muted: var(--src-slate)');
  });
});

describe('contrast', () => {
  it.each(TEXT_PAIRS)('%s clears AAA', (_name, fg, bg, floor) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(floor);
  });

  it('did not cost contrast anywhere, against the invented palette it replaced', () => {
    // The greens before this change were `#16543f` and `#6fd3a8`, chosen for legibility
    // rather than for being the club's. Adopting the real brand had to be free: if the club's
    // own colour had made a single pair worse, that would have been a trade to put to a human
    // rather than a diff to merge.
    const before: Array<[string, string, string]> = [
      ['#16543f', tokens.color.greenText.value, tokens.color.paper.value],
      ['#16543f', tokens.color.greenText.value, tokens.color.band.value],
      ['#6fd3a8', tokens.color.greenTextDark.value, tokens.color.paperDark.value],
      ['#6fd3a8', tokens.color.greenTextDark.value, tokens.color.bandDark.value],
      ['#58585d', tokens.color.slate.value, tokens.color.paper.value],
    ];

    for (const [old, now, bg] of before) {
      expect(
        contrastRatio(now, bg),
        `${now} on ${bg} is worse than ${old} was`,
      ).toBeGreaterThanOrEqual(contrastRatio(old, bg));
    }
  });

  it('keeps the brand green out of text, which is why the derived greens exist at all', () => {
    // **The negative case, and the load-bearing one.** #209D50 is 3.44:1 on the page: legal
    // for large text and for non-text UI, legal for a logotype because WCAG exempts those,
    // and illegal for anything anybody has to read. Every derived value above exists because
    // of this number. If it ever clears 4.5:1, `--src-green` has stopped being the colour
    // that was measured off the club's own site and the palette needs rederiving.
    const onPaper = contrastRatio(tokens.color.green.value, tokens.color.paper.value);
    expect(onPaper).toBeLessThan(4.5);
    expect(onPaper).toBeGreaterThanOrEqual(3);
  });

  it('refuses the timing app’s danger red, and the number is the reason', () => {
    // Recorded as a test rather than as a comment because "we looked at it and said no" is
    // not something a future diff can check. #e53935 is what `bindalshah/src-race-timing`
    // carries as `color.danger`; it is large-text-only here, and error text on the entry form
    // is body size.
    expect(contrastRatio('#e53935', tokens.color.paper.value)).toBeLessThan(4.5);
    expect(
      contrastRatio(tokens.color.error.value, tokens.color.paper.value),
    ).toBeGreaterThanOrEqual(7);
  });

  it('gives the wordmark the brighter green on the dark band, and not because it had to', () => {
    // Worth pinning precisely because it is *not* forced. The brand green is legible on the
    // dark band at 4.23:1 — above the 3:1 non-text floor, and exempt anyway as a logotype —
    // so swapping it is a decision about coherence, not a rescue: `--src-green-text-dark` is
    // what every link in the dark scheme already is. Asserting both numbers keeps the
    // reasoning in `base.css` honest, since the tempting comment to write here is "the brand
    // green would be invisible", and that is false.
    expect(
      contrastRatio(tokens.color.green.value, tokens.color.bandDark.value),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(tokens.color.greenTextDark.value, tokens.color.bandDark.value),
    ).toBeGreaterThan(
      contrastRatio(tokens.color.green.value, tokens.color.bandDark.value),
    );
  });
});

describe('the wordmark', () => {
  it('is the same artwork in brand.ts as in the file served at /logo.svg', () => {
    expect(logoSvg).toContain(`viewBox="${CLUB_LOGO.viewBox}"`);
    for (const path of CLUB_LOGO.paths) {
      expect(logoSvg, 'a path in brand.ts is not in logo.svg').toContain(path.d);
      expect(logoSvg).toContain(path.transform);
    }
    // Both paths and no more — an extra one in the file would be artwork the apps never draw.
    expect(logoSvg.match(/<path\b/g)).toHaveLength(CLUB_LOGO.paths.length);
  });

  it('carries no colour of its own in the data the apps render', () => {
    // The whole reason the mark could only ever appear on the Nightingale Nightmare hero was
    // that its fill was baked in. Nothing in `brand.ts` may name a colour: the apps fill every
    // path with `currentColor`, and CSS decides.
    const asJson = JSON.stringify(CLUB_LOGO);
    expect(asJson).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(asJson).not.toMatch(/\bfill\b/i);
  });

  it('is the club’s own artwork, at the club’s own dimensions', () => {
    // The official PNG on southvillerunningclub.co.uk is 876x267. This trace matching it
    // exactly is the evidence that it *is* the club's wordmark rather than a lookalike.
    expect(CLUB_LOGO.viewBox).toBe('0 0 876 267');
    expect(CLUB_LOGO.title).toBe('Southville Running Club');
  });
});

describe('the site banner copy', () => {
  it('names the club website and says what is missing', () => {
    // Both front doors render these strings and nothing else, so this is the only place the
    // words exist. `apps/main/tests/worker/serves.test.ts` checks they reach the page.
    expect(SITE_BANNER.clubWebsite).toBe('https://southvillerunningclub.co.uk');
    expect(SITE_BANNER.welcome).toContain('Southville Running Club');
    expect(SITE_BANNER.scope).toContain('Nightingale Nightmare');
    // The link text has to say where it goes when read out of a link list on its own.
    expect(SITE_BANNER.clubWebsiteLabel.toLowerCase()).toContain('old site');
  });
});
