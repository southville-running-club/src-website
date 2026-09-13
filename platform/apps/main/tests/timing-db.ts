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

/**
 * One arbitrary, fixed key for the advisory lock below. Invented, like every other id here.
 *
 * `pg_advisory_lock` is session-scoped, so it is held by the one `withClient` connection and
 * released in the `finally` — and by the backend exiting, if a run is killed outright.
 */
const SEED_LOCK = 245_0912;

/**
 * The two fabricated runnings, seeded **once** however many callers ask for them.
 *
 * ## ⚠️ Why this no longer clears first, and why the spec no longer clears after
 *
 * It was `clearTimingFixtures()` then a straight `insert`, and that is safe for one caller and
 * unsafe for the three that actually exist. `playwright.config.ts` runs `workers: 2` over
 * three projects with `fullyParallel: false`, so the scheduling unit is one file in one
 * project and `timing.spec.ts` runs its own `beforeAll` **three times, twice concurrently**.
 * Two things went wrong on 13 September 2026, in one run:
 *
 * - both projects reached the `insert` and one got `duplicate key value violates unique
 *   constraint "events_pkey"` — in `beforeAll`, so it took all nineteen of that project's
 *   tests down with it;
 * - and the `clearTimingFixtures()` at the top **deleted the races out from under a project
 *   that was already reading them**, which surfaced a long way from its cause: a hub page
 *   rendered "Not found", and the test waiting on a link on that page failed as a ten-second
 *   timeout naming the link.
 *
 * **Seeding is now idempotent and nothing deletes these rows mid-run.** The advisory lock
 * makes "is it there?" and "put it there" one atomic step, so the second project through waits
 * for the first to finish rather than racing it, then finds the rows and does nothing. The
 * data is identical whoever writes it, which is what makes first-writer-wins correct here
 * rather than merely convenient.
 *
 * `clearTimingFixtures()` is still exported and still called by
 * `tests/worker/admin/global-setup.ts`, which is a **different runtime with one thread** and
 * has none of this problem. What changed is that `timing.spec.ts` no longer calls it in
 * `afterAll`: leftover rows are two runnings of years that will not happen, in a database
 * `./dev up`, `./dev check` and `./dev test` each rebuild from zero anyway.
 */
