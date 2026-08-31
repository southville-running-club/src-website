import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { ENTRY_KEY, installEntryKey } from './entry-key';

/**
 * `entries.record_checkout_event()` — the only thing in this platform that writes `paid`.
 *
 * ## Why this file is separate from `entries-capacity.test.ts`
 *
 * That file proves the entry path: capacity, price, consent, and the lock that stops two
 * people taking one place. This one proves the *confirmation* path, and the two meet in
 * exactly one place — the shared advisory lock — which is tested here, at the foot, by racing
 * a revival against a fresh entry.
 *
 * ## What is worth proving, and what is not
 *
 * **Money has already left somebody's account by the time this function runs**, so the
 * negative cases are the ones that matter and there are more of them than positive ones. A
 * transition that fires when it should not takes a place from somebody; one that fails to fire
 * leaves a person who paid with no race and no way to find out. Both are tested by their
 * outcome on the row, never by the function's return value alone.
 *
 * ## The fixtures are fabricated events
 *
 * Every test runs against a `zz-hook-*` event it created, so nothing here can collide with
 * `entries.test.ts`, with `entries-capacity.test.ts`, with the acceptance suite, or with a
 * laptop somebody has left `./dev up` running on. The advisory lock is per event id, so
 * fabricated events do not contend with each other either.
 *
 * The privileged connection is the local Docker Postgres and nothing else. Its credentials are
 * the fixed ones `supabase start` prints on every machine, and there is no version of this
 * file that talks to production.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const FIXTURE_PREFIX = 'zz-hook-';

/**
 * The key the webhook presents, and its digest.
 *
 * **Deterministic and invented**, like every fixture here, and obviously not a real one. The
 * digest is what the table holds; the key itself never is. The seeded row ships with a null
 * digest — which refuses everything — so each run installs this one and puts the null back.
 */
const KEY = 'zz-hook-test-key-not-a-real-one';
const DIGEST = createHash('sha256').update(KEY, 'utf8').digest('hex');

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

async function removeFixtures(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug like $1)`,
    [`${FIXTURE_PREFIX}%`],
  );
  await query('delete from entries.events where slug like $1', [`${FIXTURE_PREFIX}%`]);
}

beforeEach(async () => {
  await removeFixtures();
  await query(
    `update entries.webhook_secrets set key_sha256 = $1 where name = 'stripe'`,
    [DIGEST],
  );
  // **The second key, and this file needs it only to build its fixtures.** Every test here is
  // about the webhook; what changed on 31 August 2026 is that *holding* the place a webhook
  // then confirms takes a key of its own. Issue #178, ADR-029.
  await installEntryKey(db);
});

afterAll(async () => {
  await removeFixtures();
  // **Back to the shipped state**, so a laptop is not left holding a working key for a test
  // secret — and so a failed run cannot leave the real event confirmable by anybody who reads
  // this file.
  await query(
    `update entries.webhook_secrets set key_sha256 = null where name = 'stripe'`,
  );
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------------------

async function seedEvent(slug: string, capacity = 10): Promise<string> {
  const rows = await query<{ id: string }>(
    // `race_slug` is a fixture race and never `nn` — see the note on the same line in
    // `entries-capacity.test.ts`.
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, from_address, consent_version, active
     ) values ($1, $2, 'zz-fixture', date '2026-11-01', time '11:00', 1, $3,
               '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 18,
               'fixture@example.com', 'fixture-v1', true)
     returning id`,
    [slug, `Fixture ${slug}`, capacity],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     values ($1, 'unaffiliated', 'Unaffiliated', 1700)`,
    [rows[0]!.id],
  );

  return rows[0]!.id;
}

interface Created {
  ok: true;
  purchase_id: string;
  amount_pence: number;
}

/** Hold a place, the way the form does. */
/**
 * **A distinct runner per call, because one entry per runner is a database rule now.**
 * `create_pending_purchase()` refuses a second entry for a runner already holding a live place
 * on the same event, keyed on name and date of birth — so a fixture that is always the same
 * person cannot hold two places, which several tests here need. The apostrophe stays in every
 * generated surname so the escaping it proves is still exercised on every call. Deterministic:
 * a counter, not a random value.
 */
let entrantSerial = 0;

async function hold(slug: string, email = 'fixture@example.com'): Promise<Created> {
  const rows = await query<{ result: Created | { ok: false; reason: string } }>(
    // `p_key` by name — it is the tenth parameter, past `p_preview`. See ADR-029.
    `select entries.create_pending_purchase(
       $1, 'unaffiliated', 'Grace O''Sullivan', $2, $3::jsonb, null, $4::jsonb, p_key => $5
     ) as result`,
    [
      slug,
      email,
      JSON.stringify([
        {
          first_name: 'Grace',
          last_name: `O'Sullivan-${(entrantSerial += 1)}`,
          date_of_birth: '1986-12-09',
          gender: 'female',
          club: null,
          emergency_contact_name: 'Margaret Hamilton',
          emergency_contact_phone: '0117 496 0000',
          // Required of a runner since ADR-025; `create_pending_purchase()` refuses without
          // one, and this helper throws on a refusal rather than reporting it.
          phone: '0117 496 0100',
        },
      ]),
      JSON.stringify({ entryTerms: true, medical: false }),
      ENTRY_KEY,
    ],
  );

  const result = rows[0]!.result;
  if (!result.ok) {
    throw new Error(`create_pending_purchase refused: ${result.reason}`);
  }
  return result;
}

