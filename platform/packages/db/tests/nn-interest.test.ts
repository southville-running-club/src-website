import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The grant and the policy that let the sign-up form write, tested from **both sides**.
 *
 * A privileged connection checks what actually landed in the table; an anonymous client
 * checks what can be reached through the API. There is no tier between a browser and
 * Postgres, so this file *is* the access control being tested rather than a model of it. A
 * mock would test the mock.
 *
 * **The negative cases are the ones that matter.** That a sign-up inserts proves the form
 * works; that the same client cannot then read, change or remove the list proves the club
 * has not published its members' addresses to anyone holding the anon key — which is
 * published in client code by design. Every one of them asserts the **error code**, not
 * merely that something failed: a test that passes because the table stopped existing is a
 * test that has quietly stopped testing.
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

/**
 * Invented people at `example.com`, which the IETF reserves and which cannot receive mail.
 * Every address this file writes is listed here, and every one is removed afterwards — the
 * seed's own seven rows are what `seed.test.ts` asserts on, and a test that leaves litter
 * behind makes another test fail somewhere else.
 */
const WRITTEN = [
  'hopper@example.com',
  'lovelace@example.com',
  'withheld@example.com',
] as const;

afterAll(async () => {
  await connected;
  await db.query('delete from intake.nn_interest where email = any($1::text[])', [
    [...WRITTEN],
  ]);
  await db.end();
});

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

function table() {
  return anon.schema('intake').from('nn_interest');
}

