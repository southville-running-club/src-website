import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * Emailing each runner their link, and a new one when they ask (race photos brief, slice 5;
 * ADR-069).
 *
 * The brief's tests for this slice at the layer that enforces them: sending is
 * role-gated and idempotent; the drain keeps the first links inside the daily limit and sends
 * the new ones first; a link becomes the runner's only once its email has gone; and the
 * lost-link request answers the same whatever it is given.
 *
 * **Every call a runner's browser or the Worker would make goes through PostgREST as `anon`**,
 * with the published key, because that is the role that would be attacked. Assertions name the
 * reason or the error code, never merely that something failed (CLAUDE.md).
 *
 * ## The field
 *
 * An invented running, `test-photos-links-2026`, with its own timing roster and its own
 * entries record, so `nn-2026` is left alone:
 *
 *   * **201** — a runner on a paid entry, with two photos of their own and one taken down;
 *   * **202** — a visually impaired runner on a paid entry, and their guide on **9202**, who
 *     wears a number of their own (ADR-061) and has an address of their own (ADR-022);
 *   * **203** — a runner whose entry was refunded, so there is nobody to email;
 *   * **204** — a walk-in, who gave no address;
 *   * **205** — a runner on a paid entry whose only photo is a part read, so no first link.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/** `seed.sql`'s local strings. Fake, and refused by every real digest. */
const ENTRY_KEY = 'zz-photos-entry-key-not-a-real-one';
const WEBHOOK_KEY = 'zz-photos-webhook-key-not-a-real-one';

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

const PHOTO_ADMIN = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c01';
const CHECKER = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c02';
const NOBODY = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c03';
const DIRECTOR = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c04';
const PEOPLE = [PHOTO_ADMIN, CHECKER, NOBODY, DIRECTOR];

const RACE = 'test-photos-links-2026';
const TIMING_ID = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c90';
const ENTRIES_ID = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5c91';
const REPLY_TO = 'photo-links-fixture@example.com';

const ADDRESS = {
  201: 'links-runner-201@example.com',
  202: 'links-runner-202@example.com',
  9202: 'links-guide-9202@example.com',
  203: 'links-runner-203@example.com',
  205: 'links-runner-205@example.com',
} as const;

const PURCHASE = {
  201: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5d01',
  202: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5d02',
  203: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5d03',
  205: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5d05',
} as const;

const PHOTO = {
  first201: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e01',
  second201: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e02',
  hidden201: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e03',
  runnerAndGuide: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e04',
  refunded: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e05',
  walkIn: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e06',
  partRead: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b5e07',
} as const;

function hashOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A hash for a token nobody will ever type — the drain's half, played by the test. */
function hashFor(label: string): string {
  return hashOf(`photos-links-test-token-${label}`);
}