interface HookResult {
  ok: boolean;
  outcome: string;
  applied: boolean;
  revived?: boolean;
  over_capacity?: boolean;
  expected_pence?: number;
  stripe_pence?: number;
}

interface HookOptions {
  client?: Client;
  key?: string;
  type?: string;
  sessionId?: string | null;
  reference?: string | null;
  amount?: number | null;
  currency?: string | null;
  paymentIntent?: string | null;
  eventId?: string | null;
}

function deliver(options: HookOptions = {}): Promise<HookResult> {
  const {
    client = db,
    key = KEY,
    type = 'checkout.session.completed',
    sessionId = 'cs_test_fixture',
    reference = null,
    amount = 1700,
    currency = 'gbp',
    paymentIntent = 'pi_test_fixture',
    eventId = 'evt_test_fixture',
  } = options;

  return client
    .query<{ result: HookResult }>(
      `select entries.record_checkout_event($1,$2,$3,$4,$5,$6,$7,$8) as result`,
      [key, type, sessionId, reference, amount, currency, paymentIntent, eventId],
    )
    .then(({ rows }) => rows[0]!.result);
}

interface PurchaseRow {
  status: string;
  paid_at: string | null;
  revived_at: string | null;
  attention: string | null;
  attention_at: string | null;
  attention_detail: Record<string, unknown> | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_event_id: string | null;
}

const purchase = async (id: string): Promise<PurchaseRow> =>
  (
    await query<PurchaseRow>(
      `select status, paid_at, revived_at, attention, attention_at, attention_detail,
              stripe_payment_intent_id, stripe_checkout_session_id, stripe_event_id
         from entries.entry_purchases where id = $1`,
      [id],
    )
  )[0]!;

/** Push a hold into the past without waiting thirty-one minutes for it. */
const lapse = (id: string): Promise<unknown[]> =>
  query(
    `update entries.entry_purchases
        set hold_expires_at = pg_catalog.now() - interval '5 minutes'
      where id = $1`,
    [id],
  );

// -----------------------------------------------------------------------------------------
// The key
// -----------------------------------------------------------------------------------------

describe('the shared key, which is what makes an anon grant safe here', () => {
  it('refuses a wrong key with ok:false and writes nothing', async () => {
    // **The attack this closes.** `create_pending_purchase` is granted to anon and returns a
    // real purchase id and the amount it computed — and the anon key is published in page
    // source. Without a second factor, two ordinary PostgREST calls would buy a free entry.
    await seedEvent(`${FIXTURE_PREFIX}key`);
    const held = await hold(`${FIXTURE_PREFIX}key`);

    const result = await deliver({ key: 'not-the-key', reference: held.purchase_id });

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('unauthorised');
    // `ok: false` rather than `ok: true`, because the Worker turns it into a 5xx and Stripe
    // retries. A key that is wrong because nobody has installed the digest yet is a deployment
    // state, and the payments in that window belong in Stripe's retry queue.
    expect((await purchase(held.purchase_id)).status).toBe('pending');
  });

  it('refuses a null key', async () => {
    await seedEvent(`${FIXTURE_PREFIX}nullkey`);
    const held = await hold(`${FIXTURE_PREFIX}nullkey`);

    const rows = await query<{ result: HookResult }>(
      `select entries.record_checkout_event(
         null, 'checkout.session.completed', 'cs_x', $1, 1700, 'gbp', 'pi_x', 'evt_x'
       ) as result`,
      [held.purchase_id],
    );

    expect(rows[0]!.result.outcome).toBe('unauthorised');
    expect((await purchase(held.purchase_id)).status).toBe('pending');
  });

  it('refuses everything while no digest is installed, which is how it ships', async () => {
    // The seeded row has a null digest. That is a real, safe state — the same shape as
    // `STRIPE_SECRET_KEY` being unset — and it must refuse rather than wave everything through.
    await query(
      `update entries.webhook_secrets set key_sha256 = null where name = 'stripe'`,
    );

    await seedEvent(`${FIXTURE_PREFIX}nodigest`);
    const held = await hold(`${FIXTURE_PREFIX}nodigest`);

    expect((await deliver({ reference: held.purchase_id })).outcome).toBe('unauthorised');
    expect((await purchase(held.purchase_id)).status).toBe('pending');
  });

  it('is checked before the purchase is looked up', async () => {
    // A wrong key must not become an oracle for which purchase ids exist. Both a real id and
    // a fabricated one answer identically.
    await seedEvent(`${FIXTURE_PREFIX}oracle`);
    const held = await hold(`${FIXTURE_PREFIX}oracle`);

    const real = await deliver({ key: 'wrong', reference: held.purchase_id });
    const fake = await deliver({
      key: 'wrong',
      reference: '00000000-0000-4000-8000-000000000000',
    });
    const nonsense = await deliver({ key: 'wrong', reference: 'not-a-uuid' });

    expect(real).toEqual(fake);
    expect(real).toEqual(nonsense);
  });
});

