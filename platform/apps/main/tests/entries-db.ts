import { Client } from 'pg';
import { createHash } from 'node:crypto';

/**
 * Reading and clearing `entries` rows, for the tests that drive the form from outside.
 *
 * **The acceptance suite and the Worker suite cannot ask the database anything through the
 * application**, and that is by design: the anon role holds no grant on any table in
 * `entries`, and `packages/db/tests/entries.test.ts` asserts it. So a test that wants to know
 * whether exactly one pending purchase was written has to look with a privileged connection,
 * exactly as the database tests do.
 *
 * The connection is the local Docker Postgres and nothing else. Its credentials are the
 * fixed ones `supabase start` prints on every machine, and there is no version of this file
 * that talks to production.
 *
 * `pg` cannot run inside `workerd`, so the Worker suite reaches these through Vitest's
 * `globalSetup` rather than from a `beforeAll` inside the runtime. Playwright runs in
 * ordinary Node and calls them directly.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The event `/nn/` is about, and the slug `worker/nn-entry.ts` asks for. */
const SLUG = 'nn-2026';

async function withClient<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();

  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

export interface PurchaseRow {
  status: string;
  amountPence: number;
  feeCode: string;
  purchaserEmail: string;
  sessionId: string | null;
  entrants: {
    firstName: string;
    lastName: string;
    club: string | null;
    /** The race category — three values, and what the prize list is grouped by. */
    gender: string;
    /** What the runner typed when asked how they describe their gender, or null. */
    genderIdentity: string | null;
  }[];
  medicalNotes: string[];
}

/** Every purchase against the real event, newest last, with what hangs off it. */
export async function purchases(): Promise<PurchaseRow[]> {
  return withClient(async (db) => {
    const { rows } = await db.query<{
      status: string;
      amount_pence: number;
      code: string;
      purchaser_email: string;
      stripe_checkout_session_id: string | null;
      entrants:
        | {
            first_name: string;
            last_name: string;
            club: string | null;
            gender: string;
            gender_identity: string | null;
          }[]
        | null;
      medical: string[] | null;
    }>(
      `select p.status,
              p.amount_pence,
              f.code,
              p.purchaser_email::text as purchaser_email,
              p.stripe_checkout_session_id,
              (
                select json_agg(json_build_object(
                         'first_name', e.first_name,
                         'last_name', e.last_name,
                         'club', e.club,
                         'gender', e.gender,
                         'gender_identity', e.gender_identity
                       ) order by e.created_at)
                  from entries.entrants e
                 where e.purchase_id = p.id
              ) as entrants,
              (
                select json_agg(m.notes)
                  from entries.entrants e
                  join entries.entrant_medical m on m.entrant_id = e.id
                 where e.purchase_id = p.id
              ) as medical
         from entries.entry_purchases p
         join entries.events ev on ev.id = p.event_id
         join entries.fees f on f.id = p.fee_id
        where ev.slug = $1
        order by p.created_at`,
      [SLUG],
    );

    return rows.map((row) => ({
      status: row.status,
      amountPence: row.amount_pence,
      feeCode: row.code,
      purchaserEmail: row.purchaser_email,
      sessionId: row.stripe_checkout_session_id,
      entrants: (row.entrants ?? []).map((entrant) => ({
        firstName: entrant.first_name,
        lastName: entrant.last_name,
        club: entrant.club,
        gender: entrant.gender,
        genderIdentity: entrant.gender_identity,
      })),
      medicalNotes: row.medical ?? [],
    }));
  });
}

/**
 * Remove every purchase against the real event.
 *
 * **Called before a test rather than only after one.** A run that failed halfway leaves rows
 * behind, and the next run's "exactly one pending purchase" would then be counting somebody
 * else's. Entrants and medical notes go with the purchase by cascade, which is the retention
 * story the schema was built around.
 */
export async function clearPurchases(): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `delete from entries.entry_purchases
        where event_id = (select id from entries.events where slug = $1)`,
      [SLUG],
    );
  });
}

