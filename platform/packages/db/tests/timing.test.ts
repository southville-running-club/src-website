import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
   *     row, the write path #203 syncs against and the read it de-duplicates from;
   *   * `open_anomalies`, `crossing_log`, `resolve_crossing`, `restore_crossing` and
   *     `edit_crossing` — `timing.crossing.resolve`, #252, which had existed since
   *     `20260911100000` and gated nothing until now. ⚠️ **`resolve_crossing` and
   *     `edit_crossing` are two functions rather than one because they take different
   *     latches**: the triage list swaps on `resolved_at is null` and the log cannot, since a
   *     row that was never flagged carries that null for ever. The concurrency block at the
   *     foot of this file is what actually holds that;
   *   * `marshal_event` — the same two checks, #203. ⚠️ **It exists because none of the four
   *     roster functions above answers *"am I on this roster"* to the marshal asking** — every
   *     one of them is behind `timing.marshal.assign`, which is an admin's permission. It is
   *     what `middleware.ts` calls to stop refusing `/timing/marshal/<slug>/` outright, and it
   *     carries the race's `format` because bibs parse differently on a relay and a solo;
   *   * `assign_bibs`, `set_bib_override` and `add_walk_in` — `timing.registration.import`,
   *     #249. ⚠️ **`effective_bib` is deliberately not among them**: it is the shared
   *     definition the collision guard and the parity test use, reachable from the definer
   *     functions and from nothing else, exactly as `resolve_crossing_team_id` is;
   *   * `import_from_entries` — `timing.registration.import`, ADR-039's roster crossing from
   *     `entries`. ⚠️ **This is the one that reads another application's schema**, so the
   *     permission check is the only thing between that grant and every entrant the club
   *     holds — which is why the bypass block below posts every `entrants` column at it;
   *   * `start_event` and `clear_start` — `timing.event.manage`, #250. ⚠️ **`start_event` is
   *     the one grant on this list that decides a number every result in the race is derived
   *     from**, and it is idempotent by its own `where` clause rather than by anything a
   *     caller does, which is what the concurrency block at the foot of this file asserts.
   *
   * ⚠️ **`anon` holds none of them, and the bib trigger function is on nobody's list.** The
   * trigger is reachable from its trigger and nothing else; a grant on it would be a function
   * anybody could call to probe how bibs resolve. Both migrations revoke it defensively, and
   * this is what says that held.
   */
  it('grants exactly these twenty-five functions, and only to authenticated', async () => {
    const { rows } = await db.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
         from information_schema.role_routine_grants
        where routine_schema = 'timing' and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by routine_name, grantee`,
    );

    expect(rows).toEqual([
      { routine_name: 'add_walk_in', grantee: 'authenticated' },
      { routine_name: 'assign_bibs', grantee: 'authenticated' },
      { routine_name: 'assign_marshal', grantee: 'authenticated' },
      { routine_name: 'assignable_marshals', grantee: 'authenticated' },
      { routine_name: 'clear_start', grantee: 'authenticated' },
      { routine_name: 'create_event', grantee: 'authenticated' },
      { routine_name: 'crossing_log', grantee: 'authenticated' },
      { routine_name: 'edit_crossing', grantee: 'authenticated' },
      { routine_name: 'event_detail', grantee: 'authenticated' },
      { routine_name: 'event_roster', grantee: 'authenticated' },
      { routine_name: 'import_from_entries', grantee: 'authenticated' },
      { routine_name: 'import_registration', grantee: 'authenticated' },
      { routine_name: 'known_crossings', grantee: 'authenticated' },
      { routine_name: 'list_events', grantee: 'authenticated' },
      { routine_name: 'marshal_event', grantee: 'authenticated' },
      { routine_name: 'open_anomalies', grantee: 'authenticated' },
      { routine_name: 'record_crossing', grantee: 'authenticated' },
      { routine_name: 'resolve_crossing', grantee: 'authenticated' },
      { routine_name: 'restore_crossing', grantee: 'authenticated' },
      { routine_name: 'results_for_event', grantee: 'authenticated' },
      { routine_name: 'roster_for_event', grantee: 'authenticated' },
      { routine_name: 'set_bib_override', grantee: 'authenticated' },
      { routine_name: 'start_event', grantee: 'authenticated' },
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
    //
    // ⚠️ **The third row carries a `resolved_action` since #252, and it had to.** It used to set
    // `resolved_at` alone, which says a capture was resolved without saying how — a row that
    // `crossings_resolution_coherent` now refuses outright. The constraint found this fixture on
    // its first run, which is the whole argument for adding it.
    await db.query(
      `insert into timing.crossings
         (event_id, bib, captured_at, anomaly_flag, resolved_at, resolved_action)
       values ($1, '7', '2026-11-01T11:40:00Z', false, null, null),
              ($1, '7', '2026-11-01T11:41:00Z', true, null, null),
              ($1, '7', '2026-11-01T11:42:00Z', true, '2026-11-01T12:00:00Z', 'marked_valid')`,
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

  /**
   * `marshal_event()` — #203, the read that lets `middleware.ts` stop refusing
   * `/timing/marshal/<slug>/` outright.
   *
   * ⚠️ **It is asserted beside `record_crossing()` on purpose, against the same three
   * people.** The door and the write have to agree about who is on this roster: a door that
   * admitted somebody the write then refuses is a marshal tapping a button all morning into a
   * queue that can never drain. Sharing the fixtures is what makes a divergence show up as a
   * failure here rather than on a start line.
   */
  describe('the race a marshal is allowed to see', () => {
    const eventAs = (person: string, slug = SLUG) =>
      asPerson<Record<string, unknown> | null>(
        person,
        'select timing.marshal_event($1) as answer',
        [slug],
      );

    it('gives a rostered marshal the facts the capture screen reasons from', async () => {
      // ⚠️ **`format` is derived from the fixture rather than written down as a literal.** It
      // is the load-bearing field — `parseBib()` reads a relay bib leg-first and a solo bib
      // whole — so a literal that happened to match would go on passing after somebody changed
      // the fixture, which is the way this assertion would most plausibly stop testing.
      const { rows } = await db.query<{ format: string; name: string }>(
        'select format, name from timing.events where slug = $1',
        [SLUG],
      );

      expect(await eventAs(MARSHAL)).toMatchObject({
        slug: SLUG,
        format: rows[0]?.format,
        name: rows[0]?.name,
      });
    });

    it('carries no counts, no course notes and no distance', async () => {
      // The negative half, and the one that goes stale silently: this is the weakest timing
      // permission there is, so a column added to `event_detail()` must not arrive here by
      // somebody copying a `select *`.
      const answer = await eventAs(MARSHAL);

      expect(Object.keys(answer ?? {}).sort()).toEqual([
        'actually_started_at',
        'finished_at',
        'format',
        'name',
        'slug',
        'start_at',
      ]);
    });

    it('answers null to somebody holding the permission but not on this roster', async () => {
      // ADR-036: the roster is a scope checked after the permission, for everybody. The admin
      // here holds `timing.crossing.record` through `timing-admin` and is still refused.
      expect(await eventAs(OFF_ROSTER)).toBeNull();
      expect(await eventAs(ADMIN)).toBeNull();
    });

    it('answers the same null for a race that does not exist', async () => {
      // Indistinguishable from the refusal above, deliberately: otherwise the door is an
      // oracle for which slugs name a race.
      expect(await eventAs(MARSHAL, 'zz-no-such-race')).toBeNull();
    });
  });
});

/**
 * The Nightingale roster crossing from `entries` — #248, under
 * [ADR-039](../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md).
 *
 * ⚠️ **This is the first function on this platform to read across two application schemas**,
 * and it is `security definer`, so it sees rows its caller cannot. The permission check is the
 * only thing standing between `timing.registration.import` and every entrant the club holds.
 * That is why the block below is weighted the way it is: the refusals and the carry list come
 * first, and the happy path — which is the easy part — comes after.
 */
describe('the roster, from the schema that already holds it', () => {
  const IMPORTER = '66666666-6666-4666-8666-666666666661';
  const NOBODY = '66666666-6666-4666-8666-666666666662';
  const TIMING_EVENT = '00000000-0000-4000-8000-0000000000e1';
  const ENTRIES_EVENT = '00000000-0000-4000-8000-0000000000e2';
  const SLUG = 'zz-import-2026';
  /** The civil race date the ages below are computed against. */
  const RACE_DATE = '2026-11-01';

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
      // ⚠️ **Rolled back, so the impersonation does not leak — and so nothing this function
      // wrote survives either.** Every test that needs to *read back* what the import did runs
      // it through `importAndKeep` below instead.
      await db.query('rollback');
    }
  }

  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

  const importAs = (person: string, slug = SLUG) =>
    asPerson<Envelope>(person, 'select timing.import_from_entries($1) as answer', [slug]);

  /**
   * The import, committed, so the rows it wrote can be read back.
   *
   * `set_config(..., true)` is transaction-local and `asPerson` rolls back, which is right for
   * asserting an *answer* and useless for asserting an *effect*. Here the role is set and reset
   * around a committed call instead.
   */
  async function importAndKeep(person: string, slug = SLUG): Promise<Envelope> {
    await db.query("select set_config('role', 'authenticated', false)");
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
      [person],
    );
    try {
      const { rows } = await db.query<{ answer: Envelope }>(
        'select timing.import_from_entries($1) as answer',
        [slug],
      );
      return rows[0]!.answer;
    } finally {
      // Back to `postgres` before anything reads a `timing` table directly: `authenticated`
      // holds no grant on any of them, so a verification read left under the impersonated role
      // fails with `permission denied for table runners`, which reads as a broken function and
      // is not one. #265 paid for this once already.
      await db.query("select set_config('role', 'postgres', false)");
      await db.query("select set_config('request.jwt.claims', null, false)");
    }
  }

  /**
   * `consents` carries the medical consent as well as the entry terms, because one test stores
   * a medical note — `assert_medical_consent()` refuses one whose purchase did not record it,
   * which is the rule that makes the note and its lawful basis inseparable. Every other test
   * here is unaffected by the extra key.
   */
  async function newPurchase(email: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, paid_at
       )
       select $1, 'paid', 1800, f.id, $2, 'Fixture Buyer', '{"entryTerms":true,"medical":true}'::jsonb,
              'fixture-v1', now()
         from entries.fees f
        where f.event_id = $1
        limit 1
       returning id`,
      [ENTRIES_EVENT, email],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [IMPORTER, 'timing-import-importer@example.com'],
      [NOBODY, 'timing-import-nobody@example.com'],
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
       values ($1, 'timing-admin', $1), ($2, 'registered', $2)
       on conflict do nothing`,
      [IMPORTER, NOBODY],
    );

    await db.query('delete from timing.events where id = $1', [TIMING_EVENT]);
    await db.query('delete from entries.events where id = $1', [ENTRIES_EVENT]);

    // **The two schemas are joined on the slug**, so both fixtures carry the same one.
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at)
       values ($1, $2, 'Import Fixture', 'solo', $3::timestamptz)`,
      [TIMING_EVENT, SLUG, `${RACE_DATE}T11:00:00Z`],
    );
    await db.query(
      `insert into entries.events (
         id, slug, display_name, event_date, start_time, capacity,
         from_address, consent_version, race_slug, minimum_age
       ) values ($1, $2, 'Import Fixture', $3::date, '11:00', 250,
                 'fixture@example.com', 'fixture-v1', 'zz-import', 18)`,
      [ENTRIES_EVENT, SLUG, RACE_DATE],
    );
    await db.query(
      `insert into entries.fees (event_id, code, label, price_pence)
       values ($1, 'unaffiliated', 'Unaffiliated', 1800)`,
      [ENTRIES_EVENT],
    );
  });

  afterEach(async () => {
    // Each test owns the whole field. Deleting the purchases cascades to the entrants, and
    // deleting the teams cascades to the runners.
    await db.query('delete from timing.teams where event_id = $1', [TIMING_EVENT]);
    await db.query('delete from entries.entry_purchases where event_id = $1', [
      ENTRIES_EVENT,
    ]);
  });

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [TIMING_EVENT]);
    await db.query('delete from entries.events where id = $1', [ENTRIES_EVENT]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [IMPORTER, NOBODY],
    ]);
  });

  describe('who may run it', () => {
    it('refuses a signed-in person who holds nothing, and reads nothing first', async () => {
      await newPurchase('refused@example.com');

      const answer = await importAs(NOBODY);

      expect(answer).toEqual({ ok: false, reason: 'refused' });
    });

    it('refuses an anonymous caller the same way', async () => {
      const { rows } = await db.query<{ answer: Envelope }>(
        'select timing.import_from_entries($1) as answer',
        [SLUG],
      );

      expect(rows[0]?.answer).toEqual({ ok: false, reason: 'refused' });
    });

    it('names a missing timing event rather than raising', async () => {
      expect(await importAs(IMPORTER, 'zz-no-such-race')).toEqual({
        ok: false,
        reason: 'no_such_event',
      });
    });

    /**
     * A `timing` event with no `entries` event of the same slug is Pass the Buck's shape — a
     * race timed here that was never entered here. It is not an error a caller can retry, so
     * it is named rather than raised.
     */
    it('names a timing race that entries has never heard of', async () => {
      await db.query(
        `insert into timing.events (slug, name, format, start_at)
         values ('zz-timing-only', 'Timing Only', 'solo', now())
         on conflict (slug) do nothing`,
      );

      expect(await importAs(IMPORTER, 'zz-timing-only')).toEqual({
        ok: false,
        reason: 'no_such_entries_event',
      });

      await db.query(`delete from timing.events where slug = 'zz-timing-only'`);
    });
  });

  /**
   * ⚠️ **The block that matters most.** ADR-039 writes down what may cross and what may not,
   * and this is the assertion that the SQL agrees with the record. It posts a *complete*
   * entrant — every column the club holds, all populated — and then asserts each forbidden one
   * arrived nowhere. `entries-rules.test.ts`'s shape: attempt the bypass, assert the specific
   * outcome, never assert the text of a rule.
   */
  describe('what it carries, and what it must never', () => {
    async function importOneFullEntrant(): Promise<Record<string, unknown>> {
      const purchaseId = await newPurchase('carries@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender, club,
           emergency_contact_name, emergency_contact_phone,
           gender_identity, phone, role, result_placement
         ) values (
           $1, 'Wilhelmina', 'O''Rourke', date '1986-12-09', 'female', 'Southville RC',
           'Kinsi Next-Of-Kin', '0117 496 0001',
           'zz-gender-identity-must-not-travel', '07700900123', 'runner', null
         )`,
        [purchaseId],
      );
      await db.query(
        `insert into entries.entrant_medical (entrant_id, notes)
         select id, 'zz-medical-note-must-not-travel' from entries.entrants
          where purchase_id = $1`,
        [purchaseId],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<Record<string, unknown>>(
        `select r.* from timing.runners r
           join timing.teams t on t.id = r.team_id
          where t.event_id = $1`,
        [TIMING_EVENT],
      );
      return rows[0]!;
    }

    it('carries the name, the club and the category', async () => {
      const runner = await importOneFullEntrant();

      expect(runner.firstname).toBe('Wilhelmina');
      expect(runner.lastname).toBe("O'Rourke");
      expect(runner.club_name).toBe('Southville RC');
      expect(runner.gender).toBe('female');
      expect(runner.role).toBe('runner');
    });

    /**
     * The date of birth is read to compute this and discarded in the same expression. 1986-12-09
     * against a 2026-11-01 race day is 39 — the birthday has not happened yet that year, which
     * is the case a naive year subtraction gets wrong.
     */
    it('carries an age computed on the race date, and no date of birth', async () => {
      const runner = await importOneFullEntrant();

      expect(runner.age_on_day).toBe(39);
      expect(Object.keys(runner)).not.toContain('date_of_birth');
    });

    /**
     * ⚠️ **The whole point of ADR-039's carry list.** Every one of these is somebody's
     * decision — three of them are ADRs — and a roster row is none of the places they belong.
     * Asserted against the rendered row rather than against the function's text, so widening
     * the `select` inside it would fail here.
     */
    it('carries no forbidden column anywhere on the row', async () => {
      const runner = await importOneFullEntrant();
      const serialised = JSON.stringify(runner);

      expect(serialised).not.toContain('zz-gender-identity-must-not-travel');
      expect(serialised).not.toContain('zz-medical-note-must-not-travel');
      expect(serialised).not.toContain('07700900123');
      expect(serialised).not.toContain('Kinsi Next-Of-Kin');
      expect(serialised).not.toContain('0117 496 0001');
      expect(serialised).not.toContain('1986-12-09');
      expect(serialised).not.toContain('1986');
    });

    /**
     * A runner is reachable through `purchaser_email`, which is a **purchase** fact.
     * `entrants.email` is a guide's own address and null for a runner, so a roster row for a
     * runner carries no address at all.
     */
    it('carries no address for a runner', async () => {
      const runner = await importOneFullEntrant();

      expect(runner.email).toBeNull();
      expect(JSON.stringify(runner)).not.toContain('carries@example.com');
    });
  });

  describe('a non-binary entrant, and a guide', () => {
    /**
     * ADR-031's answer has to arrive, or every non-binary entrant falls to "not placed" on the
     * timing side — the exact gap ADR-031 closed in `entries`, re-opened one schema along.
     */
    it('carries where a non-binary entrant asked to be placed', async () => {
      const purchaseId = await newPurchase('placed@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone, result_placement
         ) values ($1, 'Alex', 'Placement', date '1990-01-01', 'non_binary',
                   'Kin', '0117 496 0002', 'female')`,
        [purchaseId],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<{ gender: string; result_placement: string }>(
        `select r.gender, r.result_placement from timing.runners r
           join timing.teams t on t.id = r.team_id where t.event_id = $1`,
        [TIMING_EVENT],
      );

      expect(rows[0]).toEqual({ gender: 'non_binary', result_placement: 'female' });
    });

    /**
     * ADR-022: a guide rides on the runner's entry, takes one of the 250 and runs the course.
     * They are leg 2 so they get a bib of their own, and they carry **their own** address,
     * because a guide has no purchase to be reached through.
     */
    it('puts a guide on the same entry as leg two, with their own address', async () => {
      const purchaseId = await newPurchase('vi-runner@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone, role, email
         ) values
           ($1, 'Vi', 'Runner', date '1990-01-01', 'female', 'Kin', '0117 496 0003',
            'runner', null),
           ($1, 'Gwen', 'Guide', date '1992-02-02', null, 'Kin', '0117 496 0004',
            'guide', 'gwen-guide@example.com')`,
        [purchaseId],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<{
        leg: number;
        firstname: string;
        role: string;
        email: string | null;
      }>(
        `select r.leg, r.firstname, r.role, r.email from timing.runners r
           join timing.teams t on t.id = r.team_id
          where t.event_id = $1 order by r.leg`,
        [TIMING_EVENT],
      );

      expect(rows).toEqual([
        { leg: 1, firstname: 'Vi', role: 'runner', email: null },
        { leg: 2, firstname: 'Gwen', role: 'guide', email: 'gwen-guide@example.com' },
      ]);
    });
  });

  describe('running it again', () => {
    it('is a no-op on an unchanged field, and creates nothing twice', async () => {
      const purchaseId = await newPurchase('again@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, 'Same', 'Runner', date '1990-01-01', 'male', 'Kin', '0117 496 0005')`,
        [purchaseId],
      );

      const first = await importAndKeep(IMPORTER);
      const second = await importAndKeep(IMPORTER);

      expect(first.teams_created).toBe(1);
      expect(second.teams_created).toBe(0);
      expect(second.teams_updated).toBe(1);

      const { rows } = await db.query<{ count: string }>(
        `select count(*)::text as count from timing.runners r
           join timing.teams t on t.id = r.team_id where t.event_id = $1`,
        [TIMING_EVENT],
      );
      expect(rows[0]?.count).toBe('1');
    });

    /**
     * ⚠️ **The assertion the whole re-run design exists for.** Re-importing after bibs are
     * assigned must never renumber a field against numbers already printed and pinned on.
     */
    it('never touches team_number or either bib override', async () => {
      const purchaseId = await newPurchase('bibbed@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, 'Bib', 'Holder', date '1990-01-01', 'male', 'Kin', '0117 496 0006')`,
        [purchaseId],
      );
      await importAndKeep(IMPORTER);
      await db.query(
        `update timing.teams set team_number = '42', bib_leg1 = '0311', race_status = 'dns'
          where event_id = $1`,
        [TIMING_EVENT],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<{
        team_number: string;
        bib_leg1: string;
        race_status: string;
      }>(
        `select team_number, bib_leg1, race_status from timing.teams where event_id = $1`,
        [TIMING_EVENT],
      );

      expect(rows[0]).toEqual({
        team_number: '42',
        bib_leg1: '0311',
        race_status: 'dns',
      });
    });

    /**
     * A transfer replaces the runner on that entry and leaves the entry — and its bib — alone.
     * Simulated at the table rather than through `transfer_entry()`, which re-checks a dozen
     * rules that are not what this test is about.
     */
    it('replaces the runner after a transfer and leaves the bib alone', async () => {
      const purchaseId = await newPurchase('transferred@example.com');
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, 'First', 'Runner', date '1990-01-01', 'male', 'Kin', '0117 496 0007')`,
        [purchaseId],
      );
      await importAndKeep(IMPORTER);
      await db.query(`update timing.teams set team_number = '7' where event_id = $1`, [
        TIMING_EVENT,
      ]);

      await db.query('delete from entries.entrants where purchase_id = $1', [purchaseId]);
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, 'Second', 'Runner', date '1991-01-01', 'female', 'Kin', '0117 496 0008')`,
        [purchaseId],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<{ firstname: string; team_number: string }>(
        `select r.firstname, t.team_number from timing.runners r
           join timing.teams t on t.id = r.team_id where t.event_id = $1`,
        [TIMING_EVENT],
      );

      expect(rows).toEqual([{ firstname: 'Second', team_number: '7' }]);
    });

    /**
     * ⚠️ **A refunded entry's team goes, and it has to.** `cancel_entry()` deletes the entrants
     * and sets the purchase to `refunded`, so the import simply does not reach it — but a team
     * written on a previous run would linger, holding a place on the start list for somebody
     * who is not running.
     */
    it('removes the team of an entry that was refunded', async () => {
      const staying = await newPurchase('staying@example.com');
      const leaving = await newPurchase('leaving@example.com');
      for (const [id, name] of [
        [staying, 'Staying'],
        [leaving, 'Leaving'],
      ]) {
        await db.query(
          `insert into entries.entrants (
             purchase_id, first_name, last_name, date_of_birth, gender,
             emergency_contact_name, emergency_contact_phone
           ) values ($1, $2, 'Runner', date '1990-01-01', 'male', 'Kin', '0117 496 0009')`,
          [id, name],
        );
      }
      await importAndKeep(IMPORTER);

      await db.query('delete from entries.entrants where purchase_id = $1', [leaving]);
      await db.query(
        `update entries.entry_purchases set status = 'refunded', paid_at = null where id = $1`,
        [leaving],
      );

      const answer = await importAndKeep(IMPORTER);

      expect(answer.teams_removed).toBe(1);
      const { rows } = await db.query<{ firstname: string }>(
        `select r.firstname from timing.runners r
           join timing.teams t on t.id = r.team_id where t.event_id = $1`,
        [TIMING_EVENT],
      );
      expect(rows).toEqual([{ firstname: 'Staying' }]);
    });

    /**
     * ⚠️ **A roster that arrived by CSV must survive this.** The removal above is scoped to
     * teams whose anchor is a purchase of *this* `entries` event; a blanket "delete what I did
     * not just write" would empty Pass the Buck's field the first time somebody ran the import
     * on the wrong slug. This is that guard, asserted rather than trusted.
     */
    it('leaves a team that did not come from entries alone', async () => {
      await db.query(
        `insert into timing.teams (event_id, purchase_order_id, name)
         values ($1, 'FOS-CSV-0001', 'From a CSV')`,
        [TIMING_EVENT],
      );

      await importAndKeep(IMPORTER);

      const { rows } = await db.query<{ purchase_order_id: string }>(
        `select purchase_order_id from timing.teams where event_id = $1`,
        [TIMING_EVENT],
      );

      expect(rows).toEqual([{ purchase_order_id: 'FOS-CSV-0001' }]);
    });
  });

  /**
   * Only a `paid` entry is on a start line. A held place that was never paid for, and one whose
   * hold lapsed, are both people who are not running.
   */
  it('imports only the entries somebody actually paid for', async () => {
    const paid = await newPurchase('paid@example.com');
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, hold_expires_at
       )
       select $1, 'pending', 1800, f.id, 'pending@example.com', 'Held', '{"entryTerms":true}'::jsonb,
              'fixture-v1', now() + interval '31 minutes'
         from entries.fees f where f.event_id = $1 limit 1
       returning id`,
      [ENTRIES_EVENT],
    );

    for (const [id, name] of [
      [paid, 'Paid'],
      [pendingRows[0]!.id, 'Pending'],
    ]) {
      await db.query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, $2, 'Runner', date '1990-01-01', 'male', 'Kin', '0117 496 0010')`,
        [id, name],
      );
    }

    await importAndKeep(IMPORTER);

    const { rows } = await db.query<{ firstname: string }>(
      `select r.firstname from timing.runners r
         join timing.teams t on t.id = r.team_id where t.event_id = $1`,
      [TIMING_EVENT],
    );

    expect(rows).toEqual([{ firstname: 'Paid' }]);
  });
});

