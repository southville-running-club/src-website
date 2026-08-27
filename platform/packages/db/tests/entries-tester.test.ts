import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The `nn-tester` role, the permission-gated fee, the entry that belongs to somebody, and
 * cancelling one — each tested by **attempting the bypass**.
 *
 * This file is `entries-rules.test.ts`'s method applied to the four things #107 added, and the
 * method is the point rather than the coverage. Slice E found `create_pending_purchase()`
 * writing `ea_number` without consulting `fees.requires_ea_number`; Slice G found eight more
 * rules that lived in Zod and nowhere else. **The new surface here is larger than either**: a
 * function `anon` may call now behaves differently depending on who is asking, and getting
 * that wrong in the permissive direction is a free entry for anybody who reads the page
 * source.
 *
 * So every test below asks the database directly, with no Worker and no Zod in the way:
 *
 *   * an **anonymous** client, which is the shape a script with the published anon key takes;
 *   * a **signed-in client holding nothing**, which is what everybody who registers is;
 *   * a **signed-in client holding `nn-tester`**, which is the only one that should get in.
 *
 * ## A Postgres error is never a refusal
 *
 * `entries-rules.test.ts` says why and it holds here: a broken function refuses everything,
 * which reads as every rule holding at once. So each test asserts the **specific** reason
 * string or error code, and never merely that something failed.
 *
 * ## Fixtures
 *
 * Three fabricated runnings, and **none of them is a running of `nn`** — so nothing here can
 * change what the site's front door resolves to, and nothing here touches the seeded
 * `nn-2026` row or the real £1 tester fee on it.
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

/** Before the window opens — `entries_open_at` null, which is `nn-2026`'s real state today. */
const PRE_OPEN = 'zztester-pre-open';
/** Open to everybody, for the fee-gating tests, where the window is not what is being tested. */
const OPEN = 'zztester-open';
/** Shut. A tester may enter early; they may not enter a race that has finished. */
const CLOSED = 'zztester-closed';
/** Withdrawn. `active` is absolute, whatever anybody holds. */
const INACTIVE = 'zztester-inactive';

const FIXTURE_SLUGS = [PRE_OPEN, OPEN, CLOSED, INACTIVE] as const;

const EVENT_DATE = '2027-06-01';

/** The permission the tester role carries, and the one the gated fee asks for. */
const EARLY = 'nn.entry.before_open';

const TESTER_EMAIL = 'zztester-tester@example.com';
const PLAIN_EMAIL = 'zztester-plain@example.com';
const CANCELLER_EMAIL = 'zztester-canceller@example.com';
/** Never signs in. Exists so the email-match half of `my_entries()` has something to match. */
const CLAIMANT_EMAIL = 'zztester-claimant@example.com';

const FIXTURE_EMAILS = [
  TESTER_EMAIL,
  PLAIN_EMAIL,
  CANCELLER_EMAIL,
  CLAIMANT_EMAIL,
] as const;

const PASSWORD = 'correct-horse-battery-staple-107';
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

/**
 * Signs a fixture person up through the real endpoint and confirms the address the way a
 * mailbox click would — the same helper `identity.test.ts` uses, and for the same reason:
 * going through `signUp()` exercises `identity.handle_new_user()`, so the person ends up with
 * the row and the default grant a real account has rather than one this file invented.
 */
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

/** A role, granted the way the migration seeds one rather than through `grant_role()` — this
 *  file is not testing the grant path, and going through it would need a super-admin first. */
