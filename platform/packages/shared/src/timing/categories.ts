/**
 * Pair categories — the relay concept, derived from two runners' genders.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/categories.ts`** under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 * `teams.category` exists in the schema but the registration CSV never populated it — each
 * runner row carries a gender instead — so the three named pair categories are derived at read
 * time rather than migrated. Returning `null` when it cannot be determined means a caller
 * renders a placeholder rather than miscategorising somebody.
 *
 * ## ⚠️ This is not what a solo race is placed by, and the difference matters
 *
 * The [architecture review](../../../../../docs/reference/timing-app-review.md#what-the-website-and-the-port-need-to-know)
 * lists age bands as new work for the port: *"`lib/categories.ts` derives **pair** categories
 * from two runners' genders. Age bands (Vet 40/50/60, male and female) do not exist and are
 * new work — though `age_on_day` is already on `runners`, so the data is there."*
 *
 * **They are not new work. They are already here**, in
 * [`age-category.ts`](../age-category.ts): Senior 18–39, Vet 40, Vet 50, Vet 60, taken from
 * the club's own prize list on `/nn/`, tested, and already the bands the race awards prizes
 * in.
 *
 * And the two halves fit without an adapter, which is the part worth noticing:
 *
 * - `ageCategoryFor(age, category)` takes an **age**, not a date of birth — and the timing
 *   model stores `runners.age_on_day` precisely because date of birth is dropped at the parser
 *   boundary and never reaches the database. The minimisation rule and the prize bands happen
 *   to want exactly the same number.
 * - `effectiveCategory(gender, placement)` resolves a non-binary runner's placement through
 *   [ADR-031](../../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md),
 *   so a solo results table gets that answer for free rather than growing a third branch.
 *
 * So this module stays what it is — the pair category for a relay, which Pass the Buck's
 * archive still needs — and a solo race is placed by `age-category.ts`. Writing a second set
 * of bands here would fork the prize list from the entry form, which is the fork ADR-002
 * argued against in the schema and holds just as well in a function.
 */

import { normaliseTimingGender } from './gender';

export type PairCategory = "Men's Pair" | "Women's Pair" | 'Mixed Pair';

export const PAIR_CATEGORIES: readonly PairCategory[] = [
  "Men's Pair",
  "Women's Pair",
  'Mixed Pair',
] as const;

// Nullable for `TimingRunner.gender`'s reason, and #202's: the column is, and this type was
// the half that said otherwise. `normaliseTimingGender` takes a null already.
type RunnerLike = { gender: string | null };

/**
 * ⚠️ **Normalised through `gender.ts` rather than compared here**, since
 * [ADR-039](../../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md)
 * gave `timing.runners.gender` one vocabulary. This function used to upper-case and test for
 * `'M'` / `'F'` inline, which was the Full On Sport CSV's shape — a roster imported from
 * `entries` says `'female'` / `'male'` and every pair would have answered `null`, rendering a
 * placeholder instead of a category on a page nobody was looking at yet.
 *
 * **A non-binary runner makes the pair uncategorised, deliberately.** The three pair
 * categories are men's, women's and mixed, and there is no fourth; ADR-031's placement is a
 * **solo prize band** answer and reading it here would invent a pair category the club does
 * not award. `null` renders a placeholder, which is the honest answer.
 */
export function deriveCategory(runners: RunnerLike[]): PairCategory | null {
  if (runners.length !== 2) return null;
  const genders = runners.map((r) => normaliseTimingGender(r.gender));
  if (!genders.every((g) => g === 'male' || g === 'female')) return null;
  const males = genders.filter((g) => g === 'male').length;
  if (males === 2) return "Men's Pair";
  if (males === 0) return "Women's Pair";
  return 'Mixed Pair';
}
