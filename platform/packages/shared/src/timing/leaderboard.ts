import { effectiveBib } from './bib';
import {
  buildResults,
  isTerminalStatus,
  raceStartIso,
  sortResults,
  type ResultStatus,
  type SortKey,
} from './results';
import type { TimingCrossing, TimingEvent, TimingRunner, TimingTeam } from './rows';

/**
 * The live leaderboard, as a value — everything the board shows, and nothing about how it got
 * there.
 *
 * ## ⚠️ Why this file exists at all, when `buildResults()` is right there
 *
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * makes the Durable Objects leaderboard **the slice the race simulation cuts** if it fails, and
 * says in the same breath that *"falling back to Supabase Realtime must stay possible, so keep the
 * derivation independent of the transport"*. That instruction is only worth anything if there is a
 * seam to keep — and `buildResults()` alone is not it. It answers *"what are the times"*; a board
 * also has to answer *"in what order, which row is first, which row is not to be trusted, and
 * which columns does this race even have"*, and every one of those was inline JSX in the old
 * application, which is exactly why the leaderboard could not be tested without a browser.
 *
 * So: this module is the whole of the answer, `apps/timing` renders it, and
 * `apps/timing/durable-objects/leaderboard-room.ts` does nothing but say *"ask again"*. Deleting
 * the Durable Object and polling instead would not change one line in this file.
 *
 * ⚠️ **It contains no words a volunteer reads and no timezone.** Statuses are the enum
 * `results.ts` already defines, and every wording decision is
 * `apps/timing/lib/leaderboard-outcomes.ts` — the club's voice lives in a `lib/*-outcomes.ts`
 * module, not in a schema and not in shared logic. Every instant stays an ISO string for
 * `packages/shared/src/london-time.ts` to render; every duration is UTC milliseconds, which have
 * no zone at all.
 *
 * ## The two things #204 asked for that were genuinely new
 *
 * [#204](https://github.com/southville-running-club/src-website/issues/204)'s refinement narrowed
 * its own scope, and this is the narrowed part:
 *
 *   > Solo path is already in `buildResults()` … What remains new is the **display of a
 *   > single-crossing finish** and the **marking of a suspect row**.
 *
 * | | |
 * | --- | --- |
 * | {@link Leaderboard.columns} | the single-crossing finish, decided once. A solo race has one crossing per entry, so leg A and leg B are not empty columns — they do not exist, and a board that rendered two dashes beside every time would be inviting a volunteer to wonder what went wrong |
 * | {@link LeaderboardRow.suspect} | the marking. A row with an unresolved anomaly keeps its time and wears a warning, because *showing a confidently-wrong time is worse than showing an uncertain one, and dropping the row entirely is worse than both* — somebody's runner vanishes from the board while they are watching for them |
 */

/** The columns of time a board has. A solo race has one; a relay has three. */
export type LeaderboardColumn = 'splitA' | 'splitB' | 'total';

/** One participant on a row, with the one fact a board has to know about them. */
export interface LeaderboardRunner {
  id: string;
  /** 1 or 2. A solo entry has leg 1 — unless it carries a guide, who is leg 2 of the same team. */
  leg: number;
  firstname: string;
  lastname: string;
  /**
   * A visually impaired runner's guide —
   * [ADR-022](../../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md).
   *
   * ⚠️ **They are in no category and no prize, and this is not a cosmetic mark.** On a solo race
   * `import_from_entries()` puts the runner on leg 1 and their guide on leg 2 of **the same
   * team**, so the row carries two names and one time — and the time is the runner's. A board
   * with no way to say which is which prints a guide as though they had a result.
   *
   * ⚠️ **False means "not a guide as far as this answer goes", never "provably a runner".**
   * `runners.role` is null in the published payload by design — ADR-043 withholds it, because a
   * guide on leg 2 discloses their runner's disability by inference — so a caller handed the
   * public shape sees `false` for everybody. `timing.leaderboard()` is staff-only and does carry
   * the column; that migration's header carries the argument.
   */
  guide: boolean;
}

