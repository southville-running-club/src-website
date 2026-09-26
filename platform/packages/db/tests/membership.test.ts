import { afterAll, describe, expect, it } from 'vitest';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `membership` schema, tested from **both sides**.
 *
 * A privileged connection checks what is actually in the tables; an anonymous client checks
 * what can be reached through the API. There is no tier between a browser and Postgres, so
 * this file *is* the access control being tested rather than a model of it — `entries.test.ts`
 * and `store.test.ts` say the same of themselves, and this is written to earn its keep the
 * same way.
 *
 * Each assertion names the **error code** rather than merely that something failed. A test
 * that passes because a table stopped existing is a test that has quietly stopped testing.
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

async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  await connected;
  const result = await db.query(sql, values);
  return result.rows as T[];
}

afterAll(async () => {
  await connected;
  await db.end();
});

/**
 * Every table in the schema. The refusal tests walk this list rather than naming one of two,
 * so a third table cannot arrive without a decision about its grants.
 *
 * ⚠️ **The one that will hurt is the one that is not here yet.** A `membership_applications`
 * table holds a date of birth, a home address and a phone number, and is a committee decision
 * rather than a build task. When it lands it joins this list, and these refusals are what say
 * the published anon key cannot read it.
 */
const TABLES = ['membership_types', 'settings'] as const;

describe('what an anonymous client may not do, on every table in the schema', () => {
  for (const table of TABLES) {
    it(`cannot select from ${table}`, async () => {
      const { error } = await anon.schema('membership').from(table).select('*').limit(1);

      // **The specific refusal, not merely an error.** PostgREST answers `42501` for a
      // missing privilege; anything else means the grant is not what this test believes.
      expect(error?.code).toBe('42501');
    });

    it(`cannot insert into ${table}`, async () => {
      const { error } = await anon.schema('membership').from(table).insert({});

      expect(error?.code).toBe('42501');
    });
  }
});

