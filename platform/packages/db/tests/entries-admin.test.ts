import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The admin surface, from **both sides** — the same arrangement the rest of this directory uses,
 * and here it is the whole point.
 *
 * An anonymous client checks what can be reached with the key that is published in page source;
 * a privileged connection checks what is actually in the tables. There is no tier between a
 * browser and Postgres, so this file *is* the access control being tested.
 *
 * **The assertions that matter most are the refusals.** `entries.test.ts` proves the tables stay
 * shut; this proves the six new doors stay shut to anybody without the key, and that the two
 * that read special category data or take a copy out cannot do either without writing the row
 * that says they did.
 *
 * Every fixture here is invented, scoped to **its own fabricated event**, and removed afterwards.
 * The real `nn-2026` row is never touched: `entries-capacity.test.ts` and the acceptance suite
 * both depend on it, Vitest runs files at the same time, and an unscoped fixture is how an
 * intermittent gets written.
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
 * The key this file installs, and the one it presents.
 *
 * **The digest is what goes in the table**, exactly as production does it — a test that wrote
 * the key itself would be proving something the real path does not do.
 */
const GATE_KEY = 'zz-admin-test-gate-key-not-a-real-one';
const PERSON_KEY = 'zz-admin-test-person-key-not-a-real-one';
const REVOKED_KEY = 'zz-admin-test-revoked-key-not-a-real-one';
const ACTOR = 'zz-tester';
const REVOKED_ACTOR = 'zz-revoked';

/** Fabricated, and never a running of `nn`. */
const EVENT = 'zz-admin-test';
const RACE = 'zz-admin-test-race';

const PURCHASE_PAID = '0a0a0a0a-0000-4000-8000-000000000001';
const PURCHASE_PENDING = '0a0a0a0a-0000-4000-8000-000000000002';
const ENTRANT_PAID = '0a0a0a0a-0000-4000-8000-000000000011';
const ENTRANT_PENDING = '0a0a0a0a-0000-4000-8000-000000000012';

/**
 * #57's second door — two signed-in people, for the two role sets this file can safely hold.
 *
 * **The roles are inserted through the privileged connection rather than granted through
 * `identity.grant_role()`**, which needs a caller who already holds `super-admin` — and the
 * only address the migration reserves that role for is `admin@southvillerunningclub.co.uk`,
 * which `identity.test.ts` already signs up and deletes. Vitest runs these files at the same
 * time, so competing for one address is how an intermittent gets written.
 *
 * **And there is no super-admin here at all, which is deliberate and cost a green run to
 * learn.** `identity.revoke_role()` refuses to remove *the last* active super-admin grant, so
 * `identity.test.ts`'s assertion about that refusal is a claim about the whole table rather
 * than about its own fixtures — it is the one property in this directory that cannot be
 * scoped to an invented event or an invented address. A second super-admin created here made
 * it false while the two files overlapped, and the failure surfaced two files away from its
 * cause. **Exactly one test file may hold a super-admin, and it is `identity.test.ts`** — so
 * the "a super-admin does not thereby hold nn-admin" case for these four functions lives
 * there, beside the fixture it needs.
 */
const NN_ADMIN_EMAIL = 'zz-entries-admin-nn@example.com';
const MEMBER_EMAIL = 'zz-entries-admin-member@example.com';
const PEOPLE_EMAILS = [NN_ADMIN_EMAIL, MEMBER_EMAIL];

/** Long enough to clear the 12-character minimum #49 set. Not otherwise special. */
const PERSON_PASSWORD = 'zz-entries-admin-test-password';

/**
 * Cloudflare's own published dummy response token — accepted because `[auth.captcha]`'s
 * secret locally is the matching dummy secret (#53). See
 * developers.cloudflare.com/turnstile/troubleshooting/testing.
 */
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function digest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/** What the anon client gets back, unwrapped. */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await anon.schema('entries').rpc(name, args);
  expect(error).toBeNull();
  return data;
}

/** The same, as one signed-in person. */
async function rpcAs(
  person: { client: SupabaseClient },
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { data, error } = await person.client.schema('entries').rpc(name, args);
  expect(error).toBeNull();
  return data;
}

/**
 * Signs a fixture person up through the real endpoint, confirms the address the way a mailbox
 * click would, applies the roles asked for, and returns a client already signed in as them.
 *
 * The signup itself is left to fire `identity.handle_new_user()` exactly as production will,
 * so the `member` grant every account gets is real rather than fabricated.
 */
