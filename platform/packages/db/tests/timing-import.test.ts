import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Getting an entry list into a timing event — who may, who may not, and what a second import
 * is allowed to change.
 *
 * ## Why every test here attempts the bypass
 *
 * `entries-rules.test.ts` established the shape and it holds for the same reason: **a Postgres
 * error is not a refusal.** A broken function refuses everybody, which reads as every rule
 * holding at once. So each test asserts the **specific** reason string or error code, never
 * merely that something failed.
 *
 * Four callers, because the interesting one is the third:
 *
 *   * **anonymous** — the shape a script with the published anon key takes;
 *   * **signed in holding nothing** — what everybody who registers is;
 *   * ⚠️ **signed in holding `timing-marshal`** — genuinely timing staff, on the timing
 *     system, and still refused. That role holds exactly one permission and importing is not
 *     it, so this is the test that proves the door is the *permission* rather than the schema;
 *   * **signed in holding `timing-admin`** — the one that should get in.
 *
 * ## Fixtures
 *
 * Events prefixed `zzimport-`, and **none of them is a running of `nn`** — so nothing here
 * touches the row `/nn/<year>/results/` reads or anything the site's front door resolves.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const PASSWORD = 'correct-horse-battery-staple-202';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const SOLO = 'zzimport-solo';
const FIXTURE_SLUGS = [SOLO, 'zzimport-second', 'zzimport-relay'];
const FIXTURE_EMAILS = [
  'zzimport-nothing@example.com',
  'zzimport-marshal@example.com',
  'zzimport-admin@example.com',
];

const db = new Client({ connectionString: LOCAL_DB });

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let holdingNothing: SupabaseClient;
let marshal: SupabaseClient;
let admin: SupabaseClient;

async function query<T extends object>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

/**
 * Signs a fixture person up through the real endpoint and confirms the address the way a
 * mailbox click would — `entries-tester.test.ts`'s helper, for its reason: going through
 * `signUp()` exercises `identity.handle_new_user()`, so the person ends up with the row and
 * the default grant a real account has rather than one this file invented.
 */
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

async function removeFixtures(): Promise<void> {
  await query(`delete from timing.events where slug = any($1::text[])`, [FIXTURE_SLUGS]);
  await query('delete from auth.users where email = any($1::text[])', [FIXTURE_EMAILS]);
}

/**
 * The shape `parseRegistrationCsv` produces once it has minimised the file — declared rather
 * than inferred, so a test that pushes a second runner onto a row is not fighting a type
 * narrowed from the first literal.
 */
type ImportRunner = {
  leg: number;
  firstname: string;
  lastname: string;
  gender: string | null;
  email: string | null;
  club_name: string | null;
  age_on_day: number | null;
  is_captain: boolean;
};

type ImportRow = {
  purchase_order_id: string;
  csv_row_index: number;
  name: string | null;
  category: string | null;
  entry_type: string | null;
  runners: ImportRunner[];
};

/** One solo team, the shape `parseRegistrationCsv` produces once it has minimised the file. */
function soloRows(): ImportRow[] {
  return [
    {
      purchase_order_id: 'PO-1',
      csv_row_index: 1,
      name: null,
      category: 'senior',
      entry_type: 'affiliated',
      runners: [
        {
          leg: 1,
          firstname: 'Ada',
          lastname: "O'Hara",
          gender: 'F',
          email: 'ada@example.com',
          club_name: 'Southville',
          age_on_day: 34,
          is_captain: true,
        },
      ],
    },
    {
      purchase_order_id: 'PO-2',
      csv_row_index: 2,
      name: null,
      category: 'vet',
      entry_type: 'unaffiliated',
      runners: [
        {
          leg: 1,
          firstname: 'Bram',
          lastname: 'Vale',
          gender: 'M',
          email: 'bram@example.com',
          club_name: null,
          age_on_day: 51,
          is_captain: true,
        },
      ],
    },
  ];
}

