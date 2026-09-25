import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../../src/contrast.js';

/**
 * The club website's contrast guard.
 *
 * ## Why it reads the stylesheet instead of restating it
 *
 * This is `nn-contrast.test.ts`'s shape and it is copied on purpose. A test that writes
 * `expect(contrastRatio('#16301F', '#F1F7EF'))` asserts arithmetic: it will keep passing after
 * somebody changes the page background, because it never asked what the page background is.
 *
 * So **both sides of every pairing are resolved out of `club.css`'s own token blocks**. Change
 * a surface, change an ink, or delete either declaration, and this recomputes and fails rather
 * than going quietly vacuous. Only the floors are written here.
 *
 * ## Both schemes, because the club supports both
 *
 * `club.css` declares its light tokens on `:root` and overrides a subset under
 * `prefers-color-scheme: dark`. A colour defined only in the light block **falls through** to
 * the dark scheme, and that fall-through is where this class of defect actually lives — the
 * admin surface has already shipped a wash that read fine in light and measured 1.56:1 in
 * dark, because the token it mixed was deliberately not redefined. So the dark palette here is
 * resolved as "the light block, with the dark block applied over it", which is what a browser
 * does, rather than as the dark block alone.
 *
 * ## What the floors are, and why they differ
 *
 * | what | floor | why |
 * | --- | --- | --- |
 * | body and secondary text | **4.5:1** | WCAG AA 1.4.3 |
 * | non-text UI — the brand green as a line, control borders | **3:1** | WCAG AA 1.4.11 |
 *
 * ⚠️ **Deliberately AA and not the 7:1 this repository's other palettes aim at.** `base.css`
 * and `nn-theme.css` target AAA, and the Direction A palette does not reach it: the link green
 * on the alternate band is 5.68:1 and the ink on the brand fill is 5.07:1. Those two values
 * are the design — `#209D50` is the club's own published accent and the ink that can sit on it
 * is bounded by it. Holding this surface to AAA would mean choosing a different green, which
 * is a decision the club has not been asked for. The floors here are the ones the brief states
 * and the ones WCAG 2.2 AA requires; raising them later is a palette change, not a test edit.
 */

const css = readFileSync(
  fileURLToPath(new URL('../../styles/club.css', import.meta.url)),
  'utf8',
);

/** WCAG 2.2 AA. Text, and the brief's stated bar for this surface. */
const AA_TEXT = 4.5;
/** WCAG 2.2 AA 1.4.11. A line, a border, an outline — anything that is not text. */
const AA_NON_TEXT = 3;

/** Every `--club-*: #hex;` declaration inside one block of the stylesheet. */
function tokensIn(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--club-[a-z-]+):\s*(#[0-9a-fA-F]{3,8});/gu)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

/**
 * The light palette: the `:root` block that is not inside a media query.
 *
 * Anchored on the start of a line so the `:root` *inside* `@media (prefers-color-scheme: dark)`
 * — which is indented — cannot match instead.
 */
const light: ReadonlyMap<string, string> = (() => {
  const block = /^:root \{([\s\S]*?)^\}/mu.exec(css);
  if (block?.[1] === undefined) {
    throw new Error(
      'club.css no longer declares its light tokens on a top-level `:root`',
    );
  }

  const found = tokensIn(block[1]);
  if (found.size === 0) throw new Error('club.css declared no --club-* tokens on :root');
  return found;
})();

/**
 * The dark palette, as a browser resolves it: the light block with the dark block over it.
 *
 * ⚠️ **This is the half that matters.** Reading the dark block alone would make every
 * fall-through token — the brand green, its ink, the highlight — simply absent from this map,
 * and every assertion naming one would then silently not run.
 */
const dark: ReadonlyMap<string, string> = (() => {
  const block = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)^\}/mu.exec(css);
  if (block?.[1] === undefined) {
    throw new Error('club.css no longer has a prefers-color-scheme: dark block');
  }

  return new Map([...light, ...tokensIn(block[1])]);
})();

const SCHEMES = [
  ['light', light],
  ['dark', dark],
] as const;

/** Resolve a token, failing loudly rather than measuring `undefined`. */
function colour(scheme: ReadonlyMap<string, string>, name: string): string {
  const value = scheme.get(name);
  if (value === undefined) throw new Error(`club.css no longer declares ${name}`);
  return value;
}