/**
 * Put the event into a sold-out state, and hand back what it takes to undo it.
 *
 * **One paid place against a capacity of one**, rather than 250 fabricated entries. It is the
 * same state as far as `entries.create_pending_purchase()` is concerned — taken >= capacity
 * — and it is two statements instead of five hundred. `paid` rather than a live hold,
 * because a hold would lapse mid-suite and turn a deterministic test into a slow flake.
 */
export async function sellOut(): Promise<void> {
  await withClient(async (db) => {
    await db.query(`update entries.events set capacity = 1 where slug = $1`, [SLUG]);

    await db.query(
      `with event as (select id from entries.events where slug = $1),
            fee as (
              select f.id from entries.fees f, event
               where f.event_id = event.id and f.code = 'unaffiliated'
            ),
            purchase as (
              insert into entries.entry_purchases (
                event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
                consents, consent_version, paid_at
              )
              select event.id, 'paid', 2000, fee.id, 'sold-out-fixture@example.com',
                     'Sold Out Fixture', '{"entryTerms":true,"medical":false}'::jsonb,
                     'nn-2026-v1', now()
                from event, fee
              returning id
            )
       insert into entries.entrants (
         purchase_id, first_name, last_name, date_of_birth, gender,
         emergency_contact_name, emergency_contact_phone
       )
       select purchase.id, 'Sold', 'Out', date '1986-03-07', 'female',
              'Next Of Kin', '0117 496 0000'
         from purchase`,
      [SLUG],
    );
  });
}

/** Back to 250 places and no purchases, whatever happened. */
export async function restoreCapacity(): Promise<void> {
  await clearPurchases();
  await withClient(async (db) => {
    await db.query(`update entries.events set capacity = 250 where slug = $1`, [SLUG]);
  });
}

// -----------------------------------------------------------------------------------------
// What the discount-code run needs
// -----------------------------------------------------------------------------------------

/**
 * Put one discount code on the real event for the length of a run, and take it out again.
 *
 * **Against `nn-2026` rather than a fabricated event**, for the reason the entry window is:
 * this run exists to exercise the switch production will actually use, and the code path it
 * exercises reads the event the Worker resolves from the URL. Removed in teardown **even when
 * the run failed**, so a laptop is never left holding a working discount against the real
 * running.
 *
 * `feeCode` is what makes the row like the club's actual Left Handed Giant code — scoped to one fee,
 * so applying it to another is refused. Pass null for a code that applies to any.
 */
export async function installDiscountCode(options: {
  code: string;
  percentOff: number;
  maxUses: number | null;
  feeCode: string | null;
}): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `insert into entries.discount_codes (event_id, code, percent_off, max_uses, fee_id)
       select event.id,
              $2,
              $3,
              $4,
              case
                when $5::text is null then null
                else (
                  select fee.id from entries.fees as fee
                   where fee.event_id = event.id and fee.code = $5::text
                )
              end
         from entries.events as event
        where event.slug = $1`,
      [SLUG, options.code, options.percentOff, options.maxUses, options.feeCode],
    );
  });
}

/** Every code on the event, gone. Called in teardown whatever happened. */
export async function clearDiscountCodes(): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `delete from entries.discount_codes
        where event_id in (select id from entries.events where slug = $1)`,
      [SLUG],
    );
  });
}

/** How many times the code has been spent, so a test can watch it go and come back. */
export async function discountUses(code: string): Promise<number | null> {
  return withClient(async (db) => {
    const { rows } = await db.query<{ uses: number }>(
      'select uses from entries.discount_codes where code = $1',
      [code],
    );

    return rows[0]?.uses ?? null;
  });
}

// -----------------------------------------------------------------------------------------
// What the webhook run needs
// -----------------------------------------------------------------------------------------

