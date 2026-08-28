import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The email outbox — #73.
 *
 * **What this file is actually protecting.** The outbox exists so that a runner who paid is
 * always told, even when the provider is down or over its daily cap. Every property that
 * promise rests on is asserted here, and each one fails towards the runner:
 *
 *   * A committed payment always leaves a row. If the trigger did not fire, nothing else in
 *     the system would ever notice — there is no reconciliation between Stripe and the outbox.
 *   * A webhook delivered twice leaves **one** row. Stripe retries for three days.
 *   * A transfer leaves two rows, and the one addressed to the previous runner carries the
 *     address the transfer has just overwritten — which exists nowhere else afterwards.
 *   * `claim_outbox_batch` refuses without the key. It returns real email addresses, and the
 *     role it is granted to reaches Postgres with a key published in page source.
 *
 * **The negative cases are the ones that matter**, per the repository's own rule: that an
 * anonymous client *cannot* drain the queue proves more than that the Worker can.
 *
 * Every fixture is invented, with fixed uuids and `example.com` addresses, and every one is
 * removed afterwards. Surnames carry a serial because "one runner, one place" counts a live
 * place per person and a suite whose runners are all the same person cannot hold two.
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

/** The key the Worker's cron would hold. Installed in `beforeAll`, removed in `afterAll`. */
const DRAIN_KEY = 'outbox-test-key-never-a-real-one';

const EVENT_ID = '0e0e0e0e-7300-4000-8000-000000000001';
const EVENT_SLUG = 'zz-outbox-demo';

const digest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db.query(sql, values);
  return result.rows as T[];
}

/**
 * A paid-for place, built the way the entry path builds one: a `pending` purchase with a live
 * hold and one entrant, and nothing else. The transition into `paid` is what each test then
 * performs, because **that transition is the thing under test** — writing a row that is
 * already `paid` would never fire the trigger and every assertion here would pass vacuously.
 */
async function makePendingPurchase(serial: number): Promise<string> {
  const purchaseId = randomUUID();

  // `fee_id` rather than a code: the purchase references the `entries.fees` row, so the price
  // it was sold at cannot drift from the price the event offered.
  const [fee] = await query<{ id: string }>(
    `select id from entries.fees where event_id = $1 and code = 'unaffiliated'`,
    [EVENT_ID],
  );

  await query(
    `insert into entries.entry_purchases
       (id, event_id, purchaser_email, purchaser_name, fee_id, amount_pence, status,
        hold_expires_at, consents, consent_version)
     values ($1, $2, $3, 'Outbox Fixture', $4, 2000, 'pending',
             now() + interval '30 minutes',
             '{"entryTerms": true}'::jsonb, 'nn-2026-v1')`,
    [purchaseId, EVENT_ID, `outbox-${serial}@example.com`, fee!.id],
  );

  // **A serial on the surname**, because "one runner, one place" counts a live place per
  // person and a suite whose runners are all the same person cannot hold two.
  await query(
    `insert into entries.entrants
       (purchase_id, first_name, last_name, date_of_birth, gender,
        emergency_contact_name, emergency_contact_phone)
     values ($1, 'Outbox', $2, date '1986-03-07', 'female',
             'Next Of Kin', '0117 496 0000')`,
    [purchaseId, `Fixture${serial}`],
  );

  return purchaseId;
}

const outboxFor = async (purchaseId: string) =>
  query<{ template: string; recipient: string; status: string; dedupe_key: string }>(
    `select template, recipient::text as recipient, status, dedupe_key
       from entries.email_outbox
      where purchase_id = $1
      order by template`,
    [purchaseId],
  );

