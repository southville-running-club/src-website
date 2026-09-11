import { describe, expect, it } from 'vitest';
import { parseRegistrationCsv } from '../../src/timing/registration/parser';

/**
 * The registration import for a **solo** race.
 *
 * ## Why the parser has to be told
 *
 * Pass the Buck is a relay: two runners per entry, and a lone one is somebody waiting to be
 * paired on the day, which is worth a warning. **Nightingale Nightmare is solo, where one
 * runner per entry is the entire race.**
 *
 * Read as a relay, a full solo field produces 250 `lone-runner` warnings about nothing — and
 * ⚠️ **a preview that always warns is a preview nobody reads**, which costs the club the one
 * screen that says what is about to be imported. Read as solo, a relay's second runner would
 * be dropped without a word.
 *
 * So `format` is required rather than defaulted. There is no safe default: whichever way it
 * fell, one of the club's two races would be misread.
 *
 * The relay behaviour is asserted next door in `timing-parser.test.ts`, unchanged from the
 * repository it was copied from — which is what says this change added a path rather than
 * altering one.
 */

const RACE_DAY_ISO = '2026-11-01T11:00:00.000Z';
const HEADER = 'Firstname,Lastname,Email,Gender,DOB,OwnerMember,PurchaseOrderId';

const row = (first: string, po: string, dob = '14/03/1988') =>
  `${first},Runner,${first.toLowerCase()}@example.test,F,${dob},${first} Runner,${po}`;

const csvOf = (...rows: string[]) => `${HEADER}\n${rows.join('\n')}\n`;
const kinds = (r: ReturnType<typeof parseRegistrationCsv>) =>
  new Set(r.findings.map((f) => f.kind));

describe('parseRegistrationCsv for a solo race', () => {
  it('takes one runner per entry as normal, with nothing to say about it', () => {
    const r = parseRegistrationCsv(
      csvOf(row('Ada', 'PO1'), row('Bea', 'PO2'), row('Cara', 'PO3')),
      RACE_DAY_ISO,
      'solo',
    );

    expect(r.teams).toHaveLength(3);
    expect(r.hasBlocking).toBe(false);
    // The whole point: no warning, on any of them.
    expect(kinds(r)).not.toContain('lone-runner');
  });

  it('still warns about a lone runner when the race is a relay', () => {
    const r = parseRegistrationCsv(csvOf(row('Ada', 'PO1')), RACE_DAY_ISO, 'relay');

    expect(kinds(r)).toContain('lone-runner');
    expect(r.hasBlocking).toBe(false);
  });

  /**
   * ⚠️ The other half, and the one that protects the data rather than the preview.
   *
   * Two rows sharing a purchase order is a pair. On a solo race that is not a bigger entry —
   * it is the import being wrong, and building a team from it would put a runner in the race
   * who did not enter it. It blocks, and no team is built.
   */
  it('blocks a two-runner entry, because a solo entry has one runner', () => {
    const r = parseRegistrationCsv(
      csvOf(row('Ada', 'PO1'), row('Bea', 'PO1')),
      RACE_DAY_ISO,
      'solo',
    );

    expect(r.hasBlocking).toBe(true);
    expect(kinds(r)).toContain('multi-row-team');
    expect(r.teams).toHaveLength(0);

    const finding = r.findings.find((f) => f.kind === 'multi-row-team');
    expect(finding?.message).toContain('A solo entry has one runner.');
  });

  it('accepts that same pair when the race is a relay', () => {
    const r = parseRegistrationCsv(
      csvOf(row('Ada', 'PO1'), row('Bea', 'PO1')),
      RACE_DAY_ISO,
      'relay',
    );

    expect(r.hasBlocking).toBe(false);
    expect(r.teams).toHaveLength(1);
    expect(r.teams[0]!.runners).toHaveLength(2);
  });

  it('gives the single runner leg 1, which is the leg a solo bib derives from', () => {
    const r = parseRegistrationCsv(csvOf(row('Ada', 'PO1')), RACE_DAY_ISO, 'solo');

    expect(r.teams[0]!.runners).toHaveLength(1);
    expect(r.teams[0]!.runners[0]!.leg).toBe(1);
  });

  /**
   * The minimisation rule does not change with the race, and this is the assertion that says
   * so on the solo path: the age is computed and the date of birth it was computed from is
   * nowhere in the result.
   */
  it('still computes the age and keeps no date of birth', () => {
    const r = parseRegistrationCsv(
      csvOf(row('Ada', 'PO1', '02/11/1988')),
      RACE_DAY_ISO,
      'solo',
    );

    // Born 2 November 1988; race day 1 November 2026 — the birthday has not happened yet.
    expect(r.teams[0]!.runners[0]!.age_on_day).toBe(37);
    expect(JSON.stringify(r.teams)).not.toContain('1988');
  });
});
