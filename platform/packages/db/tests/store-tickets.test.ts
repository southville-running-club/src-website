import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

/**
 * Buying a ticket, end to end, against a real Postgres.
 *
 * `store.test.ts` proves what stays shut. **This file proves the door opens for the right
 * caller and only for them** — which is the half that a refusal test cannot cover, and the
 * half that would let a broken function pass as a working access control: a function that
 * refuses everything refuses correctly too.
 *
 * ## Everything here runs against a fabricated social, never the real one
 *
 * `christmas-party-2026` ships with every fact null and nothing on sale, and that is a state
 * worth keeping true in the suite as well as in production. These fixtures create their own
 * occasions with their own slugs and delete them again, so nothing in this file can leave the
 * real party looking like it has a date or a price.
 *
 * **The keys are test fixtures and nothing else.** The real ones are Worker secrets, never in
 * this repository. The digests ship null — which refuses everything — so a test that holds a
 * ticket is a test that has to install one first. That is deliberate: it keeps the refusal the
 * default in the suite as well as in production.
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

const ENTRY_KEY = 'test-store-entry-key-not-a-real-one';
const STRIPE_KEY = 'test-store-stripe-key-not-a-real-one';

const digest = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

/** Fixed and invented, so nothing here can collide with a real row. */
const OPEN = 'test-social-open';
const TINY = 'test-social-two-places';
const SHUT = 'test-social-shut';

const FIXTURES = [OPEN, TINY, SHUT];

/**
 * Remove the fixtures, purchases first.
 *
 * **`ticket_purchases.social_id` has no `on delete cascade`, deliberately** — an occasion with
 * money taken against it is not something to delete by removing its parent row, and the
 * restriction is the reminder. So a fixture has to take its own purchases out explicitly, which
 * is the schema behaving exactly as the migration says it should. The outbox rows *do* cascade
 * from the purchase, because a message about a purchase that no longer exists is a message
 * about nothing.
 */
async function removeFixtures(): Promise<void> {
  await db.query(
    `delete from store.ticket_purchases
      where social_id in (select id from store.socials where slug = any($1::text[]))`,
    [FIXTURES],
  );
  await db.query('delete from store.socials where slug = any($1::text[])', [FIXTURES]);
}

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/** One fabricated social with one £12 ticket type. `capacity` null means no limit. */
async function makeSocial(
  slug: string,
  options: { open: boolean; capacity?: number | null },
): Promise<void> {
  await query(
    `insert into store.socials (
       slug, display_name, reply_to, consent_version,
       social_date, start_time, end_time, venue, capacity,
       sales_open_at, sales_close_at, max_tickets_per_purchase,
       -- Explicit, because the column defaults to false: a fabricated social is hidden until
       -- published, exactly like a real one. Forgetting it makes every fixture here refuse
       -- with no_such_social, which is what happened the first time.
       published
     )
     values ($1, $2, 'info@example.com', 'test-v1',
             date '2026-12-05', time '19:30', time '01:00', 'The Example Rooms', $3,
             $4, $5, 6, true)`,
    [
      slug,
      `Fixture ${slug}`,
      options.capacity ?? null,
      options.open ? new Date(Date.now() - 3600_000).toISOString() : null,
      options.open ? new Date(Date.now() + 3600_000).toISOString() : null,
    ],
  );

  await query(
    `insert into store.ticket_types (social_id, code, label, price_pence)
     select id, 'standard', 'Standard ticket', 1200 from store.socials where slug = $1`,
    [slug],
  );
}

beforeAll(async () => {
  await connected;

  await db.query(
    `update store.api_secrets set key_sha256 = $2, updated_at = now() where name = $1`,
    ['entry', digest(ENTRY_KEY)],
  );
  await db.query(
    `update store.api_secrets set key_sha256 = $2, updated_at = now() where name = $1`,
    ['stripe', digest(STRIPE_KEY)],
  );

  await removeFixtures();

  await makeSocial(OPEN, { open: true });
  await makeSocial(TINY, { open: true, capacity: 2 });
  await makeSocial(SHUT, { open: false });
});

