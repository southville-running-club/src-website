import { describe, expect, it } from 'vitest';
import type { AdminEntry } from '@src/shared';

import {
  CATEGORY_ORDER,
  DEFAULT_SORT,
  DEFAULT_STATUS,
  SEARCH_MAX,
  categoryKeyOf,
  categoryOptions,
  clubName,
  foldForSearch,
  matchesSearch,
  parseEntryQuery,
  queryParams,
  raceCategoryLine,
  sortEntries,
  statusCounts,
  viewEntries,
  type EntryQuery,
} from '../../worker/nn-admin-list';

/**
 * The entries list on `/admin/nn/`, as data — which rows a view holds, in what order, and what a
 * missing value says.
 *
 * **Every fixture is invented**: fixed ids, fixed timestamps, `example.com` addresses. The rows
 * carry the awkward states on purpose — an apostrophe, a non-ASCII name, a very long address, a
 * club stored as "None", a non-binary runner nobody has placed, a refund and a lapsed hold —
 * because those are what break a list.
 */

/** A fixed clock: holds are live or lapsed against this, never against the machine's. */
const NOW = Date.parse('2026-10-11T10:00:00Z');

let serial = 0;

function entry(overrides: Partial<AdminEntry> = {}): AdminEntry {
  serial += 1;
  const id = String(serial).padStart(12, '0');

  return {
    entrantId: `00000000-0000-4000-8000-${id}`,
    purchaseId: `11111111-0000-4000-8000-${id}`,
    entryNo: serial,
    email: `runner${serial}@example.com`,
    firstName: 'Ada',
    lastName: 'Okafor',
    club: 'Southville Running Club',
    age: 35,
    gender: 'female',
    resultPlacement: null,
    genderIdentity: null,
    role: 'runner',
    discountCode: null,
    feeCode: 'unaffiliated',
    feeLabel: 'Unaffiliated',
    amountPence: 2000,
    status: 'paid',
    attention: null,
    attentionResolved: false,
    requestedAction: null,
    requestReason: null,
    requestResolved: false,
    requests: [],
    hasMedical: false,
    createdAt: '2026-09-01T06:00:00Z',
    paidAt: '2026-09-01T06:05:00Z',
    holdExpiresAt: null,
    revived: false,
    ...overrides,
  };
}

const query = (overrides: Partial<EntryQuery> = {}): EntryQuery => ({
  status: 'all',
  cat: '',
  fee: '',
  sort: 'name',
  q: '',
  showTests: false,
  ...overrides,
});

const params = (search: string) => new URLSearchParams(search);

function body(fields: [string, string][]): FormData {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  return form;
}

// The awkward rows, shared by the filter, search and sort tests below.
const apostrophe = entry({ firstName: 'Inés', lastName: 'O’Rourke', age: 52 });
const nonAscii = entry({ firstName: 'Łucja', lastName: 'Żółkiewska', age: 61 });
const longEmail = entry({
  firstName: 'Bartholomew',
  lastName: 'Featherstonehaugh',
  email: 'bartholomew.featherstonehaugh.the.third@running.example.com',
  age: 44,
  gender: 'male',
});
const noClub = entry({ firstName: 'Kwame', lastName: 'Adjei', club: 'None', age: 23 });
const unplaced = entry({
  firstName: 'Sam',
  lastName: 'Rivers',
  gender: 'non_binary',
  resultPlacement: null,
  age: 57,
});
const refunded = entry({
  entrantId: null,
  firstName: null,
  lastName: null,
  age: null,
  gender: null,
  role: null,
  club: null,
  status: 'refunded',
});
const lapsedHold = entry({
  firstName: 'Marek',
  lastName: 'Toms',
  status: 'pending',
  paidAt: null,
  holdExpiresAt: '2026-10-11T09:30:00Z',
});
const liveHold = entry({
  firstName: 'Priya',
  lastName: 'Nair',
  status: 'pending',
  paidAt: null,
  holdExpiresAt: '2026-10-11T10:20:00Z',
});
const tester = entry({ firstName: 'Tess', lastName: 'Tester', feeCode: 'tester' });
const guide = entry({
  firstName: 'Gil',
  lastName: 'Guide',
  role: 'guide',
  gender: null,
  amountPence: 0,
});

const FIELD = [
  apostrophe,
  nonAscii,
  longEmail,
  noClub,
  unplaced,
  refunded,
  lapsedHold,
  liveHold,
  tester,
  guide,
];

