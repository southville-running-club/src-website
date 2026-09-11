/**
 * The prize-eligibility guarantee, copied with the module it guards.
 *
 * Unchanged from `bindalshah/src-race-timing`'s `lib/awards.test.ts` apart from import paths
 * and the row types. ⚠️ **Most of it is about one property**: a team with any terminal race
 * status is excluded from every award, team and individual alike. That is the assertion to
 * read first if this file ever goes red.
 */

import { describe, expect, it } from 'vitest';
import { computeAwards, type TeamWithRunners } from '../../src/timing/awards';
import type { TimingCrossing, TimingRunner } from '../../src/timing/rows';

/**
 * The fixture row shapes: the structural minimum plus the columns these fixtures also set.
 *
 * Spelled out rather than widened, for the same reason `timing-results.test.ts` does it — this
 * is the list of columns `rows.ts` deliberately does not name, and it exercises the property
 * that file claims: a fuller row is accepted wherever the minimum is asked for.
 */
type RunnerFixture = TimingRunner & {
  team_id: string;
  firstname: string;
  lastname: string;
  email: string;
  club_name: string | null;
  is_captain: boolean;
  created_at: string;
};

type TeamFixture = TeamWithRunners & {
  event_id: string;
  name: string;
  entry_type: string;
  purchase_order_id: string | null;
  csv_row_index: number;
  created_at: string;
  runners: RunnerFixture[];
};

// Slice 12 — the load-bearing prize-eligibility guarantee: a team with ANY
// race status (dns/dnf/dq) is excluded from EVERY award, team prizes AND
// individual leg awards. Without this a DNF'd team's fast leg could win e.g.
// Fastest Female. The exclusion lives at the single `finished` gate in
// computeAwards; these tests exercise it end-to-end through that function.

const EVENT = {
  actually_started_at: null,
  start_at: '2026-07-08T18:00:00.000Z',
  format: 'relay' as const,
};
const START = Date.parse(EVENT.start_at);
const min = (m: number) => m * 60_000;
const iso = (msFromStart: number) => new Date(START + msFromStart).toISOString();

function runner(
  teamId: string,
  leg: number,
  gender: string,
  firstname: string,
): RunnerFixture {
  return {
    id: `r-${teamId}-${leg}`,
    team_id: teamId,
    leg,
    gender,
    firstname,
    lastname: 'Test',
    email: `${firstname}@example.com`,
    age_on_day: null,
    club_name: null,
    is_captain: leg === 1,
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

function team(
  num: string,
  a: { g: string; n: string },
  b: { g: string; n: string },
): TeamFixture {
  const id = `team-${num}`;
  return {
    id,
    event_id: 'evt',
    team_number: num,
    name: `Team ${num}`,
    category: null,
    dnf_at: null,
    race_status: null,
    entry_type: 'pair',
    purchase_order_id: null,
    csv_row_index: Number(num),
    created_at: '2026-07-01T00:00:00.000Z',
    bib_leg1: null,
    bib_leg2: null,
    runners: [runner(id, 1, a.g, a.n), runner(id, 2, b.g, b.n)],
  };
}

// Two crossings per team: handover (1XX) at START+legA, finish (2XX) at
// START+legA+legB. Only the fields buildResults reads are populated.
function xings(num: string, legA: number, legB: number): TimingCrossing[] {
  const mk = (bib: string, ms: number) =>
    ({
      bib,
      captured_at: iso(ms),
      anomaly_flag: false,
      resolved_at: null,
      resolved_action: null,
    }) satisfies TimingCrossing;
  return [mk(`1${num}`, min(legA)), mk(`2${num}`, min(legA + legB))];
}

// Fresh teams each call so a status override in one test can't leak.
function teamsFixture(): TeamFixture[] {
  return [
    team('10', { g: 'F', n: 'Fiona' }, { g: 'F', n: 'Farah' }), // fastest, 28
    team('30', { g: 'F', n: 'Gina' }, { g: 'F', n: 'Gwen' }), // 31
    team('40', { g: 'M', n: 'Mo' }, { g: 'M', n: 'Milo' }), // 32, men's pair
    team('20', { g: 'F', n: 'Zara' }, { g: 'F', n: 'Zoe' }), // 49, off-podium; Zara fastest eligible F leg
    team('50', { g: 'M', n: 'Sam' }, { g: 'M', n: 'Seb' }), // 65, largest spread + fastest male
  ];
}

const CROSSINGS: TimingCrossing[] = [
  ...xings('10', 14, 14),
  ...xings('30', 15, 16),
  ...xings('40', 16, 16),
  ...xings('20', 9, 40), // Zara's leg A = 9m — fastest female leg in the field
  ...xings('50', 5, 60), // Sam's leg A = 5m — fastest male; team's spread is largest
];

function withStatus(
  teams: TeamWithRunners[],
  num: string,
  status: string,
): TeamWithRunners[] {
  return teams.map((t) => (t.team_number === num ? { ...t, race_status: status } : t));
}

function award(awards: ReturnType<typeof computeAwards>, kind: string) {
  return awards.find((a) => a.kind === kind);
}

describe('computeAwards — race-status exclusion (Slice 12)', () => {
  it('baseline: fastest team wins the podium and Zara wins Fastest Female', () => {
    const awards = computeAwards(EVENT, teamsFixture(), CROSSINGS);
    expect(award(awards, 'first_overall')?.winner?.team.team_number).toBe('10');
    const female = award(awards, 'fastest_individual_female')?.winner;
    expect(female?.type).toBe('runner');
    expect(female && 'runner' in female ? female.runner.firstname : null).toBe('Zara');
  });

  it("a DNF'd team's fast leg no longer wins Fastest Female", () => {
    // Zara's team is off-podium, so in the baseline she is genuinely eligible.
    // Marking her team DNF must remove her from the individual-award pool.
    const awards = computeAwards(
      EVENT,
      withStatus(teamsFixture(), '20', 'dnf'),
      CROSSINGS,
    );
    const female = award(awards, 'fastest_individual_female')?.winner;
    // No other eligible female remains (teams 10/30 are podium winners, 40/50
    // are male) → the award goes unclaimed rather than to a DNF'd runner.
    expect(
      female == null || ('runner' in female && female.team.team_number !== '20'),
    ).toBe(true);
  });

  it('marking the fastest team DQ promotes the next team to 1st overall', () => {
    const awards = computeAwards(
      EVENT,
      withStatus(teamsFixture(), '10', 'dq'),
      CROSSINGS,
    );
    expect(award(awards, 'first_overall')?.winner?.team.team_number).toBe('30');
    // The DQ'd team wins nothing at all.
    const anyWonByTen = awards.some((a) => a.winner?.team.team_number === '10');
    expect(anyWonByTen).toBe(false);
  });

  it('a DNS team is excluded exactly like DNF/DQ (any non-null status)', () => {
    const awards = computeAwards(
      EVENT,
      withStatus(teamsFixture(), '10', 'dns'),
      CROSSINGS,
    );
    expect(award(awards, 'first_overall')?.winner?.team.team_number).toBe('30');
  });
});