export async function seedTimingFixtures(): Promise<void> {
  await withClient(async (db) => {
    await db.query('select pg_advisory_lock($1)', [SEED_LOCK]);

    try {
      const present = await db.query('select 1 from timing.events where id = $1', [
        RESULTS_EVENT_ID,
      ]);

      // Another project seeded these while this one waited on the lock. Identical rows, so
      // there is nothing to do and nothing to reconcile.
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

/**
 * A running of its own for the roster tests to change, one per Playwright project — #245.
 *
 * ## ⚠️ Why these cannot share the fixtures above
 *
 * Every other timing fixture is **read**, and a read does not care who else is looking. A
 * roster test **writes**: it puts somebody on a roster, asserts they are there, takes them off
 * and asserts they are gone. `playwright.config.ts` runs `workers: 2` over three projects with
 * `fullyParallel: false`, so the scheduling unit is one file in one project — which means
 * `timing.spec.ts [chromium]` and `timing.spec.ts [no-javascript]` can be in flight at the
 * same moment. Sharing one event between them is the `entries_open_at` race one schema along:
 * `assign_marshal()` is idempotent and `unassign_marshal()` answers `not_on_roster` for
 * somebody already removed, so the interleaving does not corrupt anything — it just makes one
 * project occasionally assert against the other project's roster, which is a flake that
 * reproduces on no laptop.
 *
 * **A row per project removes the race rather than managing it.** `timing.marshals` is keyed
 * `(event_id, user_id)` and both functions are event-scoped, so two projects assigning the
 * same person to two different events cannot see each other at all. That is cheaper than a
 * third Playwright config and it needs no lock.
 *
 * The id is derived from the slug rather than stored in a table of constants, so adding a
 * project to `playwright.config.ts` needs no edit here.
 */
export function rosterEventSlug(project: string): string {
  // `zz-` for the reason `timing-fixtures.ts`'s header gives: a slug of that shape can never
  // be reached by `nnEventSlugForResultsPath`, so no results address can name one of these.
  return `zz-roster-${project.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/** Deterministic and invented, the way every id in this suite is. */
function fixtureEventId(slug: string): string {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `0c0c0c0c-0000-4000-8000-0000${hash.toString(16).padStart(8, '0')}`;
}

export async function seedRosterEvent(slug: string): Promise<void> {
  await clearRosterEvent(slug);

  await withClient(async (db) => {
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at)
       values ($1, $2, $3, 'solo', '2099-11-01T11:00:00Z'::timestamptz)`,
      [fixtureEventId(slug), slug, `Roster fixture ${slug}`],
    );
  });
}

/** By this project's own slug, and never wider — `clearTimingFixtures`' rule. */
export async function clearRosterEvent(slug: string): Promise<void> {
  await withClient(async (db) => {
    await db.query('delete from timing.events where slug = $1', [slug]);
  });
}

/**
 * The races the start screen's tests drive — #250.
 *
 * ## ⚠️ Five runnings per project, because four of these tests *write*
 *
 * `seedRosterEvent`'s argument applies unchanged and one step further. A roster test writes,
 * so it gets an event per Playwright project; the start screen writes **the one value every
 * result in a race is derived from**, and it writes it irreversibly — once a race has started,
 * the countdown is gone from that row for good. So each state this screen renders gets a
 * running of its own, and each project gets its own copy of all five:
 *
 * | | What it is for |
 * | --- | --- |
 * | `pending` | read only: the countdown and the button, never pressed |
 * | `press` | the round trip — started by a test, then pressed again |
 * | `clearable` | started with nobody timed: the false start that can still be cleared |
 * | `running` | started **with a crossing against it**: the clear that must be refused |
 * | `finished` | `finished_at` set: no button and no ticking clock |
 *
 * **`pending` and `press` are two rows rather than one on purpose.** Sharing them would make
 * the countdown test depend on the round-trip test not having run yet, which `fullyParallel`
 * is free to stop being true — the same trap the roster fixtures' header names.
 *
 * ## ⚠️ The start is on the morning the clocks go back, and that is the point of the fixture
 *
 * `2026-10-25T00:30:00Z` is **01:30 BST** in London: the clocks go back at 02:00 BST that
 * morning, so 01:30 happens twice and this is the first pass through it. #250 asks for exactly
 * this instant because it is the one an ambient-timezone bug renders wrong — a page that
 * formatted the UTC value would say 00:30, and one that guessed the offset would say GMT. The
 * race itself is run the following weekend, so an hour of drift here is an hour of drift there.
 */
export const START_FIXTURE_STARTED_AT = '2026-10-25T00:30:00Z';

/** The same repeated hour, after the change: 01:45 **GMT**, fifteen minutes later in real time. */
export const START_FIXTURE_FINISHED_AT = '2026-10-25T01:45:00Z';

/** What `formatLondon` must render for the two above, which is what the specs assert. */
export const START_FIXTURE_STARTED_LONDON = '25 October 2026 at 01:30 BST';
export const START_FIXTURE_FINISHED_LONDON = '25 October 2026 at 01:45 GMT';

/** The five states, in the order the page's own branches test for them. */
export type StartFixtureState =
  'pending' | 'press' | 'clearable' | 'running' | 'finished';

const START_FIXTURE_STATES: StartFixtureState[] = [
  'pending',
  'press',
  'clearable',
  'running',
  'finished',
];

/**
 * One running, named for its state and for the project that owns it.
 *
 * `zz-` for the reason `timing-fixtures.ts`'s header gives: a slug of that shape can never be
 * reached by `nnEventSlugForResultsPath`, so no results address can name one of these.
 */
export function startEventSlug(project: string, state: StartFixtureState): string {
  return `zz-start-${state}-${project.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/**
 * The five runnings for one project, re-created from scratch.
 *
 * **Cleared first and written again, rather than seeded idempotently.** The roster fixtures
 * cannot do that — two projects share one row there and deleting it mid-run took a page out
 * from under another project. These rows are per project *and* per state, so nothing else is
 * ever looking at them; and they have to be re-created, because a previous run left `press`
 * started and `clearable` cleared.
 */
export async function seedStartEvents(project: string): Promise<void> {
  await clearStartEvents(project);

  await withClient(async (db) => {
    for (const state of START_FIXTURE_STATES) {
      const slug = startEventSlug(project, state);
      const id = fixtureEventId(slug);
      const started =
        state === 'pending' || state === 'press' ? null : START_FIXTURE_STARTED_AT;
      const finished = state === 'finished' ? START_FIXTURE_FINISHED_AT : null;

      await db.query(
        `insert into timing.events
           (id, slug, name, format, start_at, actually_started_at, finished_at)
         values ($1, $2, $3, 'solo', '2026-10-25T00:00:00Z'::timestamptz,
                 $4::timestamptz, $5::timestamptz)`,
        [id, slug, `Start fixture ${state}`, started, finished],
      );

      // ⚠️ **Only `running` gets a crossing**, and it is what makes `clear_start()` refuse:
      // a split is measured from `actually_started_at`, so clearing it after somebody has
      // been timed silently re-times them. A team first, because the crossing's trigger
      // resolves a bib to one.
      if (state !== 'running') continue;

      const { rows } = await db.query<{ id: string }>(
        `insert into timing.teams (event_id, team_number) values ($1, '11') returning id`,
        [id],
      );
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, '11', '2026-10-25T01:00:00Z'::timestamptz)`,
        [id],
      );
      // Referenced so the insert above is not mistaken for dead setup: the team is what the
      // bib resolves to, and a crossing that resolved to nobody would be a different fixture.
      if (rows.length !== 1) {
        throw new Error(`start fixture ${slug}: expected exactly one team row`);
      }
    }
  });
}