beforeAll(async () => {
  await db.connect();
  await removeFixtures();

  const nothing = await fixturePerson(FIXTURE_EMAILS[0]!);
  holdingNothing = nothing.client;

  const marshalPerson = await fixturePerson(FIXTURE_EMAILS[1]!);
  await grant(marshalPerson.id, 'timing-marshal');
  marshal = marshalPerson.client;

  const adminPerson = await fixturePerson(FIXTURE_EMAILS[2]!);
  await grant(adminPerson.id, 'timing-admin');
  admin = adminPerson.client;
}, 60_000);

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

describe('who may set up a race for timing', () => {
  it('refuses an anonymous caller at the grant, before the permission is ever asked', async () => {
    const { error } = await anon.schema('timing').rpc('create_event', {
      p_slug: SOLO,
      p_name: 'Should never exist',
      p_format: 'solo',
      p_start_at: '2026-11-01T11:00:00Z',
    });

    // 42501 is "permission denied for function" — the grant, not the function's own check.
    expect(error?.code).toBe('42501');
  });

  it('refuses somebody signed in holding nothing', async () => {
    const { data, error } = await holdingNothing.schema('timing').rpc('create_event', {
      p_slug: SOLO,
      p_name: 'Should never exist',
      p_format: 'solo',
      p_start_at: '2026-11-01T11:00:00Z',
    });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: 'refused' });
  });

  it('refuses a marshal, who is timing staff and still may not', async () => {
    // The point of the whole permission model in one assertion: `timing-marshal` is on the
    // timing system, holds a `timing.*` permission, and is refused because it is not this one.
    const { data } = await marshal.schema('timing').rpc('create_event', {
      p_slug: SOLO,
      p_name: 'Should never exist',
      p_format: 'solo',
      p_start_at: '2026-11-01T11:00:00Z',
    });

    expect(data).toEqual({ ok: false, reason: 'refused' });
  });

  it('lets a timing admin create one, once', async () => {
    const { data } = await admin.schema('timing').rpc('create_event', {
      p_slug: SOLO,
      p_name: 'Import fixture, solo',
      p_format: 'solo',
      p_start_at: '2026-11-01T11:00:00Z',
    });

    expect((data as { ok: boolean }).ok).toBe(true);

    // **A second call is refused rather than treated as an edit.** `format` decides how every
    // bib derives and which prizes exist, so an upsert on the slug would rewrite the meaning
    // of rows nobody re-checked.
    const again = await admin.schema('timing').rpc('create_event', {
      p_slug: SOLO,
      p_name: 'A different name',
      p_format: 'relay',
      p_start_at: '2027-01-01T09:00:00Z',
    });

    expect(again.data).toEqual({ ok: false, reason: 'event_exists' });

    const [row] = await query<{ name: string; format: string }>(
      `select name, format from timing.events where slug = $1`,
      [SOLO],
    );
    expect(row).toEqual({ name: 'Import fixture, solo', format: 'solo' });
  });

  it('refuses a format that is not one of the two', async () => {
    const { data } = await admin.schema('timing').rpc('create_event', {
      p_slug: 'zzimport-second',
      p_name: 'Neither',
      p_format: 'duathlon',
      p_start_at: '2026-11-01T11:00:00Z',
    });

    expect(data).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('what the published anon key opens', () => {
  it('holds execute on none of the three, so the permission is never even reached', async () => {
    // **The grant is the outer door and the permission is the inner one.** `entries.test.ts`
    // makes this a decision somebody takes in a diff rather than a side effect; the same
    // applies here, and the anon key is printed in every page's source.
    const importAttempt = await anon
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: [] });
    expect(
      importAttempt.error?.code,
      'anon must not execute timing.import_registration',
    ).toBe('42501');

    const rosterAttempt = await anon
      .schema('timing')
      .rpc('event_roster', { p_event_slug: SOLO });
    expect(rosterAttempt.error?.code, 'anon must not execute timing.event_roster').toBe(
      '42501',
    );
  });
});

