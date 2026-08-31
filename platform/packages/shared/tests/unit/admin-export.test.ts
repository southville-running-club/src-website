import { describe, expect, it } from 'vitest';
import { fetchExport, type AdminResult } from '../../src/admin';

/**
 * What the three exports are allowed to come back as.
 *
 * ## Why this file exists
 *
 * **`entries.read_export()` decides the row shape and this parser decides whether it is
 * accepted, and until 31 August 2026 the two disagreed about one column.** A guide's
 * `entrants.gender` has been null since `20260828220000_entries_guide_email_no_category.sql`
 * — a guide is in no prize category and asking them which one they would be in was collecting
 * an answer nothing could use — and `entrants_gender_unless_guide` allows exactly that one
 * exception. The start-list parser was not updated with it.
 *
 * The cost was the whole document rather than one row: `z.array(...).safeParse()` is
 * all-or-nothing, so **one guide in the field took down both the printed start list and the
 * CSV**, for every runner on it, with a 503 saying *"the club's database could not be
 * reached"* — false in both halves, on a perfectly healthy database, on the morning somebody
 * needs the sheet at the registration desk.
 *
 * ## Why it is tested here and not at the database layer
 *
 * `packages/db/tests/entries-admin.test.ts` already asserts the exact key set
 * `read_export()` returns for each kind, and it was green throughout: the database was right.
 * Nothing exercised the **parse**, which is the half that refused. So these are rows shaped
 * the way the database actually shapes them, put through the real reader.
 */

/** A stub of the two calls `fetchExport` makes, so the shape under test is the only variable. */
function clientReturning(payload: unknown): Parameters<typeof fetchExport>[0] {
  return {
    schema: () => ({
      rpc: () => Promise.resolve({ data: payload, error: null }),
    }),
  } as unknown as Parameters<typeof fetchExport>[0];
}

const EVENT = {
  slug: 'nn-2026',
  display_name: 'Nightingale Nightmare 2026',
  event_date: '2026-11-01',
};

/** A runner, exactly as `read_export()`'s start-list branch builds one. */
const RUNNER = {
  last_name: 'Okonjo',
  first_name: 'Grace',
  club: 'Southville Running Club',
  age: 41,
  gender: 'female',
  result_placement: null,
  role: 'runner',
  emergency_contact_name: 'Sam Okonjo',
  emergency_contact_phone: '0117 496 0001',
  phone: '07700 900123',
};

/**
 * A guide, likewise — **and the three nulls are the point of it.**
 *
 * A guide is asked no race category (`entrants_gender_unless_guide`), is in no result
 * placement, and is not asked for a phone number of their own — they give an email address
 * and an emergency contact instead. See ADR-022 and ADR-025.
 */
const GUIDE = {
  last_name: 'Bhatt',
  first_name: 'Ravi',
  club: null,
  age: 38,
  gender: null,
  result_placement: null,
  role: 'guide',
  emergency_contact_name: 'Priya Bhatt',
  emergency_contact_phone: '0117 496 0002',
  phone: null,
};

async function takeStartList(
  rows: unknown[],
): Promise<AdminResult<{ export: { kind: string; rows: unknown[] } }>> {
  return fetchExport(
    clientReturning({ ok: true, kind: 'start-list', event: EVENT, rows }),
    'nn-2026',
    'start-list',
  ) as Promise<AdminResult<{ export: { kind: string; rows: unknown[] } }>>;
}

describe('the start-list export', () => {
  it('accepts a field of runners', async () => {
    const taken = await takeStartList([RUNNER]);

    expect(taken.status).toBe('ok');
  });

  /**
   * **The regression, and it is asserted on the whole document rather than on the guide.**
   * The failure mode was never "the guide's row is wrong" — it was that the sheet did not
   * render at all, so the assertion that matters is that the runner beside them is still on
   * it.
   */
  it('accepts a guide, whose race category is null because they are asked none', async () => {
    const taken = await takeStartList([RUNNER, GUIDE]);

    expect(taken.status).toBe('ok');

    if (taken.status !== 'ok') return;

    expect(taken.export.rows).toHaveLength(2);
    expect(taken.export.rows[1]).toMatchObject({
      lastName: 'Bhatt',
      gender: null,
      role: 'guide',
      phone: null,
    });
  });

  /**
   * **The negative case, so the nullability above is not read as "anything goes".** A value
   * outside the three the column allows is a database this parser does not understand, and
   * refusing the sheet is the right answer to that — it is only *absence*, which the schema
   * permits for exactly one kind of person, that must not refuse it.
   */
  it('refuses a race category that is not one of the three', async () => {
    const taken = await takeStartList([{ ...RUNNER, gender: 'unspecified' }]);

    expect(taken.status).toBe('unavailable');
  });
});
