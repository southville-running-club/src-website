import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * `identity.set_roles()` — several role changes for one person, applied together or not at all.
 *
 * ADR-046 supersedes the one-form-per-role decision `worker/admin-people.ts` recorded, and
 * this file is where the new function's contract is held. The negative cases are most of it,
 * as everywhere else in this directory, and each is asserted by its **specific** refusal — a
 * broken function refuses everything, which reads as every rule holding at once.
 *
 * ## The last-super-admin guard is deliberately not re-tested here
 *
 * It is `identity.test.ts`'s, and it must stay exactly one file's. That assertion is a claim
 * about the **whole database** — "this is the last active `super-admin` grant" reads across
 * the table — and `vitest.config.ts` carries a long note about what happened the last time two
 * files held a super-admin at once: the property held only by luck of scheduling, and adding
 * one fixture person was enough to break it. `fileParallelism: false` makes it real, and a
 * second file re-asserting the same global claim would put the fragility straight back.
 *
 * What *is* this file's job is proving `set_roles()` adds no new route to that state, which is
 * the `reserved_role` group below: the batch cannot name `super-admin` at all, in either
 * direction, so it cannot empty the role however it is called. This file holds a super-admin
 * only for as long as it runs, and `afterAll` deletes the fixtures — `auth.users` cascades to
 * `identity.people` and on to `identity.role_grants`.
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

const ACTOR_EMAIL = 'zzsetroles-actor@example.com';
const SUBJECT_EMAIL = 'zzsetroles-subject@example.com';
const PLAIN_EMAIL = 'zzsetroles-plain@example.com';
/** Holds `people-admin`: opens the page, may change nothing on it. */
const READER_EMAIL = 'zzsetroles-reader@example.com';
/** Holds `src-admin`, the club's master role — see the `src-admin` test for why it is here. */
const DIRECTOR_EMAIL = 'zzsetroles-director@example.com';

const FIXTURE_EMAILS = [
  ACTOR_EMAIL,
  SUBJECT_EMAIL,
  PLAIN_EMAIL,
  READER_EMAIL,
  DIRECTOR_EMAIL,
] as const;

const PASSWORD = 'correct-horse-battery-staple-046';

/** See `identity.test.ts` — Cloudflare's published dummy response token. */
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** A person who does not exist, and is a well-formed uuid so the shape is not what refuses it. */
const NOBODY = '00000000-0000-4000-8000-000000000000';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

async function fixturePerson(
  email: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  const [row] = await query<{ id: string }>(
    `update auth.users set email_confirmed_at = now() where email = $1 returning id`,
    [email],
  );
  if (!row) throw new Error(`signUp did not create auth.users row for ${email}`);

  const signIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signIn.error) throw signIn.error;

  return { id: row.id, client };
}

async function grant(personId: string, role: string): Promise<void> {
  await query(
    `insert into identity.role_grants (person_id, role, granted_by)
     values ($1, $2, null) on conflict do nothing`,
    [personId, role],
  );
}

/** What the subject actually holds now, from the table rather than from an answer. */
async function heldBy(personId: string): Promise<string[]> {
  const rows = await query<{ role: string }>(
    `select role from identity.role_grants
      where person_id = $1 and revoked_at is null order by role`,
    [personId],
  );
  return rows.map((row) => row.role);
}

/**
 * Puts the subject back to a known state **without going through the function under test**,
 * so a test that asserts a refusal is never reading a state some earlier test's success left
 * behind.
 */
async function resetSubject(roles: string[]): Promise<void> {
  await query(`delete from identity.role_grants where person_id = $1`, [subject.id]);
  await query(`delete from identity.audit where subject = $1`, [subject.id]);
  for (const role of ['registered', ...roles]) {
    await grant(subject.id, role);
  }
}

async function auditFor(personId: string): Promise<{ action: string; role: string }[]> {
  const rows = await query<{ action: string; detail: { role?: string } }>(
    `select action, detail from identity.audit
      where subject = $1 order by action, detail->>'role'`,
    [personId],
  );
  return rows.map((row) => ({ action: row.action, role: row.detail.role ?? '' }));
}

let actor: { id: string; client: SupabaseClient };
let subject: { id: string; client: SupabaseClient };
let plain: { id: string; client: SupabaseClient };
let reader: { id: string; client: SupabaseClient };
let director: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  await query('delete from auth.users where email = any($1::text[])', [
    [...FIXTURE_EMAILS],
  ]);

  actor = await fixturePerson(ACTOR_EMAIL);
  subject = await fixturePerson(SUBJECT_EMAIL);
  plain = await fixturePerson(PLAIN_EMAIL);
  reader = await fixturePerson(READER_EMAIL);
  director = await fixturePerson(DIRECTOR_EMAIL);

  await grant(actor.id, 'super-admin');
  await grant(reader.id, 'people-admin');
  await grant(director.id, 'src-admin');
}, 60_000);

