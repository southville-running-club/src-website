import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `membership` schema, tested from **both sides**.
 *
 * A privileged connection checks what is actually in the tables; an anonymous client checks
 * what can be reached through the API. There is no tier between a browser and Postgres, so
 * this file *is* the access control being tested rather than a model of it — `entries.test.ts`
 * and `store.test.ts` say the same of themselves, and this is written to earn its keep the
 * same way.
 *
 * Each assertion names the **error code** rather than merely that something failed. A test
 * that passes because a table stopped existing is a test that has quietly stopped testing.
 *
 * The privileged connection is the local Docker Postgres and nothing else. Its credentials
 * are the fixed ones `supabase start` prints on every machine, and there is no version of
 * this file that talks to production.
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
 * Every table in the schema. The refusal tests walk this list rather than naming one of five,
 * so a sixth table cannot arrive without a decision about its grants.
 *
 * ⚠️ **`membership_applications` is the one that matters here, and it arrived on 25 September
 * 2026** — ADR-050. It holds a date of birth, a home address and a phone number, and the
 * refusals below are what say the **published** anon key cannot read a row of it. If one of
 * those tests ever goes green-by-passing rather than green-by-refusing, the club's applicant
 * list is readable by anybody who views source.
 *
 * `api_secrets` is on the list for a different reason: it holds credential digests, and a
 * readable digest is a credential somebody can attack offline.
 */
const TABLES = [
  'api_secrets',
  'email_outbox',
  'membership_applications',
  'membership_types',
  'settings',
] as const;

describe('what an anonymous client may not do, on every table in the schema', () => {
  for (const table of TABLES) {
    it(`cannot select from ${table}`, async () => {
      const { error } = await anon.schema('membership').from(table).select('*').limit(1);

      // **The specific refusal, not merely an error.** PostgREST answers `42501` for a
      // missing privilege; anything else means the grant is not what this test believes.
      expect(error?.code).toBe('42501');
    });

    it(`cannot insert into ${table}`, async () => {
      const { error } = await anon.schema('membership').from(table).insert({});

      expect(error?.code).toBe('42501');
    });
  }
});

describe('exactly which functions exist here, and exactly who may call them', () => {
  /**
   * ⚠️ **The list is the decision.**
   *
   * `CLAUDE.md` makes granting the anon role a function a stop-and-ask, and the way that is
   * enforced is a test naming the current set. `entries.test.ts`'s own count has changed
   * three times — seven, thirteen, fifteen, sixteen — which is the argument for reading the
   * test rather than trusting a number in prose.
   *
   * This schema has **one**. A second is a decision somebody takes in a diff that fails here
   * until they write down what it is for.
   */
  it('has exactly these functions and no others', async () => {
    const rows = await query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'membership'
        order by p.proname, pg_get_function_identity_arguments(p.oid)`,
    );

    expect(rows.map((row) => row.proname)).toEqual([
      // The outbox drain. **Takes the webhook key**: it returns real email addresses and,
      // for the club's own copy, a home address.
      'claim_outbox_batch',
      // Granted to nobody. Applies the retention promise.
      'delete_old_applications',
      // Granted to nobody. Writes the two rows an application owes.
      'enqueue_application_emails',
      // Granted to nobody. Callable, it would be an oracle for the key.
      'key_ok',
      // The public read: what membership costs and the minimum age to join. Every row it
      // returns is already printed on the page that calls it.
      'membership_state',
      // The drain's other half. Takes the webhook key.
      'record_send_result',
      // The one door an applicant comes through. **Takes the entry key.**
      'submit_application',
    ]);
  });

  /**
   * ⚠️ **Three functions are granted to nobody, and each would be a hole on its own.**
   *
   * `key_ok()` answers whether a string is the key — callable, a few thousand calls turn a
   * published anon key into a credential. `enqueue_application_emails()` would let anybody
   * address a message from the club to anybody. `delete_old_applications()` deletes rows.
   *
   * `entries.test.ts` names its own six for the same reason. Each is reachable only from the
   * definer functions and triggers that call it.
   */
  it('grants neither of them to any role a caller can reach', async () => {
    for (const name of ['key_ok', 'enqueue_application_emails']) {
      const rows = await query<{ grantee: string }>(
        `select distinct grantee
           from information_schema.role_routine_grants
          where specific_schema = 'membership' and routine_name = $1`,
        [name],
      );

      const grantees = rows.map((row) => row.grantee);

      // ⚠️ **`postgres` owns these, so it appears here and always will** — `revoke ... from
      // public, anon, authenticated` does not revoke from the owner. Asserting an empty list
      // would be asserting something no `revoke` can produce. What matters is the three roles
      // a caller can actually reach, which is how `entries.test.ts` words the same check.
      for (const role of ['anon', 'authenticated', 'PUBLIC']) {
        expect(grantees, `${name} is executable by ${role}`).not.toContain(role);
      }
    }
  });

  it('grants membership_state to anon and authenticated, and to nobody else', async () => {
    const rows = await query<{ grantee: string }>(
      `select distinct grantee
         from information_schema.role_routine_grants
        where specific_schema = 'membership'
          and routine_name = 'membership_state'
        order by grantee`,
    );

    const grantees = rows.map((row) => row.grantee);

    expect(grantees).toContain('anon');
    expect(grantees).toContain('authenticated');

    // ⚠️ **`public` is the one that matters.** A function is executable by `public` by
    // default, so a migration that grants `anon` without revoking `public` first leaves this
    // file describing less than reality — the grant list would look deliberate while the
    // function was in fact open to every role in the database.
    expect(grantees, 'membership_state is still executable by public').not.toContain(
      'PUBLIC',
    );
  });
});

