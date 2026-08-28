import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The transfer that reported an outage, and the reason somebody gives for asking.
 *
 * ## What is being proved
 *
 * ⚠️ **The transfer.** `transfer_entry()` sets `ea_number = null` unconditionally. On an
 * affiliated entry `assert_entrant_rules()` refuses that, so the update raises
 * `check_violation`, PostgREST returns an *error* rather than a refusal envelope, and the admin
 * surface renders **"That could not be read — the club's database could not be reached"** on a
 * database that is perfectly healthy, doing exactly what it was told. **Every affiliated
 * transfer fails, and it fails as an outage** — nothing to act on, and an on-call reflex that
 * can never help.
 *
 * **The reason.** `request_entry_action()` has recorded which of two words somebody asked for
 * and never why. "I have broken my ankle" and "my friend wants my place" are the same word on
 * the page and two different afternoons.
 *
 * Every test here is written the way `entries-rules.test.ts` insists on: **a Postgres error is
 * never a refusal**, so each asserts the specific reason and fails loudly on an error code — a
 * broken function refuses everything, which reads as every rule holding at once.
 *
 * **The guide itself is not tested here.** `entries-guides.test.ts` covers it; this file only
 * borrows a guided purchase to prove that a transfer refuses one rather than guessing which of
 * the two people is leaving.
 *
 * ## Fixtures
 *
 * Its own fabricated event, never a running of `nn`, removed in `afterAll` — the rule the rest
 * of this directory follows, and for the reason it gives: Vitest runs files at the same time and
 * an unscoped fixture is how an intermittent gets written.
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

/** Fabricated. Never a running of `nn`. */
const EVENT = 'zztransfer-open';
/** Its own event with a small capacity, so "a guide takes a place" can be proved by filling it. */
const TINY = 'zztransfer-tiny';
const SLUGS = [EVENT, TINY] as const;

const EVENT_DATE = '2027-06-01';

const NN_ADMIN_EMAIL = 'zz-transfer-admin@example.com';
const RUNNER_EMAIL = 'zz-transfer-runner@example.com';
const PEOPLE_EMAILS = [NN_ADMIN_EMAIL, RUNNER_EMAIL];
const PERSON_PASSWORD = 'zz-transfer-test-password-long-enough';

/** Cloudflare's published dummy response token — see `entries-admin.test.ts`. */
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

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

async function makeEvent(slug: string, capacity: number): Promise<string> {
  const event = await single<{ id: string }>(
    `insert into entries.events (
       slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
       consent_version, active, required_consents
     ) values (
       $1, 'zztransfer', $2, $3::date, time '11:00', 1, $4,
       now() - interval '1 hour', now() + interval '1 hour', 18, true,
       'transfers@example.com', 'zztransfer-v1', true, array['entryTerms']::text[]
     ) returning id`,
    [slug, `Transfer fixture ${slug}`, EVENT_DATE, capacity],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
     values ($1, 'affiliated', 'Affiliated', 1800, true),
            ($1, 'unaffiliated', 'Unaffiliated', 2000, false)`,
    [event.id],
  );

  return event.id;
}

async function removeFixtures(): Promise<void> {
  // Purchases first: `entry_purchases.event_id` has no cascade, deliberately.
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [[...SLUGS]],
  );
  await query('delete from entries.events where slug = any($1::text[])', [[...SLUGS]]);
}

/**
 * Signs a fixture person up through the real endpoint, confirms them the way a mailbox click
 * would, applies any roles, and hands back a client signed in as them. Copied in shape from
 * `entries-admin.test.ts`, which explains why the grants go in through the privileged
 * connection rather than through `identity.grant_role()`.
 */
async function fixturePerson(
  email: string,
  roles: string[],
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PERSON_PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  const [row] = await query<{ id: string }>(
    `update auth.users set email_confirmed_at = now() where email = $1 returning id`,
    [email],
  );
  if (!row) throw new Error(`signUp did not create auth.users row for ${email}`);

  if (roles.length > 0) {
    await query(
      `insert into identity.role_grants (person_id, role)
       select $1::uuid, unnest($2::text[])`,
      [row.id, roles],
    );
  }

  const signIn = await client.auth.signInWithPassword({
    email,
    password: PERSON_PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signIn.error) throw signIn.error;

  return { id: row.id, client };
}

let nnAdmin: { id: string; client: SupabaseClient };
let runner: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  await removeFixtures();
  await query('delete from auth.users where email = any($1::text[])', [PEOPLE_EMAILS]);

  await makeEvent(EVENT, 5000);
  await makeEvent(TINY, 2);

  nnAdmin = await fixturePerson(NN_ADMIN_EMAIL, ['nn-admin']);
  runner = await fixturePerson(RUNNER_EMAIL, []);
}, 30_000);

afterAll(async () => {
  await connected;
  await removeFixtures();
  await query('delete from entries.admin_audit where actor = any($1::text[])', [
    [nnAdmin?.id, runner?.id].filter(Boolean),
  ]);
  await query('delete from auth.users where email = any($1::text[])', [PEOPLE_EMAILS]);
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Calling the entry path the way a script with the published key would
// -----------------------------------------------------------------------------------------

/**
 * A distinct runner per call, because **one entry per runner is a database rule**. The counter
 * goes on the surname rather than on the date of birth, for the reason
 * `entries-rules.test.ts` gives: several assertions here read an age.
 */
let serial = 0;

function person(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  serial += 1;

  return {
    first_name: 'Ada',
    last_name: `O'Brien-${serial}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    club: null,
    ea_number: null,
    emergency_contact_name: 'Mary Somerville',
    emergency_contact_phone: '07700 900123',
    leg: null,
    role: 'runner',
    ...overrides,
  };
}