/**
 * Install the digest of the key the Worker will present, and take it out again afterwards.
 *
 * **The digest, never the key** — that is the whole shape of `entries.webhook_secrets`, and a
 * test that wrote the key itself would be proving something the production path does not do.
 * `createHash` rather than a hand-rolled one: this has to agree with `pg_catalog.sha256` and
 * there is exactly one right answer.
 *
 * `clearWebhookKey` is called in teardown **even when the run failed**, so a laptop is never
 * left with a working webhook key for a test secret against the real event row.
 */
export async function installWebhookKey(key: string): Promise<void> {
  const digest = createHash('sha256').update(key, 'utf8').digest('hex');

  await withClient(async (db) => {
    await db.query(
      `update entries.webhook_secrets set key_sha256 = $1, updated_at = now()
        where name = 'stripe'`,
      [digest],
    );
  });
}

export async function clearWebhookKey(): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `update entries.webhook_secrets set key_sha256 = null where name = 'stripe'`,
    );
  });
}

export interface SeededPurchase {
  id: string;
  sessionId: string;
  status: 'pending' | 'paid' | 'expired' | 'refunded';
  amountPence: number;
  email: string;
  firstName: string;
  lastName: string;
  /** Minutes from now. Negative is a hold that has already run out. */
  holdMinutes?: number;
}

/**
 * Write one purchase and its entrant, with an id the test already knows.
 *
 * **Not through `entries.create_pending_purchase()`**, deliberately. That function chooses the
 * id, and these fixtures have to be named from inside `workerd` where `pg` cannot run — so the
 * ids are fixed constants agreed across the process boundary in `webhook-fixtures.ts`. It also
 * lets a test start from `paid` or from a lapsed hold without arranging thirty-one minutes of
 * waiting or a payment that has not been built yet.
 *
 * The entry path's own behaviour is `packages/db/tests/entries-capacity.test.ts`'s to prove;
 * what this run is about is what the *Worker* does with a delivery.
 */
export async function seedPurchase(purchase: SeededPurchase): Promise<void> {
  const { holdMinutes = 31 } = purchase;

  await withClient(async (db) => {
    await db.query(
      `with event as (select id from entries.events where slug = $1),
            fee as (
              select f.id from entries.fees f, event
               where f.event_id = event.id and f.code = 'unaffiliated'
            ),
            inserted as (
              insert into entries.entry_purchases (
                id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
                consents, consent_version, hold_expires_at, paid_at,
                stripe_checkout_session_id
              )
              select $2::uuid, event.id, $3, $4, fee.id, $5, $6,
                     '{"entryTerms":true,"medical":false}'::jsonb, 'nn-2026-v1',
                     now() + ($7 || ' minutes')::interval,
                     case when $3 = 'paid' then now() end,
                     $8
                from event, fee
              returning id
            )
       insert into entries.entrants (
         purchase_id, first_name, last_name, date_of_birth, gender,
         emergency_contact_name, emergency_contact_phone
       )
       select inserted.id, $9, $10, date '1986-12-09', 'female',
              'Margaret Hamilton', '0117 496 0000'
         from inserted`,
      [
        SLUG,
        purchase.id,
        purchase.status,
        purchase.amountPence,
        purchase.email,
        `${purchase.firstName} ${purchase.lastName}`,
        String(holdMinutes),
        purchase.sessionId,
        purchase.firstName,
        purchase.lastName,
      ],
    );
  });
}

/** What actually happened to one purchase, for a test that cannot look through the API. */
export async function purchaseState(id: string): Promise<{
  status: string;
  paidAt: string | null;
  revivedAt: string | null;
  attention: string | null;
  paymentIntentId: string | null;
} | null> {
  return withClient(async (db) => {
    const { rows } = await db.query<{
      status: string;
      paid_at: string | null;
      revived_at: string | null;
      attention: string | null;
      stripe_payment_intent_id: string | null;
    }>(
      `select status, paid_at, revived_at, attention, stripe_payment_intent_id
         from entries.entry_purchases where id = $1`,
      [id],
    );

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      status: row.status,
      paidAt: row.paid_at,
      revivedAt: row.revived_at,
      attention: row.attention,
      paymentIntentId: row.stripe_payment_intent_id,
    };
  });
}
