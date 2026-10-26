import { Client } from 'pg';
import { createHash } from 'node:crypto';

import {
  PHOTO_CREDIT,
  REPLACED_TOKEN,
  RUNNER_ADDRESS,
  RUNNER_BIB,
  RUNNER_CONTACT,
  RUNNER_EVENT_ID,
  RUNNER_EVENT_NAME,
  RUNNER_EVENT_SLUG,
  RUNNER_PHOTOS,
  RUNNER_TOKEN,
  SEND_ADDRESS,
  SEND_BIB,
  SEND_EVENT_ID,
  SEND_EVENT_NAME,
  SEND_EVENT_SLUG,
  UNPUBLISHED_EVENT_ID,
  UNPUBLISHED_EVENT_SLUG,
  UNPUBLISHED_TOKEN,
} from './photos-runner-fixtures';

/**
 * A runner's race photos, for the Worker tests and Playwright (brief slice 4).
 *
 * **A running of its own, `nn-2093`** — a year that will not happen, for `timing-fixtures.ts`'s
 * reason: the address is what names the running, so a photos fixture has to be a real
 * `nn-<year>`. Its results are published, so the private page has a finish time to show; its
 * photos are published and its links "sent", so the results page's banner has something to say.
 * A second running, `nn-2094`, has photos that are **not** published, so the refusal before
 * publication has something real behind it.
 *
 * **Slice 5 adds an entry behind bib 125**, so the lost-link form has an address to match, and
 * **a third running, `nn-2092`**, published with its links not yet sent, so the photo-admin's
 * "Send the links" has somebody to send to. ⚠️ The Worker run presses that button, so it owns
 * `nn-2092`'s outbox while it runs; Playwright only reads the page.
 *
 * ⚠️ **Read-only, seeded once under an advisory lock, and never cleared by Playwright** — the
 * shape `seedTimingFixtures()` uses and argues for. `admin.spec.ts`'s projects run two at a time
 * against one database (CLAUDE.md), and a fixture that one project clears while another reads
 * it fails in a way that names neither. Nothing in a test writes these rows. The Worker run,
 * one thread in one runtime, clears and seeds them in its global setup.
 *
 * Invented throughout: `example.com` addresses, fixed ids, and a credit with an apostrophe.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Any fixed number not used by another fixture's lock. */
const SEED_LOCK = 42_026_093;

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function withClient<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

export async function seedRunnerPhotoFixtures(): Promise<void> {
  await withClient(async (db) => {
    await db.query('select pg_advisory_lock($1)', [SEED_LOCK]);

    try {
      const present = await db.query('select 1 from photos.event where slug = $1', [
        RUNNER_EVENT_SLUG,
      ]);

      // Another project seeded these while this one waited. Identical rows; nothing to do.
      if (present.rowCount !== null && present.rowCount > 0) {
        return;
      }

      await seedInto(db);
    } finally {
      await db.query('select pg_advisory_unlock($1)', [SEED_LOCK]);
    }
  });
}

