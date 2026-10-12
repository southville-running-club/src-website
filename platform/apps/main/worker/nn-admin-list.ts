/**
 * The entries list on `/admin/nn/`, as data: which rows a view holds, in what order, and what
 * each cell says about a value that is missing.
 *
 * **Pure, and separate from `nn-admin.ts` so it can be unit-tested without a Worker.** Nothing
 * here reads a database, renders markup or knows about a request; it takes the rows
 * `read_entry_list()` already returned and the query somebody asked, and answers. Filtering
 * those rows in memory is not a data change — they are the same rows, read the same way, for the
 * same event — which is why search, the category filter and the counts on the status pills cost
 * no query of their own.
 *
 * ## The query, and why it is parsed with Zod rather than read
 *
 * A query string and a form body are somebody else's input. Every value is checked against a
 * closed list or a shape, and **an unknown value falls back to the default rather than failing**
 * — a hand-typed address or an old bookmark gets the ordinary page, never an error and never a
 * value reaching anything that would act on it.
 *
 * ## The search term never travels in a URL
 *
 * A search term is a runner's name or address, and URLs reach logs, `Referer` headers and
 * browser history. The runbook's rule is that no filter carries personal data, so `q` is read
 * from a POST body and **ignored in a query string**: a `?q=` somebody typed is dropped rather
 * than honoured, because honouring it would make the URL a supported way to send a name.
 */

import { z } from 'zod';

import {
  AGE_CATEGORY_CODES,
  ageCategoryFor,
  ageCategoryLabel,
  effectiveCategory,
  type AdminEntry,
  type AgeCategoryCode,
} from '@src/shared';

// -----------------------------------------------------------------------------------------
// The query
// -----------------------------------------------------------------------------------------

/**
 * The views the status pills offer, in the order they are drawn.
 *
 * **One at a time.** The pills replaced a multi-select chip row and a sentence that hid two
 * statuses by default, and a row of pills that each show a count reads as a choice of one. A
 * bookmark from the multi-select days (`?status=paid&status=pending`) still works: the first
 * value that is recognised wins.
 *
 * `attention` and `requested` are views rather than statuses — a row they match has a real
 * status of its own, almost always `paid` — and they stay because each answers a question a
 * volunteer opens this page with: what needs a human, and what has somebody asked about.
 */
export const STATUS_VIEWS = [
  'paid',
  'pending',
  'expired',
  'refunded',
  'attention',
  'requested',
  'all',
] as const;

export type StatusView = (typeof STATUS_VIEWS)[number];

/** The view an unfiltered address opens on: the people who have paid for a place. */
export const DEFAULT_STATUS: StatusView = 'paid';

/**
 * The orders on offer.
 *
 * `name` and `category` are the two the column headers flip between; `entered` is the order
 * somebody watching the list fill up wants. The old `status` order is gone — the pills do that
 * job — and an address still carrying it falls back to `name`.
 */
export const SORTS = [
  'name',
  'name-desc',
  'category',
  'category-desc',
  'entered',
] as const;

export type Sort = (typeof SORTS)[number];

export const DEFAULT_SORT: Sort = 'name';

/** How long a search term may be. A name and an address fit with room to spare. */
export const SEARCH_MAX = 100;

/**
 * A row's place in the prize list, or the honest reason it has none.
 *
 * The four bands come from `age-category.ts` and from nothing else; the three after them are
 * the states `ageCategoryFor()` and the entry's role can produce.
 */
export type CategoryKey = AgeCategoryCode | 'under-18' | 'no-category' | 'guide';

/**
 * Prize-list order: Senior, Vet 40, Vet 50, Vet 60, then the rows nobody is placing.
 *
 * Built from `AGE_CATEGORY_CODES` rather than written out, so a fifth band is one edit in
 * `age-category.ts` and this order follows it.
 */
export const CATEGORY_ORDER = [
  ...AGE_CATEGORY_CODES,
  'under-18',
  'no-category',
  'guide',
] as const satisfies readonly CategoryKey[];

export interface EntryQuery {
  status: StatusView;
  /** Empty means every category. */
  cat: CategoryKey | '';
  /** An entry type's code, or empty for every entry type. */
  fee: string;
  sort: Sort;
  /** Trimmed, at most `SEARCH_MAX` characters, and only ever from a POST body. */
  q: string;
  /**
   * Whether the club's own test entries are shown.
   *
   * They are hidden by default — a tester's place is real and counted, and it is not what
   * somebody opens this page to look at. `hide=none` is how an address asks for them back; it
   * is the one value of the old `hide` parameter that still means anything, because the
   * refunded and expired halves of it are the status pills' job now.
   */
  showTests: boolean;
}

