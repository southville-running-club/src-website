import { Client } from 'pg';
import { createHash } from 'node:crypto';
import {
  ADMIN_CAPACITY,
  ADMIN_EVENT_DATE,
  ADMIN_EVENT_NAME,
  ADMIN_EVENT_SLUG,
  ADMIN_GATE_KEY,
  ADMIN_HANDLE,
  ADMIN_PERSON_KEY,
  ADMIN_RACE_SLUG,
  AWKWARD_CLUB,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
  CLEAN_CAPACITY,
  CLEAN_EVENT_DATE,
  CLEAN_EVENT_NAME,
  CLEAN_EVENT_SLUG,
  CLEAN_HELD_ENTRANT_ID,
  CLEAN_HELD_LAST_NAME,
  CLEAN_HELD_PURCHASE_ID,
  CLEAN_PAID_ENTRANT_ID,
  CLEAN_PAID_LAST_NAME,
  CLEAN_PAID_PURCHASE_ID,
  CLEAN_RACE_SLUG,
  EXPIRED_ENTRANT_ID,
  EXPIRED_PURCHASE_ID,
  MEDICAL_NOTE,
  MISSING_EA_ENTRANT_ID,
  MISSING_EA_LAST_NAME,
  MISSING_EA_PURCHASE_ID,
  OVER_ENTRANT_ID,
  OVER_PURCHASE_ID,
  PAID_EA_NUMBER,
  PAID_ENTRANT_ID,
  PAID_NON_ASCII_LAST_NAME,
  PAID_PURCHASE_ID,
  PENDING_ENTRANT_ID,
  PENDING_PURCHASE_ID,
  REFUNDED_ENTRANT_ID,
  REFUNDED_PURCHASE_ID,
  REVOKED_HANDLE,
  REVOKED_PERSON_KEY,
} from './admin-fixtures';

/** The two fabricated runnings this file writes, and the only ones it ever deletes from. */
const FIXTURE_EVENT_SLUGS = [ADMIN_EVENT_SLUG, CLEAN_EVENT_SLUG];

/**
 * Setting up and tearing down the admin run's fixtures, from ordinary Node.
 *
 * `pg` cannot run inside `workerd`, so this is reached through Vitest's `globalSetup` and by
 * Playwright, exactly as `entries-db.ts` is. The connection is the local Docker Postgres and
 * nothing else; its credentials are the fixed ones `supabase start` prints on every machine,
 * and there is no version of this file that talks to production.
 *
 * **The two digests are installed here and removed in teardown even when the run failed**, so a
 * laptop is never left with a working admin key for a test secret. The real rows ship null and
 * empty, which refuses everybody.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function withClient<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();

  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

function digest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Everything the admin run needs, and nothing against the real event.
 *
 * Written directly rather than through `entries.create_pending_purchase()`, which chooses its
 * own ids and cannot produce a `paid`, `expired`, `refunded` or over-capacity row at all.
 */