/** Call one function as somebody, in a transaction of its own that commits. */
async function as<T = Record<string, unknown>>(
  person: string,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  await connected;
  await db.query('begin');
  try {
    await db.query("select set_config('role', 'authenticated', true)");
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [person],
    );
    const rows = (await db.query(sql, values)).rows as Record<string, T>[];
    await db.query('commit');
    return Object.values(rows[0] ?? {})[0] as T;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

interface Answer {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

interface Message {
  id: string;
  reason: string;
  event_slug: string;
  event_name: string;
  bib: string;
  recipient: string;
  reply_to: string | null;
  photo_count: number;
  attempts: number;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await anon.schema('photos').rpc(name, args);
  if (error !== null) throw new Error(`${name}: ${error.code} ${error.message}`);
  return data as T;
}

async function claim(limit = 10, key = WEBHOOK_KEY): Promise<Message[]> {
  const answer = await rpc<Answer & { messages?: Message[] }>('claim_outbox_batch', {
    p_key: key,
    p_limit: limit,
  });
  expect(answer.ok).toBe(true);
  return answer.messages ?? [];
}

function record(
  id: string,
  outcome: { sent: boolean; hash?: string; rateLimited?: boolean; error?: string },
): Promise<Answer> {
  return rpc<Answer>('record_send_result', {
    p_key: WEBHOOK_KEY,
    p_id: id,
    p_sent: outcome.sent,
    ...(outcome.hash === undefined ? {} : { p_token_hash: outcome.hash }),
    ...(outcome.error === undefined ? {} : { p_error: outcome.error }),
    p_rate_limited: outcome.rateLimited ?? false,
  });
}

function requestLink(email: string, key = ENTRY_KEY): Promise<Answer> {
  return rpc<Answer>('request_link', { p_key: key, p_event_slug: RACE, p_email: email });
}

function sendLinks(person: string): Promise<Answer> {
  return as<Answer>(person, 'select photos.send_links($1)', [RACE]);
}

async function outbox(): Promise<
  { bib: string; reason: string; status: string; attempts: number }[]
> {
  return query(
    `select bib, reason, status, attempts from photos.email_outbox
      where event_slug = $1 order by bib, reason, created_at`,
    [RACE],
  );
}

async function publish(): Promise<void> {
  await query(`update photos.event set published_at = now() where slug = $1`, [RACE]);
}

async function linksSent(): Promise<void> {
  await query(
    `update photos.event set published_at = now(), links_sent_at = now() where slug = $1`,
    [RACE],
  );
}

async function runnerPage(hash: string): Promise<{ mine: unknown[] } | null> {
  return rpc<{ mine: unknown[] } | null>('runner_photos', {
    p_event_slug: RACE,
    p_token_hash: hash,
  });
}

async function seed(): Promise<void> {
  await query(
    `insert into timing.events (id, slug, name, format, start_at)
     values ($1, $2, 'Photo links fixture 2026', 'solo', '2026-11-01T11:00:00Z')`,
    [TIMING_ID, RACE],
  );

  await query(
    `insert into entries.events (
       id, slug, display_name, event_date, start_time, capacity,
       from_address, consent_version, race_slug, minimum_age
     ) values ($1, $2, 'Photo links fixture', '2026-11-01'::date, '11:00', 250,
               $3, 'fixture-v1', 'zz-photo-links', 18)`,
    [ENTRIES_ID, RACE, REPLY_TO],
  );
  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     values ($1, 'unaffiliated', 'Unaffiliated', 2000)`,
    [ENTRIES_ID],
  );

  for (const [bib, status] of [
    ['201', 'paid'],
    ['202', 'paid'],
    ['203', 'refunded'],
    ['205', 'paid'],
  ] as const) {
    await query(
      `insert into entries.entry_purchases (
         id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, paid_at
       )
       select $1, $2, $3, 2000, f.id, $4, 'Fixture Buyer',
              '{"entryTerms":true,"medical":false}'::jsonb, 'fixture-v1',
              case when $3 = 'paid' then now() end
         from entries.fees f where f.event_id = $2`,
      [PURCHASE[bib], ENTRIES_ID, status, ADDRESS[bib]],
    );
  }

  // The guide is an entrant with an address of their own; the runner's address is the
  // purchase's, which is why the runner's row carries none.
  await query(
    `insert into entries.entrants (
       purchase_id, first_name, last_name, date_of_birth, gender,
       emergency_contact_name, emergency_contact_phone, role, email
     ) values
       ($1, 'Vi', 'Fixture', date '1990-01-01', 'female', 'Kin', '0117 496 0010',
        'runner', null),
       ($1, 'Gwen', 'Fixture', date '1992-02-02', null, 'Kin', '0117 496 0011',
        'guide', $2)`,
    [PURCHASE[202], ADDRESS[9202]],
  );

  for (const [number, purchase] of [
    ['201', PURCHASE[201]],
    ['202', PURCHASE[202]],
    ['203', PURCHASE[203]],
    ['204', null],
    ['205', PURCHASE[205]],
  ] as const) {
    const [team] = await query<{ id: string }>(
      `insert into timing.teams (event_id, team_number, purchase_order_id, bib_leg2)
       values ($1, $2, $3, $4) returning id`,
      [TIMING_ID, number, purchase, number === '202' ? '9202' : null],
    );
    await query(
      `insert into timing.runners (team_id, leg, firstname, lastname, role)
       values ($1, 1, 'Fixture', 'Runner', 'runner')`,
      [team!.id],
    );
    if (number === '202') {
      await query(
        `insert into timing.runners (team_id, leg, firstname, lastname, role)
         values ($1, 2, 'Gwen', 'Fixture', 'guide')`,
        [team!.id],
      );
    }
  }

  await query(`insert into photos.event (slug) values ($1)`, [RACE]);

  const photos: [string, string, string | null][] = [
    [PHOTO.first201, 'TL26-0001', null],
    [PHOTO.second201, 'TL26-0002', null],
    [PHOTO.hidden201, 'TL26-0003', '2026-11-02T10:00:00Z'],
    [PHOTO.runnerAndGuide, 'TL26-0004', null],
    [PHOTO.refunded, 'TL26-0005', null],
    [PHOTO.walkIn, 'TL26-0006', null],
    [PHOTO.partRead, 'TL26-0007', null],
  ];
  for (const [id, shortId, hidden] of photos) {
    await query(
      `insert into photos.photo
         (id, event_slug, short_id, photographer, spot, taken_at, width, height,
          check_state, hidden_at)
       values ($1, $2, $3, 'Adrian', 'Finish', '2026-11-01T11:40:00Z', 2400, 1600,
               $4, $5::timestamptz)`,
      [id, RACE, shortId, id === PHOTO.partRead ? 'part_read' : 'tagged', hidden],
    );
  }

  await query(
    `insert into photos.photo_bib (photo_id, bib_text, confidence, confirmed, source)
     values ($1, '201', 0.97, true, 'model'),
            ($2, '201', 0.97, true, 'model'),
            ($3, '201', 0.97, true, 'model'),
            ($4, '202', 0.97, true, 'model'),
            ($4, '9202', 0.96, true, 'model'),
            ($5, '203', 0.97, true, 'model'),
            ($6, '204', 0.97, true, 'model'),
            ($7, '20?', 0.90, false, 'model')`,
    [
      PHOTO.first201,
      PHOTO.second201,
      PHOTO.hidden201,
      PHOTO.runnerAndGuide,
      PHOTO.refunded,
      PHOTO.walkIn,
      PHOTO.partRead,
    ],
  );
}

async function unseed(): Promise<void> {
  await query('delete from photos.email_outbox where event_slug = $1', [RACE]);
  await query('delete from photos.link where event_slug = $1', [RACE]);
  await query(
    'delete from photos.photo_bib where photo_id in (select id from photos.photo where event_slug = $1)',
    [RACE],
  );
  await query('delete from photos.photo where event_slug = $1', [RACE]);
  await query('delete from photos.event where slug = $1', [RACE]);
  await query('delete from timing.events where slug = $1', [RACE]);
  await query('delete from entries.entry_purchases where event_id = $1', [ENTRIES_ID]);
  await query('delete from entries.fees where event_id = $1', [ENTRIES_ID]);
  await query('delete from entries.events where id = $1', [ENTRIES_ID]);
}

beforeAll(async () => {
  await connected;
  await unseed();

  for (const [index, person] of PEOPLE.entries()) {
    await query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, 'not-a-password', now(), now(), now())
       on conflict (id) do nothing`,
      [person, `photos-links-${String(index)}@example.com`],
    );
  }

  for (const [person, role] of [
    [PHOTO_ADMIN, 'nn-photo-admin'],
    [CHECKER, 'nn-photo-checker'],
    [DIRECTOR, 'src-admin'],
  ] as const) {
    await query(
      `insert into identity.role_grants (person_id, role, granted_by)
       values ($1, $2, $1) on conflict do nothing`,
      [person, role],
    );
  }

  await seed();
});