/** Anything with the shape of `URLSearchParams` or `FormData` — both answer `getAll`. */
export interface QuerySource {
  getAll(name: string): unknown[];
}

const strings = z
  .array(z.unknown())
  .transform((values) =>
    values.filter((value): value is string => typeof value === 'string'),
  );

/** The first value that is on the list, or the fallback. Never an error. */
function oneOf<const T extends readonly [string, ...string[]]>(
  allowed: T,
  fallback: T[number] | '',
) {
  const item = z.enum(allowed);

  return strings.transform((values): T[number] | '' => {
    for (const value of values) {
      const parsed = item.safeParse(value);

      if (parsed.success) {
        return parsed.data;
      }
    }

    return fallback;
  });
}

/**
 * Fee codes come from the rows, so a fourth one is a migration and not also a deploy. They are
 * checked for *shape* rather than against a list — an unknown code simply matches nothing, which
 * is the honest answer to a hand-typed address.
 */
const feeCode = strings.transform(
  (values) => values.find((value) => /^[a-z0-9_-]{1,40}$/.test(value)) ?? '',
);

/**
 * The search term: the last one sent, whitespace collapsed, control characters dropped, and cut
 * at `SEARCH_MAX` rather than refused — a long paste is somebody's mistake, not an attack.
 */
const searchTerm = strings.transform((values) =>
  (values.at(-1) ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_MAX),
);

const querySchema = z.object({
  status: oneOf(STATUS_VIEWS, DEFAULT_STATUS),
  cat: oneOf(CATEGORY_ORDER, ''),
  fee: feeCode,
  sort: oneOf(SORTS, DEFAULT_SORT),
  q: searchTerm,
  hide: strings,
});

/**
 * Read the query from a GET's search parameters or a POST's form body.
 *
 * `from` says which: **a search term is read from a body and never from a URL**, so the same
 * parameter typed into the address bar is ignored rather than honoured.
 */
export function parseEntryQuery(source: QuerySource, from: 'url' | 'body'): EntryQuery {
  const parsed = querySchema.parse({
    status: source.getAll('status'),
    cat: source.getAll('cat'),
    fee: source.getAll('fee'),
    sort: source.getAll('sort'),
    q: from === 'body' ? source.getAll('q') : [],
    hide: source.getAll('hide'),
  });

  return {
    status: parsed.status === '' ? DEFAULT_STATUS : parsed.status,
    cat: parsed.cat,
    fee: parsed.fee,
    sort: parsed.sort === '' ? DEFAULT_SORT : parsed.sort,
    q: parsed.q,
    // **Present and not asking for the tester code to be hidden** is how every old address
    // that showed test entries was written — `hide=none`, or a `hide=` naming only statuses.
    showTests: parsed.hide.length > 0 && !parsed.hide.includes('fee:tester'),
  };
}

/**
 * The query as GET parameters, for a link or a GET form — **without the search term**, which
 * never goes in a URL.
 *
 * Status is always written, even when it is the default, so a link to the Paid pill says
 * `status=paid` rather than relying on the reader knowing what an empty address means.
 */
export function queryParams(query: EntryQuery): [string, string][] {
  const params: [string, string][] = [['status', query.status]];

  if (query.cat !== '') params.push(['cat', query.cat]);
  if (query.fee !== '') params.push(['fee', query.fee]);
  if (query.sort !== DEFAULT_SORT) params.push(['sort', query.sort]);
  if (query.showTests) params.push(['hide', 'none']);

  return params;
}

// -----------------------------------------------------------------------------------------
// What a row is
// -----------------------------------------------------------------------------------------

/** Whether this row is flagged and nobody has cleared the flag. */
export function needsAHuman(entry: AdminEntry): boolean {
  return entry.attention !== null && !entry.attentionResolved;
}

/** Whole minutes until a hold runs out, or `null` if there is no hold to speak of. */
export function minutesLeft(
  holdExpiresAt: string | null,
  now = Date.now(),
): number | null {
  if (holdExpiresAt === null) {
    return null;
  }

  const at = Date.parse(holdExpiresAt);

  return Number.isNaN(at) ? null : Math.floor((at - now) / 60_000);
}

/**
 * **A `pending` row whose hold has lapsed is an expired hold**, and that is not a shortcut. The
 * place is already back in the pool; it stays `pending` in the column only until the five-minute
 * sweep reaches it. Filing it under "Held now" would put the busiest kind of dead row in front of
 * somebody who asked to see live holds.
 */
