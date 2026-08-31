import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

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
/**
 * The runner a place is transferred **to**, with an account of their own — which is what makes
 * the disclosure in #148 reachable at all. `transfer_entry()` re-points `purchaser_email` and
 * nulls `person_id`, so `my_entries()` matches this person against the purchase the moment
 * they register with the address it was moved to.
 */
const NEW_RUNNER_EMAIL = 'zz-transfer-new-runner@example.com';
const PEOPLE_EMAILS = [NN_ADMIN_EMAIL, RUNNER_EMAIL, NEW_RUNNER_EMAIL];
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

/**
 * Every purchase against this file's own events, and nothing else.
 *
 * **Run between tests, because one place per email is a database rule now.** Most of this file
 * buys its entries as `RUNNER_EMAIL` and has to: `my_entries()` matches a purchase on the
 * caller's confirmed address, so a test about what a runner can see of their own entry cannot
 * use a serialised stand-in the way `create()`'s default does. Six tests buying as that address
 * against one event is six live places on it, and every one after the first is refused with
 * `email_already_entered`.
 *
 * Clearing between tests rather than serialising is the honest fix here: the rule is *one live
 * place at a time*, and a test that has finished with its entry has no live place. The events
 * and the fixture people survive — they are `beforeAll`'s, and rebuilding a signed-up person
 * per test would cost a GoTrue round trip each time for nothing.
 */
async function removePurchases(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [[...SLUGS]],
  );
}

async function removeFixtures(): Promise<void> {
  // Purchases first: `entry_purchases.event_id` has no cascade, deliberately.
  await removePurchases();
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
let newRunner: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  // **Holding a place takes the entry key since ADR-029**, and the digest ships null —
  // which refuses everything. Installing it is what makes this file's fixtures able to
  // hold a place at all; without it every call below answers `unauthorised`. Issue #178.
  await installEntryKey(db);
  await removeFixtures();
  await query('delete from auth.users where email = any($1::text[])', [PEOPLE_EMAILS]);

  await makeEvent(EVENT, 5000);
  await makeEvent(TINY, 2);

  nnAdmin = await fixturePerson(NN_ADMIN_EMAIL, ['nn-admin']);
  runner = await fixturePerson(RUNNER_EMAIL, []);
  newRunner = await fixturePerson(NEW_RUNNER_EMAIL, []);
}, 30_000);

// **Between every test, for the reason `removePurchases` explains.** One place per email is a
// database rule since 30 August 2026, and most of this file has to buy as one fixed address.
beforeEach(async () => {
  await connected;
  await removePurchases();
});