afterAll(async () => {
  await connected;
  await query('delete from auth.users where email = any($1::text[])', [
    [...FIXTURE_EMAILS],
  ]);
  await db.end();
});

beforeEach(async () => {
  await resetSubject(['nn-admin']);
});

/** The call under test, as the signed-in actor unless another client is named. */
function setRoles(
  expected: string[],
  wanted: string[],
  as: SupabaseClient = actor.client,
) {
  return as.schema('identity').rpc('set_roles', {
    p_person: subject.id,
    p_expected: expected,
    p_wanted: wanted,
  });
}

// -----------------------------------------------------------------------------------------
// anon — no privilege at all, before any rule is consulted
// -----------------------------------------------------------------------------------------

describe('what an anonymous client may not do', () => {
  it('cannot call identity.set_roles at all', async () => {
    const { error } = await anon.schema('identity').rpc('set_roles', {
      p_person: NOBODY,
      p_expected: [],
      p_wanted: ['nn-admin'],
    });

    // 42501: no execute grant to `anon`, so this is refused before the function's own
    // authorisation runs. The refusal is the grant's, not the guard's.
    expect(error?.code).toBe('42501');
  });
});

// -----------------------------------------------------------------------------------------
// Who may call it — the same question grant_role() and revoke_role() ask
// -----------------------------------------------------------------------------------------

describe('who may call it', () => {
  it('refuses somebody signed in holding nothing but their account', async () => {
    const { data, error } = await setRoles([], ['nn-admin'], plain.client);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'not_authorised' });
    expect(await heldBy(subject.id)).toEqual(['nn-admin', 'registered']);
  });

  it('refuses a people-admin, who reads this page and changes nothing on it', async () => {
    const { data, error } = await setRoles([], ['nn-admin'], reader.client);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'not_authorised' });
  });

  /**
   * ⚠️ **This pins a discrepancy rather than a design.** `src-admin` carries
   * `identity.role.grant`, and `/admin/people/` renders its controls on exactly that
   * permission — so a club director is offered buttons that `grant_role()`, `revoke_role()`
   * and now `set_roles()` all refuse, because those three ask `has_role('super-admin')` and
   * were never moved onto the permission by ADR-017's mechanism.
   *
   * The assertion is here so that resolving it is a decision somebody takes in a diff. It is
   * the same job `identity-permissions.test.ts`'s exact role and permission sets do, and the
   * same job `entries.test.ts` does for the anon grant list. Changing who may change roles is
   * a stop-and-ask; this test going red is what makes somebody notice they are taking it.
   */
  it('refuses an src-admin, whose own description says it grants roles', async () => {
    const { data, error } = await setRoles([], ['nn-admin'], director.client);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'not_authorised' });
  });
});

// -----------------------------------------------------------------------------------------
// Things that are not there
// -----------------------------------------------------------------------------------------

describe('unknown subjects and unknown roles', () => {
  it('refuses a person who does not exist', async () => {
    const { data, error } = await actor.client.schema('identity').rpc('set_roles', {
      p_person: NOBODY,
      p_expected: [],
      p_wanted: ['nn-admin'],
    });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'unknown_person' });
  });

  it('refuses a role this club does not have', async () => {
    const { data, error } = await setRoles(['nn-admin'], ['nn-admin', 'chief-wizard']);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'unknown_role' });
  });
});

// -----------------------------------------------------------------------------------------
// The two roles the batch may never carry
// -----------------------------------------------------------------------------------------

describe('the reserved roles', () => {
  it('refuses a batch that would grant super-admin', async () => {
    const { data, error } = await setRoles(['nn-admin'], ['nn-admin', 'super-admin']);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'reserved_role' });
  });

  /**
   * The revoke direction, which is the one that matters: super-admin absent from `wanted`
   * while present in `expected` is precisely how a batch would express "take it away". It is
   * refused before the sets are compared, so the batch is not a second route to the state
   * `revoke_role()`'s last-super-admin guard exists to prevent.
   */
  it('refuses a batch that names super-admin in the expected set', async () => {
    await resetSubject(['nn-admin', 'super-admin']);

    const { data, error } = await setRoles(['nn-admin', 'super-admin'], ['nn-admin']);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'reserved_role' });
    // Still held. The batch could not express taking it away.
    expect(await heldBy(subject.id)).toContain('super-admin');

    await resetSubject(['nn-admin']);
  });

  it('refuses a batch that would strip registered, which the signup trigger owns', async () => {
    const { data, error } = await setRoles(['nn-admin'], ['nn-admin', 'registered']);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'reserved_role' });
  });

  it('leaves registered alone while changing everything around it', async () => {
    const { data } = await setRoles(['nn-admin'], ['nn-results']);

    expect(data).toMatchObject({ ok: true });
    expect(await heldBy(subject.id)).toEqual(['nn-results', 'registered'].sort());
  });
});

// -----------------------------------------------------------------------------------------
// Applying one
// -----------------------------------------------------------------------------------------