export function isLapsed(entry: AdminEntry, now = Date.now()): boolean {
  return entry.status === 'pending' && (minutesLeft(entry.holdExpiresAt, now) ?? 1) <= 0;
}

export function matchesStatus(
  entry: AdminEntry,
  view: StatusView,
  now = Date.now(),
): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'attention':
      return needsAHuman(entry);
    case 'requested':
      // Outstanding only. A request already dealt with is history, and a view that kept
      // showing it would fill up with rows there is nothing left to do about.
      return entry.requestedAction !== null && !entry.requestResolved;
    case 'pending':
      return entry.status === 'pending' && !isLapsed(entry, now);
    case 'expired':
      return entry.status === 'expired' || isLapsed(entry, now);
    default:
      return entry.status === view;
  }
}

/**
 * Which line of the prize list a row belongs on, or `null` for a cancelled entry — whose age
 * and race category were deleted with the entrant, so it is a purchase with nobody on it.
 */
export function categoryKeyOf(entry: AdminEntry): CategoryKey | null {
  // A guide is in no category: they are not timed and not placed, so naming a band would be
  // inventing a result. Checked first because a guide has no race category to work one out from.
  if (entry.role === 'guide') {
    return 'guide';
  }

  if (entry.age === null || entry.gender === null) {
    return null;
  }

  const category = ageCategoryFor(
    entry.age,
    effectiveCategory(entry.gender, entry.resultPlacement),
  );

  if (category.known) {
    return category.code;
  }

  return category.reason === 'not-placed' ? 'no-category' : 'under-18';
}

/** What a category key is called on the page — the band's own label, or what the gap is. */
export function categoryKeyLabel(key: CategoryKey): string {
  if (key === 'under-18') return 'Under 18';
  if (key === 'no-category') return 'No category yet';
  if (key === 'guide') return 'Guide';

  return ageCategoryLabel(key);
}

/**
 * The second line of the Category cell: the race category the prizes are awarded in.
 *
 * ⚠️ **This is `gender`, the closed list of three, and never `gender_identity`.** The prizes
 * depend on the race category — labelled "Race category" on the entry form — and every runner
 * has one, because the database refuses a runner without it. `gender_identity` is the open,
 * optional question beside it, and not answering it is an answer rather than a gap (ADR-020):
 * flagging a blank one would treat a runner as having left something out that they were told
 * they could leave out.
 *
 * **`gap` is the one state a prize list cannot place**, and it is what the page flags:
 *
 *   * a non-binary runner who has not said which of the two categories their result should
 *     count in — ADR-031 — whose band is therefore "No category yet";
 *   * a runner with no race category at all, which the database's own constraint makes
 *     impossible and which is flagged rather than trusted to stay impossible.
 *
 * Null for a guide, who is in no category, and for a cancelled entry, which has nobody on it.
 */
export function raceCategoryLine(
  entry: AdminEntry,
): { words: string; gap: boolean } | null {
  if (entry.role !== 'runner') {
    return null;
  }

  if (entry.gender === null) {
    return { words: 'Race category not given', gap: true };
  }

  if (entry.gender === 'female') return { words: 'Female', gap: false };
  if (entry.gender === 'male') return { words: 'Male', gap: false };

  if (entry.resultPlacement === null) {
    return { words: 'Non-binary, not placed', gap: true };
  }

  return { words: `Non-binary, counts as ${entry.resultPlacement}`, gap: false };
}

/**
 * The club somebody named, or `null` for none.
 *
 * **"None", an empty box and a null all mean the same thing**, and they rendered three different
 * ways — a dash on some rows and the word "None" on others, because some runners typed it. This
 * is display only: the stored value is untouched, and the exports carry whatever was entered.
 */
export function clubName(club: string | null): string | null {
  if (club === null) {
    return null;
  }

  const trimmed = club.trim();

  return trimmed === '' || /^none$/i.test(trimmed) ? null : trimmed;
}

// -----------------------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------------------

/**
 * A string folded for matching: accents off, curly apostrophes straightened, case and spacing
 * ignored — so "ines o'rourke" finds `Inés O’Rourke` and "lucja" finds `Łucja`.
 *
 * `toLowerCase` rather than a locale-aware fold: this is matching, not rendering, and the bare
 * `toLocale*String` ban is about the second.
 */
