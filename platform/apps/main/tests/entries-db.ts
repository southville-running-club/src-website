import { Client } from 'pg';

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
  entrants: { firstName: string; lastName: string; club: string | null }[];
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
      entrants: { first_name: string; last_name: string; club: string | null }[] | null;
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
                         'club', e.club
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
    await db.query(
      `update entries.events set capacity = 1 where slug = $1`,
      [SLUG],
    );

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
              select event.id, 'paid', 1700, fee.id, 'sold-out-fixture@example.com',
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