describe('the club palette', () => {
  /**
   * Text on each of the three surfaces, in both schemes.
   *
   * The surfaces are listed rather than derived because *which* inks may appear on *which*
   * surface is the design decision worth pinning: muted text is used on the alternate band,
   * and that pairing (6.16:1 light, 8.19:1 dark) is the tightest of the six.
   */
  describe.each(SCHEMES)('%s', (_name, scheme) => {
    it.each([
      ['--club-text', '--club-background'],
      ['--club-text', '--club-surface'],
      ['--club-text', '--club-surface-alt'],
      ['--club-muted', '--club-background'],
      ['--club-muted', '--club-surface'],
      ['--club-muted', '--club-surface-alt'],
      ['--club-link', '--club-background'],
      ['--club-link', '--club-surface'],
      ['--club-link', '--club-surface-alt'],
      // A form error is read, so it clears the body-text floor rather than the non-text one.
      ['--club-danger', '--club-background'],
      ['--club-danger', '--club-surface'],
      ['--club-danger', '--club-surface-alt'],
    ])('%s reads on %s', (ink, surface) => {
      expect(
        contrastRatio(colour(scheme, ink), colour(scheme, surface)),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('refuses white on the brand fill, and accepts the ink that is there', () => {
      const brand = colour(scheme, '--club-brand');

      expect(contrastRatio('#ffffff', brand)).toBeLessThan(AA_TEXT);
      expect(
        contrastRatio(colour(scheme, '--club-on-brand'), brand),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    /**
     * ⚠️ **3.01:1 in the light scheme — one hundredth above the floor.**
     *
     * The brand green is drawn as a line on the alternate band: the current-section underline
     * in the navigation, a tick in a list, the outline on a featured card. A one-hex nudge to
     * `--club-surface-alt` breaks this with nothing looking wrong and no other test noticing,
     * which is exactly why it is named here rather than left to the eye.
     */
    it('keeps the brand green usable as a line on every surface', () => {
      for (const surface of [
        '--club-background',
        '--club-surface',
        '--club-surface-alt',
      ] as const) {
        expect(
          contrastRatio(colour(scheme, '--club-brand'), colour(scheme, surface)),
          `--club-brand is drawn as a line on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });

    /**
     * ⚠️ **A red that is not redefined for the dark scheme is not a dark-scheme red.**
     *
     * `--club-danger` is `#a3231b` in the light scheme, where it is 7.46:1 on a card. Left
     * alone in the dark scheme it measures **1.62:1** on the dark page — not hard to read,
     * absent — because the surfaces inverted and the ink did not. That is precisely the
     * defect `nn-admin.css` shipped once with an amber wash and `club.css` nearly shipped
     * with the pace highlight, so it is asserted directly rather than left to the pairings
     * above to catch by luck.
     *
     * The two schemes therefore hold **different** values, and this is what fails if somebody
     * removes one of them.
     */
    it('gives the dark scheme a red of its own', () => {
      expect(colour(light, '--club-danger')).not.toBe(colour(dark, '--club-danger'));

      // The light scheme's red, put on the dark page, is what this is protecting against.
      expect(
        contrastRatio(colour(light, '--club-danger'), colour(dark, '--club-background')),
      ).toBeLessThan(AA_TEXT);
    });

    /** Control borders are non-text UI and have to be findable. */
    it('keeps control borders visible', () => {
      for (const surface of ['--club-background', '--club-surface'] as const) {
        expect(
          contrastRatio(colour(scheme, '--club-rule-strong'), colour(scheme, surface)),
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });

    /** The focus ring has to be found quickly, on whichever surface it lands. */
    it('keeps the focus ring visible on every surface', () => {
      for (const surface of [
        '--club-background',
        '--club-surface',
        '--club-surface-alt',
      ] as const) {
        expect(
          contrastRatio(colour(scheme, '--club-focus'), colour(scheme, surface)),
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });

    /**
     * The pace guide's highlighted row.
     *
     * ⚠️ **This assertion found a real defect on its first run**, which is the argument for
     * writing it. `--club-highlight` is deliberately the same yellow in both schemes — a
     * highlight that inverted would stop being one — and the row's text was `--club-text`,
     * which is near-white in the dark scheme. Near-white on pale yellow measures **1.06:1**:
     * not hard to read, absent. The same shape as the amber wash `admin-contrast.test.ts`
     * caught at 1.56:1, and it would have shipped.
     *
     * So the row carries `--club-on-highlight`, which is not redefined in the dark block
     * either. Both halves of the pair stay put, and this is what says so.
     */
    it('keeps the highlighted row readable', () => {
      expect(
        contrastRatio(
          colour(scheme, '--club-on-highlight'),
          colour(scheme, '--club-highlight'),
        ),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    /**
     * And the ink that is *not* meant to land there.
     *
     * Without this, somebody simplifying `--club-on-highlight` away — it is, after all, the
     * same value as `--club-text` in the light scheme — would reintroduce the 1.06:1 defect
     * and the assertion above would keep passing, because it would still be comparing the
     * token to itself.
     */
    it('keeps the two inks distinct where the schemes diverge', () => {
      const onHighlight = colour(scheme, '--club-on-highlight');
      const bodyInk = colour(scheme, '--club-text');

      expect(
        contrastRatio(onHighlight, colour(scheme, '--club-highlight')),
      ).toBeGreaterThanOrEqual(
        contrastRatio(bodyInk, colour(scheme, '--club-highlight')),
      );
    });
  });

  /**
   * ⚠️ **The rule that is easiest to break and hardest to see — and it is a *light-scheme*
   * rule, which is not how it was first written.**
   *
   * `--club-brand` is the club's published accent and it is 3.22:1 on the page and 3.50:1 on
   * a card. Every instinct says to use it for a link or a button label; on the light surfaces
   * both fail.
   *
   * **In the dark scheme the same green measures 4.89:1 on the page and passes.** The first
   * version of this test asserted the prohibition in both schemes and failed here, correctly:
   * the rule the brief states is *"never use `#209D50` as text on the light backgrounds"*,
   * and the dark surfaces are not light backgrounds. Asserting it in both would have been
   * asserting something untrue, and the fix somebody reached for under time pressure would
   * have been to delete the whole test rather than to scope it.
   *
   * It stays scoped rather than extended: the design does not use the green as text anywhere,
   * and a dark-scheme-only green link would be a colour the light scheme cannot match.
   */
  it('refuses the brand green as text on the light surfaces', () => {
    for (const surface of [
      '--club-background',
      '--club-surface',
      '--club-surface-alt',
    ] as const) {
      const ratio = contrastRatio(colour(light, '--club-brand'), colour(light, surface));

      // Not an upper bound on taste — a statement that this colour cannot carry text, so that
      // a future palette change which *did* make it readable would come here and delete this
      // deliberately rather than quietly relying on it.
      expect(
        ratio,
        `--club-brand on ${surface} is ${ratio.toFixed(2)}:1; if that is now above ${String(AA_TEXT)} the palette has changed and this rule needs revisiting`,
      ).toBeLessThan(AA_TEXT);
    }
  });

  /**
   * ⚠️ **The photo panel must differ from every surface it can land on.**
   *
   * This is the assertion that was missing when a placeholder panel painted
   * `--club-surface-alt` was dropped into a `.club-sec-alt` band and measured **identical**
   * to the thing behind it — half a section of empty space, nothing red, and no existing
   * assertion that could see it. `NnSchedule`'s defect exactly: a component coloured against
   * a surface it does not itself carry.
   *
   * There is no WCAG floor here — the panel is decorative and `aria-hidden`, standing in for
   * a photograph nobody has supplied. The requirement is only that it is *visible*, which is
   * why this asserts a difference rather than a ratio. 1:1 is the failure.
   */
  it('keeps the photo panel distinct from every surface it can sit on', () => {
    for (const [name, scheme] of SCHEMES) {
      const panel = colour(scheme, '--club-photo');

      for (const surface of [
        '--club-background',
        '--club-surface',
        '--club-surface-alt',
      ] as const) {
        const behind = colour(scheme, surface);

        expect(panel, `the ${name} panel is the same colour as ${surface}`).not.toBe(
          behind,
        );
        expect(
          contrastRatio(panel, behind),
          `the ${name} panel is indistinguishable from ${surface}`,
        ).toBeGreaterThan(1.1);
      }
    }
  });

  /**
   * The wordmark, which is the one thing here WCAG exempts.
   *
   * 1.4.3 sets no floor for a logotype, so this does not assert one. What it asserts is that
   * the mark is **visible** — it was `#1A7D3F` in both schemes at first draft, which is 2.96:1
   * on the dark card: not non-compliant, simply hard to see. The dark block overrides it for
   * that reason and this is what says so.
   */
  it('keeps the wordmark visible in both schemes, exemption notwithstanding', () => {
    for (const [name, scheme] of SCHEMES) {
      expect(
        contrastRatio(colour(scheme, '--club-logo'), colour(scheme, '--club-background')),
        `the wordmark on the ${name} page`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  /**
   * ⚠️ **The club palette must not reach into the money pages' one.**
   *
   * `club.css` is self-contained because `base.css` and `tokens.css` are frozen until after
   * the race. A single `var(--colour-…)` or `--src-…` in here would resolve to nothing on a
   * club page — there is no stylesheet on that page to define it — and would render as an
   * invalid value with no error anywhere.
   */
  it('names no token from the money pages’ palette', () => {
    const strays = [...css.matchAll(/--(?:colour|src)-[a-z-]+/gu)].map((m) => m[0]);

    expect(strays).toEqual([]);
  });

  /**
   * And it must not import one either, which is the other way the isolation goes.
   *
   * `@import './tokens.css'` is one line and is exactly what somebody reaches for to get a
   * colour they can see in the next file along.
   */
  it('imports nothing', () => {
    expect(css).not.toContain('@import');
  });
});
