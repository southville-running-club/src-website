import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { medicalRetentionWording } from '@src/shared';

/**
 * Deleting the medical notes on time, and the assertion that stops the club publishing one
 * period and enforcing another.
 *
 * `/nn/privacy/` says a medical note is *"deleted — separately from, and sooner than, the rest
 * of your entry"*, and section 6 puts a period on it. Until this slice **nothing did that**.
 *
 * Every fixture here is an invented event with a fixed date, and every one of them is removed
 * afterwards. The real `nn-2026` row is never given a note and never moved: it is in the future,
 * so the sweep would ignore it anyway, and depending on that would be depending on the calendar.
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

/**
 * Three fabricated runnings, and the dates are what each one is for.
 *
 *   `long-past`  a race well over its retention period. Its note must go.
 *   `just-past`  a race one day inside its retention period. Its note must stay — the notice
 *                says "one month after the race", and somebody reading that on the last day
 *                expects the note to still exist.
 *   `future`     a race that has not happened. Nothing about it is deletable.
 */
const EVENTS = {
  longPast: { slug: 'zz-retention-long-past', date: '2020-11-01' },
  justPast: { slug: 'zz-retention-just-past', date: null as string | null },
  future: { slug: 'zz-retention-future', date: '2099-11-01' },
};

const RACE = 'zz-retention';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/** One event with one paid entry, one entrant and one medical note. */
async function seedEvent(slug: string, eventDate: string): Promise<string> {
  await query(
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, capacity,
       from_address, consent_version
     ) values ($1, 'Retention fixture', $2, $3::date, time '11:00', 250,
               'fixture@example.com', 'zz-v1')
     on conflict (slug) do nothing`,
    [slug, RACE, eventDate],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     select id, 'unaffiliated', 'Unaffiliated', 1700 from entries.events where slug = $1
     on conflict (event_id, code) do nothing`,
    [slug],
  );

  const entrant = await query<{ id: string }>(
    `with purchase as (
       insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, paid_at
       )
       select e.id, 'paid', 1700, f.id, 'retention@example.com', 'Retention Fixture',
              '{"entryTerms":true,"medical":true}'::jsonb, 'zz-v1', now()
         from entries.events e
         join entries.fees f on f.event_id = e.id and f.code = 'unaffiliated'
        where e.slug = $1
       returning id
     )
     insert into entries.entrants (
       purchase_id, first_name, last_name, date_of_birth, gender,
       emergency_contact_name, emergency_contact_phone
     )
     select purchase.id, 'Retention', 'Fixture', date '1986-03-07', 'female',
            'Next Of Kin', '0117 496 0000'
       from purchase
     returning id`,
    [slug],
  );

  const entrantId = entrant[0]!.id;

  await query(
    `insert into entries.entrant_medical (entrant_id, notes)
     values ($1::uuid, 'Fabricated note for ' || $2)`,
    [entrantId, slug],
  );

  return entrantId;
}

async function noteCount(slug: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*) from entries.entrant_medical m
       join entries.entrants en on en.id = m.entrant_id
       join entries.entry_purchases p on p.id = en.purchase_id
       join entries.events e on e.id = p.event_id
      where e.slug = $1`,
    [slug],
  );

  return Number(rows[0]?.count ?? 0);
}

async function entrantCount(slug: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*) from entries.entrants en
       join entries.entry_purchases p on p.id = en.purchase_id
       join entries.events e on e.id = p.event_id
      where e.slug = $1`,
    [slug],
  );

  return Number(rows[0]?.count ?? 0);
}

/** The function, called the way the cron calls it — through the anon key and nothing else. */
async function sweep(): Promise<{ deleted: number; events: number }> {
  const { data, error } = await anon
    .schema('entries')
    .rpc('delete_expired_medical_notes');
  expect(error).toBeNull();
  return data as { deleted: number; events: number };
}

beforeAll(async () => {
  await connected;

  // **Exactly one day inside the retention period, computed from the column rather than from
  // a constant here.** A hard-coded "one month ago plus a day" would be a second copy of the
  // rule, and this test's whole subject is the two copies that already exist.
  const boundary = await query<{ event_date: string }>(
    `select ((now() at time zone 'Europe/London')::date - interval '1 month' + interval '1 day')::date::text as event_date`,
  );
  EVENTS.justPast.date = boundary[0]!.event_date;

  await seedEvent(EVENTS.longPast.slug, EVENTS.longPast.date);
  await seedEvent(EVENTS.justPast.slug, EVENTS.justPast.date);
  await seedEvent(EVENTS.future.slug, EVENTS.future.date);
});

afterAll(async () => {
  await connected;
  const slugs = Object.values(EVENTS).map((event) => event.slug);
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [slugs],
  );
  await query('delete from entries.events where slug = any($1::text[])', [slugs]);
  await db.end();
});

// -----------------------------------------------------------------------------------------
// The promise, and the words
// -----------------------------------------------------------------------------------------

