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
 * `nn-2026` row or the real 1p tester fee on it.
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

function entrant(): Record<string, unknown> {
  return {
    first_name: 'Ada',
    last_name: "O'Brien",
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