// -----------------------------------------------------------------------------------------
// The transition, and doing it twice
// -----------------------------------------------------------------------------------------

describe('a completed event for a live hold', () => {
  it('moves it to paid and records everything the club will need', async () => {
    await seedEvent(`${FIXTURE_PREFIX}paid`);
    const held = await hold(`${FIXTURE_PREFIX}paid`);

    const result = await deliver({ reference: held.purchase_id });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'applied',
      applied: true,
      revived: false,
      over_capacity: false,
    });

    const row = await purchase(held.purchase_id);
    expect(row.status).toBe('paid');
    expect(row.paid_at).not.toBeNull();
    expect(row.revived_at).toBeNull();
    expect(row.attention).toBeNull();
    // The treasurer's only join key to a Stripe payments export.
    expect(row.stripe_payment_intent_id).toBe('pi_test_fixture');
    // Backfilled, because `attach_checkout_session` is best-effort and may have missed.
    expect(row.stripe_checkout_session_id).toBe('cs_test_fixture');
    // Evidence for a post-mortem, never a key.
    expect(row.stripe_event_id).toBe('evt_test_fixture');
  });

  it('is idempotent — the same event twice leaves one paid purchase', async () => {
    // **Stripe retries on any non-2xx and can duplicate regardless.** The second delivery must
    // change nothing and must say so, which is what lets the Worker answer 200 rather than
    // inventing a second confirmation.
    await seedEvent(`${FIXTURE_PREFIX}dup`);
    const held = await hold(`${FIXTURE_PREFIX}dup`);

    const first = await deliver({ reference: held.purchase_id });
    const before = await purchase(held.purchase_id);

    const second = await deliver({ reference: held.purchase_id });
    const after = await purchase(held.purchase_id);

    expect(first).toMatchObject({ outcome: 'applied', applied: true });
    expect(second).toMatchObject({ ok: true, outcome: 'already_paid', applied: false });

    // Not merely "still paid" — **byte for byte the same row**, so a repeat cannot quietly
    // re-stamp `paid_at` and make the club's record of when it learned move about.
    expect(after).toEqual(before);

    const rows = await query<{ n: number }>(
      `select count(*)::int as n from entries.entry_purchases
        where event_id = (select id from entries.events where slug = $1) and status = 'paid'`,
      [`${FIXTURE_PREFIX}dup`],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('is idempotent under two simultaneous deliveries on separate connections', async () => {
    // The interleaving the state guard exists for. Two real connections, one `Promise.all`,
    // so they genuinely overlap rather than merely being written next to each other.
    await seedEvent(`${FIXTURE_PREFIX}race`);
    const held = await hold(`${FIXTURE_PREFIX}race`);

    const clients = [
      new Client({ connectionString: LOCAL_DB }),
      new Client({ connectionString: LOCAL_DB }),
    ];
    await Promise.all(clients.map((client) => client.connect()));

    try {
      const results = await Promise.all(
        clients.map((client) => deliver({ client, reference: held.purchase_id })),
      );

      // **Exactly one applied.** Which one is undecidable and does not matter; that there is
      // one is the whole property.
      expect(results.filter((result) => result.applied)).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'already_paid')).toHaveLength(
        1,
      );
      expect(results.every((result) => result.ok)).toBe(true);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    expect((await purchase(held.purchase_id)).status).toBe('paid');
  });
});

// -----------------------------------------------------------------------------------------
// Only pending and expired may become paid
// -----------------------------------------------------------------------------------------