const names = (rows: AdminEntry[]) => rows.map((row) => row.lastName);

describe('parseEntryQuery', () => {
  it('opens on paid entries, by surname, with test entries left out', () => {
    expect(parseEntryQuery(params(''), 'url')).toEqual({
      status: DEFAULT_STATUS,
      cat: '',
      fee: '',
      sort: DEFAULT_SORT,
      q: '',
      showTests: false,
    });
    expect(DEFAULT_STATUS).toBe('paid');
  });

  it('reads every parameter it knows', () => {
    expect(
      parseEntryQuery(
        params('status=refunded&cat=vet50&fee=affiliated&sort=category-desc&hide=none'),
        'url',
      ),
    ).toEqual({
      status: 'refunded',
      cat: 'vet50',
      fee: 'affiliated',
      sort: 'category-desc',
      q: '',
      showTests: true,
    });
  });

  it('falls back to the default for garbage, and never throws', () => {
    const parsed = parseEntryQuery(
      params(
        'status=%27%3B+drop&cat=vet99&fee=%3Cscript%3E&sort=../../etc&hide=fee:tester',
      ),
      'url',
    );

    expect(parsed).toEqual({
      status: 'paid',
      cat: '',
      fee: '',
      sort: 'name',
      q: '',
      showTests: false,
    });
  });

  it('takes the first value it recognises, so an old multi-select bookmark still opens', () => {
    expect(
      parseEntryQuery(params('status=nonsense&status=pending&status=paid'), 'url'),
    ).toMatchObject({ status: 'pending' });
  });

  it('treats the retired status sort and status hides as the defaults', () => {
    expect(
      parseEntryQuery(params('sort=status&hide=status:refunded'), 'url'),
    ).toMatchObject(
      // **A `hide=` that does not name the tester code showed test entries before**, and still
      // does: that is what every old address carrying one meant.
      { sort: 'name', showTests: true },
    );
  });

  it('ignores a search term in a URL, and reads one from a body', () => {
    // **The rule is the runbook's**: no filter carries personal data, so a `?q=` somebody typed
    // is dropped rather than honoured.
    expect(parseEntryQuery(params('q=Nwosu'), 'url').q).toBe('');
    expect(parseEntryQuery(body([['q', 'Nwosu']]), 'body').q).toBe('Nwosu');
  });

  it('tidies a search term rather than refusing it', () => {
    const parsed = parseEntryQuery(
      body([['q', `  harriet\n\t  nwosu ${'x'.repeat(200)}`]]),
      'body',
    );

    expect(parsed.q.startsWith('harriet nwosu x')).toBe(true);
    expect(parsed.q).toHaveLength(SEARCH_MAX);
  });

  it('keeps markup in a search term as text for the template to escape', () => {
    // Escaping is `html.ts`'s job and is asserted there; the parser's is to not mangle the
    // term into something the page then echoes differently from what was typed.
    expect(parseEntryQuery(body([['q', '<script>alert(1)</script>']]), 'body').q).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('ignores a value that is not a string, as a file upload would be', () => {
    const form = new FormData();
    form.append('status', new Blob(['refunded']));

    expect(parseEntryQuery(form, 'body').status).toBe('paid');
  });
});

describe('queryParams', () => {
  it('never writes the search term into an address', () => {
    expect(queryParams(query({ q: 'Nwosu', status: 'paid' }))).toEqual([
      ['status', 'paid'],
    ]);
  });

  it('writes the status even when it is the default, and leaves other defaults out', () => {
    expect(queryParams(query({ status: 'paid' }))).toEqual([['status', 'paid']]);
    expect(
      queryParams(
        query({
          status: 'all',
          cat: 'vet40',
          fee: 'tester',
          sort: 'entered',
          showTests: true,
        }),
      ),
    ).toEqual([
      ['status', 'all'],
      ['cat', 'vet40'],
      ['fee', 'tester'],
      ['sort', 'entered'],
      ['hide', 'none'],
    ]);
  });
});

describe('clubName', () => {
  it('treats "None", an empty box and a null as the same thing', () => {
    expect(clubName(null)).toBeNull();
    expect(clubName('')).toBeNull();
    expect(clubName('   ')).toBeNull();
    expect(clubName('None')).toBeNull();
    expect(clubName(' none ')).toBeNull();
    expect(clubName('NONE')).toBeNull();
  });

  it('leaves a real club alone, including one that merely contains the word', () => {
    expect(clubName('Bristol & West AC, "the Bees"')).toBe(
      'Bristol & West AC, "the Bees"',
    );
    expect(clubName('Nonesuch Harriers')).toBe('Nonesuch Harriers');
    expect(clubName('  Southville Running Club ')).toBe('Southville Running Club');
  });
});

describe('raceCategoryLine', () => {
  it('names the race category the prizes are awarded in', () => {
    expect(raceCategoryLine(entry({ gender: 'female' }))).toEqual({
      words: 'Female',
      gap: false,
    });
    expect(raceCategoryLine(entry({ gender: 'male' }))).toEqual({
      words: 'Male',
      gap: false,
    });
    expect(
      raceCategoryLine(entry({ gender: 'non_binary', resultPlacement: 'male' })),
    ).toEqual({ words: 'Non-binary, counts as male', gap: false });
  });

  it('flags a runner a prize list cannot place', () => {
    expect(raceCategoryLine(unplaced)).toEqual({
      words: 'Non-binary, not placed',
      gap: true,
    });
    // Impossible by constraint, and flagged rather than trusted to stay impossible.
    expect(raceCategoryLine(entry({ gender: null }))).toEqual({
      words: 'Race category not given',
      gap: true,
    });
  });

  it('never flags a runner who left the optional gender question blank', () => {
    // **ADR-020: not answering is an answer.** `gender_identity` is not what this line reads.
    expect(raceCategoryLine(entry({ gender: 'female', genderIdentity: null }))?.gap).toBe(
      false,
    );
  });

  it('says nothing for a guide or a cancelled entry, who are in no category', () => {
    expect(raceCategoryLine(guide)).toBeNull();
    expect(raceCategoryLine(refunded)).toBeNull();
  });
});

describe('categoryKeyOf', () => {
  it('bands a runner from their age and race category', () => {
    expect(categoryKeyOf(entry({ age: 35 }))).toBe('senior');
    expect(categoryKeyOf(entry({ age: 44 }))).toBe('vet40');
    expect(categoryKeyOf(apostrophe)).toBe('vet50');
    expect(categoryKeyOf(nonAscii)).toBe('vet60');
  });

  it('names the rows nobody is placing', () => {
    expect(categoryKeyOf(unplaced)).toBe('no-category');
    expect(categoryKeyOf(guide)).toBe('guide');
    expect(categoryKeyOf(refunded)).toBeNull();
  });

  it('orders the prize list Senior, Vet 40, Vet 50, Vet 60', () => {
    expect(CATEGORY_ORDER.slice(0, 4)).toEqual(['senior', 'vet40', 'vet50', 'vet60']);
  });

  it('offers the four bands always, and the other categories only when a row has one', () => {
    expect(categoryOptions([entry()])).toEqual(['senior', 'vet40', 'vet50', 'vet60']);
    expect(categoryOptions([unplaced, guide])).toEqual([
      'senior',
      'vet40',
      'vet50',
      'vet60',
      'no-category',
      'guide',
    ]);
  });
});

describe('search', () => {
  it('folds accents, curly apostrophes, case and spacing', () => {
    expect(foldForSearch('  Inés   O’Rourke ')).toBe("ines o'rourke");
    expect(foldForSearch('ŻÓŁKIEWSKA')).toBe('zolkiewska');
    expect(foldForSearch('Søren Æbelø')).toBe('soren aebelo');
  });

  it('finds a name with a straight apostrophe and no accent', () => {
    expect(matchesSearch(apostrophe, "ines o'rourke")).toBe(true);
    expect(matchesSearch(apostrophe, 'o’rourke')).toBe(true);
  });

  it('finds a non-ASCII name, typed with or without its marks', () => {
    expect(matchesSearch(nonAscii, 'Żółkiewska')).toBe(true);
    expect(matchesSearch(nonAscii, 'lucja')).toBe(true);
  });

  it('matches on address and club, and on every word in any order', () => {
    expect(matchesSearch(longEmail, 'the.third@running')).toBe(true);
    expect(matchesSearch(apostrophe, 'southville rourke')).toBe(true);
    expect(matchesSearch(apostrophe, 'rourke harriers')).toBe(false);
  });

  it('does not match a club stored as "None" by the word none', () => {
    // It is displayed as no club, so finding it by "none" would be finding something the page
    // says is not there.
    expect(matchesSearch(noClub, 'none')).toBe(false);
  });

  it('matches everything when the term is empty', () => {
    expect(matchesSearch(refunded, '')).toBe(true);
    expect(matchesSearch(refunded, '   ')).toBe(true);
  });
});

describe('viewEntries', () => {
  it('shows only paid entries by default, and never the test entries', () => {
    const rows = viewEntries(FIELD, parseEntryQuery(params(''), 'url'), NOW);

    expect(rows.every((row) => row.status === 'paid')).toBe(true);
    expect(rows).not.toContain(tester);
    expect(rows).toContain(apostrophe);
  });

  it('files a lapsed hold under expired, not under held now', () => {
    expect(viewEntries(FIELD, query({ status: 'pending' }), NOW)).toEqual([liveHold]);
    expect(viewEntries(FIELD, query({ status: 'expired' }), NOW)).toEqual([lapsedHold]);
  });

  it('shows only refunded rows for the refunded pill', () => {
    expect(viewEntries(FIELD, query({ status: 'refunded' }), NOW)).toEqual([refunded]);
  });

  it('shows test entries when they are asked for by type, even without the hide toggle', () => {
    // A filter for exactly those rows that then hid them could never match — #116 again.
    expect(viewEntries(FIELD, query({ fee: 'tester' }), NOW)).toEqual([tester]);
    expect(viewEntries(FIELD, query({ showTests: true }), NOW)).toContain(tester);
  });

  it('narrows by category and by search together', () => {
    expect(viewEntries(FIELD, query({ cat: 'vet50' }), NOW)).toEqual([apostrophe]);
    expect(viewEntries(FIELD, query({ cat: 'no-category' }), NOW)).toEqual([unplaced]);
    expect(viewEntries(FIELD, query({ q: 'okafor', cat: 'vet60' }), NOW)).toEqual([]);
  });
});

describe('statusCounts', () => {
  it('counts what each pill would show, with everything else applied', () => {
    const counts = statusCounts(FIELD, query(), NOW);

    expect(counts).toMatchObject({
      paid: 6,
      pending: 1,
      expired: 1,
      refunded: 1,
      all: 9,
    });
    // The tester's row is hidden, so it is not counted under any pill.
    expect(counts.all).toBe(FIELD.length - 1);
  });

  it('follows the search, so a pill never promises a row the table will not show', () => {
    expect(statusCounts(FIELD, query({ q: 'toms' }), NOW)).toMatchObject({
      paid: 0,
      expired: 1,
      all: 1,
    });
  });
});

describe('sortEntries', () => {
  const runners = [apostrophe, nonAscii, longEmail, noClub, unplaced, refunded, guide];

  it('sorts by surname A to Z by default, with a row nobody is on last', () => {
    expect(names(sortEntries(runners, 'name'))).toEqual([
      'Adjei',
      'Featherstonehaugh',
      'Guide',
      'O’Rourke',
      'Rivers',
      'Żółkiewska',
      null,
    ]);
  });

  it('flips to Z to A and still keeps the empty row last', () => {
    expect(names(sortEntries(runners, 'name-desc'))).toEqual([
      'Żółkiewska',
      'Rivers',
      'O’Rourke',
      'Guide',
      'Featherstonehaugh',
      'Adjei',
      null,
    ]);
  });

  it('sorts by category in prize-list order, then by surname', () => {
    expect(names(sortEntries(runners, 'category'))).toEqual([
      'Adjei', // Senior
      'Featherstonehaugh', // Vet 40
      'O’Rourke', // Vet 50
      'Żółkiewska', // Vet 60
      'Rivers', // No category yet
      'Guide', // Guide
      null,
    ]);
  });

  it('flips the category order and keeps surname order within a band', () => {
    const twoSeniors = [noClub, entry({ lastName: 'Abara', age: 30 }), nonAscii];

    expect(names(sortEntries(twoSeniors, 'category-desc'))).toEqual([
      'Żółkiewska',
      'Abara',
      'Adjei',
    ]);
  });

  it('puts the newest first for the entered order', () => {
    const early = entry({ lastName: 'Early', createdAt: '2026-09-01T06:00:00Z' });
    const late = entry({ lastName: 'Late', createdAt: '2026-09-20T18:00:00Z' });

    expect(names(sortEntries([early, late], 'entered'))).toEqual(['Late', 'Early']);
  });
});
