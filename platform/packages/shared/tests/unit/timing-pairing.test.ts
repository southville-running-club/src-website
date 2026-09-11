/**
 * Copied with the module it guards, unchanged apart from the import path — the same discipline
 * as every other file in this port.
 */

import { describe, it, expect } from 'vitest';
import { planPairing, type SoloForPairing } from '../../src/timing/registration/pairing';

// Terse solo builder. Defaults model the common case: an imported /
// walk-up lone runner sitting on Leg 1.
function solo(
  teamNumber: string,
  overrides: Partial<SoloForPairing> = {},
): SoloForPairing {
  return {
    teamId: `team-${teamNumber}`,
    teamNumber,
    bibLeg1: null,
    bibLeg2: null,
    runnerId: `runner-${teamNumber}`,
    runnerLeg: 1,
    runnerName: `Runner ${teamNumber}`,
    ...overrides,
  };
}

describe('planPairing', () => {
  it('keeps the lower number; absorbs the other at the vacant leg', () => {
    // Two Leg-1 solos (30 and 32) — the common case from the roster.
    const plan = planPairing(solo('30'), solo('32'));
    expect(plan.survivorTeamNumber).toBe('30');
    expect(plan.survivorTeamId).toBe('team-30');
    expect(plan.removedTeamId).toBe('team-32');

    // Survivor untouched: still Leg 1, bib 130.
    expect(plan.keep).toEqual({
      runnerId: 'runner-30',
      runnerName: 'Runner 30',
      leg: 1,
      bib: '130',
    });

    // Absorbed runner moves onto team 30 at Leg 2 → bib 230 (was 132).
    expect(plan.moved).toEqual({
      runnerId: 'runner-32',
      runnerName: 'Runner 32',
      fromLeg: 1,
      fromBib: '132',
      toTeamId: 'team-30',
      toLeg: 2,
      toBib: '230',
    });
  });

  it("is order-independent — argument order doesn't change the survivor", () => {
    const ab = planPairing(solo('30'), solo('32'));
    const ba = planPairing(solo('32'), solo('30'));
    expect(ba.survivorTeamNumber).toBe(ab.survivorTeamNumber);
    expect(ba.removedTeamId).toBe(ab.removedTeamId);
    expect(ba.moved.toBib).toBe(ab.moved.toBib);
  });

  it('fills Leg 1 when the surviving runner is on Leg 2', () => {
    // Rare: an imported Leg-2 lone runner survives. Absorbed fills Leg 1.
    const plan = planPairing(solo('07', { runnerLeg: 2 }), solo('11', { runnerLeg: 1 }));
    expect(plan.survivorTeamNumber).toBe('07');
    expect(plan.keep.leg).toBe(2);
    expect(plan.keep.bib).toBe('207');
    expect(plan.moved.toLeg).toBe(1);
    expect(plan.moved.toBib).toBe('107');
    expect(plan.moved.fromBib).toBe('111');
  });

  it('carries padded team numbers through to the bibs', () => {
    const plan = planPairing(solo('03'), solo('08'));
    expect(plan.keep.bib).toBe('103');
    expect(plan.moved.toBib).toBe('203');
  });

  it('compares numerically, not lexically (9 vs 10)', () => {
    // Lexical sort would pick "10" as lower ("1" < "9"); numeric is right.
    const plan = planPairing(solo('9'), solo('10'));
    expect(plan.survivorTeamNumber).toBe('9');
    expect(plan.removedTeamId).toBe('team-10');
  });

  it('reports override bibs via effectiveBib, not derived (Slice 10 solo bibs)', () => {
    // Solo 30 was handed physical pool bib 150 (override on its leg 1); solo 32
    // has a leg-1 override 199. Survivor 30 keeps 150; the absorbed runner
    // arrives wearing 199 and is re-bibbed to team 30's derived vacant leg 230.
    const plan = planPairing(
      solo('30', { bibLeg1: '150' }),
      solo('32', { bibLeg1: '199' }),
    );
    expect(plan.keep.bib).toBe('150'); // survivor keeps its physical bib
    expect(plan.moved.fromBib).toBe('199'); // absorbed's physical bib (collect)
    expect(plan.moved.toBib).toBe('230'); // re-bib target = derived vacant leg
  });

  it('throws on identical team numbers', () => {
    expect(() => planPairing(solo('30'), solo('30'))).toThrow();
  });

  it('throws on a non-numeric team number', () => {
    expect(() => planPairing(solo('T1'), solo('30'))).toThrow();
  });
});
