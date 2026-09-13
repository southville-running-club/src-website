/**
 * The glue between the parser and `timing.import_registration()` — #202.
 *
 * ⚠️ **The assertions that matter here are the negative ones.** That a first name survives the
 * mapping is worth little; that nothing else does is the whole slice. So the last block posts a
 * team carrying every column the CSV drops and asserts none of them reaches a row.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toImportRows } from '../../src/timing/registration/import-rows';
import { parseRegistrationCsv } from '../../src/timing/registration/parser';
import type { ParsedTeam } from '../../src/timing/registration/types';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/registration/${name}`, import.meta.url));
const SCRUBBED = readFileSync(fixture('pass-the-buck-2026.csv'), 'utf-8');

// 8 July 2026 at 19:00 BST = 18:00 UTC. The same instant the parser's own tests pin.
const RACE_DAY_ISO = '2026-07-08T18:00:00.000Z';

describe('toImportRows', () => {
  const parsed = parseRegistrationCsv(SCRUBBED, RACE_DAY_ISO, 'relay');
  const rows = toImportRows(parsed.teams);

  it('maps every team the parser built and invents none', () => {
    expect(rows).toHaveLength(parsed.teams.length);
    expect(rows.map((r) => r.purchase_order_id)).toEqual(
      parsed.teams.map((t) => t.purchase_order_id),
    );
  });

  /**
   * ⚠️ **`event_roster()` orders `csv_row_index nulls last`**, so a null here sorts a whole
   * imported field arbitrarily and the printed start list stops matching the spreadsheet it
   * was typed from. This is the assertion that says the column is actually carried.
   */
  it('carries a row index for every team, in the order the file gave them', () => {
    const indices = rows.map((r) => r.csv_row_index);
    expect(indices.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  /**
   * `timing.teams.category` is a **relay pair** category that `categories.ts` derives from two
   * runners' genders at read time. Writing a guess into it would put the stored value and the
   * derived one out of step the first time a runner was corrected — and the CSV's own
   * `AgeCategory` column is empty in every row the club holds anyway.
   */
  it('never writes a category, because the file does not carry one', () => {
    expect(rows.every((r) => r.category === null)).toBe(true);
  });

  it('keeps each team’s runners on their own legs, captain flag and all', () => {
    for (const [i, row] of rows.entries()) {
      const team = parsed.teams[i]!;
      expect(row.runners.map((r) => r.leg)).toEqual(team.runners.map((r) => r.leg));
      expect(row.runners.map((r) => r.is_captain)).toEqual(
        team.runners.map((r) => r.is_captain),
      );
    }
  });

  /**
   * ⚠️ **The whole point of the slice, asserted on the shape that actually reaches PostgREST.**
   * `packages/db/tests/timing-import.test.ts` attempts the same bypass at the database; this is
   * the layer above, where a well-meaning `...team` spread would put it all back.
   */
  it('carries no date of birth, address, phone, emergency contact or medical note', () => {
    const serialised = JSON.stringify(rows);
    for (const forbidden of [
      'date_of_birth',
      'dob',
      'DOB',
      'address',
      'postcode',
      'POSTCODE',
      'phone',
      'Tel',
      'emergency',
      'Emergency',
      'medical',
      'Medical',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('names exactly the keys the function reads, and nothing else', () => {
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'category',
      'csv_row_index',
      'entry_type',
      'name',
      'purchase_order_id',
      'runners',
    ]);
    expect(Object.keys(rows[0]!.runners[0]!).sort()).toEqual([
      'age_on_day',
      'club_name',
      'email',
      'firstname',
      'gender',
      'is_captain',
      'lastname',
      'leg',
    ]);
  });
});

describe('toImportRows — the empty string is not a value', () => {
  /**
   * `parseRegistrationCsv()` yields `''` for a gender it does not recognise, deliberately, so
   * the parse says *"no band"* rather than guessing. **The column is nullable and should hold a
   * null rather than an empty string**, for `add_walk_in()`'s stated reason: the old
   * application stored `""` for an email address, *"which is a value that reads as an address
   * somebody has and is not one"*. The same is true of a race category.
   */
  const team: ParsedTeam = {
    purchase_order_id: 'PO-1',
    csv_row_index: 1,
    name: null,
    entry_type: null,
    runners: [
      {
        firstname: 'Alex',
        lastname: 'Doe',
        gender: '',
        email: '',
        club_name: null,
        age_on_day: null,
        is_captain: true,
        leg: 1,
      },
    ],
  };

  it('writes null rather than an empty string for a gender or an address', () => {
    const [row] = toImportRows([team]);
    expect(row!.runners[0]!.gender).toBeNull();
    expect(row!.runners[0]!.email).toBeNull();
  });

  it('leaves a recognised value exactly as the parser mapped it', () => {
    const [row] = toImportRows([
      { ...team, runners: [{ ...team.runners[0]!, gender: 'female' }] },
    ]);
    expect(row!.runners[0]!.gender).toBe('female');
  });
});
