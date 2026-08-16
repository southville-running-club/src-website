import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

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
});

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
    [ACTOR, REVOKED_ACTOR],
  ]);
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
