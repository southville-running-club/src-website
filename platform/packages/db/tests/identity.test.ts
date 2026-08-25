import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The `identity` schema — the first authenticated role this platform has ever had, tested
 * from **three sides**: an anonymous client, two ordinary signed-in people, and a
 * privileged connection that checks what actually landed in the tables.
 *
 * **There is no service-role key anywhere in this file, on purpose.** `./dev` and `ci.yml`
 * export exactly three credentials to the test suite — `SUPABASE_URL`, `SUPABASE_ANON_KEY`
 * and `SUPABASE_DB_URL` — and this file adds no fourth. Fixture people are created the same
 * way a real person would be: `signUp()` through the anon client, confirmed by the
 * privileged Postgres connection standing in for the mailbox click, then
 * `signInWithPassword()` for a real session. That exercises `identity.handle_new_user()`
 * exactly as production will fire it, rather than a hand-inserted row shaped like what the
 * trigger expects.
 *
 * The negative cases are the point, as in every other file in this directory — each is
 * asserted by the specific refusal, not merely that something failed.
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

/** Long enough to clear the 12-character minimum #49 set. Not otherwise special. */
const PASSWORD = 'zz-identity-test-password';

/** The reserved super-admin address the migration itself seeds — used here rather than a
 *  fabricated one because the bootstrap mechanism *is* this address; a different one would
 *  test a different code path than the one that matters in production. */
const ADMIN_EMAIL = 'admin@southvillerunningclub.co.uk';
const PERSON_A_EMAIL = 'zz-identity-a@example.com';
const PERSON_B_EMAIL = 'zz-identity-b@example.com';
/** Signed up with a name, unlike A and B — kept separate so their own tests, most of which
 *  predate #61, are not disturbed by a profile column suddenly being non-null. */
const PERSON_C_EMAIL = 'zz-identity-c@example.com';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/**
 * Cloudflare's own published dummy response token — every submission produces this exact
 * string when the widget's dummy "always passes" site key is in play, and GoTrue accepts
 * it because `[auth.captcha]`'s secret locally is the matching dummy secret (#53). See
 * developers.cloudflare.com/turnstile/troubleshooting/testing.
 */
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * Signs a fixture person up through the real endpoint, confirms the address the way a
 * mailbox click would, and returns a client already signed in as them plus their id.
 */
async function fixturePerson(
  email: string,
  name?: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      captchaToken: DUMMY_CAPTCHA_TOKEN,
      // #61's migration copies this into `identity.people.name` on the same trigger that
      // creates the row — the same field `worker/account.ts`'s real sign-up form sends.
      ...(name !== undefined ? { data: { name } } : {}),
    },
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

let admin: { id: string; client: SupabaseClient };
let personA: { id: string; client: SupabaseClient };
let personB: { id: string; client: SupabaseClient };
let personC: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  // Sequential, not parallel — each signUp/confirm/signIn round trip is cheap, and running
  // them concurrently would race the confirmation update against whichever signUp it
  // belongs to.
  admin = await fixturePerson(ADMIN_EMAIL);
  personA = await fixturePerson(PERSON_A_EMAIL);
  personB = await fixturePerson(PERSON_B_EMAIL);
  personC = await fixturePerson(PERSON_C_EMAIL, "D'Arcy O'Malley");
}, 30_000);

afterAll(async () => {
  await connected;
  // Cascades through identity.people, identity.role_grants and identity.audit —
  // identity.people.id references auth.users(id) on delete cascade.
  await db.query('delete from auth.users where email = any($1::text[])', [
    [ADMIN_EMAIL, PERSON_A_EMAIL, PERSON_B_EMAIL, PERSON_C_EMAIL],
  ]);
  await db.end();
});

// -----------------------------------------------------------------------------------------
// What an anonymous client may not do
// -----------------------------------------------------------------------------------------

