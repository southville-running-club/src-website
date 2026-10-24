import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The shared check page's functions (race photos brief, slice 3; ADR-065 and ADR-066).
 *
 * The brief's tests for this slice, at the layer that enforces them: two checkers asking at
 * the same moment get different photos; a hold past ten minutes frees its photo; a decision
 * records who made it, a repeat changes nothing and an undo restores what was there; publish
 * refuses while anything is left to check; and a decision made here survives the laptop's SQL
 * file being run again.
 *
 * The signed-in callers are written into `auth.users` directly and presented to Postgres the
 * way PostgREST presents them — `role` and `request.jwt.claims` set for the transaction —
 * which is `store.test.ts`'s pattern and its reasoning: what is under test is
 * `identity.has_permission()` inside a `security definer` function, not the sign-in flow.
 *
 * **These tests commit**, because a hold has to outlive the call that took it, so every test
 * starts from a cleared schema. Files in the `db` project run one at a time
 * (`vitest.config.ts`), so `photos.test.ts` clearing the same tables cannot race this one.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const db = new Client({ connectionString: LOCAL_DB });
// A second connection, for the one test that needs two transactions open at once.
const other = new Client({ connectionString: LOCAL_DB });
const connected = Promise.all([db.connect(), other.connect()]);

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  return (await db.query(sql, values)).rows as T[];
}

// Invented people. The address domain is example.com, as every fixture here is.
const CHECKER_A = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c01';
const CHECKER_B = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c02';
const PHOTO_ADMIN = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c03';
const NOBODY = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c04';
const DIRECTOR = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c05';
const PEOPLE = [CHECKER_A, CHECKER_B, PHOTO_ADMIN, NOBODY, DIRECTOR];

// An invented running of its own, so the bibs a part read fits are this file's to choose and
// `nn-2026`'s roster is left alone. The laptop-file test below uses `nn-2026`, because the
// golden file names it.
const RACE = 'test-photos-check-2026';
const RACE_ID = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c99';
const WORN = ['120', '125', '128', '130', '1250'];

const ID = {
  early: '00000000-0000-4000-8000-0000000000a1',
  part: '00000000-0000-4000-8000-0000000000a2',
  late: '00000000-0000-4000-8000-0000000000a3',
  tagged: '00000000-0000-4000-8000-0000000000a4',
  hidden: '00000000-0000-4000-8000-0000000000a5',
};

