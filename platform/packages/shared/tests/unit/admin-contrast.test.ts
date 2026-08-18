import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex } from '../../src/contrast.js';
import tokens from '../../design-tokens.json' with { type: 'json' };

/**
 * Every colour pair the admin surface invents, held to a number nobody typed.
 *
 * ## Why this file exists separately from `brand.test.ts`
 *
 * That one asserts the **palette**: the tokens, and the pairs the public pages make out of them.
 * This one asserts the **washes** — `nn-admin.css` tints four surfaces and two warning boxes by
 * mixing a token into the page colour, and a mix is a colour that exists in neither file.
 *
 * The approved design wrote them as literals: `rgba(0, 200, 90, 0.14)` behind "Paid",
 * `rgba(255, 176, 32, 0.18)` behind "Held", `#7A4E00` for the text on top. Each of those would be
 * a new colour in this repository, computed by nobody, and **wrong in dark mode**, where the page
 * behind the wash is not white. `color-mix(in srgb, <token> N%, var(--colour-background))` is the
 * same wash derived from a token, and it re-derives itself when the scheme flips.
 *
 * ## The percentages are read out of the stylesheet, not repeated here
 *
 * That is the part that makes this a guard rather than a second opinion. The test finds every
 * `color-mix` in `nn-admin.css`, resolves both operands per scheme, mixes them the way a browser
 * does, and puts the result through `contrast.ts`. So **a tint added without a passing pair fails
 * here**, and a percentage nudged for looks is re-checked automatically. No ratio in this file, in
 * `nn-admin.css`, or in `nn-admin.ts` is written by hand.
 *
 * ## The negative case is the interesting one, and it is asserted
 *
 * The capacity bar's amber fill does **not** clear WCAG's 3:1 floor for non-text UI on a light
 * page — 1.68:1 there, against 7.61:1 on a dark one. That is deliberate rather than unnoticed, and
 * it is pinned below in the same shape `brand.test.ts` pins the brand green *failing* as body
 * text: the number is what decided the design around it, so a change to it should come back here
 * rather than pass quietly.
 *
 * **The green fill does clear it, at 6.48:1, and that is also asserted** — because it only does so
 * thanks to the stylesheet using the text-safe green rather than the raw brand green the approved
 * design filled the bar with, which measures 2.05:1. Without the assertion, "simplifying" it back
 * would be invisible.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const adminCss = read('../../styles/nn-admin.css');

/** This repository's target for anything carrying text. `brand.test.ts` sets the same bar. */
const AAA = 7;

/**
 * What each `--colour-*` name resolves to, per scheme.
 *
 * Taken from `design-tokens.json` rather than by parsing `base.css`'s two `:root` blocks:
 * `brand.test.ts` already fails if the JSON and the CSS disagree, so reading the JSON here is
 * reading the same palette through a check that is somebody else's job to keep passing.
 *
 * **`--colour-surface-muted` is absent on purpose.** `base.css` does not redefine it under
 * `prefers-color-scheme: dark`, so it is the one semantic name that would be a light colour on a
 * dark page — which is exactly why `.admin` maps `--admin-page` and `--admin-track` off it in the
 * light scheme only, and derives both from `--colour-background` in the dark one.
 */
const SCHEMES = {
  light: {
    '--colour-background': tokens.color.paper.value,
    '--colour-text': tokens.color.ink.value,
    '--colour-muted': tokens.color.slate.value,
    '--colour-accent': tokens.color.greenText.value,
    '--colour-error': tokens.color.error.value,
    '--colour-danger': tokens.color.danger.value,
    '--colour-warning': tokens.color.warning.value,
    '--colour-rule': tokens.color.rule.value,
    '--admin-page': tokens.color.surfaceMuted.value,
    '--admin-track': tokens.color.surfaceMuted.value,
  },
  dark: {
    '--colour-background': tokens.color.paperDark.value,
    // `base.css` states this one as a literal rather than a primitive; so does `brand.test.ts`.
    '--colour-text': '#f2f2f0',
    '--colour-muted': tokens.color.slateDark.value,
    '--colour-accent': tokens.color.greenTextDark.value,
    '--colour-error': tokens.color.errorDark.value,
    '--colour-danger': tokens.color.danger.value,
    '--colour-warning': tokens.color.warning.value,
    '--colour-rule': tokens.color.ruleDark.value,
    '--admin-page': tokens.color.paperDark.value,
    '--admin-track': '',
  },
} as const;

type SchemeName = keyof typeof SCHEMES;

