/**
 * A guide's own time on the results table — ADR-073.
 *
 * Every team here is the shape `import_from_entries()` actually writes: a visually impaired
 * runner on **leg 1** and their guide on **leg 2** of one solo team, the guide wearing a number
 * of their own as the leg-2 override (ADR-061). Most fixtures in this repository model a guide
 * as a team of their own, which is not a shape the import produces — and is why the guide's
 * time sat unread for a whole race.
 */

import { describe, expect, it } from 'vitest';
import {
  guideOn,
  guideResults,
  resultLines,
  type LineTeam,
  type ResultLine,
} from '../../src/timing/result-lines';
import type { TimingRunner } from '../../src/timing/rows';

type Runner = Pick<TimingRunner, 'leg' | 'role'> & { name: string };
type Team = LineTeam & { runners: Runner[] };

const START = '2026-11-01T11:00:00.000Z';
const SOLO = { format: 'solo' as const, start_at: START, actually_started_at: START };

function team(
  number: string,
  runners: Runner[],
  overrides: Partial<Omit<Team, 'runners'>> = {},
): Team {
  return {
    id: `team-${number}`,
    team_number: number,
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    race_status: null,
    dnf_at: null,
    runners,
    ...overrides,
  };
}

function runner(name: string): Runner {
  return { leg: 1, role: 'runner', name };
}

/** `role` is `'guide'` in the preview's answer and null in the published one. */
function guide(name: string, role: 'guide' | null = 'guide'): Runner {
  return { leg: 2, role, name };
}

function crossing(
  bib: string,
  at: string,
  extra: Partial<{ resolved_action: string }> = {},
) {
  return {
    bib,
    captured_at: at,
    anomaly_flag: false,
    resolved_at: extra.resolved_action ? at : null,
    resolved_action: extra.resolved_action ?? null,
  };
}

/** One line in the words a reader would use: who, which number, where, how long. */
function describeLine(line: ResultLine<Team>): string {
  if (line.kind === 'guide') {
    return `${line.guide.name} #${line.bib} — ${line.result.status} ${String(line.result.totalMs)}`;
  }
  const who = line.team?.runners[0]?.name ?? '?';
  return `${who} ${line.position === null ? '—' : `P${String(line.position)}`} ${line.result.status} ${String(line.result.totalMs)}`;
}

const MINUTE = 60_000;

/**
 * A field of three entries, the middle one guided:
 *
 *   001 Ada,           finishes 40:00
 *   002 Bea + guide Cy on 003, both finish 45:00 and 45:01
 *   004 Dot,           finishes 50:00
 *
 * Numbered the way Assign bibs numbers them since ADR-067 — the guide straight after their
 * runner, and the next entry after that.
 */
function field(guideRole: 'guide' | null = 'guide'): Team[] {
  return [
    team('001', [runner('Ada')]),
    team('002', [runner('Bea'), guide('Cy', guideRole)], { bib_leg2: '003' }),
    team('004', [runner('Dot')]),
  ];
}

const FIELD_CROSSINGS = [
  crossing('001', '2026-11-01T11:40:00.000Z'),
  crossing('002', '2026-11-01T11:45:00.000Z'),
  crossing('003', '2026-11-01T11:45:01.000Z'),
  crossing('004', '2026-11-01T11:50:00.000Z'),
];

describe('guideOn', () => {
  it('finds the runner on leg 2 of a solo team', () => {
    expect(guideOn([runner('Bea'), guide('Cy')], 'solo')?.name).toBe('Cy');
  });

  /**
   * ⚠️ **The published answer withholds `role` for everybody** (ADR-043), so leg 2 is the only
   * thing that says which row is the guide's once a race is public.
   */
  it('finds them when the answer withholds the role, as the published one does', () => {
    expect(guideOn([runner('Bea'), guide('Cy', null)], 'solo')?.name).toBe('Cy');
  });

  it('never treats leg 2 of a relay pair as a guide', () => {
    expect(
      guideOn([runner('Bea'), { leg: 2, role: 'runner', name: 'Cy' }], 'relay'),
    ).toBeNull();
    expect(guideOn([runner('Bea'), guide('Cy', null)], 'relay')).toBeNull();
  });

  it('does not guess that a leg-2 runner the answer calls a runner is a guide', () => {
    expect(
      guideOn([runner('Bea'), { leg: 2, role: 'runner', name: 'Cy' }], 'solo'),
    ).toBeNull();
  });

  it('finds nobody on a team with no guide', () => {
    expect(guideOn([runner('Ada')], 'solo')).toBeNull();
  });
});

