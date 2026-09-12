import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { effectiveBib } from '@src/shared/timing/bib';

/**
 * The `timing` schema — what it holds, what it refuses, and the one thing it must agree with
 * TypeScript about.
 *
 * ## The three properties this file exists for
 *
 * 1. **Row-level security is on and there is no policy anywhere.** That is the correct state
 *    for a schema whose surfaces do not exist yet, and it is deliberate rather than pending —
 *    `store` shipped the same way. A policy arrives with the screen it opens.
 * 2. **The columns that were minimised away are absent**, not merely unused. A parser can be
 *    changed; a column that does not exist cannot be filled in by accident.
 * 3. ⚠️ **The bib trigger and `bib.ts` agree.** ADR-034 names that lockstep as one of three
 *    things the rewrite may not break, and it is the one with **no symptom until a result is
 *    wrong** — a runner's time attributed to the wrong person, found after the prizes.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TABLES = ['events', 'teams', 'runners', 'crossings', 'marshals', 'admin_actions'];

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: LOCAL_DB });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe('the shape of the schema', () => {
  it('holds exactly these six tables', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'timing' order by tablename`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([...TABLES].sort());
  });

  it('has row-level security on every one of them', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'timing' and c.relkind = 'r'
        order by c.relname`,
    );

    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS off`).toBe(true);
    }
  });

  /**
   * ⚠️ **No policy is the point, not a gap.** With RLS on and no policy, no row is readable or
   * writable by `anon` or `authenticated` whatever the grants say — which is what "the results
   * are locked" means at the only layer that can actually enforce it.
   *
   * When this goes red it should be because a surface arrived with its policy, and the person
   * adding it should be naming the screen it opens in this file.
   */
  it('carries no policy at all, because no surface needs one yet', async () => {
    const { rows } = await db.query(
      `select polname from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'timing'`,
    );

    expect(rows).toEqual([]);
  });

  it('grants no table to anon or authenticated, now that the schema is exposed', async () => {
    // **The belt, and since 11 September 2026 it is the only one.** `timing` was absent from
    // `config.toml`'s `[api].schemas` until `results_for_event()` needed a route; now PostgREST
    // can reach every table here, and what stops it is that neither role holds a grant on any
    // of them. This is the assertion that makes exposing the schema safe rather than intended —
    // the same one `store.test.ts` makes for `store`.
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.role_table_grants
        where table_schema = 'timing' and grantee in ('anon', 'authenticated')`,
    );

    expect(rows[0]?.count).toBe('0');
  });
});

describe('what the club deliberately does not store about a runner', () => {
  /**
   * The registration parser drops these at the boundary and computes `age_on_day` instead.
   * This is the half of that rule the database can hold: a parser can be changed, and a column
   * that does not exist cannot be filled in by accident.
   */
  it('has no date of birth, address, phone, emergency contact or medical column', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'timing' and table_name = 'runners'`,
    );

    const columns = rows.map((r) => r.column_name);
    const forbidden =
      /dob|date_of_birth|birth|address|postcode|phone|emergency|medical|health/i;

    for (const column of columns) {
      expect(
        forbidden.test(column),
        `runners.${column} looks like minimised-away data`,
      ).toBe(false);
    }

    // And the column that replaced them is there.
    expect(columns).toContain('age_on_day');
  });
});

