import type { Gender, ResultPlacement } from '../age-category';
import { effectiveCategory } from '../age-category';

/**
 * Reading `timing.runners.gender`, whichever importer wrote it.
 *
 * ## The column has one vocabulary now, and this file is the reason it can
 *
 * [ADR-039](../../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md)
 * settles it: **`timing.runners.gender` speaks `entries`' vocabulary** — `'female'`, `'male'`,
 * `'non_binary'` — because that is what `effectiveCategory()` takes and what the entry form
 * has always recorded. The column's original comment described `'M'` / `'F'` *"as the import
 * found it"*, which was the Full On Sport CSV's shape and never a decision.
 *
 * ⚠️ **A column with two vocabularies written by two importers is the restated-closed-list
 * trap in data form** — both writers are correct, both pass review, and whichever ran last
 * decides what the prize list says. So there is one writer vocabulary:
 * `timing.import_from_entries()` copies `entries.entrants.gender` unchanged, and
 * `parseRegistrationCsv()` maps into it **at the parser boundary**, which is where that file
 * already drops everything else it must not carry.
 *
 * ## Why reading still accepts `'M'` and `'F'`
 *
 * **Expand, migrate, contract** — the repository's own rule, and this is the expand step.
 * Unifying the writers does not rewrite rows that already exist, and Pass the Buck 2026's
 * archive is a whole race of them waiting on
 * [#206](https://github.com/southville-running-club/src-website/issues/206). A reader that
 * refused the legacy spelling would turn every one of those runners into *"no prize band"* the
 * day it shipped, which is the expensive direction: a wrong prize list is discovered at the
 * presentation.
 *
 * So the tolerance is **deliberate and temporary**, and the contract step is real work rather
 * than a tidy-up: once no row spells it the old way, the legacy branch goes and a check
 * constraint can take over. There is deliberately **no check constraint on the column today**
 * for the same reason — one would refuse the archive import before it is written.
 *
 * ⚠️ **Do not add a third spelling here to make some future import easier.** Map at that
 * import's own boundary, the way the CSV parser does. Every spelling this function accepts is
 * one the contract step has to chase down.
 */
export function normaliseTimingGender(gender: string | null | undefined): Gender | null {
  if (gender === null || gender === undefined) {
    return null;
  }

  const value = gender.trim().toLowerCase();

  // ⚠️ **`'f'` and `'m'` are the legacy spelling and the expand step**, not an alias somebody
  // added for convenience. See the header for when they may go.
  switch (value) {
    case 'female':
    case 'f':
      return 'female';
    case 'male':
    case 'm':
      return 'male';
    case 'non_binary':
      return 'non_binary';
    default:
      // ⚠️ **Unrecognised means no band rather than a guess**, and that is the safe
      // direction: guessing puts somebody in the wrong prize category, which is discovered at
      // the presentation rather than in a test.
      return null;
  }
}

/**
 * Which of the two categories the club places a result in — the one resolver every band
 * calculation on the timing side goes through.
 *
 * This is {@link normaliseTimingGender} followed by `effectiveCategory()`, and keeping the
 * pair in one function is the point: `effectiveCategory` is
 * [ADR-031](../../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
 * answer, so a caller that normalised the gender and forgot the placement would quietly send
 * every non-binary runner to `null` — which is exactly the gap ADR-031 closed in `entries` and
 * would silently re-open here.
 *
 * `awards.ts`'s `placedGender` used to be this function without the placement half, and its
 * own comment said what was missing: *"When the two are joined, that answer is what should
 * arrive here — through `effectiveCategory()`, which already exists — rather than a second
 * rule invented in this file."* This is that join.
 */
export function placementFor(
  gender: string | null | undefined,
  placement: ResultPlacement,
): 'female' | 'male' | null {
  const normalised = normaliseTimingGender(gender);
  return normalised === null ? null : effectiveCategory(normalised, placement);
}