describe('importing the entry list', () => {
  it('refuses everybody who may not, and writes nothing', async () => {
    for (const [who, client] of [
      ['holding nothing', holdingNothing],
      ['a marshal', marshal],
    ] as const) {
      const { data } = await client
        .schema('timing')
        .rpc('import_registration', { p_event_slug: SOLO, p_rows: soloRows() });

      expect(data, who).toEqual({ ok: false, reason: 'refused' });
    }

    const counted = await query<{ count: string }>(
      `select count(*)::text as count from timing.teams t
         join timing.events e on e.id = t.event_id where e.slug = $1`,
      [SOLO],
    );
    expect(counted[0]!.count).toBe('0');
  });

  it('lands the teams and their runners', async () => {
    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: soloRows() });

    expect(data).toMatchObject({
      ok: true,
      teams_created: 2,
      teams_updated: 0,
      runners_written: 2,
      runners_removed: 0,
    });

    const rows = await query<{ purchase_order_id: string; lastname: string }>(
      `select t.purchase_order_id, r.lastname
         from timing.teams t
         join timing.runners r on r.team_id = t.id
         join timing.events e on e.id = t.event_id
        where e.slug = $1 order by t.csv_row_index`,
      [SOLO],
    );

    // The apostrophe is deliberate — a fixture with only tidy names proves less.
    expect(rows).toEqual([
      { purchase_order_id: 'PO-1', lastname: "O'Hara" },
      { purchase_order_id: 'PO-2', lastname: 'Vale' },
    ]);
  });

  it('refuses an event that is not there', async () => {
    const { data } = await admin.schema('timing').rpc('import_registration', {
      p_event_slug: 'zzimport-absent',
      p_rows: soloRows(),
    });

    expect(data).toEqual({ ok: false, reason: 'no_such_event' });
  });

  it('is a no-op the second time, anchored on purchase_order_id', async () => {
    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: soloRows() });

    expect(data).toMatchObject({ ok: true, teams_created: 0, teams_updated: 2 });

    const counted = await query<{ count: string }>(
      `select count(*)::text as count from timing.teams t
         join timing.events e on e.id = t.event_id where e.slug = $1`,
      [SOLO],
    );
    expect(counted[0]!.count).toBe('2');
  });

  it('never overwrites a number somebody is already wearing', async () => {
    // ⚠️ **The test this whole file exists for.** Bibs are assigned after the import, and a
    // re-import to correct a spelling must not renumber a field whose numbers are printed and
    // pinned on — nor overwrite a race-day fact a human recorded.
    await query(
      `update timing.teams set team_number = '01', bib_leg1 = '0311', race_status = 'dnf'
         where purchase_order_id = 'PO-1'
           and event_id = (select id from timing.events where slug = $1)`,
      [SOLO],
    );

    const corrected = soloRows();
    corrected[0]!.runners[0]!.firstname = 'Adamma';

    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: corrected });
    expect((data as { ok: boolean }).ok).toBe(true);

    const [row] = await query<{
      team_number: string | null;
      bib_leg1: string | null;
      race_status: string | null;
      firstname: string;
    }>(
      `select t.team_number, t.bib_leg1, t.race_status, r.firstname
         from timing.teams t join timing.runners r on r.team_id = t.id
        where t.purchase_order_id = 'PO-1'
          and t.event_id = (select id from timing.events where slug = $1)`,
      [SOLO],
    );

    expect(row).toEqual({
      team_number: '01',
      bib_leg1: '0311',
      race_status: 'dnf',
      // The correction the file *is* authoritative about did land.
      firstname: 'Adamma',
    });
  });

  it('refuses the whole import when a row carries no purchase_order_id', async () => {
    const before = await query<{ count: string }>(
      `select count(*)::text as count from timing.teams t
         join timing.events e on e.id = t.event_id where e.slug = $1`,
      [SOLO],
    );

    const rows = soloRows();
    rows.push({
      purchase_order_id: '',
      csv_row_index: 3,
      name: null,
      category: 'senior',
      entry_type: 'affiliated',
      runners: [
        {
          leg: 1,
          firstname: 'Cy',
          lastname: 'Nolan',
          gender: 'M',
          email: 'cy@example.com',
          club_name: null,
          age_on_day: 29,
          is_captain: true,
        },
      ],
    });

    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: rows });

    expect(data).toEqual({ ok: false, reason: 'missing_purchase_order_id' });

    // **Nothing was half-applied.** A partly-imported field is worse than none, because
    // nobody can tell by looking which half landed.
    const after = await query<{ count: string }>(
      `select count(*)::text as count from timing.teams t
         join timing.events e on e.id = t.event_id where e.slug = $1`,
      [SOLO],
    );
    expect(after[0]!.count).toBe(before[0]!.count);
    expect(
      await query<{ one: number }>(
        `select 1 as one from timing.runners where lastname = 'Nolan'`,
      ),
    ).toHaveLength(0);
  });

  it('drops a leg the file no longer carries', async () => {
    const pair = soloRows();
    pair[1]!.runners.push({
      leg: 2,
      firstname: 'Del',
      lastname: 'Rowe',
      gender: 'F',
      email: 'del@example.com',
      club_name: null,
      age_on_day: 41,
      is_captain: false,
    });

    await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: pair });
    expect(
      await query(`select 1 from timing.runners where lastname = 'Rowe'`),
    ).toHaveLength(1);

    // Corrected back down to one runner: the second must not be left behind, still deriving a
    // bib nobody is wearing.
    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: soloRows() });

    expect(data).toMatchObject({ ok: true, runners_removed: 1 });
    expect(
      await query(`select 1 from timing.runners where lastname = 'Rowe'`),
    ).toHaveLength(0);
  });
});