/**
 * Starting a race, and clearing a false start — #250, against
 * `20260913170000_timing_start_race.sql`.
 *
 * ⚠️ **The property worth more than the rest: the gun goes once.** `actually_started_at` is
 * what every split, every finish time and every result in the race is measured against, so a
 * second press must not move it — and the guard has to hold when the second press is a *second
 * device*, not a second statement. That is why the block at the foot of this describe opens two
 * Postgres connections and commits, rather than using the roll-back helper everything else here
 * uses: a race between two transactions cannot be reproduced inside one.
 *
 * Negative cases first, in this file's usual order: refused without the permission, refused
 * anonymously, and `no_such_event` for a slug that names nothing.
 */
describe('starting a race', () => {
  const STARTER = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const SECOND_STARTER = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
  const MARSHAL = 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3';

  /** Not started. Every roll-back test reads and writes this one. */
  const PENDING_ID = '00000000-0000-4000-8000-0000000000d1';
  const PENDING_SLUG = 'zz-timing-start-pending';

  /** Not started, and the only event the concurrency block touches — it *commits*. */
  const RACE_ID = '00000000-0000-4000-8000-0000000000d2';
  const RACE_SLUG = 'zz-timing-start-race';

  /** Already started, nobody timed yet: the false start that can still be cleared. */
  const CLEARABLE_ID = '00000000-0000-4000-8000-0000000000d3';
  const CLEARABLE_SLUG = 'zz-timing-start-clearable';

  /** Already started, with one crossing against it: the clear that must be refused. */
  const CROSSED_ID = '00000000-0000-4000-8000-0000000000d4';
  const CROSSED_SLUG = 'zz-timing-start-crossed';
  const CROSSED_TEAM = '00000000-0000-4000-8000-0000000000d5';

  const ALL_EVENTS = [PENDING_ID, RACE_ID, CLEARABLE_ID, CROSSED_ID];
  const STARTED_AT = '2026-11-01T11:02:00Z';

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

  /** What both writers answer. `actually_started_at` is on the winner and on the loser. */
  interface Answer {
    ok: boolean;
    reason?: string;
    slug?: string;
    actually_started_at?: string | null;
  }

  /** Sets the role and the claims PostgREST would set, on whichever connection is passed. */
  async function actAs(client: Client, personId: string): Promise<void> {
    await client.query("select set_config('role', 'authenticated', true)");
    await client.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [personId],
    );
  }

  /**
   * ⚠️ **Call this before reading a `timing` table back, and the suite fails loudly if you
   * forget.** `authenticated` holds **no grant on any table** in `timing` — the property the
   * grant block a long way above asserts — so a verification read left under the impersonated
   * role answers `permission denied for table events`, which reads as a broken function and is
   * not one. #265 paid for this once; these three tests paid for it again.
   *
   * The role is set transaction-locally by `actAs`, so this only has to undo it for reads that
   * happen inside the same transaction as the call being verified.
   */
  async function stopActing(client: Client): Promise<void> {
    await client.query("select set_config('role', 'postgres', true)");
    await client.query("select set_config('request.jwt.claims', null, true)");
  }

  const startAs = (person: string, slug: string) =>
    asPerson<Answer>(person, 'select timing.start_event($1) as answer', [slug]);

  const clearAs = (person: string, slug: string) =>
    asPerson<Answer>(person, 'select timing.clear_start($1) as answer', [slug]);

  beforeAll(async () => {
    for (const [id, email] of [
      [STARTER, 'timing-start-one@example.com'],
      [SECOND_STARTER, 'timing-start-two@example.com'],
      [MARSHAL, 'timing-start-marshal@example.com'],
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
       values ($1, 'timing-admin', $1), ($2, 'timing-admin', $2),
              ($3, 'timing-marshal', $3)
       on conflict do nothing`,
      [STARTER, SECOND_STARTER, MARSHAL],
    );

    await db.query('delete from timing.events where id = any($1::uuid[])', [ALL_EVENTS]);

    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, 'Start Fixture',   'solo', '2026-11-01T11:00:00Z', null),
              ($3, $4, 'Race Fixture',    'solo', '2026-11-01T11:00:00Z', null),
              ($5, $6, 'False Start',     'solo', '2026-11-01T11:00:00Z', $9::timestamptz),
              ($7, $8, 'Already Running', 'solo', '2026-11-01T11:00:00Z', $9::timestamptz)`,
      [
        PENDING_ID,
        PENDING_SLUG,
        RACE_ID,
        RACE_SLUG,
        CLEARABLE_ID,
        CLEARABLE_SLUG,
        CROSSED_ID,
        CROSSED_SLUG,
        STARTED_AT,
      ],
    );

    // One crossing, against the one event whose start may no longer be cleared. Its split is
    // measured from `actually_started_at`, which is the whole reason for the refusal.
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '11')`,
      [CROSSED_TEAM, CROSSED_ID],
    );
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '11', '2026-11-01T11:40:00Z')`,
      [CROSSED_ID],
    );
  });

  afterAll(async () => {
    await db.query('delete from timing.events where id = any($1::uuid[])', [ALL_EVENTS]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [STARTER, SECOND_STARTER, MARSHAL],
    ]);
  });

  describe('who is refused', () => {
    it('refuses a marshal, who is timing staff and still may not start a race', async () => {
      expect(await startAs(MARSHAL, PENDING_SLUG)).toEqual({
        ok: false,
        reason: 'refused',
      });
      expect(await clearAs(MARSHAL, CLEARABLE_SLUG)).toEqual({
        ok: false,
        reason: 'refused',
      });
    });

    it('leaves the race unstarted when the start was refused', async () => {
      await startAs(MARSHAL, PENDING_SLUG);

      // Read back outside the refused call, so a refusal that silently wrote cannot hide.
      const { rows } = await db.query<{ started: string | null }>(
        'select actually_started_at as started from timing.events where id = $1',
        [PENDING_ID],
      );
      expect(rows[0]?.started).toBeNull();
    });

    /**
     * A connection with no token has no `auth.uid()`, so `identity.has_permission()` is false.
     * Asserted as the **specific** refusal rather than as "something went wrong": a broken
     * function refuses everything, which reads as every rule holding at once.
     */
    it('refuses an anonymous caller outright, rather than raising', async () => {
      const { rows } = await db.query<{ start: Answer; clear: Answer }>(
        `select timing.start_event($1) as start, timing.clear_start($2) as clear`,
        [PENDING_SLUG, CLEARABLE_SLUG],
      );

      expect(rows[0]?.start).toEqual({ ok: false, reason: 'refused' });
      expect(rows[0]?.clear).toEqual({ ok: false, reason: 'refused' });
    });

    it('says so plainly when the slug names nothing', async () => {
      expect(await startAs(STARTER, 'zz-no-such-event-at-all')).toEqual({
        ok: false,
        reason: 'no_such_event',
      });
      expect(await clearAs(STARTER, 'zz-no-such-event-at-all')).toEqual({
        ok: false,
        reason: 'no_such_event',
      });
    });
  });

  describe('the gun', () => {
    it('records the moment it was pressed, and not the scheduled start', async () => {
      await db.query('begin');
      try {
        await actAs(db, STARTER);

        const { rows: wrote } = await db.query<{ answer: Answer }>(
          'select timing.start_event($1) as answer',
          [PENDING_SLUG],
        );

        expect(wrote[0]?.answer.ok).toBe(true);
        expect(wrote[0]?.answer.slug).toBe(PENDING_SLUG);

        /*
         * ⚠️ **`now()`, not `start_at`.** The fixture is scheduled for 11:00 on 1 November
         * 2026 and this suite is run on whatever today is, so a function that had stored the
         * scheduled time would be a long way out — which is the assertion, rather than the
         * tolerance.
         */
        await stopActing(db);
        const { rows } = await db.query<{ gap: string; scheduled: string }>(
          `select extract(epoch from (now() - actually_started_at))::text as gap,
                  extract(epoch from (actually_started_at - start_at))::text as scheduled
             from timing.events where id = $1`,
          [PENDING_ID],
        );

        expect(Math.abs(Number(rows[0]?.gap))).toBeLessThan(60);
        expect(Number(rows[0]?.scheduled)).not.toBe(0);
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * ⚠️ **The two issues meet here.** #247's `update_event` refuses the *whole* update once a
     * race has started, because moving `start_at` after the gun rewrites every derived time.
     * Asserted in one transaction so the two functions are seen against the same row.
     */
    it('makes the race uneditable, which is what #247 refuses on', async () => {
      await db.query('begin');
      try {
        await actAs(db, STARTER);

        const { rows: before } = await db.query<{ answer: Record<string, unknown> }>(
          'select timing.event_detail($1) as answer',
          [PENDING_SLUG],
        );
        expect(before[0]?.answer['editable']).toBe(true);

        await db.query('select timing.start_event($1)', [PENDING_SLUG]);

        const { rows: after } = await db.query<{ answer: Record<string, unknown> }>(
          'select timing.event_detail($1) as answer',
          [PENDING_SLUG],
        );
        expect(after[0]?.answer['editable']).toBe(false);

        const { rows: edit } = await db.query<{ answer: Answer }>(
          'select timing.update_event($1, $2, $3) as answer',
          [PENDING_SLUG, 'Too late', '2026-11-01T09:00:00Z'],
        );
        expect(edit[0]?.answer).toEqual({ ok: false, reason: 'already_started' });
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * ⚠️ **The second press, in one transaction.** The concurrency block below is the version
     * two devices can actually produce; this is the cheap one, and it asserts the half that
     * matters most in words: the loser is *told the winning time*, so the screen in front of
     * them shows the same moment rather than an error it has to interpret.
     */
    it('refuses a second press and hands back the time that stands', async () => {
      await db.query('begin');
      try {
        await actAs(db, STARTER);

        const { rows: first } = await db.query<{ answer: Answer }>(
          'select timing.start_event($1) as answer',
          [PENDING_SLUG],
        );
        const { rows: second } = await db.query<{ answer: Answer }>(
          'select timing.start_event($1) as answer',
          [PENDING_SLUG],
        );

        expect(first[0]?.answer.ok).toBe(true);
        expect(second[0]?.answer.ok).toBe(false);
        expect(second[0]?.answer.reason).toBe('already_started');
        expect(second[0]?.answer.actually_started_at).toBe(
          first[0]?.answer.actually_started_at,
        );
      } finally {
        await db.query('rollback');
      }
    });

    it('audits the press that set the clock, and only that one', async () => {
      await db.query('begin');
      try {
        await actAs(db, STARTER);

        await db.query('select timing.start_event($1)', [PENDING_SLUG]);
        // The losing press writes nothing: the audit trail is where somebody goes to ask when
        // the race started, and a second row is a second candidate answer to that question.
        await db.query('select timing.start_event($1)', [PENDING_SLUG]);

        await stopActing(db);
        const { rows } = await db.query<{
          actor_id: string;
          detail: { event_slug: string };
        }>(
          `select actor_id, detail from timing.admin_actions
            where event_id = $1 and action = 'race_started'`,
          [PENDING_ID],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.actor_id).toBe(STARTER);
        expect(rows[0]?.detail.event_slug).toBe(PENDING_SLUG);
      } finally {
        await db.query('rollback');
      }
    });
  });

  /**
   * ⚠️ **Two connections, and this block commits.** Everything else in this file runs inside a
   * transaction that is rolled back, which cannot express what #250's definition of done
   * actually asks for: two callers pressing at once. The guard being tested is the `update`'s
   * own `where actually_started_at is null`, and what makes it hold is the **row lock** — the
   * second statement blocks, then re-evaluates its predicate against the committed new version
   * and matches nothing. A single transaction never blocks on itself, so it cannot prove this.
   *
   * `RACE_SLUG` is the only event this block touches, and `afterAll` deletes it.
   */
  describe('two devices, one gun', () => {
    async function connect(personId: string): Promise<Client> {
      const client = new Client({ connectionString: LOCAL_DB });
      await client.connect();
      await client.query('begin');
      await actAs(client, personId);
      return client;
    }

    it('lets exactly one press win, and tells the other which time stands', async () => {
      const first = await connect(STARTER);
      const second = await connect(SECOND_STARTER);

      try {
        const { rows: won } = await first.query<{ answer: Answer }>(
          'select timing.start_event($1) as answer',
          [RACE_SLUG],
        );

        // Issued while `first` still holds the row lock, so it blocks inside the `update`
        // rather than reading a stale row and overwriting. Not awaited until after the commit.
        const blocked = second.query<{ answer: Answer }>(
          'select timing.start_event($1) as answer',
          [RACE_SLUG],
        );

        await first.query('commit');

        const { rows: lost } = await blocked;
        await second.query('commit');

        expect(won[0]?.answer.ok).toBe(true);
        expect(lost[0]?.answer.ok).toBe(false);
        expect(lost[0]?.answer.reason).toBe('already_started');

        // ⚠️ **The assertion the whole migration exists for.** The loser is handed the
        // winner's value, so no device shows a different moment — and the column still holds
        // the first press.
        expect(lost[0]?.answer.actually_started_at).toBe(
          won[0]?.answer.actually_started_at,
        );

        const { rows: stored } = await db.query<{ started: string }>(
          'select actually_started_at as started from timing.events where id = $1',
          [RACE_ID],
        );
        expect(new Date(stored[0]!.started).toISOString()).toBe(
          new Date(won[0]!.answer.actually_started_at as string).toISOString(),
        );

        // And one audit row, naming the person whose press actually set the clock.
        await stopActing(db);
        const { rows: audit } = await db.query<{ actor_id: string }>(
          `select actor_id from timing.admin_actions
            where event_id = $1 and action = 'race_started'`,
          [RACE_ID],
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]?.actor_id).toBe(STARTER);
      } finally {
        await first.end();
        await second.end();
      }
    });
  });

  describe('clearing a false start', () => {
    it('puts the race back to not started, and lets it be corrected again', async () => {
      await db.query('begin');
      try {
        await actAs(db, STARTER);

        const { rows: cleared } = await db.query<{ answer: Answer }>(
          'select timing.clear_start($1) as answer',
          [CLEARABLE_SLUG],
        );
        expect(cleared[0]?.answer).toEqual({ ok: true, slug: CLEARABLE_SLUG });

        // The consequence rather than a side effect: `update_event` reads the same column.
        const { rows: edit } = await db.query<{ answer: Answer }>(
          'select timing.update_event($1, $2, $3) as answer',
          [CLEARABLE_SLUG, 'Corrected after a false start', '2026-11-01T11:15:00Z'],
        );
        expect(edit[0]?.answer.ok).toBe(true);

        // ⚠️ **The audit row carries the value that was thrown away**, because the column it
        // came out of is now null and this is the only place it still exists.
        await stopActing(db);
        const { rows: audit } = await db.query<{
          actor_id: string;
          detail: { was_started_at: string };
        }>(
          `select actor_id, detail from timing.admin_actions
            where event_id = $1 and action = 'start_cleared'`,
          [CLEARABLE_ID],
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]?.actor_id).toBe(STARTER);
        expect(new Date(audit[0]!.detail.was_started_at).toISOString()).toBe(
          new Date(STARTED_AT).toISOString(),
        );
      } finally {
        await db.query('rollback');
      }
    });

    /**
     * ⚠️ **The line between this function and the danger zone.** A split is
     * `captured_at - coalesce(actually_started_at, start_at)`, so clearing the start after a
     * crossing has landed silently re-times it — for rows nobody re-checks.
     */
    it('is refused once anybody has been timed, and changes nothing', async () => {
      expect(await clearAs(STARTER, CROSSED_SLUG)).toEqual({
        ok: false,
        reason: 'crossings_exist',
      });

      const { rows } = await db.query<{ started: string | null }>(
        'select actually_started_at as started from timing.events where id = $1',
        [CROSSED_ID],
      );
      expect(rows[0]?.started).not.toBeNull();
    });

    /**
     * Not an error and not a success. A page that said "the start has been cleared" about a
     * race that never started is a page somebody believes — `unassign_marshal()`'s
     * `not_on_roster` is the same shape and was written for the same reason.
     */
    it('answers not_started rather than ok for a race that never started', async () => {
      expect(await clearAs(STARTER, PENDING_SLUG)).toEqual({
        ok: false,
        reason: 'not_started',
      });
    });
  });
});

/**
 * Resolving an anomaly, and correcting the timing log — #252.
 *
 * ⚠️ **The concurrency assertions are the point of this block, not a flourish.** Two volunteers
 * on one triage list is the *normal* case on a race morning — there is one anomalies page and
 * everybody free is looking at it — and the old application learned its compare-and-swaps the
 * hard way. #252 says to reproduce them rather than simplify them, so what is asserted here is
 * that the **second** writer is refused and told, rather than silently overwriting the first
 * one's decision.
 */
describe('resolving an anomaly and correcting the log', () => {
  const RESOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01';
  const MARSHAL_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab02';
  const EVENT_ID = '00000000-0000-4000-8000-0000000000f1';
  const TEAM_ID = '00000000-0000-4000-8000-0000000000f2';
  const SLUG = 'zz-timing-anomalies';

  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

  /** Run one statement as a signed-in person, then roll back — the file's own helper shape. */
  async function asPerson<T>(
    personId: string,
    sql: string,
    params: unknown[] = [],
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

  /**
   * The same, but **committed** — which the concurrency tests need and the rolled-back helper
   * above cannot give them: two writes that both vanish at rollback never race each other.
   *
   * ⚠️ **`false` rather than `true` on `set_config`, so the setting is session-wide rather than
   * transaction-local — and that is exactly why the `finally` is not optional.** `authenticated`
   * holds **no grant on any table** in `timing`, so a verification read left under the
   * impersonated role answers `permission denied for table crossings`, which reads as a broken
   * function and is not one. This file's start-race block carries the same warning at
   * `stopActing`, which paid for it twice.
   */
  async function asPersonCommitted<T>(
    personId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    await db.query("select set_config('role', 'authenticated', false)");
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
      [personId],
    );

    try {
      const { rows } = await db.query<{ answer: T }>(sql, params);
      return rows[0]?.answer as T;
    } finally {
      await db.query("select set_config('role', 'postgres', false)");
      await db.query("select set_config('request.jwt.claims', null, false)");
    }
  }

  /**
   * A crossing, written as the superuser so each test starts from a known state.
   *
   * ⚠️ **The audit rows are cleared too, and leaving them out made an assertion count across
   * runs.** `timing.admin_actions.event_id` is `on delete set null`, deliberately — an audit
   * trail that vanished with the race it was about would be no audit trail — so dropping the
   * fixture event in `afterAll` does **not** take its actions with it. The "exactly one audit
   * row" assertion below therefore passed on a fresh database and failed on the second run of
   * the same suite, which is the shape of staleness that is easiest to misread as a real
   * concurrency defect.
   */
  async function seedCrossing(
    id: string,
    bib: string | null,
    opts: { flag?: boolean; reason?: string; at?: string } = {},
  ): Promise<void> {
    await db.query('delete from timing.crossings where id = $1', [id]);
    await db.query(
      "delete from timing.admin_actions where detail ->> 'crossing_id' = $1",
      [id],
    );
    await db.query(
      `insert into timing.crossings
         (id, event_id, bib, captured_at, anomaly_flag, anomaly_reason)
       values ($1, $2, $3, $4::timestamptz, $5, $6)`,
      [
        id,
        EVENT_ID,
        bib,
        opts.at ?? '2026-11-01T11:30:00Z',
        opts.flag ?? false,
        opts.reason ?? null,
      ],
    );
  }

  async function crossingRow(id: string): Promise<{
    bib: string | null;
    resolved_at: string | null;
    resolved_action: string | null;
    team_id: string | null;
  }> {
    const { rows } = await db.query<{
      bib: string | null;
      resolved_at: string | null;
      resolved_action: string | null;
      team_id: string | null;
    }>(
      'select bib, resolved_at, resolved_action, team_id from timing.crossings where id = $1',
      [id],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [RESOLVER, 'timing-resolver@example.com'],
      [MARSHAL_ONLY, 'timing-resolver-marshal@example.com'],
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

    // `timing-admin` carries `timing.crossing.resolve`; `timing-marshal` carries only
    // `timing.crossing.record`, which is what makes the refusals below mean something.
    await db.query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, 'timing-admin', $1), ($2, 'timing-marshal', $2)
       on conflict do nothing`,
      [RESOLVER, MARSHAL_ONLY],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, 'Anomaly Fixture', 'solo', '2026-11-01T11:00:00Z',
               '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '311')`,
      [TEAM_ID, EVENT_ID],
    );
  });

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [RESOLVER, MARSHAL_ONLY],
    ]);
    await db.query('delete from identity.people where id = any($1::uuid[])', [
      [RESOLVER, MARSHAL_ONLY],
    ]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [
      [RESOLVER, MARSHAL_ONLY],
    ]);
  });

  /**
   * ⚠️ **The constraint #252 says already exists.** It did not — `20260911140000` declared two
   * bare nullable columns with nothing tying them together — so it is asserted here as well as
   * added, because a coherence rule nobody checks is a rule that quietly stops holding.
   */
  describe('the shape a resolution may take', () => {
    it('refuses a resolved_at with no action beside it, and the reverse', async () => {
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000001', '311');

      await expect(
        db.query('update timing.crossings set resolved_at = now() where id = $1', [
          'bbbbbbbb-0000-4000-8000-000000000001',
        ]),
      ).rejects.toMatchObject({ constraint: 'crossings_resolution_coherent' });

      await expect(
        db.query(
          "update timing.crossings set resolved_action = 'discarded' where id = $1",
          ['bbbbbbbb-0000-4000-8000-000000000001'],
        ),
      ).rejects.toMatchObject({ constraint: 'crossings_resolution_coherent' });
    });

    it('refuses a resolution nobody has defined', async () => {
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000002', '311');

      await expect(
        db.query(
          "update timing.crossings set resolved_at = now(), resolved_action = 'deleted' where id = $1",
          ['bbbbbbbb-0000-4000-8000-000000000002'],
        ),
      ).rejects.toMatchObject({ constraint: 'crossings_resolved_action_shaped' });
    });
  });

  describe('the triage list', () => {
    it('unions a flagged capture with an orphan nothing flagged', async () => {
      // ⚠️ The orphan is the half a `anomaly_flag`-only query would hide: `record_crossing()`
      // stores an unknown bib and never refuses it, so nothing marks it.
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000011', '311', {
        flag: true,
        reason: 'Duplicate bib 311 — already captured at 11:20:00',
        at: '2026-11-01T11:30:00Z',
      });
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000012', '999', {
        at: '2026-11-01T11:31:00Z',
      });
      // Neither flagged nor orphaned: it must not appear.
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000013', '311', {
        at: '2026-11-01T11:32:00Z',
      });

      const open = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.open_anomalies($1) as answer',
        [SLUG],
      );

      expect(open.map((row) => row.id)).toEqual([
        'bbbbbbbb-0000-4000-8000-000000000011',
        'bbbbbbbb-0000-4000-8000-000000000012',
      ]);
      // Oldest first, because triage is a queue.
      expect(open[0]).toMatchObject({ anomaly_flag: true, orphan: false });
      expect(open[1]).toMatchObject({ anomaly_flag: false, orphan: true, bib: '999' });
    });

    it('leaves out a capture with no bib at all', async () => {
      // A tap whose marshal never typed a bib is not something an admin can resolve from a
      // desk, so it is deliberately not in the queue.
      await seedCrossing('bbbbbbbb-0000-4000-8000-000000000014', null);

      const open = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.open_anomalies($1) as answer',
        [SLUG],
      );

      expect(open.map((row) => row.id)).not.toContain(
        'bbbbbbbb-0000-4000-8000-000000000014',
      );
    });

    it('answers null to somebody holding only timing.crossing.record', async () => {
      expect(
        await asPerson(MARSHAL_ONLY, 'select timing.open_anomalies($1) as answer', [
          SLUG,
        ]),
      ).toBeNull();
      expect(
        await asPerson(MARSHAL_ONLY, 'select timing.crossing_log($1) as answer', [SLUG]),
      ).toBeNull();
    });

    it('answers the same null for a race that does not exist', async () => {
      expect(
        await asPerson(RESOLVER, 'select timing.open_anomalies($1) as answer', [
          'zz-no-such-race',
        ]),
      ).toBeNull();
    });
  });

  describe('two volunteers resolving the same capture', () => {
    const ID = 'bbbbbbbb-0000-4000-8000-000000000021';

    /**
     * ⚠️ **The assertion #252's definition of done names first**, and the reason every write in
     * that migration is a compare-and-swap. Exactly one succeeds; the loser is told so, and the
     * winner's decision is what the row holds.
     */
    it('lets exactly one through, and tells the other', async () => {
      await seedCrossing(ID, '311', { flag: true, reason: 'Duplicate bib 311' });

      const first = await asPersonCommitted(
        RESOLVER,
        'select timing.resolve_crossing($1, $2) as answer',
        [ID, 'marked_valid'],
      );
      const second = await asPersonCommitted(
        RESOLVER,
        'select timing.resolve_crossing($1, $2) as answer',
        [ID, 'discarded'],
      );

      expect(first).toMatchObject({ ok: true, resolution: 'marked_valid' });
      expect(second).toEqual({ ok: false, reason: 'already_resolved' });

      // The first decision is what stands — not the last write.
      expect(await crossingRow(ID)).toMatchObject({ resolved_action: 'marked_valid' });
    });

    it('writes no audit row for the resolution that did not happen', async () => {
      // ⚠️ Update first, audit second. An audit row claiming a change that did not happen is
      // worse than none: it is what somebody disputing a result would be shown.
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from timing.admin_actions
          where action = 'crossing_resolved'
            and detail ->> 'crossing_id' = $1`,
        [ID],
      );

      expect(rows[0]?.n).toBe('1');
    });
  });

  describe('discarding and restoring', () => {
    const ID = 'bbbbbbbb-0000-4000-8000-000000000031';

    it('round-trips, clearing both columns together', async () => {
      await seedCrossing(ID, '311', { flag: true, reason: 'Duplicate bib 311' });

      expect(
        await asPersonCommitted(
          RESOLVER,
          'select timing.resolve_crossing($1, $2) as answer',
          [ID, 'discarded'],
        ),
      ).toMatchObject({ ok: true });
      expect(await crossingRow(ID)).toMatchObject({ resolved_action: 'discarded' });

      expect(
        await asPersonCommitted(
          RESOLVER,
          'select timing.restore_crossing($1) as answer',
          [ID],
        ),
      ).toMatchObject({ ok: true });

      // ⚠️ Both null, which is what the coherence check demands — and the reason it was worth
      // adding: clearing one and leaving the other is now a row the schema refuses outright.
      const after = await crossingRow(ID);
      expect(after.resolved_at).toBeNull();
      expect(after.resolved_action).toBeNull();
    });

    it('refuses to restore a capture that was marked valid rather than discarded', async () => {
      const OTHER = 'bbbbbbbb-0000-4000-8000-000000000032';
      await seedCrossing(OTHER, '311', { flag: true });
      await asPersonCommitted(
        RESOLVER,
        'select timing.resolve_crossing($1, $2) as answer',
        [OTHER, 'marked_valid'],
      );

      // Restoring one of those would be undoing a different decision, and there is nothing to
      // undo.
      expect(
        await asPersonCommitted(
          RESOLVER,
          'select timing.restore_crossing($1) as answer',
          [OTHER],
        ),
      ).toEqual({ ok: false, reason: 'not_discarded' });
    });
  });

  describe('correcting a bib', () => {
    it('re-derives the team from the trigger rather than by hand', async () => {
      const ID = 'bbbbbbbb-0000-4000-8000-000000000041';
      await seedCrossing(ID, '999', { at: '2026-11-01T11:40:00Z' });

      expect(await crossingRow(ID)).toMatchObject({ team_id: null });

      const answer = await asPersonCommitted<Envelope>(
        RESOLVER,
        'select timing.resolve_crossing($1, $2, $3) as answer',
        [ID, 'edited', '311'],
      );

      expect(answer).toMatchObject({ ok: true, bib: '311', orphan: false });
      expect((await crossingRow(ID)).team_id).toBe(TEAM_ID);
    });

    it('keeps an edit that still matches nothing, and says so', async () => {
      // Not a failure: the admin has recorded what they believe the bib was, and the roster is
      // what has to change next. A page that read this as success would look finished.
      const ID = 'bbbbbbbb-0000-4000-8000-000000000042';
      await seedCrossing(ID, '311', { flag: true });

      expect(
        await asPersonCommitted<Envelope>(
          RESOLVER,
          'select timing.resolve_crossing($1, $2, $3) as answer',
          [ID, 'edited', '888'],
        ),
      ).toMatchObject({ ok: true, bib: '888', orphan: true });
    });

    it('refuses an edit with no bib to edit to', async () => {
      const ID = 'bbbbbbbb-0000-4000-8000-000000000043';
      await seedCrossing(ID, '311', { flag: true });

      expect(
        await asPersonCommitted(
          RESOLVER,
          'select timing.resolve_crossing($1, $2, $3) as answer',
          [ID, 'edited', '   '],
        ),
      ).toEqual({ ok: false, reason: 'bib_required' });
    });
  });

  describe('the log’s own compare-and-swap', () => {
    const ID = 'bbbbbbbb-0000-4000-8000-000000000051';
    const AT = '2026-11-01T11:45:00Z';

    /**
     * ⚠️ **The case `resolve_crossing`'s latch cannot see.** This row was never flagged, so
     * `resolved_at` is null for ever — the triage latch would match both writers and the later
     * one would win in silence. Swapping on the values the editor was looking at is what makes
     * the second attempt refuse.
     */
    it('refuses an edit made against values that have since moved', async () => {
      await seedCrossing(ID, '311', { at: AT });

      const first = await asPersonCommitted<Envelope>(
        RESOLVER,
        'select timing.edit_crossing($1, $2, $3::timestamptz, $4, $5::timestamptz) as answer',
        [ID, '312', AT, '311', AT],
      );
      const second = await asPersonCommitted<Envelope>(
        RESOLVER,
        'select timing.edit_crossing($1, $2, $3::timestamptz, $4, $5::timestamptz) as answer',
        [ID, '313', AT, '311', AT],
      );

      expect(first).toMatchObject({ ok: true, bib: '312' });
      expect(second).toEqual({ ok: false, reason: 'changed_elsewhere' });
      expect((await crossingRow(ID)).bib).toBe('312');
    });

    it('swaps correctly against a capture that has no bib at all', async () => {
      // `null = null` is null, so a bare `=` would make every swap against an unbibbed capture
      // fail for ever. `is not distinct from` is what makes this work.
      const EMPTY = 'bbbbbbbb-0000-4000-8000-000000000052';
      await seedCrossing(EMPTY, null, { at: AT });

      expect(
        await asPersonCommitted<Envelope>(
          RESOLVER,
          'select timing.edit_crossing($1, $2, $3::timestamptz, $4, $5::timestamptz) as answer',
          [EMPTY, '311', AT, null, AT],
        ),
      ).toMatchObject({ ok: true, bib: '311' });
    });

    it('records before and after on the audit row', async () => {
      const { rows } = await db.query<{ detail: Record<string, unknown> }>(
        `select detail from timing.admin_actions
          where action = 'crossing_edited' and detail ->> 'crossing_id' = $1
          order by created_at desc limit 1`,
        [ID],
      );

      // "The bib was changed" without saying from what is not something a dispute can be
      // settled on.
      expect(rows[0]?.detail).toMatchObject({
        before: expect.objectContaining({ bib: '311' }),
        after: expect.objectContaining({ bib: '312' }),
      });
    });
  });

  describe('what the log shows that the triage list does not', () => {
    it('keeps a discarded capture visible, so it can be restored', async () => {
      const ID = 'bbbbbbbb-0000-4000-8000-000000000061';
      await seedCrossing(ID, '311', { flag: true, at: '2026-11-01T11:50:00Z' });
      await asPersonCommitted(
        RESOLVER,
        'select timing.resolve_crossing($1, $2) as answer',
        [ID, 'discarded'],
      );

      const log = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.crossing_log($1) as answer',
        [SLUG],
      );
      const row = log.find((entry) => entry.id === ID);

      // ⚠️ A log that hid what had been taken out would be a log nobody could audit from.
      expect(row).toMatchObject({ resolved_action: 'discarded' });

      const open = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.open_anomalies($1) as answer',
        [SLUG],
      );
      expect(open.map((entry) => entry.id)).not.toContain(ID);
    });

    it('marks a capture timed before the gun without refusing it', async () => {
      // The old application found wrong phone clocks exactly this way. It is surfaced and left
      // alone: the row is still a real crossing.
      const EARLY = 'bbbbbbbb-0000-4000-8000-000000000062';
      await seedCrossing(EARLY, '311', { at: '2026-11-01T10:00:00Z' });

      const log = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.crossing_log($1) as answer',
        [SLUG],
      );

      expect(log.find((entry) => entry.id === EARLY)).toMatchObject({
        before_start: true,
      });
    });

    it('searches on the bib and on the team number, and on nothing else', async () => {
      const found = await asPerson<Record<string, unknown>[]>(
        RESOLVER,
        'select timing.crossing_log($1, $2) as answer',
        [SLUG, '311'],
      );

      expect(found.length).toBeGreaterThan(0);
      expect(
        found.every((entry) => entry.bib === '311' || entry.team_number === '311'),
      ).toBe(true);
    });
  });

  describe('who may change any of it', () => {
    it('refuses every write to somebody holding only timing.crossing.record', async () => {
      const ID = 'bbbbbbbb-0000-4000-8000-000000000071';
      await seedCrossing(ID, '311', { flag: true });

      expect(
        await asPerson(MARSHAL_ONLY, 'select timing.resolve_crossing($1, $2) as answer', [
          ID,
          'discarded',
        ]),
      ).toEqual({ ok: false, reason: 'refused' });
      expect(
        await asPerson(MARSHAL_ONLY, 'select timing.restore_crossing($1) as answer', [
          ID,
        ]),
      ).toEqual({ ok: false, reason: 'refused' });
      expect(
        await asPerson(
          MARSHAL_ONLY,
          'select timing.edit_crossing($1, $2, $3::timestamptz, $4, $5::timestamptz) as answer',
          [ID, '312', '2026-11-01T11:30:00Z', '311', '2026-11-01T11:30:00Z'],
        ),
      ).toEqual({ ok: false, reason: 'refused' });

      // Nothing moved.
      expect(await crossingRow(ID)).toMatchObject({ bib: '311', resolved_action: null });
    });

    it('refuses an anonymous caller on the grant, before the permission is asked', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'anon', true)");
        await expect(
          db.query('select timing.resolve_crossing($1, $2)', [
            'bbbbbbbb-0000-4000-8000-000000000071',
            'discarded',
          ]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await db.query('rollback');
      }
    });
  });
});