function guide(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return person({ first_name: 'Kit', role: 'guide', ...overrides });
}

interface CreateOptions {
  slug?: string;
  feeCode?: string;
  email?: string;
  entrants?: Record<string, unknown>[];
  medical?: (string | null)[];
  consents?: unknown;
}

async function create(
  options: CreateOptions = {},
): Promise<{ data: Record<string, unknown> | null; errorCode: string | undefined }> {
  const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
    p_slug: options.slug ?? EVENT,
    p_fee_code: options.feeCode ?? 'unaffiliated',
    p_purchaser_name: 'Ada O’Brien',
    p_purchaser_email: options.email ?? 'ada@example.com',
    p_entrants: options.entrants ?? [person()],
    p_medical: options.medical ?? [null],
    p_consents:
      options.consents === undefined
        ? { entryTerms: true, medical: false }
        : options.consents,
  });

  return { data: data as Record<string, unknown> | null, errorCode: error?.code };
}

async function acceptedPurchaseId(options: CreateOptions = {}): Promise<string> {
  const { data, errorCode } = await create(options);
  expect(errorCode).toBeUndefined();
  expect(data?.ok, `expected acceptance, got ${JSON.stringify(data)}`).toBe(true);
  return data?.purchase_id as string;
}

interface EntrantRow {
  first_name: string;
  role: string;
  ea_number: string | null;
}

async function entrantsOf(purchaseId: string): Promise<EntrantRow[]> {
  return query<EntrantRow>(
    `select first_name, role, ea_number
       from entries.entrants
      where purchase_id = $1
      order by role, first_name`,
    [purchaseId],
  );
}

// =========================================================================================
// The guide
// =========================================================================================

describe('transferring an affiliated place', () => {
  /** A paid purchase on the named fee, with one entrant, owned by nobody in particular. */
  async function paidPurchase(
    feeCode: string,
    entrants: Record<string, unknown>[] = [person({ ea_number: '1234567' })],
  ): Promise<string> {
    const purchaseId = await acceptedPurchaseId({
      feeCode,
      entrants,
      medical: entrants.map(() => null),
    });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    return purchaseId;
  }

  async function transfer(
    purchaseId: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    serial += 1;

    const { data, error } = await nnAdmin.client.schema('entries').rpc('transfer_entry', {
      p_purchase_id: purchaseId,
      p_email: `new-runner-${serial}@example.com`,
      p_first_name: 'Nell',
      p_last_name: `Gwyn-${serial}`,
      p_date_of_birth: '1991-02-02',
      p_gender: 'female',
      p_club: '',
      p_emergency_contact_name: 'Kin Three',
      p_emergency_contact_phone: '0117 496 0003',
      p_ea_number: '',
      ...args,
    });

    // ⚠️ **The assertion the original defect would have failed on.** It raised
    // `check_violation`, which arrives here as an error rather than as an envelope — and the
    // admin surface could only render that as "the database could not be reached".
    expect(error, `transfer_entry errored: ${JSON.stringify(error)}`).toBeNull();
    return data as Record<string, unknown>;
  }

  it('refuses in words when no England Athletics number is given', async () => {
    const purchaseId = await paidPurchase('affiliated');

    expect(await transfer(purchaseId)).toEqual({
      ok: false,
      reason: 'ea_number_required',
    });
  });

  it('moves the place when one is, and it is the new runner’s own', async () => {
    const purchaseId = await paidPurchase('affiliated');

    const result = await transfer(purchaseId, { p_ea_number: '9998887' });

    expect(result.ok).toBe(true);

    const [entrant] = await entrantsOf(purchaseId);

    expect(entrant?.first_name).toBe('Nell');
    expect(entrant?.ea_number).toBe('9998887');
  });

  it('ignores a number on a fee that does not take one', async () => {
    // The volunteer filling the form in cannot be expected to know which fee the purchase was
    // on, so a number supplied against an unaffiliated place is dropped rather than refused.
    const purchaseId = await paidPurchase('unaffiliated', [person()]);

    expect((await transfer(purchaseId, { p_ea_number: '9998887' })).ok).toBe(true);
    expect((await entrantsOf(purchaseId))[0]?.ea_number).toBeNull();
  });

  it('refuses a purchase with a guide on it, rather than guessing who is leaving', async () => {
    const purchaseId = await paidPurchase('unaffiliated', [person(), guide()]);

    expect(await transfer(purchaseId, { p_ea_number: '' })).toEqual({
      ok: false,
      reason: 'not_a_solo_entry',
    });
  });

  it('still refuses anybody without nn.entry.cancel', async () => {
    const purchaseId = await paidPurchase('unaffiliated', [person()]);

    const { data, error } = await runner.client.schema('entries').rpc('transfer_entry', {
      p_purchase_id: purchaseId,
      p_email: 'nope@example.com',
      p_first_name: 'Nope',
      p_last_name: 'Nope',
      p_date_of_birth: '1991-02-02',
      p_gender: 'female',
      p_club: '',
      p_emergency_contact_name: 'Kin',
      p_emergency_contact_phone: '0117 496 0004',
      p_ea_number: '',
    });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'unauthorised' });
  });
});

