import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

/**
 * A guide rides on the runner's entry, and takes one of the places.
 *
 * `entries-rules.test.ts`'s method applied to ADR-022: every test asks the database directly,
 * as an **anonymous** client, which is the shape a script with the published anon key takes.
 * The form's checks are the form's control; these are the system's.
 *
 * ## The permissive direction is the expensive one here
 *
 * Everything this file tests is a rule about **how many people one payment may put on a road
 * that holds 250**. Getting it wrong in the refusing direction turns away a visually impaired
 * runner, which is bad; getting it wrong in the permitting direction puts somebody on the
 * course whom nothing counted, which is worse and is invisible until race morning. So the
 * bypasses are attempted rather than the happy path merely asserted.
 *
 * ## A Postgres error is never a refusal
 *
 * A broken function refuses everything, which reads as every rule holding at once. Each test
 * asserts the **specific** reason string.
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

const EVENT = 'zzguide-open';
const EVENT_DATE = '2027-06-01';

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

interface Person {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  /**
   * The runner's own number — required of a runner since ADR-025, and **null for a guide**,
   * who is not asked for one. That asymmetry is the thing worth having in a fixture here: a
   * guide with a number would pass whether or not the function tells the two roles apart.
   */
  phone: string | null;
  role: string;
  /**
   * **Not a field anybody is asked for — a value posted at the function anyway.**
   *
   * The club stopped asking for England Athletics numbers on 29 August 2026 and
   * `entrants_ea_number_not_collected` refuses one in the column, so this exists only so a
   * test can send one and prove it goes nowhere. `create_pending_purchase()` is granted to
   * `anon` and reachable through PostgREST with the published key, so "the form no longer has
   * the box" is not an answer on its own.
   */
  ea_number?: string;
}