afterAll(async () => {
  await connected;
  await unseed();
  await query('delete from identity.role_grants where person_id = any($1::uuid[])', [
    PEOPLE,
  ]);
  await query('delete from auth.users where id = any($1::uuid[])', [PEOPLE]);
  await db.end();
});

beforeEach(async () => {
  await query('delete from photos.email_outbox where event_slug = $1', [RACE]);
  await query('delete from photos.link where event_slug = $1', [RACE]);
  await query(
    `update photos.event
        set published_at = null, links_sent_at = null, links_sent_by = null,
            daily_send_limit = 80
      where slug = $1`,
    [RACE],
  );
  await query(
    `update timing.teams set purchase_order_id = $2
      where event_id = $1 and team_number = '201'`,
    [TIMING_ID, PURCHASE[201]],
  );
});

describe('who may call what', () => {
  it('refuses sending the links to anybody signed out, by the grant', async () => {
    const { error } = await anon
      .schema('photos')
      .rpc('send_links', { p_event_slug: RACE });
    expect(error?.code).toBe('42501');
  });

  it('refuses sending the links to a signed-in person without nn.photo.send', async () => {
    await publish();

    expect(await sendLinks(NOBODY)).toEqual({ ok: false, reason: 'refused' });
    // A checker reads the progress and checks photos; sending is the photo-admin's.
    expect(await sendLinks(CHECKER)).toEqual({ ok: false, reason: 'refused' });
    expect(await as<Answer>(CHECKER, 'select photos.send_figures()')).toEqual({
      ok: false,
      reason: 'refused',
    });
    expect(await outbox()).toEqual([]);
  });

  it('refuses the drain and the lost-link request without their own keys', async () => {
    expect(await rpc('claim_outbox_batch', { p_key: ENTRY_KEY, p_limit: 10 })).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
    expect(
      await rpc('record_send_result', {
        p_key: '',
        p_id: '00000000-0000-4000-8000-000000000000',
        p_sent: false,
      }),
    ).toEqual({ ok: false, reason: 'unauthorised' });
    // ⚠️ The drain's key does not open the form, and the form's does not open the drain.
    expect(await requestLink(ADDRESS[201], WEBHOOK_KEY)).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });
});

