/**
 * The fabricated running the `/nn/<year>/results/` tests read, and the answers they expect.
 *
 * **Constants only, in their own file, because both runtimes need them.** `tests/timing-db.ts`
 * writes these rows from Node with `pg`; `tests/worker/admin/nn-results.test.ts` asserts them
 * from inside `workerd`, where `pg` does not exist. `admin-fixtures.ts` is the same split for
 * the same reason.
 *
 * ## Why the slug is a real `nn-<year>` and not `zz-`
 *
 * Every other fixture running in this suite is deliberately not a running of `nn`, so that
 * `entries.current_entry_state('nn')` cannot see it. **This one has no choice.** The address is
 * what names the event — `nnEventSlugForResultsPath` turns `/nn/2099/results/` into `nn-2099`
 * and there is no other input — so a results page can only be fetched for a slug of that
 * shape. What replaces the `zz-` guard is the **year**: 2099 and 2098 are runnings that will
 * not exist, they are in `timing` rather than `entries` so no entry path can reach them, and
 * the years the rest of the suite asserts about (2026 and 2027, both 404) are untouched.
 *
 * ## The two timestamps are the point of the whole fixture
 *
 * `start_at` is 11:00 and `actually_started_at` is 11:02, because **splits are measured against
 * `coalesce(actually_started_at, start_at)`** — a start delayed on the day must not inflate
 * every runner's time. That rule is invisible until the one year the start slips, so the
 * expected times below are derived from 11:02 and `WRONG_TIMES` holds what the same crossings
 * would render if somebody read `start_at` instead. Asserting both is what makes the rule
 * tested rather than merely satisfied.
 */

/** The running with a field on it. `/nn/2099/results/`. */
export const RESULTS_YEAR = '2099';
export const RESULTS_EVENT_SLUG = `nn-${RESULTS_YEAR}`;
export const RESULTS_EVENT_NAME = 'Nightingale Nightmare 2099';
export const RESULTS_PATH = `/nn/${RESULTS_YEAR}/results/`;

/** The scheduled start, and the start that actually happened two minutes later. */
export const RESULTS_START_AT = '2099-11-01T11:00:00Z';
export const RESULTS_ACTUAL_START_AT = '2099-11-01T11:02:00Z';

/** A running with no teams, no runners and no crossings. `/nn/2098/results/`. */
export const EMPTY_YEAR = '2098';
export const EMPTY_EVENT_SLUG = `nn-${EMPTY_YEAR}`;
export const EMPTY_EVENT_NAME = 'Nightingale Nightmare 2098';
export const EMPTY_PATH = `/nn/${EMPTY_YEAR}/results/`;

/**
 * A year with no `timing.events` row at all.
 *
 * ⚠️ **The refusal for this must be byte-identical to the refusal for a missing permission**,
 * because `results_for_event()` answers the same `null` to both and the page cannot tell them
 * apart on purpose. A 404 here is what says the two are still indistinguishable.
 */
export const ABSENT_PATH = '/nn/2097/results/';

export const RESULTS_EVENT_ID = '0c0c0c0c-0000-4000-8000-000000000001';
export const EMPTY_EVENT_ID = '0c0c0c0c-0000-4000-8000-000000000002';

/**
 * ⚠️ **An address and a club that must reach no page.** `timing.runners` holds both and
 * `results_for_event()`'s header promises neither is in its answer — a results table needs a
 * name, a category and a time, and minimisation applies to reads as much as to storage. Every
 * runner below carries them so that the Worker's markup can be checked for them.
 *
 * They are strings no SVG coordinate or club wordmark could produce, which is what makes
 * matching them against whole markup safe: the trap this repository has already paid for is a
 * *bare numeric* leak assertion against a document full of path data.
 */
export const LEAKED_EMAIL_DOMAIN = 'zz-timing-runner.example.com';
export const LEAKED_CLUB = 'Fixture Harriers North';

export interface ResultsTeamFixture {
  id: string;
  /** The number bibs derive from. */
  teamNumber: string;
  /** A physical bib written over the derived one at the desk, or null. */
  bibLeg1: string | null;
  category: string;
  firstName: string;
  lastName: string;
  gender: string;
  ageOnDay: number;
  /** When this runner crossed, or null for somebody still out on the course. */
  crossedAt: string | null;
  /** Whether that crossing carries an anomaly nobody has resolved. */
  openAnomaly: boolean;
  /** What the Bib column must show — the override where there is one, else the number. */
  expectedBib: string;
  /** What the Time column must show, derived from `RESULTS_ACTUAL_START_AT`. */
  expectedTime: string;
  /** What the Status column must show. */
  expectedStatus: string;
  /**
   * What the Category column must show — **derived, and never `category` above.**
   *
   * `placementFor()` resolves the gender and ADR-031's placement into one of the club's two
   * lists, and `ageCategoryFor()` names the band. `category` is left populated beside it with
   * a *different* string on purpose: `import_from_entries()` writes nothing to
   * `timing.teams.category`, so a page reading that column renders a dash for every runner the
   * club actually entered, and a fixture where the two agreed could not tell the difference.
   */
  expectedCategory: string;
  /** Finishing position, or null for a row that may not be given one. */
  expectedPosition: number | null;
}