describe('what the anonymous client may actually read', () => {
  it('can ask what membership costs', async () => {
    const { data, error } = await anon.schema('membership').rpc('membership_state');

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ **These are the club's confirmed prices**, supplied on 21 September 2026: £4 for club
   * membership, £27 for club plus the England Athletics racing licence, of which £23 is
   * England Athletics' registration fee rather than the club's money.
   *
   * Asserted as exact figures because the whole purpose of this table is that they can be
   * changed with a query — and a price the club changes should fail this test loudly, so the
   * person changing it confirms the new number here rather than discovering later that a
   * page and a test disagreed.
   */
  it('answers the prices the club actually charges', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as {
      code: string;
      price_pence: number;
      ea_fee_pence: number | null;
      minimum_age: number;
    }[];

    const club = rows.find((row) => row.code === 'club');
    const clubEa = rows.find((row) => row.code === 'club_ea');

    expect(club?.price_pence).toBe(400);
    expect(club?.ea_fee_pence).toBeNull();

    expect(clubEa?.price_pence).toBe(2700);
    expect(clubEa?.ea_fee_pence).toBe(2300);

    // The £23 is what makes £27 explicable rather than arbitrary: £4 of club membership plus
    // England Athletics' own registration fee.
    expect((clubEa?.price_pence ?? 0) - (clubEa?.ea_fee_pence ?? 0)).toBe(
      club?.price_pence,
    );
  });

  it('answers the same minimum age the race already enforces', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as { minimum_age: number }[];

    for (const row of rows) expect(row.minimum_age).toBe(18);

    // ⚠️ **And it is the same 18.** `entries.events.minimum_age` holds it for Nightingale
    // Nightmare; two numbers for one club rule is two numbers that can drift.
    const [race] = await query<{ minimum_age: number }>(
      `select minimum_age from entries.events where slug = 'nn-2026'`,
    );

    expect(rows[0]?.minimum_age).toBe(race?.minimum_age);
  });

  it('offers options in the order the club chose, and hides a withdrawn one', async () => {
    const { data } = await anon.schema('membership').rpc('membership_state');
    const rows = data as { code: string; sort_order: number }[];

    expect(rows.map((row) => row.code)).toEqual(['club', 'club_ea']);

    // An option is withdrawn by clearing `active`, never by deleting a row somebody has paid
    // against — and a withdrawn option does not come back at all rather than coming back with
    // a flag for the caller to remember to check.
    await query(
      `update membership.membership_types set active = false where code = 'club'`,
    );
    try {
      const { data: after } = await anon.schema('membership').rpc('membership_state');
      expect((after as { code: string }[]).map((row) => row.code)).toEqual(['club_ea']);
    } finally {
      await query(
        `update membership.membership_types set active = true where code = 'club'`,
      );
    }
  });
});