/** One entry's line on the board. */
export interface LeaderboardRow {
  teamId: string;
  /** The number bibs are derived from. Null for a team imported before bibs were assigned. */
  teamNumber: string | null;
  teamName: string | null;
  /** `teams.category` — the race's own entry-list category, never a computed prize band. */
  category: string | null;
  /**
   * The numbers this entry is wearing, in leg order — one on a solo race, up to two on a relay.
   *
   * ⚠️ **Resolved here through `effectiveBib()` rather than rendered by the page**, which is the
   * same reason the splits are: it is the one definition the bib collision guard and the SQL/TS
   * parity test also use, and it coalesces an override the registration desk typed over the
   * derived number. A template rebuilding `${leg}${team_number}` for itself is a second
   * implementation of the rule #249 spent a migration pinning.
   *
   * Empty for a team imported before bibs were assigned, which is a state a board legitimately
   * shows — the entry exists and has no number yet.
   */
  bibs: string[];
  runners: LeaderboardRunner[];
  status: ResultStatus;
  /** Whether {@link status} is one of the three whole-team terminal labels. */
  terminal: boolean;
  /**
   * A crossing contributing to this row carries an unresolved anomaly — see the module header.
   *
   * The time is still shown. This says *"we know this row may be wrong and somebody is looking at
   * it"*, which is the only honest thing a board can say about a capture a human has not yet
   * decided about.
   */
  suspect: boolean;
  /**
   * Where this row stands overall — 1 for the leader, `null` for anybody with no total time.
   *
   * ⚠️ **Derived from the total time and never from the row's place in the sorted array**, which
   * is the bug this field exists to make impossible: a board sorted by category or by leg A would
   * otherwise number its rows 1, 2, 3 down the page and tell a volunteer the wrong person is
   * winning. A terminal row has no total time by construction and therefore no position.
   *
   * Equal times share nothing: ties are broken by team number, exactly as `sortResults` breaks
   * them, so two identical totals get two consecutive positions rather than a dead heat nobody
   * asked this platform to adjudicate.
   */
  position: number | null;
  handoverAt: string | null;
  finishAt: string | null;
  splitAMs: number | null;
  splitBMs: number | null;
  totalMs: number | null;
}

/** How a race is going, counted off the rows rather than asked of the database. */
export interface LeaderboardCounts {
  /** Every row on the board. */
  field: number;
  finished: number;
  /** Through the handover and out on leg B. **Always 0 on a solo race**, which has no handover. */
  handedOver: number;
  /** Not seen at any point yet. Before the gun this is the whole field. */
  awaited: number;
  /** Rows wearing the warning — a subset of the others rather than a bucket of its own. */
  suspect: number;
  /** DNS, DNF and DQ together. They sort last and their label replaces their time. */
  terminal: number;
}

export interface Leaderboard {
  /**
   * The time columns this race has, in the order a board shows them.
   *
   * A solo race is `['total']` — one crossing per entry, so there is no handover to split at.
   * A relay is `['splitA', 'splitB', 'total']`. See the module header: this is #204's
   * *"display of a single-crossing finish"*, decided once here rather than by three `format ===`
   * checks in a template.
   */
  columns: LeaderboardColumn[];
  /**
   * The instant every duration on this board is measured from — `raceStartIso()`'s answer.
   *
   * `coalesce(actually_started_at, start_at)`, which is the rule the timing app has held since its
   * own first migration: *a start delayed on the day must not inflate every runner's time*.
   */
  measuredFrom: string;
  /**
   * Whether {@link measuredFrom} is a start somebody actually broadcast, or only the schedule.
   *
   * ⚠️ **The board has to say this out loud and it is the reason both columns travel from the
   * database rather than one coalesced value.** A race whose start was never recorded — the gun
   * went and nobody pressed the button, or a rehearsal nobody started — produces times measured
   * against a plan. They may be minutes out in either direction, and a time that is merely
   * *wrong* is worse on a leaderboard than a time that is missing, because nobody checks a number
   * that looks fine. `false` is what `apps/timing/lib/leaderboard-outcomes.ts` turns into a
   * sentence above the table.
   */
  startRecorded: boolean;
  rows: LeaderboardRow[];
  counts: LeaderboardCounts;
}

/** The payload `timing.leaderboard()` returns, as the derivation reads it. */
export interface LeaderboardInput {
  event: TimingEvent;
  teams: (TimingTeam & { name: string | null; runners: TimingRunner[] })[];
  crossings: TimingCrossing[];
}

