import { Client } from 'pg';

import {
  EMPTY_EVENT_ID,
  EMPTY_EVENT_NAME,
  EMPTY_EVENT_SLUG,
  LEAKED_CLUB,
  LEAKED_EMAIL_DOMAIN,
  RESULTS_ACTUAL_START_AT,
  RESULTS_EVENT_ID,
  RESULTS_EVENT_NAME,
  RESULTS_EVENT_SLUG,
  RESULTS_START_AT,
  RESULTS_TEAMS,
} from './timing-fixtures';

/**
 * The `timing` rows `/nn/<year>/results/`'s tests read, written from Node.
 *
 * `pg` cannot run inside `workerd`, so this is reached through Vitest's `globalSetup`, exactly
 * as `admin-db.ts` is. The connection is the local Docker Postgres and nothing else.
 *
 * ## Written directly, and there is no other way to write them
 *
 * `timing`'s six tables have row-level security on and **no policy**, and there is no import
 * path, no capture screen and no function that inserts a crossing — ADR-034's rewrite has the
 * schema and the pure logic, and nothing yet that puts a race into it. So a fixture is direct
 * SQL as the superuser, which is also the only thing that could produce the mid-race states
 * these tests need: a runner still out on the course, and a crossing flagged but unresolved.
 *
 * ## Cleared before as well as after
 *
 * `admin-db.ts`'s rule, for its reason: a run that failed halfway leaves rows behind, and
 * "three entries" would then be counting somebody else's. **Deleting the event is the whole
 * teardown** — `teams`, `runners` and `crossings` all cascade from it.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The two fabricated runnings this file writes, and the only ones it ever deletes. */
const FIXTURE_EVENT_IDS = [RESULTS_EVENT_ID, EMPTY_EVENT_ID];

async function withClient<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();

  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

export async function seedTimingFixtures(): Promise<void> {
  await clearTimingFixtures();

  await withClient(async (db) => {
    // **`actually_started_at` is set on one and not the other**, so the event with a field on
    // it exercises the delayed-start rule and the empty one is left in the ordinary shape.
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, $3, 'solo', $4::timestamptz, $5::timestamptz),
              ($6, $7, $8, 'solo', $4::timestamptz, null)`,
      [
        RESULTS_EVENT_ID,
        RESULTS_EVENT_SLUG,
        RESULTS_EVENT_NAME,
        RESULTS_START_AT,
        RESULTS_ACTUAL_START_AT,
        EMPTY_EVENT_ID,
        EMPTY_EVENT_SLUG,
        EMPTY_EVENT_NAME,
      ],
    );

    for (const team of RESULTS_TEAMS) {
      await db.query(
        `insert into timing.teams (id, event_id, team_number, category, bib_leg1)
         values ($1, $2, $3, $4, $5)`,
        [team.id, RESULTS_EVENT_ID, team.teamNumber, team.category, team.bibLeg1],
      );

      // **An address and a club on every runner.** Neither may reach the page, and a fixture
      // that left them null could not prove it — the assertion would pass on a payload that
      // carried them and a page that printed them, because there would be nothing to print.
      await db.query(
        `insert into timing.runners
           (team_id, leg, firstname, lastname, gender, email, club_name, age_on_day)
         values ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [
          team.id,
          team.firstName,
          team.lastName,
          team.gender,
          `${team.firstName.toLowerCase()}@${LEAKED_EMAIL_DOMAIN}`,
          LEAKED_CLUB,
          team.ageOnDay,
        ],
      );

      if (team.crossedAt === null) continue;

      // The bib scanned is the effective one — the override where the desk wrote one, else the
      // number the team derives. A crossing on the derived bib of a team holding an override
      // would resolve to nobody, which is a different test.
      await db.query(
        `insert into timing.crossings
           (event_id, bib, captured_at, anomaly_flag, anomaly_reason)
         values ($1, $2, $3::timestamptz, $4, $5)`,
        [
          RESULTS_EVENT_ID,
          team.expectedBib,
          team.crossedAt,
          team.openAnomaly,
          team.openAnomaly ? 'zz-fixture: two taps within a second' : null,
        ],
      );
    }
  });
}

export async function clearTimingFixtures(): Promise<void> {
  await withClient(async (db) => {
    // **By id, and never wider.** `timing` holds nothing else today, and a delete that took
    // every event would be exactly the fixture that stops being safe the day it does.
    await db.query('delete from timing.events where id = any($1::uuid[])', [
      FIXTURE_EVENT_IDS,
    ]);
  });
}