async function fixturePerson(
  email: string,
  roles: string[],
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PERSON_PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  const [row] = await query<{ id: string }>(
    `update auth.users set email_confirmed_at = now() where email = $1 returning id`,
    [email],
  );
  if (!row) throw new Error(`signUp did not create auth.users row for ${email}`);

  if (roles.length > 0) {
    await query(
      `insert into identity.role_grants (person_id, role)
       select $1::uuid, unnest($2::text[])`,
      [row.id, roles],
    );
  }

  // **After the grants, not before.** `has_role()` reads the table on every call rather than
  // the JWT, so the ordering does not actually matter — and asserting that it does not is
  // #59's job, where a role granted mid-session has to take effect on the next request.
  const signIn = await client.auth.signInWithPassword({
    email,
    password: PERSON_PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signIn.error) throw signIn.error;

  return { id: row.id, client };
}

let nnAdmin: { id: string; client: SupabaseClient };
let member: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;

  // **The gate key's digest is installed here and taken out in `afterAll`, whatever happens**,
  // so a laptop is never left with a working admin key for a test secret. The real row ships
  // null, which refuses everything.
  await query(
    `update entries.webhook_secrets set key_sha256 = $1, updated_at = now()
      where name = 'admin'`,
    [digest(GATE_KEY)],
  );

  await query(
    `insert into entries.admin_keys (name, key_sha256) values ($1, $2), ($3, $4)
     on conflict (name) do update set key_sha256 = excluded.key_sha256`,
    [ACTOR, digest(PERSON_KEY), REVOKED_ACTOR, digest(REVOKED_KEY)],
  );

  await query(`update entries.admin_keys set revoked_at = now() where name = $1`, [
    REVOKED_ACTOR,
  ]);

  await query(
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, capacity,
       entries_open_at, from_address, consent_version, minimum_age
     ) values ($1, 'Admin fixture', $2, date '2026-12-06', time '11:00', 2,
               '2026-01-01T00:00:00Z', 'fixture@example.com', 'zz-v1', 18)
     on conflict (slug) do nothing`,
    [EVENT, RACE],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
     select e.id, f.code, f.label, f.price, f.ea
       from entries.events e
       cross join (values ('affiliated', 'Affiliated', 1500, true),
                          ('unaffiliated', 'Unaffiliated', 1700, false))
                  as f (code, label, price, ea)
      where e.slug = $1
     on conflict (event_id, code) do nothing`,
    [EVENT],
  );

  // One paid entry with a medical note and an England Athletics number, and one live pending
  // hold without either. Two purchases against a capacity of two, so `taken` is exercised.
  await query(
    `insert into entries.entry_purchases (
       id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
       consents, consent_version, hold_expires_at, paid_at
     )
     select $2::uuid, e.id, 'paid', 1500, f.id, 'paid@example.com', 'Paid Person',
            '{"entryTerms":true,"medical":true}'::jsonb, 'zz-v1',
            now() + interval '31 minutes', now()
       from entries.events e
       join entries.fees f on f.event_id = e.id and f.code = 'affiliated'
      where e.slug = $1
     on conflict (id) do nothing`,
    [EVENT, PURCHASE_PAID],
  );

  await query(
    `insert into entries.entry_purchases (
       id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
       consents, consent_version, hold_expires_at
     )
     select $2::uuid, e.id, 'pending', 1700, f.id, 'pending@example.com', 'Pending Person',
            '{"entryTerms":true,"medical":false}'::jsonb, 'zz-v1',
            now() + interval '31 minutes'
       from entries.events e
       join entries.fees f on f.event_id = e.id and f.code = 'unaffiliated'
      where e.slug = $1
     on conflict (id) do nothing`,
    [EVENT, PURCHASE_PENDING],
  );

  await query(
    `insert into entries.entrants (
       id, purchase_id, first_name, last_name, date_of_birth, gender, club, ea_number,
       emergency_contact_name, emergency_contact_phone
     ) values
       ($1::uuid, $2::uuid, 'Paid', 'Person', date '1986-12-06', 'female',
        'Fixture AC', '1234567', 'Kin One', '0117 496 0001'),
       ($3::uuid, $4::uuid, 'Pending', 'Person', date '1999-01-01', 'male',
        null, null, 'Kin Two', '0117 496 0002')
     on conflict (id) do nothing`,
    [ENTRANT_PAID, PURCHASE_PAID, ENTRANT_PENDING, PURCHASE_PENDING],
  );

  await query(
    `insert into entries.entrant_medical (entrant_id, notes)
     values ($1::uuid, 'Fabricated note — nut allergy')
     on conflict (entrant_id) do nothing`,
    [ENTRANT_PAID],
  );

  // Sequential, not parallel — each signUp/confirm/signIn round trip is cheap, and running
  // them concurrently would race the confirmation update against whichever signUp it belongs
  // to. `identity.test.ts` makes the same note for the same reason.
  nnAdmin = await fixturePerson(NN_ADMIN_EMAIL, ['nn-admin']);
  member = await fixturePerson(MEMBER_EMAIL, []);
}, 30_000);

afterAll(async () => {
  await connected;
  await query(
    'delete from entries.entry_purchases where event_id in (select id from entries.events where slug = $1)',
    [EVENT],
  );
  await query('delete from entries.events where slug = $1', [EVENT]);
  await query('delete from entries.admin_keys where name = any($1::text[])', [
    [ACTOR, REVOKED_ACTOR],
  ]);
  await query('delete from entries.admin_audit where actor = any($1::text[])', [
    [ACTOR, REVOKED_ACTOR, nnAdmin?.id, member?.id].filter(Boolean),
  ]);
  // Cascades through identity.people and identity.role_grants — identity.people.id references
  // auth.users(id) on delete cascade.
  await query('delete from auth.users where email = any($1::text[])', [PEOPLE_EMAILS]);
  // **Back to null, which refuses everything.** Left running even if the suite failed.
  await query(
    `update entries.webhook_secrets set key_sha256 = null where name = 'admin'`,
  );
  await db.end();
});

// -----------------------------------------------------------------------------------------
// The door
// -----------------------------------------------------------------------------------------

