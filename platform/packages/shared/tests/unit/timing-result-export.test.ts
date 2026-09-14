import { describe, expect, it } from 'vitest';
import {
  buildExportRows,
  resultExportCsv,
  runnerBibs,
  RESULT_EXPORT_HEADER,
} from '../../src/timing/result-export';
import type { ExportTeam } from '../../src/timing/result-export';
import type { TimingCrossing } from '../../src/timing/rows';

/**
 * The results export — #205.
 *
 * The three rules #205 states are the three things worth asserting, and each of them fails in a
 * direction somebody only notices after the file has been sent:
 *
 *   * **finishers ranked, terminal statuses with no position, pending absent** — a pending row
 *     carries a blank time with nothing to explain it, which reads as a finisher whose clock
 *     was lost;
 *   * **bibs are runner-driven**, so a relay team whose second runner never turned up shows one
 *     bib rather than a number nobody wore;
 *   * ⚠️ **the byte-order mark is asserted on the bytes.** `TextDecoder` strips a leading U+FEFF
 *     by default, so an assertion written against decoded text reports a mark that is on the
 *     wire as missing — and one written the other way round passes on a file that opens as
 *     mojibake on every Windows machine the club owns. `CLAUDE.md` carries the trap.
 */

const SOLO = {
  actually_started_at: null,
  start_at: '2026-11-01T11:00:00.000Z',
  format: 'solo' as const,
};
const RELAY = { ...SOLO, format: 'relay' as const };
const START = Date.parse(SOLO.start_at);
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

function crossing(bib: string, minutes: number, flagged = false): TimingCrossing {
  return {
    bib,
    captured_at: at(minutes),
    anomaly_flag: flagged,
    resolved_at: null,
    resolved_action: null,
  };
}

function runner(
  id: string,
  leg: number,
  firstname: string,
  gender: string | null = 'female',
  age: number | null = 34,
  role = 'runner',
) {
  return {
    id,
    leg,
    firstname,
    lastname: 'Test',
    gender,
    result_placement: null,
    role,
    age_on_day: age,
  };
}

function soloTeam(
  number: string,
  firstname: string,
  overrides: Partial<ExportTeam> = {},
): ExportTeam {
  return {
    id: `team-${number}`,
    team_number: number,
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    race_status: null,
    dnf_at: null,
    name: null,
    runners: [runner(`r-${number}`, 1, firstname)],
    ...overrides,
  };
}

