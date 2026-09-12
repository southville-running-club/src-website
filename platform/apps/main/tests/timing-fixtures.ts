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