/**
 * Three solo entries, chosen so that each column has something to be wrong about.
 *
 * - **Team 12 finishes first and team 7 second**, which is the *opposite* of team-number
 *   order. `sortResults(…, 'total')` is the only thing that produces this, so the order of the
 *   rendered rows is itself an assertion.
 * - **Team 7's bib is an override**, so `effectiveBib` is exercised rather than assumed: a page
 *   printing `team_number` directly would name 7 where the desk wrote 507.
 * - **Team 7's crossing is over an hour**, which is `formatDuration`'s other branch — `H:MM:SS`
 *   rather than `MM:SS.cs`. One fixture on each side of that switch, or half of it is untested.
 * - **Team 7 carries an open anomaly**, so the row wears "being checked" rather than being
 *   hidden or shown as a confident time.
 * - **Team 21 never crossed**, so it is "On course" with no time and — the part worth
 *   asserting — **no position number**, which a running count over every row would get wrong.
 */
export const RESULTS_TEAMS: readonly ResultsTeamFixture[] = [
  {
    id: '0c0c0c0c-0000-4000-8000-000000000011',
    teamNumber: '12',
    bibLeg1: null,
    category: 'Senior Women',
    firstName: 'Bernadette',
    lastName: 'Odell',
    gender: 'F',
    ageOnDay: 34,
    crossedAt: '2099-11-01T11:47:23.450Z',
    openAnomaly: false,
    expectedBib: '12',
    // 11:02:00.000 → 11:47:23.450 is 45m 23.45s.
    expectedTime: '45:23.45',
    expectedStatus: 'Finished',
    expectedCategory: "Women's Senior",
    expectedPosition: 1,
  },
  {
    id: '0c0c0c0c-0000-4000-8000-000000000012',
    teamNumber: '7',
    bibLeg1: '507',
    category: 'Vet 50 Men',
    firstName: 'Callum',
    lastName: 'Prydderch',
    gender: 'M',
    ageOnDay: 51,
    crossedAt: '2099-11-01T12:14:07.000Z',
    openAnomaly: true,
    expectedBib: '507',
    // 11:02:00 → 12:14:07 is 1h 12m 7s, which is formatDuration's H:MM:SS branch.
    expectedTime: '1:12:07',
    expectedStatus: 'Finished',
    expectedCategory: "Men's Vet 50",
    expectedPosition: 2,
  },
  {
    id: '0c0c0c0c-0000-4000-8000-000000000013',
    teamNumber: '21',
    bibLeg1: null,
    category: 'Senior Women',
    firstName: 'Dilys',
    lastName: 'Anwyl',
    gender: 'F',
    ageOnDay: 27,
    crossedAt: null,
    openAnomaly: false,
    expectedBib: '21',
    expectedTime: '—',
    expectedStatus: 'On course',
    expectedCategory: "Women's Senior",
    expectedPosition: null,
  },
] as const;

/**
 * What the two finishers would render if the delayed start were ignored.
 *
 * Measured from `RESULTS_START_AT` rather than `RESULTS_ACTUAL_START_AT` — two minutes slower
 * apiece. Asserting these are **absent** is what makes the `coalesce` rule tested: without it,
 * a page reading `start_at` would produce perfectly plausible times and nothing would notice.
 */
export const WRONG_TIMES = ['47:23.45', '1:14:07'] as const;

// ===========================================================================================
// The two runnings #242 added, and the states they are in
// ===========================================================================================
// ⚠️ **Publication is the only thing that opens this page to the internet**, so the two states
// either side of it each need a running of their own: a race that has been **finished and not
// published**, which a signed-out visitor must still meet a 404 at, and a **published** one,
// which is the first page on this site a stranger may read.
//
// **Two more years that will not happen**, for `timing-fixtures.ts`'s own reason: the address
// is what names the event, so a results fixture has to be a real `nn-<year>`, and a year nobody
// will ever run is what replaces the `zz-` guard the rest of this suite uses.
//
// ⚠️ **Neither is written by a test.** Both are read-only fixtures, seeded once and never
// changed, which is what lets them be shared across Playwright projects the way the two above
// are — `seedRosterEvent`'s argument in `timing-db.ts` is about fixtures a test *writes*.