/** Call one function as somebody, in a transaction of its own that commits. */
async function as<T = Record<string, unknown>>(
  person: string,
  sql: string,
  values: unknown[] = [],
  client: Client = db,
): Promise<T> {
  await connected;
  await client.query('begin');
  try {
    await client.query("select set_config('role', 'authenticated', true)");
    await client.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [person],
    );
    const rows = (await client.query(sql, values)).rows as Record<string, T>[];
    await client.query('commit');
    return Object.values(rows[0] ?? {})[0] as T;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

interface Answer {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

interface Checking {
  id: string;
  short_id: string;
  reads: { bib_text: string; confirmed: boolean }[];
  candidates: string[];
  held_until: string;
}

async function next(person: string, client: Client = db): Promise<Checking | null> {
  const answer = await as<{ ok: boolean; photo: Checking | null }>(
    person,
    'select photos.next_photo()',
    [],
    client,
  );
  expect(answer.ok).toBe(true);
  return answer.photo;
}

function decide(
  person: string,
  photo: string,
  action: string,
  bibs: string[] | null = null,
): Promise<Answer> {
  return as<Answer>(person, 'select photos.decide($1, $2, $3)', [photo, action, bibs]);
}

async function stateOf(photo: string): Promise<Record<string, unknown>> {
  const [row] = await query<{ state: Record<string, unknown> }>(
    'select photos.photo_state($1) as state',
    [photo],
  );
  return row!.state;
}

async function clearPhotos(): Promise<void> {
  await query('delete from photos.photo_bib');
  await query('delete from photos.decision');
  await query('delete from photos.photo');
  await query('delete from photos.link');
  await query('delete from photos.event');
}

async function seedRace(): Promise<void> {
  await query(`insert into photos.event (slug) values ($1)`, [RACE]);
  await query(
    `insert into photos.photo
       (id, event_slug, short_id, photographer, spot, taken_at, width, height, check_state, hidden_at)
     values
       ($1, $6, 'TP26-0001', 'Adrian', 'Finish', '2026-11-01T11:00:00Z', 2400, 1600, 'needs_check', null),
       ($2, $6, 'TP26-0002', 'Adrian', 'Finish', '2026-11-01T11:05:00Z', 2400, 1600, 'part_read', null),
       ($3, $6, 'TP26-0003', 'Ross', 'Hill', '2026-11-01T11:10:00Z', 2400, 1600, 'needs_check', null),
       ($4, $6, 'TP26-0004', 'Ross', 'Hill', '2026-11-01T10:00:00Z', 2400, 1600, 'tagged', null),
       ($5, $6, 'TP26-0005', 'Ross', 'Hill', '2026-11-01T09:00:00Z', 2400, 1600, 'needs_check', now())`,
    [ID.early, ID.part, ID.late, ID.tagged, ID.hidden, RACE],
  );
  await query(
    `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
     values ($1, '125', 0.610, false, 'model'),
            ($2, '12?', 0.900, false, 'model'),
            ($3, '130', 0.550, false, 'model'),
            ($4, '0311', 0.970, true, 'model'),
            ($5, '120', 0.500, false, 'model')`,
    [ID.early, ID.part, ID.late, ID.tagged, ID.hidden],
  );
}

beforeAll(async () => {
  await connected;

  for (const [index, person] of PEOPLE.entries()) {
    await query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, 'not-a-password', now(), now(), now())
       on conflict (id) do nothing`,
      [person, `photos-check-${index}@example.com`],
    );
  }

  for (const [person, role] of [
    [CHECKER_A, 'nn-photo-checker'],
    [CHECKER_B, 'nn-photo-checker'],
    [PHOTO_ADMIN, 'nn-photo-admin'],
    [DIRECTOR, 'src-admin'],
  ] as const) {
    await query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, $2, $1) on conflict do nothing`,
      [person, role],
    );
  }

  await query(
    `insert into timing.events (id, slug, name, format, start_at)
     values ($1, $2, 'Photos check fixture', 'solo', '2026-11-01T11:00:00Z')
     on conflict (slug) do nothing`,
    [RACE_ID, RACE],
  );
  for (const bib of WORN) {
    const [team] = await query<{ id: string }>(
      `insert into timing.teams (event_id, team_number) values ($1, $2) returning id`,
      [RACE_ID, bib],
    );
    await query(
      `insert into timing.runners (team_id, leg, firstname, lastname)
       values ($1, 1, 'Fixture', 'Runner')`,
      [team!.id],
    );
  }
});

afterAll(async () => {
  await connected;
  await clearPhotos();
  await query('delete from timing.events where slug = $1', [RACE]);
  await query('delete from identity.role_grants where person_id = any($1::uuid[])', [
    PEOPLE,
  ]);
  await query('delete from auth.users where id = any($1::uuid[])', [PEOPLE]);
  await db.end();
  await other.end();
});

beforeEach(async () => {
  await clearPhotos();
  await seedRace();
});

describe('who may call what', () => {
  it('refuses every function to a signed-in person holding no photo role', async () => {
    for (const sql of [
      'select photos.next_photo()',
      `select photos.decide('${ID.early}', 'skip')`,
      `select photos.undo_decision('${ID.early}')`,
      'select photos.progress()',
      `select photos.publish('${RACE}')`,
      `select photos.take_down('${RACE}', 'TP26-0001')`,
      `select photos.photo_for_admin_image('${ID.early}')`,
    ]) {
      expect(await as<Answer>(NOBODY, sql), sql).toMatchObject({
        ok: false,
        reason: 'refused',
      });
    }
  });

  it('keeps the queue and the unpublished images from a photo-admin, who does not check', async () => {
    for (const sql of [
      'select photos.next_photo()',
      `select photos.decide('${ID.early}', 'confirm', array['125'])`,
      `select photos.photo_for_admin_image('${ID.early}')`,
    ]) {
      expect(await as<Answer>(PHOTO_ADMIN, sql), sql).toMatchObject({
        ok: false,
        reason: 'refused',
      });
    }
  });

  it('keeps publishing from a checker, who does not publish', async () => {
    expect(await as<Answer>(CHECKER_A, `select photos.publish('${RACE}')`)).toMatchObject(
      {
        ok: false,
        reason: 'refused',
      },
    );
  });

  it('lets anon call none of them', async () => {
    // One call per request, so each refusal is its own transaction (CLAUDE.md).
    for (const [name, args] of [
      ['next_photo', {}],
      ['decide', { p_photo_id: ID.early, p_action: 'skip' }],
      ['undo_decision', { p_photo_id: ID.early }],
      ['progress', {}],
      ['publish', { p_event_slug: RACE }],
      ['take_down', { p_event_slug: RACE, p_short_id: 'TP26-0001' }],
      ['photo_for_admin_image', { p_photo_id: ID.early }],
    ] as const) {
      const { error } = await anon.schema('photos').rpc(name, args);
      expect(error?.code, name).toBe('42501');
    }
  });

  it('lets a director do all of it, as src-admin holds the four', async () => {
    expect(await next(DIRECTOR)).not.toBeNull();
    expect(await as<Answer>(DIRECTOR, 'select photos.progress()')).toMatchObject({
      ok: true,
    });
  });
});