describe('the admin key is what makes the anon grant safe', () => {
  // **These are the assertions this whole slice rests on.** Every function below is granted to
  // `anon`, whose key is published in page source, because there is no other role a Worker can
  // reach Postgres as. If one of these starts passing, the club's entry list is readable by
  // anybody who can open the page source.

  const withoutKey: [string, Record<string, unknown>][] = [
    ['admin_sign_in', { p_key: 'wrong', p_person_key: PERSON_KEY }],
    ['admin_entry_list', { p_key: 'wrong', p_event_slug: EVENT }],
    ['admin_interest_list', { p_key: 'wrong' }],
    [
      'admin_entrant_medical',
      { p_key: 'wrong', p_actor: ACTOR, p_entrant_id: ENTRANT_PAID },
    ],
    [
      'admin_export',
      { p_key: 'wrong', p_actor: ACTOR, p_event_slug: EVENT, p_kind: 'start-list' },
    ],
  ];

  for (const [name, args] of withoutKey) {
    it(`${name} refuses a wrong key, and says nothing else`, async () => {
      const data = await rpc(name, args);

      // **The whole answer, asserted as a whole.** `toMatchObject` would pass while the
      // function also handed back an event name, a count or a row — which is exactly the
      // disclosure this is here to prevent.
      expect(data).toEqual({ ok: false, reason: 'unauthorised' });
    });

    it(`${name} refuses a null key`, async () => {
      expect(await rpc(name, { ...args, p_key: null })).toEqual({
        ok: false,
        reason: 'unauthorised',
      });
    });
  }

  it('refuses everything when no digest is installed, which is how it ships', async () => {
    await query(
      `update entries.webhook_secrets set key_sha256 = null where name = 'admin'`,
    );

    // Even the right key. A null digest is the shipped state and it is a refusal, not a
    // wildcard — the failure mode where "not configured" means "open to everybody" is the one
    // worth an assertion of its own.
    expect(
      await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT }),
    ).toEqual({
      ok: false,
      reason: 'unauthorised',
    });

    await query(
      `update entries.webhook_secrets set key_sha256 = $1 where name = 'admin'`,
      [digest(GATE_KEY)],
    );
  });

  it('does not disclose whether an event exists to a caller without the key', async () => {
    // The two answers are identical strings. An event that exists and one that never did are
    // the same refusal, so the key cannot be used to enumerate what is here.
    const real = await rpc('admin_entry_list', { p_key: 'wrong', p_event_slug: EVENT });
    const invented = await rpc('admin_entry_list', {
      p_key: 'wrong',
      p_event_slug: 'zz-no-such-event-at-all',
    });

    expect(real).toEqual(invented);
  });

  it('never lets anybody call the internal helpers', async () => {
    // `admin_key_ok` on its own is an oracle for the key, and `record_admin_action` on its own
    // is a way to forge an audit trail. Both are granted to nobody, exactly as
    // `raise_attention` is, and both are reachable only from the definer functions above.
    for (const [name, args] of [
      ['admin_key_ok', { p_key: GATE_KEY }],
      ['record_admin_action', { p_actor: ACTOR, p_action: 'sign_in', p_detail: {} }],
    ] as const) {
      const { error } = await anon.schema('entries').rpc(name, args);

      // **`42501 permission denied`, and not `PGRST202`.** The distinction matters: PostgREST
      // does put the function in its schema cache and does send the call to Postgres, and
      // Postgres is what refuses it. A `PGRST202` would mean the request never got as far as
      // being denied, which is a refusal nobody has tested.
      expect(error?.code, name).toBe('42501');
    }
  });
});

// -----------------------------------------------------------------------------------------
// Who is signing in
// -----------------------------------------------------------------------------------------

describe('entries.admin_sign_in()', () => {
  it('answers with the handle for a key that is issued and not revoked', async () => {
    expect(
      await rpc('admin_sign_in', { p_key: GATE_KEY, p_person_key: PERSON_KEY }),
    ).toEqual({ ok: true, name: ACTOR });
  });

  it('refuses a revoked key, and says the same thing as for an unknown one', async () => {
    // **One answer for "no such key", "revoked" and "mistyped".** Which of the three it is
    // tells somebody who is guessing more than it tells somebody who fumbled a paste.
    const revoked = await rpc('admin_sign_in', {
      p_key: GATE_KEY,
      p_person_key: REVOKED_KEY,
    });
    const unknown = await rpc('admin_sign_in', {
      p_key: GATE_KEY,
      p_person_key: 'not-a-key-anybody-has',
    });

    expect(revoked).toEqual({ ok: false, reason: 'refused' });
    expect(revoked).toEqual(unknown);
  });

  it('refuses an empty key rather than matching an empty digest', async () => {
    expect(await rpc('admin_sign_in', { p_key: GATE_KEY, p_person_key: '  ' })).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('does not trim the key it is given', async () => {
    // A credential is not a name. Accepting a variant of it would mean two strings open the
    // same door and only one of them was ever written down.
    expect(
      await rpc('admin_sign_in', { p_key: GATE_KEY, p_person_key: ` ${PERSON_KEY} ` }),
    ).toEqual({ ok: false, reason: 'refused' });
  });

  it('stamps last_used_at, which is the only signal a key is in use', async () => {
    await query('update entries.admin_keys set last_used_at = null where name = $1', [
      ACTOR,
    ]);
    await rpc('admin_sign_in', { p_key: GATE_KEY, p_person_key: PERSON_KEY });

    const rows = await query<{ last_used_at: Date | null }>(
      'select last_used_at from entries.admin_keys where name = $1',
      [ACTOR],
    );

    expect(rows[0]?.last_used_at).not.toBeNull();
  });

  it('records the sign-in, and never the key', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);
    await rpc('admin_sign_in', { p_key: GATE_KEY, p_person_key: PERSON_KEY });

    const rows = await query<{ action: string; detail: unknown }>(
      'select action, detail from entries.admin_audit where actor = $1',
      [ACTOR],
    );

    expect(rows).toEqual([{ action: 'sign_in', detail: {} }]);

    // Belt and braces: nothing anywhere in the audit table contains either key.
    const leaked = await query(
      `select 1 from entries.admin_audit where detail::text like '%' || $1 || '%'`,
      [PERSON_KEY],
    );
    expect(leaked).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// What the list says
// -----------------------------------------------------------------------------------------

describe('entries.admin_entry_list()', () => {
  it('returns one row per entrant, whatever the status', async () => {
    const data = (await rpc('admin_entry_list', {
      p_key: GATE_KEY,
      p_event_slug: EVENT,
    })) as { entries: { last_name: string; status: string }[] };

    expect(data.entries.map((entry) => entry.status).sort()).toEqual(['paid', 'pending']);
  });

  it('counts places by the capacity predicate, not by counting paid rows', async () => {
    // A live pending hold takes a place. That is what `create_pending_purchase()` counts, and
    // a page that counted only paid rows would tell a race director there was room there is not.
    const data = (await rpc('admin_entry_list', {
      p_key: GATE_KEY,
      p_event_slug: EVENT,
    })) as { event: { taken: number; capacity: number } };

    expect(data.event).toMatchObject({ taken: 2, capacity: 2 });
  });

  it('gives an age and never a date of birth', async () => {
    // **The assertion that keeps minimisation true for a read.** A category needs an age; a
    // date of birth is a far stronger identifier and this surface has no use for one.
    const data = await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT });
    const serialised = JSON.stringify(data);

    expect(serialised).not.toContain('date_of_birth');
    expect(serialised).not.toContain('1986-12-06');

    const entries = (data as { entries: { last_name: string; age: number }[] }).entries;
    const paid = entries.find(
      (entry) => entry.last_name === 'Person' && entry.age === 40,
    );

    // Forty exactly: born 6 December 1986, race on 6 December 2026. A birthday **on** race day
    // counts, which is the same rule `create_pending_purchase()` enforces the minimum age with.
    expect(paid?.age).toBe(40);
  });

  it('says a medical note exists and never what it says', async () => {
    const data = await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT });

    expect(JSON.stringify(data)).not.toContain('nut allergy');
    expect(JSON.stringify(data)).not.toContain('notes');

    const entries = (data as { entries: { has_medical: boolean }[] }).entries;
    expect(entries.filter((entry) => entry.has_medical)).toHaveLength(1);
  });

  it('carries no email address at all', async () => {
    // Not the entrant's, not the purchaser's. An organiser checking England Athletics numbers
    // or setting out bibs does not need one, and the entries-attention runbook has the query
    // for the rare case somebody must be contacted.
    const data = await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT });

    expect(JSON.stringify(data)).not.toContain('@example.com');
  });

  it('answers no_such_event for a slug that is not one, to a caller who may ask', async () => {
    expect(
      await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: 'zz-nope' }),
    ).toEqual({ ok: false, reason: 'no_such_event' });
  });

  it('writes no audit row — a list render is not an audited action', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);
    await rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT });
    await rpc('admin_interest_list', { p_key: GATE_KEY });

    // A row per page load would grow on every refresh and bury the two entries that matter.
    expect(
      await query('select 1 from entries.admin_audit where actor = $1', [ACTOR]),
    ).toEqual([]);
  });
});