export async function seedAdminFixtures(gateKey: string = ADMIN_GATE_KEY): Promise<void> {
  // **The gate key is an argument because the two callers hold different ones**, and getting it
  // wrong is a failure that reads as "the admin surface is broken" rather than as a fixture
  // mistake. The Miniflare run binds `ADMIN_GATE_KEY` in its own config, so it takes the
  // default. Playwright drives the *preview* Worker, which is started by `apps/main`'s `preview`
  // script with the key `seed.sql` installs — so it passes that one instead. Installing the
  // wrong digest would leave the Worker holding a key the database no longer recognises, and
  // every sign-in would be refused with nothing saying why.
  await clearAdminFixtures();

  await withClient(async (db) => {
    await db.query(
      `update entries.webhook_secrets set key_sha256 = $1, updated_at = now()
        where name = 'admin'`,
      [digest(gateKey)],
    );

    await db.query(
      `insert into entries.admin_keys (name, key_sha256) values ($1, $2), ($3, $4)
       on conflict (name) do update set key_sha256 = excluded.key_sha256, revoked_at = null`,
      [
        ADMIN_HANDLE,
        digest(ADMIN_PERSON_KEY),
        REVOKED_HANDLE,
        digest(REVOKED_PERSON_KEY),
      ],
    );

    await db.query(`update entries.admin_keys set revoked_at = now() where name = $1`, [
      REVOKED_HANDLE,
    ]);

    const seedEvent = async (
      slug: string,
      name: string,
      raceSlug: string,
      date: string,
      capacity: number,
    ): Promise<void> => {
      await db.query(
        `insert into entries.events (
           slug, display_name, race_slug, event_date, start_time, capacity,
           entries_open_at, from_address, consent_version, minimum_age
         ) values ($1, $2, $3, $4::date, time '11:00', $5,
                   '2026-01-01T00:00:00Z', 'fixture@example.com', 'zz-v1', 18)
         on conflict (slug) do nothing`,
        [slug, name, raceSlug, date, capacity],
      );

      await db.query(
        `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
         select e.id, f.code, f.label, f.price, f.ea
           from entries.events e
           cross join (values ('affiliated', 'Affiliated', 1500, true),
                              ('unaffiliated', 'Unaffiliated', 1700, false))
                      as f (code, label, price, ea)
          where e.slug = $1
         on conflict (event_id, code) do nothing`,
        [slug],
      );
    };

    await seedEvent(
      ADMIN_EVENT_SLUG,
      ADMIN_EVENT_NAME,
      ADMIN_RACE_SLUG,
      ADMIN_EVENT_DATE,
      ADMIN_CAPACITY,
    );

    await seedEvent(
      CLEAN_EVENT_SLUG,
      CLEAN_EVENT_NAME,
      CLEAN_RACE_SLUG,
      CLEAN_EVENT_DATE,
      CLEAN_CAPACITY,
    );

    /**
     * One purchase and one entrant, with ids the tests already know.
     *
     * `holdMinutes` negative is a hold that has already run out; `attention` is the flag the
     * webhook sets when somebody paid for a place the race did not have.
     */
    const seed = async (purchase: {
      purchaseId: string;
      entrantId: string;
      status: string;
      feeCode: string;
      amountPence: number;
      firstName: string;
      lastName: string;
      club: string | null;
      eaNumber: string | null;
      dateOfBirth: string;
      gender: string;
      holdMinutes: number;
      attention?: string;
      notes?: string;
      /** Which fabricated running this purchase belongs to. Defaults to the oversold one. */
      eventSlug?: string;
    }): Promise<void> => {
      const eventSlug = purchase.eventSlug ?? ADMIN_EVENT_SLUG;

      await db.query(
        `insert into entries.entry_purchases (
           id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
           consents, consent_version, hold_expires_at, paid_at, revived_at,
           attention, attention_at, attention_detail
         )
         select $1::uuid, e.id, $2, $3, f.id, $4, $5,
                '{"entryTerms":true,"medical":true}'::jsonb, 'zz-v1',
                now() + ($6 || ' minutes')::interval,
                case when $2 = 'paid' then now() end,
                case when $7::text is not null then now() end,
                $7::text,
                case when $7::text is not null then now() end,
                case when $7::text is not null
                     then jsonb_build_object('capacity', $8::int, 'taken', $8::int, 'wanted', 1)
                end
           from entries.events e
           join entries.fees f on f.event_id = e.id and f.code = $9
          where e.slug = $10`,
        [
          purchase.purchaseId,
          purchase.status,
          purchase.amountPence,
          `${purchase.firstName.toLowerCase()}@example.com`,
          `${purchase.firstName} ${purchase.lastName}`,
          String(purchase.holdMinutes),
          purchase.attention ?? null,
          ADMIN_CAPACITY,
          purchase.feeCode,
          eventSlug,
        ],
      );

      await db.query(
        `insert into entries.entrants (
           id, purchase_id, first_name, last_name, date_of_birth, gender, club, ea_number,
           emergency_contact_name, emergency_contact_phone
         ) values ($1::uuid, $2::uuid, $3, $4, $5::date, $6, $7, $8, $9, $10)`,
        [
          purchase.entrantId,
          purchase.purchaseId,
          purchase.firstName,
          purchase.lastName,
          purchase.dateOfBirth,
          purchase.gender,
          purchase.club,
          purchase.eaNumber,
          `Kin ${purchase.lastName}`,
          '0117 496 0000',
        ],
      );

      if (purchase.notes !== undefined) {
        await db.query(
          'insert into entries.entrant_medical (entrant_id, notes) values ($1::uuid, $2)',
          [purchase.entrantId, purchase.notes],
        );
      }
    };

    // Paid, affiliated, with an England Athletics number and the only medical note in the run.
    // Born on race day forty years earlier, so the category is the Vet 40 boundary.
    await seed({
      purchaseId: PAID_PURCHASE_ID,
      entrantId: PAID_ENTRANT_ID,
      status: 'paid',
      feeCode: 'affiliated',
      amountPence: 1500,
      firstName: 'Harriet',
      lastName: 'Nwosu',
      club: 'Southville Running Club',
      eaNumber: PAID_EA_NUMBER,
      dateOfBirth: '1986-12-06',
      gender: 'female',
      holdMinutes: 31,
      notes: MEDICAL_NOTE,
    });

    // The awkward strings, and a live hold.
    await seed({
      purchaseId: PENDING_PURCHASE_ID,
      entrantId: PENDING_ENTRANT_ID,
      status: 'pending',
      feeCode: 'unaffiliated',
      amountPence: 1700,
      firstName: AWKWARD_FIRST_NAME,
      lastName: AWKWARD_LAST_NAME,
      // A plain club here: the CSV hazard belongs on a paid entrant, because an export carries
      // paid entries only. See the note in `admin-fixtures.ts`.
      club: 'Bristol & West AC',
      eaNumber: null,
      dateOfBirth: '2000-12-07',
      gender: 'female',
      holdMinutes: 31,
    });

    // A hold that ran out. Its place went back into the pool the instant it lapsed.
    await seed({
      purchaseId: EXPIRED_PURCHASE_ID,
      entrantId: EXPIRED_ENTRANT_ID,
      status: 'expired',
      feeCode: 'unaffiliated',
      amountPence: 1700,
      firstName: 'Kwame',
      lastName: 'Adjei',
      club: 'Long Ashton RC',
      eaNumber: null,
      dateOfBirth: '1975-06-30',
      gender: 'male',
      holdMinutes: -40,
    });

    // **The row the page exists to make impossible to miss.** Paid after the last place had
    // gone, flagged, and consuming a place regardless.
    await seed({
      purchaseId: OVER_PURCHASE_ID,
      entrantId: OVER_ENTRANT_ID,
      status: 'paid',
      feeCode: 'affiliated',
      amountPence: 1500,
      firstName: 'Lena',
      lastName: PAID_NON_ASCII_LAST_NAME,
      // **The CSV hazard, on the one entrant that reaches every export.** A comma and a double
      // quote in one field, and a non-ASCII surname to go with the byte-order mark.
      club: AWKWARD_CLUB,
      eaNumber: '7654321',
      dateOfBirth: '1960-01-15',
      gender: 'female',
      holdMinutes: -60,
      attention: 'over_capacity',
    });

    // Refunded: the place came back, and no export carries it.
    await seed({
      purchaseId: REFUNDED_PURCHASE_ID,
      entrantId: REFUNDED_ENTRANT_ID,
      status: 'refunded',
      feeCode: 'unaffiliated',
      amountPence: 1700,
      firstName: 'Marek',
      lastName: 'Toms',
      club: null,
      eaNumber: null,
      dateOfBirth: '1999-02-28',
      gender: 'male',
      holdMinutes: -90,
    });

    // **Paid, affiliated, and no England Athletics number** — the state the affiliation panel
    // exists to surface, and one `create_pending_purchase()` permits. See the note in
    // `admin-fixtures.ts`.
    await seed({
      purchaseId: MISSING_EA_PURCHASE_ID,
      entrantId: MISSING_EA_ENTRANT_ID,
      status: 'paid',
      feeCode: 'affiliated',
      amountPence: 1500,
      firstName: 'Nadia',
      lastName: MISSING_EA_LAST_NAME,
      club: 'Westbury Harriers',
      eaNumber: null,
      dateOfBirth: '1994-03-09',
      gender: 'female',
      holdMinutes: 31,
    });

    // --- the quiet event, with nothing flagged on it ------------------------------------------
    // Two entries against ten places: not full, not over, nothing needing a human, no medical
    // note and no missing number. It is what proves the attention panel *stays away*.
    await seed({
      eventSlug: CLEAN_EVENT_SLUG,
      purchaseId: CLEAN_PAID_PURCHASE_ID,
      entrantId: CLEAN_PAID_ENTRANT_ID,
      status: 'paid',
      feeCode: 'unaffiliated',
      amountPence: 1700,
      firstName: 'Tomas',
      lastName: CLEAN_PAID_LAST_NAME,
      club: 'Chew Valley RC',
      eaNumber: null,
      dateOfBirth: '1991-05-02',
      gender: 'male',
      holdMinutes: 31,
    });

    await seed({
      eventSlug: CLEAN_EVENT_SLUG,
      purchaseId: CLEAN_HELD_PURCHASE_ID,
      entrantId: CLEAN_HELD_ENTRANT_ID,
      status: 'pending',
      feeCode: 'unaffiliated',
      amountPence: 1700,
      firstName: 'Bea',
      lastName: CLEAN_HELD_LAST_NAME,
      club: null,
      eaNumber: null,
      dateOfBirth: '1979-08-19',
      gender: 'female',
      // A live hold, so this event has one place held and one paid.
      holdMinutes: 31,
    });
  });
}