describe('the queue', () => {
  it('hands out the earliest unsure photo and holds it for ten minutes', async () => {
    const photo = await next(CHECKER_A);

    // TP26-0005 is earlier and hidden, TP26-0004 is earlier and tagged: neither is unsure.
    expect(photo?.short_id).toBe('TP26-0001');

    const [row] = await query<{ held_by: string; minutes: number }>(
      `select held_by, round(extract(epoch from held_until - now()) / 60)::int as minutes
         from photos.photo where id = $1`,
      [ID.early],
    );
    expect(row).toEqual({ held_by: CHECKER_A, minutes: 10 });
  });

  it('gives the same photo back on a reload rather than a second one', async () => {
    const first = await next(CHECKER_A);
    const again = await next(CHECKER_A);

    expect(again?.id).toBe(first?.id);
  });

  it('gives two checkers asking at the same moment two different photos', async () => {
    // Checker A's transaction is still open — the moment the row is locked — when checker B
    // asks. `skip locked` is what sends B past it rather than waiting for it.
    await connected;
    await db.query('begin');
    await db.query("select set_config('role', 'authenticated', true)");
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [CHECKER_A],
    );
    const forA = (await db.query('select photos.next_photo() as answer')).rows[0]
      .answer as {
      photo: Checking;
    };

    const forB = await next(CHECKER_B, other);
    await db.query('commit');

    expect(forA.photo.id).not.toBe(forB?.id);
    expect([forA.photo.short_id, forB?.short_id].sort()).toEqual([
      'TP26-0001',
      'TP26-0002',
    ]);
  });

  it('frees a photo whose hold ran out for the next checker', async () => {
    await next(CHECKER_A);
    await query(
      `update photos.photo set held_until = now() - interval '1 second' where id = $1`,
      [ID.early],
    );

    expect((await next(CHECKER_B))?.id).toBe(ID.early);
  });

  it('does not hand out a photo somebody else holds', async () => {
    await next(CHECKER_A);

    expect((await next(CHECKER_B))?.id).not.toBe(ID.early);
  });

  it('puts a photo this checker skipped behind the others, and releases it', async () => {
    const photo = await next(CHECKER_A);
    expect(await decide(CHECKER_A, photo!.id, 'skip')).toMatchObject({ ok: true });

    const [held] = await query<{ held_by: string | null }>(
      'select held_by from photos.photo where id = $1',
      [photo!.id],
    );
    expect(held?.held_by).toBeNull();
    expect((await next(CHECKER_A))?.id).not.toBe(photo!.id);
  });

  it('answers no photo once there is nothing left to check', async () => {
    for (const id of [ID.early, ID.late]) {
      await decide(CHECKER_A, id, 'no_bib');
    }
    await decide(CHECKER_A, ID.part, 'keep_part');

    expect(await next(CHECKER_A)).toBeNull();
  });

  it('offers the bibs a part read fits, from the race roster, and nothing else', async () => {
    await query(
      `update photos.photo set held_by = $1, held_until = now() + interval '10 minutes'
                  where id <> $2`,
      [CHECKER_B, ID.part],
    );

    const photo = await next(CHECKER_A);

    expect(photo?.id).toBe(ID.part);
    // `12?` fits 120, 125 and 128 — the same length — and not 130 or 1250.
    expect(photo?.candidates).toEqual(['120', '125', '128']);
  });
});