/**
 * The figures the admin page **states**, against the rows this file seeded.
 *
 * Asserted here rather than only in the Worker suite because these are the numbers an organiser
 * acts on, and the interesting property is that **they are computed over every purchase while the
 * row array is capped at the most recent 2,000**. A test that counted the array would agree with
 * the page and with nothing else.
 *
 * Every expectation below is derived from the two purchases in `beforeAll` — one paid affiliated
 * entry at £15 with a medical note, one live unaffiliated hold at £17, against a capacity of two —
 * rather than from a snapshot of what the function happened to return.
 */
describe('the figures on entries.admin_entry_list()', () => {
  interface Figures {
    paid: number;
    over_capacity: number;
    held: number;
    holds_returned: number;
    refunded: number;
    fees_pence: number;
    medical_count: number;
    affiliated: number;
    affiliated_missing_ea: number;
    entries_open_at: string | null;
    entries_close_at: string | null;
    medical_retention: string;
    medical_delete_after: string;
  }

  const figures = async (): Promise<Figures> => {
    const data = (await rpc('admin_entry_list', {
      p_key: GATE_KEY,
      p_event_slug: EVENT,
    })) as { event: Figures };

    return data.event;
  };

  it('breaks the field down the way the legend does', async () => {
    expect(await figures()).toMatchObject({
      paid: 1,
      over_capacity: 0,
      held: 1,
      holds_returned: 0,
      refunded: 0,
    });
  });

  it('counts only paid money, at the price each entry was charged', async () => {
    // £15, not £32. The live hold is somebody halfway through a payment page.
    expect((await figures()).fees_pence).toBe(1500);
  });

  it('counts medical notes without disclosing one', async () => {
    const event = await figures();

    expect(event.medical_count).toBe(1);
    // The count travels; the note does not. It is `admin_entrant_medical()`'s to hand over, and
    // that one writes an audit row in the same transaction.
    expect(JSON.stringify(event)).not.toContain('nut allergy');
  });

  it('counts affiliated claims, and finds none missing a number in this fixture', async () => {
    expect(await figures()).toMatchObject({ affiliated: 1, affiliated_missing_ea: 0 });
  });

  /**
   * **The state the affiliation panel exists to catch — and it is no longer reachable, which is
   * what this test now says.**
   *
   * It used to read: *"this insert succeeding is the assertion… this test is what will fail if
   * somebody later adds the check that makes it unreachable, which is the moment to take the
   * panel off."* Slice G added that check. The row two ordinary PostgREST calls with the
   * published anon key used to produce is now refused, in the function and again by
   * `entrants_obey_their_event`.
   *
   * **The panel stays, and the reason is the one thing a trigger cannot do.** A trigger only ever
   * sees a write, so it says nothing about the rows that were already there — and the four check
   * constraints Slice G added shipped `NOT VALID` precisely because nobody could see production's.
   * Until [the constraints runbook](../../../../docs/delivery/runbooks/entries-constraints.md) has
   * been run, a pre-enforcement row is exactly the thing this count would find, and it is the only
   * thing that would find it.
   *
   * So the test does both halves: the insert is refused the ordinary way, and then the row is
   * written the *only* way it can still exist — as history, with triggers suppressed — to prove
   * the panel still counts it.
   */
  it('refuses an affiliated entry with no number, where the schema once permitted it', async () => {
    const purchase = '0d0d0d0d-0000-4000-8000-0000000000a1';
    const entrant = '0d0d0d0d-0000-4000-8000-0000000000b1';

    await query(
      `insert into entries.entry_purchases (
         id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version, paid_at
       )
       select $2::uuid, e.id, 'paid', 1500, f.id, 'noea@example.com', 'No EA Person',
              '{"entryTerms":true}'::jsonb, 'zz-v1', now()
         from entries.events e
         join entries.fees f on f.event_id = e.id and f.code = 'affiliated'
        where e.slug = $1`,
      [EVENT, purchase],
    );

    const insertEntrant = `insert into entries.entrants (
         id, purchase_id, first_name, last_name, date_of_birth, gender, club, ea_number,
         emergency_contact_name, emergency_contact_phone
       ) values ($1::uuid, $2::uuid, 'No', 'Number', date '1990-01-01', 'female',
                 null, null, 'Kin Three', '0117 496 0003')`;

    try {
      // **This insert being refused is the assertion now.** The trigger ties the number to the
      // fee, so the state the panel counts can no longer be created.
      await expect(query(insertEntrant, [entrant, purchase])).rejects.toMatchObject({
        code: '23514',
      });

      // Then the same row as *history*. `session_replication_role = replica` suppresses user
      // triggers for this connection only — it is how Postgres replays rows that were written
      // under older rules, which is exactly what a pre-enforcement entry is. It cannot leak: it
      // is a session setting, restored below, and it does not touch the check constraints.
      await query('set session_replication_role = replica');
      try {
        await query(insertEntrant, [entrant, purchase]);
      } finally {
        await query('set session_replication_role = origin');
      }

      // **The panel still finds it**, which is why the panel is still on the page.
      expect(await figures()).toMatchObject({
        affiliated: 2,
        affiliated_missing_ea: 1,
      });
    } finally {
      // Scoped to the row this test wrote, so the figures above stay true for every other test in
      // this file whatever order they run in.
      await query('delete from entries.entry_purchases where id = $1::uuid', [purchase]);
    }
  });

  it('reports the entry window as the club has actually decided it', async () => {
    const event = await figures();

    expect(event.entries_open_at).not.toBeNull();
    // **Null, because the club has not decided.** The page says so in those words rather than
    // publishing a closing time nobody chose — a runner arranges a weekend around one of those.
    expect(event.entries_close_at).toBeNull();
  });

  /**
   * The deletion date, from the interval the job enforces.
   *
   * `entries-retention.test.ts` already ties `race.json`'s published *wording* to this column.
   * This ties the **date the admin page states** to the same column, which is the other half: a
   * panel that computed its date from the published sentence would be reading the promise instead
   * of the mechanism, and the two are only equal while that other test passes.
   */
  it('states a deletion date computed from the enforced retention, not the published words', async () => {
    const event = await figures();
    // **`::date`, as the function casts it.** `date + interval` is a *timestamp* in Postgres, so
    // without the cast this compares `2027-01-06` against `2027-01-06 00:00:00` and fails on a
    // difference that is not one. The function's own cast is what keeps a midnight out of a
    // sentence a volunteer reads.
    const rows = await query<{ enforced: string }>(
      `select (event_date + medical_retention)::date::text as enforced
         from entries.events where slug = $1`,
      [EVENT],
    );
    // Indexing an array yields `T | undefined` under this repository's `noUncheckedIndexedAccess`,
    // so the row is named rather than destructured. `./dev check`'s typecheck caught this; running
    // the file through Vitest alone did not, because Vitest does not typecheck.
    const enforced = rows[0]?.enforced;

    expect(event.medical_delete_after).toBe(enforced);
    // The fixture's race is 6 December 2026 and the interval is one month.
    expect(event.medical_delete_after).toBe('2027-01-06');
    expect(event.medical_retention).toBe('1 mon');
  });
});

