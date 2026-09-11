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

describe('the one read, and who may call it', () => {
  /**
   * `timing.results_for_event()` is the only thing in this schema either role may call — the
   * read behind `/nn/<year>/results/`, which authorises inside itself against
   * `nn.results.read`.
   *
   * ⚠️ **The bib trigger function must not be on this list.** It is reachable from its trigger
   * and nothing else; a grant on it would be a function anybody could call to probe how bibs
   * resolve. The migration that added the read revokes it from both roles defensively, and this
   * is what says that held.
   */
  it('grants exactly one function, results_for_event, and only to authenticated', async () => {
    const { rows } = await db.query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
         from information_schema.role_routine_grants
        where routine_schema = 'timing' and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by routine_name, grantee`,
    );

    expect(rows).toEqual([
      { routine_name: 'results_for_event', grantee: 'authenticated' },
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
    event: { slug: string; format: string };
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