describe('a decision', () => {
  it('records who made it, and settles the photo as the chosen bib', async () => {
    expect(await decide(CHECKER_A, ID.early, 'confirm', ['125'])).toEqual({
      ok: true,
      action: 'confirm',
    });

    const [photo] = await query<{
      check_state: string;
      checked_by: string;
      held_by: unknown;
    }>('select check_state, checked_by, held_by from photos.photo where id = $1', [
      ID.early,
    ]);
    expect(photo).toEqual({
      check_state: 'checked',
      checked_by: CHECKER_A,
      held_by: null,
    });

    const bibs = await query(
      `select bib_text, confirmed, dismissed, source, decided_by from photos.photo_bib
        where photo_id = $1 order by bib_text collate "C"`,
      [ID.early],
    );
    expect(bibs).toEqual([
      {
        bib_text: '125',
        confirmed: true,
        dismissed: false,
        source: 'person',
        decided_by: CHECKER_A,
      },
    ]);
  });

  it('sets a read aside rather than deleting it when a different bib is chosen', async () => {
    await decide(CHECKER_A, ID.part, 'correct', ['125']);

    const bibs = await query(
      `select bib_text, confirmed, dismissed, decided_by from photos.photo_bib
        where photo_id = $1 order by bib_text collate "C"`,
      [ID.part],
    );
    expect(bibs).toEqual([
      { bib_text: '125', confirmed: true, dismissed: false, decided_by: CHECKER_A },
      { bib_text: '12?', confirmed: false, dismissed: true, decided_by: CHECKER_A },
    ]);
  });

  it('keeps a part read as "could be you", decided but never confirmed', async () => {
    expect(await decide(CHECKER_A, ID.part, 'keep_part')).toMatchObject({ ok: true });

    const [bib] = await query(
      `select confirmed, dismissed, decided_by from photos.photo_bib where photo_id = $1`,
      [ID.part],
    );
    expect(bib).toEqual({ confirmed: false, dismissed: false, decided_by: CHECKER_A });
    const [photo] = await query<{ check_state: string }>(
      'select check_state from photos.photo where id = $1',
      [ID.part],
    );
    expect(photo?.check_state).toBe('part_read');
  });

  it('refuses to keep a part read on a photo that has none', async () => {
    expect(await decide(CHECKER_A, ID.early, 'keep_part')).toEqual({
      ok: false,
      reason: 'nothing_part_read',
    });
  });

  it('changes nothing when the same decision is made again', async () => {
    await decide(CHECKER_A, ID.early, 'confirm', ['125']);
    const settled = await stateOf(ID.early);

    expect(await decide(CHECKER_A, ID.early, 'confirm', ['125'])).toEqual({
      ok: true,
      action: 'confirm',
      unchanged: true,
    });
    expect(await stateOf(ID.early)).toEqual(settled);

    const [count] = await query<{ n: string }>(
      `select count(*) as n from photos.decision where photo_id = $1 and action = 'confirm'`,
      [ID.early],
    );
    expect(count?.n).toBe('1');
  });

  it('tells a second checker the photo was decided first, and changes nothing', async () => {
    await decide(CHECKER_A, ID.early, 'confirm', ['125']);
    const settled = await stateOf(ID.early);

    expect(await decide(CHECKER_B, ID.early, 'no_bib')).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    expect(await stateOf(ID.early)).toEqual(settled);
  });

  it('refuses a photo the laptop already tagged, and one that has been taken down', async () => {
    expect(await decide(CHECKER_A, ID.tagged, 'no_bib')).toEqual({
      ok: false,
      reason: 'not_waiting',
    });
    expect(await decide(CHECKER_A, ID.hidden, 'no_bib')).toEqual({
      ok: false,
      reason: 'no_such_photo',
    });
  });

  it('refuses a bib that is not a bib', async () => {
    expect(await decide(CHECKER_A, ID.early, 'correct', ['12a'])).toEqual({
      ok: false,
      reason: 'invalid_bib',
    });
    expect(await decide(CHECKER_A, ID.early, 'correct', ['  '])).toEqual({
      ok: false,
      reason: 'bib_required',
    });
  });
});

describe('undo', () => {
  it('restores exactly what was there, and gives the photo back to the checker', async () => {
    const before = await stateOf(ID.part);
    await decide(CHECKER_A, ID.part, 'correct', ['125']);

    expect(
      await as<Answer>(CHECKER_A, 'select photos.undo_decision($1)', [ID.part]),
    ).toEqual({
      ok: true,
      action: 'correct',
    });
    expect(await stateOf(ID.part)).toEqual(before);
    expect((await next(CHECKER_A))?.id).toBe(ID.part);
  });

  it('is only the person who made the decision', async () => {
    await decide(CHECKER_A, ID.early, 'no_bib');

    expect(
      await as<Answer>(CHECKER_B, 'select photos.undo_decision($1)', [ID.early]),
    ).toEqual({
      ok: false,
      reason: 'not_yours',
    });
  });

  it('refuses once anything about the photo has changed since', async () => {
    await decide(CHECKER_A, ID.early, 'no_bib');
    await query(`update photos.photo_bib set confidence = 0.700 where photo_id = $1`, [
      ID.early,
    ]);

    expect(
      await as<Answer>(CHECKER_A, 'select photos.undo_decision($1)', [ID.early]),
    ).toEqual({
      ok: false,
      reason: 'changed_since',
    });
  });

  it('lets the same decision be made again after it is undone', async () => {
    await decide(CHECKER_A, ID.early, 'no_bib');
    await as(CHECKER_A, 'select photos.undo_decision($1)', [ID.early]);

    expect(await decide(CHECKER_A, ID.early, 'confirm', ['125'])).toEqual({
      ok: true,
      action: 'confirm',
    });
  });
});

