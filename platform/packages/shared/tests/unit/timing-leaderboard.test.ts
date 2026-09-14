/**
 * The live leaderboard's derivation — [#204](https://github.com/southville-running-club/src-website/issues/204).
 *
 * ⚠️ **These cases are the argument that the slice is cuttable.** ADR-034 makes the Durable
 * Objects leaderboard the thing the race simulation cuts if it fails, and requires that falling
 * back to Supabase Realtime stays possible. Every assertion below runs with no transport, no
 * Worker, no browser and no clock — which is what *"keep the derivation independent of the
 * transport"* has to mean if it means anything.
 *
 * The two things #204 says are genuinely new are the two the cases lean on: the **single-crossing
 * finish** on a solo race, and the **marking of a suspect row**.
 */

import { describe, expect, it } from 'vitest';
import { buildLeaderboard, type LeaderboardInput } from '../../src/timing/leaderboard';
import type { TimingCrossing, TimingRunner, TimingTeam } from '../../src/timing/rows';

/**
 * Fixed and invented, as every fixture here is: no production data on a laptop, ever.
 *
 * The start is deliberately **on the clocks-change weekend** — 25 October 2026, the Sunday the
 * clocks go back, the weekend before the race this platform is being built for. A duration is UTC
 * milliseconds and has no zone, so these numbers would be identical in any timezone; the date is
 * chosen so that a future change which *did* introduce a zone into the derivation would fail here
 * rather than in November.
 */
const SCHEDULED = '2026-10-25T10:00:00.000Z';
const ACTUAL = '2026-10-25T10:02:00.000Z';

function team(
  over: Partial<TimingTeam & { name: string | null; runners: TimingRunner[] }> = {},
) {
  return {
    id: `team-${over.team_number ?? '1'}`,
    team_number: '1',
    name: 'Bristol Beavers',
    category: 'Open',
    bib_leg1: null,
    bib_leg2: null,
    race_status: null,
    dnf_at: null,
    runners: [] as TimingRunner[],
    ...over,
  };
}

function runner(over: Partial<TimingRunner> = {}): TimingRunner {
  return {
    id: 'runner-1',
    leg: 1,
    firstname: 'Ada',
    lastname: "O'Hara",
    gender: 'female',
    result_placement: null,
    role: 'runner',
    age_on_day: 41,
    ...over,
  };
}

function crossing(over: Partial<TimingCrossing> = {}): TimingCrossing {
  return {
    bib: '1',
    captured_at: '2026-10-25T10:42:00.000Z',
    anomaly_flag: null,
    resolved_at: null,
    resolved_action: null,
    ...over,
  };
}

function soloInput(over: Partial<LeaderboardInput> = {}): LeaderboardInput {
  return {
    event: { format: 'solo', start_at: SCHEDULED, actually_started_at: ACTUAL },
    teams: [team({ runners: [runner()] })],
    crossings: [crossing()],
    ...over,
  };
}

describe('the columns a race has', () => {
  /**
   * #204's *"display of a single-crossing finish"*, and the reason it is a decision rather than a
   * template detail: a solo entry crosses **once**, so leg A and leg B are not columns this race
   * has and cannot fill — they are columns it does not have. A board rendering two dashes beside
   * every finisher invites a volunteer to go looking for the missing captures.
   */
  it('gives a solo race one time column and no legs', () => {
    expect(buildLeaderboard(soloInput()).columns).toEqual(['total']);
  });

  it('gives a relay the handover, the second leg and the total', () => {
    const board = buildLeaderboard({
      ...soloInput(),
      event: { format: 'relay', start_at: SCHEDULED, actually_started_at: ACTUAL },
    });

    expect(board.columns).toEqual(['splitA', 'splitB', 'total']);
  });
});

describe('what a single crossing means on a solo race', () => {
  it('is the finish, and the total is measured from the start', () => {
    const [row] = buildLeaderboard(soloInput()).rows;

    expect(row).toMatchObject({
      status: 'finished',
      finishAt: '2026-10-25T10:42:00.000Z',
      // 10:42:00 − 10:02:00, the *recorded* start. Forty minutes.
      totalMs: 40 * 60 * 1000,
      handoverAt: null,
      splitAMs: null,
      splitBMs: null,
      position: 1,
    });
  });

  /**
   * ⚠️ **The rule the whole platform derives splits by, asserted where a delayed start is visible.**
   * `raceStartIso()` coalesces `actually_started_at` over `start_at`, so two minutes of delay on
   * the day does not add two minutes to everybody's time. This is the case that would catch a
   * future edit reading `start_at` directly.
   */
  it('measures against the recorded start and not the scheduled one', () => {
    const scheduledOnly = buildLeaderboard(
      soloInput({
        event: { format: 'solo', start_at: SCHEDULED, actually_started_at: null },
      }),
    );

    expect(scheduledOnly.measuredFrom).toBe(SCHEDULED);
    expect(scheduledOnly.rows[0]?.totalMs).toBe(42 * 60 * 1000);

    const recorded = buildLeaderboard(soloInput());

    expect(recorded.measuredFrom).toBe(ACTUAL);
    expect(recorded.rows[0]?.totalMs).toBe(40 * 60 * 1000);
  });

  /**
   * The board has to be able to say it is measuring against a plan rather than a gun — see
   * `Leaderboard.startRecorded`. A time that is merely *wrong* is worse here than one that is
   * missing, because nobody re-checks a number that looks fine.
   */
  it('says whether the start it measured from was actually recorded', () => {
    expect(buildLeaderboard(soloInput()).startRecorded).toBe(true);

    expect(
      buildLeaderboard(
        soloInput({
          event: { format: 'solo', start_at: SCHEDULED, actually_started_at: null },
        }),
      ).startRecorded,
    ).toBe(false);
  });
});