async function seedInto(db: Client): Promise<void> {
  // The race, with published results and one finisher on bib 125 — so the private page has a
  // finish time — and a second runner on 128.
  await db.query(
    `insert into timing.events
       (id, slug, name, format, start_at, finished_at, results_published_at)
     values ($1, $2, $3, 'solo', '2093-11-01T11:00:00Z', '2093-11-01T13:30:00Z',
             '2093-11-01T18:00:00Z'),
            ($4, $5, 'Nightingale Nightmare 2094', 'solo', '2094-11-01T11:00:00Z', null, null)`,
    [
      RUNNER_EVENT_ID,
      RUNNER_EVENT_SLUG,
      RUNNER_EVENT_NAME,
      UNPUBLISHED_EVENT_ID,
      UNPUBLISHED_EVENT_SLUG,
    ],
  );

  for (const [teamNumber, first, crossed] of [
    [RUNNER_BIB, 'Ffion', '2093-11-01T11:44:10Z'],
    ['128', 'Gethin', '2093-11-01T11:51:00Z'],
  ] as const) {
    const { rows } = await db.query<{ id: string }>(
      `insert into timing.teams (event_id, team_number) values ($1, $2) returning id`,
      [RUNNER_EVENT_ID, teamNumber],
    );
    await db.query(
      `insert into timing.runners (team_id, leg, firstname, lastname, gender, role)
       values ($1, 1, $2, 'Fixture', 'female', 'runner')`,
      [rows[0]!.id, first],
    );
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at) values ($1, $2, $3::timestamptz)`,
      [RUNNER_EVENT_ID, teamNumber, crossed],
    );
  }

  // The address "That's me" and a takedown request go to — the race's own Reply-To, held on
  // its entries record. **A race slug of its own**, so `entries.current_entry_state('nn')`
  // never mistakes this for the forthcoming running and repaints `/nn/`.
  await db.query(
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, capacity,
       entries_open_at, from_address, consent_version, minimum_age
     ) values ($1, $2, 'zz-runner-photos', '2093-11-01'::date, time '11:00', 10,
               '2093-01-01T00:00:00Z', $3, 'zz-v1', 18)
     on conflict (slug) do nothing`,
    [RUNNER_EVENT_SLUG, RUNNER_EVENT_NAME, RUNNER_CONTACT],
  );

  // An entry behind bib 125, so the lost-link form has an address to match (slice 5).
  await paidEntry(db, RUNNER_EVENT_SLUG, RUNNER_ADDRESS, RUNNER_EVENT_ID, RUNNER_BIB);

  await db.query(
    `insert into photos.event (slug, published_at, links_sent_at)
     values ($1, '2093-11-03T09:00:00Z', '2093-11-03T09:30:00Z'), ($2, null, null)`,
    [RUNNER_EVENT_SLUG, UNPUBLISHED_EVENT_SLUG],
  );

  const photos: [string, string, string, string, string | null][] = [
    [
      RUNNER_PHOTOS.mine.id,
      RUNNER_PHOTOS.mine.shortId,
      RUNNER_EVENT_SLUG,
      'tagged',
      null,
    ],
    [
      RUNNER_PHOTOS.couldBe.id,
      RUNNER_PHOTOS.couldBe.shortId,
      RUNNER_EVENT_SLUG,
      'checked',
      null,
    ],
    [
      RUNNER_PHOTOS.someoneElse.id,
      RUNNER_PHOTOS.someoneElse.shortId,
      RUNNER_EVENT_SLUG,
      'tagged',
      null,
    ],
    [
      RUNNER_PHOTOS.hidden.id,
      RUNNER_PHOTOS.hidden.shortId,
      RUNNER_EVENT_SLUG,
      'tagged',
      '2093-11-04T10:00:00Z',
    ],
    [
      RUNNER_PHOTOS.unpublished.id,
      RUNNER_PHOTOS.unpublished.shortId,
      UNPUBLISHED_EVENT_SLUG,
      'tagged',
      null,
    ],
  ];

  for (const [id, shortId, slug, state, hidden] of photos) {
    await db.query(
      `insert into photos.photo
         (id, event_slug, short_id, photographer, spot, taken_at, width, height,
          check_state, hidden_at)
       values ($1, $3, $2, $4, 'The finish', '2093-11-01T11:44:12Z', 2400, 1600, $5,
               $6::timestamptz)`,
      [id, shortId, slug, PHOTO_CREDIT, state, hidden],
    );
  }

  await db.query(
    `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source, decided_at)
     values ($1, '125', 0.97, true, 'model', null),
            ($2, '12?', 0.90, false, 'model', '2093-11-02T10:00:00Z'),
            ($3, '128', 0.98, true, 'model', null),
            ($4, '125', 0.96, true, 'model', null),
            ($5, '125', 0.95, true, 'model', null)`,
    [
      RUNNER_PHOTOS.mine.id,
      RUNNER_PHOTOS.couldBe.id,
      RUNNER_PHOTOS.someoneElse.id,
      RUNNER_PHOTOS.hidden.id,
      RUNNER_PHOTOS.unpublished.id,
    ],
  );

  await db.query(
    `insert into photos.link (token_hash, event_slug, bib, replaced_at)
     values ($1, $4, '125', null),
            ($2, $4, '125', '2093-11-03T08:00:00Z'),
            ($3, $5, '125', null)`,
    [
      hash(RUNNER_TOKEN),
      hash(REPLACED_TOKEN),
      hash(UNPUBLISHED_TOKEN),
      RUNNER_EVENT_SLUG,
      UNPUBLISHED_EVENT_SLUG,
    ],
  );

  await seedSendRunning(db);
}

/**
 * `nn-2092`: published, its links not sent, one runner with one photo on a paid entry — what
 * "Send the links" is pressed against.
 */