describe('bib resolution agrees with bib.ts', () => {
  /**
   * ⚠️ **The lockstep.** Each case is run through the trigger *and* through `effectiveBib`,
   * and the two must name the same team. Writing the expected answer by hand would only assert
   * that the trigger does what this file thinks; comparing against the TypeScript is what
   * makes it a lockstep.
   */
  const EVENT_RELAY = '00000000-0000-4000-8000-0000000000a1';
  const EVENT_SOLO = '00000000-0000-4000-8000-0000000000a2';

  beforeAll(async () => {
    await db.query(`delete from timing.events where id in ($1, $2)`, [
      EVENT_RELAY,
      EVENT_SOLO,
    ]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at) values
         ($1, 'zz-timing-relay', 'Relay Fixture', 'relay', '2026-07-08T18:00:00Z'),
         ($2, 'zz-timing-solo',  'Solo Fixture',  'solo',  '2026-11-01T11:00:00Z')`,
      [EVENT_RELAY, EVENT_SOLO],
    );
  });

  afterAll(async () => {
    await db.query(`delete from timing.events where id in ($1, $2)`, [
      EVENT_RELAY,
      EVENT_SOLO,
    ]);
  });

  const cases = [
    // team_number, bib_leg1, bib_leg2, the bib scanned, format
    { teamNumber: '47', leg1: null, leg2: null, bib: '147', format: 'relay' as const },
    { teamNumber: '47', leg1: null, leg2: null, bib: '247', format: 'relay' as const },
    // Team 100 derives "1100" and "2100", which still parses — and must not be confused with
    // team 10's "110" / "210".
    { teamNumber: '100', leg1: null, leg2: null, bib: '1100', format: 'relay' as const },
    { teamNumber: '10', leg1: null, leg2: null, bib: '110', format: 'relay' as const },
    // An override beats the derived bib, verbatim.
    { teamNumber: '47', leg1: '5', leg2: null, bib: '5', format: 'relay' as const },
    // An empty-string override is absent, so the derived bib still resolves.
    { teamNumber: '47', leg1: '', leg2: null, bib: '147', format: 'relay' as const },
    // Leading zeros are not normalised: "0311" is not "311".
    {
      teamNumber: '311',
      leg1: '0311',
      leg2: null,
      bib: '0311',
      format: 'relay' as const,
    },
    // Solo: the team number alone, with no leg prefix.
    { teamNumber: '42', leg1: null, leg2: null, bib: '42', format: 'solo' as const },
    { teamNumber: '42', leg1: '7', leg2: null, bib: '7', format: 'solo' as const },
  ];

  for (const [index, c] of cases.entries()) {
    it(`resolves ${c.format} bib "${c.bib}" the same way TypeScript does`, async () => {
      const eventId = c.format === 'relay' ? EVENT_RELAY : EVENT_SOLO;
      const teamId = `00000000-0000-4000-8000-0000000${String(index).padStart(5, '0')}`;

      await db.query(
        `insert into timing.teams (id, event_id, team_number, bib_leg1, bib_leg2)
           values ($1, $2, $3, $4, $5)`,
        [teamId, eventId, c.teamNumber, c.leg1, c.leg2],
      );

      const { rows } = await db.query<{ team_id: string | null }>(
        `insert into timing.crossings (event_id, bib, captured_at)
           values ($1, $2, now()) returning team_id`,
        [eventId, c.bib],
      );

      // TypeScript's answer for the same team and the same bib.
      const team = { team_number: c.teamNumber, bib_leg1: c.leg1, bib_leg2: c.leg2 };
      const tsMatches =
        effectiveBib(team, 1, c.format) === c.bib ||
        effectiveBib(team, 2, c.format) === c.bib;

      expect(tsMatches, 'bib.ts did not match this bib at all').toBe(true);
      expect(rows[0]?.team_id, 'the trigger resolved a different team than bib.ts').toBe(
        teamId,
      );

      await db.query(`delete from timing.teams where id = $1`, [teamId]);
    });
  }

  it('resolves no team for a bib nobody owns, rather than guessing', async () => {
    const { rows } = await db.query<{ team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, 'nobody', now()) returning team_id`,
      [EVENT_RELAY],
    );

    expect(rows[0]?.team_id).toBeNull();
  });

  it('accepts a crossing with no bib at all, because the queue captures time first', async () => {
    const { rows } = await db.query<{ team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, null, now()) returning team_id`,
      [EVENT_RELAY],
    );

    expect(rows[0]?.team_id).toBeNull();
  });
});

describe('what may be called, and by whom', () => {
  /**
   * **The exact list, so a fifth is a decision somebody takes in a diff rather than a side
   * effect** — `entries.test.ts`'s mechanism, and this assertion has already done its job
   * once: it went red the moment the registration import added three functions, which is
   * precisely what it is for.
   *
   * Every one of them authorises *inside itself* against a permission, so the grant only says
   * "you may ask":
   *
   *   * `results_for_event` — `nn.results.read`, the read behind `/nn/<year>/results/`;
   *   * `create_event` and `import_registration` — `timing.event.manage` and
   *     `timing.registration.import`, the write path an entry list arrives through;
   *   * `event_roster` — `timing.registration.import`, reading back what landed;
   *   * `list_events` and `event_detail` — `timing.event.manage`, the two reads the events
   *     hub is built from, both answering `null` when refused;
   *   * `update_event` — `timing.event.manage`, correcting a race **before** it starts;
   *   * `roster_for_event`, `assignable_marshals`, `assign_marshal` and `unassign_marshal` —
   *     `timing.marshal.assign`, the per-event scope ADR-036 checks *after* the permission;
   *   * `record_crossing` and `known_crossings` — `timing.crossing.record` **and** a roster
   *     row, the write path #203 syncs against and the read it de-duplicates from.
   *
   * ⚠️ **`anon` holds none of them, and the bib trigger function is on nobody's list.** The
   * trigger is reachable from its trigger and nothing else; a grant on it would be a function
   * anybody could call to probe how bibs resolve. Both migrations revoke it defensively, and
   * this is what says that held.
   */
  it('grants exactly these thirteen functions, and only to authenticated', async () => {
    const { rows } = await db.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
         from information_schema.role_routine_grants
        where routine_schema = 'timing' and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by routine_name, grantee`,
    );

    expect(rows).toEqual([
      { routine_name: 'assign_marshal', grantee: 'authenticated' },
      { routine_name: 'assignable_marshals', grantee: 'authenticated' },
      { routine_name: 'create_event', grantee: 'authenticated' },
      { routine_name: 'event_detail', grantee: 'authenticated' },
      { routine_name: 'event_roster', grantee: 'authenticated' },
      { routine_name: 'import_registration', grantee: 'authenticated' },
      { routine_name: 'known_crossings', grantee: 'authenticated' },
      { routine_name: 'list_events', grantee: 'authenticated' },
      { routine_name: 'record_crossing', grantee: 'authenticated' },
      { routine_name: 'results_for_event', grantee: 'authenticated' },
      { routine_name: 'roster_for_event', grantee: 'authenticated' },
      { routine_name: 'unassign_marshal', grantee: 'authenticated' },
      { routine_name: 'update_event', grantee: 'authenticated' },
    ]);
  });

  /**
   * The refusal, asserted as the specific answer rather than as "something went wrong". A
   * connection with no token has no `auth.uid()`, so `identity.has_permission()` is false and
   * the function answers `null` — not an error, and not the results.
   */
  it('answers null to a caller without nn.results.read, rather than the results', async () => {
    const { rows } = await db.query<{ results: unknown }>(
      `select timing.results_for_event('nn-2026') as results`,
    );

    expect(rows[0]?.results).toBeNull();
  });
});