describe('sending the links', () => {
  it('refuses before the photos are published, and queues nothing', async () => {
    expect(await sendLinks(PHOTO_ADMIN)).toEqual({ ok: false, reason: 'not_published' });
    expect(await outbox()).toEqual([]);
  });

  it('queues one first link for every runner with a photo of their own and an address', async () => {
    await publish();

    expect(await sendLinks(PHOTO_ADMIN)).toEqual({
      ok: true,
      queued: 3,
      // 201, 202, 9202 (the guide), 203 (refunded) and 204 (a walk-in). 205 has only a part
      // read, which is "Could be you" and never a runner's own.
      runners: 5,
      no_address: 2,
    });
    expect((await outbox()).map((row) => [row.bib, row.reason, row.status])).toEqual([
      ['201', 'first_link', 'pending'],
      ['202', 'first_link', 'pending'],
      ['9202', 'first_link', 'pending'],
    ]);

    const [event] = await query<{ sent: boolean; by: string }>(
      `select links_sent_at is not null as sent, links_sent_by as by
         from photos.event where slug = $1`,
      [RACE],
    );
    expect(event).toEqual({ sent: true, by: PHOTO_ADMIN });
  });

  it('queues nothing new the second time, whoever presses it', async () => {
    await publish();
    await sendLinks(PHOTO_ADMIN);
    const [first] = await query<{ at: Date }>(
      'select links_sent_at as at from photos.event where slug = $1',
      [RACE],
    );

    expect(await sendLinks(PHOTO_ADMIN)).toMatchObject({ ok: true, queued: 0 });
    expect(await sendLinks(DIRECTOR)).toMatchObject({ ok: true, queued: 0 });
    expect(await outbox()).toHaveLength(3);

    const [again] = await query<{ at: Date }>(
      'select links_sent_at as at from photos.event where slug = $1',
      [RACE],
    );
    expect(again!.at).toEqual(first!.at);
  });

  it('shows the photo-admin counts and no address', async () => {
    await publish();
    await sendLinks(PHOTO_ADMIN);

    const figures = await as<{ ok: boolean; events: Record<string, unknown>[] }>(
      PHOTO_ADMIN,
      'select photos.send_figures()',
    );
    expect(figures.ok).toBe(true);
    expect(figures.events.find((event) => event.slug === RACE)).toMatchObject({
      daily_send_limit: 80,
      runners: 5,
      no_address: 2,
      to_send: 0,
      waiting: 3,
      sent: 0,
      failed: 0,
      sent_last_day: 0,
    });
    expect(JSON.stringify(figures)).not.toContain('@');
  });
});

