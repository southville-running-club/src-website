import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@src/shared/contrast';

/**
 * Every colour pairing the timing layer makes, measured in each scheme it can be drawn in.
 *
 * ## Why this is separate from `club-contrast.test.ts`
 *
 * That test measures the club website's palette as the website uses it. `app/styles/timing.css`
 * puts the same tokens into combinations the website never makes (ink as a button fill on the
 * brand green, a danger fill, the brand green behind a whole screen), and it adds two things the
 * website does not have: `--club-on-danger`, and a block that forces the race console and the
 * capture screen into the light palette whatever the phone is set to (D5).
 *
 * `CLAUDE.md`'s `NnSchedule` trap is the reason to measure rather than trust: a colour computed
 * against one surface and then drawn on another fails silently, and looks fine while it does.
 *
 * ## Nothing here is typed by hand
 *
 * The light and dark tokens are read out of `club-chrome.css`, and `--club-on-danger` and the
 * forced-light block out of `timing.css`. Each pairing names the tokens a rule in `timing.css`
 * actually puts together; the ratios are computed.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const chrome = read('../../../../packages/shared/styles/club-chrome.css');
const timing = read('../../app/styles/timing.css');

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

function tokensIn(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of block.matchAll(
    /(--club-[a-z-]+):\s*(#[0-9a-fA-F]{3,8});/gu,
  )) {
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

/** The body of the first block after `opener`, matched by brace depth. */
function blockAfter(css: string, opener: RegExp, what: string): string {
  const match = opener.exec(css);
  if (match === null) throw new Error(`${what} is missing`);
  const start = match.index + match[0].length;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < css.length) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    end += 1;
  }
  return css.slice(start, end - 1);
}

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');

