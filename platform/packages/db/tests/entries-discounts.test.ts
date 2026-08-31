import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

/**
 * Discount codes: which fee one is for, what a preview costs, and when a use comes back.
 *
 * `entries-rules.test.ts`'s method, applied to the three things the discount slice added. The
 * method is the point rather than the coverage: every test here asks the database directly,
 * with **no Worker and no Zod in the way**, because the form's checks are the form's control
 * and these are the system's.
 *
 * ## A Postgres error is never a refusal
 *
 * A broken function refuses everything, which reads as every rule holding at once. So each
 * test asserts the **specific** reason string, never merely that something failed.
 *
 * ## What the fixtures are
 *
 * One fabricated running of `zzdisc`, never of `nn`, so nothing here can change what the
 * site's front door resolves to or touch the seeded `nn-2026` row. Capacity is far above
 * anything this file enters, because a fixture that runs out answers `sold_out` to every later
 * probe — which reads as a refusal for the reason being tested and is not one.
 *
 * **Every entrant carries a serial on the surname.** `create_pending_purchase()` refuses a
 * runner who already holds a live place, keyed on name and date of birth, so a suite whose
 * runners are all the same person cannot hold two places.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVENT = 'zzdisc-open';
const EVENT_DATE = '2027-06-01';

/** Scoped to the unaffiliated fee, which is the 2026 Left Handed Giant code's actual shape. */
const SCOPED = 'ZZDISC-SCOPED';
/** Null `fee_id`, which is what "any fee" looks like. */
const ANY_FEE = 'ZZDISC-ANYFEE';
/** Two uses, so exhausting it is one line rather than twenty-two. */
const CAPPED = 'ZZDISC-CAPPED';
/** Withdrawn. */
const WITHDRAWN = 'ZZDISC-WITHDRAWN';

const UNAFFILIATED_PENCE = 2000;
const AFFILIATED_PENCE = 1800;

let serial = 0;

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

async function single<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const rows = await query<T>(sql, values);
  expect(rows, 'expected exactly one row back').toHaveLength(1);
  return rows[0] as T;
}

/** One runner, distinct from every other this file makes. */
function entrant(): Record<string, unknown> {
  serial += 1;
  return {
    first_name: 'Ada',
    last_name: `Discount-${serial}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    emergency_contact_name: 'Grace Hopper',
    emergency_contact_phone: '07700 900000',
    // The runner's own number, which `create_pending_purchase()` has required of a
    // runner since ADR-025 and refuses with `phone_required` without. Deliberately not
    // the emergency contact's: a fixture where the two agree cannot catch the two being
    // read the wrong way round.
    phone: '07700 900001',
    role: 'runner',
  };
}

type Refusal = { ok: false; reason: string };
type Created = { ok: true; purchase_id: string; amount_pence: number };
type Priced = {
  ok: true;
  preview: true;
  amount_pence: number;
  list_price_pence: number;
  discount_applied: boolean;
};

async function enter(
  feeCode: string,
  code: string | null,
  options: { preview?: boolean } = {},
): Promise<Refusal | Created | Priced> {
  const person = entrant();

  const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
    p_key: ENTRY_KEY,
    p_slug: EVENT,
    p_fee_code: feeCode,
    p_purchaser_name: 'Ada Discount',
    p_purchaser_email: `zzdisc-${serial}@example.com`,
    p_entrants: [person],
    p_medical: [null],
    p_consents: { entryTerms: true, medical: false, vi: false },
    ...(code === null ? {} : { p_discount_code: code }),
    ...(options.preview === true ? { p_preview: true } : {}),
  });

  if (error) throw error;
  return data as Refusal | Created | Priced;
}

async function usesOf(code: string): Promise<number> {
  const row = await single<{ uses: number }>(
    'select uses from entries.discount_codes where code = $1',
    [code],
  );
  return row.uses;
}

async function removeFixtures(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = $1)`,
    [EVENT],
  );
  await query('delete from entries.events where slug = $1', [EVENT]);
}