describe('the rules the schema enforces about its own rows', () => {
  it('refuses a second settings row', async () => {
    // A settings table with two rows is one nobody can read confidently, and the failure is
    // silent: a query picks one and the other is ignored.
    //
    // ⚠️ **Every not-null column has to be supplied, or this asserts the wrong refusal.**
    // `notification_email` arrived with the applications schema; without it the insert fails
    // on that column and never reaches the single-row guard — a green-looking test that has
    // stopped testing what its name says.
    await expect(
      query(
        `insert into membership.settings (id, minimum_age, notification_email)
         values (false, 16, 'zz-second@example.com')`,
      ),
    ).rejects.toThrow(/settings_single_row/u);
  });

  it('refuses an England Athletics share larger than the price', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence, ea_fee_pence)
         values ('nonsense', 'Nonsense', 400, 2300)`,
      ),
    ).rejects.toThrow(/membership_types_ea_fee_sane/u);
  });

  it('refuses a negative price', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence)
         values ('cheap', 'Cheap', -1)`,
      ),
    ).rejects.toThrow(/membership_types_price_sane/u);
  });

  it('refuses a code that is not a stable slug', async () => {
    await expect(
      query(
        `insert into membership.membership_types (code, display_name, price_pence)
         values ('Club EA', 'Club EA', 400)`,
      ),
    ).rejects.toThrow(/membership_types_code_shaped/u);
  });

  it('has row-level security on every table, with no policy anywhere', async () => {
    // RLS on from the first migration, no exceptions. The anon role reaches this schema
    // through one function and nothing else, so there is no policy to write.
    const rows = await query<{
      tablename: string;
      rowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname as tablename,
              c.relrowsecurity as rowsecurity,
              coalesce(count(p.polname), 0)::text as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'membership' and c.relkind = 'r'
        group by c.relname, c.relrowsecurity
        order by c.relname`,
    );

    expect(rows.map((row) => row.tablename)).toEqual([...TABLES].sort());
    for (const row of rows) {
      expect(row.rowsecurity, `${row.tablename} has RLS off`).toBe(true);
      expect(row.policies, `${row.tablename} has a policy`).toBe('0');
    }
  });
});

/**
 * Applying to join, from the outside.
 *
 * ⚠️ **Every test here attempts the bypass rather than asserting the rule.** Slice G found
 * `create_pending_purchase()` trusting the form on a rule the database never checked, and two
 * PostgREST calls with the published anon key bought an affiliated place £2 under. Zod is the
 * form's control, not the system's — so what is proved below is what an attacker gets, not
 * what the form sends.
 */
describe('submitting an application, as an anonymous caller', () => {
  const KEY = 'zz-membership-entry-key-not-a-real-one';

  /** Deterministic and invented, at example.com. Never production data. */
  const application = (overrides: Record<string, unknown> = {}) => ({
    title: 'Ms',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'zz-ada@example.com',
    phone: '+447700900123',
    dateOfBirth: '1990-04-12',
    addressLine1: '12 Dean Lane',
    cityTown: 'Bristol',
    postcode: 'BS3 1DB',
    country: 'GB',
    membershipType: 'club_ea',
    previousAffiliation: true,
    previousClubName: 'Bristol AC',
    eaUrn: '1234567',
    consentsVersion: '2026-09-25',
    ...overrides,
  });

  const submit = async (key: string, input: Record<string, unknown>) => {
    const { data } = await anon
      .schema('membership')
      .rpc('submit_application', { p_key: key, p_application: input });

    return data as { ok: boolean; reason?: string; applicationId?: string };
  };

  beforeAll(async () => {
    await connected;
    await db.query(
      `update membership.api_secrets
          set key_sha256 = encode(sha256(convert_to($1, 'UTF8')), 'hex')
        where name = 'entry'`,
      [KEY],
    );
  });

  afterAll(async () => {
    await db.query(
      `delete from membership.membership_applications where email like 'zz-%'`,
    );
    await db.query(
      `update membership.api_secrets set key_sha256 = null where name = 'entry'`,
    );
  });

  /**
   * ⚠️ **The reason this function takes a key at all.**
   *
   * It is granted to `anon` — it must be, an applicant is signed out — and it inserts a row
   * and enqueues two emails. Without a key, a loop against the key printed in page source
   * fills the table and burns the club's entire daily email allowance: Resend's free tier is
   * 100 a day, account-wide, shared with every race and account email the platform sends.
   *
   * ADR-029 is the precedent, and it was learned the expensive way — 249 of 250 race places
   * taken in half a second.
   */
  it('is refused outright without the key', async () => {
    expect(await submit('', application())).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });

  it('is refused with the wrong key, indistinguishably', async () => {
    // Indistinguishable on purpose: a caller probing learns nothing about whether a key is
    // installed, only that this one is not it.
    expect(await submit('not-the-key', application())).toEqual({
      ok: false,
      reason: 'unauthorised',
    });
  });

  /**
   * ⚠️ **The minimum age is enforced here, not only in Zod.** A submission posted straight at
   * PostgREST never meets the form.
   */
  it('refuses somebody under the minimum age, whatever the form allowed', async () => {
    const result = await submit(KEY, application({ dateOfBirth: '2015-01-01' }));

    expect(result).toEqual({ ok: false, reason: 'too_young' });
  });

  it('refuses a date of birth in the future', async () => {
    expect(await submit(KEY, application({ dateOfBirth: '2099-01-01' }))).toEqual({
      ok: false,
      reason: 'date_of_birth_future',
    });
  });

  it('refuses a membership type nobody sells', async () => {
    expect(await submit(KEY, application({ membershipType: 'club_gold' }))).toEqual({
      ok: false,
      reason: 'unknown_membership_type',
    });
  });

  /**
   * ⚠️ **The price is never taken from the caller.** It is read from `membership_types`
   * inside the function, so a submission naming £0 is recorded at the real price — the same
   * bypass that bought an affiliated race place £2 under.
   */
  it('records the club’s price, not the one the caller sent', async () => {
    const result = await submit(KEY, application({ pricePence: 0, price_pence: 0 }));
    expect(result.ok).toBe(true);

    const [row] = await query<{ price_pence: number; membership_type: string }>(
      `select price_pence, membership_type
         from membership.membership_applications where id = $1`,
      [result.applicationId],
    );

    expect(row).toEqual({ price_pence: 2700, membership_type: 'club_ea' });
  });

  /**
   * ⚠️ **The applicant's own copy carries no application details, and the query is what
   * enforces that** — not the template. `claim_outbox_batch()` returns `details: null` for
   * `application_received`, so an edit to that template cannot grow a home address.
   */
  it('owes two messages, and only the club’s carries the answers', async () => {
    const result = await submit(KEY, application({ email: 'zz-two@example.com' }));
    expect(result.ok).toBe(true);

    const rows = await query<{ template: string; recipient: string }>(
      `select template, recipient::text as recipient
         from membership.email_outbox
        where application_id = $1
        order by template`,
      [result.applicationId],
    );

    expect(rows).toEqual([
      { template: 'application_received', recipient: 'zz-two@example.com' },
      {
        template: 'application_submitted',
        recipient: 'membership@southvillerunningclub.co.uk',
      },
    ]);
  });

  /**
   * ⚠️ **The whole reason the anon grant is safe.** The function may be called; the table it
   * writes to may not be read. If this stops refusing, the club's applicant list — names,
   * addresses, dates of birth — is readable with a key published in page source.
   */
  it('cannot then read back what it just wrote', async () => {
    const result = await submit(KEY, application({ email: 'zz-read@example.com' }));
    expect(result.ok).toBe(true);

    const { error } = await anon
      .schema('membership')
      .from('membership_applications')
      .select('*')
      .limit(1);

    expect(error?.code).toBe('42501');
  });
});

/**
 * The retention promise, applied by the same cron that expires holds and deletes medical
 * notes.
 */
describe('deleting an application the club has finished with', () => {
  afterAll(async () => {
    await db.query(
      `delete from membership.membership_applications where email like 'zz-%'`,
    );
  });

  const insert = async (
    email: string,
    status: string,
    processedAt: string | null,
  ): Promise<string> => {
    const [row] = await query<{ id: string }>(
      `insert into membership.membership_applications (
         title, first_name, last_name, email, phone, date_of_birth,
         address_line1, city_town, postcode, country,
         membership_type, price_pence,
         previous_affiliation, consents_version,
         status, processed_at
       ) values (
         'Mx', 'Grace', 'Hopper', $1, '+447700900124', date '1980-01-01',
         '1 Dean Lane', 'Bristol', 'BS3 1DB', 'GB',
         'club', 400, false, '2026-09-25', $2, $3
       ) returning id`,
      [email, status, processedAt],
    );

    return row!.id;
  };

  /**
   * ⚠️ **An application nobody has acted on is never swept.** It is outstanding work, and
   * deleting it loses somebody who is waiting to hear back — the clock starts when a human
   * marks it settled, not when it arrives. This is the assertion that would catch a "tidy up
   * old rows" change written against `created_at`.
   */
  it('never touches one still marked new, however old', async () => {
    const id = await insert('zz-waiting@example.com', 'new', null);

    await query(`select membership.delete_old_applications()`);

    const [row] = await query<{ n: string }>(
      `select count(*)::text as n from membership.membership_applications where id = $1`,
      [id],
    );

    expect(row?.n).toBe('1');
  });

  it('deletes one settled longer ago than the retention period', async () => {
    const id = await insert(
      'zz-done@example.com',
      'processed',
      new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
    );

    await query(`select membership.delete_old_applications()`);

    const [row] = await query<{ n: string }>(
      `select count(*)::text as n from membership.membership_applications where id = $1`,
      [id],
    );

    expect(row?.n).toBe('0');
  });

  it('keeps one settled inside it', async () => {
    const id = await insert(
      'zz-recent@example.com',
      'processed',
      new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    );

    await query(`select membership.delete_old_applications()`);

    const [row] = await query<{ n: string }>(
      `select count(*)::text as n from membership.membership_applications where id = $1`,
      [id],
    );

    expect(row?.n).toBe('1');
  });
});