const chromeLight = tokensIn(
  blockAfter(strip(chrome), /^:root \{/mu, 'club-chrome.css :root'),
);
const chromeDarkBlock = blockAfter(
  strip(chrome),
  /@media \(prefers-color-scheme: dark\) \{/u,
  'club-chrome.css dark block',
);
const chromeDark = tokensIn(chromeDarkBlock);

const timingCss = strip(timing);
const timingLight = tokensIn(blockAfter(timingCss, /^:root \{/mu, 'timing.css :root'));
const timingDarkBlock = blockAfter(
  timingCss,
  /@media \(prefers-color-scheme: dark\) \{/u,
  'timing.css dark block',
);
const forcedBlock = blockAfter(
  timingDarkBlock,
  /:root:has\(\.timing-force-light\) \{/u,
  'the forced-light block',
);
const forced = tokensIn(forcedBlock);
const timingDark = tokensIn(timingDarkBlock.replace(forcedBlock, ''));

const light = new Map([...chromeLight, ...timingLight]);
const dark = new Map([...light, ...chromeDark, ...timingDark]);
/** A phone set to dark, on one of the two screens that are always light. */
const forcedLight = new Map([...dark, ...forced]);

const SCHEMES = [
  ['light', light],
  ['dark', dark],
  ['dark, forced light', forcedLight],
] as const;

function colour(scheme: ReadonlyMap<string, string>, name: string): string {
  const value = scheme.get(name);
  if (value === undefined) throw new Error(`no value for ${name}`);
  return value;
}

describe('the forced-light block (D5)', () => {
  it('restates every token club-chrome.css redefines for dark', () => {
    // If the chrome gains a dark token and this block does not, that one colour turns dark on a
    // screen that is meant to be light, and nothing else would notice.
    expect([...forced.keys()]).toEqual(expect.arrayContaining([...chromeDark.keys()]));
  });

  it('restates them with their light values, so the two screens match the light scheme', () => {
    for (const [name] of chromeDark) {
      expect(forced.get(name), name).toBe(light.get(name));
    }
    expect(forced.get('--club-on-danger')).toBe(light.get('--club-on-danger'));
  });

  it('restates base.css’s dark tokens too, with base.css’s own light values', () => {
    // The console's sections not yet restyled are painted with `base.css`'s `--colour-*`
    // palette. Forcing only the club's left them dark-scheme grey on a light page: a `<dt>` at
    // 2.14:1, which axe caught on a phone set to dark.
    const base = strip(read('../../../../packages/shared/styles/base.css'));
    const declarations = (block: string) =>
      new Map(
        [...block.matchAll(/(--colour-[a-z-]+):\s*([^;]+);/gu)].map(
          ([, name, value]) => [name ?? '', (value ?? '').trim()] as const,
        ),
      );
    const baseLight = declarations(blockAfter(base, /^:root \{/mu, 'base.css :root'));
    const baseDark = declarations(
      blockAfter(
        base,
        /@media \(prefers-color-scheme: dark\) \{/u,
        'base.css dark block',
      ),
    );
    const restated = declarations(forcedBlock);

    expect(baseDark.size).toBeGreaterThan(5);
    for (const [name] of baseDark) {
      expect(restated.get(name), name).toBe(baseLight.get(name));
    }
  });

  it('actually differs from dark, so the test above is not vacuous', () => {
    expect(colour(dark, '--club-background')).not.toBe(
      colour(forcedLight, '--club-background'),
    );
  });
});

describe.each(SCHEMES)('the timing layer, %s', (_name, scheme) => {
  const ratio = (fg: string, bg: string) =>
    contrastRatio(colour(scheme, fg), colour(scheme, bg));

  /*
   * Text. Each row is a rule in `timing.css`:
   *
   * - on-brand on brand: the race control screen, the capture tile, the online pill and the
   *   ok/resolved state badge. Never white on this green.
   * - background on text: `.timing-btn-dark`, the one action on the race control screen.
   * - on-danger on danger: `.timing-btn-danger` and the failed/discarded badges.
   * - danger on surface and background: `.timing-danger-link`, `.timing-fail`.
   * - on-highlight on highlight: `.timing-warn`, the offline pill and the flagged/queued badges.
   * - muted on surface: the "Crossed at" label inside a queue card.
   * - muted on background: the capture screen's hints.
   * - text on surface: the bib tile, the keypad, the jump links.
   */
  it.each([
    ['--club-on-brand', '--club-brand'],
    ['--club-background', '--club-text'],
    ['--club-on-danger', '--club-danger'],
    ['--club-danger', '--club-surface'],
    ['--club-danger', '--club-background'],
    ['--club-on-highlight', '--club-highlight'],
    ['--club-muted', '--club-surface'],
    ['--club-muted', '--club-background'],
    ['--club-text', '--club-surface'],
    ['--club-text', '--club-background'],
    // The app shell (ADR-054): the footer's links are the link colour on the page.
    ['--club-link', '--club-background'],
  ])('%s on %s is readable text', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /*
   * Lines and focus rings, which need 3:1 against what they sit on:
   *
   * - the ink focus ring on the green race control screen (`.timing-go :focus-visible`);
   * - the dark pill's edge on the green (`.timing-btn-dark` has no other boundary there);
   * - the keypad keys' border, the open card's border, and the failed card's border.
   */
  it.each([
    ['--club-text', '--club-brand'],
    ['--club-focus', '--club-background'],
    ['--club-rule-strong', '--club-surface'],
    ['--club-text', '--club-surface'],
    ['--club-danger', '--club-surface'],
    // The current area's underline in the app header (ADR-054).
    ['--club-brand', '--club-background'],
  ])('%s against %s is a visible edge', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

/*
 * The one pairing that is deliberately not allowed, pinned the way `club-contrast.test.ts` pins
 * it: white on the brand green is 3.5:1 and fails for text. If somebody "improves" a pill or the
 * capture tile to white text, it is the token they reach for, and this says why not.
 */
it('white on the brand green still fails as text, which is why nothing here uses it', () => {
  expect(contrastRatio('#ffffff', colour(light, '--club-brand'))).toBeLessThan(AA_TEXT);
});