describe('the drain', () => {
  beforeEach(async () => {
    await publish();
    await sendLinks(PHOTO_ADMIN);
  });

  it('hands over each email with the address entries hold for that bib, and the race reply address', async () => {
    const messages = await claim();
    const byBib = Object.fromEntries(messages.map((m) => [m.bib, m]));

    expect(Object.keys(byBib).sort()).toEqual(['201', '202', '9202']);
    expect(byBib['201']).toMatchObject({
      reason: 'first_link',
      event_slug: RACE,
      event_name: 'Photo links fixture 2026',
      recipient: ADDRESS[201],
      reply_to: REPLY_TO,
      // The photo taken down is not counted.
      photo_count: 2,
      attempts: 1,
    });
    expect(byBib['202']!.recipient).toBe(ADDRESS[202]);
    // **The guide's own address, never the runner's.**
    expect(byBib['9202']!.recipient).toBe(ADDRESS[9202]);
  });

  it('counts an email claimed and not yet recorded against the limit', async () => {
    // Two drains can overlap — the nudge and the cron. A claimed row stays `pending`, as in
    // the other three outboxes, and Resend's idempotency key is what stops a second copy;
    // what must not happen is the second drain spending the same day's allowance again.
    await query(`update photos.event set daily_send_limit = 1 where slug = $1`, [RACE]);

    expect(await claim()).toHaveLength(1);
    expect(await claim()).toEqual([]);
  });

  it('keeps the first links inside the daily limit', async () => {
    await query(`update photos.event set daily_send_limit = 1 where slug = $1`, [RACE]);

    const one = await claim();
    expect(one).toHaveLength(1);
    await record(one[0]!.id, { sent: true, hash: hashFor('limit-1') });

    // Sent in the last 24 hours, so the day's one is spent.
    expect(await claim()).toEqual([]);

    // Lifting the limit is an update and no deploy.
    await query(`update photos.event set daily_send_limit = null where slug = $1`, [
      RACE,
    ]);
    expect(await claim()).toHaveLength(2);
  });

  it('sends a new link somebody asked for first, and outside the limit', async () => {
    await query(`update photos.event set daily_send_limit = 1 where slug = $1`, [RACE]);
    await query(`update photos.event set links_sent_at = now() where slug = $1`, [RACE]);
    await requestLink(ADDRESS[202]);

    const messages = await claim(10);
    expect(messages.map((m) => m.reason)).toEqual(['new_link', 'first_link']);
    expect(messages[0]!.bib).toBe('202');
  });

  it('makes a link active only once its email has gone', async () => {
    const [message] = (await claim()).filter((m) => m.bib === '201');
    const hash = hashFor('active-1');

    expect(await runnerPage(hash)).toBeNull();
    expect(await record(message!.id, { sent: true, hash })).toMatchObject({
      ok: true,
      status: 'sent',
      already: false,
    });

    const page = await runnerPage(hash);
    // The email's count and the page's own photos are the same answer.
    expect(page?.mine).toHaveLength(message!.photo_count);
  });

  it('replaces the old link when a new one has gone, and only then', async () => {
    const [first] = (await claim()).filter((m) => m.bib === '201');
    const oldHash = hashFor('old');
    await record(first!.id, { sent: true, hash: oldHash });

    await requestLink(ADDRESS[201]);
    const [asked] = (await claim()).filter((m) => m.reason === 'new_link');

    // A failed attempt takes nothing away: the old link still works.
    await record(asked!.id, { sent: false, error: 'http 500' });
    expect(await runnerPage(oldHash)).not.toBeNull();

    const [retry] = (await claim()).filter((m) => m.reason === 'new_link');
    const newHash = hashFor('new');
    await record(retry!.id, { sent: true, hash: newHash });

    expect(await runnerPage(oldHash)).toBeNull();
    expect(await runnerPage(newHash)).not.toBeNull();
    const active = await query(
      `select 1 from photos.link where event_slug = $1 and bib = '201' and replaced_at is null`,
      [RACE],
    );
    expect(active).toHaveLength(1);
  });

  it('changes nothing when the same send is recorded twice', async () => {
    const [message] = await claim();
    const hash = hashFor('twice');
    await record(message!.id, { sent: true, hash });

    expect(await record(message!.id, { sent: true, hash })).toMatchObject({
      ok: true,
      already: true,
    });
    expect(
      await query(`select 1 from photos.link where token_hash = $1`, [hash]),
    ).toHaveLength(1);
  });

  it('refuses to record a send without a hash, and leaves it to be sent again', async () => {
    const [message] = await claim();

    expect(await record(message!.id, { sent: true, hash: 'not-a-hash' })).toEqual({
      ok: false,
      reason: 'bad_hash',
    });
    const [row] = await query<{ status: string }>(
      `select status from photos.email_outbox where id = $1`,
      [message!.id],
    );
    expect(row!.status).toBe('pending');
  });

  it('gives a rate-limited attempt back, and gives up after three real ones', async () => {
    const [message] = (await claim()).filter((m) => m.bib === '201');
    expect(await record(message!.id, { sent: false, rateLimited: true })).toMatchObject({
      status: 'pending',
    });
    const [returned] = await query<{ attempts: number }>(
      `select attempts from photos.email_outbox where id = $1`,
      [message!.id],
    );
    expect(returned!.attempts).toBe(0);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [again] = (await claim()).filter((m) => m.id === message!.id);
      const outcome = await record(again!.id, { sent: false, error: 'http 500' });
      expect(outcome.status).toBe(attempt === 3 ? 'failed' : 'pending');
    }
  });

  it('marks a row failed instead of sending it once its bib has nobody to email', async () => {
    // The roster losing its link to the entry, which is what a bib with nobody behind it looks
    // like from here — without refunding a purchase, which would fire the entry emails.
    await query(
      `update timing.teams set purchase_order_id = null
        where event_id = $1 and team_number = '201'`,
      [TIMING_ID],
    );

    const messages = await claim();
    expect(messages.map((m) => m.bib).sort()).toEqual(['202', '9202']);
    const [row] = await query<{ status: string; last_error: string }>(
      `select status, last_error from photos.email_outbox
        where event_slug = $1 and bib = '201'`,
      [RACE],
    );
    expect(row).toEqual({ status: 'failed', last_error: 'no_address' });
  });
});

