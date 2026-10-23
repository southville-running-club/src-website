import { afterAll, describe, expect, it } from 'vitest';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `photos` schema, as slice 2 leaves it: four tables that only the SQL editor can write.
 *
 * Race photos arrive from the laptop tool as a SQL file a volunteer runs by hand (brief §2
 * decision 6). Nothing on the website reads or writes here until the slices that build the
 * check page, the runners' pages and the private links add their own functions, each with
 * its own grants. Until then the assertion that matters is the negative one: no role a
 * browser can reach holds anything, and the schema is not exposed through PostgREST at all.
 *
 * Each refusal names its **error code**, for the reason `membership.test.ts` gives: a test
 * that passes because a table stopped existing has stopped testing.
 *
 * The privileged connection is the local Docker Postgres and nothing else.
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
 * Every table in the schema. The checks below walk this list, and one of them fails if the
 * schema holds a table that is not on it, so a fifth table cannot arrive without a decision
 * about who may reach it.
 */
const TABLES = ['event', 'link', 'photo', 'photo_bib'] as const;

// Invented, fixed values. `nn-2026` is the one running `timing.events` holds on every machine.
const EVENT = 'nn-2026';
const PHOTO = '6f1d2c3b-4a59-4e6f-8a7b-1c2d3e4f5a6b';
const HASH = 'a'.repeat(64);

const insertEvent = `insert into photos.event (slug) values ('${EVENT}')`;
const insertPhoto = `insert into photos.photo (id, event_slug, short_id, photographer, spot, width, height, check_state)
     values ('${PHOTO}', '${EVENT}', 'NN26-0001', 'Adrian', 'Finish', 2400, 1600, 'tagged')`;
const setup = [insertEvent, insertPhoto];

/**
 * Runs `statements` in a transaction that is always rolled back, and answers the error code
 * of the last one, or null if every statement succeeded. One refusal per transaction, because
 * a refused statement aborts the transaction and every later one would answer `25P02`
 * whatever it did (CLAUDE.md).
 */
async function attempt(statements: string[]): Promise<string | null> {
  await connected;
  await db.query('begin');
  try {
    for (const statement of statements) {
      await db.query(statement);
    }
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await db.query('rollback');
  }
}

