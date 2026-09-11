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

  it('is not reachable through PostgREST, because it is not an exposed schema', async () => {
    // Belt to the braces above: `config.toml`'s `[api].schemas` deliberately omits `timing`,
    // so even a grant made in error would have no route. This asserts the grant half.
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