describe('what may and may not become paid', () => {
  it('never resurrects a refunded purchase, and tells a human instead', async () => {
    // A webhook does not undo a person. Somebody at the club refunded this; a late completed
    // event must not put it back.
    await seedEvent(`${FIXTURE_PREFIX}refund`);
    const held = await hold(`${FIXTURE_PREFIX}refund`);
    await query(
      `update entries.entry_purchases set status = 'refunded', paid_at = null where id = $1`,
      [held.purchase_id],
    );

    const result = await deliver({ reference: held.purchase_id });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'paid_after_refund',
      applied: false,
    });

    const row = await purchase(held.purchase_id);
    expect(row.status).toBe('refunded');
    expect(row.attention).toBe('paid_after_refund');
  });

  it('never demotes a paid purchase when an expiry event arrives late', async () => {
    // Out-of-order delivery. The transition is monotone: an `expired` for a session that was
    // in fact paid must not undo it, or somebody who paid loses their place to a message that
    // arrived in the wrong order.
    await seedEvent(`${FIXTURE_PREFIX}late`);
    const held = await hold(`${FIXTURE_PREFIX}late`);
    await deliver({ reference: held.purchase_id });

    const result = await deliver({
      reference: held.purchase_id,
      type: 'checkout.session.expired',
    });

    expect(result).toMatchObject({ ok: true, outcome: 'already_paid', applied: false });
    expect((await purchase(held.purchase_id)).status).toBe('paid');
  });

  it('expires a pending hold when Stripe says the session expired', async () => {
    // Belt and braces: the five-minute sweep already does this. Both must be safe, and safe to
    // run in either order.
    await seedEvent(`${FIXTURE_PREFIX}exp`);
    const held = await hold(`${FIXTURE_PREFIX}exp`);

    const first = await deliver({
      reference: held.purchase_id,
      type: 'checkout.session.expired',
    });
    const second = await deliver({
      reference: held.purchase_id,
      type: 'checkout.session.expired',
    });

    expect(first).toMatchObject({ outcome: 'expired', applied: true });
    expect(second).toMatchObject({ outcome: 'ignored', applied: false });
    expect((await purchase(held.purchase_id)).status).toBe('expired');
  });

  it('leaves a purchase alone when the event names a different session', async () => {
    await seedEvent(`${FIXTURE_PREFIX}mismatch`);
    const held = await hold(`${FIXTURE_PREFIX}mismatch`);
    await query(`select entries.attach_checkout_session($1, 'cs_test_theirs')`, [
      held.purchase_id,
    ]);

    const result = await deliver({
      reference: held.purchase_id,
      sessionId: 'cs_test_mine',
    });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'session_mismatch',
      applied: false,
    });

    const row = await purchase(held.purchase_id);
    expect(row.status).toBe('pending');
    expect(row.attention).toBe('session_conflict');
  });
});

// -----------------------------------------------------------------------------------------
// Events that are not ours
// -----------------------------------------------------------------------------------------

describe('events for payments this club did not take', () => {
  // **This Stripe account may also carry the club's England Athletics portal payments**, so
  // events will arrive for sessions this code never created. Every one of these must be
  // `ok: true`, because the Worker turns `ok: false` into a retry — and retrying forever on
  // somebody else's payment is how an endpoint gets disabled.

  it('answers not_ours for a client_reference_id that is not a uuid', async () => {
    expect(await deliver({ reference: 'ea-portal-12345' })).toMatchObject({
      ok: true,
      outcome: 'not_ours',
      applied: false,
    });
  });

  it('answers not_ours for a uuid naming no purchase of ours', async () => {
    expect(
      await deliver({ reference: '00000000-0000-4000-8000-000000000000' }),
    ).toMatchObject({ ok: true, outcome: 'not_ours' });
  });

  it('answers not_ours for a null client_reference_id', async () => {
    expect(await deliver({ reference: null })).toMatchObject({
      ok: true,
      outcome: 'not_ours',
    });
  });

  it('ignores an event type it does not act on', async () => {
    await seedEvent(`${FIXTURE_PREFIX}other`);
    const held = await hold(`${FIXTURE_PREFIX}other`);

    const result = await deliver({
      reference: held.purchase_id,
      type: 'payment_intent.succeeded',
    });

    expect(result).toMatchObject({ ok: true, outcome: 'ignored', applied: false });
    expect((await purchase(held.purchase_id)).status).toBe('pending');
  });
});

// -----------------------------------------------------------------------------------------
// The amount
// -----------------------------------------------------------------------------------------