/** One person, distinct from every other this file makes unless told otherwise. */
function person(role: 'runner' | 'guide', overrides: Partial<Person> = {}): Person {
  serial += 1;
  return {
    first_name: role === 'guide' ? 'Grace' : 'Ada',
    last_name: `Guided-${serial}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    emergency_contact_name: 'Margaret Hamilton',
    emergency_contact_phone: '07700 900000',
    // **Required of a runner and null for a guide** — ADR-025, and the function refuses a
    // runner without one with `phone_required`. Deliberately not the emergency contact's
    // number: a fixture where the two agree cannot catch the two being read the wrong way
    // round.
    phone: role === 'guide' ? null : '07700 900001',
    role,
    ...overrides,
  };
}

type Refusal = { ok: false; reason: string };
type Created = { ok: true; purchase_id: string; amount_pence: number };

async function enter(
  entrants: Person[],
  consents: Record<string, boolean>,
  feeCode = 'unaffiliated',
): Promise<Refusal | Created> {
  serial += 1;

  const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
    p_key: ENTRY_KEY,
    p_slug: EVENT,
    p_fee_code: feeCode,
    p_purchaser_name: 'Ada Guided',
    p_purchaser_email: `zzguide-${serial}@example.com`,
    p_entrants: entrants,
    p_medical: entrants.map(() => null),
    p_consents: { entryTerms: true, medical: false, ...consents },
  });

  if (error) throw error;
  return data as Refusal | Created;
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
       $1, 'zzguide', 'Guide fixture', $2::date, time '11:00', 1, 5000,
       now() - interval '1 hour', now() + interval '1 hour', 18, true,
       'guide@example.com', 'zzguide-v1', true, array['entryTerms']::text[]
     ) returning id`,
    [EVENT, EVENT_DATE],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, affiliated)
     values ($1, 'unaffiliated', 'Unaffiliated', 2000, false),
            ($1, 'affiliated', 'Affiliated', 1800, true)`,
    [event.id],
  );
});

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

describe('a guide is a second entrant on one purchase', () => {
  it('is accepted, stored with role = guide, and charged nothing extra', async () => {
    const result = (await enter([person('runner'), person('guide')], {
      vi: true,
    })) as Created;

    expect(result.ok).toBe(true);
    // **One fee for the entry, not one per person.** The guide adds nobody to the bill.
    expect(result.amount_pence).toBe(2000);

    const rows = await query<{ role: string }>(
      `select role from entries.entrants
        where purchase_id = $1 order by role`,
      [result.purchase_id],
    );

    expect(rows.map((row) => row.role)).toEqual(['guide', 'runner']);
  });

  it('takes two of the places rather than one', async () => {
    // **The whole reason nothing is reserved.** The capacity count counts entrant rows, so a
    // guided entry consumes two of the 250 at the moment it is made — which is what the club
    // needed, and is why holding four places back would have answered a different question.
    const before = await single<{ taken: number }>(
      `select count(*)::int as taken
         from entries.entry_purchases p
         join entries.entrants e on e.purchase_id = p.id
        where p.event_id = (select id from entries.events where slug = $1)`,
      [EVENT],
    );

    expect(
      ((await enter([person('runner'), person('guide')], { vi: true })) as Created).ok,
    ).toBe(true);

    const after = await single<{ taken: number }>(
      `select count(*)::int as taken
         from entries.entry_purchases p
         join entries.entrants e on e.purchase_id = p.id
        where p.event_id = (select id from entries.events where slug = $1)`,
      [EVENT],
    );

    expect(after.taken - before.taken).toBe(2);
  });
});

describe('the shape of the entrant list is refused rather than corrected', () => {
  it('refuses a second entrant when the vi consent was not given', async () => {
    // **Otherwise the declaration would be decoration.** Anybody posting straight at PostgREST
    // could put a second person on any entry and get two places for one fee.
    expect(await enter([person('runner'), person('guide')], { vi: false })).toEqual({
      ok: false,
      reason: 'invalid_entrants',
    });
  });

  it('refuses the vi consent with nobody to guide', async () => {
    expect(await enter([person('runner')], { vi: true })).toEqual({
      ok: false,
      reason: 'invalid_entrants',
    });
  });

  it('refuses a payload whose roles and positions disagree', async () => {
    // **Position decides the role and the payload only gets to agree with it.** Trusting the
    // key would let a submission mark its *runner* as the guide, which is a place with no fee
    // attached to anybody.
    expect(await enter([person('guide'), person('runner')], { vi: true })).toEqual({
      ok: false,
      reason: 'invalid_entrants',
    });
  });

  it('refuses a third person however the consents are set', async () => {
    expect(
      await enter([person('runner'), person('guide'), person('guide')], { vi: true }),
    ).toEqual({ ok: false, reason: 'invalid_entrants' });
  });
});

describe('every rule about a runner is a rule about their guide', () => {
  it('refuses a guide under the minimum age', async () => {
    // Somebody guiding a runner is on the same course for the same distance in the same dark,
    // and the committee set 18 for the course rather than for the transaction.
    expect(
      await enter([person('runner'), person('guide', { date_of_birth: '2015-01-01' })], {
        vi: true,
      }),
    ).toEqual({ ok: false, reason: 'under_minimum_age' });
  });

  it('refuses a guide who already holds a place of their own', async () => {
    const solo = person('runner', { first_name: 'Katherine', last_name: 'Twice' });
    expect(((await enter([solo], {})) as Created).ok).toBe(true);

    expect(
      await enter(
        [
          person('runner'),
          person('guide', { first_name: 'Katherine', last_name: 'Twice' }),
        ],
        { vi: true },
      ),
    ).toEqual({ ok: false, reason: 'already_entered' });
  });

  it('refuses somebody entering as their own guide', async () => {
    // **The rule the committed-rows check cannot catch.** Both halves are written in the same
    // transaction, so when the database checks the guide, the runner it was handed a moment
    // earlier is not in any table yet — and one person would have taken two of the 250.
    const twin = {
      first_name: 'Ada',
      last_name: 'Selfguided',
      date_of_birth: '1990-01-01',
    };

    expect(
      await enter(
        [person('runner', twin), person('guide', { ...twin, first_name: ' ADA ' })],
        { vi: true },
      ),
    ).toEqual({ ok: false, reason: 'already_entered' });
  });

  it('stores no England Athletics number for anybody on the entry, posted or not', async () => {
    // **This asserted the guide's number was null and the runner's was kept.** Since 29 August
    // 2026 the club asks nobody for one, so both are null and the interesting half is the
    // runner's: `create_pending_purchase()` is granted to `anon`, so a number posted straight
    // at PostgREST with the published key is the only route a number could still take. It is
    // dropped by the fee normalisation and refused by `entrants_ea_number_not_collected`
    // behind it.
    //
    // **On the affiliated fee**, because that is the one that used to require it — and the
    // entry going through at all is the other half of what changed: requiring a number from a
    // guide once made the affiliated price the one a visually impaired runner could not use.
    const result = (await enter(
      [person('runner', { ea_number: '1234567' }), person('guide')],
      { vi: true },
      'affiliated',
    )) as Created;

    expect(result.ok).toBe(true);

    const rows = await query<{ role: string; ea_number: string | null }>(
      `select role, ea_number from entries.entrants
        where purchase_id = $1 order by role`,
      [result.purchase_id],
    );

    expect(rows.map((row) => row.ea_number)).toEqual([null, null]);
  });
});
