import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex } from '../../src/contrast.js';

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

/**
 * Every innermost rule in the stylesheet, as a selector list and its declarations.
 *
 * Comments are stripped first, because several of this file's contain braces. The pattern then
 * matches only blocks whose body has no braces of its own, which is what makes it skip an
 * `@media` wrapper and find the rules inside it — the alternative, anchoring on a selector at
 * the start of a line, cannot see a rule that shares its declarations with others.
 *
 * That matters here rather than being tidiness: the mono voice is one rule over seven
 * selectors, and a helper that only recognised a selector sitting alone would have reported it
 * missing and failed for the wrong reason.
 */
const rules: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = (() => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Array<readonly [ReadonlyArray<string>, string]> = [];

  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const [, selectors, declarations] = match;
    if (selectors === undefined || declarations === undefined) continue;
    found.push([
      selectors
        .split(',')
        .map((one) => one.trim().replace(/\s+/g, ' '))
        .filter((one) => one !== ''),
      declarations,
    ]);
  }
  return found;
})();

/** The declarations of the rule carrying this exact selector. Throws if it is gone. */
const rule = (selector: string): string => {
  const found = rules.find(([selectors]) => selectors.includes(selector));
  if (found === undefined)
    throw new Error(`nn-theme.css has no rule for \`${selector}\``);
  return found[1];
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
 * The consolidated year page's own surfaces.
 *
 * Everything here is new colour work, so all of it is computed rather than asserted from a
 * comment. Two of these pairings changed *because* of this test rather than after it: the
 * jump-nav's links were going to be dimmed with a `color-mix` that measured 5.64:1, and the
 * copy placeholders were going to be gold text at 5.44:1. Both are AA against a bar this
 * repository sets at AAA, and both were redesigned before they were written — the links kept
 * full `bone`, and the placeholder moved its signal to a border, which is non-text and has a
 * 3:1 floor rather than a 7:1 one.
 *
 * That is the whole argument for computing first: neither would have been caught by looking,
 * because both look fine.
 */
describe('the consolidated year page', () => {
  const card = colourOf(rule('.theme-nn .nn-card'), 'background');
  const gradient = tokens.get('--nn-blood') ?? '';

  it('states the entry label in the accent that works on a card', () => {
    const label = colourOf(rule('.theme-nn .nn-entry-card-label'), 'color');
    expect(contrastRatio(label, card)).toBeGreaterThanOrEqual(AAA);
  });

  it('states the fee, which is the number somebody compares', () => {
    const fee = colourOf(rule('.theme-nn .nn-entry-card-fee'), 'color');
    expect(contrastRatio(fee, card)).toBeGreaterThanOrEqual(AAA);
  });

  it('states the entry window quietly but not faintly', () => {
    const term = colourOf(rule('.theme-nn .nn-entry-card-when dt'), 'color');
    expect(contrastRatio(term, card)).toBeGreaterThanOrEqual(AAA);
  });

  /**
   * **The pairing that decided the jump-nav's design.** Dimming these links to subordinate
   * them to the masthead measured 5.64:1 against the gradient's centre stop, so the
   * subordination is carried by size, weight and the absence of a background band instead.
   * Asserting full brightness here is what stops somebody reintroducing the dim for looks.
   */
  it('keeps the jump-nav links at full brightness on the gradient', () => {
    const link = colourOf(rule('.theme-nn .nn-jump-links a'), 'color');
    expect(contrastRatio(link, gradient)).toBeGreaterThanOrEqual(AAA);
  });

  /**
   * The placeholder's text is what has to be readable; its border is what has to be
   * unmissable. They are held to different floors on purpose — 7:1 for the words, WCAG's 3:1
   * for a non-text indicator — which is exactly why the signal moved to the border.
   */
  it('marks unwritten copy legibly, and its border loudly', () => {
    const declarations = rule('.theme-nn .nn-placeholder');
    expect(
      contrastRatio(colourOf(declarations, 'color'), gradient),
    ).toBeGreaterThanOrEqual(AAA);
    expect(
      contrastRatio(colourOf(declarations, 'border'), gradient),
    ).toBeGreaterThanOrEqual(3);
  });

  /**
   * **The closing line was asked for in white, and that is why the yellow band went.**
   *
   * `--nn-bone` on `--nn-pus` measures **1.55:1** — not a near miss, and the same shape as the
   * schedule that rendered invisible on the gradient. So the band was removed rather than the
   * colour refused, and the line sits on the page background the way the hero does.
   *
   * Asserted against the gradient because it no longer has a surface of its own, and the
   * absence of a background is asserted alongside it — re-introducing a band under white text
   * would put 1.55:1 back, and it should fail here rather than in somebody's eyes.
   */
  it('states the closing line against the page, now that it has no band', () => {
    const declarations = rule('.theme-nn .nn-closing');

    expect(declarations).not.toMatch(/background/);
    expect(
      contrastRatio(colourOf(declarations, 'color'), gradient),
    ).toBeGreaterThanOrEqual(AAA);
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

/**
 * The year panel, which moved from a white card onto the campaign's aubergine.
 *
 * ## Why this block exists at all
 *
 * The panel was `.nn-card` — white — and every colour inside it was chosen against white. The
 * club asked for it in aubergine, and that request is a colour change to **every line in it**
 * rather than one background declaration. What the old colours became on the new surface:
 *
 *   the date and the facts   `--nn-ink`     18.09:1 on white  ->  **1.17:1**
 *   the label and the note   `--nn-slate`    8.30:1 on white  ->  **1.87:1**
 *   the two year links       `--nn-blood`    9.01:1 on white  ->  **1.72:1**
 *
 * 1.17:1 is not "hard to read". It is the date of the race — the largest thing on the panel and
 * the one question somebody arrives with — rendered in a colour that cannot be resolved from the
 * panel behind it. **This is `NnSchedule`'s defect exactly**, one component along, and it is the
 * third time this stylesheet has met it. So it is guarded the same way, by resolving both sides
 * out of the CSS rather than restating a number: change the surface, change a colour, or delete
 * either declaration and this recomputes and fails.
 */
describe('the year panel on aubergine', () => {
  const surface = colourOf(rule('.theme-nn .nn-panel'), 'background');

  const pairs = [
    ['the date', '.theme-nn .nn-panel-year .nn-panel-date'],
    ['the facts line', '.theme-nn .nn-panel-year .nn-panel-facts'],
    ['the label', '.theme-nn .nn-panel-year .nn-panel-label'],
    ['the entries note', '.theme-nn .nn-panel.nn-panel-year .nn-panel-note'],
    ['the two year links', '.theme-nn .nn-panel-links a'],
    ['the action while entries are shut', '.theme-nn .nn-panel-year .nn-ghost'],
  ] as const;

  for (const [what, selector] of pairs) {
    it(`states ${what} against the surface the panel carries`, () => {
      expect(
        contrastRatio(colourOf(rule(selector), 'color'), surface),
      ).toBeGreaterThanOrEqual(AAA);
    });
  }

  /**
   * The negative case, and the one that explains why the block above is not arithmetic.
   *
   * `--nn-ink` and `--nn-blood` are what these lines used to be, and both are still declared and
   * still correct **on white**. Pinned as thresholds rather than identities: they are not near
   * misses to be tightened, they are the measurements that say why every colour above had to
   * change. If somebody restores one of them here, the block above goes red — this says what
   * they would be restoring.
   */
  it('would lose the date entirely in the colour it used to be', () => {
    const ink = tokens.get('--nn-ink');
    expect(ink).toBeDefined();
    expect(contrastRatio(ink ?? '', surface)).toBeLessThan(1.5);
  });

  it('would lose the year links in the colour they used to be', () => {
    const blood = tokens.get('--nn-blood');
    expect(blood).toBeDefined();
    expect(contrastRatio(blood ?? '', surface)).toBeLessThan(2);
  });

  /**
   * The action's border, which is a control rather than text and carries the lower bar.
   *
   * **It is the same token as its label**, so this is not a second colour to keep in step — it
   * is the assertion that the button still has an edge at all. `.nn-ghost` is `background:
   * transparent` by design, and the border is the only thing that says it is a button; the note
   * over the base rule records that a bone edge on a white card computes to 1.06:1 and loses
   * exactly that. Pinned at the 3:1 that WCAG asks of a non-text control rather than at AAA,
   * because that is what it is.
   */
  it('keeps an edge on the action, which is all that says it is a button', () => {
    const declarations = rule('.theme-nn .nn-panel-year .nn-ghost');
    const border = colourOf(declarations, 'border-color');
    expect(contrastRatio(border, surface)).toBeGreaterThanOrEqual(3);
  });

  /**
   * **The fill is what separates the two states, so it is asserted as absent.**
   *
   * Entries shut is this outline; entries open swaps the class to `.nn-cta`, which is the same
   * pus *filled* with ink on it. Giving the shut state a fill would make it read as "enter" on
   * a page where entries are not open — the dishonesty `site.spec.ts` guards in the browser and
   * this guards in the stylesheet. Recolouring the button was asked for; refilling it was not.
   */
  it('leaves the fill to the state that has something to offer', () => {
    expect(rule('.theme-nn .nn-panel-year .nn-ghost')).not.toMatch(/background/);
  });

  /**
   * The divider is the one line under 4.5:1 and it is deliberate, so it is pinned from both
   * sides. A rule is decoration rather than "non-text content required to understand" — the same
   * argument this file already makes for the panel's own fill — but it still has to be *seen*,
   * and `--colour-rule`'s 35% computes to 2.94:1 on this surface because it was measured against
   * the gradient. The floor stops it being dimmed back to invisible; the ceiling stops somebody
   * "fixing" it into the loudest thing on the panel, which is precisely what happened to the
   * schedule's divider the first time this defect appeared.
   */
  it('keeps its divider visible without letting it shout', () => {
    const declarations = rule('.theme-nn .nn-panel-year .nn-panel-rule');
    const found = /border-top:[^;]*rgba\(([^)]*)\)/.exec(declarations);
    expect(found?.[1], 'the divider should state its own translucent bone').toBeDefined();

    const [r, g, b, alpha] = (found?.[1] ?? '')
      .split(',')
      .map((part) => Number(part.trim()));
    expect(alpha, 'the divider should be translucent').toBeGreaterThan(0);

    // **Composited by hand, because `contrastRatio` takes hex and a translucent border is not
    // one.** A ratio computed against the border's own colour rather than what a reader sees
    // through it would be a number about nothing — the whole point of the value is the surface
    // showing through, so it is flattened onto that surface first.
    const over = (channel: number, base: number): number =>
      Math.round(channel * (alpha ?? 1) + base * (1 - (alpha ?? 1)));
    const [sr, sg, sb] = parseHex(surface);
    const flattened = [over(r ?? 0, sr), over(g ?? 0, sg), over(b ?? 0, sb)]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('');

    const ratio = contrastRatio(`#${flattened}`, surface);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(6);
  });
});
