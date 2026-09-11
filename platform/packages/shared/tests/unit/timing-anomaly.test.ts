/**
 * The anomaly rules, copied with the module they guard.
 *
 * Unchanged from `bindalshah/src-race-timing`'s `lib/anomaly.test.ts` apart from the import
 * path — the same discipline as `timing-bib.test.ts`: a port whose tests were rewritten proves
 * nothing about what it ported.
 *
 * ⚠️ **The cases that matter most are the ones asserting an anomaly does *not* block.** If a
 * future change makes `checkAnomaly` refuse a crossing rather than mark it, these are what
 * says so.
 */

import { describe, expect, it } from 'vitest';
import { checkAnomaly, formatAnomalyMessage, parseBib } from '../../src/timing/anomaly';

describe('parseBib — relay', () => {
  it('parses 147 as leg 1, team 47', () => {
    expect(parseBib('147', 'relay')).toEqual({
      valid: true,
      kind: 'relay-1',
      teamNumber: '47',
    });
  });

  it('parses 247 as leg 2, team 47', () => {
    expect(parseBib('247', 'relay')).toEqual({
      valid: true,
      kind: 'relay-2',
      teamNumber: '47',
    });
  });

  it('parses 1100 as leg 1, team 100 (3-digit team)', () => {
    expect(parseBib('1100', 'relay')).toEqual({
      valid: true,
      kind: 'relay-1',
      teamNumber: '100',
    });
  });

  it('preserves leading zeros in team number (101 → leg 1, team 01)', () => {
    expect(parseBib('101', 'relay')).toEqual({
      valid: true,
      kind: 'relay-1',
      teamNumber: '01',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseBib('  147  ', 'relay')).toEqual({
      valid: true,
      kind: 'relay-1',
      teamNumber: '47',
    });
  });

  it('rejects bibs without a leg prefix', () => {
    expect(parseBib('47', 'relay')).toEqual({ valid: false });
  });

  it('rejects leg digit other than 1 or 2', () => {
    expect(parseBib('347', 'relay')).toEqual({ valid: false });
  });

  it('rejects leading-zero leg digit (0147)', () => {
    expect(parseBib('0147', 'relay')).toEqual({ valid: false });
  });

  it('rejects partially-numeric input (14a)', () => {
    expect(parseBib('14a', 'relay')).toEqual({ valid: false });
  });

  it('rejects fully non-numeric input', () => {
    expect(parseBib('abc', 'relay')).toEqual({ valid: false });
  });

  it('rejects empty input', () => {
    expect(parseBib('', 'relay')).toEqual({ valid: false });
  });

  it('rejects single-digit input (no team digits)', () => {
    expect(parseBib('1', 'relay')).toEqual({ valid: false });
  });
});

describe('parseBib — solo', () => {
  it('parses 47 as team 47', () => {
    expect(parseBib('47', 'solo')).toEqual({
      valid: true,
      kind: 'solo',
      teamNumber: '47',
    });
  });

  it('parses 147 as team 147 (no leg semantics on solo)', () => {
    expect(parseBib('147', 'solo')).toEqual({
      valid: true,
      kind: 'solo',
      teamNumber: '147',
    });
  });

  it('preserves leading zeros (01 → team 01)', () => {
    expect(parseBib('01', 'solo')).toEqual({
      valid: true,
      kind: 'solo',
      teamNumber: '01',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseBib(' 47 ', 'solo')).toEqual({
      valid: true,
      kind: 'solo',
      teamNumber: '47',
    });
  });

  it('rejects non-numeric input', () => {
    expect(parseBib('abc', 'solo')).toEqual({ valid: false });
  });

  it('rejects empty input', () => {
    expect(parseBib('', 'solo')).toEqual({ valid: false });
  });
});

describe('checkAnomaly — relay', () => {
  it('flags nothing on a valid handover with no priors', () => {
    expect(checkAnomaly('147', 'relay', [])).toEqual({
      flag: false,
      reason: null,
    });
  });

  it('flags nothing on a finish that follows a handover', () => {
    expect(
      checkAnomaly('247', 'relay', [{ bib: '147', captured_at: '2026-04-30T19:00:00Z' }]),
    ).toEqual({ flag: false, reason: null });
  });

  it('flags duplicate bib with the existing captured_at', () => {
    expect(
      checkAnomaly('147', 'relay', [{ bib: '147', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({
      flag: true,
      reason: {
        kind: 'duplicate-bib',
        bib: '147',
        existingCapturedAt: '2026-04-30T19:17:42Z',
      },
    });
  });

  it('flags 2XX before any 1XX for the same team', () => {
    expect(checkAnomaly('247', 'relay', [])).toEqual({
      flag: true,
      reason: {
        kind: 'leg2-before-leg1',
        bib: '247',
        teamNumber: '47',
      },
    });
  });

  it('does not flag a late-logged handover after an unrelated 2XX', () => {
    expect(
      checkAnomaly('147', 'relay', [{ bib: '299', captured_at: '2026-04-30T19:00:00Z' }]),
    ).toEqual({ flag: false, reason: null });
  });

  it('flags duplicate over leg2-before-leg1 when both apply', () => {
    const result = checkAnomaly('247', 'relay', [
      { bib: '247', captured_at: '2026-04-30T19:17:42Z' },
    ]);
    expect(result.flag).toBe(true);
    if (result.flag) {
      expect(result.reason.kind).toBe('duplicate-bib');
    }
  });

  it('flags duplicate even when leg-1 also exists', () => {
    const result = checkAnomaly('247', 'relay', [
      { bib: '147', captured_at: '2026-04-30T19:00:00Z' },
      { bib: '247', captured_at: '2026-04-30T19:17:42Z' },
    ]);
    expect(result.flag).toBe(true);
    if (result.flag) {
      expect(result.reason.kind).toBe('duplicate-bib');
    }
  });

  it('flags 1XX after a 2XX for the same team', () => {
    expect(
      checkAnomaly('147', 'relay', [{ bib: '247', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({
      flag: true,
      reason: {
        kind: 'leg1-after-leg2',
        bib: '147',
        teamNumber: '47',
      },
    });
  });

  it("does not flag 1XX when only a different team's 2XX exists", () => {
    expect(
      checkAnomaly('147', 'relay', [{ bib: '248', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({ flag: false, reason: null });
  });

  it('preserves leading zeros in the leg1-after-leg2 detection (101 / 201)', () => {
    expect(
      checkAnomaly('101', 'relay', [{ bib: '201', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({
      flag: true,
      reason: {
        kind: 'leg1-after-leg2',
        bib: '101',
        teamNumber: '01',
      },
    });
  });

  it('flags duplicate over leg1-after-leg2 when both apply', () => {
    const result = checkAnomaly('147', 'relay', [
      { bib: '147', captured_at: '2026-04-30T19:00:00Z' },
      { bib: '247', captured_at: '2026-04-30T19:17:42Z' },
    ]);
    expect(result.flag).toBe(true);
    if (result.flag) {
      expect(result.reason.kind).toBe('duplicate-bib');
    }
  });

  it('does not anomaly-flag unparseable bibs (UI gates submission)', () => {
    expect(checkAnomaly('abc', 'relay', [])).toEqual({
      flag: false,
      reason: null,
    });
  });

  it('does not anomaly-flag empty bibs', () => {
    expect(checkAnomaly('', 'relay', [])).toEqual({
      flag: false,
      reason: null,
    });
  });
});

describe('checkAnomaly — solo', () => {
  it('flags nothing on a valid solo finish with no priors', () => {
    expect(checkAnomaly('47', 'solo', [])).toEqual({
      flag: false,
      reason: null,
    });
  });

  it('flags duplicate bib', () => {
    expect(
      checkAnomaly('47', 'solo', [{ bib: '47', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({
      flag: true,
      reason: {
        kind: 'duplicate-bib',
        bib: '47',
        existingCapturedAt: '2026-04-30T19:17:42Z',
      },
    });
  });

  it('does not apply the 2XX-before-1XX rule on solo (247 is just team 247)', () => {
    expect(checkAnomaly('247', 'solo', [])).toEqual({
      flag: false,
      reason: null,
    });
  });

  it('does not apply leg1-after-leg2 on solo (147 is just team 147)', () => {
    expect(
      checkAnomaly('147', 'solo', [{ bib: '247', captured_at: '2026-04-30T19:17:42Z' }]),
    ).toEqual({ flag: false, reason: null });
  });
});

describe('formatAnomalyMessage', () => {
  /**
   * ⚠️ **The one assertion in this file that deliberately differs from the original, and the
   * reason is an hour.**
   *
   * It read `19:17:42` there, and passed, because the original renders through the ambient
   * timezone and its test script pins `TZ=UTC`. **30 April is British Summer Time**, so that
   * instant is `20:17:42` in London — the value a marshal at the line would actually see on
   * the clock beside them, and the value this now returns.
   *
   * The old assertion was not testing the rendering. It was testing that the process
   * happened to be running in UTC, which is exactly the drift
   * `docs/architecture/principles.md` bans a bare `toLocale*String` to prevent.
   */
  it('formats duplicate-bib with the London wall-clock time of the existing crossing', () => {
    expect(
      formatAnomalyMessage({
        kind: 'duplicate-bib',
        bib: '147',
        existingCapturedAt: '2026-04-30T19:17:42Z',
      }),
    ).toBe('Duplicate bib 147 — already captured at 20:17:42');
  });

  /**
   * And the same instant six months later, which is the half the original could never have
   * caught: in GMT the London rendering and the UTC one agree again.
   */
  it('agrees with UTC in winter, and that is the point rather than a coincidence', () => {
    expect(
      formatAnomalyMessage({
        kind: 'duplicate-bib',
        bib: '147',
        existingCapturedAt: '2026-11-01T10:17:42Z',
      }),
    ).toBe('Duplicate bib 147 — already captured at 10:17:42');
  });

  it('formats leg2-before-leg1 with the team number', () => {
    expect(
      formatAnomalyMessage({
        kind: 'leg2-before-leg1',
        bib: '247',
        teamNumber: '47',
      }),
    ).toBe('Bib 247 — no handover recorded for team 47');
  });

  it('formats leg1-after-leg2 with the team number', () => {
    expect(
      formatAnomalyMessage({
        kind: 'leg1-after-leg2',
        bib: '147',
        teamNumber: '47',
      }),
    ).toBe('Bib 147 — leg-2 already recorded for team 47');
  });

  it('handles a future-dated existing capture without negative or garbled output', () => {
    expect(
      formatAnomalyMessage({
        kind: 'duplicate-bib',
        bib: '147',
        existingCapturedAt: '2099-01-15T05:30:00Z',
      }),
    ).toBe('Duplicate bib 147 — already captured at 05:30:00');
  });
});
