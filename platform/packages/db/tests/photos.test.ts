import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `photos` schema: tables only the SQL editor and the schema's own functions can write.
 *
 * Race photos arrive from the laptop tool as a SQL file a volunteer runs by hand (brief §2
 * decision 6). The website reaches them only through functions, each with its own grant:
 * the shared check page's since slice 3 (`photos-check.test.ts`), and the runners' pages and
 * private links in the slices after. The assertion that matters here is the negative one: no
 * role a browser can reach holds anything on a table, though the schema is exposed through
 * PostgREST since slice 3.
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
    it(`cannot read ${table} through the API, because nothing grants it`, async () => {
      const { error } = await anon.schema('photos').from(table).select('*').limit(1);

      // 42501: PostgREST routes the request since the check page exposed the schema, and
      // Postgres refuses it. It was PGRST106 until then — no route at all — which proved less:
      // a refusal that only happens because nothing can get as far as asking is not one.
      expect(error?.code).toBe('42501');
    });

    it(`cannot write ${table} through the API either`, async () => {
      const { error } = await anon.schema('photos').from(table).insert({});

      expect(error?.code).toBe('42501');
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

/**
 * The SQL file the laptop writes (`tools/photos/racephotos/sqlfile.py`), run here for real.
 *
 * `fixtures/photos-golden.sql` is that writer's output for six invented photos, and the
 * tool's own test fails if the writer stops producing exactly this text. So this is the
 * other half of one contract: the file applies cleanly, a second run changes nothing at all,
 * and nothing in it overwrites what the team decided on the website (brief §8).
 *
 * These tests commit, unlike the ones above, so they clear the schema before each and after
 * the last, and they run last in this file for that reason.
 */
const GOLDEN = readFileSync(
  fileURLToPath(new URL('./fixtures/photos-golden.sql', import.meta.url)),
  'utf8',
);
const CHECKER = '6a0b2c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

async function clearPhotos(): Promise<void> {
  await query('delete from photos.photo_bib');
  await query('delete from photos.photo');
  await query('delete from photos.link');
  await query('delete from photos.event');
  await query('delete from auth.users where id = $1', [CHECKER]);
}

async function snapshot(): Promise<{ photos: unknown[]; bibs: unknown[] }> {
  return {
    photos: await query('select * from photos.photo order by short_id'),
    bibs: await query(
      'select * from photos.photo_bib order by photo_id, bib_text collate "C"',
    ),
  };
}

async function photoId(shortId: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    'select id from photos.photo where short_id = $1',
    [shortId],
  );
  return row!.id;
}

describe("the laptop's SQL file", () => {
  beforeEach(clearPhotos);
  afterAll(clearPhotos);

  it('applies to an empty schema and holds what was sent', async () => {
    await query(GOLDEN);

    const photos = await query<{
      short_id: string;
      photographer: string;
      check_state: string;
    }>('select short_id, photographer, check_state from photos.photo order by short_id');
    expect(photos).toEqual([
      { short_id: 'NN26-0001', photographer: 'Adrian', check_state: 'tagged' },
      { short_id: 'NN26-0002', photographer: 'Adrian', check_state: 'part_read' },
      { short_id: 'NN26-0003', photographer: "Ross O'Neill", check_state: 'checked' },
      { short_id: 'NN26-0004', photographer: "Ross O'Neill", check_state: 'no_bib_seen' },
      { short_id: 'NN26-0006', photographer: "Ross O'Neill", check_state: 'needs_check' },
    ]);

    const bibs = await query<{ bib_text: string; confirmed: boolean }>(
      'select bib_text, confirmed from photos.photo_bib order by bib_text collate "C"',
    );
    expect(bibs).toEqual([
      { bib_text: '0311', confirmed: true },
      { bib_text: '125', confirmed: true },
      { bib_text: '12?', confirmed: false },
      { bib_text: '999', confirmed: false },
    ]);
  });

  it('changes nothing at all when it is run a second time, not even updated_at', async () => {
    await query(GOLDEN);
    const first = await snapshot();
    await query(GOLDEN);

    expect(await snapshot()).toEqual(first);
  });

  it('never overwrites a decision made on the website, or a takedown', async () => {
    await query(GOLDEN);
    await query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', 'photo-checker@example.com', 'not-a-password', now(), now(), now())`,
      [CHECKER],
    );
    const two = await photoId('NN26-0002');

    // On the website: a checker settles NN26-0002 as 121 and keeps the part read as decided,
    // and NN26-0004 is taken down.
    await query(
      `update photos.photo set check_state = 'checked', checked_by = $1, checked_at = now()
        where short_id = 'NN26-0002'`,
      [CHECKER],
    );
    await query(
      `insert into photos.photo_bib (photo_id, bib_text, confirmed, source, decided_by, decided_at)
       values ($1, '121', true, 'person', $2, now())`,
      [two, CHECKER],
    );
    await query(
      `update photos.photo_bib set decided_by = $1, decided_at = now()
        where photo_id = $2 and bib_text = '12?'`,
      [CHECKER, two],
    );
    await query(`update photos.photo set hidden_at = now() where short_id = 'NN26-0004'`);
    const decided = await snapshot();

    await query(GOLDEN);

    expect(await snapshot()).toEqual(decided);
  });
});
