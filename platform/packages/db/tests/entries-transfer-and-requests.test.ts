import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The transfer that reported an outage, and the reason somebody gives for asking.
 *
 * ## What is being proved
 *
 * ⚠️ **The transfer.** `transfer_entry()` set `ea_number = null` unconditionally. On an
 * affiliated entry `assert_entrant_rules()` refused that, so the update raised
 * `check_violation`, PostgREST returned an *error* rather than a refusal envelope, and the admin
 * surface rendered **"That could not be read — the club's database could not be reached"** on a
 * database that was perfectly healthy, doing exactly what it was told. **Every affiliated
 * transfer failed, and it failed as an outage** — nothing to act on, and an on-call reflex that
 * could never help.
 *
 * It was fixed by asking the new runner for a number of their own, refused in words as
 * `ea_number_required`. **That refusal is gone since 29 August 2026**, when the club stopped
 * asking for England Athletics numbers at all: no fee requires one, so the branch cannot fire
 * and an affiliated place transfers like any other. The tests below are what say so — the
 * outage assertion is unchanged, because it is the thing that must never come back.
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
    `insert into entries.fees (event_id, code, label, price_pence, affiliated)
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
    entrants: Record<string, unknown>[] = [person()],
    consents?: Record<string, boolean>,
  ): Promise<string> {
    const purchaseId = await acceptedPurchaseId({
      feeCode,
      entrants,
      medical: entrants.map(() => null),
      ...(consents === undefined ? {} : { consents }),
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

  it('moves an affiliated place with no number anywhere in it', async () => {
    // **The whole of the original defect, and then the whole of its fix.** This transfer used
    // to raise `check_violation` and reach a volunteer as an outage; it was then made to refuse
    // in words with `ea_number_required` unless the new runner supplied a number of their own.
    // The club stopped asking for numbers on 29 August 2026, so it is simply a transfer.
    const purchaseId = await paidPurchase('affiliated');

    const result = await transfer(purchaseId);

    expect(result.ok).toBe(true);

    const [entrant] = await entrantsOf(purchaseId);

    expect(entrant?.first_name).toBe('Nell');
    expect(entrant?.ea_number).toBeNull();
  });

  it('drops a number supplied to the ten-argument form, on either fee', async () => {
    // **The argument survives until the contract step**, so a Worker deployed before the
    // decision goes on calling the same signature. What it may not do is write one — the fee no
    // longer requires it, so the function's own `else` branch nulls it, and
    // `entrants_ea_number_not_collected` is behind that.
    for (const feeCode of ['affiliated', 'unaffiliated']) {
      const purchaseId = await paidPurchase(feeCode, [person()]);

      expect((await transfer(purchaseId, { p_ea_number: '9998887' })).ok).toBe(true);
      expect((await entrantsOf(purchaseId))[0]?.ea_number).toBeNull();
    }
  });

  it('refuses a purchase with a guide on it, rather than guessing who is leaving', async () => {
    // **The `vi` consent is what makes a two-entrant list legal**, and it is a consent rather
    // than a column because it is a statement somebody makes about themselves — see the guide
    // migration. Without it `create_pending_purchase()` refuses the *length* of the list.
    const purchaseId = await paidPurchase('unaffiliated', [person(), guide()], {
      entryTerms: true,
      medical: false,
      vi: true,
    });

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

// =========================================================================================
// Asking twice
// =========================================================================================

/**
 * **The column held one word and somebody can press two buttons.**
 *
 * A runner who asked about a transfer, thought better of it and asked to cancel left a record
 * saying only the second — and read the other way round, a volunteer looking at *"transfer asked
 * for"* had no way to know a cancellation had been asked for afterwards. The two want opposite
 * things: one wants a refund and one deliberately does not, so acting on the wrong one either
 * takes a place off somebody who wanted to hand it to a friend, or hands on a place somebody
 * wanted their money back for.
 *
 * These assert the **history**, not the summary. The summary columns keep working exactly as
 * they did — that is the expand step, and the second test here is what proves it.
 */
describe('a second ask does not erase the first', () => {
  async function ownedPurchase(): Promise<string> {
    const purchaseId = await acceptedPurchaseId({ email: RUNNER_EMAIL });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    return purchaseId;
  }

  interface RequestRow {
    action: string;
    reason: string | null;
    resolved_at: string | null;
  }

  async function historyOf(purchaseId: string): Promise<RequestRow[]> {
    return query<RequestRow>(
      `select action, reason, resolved_at
         from entries.entry_requests
        where purchase_id = $1
        order by requested_at, id`,
      [purchaseId],
    );
  }

  async function ask(purchaseId: string, action: string, reason: string): Promise<void> {
    const { data, error } = await runner.client
      .schema('entries')
      .rpc('request_entry_action', {
        p_purchase_id: purchaseId,
        p_action: action,
        p_reason: reason,
      });

    // **A Postgres error is never a refusal.** Asserted on every call here, for the reason
    // `entries-rules.test.ts` gives: a broken function refuses everything, which reads as every
    // rule holding at once.
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, action });
  }

  it('keeps both asks, in order, with the words used for each', async () => {
    const purchaseId = await ownedPurchase();

    await ask(purchaseId, 'transfer', 'My friend would like my place.');
    await ask(purchaseId, 'cancel', 'Actually I have broken my ankle.');

    expect(await historyOf(purchaseId)).toEqual([
      {
        action: 'transfer',
        reason: 'My friend would like my place.',
        resolved_at: null,
      },
      {
        action: 'cancel',
        reason: 'Actually I have broken my ankle.',
        resolved_at: null,
      },
    ]);
  });

  it('still puts the most recent one on the purchase, so every deployed reader works', async () => {
    // **The expand step, asserted rather than assumed.** `read_entry_list()`'s **Asked about**
    // filter and `/account/entries/`'s summary line are both built on these columns, and a
    // Worker deployed before the history table has nothing else to read.
    const purchaseId = await ownedPurchase();

    await ask(purchaseId, 'transfer', 'My friend would like my place.');
    await ask(purchaseId, 'cancel', 'Actually I have broken my ankle.');

    const row = await single<{
      requested_action: string;
      request_reason: string;
      request_resolved_at: string | null;
    }>(
      `select requested_action, request_reason, request_resolved_at
         from entries.entry_purchases where id = $1`,
      [purchaseId],
    );

    expect(row.requested_action).toBe('cancel');
    expect(row.request_reason).toBe('Actually I have broken my ankle.');
    expect(row.request_resolved_at).toBeNull();
  });

  it('closes every outstanding ask when a volunteer deals with the entry', async () => {
    // **Resolution is a fact about the entry rather than about one ask.** There is no act that
    // answers one and leaves another open, so both close together — and that is what lets
    // `cancel_entry()` and `transfer_entry()` stay exactly as they are.
    const purchaseId = await ownedPurchase();

    await ask(purchaseId, 'transfer', 'My friend would like my place.');
    await ask(purchaseId, 'cancel', 'Actually I have broken my ankle.');

    const { data, error } = await nnAdmin.client.schema('entries').rpc('cancel_entry', {
      p_purchase_id: purchaseId,
      p_refund_reference: null,
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>)?.ok).toBe(true);

    const history = await historyOf(purchaseId);
    expect(history).toHaveLength(2);
    expect(history.every((row) => row.resolved_at !== null)).toBe(true);
  });

  it('a fresh ask after one was dealt with does not re-open the old one', async () => {
    // `request_entry_action()` sets `request_resolved_at` back to null, which is a new ask
    // rather than a resolution. The trigger fires only on the transition *into* resolved, so
    // the row that was dealt with stays dealt with and the new one is outstanding on its own.
    const purchaseId = await ownedPurchase();

    await ask(purchaseId, 'transfer', 'My friend would like my place.');

    await query(
      `update entries.entry_purchases set request_resolved_at = now() where id = $1`,
      [purchaseId],
    );

    await ask(purchaseId, 'cancel', 'Changed my mind.');

    const history = await historyOf(purchaseId);
    expect(history.map((row) => [row.action, row.resolved_at === null])).toEqual([
      ['transfer', false],
      ['cancel', true],
    ]);
  });

  it('records nothing at all for an entry that is not the caller’s', async () => {
    // **The history row is written after the update and only when it matched.** Writing it
    // first would record an ask against an entry the caller may have no claim to, which is
    // exactly the oracle the single `no_such_entry` refusal exists to prevent.
    const someoneElses = await acceptedPurchaseId({ email: 'stranger2@example.com' });

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
    expect(await historyOf(someoneElses)).toEqual([]);
  });

  it('is on the entry list and on the runner’s own page, both times in full', async () => {
    const purchaseId = await ownedPurchase();

    await ask(purchaseId, 'transfer', 'My friend would like my place.');
    await ask(purchaseId, 'cancel', 'Actually I have broken my ankle.');

    const { data: list } = await nnAdmin.client
      .schema('entries')
      .rpc('entry_list', { p_event_slug: EVENT });

    const listed = (
      (list as { entries?: { purchase_id: string; requests?: { action: string }[] }[] })
        .entries ?? []
    ).find((row) => row.purchase_id === purchaseId);

    // Newest first on both, which is the order somebody reading either page wants.
    expect(listed?.requests?.map((request) => request.action)).toEqual([
      'cancel',
      'transfer',
    ]);

    const { data: mine } = await runner.client.schema('entries').rpc('my_entries');

    const own = (
      (mine as { entries?: { purchase_id: string; requests?: { action: string }[] }[] })
        .entries ?? []
    ).find((row) => row.purchase_id === purchaseId);

    expect(own?.requests?.map((request) => request.action)).toEqual([
      'cancel',
      'transfer',
    ]);
  });
});

// =========================================================================================
// One entry, in full
// =========================================================================================

/**
 * `entries.admin_entry_detail()` — ADR-024.
 *
 * **The negative cases are most of this block**, for the reason the whole directory gives: that
 * an anonymous client *cannot* read an entry proves more than that a volunteer can. And two of
 * them are about what the function must **not** return even to somebody who may call it —
 * `entry_purchases.consents` and the medical note itself — because both are absences that
 * nothing else in the system would notice going missing.
 */
describe('reading one entry in full', () => {
  interface Detail {
    ok?: boolean;
    reason?: string;
    purchase?: Record<string, unknown>;
    entrants?: Record<string, unknown>[];
    emails?: Record<string, unknown>[];
    requests?: Record<string, unknown>[];
    audit?: Record<string, unknown>[];
  }

  async function detailAs(
    client: SupabaseClient,
    purchaseId: string,
  ): Promise<{ data: Detail; errorCode: string | undefined }> {
    const { data, error } = await client
      .schema('entries')
      .rpc('admin_entry_detail', { p_purchase_id: purchaseId });

    return { data: (data ?? {}) as Detail, errorCode: error?.code };
  }

  async function paidOwnedPurchase(
    entrants: Record<string, unknown>[] = [person()],
    consents?: Record<string, boolean>,
  ): Promise<string> {
    const purchaseId = await acceptedPurchaseId({
      email: RUNNER_EMAIL,
      entrants,
      medical: entrants.map(() => null),
      ...(consents === undefined ? {} : { consents }),
    });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    return purchaseId;
  }

  it('refuses an anonymous caller, and says so rather than erroring', async () => {
    const purchaseId = await paidOwnedPurchase();

    const { data, errorCode } = await detailAs(anon, purchaseId);

    // **A Postgres error is not a refusal.** A broken function refuses everybody, which reads
    // as the rule holding when it has stopped being tested at all.
    expect(errorCode).toBeUndefined();
    expect(data).toEqual({ ok: false, reason: 'unauthorised' });
  });

  it('refuses somebody signed in who holds no permission', async () => {
    // The case a naive "is this person signed in" check would pass. `runner` holds an account
    // and nothing else, which is what everybody who registers holds.
    const purchaseId = await paidOwnedPurchase();

    const { data, errorCode } = await detailAs(runner.client, purchaseId);

    expect(errorCode).toBeUndefined();
    expect(data).toEqual({ ok: false, reason: 'unauthorised' });
  });

  it('answers no_such_entry for an id nobody has, without saying which it is', async () => {
    const { data } = await detailAs(
      nnAdmin.client,
      '00000000-0000-4000-8000-000000000000',
    );

    expect(data).toEqual({ ok: false, reason: 'no_such_entry' });
  });

  it('gives a volunteer the payment, the address that paid, and the person on it', async () => {
    const purchaseId = await paidOwnedPurchase();

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.ok).toBe(true);
    expect(data.purchase?.purchase_id).toBe(purchaseId);
    expect(data.purchase?.status).toBe('paid');
    expect(data.purchase?.fee_code).toBe('unaffiliated');
    expect(data.purchase?.purchaser_email).toBe(RUNNER_EMAIL);
    expect(data.purchase?.event_slug).toBe(EVENT);
    expect(data.entrants).toHaveLength(1);
    expect(data.entrants?.[0]?.emergency_contact_name).toBe('Mary Somerville');
  });

  it('never returns what was consented to, only which version was in force', async () => {
    // **ADR-022 put the visually impaired declaration in `consents` precisely so that no read
    // would return it**: it is data about disability, held as the lawful basis for a guide's
    // row, and never a fact on a screen. No read has ever returned this column and this test is
    // what stops the next one becoming the first.
    const purchaseId = await paidOwnedPurchase();

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.purchase).not.toHaveProperty('consents');
    expect(data.purchase?.consent_version).toBe('zztransfer-v1');
    expect(JSON.stringify(data)).not.toContain('entryTerms');
  });

  it('says whether there is a medical note and never what it says', async () => {
    // The note keeps its single door — `entries.entrant_medical()` — which writes an audit row
    // every time it opens. A second, unaudited read of Article 9 data is the one thing this
    // page must not become.
    const purchaseId = await acceptedPurchaseId({
      email: RUNNER_EMAIL,
      entrants: [person()],
      medical: ['Asthma — carries an inhaler'],
      consents: { entryTerms: true, medical: true },
    });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.entrants?.[0]?.has_medical).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Asthma');
    expect(JSON.stringify(data)).not.toContain('inhaler');
  });

  it('says whether an account has claimed the entry, and never whose', async () => {
    // A uuid on a page is a fact nobody can act on; "they can see this at /account/entries/" is
    // one they can.
    const purchaseId = await paidOwnedPurchase();

    await query('update entries.entry_purchases set person_id = $1 where id = $2', [
      runner.id,
      purchaseId,
    ]);

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.purchase?.linked_to_account).toBe(true);
    expect(data.purchase).not.toHaveProperty('person_id');
    expect(JSON.stringify(data)).not.toContain(runner.id);
  });

  it('puts the runner before the guide, whatever their names are', async () => {
    // `role` sorts `guide` before `runner` alphabetically, which is the wrong way round on a
    // page whose subject is the runner.
    // **The `vi` consent is what makes a two-entrant list legal** — see the guide migration.
    // Without it `create_pending_purchase()` refuses the length of the list.
    const purchaseId = await paidOwnedPurchase(
      [person({ first_name: 'Zoe' }), guide({ first_name: 'Aaron' })],
      { entryTerms: true, medical: false, vi: true },
    );

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.entrants?.map((entrant) => entrant.role)).toEqual(['runner', 'guide']);
  });

  it('carries every ask that was made about it', async () => {
    const purchaseId = await paidOwnedPurchase();

    await runner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: purchaseId,
      p_action: 'transfer',
      p_reason: 'My friend would like my place.',
    });
    await runner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: purchaseId,
      p_action: 'cancel',
      p_reason: 'Actually I have broken my ankle.',
    });

    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.requests?.map((request) => request.action)).toEqual([
      'cancel',
      'transfer',
    ]);
  });

  it('shows what has been done to this entry, and nothing done to any other', async () => {
    // **The audit trail comes onto the surface here and this is the line it is held to.** It is
    // the history of a record rather than a log of what a volunteer has been doing, so a row
    // naming a different purchase must not appear on this one.
    const mine = await paidOwnedPurchase();
    const theirs = await paidOwnedPurchase();

    await nnAdmin.client.schema('entries').rpc('cancel_entry', {
      p_purchase_id: theirs,
      p_refund_reference: null,
    });

    const before = await detailAs(nnAdmin.client, mine);
    expect(before.data.audit).toEqual([]);

    await nnAdmin.client.schema('entries').rpc('cancel_entry', {
      p_purchase_id: mine,
      p_refund_reference: null,
    });

    const after = await detailAs(nnAdmin.client, mine);
    expect(after.data.audit?.map((row) => row.action)).toEqual(['cancel_entry']);
    // The actor is `auth.uid()` and stays a pseudonym — ADR-013's amendment, which ADR-024
    // deliberately does not reopen.
    expect(after.data.audit?.[0]?.actor).toBe(nnAdmin.id);
  });

  it('carries the emails the club owes about this entry', async () => {
    const purchaseId = await paidOwnedPurchase();

    // The confirmation is written by a trigger on the move into `paid`, so a purchase forced
    // straight to `paid` by a fixture has one exactly as a real one does.
    const { data } = await detailAs(nnAdmin.client, purchaseId);

    expect(data.emails?.map((message) => message.template)).toContain('entry_confirmed');
    expect(data.emails?.[0]?.recipient).toBe(RUNNER_EMAIL);
  });
});