describe('publishing', () => {
  it('is refused while anything is left to check, and says how much', async () => {
    expect(await as<Answer>(PHOTO_ADMIN, `select photos.publish('${RACE}')`)).toEqual({
      ok: false,
      reason: 'left_to_check',
      left: 3,
    });

    const [event] = await query<{ published_at: unknown }>(
      'select published_at from photos.event where slug = $1',
      [RACE],
    );
    expect(event?.published_at).toBeNull();
  });

  it('goes ahead once every unsure photo is decided, and records who', async () => {
    await decide(CHECKER_A, ID.early, 'confirm', ['125']);
    await decide(CHECKER_A, ID.part, 'keep_part');
    await decide(CHECKER_A, ID.late, 'no_bib');

    expect(
      await as<Answer>(PHOTO_ADMIN, `select photos.publish('${RACE}')`),
    ).toMatchObject({
      ok: true,
      already: false,
    });
    const [event] = await query<{ published_by: string }>(
      'select published_by from photos.event where slug = $1',
      [RACE],
    );
    expect(event?.published_by).toBe(PHOTO_ADMIN);

    expect(
      await as<Answer>(PHOTO_ADMIN, `select photos.publish('${RACE}')`),
    ).toMatchObject({
      ok: true,
      already: true,
    });
  });

  it('counts the same photos the queue does', async () => {
    const progress = await as<{ ok: boolean; events: Record<string, unknown>[] }>(
      PHOTO_ADMIN,
      'select photos.progress()',
    );

    expect(progress.events.find((event) => event.slug === RACE)).toMatchObject({
      photos: 4,
      hidden: 1,
      tagged: 1,
      left_to_check: 3,
      checked_here: 0,
    });
  });
});

describe('taking a photo down', () => {
  it('hides it at once and answers where its copies are', async () => {
    expect(
      await as<Answer>(CHECKER_A, `select photos.take_down($1, $2)`, [
        RACE,
        ' tp26-0003 ',
      ]),
    ).toEqual({
      ok: true,
      id: ID.late,
      event_slug: RACE,
      short_id: 'TP26-0003',
      already: false,
    });

    expect(
      await as<Answer>(CHECKER_A, 'select photos.photo_for_admin_image($1)', [ID.late]),
    ).toEqual({ ok: false, reason: 'no_such_photo' });
  });

  it('answers the id again for a photo already down, so a failed deletion can be finished', async () => {
    await as(PHOTO_ADMIN, `select photos.take_down($1, 'TP26-0003')`, [RACE]);

    expect(
      await as<Answer>(PHOTO_ADMIN, `select photos.take_down($1, 'TP26-0003')`, [RACE]),
    ).toMatchObject({ ok: true, id: ID.late, already: true });
  });

  it('answers nothing for a short ID the running does not have', async () => {
    expect(
      await as<Answer>(CHECKER_A, `select photos.take_down($1, 'TP26-9999')`, [RACE]),
    ).toEqual({ ok: false, reason: 'no_such_photo' });
  });
});

/**
 * The laptop's SQL file, run again after a real decision on the website. `photos.test.ts`
 * proves the file leaves a *simulated* decision alone; this proves it of `decide()` itself, so
 * the marking-not-deleting rule in the migration's header is what is being tested.
 */
describe("a decision made here, and the laptop's SQL file run again", () => {
  const GOLDEN = readFileSync(
    fileURLToPath(new URL('./fixtures/photos-golden.sql', import.meta.url)),
    'utf8',
  );

  it('survives the file, bib rows and all', async () => {
    await query(GOLDEN);
    const [part] = await query<{ id: string }>(
      `select id from photos.photo where short_id = 'NN26-0002'`,
    );
    const [unsure] = await query<{ id: string }>(
      `select id from photos.photo where short_id = 'NN26-0006'`,
    );

    await decide(CHECKER_A, part!.id, 'correct', ['121']);
    await decide(CHECKER_A, unsure!.id, 'no_bib');
    const decided = [await stateOf(part!.id), await stateOf(unsure!.id)];

    await query(GOLDEN);

    expect([await stateOf(part!.id), await stateOf(unsure!.id)]).toEqual(decided);
  });
});