/** Finished, and nobody has published it. `/nn/2096/results/` is still a 404 to the public. */
export const FINISHED_YEAR = '2096';
export const FINISHED_EVENT_SLUG = `nn-${FINISHED_YEAR}`;
export const FINISHED_EVENT_NAME = 'Nightingale Nightmare 2096';
export const FINISHED_PATH = `/nn/${FINISHED_YEAR}/results/`;
export const FINISHED_EVENT_ID = '0c0c0c0c-0000-4000-8000-000000000003';

/** Published. `/nn/2095/results/` is public, cacheable and indexable. */
export const PUBLISHED_YEAR = '2095';
export const PUBLISHED_EVENT_SLUG = `nn-${PUBLISHED_YEAR}`;
export const PUBLISHED_EVENT_NAME = 'Nightingale Nightmare 2095';
export const PUBLISHED_PATH = `/nn/${PUBLISHED_YEAR}/results/`;
export const PUBLISHED_EVENT_ID = '0c0c0c0c-0000-4000-8000-000000000004';

export const PUBLISHED_START_AT = '2095-11-06T11:00:00Z';

export interface PublishedTeamFixture {
  id: string;
  teamNumber: string;
  firstName: string;
  lastName: string;
  /** `entries`' vocabulary — what `import_from_entries()` writes since ADR-039. */
  gender: string | null;
  /** ADR-031's answer, and null for everybody who was never asked. */
  resultPlacement: 'female' | 'male' | null;
  ageOnDay: number | null;
  crossedAt: string;
  expectedTime: string;
  /**
   * What the Category column must show **on the published page**, where there is no age to
   * derive a band from — ADR-043. The band the same runner shows in the preview is
   * `previewCategory`.
   */
  expectedCategory: string;
  /** What the same row shows to a holder of `nn.results.read` before publication. */
  previewCategory: string;
}

/**
 * Three finishers, chosen so that the category column has something to be wrong about in each
 * of the three ways it can be.
 *
 * - **Nesta is `female` in `entries`' vocabulary**, which the legacy `'F'` fixtures above do
 *   not exercise at all — `normaliseTimingGender()` accepts both and a page that only ever met
 *   one spelling proves nothing about the other.
 * - ⚠️ **Rhodri is `non_binary` and asked to be placed with the men**, which is the assertion
 *   [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)
 *   is for: reading `gender` alone renders *no category* for them however they answered, and
 *   that is a silent wrong answer rather than a failure.
 * - **Ozzy has no gender recorded**, so there is no category and the column says so. Unknown
 *   means no band rather than a guess, which is the rule everywhere else in the timing logic.
 */
export const PUBLISHED_TEAMS: readonly PublishedTeamFixture[] = [
  {
    id: '0c0c0c0c-0000-4000-8000-000000000041',
    teamNumber: '3',
    firstName: 'Nesta',
    lastName: 'Vaughan',
    gender: 'female',
    resultPlacement: null,
    ageOnDay: 62,
    crossedAt: '2095-11-06T11:44:10.000Z',
    // 11:00:00 → 11:44:10 is 44m 10s. `start_at` only: this running was not delayed.
    expectedTime: '44:10.00',
    expectedCategory: 'Women',
    previewCategory: "Women's Vet 60",
  },
  {
    id: '0c0c0c0c-0000-4000-8000-000000000042',
    teamNumber: '8',
    firstName: 'Rhodri',
    lastName: 'Bevan',
    gender: 'non_binary',
    resultPlacement: 'male',
    ageOnDay: 41,
    crossedAt: '2095-11-06T11:52:30.000Z',
    expectedTime: '52:30.00',
    expectedCategory: 'Men',
    previewCategory: "Men's Vet 40",
  },
  {
    id: '0c0c0c0c-0000-4000-8000-000000000043',
    teamNumber: '15',
    firstName: 'Ozzy',
    lastName: 'Treharne',
    gender: null,
    resultPlacement: null,
    ageOnDay: 33,
    crossedAt: '2095-11-06T12:01:05.000Z',
    expectedTime: '1:01:05',
    expectedCategory: '—',
    previewCategory: '—',
  },
];

/**
 * ⚠️ **The exact ages the published page may not print** — ADR-043, which withholds
 * `age_on_day` from `results_for_event()`'s answer the moment a race is published.
 *
 * **Not matched against the whole document**, and that restraint is the point: these are bare
 * numbers, and this repository has already paid for a leak assertion that matched one against
 * rendered markup full of SVG path data. They are checked against the table's own cells, where
 * a number can only have got there by being printed as a fact about somebody.
 */
export const PUBLISHED_AGES = PUBLISHED_TEAMS.map((team) => String(team.ageOnDay));
