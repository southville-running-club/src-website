import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The seed, and the boundary around it — tested from **both sides**.
 *
 * A privileged connection checks what is in the table; an anonymous client checks what can
 * be reached through the API. Testing only one side proves half of an access-control
 * question, and the half that matters is usually the other one.
 *
 * The privileged connection is the local Docker Postgres and nothing else. Its credentials
 * are the fixed ones `supabase start` prints on every machine, and there is no version of
 * this file that talks to production.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

afterAll(async () => {
  await connected;
  await db.end();
});

async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql);
  return rows as T[];
}

describe('the seed', () => {
  it('applied, and is the fabricated data rather than anybody real', async () => {
    // Counted by id rather than as `count(*)`, because `nn-interest.test.ts` now writes to
    // this table to prove the anonymous-insert policy works, and the two files can run at
    // the same time. Naming the seven ids says what "the seed applied" actually means and
    // cannot start failing because a sibling test was mid-flight.
    const rows = await query<{ count: string }>(
      `select count(*) from intake.nn_interest
        where id in (
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
          '55555555-5555-4555-8555-555555555555',
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777'
        )`,
    );

    expect(Number(rows[0]?.count)).toBe(7);

    // Every address is at example.com, which the IETF reserves and which cannot receive
    // mail. If this ever fails, real data has reached a laptop.
    const outside = await query(
      "select email from intake.nn_interest where email not like '%@example.com'",
    );
    expect(outside).toEqual([]);
  });

  it('is deterministic, so a test can assert on it', async () => {
    // Fixed UUIDs and fixed timestamps. Random fixtures produce tests that fail on
    // Tuesdays and nobody knows why.
    const rows = await query<{ name: string; created_at: Date }>(
      "select name, created_at from intake.nn_interest where id = '11111111-1111-4111-8111-111111111111'",
    );

    expect(rows[0]?.name).toBe('Alice Fernsby');
    expect(rows[0]?.created_at.toISOString()).toBe('2026-08-01T09:15:00.000Z');
  });

  it('includes the awkward states, because those are what break rendering', async () => {
    const withheld = await query(
      'select 1 from intake.nn_interest where consent = false',
    );
    expect(withheld.length).toBeGreaterThan(0);

    const awkwardNames = await query(
      "select 1 from intake.nn_interest where name like '%''%' or name !~ '^[ -~]*$'",
    );
    expect(awkwardNames.length).toBeGreaterThan(0);
  });

  it('straddles the clocks change, an hour apart and identical on screen', async () => {
    // 25 October 2026. Both render as 01:30 in Europe/London; they are an hour apart in
    // UTC. This is the fixture that makes the timezone bug reproducible.
    const rows = await query<{ created_at: Date }>(
      "select created_at from intake.nn_interest where created_at::date = '2026-10-25' order by created_at",
    );

    expect(rows).toHaveLength(2);
    const gap = rows[1]!.created_at.getTime() - rows[0]!.created_at.getTime();
    expect(gap).toBe(60 * 60 * 1000);
  });
});

describe('the table, and the one door into it', () => {
  it('has row-level security enabled', async () => {
    // From the first migration, with no exceptions. There is no API tier between the
    // browser and Postgres, so this is the access control rather than a layer of it.
    const rows = await query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'intake.nn_interest'::regclass",
    );

    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it('has exactly one policy, and it lets in exactly one verb', async () => {
    // This test used to assert there were *no* policies, because the table was created
    // before anything needed to write to it. The sign-up form is the thing that needed to,
    // and it arrived with the policy in the pull request that could test it — as the
    // original migration said it would.
    //
    // **The assertion is still the same shape: one door, and the count of doors is the
    // thing being watched.** A second policy appearing here means somebody has opened
    // something, and it should have to be argued for in a diff rather than noticed later.
    const policies = await query<{ policyname: string; cmd: string; roles: string }>(
      `select policyname, cmd, roles::text
         from pg_policies
        where schemaname = 'intake' and tablename = 'nn_interest'`,
    );

    expect(policies).toHaveLength(1);
    expect(policies[0]?.cmd).toBe('INSERT');
    expect(policies[0]?.roles).toBe('{anon}');
  });

  it('refuses an anonymous client outright, despite holding seven rows', async () => {
    // The assertion that matters. The rows are demonstrably there — the first test in this
    // file counted them — and an anonymous caller gets none.
    //
    // Note *how* it fails: `42501 permission denied`, not an empty result set. There is no
    // `grant` on this table, so the request is refused before row-level security is even
    // consulted. **Two independent locks**, and the grant is the outer one — worth knowing,
    // because a policy added carelessly later would still not open the table without a
    // grant to go with it.
    const { data, error } = await anon.schema('intake').from('nn_interest').select('*');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  // `'rejects an anonymous insert'` lived here and is **superseded**: an anonymous insert
  // is now the entire point of the table, and the grant and policy that allow it are
  // covered from both sides in `nn-interest.test.ts` — including every verb that is still
  // refused, each asserted by error code.
});

describe('the shape of the table', () => {
  it('holds four columns and an id, and no personal data beyond them', async () => {
    // Adding a column here is a committee decision, not a build decision. If this test
    // fails because somebody added one, that is the test doing its job.
    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'intake' and table_name = 'nn_interest'
       order by column_name`,
    );

    expect(columns.map((c) => c.column_name)).toEqual([
      'consent',
      'created_at',
      'email',
      'id',
      'name',
    ]);
  });

  it('stores one expression of interest per person', async () => {
    // What makes a double-submitted form harmless: the second insert conflicts rather than
    // creating a second row.
    await expect(
      query(
        "insert into intake.nn_interest (name, email, consent) values ('Alice Again', 'ALICE@example.com', true)",
      ),
    ).rejects.toThrow(/duplicate key/i);
  });
});