function resolve(scheme: SchemeName, name: string): string {
  const value = (SCHEMES[scheme] as Record<string, string>)[name];

  if (value === undefined || value === '') {
    throw new Error(`No ${scheme} value recorded for ${name}`);
  }

  return value;
}

/**
 * `color-mix(in srgb, a p%, b)`, the way a browser computes it.
 *
 * sRGB rather than a perceptual space, because that is what the stylesheet asks for — `in srgb`
 * is stated in every call. A channel-wise interpolation on the raw bytes is exactly what the
 * specification defines for it, so this is the same arithmetic rather than an approximation of it.
 */
function mix(a: string, percent: number, b: string): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const p = percent / 100;

  const channel = (x: number, y: number) =>
    Math.round(x * p + y * (1 - p))
      .toString(16)
      .padStart(2, '0');

  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/** `--admin-track`, which is a mix in the dark scheme and a plain token in the light one. */
function track(scheme: SchemeName): string {
  return scheme === 'light'
    ? resolve('light', '--admin-track')
    : mix(resolve('dark', '--colour-text'), 10, resolve('dark', '--colour-background'));
}

/** `--admin-card`, likewise. */
function card(scheme: SchemeName): string {
  return scheme === 'light'
    ? resolve('light', '--colour-background')
    : mix(resolve('dark', '--colour-text'), 4, resolve('dark', '--colour-background'));
}

/** `--admin-mast` and the ink on it. Inverted in light, lifted in dark. */
function masthead(scheme: SchemeName): { band: string; ink: string } {
  return scheme === 'light'
    ? {
        band: resolve('light', '--colour-text'),
        ink: resolve('light', '--colour-background'),
      }
    : {
        band: mix(
          resolve('dark', '--colour-text'),
          8,
          resolve('dark', '--colour-background'),
        ),
        ink: resolve('dark', '--colour-text'),
      };
}

interface Wash {
  token: string;
  percent: number;
  over: string;
  declaration: string;
}

/**
 * Every `color-mix` in `nn-admin.css`, found rather than listed.
 *
 * A listed set would be a second copy of the stylesheet's decisions, and the copy is what goes
 * stale. This is what makes "a tint added without a passing contrast pair fails this test" true.
 */
function washes(): Wash[] {
  const found: Wash[] = [];
  const pattern =
    /color-mix\(\s*in srgb,\s*var\((--[a-z-]+)\)\s*(\d+(?:\.\d+)?)%,\s*var\((--[a-z-]+)\)\s*\)/g;

  for (const match of adminCss.matchAll(pattern)) {
    const [declaration, token, percent, over] = match;
    if (token && percent && over) {
      found.push({
        token,
        percent: Number(percent),
        over,
        declaration,
      });
    }
  }

  return found;
}

const WASHES = washes();

describe('the washes the admin surface mixes', () => {
  it('finds them in the stylesheet at all', () => {
    // A regex that silently matches nothing would make every assertion below vacuous — the
    // failure mode this whole file exists to avoid. Six is what the stylesheet carries today:
    // two pills and filters, two chips, and the two warning boxes; plus three surface lifts that
    // only apply in the dark scheme.
    expect(WASHES.length).toBeGreaterThanOrEqual(6);
  });

  it('holds no hex value anywhere in the stylesheet', () => {
    // **The claim at the head of `nn-admin.css`, enforced.** Every colour on this surface is a
    // custom property, so a literal anywhere in the file — in a `color-mix`, in a print rule, in
    // a border — is a new colour introduced past the two-layer arrangement. It caught three in
    // the print block on its first run.
    expect(adminCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`carries text on every wash at AAA in the ${scheme} scheme`, () => {
      for (const wash of WASHES) {
        const mixed = mix(
          resolve(scheme, wash.token),
          wash.percent,
          resolve(scheme, wash.over),
        );
        const ratio = contrastRatio(resolve(scheme, '--colour-text'), mixed);

        expect(
          ratio,
          `--colour-text on ${wash.declaration} is ${ratio.toFixed(2)}:1 in the ${scheme} scheme`,
        ).toBeGreaterThanOrEqual(AAA);
      }
    });
  }
});

describe('the pairs that are not washes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`reads the masthead at AAA in the ${scheme} scheme`, () => {
      const { band, ink } = masthead(scheme);

      // **The band's own ink, not the brand green.** The design put "Sign out" in the green,
      // which measures under this target on a dark band; an underline is what makes it read as a
      // link instead, and it costs no contrast at all.
      expect(contrastRatio(ink, band)).toBeGreaterThanOrEqual(AAA);
    });

    it(`reads a spent chip and the page's own text at AAA in the ${scheme} scheme`, () => {
      // `.admin-chip-gone` — an expired hold. It keeps the page's own text colour rather than
      // dropping to `--colour-muted`, which measured 6.92:1 here in the light scheme and 5.96:1
      // in the dark. This is the assertion that found that.
      expect(
        contrastRatio(resolve(scheme, '--colour-text'), track(scheme)),
      ).toBeGreaterThanOrEqual(AAA);

      // The cards everything sits on.
      expect(
        contrastRatio(resolve(scheme, '--colour-text'), card(scheme)),
      ).toBeGreaterThanOrEqual(AAA);

      expect(
        contrastRatio(resolve(scheme, '--colour-muted'), card(scheme)),
      ).toBeGreaterThanOrEqual(AAA);
    });

    it(`reads the "needs a human" badge at AAA in the ${scheme} scheme`, () => {
      // Reversed out of the error colour — the one filled label on the page.
      expect(
        contrastRatio(
          resolve(scheme, '--colour-background'),
          resolve(scheme, '--colour-error'),
        ),
      ).toBeGreaterThanOrEqual(AAA);
    });
  }
});