// =========================================================================================
// The reason somebody gives for asking
// =========================================================================================

describe('asking the club to cancel or transfer, and saying why', () => {
  /** A paid purchase owned by the signed-in runner, matched on their confirmed address. */
  async function ownedPurchase(): Promise<string> {
    const purchaseId = await acceptedPurchaseId({ email: RUNNER_EMAIL });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    return purchaseId;
  }

  async function reasonOn(purchaseId: string): Promise<string | null> {
    const row = await single<{ request_reason: string | null }>(
      'select request_reason from entries.entry_purchases where id = $1',
      [purchaseId],
    );

    return row.request_reason;
  }

  it('records the words somebody used, not only the button they pressed', async () => {
    const purchaseId = await ownedPurchase();

    const { data, error } = await runner.client
      .schema('entries')
      .rpc('request_entry_action', {
        p_purchase_id: purchaseId,
        p_action: 'cancel',
        p_reason: 'I broke my ankle on Tuesday.',
      });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, action: 'cancel' });
    expect(await reasonOn(purchaseId)).toBe('I broke my ankle on Tuesday.');
  });

  it('treats an empty box as "did not say" rather than as an empty answer', async () => {
    const purchaseId = await ownedPurchase();

    await runner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: purchaseId,
      p_action: 'transfer',
      p_reason: '   ',
    });

    expect(await reasonOn(purchaseId)).toBeNull();
  });

  it('refuses one that is too long rather than cutting it off mid-word', async () => {
    // A sentence that stops halfway reads to a volunteer as a database fault, and they cannot
    // tell what was lost.
    const purchaseId = await ownedPurchase();

    const { data } = await runner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: purchaseId,
      p_action: 'cancel',
      p_reason: 'x'.repeat(501),
    });

    expect(data).toEqual({ ok: false, reason: 'reason_too_long' });
    expect(await reasonOn(purchaseId)).toBeNull();
  });

  it('still works for a caller that has never heard of the reason', async () => {
    // **The expand step.** A Worker deployed before this migration calls two arguments and
    // must go on working, recording exactly what it knows: no reason.
    const purchaseId = await ownedPurchase();

    const { data, error } = await runner.client
      .schema('entries')
      .rpc('request_entry_action', {
        p_purchase_id: purchaseId,
        p_action: 'cancel',
      });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, action: 'cancel' });
    expect(await reasonOn(purchaseId)).toBeNull();
  });

  it('is still not an oracle for somebody else’s entry', async () => {
    // "Not yours", "not there" and "not paid" are one answer. A purchase id is printed on a
    // confirmation page; it is not a credential, and adding a reason does not make it one.
    const someoneElses = await acceptedPurchaseId({ email: 'stranger@example.com' });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [someoneElses],
    );

    const { data } = await runner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: someoneElses,
      p_action: 'cancel',
      p_reason: 'let me in',
    });

    expect(data).toEqual({ ok: false, reason: 'no_such_entry' });
    expect(await reasonOn(someoneElses)).toBeNull();
  });
});
