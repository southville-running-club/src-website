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
 *
 * ## The painted list is empty, so most of this now guards a mechanism rather than a link
 *
 * `Race info` and `Spooktators` came out of the bar on request. The `running` array they lived
 * in is still declared, still typed and still mapped in the markup — the Worker's
 * `renderNnNav` is unchanged and registers both selectors on every page, finding nothing — so
 * putting a link back is one entry here and no Worker change.
 *
 * That leaves two links in the `<nav>`, `Race` and `Privacy`, neither of them painted and
 * neither able to carry a year. **What the assertions below are mostly protecting is therefore
 * the shape a re-added entry would render through**, not markup any page currently emits: the
 * `hidden`, the `href=""` and the order are all things that would be free to a link somebody
 * added, and all things easy to tidy away while the list is empty and nothing looks broken.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const NAV = read('../../src/components/NnNav.astro');
const MASTHEAD = read('../../src/components/NnMasthead.astro');

/**
 * The source with its comments taken out.
 *
 * Every assertion that forbids a path needs this, and so does every one that counts them,
 * because these components discuss the addresses they no longer link at length: `/nn/2026/` in
 * the note about painting, and `/nn/course/` in the note about why that entry came out of the
 * bar. **Describing the thing that must not be in the markup is exactly how the reasoning gets
 * written down**, so a test that failed on prose would be one somebody deleted rather than one
 * somebody fixed.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

describe('no year is written into the navigation', () => {
  it.each([
    ['NnNav.astro', NAV],
    ['NnMasthead.astro', MASTHEAD],
  ])('has no year-bearing path in %s', (_name, source) => {
    expect(withoutComments(source)).not.toMatch(/\/nn\/\d{4}/);
  });

  it('keeps the painted template hidden, so a re-added link cannot ship visible', () => {
    // A "Race info" that quietly went to `/nn/` would be a link that lies. Hidden is a link
    // that is missing, and missing is the honest failure when the database is unreachable.
    //
    // **`running` is empty, so this `<li>` is a template rather than markup any page emits**,
    // and that is precisely why it is asserted. The `hidden` is dead weight while the list is
    // empty — nothing renders, nothing looks wrong, and dropping it would go unremarked until
    // somebody put an entry back and shipped a bar with a visible link to nowhere on it.
    // Asserting the element the map produces rather than a literal key is also what makes this
    // survive the list being empty at all.
    expect(NAV).toMatch(/<li data-nn-nav-item=\{key\}\s+hidden>/);
    // The masthead's button is the one control still painted on every page, so its half of
    // this is live rather than a template.
    //
    // Whitespace-tolerant: Prettier splits the button across lines once it has enough
    // attributes, and an assertion that only held while it fitted on one is an assertion
    // that goes green for the wrong reason the next time somebody formats the file.
    expect(MASTHEAD).toMatch(/data-nn-nav-cta\s+hidden/);
  });

  it('keeps the painted template empty-href, so a re-added link cannot ship plausible', () => {
    // `href=""` resolves to the page it is on, so even a half-painted bar cannot send somebody
    // somewhere that does not exist. Same reasoning as the `hidden` above: unreachable today,
    // and the guarantee a re-added entry inherits without anybody having to think about it.
    expect(NAV).toMatch(/<a href="" data-nn-nav-link=\{key\}/);
    expect(MASTHEAD).toMatch(/class="nn-nav-cta"\s+href=""/);
  });

  it('declares the painted list and leaves it empty, so a link back is deliberate', () => {
    // **This replaced a count of two.** `race-day` and `spectators` were entries here and came
    // out on request; what is left is the declaration, the type and the map below it.
    //
    // The empty literal is the guard proper: a year-bearing link can only reach this bar
    // through an entry in this array, so an addition has to appear in a diff as one. The
    // absence of any `key:` string is the belt to that brace — it catches an entry added in
    // some other shape, and it is the one an addition has to edit rather than merely satisfy.
    //
    // **The type annotation is asserted too, and it is the thing most likely to be tidied
    // away.** `[] as ReadonlyArray<…>` on an empty array reads like ceremony; without it the
    // literal infers as `never[]` and the map below stops compiling the moment an entry goes
    // back in, which is a confusing failure to meet while doing something simple.
    expect(NAV).toMatch(/const running = \[\]\s*as ReadonlyArray</);
    expect(NAV).toMatch(/key: string;/);
    expect([...NAV.matchAll(/key: '[a-z-]+'/g)]).toHaveLength(0);
  });
});

describe('the two evergreen destinations are the whole of the bar', () => {
  it('links Race directly, because it cannot move', () => {
    // `evergreen` holds one entry now that `Course` has gone, so this is the whole of that
    // list. It is still asserted as a literal rather than by counting the list, because what
    // matters is *which* address is written down here, not how many are.
    expect(NAV).toContain("href: '/nn/'");
    expect(NAV).toContain("label: 'Race'");
  });

  it('writes down two destinations and no others', () => {
    // **Hard-coded used to be the distinction this describe drew, and it has stopped being
    // one**: with `running` empty, these two *are* the bar — `Race`, `Privacy`, and the
    // masthead's button outside the `<nav>` beside them. So the count is worth asserting now
    // in a way it was not while a painted pair sat between them, because a third `<li>` from
    // any source is a change to what the bar is rather than a change to how it is built.
    //
    // Counted off the object literals rather than the markup: `href={href}` renders three
    // times below from two entries, which is the shape of the map and says nothing about how
    // many destinations exist. Comment-stripped, because the prose above both lists names
    // addresses at length.
    const code = withoutComments(NAV);

    expect([...code.matchAll(/href: '/g)]).toHaveLength(2);
    expect([...code.matchAll(/label: '/g)]).toHaveLength(2);
  });

  it('links nothing at /nn/course/, because that address is a redirect now', () => {
    // **The course page is gone — its content is on `/nn/`, and `/nn/course/` 301s there** —
    // and nothing else in the suite can see a link to it. Playwright and `SELF.fetch` both
    // follow redirects, so a `Course` entry put back into the bar would land on `/nn/`, pass
    // every acceptance test that clicked it, and cost every visitor a hop to a page that no
    // longer exists. This grep is the only thing that says no.
    //
    // Against the comment-stripped source, because the component explains at length in prose
    // why the entry came out, and that explanation names the path.
    expect(withoutComments(NAV)).not.toContain('/nn/course/');
  });

  it('links the privacy notice directly too, for the same reason', () => {
    // **The notice is evergreen and belongs to the race rather than to a running**, so its
    // address is a literal here exactly as `Race` is. If it ever acquires a year it stops
    // being a candidate for this list and joins the painted pair — which is the distinction
    // this file exists to keep, and the year assertion above is what would catch it.
    expect(NAV).toContain("href: '/nn/privacy/'");
    expect(NAV).toContain("label: 'Privacy'");
  });

  it('renders the notice after the group the Worker paints, not among the race links', () => {
    // **The order is the decision, so it is the thing asserted.** ADR-014 puts Privacy last:
    // the links before it read as a set about the race, and a legal notice dropped into the
    // middle of that set breaks it. Nothing else in the component would notice if the three
    // groups were rendered in another order, which is exactly why this is here.
    //
    // **With `running` empty the middle group renders nothing, so this decides where a
    // re-added link would land rather than where anything sits today** — between `Race` and
    // `Privacy`, which is the set it belongs to. That is the whole of what keeps the ordering
    // from being rearranged as three interchangeable blocks while none of it is visible.
    const markup = NAV.slice(NAV.indexOf('<nav'));

    expect(markup.indexOf('notice.map')).toBeGreaterThan(markup.indexOf('running.map'));
    expect(markup.indexOf('running.map')).toBeGreaterThan(
      markup.indexOf('evergreen.map'),
    );
  });
});