describe('a row nobody has resolved yet', () => {
  /**
   * ⚠️ **The marking, and the negative half of it matters more than the positive half.** The time
   * is still there. `results.ts`'s own header carries the reasoning: showing a confidently-wrong
   * time is worse than showing an uncertain one, and dropping the row is worse than both, because
   * somebody's runner vanishes from the board while they are watching for them.
   */
  it('is marked suspect and keeps its time', () => {
    const board = buildLeaderboard(
      soloInput({ crossings: [crossing({ anomaly_flag: true })] }),
    );

    expect(board.rows[0]).toMatchObject({
      suspect: true,
      status: 'finished',
      totalMs: 40 * 60 * 1000,
      position: 1,
    });
    expect(board.counts.suspect).toBe(1);
  });

  it('stops being suspect once a human has resolved it', () => {
    const board = buildLeaderboard(
      soloInput({
        crossings: [
          crossing({
            anomaly_flag: true,
            resolved_at: '2026-10-25T10:50:00.000Z',
            resolved_action: 'valid',
          }),
        ],
      }),
    );

    expect(board.rows[0]?.suspect).toBe(false);
    expect(board.counts.suspect).toBe(0);
  });

  /**
   * A discarded capture is removed from timing altogether — not shown suspect, and not shown as a
   * time either. The row falls back to pending, which is the true statement about a team whose only
   * crossing an admin has thrown away.
   */
  it('is back to being awaited once its only capture is discarded', () => {
    const board = buildLeaderboard(
      soloInput({
        crossings: [
          crossing({
            anomaly_flag: true,
            resolved_at: '2026-10-25T10:50:00.000Z',
            resolved_action: 'discarded',
          }),
        ],
      }),
    );

    expect(board.rows[0]).toMatchObject({
      status: 'pending',
      suspect: false,
      totalMs: null,
      position: null,
    });
  });
});

describe('a whole-team terminal label', () => {
  const field = (statuses: (string | null)[]) =>
    buildLeaderboard(
      soloInput({
        teams: statuses.map((race_status, index) =>
          team({
            team_number: String(index + 1),
            race_status,
            runners: [runner({ id: `runner-${index + 1}` })],
          }),
        ),
        crossings: statuses.map((_, index) =>
          crossing({
            bib: String(index + 1),
            // Each finishes a minute after the last, so the ordering is unambiguous.
            captured_at: `2026-10-25T10:4${index}:00.000Z`,
          }),
        ),
      }),
    );

  it('replaces the time and takes the position with it', () => {
    const board = field(['dq']);

    expect(board.rows[0]).toMatchObject({
      status: 'dq',
      terminal: true,
      totalMs: null,
      position: null,
    });
    expect(board.counts.terminal).toBe(1);
  });

  it('sorts last, behind everybody still out on the course', () => {
    // Three entries: one disqualified, one that did not start, one ordinary finisher. The
    // finisher crossed *last* of the three, so nothing but the partition can put it first.
    const board = field(['dq', 'dns', null]);

    expect(board.rows.map((row) => row.status)).toEqual(['finished', 'dq', 'dns']);
    expect(board.rows.map((row) => row.position)).toEqual([1, null, null]);
  });
});

