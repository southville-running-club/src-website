import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
   *   * `team_status_list`, `set_race_status`, `finish_event` and `reopen_event` —
   *     `timing.event.manage`, #253. ⚠️ **`set_race_status()` audits the reversal as well as the
   *     setting**, which the old application did not: a runner disputing a disqualification is
   *     owed the record of it being lifted as much as the record of it being applied. ⚠️
   *     **Neither finishing function gates anything** — `record_crossing()` and the resolution
   *     functions are untouched by `finished_at`, because the last runner's crossing arrives
   *     after the race director has called it, and the block at the foot of this file asserts
   *     exactly that;
   *   * `reset_event` — `timing.event.manage`, #254. ⚠️ **The most destructive grant on this
   *     list and the only one that takes a confirmation phrase**, because a POST that skipped
   *     the page has to meet the same control as one that did not: it refuses unless its second
   *     argument is the race's own slug. It is refused outright once results are published —
   *     #241's column — and it **audits even when it removes nothing**, because the intent is
   *     the auditable fact. The block at the foot of this file asserts the counts against the
   *     rows actually removed, with a fixture holding crossings both matched and orphaned;
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
   *     caller does, which is what the concurrency block at the foot of this file asserts;
   *   * `publish_results` and `unpublish_results` — `timing.result.publish`, #241 and ADR-042,
   *     which had existed since `20260911100000` and gated nothing until now. ⚠️ **Publishing
   *     is refused while `finished_at` is null and while any crossing is on the triage list**,
   *     and unpublishing is refused by nothing beyond the permission, because a correction
   *     after publication is *unpublish, fix, publish* and an anomaly found afterwards is
   *     exactly when somebody needs it most.
   *
   *   * `results_published_at` — **nothing**, and it is the one function on this list that
   *     authorises by answering a fact publication has already made public: when this race's
   *     results became public, or `null` for a race that is not published *and* for one that
   *     does not exist. #242 and
   *     [ADR-043](../../../../docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).
   *     ⚠️ **It exists so that `/nn/` and `/nn/<year>/` can link to the results only once they
   *     are published** — a link to a 404 is a claim about a record — without calling
   *     `results_for_event`, which answers that one bit by returning every team, every runner
   *     and every crossing of the field.
   *
   * ⚠️ **`anon` holds exactly two of them, and that is the decision this list exists to make
   * visible.** `results_for_event` is granted to `anon` as well as to `authenticated` since
   * #241, because a published result is public and a signed-out visitor reaches PostgREST as
   * `anon`. It answers `null` for an unpublished race whoever asks, so the grant discloses
   * nothing publication has not already made public — and `anon` still holds no grant on any
   * *table* here, which is the assertion at the head of this file. `results_published_at`
   * joined it with #242; ADR-042's *"and the only one"* is superseded by ADR-043 and the
   * count in this test's own name is what made that a sentence somebody wrote down.
   *
   * ⚠️ **The bib trigger function is still on nobody's list.** It is reachable from its trigger
   * and nothing else; a grant on it would be a function anybody could call to probe how bibs
   * resolve. Both migrations revoke it defensively, and this is what says that held.
   */
  it('grants exactly these thirty-four functions, and anon exactly two of them', async () => {
    const { rows } = await db.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
         from information_schema.role_routine_grants
        where routine_schema = 'timing' and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by routine_name, grantee`,
    );

    // Thirty-four functions and thirty-six rows: `results_for_event` and
    // `results_published_at` each appear twice, which is the whole point of the list.
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
      { routine_name: 'finish_event', grantee: 'authenticated' },
      { routine_name: 'import_from_entries', grantee: 'authenticated' },
      { routine_name: 'import_registration', grantee: 'authenticated' },
      { routine_name: 'known_crossings', grantee: 'authenticated' },
      { routine_name: 'list_events', grantee: 'authenticated' },
      { routine_name: 'marshal_event', grantee: 'authenticated' },
      { routine_name: 'open_anomalies', grantee: 'authenticated' },
      { routine_name: 'publish_results', grantee: 'authenticated' },
      { routine_name: 'record_crossing', grantee: 'authenticated' },
      { routine_name: 'reopen_event', grantee: 'authenticated' },
      { routine_name: 'reset_event', grantee: 'authenticated' },
      { routine_name: 'resolve_crossing', grantee: 'authenticated' },
      { routine_name: 'restore_crossing', grantee: 'authenticated' },
      // ⚠️ **The first `anon` grant in this schema**, #241. See the block comment above.
      { routine_name: 'results_for_event', grantee: 'anon' },
      { routine_name: 'results_for_event', grantee: 'authenticated' },
      /**
       * ⚠️ **The thirty-second, #205, and `authenticated` only — never `anon`.** It is
       * `results_for_event()`'s answer plus `runners.role` and `runners.result_placement`,
       * which the public answer may never carry: a guide's role discloses, by inference, that
       * the runner they are paired with is visually impaired (ADR-022), and a placement is
       * ADR-031's raw answer rather than the category derived from it.
       *
       * It exists because `results_for_event()` answers `null` to the person the preview screen
       * is for — `timing-admin` deliberately does not hold `nn.results.read`, which
       * `identity-permissions.test.ts` says in as many words. Two audiences, two functions, and
       * the difference between them is exactly the fields that must stay in the building.
       */
      { routine_name: 'results_preview', grantee: 'authenticated' },
      // ⚠️ **#242's, and the second `anon` grant.** One bit, so a link can be painted without
      // reading a whole field of runners to decide whether to paint an anchor.
      { routine_name: 'results_published_at', grantee: 'anon' },
      { routine_name: 'results_published_at', grantee: 'authenticated' },
      { routine_name: 'roster_for_event', grantee: 'authenticated' },
      { routine_name: 'set_bib_override', grantee: 'authenticated' },
      { routine_name: 'set_race_status', grantee: 'authenticated' },
      { routine_name: 'start_event', grantee: 'authenticated' },
      { routine_name: 'team_status_list', grantee: 'authenticated' },
      { routine_name: 'unassign_marshal', grantee: 'authenticated' },
      { routine_name: 'unpublish_results', grantee: 'authenticated' },
      { routine_name: 'update_event', grantee: 'authenticated' },
    ]);
  });

  /**
   * The refusal, asserted as the specific answer rather than as "something went wrong". A
   * connection with no token has no `auth.uid()`, so `identity.has_permission()` is false and
   * the function answers `null` — not an error, and not the results.
   *
   * ⚠️ **Since #241 that refusal has two halves and this asserts the pair.** The permission is
   * consulted only when the race is unpublished, so what this proves is that an unpublished
   * race is refused to a caller holding nothing — which is the club's rule, and the state every
   * race is in until somebody publishes it.
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
   *
   * ⚠️ **`results_published_at` joined them with #241 and it is a key with the same property**:
   * the page tells a preview from a published table by its presence, so a key that stopped
   * being built would arrive as `undefined` and every published race would render the
   * preview's "not published" banner to the public. ⚠️ **`results_published_by` is
   * deliberately absent** — no results page needs to know which volunteer pressed the button,
   * and the minimisation rule that keeps a runner's email out of this payload applies to a
   * staff member's id too.
   */
  it('carries the timestamps a derived time is measured against, as keys', async () => {
    const results = await asPerson(RESULTS_READER);

    expect(Object.keys(results?.event ?? {}).sort()).toEqual([
      'actually_started_at',
      'finished_at',
      'format',
      'name',
      'results_published_at',
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

/**
 * Race status, and finishing — #253.
 *
 * ⚠️ **Two assertions here are the ones that matter and neither is about the happy path**: that
 * **lifting** a status is audited as loudly as applying one, and that finishing **gates
 * nothing**. The old application audited a disqualification and not its reversal, which is
 * exactly backwards for the person disputing it; and a finish that refused a crossing would lose
 * the last runner's result, because the last crossing always arrives after somebody has called
 * the race.
 */
describe('race status and finishing', () => {
  const MANAGER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01';
  const MARSHAL_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02';
  const EVENT_ID = '00000000-0000-4000-8000-000000000f01';
  const TEAM_ID = '00000000-0000-4000-8000-000000000f02';
  const SLUG = 'zz-timing-finishing';

  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

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

  /** Committed, because the reversal has to see what the setting wrote. See #252's helper. */
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
      // ⚠️ `authenticated` holds no grant on any table in `timing`, so a verification read left
      // under the impersonated role answers `permission denied`. This file warns about it twice.
      await db.query("select set_config('role', 'postgres', false)");
      await db.query("select set_config('request.jwt.claims', null, false)");
    }
  }

  async function resetRace(): Promise<void> {
    await db.query('update timing.events set finished_at = null where id = $1', [
      EVENT_ID,
    ]);
    await db.query('update timing.teams set race_status = null where id = $1', [TEAM_ID]);
    await db.query(
      "delete from timing.admin_actions where event_id = $1 and action in ('race_status_set', 'race_finished', 'race_reopened')",
      [EVENT_ID],
    );
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [MANAGER, 'timing-finish-manager@example.com'],
      [MARSHAL_ONLY, 'timing-finish-marshal@example.com'],
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
       values ($1, 'timing-admin', $1), ($2, 'timing-marshal', $2)
       on conflict do nothing`,
      [MANAGER, MARSHAL_ONLY],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, 'Finishing Fixture', 'solo', '2026-11-01T11:00:00Z',
               '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '501')`,
      [TEAM_ID, EVENT_ID],
    );
    await db.query(
      `insert into timing.runners (team_id, leg, firstname, lastname)
       values ($1, 1, 'Ada', 'Lovelace')`,
      [TEAM_ID],
    );
    // The manager is rostered so the never-a-gate assertion can record a crossing as them.
    await db.query(
      'insert into timing.marshals (event_id, user_id) values ($1, $2) on conflict do nothing',
      [EVENT_ID, MANAGER],
    );
  });

  beforeEach(resetRace);

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
    await db.query('delete from identity.people where id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
  });

  describe('marking a team', () => {
    it.each([['dns'], ['dnf'], ['dq']])('records %s', async (status) => {
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.set_race_status($1, $2, $3) as answer',
          [SLUG, TEAM_ID, status],
        ),
      ).toMatchObject({ ok: true, race_status: status, changed: true });

      const { rows } = await db.query<{ race_status: string | null }>(
        'select race_status from timing.teams where id = $1',
        [TEAM_ID],
      );
      expect(rows[0]?.race_status).toBe(status);
    });

    /**
     * ⚠️ **The assertion #253 exists to add.** The old application noted that undoing a DQ was
     * not audited; a runner disputing one is owed the record of it being lifted as much as the
     * record of it being applied.
     */
    it('audits the reversal with both sides, not only the setting', async () => {
      await asPersonCommitted(
        MANAGER,
        'select timing.set_race_status($1, $2, $3) as answer',
        [SLUG, TEAM_ID, 'dq'],
      );
      await asPersonCommitted(
        MANAGER,
        'select timing.set_race_status($1, $2, $3) as answer',
        [SLUG, TEAM_ID, null],
      );

      const { rows } = await db.query<{ detail: Record<string, unknown> }>(
        `select detail from timing.admin_actions
          where event_id = $1 and action = 'race_status_set'
          order by created_at`,
        [EVENT_ID],
      );

      expect(rows).toHaveLength(2);
      expect(rows[0]?.detail).toMatchObject({ before: null, after: 'dq' });
      expect(rows[1]?.detail).toMatchObject({ before: 'dq', after: null });
    });

    it('writes no audit row when nothing moved', async () => {
      // Pressing "clear" on a team with no status is an ordinary thing to do twice, and it is
      // not a failure — but it is not a decision either, so it is not in the trail.
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.set_race_status($1, $2, $3) as answer',
          [SLUG, TEAM_ID, null],
        ),
      ).toMatchObject({ ok: true, changed: false });

      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from timing.admin_actions
          where event_id = $1 and action = 'race_status_set'`,
        [EVENT_ID],
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('refuses a status nobody has defined', async () => {
      expect(
        await asPerson(MANAGER, 'select timing.set_race_status($1, $2, $3) as answer', [
          SLUG,
          TEAM_ID,
          'withdrawn',
        ]),
      ).toEqual({ ok: false, reason: 'invalid_status' });
    });

    it('refuses a team that is not on the race in the address', async () => {
      // ⚠️ Scoped to the event as well as the team id: a team id alone would let a volunteer on
      // one race's page change a team on another, invisibly.
      expect(
        await asPerson(MANAGER, 'select timing.set_race_status($1, $2, $3) as answer', [
          'zz-no-such-race',
          TEAM_ID,
          'dnf',
        ]),
      ).toEqual({ ok: false, reason: 'no_such_event' });
    });
  });

  describe('finishing', () => {
    it('is idempotent, and the second press gets the winning time', async () => {
      const first = await asPersonCommitted<Envelope>(
        MANAGER,
        'select timing.finish_event($1) as answer',
        [SLUG],
      );
      const second = await asPersonCommitted<Envelope>(
        MANAGER,
        'select timing.finish_event($1) as answer',
        [SLUG],
      );

      expect(first).toMatchObject({ ok: true });
      // `start_event()`'s rule: the losing device shows the same moment rather than an error.
      expect(second).toMatchObject({ ok: false, reason: 'already_finished' });
      expect(second.finished_at).toBe(first.finished_at);
    });

    /**
     * ⚠️ **The never-a-gate assertion**, and the one that would cost a real result if it ever
     * went red. The last runner crosses after the race director has called it.
     */
    it('does not stop a crossing being recorded afterwards', async () => {
      await asPersonCommitted(MANAGER, 'select timing.finish_event($1) as answer', [
        SLUG,
      ]);

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.record_crossing($1, $2, $3, $4) as answer',
          ['cccccccc-0000-4000-8000-000000000001', SLUG, '501', '2026-11-01T12:30:00Z'],
        ),
      ).toMatchObject({ ok: true });
    });

    it('does not stop a status being set afterwards', async () => {
      await asPersonCommitted(MANAGER, 'select timing.finish_event($1) as answer', [
        SLUG,
      ]);

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.set_race_status($1, $2, $3) as answer',
          [SLUG, TEAM_ID, 'dnf'],
        ),
      ).toMatchObject({ ok: true, changed: true });
    });

    it('reopens, and refuses to reopen a race that was not finished', async () => {
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reopen_event($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'not_finished' });

      await asPersonCommitted(MANAGER, 'select timing.finish_event($1) as answer', [
        SLUG,
      ]);

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reopen_event($1) as answer',
          [SLUG],
        ),
      ).toMatchObject({ ok: true });

      const { rows } = await db.query<{ finished_at: string | null }>(
        'select finished_at from timing.events where id = $1',
        [EVENT_ID],
      );
      expect(rows[0]?.finished_at).toBeNull();
    });

    it('audits both the finish and the reopening', async () => {
      await asPersonCommitted(MANAGER, 'select timing.finish_event($1) as answer', [
        SLUG,
      ]);
      await asPersonCommitted(MANAGER, 'select timing.reopen_event($1) as answer', [
        SLUG,
      ]);

      const { rows } = await db.query<{ action: string }>(
        `select action from timing.admin_actions
          where event_id = $1 and action in ('race_finished', 'race_reopened')
          order by created_at`,
        [EVENT_ID],
      );

      expect(rows.map((r) => r.action)).toEqual(['race_finished', 'race_reopened']);
    });
  });

  describe('who may do any of it', () => {
    it('refuses every write to somebody holding only timing.crossing.record', async () => {
      for (const [sql, params] of [
        ['select timing.set_race_status($1, $2, $3) as answer', [SLUG, TEAM_ID, 'dq']],
        ['select timing.finish_event($1) as answer', [SLUG]],
        ['select timing.reopen_event($1) as answer', [SLUG]],
      ] as const) {
        expect(await asPerson(MARSHAL_ONLY, sql, [...params]), sql).toEqual({
          ok: false,
          reason: 'refused',
        });
      }

      expect(
        await asPerson(MARSHAL_ONLY, 'select timing.team_status_list($1) as answer', [
          SLUG,
        ]),
      ).toBeNull();
    });

    it('refuses an anonymous caller on the grant, before the permission is asked', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'anon', true)");
        await expect(
          db.query('select timing.finish_event($1)', [SLUG]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await db.query('rollback');
      }
    });
  });

  describe('the list the status page reads', () => {
    it('carries the runners, with a guide marked as one', async () => {
      const teams = await asPerson<Record<string, unknown>[]>(
        MANAGER,
        'select timing.team_status_list($1) as answer',
        [SLUG],
      );

      expect(teams).toHaveLength(1);
      expect(teams[0]).toMatchObject({ team_number: '501', race_status: null });
      expect(teams[0]?.runners).toEqual([
        expect.objectContaining({ leg: 1, firstname: 'Ada', lastname: 'Lovelace' }),
      ]);
    });

    it('searches by team number and by name', async () => {
      for (const term of ['501', 'Lovelace', 'ada']) {
        const found = await asPerson<Record<string, unknown>[]>(
          MANAGER,
          'select timing.team_status_list($1, $2) as answer',
          [SLUG, term],
        );
        expect(found, term).toHaveLength(1);
      }

      expect(
        await asPerson<Record<string, unknown>[]>(
          MANAGER,
          'select timing.team_status_list($1, $2) as answer',
          [SLUG, 'Hopper'],
        ),
      ).toEqual([]);
    });
  });
});

/**
 * Publishing a race's results, and the one grant that lets the internet read them — #241, under
 * [ADR-042](../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
 *
 * ⚠️ **The negative cases come first and they are the club's rule rather than a technicality.**
 * A race that is finished is not a race whose results are published; an anonymous caller is
 * refused until somebody decides. That ordering — unpublished first, published second, back to
 * `null` third — is what this block is shaped around, because a file that only ever asserted
 * the published case would pass just as happily if the gate were not there at all.
 *
 * Same fixture style as every block above: `auth.users` written directly, `request.jwt.claims`
 * set by hand, and every call in a transaction that is rolled back unless a later step has to
 * see what an earlier one wrote.
 */
describe("publishing a race's results", () => {
  const PUBLISHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaad01';
  const MANAGE_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaad02';
  const PREVIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaad03';
  const EVENT_ID = '00000000-0000-4000-8000-000000000f11';
  const TEAM_ID = '00000000-0000-4000-8000-000000000f12';
  const SLUG = 'zz-timing-publish';

  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };
  type ResultsAnswer = {
    event: Record<string, unknown>;
    teams: { runners: Record<string, unknown>[] }[];
    crossings: unknown[];
  } | null;

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

  /** Committed, because publishing and then reading back are two statements. #252's helper. */
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
      // ⚠️ `authenticated` holds no grant on any table in `timing`, so a verification read left
      // under the impersonated role answers `permission denied`. This file warns about it twice
      // already; this is the third.
      await db.query("select set_config('role', 'postgres', false)");
      await db.query("select set_config('request.jwt.claims', null, false)");
    }
  }

  /**
   * ⚠️ **The whole point of the grant, exercised as `anon` rather than as the owner.** Setting
   * the role is what proves EXECUTE was granted and that USAGE on the schema reaches it — a
   * call made as `postgres` would answer the same `null` or the same rows while saying nothing
   * about whether the internet can make it at all. No `sub` claim, so `auth.uid()` is null and
   * `identity.has_permission()` is false, which is exactly a signed-out visitor.
   */
  async function asAnon(): Promise<ResultsAnswer> {
    await db.query('begin');
    try {
      await db.query("select set_config('role', 'anon', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true)",
      );
      const { rows } = await db.query<{ answer: ResultsAnswer }>(
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      return rows[0]?.answer ?? null;
    } finally {
      await db.query('rollback');
    }
  }

  /**
   * ⚠️ **A role that exists for the length of one transaction and never commits.** The
   * definition of done asks for the refusal to a caller holding `timing.event.manage` but *not*
   * `timing.result.publish`, and **no role in the database is that shape** — `timing-admin` and
   * `src-admin` both hold the two together. Using an existing role would test something weaker:
   * that a marshal is refused, which every block above already proves.
   *
   * So the role is invented inside the same rolled-back transaction as the call. Nothing is
   * committed, so `identity-permissions.test.ts`'s "exactly these roles and permissions"
   * assertion can never see it — which is what makes this safe rather than a second definition
   * of the club's roles living in a test file.
   */
  async function asManageOnly(sql: string, params: unknown[] = []): Promise<Envelope> {
    await db.query('begin');
    try {
      await db.query(
        `insert into identity.roles (slug, description)
         values ('zz-timing-manage-only',
                 'Fixture only, never committed. Runs a race and may not publish it.')`,
      );
      await db.query(
        `insert into identity.role_permissions (role, permission)
         values ('zz-timing-manage-only', 'timing.event.manage')`,
      );
      await db.query(
        `insert into identity.role_grants (person_id, role, granted_by)
         values ($1, 'zz-timing-manage-only', $1)`,
        [MANAGE_ONLY],
      );

      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [MANAGE_ONLY],
      );

      const { rows } = await db.query<{ answer: Envelope }>(sql, params);
      return rows[0]?.answer as Envelope;
    } finally {
      await db.query('rollback');
    }
  }

  async function finishRace(): Promise<void> {
    await db.query(
      "update timing.events set finished_at = '2026-11-01T13:00:00Z' where id = $1",
      [EVENT_ID],
    );
  }

  async function publishedAt(): Promise<{ at: string | null; by: string | null }> {
    const { rows } = await db.query<{
      results_published_at: string | null;
      results_published_by: string | null;
    }>(
      'select results_published_at, results_published_by from timing.events where id = $1',
      [EVENT_ID],
    );

    return {
      at: rows[0]?.results_published_at ?? null,
      by: rows[0]?.results_published_by ?? null,
    };
  }

  async function resetRace(): Promise<void> {
    await db.query(
      `update timing.events
          set finished_at = null, results_published_at = null, results_published_by = null
        where id = $1`,
      [EVENT_ID],
    );
    await db.query('delete from timing.crossings where event_id = $1', [EVENT_ID]);
    await db.query(
      `delete from timing.admin_actions
        where event_id = $1 and action in ('results_published', 'results_unpublished')`,
      [EVENT_ID],
    );
    // One clean capture, matched to the team, resolved by nothing because it never needed to be.
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '601', '2026-11-01T11:40:00Z')`,
      [EVENT_ID],
    );
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [PUBLISHER, 'timing-publish-admin@example.com'],
      [MANAGE_ONLY, 'timing-publish-manage-only@example.com'],
      [PREVIEWER, 'timing-publish-previewer@example.com'],
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
       values ($1, 'timing-admin', $1), ($2, 'nn-results', $2)
       on conflict do nothing`,
      [PUBLISHER, PREVIEWER],
    );

    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query(
      `insert into timing.events (id, slug, name, format, start_at, actually_started_at)
       values ($1, $2, 'Publication Fixture', 'solo', '2026-11-01T11:00:00Z',
               '2026-11-01T11:00:00Z')`,
      [EVENT_ID, SLUG],
    );
    await db.query(
      `insert into timing.teams (id, event_id, team_number) values ($1, $2, '601')`,
      [TEAM_ID, EVENT_ID],
    );
    // ⚠️ An email address and a club on the fixture, deliberately: the leak assertion below is
    // worth nothing against a runner who has neither.
    await db.query(
      `insert into timing.runners
         (team_id, leg, firstname, lastname, gender, email, club_name, age_on_day)
       values ($1, 1, 'Grace', 'Hopper', 'F', 'grace.hopper@example.com',
               'Fixture Harriers', 45)`,
      [TEAM_ID],
    );
    // ⚠️ **A guide on leg 2 of the same team, which is the shape `import_from_entries()`
    // actually produces** — ADR-022 puts a visually impaired runner and their guide on one
    // entry, leg 1 and leg 2. Without a guide in the fixture the assertion below is vacuous,
    // and the disclosure it guards against is invisible to every other test in this file.
    await db.query(
      `insert into timing.runners
         (team_id, leg, firstname, lastname, gender, role, email, club_name, age_on_day)
       values ($1, 2, 'Margaret', 'Hamilton', null, 'guide',
               'margaret.hamilton@example.com', 'Fixture Harriers', 38)`,
      [TEAM_ID],
    );
  });

  beforeEach(resetRace);

  afterAll(async () => {
    await db.query('delete from timing.events where id = $1', [EVENT_ID]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [PUBLISHER, MANAGE_ONLY, PREVIEWER],
    ]);
    await db.query('delete from identity.people where id = any($1::uuid[])', [
      [PUBLISHER, MANAGE_ONLY, PREVIEWER],
    ]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [
      [PUBLISHER, MANAGE_ONLY, PREVIEWER],
    ]);
  });

  describe('what the public may read, and when', () => {
    /**
     * ⚠️ **The assertion the whole rung exists for, and it is the negative one.** A race that
     * has been captured, finished and never published is `null` to the internet;
     * `/nn/<year>/results/` 404s on exactly this answer.
     */
    it('answers null to an anonymous caller while the race is unpublished', async () => {
      expect(await asAnon()).toBeNull();

      // And finishing it changes nothing, which is the half people expect to be wrong.
      await finishRace();
      expect(await asAnon()).toBeNull();
    });

    it('answers the results to an anonymous caller once they are published', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      const results = await asAnon();

      expect(results).not.toBeNull();
      expect(results?.event).toMatchObject({ slug: SLUG, format: 'solo' });
      expect(results?.event.results_published_at).not.toBeNull();
      expect(results?.teams).toHaveLength(1);
      expect(results?.teams[0]?.runners[0]).toMatchObject({
        firstname: 'Grace',
        lastname: 'Hopper',
      });
    });

    /**
     * ⚠️ **Publishing widens the audience and never the answer.** This payload can now reach
     * the internet, so the minimisation assertion that used to protect a preview is protecting
     * a public page — a runner's email address and club are on `timing.runners` and are not
     * facts a results table states.
     */
    it('still carries no email address, no club and no publisher once it is public', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      const text = JSON.stringify(await asAnon());

      expect(text).not.toContain('grace.hopper@example.com');
      expect(text).not.toContain('Fixture Harriers');
      expect(text).not.toMatch(/"email"|"club_name"/);
      // The volunteer who pressed the button is not on a results page either.
      expect(text).not.toContain(PUBLISHER);
      expect(text).not.toMatch(/"results_published_by"/);
    });

    /**
     * ⚠️ **The disclosure #241 opened, closed here** — #242 and
     * [ADR-043](../../../../docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).
     * The grant made this payload reachable with the published anon key, and the payload
     * carried `age_on_day` — an exact age on race day, beside a full name. Nothing on
     * `/nn/<year>/results/` renders it, which is exactly what made it easy to miss.
     *
     * **Withheld by publication rather than by permission**, and the assertion is in two halves
     * because that is the decision: the preview keeps the age, because it exists so somebody
     * can check the data before the internet reads it, and a published race answers the same
     * thing to everybody — which is what lets the page carry a public `Cache-Control` at all.
     *
     * The expected value is read off the fixture row rather than written out, so it goes on
     * meaning something if the fixture's age moves.
     */
    it('withholds the exact age once the results are public, and keeps it in the preview', async () => {
      const { rows } = await db.query<{ age_on_day: number }>(
        'select age_on_day from timing.runners where team_id = $1',
        [TEAM_ID],
      );
      const age = rows[0]?.age_on_day;
      expect(age, 'the fixture runner has no age to withhold').toEqual(
        expect.any(Number),
      );

      const preview = await asPerson<ResultsAnswer>(
        PREVIEWER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(preview?.teams[0]?.runners[0]?.age_on_day).toBe(age);

      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      // The key is still there and it is null — `add_walk_in()` writes a runner with no age,
      // so every reader already handles that and nothing needed a new shape.
      const published = await asAnon();
      expect(published?.teams[0]?.runners[0]).toHaveProperty('age_on_day', null);

      // And a permission holder gets the identical answer, which is the half that makes the
      // page cacheable: two callers, one set of bytes.
      const holderAfter = await asPerson<ResultsAnswer>(
        PREVIEWER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(holderAfter?.teams[0]?.runners[0]?.age_on_day).toBeNull();
    });

    /**
     * **What a category is derived from, which is the opposite direction and is not a
     * widening.** `result_placement` is
     * [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
     * answer and `role` is [ADR-022](../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md)'s;
     * without the first every non-binary runner renders as no category whatever they asked
     * for, and without the second a visually impaired runner's guide lands in a prize band.
     *
     * ⚠️ **`packages/shared/src/timing/rows.ts` declared both on `TimingRunner` before this
     * answer carried either**, which compiled only because `apps/main/worker/nn-results.ts`
     * casts through `unknown` — the mismatch that file's own header warns about.
     */
    it('carries the placement and the role a race category is derived from, before it is public', async () => {
      const runner = (
        await asPerson<ResultsAnswer>(
          PREVIEWER,
          'select timing.results_for_event($1) as answer',
          [SLUG],
        )
      )?.teams[0]?.runners[0];

      expect(runner).toHaveProperty('result_placement', null);
      expect(runner).toHaveProperty('role', 'runner');
    });

    /**
     * ⚠️ **The second disclosure in this payload, and this one is Article 9.**
     * `import_from_entries()` puts a visually impaired runner on **leg 1 and their guide on
     * leg 2 of the same team** — ADR-022. So a published answer saying *"leg 2 is a guide"*
     * says *"leg 1 is visually impaired"* about a named person, to anybody holding the
     * published anon key. That it is an inference rather than a column makes it no less a
     * disclosure of health data, and `/nn/privacy/` publishes results by name, category and
     * time and says nothing about this.
     *
     * **It is the same rule as the age, applied to the field that was left in.** The argument
     * that a public *payload* is not a public *page*, and that the two are judged apart, was
     * made for `age_on_day` and not for this.
     *
     * `gender` and `result_placement` go with it, because a guide's category is suppressed on
     * `role` and taking only `role` away would put a guide who happened to have a gender into
     * a prize band on the published table. The preview keeps all three — it is what
     * `awards.ts` is handed, and excluding a guide from a prize is the whole reason the column
     * exists.
     */
    it('withholds what marks a guide once the results are public, and keeps it in the preview', async () => {
      const guideBefore = (
        await asPerson<ResultsAnswer>(
          PREVIEWER,
          'select timing.results_for_event($1) as answer',
          [SLUG],
        )
      )?.teams[0]?.runners[1];
      expect(guideBefore, 'the fixture has a guide on leg 2').toBeDefined();
      expect(guideBefore).toHaveProperty('role', 'guide');

      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      const published = await asAnon();
      const guide = published?.teams[0]?.runners[1];

      // The guide is still a finisher with a name and a bib — they ran the course and took one
      // of the 250. What is gone is every field that says *which* of the two they are.
      expect(guide).toHaveProperty('firstname', 'Margaret');
      expect(guide).toHaveProperty('role', null);
      expect(guide).toHaveProperty('gender', null);
      expect(guide).toHaveProperty('result_placement', null);

      // ⚠️ The whole payload, not one row: `'guide'` must not appear anywhere in it, which is
      // what catches a future reader adding the marker back somewhere else.
      expect(JSON.stringify(published)).not.toContain('guide');

      // A permission holder gets the identical answer after publication — the property that
      // lets the page be cached publicly at all.
      const holderAfter = await asPerson<ResultsAnswer>(
        PREVIEWER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(holderAfter?.teams[0]?.runners[1]).toHaveProperty('role', null);
    });

    it('returns to null for an anonymous caller when it is unpublished again', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);
      expect(await asAnon()).not.toBeNull();

      expect(
        await asPersonCommitted<Envelope>(
          PUBLISHER,
          'select timing.unpublish_results($1) as answer',
          [SLUG],
        ),
      ).toMatchObject({ ok: true });

      // Back to 404 while a correction is made, which is the honest state for a table somebody
      // is editing.
      expect(await asAnon()).toBeNull();
    });

    it('shows the preview to an nn.results.read holder before publication, and after', async () => {
      const before = await asPerson<ResultsAnswer>(
        PREVIEWER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(before).not.toBeNull();
      expect(before?.event.results_published_at).toBeNull();

      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      const after = await asPerson<ResultsAnswer>(
        PREVIEWER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(after?.event.results_published_at).not.toBeNull();
    });

    it('answers null for a race that does not exist, exactly as it refuses one', async () => {
      // The same bare `null`, so a 404 cannot be told apart from "nothing there".
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'anon', true)");
        const { rows } = await db.query<{ answer: unknown }>(
          'select timing.results_for_event($1) as answer',
          ['zz-timing-no-such-race'],
        );
        expect(rows[0]?.answer).toBeNull();
      } finally {
        await db.query('rollback');
      }
    });
  });

  /**
   * `timing.results_published_at()` — the one bit `/nn/` and `/nn/<year>/` ask before painting
   * a link to this page. #242 and ADR-043.
   *
   * ⚠️ **It is the second `anon`-callable function in this schema**, and the argument for it is
   * that the alternative answers the same one bit by returning every team, every runner and
   * every crossing of a two-hundred-and-fifty runner field — on two pages, for every visitor,
   * on every view. The grant list above is where that decision is actually pinned.
   */
  describe('whether a race is published, for a link to ask about', () => {
    async function publishedAt(slug: string): Promise<string | null> {
      await db.query('begin');

      try {
        await db.query("select set_config('role', 'anon', true)");
        await db.query(
          "select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true)",
        );
        const { rows } = await db.query<{ answer: string | null }>(
          'select timing.results_published_at($1) as answer',
          [slug],
        );
        return rows[0]?.answer ?? null;
      } finally {
        await db.query('rollback');
      }
    }

    /** The negative case, and the one the link rests on: no link before publication. */
    it('answers null to an anonymous caller while the race is unpublished', async () => {
      expect(await publishedAt(SLUG)).toBeNull();

      // Finishing is not publishing, which is the whole of ADR-042 and is where somebody
      // would expect a link to appear if the two were confused.
      await finishRace();
      expect(await publishedAt(SLUG)).toBeNull();
    });

    it('answers the moment it became public once it is published', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      const answered = await publishedAt(SLUG);
      expect(answered).not.toBeNull();

      // The same instant the race itself records, rather than a second clock.
      const { rows } = await db.query<{ results_published_at: Date | null }>(
        'select results_published_at from timing.events where id = $1',
        [EVENT_ID],
      );
      expect(new Date(answered as string).toISOString()).toBe(
        rows[0]?.results_published_at?.toISOString(),
      );
    });

    it('returns to null when the results are withdrawn', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);
      expect(await publishedAt(SLUG)).not.toBeNull();

      await asPersonCommitted(
        PUBLISHER,
        'select timing.unpublish_results($1) as answer',
        [SLUG],
      );

      // The link goes with the page, which is the point: ADR-042 takes the address back to a
      // 404 while a correction is made, and a link left behind would be a claim about a record.
      expect(await publishedAt(SLUG)).toBeNull();
    });

    /**
     * ⚠️ **A race that does not exist and a race that is not published are the same answer.**
     * `results_for_event()` rests on that indistinguishability and so does this: a function
     * that answered differently would let somebody probe which years the club has rows for.
     */
    it('answers null for a race that does not exist, exactly as it does for an unpublished one', async () => {
      expect(await publishedAt('zz-timing-no-such-race')).toBeNull();
      expect(await publishedAt(SLUG)).toBeNull();
    });
  });

  describe('who may publish, and when they are refused', () => {
    it('refuses a race that has not been finished', async () => {
      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'not_finished' });
    });

    it('refuses while a flagged capture is open, and says how many', async () => {
      await finishRace();
      await db.query(
        `insert into timing.crossings
           (event_id, bib, captured_at, anomaly_flag, anomaly_reason)
         values ($1, '601', '2026-11-01T11:41:00Z', true, 'Two taps within a second')`,
        [EVENT_ID],
      );

      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'open_anomalies', open: 1 });
    });

    /**
     * ⚠️ **The parity that keeps two predicates honest.** The refusal is a restatement of
     * `open_anomalies()`'s `where` clause, and a restated rule is the shape `entries` learned
     * to fear. Every row that blocks publication must be a row somebody can open a page and
     * clear — so this asserts both answers about the same crossing rather than the refusal
     * alone.
     */
    it('refuses while an orphan is open, and that orphan is on the triage list', async () => {
      await finishRace();
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, '999', '2026-11-01T11:42:00Z')`,
        [EVENT_ID],
      );

      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'open_anomalies', open: 1 });

      const open = await asPerson<Record<string, unknown>[]>(
        PUBLISHER,
        'select timing.open_anomalies($1) as answer',
        [SLUG],
      );
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ bib: '999', orphan: true });
    });

    /**
     * ⚠️ **The case the literal reading of #241 would have got wrong.** A crossing with no bib
     * at all also has no team, and `open_anomalies()` excludes it deliberately — it is not
     * something an admin can resolve from a desk. If publication refused over one, the triage
     * list would be empty while the button said there were open anomalies, and nobody could
     * clear either.
     */
    it('is not blocked by a capture whose marshal never typed a bib', async () => {
      await finishRace();
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, null, '2026-11-01T11:43:00Z')`,
        [EVENT_ID],
      );

      expect(
        await asPerson<Record<string, unknown>[]>(
          PUBLISHER,
          'select timing.open_anomalies($1) as answer',
          [SLUG],
        ),
      ).toEqual([]);
      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toMatchObject({ ok: true });
    });

    it('is not blocked by an anomaly somebody has already resolved', async () => {
      await finishRace();
      await db.query(
        `insert into timing.crossings
           (event_id, bib, captured_at, anomaly_flag, anomaly_reason,
            resolved_at, resolved_action)
         values ($1, '601', '2026-11-01T11:44:00Z', true, 'Two taps within a second',
                 now(), 'marked_valid')`,
        [EVENT_ID],
      );

      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toMatchObject({ ok: true });
    });

    /**
     * ⚠️ **The permission is the door, and this is what proves it is not the role.** See
     * `asManageOnly` for why the role is invented inside the transaction.
     */
    it('refuses somebody who may run the race but may not publish it', async () => {
      await finishRace();

      expect(
        await asManageOnly('select timing.publish_results($1) as answer', [SLUG]),
      ).toEqual({ ok: false, reason: 'refused' });
      expect(
        await asManageOnly('select timing.unpublish_results($1) as answer', [SLUG]),
      ).toEqual({ ok: false, reason: 'refused' });
    });

    it('refuses somebody who may read the preview but may not publish it', async () => {
      await finishRace();

      // Seeing a result before the public does and deciding the public may see it are two
      // powers, which is why `nn-results` is a role for looking.
      expect(
        await asPerson<Envelope>(
          PREVIEWER,
          'select timing.publish_results($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'refused' });
    });

    /**
     * ⚠️ **One refused call per transaction, and that is not a style choice.** A `42501` from
     * the first call aborts the transaction, so every statement after it — including the
     * second refusal this test is about — comes back `25P02`, *current transaction is
     * aborted*, whatever the grant actually says. Asserted together in one `begin`, the
     * second expectation could never observe the code it names, and would go on failing on
     * a grant that was perfectly correct. Two transactions, one refusal each.
     *
     * This is the general shape of the rule the file already applies everywhere else: assert
     * the **specific** refusal, because a Postgres error is not a refusal — and an aborted
     * transaction refuses everything, which reads as every grant holding at once.
     */
    it('refuses an anonymous caller on the grant, before the permission is asked', async () => {
      for (const call of ['publish_results', 'unpublish_results']) {
        await db.query('begin');
        try {
          await db.query("select set_config('role', 'anon', true)");
          await expect(
            db.query(`select timing.${call}($1)`, [SLUG]),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await db.query('rollback');
        }
      }
    });

    it('refuses a race that does not exist', async () => {
      expect(
        await asPerson<Envelope>(
          PUBLISHER,
          'select timing.publish_results($1) as answer',
          ['zz-timing-no-such-race'],
        ),
      ).toEqual({ ok: false, reason: 'no_such_event' });
    });
  });

  describe('what it writes, and what it says the second time', () => {
    it('records when it was published and who published it', async () => {
      await finishRace();

      const answer = await asPersonCommitted<Envelope>(
        PUBLISHER,
        'select timing.publish_results($1) as answer',
        [SLUG],
      );
      expect(answer).toMatchObject({ ok: true, slug: SLUG });

      const stored = await publishedAt();
      expect(stored.at).not.toBeNull();
      expect(stored.by).toBe(PUBLISHER);
    });

    it('answers the winning time to a second press rather than an error', async () => {
      await finishRace();

      const first = await asPersonCommitted<Envelope>(
        PUBLISHER,
        'select timing.publish_results($1) as answer',
        [SLUG],
      );
      const second = await asPersonCommitted<Envelope>(
        PUBLISHER,
        'select timing.publish_results($1) as answer',
        [SLUG],
      );

      expect(first).toMatchObject({ ok: true });
      // `start_event()` and `finish_event()`'s rule: two devices agree on the moment rather
      // than one of them seeing something that reads as a failure.
      expect(second).toMatchObject({ ok: false, reason: 'already_published' });
      expect(second.results_published_at).toBe(first.results_published_at);
    });

    it('clears both columns on unpublishing, and refuses to unpublish twice', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);
      await asPersonCommitted(
        PUBLISHER,
        'select timing.unpublish_results($1) as answer',
        [SLUG],
      );

      expect(await publishedAt()).toEqual({ at: null, by: null });

      expect(
        await asPersonCommitted<Envelope>(
          PUBLISHER,
          'select timing.unpublish_results($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'not_published' });
    });

    /**
     * ⚠️ **The reversal is audited as loudly as the act**, which is `set_race_status()`'s rule
     * and the old application's mistake: somebody asking why a result they had seen is gone is
     * owed the record of its withdrawal.
     */
    it('audits the publishing and the withdrawal, with the time on both', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);
      const published = await publishedAt();
      await asPersonCommitted(
        PUBLISHER,
        'select timing.unpublish_results($1) as answer',
        [SLUG],
      );

      const { rows } = await db.query<{
        action: string;
        actor_id: string | null;
        detail: Record<string, unknown>;
      }>(
        `select action, actor_id, detail from timing.admin_actions
          where event_id = $1 and action in ('results_published', 'results_unpublished')
          order by created_at`,
        [EVENT_ID],
      );

      expect(rows.map((r) => r.action)).toEqual([
        'results_published',
        'results_unpublished',
      ]);
      expect(rows[0]?.actor_id).toBe(PUBLISHER);
      expect(rows[1]?.actor_id).toBe(PUBLISHER);
      expect(rows[0]?.detail.results_published_at).not.toBeUndefined();
      expect(rows[1]?.detail.was_published_at).not.toBeUndefined();
      expect(published.at).not.toBeNull();
    });

    it('writes no audit row for a refusal', async () => {
      // Nothing happened, so there is nothing to record. `set_race_status()`'s rule about a
      // press that moved nothing, applied to one that was refused.
      await asPerson(PUBLISHER, 'select timing.publish_results($1) as answer', [SLUG]);

      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from timing.admin_actions
          where event_id = $1 and action = 'results_published'`,
        [EVENT_ID],
      );
      expect(rows[0]?.n).toBe('0');
    });
  });

  describe('reopening a race whose results are out', () => {
    /**
     * ⚠️ **The debt #253 left and `20260913240000` deferred to #241 by name.** Reopening clears
     * `finished_at`, and publication was conditional on it being set — so allowing this would
     * produce a race that is published and not finished, a state the state machine has no
     * arrow into. A race whose results are out is reopened by unpublishing first.
     */
    it('refuses to reopen a published race, and says so distinctly', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      expect(
        await asPersonCommitted<Envelope>(
          PUBLISHER,
          'select timing.reopen_event($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'published' });

      // And it really was refused: the race is still finished.
      const { rows } = await db.query<{ finished_at: string | null }>(
        'select finished_at from timing.events where id = $1',
        [EVENT_ID],
      );
      expect(rows[0]?.finished_at).not.toBeNull();
    });

    it('reopens once the results have been withdrawn', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);
      await asPersonCommitted(
        PUBLISHER,
        'select timing.unpublish_results($1) as answer',
        [SLUG],
      );

      expect(
        await asPersonCommitted<Envelope>(
          PUBLISHER,
          'select timing.reopen_event($1) as answer',
          [SLUG],
        ),
      ).toMatchObject({ ok: true });
    });

    it('still answers not_finished for a race that was never finished', async () => {
      // The two refusals are distinct, which is why the guard is checked before the update
      // rather than folded into its `where`.
      expect(
        await asPersonCommitted<Envelope>(
          PUBLISHER,
          'select timing.reopen_event($1) as answer',
          [SLUG],
        ),
      ).toEqual({ ok: false, reason: 'not_finished' });
    });
  });

  describe('the coherence of the pair', () => {
    /**
     * `events_publication_coherent` is one-directional on purpose. `results_published_by` has
     * `on delete set null`, so a volunteer's account going away must not un-publish a race —
     * the results are the club's, not theirs. A `published_by` with no `published_at` is the
     * half that means nothing, and it is refused.
     */
    it('refuses a publisher recorded against a race that is not published', async () => {
      await expect(
        db.query('update timing.events set results_published_by = $2 where id = $1', [
          EVENT_ID,
          PUBLISHER,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('allows a published race whose publisher is no longer known', async () => {
      await finishRace();
      await asPersonCommitted(PUBLISHER, 'select timing.publish_results($1) as answer', [
        SLUG,
      ]);

      await db.query(
        'update timing.events set results_published_by = null where id = $1',
        [EVENT_ID],
      );

      const stored = await publishedAt();
      expect(stored.at).not.toBeNull();
      expect(stored.by).toBeNull();
      // And it is still public, because the results are the club's.
      expect(await asAnon()).not.toBeNull();
    });
  });

  /**
   * The preview a `timing-admin` reads before they press the button —
   * [#205](https://github.com/southville-running-club/src-website/issues/205).
   *
   * ⚠️ **The first assertion is the finding that made this function necessary.** `timing-admin`
   * holds `timing.result.publish` and deliberately **not** `nn.results.read`, so
   * `results_for_event()` answers `null` to the very person the preview screen is for — they
   * would see an empty page and a button offering to publish it. That is asserted here as a
   * pair: the same person, the same race, two functions, two answers.
   *
   * ⚠️ **The second is the disclosure that keeps them two functions.** `role` and
   * `result_placement` are in this answer and must never be in the public one.
   */
  describe('the preview, for somebody who may publish', () => {
    const GUIDE_TEAM_ID = '00000000-0000-4000-8000-000000000f13';

    type Preview = {
      event: Record<string, unknown>;
      open_anomalies: number;
      teams: { team_number: string | null; runners: Record<string, unknown>[] }[];
      crossings: unknown[];
    } | null;

    const preview = (personId: string): Promise<Preview> =>
      asPerson<Preview>(personId, 'select timing.results_preview($1) as answer', [SLUG]);

    beforeAll(async () => {
      // A second team carrying a guide and a non-binary runner's placement, because the two
      // columns this function exists to carry are worth nothing against a fixture without them.
      await db.query(
        `insert into timing.teams (id, event_id, team_number) values ($1, $2, '602')
         on conflict (id) do nothing`,
        [GUIDE_TEAM_ID, EVENT_ID],
      );
      await db.query('delete from timing.runners where team_id = $1', [GUIDE_TEAM_ID]);
      await db.query(
        `insert into timing.runners
           (team_id, leg, firstname, lastname, gender, result_placement, role, age_on_day)
         values ($1, 1, 'Iris', 'Murdoch', 'non_binary', 'female', 'guide', 41)`,
        [GUIDE_TEAM_ID],
      );
    });

    afterAll(async () => {
      await db.query('delete from timing.teams where id = $1', [GUIDE_TEAM_ID]);
    });

    it('answers a publisher, where results_for_event answers them null', async () => {
      // ⚠️ The pair. Same person, same unpublished race, two functions.
      const refused = await asPerson<Preview>(
        PUBLISHER,
        'select timing.results_for_event($1) as answer',
        [SLUG],
      );
      expect(refused).toBeNull();

      const answer = await preview(PUBLISHER);
      expect(answer?.event).toMatchObject({ slug: SLUG, format: 'solo' });
      expect(answer?.teams.map((team) => team.team_number).sort()).toEqual([
        '601',
        '602',
      ]);
    });

    it('carries the role and the placement a prize list needs', async () => {
      const answer = await preview(PUBLISHER);
      const guide = answer?.teams.find((team) => team.team_number === '602')?.runners[0];

      // Without `role`, `awards.ts` cannot exclude a guide and one wins a band — discovered at
      // the presentation. Without `result_placement`, every non-binary runner falls out of both
      // lists, which is the gap ADR-031 closed in `entries` and would silently re-open here.
      expect(guide).toMatchObject({ role: 'guide', result_placement: 'female' });
    });

    it('still carries no email address and no club, exactly like the public answer', async () => {
      const answer = await preview(PUBLISHER);
      const runner = answer?.teams.find((team) => team.team_number === '601')?.runners[0];

      // The fixture runner has both. Minimisation applies to what is read, and a wider audience
      // is not a reason to widen the row.
      expect(runner).not.toHaveProperty('email');
      expect(runner).not.toHaveProperty('club_name');
      expect(JSON.stringify(answer)).not.toContain('grace.hopper@example.com');
    });

    it('counts the captures that will refuse publication, orphans included', async () => {
      expect((await preview(PUBLISHER))?.open_anomalies).toBe(0);

      // ⚠️ **An orphan carries no flag**, so a count of flagged rows alone would say zero here
      // while `publish_results()` refused — the two-screens-both-right failure #241's header
      // describes. This is the assertion that holds them to one expression.
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, '999', '2026-11-01T11:41:00Z')`,
        [EVENT_ID],
      );

      expect((await preview(PUBLISHER))?.open_anomalies).toBe(1);

      const refusal = await asPerson<Envelope>(
        PUBLISHER,
        'select timing.publish_results($1) as answer',
        [SLUG],
      );
      expect(refusal).toMatchObject({ ok: false, reason: 'open_anomalies', open: 1 });
    });

    it('is the same number event_detail reports, which it was not before', async () => {
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, '999', '2026-11-01T11:41:00Z')`,
        [EVENT_ID],
      );

      const detail = await asPerson<{ counts: { open_anomalies: number } }>(
        PUBLISHER,
        'select timing.event_detail($1) as answer',
        [SLUG],
      );

      // ⚠️ `event_detail()` counted only *flagged* rows until #205, so the race hub read 0 here
      // beside a publish button refusing for open anomalies.
      expect(detail.counts.open_anomalies).toBe(1);
    });

    it('refuses somebody who may run the race but not publish it', async () => {
      // ⚠️ **One refused call per transaction** — `asManageOnly` opens its own and rolls it
      // back. The refusal is a bare `null`, like every other read in this schema.
      const answer = await asManageOnly('select timing.results_preview($1) as answer', [
        SLUG,
      ]);

      expect(answer).toBeNull();
    });

    it('refuses a preview-only reader, who has their own page to read', async () => {
      // `nn-results` reads `/nn/<year>/results/` through `results_for_event()`. This function is
      // the staff screen, and it carries two columns that page may not have.
      expect(await preview(PREVIEWER)).toBeNull();
    });

    it('answers the same null for a race that does not exist', async () => {
      // "You may not" and "no such race" stay indistinguishable, which is the property
      // `/timing`'s pages 404 on.
      const answer = await asPerson<Preview>(
        PUBLISHER,
        'select timing.results_preview($1) as answer',
        ['zz-no-such-race'],
      );

      expect(answer).toBeNull();
    });
  });

  /**
   * ⚠️ **The one statement of the predicate is granted to nobody**, like `raise_attention()` one
   * schema along: a function that answers a question about a race nobody may otherwise ask is
   * not a function to expose, and an internal helper with no grant cannot become an oracle. The
   * grant list above is what proves it is absent; this proves the call itself is refused.
   */
  describe('the shared anomaly count', () => {
    it('is refused to an ordinary signed-in caller', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'authenticated', true)");
        await expect(
          db.query('select timing.open_anomaly_count($1)', [EVENT_ID]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await db.query('rollback');
      }
    });
  });
});