afterAll(async () => {
  await connected;
  await removeFixtures();

  // **Both digests go back to null**, which is the state the migration ships and the state
  // every other file in this suite expects to find. A suite that left a key installed would
  // make `store.test.ts`'s refusal tests pass for the wrong reason.
  await db.query('update store.api_secrets set key_sha256 = null');
  await db.end();
});

async function hold(
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await anon.schema('store').rpc('create_pending_purchase', {
    p_key: ENTRY_KEY,
    p_social_slug: slug,
    p_ticket_code: 'standard',
    p_purchaser_name: 'Alex Example',
    p_purchaser_email: `alex+${Math.random().toString(36).slice(2)}@example.com`,
    p_quantity: 1,
    ...overrides,
  });

  expect(error).toBeNull();
  return data?.[0] as Record<string, unknown> | undefined;
}

describe('holding tickets', () => {
  it('prices the whole purchase, not one ticket', async () => {
    const held = await hold(OPEN, { p_quantity: 3 });

    // **Three tickets at £12 is £36**, and the amount is what the card will be charged. The
    // page shows the same figure because `quantityOptionLabel` multiplies the same
    // `price_pence` — neither side re-derives the other's arithmetic.
    expect(held).toMatchObject({ ok: true, amount_pence: 3600, quantity: 3 });
  });

  it('holds nothing and spends nothing in preview, but prices it exactly the same', async () => {
    const before = await query('select count(*)::int as n from store.ticket_purchases');

    const preview = await hold(OPEN, { p_quantity: 2, p_preview: true });

    const after = await query('select count(*)::int as n from store.ticket_purchases');

    expect(preview).toMatchObject({ ok: true, amount_pence: 2400, purchase_id: null });
    // **The whole point of the preview**: every rule ran and the first write never happened.
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('refuses a quantity beyond the occasion’s own cap', async () => {
    // The cap is a column, so this is the occasion's rule rather than a constant.
    expect(await hold(OPEN, { p_quantity: 7 })).toMatchObject({
      ok: false,
      reason: 'invalid_quantity',
    });
  });

  it('refuses a ticket type that is not on this occasion', async () => {
    expect(await hold(OPEN, { p_ticket_code: 'concession' })).toMatchObject({
      ok: false,
      reason: 'invalid_ticket_type',
    });
  });

  it('refuses before the window opens, and says which', async () => {
    // A null `sales_open_at` reads as *never opens* rather than *no lower bound* — the branch
    // that would have put a race on sale if it had been written the other way round.
    expect(await hold(SHUT)).toMatchObject({ ok: false, reason: 'pre_open' });
  });

  it('counts tickets rather than purchases when it checks capacity', async () => {
    // Two places, taken by one purchase of two.
    expect(await hold(TINY, { p_quantity: 2 })).toMatchObject({ ok: true });

    // **The third ticket is refused, not the third buyer.** A capacity check that counted
    // rows would have let this through and oversold the room.
    expect(await hold(TINY, { p_quantity: 1 })).toMatchObject({
      ok: false,
      reason: 'sold_out',
    });
  });

  it('gives a lapsed hold’s tickets back to the pool', async () => {
    await query(
      `update store.ticket_purchases set hold_expires_at = now() - interval '1 minute'
        where social_id = (select id from store.socials where slug = $1)
          and status = 'pending'`,
      [TINY],
    );

    // **Without the sweep having run.** The capacity count only counts a hold while it is
    // still in the future, which is what makes the cron housekeeping rather than load-bearing:
    // if it never runs again, nobody is turned away.
    expect(await hold(TINY, { p_quantity: 2 })).toMatchObject({ ok: true });

    const swept = await anon.schema('store').rpc('expire_pending_holds');
    expect(swept.error).toBeNull();
    expect((swept.data?.[0] as { expired: number }).expired).toBeGreaterThan(0);
  });
});

describe('confirming the payment', () => {
  it('moves a purchase to paid, once, and owes exactly one email', async () => {
    const held = await hold(OPEN);
    const purchaseId = held?.purchase_id as string;

    await query(
      `update store.ticket_purchases set stripe_checkout_session_id = $2 where id = $1`,
      [purchaseId, `cs_test_${purchaseId}`],
    );

    const first = await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: `cs_test_${purchaseId}`,
      p_amount_total: 1200,
    });

    expect(first.data?.[0]).toMatchObject({ ok: true, result: 'paid' });

    // **A retry is a success, not an error.** Stripe retries for three days, and a second
    // delivery of a payment already recorded has nothing left to do.
    const second = await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: `cs_test_${purchaseId}`,
      p_amount_total: 1200,
    });

    expect(second.data?.[0]).toMatchObject({ ok: true, result: 'already_paid' });

    const outbox = await query(
      `select template, status from store.email_outbox where purchase_id = $1`,
      [purchaseId],
    );

    // **One row, not two.** The trigger fires on the transition and the retry made none; the
    // unique `dedupe_key` is the belt to that braces.
    expect(outbox).toEqual([{ template: 'ticket_confirmed', status: 'pending' }]);
  });

  it('flags an amount that disagrees with Stripe rather than refusing the payment', async () => {
    const held = await hold(OPEN);
    const purchaseId = held?.purchase_id as string;

    await query(
      `update store.ticket_purchases set stripe_checkout_session_id = $2 where id = $1`,
      [purchaseId, `cs_test_${purchaseId}`],
    );

    const recorded = await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: `cs_test_${purchaseId}`,
      p_amount_total: 999,
    });

    // ⚠️ **Still `paid`.** By the time this runs the money has gone; refusing it would take
    // somebody's payment and give them nothing. The flag is what makes a human look.
    expect(recorded.data?.[0]).toMatchObject({ ok: true, result: 'paid' });

    const rows = await query<{ status: string; attention: string | null }>(
      'select status, attention from store.ticket_purchases where id = $1',
      [purchaseId],
    );

    expect(rows[0]).toEqual({ status: 'paid', attention: 'amount_mismatch' });
  });

  it('pays a purchase whose hold had already lapsed, and never refuses it', async () => {
    const held = await hold(OPEN);
    const purchaseId = held?.purchase_id as string;

    await query(
      `update store.ticket_purchases
          set stripe_checkout_session_id = $2, status = 'expired', hold_expires_at = null
        where id = $1`,
      [purchaseId, `cs_test_${purchaseId}`],
    );

    const recorded = await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: `cs_test_${purchaseId}`,
      p_amount_total: 1200,
    });

    // The webhook may simply be late. A payment that arrives after the hold lapsed is still a
    // payment, and there is deliberately no fifth status for it to disappear into.
    expect(recorded.data?.[0]).toMatchObject({ ok: true, result: 'paid' });
  });

  it('owes a refund notice only when something was actually paid', async () => {
    const held = await hold(OPEN);
    const purchaseId = held?.purchase_id as string;

    // Straight from `pending` to `refunded`: nothing was paid, so nothing was refunded.
    await query(`update store.ticket_purchases set status = 'refunded' where id = $1`, [
      purchaseId,
    ]);

    expect(
      await query('select id from store.email_outbox where purchase_id = $1', [
        purchaseId,
      ]),
    ).toEqual([]);
  });
});