describe('entries.admin_interest_list()', () => {
  it('shows a withheld consent rather than filtering the row out', async () => {
    // **The one place in this surface an email address appears**, and the reason is the club's
    // promise of one email when entries open. A row that says no must be visible, because a
    // list somebody is about to email has to be honest about who is not on it.
    const data = (await rpc('admin_interest_list', { p_key: GATE_KEY })) as {
      total: number;
      consented: number;
      interest: { consent: boolean }[];
    };

    expect(data.total).toBeGreaterThan(0);
    expect(data.consented).toBeLessThan(data.total);
    expect(data.interest.some((row) => !row.consent)).toBe(true);
  });

  it('needs no grant on intake.nn_interest, which is still insert-only', async () => {
    // The definer function reads the table; the anon role still cannot. If this ever starts
    // returning rows, the interest list is readable by anybody holding the published key.
    const { data, error } = await anon.schema('intake').from('nn_interest').select('*');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------
// Special category data, and the row that says who looked
// -----------------------------------------------------------------------------------------

describe('entries.admin_entrant_medical()', () => {
  it('returns the note, and records the read in the same transaction', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    const data = (await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_PAID,
    })) as { ok: boolean; notes: string };

    expect(data.ok).toBe(true);
    expect(data.notes).toBe('Fabricated note — nut allergy');

    const audit = await query<{ action: string; detail: { entrant_id: string } }>(
      'select action, detail from entries.admin_audit where actor = $1',
      [ACTOR],
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('medical_note');
    expect(audit[0]?.detail.entrant_id).toBe(ENTRANT_PAID);
  });

  it('records the read even when there is no note to find', async () => {
    // **The interesting fact is that somebody went looking**, not what they found. An entrant
    // with no note is one whose separate medical consent was withheld, and a read of that is
    // still a read.
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    const data = (await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_PENDING,
    })) as { ok: boolean; notes: string | null };

    expect(data.ok).toBe(true);
    expect(data.notes).toBeNull();

    const audit = await query<{ detail: { had_note: boolean } }>(
      'select detail from entries.admin_audit where actor = $1',
      [ACTOR],
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail.had_note).toBe(false);
  });

  it('never puts the note itself into the audit row', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);
    await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_PAID,
    });

    const leaked = await query(
      `select 1 from entries.admin_audit where detail::text like '%allergy%'`,
    );

    expect(leaked).toEqual([]);
  });

  it('records an unattributed read rather than failing the read', async () => {
    // **Unreachable through the Worker**, which will not hand on anything that is not a handle
    // — `readAdminSession` re-checks the shape before it returns one. It is asserted because
    // the audit write must never be the thing that fails a read: `admin_audit.actor` is
    // `check (length(trim(actor)) between 1 and 40)`, so a blank actor would fire the
    // constraint and roll the whole transaction back, taking the read with it and leaving no
    // trace that anybody tried.
    //
    // A row saying an unattributed read happened is the louder signal. An earlier version
    // coalesced to an empty string and claimed this property in a comment without having it.
    await query('delete from entries.admin_audit where actor like $1', [
      '(unattributed)',
    ]);

    const data = (await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: null,
      p_entrant_id: ENTRANT_PAID,
    })) as { ok: boolean };

    expect(data.ok).toBe(true);

    const audit = await query<{ actor: string; action: string }>(
      "select actor, action from entries.admin_audit where actor = '(unattributed)'",
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('medical_note');

    // **The sentinel cannot be a handle**, so it can never be confused with a person:
    // `admin_keys.name` is constrained to a slug and parentheses cannot satisfy it.
    await expect(
      query(
        `insert into entries.admin_keys (name, key_sha256)
         values ('(unattributed)', repeat('a', 64))`,
      ),
    ).rejects.toThrow(/admin_keys_name_check/);

    await query("delete from entries.admin_audit where actor = '(unattributed)'");
  });

  it('answers not_found for an entrant that does not exist', async () => {
    const data = await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: '00000000-0000-4000-8000-000000000000',
    });

    expect(data).toEqual({ ok: false, reason: 'not_found' });
  });
});

