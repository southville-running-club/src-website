import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

/**
 * `entries.entry_purchases.entry_no` — the readable half of the reference a runner quotes.
 *
 * ## What is worth testing here, and what is not
 *
 * The **string** is `packages/shared/tests/unit/entry-reference.test.ts`'s: no SQL renders a
 * reference to text, deliberately, because the date in one is the London day and this
 * repository has exactly one path timezone conversion may take.
 *
 * What this file tests is the number itself, and the three properties a reference depends on:
 *
 *   1. **Every insert gets one**, whichever function did the inserting. The trigger exists
 *      rather than a line in `create_pending_purchase()` precisely so that a third writer
 *      cannot quietly leave a null.
 *   2. **It is unique within an event and it does not restart.** A reference that names two
 *      entries is worse than the long one it replaced.
 *   3. **It is never re-issued and never moves.** A number already emailed to somebody is not
 *      the database's to change, so a later insert may not take a released one back.
 *
 * ## Two events, on purpose
 *
 * The counter is per event. A test with one event cannot tell a per-event counter from a
 * global one, and the two only diverge on the day the club runs a second race — which is the
 * day nobody is looking at this.
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

const EVENTS = ['zzref-one', 'zzref-two'] as const;

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

type Created = { ok: true; purchase_id: string };

/** One valid entry, by the ordinary anon path, on the event named. */
async function enter(slug: string): Promise<string> {
  serial += 1;

  const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
    p_key: ENTRY_KEY,
    p_slug: slug,
    p_fee_code: 'unaffiliated',
    p_purchaser_name: 'Ada Referenced',
    p_purchaser_email: `zzref-${serial}@example.com`,
    p_entrants: [
      {
        // **A serial on the surname and on the address**, because one runner one place and one
        // place per address are both database rules now: a suite whose runners are all the same
        // person cannot hold two places.
        first_name: 'Ada',
        last_name: `Referenced-${serial}`,
        date_of_birth: '1990-01-01',
        gender: 'female',
        emergency_contact_name: 'Margaret Hamilton',
        emergency_contact_phone: '07700 900000',
        phone: '07700 900001',
        role: 'runner',
      },
    ],
    p_medical: [null],
    p_consents: { entryTerms: true, medical: false },
  });

  if (error) throw error;

  const result = data as Created | { ok: false; reason: string };
  expect(result.ok, `entry refused: ${JSON.stringify(result)}`).toBe(true);

  return (result as Created).purchase_id;
}

async function entryNumber(purchaseId: string): Promise<number | null> {
  const row = await single<{ entry_no: number | null }>(
    'select entry_no from entries.entry_purchases where id = $1',
    [purchaseId],
  );

  return row.entry_no;
}

async function removeFixtures(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [EVENTS],
  );
  await query('delete from entries.events where slug = any($1::text[])', [EVENTS]);
}

beforeAll(async () => {
  await connected;
  await installEntryKey(db);
  await removeFixtures();

  for (const slug of EVENTS) {
    const event = await single<{ id: string }>(
      `insert into entries.events (
         slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
         entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
         consent_version, active, required_consents
       ) values (
         $1, 'zzref', 'Reference fixture', date '2027-06-01', time '11:00', 1, 5000,
         now() - interval '1 hour', now() + interval '1 hour', 18, true,
         'reference@example.com', 'zzref-v1', true, array['entryTerms']::text[]
       ) returning id`,
      [slug],
    );

    await query(
      `insert into entries.fees (event_id, code, label, price_pence, affiliated)
       values ($1, 'unaffiliated', 'Unaffiliated', 2000, false),
              ($1, 'complimentary', 'Complimentary', 0, false)`,
      [event.id],
    );
  }
});

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

describe('every purchase is given a number', () => {
  it('numbers the ordinary entry path from one, in order', async () => {
    const first = await enter(EVENTS[0]);
    const second = await enter(EVENTS[0]);

    expect(await entryNumber(first)).toBe(1);
    expect(await entryNumber(second)).toBe(2);
  });

  it('counts per event rather than across the database', async () => {
    // **The property that only shows up on the day there are two races.** A global counter
    // passes every test above and gives Pass the Buck's first entry the number after
    // Nightingale Nightmare's last.
    const other = await enter(EVENTS[1]);

    expect(await entryNumber(other)).toBe(1);
  });

  it('numbers a place given from /admin/nn/ too, because the trigger is on the table', async () => {
    // **The reason this is a trigger and not a line in `create_pending_purchase()`.** A
    // complimentary place is inserted `paid` by a different function — the two Kinsi places and
    // every visually impaired guide's place go through it — and a runner given one is owed a
    // reference exactly as much as a runner who paid for one.
    const event = await single<{ id: string }>(
      'select id from entries.events where slug = $1',
      [EVENTS[0]],
    );

    const before = await single<{ highest: number }>(
      `select coalesce(max(entry_no), 0) as highest
         from entries.entry_purchases where event_id = $1`,
      [event.id],
    );

    const given = await single<{ id: string }>(
      `insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, paid_at
       ) values (
         $1, 'paid', 0,
         (select id from entries.fees where event_id = $1 and code = 'complimentary'),
         'zzref-given@example.com', 'Given Place',
         '{"entryTerms": true}'::jsonb, 'zzref-v1', now()
       ) returning id`,
      [event.id],
    );

    expect(await entryNumber(given.id)).toBe(Number(before.highest) + 1);
  });

  it('refuses a second purchase claiming a number already issued on that event', async () => {
    // **The index is the guarantee, not the trigger.** The trigger computes the number under
    // the advisory lock the entry path already holds; this is what makes a duplicate impossible
    // even from a path that forgets to take it. Asserted by setting the number explicitly,
    // which is the one thing the trigger stands aside for.
    const event = await single<{ id: string }>(
      'select id from entries.events where slug = $1',
      [EVENTS[0]],
    );

    await expect(
      query(
        `insert into entries.entry_purchases (
           event_id, entry_no, status, amount_pence, fee_id, purchaser_email, purchaser_name,
           consents, consent_version
         ) values (
           $1, 1, 'pending', 2000,
           (select id from entries.fees where event_id = $1 and code = 'unaffiliated'),
           'zzref-clash@example.com', 'Clashing Place',
           '{"entryTerms": true}'::jsonb, 'zzref-v1'
         )`,
        [event.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('does not re-issue a number after the purchase holding it is deleted', async () => {
    // ⚠️ **A reference already emailed to somebody may never come to mean a different entry.**
    // `max() + 1` gives this for free and `count(*) + 1` would not — which is the whole reason
    // the trigger is written the way it is. Nothing deletes a purchase today; a restore, a
    // fixture teardown, or a future data-request erasure all can.
    const doomed = await enter(EVENTS[1]);
    const doomedNumber = await entryNumber(doomed);

    await query('delete from entries.entry_purchases where id = $1', [doomed]);

    const next = await enter(EVENTS[1]);

    expect(await entryNumber(next)).toBe((doomedNumber ?? 0) + 1);
  });
});