async function grant(personId: string, role: string): Promise<void> {
  await query(
    `insert into identity.role_grants (person_id, role, granted_by)
     values ($1, $2, null)
     on conflict do nothing`,
    [personId, role],
  );
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

/**
 * One fabricated running, with an ordinary fee and a gated one.
 *
 * The capacity is far above anything this file enters, for `entries-rules.test.ts`'s reason: a
 * fixture that runs out of places answers `sold_out` to every later probe, which reads as a
 * refusal for the reason being tested and is not one. The one exception is the one-place event
 * the last cancellation test builds inline, where running out is the whole question.
 */
async function makeEvent(
  slug: string,
  options: {
    opensAt?: string;
    closesAt?: string;
    active?: boolean;
    capacity?: number;
  } = {},
): Promise<string> {
  const {
    opensAt = 'null',
    closesAt = "now() + interval '1 hour'",
    active = true,
    capacity = 5000,
  } = options;

  const event = await single<{ id: string }>(
    `insert into entries.events (
       slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
       consent_version, active, required_consents
     ) values (
       $1, 'zztester', $2, $3::date, time '11:00', 1, $4,
       ${opensAt}, ${closesAt}, 18, true,
       'tester@example.com', 'zztester-v1', $5, array['entryTerms']::text[]
     ) returning id`,
    [slug, `Tester fixture ${slug}`, EVENT_DATE, capacity, active],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number, requires_permission)
     values ($1, 'unaffiliated', 'Unaffiliated', 1700, false, null),
            ($1, 'tester', 'Tester (do not use)', 1, false, $2)`,
    [event.id, EARLY],
  );

  return event.id;
}

let tester: { id: string; client: SupabaseClient };
let plain: { id: string; client: SupabaseClient };
let canceller: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  await removeFixtures();

  await makeEvent(PRE_OPEN);
  await makeEvent(OPEN, { opensAt: "now() - interval '1 hour'" });
  await makeEvent(CLOSED, {
    opensAt: "now() - interval '2 hours'",
    closesAt: "now() - interval '1 hour'",
  });
  await makeEvent(INACTIVE, { opensAt: "now() - interval '1 hour'", active: false });

  // Sequential, for `identity.test.ts`'s reason: running these concurrently races each
  // confirmation update against whichever signUp it belongs to.
  tester = await fixturePerson(TESTER_EMAIL);
  plain = await fixturePerson(PLAIN_EMAIL);
  canceller = await fixturePerson(CANCELLER_EMAIL);

  await grant(tester.id, 'nn-tester');
  await grant(canceller.id, 'nn-admin');
}, 40_000);

afterAll(async () => {
  await connected;
  await removeFixtures();
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Calling the entry path the way a script with the published key would
// -----------------------------------------------------------------------------------------

/**
 * **A distinct runner per call, because one entry per runner is a database rule now.**
 *
 * `entries.create_pending_purchase()` refuses a second entry for a runner who already holds a
 * live place on the same event, keyed on first name, last name and date of birth. Every
 * fixture in this file used to be the same person, so the second entry against any one event
 * was refused with `already_entered` and dozens of tests failed on a rule they were not
 * written to exercise.
 *
 * **The counter goes on the surname rather than the date of birth**, deliberately. The default
 * date of birth is chosen to sit comfortably clear of the minimum age and several tests read a
 * category derived from it; moving it would make those tests depend on how many entries ran
 * before them. A surname is read back by exactly one test, which asserts the apostrophe rather
 * than the whole string.
 *
 * **The apostrophe stays in every generated name**, so the escaping it exists to prove is
 * still exercised on every single call rather than only where somebody remembered to ask.
 *
 * Deterministic: a counter, not a random value, so a failing run can be read.
 */
let entrantSerial = 0;

function entrant(): Record<string, unknown> {
  return {
    first_name: 'Ada',
    last_name: `O'Brien-${(entrantSerial += 1)}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    club: null,
    ea_number: null,
    emergency_contact_name: 'Mary Somerville',
    emergency_contact_phone: '07700 900123',
    leg: null,
  };
}

interface Attempt {
  ok?: boolean;
  reason?: string;
  purchase_id?: string;
  amount_pence?: number;
}

async function attemptEntry(
  client: SupabaseClient,
  slug: string,
  options: { feeCode?: string; email?: string } = {},
): Promise<Attempt> {
  const { feeCode = 'unaffiliated', email = 'entrant@example.com' } = options;

  const { data, error } = await client.schema('entries').rpc('create_pending_purchase', {
    p_slug: slug,
    p_fee_code: feeCode,
    p_purchaser_name: 'Ada O’Brien',
    p_purchaser_email: email,
    p_entrants: [entrant()],
    p_medical: [null],
    p_consents: { entryTerms: true },
  });

  // **A Postgres error is not a refusal.** Failing loudly here is what stops a broken function
  // scoring as every rule holding at once — the mistake the harness that produced
  // `entries-rules.test.ts` actually made.
  if (error) {
    throw new Error(`create_pending_purchase errored: ${error.code} ${error.message}`);
  }

  return data as Attempt;
}

// -----------------------------------------------------------------------------------------
// The window, and who may cross it early
// -----------------------------------------------------------------------------------------