/**
 * Wiping a rehearsal — [#254](https://github.com/southville-running-club/src-website/issues/254).
 *
 * ⚠️ **Three assertions here are the ones that matter and none is about the happy path.**
 *
 *   1. **The counts returned are the rows that were actually removed**, asserted against a
 *      fixture holding crossings **both matched and orphaned** — a capture whose bib resolved to
 *      a team, and one whose bib belongs to nobody. The old function deleted teams *before*
 *      crossings, and `crossings.team_id` is `on delete set null`, so it manufactured exactly
 *      the orphans a reset exists to remove. A fixture whose crossings all matched a team would
 *      pass against that bug.
 *   2. **A published race is refused**, and allowed again once it is unpublished. That is the
 *      club's permanent record, and #241 owns the column this reads.
 *   3. **A second call on an empty race returns zeros and still writes its audit row.** The
 *      intent is the auditable fact; *"it turned out to be empty"* is not a reason for somebody
 *      having asked to go unrecorded.
 *
 * ⚠️ **This block cannot pass until #241 has landed.** `timing.events.results_published_at` is
 * that issue's column, and the migration this tests refuses to apply without it — deliberately
 * and loudly, because plpgsql resolves a `%rowtype` field lazily and would otherwise fail in
 * front of a volunteer instead.
 */
