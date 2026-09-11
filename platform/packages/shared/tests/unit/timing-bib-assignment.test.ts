/**
 * Copied with the module it guards, unchanged apart from the import path — the same discipline
 * as every other file in this port.
 */

import { describe, it, expect } from 'vitest';
import {
  planBibAssignment,
  bibFromTeamNumber,
  computeNextTeamNumber,
  MAX_TEAM_NUMBER,
} from '../../src/timing/registration/bib-assignment';

// Helper: build a TeamForAssignment quickly without writing the full
// object every time. Order in the array doesn't matter — planBibAssignment
// sorts by csv_row_index internally.
function t(csvRow: number, teamNumber: string | null, id = `id-${csvRow}`) {
  return { id, csv_row_index: csvRow, team_number: teamNumber };
}

// Default options for the common "Kayleigh enters 101/201" case — 2-digit
// padding, starting at team_number 1 (zero-padded to "01"). Tests that
// need different starts override per-call.
const DEFAULT_OPTS = { startFrom: 1, padWidth: 2 };

describe('planBibAssignment', () => {
  it('returns empty plan for empty input', () => {
    const plan = planBibAssignment([], DEFAULT_OPTS);
    expect(plan.assignments).toEqual([]);
    expect(plan.alreadyAssigned).toBe(0);
    expect(plan.totalCount).toBe(0);
    expect(plan.assignedFirst).toBeNull();
    expect(plan.assignedLast).toBeNull();
    expect(plan.eventFirst).toBeNull();
    expect(plan.eventLast).toBeNull();
  });

  it('assigns consecutively from 1 when nothing is numbered (101/201 default)', () => {
    const plan = planBibAssignment([t(1, null), t(2, null), t(3, null)], DEFAULT_OPTS);
    expect(plan.assignments).toEqual([
      { id: 'id-1', newTeamNumber: '01' },
      { id: 'id-2', newTeamNumber: '02' },
      { id: 'id-3', newTeamNumber: '03' },
    ]);
    expect(plan.assignedFirst).toBe(1);
    expect(plan.assignedLast).toBe(3);
    expect(plan.eventFirst).toBe(1);
    expect(plan.eventLast).toBe(3);
    expect(plan.alreadyAssigned).toBe(0);
    expect(plan.totalCount).toBe(3);
  });

  it('preserves CSV row order regardless of input array order', () => {
    const plan = planBibAssignment(
      [t(3, null, 'third'), t(1, null, 'first'), t(2, null, 'second')],
      DEFAULT_OPTS,
    );
    expect(plan.assignments.map((a) => a.id)).toEqual(['first', 'second', 'third']);
    expect(plan.assignments.map((a) => a.newTeamNumber)).toEqual(['01', '02', '03']);
  });

  it('starts from a custom startFrom (e.g., Kayleigh enters 150/250)', () => {
    // suffix "50" → startFrom 50, padWidth 2
    const plan = planBibAssignment([t(1, null), t(2, null), t(3, null)], {
      startFrom: 50,
      padWidth: 2,
    });
    expect(plan.assignments).toEqual([
      { id: 'id-1', newTeamNumber: '50' },
      { id: 'id-2', newTeamNumber: '51' },
      { id: 'id-3', newTeamNumber: '52' },
    ]);
    expect(plan.assignedFirst).toBe(50);
    expect(plan.assignedLast).toBe(52);
  });

  it('respects padWidth wider than 2 (e.g., 4-digit bibs from 1001/2001)', () => {
    // suffix "001" → startFrom 1, padWidth 3
    const plan = planBibAssignment([t(1, null), t(2, null)], {
      startFrom: 1,
      padWidth: 3,
    });
    expect(plan.assignments).toEqual([
      { id: 'id-1', newTeamNumber: '001' },
      { id: 'id-2', newTeamNumber: '002' },
    ]);
  });

  it('is a no-op when all teams are numbered', () => {
    const plan = planBibAssignment([t(1, '01'), t(2, '02'), t(3, '03')], DEFAULT_OPTS);
    expect(plan.assignments).toEqual([]);
    expect(plan.assignedFirst).toBeNull();
    expect(plan.assignedLast).toBeNull();
    expect(plan.eventFirst).toBe(1);
    expect(plan.eventLast).toBe(3);
    expect(plan.alreadyAssigned).toBe(3);
  });

  it('extends from max+1 on partial state (idempotent re-run)', () => {
    const plan = planBibAssignment(
      [
        t(1, '01'),
        t(2, '02'),
        t(3, '03'),
        t(4, null, 'row4'),
        t(5, null, 'row5'),
        t(6, null, 'row6'),
      ],
      DEFAULT_OPTS,
    );
    expect(plan.assignments).toEqual([
      { id: 'row4', newTeamNumber: '04' },
      { id: 'row5', newTeamNumber: '05' },
      { id: 'row6', newTeamNumber: '06' },
    ]);
    expect(plan.assignedFirst).toBe(4);
    expect(plan.assignedLast).toBe(6);
    expect(plan.eventFirst).toBe(1);
    expect(plan.eventLast).toBe(6);
    expect(plan.alreadyAssigned).toBe(3);
  });

  it('uses max(startFrom, existingMax + 1) for partial extension', () => {
    // Admin says start from 10, but existing teams go up to 15 — must
    // pick up at 16, not 10 (don't collide on the unique constraint).
    const plan = planBibAssignment([t(1, '10'), t(2, '15'), t(3, null, 'row3')], {
      startFrom: 10,
      padWidth: 2,
    });
    expect(plan.assignments).toEqual([{ id: 'row3', newTeamNumber: '16' }]);
  });

  it('startFrom is the floor even when existingMax is lower', () => {
    // Existing has "01"-"03"; admin says start at 50 → new assignments
    // begin at 50 (jumping past 04-49).
    const plan = planBibAssignment(
      [t(1, '01'), t(2, '02'), t(3, '03'), t(4, null, 'row4')],
      { startFrom: 50, padWidth: 2 },
    );
    expect(plan.assignments).toEqual([{ id: 'row4', newTeamNumber: '50' }]);
    expect(plan.eventFirst).toBe(1);
    expect(plan.eventLast).toBe(50);
  });

  it('ignores non-numeric team_numbers when computing max but counts them as assigned', () => {
    const plan = planBibAssignment(
      [t(1, 'T1', 'smoke'), t(2, null, 'row2'), t(3, null, 'row3')],
      DEFAULT_OPTS,
    );
    expect(plan.assignments).toEqual([
      { id: 'row2', newTeamNumber: '01' },
      { id: 'row3', newTeamNumber: '02' },
    ]);
    expect(plan.alreadyAssigned).toBe(1);
    expect(plan.eventFirst).toBe(1);
    expect(plan.eventLast).toBe(2);
  });

  it('handles a single unnumbered team', () => {
    const plan = planBibAssignment([t(1, null)], DEFAULT_OPTS);
    expect(plan.assignments).toEqual([{ id: 'id-1', newTeamNumber: '01' }]);
    expect(plan.assignedFirst).toBe(1);
    expect(plan.assignedLast).toBe(1);
  });
});