describe('exactly which functions exist here, and exactly who may call them', () => {
  /**
   * ⚠️ **The list is the decision.**
   *
   * `CLAUDE.md` makes granting the anon role a function a stop-and-ask, and the way that is
   * enforced is a test naming the current set. `entries.test.ts`'s own count has changed
   * three times — seven, thirteen, fifteen, sixteen — which is the argument for reading the
   * test rather than trusting a number in prose.
   *
   * This schema has **one**. A second is a decision somebody takes in a diff that fails here
   * until they write down what it is for.
   */
  it('has exactly these functions and no others', async () => {
    const rows = await query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'membership'
        order by p.proname, pg_get_function_identity_arguments(p.oid)`,
    );

    expect(rows.map((row) => row.proname)).toEqual([
      // The public read: what membership costs and the minimum age to join. Every row it
      // returns is already printed on the page that calls it.
      'membership_state',
    ]);
  });

  it('grants membership_state to anon and authenticated, and to nobody else', async () => {
    const rows = await query<{ grantee: string }>(
      `select distinct grantee
         from information_schema.role_routine_grants
        where specific_schema = 'membership'
          and routine_name = 'membership_state'
        order by grantee`,
    );

    const grantees = rows.map((row) => row.grantee);

    expect(grantees).toContain('anon');
    expect(grantees).toContain('authenticated');

    // ⚠️ **`public` is the one that matters.** A function is executable by `public` by
    // default, so a migration that grants `anon` without revoking `public` first leaves this
    // file describing less than reality — the grant list would look deliberate while the
    // function was in fact open to every role in the database.
    expect(grantees, 'membership_state is still executable by public').not.toContain(
      'PUBLIC',
    );
  });
});

describe('what the anonymous client may actually read', () => {
  it('can ask what membership costs', async () => {
    const { data, error } = await anon.schema('membership').rpc('membership_state');

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ **These are the club's confirmed prices**, supplied on 21 September 2026: £4 for club
   * membership, £27 for club plus the England Athletics racing licence, of which £23 is
   * England Athletics' registration fee rather than the club's money.
   *
   * Asserted as exact figures because the whole purpose of this table is that they can be
   * changed with a query — and a price the club changes should fail this test loudly, so the
   * person changing it confirms the new number here rather than discovering later that a
   * page and a test disagreed.
   */
  it('answers the prices the club actually charges', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as {
      code: string;
      price_pence: number;
      ea_fee_pence: number | null;
      minimum_age: number;
    }[];

    const club = rows.find((row) => row.code === 'club');
    const clubEa = rows.find((row) => row.code === 'club_ea');

    expect(club?.price_pence).toBe(400);
    expect(club?.ea_fee_pence).toBeNull();

    expect(clubEa?.price_pence).toBe(2700);
    expect(clubEa?.ea_fee_pence).toBe(2300);

    // The £23 is what makes £27 explicable rather than arbitrary: £4 of club membership plus
    // England Athletics' own registration fee.
    expect((clubEa?.price_pence ?? 0) - (clubEa?.ea_fee_pence ?? 0)).toBe(
      club?.price_pence,
    );
  });

  it('answers the same minimum age the race already enforces', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as { minimum_age: number }[];

    for (const row of rows) expect(row.minimum_age).toBe(18);

    // ⚠️ **And it is the same 18.** `entries.events.minimum_age` holds it for Nightingale
    // Nightmare; two numbers for one club rule is two numbers that can drift.
    const [race] = await query<{ minimum_age: number }>(
      `select minimum_age from entries.events where slug = 'nn-2026'`,
    );

    expect(rows[0]?.minimum_age).toBe(race?.minimum_age);
  });

  it('offers options in the order the club chose, and hides a withdrawn one', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as { code: string; sort_order: number }[];

    expect(rows.map((row) => row.code)).toEqual(['club', 'club_ea']);

    // An option is withdrawn by clearing `active`, never by deleting a row somebody has paid
    // against — and a withdrawn option does not come back at all rather than coming back with
    // a flag for the caller to remember to check.
    await query(
      `update membership.membership_types set active = false where code = 'club'`,
    );
    try {
      const { data: after } = await anon.schema('membership').rpc('membership_state');
      expect((after as { code: string }[]).map((row) => row.code)).toEqual(['club_ea']);
    } finally {
      await query(
        `update membership.membership_types set active = true where code = 'club'`,
      );
    }
  });
});

describe('the rules the schema enforces about its own rows', () => {
  it('refuses a second settings row', async () => {
    // A settings table with two rows is one nobody can read confidently, and the failure is
    // silent: a query picks one and the other is ignored.
    await expect(
      query(`insert into membership.settings (id, minimum_age) values (false, 16)`),
    ).rejects.toThrow(/settings_single_row/u);
  });

  it('refuses an England Athletics share larger than the price', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence, ea_fee_pence)
         values ('nonsense', 'Nonsense', 400, 2300)`,
      ),
    ).rejects.toThrow(/membership_types_ea_fee_sane/u);
  });

  it('refuses a negative price', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence)
         values ('cheap', 'Cheap', -1)`,
      ),
    ).rejects.toThrow(/membership_types_price_sane/u);
  });

  it('refuses a code that is not a stable slug', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence)
         values ('Club EA', 'Club EA', 400)`,
      ),
    ).rejects.toThrow(/membership_types_code_shaped/u);
  });

  it('has row-level security on every table, with no policy anywhere', async () => {
    // RLS on from the first migration, no exceptions. The anon role reaches this schema
    // through one function and nothing else, so there is no policy to write.
    const rows = await query<{
      tablename: string;
      rowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname as tablename,
              c.relrowsecurity as rowsecurity,
              coalesce(count(p.polname), 0)::text as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'membership' and c.relkind = 'r'
        group by c.relname, c.relrowsecurity
        order by c.relname`,
    );

    expect(rows.map((row) => row.tablename)).toEqual([...TABLES].sort());
    for (const row of rows) {
      expect(row.rowsecurity, `${row.tablename} has RLS off`).toBe(true);
      expect(row.policies, `${row.tablename} has a policy`).toBe('0');
    }
  });
});

/**
 * ⚠️ **What is deliberately absent, asserted so it stays a decision.**
 *
 * A new member's application holds a date of birth, a home address and a phone number.
 * `CLAUDE.md` is explicit that adding a database column which holds personal data is a
 * committee decision, and neither `/privacy/` nor `/nn/privacy/` currently covers this
 * collection or the England Athletics sharing it involves.
 *
 * This fails the day somebody adds the table, which is the point: it should be added by
 * somebody who has the committee's answer, not by somebody finishing a form.
 */
describe('the applications table, which is not built yet', () => {
  it('does not exist, because storing a member is a committee decision', async () => {
    const rows = await query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'membership' and c.relkind = 'r'
        order by c.relname`,
    );

    expect(rows.map((row) => row.relname)).not.toContain('membership_applications');
  });
});