describe('what an anonymous client may now do', () => {
  it('adds one expression of interest', async () => {
    const { error } = await table().insert({
      name: 'Grace Hopper',
      email: 'hopper@example.com',
      consent: true,
    });

    expect(error).toBeNull();
  });

  it('creates exactly one row, holding exactly the four expected fields', async () => {
    // The definition-of-done item, checked from the privileged side because the anonymous
    // one deliberately cannot look. Four columns and an id: adding a fifth is a committee
    // decision, and `seed.test.ts` fails separately if one appears.
    const rows = await query<Record<string, unknown>>(
      'select * from intake.nn_interest where email = $1',
      ['hopper@example.com'],
    );

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'consent',
      'created_at',
      'email',
      'id',
      'name',
    ]);
    expect(rows[0]!.name).toBe('Grace Hopper');
    expect(rows[0]!.consent).toBe(true);
  });

  it('gets an id and a timestamp it did not supply', async () => {
    // Both are the database's, which is why the grant does not name either column.
    const rows = await query<{ id: string; created_at: Date }>(
      'select id, created_at from intake.nn_interest where email = $1',
      ['hopper@example.com'],
    );

    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(Date.now() - rows[0]!.created_at.getTime())).toBeLessThan(60_000);
  });

  it('still stores a withheld consent, so the decision stays reversible', async () => {
    // The policy is deliberately silent about consent: `consent` is `not null` and `false`
    // is a legitimate stored value. **The form is what currently requires the box to be
    // ticked, not the database** — so if the committee decides an unconsented submission
    // should be kept, that is two lines of TypeScript and no migration at all. This test is
    // what proves the migration is not quietly in the way of that.
    const { error } = await table().insert({
      name: 'Cerys Withheld',
      email: 'withheld@example.com',
      consent: false,
    });

    expect(error).toBeNull();
    const rows = await query('select 1 from intake.nn_interest where consent = false');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('what it must never be able to do', () => {
  // **The most important assertions in the sign-up work.** The anon key is public and
  // appears in client code; if any of these four starts passing, the club's interest list
  // is readable, editable or deletable by anybody who can open the page source.

  it('cannot read the list back', async () => {
    const { data, error } = await table().select('*');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('cannot read back even the row it just wrote', async () => {
    // Narrower than the test above and worth having separately: "I only want *my* row" is
    // the reasonable-sounding request that would open the whole table.
    const { data, error } = await table().select('*').eq('email', 'hopper@example.com');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('cannot change a row', async () => {
    const { error } = await table()
      .update({ name: 'Someone Else' })
      .eq('email', 'hopper@example.com');

    expect(error?.code).toBe('42501');
    // And nothing changed.
    const rows = await query<{ name: string }>(
      'select name from intake.nn_interest where email = $1',
      ['hopper@example.com'],
    );
    expect(rows[0]!.name).toBe('Grace Hopper');
  });

  it('cannot delete a row', async () => {
    const { error } = await table().delete().eq('email', 'hopper@example.com');

    expect(error?.code).toBe('42501');
    const rows = await query('select 1 from intake.nn_interest where email = $1', [
      'hopper@example.com',
    ]);
    expect(rows).toHaveLength(1);
  });

  it('cannot ask for the row back as part of inserting it', async () => {
    // `insert().select()` is the idiom somebody reaches for by habit, and it needs a select
    // grant. It fails, which is why `worker/nn-signup.ts` deliberately does not chain one —
    // and why that is a comment there rather than a thing to rediscover.
    const { error } = await table()
      .insert({ name: 'Ada Lovelace', email: 'lovelace@example.com', consent: true })
      .select();

    expect(error?.code).toBe('42501');
  });

  it('cannot choose its own id', async () => {
    // The grant names three columns. `id` is not one of them, so a caller cannot overwrite
    // an existing row by guessing a primary key, and cannot pick a memorable one either.
    const { error } = await table().insert({
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Id Chooser',
      email: 'idchooser@example.com',
      consent: true,
    });

    expect(error?.code).toBe('42501');
  });

  it('cannot back-date a submission', async () => {
    // `created_at` is not in the grant either. A sign-up cannot claim to have arrived
    // before an entry window opened, which is the version of this that would matter once
    // there is anything to be first in a queue for.
    const { error } = await table().insert({
      name: 'Time Traveller',
      email: 'backdater@example.com',
      consent: true,
      created_at: '2020-01-01T00:00:00Z',
    });

    expect(error?.code).toBe('42501');
  });
});

describe('what the policy itself refuses', () => {
  it('rejects a name that is only whitespace', async () => {
    // The policy's `with check` mirrors the table's own constraint, so a row that would
    // violate the constraint is refused by row-level security first. Postgres reports an
    // RLS refusal as `42501` as well — the message is what tells the two apart, and both
    // are a refusal rather than a stored row, which is the part that matters.
    const { error } = await table().insert({
      name: '   ',
      email: 'whitespace@example.com',
      consent: true,
    });

    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/row-level security/i);
  });

  it('rejects an address with no @ in it', async () => {
    const { error } = await table().insert({
      name: 'No Atsign',
      email: 'notanaddress',
      consent: true,
    });

    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/row-level security/i);
  });

  it('rejects a name longer than the column allows', async () => {
    const { error } = await table().insert({
      name: 'a'.repeat(101),
      email: 'toolong@example.com',
      consent: true,
    });

    expect(error?.code).toBe('42501');
  });
});

describe('one person, one expression of interest', () => {
  it('conflicts on a second submission of the same address', async () => {
    const { error } = await table().insert({
      name: 'Grace Again',
      email: 'hopper@example.com',
      consent: true,
    });

    // 23505, not 42501: the write was permitted and the *index* refused it. That
    // distinction is what lets the Worker treat this as success — the person did the right
    // thing twice and the outcome they wanted is already true.
    expect(error?.code).toBe('23505');
  });

  it('conflicts whatever the case, because the index is on lower(email)', async () => {
    const { error } = await table().insert({
      name: 'Grace Shouting',
      email: 'HOPPER@EXAMPLE.COM',
      consent: true,
    });

    expect(error?.code).toBe('23505');
  });

  it('leaves exactly one row behind after all of that', async () => {
    const rows = await query('select 1 from intake.nn_interest where lower(email) = $1', [
      'hopper@example.com',
    ]);

    expect(rows).toHaveLength(1);
  });
});

describe('the grant, read straight from the catalogue', () => {
  it('is insert only, on exactly three columns', async () => {
    // Asserted against `information_schema` rather than inferred from behaviour above, so
    // the shape of the grant is written down somewhere a reviewer can check in one place.
    // If `select` ever appears in this list, the interest list is public.
    const granted = await query<{ privilege_type: string; column_name: string }>(
      `select privilege_type, column_name
         from information_schema.column_privileges
        where grantee = 'anon'
          and table_schema = 'intake'
          and table_name = 'nn_interest'
        order by privilege_type, column_name`,
    );

    expect(granted).toEqual([
      { privilege_type: 'INSERT', column_name: 'consent' },
      { privilege_type: 'INSERT', column_name: 'email' },
      { privilege_type: 'INSERT', column_name: 'name' },
    ]);
  });

  it('gives the anon role nothing at table level', async () => {
    const tableWide = await query<{ privilege_type: string }>(
      `select privilege_type
         from information_schema.table_privileges
        where grantee = 'anon'
          and table_schema = 'intake'
          and table_name = 'nn_interest'`,
    );

    // A table-level insert grant would cover every column including `id` and `created_at`,
    // which is precisely what the column-scoped form exists to avoid.
    expect(tableWide).toEqual([]);
  });
});
