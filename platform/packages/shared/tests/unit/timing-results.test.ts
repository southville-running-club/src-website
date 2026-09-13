/**
 * The results derivation, copied with the module it guards.
 *
 * Unchanged from `bindalshah/src-race-timing`'s `lib/results.test.ts` apart from import paths.
 * The cases that matter most are the ones about **who is not shown a time**: a team with an
 * unresolved anomaly, and a team carrying a terminal label.
 */

import { describe, expect, it } from 'vitest';
import {
  assignCategoryPositions,
  buildResults,
  durationToHMSss,
  isTerminalStatus,
  sortResults,
  teamRaceStatus,
} from '../../src/timing/results';
import type { TimingTeam } from '../../src/timing/rows';

/**
 * `noUncheckedIndexedAccess` is on in this workspace and was not in the repository these
 * assertions came from, so the head of a result array is `Result | undefined` here. This
 * narrows it and fails loudly when it is genuinely empty - which is a better failure than
 * `Cannot read properties of undefined`, and is the only change these cases needed.
 */
function assertDefined<T>(value: T): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a result, got none');
  }
}

describe('durationToHMSss', () => {
  it('formats zero as 00:00:00.00', () => {
    expect(durationToHMSss(0)).toBe('00:00:00.00');
  });

  it('formats sub-second values with the centisecond component', () => {
    expect(durationToHMSss(250)).toBe('00:00:00.25');
  });

  it('formats whole seconds with zero centiseconds', () => {
    expect(durationToHMSss(5_000)).toBe('00:00:05.00');
  });

  it('formats minutes with zero-padded hours', () => {
    // 1 minute 5 seconds — the export needs HH even when the
    // duration doesn't reach an hour.
    expect(durationToHMSss(65_000)).toBe('00:01:05.00');
  });

  it('formats hour-spanning durations', () => {
    // 1h 2m 5.50s
    expect(durationToHMSss(3_725_500)).toBe('01:02:05.50');
  });

  it('formats double-digit hours without truncation', () => {
    expect(durationToHMSss(36_000_000)).toBe('10:00:00.00');
  });

  it('rolls correctly at the 1000ms boundary', () => {
    expect(durationToHMSss(999)).toBe('00:00:00.99');
    expect(durationToHMSss(1_000)).toBe('00:00:01.00');
  });

  it('floors sub-centisecond precision (does not round up)', () => {
    // 1.234s → "01.23", the trailing 4ms is truncated. Matches the
    // earlier formatDuration helper's flooring behaviour so the two
    // never disagree on the same input.
    expect(durationToHMSss(1_234)).toBe('00:00:01.23');
    expect(durationToHMSss(1_239)).toBe('00:00:01.23');
  });

  it('returns the default em-dash for null', () => {
    expect(durationToHMSss(null)).toBe('—');
  });

  it('returns the explicit nullValue for null when provided', () => {
    expect(durationToHMSss(null, { nullValue: '' })).toBe('');
  });

  it('returns nullValue for negative durations', () => {
    // Race-clock skew or pre-start crossings can momentarily produce
    // negative deltas. Both preview and CSV should treat them as
    // missing rather than emitting "-00:00:01.23".
    expect(durationToHMSss(-1_000)).toBe('—');
    expect(durationToHMSss(-1_000, { nullValue: '' })).toBe('');
  });

  it('returns nullValue for non-finite inputs', () => {
    expect(durationToHMSss(Infinity)).toBe('—');
    expect(durationToHMSss(-Infinity)).toBe('—');
    expect(durationToHMSss(Number.NaN)).toBe('—');
    expect(durationToHMSss(Number.NaN, { nullValue: '' })).toBe('');
  });
});

