import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * What a runner's private link may read (brief slice 4, decisions 7 and 8; ADR-068).
 *
 * Every call here goes the way the Worker's does — through PostgREST with the published anon
 * key — because these are the first `photos` functions `anon` may execute, and what is being
 * proved is that the key alone opens nothing: no link, a wrong link, a replaced link and
 * unpublished photos all answer the same `null`.
 *
 * The rows are written the way slice 3 leaves them (ADR-065): a confirmed row is a runner's
 * own photo, an unconfirmed row that is not dismissed is "Could be you", a dismissed row is
 * nobody's, and a photo still waiting to be checked is nobody's yet.
 *
 * These tests commit, so each starts from a cleared `photos` schema. Files in the `db` project
 * run one at a time (`vitest.config.ts`).
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

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  return (await db.query(sql, values)).rows as T[];
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await anon.schema('photos').rpc(name, args);
  expect(error, `${name} answered an error`).toBeNull();
  return data as T;
}

interface Card {
  id: string;
  short_id: string;
  spot: string;
  photographer: string;
  read?: string;
}

interface RunnerPage {
  event_slug: string;
  event_name: string;
  contact: string | null;
  bib: string;
  mine: Card[];
  could_be: Card[];
}

// Two invented runnings of their own, so `nn-2026` is never touched.
const RACE = 'test-photos-runner';
const OTHER_RACE = 'test-photos-runner-other';
const RACE_ID = '7b1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c91';
const OTHER_RACE_ID = '7b1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c92';

// Hashes stand in for tokens: the database only ever sees a hash.
const LINK_125 = 'a'.repeat(64);
const LINK_REPLACED = 'b'.repeat(64);
const LINK_OTHER_RACE = 'c'.repeat(64);

const PHOTO = {
  mine: '00000000-0000-4000-8000-0000000000b1',
  part: '00000000-0000-4000-8000-0000000000b2',
  unsureWhole: '00000000-0000-4000-8000-0000000000b3',
  dismissed: '00000000-0000-4000-8000-0000000000b4',
  hidden: '00000000-0000-4000-8000-0000000000b5',
  waiting: '00000000-0000-4000-8000-0000000000b6',
  someoneElse: '00000000-0000-4000-8000-0000000000b7',
  wrongLength: '00000000-0000-4000-8000-0000000000b8',
  otherRace: '00000000-0000-4000-8000-0000000000b9',
};

async function clearPhotos(): Promise<void> {
  await query('delete from photos.photo_bib');
  await query('delete from photos.decision');
  await query('delete from photos.photo');
  await query('delete from photos.link');
  await query('delete from photos.event');
}

async function photo(
  id: string,
  shortId: string,
  state: string,
  race = RACE,
  hidden = false,
): Promise<void> {
  await query(
    `insert into photos.photo
       (id, event_slug, short_id, photographer, spot, taken_at, width, height, check_state, hidden_at)
     values ($1, $2, $3, 'Adrian', 'Finish', '2026-11-01T11:00:00Z', 2400, 1600, $4,
             case when $5 then now() end)`,
    [id, race, shortId, state, hidden],
  );
}

async function bib(
  photoId: string,
  text: string,
  confirmed: boolean,
  options: { dismissed?: boolean; decided?: boolean } = {},
): Promise<void> {
  await query(
    `insert into photos.photo_bib
       (photo_id, bib_text, confidence, confirmed, source, decided_at, dismissed)
     values ($1, $2, 0.9, $3, 'model', case when $4 then now() end, $5)`,
    [
      photoId,
      text,
      confirmed,
      options.decided === true || options.dismissed === true,
      options.dismissed === true,
    ],
  );
}