describe('the lost-link request', () => {
  it('answers the same whatever it is given', async () => {
    await linksSent();

    const answers = [
      await requestLink(ADDRESS[201]),
      await requestLink('nobody-ran@example.com'),
      await requestLink(ADDRESS[205]),
      await requestLink(ADDRESS[203]),
      await requestLink('not an address'),
    ];

    for (const answer of answers) expect(answer).toEqual({ ok: true });
  });

  it('queues a new link for a known address, ignoring case and spaces', async () => {
    await linksSent();
    await requestLink(`  ${ADDRESS[201].toUpperCase()} `);

    expect(await outbox()).toEqual([
      { bib: '201', reason: 'new_link', status: 'pending', attempts: 0 },
    ]);
  });

  it("queues a guide's link for the guide's own address", async () => {
    await linksSent();
    await requestLink(ADDRESS[9202]);

    expect((await outbox()).map((row) => row.bib)).toEqual(['9202']);
  });

  it('queues nothing for an address that did not enter, a refund, or a runner with no photo of their own', async () => {
    await linksSent();
    await requestLink('nobody-ran@example.com');
    await requestLink(ADDRESS[203]);
    await requestLink(ADDRESS[205]);

    expect(await outbox()).toEqual([]);
  });

  it('queues nothing before the links have gone out', async () => {
    await publish();
    expect(await requestLink(ADDRESS[201])).toEqual({ ok: true });
    expect(await outbox()).toEqual([]);
  });

  it('queues at most three new links a day for one bib', async () => {
    await linksSent();
    for (let ask = 0; ask < 5; ask += 1) {
      expect(await requestLink(ADDRESS[201])).toEqual({ ok: true });
    }

    expect(await outbox()).toHaveLength(3);
  });
});
