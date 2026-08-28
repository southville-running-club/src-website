import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Assigning a complimentary place — the one function here that gives something away.
 *
 * `entries-tester.test.ts`'s method, applied to ADR-021. Every rule is attempted from each of
 * the three shapes a caller can take:
 *
 *   * an **anonymous** client, which is what a script with the published anon key is;
 *   * a **signed-in client holding nothing**, which is what everybody who registers is;
 *   * a **signed-in client holding `nn-admin`**, which is the only one that should get in.
 *
 * ## Why the anonymous case is the one that matters
 *
 * This function writes a `paid` purchase without a payment. If it were reachable with the
 * published anon key, anybody who read the page source could give themselves a free place in
 * a race that sold out in 2023. `entries.test.ts` asserts the grant list; this asserts the
 * behaviour behind it, because a grant that was never made and a function that does not check
 * are two different mistakes and only one of them is visible in a privilege table.
 *
 * ## A Postgres error is never a refusal
 *
 * Each test asserts the **specific** reason string, never merely that something failed.
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

const EVENT = 'zzgive-open';
const TINY = 'zzgive-tiny';
const INACTIVE = 'zzgive-inactive';
const NO_FEE = 'zzgive-nofee';
const FIXTURE_SLUGS = [EVENT, TINY, INACTIVE, NO_FEE] as const;

const EVENT_DATE = '2027-06-01';

const GIVER_EMAIL = 'zzgive-giver@example.com';
const PLAIN_EMAIL = 'zzgive-plain@example.com';
const FIXTURE_EMAILS = [GIVER_EMAIL, PLAIN_EMAIL] as const;

const PASSWORD = 'correct-horse-battery-staple-021';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

let giver: SupabaseClient;
let plain: SupabaseClient;
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

async function fixturePerson(
  email: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  const [row] = await query<{ id: string }>(
    `update auth.users set email_confirmed_at = now() where email = $1 returning id`,
    [email],
  );
  if (!row) throw new Error(`signUp did not create auth.users row for ${email}`);

  const signIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signIn.error) throw signIn.error;

  return { id: row.id, client };
}

interface Person {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  role: string;
}