// -----------------------------------------------------------------------------------------
// The three exports
// -----------------------------------------------------------------------------------------

describe('entries.admin_export()', () => {
  it('gives the England Athletics check numbers and no contact details', async () => {
    const data = (await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'ea',
    })) as { rows: Record<string, unknown>[] };

    expect(data.rows).toHaveLength(1);
    expect(Object.keys(data.rows[0] ?? {}).sort()).toEqual([
      'amount_pence',
      'club',
      'ea_number',
      'fee_label',
      'first_name',
      'last_name',
    ]);
  });

  it('gives the start list an emergency contact and no medical note', async () => {
    const data = (await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'start-list',
    })) as { rows: Record<string, unknown>[] };

    expect(Object.keys(data.rows[0] ?? {}).sort()).toEqual([
      'age',
      'club',
      'emergency_contact_name',
      'emergency_contact_phone',
      'first_name',
      'gender',
      'last_name',
    ]);

    // **The column shape is the minimisation.** A start list does not carry a medical note,
    // and the note is never selected for it — so there is nothing for a caller to discard.
    expect(JSON.stringify(data.rows)).not.toContain('allergy');
  });

  it('gives the medical export the note, and nothing beyond the name and club', async () => {
    const data = (await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'medical',
    })) as { rows: Record<string, unknown>[] };

    expect(data.rows).toHaveLength(1);
    expect(Object.keys(data.rows[0] ?? {}).sort()).toEqual([
      'club',
      'first_name',
      'last_name',
      'notes',
    ]);

    // No emergency contact here. A first aider reading a note does not need one, and the
    // start list is where it belongs.
    expect(JSON.stringify(data.rows)).not.toContain('0117 496');
  });

  it('exports only paid entries, in all three', async () => {
    // A pending hold is somebody halfway through a payment page; an expired one is a place
    // that came back. Neither is a runner, and a start list with either on it sets out bibs
    // for people who are not coming.
    for (const kind of ['ea', 'start-list', 'medical'] as const) {
      const data = (await rpc('admin_export', {
        p_key: GATE_KEY,
        p_actor: ACTOR,
        p_event_slug: EVENT,
        p_kind: kind,
      })) as { rows: { first_name: string }[] };

      expect(
        data.rows.every((row) => row.first_name !== 'Pending'),
        kind,
      ).toBe(true);
    }
  });

  it('records who took what and how many rows, and never the contents', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'start-list',
    });

    const audit = await query<{
      action: string;
      detail: { event: string; kind: string; rows: number };
    }>('select action, detail from entries.admin_audit where actor = $1', [ACTOR]);

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('export');
    expect(audit[0]?.detail).toEqual({ event: EVENT, kind: 'start-list', rows: 1 });
  });

  it('records the medical export under its own action, not as an export with a kind', async () => {
    // **The assertion that makes an access review answerable.** "Who has read medical data" has
    // to find the person who downloaded every note as well as the person who clicked one — and
    // with a single `export` value the query has to know to look inside `detail ->> 'kind'`.
    // The runbook's did not, so the CSV was invisible while the single note was not.
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'medical',
    });

    const audit = await query<{ action: string; detail: { kind: string } }>(
      'select action, detail from entries.admin_audit where actor = $1',
      [ACTOR],
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('medical_export');
    // The kind is still recorded. The action is what makes it findable beside a note read.
    expect(audit[0]?.detail.kind).toBe('medical');
  });

  it('finds both medical reads with one predicate, which is the runbook’s query', async () => {
    // The query in `docs/delivery/runbooks/entries-admin.md`, run against both kinds of read.
    // If this fails, that runbook is answering the wrong question.
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_PAID,
    });
    await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'medical',
    });
    // And one that is not a medical read at all, which must not be caught by it.
    await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: EVENT,
      p_kind: 'start-list',
    });

    const found = await query<{ action: string }>(
      `select action from entries.admin_audit
        where actor = $1 and action in ('medical_note', 'medical_export')
        order by action`,
      [ACTOR],
    );

    expect(found.map((row) => row.action)).toEqual(['medical_export', 'medical_note']);
  });

  it('refuses a kind it does not know, before it reads anything', async () => {
    expect(
      await rpc('admin_export', {
        p_key: GATE_KEY,
        p_actor: ACTOR,
        p_event_slug: EVENT,
        p_kind: 'everything',
      }),
    ).toEqual({ ok: false, reason: 'unknown_kind' });
  });

  it('writes no audit row for a refused export', async () => {
    await query('delete from entries.admin_audit where actor = $1', [ACTOR]);

    await rpc('admin_export', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_event_slug: 'zz-nope',
      p_kind: 'ea',
    });

    expect(
      await query('select 1 from entries.admin_audit where actor = $1', [ACTOR]),
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// The tables the surface added
// -----------------------------------------------------------------------------------------

describe('the two new tables', () => {
  it('constrains a handle to a slug, which is what keeps a name out of the audit', async () => {
    await expect(
      query(
        `insert into entries.admin_keys (name, key_sha256)
         values ('Bindal Shah', repeat('a', 64))`,
      ),
    ).rejects.toThrow(/admin_keys_name_check/);
  });

  it('refuses a key digest that is not one', async () => {
    await expect(
      query(
        `insert into entries.admin_keys (name, key_sha256) values ('zz-bad', 'not-a-digest')`,
      ),
    ).rejects.toThrow(/admin_keys_key_sha256_check/);
  });

  it('refuses an audit action nobody has argued for', async () => {
    await expect(
      query(
        `insert into entries.admin_audit (actor, action) values ('zz-tester', 'deleted_everything')`,
      ),
    ).rejects.toThrow(/admin_audit_action_check/);
  });
});

// -----------------------------------------------------------------------------------------
// The second door: the nn-admin role
// -----------------------------------------------------------------------------------------

/**
 * The four, once, so the refusal tests below walk the whole surface rather than whichever
 * function somebody remembered.
 */
const ROLE_FUNCTIONS: [string, Record<string, unknown>][] = [
  ['entry_list', { p_event_slug: EVENT }],
  ['interest_list', {}],
  ['entrant_medical', { p_entrant_id: ENTRANT_PAID }],
  ['export', { p_event_slug: EVENT, p_kind: 'start-list' }],
];

describe('the nn-admin role is the second door, and it is the only other one', () => {
  // **The refusals are the point, exactly as they are for the key.** These four are granted to
  // `authenticated`, which is a role anybody who registers holds — so if one of these starts
  // passing, every account on the platform can read the club's entry list.

  it.each(ROLE_FUNCTIONS)(
    'entries.%s refuses an anonymous client outright',
    async (name, args) => {
      const { data, error } = await anon.schema('entries').rpc(name, args);

      // **`42501`, and not an envelope.** There is no grant to `anon` on any of the four, so
      // Postgres refuses before the function runs and before `has_role` is consulted. A
      // `{ ok: false }` here would mean the grant had been widened and only the check inside
      // was holding the door — one lock where there should be two.
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
    },
  );

  it.each(ROLE_FUNCTIONS)(
    'entries.%s refuses a signed-in person holding only member',
    async (name, args) => {
      // The whole answer, asserted as a whole — `toMatchObject` would pass while the function
      // also handed back an event name or a count, which is the disclosure this prevents.
      expect(await rpcAs(member, name, args)).toEqual({
        ok: false,
        reason: 'unauthorised',
      });
    },
  );

  // **The super-admin case is in `identity.test.ts`**, which owns the one super-admin this
  // suite may have — see the fixture note at the top of this file for why it cannot be here.

  it.each(ROLE_FUNCTIONS)(
    'entries.%s refuses before it resolves anything, so a refusal discloses nothing',
    async (name, args) => {
      // The same call against a slug and an entrant that do not exist. If the answer differed
      // from the one above, a refusal would be an oracle for what the club is running.
      const nonsense: Record<string, unknown> = { ...args };
      if ('p_event_slug' in nonsense) nonsense.p_event_slug = 'zz-no-such-event-at-all';
      if ('p_entrant_id' in nonsense) {
        nonsense.p_entrant_id = '0a0a0a0a-0000-4000-8000-00000000ffff';
      }

      expect(await rpcAs(member, name, nonsense)).toEqual({
        ok: false,
        reason: 'unauthorised',
      });
    },
  );

  it('refuses a member even while the key path is wide open', async () => {
    // The gate key is installed for the whole of this file. A role-checked function must not
    // care: the two doors are independent, which is what lets one of them be taken away.
    expect(await rpcAs(member, 'entry_list', { p_event_slug: EVENT })).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });
});

describe('what nn-admin may then read, and that it is the same room', () => {
  it('gives entry_list exactly what admin_entry_list gives', async () => {
    // **The strongest assertion in this file, and the reason the read was extracted rather
    // than copied.** Two doors, one room: if these ever diverge, two admin pages disagree
    // about how many people are running, and somebody sets out bibs from the wrong one.
    const throughTheKey = await rpc('admin_entry_list', {
      p_key: GATE_KEY,
      p_event_slug: EVENT,
    });
    const throughTheRole = await rpcAs(nnAdmin, 'entry_list', { p_event_slug: EVENT });

    expect(throughTheRole).toEqual(throughTheKey);
  });

  it('gives interest_list exactly what admin_interest_list gives', async () => {
    const throughTheKey = await rpc('admin_interest_list', { p_key: GATE_KEY });
    const throughTheRole = await rpcAs(nnAdmin, 'interest_list');

    expect(throughTheRole).toEqual(throughTheKey);
  });

  it('answers no_such_event for a slug that is not one, to a caller who may ask', async () => {
    expect(
      await rpcAs(nnAdmin, 'entry_list', { p_event_slug: 'zz-no-such-event-at-all' }),
    ).toEqual({ ok: false, reason: 'no_such_event' });
  });

  it('gives an age and never a date of birth', async () => {
    // Minimisation does not depend on which door was used to get in.
    const answer = (await rpcAs(nnAdmin, 'entry_list', { p_event_slug: EVENT })) as {
      entries: Record<string, unknown>[];
    };

    expect(JSON.stringify(answer)).not.toContain('date_of_birth');
    expect(answer.entries.every((entry) => typeof entry.age === 'number')).toBe(true);
  });

  it('carries no email address at all', async () => {
    expect(
      JSON.stringify(await rpcAs(nnAdmin, 'entry_list', { p_event_slug: EVENT })),
    ).not.toContain('@example.com');
  });

  it('refuses a kind it does not know, before it reads anything', async () => {
    expect(
      await rpcAs(nnAdmin, 'export', { p_event_slug: EVENT, p_kind: 'everything' }),
    ).toEqual({ ok: false, reason: 'unknown_kind' });
  });
});

describe('the audit trail names a uuid now, and keeps the handles it already had', () => {
  it('writes exactly one audit row for a medical read, with the caller’s uuid', async () => {
    await query('delete from entries.admin_audit where actor = $1', [nnAdmin.id]);

    const note = (await rpcAs(nnAdmin, 'entrant_medical', {
      p_entrant_id: ENTRANT_PAID,
    })) as { ok: boolean; notes: string };

    expect(note.ok).toBe(true);
    expect(note.notes).toContain('nut allergy');

    const audit = await query<{ action: string; detail: Record<string, unknown> }>(
      'select action, detail from entries.admin_audit where actor = $1',
      [nnAdmin.id],
    );

    // **Exactly one**, not "at least one" — the read and the record of it are the same
    // statement, and a second row would mean the wrapper and the helper were both writing.
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('medical_note');
    expect(audit[0]?.detail.entrant_id).toBe(ENTRANT_PAID);
    // Never the note itself.
    expect(JSON.stringify(audit[0]?.detail)).not.toContain('nut allergy');
  });

  it('writes the actor as a uuid the caller could not have chosen', async () => {
    // `auth.uid()`, read inside the function, rather than a `p_actor` argument. There is no
    // argument to pass — which is the property, not the omission.
    const rows = await query<{ actor: string }>(
      'select actor from entries.admin_audit where actor = $1',
      [nnAdmin.id],
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.actor).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // 36 characters, inside `length(trim(actor)) between 1 and 40`. No column migration needed.
    expect(rows[0]?.actor).toHaveLength(36);
  });

  it('writes no audit row for a refused read', async () => {
    await query('delete from entries.admin_audit where actor = $1', [member.id]);

    await rpcAs(member, 'entrant_medical', { p_entrant_id: ENTRANT_PAID });
    await rpcAs(member, 'export', { p_event_slug: EVENT, p_kind: 'medical' });

    const audit = await query('select id from entries.admin_audit where actor = $1', [
      member.id,
    ]);

    expect(audit).toEqual([]);
  });

  it('finds both identity schemes with the runbook’s one query', async () => {
    // **Mixed values in one column is what a migration between identity schemes looks like.**
    // The rows written under the key scheme keep their handles; the rows written under the role
    // scheme carry a uuid. The runbook's "who has read medical data" query must return both, or
    // six months of audit becomes unreadable the day the key scheme is retired.
    await query('delete from entries.admin_audit where actor = any($1::text[])', [
      [ACTOR, nnAdmin.id],
    ]);

    await rpc('admin_entrant_medical', {
      p_key: GATE_KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_PAID,
    });
    await rpcAs(nnAdmin, 'export', { p_event_slug: EVENT, p_kind: 'medical' });

    const found = await query<{ actor: string; action: string }>(
      `select actor, action from entries.admin_audit
        where action in ('medical_note', 'medical_export')
          and actor = any($1::text[])
        order by action`,
      [[ACTOR, nnAdmin.id]],
    );

    expect(found).toEqual([
      { actor: nnAdmin.id, action: 'medical_export' },
      { actor: ACTOR, action: 'medical_note' },
    ]);
  });
});

describe('the key path is untouched, which is what makes this expand-only', () => {
  it('still answers a wrong key with the same whole answer', async () => {
    expect(
      await rpc('admin_entry_list', { p_key: 'wrong', p_event_slug: EVENT }),
    ).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });

  it('is not reachable at all by a signed-in caller, even one holding nn-admin', async () => {
    // **`42501`, and it is a stronger separation than the one this test was written to
    // assert.** The key-gated four are granted to `anon` and to nothing else, and
    // `authenticated` does not inherit `anon`'s grants — so a signed-in person cannot present
    // a key to these functions at all, right or wrong. The two doors do not blend into one
    // that opens on either, which is exactly what makes retiring the key scheme thinkable.
    const { data, error } = await nnAdmin.client
      .schema('entries')
      .rpc('admin_entry_list', { p_key: GATE_KEY, p_event_slug: EVENT });

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('keeps every existing signature exactly as it was', async () => {
    // **The assertion behind "the key path keeps working".** A renamed or reordered argument
    // is the one change that would break the deployed Worker in the window between a migration
    // and a Cloudflare deploy, and it is invisible to every behavioural test above.
    const signatures = await query<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_arguments(p.oid) as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
          and p.proname in (
            'admin_entry_list', 'admin_interest_list', 'admin_entrant_medical', 'admin_export'
          )
        order by p.proname`,
    );

    expect(signatures).toEqual([
      {
        proname: 'admin_entrant_medical',
        args: 'p_key text, p_actor text, p_entrant_id uuid',
      },
      { proname: 'admin_entry_list', args: 'p_key text, p_event_slug text' },
      {
        proname: 'admin_export',
        args: 'p_key text, p_actor text, p_event_slug text, p_kind text',
      },
      { proname: 'admin_interest_list', args: 'p_key text' },
    ]);
  });
});
