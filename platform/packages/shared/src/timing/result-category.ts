/**
 * The words that go in a result's **Category** column, for either format.
 *
 * Written here rather than in `categories.ts` or `age-category.ts`, because it is neither of
 * their jobs and both of their headers say so. `categories.ts` is *"the pair category for a
 * relay … and a solo race is placed by `age-category.ts`"*; `age-category.ts` is the bands and
 * refuses to know anything about a race. What was missing is the one-line join between them —
 * *"given this team on this race, what does the column say"* — and until now every surface that
 * needed it was about to write its own.
 *
 * ## ⚠️ It resolves, it does not decide
 *
 * Every rule here belongs to somebody else and is called rather than restated:
 *
 * | | |
 * | --- | --- |
 * | Which of the two lists a result counts in | `placementFor()` → `effectiveCategory()` — [ADR-031](../../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md) |
 * | Which age band | `ageCategoryFor()` in [`age-category.ts`](../age-category.ts), the only thing allowed to name one |
 * | A relay pair's category | `deriveCategory()` in [`categories.ts`](./categories.ts) |
 * | A guide is in none | [ADR-022](../../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md), and `awards.ts` already excludes them from every prize |
 *
 * **There is deliberately no third branch for a non-binary runner**, which is the whole of what
 * ADR-031 bought: `effectiveCategory()` answers `'female'`, `'male'` or `null`, and a `null`
 * reaches `ageCategoryFor()` as `not-placed` rather than as a category this module invents.
 *
 * ## ⚠️ An unknown category is a blank, never a guess and never a dash
 *
 * `null` here means *the club has not placed this runner*, and every caller renders it as
 * empty. The CSV and the XLSX want an empty cell rather than an em-dash — a literal `—` breaks
 * a downstream sort and is not a category — and the preview table renders its own placeholder.
 * Guessing puts somebody in the wrong band, which is discovered at the presentation.
 */

import { ageCategoryFor, type AgeCategory } from '../age-category';
import { deriveCategory } from './categories';
import { placementFor } from './gender';
import type { EventFormat } from './bib';
import type { TimingRunner } from './rows';

/**
 * What this module needs to know about one runner. A `Pick` of {@link TimingRunner} rather than
 * the whole row, for `rows.ts`' reason — a function that names the four columns it reads says
 * what it depends on.
 */
export type CategoryRunner = Pick<
  TimingRunner,
  'gender' | 'result_placement' | 'role' | 'age_on_day'
>;

/** ADR-022's guide: on the start line, in no category and no prize. */
export function isGuide(runner: Pick<TimingRunner, 'role'>): boolean {
  return runner.role === 'guide';
}

/**
 * The band one solo runner falls in, or `null` when there is not one.
 *
 * Three ways to reach `null`, and none of them is a failure worth distinguishing here: a guide,
 * a runner with no recorded age, and a runner `effectiveCategory()` places in neither list.
 * A caller that needs to tell them apart has the runner row beside this.
 */
export function soloAgeCategory(runner: CategoryRunner): AgeCategory | null {
  if (isGuide(runner)) return null;
  if (runner.age_on_day === null) return null;

  return ageCategoryFor(
    runner.age_on_day,
    placementFor(runner.gender, runner.result_placement),
  );
}

/**
 * `Women's Vet 40`, `Men's Senior` — the club's own phrasing, matching the prize titles
 * `awards.ts` builds from the same two pieces.
 */
function soloLabel(runner: CategoryRunner): string | null {
  const band = soloAgeCategory(runner);
  if (band === null || !band.known) return null;

  const placement = placementFor(runner.gender, runner.result_placement);
  if (placement === null) return null;

  return `${placement === 'female' ? 'Women' : 'Men'}'s ${band.label}`;
}

/**
 * The Category column for one team, or `null` when the club has not placed them.
 *
 * **A relay reads the pair category and a solo race reads the band**, which is the split
 * `categories.ts` records: the three pair categories are men's, women's and mixed, and a solo
 * field is placed by age band. Nightingale Nightmare is solo; Pass the Buck's archive is a
 * relay, and both go through here.
 *
 * ⚠️ **`teams.category` is the fallback and never the first answer.** The column exists and the
 * registration CSV never populated it, so a stored value is either a walk-in desk's typing or
 * an archive import — worth rendering when it is there and never worth preferring over a
 * category derived from the runners who actually ran.
 */
export function resultCategoryLabel(
  runners: readonly CategoryRunner[],
  format: EventFormat,
  storedCategory: string | null = null,
): string | null {
  if (format === 'solo') {
    // A solo entry is one runner. A team carrying more than one on a solo race is not a shape
    // the import can produce, and picking the first would be a guess about which of them the
    // time belongs to.
    const runner = runners.length === 1 ? runners[0] : undefined;
    const derived = runner === undefined ? null : soloLabel(runner);
    return derived ?? storedCategory ?? null;
  }

  return deriveCategory([...runners]) ?? storedCategory ?? null;
}