/** By this project's own slugs, and never wider — `clearTimingFixtures`' rule. */
export async function clearStartEvents(project: string): Promise<void> {
  await withClient(async (db) => {
    await db.query('delete from timing.events where slug = any($1::text[])', [
      START_FIXTURE_STATES.map((state) => startEventSlug(project, state)),
    ]);
  });
}

/**
 * The race the capture screen's tests record against — #203.
 *
 * ## ⚠️ One per project, and this one has to be, more than any before it
 *
 * `seedRosterEvent`'s argument applies and goes further. Every other fixture here is read, or
 * writes one column; **these tests write crossings**, and a crossing's anomaly is judged
 * against every other crossing on the same race. Two projects sharing a race would not merely
 * race each other — the *second* project's first bib would be flagged as a duplicate of the
 * first project's, which is a failure that reads as a broken anomaly rule.
 *
 * ## `relay`, unlike every other fixture here, and on purpose
 *
 * The roster and start fixtures are `solo`, where a bib is a whole team number and nothing is
 * read out of its first digit. This one is `relay`, because that is where `format` is
 * load-bearing: `147` is leg 1 of team 47, `247` is leg 2 of the same team, and the screen
 * flags a leg 2 with no handover recorded. A `solo` fixture could not tell a screen that
 * guessed the format from one that read it.
 *
 * **Started, with a team on it.** A crossing's trigger resolves a bib to a team, so a race
 * with no teams would record every crossing with `team_id` null — which is a legitimate state
 * and not the one worth testing against.
 */