describe('assignCategoryPositions', () => {
  it('returns sequential positions when every row shares a category', () => {
    expect(
      assignCategoryPositions(
        [{ category: 'Mixed' }, { category: 'Mixed' }, { category: 'Mixed' }],
        (r) => r.category,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('counts per category independently when interleaved', () => {
    expect(
      assignCategoryPositions(
        [{ category: 'M' }, { category: 'W' }, { category: 'M' }, { category: 'W' }],
        (r) => r.category,
      ),
    ).toEqual([1, 1, 2, 2]);
  });

  it('handles three categories interleaved', () => {
    expect(
      assignCategoryPositions(
        [
          { category: 'M' },
          { category: 'W' },
          { category: 'Mixed' },
          { category: 'M' },
          { category: 'W' },
          { category: 'Mixed' },
        ],
        (r) => r.category,
      ),
    ).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('clusters null categories into their own bucket', () => {
    // Two null-category rows precede a Mixed row; the nulls count
    // against each other, the Mixed row starts at 1.
    expect(
      assignCategoryPositions(
        [{ category: null }, { category: null }, { category: 'Mixed' }],
        (r) => r.category,
      ),
    ).toEqual([1, 2, 1]);
  });

  it('does not let null and an empty-string category bleed across each other in normal data', () => {
    // Empty string is the synthetic key for nulls. If a real row ever
    // arrives with category = "" (edge case), it shares the null
    // bucket — documented behaviour, not a bug. Test pins it.
    expect(
      assignCategoryPositions(
        [{ category: null }, { category: '' }, { category: null }],
        (r) => r.category,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('returns an empty array for empty input', () => {
    expect(
      assignCategoryPositions([] as { category: string | null }[], (r) => r.category),
    ).toEqual([]);
  });

  it('returns [1] for a single row regardless of category', () => {
    expect(assignCategoryPositions([{ category: 'Mixed' }], (r) => r.category)).toEqual([
      1,
    ]);
    expect(assignCategoryPositions([{ category: null }], (r) => r.category)).toEqual([1]);
  });

  it('composes with nested-shape rows via the accessor', () => {
    // The real call site is `Result[]` where category lives at
    // `team.category`. Confirm the accessor reaches into nested
    // structures cleanly.
    const rows = [
      { team: { category: 'M' } },
      { team: { category: 'W' } },
      { team: { category: 'M' } },
    ];
    expect(assignCategoryPositions(rows, (r) => r.team.category)).toEqual([1, 1, 2]);
  });
});

// Slice 9: editing a crossing's captured_at ripples through buildResults.
// These are the first buildResults tests — they pin the two behaviours the
// edit-crossing action depends on: MIN-per-bib dedup, and that a time edit
// reorders the leaderboard. All fixture timestamps use the same UTC offset
// ('Z'); the dedup compares captured_at as ISO STRINGS (lib/results.ts:83),
// so a mixed offset would make the min wrong.
/**
 * The structural minimum plus the columns these fixtures also set.
 *
 * Spelled out rather than widened with an index signature, because it is doing a second job:
 * it is the list of things `rows.ts` deliberately does **not** name, and it demonstrates the
 * property that file claims — a fuller row is accepted wherever the minimum is asked for.
 */
type Team = TimingTeam & {
  id: string;
  event_id: string;
  name: string;
  entry_type: string;
  purchase_order_id: string | null;
  csv_row_index: number;
  created_at: string;
};

function makeTeam(teamNumber: string, category = 'Open'): Team {
  return {
    id: `team-${teamNumber}`,
    event_id: 'evt',
    team_number: teamNumber,
    name: `Team ${teamNumber}`,
    category,
    dnf_at: null,
    race_status: null,
    entry_type: 'pair',
    purchase_order_id: null,
    csv_row_index: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    // Slice 10 added per-team bib overrides; null = derive from team_number,
    // which is what these pre-override fixtures assume.
    bib_leg1: null,
    bib_leg2: null,
  };
}

function finish(bib: string, capturedAt: string) {
  return {
    bib,
    captured_at: capturedAt,
    anomaly_flag: false,
    resolved_at: null,
    resolved_action: null,
  };
}

const EVENT = {
  actually_started_at: null,
  start_at: '2026-07-08T18:00:00.000Z', // 19:00 BST
  format: 'relay' as const,
};

describe('buildResults — captured_at dedup and time-edit reorder', () => {
  it('keeps the EARLIEST captured_at per bib, not the first or last seen', () => {
    const results = buildResults(
      EVENT,
      [makeTeam('47')],
      [
        // Three duplicate finish taps; the earliest sits in the MIDDLE so the
        // test fails under both a first-write-wins (→18:45) and a
        // last-write-wins (→18:50) regression — only the MIN guard yields
        // 18:40. (Earliest-last would let last-write-wins pass vacuously.)
        finish('247', '2026-07-08T18:45:00.000Z'),
        finish('247', '2026-07-08T18:40:00.000Z'),
        finish('247', '2026-07-08T18:50:00.000Z'),
      ],
    );
    const team47 = results.find((r) => r.team.team_number === '47');
    expect(team47?.finishAt).toBe('2026-07-08T18:40:00.000Z');
    expect(team47?.totalMs).toBe(40 * 60_000);
  });

  it('reorders the leaderboard when a captured_at is edited earlier', () => {
    const teams = [makeTeam('47'), makeTeam('48')];

    // Both teams share category "Open", so assignCategoryPositions numbers by
    // finishing order — position keyed to team 47 is what proves the reorder
    // (asserting the raw [1,2] array would hold for any order, vacuously).
    const posOf = (sorted: ReturnType<typeof sortResults>, team: string) => {
      const positions = assignCategoryPositions(sorted, (r) => r.team.category);
      return positions[sorted.findIndex((r) => r.team.team_number === team)];
    };

    // Baseline: 48 finishes in 30m, 47 in 40m → 48 leads, 47 is 2nd in Open.
    const before = sortResults(
      buildResults(EVENT, teams, [
        finish('247', '2026-07-08T18:40:00.000Z'),
        finish('248', '2026-07-08T18:30:00.000Z'),
      ]),
      'total',
    );
    expect(before.map((r) => r.team.team_number)).toEqual(['48', '47']);
    expect(posOf(before, '47')).toBe(2);

    // Admin edits 47's finish 20 minutes earlier (18:40 → 18:20) → 47 now
    // finishes in 20m and takes the lead. This is exactly the ripple the
    // edit-crossing action relies on.
    const after = sortResults(
      buildResults(EVENT, teams, [
        finish('247', '2026-07-08T18:20:00.000Z'),
        finish('248', '2026-07-08T18:30:00.000Z'),
      ]),
      'total',
    );
    expect(after.map((r) => r.team.team_number)).toEqual(['47', '48']);
    // 47 moves from category position 2 to 1.
    expect(posOf(after, '47')).toBe(1);
  });

  it('excludes a discarded crossing so its team drops off the board', () => {
    const results = buildResults(
      EVENT,
      [makeTeam('47')],
      [
        {
          ...finish('247', '2026-07-08T18:40:00.000Z'),
          resolved_at: '2026-07-08T19:00:00.000Z',
          resolved_action: 'discarded',
        },
      ],
    );
    const team47 = results.find((r) => r.team.team_number === '47');
    expect(team47?.finishAt).toBeNull();
    expect(team47?.totalMs).toBeNull();
  });

  /**
   * ⚠️ **The case a discard actually exists for** — [#252](https://github.com/southville-running-club/src-website/issues/252)'s
   * definition of done names it as *"the earliest **undiscarded** capture per bib"*, and the
   * test above does not reach it: with one crossing, dropping it and picking a later one are
   * the same answer.
   *
   * The real shape is the double tap. A marshal presses twice, or two marshals catch the same
   * runner, and an admin discards the wrong one — so the board has to fall through to the next
   * capture rather than to nothing. Picking the earliest of *all* captures would silently
   * restore the crossing somebody had just taken out.
   */
  it('falls through to the next capture when the earliest one was discarded', () => {
    const results = buildResults(
      EVENT,
      [makeTeam('47')],
      [
        {
          ...finish('247', '2026-07-08T18:40:00.000Z'),
          resolved_at: '2026-07-08T19:00:00.000Z',
          resolved_action: 'discarded',
        },
        finish('247', '2026-07-08T18:44:00.000Z'),
      ],
    );

    const team47 = results.find((r) => r.team.team_number === '47');
    expect(team47?.finishAt).toBe('2026-07-08T18:44:00.000Z');
  });
});

// Slice 12 — whole-team race status (dns/dnf/dq). A LABEL on top of crossings:
// it changes derived status + times + sort, and NEVER changes the crossings
// themselves. The load-bearing guarantees pinned here: a NULL-race_status team
// is byte-identical to before; race_status is canonical over legacy dnf_at; and
// every terminal team sorts below the timed field.
describe('buildResults — race status (Slice 12)', () => {
  const relayCrossings = (teamNum: string, handoverAt: string, finishAt: string) => [
    finish(`1${teamNum}`, handoverAt),
    finish(`2${teamNum}`, finishAt),
  ];

  it('NULL race_status + NULL dnf_at behaves exactly as before (regression)', () => {
    const [r] = buildResults(
      EVENT,
      [makeTeam('47')],
      relayCrossings('47', '2026-07-08T18:20:00.000Z', '2026-07-08T18:41:00.000Z'),
    );
    assertDefined(r);
    expect(r.status).toBe('finished');
    expect(r.splitAMs).toBe(20 * 60_000);
    expect(r.splitBMs).toBe(21 * 60_000);
    expect(r.totalMs).toBe(41 * 60_000);
  });

  it('dns overrides any crossings: status dns, every time suppressed', () => {
    // A DNS team that somehow carries crossings — the admin's "did not start"
    // judgment wins; no leg A, no leg B, no total.
    const team = { ...makeTeam('47'), race_status: 'dns' };
    const [r] = buildResults(
      EVENT,
      [team],
      relayCrossings('47', '2026-07-08T18:20:00.000Z', '2026-07-08T18:41:00.000Z'),
    );
    assertDefined(r);
    expect(r.status).toBe('dns');
    expect(r.splitAMs).toBeNull();
    expect(r.splitBMs).toBeNull();
    expect(r.totalMs).toBeNull();
  });

  it('dnf keeps a completed leg A but nulls leg B and total', () => {
    const team = { ...makeTeam('47'), race_status: 'dnf' };
    const [r] = buildResults(
      EVENT,
      [team],
      relayCrossings('47', '2026-07-08T18:20:00.000Z', '2026-07-08T18:41:00.000Z'),
    );
    assertDefined(r);
    expect(r.status).toBe('dnf');
    expect(r.splitAMs).toBe(20 * 60_000); // handover preserved — a real fact
    expect(r.splitBMs).toBeNull();
    expect(r.totalMs).toBeNull();
  });

  it('dq behaves like dnf for display: status dq, leg A kept, total nulled', () => {
    const team = { ...makeTeam('47'), race_status: 'dq' };
    const [r] = buildResults(
      EVENT,
      [team],
      relayCrossings('47', '2026-07-08T18:20:00.000Z', '2026-07-08T18:41:00.000Z'),
    );
    assertDefined(r);
    expect(r.status).toBe('dq');
    expect(r.splitAMs).toBe(20 * 60_000);
    expect(r.totalMs).toBeNull();
  });

  it('legacy dnf_at with NULL race_status still resolves to dnf (fallback)', () => {
    const team = { ...makeTeam('47'), dnf_at: '2026-07-08T18:30:00.000Z' };
    const [r] = buildResults(
      EVENT,
      [team],
      relayCrossings('47', '2026-07-08T18:20:00.000Z', '2026-07-08T18:41:00.000Z'),
    );
    assertDefined(r);
    expect(r.status).toBe('dnf');
    expect(r.splitAMs).toBe(20 * 60_000);
    expect(r.totalMs).toBeNull();
  });

  it('race_status is canonical: it wins over a set dnf_at', () => {
    const team = {
      ...makeTeam('47'),
      dnf_at: '2026-07-08T18:30:00.000Z',
      race_status: 'dq',
    };
    const [r] = buildResults(EVENT, [team], []);
    assertDefined(r);
    expect(r.status).toBe('dq');
  });

  it('sorts every terminal team below timed and pending teams, by team_number', () => {
    const teams = [
      makeTeam('10'), // finished
      makeTeam('20'), // pending (no crossings)
      { ...makeTeam('30'), race_status: 'dnf' },
      { ...makeTeam('05'), race_status: 'dns' },
      { ...makeTeam('40'), race_status: 'dq' },
    ];
    const crossings = relayCrossings(
      '10',
      '2026-07-08T18:20:00.000Z',
      '2026-07-08T18:40:00.000Z',
    );
    const sorted = sortResults(buildResults(EVENT, teams, crossings), 'total');
    // finished (10), then pending (20), then the three terminal teams by
    // team_number (05, 30, 40) — one shared bucket regardless of kind.
    expect(sorted.map((r) => r.team.team_number)).toEqual(['10', '20', '05', '30', '40']);
  });

  it('a DNS team with no crossings sorts below a pending team with no crossings', () => {
    const teams = [{ ...makeTeam('30'), race_status: 'dns' }, makeTeam('20')];
    const sorted = sortResults(buildResults(EVENT, teams, []), 'total');
    expect(sorted.map((r) => r.team.team_number)).toEqual(['20', '30']);
  });
});

describe('teamRaceStatus / isTerminalStatus (Slice 12 helpers)', () => {
  it('returns the race_status when set, ignoring dnf_at', () => {
    expect(teamRaceStatus({ race_status: 'dq', dnf_at: null })).toBe('dq');
    expect(teamRaceStatus({ race_status: 'dns', dnf_at: 'x' })).toBe('dns');
  });
  it('falls back to dnf when only the legacy dnf_at is set', () => {
    expect(teamRaceStatus({ race_status: null, dnf_at: '2026-01-01T00:00:00Z' })).toBe(
      'dnf',
    );
  });
  it('returns null for a normal team (no status, no dnf_at)', () => {
    expect(teamRaceStatus({ race_status: null, dnf_at: null })).toBeNull();
  });
  it('isTerminalStatus is true only for dns/dnf/dq', () => {
    expect((['dns', 'dnf', 'dq'] as const).map(isTerminalStatus)).toEqual([
      true,
      true,
      true,
    ]);
    expect((['pending', 'leg1', 'finished'] as const).map(isTerminalStatus)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