describe('the one read, for somebody who holds nn.results.read', () => {
  /**
   * **The positive case, at the layer that enforces it.** The fixtures write `auth.users`
   * directly and set `request.jwt.claims` by hand — `store.test.ts`'s pattern, and for its
   * reason: what is under test is `identity.has_permission()` inside a `security definer`
   * function, and `set_config('request.jwt.claims', …)` is exactly how PostgREST presents a
   * signed-in caller to Postgres. Every call runs in a transaction that is rolled back.
   *
   * ⚠️ **The minimisation assertion is the one that matters most.** The fixture runner has an
   * email address and a club, and the answer must carry neither: a results page needs a name,
   * a gender and an age, and data minimisation applies to what is read as much as to what is
   * stored.
   */
  const RESULTS_READER = '33333333-3333-4333-8333-333333333333';
  const NOBODY = '44444444-4444-4444-8444-444444444444';
  const EVENT_ID = '00000000-0000-4000-8000-0000000000b1';
  const TEAM_ID = '00000000-0000-4000-8000-0000000000b2';
  const SLUG = 'zz-timing-results';

  type ResultsAnswer = {
    event: Record<string, unknown> & { slug: string; format: string };
    teams: { team_number: string | null; runners: Record<string, unknown>[] }[];
    crossings: { bib: string | null }[];
  };

  async function asPerson(personId: string): Promise<ResultsAnswer | null> {
    await db.query('begin');

    try {
      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [personId],
      );

      const { rows } = await db.query<{ results: ResultsAnswer | null }>(
        'select timing.results_for_event($1) as results',
        [SLUG],
      );

      return rows[0]?.results ?? null;
    } finally {
      await db.query('rollback');
    }
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [RESULTS_READER, 'timing-results-reader@example.com'],
      [NOBODY, 'timing-results-nobody@example.com'],
    ]) {
      await db.query(
        `insert into auth.users
           (id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, 'not-a-password', now(), now(), now())
         on conflict (id) do nothing`,
        [id, email],
      );
    }

    await db.query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, 'nn-results', $1) on conflict do nothing`,
      [RESULTS_READER],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at)
       values ($1, $2, 'Results Fixture', 'solo', '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '42')`,
      [TEAM_ID, EVENT_ID],
    );
    await db.query(
      `insert into timing.runners
         (team_id, leg, firstname, lastname, gender, email, club_name, age_on_day)
       values ($1, 1, 'Ada', 'Lovelace', 'F', 'ada.lovelace@example.com', 'Fixture Harriers', 34)`,
      [TEAM_ID],
    );
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '42', '2026-11-01T11:40:00Z')`,
      [EVENT_ID],
    );
  });

  afterAll(async () => {
    // The event cascades to its teams, runners and crossings. `auth.users` is left, as
    // `store.test.ts` leaves its own: fixed ids and `on conflict do nothing` make a re-run safe.
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = $1', [
      RESULTS_READER,
    ]);
  });

  it('returns the event, its teams with their runners, and its crossings', async () => {
    const results = await asPerson(RESULTS_READER);

    expect(results).not.toBeNull();
    expect(results?.event).toMatchObject({ slug: SLUG, format: 'solo' });
    expect(results?.teams).toHaveLength(1);
    expect(results?.teams[0]?.team_number).toBe('42');
    expect(results?.teams[0]?.runners[0]).toMatchObject({
      firstname: 'Ada',
      lastname: 'Lovelace',
      gender: 'F',
      age_on_day: 34,
    });
    expect(results?.crossings).toEqual([expect.objectContaining({ bib: '42' })]);
  });

  /**
   * ⚠️ **The two columns every derived time is measured against, asserted as *present* rather
   * than by value.** `raceStartIso()` is `actually_started_at ?? start_at`, so a key this
   * function stopped building would arrive as `undefined`, coalesce to the scheduled start, and
   * make every split on the results page wrong by however long the start slipped — with no
   * error anywhere and a table that looks entirely plausible. A coalesce cannot distinguish
   * "no delayed start" from "the column was not sent", which is why the key has to be checked
   * and not only the value.
   *
   * `finished_at` goes with them because `nn-results.ts` names it in the payload it reads;
   * `format` is asserted above, and it is what decides whether a bib derives with a leg prefix.
   */
  it('carries the timestamps a derived time is measured against, as keys', async () => {
    const results = await asPerson(RESULTS_READER);

    expect(Object.keys(results?.event ?? {}).sort()).toEqual([
      'actually_started_at',
      'finished_at',
      'format',
      'name',
      'slug',
      'start_at',
    ]);

    // This fixture's start was not delayed, so the column is null and `start_at` is what a
    // split would be measured from — which is the fallback working, not the key missing.
    expect(results?.event.actually_started_at).toBeNull();
    expect(results?.event.start_at).not.toBeNull();
  });

  it('carries no email address and no club, because a results page needs neither', async () => {
    const text = JSON.stringify(await asPerson(RESULTS_READER));

    expect(text).not.toContain('ada.lovelace@example.com');
    expect(text).not.toContain('Fixture Harriers');
    expect(text).not.toMatch(/"email"|"club_name"/);
  });

  it('answers null to a signed-in person who does not hold the permission', async () => {
    expect(await asPerson(NOBODY)).toBeNull();
  });
});

/**
 * The events hub's two reads and its one write — #247.
 *
 * Same fixture style as the results block above and for the same reason: what is under test is
 * `identity.has_permission()` inside a `security definer` function, and
 * `set_config('request.jwt.claims', …)` is how PostgREST presents a signed-in caller to
 * Postgres. Every call runs in a transaction that is rolled back.
 *
 * ⚠️ **The negative cases come first deliberately.** That a `timing-admin` can read a list
 * proves less than that a `timing-marshal` cannot — a marshal is on the timing system, holds a
 * `timing.*` permission, and is refused because it is not *this* one. A door that opened to
 * any timing permission would pass every positive test in this block.
 */
describe('listing, reading and correcting an event', () => {
  const MANAGER = '55555555-5555-4555-8555-555555555555';
  const MARSHAL = '66666666-6666-4666-8666-666666666666';
  const EVENT_ID = '00000000-0000-4000-8000-0000000000c1';
  const TEAM_ID = '00000000-0000-4000-8000-0000000000c2';
  const STARTED_ID = '00000000-0000-4000-8000-0000000000c3';
  const SLUG = 'zz-timing-events';
  const STARTED_SLUG = 'zz-timing-events-started';

  /** Runs one statement as a given person, inside a transaction that is always rolled back. */
  async function asPerson<T>(
    personId: string,
    sql: string,
    params: unknown[],
  ): Promise<T> {
    await db.query('begin');

    try {
      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [personId],
      );

      const { rows } = await db.query<{ answer: T }>(sql, params);
      return rows[0]?.answer as T;
    } finally {
      await db.query('rollback');
    }
  }

  const listAs = (person: string) =>
    asPerson<unknown>(person, 'select timing.list_events() as answer', []);

  const detailAs = (person: string, slug = SLUG) =>
    asPerson<Record<string, unknown> | null>(
      person,
      'select timing.event_detail($1) as answer',
      [slug],
    );

  const updateAs = (
    person: string,
    slug: string,
    name: string | null,
    startAt: string | null,
    distance: number | null = null,
    notes: string | null = null,
  ) =>
    asPerson<{ ok: boolean; reason?: string; slug?: string }>(
      person,
      'select timing.update_event($1, $2, $3, $4, $5) as answer',
      [slug, name, startAt, distance, notes],
    );

  beforeAll(async () => {
    for (const [id, email] of [
      [MANAGER, 'timing-events-manager@example.com'],
      [MARSHAL, 'timing-events-marshal@example.com'],
    ]) {
      await db.query(
        `insert into auth.users
           (id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, 'not-a-password', now(), now(), now())
         on conflict (id) do nothing`,
        [id, email],
      );
    }

    await db.query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, 'timing-admin', $1), ($2, 'timing-marshal', $2)
       on conflict do nothing`,
      [MANAGER, MARSHAL],
    );

    for (const id of [EVENT_ID, STARTED_ID]) {
      await db.query('delete from timing.events where id = $1', [id]);
    }

    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, distance_m, course_notes)
       values ($1, $2, 'Events Fixture', 'solo', '2026-11-01T11:00:00Z', 10000, 'Two laps')`,
      [EVENT_ID, SLUG],
    );

    // A race that has already gone off, which is what `update_event` must refuse.
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, 'Already Started', 'solo',
               '2026-11-01T11:00:00Z', '2026-11-01T11:02:00Z')`,
      [STARTED_ID, STARTED_SLUG],
    );

    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '7')`,
      [TEAM_ID, EVENT_ID],
    );
    await db.query(
      `insert into timing.runners (team_id, leg, firstname, lastname)
       values ($1, 1, 'Grace', 'Hopper')`,
      [TEAM_ID],
    );
    // Three crossings: one clean, one anomaly still open, one anomaly already resolved. The
    // third is what stops `open_anomalies` being satisfied by `count(*) where anomaly_flag`.
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at, anomaly_flag, resolved_at)
       values ($1, '7', '2026-11-01T11:40:00Z', false, null),
              ($1, '7', '2026-11-01T11:41:00Z', true, null),
              ($1, '7', '2026-11-01T11:42:00Z', true, '2026-11-01T12:00:00Z')`,
      [EVENT_ID],
    );
    await db.query(
      `insert into timing.marshals (event_id, user_id) values ($1, $2)
       on conflict do nothing`,
      [EVENT_ID, MARSHAL],
    );
  });

  afterAll(async () => {
    for (const id of [EVENT_ID, STARTED_ID]) {
      await db.query('delete from timing.events where id = $1', [id]);
    }
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [MANAGER, MARSHAL],
    ]);
  });

  describe('who is refused', () => {
    it('answers null to a marshal, who is timing staff and still may not', async () => {
      expect(await listAs(MARSHAL)).toBeNull();
      expect(await detailAs(MARSHAL)).toBeNull();
    });

    it('refuses a marshal the update, with a reason rather than a raised error', async () => {
      // A writer says why; a reader says nothing. The asymmetry is deliberate — a form needs
      // words, and a read must not disclose that the slug exists.
      expect(
        await updateAs(MARSHAL, SLUG, 'Renamed by a marshal', '2026-11-01T11:00:00Z'),
      ).toEqual({ ok: false, reason: 'refused' });
    });

    it('leaves the event untouched when the update was refused', async () => {
      await updateAs(MARSHAL, SLUG, 'Renamed by a marshal', '2026-11-01T11:00:00Z');

      // Read back as somebody who may, so a refusal that silently wrote cannot hide behind
      // the refusal that the marshal also gets on the read.
      expect((await detailAs(MANAGER))?.['name']).toBe('Events Fixture');
    });

    /**
     * `null` for "no such event" and `null` for "you may not" are the same answer on purpose,
     * so a slug cannot be probed for existence by somebody holding nothing.
     */
    it('gives a manager the same null for a slug that does not exist', async () => {
      expect(await detailAs(MANAGER, 'zz-no-such-event-at-all')).toBeNull();
      expect(await detailAs(MARSHAL, 'zz-no-such-event-at-all')).toBeNull();
    });
  });

  describe('what a manager reads', () => {
    it('lists the event, with the figures the index sorts on', async () => {
      const events = (await listAs(MANAGER)) as Record<string, unknown>[];

      const mine = events.find((e) => e['slug'] === SLUG);

      expect(mine).toMatchObject({
        name: 'Events Fixture',
        format: 'solo',
        teams: 1,
        open_anomalies: 1,
      });
    });

    it('counts the field, the crossings and only the anomalies still open', async () => {
      const detail = await detailAs(MANAGER);

      expect(detail).toMatchObject({
        slug: SLUG,
        name: 'Events Fixture',
        distance_m: 10000,
        course_notes: 'Two laps',
        editable: true,
      });

      // Three crossings, two flagged, one of those resolved — so one is open. A count written
      // as `where anomaly_flag` alone would say two here, and that is the whole point of the
      // third fixture row.
      expect(detail?.['counts']).toEqual({
        teams: 1,
        runners: 1,
        crossings: 3,
        open_anomalies: 1,
        marshals: 1,
      });
    });

    it('says a race that has gone off is not editable', async () => {
      const detail = await detailAs(MANAGER, STARTED_SLUG);

      expect(detail?.['editable']).toBe(false);
      expect(detail?.['actually_started_at']).not.toBeNull();
    });
  });

  describe('what a manager may change, and when', () => {
    it('applies a correction before the race starts', async () => {
      // One transaction: the update and the read-back both roll back, so the fixture the rest
      // of this block reads is untouched.
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MANAGER],
        );

        const { rows: wrote } = await db.query<{ answer: { ok: boolean } }>(
          'select timing.update_event($1, $2, $3, $4, $5) as answer',
          [SLUG, '  Corrected Name  ', '2026-11-01T10:30:00Z', 10500, null],
        );
        expect(wrote[0]?.answer).toEqual({ ok: true, slug: SLUG });

        const { rows: read } = await db.query<{ answer: Record<string, unknown> }>(
          'select timing.event_detail($1) as answer',
          [SLUG],
        );

        // Trimmed, exactly as `create_event` trims — and `course_notes` really is cleared by
        // passing null, which is what makes this a whole-record update rather than a patch.
        expect(read[0]?.answer).toMatchObject({
          name: 'Corrected Name',
          distance_m: 10500,
          course_notes: null,
        });
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * ⚠️ **The rule this function exists to enforce.** Every split is measured against
     * `coalesce(actually_started_at, start_at)`, so moving the start after the gun rewrites
     * every derived time in the race.
     */
    it('refuses the whole update once the race has actually started', async () => {
      expect(
        await updateAs(MANAGER, STARTED_SLUG, 'Too late', '2026-11-01T09:00:00Z'),
      ).toEqual({ ok: false, reason: 'already_started' });
    });

    it('refuses a blank name and a missing start, rather than storing them', async () => {
      expect(await updateAs(MANAGER, SLUG, '   ', '2026-11-01T11:00:00Z')).toEqual({
        ok: false,
        reason: 'incomplete',
      });
      expect(await updateAs(MANAGER, SLUG, 'Fine', null)).toEqual({
        ok: false,
        reason: 'incomplete',
      });
    });

    it('refuses a distance the table would refuse anyway, in words a form can print', async () => {
      expect(await updateAs(MANAGER, SLUG, 'Fine', '2026-11-01T11:00:00Z', 0)).toEqual({
        ok: false,
        reason: 'invalid_distance',
      });
    });

    it('says so plainly when the slug names nothing', async () => {
      expect(
        await updateAs(
          MANAGER,
          'zz-no-such-event-at-all',
          'Fine',
          '2026-11-01T11:00:00Z',
        ),
      ).toEqual({ ok: false, reason: 'no_such_event' });
    });
  });
});

