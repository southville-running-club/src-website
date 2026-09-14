import { describe, expect, it } from 'vitest';
import { computeAwards, type TeamWithRunners } from '../../src/timing/awards';
import {
  buildPrizeRows,
  prizeExportCsv,
  PRIZE_EXPORT_HEADER,
  type PrizeAward,
} from '../../src/timing/prize-export';
import type { TimingCrossing } from '../../src/timing/rows';

/**
 * The prize export — #205.
 *
 * ⚠️ **The property under test is that this file reports and never re-decides.** #205's rule is
 * that the export *"consumes the presenter's resolved `Award[]`, so the published table cannot
 * disagree with what was announced"* — so the assertions here hand it awards that have already
 * been resolved, including one whose winner was passed over and one whose winner is a spot draw
 * that exists nowhere but the presenter's address bar, and check that what comes out is what
 * went in.
 */

const SOLO = {
  actually_started_at: null,
  start_at: '2026-11-01T11:00:00.000Z',
  format: 'solo' as const,
};
const START = Date.parse(SOLO.start_at);
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

function crossing(bib: string, minutes: number): TimingCrossing {
  return {
    bib,
    captured_at: at(minutes),
    anomaly_flag: false,
    resolved_at: null,
    resolved_action: null,
  };
}

function soloTeam(
  number: string,
  firstname: string,
  gender: string,
  age: number,
): TeamWithRunners & { name: string | null } {
  return {
    id: `team-${number}`,
    team_number: number,
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    race_status: null,
    dnf_at: null,
    name: null,
    runners: [
      {
        id: `r-${number}`,
        leg: 1,
        firstname,
        lastname: 'Test',
        gender,
        result_placement: null,
        role: 'runner',
        age_on_day: age,
      },
    ],
  };
}

const FIELD = [
  soloTeam('11', 'Ada', 'female', 34),
  soloTeam('12', 'Grace', 'male', 52),
  soloTeam('13', 'Mary', 'female', 61),
];
const CROSSINGS = [crossing('12', 40), crossing('11', 45), crossing('13', 50)];

const rowFor = (rows: ReturnType<typeof buildPrizeRows>, prize: string) =>
  rows.find((row) => row.prize === prize);

describe('buildPrizeRows', () => {
  it('writes a line for every prize, including the ones nobody won', () => {
    const awards = computeAwards(SOLO, FIELD, CROSSINGS);
    const rows = buildPrizeRows(awards, 'solo');

    expect(rows).toHaveLength(awards.length);
    // ⚠️ An unclaimed band stays on the list. See the module header: the club's prize list is
    // prizes *offered*, and "nobody in the Vet 50 women's band this year" is the useful fact.
    expect(rowFor(rows, "Women's Vet 50")).toMatchObject({ winner: '', time: '' });
  });

  it('names the winner, the bib and the metric the award was actually won on', () => {
    const rows = buildPrizeRows(computeAwards(SOLO, FIELD, CROSSINGS), 'solo');

    expect(rowFor(rows, '1st Place Overall')).toMatchObject({
      winner: 'Grace Test',
      bibs: '12',
      time: '40:00',
    });
  });

  it('reports the presenter’s exclusion rather than recomputing around it', () => {
    const passed = computeAwards(SOLO, FIELD, CROSSINGS, new Set(['team-12']));
    const rows = buildPrizeRows(passed, 'solo');

    // Grace has gone home, so Ada is first overall — on the screen and therefore in the file.
    expect(rowFor(rows, '1st Place Overall')?.winner).toBe('Ada Test');
    expect(rows.some((row) => row.winner === 'Grace Test')).toBe(false);
  });

  it('carries a spot draw the presenter made, with no time beside it', () => {
    const awards = computeAwards(SOLO, FIELD, CROSSINGS);
    const draw = awards.find((award) => award.kind === 'random_draw_1');
    const drawn = awards.map((award): PrizeAward =>
      award === draw
        ? {
            ...award,
            // What `resolvePrizeAwards()` does with a choice out of the URL: a team, and
            // deliberately no metric.
            winner: { type: 'team', team: FIELD[2]!, metricMs: 0, metricLabel: '' },
          }
        : award,
    );

    const row = rowFor(buildPrizeRows(drawn, 'solo'), 'Spot Prize');
    // ⚠️ `Drawn` rather than a blank Time column beside a name, which would read as a lost time.
    expect(row).toMatchObject({ winner: 'Mary Test', time: '', kind: 'Drawn' });
  });

  it('names one leg’s bib for a runner award and both for a team award', () => {
    const relay = { ...SOLO, format: 'relay' as const };
    const pair: TeamWithRunners & { name: string | null } = {
      ...soloTeam('7', 'Ada', 'female', 34),
      name: 'The Bees',
      runners: [
        soloTeam('7', 'Ada', 'female', 34).runners[0]!,
        { ...soloTeam('7', 'Grace', 'male', 41).runners[0]!, id: 'r-7b', leg: 2 },
      ],
    };

    const rows = buildPrizeRows(
      computeAwards(relay, [pair], [crossing('17', 20), crossing('27', 45)]),
      'relay',
    );

    expect(rowFor(rows, '1st Place Overall')).toMatchObject({
      winner: 'Ada Test & Grace Test',
      bibs: '17 / 27',
      team: 'The Bees',
    });

    // ⚠️ **The runner award is asserted against an award built by hand rather than one
    // `computeAwards()` happened to produce**, because with one pair in the field every runner
    // is already on a prize-winning team and the leg awards are correctly empty. What is under
    // test here is this module's choice of *which* bib, not `awards.ts`' eligibility rule —
    // which `timing-awards.test.ts` owns.
    const legAward: PrizeAward = {
      kind: 'fastest_individual_male',
      title: 'Fastest Male Leg',
      subtitle: 'Fastest single leg by a male runner not already winning',
      winner: {
        type: 'runner',
        team: pair,
        runner: pair.runners[1]!,
        leg: 2,
        metricMs: 25 * 60_000,
        metricLabel: '25:00',
      },
    };

    // One person over one leg; printing both numbers would send whoever is calling names out
    // looking for two people.
    expect(buildPrizeRows([legAward], 'relay')[0]?.bibs).toBe('27');
  });
});

describe('prizeExportCsv', () => {
  it('opens with the byte-order mark on the bytes and the header the module names', () => {
    const csv = prizeExportCsv(
      buildPrizeRows(computeAwards(SOLO, FIELD, CROSSINGS), 'solo'),
    );
    const bytes = new TextEncoder().encode(csv);

    // ⚠️ Asserted on `EF BB BF`, never through `Response.text()` — see `timing-result-export`.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(decoded.slice(1).split('\r\n')[0]).toBe(PRIZE_EXPORT_HEADER.join(','));
  });
});