/**
 * Everything back, whatever happened.
 *
 * **The two digests go back to null and the handles are deleted**, so no laptop is left with a
 * working admin key for a test secret against a real database.
 */
export async function clearAdminFixtures(
  restoreGateKey: string | null = null,
): Promise<void> {
  await withClient(async (db) => {
    // **Scoped to this file's own two runnings, by slug, and never wider.** A delete that took
    // every purchase or every event would take `nn-2026`'s with it, and two specs sharing one
    // database have already bitten this suite: `nn-entry.spec.ts` clears purchases against the
    // real event, which is exactly why these fixtures are against fabricated ones.
    await db.query(
      `delete from entries.entry_purchases
        where event_id in (select id from entries.events where slug = any($1::text[]))`,
      [FIXTURE_EVENT_SLUGS],
    );
    await db.query('delete from entries.events where slug = any($1::text[])', [
      FIXTURE_EVENT_SLUGS,
    ]);
    await db.query('delete from entries.admin_audit where actor = any($1::text[])', [
      [ADMIN_HANDLE, REVOKED_HANDLE],
    ]);
    await db.query('delete from entries.admin_keys where name = any($1::text[])', [
      [ADMIN_HANDLE, REVOKED_HANDLE],
    ]);
    // **Null is the shipped state and the default here**, so a run that ends leaves a laptop
    // with no admin surface rather than one whose key is written in a test file.
    //
    // Playwright passes the local seed key back instead, because `./dev test --keep-up` leaves
    // the site running and the next thing somebody does is open it. Nulling it there would mean
    // an admin surface that silently stopped existing after a test run, with only a `./dev
    // reset` to explain it.
    await db.query(
      `update entries.webhook_secrets
          set key_sha256 = case when $1::text is null
                                then null
                                else encode(sha256(convert_to($1, 'UTF8')), 'hex')
                           end,
              updated_at = now()
        where name = 'admin'`,
      [restoreGateKey],
    );
  });
}

/** What the audit table records, for a test that cannot look through the API. */
export async function adminAudit(): Promise<
  { actor: string; action: string; detail: Record<string, unknown> }[]
> {
  return withClient(async (db) => {
    const { rows } = await db.query<{
      actor: string;
      action: string;
      detail: Record<string, unknown>;
    }>(
      `select actor, action, detail from entries.admin_audit
        where actor = any($1::text[]) order by at`,
      [[ADMIN_HANDLE, REVOKED_HANDLE]],
    );

    return rows;
  });
}