describe('where a row stands overall', () => {
  const threeFinishers = () =>
    soloInput({
      teams: [
        team({ team_number: '1', category: 'Senior', runners: [runner({ id: 'r1' })] }),
        team({ team_number: '2', category: 'Open', runners: [runner({ id: 'r2' })] }),
        team({ team_number: '3', category: 'Open', runners: [runner({ id: 'r3' })] }),
      ],
      crossings: [
        crossing({ bib: '1', captured_at: '2026-10-25T10:50:00.000Z' }),
        crossing({ bib: '2', captured_at: '2026-10-25T10:40:00.000Z' }),
        crossing({ bib: '3', captured_at: '2026-10-25T10:45:00.000Z' }),
      ],
    });

  it('numbers the fastest first whatever the board is sorted by', () => {
    const byTotal = buildLeaderboard(threeFinishers(), 'total');

    expect(byTotal.rows.map((row) => row.teamNumber)).toEqual(['2', '3', '1']);
    expect(byTotal.rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  /**
   * ⚠️ **The case this field exists for.** Sorted by category the rows come out in a different
   * order, and numbering them down the page would announce a different leader — which is a board
   * telling a volunteer something false about who is winning.
   */
  it('keeps the overall standing when the board is sorted by category', () => {
    const byCategory = buildLeaderboard(threeFinishers(), 'category');

    expect(byCategory.rows.map((row) => row.category)).toEqual([
      'Open',
      'Open',
      'Senior',
    ]);
    // Team 2 leads whichever way the page is sorted; team 1 is slowest and stays third.
    expect(byCategory.rows.map((row) => [row.teamNumber, row.position])).toEqual([
      ['2', 1],
      ['3', 2],
      ['1', 3],
    ]);
  });
});

describe("a visually impaired runner's guide", () => {
  /**
   * ⚠️ **ADR-022: a guide is in no category and no prize, and on a solo race they share their
   * runner's team.** `import_from_entries()` puts the runner on leg 1 and the guide on leg 2 of one
   * team, so the row carries two names and one time — and the time is the runner's. Without this
   * mark a board prints a guide as though they had a result of their own.
   */
  it('is marked on the row they share with the runner they guide', () => {
    const board = buildLeaderboard(
      soloInput({
        teams: [
          team({
            runners: [
              runner({ id: 'vi', leg: 1, firstname: 'Nadia' }),
              runner({ id: 'guide', leg: 2, firstname: 'Sam', role: 'guide' }),
            ],
          }),
        ],
      }),
    );

    expect(board.rows[0]?.runners).toEqual([
      expect.objectContaining({ id: 'vi', leg: 1, guide: false }),
      expect.objectContaining({ id: 'guide', leg: 2, guide: true }),
    ]);
    // One entry, one line, one time — the guide is not a row of their own.
    expect(board.counts.field).toBe(1);
  });

  /**
   * ⚠️ **A null `role` is "this answer does not say", never "provably a runner".**
   * `results_for_event()` withholds the column once a race is published — ADR-043 — so a caller
   * handed the public shape must see `false` rather than a crash or a guess. This asserts the
   * conservative reading rather than a clever one.
   */
  it('is not claimed when the answer carries no role at all', () => {
    const board = buildLeaderboard(
      soloInput({ teams: [team({ runners: [runner({ role: null })] })] }),
    );

    expect(board.rows[0]?.runners[0]?.guide).toBe(false);
  });
});

describe('how the race is going', () => {
  it('counts the field before the gun as entirely awaited', () => {
    const board = buildLeaderboard(
      soloInput({
        teams: [team({ team_number: '1' }), team({ team_number: '2' })],
        crossings: [],
      }),
    );

    expect(board.counts).toEqual({
      field: 2,
      finished: 0,
      handedOver: 0,
      awaited: 2,
      suspect: 0,
      terminal: 0,
    });
  });

  /**
   * `handedOver` is the relay's middle state and there is no such thing on a solo race, which is
   * asserted rather than left to a reader of the type — a nonzero count here would mean the solo
   * path had grown a handover.
   */
  it('counts a handover on a relay and never on a solo race', () => {
    const relay = buildLeaderboard({
      event: { format: 'relay', start_at: SCHEDULED, actually_started_at: ACTUAL },
      teams: [team({ team_number: '1', runners: [runner()] })],
      // Bib "11" is leg 1 of team 1 on a relay: the handover, with no finish behind it.
      crossings: [crossing({ bib: '11', captured_at: '2026-10-25T10:22:00.000Z' })],
    });

    expect(relay.counts).toMatchObject({ handedOver: 1, finished: 0, awaited: 0 });
    expect(relay.rows[0]).toMatchObject({
      status: 'leg1',
      splitAMs: 20 * 60 * 1000,
      splitBMs: null,
      totalMs: null,
      position: null,
    });

    expect(buildLeaderboard(soloInput()).counts.handedOver).toBe(0);
  });

  it('leaves a team with no bib awaited rather than guessing at one', () => {
    const board = buildLeaderboard(
      soloInput({
        teams: [team({ team_number: null, runners: [runner()] })],
        crossings: [crossing({ bib: '1' })],
      }),
    );

    expect(board.rows[0]).toMatchObject({
      teamNumber: null,
      status: 'pending',
      totalMs: null,
      position: null,
    });
  });
});

describe('an empty race', () => {
  /**
   * The state every race is in when somebody first opens the board, and the one a rehearsal is
   * wiped back to by `timing.reset_event()` — #254. It must be a board with nothing on it rather
   * than a thrown error.
   */
  it('is a board with no rows and every count at zero', () => {
    const board = buildLeaderboard({
      event: { format: 'solo', start_at: SCHEDULED, actually_started_at: null },
      teams: [],
      crossings: [],
    });

    expect(board.rows).toEqual([]);
    expect(board.counts).toEqual({
      field: 0,
      finished: 0,
      handedOver: 0,
      awaited: 0,
      suspect: 0,
      terminal: 0,
    });
    expect(board.startRecorded).toBe(false);
  });
});