describe('the readable reference', () => {
  it('issues a per-occasion number that never repeats, even after a deletion', async () => {
    const first = await hold(OPEN);
    const second = await hold(OPEN);

    const numbers = await query<{ ticket_no: number }>(
      'select ticket_no from store.ticket_purchases where id = any($1::uuid[]) order by ticket_no',
      [[first?.purchase_id, second?.purchase_id]],
    );

    expect(numbers).toHaveLength(2);
    expect(numbers[1]!.ticket_no).toBe(numbers[0]!.ticket_no + 1);

    // **A high-water mark rather than `max() + 1`.** Deleting the newest purchase must not
    // make the next one reuse its number: a reference already emailed to somebody may never
    // come to mean a different ticket.
    await query('delete from store.ticket_purchases where id = $1', [
      second?.purchase_id,
    ]);

    const third = await hold(OPEN);
    const after = await query<{ ticket_no: number }>(
      'select ticket_no from store.ticket_purchases where id = $1',
      [third?.purchase_id],
    );

    expect(after[0]!.ticket_no).toBe(numbers[1]!.ticket_no + 1);
  });
});

describe('the outbox drain', () => {
  it('hands a claimed message everything a template needs, and marks the attempt', async () => {
    const held = await hold(OPEN, { p_quantity: 2 });
    const purchaseId = held?.purchase_id as string;

    await query(
      `update store.ticket_purchases set stripe_checkout_session_id = $2 where id = $1`,
      [purchaseId, `cs_test_${purchaseId}`],
    );
    await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: `cs_test_${purchaseId}`,
      p_amount_total: 2400,
    });

    const { data, error } = await anon.schema('store').rpc('claim_outbox_batch', {
      p_key: STRIPE_KEY,
      p_limit: 50,
    });

    expect(error).toBeNull();

    const mine = (data as Record<string, unknown>[]).find(
      (row) => row.purchase_id === purchaseId,
    );

    // The reference is built in TypeScript from these three, so all three have to arrive.
    expect(mine).toMatchObject({
      template: 'ticket_confirmed',
      social_slug: OPEN,
      amount_pence: 2400,
      quantity: 2,
      purchaser_name: 'Alex Example',
      attempts: 1,
      reply_to: 'info@example.com',
    });
    expect(mine?.ticket_no).toBeTypeOf('number');

    const recorded = await anon.schema('store').rpc('record_send_result', {
      p_key: STRIPE_KEY,
      p_id: mine?.id as string,
      p_status: 'sent',
      p_provider_message_id: 'resend-test-id',
    });

    expect(recorded.data).toBe(true);

    const after = await query<{ status: string; sent_at: string | null }>(
      'select status, sent_at from store.email_outbox where id = $1',
      [mine?.id],
    );

    expect(after[0]?.status).toBe('sent');
    expect(after[0]?.sent_at).not.toBeNull();
  });
  /**
   * **The case nothing asserted, which is why it shipped wrong.**
   *
   * A Stripe event for a session this database has never seen is an ordinary occurrence — a
   * session created against another environment, the endpoint's own test event — and it is
   * emphatically not a credential problem. Answering `ok = false` made the Worker report
   * `bad_key`, which reached a volunteer as a 503 and a log line naming a digest that was
   * correct. Fixed by `20260913230000`; `entries.record_checkout_event()` has always answered
   * its equivalent `not_ours` with `ok = true`.
   */
  it('answers an unrecognised session without calling it a bad key', async () => {
    const recorded = await anon.schema('store').rpc('record_checkout_event', {
      p_key: STRIPE_KEY,
      p_session_id: 'cs_test_no_such_session_anywhere',
      p_amount_total: 1200,
    });

    expect(recorded.data?.[0]).toMatchObject({ ok: true, result: 'no_such_session' });
  });

  /**
   * **And the refusal that `ok = false` is now reserved for.** The pair matters more than
   * either half: a test asserting only the line above would pass on a function that answered
   * `ok = true` to everything, including a key it should have refused.
   */
  it('still refuses a wrong key, and tells them apart', async () => {
    const refused = await anon.schema('store').rpc('record_checkout_event', {
      p_key: 'not-the-stripe-key',
      p_session_id: 'cs_test_no_such_session_anywhere',
      p_amount_total: 1200,
    });

    expect(refused.data?.[0]).toMatchObject({ ok: false, result: 'bad_key' });
  });
});