/**
 * `runners.role` is `'guide'`, and nothing else counts.
 *
 * A separate function rather than an inline comparison because the column is nullable and a null
 * means *"this answer does not say"* rather than *"no"* — see {@link LeaderboardRunner.guide}. One
 * place to change if the vocabulary ever grows a third value.
 */
function isGuideRole(role: string | null): boolean {
  return role === 'guide';
}

/**
 * The whole board, from one `timing.leaderboard()` payload.
 *
 * Pure: same input, same output, no clock and no environment. That is what lets it be re-run on
 * every nudge from the Durable Object without worrying about hidden state, and what lets it be
 * unit-tested against a fixture in the ordinary `unit` project rather than against a browser.
 *
 * @param sort which column the board is ordered by. Defaults to total time, which is the ordering
 *   *a leaderboard* means; the other keys exist because the page offers them and because
 *   {@link LeaderboardRow.position} stays the overall standing whichever is chosen.
 */
export function buildLeaderboard(
  input: LeaderboardInput,
  sort: SortKey = 'total',
): Leaderboard {
  const { event, teams, crossings } = input;

  // `buildResults` takes the structural minimums and the payload's rows are wider, which is what
  // `rows.ts`'s `Pick`-shaped types are for. The runners ride along on each team and are read back
  // off it below.
  const built = buildResults(event, teams, crossings);

  const results = sortResults(built, sort);

  /**
   * Overall standings, keyed by team id — the ordering `sortResults(_, 'total')` produces, with a
   * position given only to a row that has a total time.
   *
   * ⚠️ **Sorted a second time rather than numbered off `results`.** That is the bug
   * {@link LeaderboardRow.position} exists to make impossible: numbering the rows as they appear
   * would make a board sorted by category, or by leg A, announce the wrong leader. And it is
   * `sortResults` rather than a tiebreak written out here, so the positions and a board actually
   * sorted by total agree **by construction** instead of agreeing in the common case.
   */
  const positions = new Map(
    sortResults(built, 'total')
      .filter((result) => result.totalMs !== null)
      .map((result, index) => [result.team.id, index + 1] as const),
  );

  const runnersByTeam = new Map(teams.map((team) => [team.id, team.runners]));
  const namesByTeam = new Map(teams.map((team) => [team.id, team.name]));

  const rows: LeaderboardRow[] = results.map((result) => ({
    teamId: result.team.id,
    teamNumber: result.team.team_number,
    // `buildResults` narrows to the structural minimum, which does not name `name`. The payload's
    // team does; reading it back off the input keeps the widening in one place.
    teamName: namesByTeam.get(result.team.id) ?? null,
    category: result.team.category,
    bibs: (event.format === 'solo' ? ([1] as const) : ([1, 2] as const))
      .map((leg) => effectiveBib(result.team, leg, event.format))
      .filter((bib): bib is string => bib !== null),
    runners: (runnersByTeam.get(result.team.id) ?? []).map((runner) => ({
      id: runner.id,
      leg: runner.leg,
      firstname: runner.firstname,
      lastname: runner.lastname,
      guide: isGuideRole(runner.role),
    })),
    status: result.status,
    terminal: isTerminalStatus(result.status),
    suspect: result.hasOpenAnomaly,
    position: positions.get(result.team.id) ?? null,
    handoverAt: result.handoverAt,
    finishAt: result.finishAt,
    splitAMs: result.splitAMs,
    splitBMs: result.splitBMs,
    totalMs: result.totalMs,
  }));

  return {
    // #204's single-crossing finish. A solo entry crosses once, so leg A and leg B are not columns
    // this race has — as against columns it has and cannot fill yet.
    columns: event.format === 'solo' ? ['total'] : ['splitA', 'splitB', 'total'],
    measuredFrom: raceStartIso(event),
    startRecorded: event.actually_started_at !== null,
    rows,
    counts: {
      field: rows.length,
      finished: rows.filter((row) => row.status === 'finished').length,
      handedOver: rows.filter((row) => row.status === 'leg1').length,
      awaited: rows.filter((row) => row.status === 'pending').length,
      suspect: rows.filter((row) => row.suspect).length,
      terminal: rows.filter((row) => row.terminal).length,
    },
  };
}