beforeAll(async () => {
  await connected;

  // The drain reuses the Stripe webhook digest — see the migration's argument for why there is
  // not a second secret. Installed here and removed in `afterAll` whatever happens, so a
  // laptop is never left holding a working key for a test secret.
  await query(
    `update entries.webhook_secrets set key_sha256 = $1, updated_at = now()
      where name = 'stripe'`,
    [digest(DRAIN_KEY)],
  );

  await query(
    `insert into entries.events
       (id, slug, display_name, race_slug, event_date, start_time, entrants_per_entry,
        capacity, minimum_age, requires_dob, from_address, consent_version, active)
     values ($1, $2, 'Outbox Fixture Race 2026', 'zz-outbox', date '2026-12-06',
             time '10:30', 1, 20, 18, true, 'fixture@example.com', 'nn-2026-v1', true)
     on conflict (slug) do nothing`,
    [EVENT_ID, EVENT_SLUG],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     values ($1, 'unaffiliated', 'Unaffiliated', 2000)
     on conflict do nothing`,
    [EVENT_ID],
  );
});

afterAll(async () => {
  await query(`delete from entries.entry_purchases where event_id = $1`, [EVENT_ID]);
  await query(`delete from entries.events where id = $1`, [EVENT_ID]);
  await query(
    `update entries.webhook_secrets set key_sha256 = null where name = 'stripe'`,
  );
  await db.end();
});

// -----------------------------------------------------------------------------------------
// The trigger — what the club comes to owe, and when
// -----------------------------------------------------------------------------------------

describe('entries.enqueue_entry_email(), the trigger that owes the message', () => {
  it('owes a confirmation the moment a hold becomes paid', async () => {
    const purchaseId = await makePendingPurchase(1);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const rows = await outboxFor(purchaseId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      template: 'entry_confirmed',
      recipient: 'outbox-1@example.com',
      status: 'pending',
    });
  });

  it('owes exactly one confirmation however many times the webhook is delivered', async () => {
    // **Stripe retries for three days.** `record_checkout_event()` guards its own transition
    // with `status in ('pending','expired')`, so a second delivery updates nothing and the
    // trigger never fires again — but this asserts the belt as well as the braces, by running
    // the transition twice at the statement level.
    const purchaseId = await makePendingPurchase(2);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now()
        where id = $1 and status in ('pending', 'expired')`,
      [purchaseId],
    );
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now()
        where id = $1 and status in ('pending', 'expired')`,
      [purchaseId],
    );

    expect(await outboxFor(purchaseId)).toHaveLength(1);
  });

  it('owes nothing at all for a hold that lapsed without being paid', async () => {
    const purchaseId = await makePendingPurchase(3);

    await query(`update entries.entry_purchases set status = 'expired' where id = $1`, [
      purchaseId,
    ]);

    expect(await outboxFor(purchaseId)).toEqual([]);
  });

  it('owes a refund message when a paid place is refunded', async () => {
    const purchaseId = await makePendingPurchase(4);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );
    await query(
      `update entries.entry_purchases set status = 'refunded', paid_at = null where id = $1`,
      [purchaseId],
    );

    const rows = await outboxFor(purchaseId);

    expect(rows.map((row) => row.template)).toEqual([
      'entry_confirmed',
      'entry_refunded',
    ]);
  });

  it('still owes the refund message after the entrant has been deleted', async () => {
    // **This is the case the whole design turns on.** `cancel_entry()` deletes the entrants,
    // so a message built by joining to one would have nobody to send to. The recipient comes
    // from the purchase, which survives.
    const purchaseId = await makePendingPurchase(5);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );
    await query(`delete from entries.entrants where purchase_id = $1`, [purchaseId]);
    await query(
      `update entries.entry_purchases set status = 'refunded', paid_at = null where id = $1`,
      [purchaseId],
    );

    const rows = await outboxFor(purchaseId);
    const refund = rows.find((row) => row.template === 'entry_refunded');

    expect(refund).toBeDefined();
    expect(refund?.recipient).toBe('outbox-5@example.com');
  });

  it('owes both sides of a transfer, and keeps the address the transfer overwrote', async () => {
    // **The previous runner's address exists nowhere else after this statement.**
    // `transfer_entry()` re-points `purchaser_email` at the new person, so `old` inside the
    // trigger is the only place it survives — which is precisely why this is a trigger and
    // not a send built later from the resulting row.
    const purchaseId = await makePendingPurchase(6);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );
    await query(`update entries.entry_purchases set purchaser_email = $2 where id = $1`, [
      purchaseId,
      'outbox-6-new@example.com',
    ]);

    const rows = await outboxFor(purchaseId);

    expect(rows.map((row) => row.template)).toEqual([
      'entry_confirmed',
      'entry_transferred_in',
      'entry_transferred_out',
    ]);

    expect(rows.find((row) => row.template === 'entry_transferred_out')?.recipient).toBe(
      'outbox-6@example.com',
    );
    expect(rows.find((row) => row.template === 'entry_transferred_in')?.recipient).toBe(
      'outbox-6-new@example.com',
    );
  });

  it('owes a second pair when a place changes hands twice', async () => {
    // A dedupe key of `(purchase_id, template)` would silently swallow this, and the person
    // the place moved to second would never be told they had it.
    const purchaseId = await makePendingPurchase(7);

    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );
    await query(`update entries.entry_purchases set purchaser_email = $2 where id = $1`, [
      purchaseId,
      'outbox-7-second@example.com',
    ]);
    await query(`update entries.entry_purchases set purchaser_email = $2 where id = $1`, [
      purchaseId,
      'outbox-7-third@example.com',
    ]);

    const rows = await outboxFor(purchaseId);

    expect(rows.filter((row) => row.template === 'entry_transferred_in')).toHaveLength(2);
    expect(rows.filter((row) => row.template === 'entry_transferred_out')).toHaveLength(
      2,
    );
  });
});

// -----------------------------------------------------------------------------------------
// The drain — and the key that makes an anon grant safe
// -----------------------------------------------------------------------------------------

describe('entries.claim_outbox_batch(), the fourteenth function anon may call', () => {
  it('refuses an anonymous caller with no key at all', async () => {
    const { data, error } = await anon
      .schema('entries')
      .rpc('claim_outbox_batch', { p_key: '' });

    // **Not an error — a refusal.** A Postgres error would mean the function is broken, which
    // reads as every rule holding at once. The specific answer is what is asserted.
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('refuses a wrong key, and discloses nothing about what is queued', async () => {
    await makePendingPurchase(8).then((id) =>
      query(
        `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
        [id],
      ),
    );

    const { data } = await anon
      .schema('entries')
      .rpc('claim_outbox_batch', { p_key: 'not-the-key' });

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
    // No `messages` key at all: a refused caller learns neither how many are queued nor that
    // any exist.
    expect((data as { messages?: unknown }).messages).toBeUndefined();
  });

  it('cannot be reached by selecting the table, whatever the key', async () => {
    const { error } = await anon.schema('entries').from('email_outbox').select('*');

    // RLS with no policy: the grant is what is missing, and this is the assertion that would
    // fail if somebody added one "just for the dashboard".
    expect(error).not.toBeNull();
  });

  it('hands over a claimed batch with the key, and counts the attempt', async () => {
    const purchaseId = await makePendingPurchase(9);
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const { data } = await anon
      .schema('entries')
      .rpc('claim_outbox_batch', { p_key: DRAIN_KEY, p_limit: 50 });

    const claimed = data as { ok: boolean; messages: { purchase_reference: string }[] };

    expect(claimed.ok).toBe(true);

    const mine = claimed.messages.find((row) => row.purchase_reference === purchaseId);

    expect(mine).toMatchObject({
      template: 'entry_confirmed',
      recipient: 'outbox-9@example.com',
      // Everything a message needs, joined at send time rather than copied into the queue.
      event_name: 'Outbox Fixture Race 2026',
      amount_pence: 2000,
      entrant_first_name: 'Outbox',
      reply_to: 'fixture@example.com',
      attempts: 1,
    });
  });

  it('gives an attempt back when the provider refused to look at the message', async () => {
    // **A capped day must not exhaust the three attempts every message gets.** Without this,
    // one busy afternoon would mark the entire overflow `failed` before Resend's cap reset.
    const purchaseId = await makePendingPurchase(10);
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const [row] = await query<{ id: string }>(
      `select id from entries.email_outbox where purchase_id = $1`,
      [purchaseId],
    );

    await anon
      .schema('entries')
      .rpc('claim_outbox_batch', { p_key: DRAIN_KEY, p_limit: 50 });

    await anon.schema('entries').rpc('record_send_result', {
      p_key: DRAIN_KEY,
      p_id: row!.id,
      p_ok: false,
      p_rate_limited: true,
    });

    const [after] = await query<{ status: string; attempts: number }>(
      `select status, attempts from entries.email_outbox where id = $1`,
      [row!.id],
    );

    expect(after).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('gives up at three attempts and marks the message failed', async () => {
    const purchaseId = await makePendingPurchase(11);
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const [row] = await query<{ id: string }>(
      `select id from entries.email_outbox where purchase_id = $1`,
      [purchaseId],
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await anon
        .schema('entries')
        .rpc('claim_outbox_batch', { p_key: DRAIN_KEY, p_limit: 50 });
      await anon.schema('entries').rpc('record_send_result', {
        p_key: DRAIN_KEY,
        p_id: row!.id,
        p_ok: false,
        p_error: 'http 422',
      });
    }

    const [after] = await query<{ status: string; last_error: string }>(
      `select status, last_error from entries.email_outbox where id = $1`,
      [row!.id],
    );

    expect(after).toMatchObject({ status: 'failed', last_error: 'http 422' });
  });

  it('refuses record_send_result without the key, so nothing can be marked sent', async () => {
    const purchaseId = await makePendingPurchase(12);
    await query(
      `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
      [purchaseId],
    );

    const [row] = await query<{ id: string }>(
      `select id from entries.email_outbox where purchase_id = $1`,
      [purchaseId],
    );

    const { data } = await anon.schema('entries').rpc('record_send_result', {
      p_key: 'not-the-key',
      p_id: row!.id,
      p_ok: true,
    });

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });

    const [after] = await query<{ status: string }>(
      `select status from entries.email_outbox where id = $1`,
      [row!.id],
    );

    // **The row is untouched.** A caller who could mark messages sent without the key could
    // silently stop every confirmation the club owes.
    expect(after?.status).toBe('pending');
  });
});