describe('what an anonymous client may not do', () => {
  it('cannot select from identity.people', async () => {
    const { data, error } = await anon.schema('identity').from('people').select('*');

    // `42501`, not an empty result — there is no grant to anon on this schema at all, so
    // the request is refused before row-level security is even consulted.
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('cannot update identity.people either — #61 adds a write path, not a grant to anon', async () => {
    const { error } = await anon
      .schema('identity')
      .from('people')
      .update({ name: 'nobody' })
      .eq('id', personA.id);

    expect(error?.code).toBe('42501');
  });

  it('cannot select from identity.role_grants', async () => {
    const { error } = await anon.schema('identity').from('role_grants').select('*');
    expect(error?.code).toBe('42501');
  });

  it('cannot select from identity.reserved_grants', async () => {
    const { error } = await anon.schema('identity').from('reserved_grants').select('*');
    expect(error?.code).toBe('42501');
  });

  it('cannot select from identity.audit', async () => {
    const { error } = await anon.schema('identity').from('audit').select('*');
    expect(error?.code).toBe('42501');
  });

  it('cannot call identity.has_role', async () => {
    const { error } = await anon.schema('identity').rpc('has_role', {
      p_role: 'member',
    });
    // No grant to anon on the function: PostgREST finds it and Postgres denies it with 42501.
    // PGRST202 would mean the request never got as far as being denied.
    expect(error?.code).toBe('42501');
  });
});

// -----------------------------------------------------------------------------------------
// The signup trigger
// -----------------------------------------------------------------------------------------

describe('what the signup trigger does', () => {
  it('creates exactly one identity.people row per signup', async () => {
    const rows = await query('select id from identity.people where id = $1', [
      personA.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('grants an ordinary address member and not super-admin', async () => {
    const rows = await query<{ role: string }>(
      `select role from identity.role_grants
        where person_id = $1 and revoked_at is null`,
      [personA.id],
    );
    expect(rows.map((r) => r.role)).toEqual(['member']);
  });

  it('grants the reserved address super-admin, in addition to member', async () => {
    const rows = await query<{ role: string }>(
      `select role from identity.role_grants
        where person_id = $1 and revoked_at is null
        order by role`,
      [admin.id],
    );
    expect(rows.map((r) => r.role)).toEqual(['member', 'super-admin']);
  });

  it('applies the reserved grant exactly once, not once per row in the table', async () => {
    const rows = await query(
      `select id from identity.role_grants
        where person_id = $1 and role = 'super-admin' and revoked_at is null`,
      [admin.id],
    );
    expect(rows).toHaveLength(1);
  });

  // #61 — the name sign-up already collects reaching identity.people, from the same
  // trigger, rather than sitting stranded in auth.users.raw_user_meta_data.
  it('copies the metadata name onto identity.people, apostrophe and all', async () => {
    const rows = await query<{ name: string | null }>(
      'select name from identity.people where id = $1',
      [personC.id],
    );
    expect(rows[0]?.name).toBe("D'Arcy O'Malley");
  });

  it('leaves the name null when signup carried none', async () => {
    // personB, not personA — personA's own row is what the update tests below change, and
    // this assertion would become order-dependent on personA instead of standing alone.
    const rows = await query<{ name: string | null }>(
      'select name from identity.people where id = $1',
      [personB.id],
    );
    expect(rows[0]?.name).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------
// Row-level security on identity.people
// -----------------------------------------------------------------------------------------

describe('identity.people, read by its owner and nobody else', () => {
  it('lets a person read their own row', async () => {
    const { data, error } = await personA.client
      .schema('identity')
      .from('people')
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(personA.id);
  });

  it("returns zero rows for another person's row, not an error", async () => {
    // RLS filters; it does not raise. A `select` for a row that exists but is not yours
    // comes back empty, the same shape as a row that does not exist at all.
    const { data, error } = await personA.client
      .schema('identity')
      .from('people')
      .select('id')
      .eq('id', personB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// #61 — `/account/details/`'s write path. Asserted by result, on the `people_update_own_row`
// policy #51 already shipped: this is the first thing in the repository to actually call
// `update` on `identity.people`, so it is the first place these properties are observable.
describe('identity.people, updated by its owner and nobody else', () => {
  it('lets a person update every profile column on their own row, apostrophe included', async () => {
    const { error } = await personA.client
      .schema('identity')
      .from('people')
      .update({
        name: "D'Arcy O'Malley",
        gender: 'non-binary',
        date_of_birth: '1990-06-15',
        address: '1 Analytical Engine Way',
      })
      .eq('id', personA.id);

    expect(error).toBeNull();

    const rows = await query<{
      name: string;
      gender: string;
      date_of_birth: Date;
      address: string;
    }>('select name, gender, date_of_birth, address from identity.people where id = $1', [
      personA.id,
    ]);
    expect(rows[0]).toMatchObject({
      name: "D'Arcy O'Malley",
      gender: 'non-binary',
      address: '1 Analytical Engine Way',
    });
    // `pg` parses a `date` column into a JS `Date` — `seed.test.ts`'s own convention for
    // reading a timestamp back is `.toISOString()`, not `String()`, which gives a
    // human-readable form instead. There is no time component to drift here regardless of
    // session timezone, unlike the timestamptz columns london-time.ts exists for.
    expect(rows[0]?.date_of_birth.toISOString().slice(0, 10)).toBe('1990-06-15');
  });

  it('does not hand the extra profile columns to identity.list_people, run right after they are set', async () => {
    // #59's read, not #61's — this only confirms #61 did not widen it. `list_people()`
    // itself joins nothing but `name`; a super-admin reading the roles page a moment after
    // personA saved a full profile above should see that name and nothing else about them.
    const { data, error } = await admin.client.schema('identity').rpc('list_people');
    expect(error).toBeNull();

    const result = data as { ok: boolean; people: Array<Record<string, unknown>> };
    const entry = result.people.find((p) => p.id === personA.id);
    expect(entry).toMatchObject({ name: "D'Arcy O'Malley" });
    expect(entry).not.toHaveProperty('gender');
    expect(entry).not.toHaveProperty('date_of_birth');
    expect(entry).not.toHaveProperty('address');
  });

  it("changes nothing on another person's row, and does not error in a way that discloses it exists", async () => {
    const before = await query<{ name: string | null }>(
      'select name from identity.people where id = $1',
      [personB.id],
    );

    const { error } = await personA.client
      .schema('identity')
      .from('people')
      .update({ name: 'not personB' })
      .eq('id', personB.id);

    // RLS filters the target row out of the update entirely — zero rows touched, not a
    // refusal. The same "empty rather than an error" shape the read test above documents,
    // now for a write: an update statement whose `where` matches nothing is not a failure.
    expect(error).toBeNull();

    const after = await query<{ name: string | null }>(
      'select name from identity.people where id = $1',
      [personB.id],
    );
    expect(after).toEqual(before);
  });
});

// -----------------------------------------------------------------------------------------
// identity.grant_role / identity.revoke_role
// -----------------------------------------------------------------------------------------

describe('identity.grant_role, refused for anybody who is not super-admin', () => {
  it('refuses a plain member, with the specific reason, and writes no audit row', async () => {
    const before = await query('select id from identity.audit');

    const { data, error } = await personA.client
      .schema('identity')
      .rpc('grant_role', { p_person: personB.id, p_role: 'nn-admin' });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'not_authorised' });

    const after = await query('select id from identity.audit');
    expect(after).toHaveLength(before.length);

    const grants = await query(
      `select id from identity.role_grants
        where person_id = $1 and role = 'nn-admin' and revoked_at is null`,
      [personB.id],
    );
    expect(grants).toHaveLength(0);
  });

  it('lets super-admin grant a role, and writes exactly one audit row for it', async () => {
    // **Scoped to this subject, because `after` is.** It was a count of the whole table, which
    // made the assertion below true only while `identity.audit` was otherwise empty — and this
    // file's `afterAll` deliberately cannot empty it: `audit.actor` and `audit.subject` are not
    // foreign keys, precisely so the history outlives a deleted person. So the second run
    // against a database nobody had reset failed, two tests away from anything that had
    // changed. `./dev check` rebuilds every time and never saw it.
    const before = await query(
      `select id from identity.audit where subject = $1 and action = 'grant_role'`,
      [personB.id],
    );

    const { data, error } = await admin.client
      .schema('identity')
      .rpc('grant_role', { p_person: personB.id, p_role: 'nn-admin' });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });

    const grants = await query(
      `select id from identity.role_grants
        where person_id = $1 and role = 'nn-admin' and revoked_at is null`,
      [personB.id],
    );
    expect(grants).toHaveLength(1);

    const after = await query<{ action: string; subject: string; actor: string }>(
      `select action, subject, actor from identity.audit
        where subject = $1 and action = 'grant_role'`,
      [personB.id],
    );
    expect(after.length - before.length).toBe(1);
    expect(after[0]).toMatchObject({
      action: 'grant_role',
      subject: personB.id,
      actor: admin.id,
    });
  });
});

// -----------------------------------------------------------------------------------------
// Holding one role is not holding another
// -----------------------------------------------------------------------------------------

describe('a super-admin does not thereby hold nn-admin', () => {
  /**
   * **#57's four role-checked `entries` reads, asserted from here rather than from
   * `entries-admin.test.ts`, and the reason is the fixture below this one.**
   *
   * `identity.revoke_role()` refuses to remove *the last* active super-admin grant, so the
   * assertion in the next describe is a claim about the whole table — the one property in
   * this directory that cannot be scoped to an invented address. A second super-admin
   * anywhere in the suite makes it false, and Vitest runs these files at the same time. So
   * exactly one file may hold a super-admin, and this is it; the case that needs one lives
   * here beside it.
   *
   * What it proves is worth the awkwardness: **granting roles is not inheriting them.** A club
   * officer who can hand somebody `nn-admin` has not thereby given it to themselves, and the
   * refusal is as flat as the one a stranger gets — which is what makes a role grant an act
   * with a date on it rather than a formality.
   */
  const ENTRIES_READS: [string, Record<string, unknown>][] = [
    ['entry_list', { p_event_slug: 'nn-2026' }],
    ['interest_list', {}],
    ['entrant_medical', { p_entrant_id: '00000000-0000-4000-8000-000000000000' }],
    ['export', { p_event_slug: 'nn-2026', p_kind: 'start-list' }],
  ];

  it('holds super-admin and does not hold nn-admin, which is the premise', async () => {
    const roles = await query<{ role: string }>(
      `select role from identity.role_grants
        where person_id = $1 and revoked_at is null
        order by role`,
      [admin.id],
    );

    expect(roles.map((row) => row.role)).toEqual(['member', 'super-admin']);
  });

  it.each(ENTRIES_READS)('entries.%s refuses them', async (name, args) => {
    const { data, error } = await admin.client.schema('entries').rpc(name, args);

    expect(error).toBeNull();
    // The whole answer, asserted as a whole — and identical to the one a plain member gets, so
    // the refusal discloses nothing about what the caller nearly had.
    expect(data).toEqual({ ok: false, reason: 'unauthorised' });
  });
});

describe('identity.revoke_role, and the last super-admin', () => {
  it('refuses to remove the last active super-admin grant', async () => {
    const { data, error } = await admin.client
      .schema('identity')
      .rpc('revoke_role', { p_person: admin.id, p_role: 'super-admin' });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'last_super_admin' });

    const rows = await query(
      `select id from identity.role_grants
        where person_id = $1 and role = 'super-admin' and revoked_at is null`,
      [admin.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('revokes an ordinary grant that is not the last super-admin', async () => {
    const { data, error } = await admin.client
      .schema('identity')
      .rpc('revoke_role', { p_person: personB.id, p_role: 'nn-admin' });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });

    const rows = await query(
      `select id from identity.role_grants
        where person_id = $1 and role = 'nn-admin' and revoked_at is null`,
      [personB.id],
    );
    expect(rows).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------------------
// #62 — identity.export_me() and identity.delete_me()
// -----------------------------------------------------------------------------------------

describe('what an anonymous client may not do with #62’s two functions', () => {
  it('cannot call identity.export_me', async () => {
    const { error } = await anon.schema('identity').rpc('export_me');
    // 42501, not PGRST202: the function exists and anon is refused it. PGRST202 would mean
    // the request never got as far as being denied, which is a different bug.
    expect(error?.code).toBe('42501');
  });

  it('cannot call identity.delete_me', async () => {
    const { error } = await anon.schema('identity').rpc('delete_me');
    expect(error?.code).toBe('42501');
  });
});

describe('identity.export_me()', () => {
  it('hands somebody their own profile, name included', async () => {
    const { data, error } = await personC.client.schema('identity').rpc('export_me');

    expect(error).toBeNull();
    const result = data as {
      ok: boolean;
      account: { id: string; email: string };
      profile: Record<string, unknown>;
    };

    expect(result.ok).toBe(true);
    expect(result.account.id).toBe(personC.id);
    expect(result.account.email).toBe(PERSON_C_EMAIL);
    // The apostrophe fixture, round-tripping through jsonb rather than through markup.
    expect(result.profile.name).toBe("D'Arcy O'Malley");
  });

  /**
   * **The assertion #62 actually asks for**, and it is written this way on purpose: the
   * expected key list is read from the database rather than typed here, so a column added to
   * `identity.people` later and *not* added to `export_me()` fails this test rather than
   * quietly escaping the export. A literal list would stop testing the moment somebody added
   * a column and updated the literal without touching the function.
   */
  it('lists every column of identity.people, so a new one cannot escape', async () => {
    const columns = await query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'identity' and table_name = 'people'
        order by column_name`,
    );

    const { data } = await personC.client.schema('identity').rpc('export_me');
    const profile = (data as { profile: Record<string, unknown> }).profile;

    // `id` is reported under `account`, not repeated inside the profile.
    const expected = columns
      .map((row) => row.column_name)
      .filter((name) => name !== 'id')
      .sort();

    expect(Object.keys(profile).sort()).toEqual(expected);
  });

  it('includes the roles somebody holds, which they cannot read any other way', async () => {
    const { data } = await admin.client.schema('identity').rpc('export_me');
    const roles = (data as { roles: { role: string }[] }).roles;

    expect(roles.map((grant) => grant.role)).toContain('super-admin');
  });

  /** `granted_by` is another person's id. Who granted somebody a role is the club's record
   *  rather than theirs, and an export is not a way to read it out. */
  it('does not disclose who granted a role', async () => {
    const { data } = await admin.client.schema('identity').rpc('export_me');
    expect(JSON.stringify(data)).not.toContain('granted_by');
  });
});

describe('identity.delete_me()', () => {
  const PERSON_D_EMAIL = 'zz-identity-d@example.com';
  const PERSON_E_EMAIL = 'zz-identity-e@example.com';

  afterAll(async () => {
    await db.query('delete from auth.users where email = any($1::text[])', [
      [PERSON_D_EMAIL, PERSON_E_EMAIL],
    ]);
  });

  it('deletes the caller, and the profile goes with them', async () => {
    const personD = await fixturePerson(PERSON_D_EMAIL);

    const { data, error } = await personD.client.schema('identity').rpc('delete_me');
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });

    expect(await query('select id from auth.users where id = $1', [personD.id])).toEqual(
      [],
    );
    expect(
      await query('select id from identity.people where id = $1', [personD.id]),
    ).toEqual([]);
  }, 20_000);

  /**
   * The function takes no arguments, so there is nothing to pass that could name somebody
   * else. This asserts the *result* of that rather than the intention: person E deleting
   * themselves leaves person A entirely alone.
   */
  it('deletes only the caller', async () => {
    const personE = await fixturePerson(PERSON_E_EMAIL);

    await personE.client.schema('identity').rpc('delete_me');

    const survivors = await query('select id from identity.people where id = $1', [
      personA.id,
    ]);
    expect(survivors).toHaveLength(1);
  }, 20_000);

  /**
   * The same hole `revoke_role()` already refuses through its own door — "no system is
   * reachable by only one person", and an account deletion that empties the super-admin role
   * leaves the club unable to administer its own site.
   */
  it('refuses the last super-admin, and says why', async () => {
    const { data, error } = await admin.client.schema('identity').rpc('delete_me');

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'last_super_admin' });

    // And nothing happened.
    expect(
      await query('select id from auth.users where id = $1', [admin.id]),
    ).toHaveLength(1);
  });
});

/**
 * **Not a test of `delete_me()` so much as of the shape that makes it safe.** #62 is explicit
 * that a paid race entry survives a deletion because `entries.entrants` is not keyed on
 * `identity.people` — and that this issue "must not make it so". Asserting the absence of the
 * foreign key is what keeps that true a year from now: inserting an entrant and watching it
 * survive would pass just as well on a schema where somebody had added a nullable reference,
 * right up until the day it was made `on delete cascade`.
 */
describe('what a deletion cannot reach', () => {
  it('no table in entries references identity.people', async () => {
    const references = await query<{ table_name: string; constraint_name: string }>(
      `select tc.table_name, tc.constraint_name
         from information_schema.table_constraints as tc
         join information_schema.constraint_column_usage as ccu
           on ccu.constraint_name = tc.constraint_name
          and ccu.constraint_schema = tc.constraint_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'entries'
          and ccu.table_schema = 'identity'`,
    );

    expect(references).toEqual([]);
  });

  it('identity.audit has no foreign key to people, so it outlives them', async () => {
    const references = await query(
      `select tc.constraint_name
         from information_schema.table_constraints as tc
         join information_schema.constraint_column_usage as ccu
           on ccu.constraint_name = tc.constraint_name
          and ccu.constraint_schema = tc.constraint_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'identity'
          and tc.table_name = 'audit'`,
    );

    expect(references).toEqual([]);
  });
});