/**
 * The per-event marshal roster — #245, under ADR-036.
 *
 * ⚠️ **The whole point is that this is a scope and not an authority.** Whether somebody may
 * record a crossing at all is `timing.crossing.record` in `identity`; this table says *which
 * races*, checked after the permission. So the assertion that matters most is that a person
 * without that permission **cannot be put on a roster at all** — a row saying otherwise would
 * be a roster that had quietly granted something.
 */
describe('the marshal roster', () => {
  const ASSIGNER = '77777777-7777-4777-8777-777777777777';
  const MARSHAL = '88888888-8888-4888-8888-888888888888';
  const OUTSIDER = '99999999-9999-4999-8999-999999999999';
  const EVENT_ID = '00000000-0000-4000-8000-0000000000d1';
  const SLUG = 'zz-timing-roster';

  async function asPerson<T>(
    personId: string,
    sql: string,
    params: unknown[],
  ): Promise<T> {
    await db.query('begin');
    try {
      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [personId],
      );
      const { rows } = await db.query<{ answer: T }>(sql, params);
      return rows[0]?.answer as T;
    } finally {
      await db.query('rollback');
    }
  }

  type Envelope = { ok: boolean; reason?: string };

  const rosterAs = (person: string, slug = SLUG) =>
    asPerson<Record<string, unknown> | null>(
      person,
      'select timing.roster_for_event($1) as answer',
      [slug],
    );

  const pickerAs = (person: string) =>
    asPerson<Record<string, unknown>[] | null>(
      person,
      'select timing.assignable_marshals() as answer',
      [],
    );

  const assignAs = (actor: string, subject: string, slug = SLUG) =>
    asPerson<Envelope>(actor, 'select timing.assign_marshal($1, $2) as answer', [
      slug,
      subject,
    ]);

  const unassignAs = (actor: string, subject: string, slug = SLUG) =>
    asPerson<Envelope>(actor, 'select timing.unassign_marshal($1, $2) as answer', [
      slug,
      subject,
    ]);

  beforeAll(async () => {
    for (const [id, email] of [
      [ASSIGNER, 'timing-roster-assigner@example.com'],
      [MARSHAL, 'timing-roster-marshal@example.com'],
      [OUTSIDER, 'timing-roster-outsider@example.com'],
    ]) {
      await db.query(
        `insert into auth.users
           (id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, 'not-a-password', now(), now(), now())
         on conflict (id) do nothing`,
        [id, email],
      );
      await db.query(
        `insert into identity.people (id) values ($1) on conflict (id) do nothing`,
        [id],
      );
    }

    await db.query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, 'timing-admin', $1), ($2, 'timing-marshal', $2), ($3, 'registered', $3)
       on conflict do nothing`,
      [ASSIGNER, MARSHAL, OUTSIDER],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at)
       values ($1, $2, 'Roster Fixture', 'solo', '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
  });

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [ASSIGNER, MARSHAL, OUTSIDER],
    ]);
  });

  describe('who may look and who may act', () => {
    it('answers null to a marshal, who may capture and may not assign', async () => {
      expect(await rosterAs(MARSHAL)).toBeNull();
      expect(await pickerAs(MARSHAL)).toBeNull();
    });

    it('refuses a marshal both writes, with a reason', async () => {
      expect(await assignAs(MARSHAL, MARSHAL)).toEqual({ ok: false, reason: 'refused' });
      expect(await unassignAs(MARSHAL, MARSHAL)).toEqual({
        ok: false,
        reason: 'refused',
      });
    });

    it('gives the same null for a slug that does not exist', async () => {
      expect(await rosterAs(ASSIGNER, 'zz-no-such-roster')).toBeNull();
      expect(await rosterAs(MARSHAL, 'zz-no-such-roster')).toBeNull();
    });
  });

  /**
   * ⚠️ **ADR-036 in one assertion.** The roster narrows a permission; it cannot grant one. A
   * function that wrote the row anyway would produce a person who is on a race roster and
   * still cannot record anything — a state with no meaning, discovered at a finish line.
   */
  describe('the roster cannot grant a permission', () => {
    it('refuses somebody who does not hold timing.crossing.record', async () => {
      expect(await assignAs(ASSIGNER, OUTSIDER)).toEqual({
        ok: false,
        reason: 'not_a_marshal',
      });
    });

    it('writes no row when it refuses', async () => {
      await assignAs(ASSIGNER, OUTSIDER);

      const { rows } = await db.query<{ n: string }>(
        'select count(*) as n from timing.marshals where event_id = $1 and user_id = $2',
        [EVENT_ID, OUTSIDER],
      );
      expect(rows[0]?.n).toBe('0');
    });

    /**
     * A revoked role is not a permission. `role_grants.revoked_at` is set rather than the row
     * deleted — `identity.audit` names a grant by its row — so a join that forgot it would
     * quietly re-admit everybody who ever held the role.
     */
    it('refuses somebody whose marshal role has been revoked', async () => {
      await db.query(
        `update identity.role_grants set revoked_at = now()
          where person_id = $1 and role = 'timing-marshal'`,
        [MARSHAL],
      );
      try {
        expect(await assignAs(ASSIGNER, MARSHAL)).toEqual({
          ok: false,
          reason: 'not_a_marshal',
        });

        // Gone from the picker too — but the picker is not empty, because the assigner
        // holds `timing-admin`, which carries all six timing permissions including
        // `timing.crossing.record`. See the block below.
        const ids = ((await pickerAs(ASSIGNER)) ?? []).map((p) => p['person_id']);
        expect(ids).not.toContain(MARSHAL);
      } finally {
        await db.query(
          `update identity.role_grants set revoked_at = null
            where person_id = $1 and role = 'timing-marshal'`,
          [MARSHAL],
        );
      }
    });
  });

  describe('the picker', () => {
    it('offers only people holding timing.crossing.record', async () => {
      const ids = ((await pickerAs(ASSIGNER)) ?? []).map((p) => p['person_id']);

      expect(ids).toContain(MARSHAL);
      expect(ids).not.toContain(OUTSIDER);
    });

    /**
     * ⚠️ **A `timing-admin` is in the picker, and that is the requirement rather than a leak.**
     * `timing-admin` carries all six timing permissions, `timing.crossing.record` among them,
     * so an admin genuinely may capture — and #245 is explicit that one who is going to stand
     * at the line **adds themselves**, because ADR-036 checks the roster after the permission
     * for everybody and the old application's global-admin bypass is what that replaces.
     *
     * This assertion is here because the first version of this test asserted the opposite and
     * failed, which is the useful direction for a test to fail in.
     */
    it('includes an admin, who may capture and must still be rostered to do it', async () => {
      const ids = ((await pickerAs(ASSIGNER)) ?? []).map((p) => p['person_id']);

      expect(ids).toContain(ASSIGNER);
    });

    it('carries an address, because identifying one person is its whole job', async () => {
      const people = (await pickerAs(ASSIGNER)) ?? [];
      const marshal = people.find((p) => p['person_id'] === MARSHAL);

      // `identity.people.name` is null until #61, so without this the list is
      // indistinguishable rows and the failure mode is assigning the wrong person.
      expect(marshal).toMatchObject({ email: 'timing-roster-marshal@example.com' });
    });

    /**
     * It is not `identity.list_people()` with a filter — that is a different and much larger
     * question, behind `identity.person.read`, which this caller need not hold.
     */
    it('is not the club, however many people have accounts', async () => {
      const ids = ((await pickerAs(ASSIGNER)) ?? []).map((p) => p['person_id']);

      // A registered member with an account and no timing permission is not offered.
      expect(ids).not.toContain(OUTSIDER);
    });
  });

  describe('assigning, and taking somebody off again', () => {
    it('adds a marshal, audits it, and is idempotent on a second ask', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [ASSIGNER],
        );

        const first = await db.query<{ answer: Envelope }>(
          'select timing.assign_marshal($1, $2) as answer',
          [SLUG, MARSHAL],
        );
        expect(first.rows[0]?.answer).toMatchObject({ ok: true });

        // Asked twice: still one row, because the primary key says so.
        await db.query('select timing.assign_marshal($1, $2)', [SLUG, MARSHAL]);

        // ⚠️ **Back to the owning role before reading a table directly.** `authenticated`
        // holds no grant on any table in `timing` — that is the property `timing.test.ts`
        // asserts a few blocks up — so a verification read left under the impersonated role
        // fails with `permission denied`, which looks like a broken function and is not one.
        await db.query("select set_config('role', 'postgres', true)");

        const { rows } = await db.query<{ n: string }>(
          'select count(*) as n from timing.marshals where event_id = $1 and user_id = $2',
          [EVENT_ID, MARSHAL],
        );
        expect(rows[0]?.n).toBe('1');

        // Both asks audited. "Somebody asked for this person to be on this roster" is the
        // fact worth keeping, and a second ask is not a different intention.
        const audit = await db.query<{ n: string }>(
          `select count(*) as n from timing.admin_actions
            where event_id = $1 and action = 'marshal_assigned'`,
          [EVENT_ID],
        );
        expect(audit.rows[0]?.n).toBe('2');
      } finally {
        await db.query('rollback');
      }
    });

    it('says so rather than claiming success when the person was never on the roster', async () => {
      expect(await unassignAs(ASSIGNER, MARSHAL)).toEqual({
        ok: false,
        reason: 'not_on_roster',
      });
    });

    /**
     * ⚠️ **The case #245 names explicitly.** `crossings.marshal_id` is `on delete set null`
     * against `auth.users`, which is for an account that is gone. A roster change is not that:
     * somebody taken off a roster at 11:40 has not un-seen the runners who crossed at 11:30.
     */
    it('leaves the crossings a removed marshal recorded exactly as they were', async () => {
      await db.query('begin');
      try {
        await db.query(
          'insert into timing.marshals (event_id, user_id) values ($1, $2)',
          [EVENT_ID, MARSHAL],
        );
        await db.query(
          `insert into timing.crossings (event_id, marshal_id, bib, captured_at)
           values ($1, $2, '11', '2026-11-01T11:30:00Z')`,
          [EVENT_ID, MARSHAL],
        );

        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [ASSIGNER],
        );

        const { rows: off } = await db.query<{ answer: Envelope }>(
          'select timing.unassign_marshal($1, $2) as answer',
          [SLUG, MARSHAL],
        );
        expect(off[0]?.answer).toMatchObject({ ok: true });

        // See the note above: `authenticated` may not read these tables directly.
        await db.query("select set_config('role', 'postgres', true)");

        const { rows } = await db.query<{ marshal_id: string | null; bib: string }>(
          'select marshal_id, bib from timing.crossings where event_id = $1',
          [EVENT_ID],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.bib).toBe('11');
        // Still attributed. This is the assertion, not the row count.
        expect(rows[0]?.marshal_id).toBe(MARSHAL);
      } finally {
        await db.query('rollback');
      }
    });

    it('reads the roster back with a name key, null until #61 writes one', async () => {
      await db.query('begin');
      try {
        await db.query(
          'insert into timing.marshals (event_id, user_id) values ($1, $2)',
          [EVENT_ID, MARSHAL],
        );
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [ASSIGNER],
        );

        const { rows } = await db.query<{
          answer: { marshals: Record<string, unknown>[] };
        }>('select timing.roster_for_event($1) as answer', [SLUG]);

        expect(rows[0]?.answer.marshals).toEqual([
          expect.objectContaining({ person_id: MARSHAL, name: null }),
        ]);
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * A roster is who is at the line, not how to contact them. The picker carries an address
     * because identifying somebody is its whole job; this must not.
     */
    it('carries no email address at all', async () => {
      await db.query('begin');
      try {
        await db.query(
          'insert into timing.marshals (event_id, user_id) values ($1, $2)',
          [EVENT_ID, MARSHAL],
        );
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [ASSIGNER],
        );

        const { rows } = await db.query<{ answer: unknown }>(
          'select timing.roster_for_event($1) as answer',
          [SLUG],
        );
        const text = JSON.stringify(rows[0]?.answer);

        expect(text).not.toContain('timing-roster-marshal@example.com');
        expect(text).not.toMatch(/"email"/);
      } finally {
        await db.query('rollback');
      }
    });
  });
});

/**
 * The crossing write path — #251, the contract #203's offline queue syncs against.
 *
 * ⚠️ **Idempotency is the property, and it is not "the second call does nothing".** It is that
 * the second call **succeeds** — a queue that got back an error on a retry of a row that had
 * already landed would retry for ever, or retire the card as failed and show "Manual review"
 * for a crossing that is in the database. Both assertions are here.
 */
describe('recording a crossing', () => {
  const MARSHAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const OFF_ROSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const EVENT_ID = '00000000-0000-4000-8000-0000000000e1';
  const TEAM_ID = '00000000-0000-4000-8000-0000000000e2';
  const SLUG = 'zz-timing-crossings';

  type Envelope = { ok: boolean; reason?: string; id?: string };

  async function asPerson<T>(
    personId: string,
    sql: string,
    params: unknown[],
  ): Promise<T> {
    await db.query('begin');
    try {
      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [personId],
      );
      const { rows } = await db.query<{ answer: T }>(sql, params);
      return rows[0]?.answer as T;
    } finally {
      await db.query('rollback');
    }
  }

  const recordAs = (
    person: string,
    id: string,
    bib: string | null,
    capturedAt = '2026-11-01T11:30:00Z',
    slug = SLUG,
    source = 'tap',
  ) =>
    asPerson<Envelope>(
      person,
      'select timing.record_crossing($1, $2, $3, $4, $5) as answer',
      [id, slug, bib, capturedAt, source],
    );

  const knownAs = (person: string, slug = SLUG) =>
    asPerson<Record<string, unknown>[] | null>(
      person,
      'select timing.known_crossings($1) as answer',
      [slug],
    );

  beforeAll(async () => {
    for (const [id, email] of [
      [MARSHAL, 'timing-crossing-marshal@example.com'],
      [ADMIN, 'timing-crossing-admin@example.com'],
      [OFF_ROSTER, 'timing-crossing-offroster@example.com'],
    ]) {
      await db.query(
        `insert into auth.users
           (id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, 'not-a-password', now(), now(), now())
         on conflict (id) do nothing`,
        [id, email],
      );
      await db.query(
        'insert into identity.people (id) values ($1) on conflict (id) do nothing',
        [id],
      );
    }

    await db.query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, 'timing-marshal', $1), ($2, 'timing-admin', $2),
              ($3, 'timing-marshal', $3)
       on conflict do nothing`,
      [MARSHAL, ADMIN, OFF_ROSTER],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at)
       values ($1, $2, 'Crossing Fixture', 'solo', '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '311')`,
      [TEAM_ID, EVENT_ID],
    );

    // Only the marshal is rostered. The admin deliberately is not — see ADR-036.
    await db.query(
      'insert into timing.marshals (event_id, user_id) values ($1, $2) on conflict do nothing',
      [EVENT_ID, MARSHAL],
    );
  });

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [MARSHAL, ADMIN, OFF_ROSTER],
    ]);
  });

  describe('who may write', () => {
    /**
     * ⚠️ **ADR-036's rule, and the old application's bug.** A `timing-admin` holds
     * `timing.crossing.record` and is still refused on a race they are not rostered to. The
     * old app let a global admin bypass the roster; an admin who is going to stand at the line
     * adds themselves with `assign_marshal()`.
     */
    it('refuses an admin who is not on this roster', async () => {
      expect(
        await recordAs(ADMIN, '11111111-1111-4111-8111-111111111111', '311'),
      ).toEqual({
        ok: false,
        reason: 'not_on_roster',
      });
    });

    it('refuses a marshal who is not on this roster either', async () => {
      expect(
        await recordAs(OFF_ROSTER, '11111111-1111-4111-8111-111111111112', '311'),
      ).toEqual({ ok: false, reason: 'not_on_roster' });
    });

    it('writes nothing when it refuses', async () => {
      await recordAs(ADMIN, '11111111-1111-4111-8111-111111111113', '311');

      const { rows } = await db.query<{ n: string }>(
        'select count(*) as n from timing.crossings where id = $1',
        ['11111111-1111-4111-8111-111111111113'],
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('refuses a slug that names nothing, without saying whether the roster would have', async () => {
      expect(
        await recordAs(
          MARSHAL,
          '11111111-1111-4111-8111-111111111114',
          '311',
          '2026-11-01T11:30:00Z',
          'zz-no-such-race',
        ),
      ).toEqual({ ok: false, reason: 'no_such_event' });
    });

    it('answers null on the read to everybody who may not write', async () => {
      expect(await knownAs(ADMIN)).toBeNull();
      expect(await knownAs(OFF_ROSTER)).toBeNull();
    });
  });

  describe('the same tap, sent more than once', () => {
    const ID = '22222222-2222-4222-8222-222222222221';

    it('writes one row and calls the retry a success', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );

        const first = await db.query<{ answer: Envelope }>(
          'select timing.record_crossing($1, $2, $3, $4) as answer',
          [ID, SLUG, '311', '2026-11-01T11:30:00Z'],
        );
        const second = await db.query<{ answer: Envelope }>(
          'select timing.record_crossing($1, $2, $3, $4) as answer',
          [ID, SLUG, '311', '2026-11-01T11:30:00Z'],
        );

        // Both `ok`. A queue that got an error on the retry would either loop for ever or
        // show "Manual review" for a crossing that is in the database.
        expect(first.rows[0]?.answer).toEqual({ ok: true, id: ID });
        expect(second.rows[0]?.answer).toEqual({ ok: true, id: ID });

        await db.query("select set_config('role', 'postgres', true)");
        const { rows } = await db.query<{ n: string }>(
          'select count(*) as n from timing.crossings where id = $1',
          [ID],
        );
        expect(rows[0]?.n).toBe('1');
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * ⚠️ **The reason it is `do nothing` and not `do update`.** A marshal's phone draining an
     * hour-old queue must not overwrite a bib an admin has corrected in the meantime.
     */
    it('does not overwrite a bib an admin has corrected since', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        await db.query('select timing.record_crossing($1, $2, $3, $4)', [
          ID,
          SLUG,
          '311',
          '2026-11-01T11:30:00Z',
        ]);

        // The admin's correction, applied directly the way the resolve surface will.
        await db.query("select set_config('role', 'postgres', true)");
        await db.query('update timing.crossings set bib = $2 where id = $1', [ID, '312']);

        // The phone retries with what it recorded at the time.
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        const retry = await db.query<{ answer: Envelope }>(
          'select timing.record_crossing($1, $2, $3, $4) as answer',
          [ID, SLUG, '311', '2026-11-01T11:30:00Z'],
        );
        expect(retry.rows[0]?.answer).toMatchObject({ ok: true });

        await db.query("select set_config('role', 'postgres', true)");
        const { rows } = await db.query<{ bib: string }>(
          'select bib from timing.crossings where id = $1',
          [ID],
        );
        // The correction survives. This is the assertion.
        expect(rows[0]?.bib).toBe('312');
      } finally {
        await db.query('rollback');
      }
    });
  });

  describe('what lands, and what the trigger makes of it', () => {
    it('attributes the crossing to the caller and keeps the phone clock', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        await db.query('select timing.record_crossing($1, $2, $3, $4)', [
          '33333333-3333-4333-8333-333333333331',
          SLUG,
          '311',
          '2026-11-01T11:33:20Z',
        ]);

        await db.query("select set_config('role', 'postgres', true)");
        const { rows } = await db.query<{
          marshal_id: string;
          team_id: string | null;
          captured_at: Date;
        }>(
          'select marshal_id, team_id, captured_at from timing.crossings where id = $1',
          ['33333333-3333-4333-8333-333333333331'],
        );

        // `marshal_id` is `auth.uid()` and never a parameter — a client that could name the
        // marshal could attribute somebody else's work.
        expect(rows[0]?.marshal_id).toBe(MARSHAL);
        // The trigger resolved the bib to the team.
        expect(rows[0]?.team_id).toBe(TEAM_ID);
        // Nothing server-side replaced the time the phone recorded.
        expect(rows[0]?.captured_at.toISOString()).toBe('2026-11-01T11:33:20.000Z');
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * **An anomaly flags and never blocks.** A marshal at a finish line cannot stop to argue
     * with a validator, so a bib matching nothing is stored with `team_id` null and no error.
     */
    it('stores an unknown bib rather than refusing it', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        const wrote = await db.query<{ answer: Envelope }>(
          'select timing.record_crossing($1, $2, $3, $4) as answer',
          ['33333333-3333-4333-8333-333333333332', SLUG, '999', '2026-11-01T11:35:00Z'],
        );
        expect(wrote.rows[0]?.answer).toMatchObject({ ok: true });

        await db.query("select set_config('role', 'postgres', true)");
        const { rows } = await db.query<{ team_id: string | null; bib: string }>(
          'select team_id, bib from timing.crossings where id = $1',
          ['33333333-3333-4333-8333-333333333332'],
        );
        expect(rows[0]?.bib).toBe('999');
        expect(rows[0]?.team_id).toBeNull();
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * A bib is an opaque string, exact equality only — ADR-034's second unimprovable thing.
     * `"0311"` is not `"311"`, so it resolves to no team rather than to this one.
     */
    it('does not treat a leading zero as the same bib', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        await db.query('select timing.record_crossing($1, $2, $3, $4)', [
          '33333333-3333-4333-8333-333333333333',
          SLUG,
          '0311',
          '2026-11-01T11:36:00Z',
        ]);

        await db.query("select set_config('role', 'postgres', true)");
        const { rows } = await db.query<{ team_id: string | null }>(
          'select team_id from timing.crossings where id = $1',
          ['33333333-3333-4333-8333-333333333333'],
        );
        expect(rows[0]?.team_id).toBeNull();
      } finally {
        await db.query('rollback');
      }
    });

    it('refuses a source that is not a tap or a manual entry', async () => {
      expect(
        await recordAs(
          MARSHAL,
          '33333333-3333-4333-8333-333333333334',
          '311',
          '2026-11-01T11:37:00Z',
          SLUG,
          'guesswork',
        ),
      ).toEqual({ ok: false, reason: 'invalid_source' });
    });

    it('refuses a call with no id and no time', async () => {
      expect(await recordAs(MARSHAL, null as unknown as string, '311')).toMatchObject({
        ok: false,
        reason: 'incomplete',
      });
    });
  });

  describe('what the screen reads back', () => {
    it('gives a rostered marshal the bibs and times, and no marshal identity', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [MARSHAL],
        );
        await db.query('select timing.record_crossing($1, $2, $3, $4)', [
          '44444444-4444-4444-8444-444444444441',
          SLUG,
          '311',
          '2026-11-01T11:38:00Z',
        ]);

        const { rows } = await db.query<{ answer: Record<string, unknown>[] }>(
          'select timing.known_crossings($1) as answer',
          [SLUG],
        );

        expect(rows[0]?.answer).toEqual([
          expect.objectContaining({ bib: '311', anomaly_flag: false }),
        ]);

        // Who recorded it is on the table for an admin resolving an anomaly. It is not a
        // fact a marshal screen needs in order to de-duplicate.
        expect(JSON.stringify(rows[0]?.answer)).not.toContain('marshal');
      } finally {
        await db.query('rollback');
      }
    });

    it('is an empty array on a race with nothing recorded, not null', async () => {
      // Null means "you may not" here. A race that has had no taps yet is a different and
      // perfectly ordinary answer, and the screen must not read one as the other.
      expect(await knownAs(MARSHAL)).toEqual([]);
    });
  });
});
