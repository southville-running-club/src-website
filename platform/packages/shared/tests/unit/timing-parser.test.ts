/**
 * The registration import for a **relay**, copied with the module it guards — **including the assertions that
 * the dropped columns are dropped**, which are the ones that matter.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parseRegistrationCsv } from '../../src/timing/registration/parser';
import type { Finding } from '../../src/timing/registration/types';

// Resolved against this file rather than the working directory. A vitest run is rooted at
// the workspace, not the package, so `process.cwd()` found these only by an accident of
// where the original repository happened to be rooted.
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/registration/${name}`, import.meta.url));
const SCRUBBED = readFileSync(fixture('pass-the-buck-2026.csv'), 'utf-8');
const MALFORMED = readFileSync(fixture('pass-the-buck-2026-malformed.csv'), 'utf-8');

// 8 July 2026 at 19:00 BST = 18:00 UTC. Real race day.
const RACE_DAY_ISO = '2026-07-08T18:00:00.000Z';

function findingKinds(findings: Finding[]) {
  return findings.map((f) => f.kind);
}

describe('parseRegistrationCsv — scrubbed fixture', () => {
  const result = parseRegistrationCsv(SCRUBBED, RACE_DAY_ISO, 'relay');

  it('parses to 6 teams', () => {
    expect(result.teams).toHaveLength(6);
  });

  it('parses to 12 runners total', () => {
    const totalRunners = result.teams.reduce((sum, t) => sum + t.runners.length, 0);
    expect(totalRunners).toBe(12);
  });

  it('has no blocking findings', () => {
    expect(result.hasBlocking).toBe(false);
    expect(result.findings.filter((f) => f.severity === 'block')).toHaveLength(0);
  });

  it('has no warn-level findings', () => {
    // Scrubbed fixture is all clean pairs — only info-level findings expected.
    expect(result.findings.filter((f) => f.severity === 'warn')).toHaveLength(0);
  });

  it('emits info-level finding for within-pair shared email (Hayes pair)', () => {
    const f = result.findings.find(
      (x) => x.kind === 'within-pair-duplicate-email' && x.purchaseOrderId === '13630491',
    );
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('emits info-level finding for empty TeamName (Mark Stevens team)', () => {
    const f = result.findings.find(
      (x) => x.kind === 'empty-team-name' && x.purchaseOrderId === '13596741',
    );
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it("preserves EntryType verbatim including the 'Unafilliated' typo", () => {
    const unafilliated = result.teams.filter((t) => t.entry_type === 'Unafilliated');
    // Hoofclump + Mark Stevens team — both Unafilliated in the fixture.
    expect(unafilliated.length).toBe(2);
  });

  it("preserves the empty TeamName as null on Mark Stevens' team", () => {
    const mark = result.teams.find((t) => t.purchase_order_id === '13596741');
    expect(mark).toBeDefined();
    expect(mark!.name).toBeNull();
  });

  it('detects captain from OwnerMember on Oliver Walsh (leg 1)', () => {
    const team = result.teams.find((t) => t.purchase_order_id === '13651430')!;
    expect(team.runners[0]!.is_captain).toBe(true); // Oliver Walsh, leg 1
    expect(team.runners[1]!.is_captain).toBe(false); // Charlotte Hughes, leg 2
  });

  it('detects captain when OwnerMember matches the leg-2 runner (Andrew Mitchell)', () => {
    const team = result.teams.find((t) => t.purchase_order_id === '13635863')!;
    expect(team.runners[0]!.is_captain).toBe(false); // Olivia Greenwood, leg 1
    expect(team.runners[1]!.is_captain).toBe(true); // Andrew Mitchell, leg 2
  });

  it('assigns leg 1/2 in CSV row order within a pair', () => {
    const team = result.teams.find((t) => t.purchase_order_id === '13651430')!;
    expect(team.runners.map((r) => r.leg)).toEqual([1, 2]);
    expect(team.runners[0]!.firstname).toBe('Oliver');
    expect(team.runners[1]!.firstname).toBe('Charlotte');
  });

  it('computes age_on_day from DOB against event start', () => {
    const team = result.teams.find((t) => t.purchase_order_id === '13651430')!;
    // Oliver Walsh born 14/03/1988; race day 2026-07-08 → age 38.
    expect(team.runners[0]!.age_on_day).toBe(38);
    // Charlotte Hughes born 16/05/1989; race day 2026-07-08 → age 37.
    expect(team.runners[1]!.age_on_day).toBe(37);
  });

  it('does not return raw DOB in the result shape', () => {
    // Tighten the PII boundary: there should be no 'dob' / 'address' /
    // 'phone' field on any parsed runner shape.
    const flatRunners = result.teams.flatMap((t) => t.runners);
    for (const r of flatRunners) {
      const keys = Object.keys(r);
      expect(keys).not.toContain('dob');
      expect(keys).not.toContain('address');
      expect(keys).not.toContain('phone');
      expect(keys).not.toContain('emergency_name');
    }
  });

  it('nullifies empty club_name for unaffiliated partners', () => {
    const team = result.teams.find((t) => t.purchase_order_id === '13631455')!;
    // Marcus has Thornbury Running Club; Sophie has empty ClubName.
    expect(team.runners[0]!.club_name).toBe('Thornbury Running Club');
    expect(team.runners[1]!.club_name).toBeNull();
  });
});

describe('parseRegistrationCsv — malformed fixture', () => {
  const result = parseRegistrationCsv(MALFORMED, RACE_DAY_ISO, 'relay');

  it('has blocking findings', () => {
    expect(result.hasBlocking).toBe(true);
  });

  it('emits a blocking missing-required-field for the blank-email row', () => {
    const f = result.findings.find(
      (x) =>
        x.severity === 'block' &&
        x.kind === 'missing-required-field' &&
        x.columnName === 'Email',
    );
    expect(f).toBeDefined();
  });

  it('emits a blocking multi-row-team for the 3-pack (13635863)', () => {
    const f = result.findings.find(
      (x) =>
        x.severity === 'block' &&
        x.kind === 'multi-row-team' &&
        x.purchaseOrderId === '13635863',
    );
    expect(f).toBeDefined();
  });

  it('emits warn lone-runner for Marcus Bennett (13631455) and Mark Stevens (13596741)', () => {
    const lones = result.findings.filter((f) => f.kind === 'lone-runner');
    const poIds = lones.map((f) => f.purchaseOrderId).sort();
    expect(poIds).toEqual(['13596741', '13631455']);
    for (const f of lones) expect(f.severity).toBe('warn');
  });

  it("emits warn cross-team-duplicate-email for Oliver's shared email", () => {
    const f = result.findings.find(
      (x) => x.severity === 'warn' && x.kind === 'cross-team-duplicate-email',
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('oliver.walsh.001@example.test');
  });

  it('emits warn pair-not-adjacent for the 3-pack team', () => {
    const f = result.findings.find(
      (x) => x.kind === 'pair-not-adjacent' && x.severity === 'warn',
    );
    expect(f).toBeDefined();
    expect(f!.purchaseOrderId).toBe('13635863');
  });

  it('emits info unexpected-columns for extra_column_for_test', () => {
    const f = result.findings.find(
      (x) => x.severity === 'info' && x.kind === 'unexpected-columns',
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('extra_column_for_test');
  });

  it('does NOT include the 3-pack as a parsed team', () => {
    // The 13635863 group is blocked and skipped — no team built for it.
    const t = result.teams.find((x) => x.purchase_order_id === '13635863');
    expect(t).toBeUndefined();
  });

  it('still includes the lone runners as parsed teams (commit blocked but data shape valid)', () => {
    const marcus = result.teams.find((t) => t.purchase_order_id === '13631455');
    const mark = result.teams.find((t) => t.purchase_order_id === '13596741');
    expect(marcus).toBeDefined();
    expect(marcus!.runners).toHaveLength(1);
    expect(marcus!.runners[0]!.leg).toBe(1);
    expect(mark).toBeDefined();
    expect(mark!.runners).toHaveLength(1);
    expect(mark!.runners[0]!.leg).toBe(1);
  });
});

describe('parseRegistrationCsv — edge cases', () => {
  it('handles empty input gracefully', () => {
    const r = parseRegistrationCsv('', RACE_DAY_ISO, 'relay');
    expect(r.teams).toHaveLength(0);
    expect(r.totalRows).toBe(0);
  });

  it('handles header-only input (no data rows)', () => {
    const headerOnly =
      'EventName,EntryType,Firstname,Lastname,Email,Gender,PurchaseOrderId\n';
    const r = parseRegistrationCsv(headerOnly, RACE_DAY_ISO, 'relay');
    expect(r.teams).toHaveLength(0);
    expect(r.hasBlocking).toBe(false);
  });

  it('flags malformed DOB as warn invalid-dob without blocking', () => {
    const csv =
      'Firstname,Lastname,Email,Gender,DOB,OwnerMember,PurchaseOrderId\n' +
      'Test,Person,test@example.test,M,not-a-date,Test Person,PO1\n';
    const r = parseRegistrationCsv(csv, RACE_DAY_ISO, 'relay');
    const invalid = r.findings.find((f) => f.kind === 'invalid-dob');
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe('warn');
    expect(r.hasBlocking).toBe(false);
    expect(r.teams[0]!.runners[0]!.age_on_day).toBeNull();
  });

  it('ignores trailing empty column from source CSV without warning', () => {
    // Header ending in comma → unnamed trailing column. Must NOT trigger
    // unexpected-columns since the empty-string column is in KNOWN_COLUMNS.
    const csv =
      'Firstname,Lastname,Email,Gender,OwnerMember,PurchaseOrderId,\n' +
      'Test,Person,test@example.test,M,Test Person,PO1,\n';
    const r = parseRegistrationCsv(csv, RACE_DAY_ISO, 'relay');
    expect(findingKinds(r.findings)).not.toContain('unexpected-columns');
  });
});