describe('the amount and the currency, which should never disagree', () => {
  it('refuses to mark paid when the amount does not match, and flags it', async () => {
    await seedEvent(`${FIXTURE_PREFIX}amount`);
    const held = await hold(`${FIXTURE_PREFIX}amount`);

    const result = await deliver({ reference: held.purchase_id, amount: 1500 });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'amount_mismatch',
      applied: false,
      expected_pence: 1700,
      stripe_pence: 1500,
    });

    const row = await purchase(held.purchase_id);
    // **Not paid.** Something happened nobody anticipated, and the answer is a person rather
    // than a guess about which number was right.
    expect(row.status).toBe('pending');
    expect(row.attention).toBe('amount_mismatch');
    expect(row.attention_detail).toMatchObject({
      expected_pence: 1700,
      stripe_pence: 1500,
      stripe_currency: 'gbp',
    });
  });

  it('refuses a currency that is not sterling', async () => {
    // `adaptive_pricing[enabled]=false` is set at session creation precisely so nobody is
    // charged a converted amount at a rate nobody here chose. This is what proves that setting
    // is still doing its job — otherwise the treasurer finds the difference months later.
    await seedEvent(`${FIXTURE_PREFIX}ccy`);
    const held = await hold(`${FIXTURE_PREFIX}ccy`);

    expect(await deliver({ reference: held.purchase_id, currency: 'usd' })).toMatchObject(
      { outcome: 'amount_mismatch', applied: false },
    );
    expect((await purchase(held.purchase_id)).status).toBe('pending');
  });

  it('refuses a missing currency rather than assuming sterling', async () => {
    await seedEvent(`${FIXTURE_PREFIX}nullccy`);
    const held = await hold(`${FIXTURE_PREFIX}nullccy`);

    expect(await deliver({ reference: held.purchase_id, currency: null })).toMatchObject({
      outcome: 'amount_mismatch',
      applied: false,
    });
  });

  it('refuses a missing amount rather than trusting the signature alone', async () => {
    await seedEvent(`${FIXTURE_PREFIX}nullamt`);
    const held = await hold(`${FIXTURE_PREFIX}nullamt`);

    expect(await deliver({ reference: held.purchase_id, amount: null })).toMatchObject({
      outcome: 'amount_mismatch',
      applied: false,
    });
  });

  it('does not re-stamp the flag when Stripe retries the same mismatch', async () => {
    // **First raise wins.** `attention_at` is what the cron ages, and an anomaly that is
    // permanently "0 hours old" never reads as urgent.
    await seedEvent(`${FIXTURE_PREFIX}restamp`);
    const held = await hold(`${FIXTURE_PREFIX}restamp`);

    await deliver({ reference: held.purchase_id, amount: 1500 });
    const first = await purchase(held.purchase_id);

    await query(
      `update entries.entry_purchases
          set attention_at = attention_at - interval '3 hours' where id = $1`,
      [held.purchase_id],
    );
    const aged = await purchase(held.purchase_id);

    await deliver({ reference: held.purchase_id, amount: 1500 });

    expect(first.attention_at).not.toBeNull();
    expect((await purchase(held.purchase_id)).attention_at).toEqual(aged.attention_at);
  });
});

// -----------------------------------------------------------------------------------------
// The revival — the case the brief called out, and the one that costs somebody money
// -----------------------------------------------------------------------------------------