function person(role: 'runner' | 'guide', overrides: Partial<Person> = {}): Person {
  serial += 1;
  return {
    first_name: role === 'guide' ? 'Grace' : 'Ada',
    last_name: `Given-${serial}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    emergency_contact_name: 'Margaret Hamilton',
    emergency_contact_phone: '07700 900000',
    role,
    ...overrides,
  };
}

type Refusal = { ok: false; reason: string };
type Given = { ok: true; purchase_id: string; entrants: number };

async function give(
  client: SupabaseClient,
  entrants: Person[],
  options: { slug?: string; consents?: Record<string, boolean> } = {},
): Promise<Refusal | Given> {
  serial += 1;

  const { data, error } = await client.schema('entries').rpc('create_manual_entry', {
    p_slug: options.slug ?? EVENT,
    p_purchaser_name: 'Ada Given',
    p_purchaser_email: `zzgive-${serial}@example.com`,
    p_entrants: entrants,
    p_medical: entrants.map(() => null),
    p_consents: options.consents ?? {
      entryTerms: true,
      medical: false,
      vi: entrants.length > 1,
    },
    p_reason: 'Kinsi partnership place',
  });

  if (error) throw error;
  return data as Refusal | Given;
}

async function makeEvent(
  slug: string,
  options: { capacity?: number; active?: boolean; withFee?: boolean } = {},
): Promise<string> {
  const { capacity = 5000, active = true, withFee = true } = options;

  const event = await single<{ id: string }>(
    `insert into entries.events (
       slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
       consent_version, active, required_consents
     ) values (
       $1, 'zzgive', $2, $3::date, time '11:00', 1, $4,
       null, null, 18, true,
       'give@example.com', 'zzgive-v1', $5, array['entryTerms']::text[]
     ) returning id`,
    [slug, `Give fixture ${slug}`, EVENT_DATE, capacity, active],
  );

  if (withFee) {
    await query(
      `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number, requires_permission)
       values ($1, 'complimentary', 'Complimentary', 0, false, 'nn.entry.create'),
              ($1, 'unaffiliated', 'Unaffiliated', 2000, false, null)`,
      [event.id],
    );
  }

  return event.id;
}

async function removeFixtures(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [[...FIXTURE_SLUGS]],
  );
  await query('delete from entries.events where slug = any($1::text[])', [
    [...FIXTURE_SLUGS],
  ]);
  await query('delete from auth.users where email = any($1::text[])', [
    [...FIXTURE_EMAILS],
  ]);
}

beforeAll(async () => {
  await connected;
  await removeFixtures();

  await makeEvent(EVENT);
  await makeEvent(TINY, { capacity: 1 });
  await makeEvent(INACTIVE, { active: false });
  await makeEvent(NO_FEE, { withFee: false });

  const giverPerson = await fixturePerson(GIVER_EMAIL);
  const plainPerson = await fixturePerson(PLAIN_EMAIL);

  await query(
    `insert into identity.role_grants (person_id, role, granted_by)
     values ($1, 'nn-admin', null) on conflict do nothing`,
    [giverPerson.id],
  );

  giver = giverPerson.client;
  plain = plainPerson.client;
});

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

describe('who may give a place away', () => {
  it('refuses an anonymous caller outright', async () => {
    // **The grant is the first lock and this is the second.** `entries.test.ts` asserts that
    // `anon` was never granted this; if that grant were ever made by accident, the function
    // still refuses, because `auth.uid()` is null and `has_permission()` joins nothing.
    const { data, error } = await anon.schema('entries').rpc('create_manual_entry', {
      p_slug: EVENT,
      p_purchaser_name: 'Nobody At All',
      p_purchaser_email: 'zzgive-anon@example.com',
      p_entrants: [person('runner')],
      p_medical: [null],
      p_consents: { entryTerms: true },
    });

    // Either the grant refuses it before it runs, or the function refuses it once it does.
    // Both are correct; what must never happen is a purchase.
    if (error === null) {
      expect(data).toEqual({ ok: false, reason: 'unauthorised' });
    } else {
      expect(error.code).toBe('42501');
    }

    expect(
      await query(
        `select 1 from entries.entry_purchases
          where purchaser_email = 'zzgive-anon@example.com'`,
      ),
    ).toEqual([]);
  });

  it('refuses somebody signed in who holds nothing', async () => {
    expect(await give(plain, [person('runner')])).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });

  it('lets somebody holding nn.entry.create give one', async () => {
    const result = (await give(giver, [person('runner')])) as Given;

    expect(result.ok).toBe(true);
    expect(result.entrants).toBe(1);
  });
});

describe('what a given place actually is', () => {
  it('is paid, at nothing, on the complimentary fee, with no Stripe reference', async () => {
    const result = (await give(giver, [person('runner')])) as Given;

    const row = await single<{
      status: string;
      amount_pence: number;
      paid_at: string | null;
      hold_expires_at: string | null;
      stripe_checkout_session_id: string | null;
      person_id: string | null;
      fee_code: string;
    }>(
      `select p.status, p.amount_pence, p.paid_at, p.hold_expires_at,
              p.stripe_checkout_session_id, p.person_id, f.code as fee_code
         from entries.entry_purchases p
         join entries.fees f on f.id = p.fee_id
        where p.id = $1`,
      [result.purchase_id],
    );

    // **`paid`, and deliberately not a fifth status.** The capacity predicate counts
    // `status = 'paid'`, so a value it did not know about would make a given place invisible
    // to the count and let the same place be sold to somebody else. See ADR-021.
    expect(row.status).toBe('paid');
    expect(row.amount_pence).toBe(0);
    expect(row.fee_code).toBe('complimentary');
    expect(row.paid_at).not.toBeNull();
    expect(row.hold_expires_at).toBeNull();
    expect(row.stripe_checkout_session_id).toBeNull();
    // **Null, and not the volunteer's.** `person_id` says whose entry this is, and it is the
    // runner's — who very likely has no account. Writing the giver's id would file the club's
    // gift under the giver's own name.
    expect(row.person_id).toBeNull();
  });

  it('records that a volunteer ticked the consents rather than the runner', async () => {
    // **The property that keeps the record honest.** Without the marker, the row asserts that
    // this person clicked something they never saw.
    const result = (await give(giver, [person('runner')])) as Given;

    const row = await single<{ consents: Record<string, unknown> }>(
      'select consents from entries.entry_purchases where id = $1',
      [result.purchase_id],
    );

    expect(row.consents).toMatchObject({ entryTerms: true, recorded_by_admin: true });
  });

  it('writes the audit row, with the reason', async () => {
    const before = await single<{ n: number }>(
      `select count(*)::int as n from entries.admin_audit where action = 'create_manual_entry'`,
    );

    expect(((await give(giver, [person('runner')])) as Given).ok).toBe(true);

    const after = await single<{ n: number }>(
      `select count(*)::int as n from entries.admin_audit where action = 'create_manual_entry'`,
    );

    expect(after.n).toBe(before.n + 1);

    const latest = await single<{ detail: Record<string, unknown> }>(
      `select detail from entries.admin_audit
        where action = 'create_manual_entry'
        order by at desc limit 1`,
    );

    expect(latest.detail).toMatchObject({ reason: 'Kinsi partnership place' });
  });

  it('carries a guide, and both people take a place', async () => {
    const result = (await give(giver, [person('runner'), person('guide')])) as Given;

    expect(result.entrants).toBe(2);

    const rows = await query<{ role: string }>(
      `select role from entries.entrants where purchase_id = $1 order by role`,
      [result.purchase_id],
    );

    expect(rows.map((row) => row.role)).toEqual(['guide', 'runner']);
  });
});

describe('every rule about a bought place is a rule about a given one', () => {
  it('will not oversell the course', async () => {
    // **The one that matters most.** The 250 is a number of bodies on a road at night, and a
    // place the club gave is a body like any other. A given place that oversold would be a
    // real person turned round on the day.
    expect(((await give(giver, [person('runner')], { slug: TINY })) as Given).ok).toBe(
      true,
    );

    expect(await give(giver, [person('runner')], { slug: TINY })).toEqual({
      ok: false,
      reason: 'sold_out',
    });
  });

  it('applies the minimum age', async () => {
    expect(
      await give(giver, [person('runner', { date_of_birth: '2015-01-01' })]),
    ).toEqual({ ok: false, reason: 'under_minimum_age' });
  });

  it('applies one runner, one place', async () => {
    const twice = { first_name: 'Joan', last_name: 'Clarke-Given' };

    expect(((await give(giver, [person('runner', twice)])) as Given).ok).toBe(true);

    expect(await give(giver, [person('runner', twice)])).toEqual({
      ok: false,
      reason: 'already_entered',
    });
  });

  it('refuses without the consents the event requires', async () => {
    expect(
      await give(giver, [person('runner')], { consents: { medical: false } }),
    ).toEqual({ ok: false, reason: 'consents_missing' });
  });

  it('refuses a withdrawn running', async () => {
    // The entry *window* deliberately does not apply — a complimentary place is not a purchase
    // and both fixtures here have a null `entries_open_at`, which is what every test above
    // has been relying on. `active` is the thing that still holds.
    expect(await give(giver, [person('runner')], { slug: INACTIVE })).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('says so plainly when the running has no complimentary fee', async () => {
    // Never the volunteer's fault: it means the fee row is missing from this running, which is
    // a deployment state rather than a bad submission, and the reason reads as one.
    expect(await give(giver, [person('runner')], { slug: NO_FEE })).toEqual({
      ok: false,
      reason: 'no_complimentary_fee',
    });
  });
});