async function seed(published: boolean, linksSent = false): Promise<void> {
  await query(
    `insert into photos.event (slug, published_at, links_sent_at)
     values ($1, case when $2 then now() end, case when $3 then now() end),
            ($4, now(), now())`,
    [RACE, published, linksSent, OTHER_RACE],
  );

  // A runner's own photo, and a photo of somebody else.
  await photo(PHOTO.mine, 'TR26-0001', 'tagged');
  await bib(PHOTO.mine, '125', true);
  await photo(PHOTO.someoneElse, 'TR26-0007', 'tagged');
  await bib(PHOTO.someoneElse, '128', true);

  // Could be you: a part read kept on the laptop, and an unsure whole read kept as such.
  await photo(PHOTO.part, 'TR26-0002', 'checked');
  await bib(PHOTO.part, '12?', false, { decided: true });
  await photo(PHOTO.unsureWhole, 'TR26-0003', 'checked');
  await bib(PHOTO.unsureWhole, '125', false, { decided: true });

  // Nobody's: a read set aside, a photo taken down, a photo still on the check queue, and a
  // part read of a different length.
  await photo(PHOTO.dismissed, 'TR26-0004', 'checked');
  await bib(PHOTO.dismissed, '12?', false, { dismissed: true });
  await photo(PHOTO.hidden, 'TR26-0005', 'tagged', RACE, true);
  await bib(PHOTO.hidden, '125', true);
  await photo(PHOTO.waiting, 'TR26-0006', 'needs_check');
  await bib(PHOTO.waiting, '125', false);
  await photo(PHOTO.wrongLength, 'TR26-0008', 'checked');
  await bib(PHOTO.wrongLength, '1?', false, { decided: true });

  // The same bib in another running.
  await photo(PHOTO.otherRace, 'TO26-0001', 'tagged', OTHER_RACE);
  await bib(PHOTO.otherRace, '125', true);

  await query(
    `insert into photos.link (token_hash, event_slug, bib, replaced_at)
     values ($1, $4, '125', null),
            ($2, $4, '128', now()),
            ($3, $5, '125', null)`,
    [LINK_125, LINK_REPLACED, LINK_OTHER_RACE, RACE, OTHER_RACE],
  );
}

beforeAll(async () => {
  await connected;
  await query(
    `insert into timing.events (id, slug, name, format, start_at)
     values ($1, $2, 'Photos runner fixture', 'solo', '2026-11-01T11:00:00Z'),
            ($3, $4, 'Photos runner fixture, other', 'solo', '2026-11-01T11:00:00Z')
     on conflict (slug) do nothing`,
    [RACE_ID, RACE, OTHER_RACE_ID, OTHER_RACE],
  );
});

afterAll(async () => {
  await connected;
  await clearPhotos();
  await query('delete from timing.events where slug = any($1::text[])', [
    [RACE, OTHER_RACE],
  ]);
  await db.end();
});

beforeEach(clearPhotos);

describe('a runner page, for a link', () => {
  it('shows their own photos and the ones that could be them, and nothing else', async () => {
    await seed(true);

    const page = await call<RunnerPage>('runner_photos', {
      p_event_slug: RACE,
      p_token_hash: LINK_125,
    });

    expect(page.bib).toBe('125');
    expect(page.event_name).toBe('Photos runner fixture');
    expect(page.mine.map((card) => card.short_id)).toEqual(['TR26-0001']);
    expect(page.could_be.map((card) => [card.short_id, card.read])).toEqual([
      ['TR26-0002', '12?'],
      ['TR26-0003', '125'],
    ]);
  });

  it('carries a photo, its spot and its credit, and no other runner’s bib', async () => {
    await seed(true);

    const page = await call<RunnerPage>('runner_photos', {
      p_event_slug: RACE,
      p_token_hash: LINK_125,
    });

    expect(Object.keys(page.mine[0]!).sort()).toEqual(
      ['height', 'id', 'photographer', 'short_id', 'spot', 'taken_at', 'width'].sort(),
    );
    expect(JSON.stringify(page)).not.toContain('128');
  });

  it('answers nothing until the photos are published', async () => {
    await seed(false);

    expect(
      await call('runner_photos', { p_event_slug: RACE, p_token_hash: LINK_125 }),
    ).toBeNull();
  });

  it('answers the same nothing to a replaced link, an unknown one and a malformed one', async () => {
    await seed(true);

    for (const hash of [LINK_REPLACED, 'd'.repeat(64), 'not-a-hash', '']) {
      expect(
        await call('runner_photos', { p_event_slug: RACE, p_token_hash: hash }),
        hash,
      ).toBeNull();
    }
  });

  it('answers nothing to a link from another running at this running’s address', async () => {
    await seed(true);

    expect(
      await call('runner_photos', { p_event_slug: RACE, p_token_hash: LINK_OTHER_RACE }),
    ).toBeNull();
  });
});