describe('entering before entries open', () => {
  it('refuses an anonymous caller, which is the published-key case', async () => {
    const result = await attemptEntry(anon, PRE_OPEN);

    // `closed`, specifically. This is the refusal the whole feature rests on: `auth.uid()` is
    // null for `anon`, `has_permission()` joins nothing, and the answer is the one the deployed
    // site gives everybody today.
    expect(result).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('refuses somebody signed in who holds no permission', async () => {
    const result = await attemptEntry(plain.client, PRE_OPEN);

    // **The test that matters most.** Having an account is not the qualification — anybody may
    // register. If this ever passes, every registered person can enter before the race opens.
    expect(result).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('lets somebody holding nn-tester in', async () => {
    const result = await attemptEntry(tester.client, PRE_OPEN);

    expect(result.ok).toBe(true);
    expect(result.purchase_id).toBeTruthy();
  });

  it('refuses a tester after the window has closed', async () => {
    const result = await attemptEntry(tester.client, CLOSED);

    // `entries_close_at` is never bypassed. A tester enters early; they do not enter a race
    // that has finished.
    expect(result).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('refuses a tester on an event that has been withdrawn', async () => {
    const result = await attemptEntry(tester.client, INACTIVE);

    expect(result).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('still lets an ordinary caller into an open event', async () => {
    // The regression guard for everybody who is not a tester, which is the whole population
    // from 1 September. Rewriting the window check must not have moved this.
    const result = await attemptEntry(anon, OPEN);

    expect(result.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------
// The permission-gated fee
// -----------------------------------------------------------------------------------------

async function feeCodesFor(client: SupabaseClient, slug: string): Promise<string[]> {
  const { data, error } = await client
    .schema('entries')
    .rpc('entry_state', { p_slug: slug });

  if (error) {
    throw new Error(`entry_state errored: ${error.code} ${error.message}`);
  }

  const fees = (data as { fees?: { code: string }[] }).fees ?? [];
  return fees.map((fee) => fee.code).sort();
}

describe('a fee only some people may see', () => {
  it('hides it from an anonymous caller', async () => {
    expect(await feeCodesFor(anon, OPEN)).toEqual(['unaffiliated']);
  });

  it('hides it from somebody signed in who holds no permission', async () => {
    expect(await feeCodesFor(plain.client, OPEN)).toEqual(['unaffiliated']);
  });

  it('shows it to somebody who holds the permission', async () => {
    expect(await feeCodesFor(tester.client, OPEN)).toEqual(['tester', 'unaffiliated']);
  });

  it('refuses an anonymous caller who names it anyway', async () => {
    const result = await attemptEntry(anon, OPEN, { feeCode: 'tester' });

    // **`invalid_fee`, the same answer a fee that does not exist gets.** Hiding it in
    // `entry_state()` is presentation; this is the control, and Slice E is the reason there are
    // two. A distinct reason here would be an oracle for which gated prices an event has.
    expect(result).toMatchObject({ ok: false, reason: 'invalid_fee' });
  });

  it('refuses a signed-in caller without the permission who names it', async () => {
    const result = await attemptEntry(plain.client, OPEN, { feeCode: 'tester' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_fee' });
  });

  it('lets a tester buy it, at the price the row says and not the one they sent', async () => {
    const result = await attemptEntry(tester.client, OPEN, { feeCode: 'tester' });

    expect(result.ok).toBe(true);

    // **1, and deliberately not the seeded £1.** This is the fabricated `zztester` event's own
    // fee, inserted above at a penny; the real fee on `nn-2026` is £1 because Stripe will not
    // charge below £0.30, and `entries.test.ts` is what asserts that. The two are different
    // numbers on purpose — the price here is arbitrary, which is the whole point of the test:
    // what comes back is the row's price rather than anything the caller sent. Making them
    // match would quietly turn this into a second assertion about the seeded row, and the
    // fixture would stop being invented.
    expect(result.amount_pence).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------
// Whose entry it is
// -----------------------------------------------------------------------------------------

describe('an entry that knows whose it is', () => {
  it('stamps person_id when the buyer was signed in', async () => {
    const result = await attemptEntry(tester.client, OPEN, {
      email: 'linked@example.com',
    });
    expect(result.ok).toBe(true);

    const row = await single<{ person_id: string | null }>(
      'select person_id from entries.entry_purchases where id = $1',
      [result.purchase_id],
    );

    expect(row.person_id).toBe(tester.id);
  });

  it('leaves person_id null for a signed-out buyer, which is most of them', async () => {
    const result = await attemptEntry(anon, OPEN, { email: CLAIMANT_EMAIL });
    expect(result.ok).toBe(true);

    const row = await single<{ person_id: string | null }>(
      'select person_id from entries.entry_purchases where id = $1',
      [result.purchase_id],
    );

    expect(row.person_id).toBeNull();
  });

  it('cannot be pointed at somebody else, because it is read and never passed', async () => {
    // There is no `p_person` argument to aim, which is the design. Asserted as the absence of
    // the parameter rather than by trying to send one, because sending an unknown argument to
    // PostgREST is a 404 about the function signature and would pass for the wrong reason.
    const args = await query<{ parameter_name: string }>(
      `select parameter_name
         from information_schema.parameters
        where specific_schema = 'entries'
          and specific_name like 'create_pending_purchase%'
        order by ordinal_position`,
    );

    const names = args.map((row) => row.parameter_name);
    expect(names).not.toContain('p_person');
    expect(names).not.toContain('p_person_id');
  });
});

describe('what a runner may read about their own entries', () => {
  it('refuses an anonymous caller outright', async () => {
    const { error } = await anon.schema('entries').rpc('my_entries');

    // 42501, not PGRST202: the function exists and anon has no grant on it. PGRST202 would
    // mean the request never got as far as being denied.
    expect(error?.code).toBe('42501');
  });

  it('matches an entry bought while signed in', async () => {
    const { data, error } = await tester.client.schema('entries').rpc('my_entries');
    expect(error).toBeNull();

    const answer = data as { ok: boolean; entries: { purchase_id: string }[] };
    expect(answer.ok).toBe(true);
    expect(answer.entries.length).toBeGreaterThan(0);
  });

  it('matches an entry bought signed-out, once the address is registered and confirmed', async () => {
    // The claim path, and the reason an account is not required to enter. The purchase above
    // was made anonymously against CLAIMANT_EMAIL; registering that address afterwards is what
    // brings it onto the account.
    const claimant = await fixturePerson(CLAIMANT_EMAIL);

    const { data, error } = await claimant.client.schema('entries').rpc('my_entries');
    expect(error).toBeNull();

    const answer = data as {
      ok: boolean;
      entries: { purchase_id: string }[];
    };

    expect(answer.ok).toBe(true);
    expect(answer.entries.length).toBeGreaterThan(0);
  });

  it('shows somebody nothing about anybody else', async () => {
    const { data } = await plain.client.schema('entries').rpc('my_entries');
    const answer = data as { ok: boolean; entries: unknown[] };

    // `plain` has bought nothing and registered an address nobody entered with. An empty list
    // is the whole assertion: this person shares a database with several live entries.
    expect(answer).toMatchObject({ ok: true });
    expect(answer.entries).toEqual([]);
  });

  it('returns no medical note, no emergency contact and no Stripe reference', async () => {
    const { data } = await tester.client.schema('entries').rpc('my_entries');
    const serialised = JSON.stringify(data);

    // **Asserted on the serialised answer rather than on named keys**, so a field added to
    // this function later cannot slip past a test that only looked at the ones it knew about.
    for (const forbidden of [
      'medical',
      'emergency',
      'date_of_birth',
      'ea_number',
      'stripe',
      'payment_intent',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

// -----------------------------------------------------------------------------------------
// Cancelling
// -----------------------------------------------------------------------------------------

describe('cancelling an entry', () => {
  /**
   * **The row survives the runner, and the admin page has to keep showing it.** #116.
   *
   * `cancel_entry()` deletes the entrants on purpose, so the club stops holding personal data
   * for a race somebody is not running. `read_entry_list()` used to drive its rows from
   * `entries.entrants` and inner-join the purchase, so a refunded purchase **could not appear
   * on `/admin/nn/` at all** — the Refunded filter on that page could never match a row, and a
   * volunteer clicking it concluded there had been no refunds.
   *
   * Read through `entries.read_entry_list()` directly rather than through one of the six
   * functions that wrap it: this is about the shape of the rows, and the doors in front of it
   * have their own tests. It is granted to nobody, which is why this goes over the superuser
   * connection rather than through PostgREST.
   */
  it('leaves the purchase on the admin list with no runner on it', async () => {
    const made = await attemptEntry(anon, OPEN, { email: 'cancel-visible@example.com' });
    expect(made.ok).toBe(true);

    // **`paid_at` goes with the status**, because `entry_purchases_paid_has_timestamp` refuses
    // a paid row that does not say when — the constraint that stops a purchase claiming a
    // payment with no moment attached. Set here rather than through the webhook because what
    // this test is about is what the admin list does with a *cancelled* row, not how one
    // becomes paid; `entries-webhook.test.ts` owns that.
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [made.purchase_id],
    );

    const cancelled = await canceller.client
      .schema('entries')
      .rpc('cancel_entry', { p_purchase_id: made.purchase_id });

    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toMatchObject({ ok: true });

    const listed = await single<{ result: { entries: Record<string, unknown>[] } }>(
      'select entries.read_entry_list($1) as result',
      [OPEN],
    );

    const row = listed.result.entries.find(
      (entry) => entry.purchase_id === made.purchase_id,
    );

    // **Present at all** is the assertion. Before this it was absent, and absent is
    // indistinguishable from "there have been no refunds".
    expect(row, 'the cancelled purchase is missing from the admin list').toBeDefined();

    expect(row).toMatchObject({
      status: 'refunded',
      // Null rather than gone: the runner is a fact about the purchase that the refund
      // legitimately removed, exactly as `my_entries()` has always reported it.
      entrant_id: null,
      first_name: null,
      last_name: null,
      age: null,
      gender: null,
    });

    // And the amount is still there, because that is what a refund is *about* — a row with no
    // money on it would be useless to whoever is reconciling against Stripe.
    expect(row?.amount_pence).toEqual(expect.any(Number));
  });

  it('refuses somebody signed in who holds no permission', async () => {
    const made = await attemptEntry(anon, OPEN, { email: 'cancel-a@example.com' });
    expect(made.ok).toBe(true);

    const { data, error } = await plain.client
      .schema('entries')
      .rpc('cancel_entry', { p_purchase_id: made.purchase_id });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });

    // **And the row is untouched.** A refusal that had already deleted the entrant would be a
    // refusal in name only.
    const row = await single<{ status: string }>(
      'select status from entries.entry_purchases where id = $1',
      [made.purchase_id],
    );
    expect(row.status).toBe('pending');
  });

  it('refuses an anonymous caller outright', async () => {
    const { error } = await anon
      .schema('entries')
      .rpc('cancel_entry', { p_purchase_id: '00000000-0000-0000-0000-000000000000' });

    expect(error?.code).toBe('42501');
  });

  it('refuses to say whether a purchase exists to somebody who may not cancel', async () => {
    const { data } = await plain.client.schema('entries').rpc('cancellable_purchase', {
      p_purchase_id: '00000000-0000-0000-0000-000000000000',
    });

    // `unauthorised` rather than `no_such_purchase`, because the permission is checked before
    // the row is resolved — the ordering discipline `admin_key_ok()` established.
    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('deletes the entrant, releases the place and records the reason', async () => {
    const made = await attemptEntry(anon, OPEN, { email: 'cancel-b@example.com' });
    expect(made.ok).toBe(true);

    const { data, error } = await canceller.client.schema('entries').rpc('cancel_entry', {
      p_purchase_id: made.purchase_id,
      p_refund_reference: 're_fixture_107',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, already: false, entrants_deleted: 1 });

    const row = await single<{
      status: string;
      paid_at: string | null;
      hold_expires_at: string | null;
    }>(
      'select status, paid_at, hold_expires_at from entries.entry_purchases where id = $1',
      [made.purchase_id],
    );

    expect(row.status).toBe('refunded');
    // `entry_purchases_paid_has_timestamp` insists these two agree, and moving off `paid` is
    // what has to clear it.
    expect(row.paid_at).toBeNull();
    expect(row.hold_expires_at).toBeNull();

    const entrants = await query(
      'select id from entries.entrants where purchase_id = $1',
      [made.purchase_id],
    );
    expect(entrants).toEqual([]);

    // The audit row, and it names what was destroyed rather than only that something was.
    // `at`, not `created_at` — this table has named its timestamp column differently from
    // every other table in the schema since it was written.
    const audit = await single<{ action: string; detail: Record<string, unknown> }>(
      `select action, detail from entries.admin_audit
        where detail ->> 'purchase_id' = $1
        order by at desc
        limit 1`,
      [made.purchase_id],
    );

    expect(audit.action).toBe('cancel_entry');
    expect(audit.detail).toMatchObject({
      entrants_deleted: 1,
      refund_reference: 're_fixture_107',
    });
  });

  it('is idempotent, because a retry after a failed mark is the expected path', async () => {
    const made = await attemptEntry(anon, OPEN, { email: 'cancel-c@example.com' });
    expect(made.ok).toBe(true);

    const first = await canceller.client
      .schema('entries')
      .rpc('cancel_entry', { p_purchase_id: made.purchase_id });
    expect(first.data).toMatchObject({ ok: true, already: false });

    const second = await canceller.client
      .schema('entries')
      .rpc('cancel_entry', { p_purchase_id: made.purchase_id });

    // `ok: true`, not a refusal. The Worker calls this after a Stripe refund that is itself
    // idempotent, so pressing the button twice has to be safe rather than merely tolerated.
    expect(second.data).toMatchObject({ ok: true, already: true });
  });

  it('gives the place back, which is the point of deleting the entrant', async () => {
    // A one-place event, so "the place came back" is testable rather than inferable.
    const slug = 'zztester-tiny';
    await query('delete from entries.events where slug = $1', [slug]);

    const event = await single<{ id: string }>(
      `insert into entries.events (
         slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
         entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
         consent_version, active, required_consents
       ) values (
         $1, 'zztester', 'Tiny', $2::date, time '11:00', 1, 1,
         now() - interval '1 hour', now() + interval '1 hour', 18, true,
         'tester@example.com', 'zztester-v1', true, array['entryTerms']::text[]
       ) returning id`,
      [slug, EVENT_DATE],
    );

    await query(
      `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
       values ($1, 'unaffiliated', 'Unaffiliated', 1700, false)`,
      [event.id],
    );

    try {
      const first = await attemptEntry(anon, slug, { email: 'tiny-a@example.com' });
      expect(first.ok).toBe(true);

      const full = await attemptEntry(anon, slug, { email: 'tiny-b@example.com' });
      expect(full).toMatchObject({ ok: false, reason: 'sold_out' });

      await canceller.client
        .schema('entries')
        .rpc('cancel_entry', { p_purchase_id: first.purchase_id });

      const afterwards = await attemptEntry(anon, slug, { email: 'tiny-c@example.com' });
      expect(afterwards.ok).toBe(true);
    } finally {
      await query(`delete from entries.entry_purchases where event_id = $1`, [event.id]);
      await query('delete from entries.events where id = $1', [event.id]);
    }
  });
});

// -----------------------------------------------------------------------------------------
// Asking the club to do something with your own entry
// -----------------------------------------------------------------------------------------
/**
 * **A purchase id is not a credential, and this is the suite that says so.**
 *
 * `entries.request_entry_action()` takes one, and it is printed on the confirmation page, sent
 * in the return URL and now shown on `/account/entries/`. So the interesting tests here are not
 * "does it work" — they are the three ways somebody holding a reference might use it against
 * an entry that is not theirs.
 *
 * It records an ask and performs nothing: cancelling is `cancel_entry()` behind
 * `nn.entry.cancel`, and transferring has no implementation at all.
 */
describe('requesting something on your own entry', () => {
  async function ask(
    client: SupabaseClient,
    purchaseId: string,
    action: string,
  ): Promise<Attempt> {
    const { data, error } = await client
      .schema('entries')
      .rpc('request_entry_action', { p_purchase_id: purchaseId, p_action: action });

    if (error) {
      throw new Error(`request_entry_action errored: ${error.code} ${error.message}`);
    }

    return data as Attempt;
  }

  /** A paid entry belonging to whoever bought it. */
  async function paidEntryFor(client: SupabaseClient, email: string): Promise<string> {
    const made = await attemptEntry(client, OPEN, { email });
    expect(made.ok).toBe(true);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [made.purchase_id],
    );

    return made.purchase_id as string;
  }

  it('is not callable by anon at all, which is a stronger refusal than a reason', async () => {
    const purchaseId = await paidEntryFor(tester.client, 'ask-anon@example.com');

    // **`42501`, not a structured refusal, and that is the better answer.** This function is
    // granted to `authenticated` and to nothing else, so an anonymous caller is stopped by the
    // grant before a line of it runs — the published anon key cannot reach it whatever id it
    // carries. The `auth.uid() is null` branch inside is belt and braces for a caller who
    // presents a token that resolves to nobody, and is deliberately kept.
    //
    // Asserted as the **specific** error rather than as "something failed", for this file's
    // usual reason: a function that is broken for everybody would otherwise score as a rule
    // holding.
    const { error } = await anon
      .schema('entries')
      .rpc('request_entry_action', { p_purchase_id: purchaseId, p_action: 'cancel' });

    expect(error?.code).toBe('42501');

    const row = await single<{ requested_action: string | null }>(
      'select requested_action from entries.entry_purchases where id = $1',
      [purchaseId],
    );
    expect(row.requested_action).toBeNull();
  });

  it('refuses a signed-in stranger, and tells them nothing about the entry', async () => {
    const purchaseId = await paidEntryFor(tester.client, 'ask-owner@example.com');

    // **The assertion that matters most on this page.** `plain` holds an account and no
    // permission, and is not the buyer. The answer is `no_such_entry` — the same answer an
    // invented uuid gets — so the reference cannot be used to find out whether it names a real
    // paid entry belonging to somebody else.
    expect(await ask(plain.client, purchaseId, 'cancel')).toMatchObject({
      ok: false,
      reason: 'no_such_entry',
    });

    const invented = await ask(
      plain.client,
      '00000000-0000-0000-0000-000000000000',
      'cancel',
    );
    expect(invented).toMatchObject({ ok: false, reason: 'no_such_entry' });

    // And the entry is untouched, which is what makes the refusal a refusal.
    const row = await single<{ requested_action: string | null }>(
      'select requested_action from entries.entry_purchases where id = $1',
      [purchaseId],
    );
    expect(row.requested_action).toBeNull();
  });

  it('refuses an action that is not one of the two words', async () => {
    const purchaseId = await paidEntryFor(tester.client, 'ask-bad-action@example.com');

    expect(await ask(tester.client, purchaseId, 'refund')).toMatchObject({
      ok: false,
      reason: 'invalid_action',
    });
  });

  it('refuses an entry the club has not recorded a place for', async () => {
    // Left `pending`: there is nothing to ask about a place that is not held, and a lapsed
    // hold carrying a request would put rows on the volunteers' list that resolve themselves.
    const made = await attemptEntry(tester.client, OPEN, {
      email: 'ask-pending@example.com',
    });
    expect(made.ok).toBe(true);

    expect(await ask(tester.client, made.purchase_id as string, 'cancel')).toMatchObject({
      ok: false,
      reason: 'no_such_entry',
    });
  });

  it('records the ask for the person who bought it, and changes nothing else', async () => {
    const purchaseId = await paidEntryFor(tester.client, 'ask-records@example.com');

    expect(await ask(tester.client, purchaseId, 'cancel')).toMatchObject({
      ok: true,
      action: 'cancel',
    });

    const row = await single<{
      requested_action: string;
      requested_at: string;
      status: string;
    }>(
      `select requested_action, requested_at, status
         from entries.entry_purchases where id = $1`,
      [purchaseId],
    );

    expect(row.requested_action).toBe('cancel');
    expect(row.requested_at).not.toBeNull();

    // **Still paid, and still holding a place.** The request is not a fifth status: the
    // capacity predicate counts `paid`, and an entry somebody has asked to cancel is one
    // until a volunteer cancels it.
    expect(row.status).toBe('paid');
  });

  it('replaces an earlier ask rather than stacking one on it', async () => {
    const purchaseId = await paidEntryFor(tester.client, 'ask-replace@example.com');

    await ask(tester.client, purchaseId, 'cancel');

    // A volunteer deals with it...
    await query(
      'update entries.entry_purchases set request_resolved_at = now() where id = $1',
      [purchaseId],
    );

    // ...and the runner asks for something else. The resolved mark has to clear, or the new
    // ask arrives on the volunteers' list already looking handled.
    expect(await ask(tester.client, purchaseId, 'transfer')).toMatchObject({
      ok: true,
      action: 'transfer',
    });

    const row = await single<{
      requested_action: string;
      request_resolved_at: string | null;
    }>(
      `select requested_action, request_resolved_at
         from entries.entry_purchases where id = $1`,
      [purchaseId],
    );

    expect(row.requested_action).toBe('transfer');
    expect(row.request_resolved_at).toBeNull();
  });
});