async function seedSendRunning(db: Client): Promise<void> {
  await db.query(
    `insert into timing.events (id, slug, name, format, start_at)
     values ($1, $2, $3, 'solo', '2092-11-01T11:00:00Z')`,
    [SEND_EVENT_ID, SEND_EVENT_SLUG, SEND_EVENT_NAME],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into timing.teams (event_id, team_number) values ($1, $2) returning id`,
    [SEND_EVENT_ID, SEND_BIB],
  );
  await db.query(
    `insert into timing.runners (team_id, leg, firstname, lastname, gender, role)
     values ($1, 1, 'Seren', 'Fixture', 'female', 'runner')`,
    [rows[0]!.id],
  );

  await db.query(
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, capacity,
       entries_open_at, from_address, consent_version, minimum_age
     ) values ($1, $2, 'zz-runner-photos', '2092-11-01'::date, time '11:00', 10,
               '2092-01-01T00:00:00Z', $3, 'zz-v1', 18)
     on conflict (slug) do nothing`,
    [SEND_EVENT_SLUG, SEND_EVENT_NAME, RUNNER_CONTACT],
  );
  await paidEntry(db, SEND_EVENT_SLUG, SEND_ADDRESS, SEND_EVENT_ID, SEND_BIB);

  await db.query(
    `insert into photos.event (slug, published_at, links_sent_at)
     values ($1, '2092-11-03T09:00:00Z', null)`,
    [SEND_EVENT_SLUG],
  );
  await db.query(
    `insert into photos.photo
       (id, event_slug, short_id, photographer, spot, taken_at, width, height, check_state)
     values ($1, $2, $3, $4, 'The finish', '2092-11-01T11:50:00Z', 2400, 1600, 'tagged')`,
    [
      RUNNER_PHOTOS.toSend.id,
      SEND_EVENT_SLUG,
      RUNNER_PHOTOS.toSend.shortId,
      PHOTO_CREDIT,
    ],
  );
  await db.query(
    `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
     values ($1, $2, 0.97, true, 'model')`,
    [RUNNER_PHOTOS.toSend.id, SEND_BIB],
  );
}

/**
 * A paid entry for one address on a running's entries record, tied to the team on that bib —
 * which is how a bib reaches an address (`photos.recipient_for()`). Inserted directly, as
 * `seed.sql` inserts its own: there is no payment to simulate here.
 */
async function paidEntry(
  db: Client,
  eventSlug: string,
  address: string,
  timingEventId: string,
  bib: string,
): Promise<void> {
  const { rows: fees } = await db.query<{ id: string; event_id: string }>(
    `insert into entries.fees (event_id, code, label, price_pence)
     select e.id, 'unaffiliated', 'Unaffiliated', 2000 from entries.events e where e.slug = $1
     on conflict (event_id, code) do update set label = excluded.label
     returning id, event_id`,
    [eventSlug],
  );
  const { rows: purchases } = await db.query<{ id: string }>(
    `insert into entries.entry_purchases (
       event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
       consents, consent_version, paid_at
     ) values ($1, 'paid', 2000, $2, $3, 'Fixture Buyer',
               '{"entryTerms":true,"medical":false}'::jsonb, 'zz-v1', now())
     returning id`,
    [fees[0]!.event_id, fees[0]!.id, address],
  );
  await db.query(
    `update timing.teams set purchase_order_id = $1
      where event_id = $2 and team_number = $3`,
    [purchases[0]!.id, timingEventId, bib],
  );
}

/** For the Worker run's global setup, which is one thread and owns the rows while it runs. */
export async function clearRunnerPhotoFixtures(): Promise<void> {
  await withClient(async (db) => {
    const slugs = [RUNNER_EVENT_SLUG, UNPUBLISHED_EVENT_SLUG, SEND_EVENT_SLUG];
    await db.query('delete from photos.email_outbox where event_slug = any($1::text[])', [
      slugs,
    ]);
    await db.query('delete from photos.link where event_slug = any($1::text[])', [slugs]);
    await db.query('delete from photos.photo where event_slug = any($1::text[])', [
      slugs,
    ]);
    await db.query('delete from photos.event where slug = any($1::text[])', [slugs]);
    // Purchases and fees first: an entries event is not deleted from under them.
    await db.query(
      `delete from entries.entry_purchases
        where event_id in (select id from entries.events where slug = any($1::text[]))`,
      [slugs],
    );
    await db.query(
      `delete from entries.fees
        where event_id in (select id from entries.events where slug = any($1::text[]))`,
      [slugs],
    );
    await db.query('delete from entries.events where slug = any($1::text[])', [slugs]);
    await db.query('delete from timing.events where slug = any($1::text[])', [slugs]);
  });
}