describe('what nobody a browser can be may do', () => {
  for (const table of TABLES) {
    it(`cannot reach ${table} through the API, because the schema is not exposed`, async () => {
      const { error } = await anon.schema('photos').from(table).select('*').limit(1);

      // PGRST106: PostgREST has no route to the schema at all. The later slices expose it,
      // and from then this becomes 42501 — the grant refusing rather than the route missing.
      expect(error?.code).toBe('PGRST106');
    });

    it(`grants anon and authenticated nothing on ${table}`, async () => {
      const rows = await query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege, has_table_privilege(role, 'photos.' || $1, privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'])
                  as privilege`,
        [table],
      );

      expect(rows.filter((row) => row.held)).toEqual([]);
    });
  }
});

describe('the shape of the schema', () => {
  it('has exactly these tables, each with row-level security on', async () => {
    const rows = await query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'photos' and c.relkind = 'r'
        order by c.relname`,
    );

    expect(rows.map((row) => row.relname)).toEqual([...TABLES].sort());
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('has no policy on any table, which is what the refusals rest on', async () => {
    const rows = await query(
      `select polname from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'photos'`,
    );

    expect(rows).toEqual([]);
  });

  /**
   * ⚠️ **The list is the decision**, as `membership.test.ts` says of its own. Slice 2 adds no
   * function. Each later slice adds its own here, with what it is for and who may call it, in
   * the same diff as the grant.
   */
  it('has no functions yet', async () => {
    const rows = await query(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'photos'`,
    );

    expect(rows).toEqual([]);
  });
});

describe('what the SQL file may write, and what it may not', () => {
  it('accepts a photo, a confirmed bib, a part read and an active link', async () => {
    // The positive case, so the refusals below are refusing something real.
    expect(
      await attempt([
        ...setup,
        `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
           values ('${PHOTO}', '0311', 0.97, true, 'model')`,
        `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
           values ('${PHOTO}', '12?', 0.95, false, 'model')`,
        `insert into photos.link (token_hash, event_slug, bib) values ('${HASH}', '${EVENT}', '0311')`,
      ]),
    ).toBeNull();
  });

  it('refuses a running that is not in timing.events', async () => {
    expect(await attempt([`insert into photos.event (slug) values ('nn-1999')`])).toBe(
      '23503',
    );
  });

  it('refuses a short ID in any other shape', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.photo (id, event_slug, short_id, photographer, spot, width, height, check_state)
           values ('${PHOTO}', '${EVENT}', 'nn26-1', 'Adrian', 'Finish', 2400, 1600, 'tagged')`,
      ]),
    ).toBe('23514');
  });

  it('refuses a short ID given twice in one running', async () => {
    expect(
      await attempt([
        ...setup,
        `insert into photos.photo (id, event_slug, short_id, photographer, spot, width, height, check_state)
           values (gen_random_uuid(), '${EVENT}', 'NN26-0001', 'Ross', 'Start', 2400, 1600, 'tagged')`,
      ]),
    ).toBe('23505');
  });

  it('refuses a check state it does not know', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.photo (id, event_slug, short_id, photographer, spot, width, height, check_state)
           values ('${PHOTO}', '${EVENT}', 'NN26-0001', 'Adrian', 'Finish', 2400, 1600, 'maybe')`,
      ]),
    ).toBe('23514');
  });

  it('refuses half a hold', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.photo (id, event_slug, short_id, photographer, spot, width, height, check_state, held_until)
           values ('${PHOTO}', '${EVENT}', 'NN26-0001', 'Adrian', 'Finish', 2400, 1600, 'tagged', now())`,
      ]),
    ).toBe('23514');
  });

  it('refuses a bib that is not digits and question marks', async () => {
    expect(
      await attempt([
        ...setup,
        `insert into photos.photo_bib (photo_id, bib_text, confirmed, source)
           values ('${PHOTO}', 'Ada', false, 'model')`,
      ]),
    ).toBe('23514');
  });

  it('refuses a part read that claims to be confirmed', async () => {
    // ADR-058: a part read is never anybody's own until a person confirms a whole bib.
    expect(
      await attempt([
        ...setup,
        `insert into photos.photo_bib (photo_id, bib_text, confirmed, source)
           values ('${PHOTO}', '12?', true, 'person')`,
      ]),
    ).toBe('23514');
  });

  it('refuses a confidence outside 0 to 1', async () => {
    expect(
      await attempt([
        ...setup,
        `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
           values ('${PHOTO}', '125', 1.5, true, 'model')`,
      ]),
    ).toBe('23514');
  });

  it('refuses a second active link for one bib', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.link (token_hash, event_slug, bib) values ('${HASH}', '${EVENT}', '125')`,
        `insert into photos.link (token_hash, event_slug, bib) values ('${'b'.repeat(64)}', '${EVENT}', '125')`,
      ]),
    ).toBe('23505');
  });

  it('allows a new link once the old one is replaced', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.link (token_hash, event_slug, bib, replaced_at)
           values ('${HASH}', '${EVENT}', '125', now())`,
        `insert into photos.link (token_hash, event_slug, bib) values ('${'b'.repeat(64)}', '${EVENT}', '125')`,
      ]),
    ).toBeNull();
  });

  it('refuses anything but a SHA-256 hex digest where a token would be', async () => {
    expect(
      await attempt([
        insertEvent,
        `insert into photos.link (token_hash, event_slug, bib) values ('a-real-looking-token', '${EVENT}', '125')`,
      ]),
    ).toBe('23514');
  });
});