describe('buildExportRows', () => {
  it('ranks finishers and leaves a team still on the course out entirely', () => {
    const rows = buildExportRows(
      SOLO,
      [soloTeam('11', 'Ada'), soloTeam('12', 'Grace'), soloTeam('13', 'Mary')],
      [crossing('12', 40), crossing('11', 45)],
    );

    // Mary has no crossing at all, so she is pending and absent — not a blank row.
    expect(rows.map((row) => [row.position, row.bibs])).toEqual([
      [1, '12'],
      [2, '11'],
    ]);
    expect(rows.every((row) => row.status === '')).toBe(true);
  });

  it('gives a DNS, a DNF and a DQ no position and puts them after every finisher', () => {
    const rows = buildExportRows(
      SOLO,
      [
        soloTeam('11', 'Ada'),
        soloTeam('12', 'Grace', { race_status: 'dns' }),
        soloTeam('13', 'Mary', { race_status: 'dnf' }),
        soloTeam('14', 'Joan', { race_status: 'dq' }),
      ],
      [crossing('11', 45), crossing('13', 50)],
    );

    expect(rows.map((row) => [row.position, row.status])).toEqual([
      [1, ''],
      [null, 'DNS'],
      [null, 'DNF'],
      [null, 'DQ'],
    ]);

    // ⚠️ A terminal row carries no time. A real one would say they finished and a dash would
    // say they are still out; the label is what replaces the team time.
    expect(rows.slice(1).every((row) => row.total === '')).toBe(true);
  });

  it('names the band a solo runner is placed in, and a guide is in none', () => {
    const guide = soloTeam('14', 'Iris', {
      runners: [runner('r-14', 1, 'Iris', 'female', 41, 'guide')],
    });

    const rows = buildExportRows(
      SOLO,
      [soloTeam('11', 'Ada', { runners: [runner('r-11', 1, 'Ada', 'male', 52)] }), guide],
      [crossing('11', 45), crossing('14', 46)],
    );

    expect(rows[0]?.category).toBe("Men's Vet 50");
    expect(rows[1]?.category).toBe('');
  });

  it('leaves the leg columns empty on a solo race and fills them on a relay', () => {
    const solo = buildExportRows(SOLO, [soloTeam('11', 'Ada')], [crossing('11', 45)]);
    expect([solo[0]?.legA, solo[0]?.legB]).toEqual(['', '']);
    expect(solo[0]?.total).toBe('00:45:00.00');

    const pair: ExportTeam = {
      ...soloTeam('7', 'Ada'),
      runners: [runner('r-7a', 1, 'Ada'), runner('r-7b', 2, 'Grace', 'male')],
    };
    const relay = buildExportRows(
      RELAY,
      [pair],
      [crossing('17', 20), crossing('27', 45)],
    );

    expect([relay[0]?.legA, relay[0]?.legB, relay[0]?.total]).toEqual([
      '00:20:00.00',
      '00:25:00.00',
      '00:45:00.00',
    ]);
  });

  it('marks a row whose capture is still flagged, which only a preview can ever hold', () => {
    const rows = buildExportRows(
      SOLO,
      [soloTeam('11', 'Ada')],
      [crossing('11', 45, true)],
    );
    expect(rows[0]?.beingChecked).toBe('Yes');
  });
});

describe('runnerBibs', () => {
  it('shows one bib for a lone-runner relay team, not the two legs it could derive', () => {
    const lonely: ExportTeam = {
      ...soloTeam('7', 'Ada'),
      runners: [runner('r-7a', 1, 'Ada')],
    };

    // ⚠️ The leg-driven answer — which is what `teamEffectiveBibs()` gives — is `['17', '27']`.
    // Nobody wore `27`.
    expect(runnerBibs(lonely, 'relay')).toEqual(['17']);
  });

  it('shows both when both ran, in leg order, and honours an override', () => {
    const pair: ExportTeam = {
      ...soloTeam('7', 'Ada'),
      bib_leg2: '99',
      runners: [runner('r-7b', 2, 'Grace'), runner('r-7a', 1, 'Ada')],
    };

    expect(runnerBibs(pair, 'relay')).toEqual(['17', '99']);
  });

  it('resolves a solo team with no runner recorded, because the number is the place', () => {
    const empty: ExportTeam = { ...soloTeam('11', 'Ada'), runners: [] };
    expect(runnerBibs(empty, 'solo')).toEqual(['11']);
  });
});

describe('resultExportCsv', () => {
  it('opens with the byte-order mark on the bytes, not merely in decoded text', () => {
    const csv = resultExportCsv(
      buildExportRows(SOLO, [soloTeam('11', 'Ada')], [crossing('11', 45)]),
    );

    // ⚠️ **The assertion is on `EF BB BF`.** `new TextDecoder().decode()` would strip it and
    // report a mark that is present as absent. See this file's header.
    const bytes = new TextEncoder().encode(csv);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    // And the same file read back with the mark kept, so the header row is where it says.
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(decoded.slice(1).split('\r\n')[0]).toBe(RESULT_EXPORT_HEADER.join(','));
  });

  it('quotes a club name carrying a comma and a quote rather than splitting the row', () => {
    const awkward = soloTeam('11', 'Ada', { name: 'Bristol & West AC, "the Bees"' });
    const csv = resultExportCsv(buildExportRows(SOLO, [awkward], [crossing('11', 45)]));

    expect(csv).toContain('"Bristol & West AC, ""the Bees"""');
    // One header line and one data line, so the comma did not become a column break.
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });
});