export function foldForSearch(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[‘’ʼ`]/g, "'")
      .toLowerCase()
      // The letters NFKD leaves whole, because a stroke or a ligature is not a combining
      // mark: without these, "lucja" would not find Łucja.
      .replace(/[łøđħ]/g, (letter) => STROKES[letter] ?? letter)
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const STROKES: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ħ: 'h' };

/**
 * Whether a row matches a search, on name, address or club.
 *
 * **Every word must appear somewhere**, in any order, so "harriet nwosu", "nwosu harriet" and
 * "nwosu southville" all find the same row.
 */
export function matchesSearch(entry: AdminEntry, q: string): boolean {
  const needle = foldForSearch(q);

  if (needle === '') {
    return true;
  }

  const haystack = foldForSearch(
    [entry.firstName, entry.lastName, entry.email, clubName(entry.club)]
      .filter((value): value is string => value !== null)
      .join(' '),
  );

  return needle.split(' ').every((word) => haystack.includes(word));
}

// -----------------------------------------------------------------------------------------
// The view
// -----------------------------------------------------------------------------------------

/**
 * Every filter except status, so the pills can count what each status would show.
 *
 * Test entries are left out unless asked for, **or unless somebody chose the tester entry type**
 * — a filter for exactly those rows that then hid them would be a filter that can never match,
 * which is how the Refunded filter once convinced a volunteer there had been no refunds (#116).
 */
function matchesAllButStatus(entry: AdminEntry, query: EntryQuery): boolean {
  if (!query.showTests && query.fee !== 'tester' && entry.feeCode === 'tester') {
    return false;
  }

  if (query.fee !== '' && entry.feeCode !== query.fee) {
    return false;
  }

  if (query.cat !== '' && categoryKeyOf(entry) !== query.cat) {
    return false;
  }

  return matchesSearch(entry, query.q);
}

/**
 * How many rows each pill would show, given everything else that is chosen.
 *
 * Counted with the search and the category applied, so a pill never promises rows the table
 * will not then show.
 */
export function statusCounts(
  entries: readonly AdminEntry[],
  query: EntryQuery,
  now = Date.now(),
): Record<StatusView, number> {
  const pool = entries.filter((entry) => matchesAllButStatus(entry, query));

  return Object.fromEntries(
    STATUS_VIEWS.map((view) => [
      view,
      pool.filter((entry) => matchesStatus(entry, view, now)).length,
    ]),
  ) as Record<StatusView, number>;
}

/**
 * Surname, then first name. **A row with nobody on it sorts last in every order**, flipped or
 * not: it is the one row about a place that came back rather than about somebody running, and a
 * volunteer scanning for runners should not meet it in the middle of the alphabet.
 */
function byName(a: AdminEntry, b: AdminEntry): number {
  return (
    (a.lastName ?? '').localeCompare(b.lastName ?? '', 'en-GB') ||
    (a.firstName ?? '').localeCompare(b.firstName ?? '', 'en-GB') ||
    // Deterministic, so two rows of one name cannot swap places between two loads.
    a.purchaseId.localeCompare(b.purchaseId)
  );
}

function categoryRank(entry: AdminEntry): number {
  const key = categoryKeyOf(entry);

  return key === null
    ? CATEGORY_ORDER.length
    : (CATEGORY_ORDER as readonly string[]).indexOf(key);
}

export function sortEntries(entries: readonly AdminEntry[], sort: Sort): AdminEntry[] {
  const nobody = (entry: AdminEntry): number => Number(entry.lastName === null);

  return [...entries].sort((a, b) => {
    const empty = nobody(a) - nobody(b);

    if (empty !== 0) {
      return empty;
    }

    switch (sort) {
      case 'name-desc':
        return byName(b, a);
      case 'category':
        return categoryRank(a) - categoryRank(b) || byName(a, b);
      case 'category-desc':
        return categoryRank(b) - categoryRank(a) || byName(a, b);
      case 'entered':
        // Newest first: the interesting end of a list somebody is watching fill up.
        return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

/** The rows a query shows, in the order it asked for. */
export function viewEntries(
  entries: readonly AdminEntry[],
  query: EntryQuery,
  now = Date.now(),
): AdminEntry[] {
  return sortEntries(
    entries.filter(
      (entry) =>
        matchesAllButStatus(entry, query) && matchesStatus(entry, query.status, now),
    ),
    query.sort,
  );
}

/** The category options a filter offers: the four bands always, the others only when present. */
export function categoryOptions(entries: readonly AdminEntry[]): CategoryKey[] {
  const present = new Set(entries.map(categoryKeyOf));

  return CATEGORY_ORDER.filter(
    (key) => (AGE_CATEGORY_CODES as readonly string[]).includes(key) || present.has(key),
  );
}