describe('wiping a race', () => {
  const MANAGER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaad01';
  const MARSHAL_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaad02';
  const EVENT_ID = '00000000-0000-4000-8000-000000000f11';
  const OTHER_EVENT_ID = '00000000-0000-4000-8000-000000000f12';
  const SLUG = 'zz-timing-reset';
  const OTHER_SLUG = 'zz-timing-reset-bystander';

  const TEAM_NUMBERS = ['601', '602'];
  const MATCHED_BIB = '601';
  /** A bib no team on this race owns, so the trigger resolves `team_id` to null. */
  const ORPHAN_BIB = '999';

  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

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

  /** Committed, because a reset is a thing the next assertion has to be able to see. */
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
      // ⚠️ `authenticated` holds no grant on any table in `timing`, so a verification read left
      // under the impersonated role answers `permission denied`. This file warns about it twice.
      await db.query("select set_config('role', 'postgres', false)");
      await db.query("select set_config('request.jwt.claims', null, false)");
    }
  }

  interface RaceState {
    crossings: number;
    orphanCrossings: number;
    teams: number;
    runners: number;
    marshals: number;
    auditRows: number;
    startedAt: string | null;
    finishedAt: string | null;
  }

  /** What the race holds now — the figures a reset moves, and the ones it must not. */
  async function raceState(eventId: string = EVENT_ID): Promise<RaceState> {
    const one = async (sql: string): Promise<number> => {
      const { rows } = await db.query<{ n: string }>(sql, [eventId]);
      return Number(rows[0]?.n ?? 0);
    };

    const event = await db.query<{
      actually_started_at: string | null;
      finished_at: string | null;
    }>('select actually_started_at, finished_at from timing.events where id = $1', [
      eventId,
    ]);

    return {
      crossings: await one(
        'select count(*) as n from timing.crossings where event_id = $1',
      ),
      orphanCrossings: await one(
        'select count(*) as n from timing.crossings where event_id = $1 and team_id is null',
      ),
      teams: await one('select count(*) as n from timing.teams where event_id = $1'),
      runners: await one(
        `select count(*) as n from timing.runners r
           join timing.teams t on t.id = r.team_id where t.event_id = $1`,
      ),
      marshals: await one(
        'select count(*) as n from timing.marshals where event_id = $1',
      ),
      auditRows: await one(
        'select count(*) as n from timing.admin_actions where event_id = $1',
      ),
      startedAt: event.rows[0]?.actually_started_at ?? null,
      finishedAt: event.rows[0]?.finished_at ?? null,
    };
  }

  /**
   * A race that has been run: two teams with a runner each, three crossings — one matched, one
   * orphaned and one with no bib at all — a rostered marshal, and an audit row from something
   * else somebody did. The last two are what a reset must leave alone.
   *
   * A second race gets exactly the same rows, so the "touches no other race" assertion is
   * comparing against something a wrong `where` clause would plausibly have taken with it.
   */
  async function seedRace(): Promise<void> {
    await db.query('delete from timing.events where id = any($1::uuid[])', [
      [EVENT_ID, OTHER_EVENT_ID],
    ]);

    for (const [id, slug] of [
      [EVENT_ID, SLUG],
      [OTHER_EVENT_ID, OTHER_SLUG],
    ]) {
      await db.query(
        `insert into timing.events
           (id, slug, name, format, start_at, actually_started_at, finished_at)
         values ($1, $2, 'Reset Fixture', 'solo', '2026-11-01T11:00:00Z',
                 '2026-11-01T11:02:00Z', '2026-11-01T13:00:00Z')`,
        [id, slug],
      );

      for (const number of TEAM_NUMBERS) {
        const { rows } = await db.query<{ id: string }>(
          'insert into timing.teams (event_id, team_number) values ($1, $2) returning id',
          [id, number],
        );
        await db.query(
          `insert into timing.runners (team_id, leg, firstname, lastname)
           values ($1, 1, 'Ada', 'Lovelace')`,
          [rows[0]!.id],
        );
      }

      // ⚠️ **Matched, orphaned and bib-less.** The trigger resolves the first to a team and
      // leaves the other two null, which is the population the delete order is about.
      await db.query(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, $2, '2026-11-01T11:40:00Z'),
                ($1, $3, '2026-11-01T11:41:00Z'),
                ($1, null, '2026-11-01T11:42:00Z')`,
        [id, MATCHED_BIB, ORPHAN_BIB],
      );

      await db.query(
        'insert into timing.marshals (event_id, user_id) values ($1, $2) on conflict do nothing',
        [id, MANAGER],
      );
      await db.query(
        `insert into timing.admin_actions (event_id, actor_id, action, detail)
         values ($1, $2, 'race_finished', '{}'::jsonb)`,
        [id, MANAGER],
      );
    }
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [MANAGER, 'timing-reset-manager@example.com'],
      [MARSHAL_ONLY, 'timing-reset-marshal@example.com'],
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
       values ($1, 'timing-admin', $1), ($2, 'timing-marshal', $2)
       on conflict do nothing`,
      [MANAGER, MARSHAL_ONLY],
    );
  });

  beforeEach(seedRace);

  afterAll(async () => {
    await db.query('delete from timing.events where id = any($1::uuid[])', [
      [EVENT_ID, OTHER_EVENT_ID],
    ]);
    await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
    await db.query('delete from identity.people where id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [
      [MANAGER, MARSHAL_ONLY],
    ]);
  });

  describe('the blast radius', () => {
    /**
     * ⚠️ **The fixture holds an orphan on purpose.** The old function deleted teams first, and
     * `crossings.team_id` is `on delete set null` — so it left every capture behind as a bib
     * pointing at nothing. A fixture whose crossings all matched a team would pass against that.
     */
    it('starts with crossings both matched and orphaned', async () => {
      const before = await raceState();

      expect(before.crossings).toBe(3);
      // The bib nobody owns, and the capture with no bib at all.
      expect(before.orphanCrossings).toBe(2);
      expect(before.teams).toBe(2);
      expect(before.runners).toBe(2);
    });

    it('returns counts that match the rows it removed', async () => {
      const before = await raceState();

      const answer = await asPersonCommitted<Envelope>(
        MANAGER,
        'select timing.reset_event($1, $2) as answer',
        [SLUG, SLUG],
      );

      expect(answer).toMatchObject({
        ok: true,
        crossings: before.crossings,
        teams: before.teams,
        runners: before.runners,
      });

      const after = await raceState();
      expect(after.crossings).toBe(0);
      expect(after.teams).toBe(0);
      expect(after.runners).toBe(0);
    });

    /** The second of the old function's two corrections: a wiped race came back still finished. */
    it('clears both the actual start and the finish', async () => {
      await asPersonCommitted(MANAGER, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      const after = await raceState();
      expect(after.startedAt).toBeNull();
      expect(after.finishedAt).toBeNull();
    });

    it('leaves the roster and the audit trail alone', async () => {
      await asPersonCommitted(MANAGER, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      const after = await raceState();
      expect(after.marshals).toBe(1);
      // The seeded row plus the reset's own. Nothing was removed from this table.
      expect(after.auditRows).toBe(2);
    });

    /** Scoped to the race in the address, and to nothing else that happens to be in the schema. */
    it('touches no other race', async () => {
      const before = await raceState(OTHER_EVENT_ID);

      await asPersonCommitted(MANAGER, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      expect(await raceState(OTHER_EVENT_ID)).toEqual(before);
    });

    it('keeps the race itself, because this is a reset rather than a delete', async () => {
      await asPersonCommitted(MANAGER, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      const { rows } = await db.query<{ slug: string; name: string }>(
        'select slug, name from timing.events where id = $1',
        [EVENT_ID],
      );
      expect(rows[0]).toMatchObject({ slug: SLUG, name: 'Reset Fixture' });
    });
  });

  describe('the typed confirmation', () => {
    /**
     * ⚠️ **Checked in the database rather than only on the page.** The typing *is* the modal,
     * and a control only the page enforces is no control at all against a POST that skipped it —
     * which is the class of bypass Slice G found nine of in `entries`.
     *
     * The middle case is the one that decides a rule: `ZZ-TIMING-RESET` is what a phone keyboard
     * offers for a field whose first letter it has capitalised, and it is still refused. The page
     * turns autocapitalise off; accepting it here would make the confirmation weaker than the
     * thing it guards.
     */
    it.each([['zz-timing-rese'], ['ZZ-TIMING-RESET'], ['']])(
      'refuses "%s" with not_confirmed, and removes nothing',
      async (phrase) => {
        expect(
          await asPersonCommitted<Envelope>(
            MANAGER,
            'select timing.reset_event($1, $2) as answer',
            [SLUG, phrase],
          ),
        ).toEqual({ ok: false, reason: 'not_confirmed' });

        const after = await raceState();
        expect(after.crossings).toBe(3);
        expect(after.teams).toBe(2);
      },
    );

    it('refuses a null confirmation rather than raising', async () => {
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, null],
        ),
      ).toEqual({ ok: false, reason: 'not_confirmed' });
    });

    /** A phone keyboard's trailing space is invisible on screen and is not a different phrase. */
    it('accepts the slug with whitespace around it', async () => {
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, `  ${SLUG} `],
        ),
      ).toMatchObject({ ok: true });
    });

    /** Not another race's slug either — the phrase names the race being wiped. */
    it('refuses another race’s slug', async () => {
      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, OTHER_SLUG],
        ),
      ).toEqual({ ok: false, reason: 'not_confirmed' });
    });
  });

  describe('a published race', () => {
    async function publish(at: string | null): Promise<void> {
      await db.query('update timing.events set results_published_at = $2 where id = $1', [
        EVENT_ID,
        at,
      ]);
    }

    /**
     * ⚠️ **The refusal this issue exists to carry.** A published result is the club's permanent
     * record; the way past it is `unpublish_results()`, a separate audited act behind a
     * permission this caller may well not hold.
     */
    it('is refused with published, and keeps every row', async () => {
      await publish('2026-11-02T09:00:00Z');

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, SLUG],
        ),
      ).toEqual({ ok: false, reason: 'published' });

      const after = await raceState();
      expect(after.crossings).toBe(3);
      expect(after.teams).toBe(2);
      expect(after.finishedAt).not.toBeNull();
    });

    /**
     * ⚠️ **Published beats a wrong phrase**, deliberately. Somebody who typed the slug correctly
     * into a published race is owed the reason they can act on, rather than one that sends them
     * back to type it again.
     */
    it('says published rather than not_confirmed when both are true', async () => {
      await publish('2026-11-02T09:00:00Z');

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, 'not-the-slug'],
        ),
      ).toEqual({ ok: false, reason: 'published' });
    });

    it('is allowed again once it is unpublished', async () => {
      await publish('2026-11-02T09:00:00Z');
      await publish(null);

      expect(
        await asPersonCommitted<Envelope>(
          MANAGER,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, SLUG],
        ),
      ).toMatchObject({ ok: true, crossings: 3, teams: 2 });
    });

    it('writes no audit row for the refusal', async () => {
      await publish('2026-11-02T09:00:00Z');
      await asPersonCommitted(MANAGER, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from timing.admin_actions
          where event_id = $1 and action = 'event_reset'`,
        [EVENT_ID],
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });

  describe('doing it twice', () => {
    /**
     * ⚠️ **Zeros and an audit row, which is the pair.** The intent is the auditable fact:
     * somebody typed the slug of a race and asked for it to be wiped, and *"it turned out to be
     * empty"* is not a reason for that to go unrecorded. Two rows an hour apart are the ordinary
     * shape of a rehearsal day.
     */
    it('returns zeros the second time and still audits both', async () => {
      const first = await asPersonCommitted<Envelope>(
        MANAGER,
        'select timing.reset_event($1, $2) as answer',
        [SLUG, SLUG],
      );
      const second = await asPersonCommitted<Envelope>(
        MANAGER,
        'select timing.reset_event($1, $2) as answer',
        [SLUG, SLUG],
      );

      expect(first).toMatchObject({ ok: true, crossings: 3, teams: 2, runners: 2 });
      expect(second).toEqual({
        ok: true,
        slug: SLUG,
        crossings: 0,
        teams: 0,
        runners: 0,
      });

      const { rows } = await db.query<{ detail: { crossings: number } }>(
        `select detail from timing.admin_actions
          where event_id = $1 and action = 'event_reset'
          order by created_at`,
        [EVENT_ID],
      );
      expect(rows.map((r) => r.detail.crossings)).toEqual([3, 0]);
    });
  });

  describe('who may do it', () => {
    it('refuses somebody holding only timing.crossing.record', async () => {
      expect(
        await asPerson<Envelope>(
          MARSHAL_ONLY,
          'select timing.reset_event($1, $2) as answer',
          [SLUG, SLUG],
        ),
      ).toEqual({ ok: false, reason: 'refused' });
    });

    it('leaves every row in place after that refusal', async () => {
      await asPerson(MARSHAL_ONLY, 'select timing.reset_event($1, $2) as answer', [
        SLUG,
        SLUG,
      ]);

      const after = await raceState();
      expect(after.crossings).toBe(3);
      expect(after.teams).toBe(2);
    });

    it('refuses an anonymous caller on the grant, before the permission is asked', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('role', 'anon', true)");
        await expect(
          db.query('select timing.reset_event($1, $2)', [SLUG, SLUG]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await db.query('rollback');
      }
    });

    it('gives a manager the ordinary no_such_event for a slug that names nothing', async () => {
      expect(
        await asPerson<Envelope>(MANAGER, 'select timing.reset_event($1, $2) as answer', [
          'zz-no-such-race',
          'zz-no-such-race',
        ]),
      ).toEqual({ ok: false, reason: 'no_such_event' });
    });
  });
});
