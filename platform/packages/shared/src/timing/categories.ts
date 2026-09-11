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

export type PairCategory = "Men's Pair" | "Women's Pair" | 'Mixed Pair';

export const PAIR_CATEGORIES: readonly PairCategory[] = [
  "Men's Pair",
  "Women's Pair",
  'Mixed Pair',
] as const;

type RunnerLike = { gender: string };

export function deriveCategory(runners: RunnerLike[]): PairCategory | null {
  if (runners.length !== 2) return null;
  const genders = runners.map((r) => r.gender.trim().toUpperCase());
  if (!genders.every((g) => g === 'M' || g === 'F')) return null;
  const males = genders.filter((g) => g === 'M').length;
  if (males === 2) return "Men's Pair";
  if (males === 0) return "Women's Pair";
  return 'Mixed Pair';
}