/**
 * The capacity bar, and the one pair on this surface that does not clear a WCAG floor.
 *
 * Both directions are asserted, because the interesting fact is that **they differ**:
 *
 *   * the ordinary fill **passes**, and only because the stylesheet uses the text-safe green
 *     rather than the raw brand green the design filled it with. Pinning it is what stops
 *     somebody "simplifying" it back to `--src-green`, which measures 2.05:1 here;
 *   * the amber at full **fails in the light scheme and passes in the dark one** — 1.68:1 against
 *     a near-white track, 7.61:1 against a near-black one. So the accessibility question is a
 *     light-mode question only, and the light-mode answer is that the bar is `aria-hidden`, its
 *     track carries a rule so its extent survives without the hue, and every quantity it encodes
 *     is stated in words in the same panel. There is no darker amber in the palette to reach for:
 *     `tokens.css` is explicit that `--src-warning` is decorative and large-scale only.
 *
 * Asserting the failure is the same move `brand.test.ts` makes about the brand green as body
 * text: the number is what decided the shape of the thing around it, so a change to it should
 * come back here rather than pass quietly. If somebody darkens `--colour-warning` until this
 * passes, the token has stopped being `color.warning` from the adopted guideline, and
 * `brand.test.ts` will say so too.
 */
describe('the capacity bar', () => {
  const NON_TEXT_FLOOR = 3;

  it('fills the ordinary state with a green that clears the non-text floor', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const ratio = contrastRatio(resolve(scheme, '--colour-accent'), track(scheme));

      expect(
        ratio,
        `the bar's green is ${ratio.toFixed(2)}:1 against its track in the ${scheme} scheme`,
      ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
    }
  });

  it('fills the full state with an amber that clears the floor on a dark page', () => {
    // Amber on a near-black track is a strong contrast, so the full state is unambiguous for
    // anybody reading in dark mode. It is only the light scheme where it is not.
    const ratio = contrastRatio(resolve('dark', '--colour-warning'), track('dark'));

    expect(
      ratio,
      `the bar's amber is ${ratio.toFixed(2)}:1 against its track in the dark scheme`,
    ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
  });

  it('fills it with one that does not on a light page, which is why the words carry it', () => {
    // **The one pair on this surface below a WCAG floor**, and the reason the bar is
    // `aria-hidden`, its track is ruled, and the legend states every quantity in words. There is
    // no darker amber in the palette to reach for: `tokens.css` is explicit that `--src-warning`
    // is decorative and large-scale only, and ink on it — not it on a page — is how it is meant
    // to be read.
    const ratio = contrastRatio(resolve('light', '--colour-warning'), track('light'));

    expect(
      ratio,
      `the bar's amber is ${ratio.toFixed(2)}:1 against its track in the light scheme — if this now passes, the token changed`,
    ).toBeLessThan(NON_TEXT_FLOOR);
  });

  it('states every quantity the bar encodes in words as well', () => {
    // The guard for the sentence above. `legendItem` renders a count and a label for each, and
    // the figure itself is "N of M" in text — so the bar is reinforcement rather than the only
    // carrier. These are the labels `nn-admin.ts` writes.
    const workerSource = read('../../../../apps/main/worker/nn-admin.ts');

    for (const label of [
      'paid',
      'over capacity',
      'held right now',
      'holds expired and returned',
    ]) {
      expect(workerSource, `the legend must name "${label}" in words`).toContain(
        `'${label}'`,
      );
    }
  });
});