beforeAll(async () => {
  await connected;
  // **Holding a place takes the entry key since ADR-029**, and the digest ships null —
  // which refuses everything. Installing it is what makes this file's fixtures able to
  // hold a place at all; without it every call below answers `unauthorised`. Issue #178.
  await installEntryKey(db);
  await removeFixtures();

  const event = await single<{ id: string }>(
    `insert into entries.events (
       slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
       consent_version, active, required_consents
     ) values (
       $1, 'zzdisc', 'Discount fixture', $2::date, time '11:00', 1, 5000,
       now() - interval '1 hour', now() + interval '1 hour', 18, true,
       'disc@example.com', 'zzdisc-v1', true, array['entryTerms']::text[]
     ) returning id`,
    [EVENT, EVENT_DATE],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, affiliated)
     values ($1, 'unaffiliated', 'Unaffiliated', $2, false),
            ($1, 'affiliated', 'Affiliated', $3, true)`,
    [event.id, UNAFFILIATED_PENCE, AFFILIATED_PENCE],
  );

  const unaffiliated = await single<{ id: string }>(
    `select id from entries.fees where event_id = $1 and code = 'unaffiliated'`,
    [event.id],
  );

  await query(
    `insert into entries.discount_codes (event_id, code, percent_off, max_uses, fee_id, active)
     values ($1, $2, 10, null, $6, true),
            ($1, $3, 10, null, null, true),
            ($1, $4, 50, 2,    null, true),
            ($1, $5, 10, null, null, false)`,
    [event.id, SCOPED, ANY_FEE, CAPPED, WITHDRAWN, unaffiliated.id],
  );
});

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

describe('a code scoped to a fee applies to that fee and no other', () => {
  it('takes 10% off the fee it names', async () => {
    const result = (await enter('unaffiliated', SCOPED)) as Created;

    expect(result.ok).toBe(true);
    // 10% of £20.00 is exactly £2.00 and the rounding never fires. **That £2 is the ARC
    // Unattached Runner Levy**, which the club still has to remit — so a discounted entry
    // nets £16 rather than £18. The arithmetic is the same either way; the note is here
    // because the number is not visible from the row.
    expect(result.amount_pence).toBe(1800);
  });

  it('refuses the same code against a fee it is not for', async () => {
    // **The rule that did not exist before this slice.** `percent_off` said ten and nothing
    // said *unaffiliated*, so the 2023 code would have taken 10% off the £18 affiliated entry
    // as happily as off the £20 one.
    expect(await enter('affiliated', SCOPED)).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });
  });

  it('lets an unscoped code apply to either', async () => {
    // Null `fee_id` keeps the old meaning, so a code that is genuinely for any fee says so by
    // omission rather than by a column nobody set.
    const off = (await enter('affiliated', ANY_FEE)) as Created;

    expect(off.ok).toBe(true);
    expect(off.amount_pence).toBe(1620);
  });
});

describe('the four refusals a code can produce are one answer', () => {
  it('refuses a code that does not exist', async () => {
    expect(await enter('unaffiliated', 'ZZDISC-NO-SUCH-CODE')).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });
  });

  it('refuses a withdrawn code', async () => {
    expect(await enter('unaffiliated', WITHDRAWN)).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });
  });

  it('refuses one whose places are gone, and only once they are', async () => {
    expect(((await enter('unaffiliated', CAPPED)) as Created).ok).toBe(true);
    expect(((await enter('unaffiliated', CAPPED)) as Created).ok).toBe(true);

    // Two uses, two entries, and the third meets the cap.
    expect(await enter('unaffiliated', CAPPED)).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });
  });

  it('matches case-insensitively and ignores surrounding space', async () => {
    // Somebody typing a code off a newsletter should not have to match its case, and a code
    // pasted from an email arrives with whitespace on it.
    const result = (await enter(
      'unaffiliated',
      `  ${SCOPED.toLowerCase()}  `,
    )) as Created;

    expect(result.ok).toBe(true);
    expect(result.amount_pence).toBe(1800);
  });
});

describe('a preview prices the entry and changes nothing', () => {
  it('returns what would be charged, and what it would have been', async () => {
    const result = (await enter('unaffiliated', SCOPED, { preview: true })) as Priced;

    expect(result).toMatchObject({
      ok: true,
      preview: true,
      amount_pence: 1800,
      list_price_pence: 2000,
      discount_applied: true,
    });
  });

  it('holds no place and spends no use', async () => {
    // **The property the whole two-step depends on.** If a preview held a place, somebody who
    // read the total and closed the tab would have taken one of the 250 for 31 minutes and a
    // use out of 22 — which is worse than the confirmation step is worth.
    const before = await usesOf(ANY_FEE);
    const purchasesBefore = await query(
      `select 1 from entries.entry_purchases
        where event_id = (select id from entries.events where slug = $1)`,
      [EVENT],
    );

    await enter('unaffiliated', ANY_FEE, { preview: true });

    expect(await usesOf(ANY_FEE)).toBe(before);
    expect(
      await query(
        `select 1 from entries.entry_purchases
          where event_id = (select id from entries.events where slug = $1)`,
        [EVENT],
      ),
    ).toHaveLength(purchasesBefore.length);
  });

  it('refuses a bad code exactly as the real call does', async () => {
    // **Which is what makes it safe to show a total and then charge it.** A preview that
    // accepted something the real call would refuse would send somebody to a payment page for
    // an entry that cannot be made.
    expect(
      await enter('unaffiliated', 'ZZDISC-STILL-NOT-A-CODE', { preview: true }),
    ).toEqual({ ok: false, reason: 'invalid_discount' });
  });

  it('previews an entry with no code at all', async () => {
    const result = (await enter('unaffiliated', null, { preview: true })) as Priced;

    expect(result).toMatchObject({
      amount_pence: 2000,
      list_price_pence: 2000,
      discount_applied: false,
    });
  });
});

describe('a use goes back when the place does', () => {
  it('is spent when the place is held', async () => {
    const before = await usesOf(ANY_FEE);
    expect(((await enter('unaffiliated', ANY_FEE)) as Created).ok).toBe(true);
    expect(await usesOf(ANY_FEE)).toBe(before + 1);
  });

  it('comes back when the hold lapses', async () => {
    // **The defect this closes.** `uses` only ever incremented, so twenty-two people opening
    // Stripe and closing the tab would have exhausted a twenty-two-place allocation with
    // nobody entered — and the only remedy was a volunteer editing a counter by hand in the
    // middle of a live entry window.
    const held = (await enter('unaffiliated', ANY_FEE)) as Created;
    const spent = await usesOf(ANY_FEE);

    // Reach back in time rather than waiting 31 minutes. The cron's predicate is
    // `hold_expires_at < now()`, so this is the state a lapsed hold is actually in.
    await query(
      `update entries.entry_purchases
          set hold_expires_at = now() - interval '1 minute'
        where id = $1`,
      [held.purchase_id],
    );

    const { error } = await anon.schema('entries').rpc('expire_pending_holds');
    expect(error).toBeNull();

    expect(await usesOf(ANY_FEE)).toBe(spent - 1);
    expect(
      (
        await single<{ status: string }>(
          'select status from entries.entry_purchases where id = $1',
          [held.purchase_id],
        )
      ).status,
    ).toBe('expired');
  });

  it('does not go below zero, however many times the sweep runs', async () => {
    // `discount_codes_within_max_uses` polices the ceiling and nothing polices the floor. The
    // guard costs one word and removes the need to have reasoned correctly about whether a
    // purchase can expire twice.
    const { error } = await anon.schema('entries').rpc('expire_pending_holds');
    expect(error).toBeNull();

    const rows = await query<{ uses: number }>(
      'select uses from entries.discount_codes where uses < 0',
    );
    expect(rows).toEqual([]);
  });
});
