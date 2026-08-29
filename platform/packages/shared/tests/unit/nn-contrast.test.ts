import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../../src/contrast.js';

/**
 * The first contrast guard the campaign theme has ever had.
 *
 * ## Why it exists, and what it is not
 *
 * `nn-theme.css` opens with a table of colour pairs and their ratios, hand-written, and
 * **nothing recomputes it.** `brand.test.ts` covers the club palette and `admin-contrast.test.ts`
 * covers the admin washes; neither reads this file. So every number at the head of the campaign
 * stylesheet is its author's word, and one of them has already gone stale — the masthead rows
 * outlived the layout they described.
 *
 * This does not fix that table. It guards the one pair whose failure was found in a browser
 * rather than in a test, and it guards it in the shape that would have caught it.
 *
 * ## The failure it is a response to
 *
 * `NnSchedule` was written inside `race-day.astro`'s `.nn-card` and every colour in it assumes
 * white: the time is `--nn-blood` at a computed 9.01:1 *on that card*, and the row divider is
 * `--nn-card-muted`, chosen to be an almost-invisible line *on that card*. Rendering the same
 * component on the page gradient inverted both — the divider became the loudest thing in the
 * block, and the time became `#8f1b0f` on a `#8f1b0f` radial centre stop. **1:1 by identity: not
 * hard to read, absent.** Nothing went red, because nothing was looking.
 *
 * ## Why it reads the stylesheet instead of restating it
 *
 * A test that writes `expect(contrastRatio('#8f1b0f', '#ffffff'))` asserts arithmetic. The thing
 * worth asserting is **that the time is still stated against the surface the block actually
 * carries** — so both sides are resolved out of the CSS, through the token block that declares
 * them. Change the surface, change the colour, or delete either declaration, and this recomputes
 * and fails rather than going quietly vacuous. Only the floor is written here.
 */

const css = readFileSync(
  fileURLToPath(new URL('../../styles/nn-theme.css', import.meta.url)),
  'utf8',
);

/** This repository's bar for text. `brand.test.ts` and `admin-contrast.test.ts` use the same. */
const AAA = 7;

/**
 * The campaign palette, read out of the one block that declares it.
 *
 * `body.theme-nn` rather than `:root` on purpose — the specificity is load-bearing and the
 * stylesheet says why. If the tokens ever move, this throws rather than silently resolving
 * nothing.
 */
const tokens: ReadonlyMap<string, string> = (() => {
  const block = /body\.theme-nn\s*\{([\s\S]*?)\n\}/.exec(css);
  if (block?.[1] === undefined) {
    throw new Error('nn-theme.css no longer declares its tokens on `body.theme-nn`');
  }

  const found = new Map<string, string>();
  for (const match of block[1].matchAll(/(--nn-[a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
})();

/** The declaration body of one rule, found by its exact selector. Throws if it is gone. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\n${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (match?.[1] === undefined)
    throw new Error(`nn-theme.css has no rule for \`${selector}\``);
  return match[1];
};

/**
 * `background: var(--nn-card)` becomes `#ffffff`.
 *
 * **A literal fails here rather than being measured.** Every colour in this theme is a token,
 * and a hex typed straight into a rule is the thing that makes a palette stop being one — so
 * this refuses to resolve it rather than quietly asserting a number about it.
 */
const colourOf = (declarations: string, property: string): string => {
  const found = new RegExp(`(?:^|\\n)\\s*${property}:[^;]*var\\((--nn-[a-z-]+)\\)`).exec(
    declarations,
  );
  if (found?.[1] === undefined) {
    throw new Error(`expected \`${property}\` to be a var(--nn-*) token, not a literal`);
  }

  const value = tokens.get(found[1]);
  if (value === undefined) {
    throw new Error(`\`${found[1]}\` is not declared on \`body.theme-nn\``);
  }
  return value;
};

describe('the race-morning schedule', () => {
  const surface = colourOf(rule('.theme-nn .nn-schedule'), 'background');
  const time = colourOf(rule('.theme-nn .nn-schedule dt'), 'color');
  const detail = colourOf(rule('.theme-nn .nn-schedule'), 'color');

  it('states the time against the surface the block itself carries', () => {
    expect(contrastRatio(time, surface)).toBeGreaterThanOrEqual(AAA);
  });

  it('states the detail against that same surface', () => {
    expect(contrastRatio(detail, surface)).toBeGreaterThanOrEqual(AAA);
  });

  /**
   * The negative case, and the one that actually explains the surface.
   *
   * `--nn-blood` is both the time's colour and the centre stop of the page's radial background,
   * so a schedule with no surface of its own renders the time in the background's own colour.
   * Pinned as an identity rather than a threshold: it is not a near miss to be tightened, it is
   * the same colour twice, and if somebody ever changes one of the two this stops being true and
   * should be re-read rather than re-tuned.
   */
  it('would be invisible on the page gradient, which is why it carries a surface', () => {
    const gradientCentre = tokens.get('--nn-blood');
    expect(gradientCentre).toBeDefined();
    expect(contrastRatio(time, gradientCentre ?? '')).toBeCloseTo(1, 2);
  });

  /**
   * The divider is decorative and is *meant* to be barely there — but only on the surface it was
   * chosen against. The same 1.12:1 line on the gradient is a near-white rule on dark red, which
   * is the loudest thing in the block and the exact inversion this fix undoes. Asserting it stays
   * low keeps somebody from "fixing" its visibility on the wrong background.
   */
  it('keeps its row divider decorative rather than structural', () => {
    const divider = colourOf(rule('.theme-nn .nn-schedule-row'), 'border-bottom');
    expect(contrastRatio(divider, surface)).toBeLessThan(1.5);
  });

  /**
   * The half that keeps `/nn/2026/race-day/` unchanged.
   *
   * That page wraps its whole article body in `.nn-card`, so without this rule the schedule
   * would be a white card inside a white card. Deleting it is a visible change to a page nobody
   * intended to touch, and it would look like tidying.
   */
  it('takes its surface back off where a card already provides one', () => {
    const nested = rule('.theme-nn .nn-card .nn-schedule');
    expect(nested).toMatch(/background:\s*none/);
    expect(nested).toMatch(/padding:\s*0/);
  });
});

/**
 * The mono class exists so that a number can never be given the face without the figures.
 * `nn-admin.css`'s `.admin-mono` is its opposite number on the club surface.
 */
describe('the campaign mono class', () => {
  const figures = rule('.theme-nn .nn-figures');

  it('carries the face and its tabular figures together', () => {
    expect(figures).toMatch(/font-family:\s*var\(--nn-mono\)/);
    expect(figures).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(figures).toMatch(/font-feature-settings:\s*'tnum'/);
  });

  /**
   * **No weight, deliberately.** JetBrains Mono is declared `500 700`, so a rule that sets the
   * family and omits the weight computes to 400 — outside the axis, where the browser clamps
   * rather than rendering what was asked for. Five rules in this stylesheet already do that. If
   * this class set a weight it would make that decision silently for every future call site.
   */
  it('leaves the weight to the call site, because the axis starts at 500', () => {
    expect(figures).not.toMatch(/font-weight/);
  });
});
