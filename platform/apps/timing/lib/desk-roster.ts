import { resultCategoryLabel, isGuide } from '@src/shared/timing/result-category';
import { placementFor } from '@src/shared/timing/gender';

/**
 * The Roster page's rules — ADR-056 — kept pure so they are unit-tested rather than trusted:
 * the category a row shows, the search a desk volunteer types, and the order the table is in.
 *
 * One row is one **runner**: Nightingale Nightmare is a solo race, and a visually impaired
 * runner's guide is a runner of their own on the same team, wearing a bib.
 */

/** One row of `timing.desk_roster()`'s `runners`. */
export interface DeskRunner {
  runner_id: string;
  team_id: string;
  leg: number;
  firstname: string;
  lastname: string;
  bib: string | null;
  race_status: 'dns' | 'dnf' | 'dq' | null;
  gender: string | null;
  result_placement: 'female' | 'male' | null;
  role: string | null;
  /** An admin's read only. A marshal's is `null`, so their category has no age band. */
  age_on_day: number | null;
}

export interface DeskRoster {
  event: { slug: string; name: string; format: 'solo' | 'relay' };
  runners: DeskRunner[];
}

/**
 * The Category cell.
 *
 * - A guide is **"Guide"** — in no category and no prize (ADR-022) — rather than a blank, which
 *   would read as the club not having worked it out yet.
 * - With an age, the full race category — "Women's Vet 40" — through the same
 *   `resultCategoryLabel()` the results use, so the two can never disagree.
 * - Without one — every marshal, and anybody whose age is not recorded — **"Women" or "Men"**:
 *   true, and all a marshal looking a runner up needs. `placementFor()` is ADR-031's resolver, so
 *   a non-binary runner shows where they asked to be placed.
 * - Otherwise a dash.
 */
export function categoryFor(runner: DeskRunner): string {
  if (isGuide(runner)) return 'Guide';

  const full = resultCategoryLabel([runner], 'solo');
  if (full !== null) return full;

  const placement = placementFor(runner.gender, runner.result_placement);
  if (placement === 'female') return 'Women';
  if (placement === 'male') return 'Men';
  return '—';
}

/** Case- and accent-insensitive, and spacing-insensitive: "Ó'Dell  " is "o'dell". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The ways somebody at a desk says a name: "Jane", "Smith", "jane smith", "smith jane",
 * "Smith, J" — and the bib.
 */
function haystacks(runner: DeskRunner): string[] {
  const first = fold(runner.firstname);
  const last = fold(runner.lastname);
  return [
    first,
    last,
    `${first} ${last}`,
    `${last} ${first}`,
    `${last}, ${first}`,
    fold(runner.bib ?? ''),
  ];
}

/** Whether the runner's bib is exactly what was typed — the case the desk most wants. */
export function isExactBib(runner: DeskRunner, query: string): boolean {
  const q = query.trim();
  return q !== '' && runner.bib === q;
}

/** The runners matching a search, with an exact bib match first. A blank search is everybody. */
export function searchRoster(
  runners: readonly DeskRunner[],
  query: string,
): DeskRunner[] {
  const q = fold(query);
  if (q === '') return [...runners];

  const matches = runners.filter((runner) =>
    haystacks(runner).some((h) => h.includes(q)),
  );
  return [
    ...matches.filter((runner) => isExactBib(runner, query)),
    ...matches.filter((runner) => !isExactBib(runner, query)),
  ];
}

export type SortKey = 'name' | 'status' | 'category' | 'bib';
export type SortDir = 'asc' | 'desc';

export const SORT_KEYS: readonly SortKey[] = ['name', 'status', 'category', 'bib'];

/** Normal first, then the three labels in the order a race runs: DNS, DNF, DQ. */
const STATUS_ORDER: Record<string, number> = { normal: 0, dns: 1, dnf: 2, dq: 3 };

/** Natural, so 9 comes before 10; case- and accent-insensitive, as a person reads a list. */
const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });

/** A blank sorts last whichever way the column is turned — a missing bib is never "first". */
function compareBlankLast(a: string, b: string, dir: SortDir): number {
  const blankA = a === '' || a === '—';
  const blankB = b === '' || b === '—';
  if (blankA !== blankB) return blankA ? 1 : -1;
  const order = collator.compare(a, b);
  return dir === 'asc' ? order : -order;
}

function byName(a: DeskRunner, b: DeskRunner): number {
  return (
    collator.compare(a.lastname, b.lastname) ||
    collator.compare(a.firstname, b.firstname) ||
    a.runner_id.localeCompare(b.runner_id)
  );
}

/**
 * The table's order. **Surname by default** — a desk list is alphabetical by surname. Every
 * other column falls back to surname, so equal values keep a predictable order.
 */
export function sortRoster(
  runners: readonly DeskRunner[],
  key: SortKey,
  dir: SortDir,
): DeskRunner[] {
  const sorted = [...runners];
  sorted.sort((a, b) => {
    if (key === 'name') return dir === 'asc' ? byName(a, b) : byName(b, a);

    let order: number;
    if (key === 'status') {
      const sa = STATUS_ORDER[a.race_status ?? 'normal'] ?? 0;
      const sb = STATUS_ORDER[b.race_status ?? 'normal'] ?? 0;
      order = dir === 'asc' ? sa - sb : sb - sa;
    } else if (key === 'category') {
      order = compareBlankLast(categoryFor(a), categoryFor(b), dir);
    } else {
      order = compareBlankLast(a.bib ?? '', b.bib ?? '', dir);
    }
    return order || byName(a, b);
  });
  return sorted;
}

/** What a race status reads as, in a chip. Normal is a muted dash. */
export const STATUS_LABEL: Record<string, string> = {
  normal: '—',
  dns: 'DNS',
  dnf: 'DNF',
  dq: 'DQ',
};

/** A `?sort=` value, or the default. */
export function sortFrom(value: string | undefined): SortKey {
  return SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : 'name';
}

/** A `?dir=` value, or ascending. */
export function dirFrom(value: string | undefined): SortDir {
  return value === 'desc' ? 'desc' : 'asc';
}