describe('applying a batch', () => {
  it('grants and revokes in the same call', async () => {
    const { data, error } = await setRoles(
      ['nn-admin'],
      ['nn-results', 'timing-marshal'],
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, changed: 3 });
    expect(await heldBy(subject.id)).toEqual([
      'nn-results',
      'registered',
      'timing-marshal',
    ]);
  });

  /**
   * **One row per role changed, with the two actions that already exist.** This is the half of
   * the superseded decision that survives — an accidental revoke is still individually visible
   * in the trail — and it is why this migration does not widen `identity.audit`'s `action`
   * check constraint, which is the restated-closed-list trap `CLAUDE.md` records.
   */
  it('writes one audit row per role changed, and no new action', async () => {
    await setRoles(['nn-admin'], ['nn-results', 'timing-marshal']);

    expect(await auditFor(subject.id)).toEqual([
      { action: 'grant_role', role: 'nn-results' },
      { action: 'grant_role', role: 'timing-marshal' },
      { action: 'revoke_role', role: 'nn-admin' },
    ]);
  });

  it('is a success that changes nothing when the wanted set is already held', async () => {
    const { data, error } = await setRoles(['nn-admin'], ['nn-admin']);

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, changed: 0 });
    // Somebody who flipped a switch and flipped it back has asked for a state the database is
    // already in. That is not a refusal, and it must not write an audit row either.
    expect(await auditFor(subject.id)).toEqual([]);
  });

  it('does not care about order or repetition in either array', async () => {
    const { data } = await setRoles(
      ['nn-admin', 'nn-admin'],
      ['timing-marshal', 'nn-results', 'timing-marshal'],
    );

    expect(data).toMatchObject({ ok: true });
    expect(await heldBy(subject.id)).toEqual([
      'nn-results',
      'registered',
      'timing-marshal',
    ]);
  });

  it('empties every role it may touch, and keeps the one it may not', async () => {
    const { data } = await setRoles(['nn-admin'], []);

    expect(data).toMatchObject({ ok: true, changed: 1 });
    expect(await heldBy(subject.id)).toEqual(['registered']);
  });
});

// -----------------------------------------------------------------------------------------
// Staleness — two volunteers on one page is the normal case
// -----------------------------------------------------------------------------------------

describe('a stale expected set', () => {
  it('is refused, and the refusal carries what is actually held', async () => {
    // Somebody else granted `nn-results` after this caller's page was drawn.
    await grant(subject.id, 'nn-results');

    const { data, error } = await setRoles(['nn-admin'], ['timing-marshal']);

    expect(error).toBeNull();
    expect(data).toEqual({
      ok: false,
      reason: 'stale',
      // Sorted, and without the roles the batch may not carry — the set the page will redraw.
      roles: ['nn-admin', 'nn-results'],
    });
  });

  it('writes nothing at all when it refuses', async () => {
    await grant(subject.id, 'nn-results');

    await setRoles(['nn-admin'], ['timing-marshal']);

    expect(await heldBy(subject.id)).toEqual(['nn-admin', 'nn-results', 'registered']);
    expect(await auditFor(subject.id)).toEqual([]);
  });

  it('is not confused by a reserved role the caller never sent', async () => {
    // The subject is a super-admin, which the caller's expected set correctly omits because
    // the batch may not carry it. That must not read as staleness.
    await resetSubject(['nn-admin', 'super-admin']);

    const { data } = await setRoles(['nn-admin'], ['nn-results']);

    expect(data).toMatchObject({ ok: true });
    expect(await heldBy(subject.id)).toEqual(['nn-results', 'registered', 'super-admin']);

    await resetSubject(['nn-admin']);
  });
});

// -----------------------------------------------------------------------------------------
// Atomicity
// -----------------------------------------------------------------------------------------

describe('all of it or none of it', () => {
  /**
   * The batch is validated before the first write, so there is no payload that half-applies —
   * which is the property, stated as a test rather than left to be inferred from the function
   * body. A good role beside an unknown one grants **neither**.
   */
  it('grants nothing when one role in the batch is unknown', async () => {
    const { data } = await setRoles(
      ['nn-admin'],
      ['nn-admin', 'timing-marshal', 'chief-wizard'],
    );

    expect(data).toEqual({ ok: false, reason: 'unknown_role' });
    expect(await heldBy(subject.id)).toEqual(['nn-admin', 'registered']);
    expect(await auditFor(subject.id)).toEqual([]);
  });

  it('revokes nothing when the batch also names a reserved role', async () => {
    const { data } = await setRoles(['nn-admin'], ['super-admin']);

    expect(data).toEqual({ ok: false, reason: 'reserved_role' });
    // `nn-admin` would have been revoked by this batch had it been applied at all.
    expect(await heldBy(subject.id)).toEqual(['nn-admin', 'registered']);
    expect(await auditFor(subject.id)).toEqual([]);
  });
});