describe('resultLines', () => {
  it('lists the guide where their own time puts them, with no position', () => {
    expect(resultLines(SOLO, field(), FIELD_CROSSINGS).map(describeLine)).toEqual([
      `Ada P1 finished ${String(40 * MINUTE)}`,
      `Bea P2 finished ${String(45 * MINUTE)}`,
      `Cy #003 — finished ${String(45 * MINUTE + 1000)}`,
      // ⚠️ Still third. A guide placed in the count would have made Dot fourth, on a table
      // people had already read.
      `Dot P3 finished ${String(50 * MINUTE)}`,
    ]);
  });

  it('lists the guide just the same from the published answer, which withholds the role', () => {
    const lines = resultLines(SOLO, field(null), FIELD_CROSSINGS);
    expect(lines.filter((line) => line.kind === 'guide')).toHaveLength(1);
  });

  it('leaves the runner timed from their own number, whoever crossed first', () => {
    // The guide crosses a second *before* their runner. The entry's time is still the
    // runner's, because a solo team is timed from leg 1 alone.
    const crossings = [
      crossing('002', '2026-11-01T11:45:01.000Z'),
      crossing('003', '2026-11-01T11:45:00.000Z'),
    ];
    const lines = resultLines(SOLO, [field()[1]!], crossings);

    expect(lines.map(describeLine)).toEqual([
      `Cy #003 — finished ${String(45 * MINUTE)}`,
      `Bea P1 finished ${String(45 * MINUTE + 1000)}`,
    ]);
  });

  it('puts the runner first when the two crossed in the same instant', () => {
    const crossings = [
      crossing('003', '2026-11-01T11:45:00.000Z'),
      crossing('002', '2026-11-01T11:45:00.000Z'),
    ];
    const lines = resultLines(SOLO, [field()[1]!], crossings);

    expect(lines.map((line) => line.kind)).toEqual(['entry', 'guide']);
  });

  /**
   * ⚠️ **No capture, no row.** A guide row with no crossing would read "On course", or on a
   * finished race a time the club failed to record, about somebody who ran beside a runner the
   * table already lists.
   */
  it('lists no guide whose own number was never captured', () => {
    const crossings = FIELD_CROSSINGS.filter((one) => one.bib !== '003');
    expect(resultLines(SOLO, field(), crossings).map((line) => line.kind)).toEqual([
      'entry',
      'entry',
      'entry',
    ]);
  });

  it('lists no guide whose only capture was discarded', () => {
    const crossings = [
      ...FIELD_CROSSINGS.filter((one) => one.bib !== '003'),
      crossing('003', '2026-11-01T11:45:01.000Z', { resolved_action: 'discarded' }),
    ];
    expect(guideResults(SOLO, field(), crossings)).toEqual([]);
  });

  it('lists no guide who has no number of their own yet', () => {
    const teams = field();
    teams[1] = { ...teams[1]!, bib_leg2: null };
    expect(guideResults(SOLO, teams, FIELD_CROSSINGS)).toEqual([]);
  });

  it('carries the entry’s DNS, DNF or DQ onto the guide’s row, and its time with it', () => {
    const teams = field();
    teams[1] = { ...teams[1]!, race_status: 'dq' };
    const lines = resultLines(SOLO, teams, FIELD_CROSSINGS);
    const guideLine = lines.find((line) => line.kind === 'guide');

    expect(guideLine?.result.status).toBe('dq');
    expect(guideLine?.result.totalMs).toBeNull();
    // Both sort below the timed field, the entry first.
    expect(lines.map(describeLine).slice(-2)).toEqual([
      'Bea — dq null',
      'Cy #003 — dq null',
    ]);
  });

  it('measures the guide from the start that happened, like everybody else', () => {
    const delayed = { ...SOLO, actually_started_at: '2026-11-01T11:02:00.000Z' };
    const [line] = guideResults(delayed, field(), FIELD_CROSSINGS);
    expect(line?.result.totalMs).toBe(43 * MINUTE + 1000);
  });

  it('adds nothing to a relay, whose leg 2 is the team’s own finish', () => {
    const relay = { ...SOLO, format: 'relay' as const };
    const teams = [team('5', [runner('Ed'), { leg: 2, role: 'runner', name: 'Flo' }])];
    const crossings = [
      crossing('15', '2026-11-01T11:20:00.000Z'),
      crossing('25', '2026-11-01T11:40:00.000Z'),
    ];

    const lines = resultLines(relay, teams, crossings);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('entry');
    expect(lines[0]?.result.totalMs).toBe(40 * MINUTE);
  });

  it('hands back the payload’s own team row, so the page can read its names', () => {
    const teams = field();
    const lines = resultLines(SOLO, teams, FIELD_CROSSINGS);
    const guideLine = lines.find((line) => line.kind === 'guide');

    expect(guideLine?.team).toBe(teams[1]);
    for (const line of lines) {
      expect(teams).toContain(line.team);
    }
  });
});