describe('a payment that arrives after the hold has lapsed', () => {
  it('pays a lapsed hold the sweep has not reached, and records the revival', async () => {
    // **The test is the capacity predicate, not `status = 'expired'`.** A pending row whose
    // hold ran out four minutes ago is already gone as far as capacity is concerned, whether
    // or not the five-minute cron has touched it. Keying on `expired` would make the webhook's
    // correctness depend on a scheduler.
    await seedEvent(`${FIXTURE_PREFIX}lapsed`);
    const held = await hold(`${FIXTURE_PREFIX}lapsed`);
    await lapse(held.purchase_id);

    const result = await deliver({ reference: held.purchase_id });

    expect(result).toMatchObject({ outcome: 'applied', applied: true, revived: true });

    const row = await purchase(held.purchase_id);
    expect(row.status).toBe('paid');
    expect(row.revived_at).not.toBeNull();
    // Room was available, so nobody needs to do anything about it.
    expect(row.attention).toBeNull();
  });

  it('pays a purchase the sweep has already expired', async () => {
    await seedEvent(`${FIXTURE_PREFIX}swept`);
    const held = await hold(`${FIXTURE_PREFIX}swept`);
    await lapse(held.purchase_id);
    await query('select entries.expire_pending_holds()');

    expect((await purchase(held.purchase_id)).status).toBe('expired');

    const result = await deliver({ reference: held.purchase_id });

    expect(result).toMatchObject({ outcome: 'applied', applied: true, revived: true });
    expect((await purchase(held.purchase_id)).status).toBe('paid');
  });

  it('keeps hold_expires_at, which is what says the payment was late', async () => {
    // Slice A's column comment said this was nulled once paid. Nothing ever nulled it and
    // nothing should: `paid_at > hold_expires_at` is the only record that a payment arrived
    // after its hold.
    await seedEvent(`${FIXTURE_PREFIX}keephold`);
    const held = await hold(`${FIXTURE_PREFIX}keephold`);
    await lapse(held.purchase_id);
    await deliver({ reference: held.purchase_id });

    const rows = await query<{ late: boolean }>(
      `select paid_at > hold_expires_at as late from entries.entry_purchases where id = $1`,
      [held.purchase_id],
    );

    expect(rows[0]!.late).toBe(true);
  });

  it('takes the money when there is no room, flags it loudly, and consumes a place', async () => {
    // **The decision this slice had to take.** The money is never refused: refusing leaves the
    // club holding a payment with nothing against it, which is worse than every alternative.
    // So it becomes `paid` — the same status as every other payment, so the existing capacity
    // predicate counts it — and `attention` is what says a human must decide.
    await seedEvent(`${FIXTURE_PREFIX}over`, 1);

    const late = await hold(`${FIXTURE_PREFIX}over`, 'late@example.com');
    await lapse(late.purchase_id);

    // Somebody else took the place while the first person was paying.
    const other = await hold(`${FIXTURE_PREFIX}over`, 'other@example.com');
    await deliver({ reference: other.purchase_id, sessionId: 'cs_test_other' });

    const result = await deliver({ reference: late.purchase_id });

    expect(result).toMatchObject({
      ok: true,
      outcome: 'applied',
      applied: true,
      revived: true,
      over_capacity: true,
    });

    const row = await purchase(late.purchase_id);
    // **No fifth status.** A new status value would be invisible to the capacity predicate
    // inside `create_pending_purchase`, so the oversold place would read as free and be sold
    // to a second person.
    expect(row.status).toBe('paid');
    expect(row.attention).toBe('over_capacity');
    expect(row.attention_detail).toMatchObject({ capacity: 1, taken: 1, wanted: 1 });
  });

  it('counts the over-capacity place, so raising capacity by one resolves exactly one person', async () => {
    // **Counting is self-limiting; not counting compounds.** The committee's likely remedy is
    // "fine, take 251". If the row did not count, that raise would open the extra place to the
    // internet instead of resolving the person who already paid — and the fix would re-oversell
    // the race.
    await seedEvent(`${FIXTURE_PREFIX}counts`, 1);

    const late = await hold(`${FIXTURE_PREFIX}counts`, 'late@example.com');
    await lapse(late.purchase_id);
    const other = await hold(`${FIXTURE_PREFIX}counts`, 'other@example.com');
    await deliver({ reference: other.purchase_id, sessionId: 'cs_test_other' });
    await deliver({ reference: late.purchase_id });

    // Two paid places against a capacity of one. A third person is refused.
    await expect(hold(`${FIXTURE_PREFIX}counts`, 'third@example.com')).rejects.toThrow(
      /sold_out/,
    );

    // Raise capacity to two — the club deciding to take the extra runner — and the field is
    // exactly full rather than a place short or a place over.
    await query('update entries.events set capacity = 2 where slug = $1', [
      `${FIXTURE_PREFIX}counts`,
    ]);
    await expect(hold(`${FIXTURE_PREFIX}counts`, 'fourth@example.com')).rejects.toThrow(
      /sold_out/,
    );
  });

  it('does not report an ordinary payment as over capacity', async () => {
    // The row being paid is excluded from its own capacity count. Without that exclusion it
    // would be counted twice — once as a live hold and once as the place being asked for — and
    // **every single payment** would raise the alarm.
    await seedEvent(`${FIXTURE_PREFIX}exclude`, 1);
    const held = await hold(`${FIXTURE_PREFIX}exclude`);

    const result = await deliver({ reference: held.purchase_id });

    expect(result).toMatchObject({ applied: true, over_capacity: false });
    expect((await purchase(held.purchase_id)).attention).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------
// Reconciliation
// -----------------------------------------------------------------------------------------

describe('a paid purchase the treasurer could not reconcile', () => {
  it('is paid anyway and flagged when Stripe sent no payment intent', async () => {
    // The signature said the money is real, so refusing it would be the wrong trade. But a
    // paid row with no payment intent cannot be joined to a Stripe payments export, which is
    // the treasurer's only reconciliation key — so it is the one row a check would silently
    // miss, and it says so.
    await seedEvent(`${FIXTURE_PREFIX}nopi`);
    const held = await hold(`${FIXTURE_PREFIX}nopi`);

    const result = await deliver({ reference: held.purchase_id, paymentIntent: null });

    expect(result).toMatchObject({ outcome: 'applied', applied: true });

    const row = await purchase(held.purchase_id);
    expect(row.status).toBe('paid');
    expect(row.attention).toBe('no_payment_intent');
  });
});

// -----------------------------------------------------------------------------------------
// The sweep, which is the alarm
// -----------------------------------------------------------------------------------------

describe('entries.expire_pending_holds(), now also the alarm channel', () => {
  it('reports how many purchases are waiting for a human, and for how long', async () => {
    await seedEvent(`${FIXTURE_PREFIX}alarm`);
    const held = await hold(`${FIXTURE_PREFIX}alarm`);
    await deliver({ reference: held.purchase_id, amount: 1 });

    await query(
      `update entries.entry_purchases
          set attention_at = attention_at - interval '26 hours' where id = $1`,
      [held.purchase_id],
    );

    const rows = await query<{
      result: { expired: number; attention: number; attention_oldest_hours: number };
    }>('select entries.expire_pending_holds() as result');

    expect(rows[0]!.result.attention).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.result.attention_oldest_hours).toBeGreaterThanOrEqual(26);
  });

  it('goes quiet only when somebody resolves it, never with time', async () => {
    // **An alarm silenced by the calendar goes quiet exactly when both volunteers are away**,
    // which is when an alarm is for. The only thing that clears it is a person.
    await seedEvent(`${FIXTURE_PREFIX}resolve`);
    const held = await hold(`${FIXTURE_PREFIX}resolve`);
    await deliver({ reference: held.purchase_id, amount: 1 });

    const before = await query<{ result: { attention: number } }>(
      'select entries.expire_pending_holds() as result',
    );
    expect(before[0]!.result.attention).toBeGreaterThanOrEqual(1);

    // A year is not enough. Somebody setting `attention_resolved_at` is.
    await query(
      `update entries.entry_purchases
          set attention_at = attention_at - interval '365 days' where id = $1`,
      [held.purchase_id],
    );
    const stillLoud = await query<{ result: { attention: number } }>(
      'select entries.expire_pending_holds() as result',
    );
    expect(stillLoud[0]!.result.attention).toBeGreaterThanOrEqual(1);

    await query(
      `update entries.entry_purchases
          set attention_resolved_at = pg_catalog.now() where id = $1`,
      [held.purchase_id],
    );

    const rows = await query<{ n: number }>(
      `select count(*)::int as n from entries.entry_purchases
        where id = $1 and attention is not null and attention_resolved_at is null`,
      [held.purchase_id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('still returns the expired count the deployed Worker reads', async () => {
    // Expand, migrate, contract: the Slice B Worker parses this with a non-strict Zod object,
    // which strips unknown keys. The key it reads must not have moved.
    await seedEvent(`${FIXTURE_PREFIX}sweep`);
    const held = await hold(`${FIXTURE_PREFIX}sweep`);
    await lapse(held.purchase_id);

    const rows = await query<{ result: { expired: number } }>(
      'select entries.expire_pending_holds() as result',
    );

    expect(rows[0]!.result.expired).toBeGreaterThanOrEqual(1);
    expect((await purchase(held.purchase_id)).status).toBe('expired');
  });
});

// -----------------------------------------------------------------------------------------
// The read path
// -----------------------------------------------------------------------------------------

describe('entries.entry_completion_state(), and everything it refuses to say', () => {
  it('returns one key and one key only', async () => {
    // **A session id in a URL is not authentication.** It is in the address bar, in history,
    // in a screenshot. This function is written as though the string were public, and the
    // shape of the answer is what enforces that — there is no field for a name to arrive in.
    await seedEvent(`${FIXTURE_PREFIX}shape`);
    const held = await hold(`${FIXTURE_PREFIX}shape`);
    await query(`select entries.attach_checkout_session($1, 'cs_test_shape')`, [
      held.purchase_id,
    ]);

    const rows = await query<{ result: Record<string, unknown> }>(
      'select entries.entry_completion_state($1) as result',
      ['cs_test_shape'],
    );

    expect(Object.keys(rows[0]!.result)).toEqual(['state']);
  });

  it('reads paid, pending, lapsed, refunded and unknown', async () => {
    await seedEvent(`${FIXTURE_PREFIX}states`, 10);

    const state = async (session: string | null): Promise<string> =>
      (
        await query<{ result: { state: string } }>(
          'select entries.entry_completion_state($1) as result',
          [session],
        )
      )[0]!.result.state;

    const paid = await hold(`${FIXTURE_PREFIX}states`, 'paid@example.com');
    await deliver({ reference: paid.purchase_id, sessionId: 'cs_test_paid' });
    expect(await state('cs_test_paid')).toBe('paid');

    const pending = await hold(`${FIXTURE_PREFIX}states`, 'pending@example.com');
    await query(`select entries.attach_checkout_session($1, 'cs_test_pending')`, [
      pending.purchase_id,
    ]);
    expect(await state('cs_test_pending')).toBe('pending');

    // **A lapsed hold the sweep has not reached must read the same as one it has.** The
    // difference between them is a scheduler, not a fact about anybody's payment.
    const lapsed = await hold(`${FIXTURE_PREFIX}states`, 'lapsed@example.com');
    await query(`select entries.attach_checkout_session($1, 'cs_test_lapsed')`, [
      lapsed.purchase_id,
    ]);
    await lapse(lapsed.purchase_id);
    expect(await state('cs_test_lapsed')).toBe('lapsed');
    await query('select entries.expire_pending_holds()');
    expect(await state('cs_test_lapsed')).toBe('lapsed');

    const refunded = await hold(`${FIXTURE_PREFIX}states`, 'refunded@example.com');
    await query(`select entries.attach_checkout_session($1, 'cs_test_refunded')`, [
      refunded.purchase_id,
    ]);
    await query(
      `update entries.entry_purchases set status = 'refunded', paid_at = null where id = $1`,
      [refunded.purchase_id],
    );
    expect(await state('cs_test_refunded')).toBe('refunded');
  });

  it('says unknown for anything it cannot match, and never null', async () => {
    // A scalar subquery matching no row yields SQL NULL, which would reach the Worker as an
    // unrecognised shape and degrade a page with somebody waiting on it. The `coalesce` is
    // what makes all four of these one answer.
    const state = async (session: string | null): Promise<{ state: string }> =>
      (
        await query<{ result: { state: string } }>(
          'select entries.entry_completion_state($1) as result',
          [session],
        )
      )[0]!.result;

    expect(await state('cs_test_never_existed')).toEqual({ state: 'unknown' });
    expect(await state('')).toEqual({ state: 'unknown' });
    expect(await state('   ')).toEqual({ state: 'unknown' });
    expect(await state(null)).toEqual({ state: 'unknown' });
  });

  it('does not tell anybody that a payment was over capacity', async () => {
    // **A judgement call, and it ships flagged as one.** The page says `paid`, which is true.
    // Telling a runner from a web page that they may not have a place produces the phone call
    // the alarm exists to prevent, before the club has decided anything.
    await seedEvent(`${FIXTURE_PREFIX}quiet`, 1);
    const late = await hold(`${FIXTURE_PREFIX}quiet`, 'late@example.com');
    await lapse(late.purchase_id);
    const other = await hold(`${FIXTURE_PREFIX}quiet`, 'other@example.com');
    await deliver({ reference: other.purchase_id, sessionId: 'cs_test_other' });
    await deliver({ reference: late.purchase_id, sessionId: 'cs_test_late' });

    expect((await purchase(late.purchase_id)).attention).toBe('over_capacity');

    const rows = await query<{ result: Record<string, unknown> }>(
      'select entries.entry_completion_state($1) as result',
      ['cs_test_late'],
    );

    expect(rows[0]!.result).toEqual({ state: 'paid' });
  });
});

// -----------------------------------------------------------------------------------------
// Where the two paths meet
// -----------------------------------------------------------------------------------------

describe('a revival racing a fresh entry for the last place', () => {
  it('lets exactly one of them have it', async () => {
    // **The reason `record_checkout_event` takes the same advisory lock literal as
    // `create_pending_purchase`.** The revival reads the capacity count and then writes, which
    // is the identical count-then-insert race the entry path solved in 2023's shape. If the
    // webhook took a *different* lock it would serialise webhooks against webhooks and nothing
    // else, and a revival and a live entry would each take the last place.
    //
    // Nothing else in the suite would catch somebody tidying the literal in one function and
    // not the other, which is exactly why this test exists. It asserts the *outcome* — one
    // place given away — rather than the lock, because the lock is a means.
    await seedEvent(`${FIXTURE_PREFIX}contend`, 1);

    const late = await hold(`${FIXTURE_PREFIX}contend`, 'late@example.com');
    await lapse(late.purchase_id);

    const clients = [
      new Client({ connectionString: LOCAL_DB }),
      new Client({ connectionString: LOCAL_DB }),
    ];
    await Promise.all(clients.map((client) => client.connect()));

    try {
      const [revival, fresh] = await Promise.all([
        deliver({ client: clients[0]!, reference: late.purchase_id }),
        clients[1]!
          .query<{ result: { ok: boolean; reason?: string } }>(
            `select entries.create_pending_purchase(
               $1, 'unaffiliated', 'Ada Lovelace', 'fresh@example.com', $2::jsonb, null,
               $3::jsonb, p_key => $4
             ) as result`,
            [
              `${FIXTURE_PREFIX}contend`,
              JSON.stringify([
                {
                  first_name: 'Ada',
                  last_name: 'Lovelace',
                  date_of_birth: '1986-12-09',
                  gender: 'female',
                  emergency_contact_name: 'Margaret Hamilton',
                  emergency_contact_phone: '0117 496 0000',
                  phone: '0117 496 0100',
                },
              ]),
              JSON.stringify({ entryTerms: true, medical: false }),
              ENTRY_KEY,
            ],
          )
          .then(({ rows }) => rows[0]!.result),
      ]);

      // **The revival always wins the money argument**: it is paid either way. What is being
      // asserted is that the two cannot *both* end up holding a place against a capacity of
      // one without somebody being told. Either the fresh entry was refused as sold out, or it
      // got in and the revival is flagged over capacity — and never both silently succeeding.
      expect(revival.applied).toBe(true);

      const freshRefused = fresh.ok === false && fresh.reason === 'sold_out';
      const revivalFlagged = revival.over_capacity === true;

      expect(freshRefused || revivalFlagged).toBe(true);

      const counted = await query<{ n: number }>(
        `select count(*)::int as n
           from entries.entry_purchases p
           join entries.entrants e on e.purchase_id = p.id
          where p.event_id = (select id from entries.events where slug = $1)
            and (p.status = 'paid'
                 or (p.status = 'pending'
                     and (p.hold_expires_at is null or p.hold_expires_at > now())))`,
        [`${FIXTURE_PREFIX}contend`],
      );

      // One place, so at most one taker may go unremarked. If two are counted, one of them is
      // flagged — which is the whole guarantee: **the club finds out from the system.**
      if (counted[0]!.n > 1) {
        const flagged = await query<{ n: number }>(
          `select count(*)::int as n from entries.entry_purchases
            where event_id = (select id from entries.events where slug = $1)
              and attention is not null`,
          [`${FIXTURE_PREFIX}contend`],
        );
        expect(flagged[0]!.n).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });
});