describe('one photo, for a link', () => {
  it('opens a runner’s own photo and a could-be-you one, saying which', async () => {
    await seed(true);

    const own = await call<{ mine: boolean; photo: Card }>('runner_photo', {
      p_event_slug: RACE,
      p_token_hash: LINK_125,
      p_short_id: 'tr26-0001',
    });
    const maybe = await call<{ mine: boolean; photo: Card }>('runner_photo', {
      p_event_slug: RACE,
      p_token_hash: LINK_125,
      p_short_id: 'TR26-0002',
    });

    expect(own.mine).toBe(true);
    expect(own.photo.id).toBe(PHOTO.mine);
    expect(maybe.mine).toBe(false);
  });

  it('will not open a photo that link’s page does not show', async () => {
    await seed(true);

    for (const shortId of [
      'TR26-0007',
      'TR26-0004',
      'TR26-0005',
      'TR26-0006',
      'TO26-0001',
    ]) {
      expect(
        await call('runner_photo', {
          p_event_slug: RACE,
          p_token_hash: LINK_125,
          p_short_id: shortId,
        }),
        shortId,
      ).toBeNull();
    }
  });
});

describe('whether an image may be served', () => {
  it('serves a published photo that is not taken down, in its own running', async () => {
    await seed(true);

    expect(
      await call('servable_photo', { p_event_slug: RACE, p_photo_id: PHOTO.someoneElse }),
    ).toEqual({ short_id: 'TR26-0007' });
  });

  it('serves nothing before publishing, once taken down, or at another running’s address', async () => {
    await seed(false);
    expect(
      await call('servable_photo', { p_event_slug: RACE, p_photo_id: PHOTO.mine }),
    ).toBeNull();

    await clearPhotos();
    await seed(true);
    expect(
      await call('servable_photo', { p_event_slug: RACE, p_photo_id: PHOTO.hidden }),
    ).toBeNull();
    expect(
      await call('servable_photo', { p_event_slug: RACE, p_photo_id: PHOTO.otherRace }),
    ).toBeNull();
  });
});

describe('whether the photos are out', () => {
  it('is true only once they are published and the links have gone', async () => {
    await seed(true, false);
    expect(await call('photos_ready', { p_event_slug: RACE })).toBe(false);

    await query('update photos.event set links_sent_at = now() where slug = $1', [RACE]);
    expect(await call('photos_ready', { p_event_slug: RACE })).toBe(true);
  });

  it('is false for a running with no photos at all', async () => {
    expect(await call('photos_ready', { p_event_slug: 'no-such-running' })).toBe(false);
  });
});

describe('who may call them', () => {
  it('lets a signed-in person call none of the four, which only anon needs', async () => {
    const rows = await query<{ name: string; authenticated: boolean; anon: boolean }>(
      `select p.proname as name,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'photos'
          and p.proname in ('runner_photos', 'runner_photo', 'servable_photo', 'photos_ready')
        order by p.proname`,
    );

    expect(rows.every((row) => row.anon && !row.authenticated)).toBe(true);
    expect(rows).toHaveLength(4);
  });
});