afterAll(async () => {
  await connected;
  await removeFixtures();
  await query('delete from entries.admin_audit where actor = any($1::text[])', [
    [nnAdmin?.id, runner?.id, newRunner?.id].filter(Boolean),
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
    // The runner's own number, which `create_pending_purchase()` has required of a
    // runner since ADR-025 and refuses with `phone_required` without. Deliberately not
    // the emergency contact's: a fixture where the two agree cannot catch the two being
    // read the wrong way round.
    phone: '07700 900124',
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
    p_key: ENTRY_KEY,
    p_slug: options.slug ?? EVENT,
    p_fee_code: options.feeCode ?? 'unaffiliated',
    p_purchaser_name: 'Ada O’Brien',
    // **A serial on the address, for the reason the surname carries one.** One place per
    // email is a database rule since 30 August 2026, so a suite whose purchasers are all
    // `ada@example.com` cannot hold two places on one event. The tests that are *about* that
    // rule pass `email` explicitly.
    p_purchaser_email: options.email ?? `ada-${(serial += 1)}@example.com`,
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
  /** The runner's own number — ADR-025. Replaced by a transfer, never carried
   *  across, and null on every entry taken before 30 August 2026. */
  phone: string | null;
  gender: string | null;
  /** Where a non-binary entrant's result counts, if anywhere — ADR-031. Cleared by a
   *  transfer exactly like `gender_identity`, never carried across. */
  result_placement: string | null;
}

async function entrantsOf(purchaseId: string): Promise<EntrantRow[]> {
  return query<EntrantRow>(
    `select first_name, role, ea_number, phone, gender, result_placement
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

  /** The same thing, bought by a named address — for the one-place-per-email tests. */
  async function paidPurchaseFor(email: string): Promise<string> {
    const purchaseId = await acceptedPurchaseId({ email, entrants: [person()] });

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
      // **Naming both is what reaches the eleven-argument form**, which is the one that takes
      // a phone number. Ten `text` arguments is already the England Athletics signature, and
      // Postgres tells functions apart by their argument types.
      p_phone: '0117 496 0203',
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

  it("replaces the previous runner's phone number rather than carrying it across", async () => {
    // **A number is a fact about the person who gave it** — ADR-025 — so this follows the rule
    // the medical note and the recorded gender already do. Leaving it on the row would file
    // one person's number under another person's name and print it on the start list beside
    // them, and nothing about the row would look wrong.
    const purchaseId = await paidPurchase('unaffiliated');

    expect((await entrantsOf(purchaseId))[0]?.phone).toBe('07700 900124');

    expect((await transfer(purchaseId)).ok).toBe(true);

    const [entrant] = await entrantsOf(purchaseId);

    expect(entrant?.first_name).toBe('Nell');
    expect(entrant?.phone).toBe('0117 496 0203');
  });

  it("clears the previous runner's number when no new one is given", async () => {
    // **Null is allowed here and refused on the entry form**, because the two are not the same
    // promise: `/nn/2026/` will not take an entry without a number, and a volunteer moving a
    // place may be working from an email thread. It is also the line the nine- and
    // ten-argument wrappers reach — they delegate with a null phone, which is what keeps a
    // Worker deployed before ADR-025 transferring places rather than meeting a refusal it has
    // no wording for.
    //
    // **The safe direction, and that is the point.** The disclosure is closed on every path the
    // moment the migration lands; only the *new* number waits for the Worker to catch up.
    const purchaseId = await paidPurchase('unaffiliated', [person()]);

    expect((await transfer(purchaseId, { p_phone: '' })).ok).toBe(true);
    expect((await entrantsOf(purchaseId))[0]?.phone).toBeNull();
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

  it('refuses moving a place onto an address that already holds one', async () => {
    // **The entry path's rule, on the other path** —
    // `20260830160000_entries_one_place_per_email.sql`. Without it the transfer form is simply
    // the way round the entry form: one address would end up holding two places, which is the
    // state that migration exists to make unreachable.
    const held = await paidPurchaseFor('holder@example.com');
    const moving = await paidPurchase('unaffiliated');

    const result = await transfer(moving, { p_email: 'holder@example.com' });

    expect(result).toMatchObject({ ok: false, reason: 'email_already_entered' });

    // And nothing moved: the refusal is before the write, so the place it was moving from is
    // untouched rather than half-transferred.
    const [row] = await query<{ purchaser_email: string }>(
      `select purchaser_email::text as purchaser_email
         from entries.entry_purchases where id = $1`,
      [moving],
    );

    expect(row?.purchaser_email).not.toBe('holder@example.com');
    expect(held).not.toBe(moving);
  });

  it('still lets a place be re-pointed at the address that already owns it', async () => {
    // **A correction, not a second entry.** Fixing a typo in the runner's name on an entry
    // whose address is already right must not be refused by a rule about second entries —
    // which is what `purchase.id <> p_purchase_id` in the check is there for.
    const purchaseId = await paidPurchaseFor('same-again@example.com');

    const result = await transfer(purchaseId, { p_email: 'same-again@example.com' });

    expect(result).toMatchObject({ ok: true });
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

  describe('a non-binary entrant’s placement — ADR-031', () => {
    it('is cleared by a transfer, exactly like gender_identity', async () => {
      // **Load-bearing, not tidy.** The transfer form collects the new runner's own `gender`
      // fresh but does not ask the placement follow-up — that is its own decision, still
      // open — so leaving the column as it was would attach the previous runner's answer to
      // whoever the place moves to, and would violate
      // `entrants_result_placement_only_non_binary` the moment the new runner's `gender` is
      // not `non_binary`, which is exactly the shape this test transfers into.
      const purchaseId = await paidPurchase('unaffiliated', [
        person({ gender: 'non_binary', result_placement: 'female' }),
      ]);

      const result = await transfer(purchaseId, { p_gender: 'male' });

      expect(result.ok).toBe(true);

      const [entrant] = await entrantsOf(purchaseId);
      expect(entrant?.gender).toBe('male');
      expect(entrant?.result_placement).toBeNull();
    });

    it('leaves a transferred-in non-binary runner unplaced, since the form does not ask', async () => {
      // **The scope boundary, asserted rather than assumed.** A transfer into a non-binary
      // `gender` is a legal state — the check constraint only forbids a placement on a
      // female or male row, never the reverse — and this is what confirms it lands unplaced
      // rather than refused.
      const purchaseId = await paidPurchase('unaffiliated');

      const result = await transfer(purchaseId, { p_gender: 'non_binary' });

      expect(result.ok).toBe(true);

      const [entrant] = await entrantsOf(purchaseId);
      expect(entrant?.gender).toBe('non_binary');
      expect(entrant?.result_placement).toBeNull();
    });
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
// Whose ask was it — #148, finding 1
// =========================================================================================

/**
 * **The disclosure this block exists to keep closed.**
 *
 * `transfer_entry()` re-points `purchaser_email` at the new runner and sets `person_id` null.
 * `my_entries()` matches a purchase on exactly those two things — so before an owner was
 * stamped on each ask, the person a place was transferred **to** was shown the entire request
 * history of the person it came **from**, addressed to them in the second person:
 *
 *   > **Asked for** — You asked the club about transferring this place. The club has dealt
 *   > with it. *You told the club: <whatever the previous runner typed>*
 *
 * The reason box is 500 characters of anything — a bereavement, a pregnancy, a phone number.
 * So this is a disclosure of one runner's free text to another, and the copy being addressed
 * to the wrong person is the smaller half of it.
 *
 * **Every assertion here is a negative one**, per the repository's rule: that the new runner
 * *cannot* see the previous runner's words proves the thing that matters. The positives are
 * beside them only to stop the negatives passing vacuously — a `my_entries()` that returned
 * nothing at all would satisfy every "must not see" line in this file.
 */
describe('an ask belongs to whoever made it, and a transfer does not hand it on', () => {
  const WORDS = 'My father has died and I cannot face it. Please cancel.';

  async function myEntry(
    who: { client: SupabaseClient },
    purchaseId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const { data, error } = await who.client.schema('entries').rpc('my_entries');

    expect(error, `my_entries errored: ${JSON.stringify(error)}`).toBeNull();

    return ((data as { entries?: Record<string, unknown>[] }).entries ?? []).find(
      (row) => row.purchase_id === purchaseId,
    );
  }

  /** A paid place held by `runner`, carrying one ask with words on it. */
  async function askedAbout(): Promise<string> {
    const purchaseId = await acceptedPurchaseId({ email: RUNNER_EMAIL });

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const { data, error } = await runner.client
      .schema('entries')
      .rpc('request_entry_action', {
        p_purchase_id: purchaseId,
        p_action: 'cancel',
        p_reason: WORDS,
      });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, action: 'cancel' });

    return purchaseId;
  }

  /** Move the place to `newRunner`, who has an account and will therefore match it. */
  async function moveToNewRunner(purchaseId: string): Promise<void> {
    serial += 1;

    const { data, error } = await nnAdmin.client.schema('entries').rpc('transfer_entry', {
      p_purchase_id: purchaseId,
      p_email: NEW_RUNNER_EMAIL,
      p_first_name: 'Nell',
      p_last_name: `Gwyn-owner-${serial}`,
      p_date_of_birth: '1991-02-02',
      p_gender: 'female',
      p_club: '',
      p_emergency_contact_name: 'Kin Three',
      p_emergency_contact_phone: '0117 496 0003',
      p_ea_number: '',
    });

    expect(error, `transfer_entry errored: ${JSON.stringify(error)}`).toBeNull();
    expect((data as { ok?: boolean }).ok).toBe(true);
  }

  it('stamps the asker on the ask, rather than leaving it to be inferred from a clock', async () => {
    // The mechanism itself. A `transferred_at` column would have answered "was this made
    // before the transfer", which is a proxy; this answers "whose was it", which is the
    // question — and it is the only one of the two that survives a second transfer.
    const purchaseId = await askedAbout();

    const row = await single<{ owner_email: string; owner_person_id: string | null }>(
      `select owner_email, owner_person_id from entries.entry_requests
        where purchase_id = $1`,
      [purchaseId],
    );

    expect(row.owner_email).toBe(RUNNER_EMAIL);
    expect(row.owner_person_id).toBe(runner.id);
  });

  it('shows the asker their own ask, words and all', async () => {
    // **Here so the negatives below cannot pass vacuously.** Every "must not see" assertion
    // in this block is satisfied by a function that returns nothing to anybody.
    const purchaseId = await askedAbout();
    const own = await myEntry(runner, purchaseId);

    expect(own).toBeDefined();
    expect(own?.requests).toEqual([
      expect.objectContaining({ action: 'cancel', reason: WORDS }),
    ]);
    expect(own?.request_reason).toBe(WORDS);
    expect(own?.requested_action).toBe('cancel');
  });

  it('shows the new runner the entry and none of the previous runner’s asks', async () => {
    // **The defect, asserted from the reader's side.** The new runner really does hold this
    // entry — the first assertion is what makes the rest meaningful — and the history on it
    // is not theirs.
    const purchaseId = await askedAbout();
    await moveToNewRunner(purchaseId);

    const theirs = await myEntry(newRunner, purchaseId);

    expect(theirs, 'the new runner should see the entry itself').toBeDefined();
    expect(theirs?.requests).toEqual([]);
  });

  it('does not leak the words through the summary columns either', async () => {
    // ⚠️ **The second door, and the one that was open by luck rather than by design.**
    // `transfer_entry()` clears `requested_action` and deliberately **keeps** `request_reason`
    // — it is the record of why the place moved. `asksFor()` in `worker/account.ts` falls back
    // to the summary columns whenever `requests` is empty, and it is keyed on
    // `requested_action`, which happens to be null here. Filtering only the list would have
    // left this reachable the moment any future path resolved an ask without clearing that
    // column, so `my_entries()` derives all four keys from the owned asks.
    const purchaseId = await askedAbout();
    await moveToNewRunner(purchaseId);

    const theirs = await myEntry(newRunner, purchaseId);

    expect(theirs?.request_reason).toBeNull();
    expect(theirs?.requested_action).toBeNull();
    expect(theirs?.request_resolved).toBe(false);

    // And the row itself still carries it, which is the point of the boundary being on the
    // read: the club has not forgotten why the place moved, it has stopped showing it to
    // somebody it is not about.
    const stored = await single<{ request_reason: string | null }>(
      `select request_reason from entries.entry_purchases where id = $1`,
      [purchaseId],
    );

    expect(stored.request_reason).toBe(WORDS);
  });

  it('keeps the whole history on the admin surface, which is what the volunteer acted on', async () => {
    // **Not "delete the history on transfer".** Keeping it is right for `/admin/nn/`: it is
    // the record of why the place moved. The boundary belongs on the runner's read and
    // nowhere else, and this is the half that would break if somebody moved it.
    const purchaseId = await askedAbout();
    await moveToNewRunner(purchaseId);

    const { data } = await nnAdmin.client
      .schema('entries')
      .rpc('entry_list', { p_event_slug: EVENT });

    const listed = (
      (
        data as {
          entries?: {
            purchase_id: string;
            requests?: { action: string; reason: string | null }[];
          }[];
        }
      ).entries ?? []
    ).find((row) => row.purchase_id === purchaseId);

    expect(listed?.requests).toEqual([
      expect.objectContaining({ action: 'cancel', reason: WORDS }),
    ]);
  });

  it('survives a place changing hands twice, which is the reason for the mechanism', async () => {
    // **The argument for stamping an owner over stamping a clock**, made as a test. After two
    // moves there are three people involved, and each ask has to land with exactly one of
    // them. A boundary that said "anything before the transfer" has no way to express that.
    const purchaseId = await askedAbout();
    await moveToNewRunner(purchaseId);

    // The new runner now asks something of their own.
    const second = await newRunner.client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: purchaseId,
      p_action: 'transfer',
      p_reason: 'A friend would like it.',
    });

    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ok: true, action: 'transfer' });

    // And the place moves on again, to somebody with no account at all.
    serial += 1;
    const { error } = await nnAdmin.client.schema('entries').rpc('transfer_entry', {
      p_purchase_id: purchaseId,
      p_email: `zz-third-holder-${serial}@example.com`,
      p_first_name: 'Ida',
      p_last_name: `Third-${serial}`,
      p_date_of_birth: '1992-03-03',
      p_gender: 'female',
      p_club: '',
      p_emergency_contact_name: 'Kin Four',
      p_emergency_contact_phone: '0117 496 0004',
      p_ea_number: '',
    });
    expect(error).toBeNull();

    // Two asks on the row, by two different people, and neither is now visible to the third
    // holder — who has an account nowhere, so the strongest thing that can be asserted is
    // that the two asks are still attributed to the two people who made them.
    const rows = await query<{ owner_email: string; action: string }>(
      `select owner_email, action from entries.entry_requests
        where purchase_id = $1 order by requested_at, id`,
      [purchaseId],
    );

    expect(rows).toEqual([
      { owner_email: RUNNER_EMAIL, action: 'cancel' },
      { owner_email: NEW_RUNNER_EMAIL, action: 'transfer' },
    ]);

    // And the middle person no longer holds the entry, so they see nothing — not even their
    // own ask, because the entry is not theirs any more. That is the outer ownership test
    // doing its job, and it is unchanged by this work.
    expect(await myEntry(newRunner, purchaseId)).toBeUndefined();
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

  /**
   * A paid purchase owned by the runner — or by somebody else, when `email` says so.
   *
   * **The address is a parameter because one place per email is a database rule.** A test that
   * needs two entries at once cannot have both belong to `RUNNER_EMAIL`; the second is refused.
   * Where the second entry is meant to be *somebody else's* — which is the only reason a test
   * here wants two — saying so is more faithful than sharing an address for the convenience of
   * one helper.
   */
  async function paidOwnedPurchase(
    entrants: Record<string, unknown>[] = [person()],
    consents?: Record<string, boolean>,
    email: string = RUNNER_EMAIL,
  ): Promise<string> {
    const purchaseId = await acceptedPurchaseId({
      email,
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

  it('is not callable by an anonymous client at all', async () => {
    // **The outer of two independent locks, and it is the one that matters here.**
    // `admin_entry_detail` is granted to `authenticated` and to nobody else, so an anonymous
    // PostgREST call is refused by Postgres **before the function runs** — `42501 permission
    // denied`, not a refusal envelope.
    //
    // **That is why this asserts an error where the rest of this file asserts a refusal.** The
    // "a Postgres error is never a refusal" rule applies to functions `anon` may legitimately
    // call, where an error means the rule is broken rather than holding. This one `anon` may
    // not call, and the error *is* the answer. The thirteen anon-callable functions are named
    // in `entries.test.ts`; a fourteenth would be a decision, and this is not it.
    const purchaseId = await paidOwnedPurchase();

    const { errorCode } = await detailAs(anon, purchaseId);

    expect(errorCode).toBe('42501');
  });

  it('refuses somebody signed in who holds no permission, and says so rather than erroring', async () => {
    // **The inner lock, and the case a naive "is this person signed in" check would pass.**
    // `runner` holds an account and nothing else, which is what everybody who registers holds
    // — so they reach PostgREST as `authenticated`, the grant lets them ask, and
    // `identity.has_permission('nn.entry.read')` inside is what says no.
    //
    // Here the "a Postgres error is never a refusal" rule does apply: a `42501` would mean the
    // grant was wrong, and any other error would mean a broken function refusing everybody,
    // which reads as the rule holding when it has stopped being tested at all.
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
    // **Somebody else's, and now literally so.** It shared the runner's address until one
    // place per email made that impossible — which is the rule reading this fixture correctly:
    // "any other" entry belonging to the same person was never what this test meant.
    const theirs = await paidOwnedPurchase(
      [person()],
      undefined,
      'other-entry@example.com',
    );

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