describe('bibFromTeamNumber', () => {
  // No padding inside this function — caller passes the already-stored
  // team_number text. The function just concatenates leg + team_number.
  it('derives bibs for padded 2-digit team numbers', () => {
    expect(bibFromTeamNumber('01', 1)).toBe('101');
    expect(bibFromTeamNumber('01', 2)).toBe('201');
    expect(bibFromTeamNumber('07', 1)).toBe('107');
    expect(bibFromTeamNumber('47', 1)).toBe('147');
    expect(bibFromTeamNumber('47', 2)).toBe('247');
    expect(bibFromTeamNumber('99', 2)).toBe('299');
  });

  it('derives bibs for padded 3-digit team numbers', () => {
    expect(bibFromTeamNumber('001', 1)).toBe('1001');
    expect(bibFromTeamNumber('050', 2)).toBe('2050');
    expect(bibFromTeamNumber('999', 1)).toBe('1999');
  });

  it('accepts numeric inputs (legacy callers / convenience)', () => {
    expect(bibFromTeamNumber(7, 1)).toBe('17');
    expect(bibFromTeamNumber(100, 2)).toBe('2100');
  });
});

describe('computeNextTeamNumber', () => {
  // Terser than the full RosterTeam — the helper only reads team_number.
  const n = (team_number: string | null) => ({ team_number });

  it('returns null when no team is numbered yet', () => {
    expect(computeNextTeamNumber([])).toBeNull();
    expect(computeNextTeamNumber([n(null), n(null)])).toBeNull();
  });

  it('returns null when every team_number is non-numeric', () => {
    // Smoke-test teams like "T1" carry no scheme to extend.
    expect(computeNextTeamNumber([n('T1'), n('smoke')])).toBeNull();
  });

  it("appends after the max, padding to the event's width (101/201 event)", () => {
    const teams = [n('01'), n('02'), n('47')];
    expect(computeNextTeamNumber(teams)).toEqual({
      next: 48,
      padWidth: 2,
      teamNumber: '48',
    });
  });

  it('derives the two walk-up bibs via bibFromTeamNumber', () => {
    const next = computeNextTeamNumber([n('59'), n('60')])!;
    expect(next.teamNumber).toBe('61');
    expect(bibFromTeamNumber(next.teamNumber, 1)).toBe('161');
    expect(bibFromTeamNumber(next.teamNumber, 2)).toBe('261');
  });

  it('ignores non-numeric team_numbers for max and width', () => {
    // "T1" (len 2) must not influence max; "100" is the real max.
    const next = computeNextTeamNumber([n('T1'), n('98'), n('100')])!;
    expect(next.next).toBe(101);
    expect(next.padWidth).toBe(3);
    expect(next.teamNumber).toBe('101');
  });

  it("grows width past the event's pad when next overflows it (no collision)", () => {
    // 2-digit event at 99 → next 100 → "100" (3 digits) → bibs 1100/2100.
    // The concat scheme keeps these unique; there is no 100-team ceiling.
    const next = computeNextTeamNumber([n('98'), n('99')])!;
    expect(next).toEqual({ next: 100, padWidth: 2, teamNumber: '100' });
    expect(bibFromTeamNumber(next.teamNumber, 1)).toBe('1100');
    expect(bibFromTeamNumber(next.teamNumber, 2)).toBe('2100');
  });

  it('order-independent: unsorted input yields the same max', () => {
    expect(computeNextTeamNumber([n('47'), n('01'), n('23')])!.teamNumber).toBe('48');
  });

  it('picks up exactly where a planBibAssignment run left off (parity)', () => {
    // Assign 5 teams from scratch at the 101/201 default, then feed the
    // resulting numbered teams to computeNextTeamNumber. The walk-up
    // number must be the number planBibAssignment WOULD have given a 6th
    // team — the two derivations agree on both the number and the padding.
    const plan = planBibAssignment(
      [t(1, null), t(2, null), t(3, null), t(4, null), t(5, null)],
      DEFAULT_OPTS,
    );
    const numbered = plan.assignments.map((a) => n(a.newTeamNumber));
    const sixthViaPlan = planBibAssignment([t(6, null)], {
      startFrom: plan.assignedLast! + 1,
      padWidth: DEFAULT_OPTS.padWidth,
    }).assignments[0]!.newTeamNumber;

    expect(computeNextTeamNumber(numbered)!.teamNumber).toBe(sixthViaPlan);
    expect(sixthViaPlan).toBe('06');
  });

  it('MAX_TEAM_NUMBER bounds the ceiling refusal: next past it is 1000', () => {
    // The action refuses when next > MAX_TEAM_NUMBER. At the boundary the
    // helper still computes honestly; the guard lives in the action.
    const next = computeNextTeamNumber([n('999')])!;
    expect(next.next).toBe(1000);
    expect(next.next > MAX_TEAM_NUMBER).toBe(true);
    // One below the cap is allowed.
    expect(computeNextTeamNumber([n('998')])!.next).toBe(999);
    expect(999 > MAX_TEAM_NUMBER).toBe(false);
  });
});
