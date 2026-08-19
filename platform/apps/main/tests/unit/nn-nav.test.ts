import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The navigation, asserted against its **source** rather than against what the Worker painted.
 *
 * ## Why this file exists at all
 *
 * `tests/worker/nn-nav.test.ts` fetches pages through the Worker, so every year it sees is one
 * the Worker put there — which means it can never catch the failure that matters: a
 * `/nn/2026/` typed into the component by hand. That link would work perfectly for a year and
 * then point at a page nobody had noticed was stale, and it would not look wrong in a diff.
 *
 * So this reads the two component files off disk and greps them. It is a crude test and it is
 * the only one that can fail for the right reason.
 *
 * **It runs in the plain unit project**, so `./dev check` catches a hard-coded year without a
 * build, a database or a browser.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const NAV = read('../../src/components/NnNav.astro');
const MASTHEAD = read('../../src/components/NnMasthead.astro');

describe('no year is written into the navigation', () => {
  it.each([
    ['NnNav.astro', NAV],
    ['NnMasthead.astro', MASTHEAD],
  ])('has no year-bearing path in %s', (_name, source) => {
    // Strip the comments first. They discuss `/nn/2026/` at length — describing the thing that
    // must not be in the markup is exactly how the reasoning gets written down — and a test
    // that failed on prose would be one somebody deleted.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

    expect(code).not.toMatch(/\/nn\/\d{4}/);
  });

  it('ships the year-bearing controls hidden, so an unpainted bar links nowhere wrong', () => {
    // A "Race day" that quietly went to `/nn/` would be a link that lies. Hidden is a link
    // that is missing, and missing is the honest failure when the database is unreachable.
    //
    // The two links are rendered from a map, so what is asserted is the shape of the element
    // the map produces rather than a literal key — which is also the only form a fifth painted
    // link could be added in without noticing this test.
    expect(NAV).toMatch(/<li data-nn-nav-item=\{key\}\s+hidden>/);
    // Whitespace-tolerant: Prettier splits the button across lines once it has enough
    // attributes, and an assertion that only held while it fitted on one is an assertion
    // that goes green for the wrong reason the next time somebody formats the file.
    expect(MASTHEAD).toMatch(/data-nn-nav-cta\s+hidden/);
  });

  it('gives the two painted links an empty href rather than a plausible one', () => {
    // `href=""` resolves to the page it is on, so even a half-painted bar cannot send somebody
    // somewhere that does not exist.
    expect(NAV).toMatch(/<a href="" data-nn-nav-link=\{key\}/);
    expect(MASTHEAD).toMatch(/class="nn-nav-cta"\s+href=""/);
  });

  it('paints exactly the two destinations that belong to a running', () => {
    // The set, not the count: a third painted link added here without a matching branch in
    // `renderNnNav` would ship hidden on every page and nobody would see it.
    expect(NAV).toMatch(/key: 'race-day'/);
    expect(NAV).toMatch(/key: 'spectators'/);
    expect([...NAV.matchAll(/key: '[a-z-]+'/g)]).toHaveLength(2);
  });
});

describe('the three evergreen destinations are the only hard-coded ones', () => {
  it('links Race and Course directly, because neither can move', () => {
    expect(NAV).toContain("href: '/nn/'");
    expect(NAV).toContain("href: '/nn/course/'");
  });

  it('links the privacy notice directly too, for the same reason', () => {
    // **The notice is evergreen and belongs to the race rather than to a running**, so its
    // address is a literal here exactly as `Course` is. If it ever acquires a year it stops
    // being a candidate for this list and joins the painted pair — which is the distinction
    // this file exists to keep, and the year assertion above is what would catch it.
    expect(NAV).toContain("href: '/nn/privacy/'");
    expect(NAV).toContain("label: 'Privacy'");
  });

  it('renders the notice after the pair the Worker paints, not among the race links', () => {
    // **The order is the decision, so it is the thing asserted.** ADR-014 puts Privacy last:
    // the four links before it read as a set about the race, and a legal notice dropped into
    // the middle of that set breaks it. Nothing else in the component would notice if the
    // three groups were rendered in another order, which is exactly why this is here.
    const markup = NAV.slice(NAV.indexOf('<nav'));

    expect(markup.indexOf('notice.map')).toBeGreaterThan(markup.indexOf('running.map'));
    expect(markup.indexOf('running.map')).toBeGreaterThan(
      markup.indexOf('evergreen.map'),
    );
  });
});
