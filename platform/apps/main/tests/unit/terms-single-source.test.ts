import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import race from '../../src/content/race.json';

/**
 * The entry terms page states no fact twice.
 *
 * ## Why this is a source test rather than a rendering test
 *
 * `nn-terms.spec.ts` asserts that the rendered page contains `race.permit`, `race.contact` and
 * the rest — derived from the import rather than written out, so changing the data file changes
 * the expectation. That proves the page renders *whatever the file says*. **It does not prove
 * the page reads the file**, and the difference is the whole point: a page with
 * `ARC/26/0842` typed into its markup passes every assertion in that spec, today, and goes on
 * passing on the morning somebody changes the number in `race.json` and the terms page alone
 * keeps the old one.
 *
 * The failure that shape produces is the expensive one. The permit number, the transfer
 * deadline and the contact address are quoted on `/nn/2026/`, at the foot of the entry form and
 * here; a runner reading two different deadlines on two pages of the same site has a dispute
 * the club cannot win. So the guard is on the source: **the values must not appear in the
 * markup at all.**
 *
 * ## Why the whole file rather than the markup alone
 *
 * The frontmatter is where an interpolation would be assembled, so a literal hidden in a `const`
 * is exactly as bad as one in a `<li>`. Prose in the header comment is the one legitimate place
 * these strings appear — the comment explains the permit-number transcription slip and names the
 * value — so comments are stripped before matching rather than exempted by hand. Stripping is
 * what keeps this from being a test somebody has to remember to work around.
 */

const SOURCE = fileURLToPath(
  new URL('../../src/pages/nn/2026/terms.astro', import.meta.url),
);

/**
 * The file with every comment removed — `/* … *\/` blocks, whole-line `//` comments, and
 * Astro's `{ /* … *\/ }` expression comments, which are the form the markup half uses.
 *
 * Block comments go first deliberately: a `//` inside one cannot then be mistaken for the start
 * of a line comment.
 *
 * **Whole-line `//` only, and never a trailing one.** A regex for trailing line comments also
 * eats the second half of any `https://…` string, which would silently truncate the canonical
 * URL and turn this into a test that greps less of the file than it claims to. Every `//`
 * comment in `terms.astro` is on its own line, and this is the cheaper half of that trade.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('the entry terms page states no fact twice', () => {
  const source = readFileSync(SOURCE, 'utf8');
  const code = withoutComments(source);

  // Every fact on the page that also appears somewhere else on the site, with the key it has to
  // be read from. The value is never written here either — it comes from the same import the
  // page uses, so this table cannot drift from `race.json` any more than the page can.
  const FACTS: ReadonlyArray<readonly [string, string]> = [
    ['race.date', race.date],
    ['race.dateShort', race.dateShort],
    ['race.permit', race.permit],
    ['race.hqName', race.hqName],
    ['race.transferDeadline', race.transferDeadline],
    ['race.contact', race.contact],
    ['race.privacy.controller', race.privacy.controller],
  ];

  for (const [key, value] of FACTS) {
    it(`reads ${key} rather than repeating "${value}"`, () => {
      // The half that actually guards anything: the value is nowhere in the source.
      expect(code).not.toContain(value);

      // And the key is read. **Anchored on a non-identifier character**, because `race.date`
      // is a prefix of `race.dateShort` — a bare `toContain('race.date')` would pass on a page
      // that read only the short form, which is exactly the vacuous-assertion shape this
      // repository has been caught by before.
      expect(code).toMatch(new RegExp(`${key.replace(/\./g, '\\.')}(?![A-Za-z0-9_])`));
    });
  }

  it('reads the collection time off the schedule row, and never writes it out', () => {
    const registration = race.schedule.find((row) => row.id === 'registration');

    // **The one fact that is not a top-level key**, and the reason that row grew an `id`.
    // `09:15` is stated once in this repository — in the schedule `/nn/2026/race-day/` renders
    // — and this page asks for it by name. A second key holding the same time would be a
    // duplicate with a longer fuse than a literal, because it would look like single-sourcing.
    expect(registration).toBeDefined();
    expect(code).not.toContain(registration?.time ?? '');
    expect(code).toContain("row.id === 'registration'");
  });

  it('quotes the permit without the transcription slip in the supplied copy', () => {
    // The race director's copy reads "ARC/26/ 0842" with an internal space; the number issued
    // on 27 August 2026 has none, and it is `race.json`'s. Confirmed as a slip, and it is the
    // only character on the page that is not hers — asserted so that a future transcription
    // cannot quietly reintroduce it.
    //
    // **Against the comment-stripped copy, like every other assertion here.** The page's header
    // comment quotes the slipped form in order to explain it, which is exactly the legitimate
    // use the stripping exists for — this assertion read the raw source on its first draft and
    // failed on that comment, which is the test being wrong rather than the page.
    expect(code).not.toContain('ARC/26/ 0842');
    expect(race.permit).toBe('ARC/26/0842');
  });

  it('claims no committee ratification', () => {
    // The committee has not ratified these terms. The provenance line says so, and a future
    // edit that upgrades "Supplied by the race director" to something warmer would be putting a
    // false statement of provenance on a legal document.
    expect(code).toContain(
      'Version 1 — published 28 August 2026. Supplied by the race director.',
    );
    expect(code).not.toMatch(/committee|ratified|approved by/i);
  });
});