export function captureEventSlug(project: string): string {
  // `zz-` for the reason `timing-fixtures.ts`'s header gives: a slug of that shape can never be
  // reached by `nnEventSlugForResultsPath`, so no results address can name one of these.
  return `zz-capture-${project.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/** The team on it, and therefore the bibs `147` and `247` resolve to. */
export const CAPTURE_TEAM_NUMBER = '47';

/**
 * Create the race and put one person on its roster.
 *
 * ⚠️ **The marshal is rostered and the admin deliberately is not.** ADR-036 makes the roster a
 * scope checked *after* the permission, for everybody — and `timing-admin` carries
 * `timing.crossing.record`, so an admin who is refused this race is the only thing that proves
 * the roster is being checked at all rather than the permission being checked twice.
 *
 * Must run **after** `seedTimingStaff()`, which is what creates the account this looks up.
 */
export async function seedCaptureEvent(
  project: string,
  marshalEmail: string,
): Promise<void> {
  const slug = captureEventSlug(project);
  await clearCaptureEvent(project);

  await withClient(async (db) => {
    const id = fixtureEventId(slug);

    await db.query(
      `insert into timing.events
         (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, $3, 'relay', '2026-10-25T00:00:00Z'::timestamptz,
               '2026-10-25T00:30:00Z'::timestamptz)`,
      [id, slug, `Capture fixture ${project}`],
    );

    await db.query(`insert into timing.teams (event_id, team_number) values ($1, $2)`, [
      id,
      CAPTURE_TEAM_NUMBER,
    ]);

    const { rows } = await db.query<{ id: string }>(
      'select id from auth.users where email = $1',
      [marshalEmail],
    );
    const marshalId = rows[0]?.id;
    if (marshalId === undefined) {
      throw new Error(`no auth.users row for ${marshalEmail} — seed the staff first`);
    }

    await db.query('insert into timing.marshals (event_id, user_id) values ($1, $2)', [
      id,
      marshalId,
    ]);
  });
}

/** What this race has recorded, oldest first — the assertion the screen cannot make itself. */
export async function captureCrossings(
  project: string,
): Promise<
  { id: string; bib: string | null; anomaly_flag: boolean; team_id: string | null }[]
> {
  return withClient(async (db) => {
    const { rows } = await db.query<{
      id: string;
      bib: string | null;
      anomaly_flag: boolean;
      team_id: string | null;
    }>(
      `select c.id, c.bib, c.anomaly_flag, c.team_id
         from timing.crossings c
         join timing.events e on e.id = c.event_id
        where e.slug = $1
        order by c.captured_at`,
      [captureEventSlug(project)],
    );

    return rows;
  });
}

/** By this project's own slug, and never wider — `clearTimingFixtures`' rule. */
export async function clearCaptureEvent(project: string): Promise<void> {
  await withClient(async (db) => {
    await db.query('delete from timing.events where slug = $1', [
      captureEventSlug(project),
    ]);
  });
}

/**
 * The race the anomaly and timing-log tests resolve against — #252.
 *
 * ## ⚠️ Re-seeded per test rather than per project, and that is the lesson from #203
 *
 * `seedCaptureEvent`'s header argues for one race per Playwright project. These tests need one
 * step more: every one of them **writes a resolution**, and a resolution is irreversible from
 * the page's point of view — a capture marked valid cannot be marked valid again, and the
 * second attempt answers `already_resolved`. Sharing captures between tests in one project
 * would make each test depend on which of its siblings had run first, which is exactly the
 * order dependency the capture screen's spec shipped with and CI caught.
 *
 * So {@link seedAnomalyCrossings} deletes and re-writes the captures, and the spec calls it in
 * a `beforeEach`. The event and its team are per project and are created once.
 */
export function anomalyEventSlug(project: string): string {
  // `zz-` for the reason `timing-fixtures.ts`'s header gives: a slug of that shape can never be
  // reached by `nnEventSlugForResultsPath`, so no results address can name one of these.
  return `zz-anomaly-${project.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/** The team on this race, and therefore the only bib that resolves to anybody. */
export const ANOMALY_TEAM_NUMBER = '311';

/** A second team on the same race, so a corrected bib has somewhere real to land. */
export const ANOMALY_SECOND_TEAM_NUMBER = '312';

/** A bib no team carries, so a capture holding it is an orphan for ever. */
export const ANOMALY_ORPHAN_BIB = '999';

/** The marshal's own words on the flagged capture, rendered verbatim by the triage page. */
export const ANOMALY_REASON = 'Duplicate bib 311 — already captured at 11:20:00';

export async function seedAnomalyEvent(project: string): Promise<void> {
  const slug = anomalyEventSlug(project);
  await clearAnomalyEvent(project);

  await withClient(async (db) => {
    const id = fixtureEventId(slug);

    // **Started**, because the timing log marks a capture recorded before the gun and one of
    // the tests reads that marker.
    await db.query(
      `insert into timing.events
         (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, $3, 'solo', '2026-11-01T11:00:00Z'::timestamptz,
               '2026-11-01T11:00:00Z'::timestamptz)`,
      [id, slug, `Anomaly fixture ${project}`],
    );

    // ⚠️ **Two teams, and the second one exists so a correction can land.** With one team the
    // only bib that resolves is the one already on the capture, so *every* edit a test could
    // make would orphan the row — and the log's "corrects a bib" test asserted plain success
    // against a page that correctly said the new bib matched nothing.
    await db.query(
      `insert into timing.teams (event_id, team_number) values ($1, $2), ($1, $3)`,
      [id, ANOMALY_TEAM_NUMBER, ANOMALY_SECOND_TEAM_NUMBER],
    );
  });

  await seedAnomalyCrossings(project);
}

/**
 * Three captures, re-written from scratch: one flagged, one orphan, one clean.
 *
 * ⚠️ **The ids are fixed and the audit rows are cleared with them.**
 * `timing.admin_actions.event_id` is `on delete set null`, so an action outlives the race it was
 * about — deliberately — and a test asserting "resolved once" would count a previous run's row
 * as well. `packages/db/tests/timing.test.ts` pays for the same thing in its own fixture.
 */
export async function seedAnomalyCrossings(project: string): Promise<void> {
  const slug = anomalyEventSlug(project);
  const eventId = fixtureEventId(slug);

  const flagged = anomalyCrossingId(project, 'flagged');
  const orphan = anomalyCrossingId(project, 'orphan');
  const clean = anomalyCrossingId(project, 'clean');

  await withClient(async (db) => {
    await db.query('delete from timing.crossings where event_id = $1', [eventId]);
    await db.query(
      `delete from timing.admin_actions
        where detail ->> 'crossing_id' = any($1::text[])`,
      [[flagged, orphan, clean]],
    );

    await db.query(
      `insert into timing.crossings
         (id, event_id, bib, captured_at, anomaly_flag, anomaly_reason)
       values ($1, $4, $7, '2026-11-01T11:30:00Z'::timestamptz, true, $8),
              ($2, $4, $5, '2026-11-01T11:31:00Z'::timestamptz, false, null),
              ($3, $4, $6, '2026-11-01T11:32:00Z'::timestamptz, false, null)`,
      [
        flagged,
        orphan,
        clean,
        eventId,
        ANOMALY_ORPHAN_BIB,
        ANOMALY_TEAM_NUMBER,
        ANOMALY_TEAM_NUMBER,
        ANOMALY_REASON,
      ],
    );
  });
}

/**
 * One capture's id, **per project** — deterministic and invented, the way every id here is.
 *
 * ⚠️ **These were three fixed constants and CI refused them within a minute.** Each project gets
 * its own race, but a crossing's primary key is global: `seedAnomalyCrossings` deletes
 * `where event_id = …`, so it never touches the other project's rows, and inserting the same
 * three ids answered `duplicate key value violates unique constraint "crossings_pkey"` in a
 * `beforeEach` — which takes a whole project down and reads as a broken application rather than
 * two fixtures colliding. **The rule is the one this file states three times already**: anything
 * a second project can be holding at the same moment has to carry the project in its key.
 */
export function anomalyCrossingId(
  project: string,
  which: 'flagged' | 'orphan' | 'clean',
): string {
  const suffix = { flagged: 1, orphan: 2, clean: 3 }[which];
  let hash = 0;
  for (const char of project) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `0a0a0a0a-0000-4000-8000-${hash.toString(16).padStart(8, '0')}${String(suffix).padStart(4, '0')}`;
}

/** What the database now says about one capture — the assertion the page cannot make itself. */
export async function anomalyCrossing(id: string): Promise<{
  bib: string | null;
  resolved_action: string | null;
  team_id: string | null;
} | null> {
  return withClient(async (db) => {
    const { rows } = await db.query<{
      bib: string | null;
      resolved_action: string | null;
      team_id: string | null;
    }>('select bib, resolved_action, team_id from timing.crossings where id = $1', [id]);

    return rows[0] ?? null;
  });
}

/** By this project's own slug, and never wider — `clearTimingFixtures`' rule. */
export async function clearAnomalyEvent(project: string): Promise<void> {
  await withClient(async (db) => {
    await db.query('delete from timing.events where slug = $1', [
      anomalyEventSlug(project),
    ]);
  });
}