describe('the published wording and the enforced period cannot drift apart', () => {
  // **This is the assertion the brief asked for, and it is the only thing tying the two
  // together.** `race.json`'s `privacy.medicalRetention` is what `/nn/privacy/` renders;
  // `entries.events.medical_retention` is what the deletion applies. Changing either one alone
  // turns this red, and changing both together is one commit a reviewer can see the whole of.
  //
  // Read off disk rather than imported, so the assertion does not depend on
  // `resolveJsonModule` reaching across a package boundary — and so the file it checks is the
  // file that ships.
  const racePath = fileURLToPath(
    new URL('../../../apps/main/src/content/race.json', import.meta.url),
  );
  const race = JSON.parse(readFileSync(racePath, 'utf8')) as {
    privacy: { medicalRetention: string | null };
  };

  it('says in the notice exactly what the database enforces', async () => {
    const rows = await query<{ medical_retention: unknown }>(
      "select medical_retention::text as medical_retention from entries.events where slug = 'nn-2026'",
    );

    const enforced = String(rows[0]?.medical_retention);
    const wording = medicalRetentionWording(enforced);

    // A period this module cannot describe in one clause is one the notice cannot honestly
    // describe either, and a red test is the right place to find that out.
    expect(wording, `no wording for the interval "${enforced}"`).not.toBeNull();
    expect(race.privacy.medicalRetention).toBe(wording);
  });

  it('is one month today, which is what the notice says', async () => {
    // Pinned as a literal as well, so a change that moved *both* the column and the JSON still
    // arrives as a diff on this line rather than passing quietly.
    const rows = await query<{ medical_retention: unknown }>(
      "select medical_retention::text as medical_retention from entries.events where slug = 'nn-2026'",
    );

    expect(String(rows[0]?.medical_retention)).toBe('1 mon');
    expect(race.privacy.medicalRetention).toBe('One month after the race');
  });

  it('refuses a retention period of nothing', async () => {
    // Zero would delete a note the moment the race finished, which no version of the notice
    // says. Negative would delete it before.
    await expect(
      query(
        `insert into entries.events (
           slug, display_name, race_slug, event_date, start_time, capacity,
           from_address, consent_version, medical_retention
         ) values ('zz-retention-zero', 'Zero', 'zz-retention', date '2026-11-01',
                   time '11:00', 250, 'f@example.com', 'v1', interval '0')`,
      ),
    ).rejects.toThrow(/events_medical_retention_positive/);
  });
});

// -----------------------------------------------------------------------------------------
// What the job deletes
// -----------------------------------------------------------------------------------------

describe('entries.delete_expired_medical_notes()', () => {
  it('deletes the note for a race well past its retention period', async () => {
    expect(await noteCount(EVENTS.longPast.slug)).toBe(1);

    const result = await sweep();

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await noteCount(EVENTS.longPast.slug)).toBe(0);
  });

  it('leaves the note for a race one day inside the period', async () => {
    // **The boundary, and it is the one a person would check.** "One month after the race" for
    // a race on 1 November means the note is still there on 1 December.
    expect(await noteCount(EVENTS.justPast.slug)).toBe(1);
  });

  it('leaves a race that has not happened alone', async () => {
    expect(await noteCount(EVENTS.future.slug)).toBe(1);
  });

  it('leaves the entrant, the purchase and the consent intact', async () => {
    // **Only the notes go.** The entry is kept under its own retention period, and the record
    // that somebody consented outlives the data the consent permitted — it is the evidence the
    // club was allowed to hold it at all.
    expect(await entrantCount(EVENTS.longPast.slug)).toBe(1);

    const purchase = await query<{ status: string; consents: { medical: boolean } }>(
      `select p.status, p.consents from entries.entry_purchases p
         join entries.events e on e.id = p.event_id
        where e.slug = $1`,
      [EVENTS.longPast.slug],
    );

    expect(purchase[0]?.status).toBe('paid');
    expect(purchase[0]?.consents.medical).toBe(true);
  });

  it('is safe to run twice, and the second run deletes nothing', async () => {
    // It is called every five minutes forever and deletes something on a handful of days a
    // year. A second run finding nothing is the ordinary case, not the exception.
    const second = await sweep();

    const fromOurEvents = await noteCount(EVENTS.longPast.slug);

    expect(fromOurEvents).toBe(0);
    // Scoped to what this file seeded: another file may have seeded its own past event, and an
    // unscoped `expect(second.deleted).toBe(0)` is exactly the cross-file race the brief warns
    // about. What is asserted is that ours stay gone and the count is a number.
    expect(second.deleted).toBeGreaterThanOrEqual(0);
    expect(await noteCount(EVENTS.justPast.slug)).toBe(1);
    expect(await noteCount(EVENTS.future.slug)).toBe(1);
  });

  it('honours a per-event period rather than a constant', async () => {
    // **The period is a column, so a race with a different one behaves differently.** Shortened
    // to a day, the boundary fixture falls outside its own retention period and its note goes —
    // which is what proves the function reads the column rather than a hard-coded month.
    await query(
      "update entries.events set medical_retention = interval '1 day' where slug = $1",
      [EVENTS.justPast.slug],
    );

    const result = await sweep();

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await noteCount(EVENTS.justPast.slug)).toBe(0);
    expect(await noteCount(EVENTS.future.slug)).toBe(1);
  });

  it('returns a count and nothing about anybody', async () => {
    const result = await sweep();

    expect(Object.keys(result).sort()).toEqual(['deleted', 'events']);
  });
});