describe('the minimisation boundary', () => {
  it('ignores personal data the file should never have carried this far', async () => {
    // ⚠️ **The opposite bypass**, the shape `entries-rules.test.ts` uses for England Athletics
    // numbers: post the fields straight at PostgREST with a caller who *is* allowed to import,
    // and assert they reach no column. The parser drops them at the boundary; this proves the
    // database would not have stored them even if it had not.
    const rows = soloRows();
    Object.assign(rows[0]!.runners[0]!, {
      date_of_birth: '1992-04-17',
      address: '1 Nowhere Street',
      phone: '07700900123',
      emergency_contact_name: 'Nobody',
      emergency_contact_phone: '07700900124',
      medical_notes: 'none',
    });

    const { data } = await admin
      .schema('timing')
      .rpc('import_registration', { p_event_slug: SOLO, p_rows: rows });
    expect((data as { ok: boolean }).ok).toBe(true);

    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'timing' and table_name = 'runners'`,
    );
    const names = columns.map((c) => c.column_name);

    for (const forbidden of [
      'date_of_birth',
      'dob',
      'address',
      'phone',
      'emergency_contact_name',
      'emergency_contact_phone',
      'medical_notes',
    ]) {
      expect(names, `timing.runners must not hold ${forbidden}`).not.toContain(forbidden);
    }

    // And the age that *was* kept is the one the parser computed.
    const [row] = await query<{ age_on_day: number }>(
      `select r.age_on_day from timing.runners r
         join timing.teams t on t.id = r.team_id
        where t.purchase_order_id = 'PO-1'
          and t.event_id = (select id from timing.events where slug = $1)`,
      [SOLO],
    );
    expect(row!.age_on_day).toBe(34);
  });
});

describe('reading back what landed', () => {
  it('answers null to everybody who may not read it', async () => {
    for (const [who, client] of [
      ['holding nothing', holdingNothing],
      ['a marshal', marshal],
    ] as const) {
      const { data } = await client
        .schema('timing')
        .rpc('event_roster', { p_event_slug: SOLO });

      // `null` rather than an exception, so a refusal and an absent race are indistinguishable.
      expect(data, who).toBeNull();
    }
  });

  it('answers null for a race that does not exist, exactly as for a refusal', async () => {
    const { data } = await admin
      .schema('timing')
      .rpc('event_roster', { p_event_slug: 'zzimport-absent' });

    expect(data).toBeNull();
  });

  it("gives a timing admin the roster, in the file's own row order", async () => {
    const { data } = await admin
      .schema('timing')
      .rpc('event_roster', { p_event_slug: SOLO });

    const roster = data as {
      event: { slug: string; format: string };
      teams: { purchase_order_id: string; runners: { lastname: string }[] }[];
    };

    expect(roster.event).toMatchObject({ slug: SOLO, format: 'solo' });
    expect(roster.teams.map((t) => t.purchase_order_id)).toEqual(['PO-1', 'PO-2']);
    expect(roster.teams[0]!.runners[0]!.lastname).toBe("O'Hara");
  });
});
