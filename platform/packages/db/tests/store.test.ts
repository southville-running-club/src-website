import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `store` schema, tested from **both sides**.
 *
 * A privileged connection checks what is actually in the tables; an anonymous client checks
 * what can be reached through the API. There is no tier between a browser and Postgres, so
 * this file *is* the access control being tested rather than a model of it.
 *
 * **The refusals are the point of this file.** `entries.test.ts` says the same of itself and
 * has now outlived four slices; this one is written to do the same. If a refusal below ever
 * starts failing, something granted a table privilege that the **published** anon key would
 * then carry — and the two tables it would hurt most are named in `TABLES` below.
 *
 * Each assertion names the **error code**, not merely that something failed. A test that
 * passes because a table stopped existing is a test that has quietly stopped testing.
 *
 * The privileged connection is the local Docker Postgres and nothing else. Its credentials
 * are the fixed ones `supabase start` prints on every machine, and there is no version of this
 * file that talks to production.
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
 * Every table in the schema. The refusal tests walk this list rather than naming three of
 * five, so a sixth table cannot arrive without a decision about its grants.
 *
 * **`api_secrets` is the one that would hurt most.** It holds the digest of the key that lets
 * anything hold a ticket and the digest of the key that lets anything be marked paid. If its
 * refusal starts failing, those digests are readable with a key published in page source.
 *
 * **`email_outbox` is the second**: it is a list of the club's members' email addresses.
 */
const TABLES = [
  'socials',
  'ticket_types',
  'ticket_purchases',
  'api_secrets',
  'email_outbox',
] as const;

afterAll(async () => {
  await connected;
  await db.end();
});

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

describe('what an anonymous client may not do, on every table in the schema', () => {
  for (const table of TABLES) {
    it(`refuses to select from store.${table}`, async () => {
      const { error } = await anon.schema('store').from(table).select('*').limit(1);

      // **The specific refusal, not merely an error.** PostgREST answers `42501` for a
      // permission failure; a broken schema would answer something else entirely, and a test
      // that accepts any error would pass on a schema that had ceased to exist.
      expect(error?.code).toBe('42501');
    });

    it(`refuses to insert into store.${table}`, async () => {
      const { error } = await anon.schema('store').from(table).insert({});

      expect(error?.code).toBe('42501');
    });
  }
});

describe('exactly which functions exist here, and exactly who may call them', () => {
  // **The list is the decision.** CLAUDE.md makes "an eighth function granted to anon" a
  // stop-and-ask; this is what forces that decision to be taken in a diff somebody reviews
  // rather than as a side effect of a slice. `entries.test.ts` earns its keep the same way,
  // and its own count has already changed three times.

  it('has exactly these functions and no others', async () => {
    const rows = await query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'store'
        order by p.proname, pg_get_function_identity_arguments(p.oid)`,
    );

    expect(rows.map((row) => row.proname)).toEqual([
      // The outbox drain's two, both keyed.
      'attach_checkout_session',
      'claim_outbox_batch',
      'create_pending_purchase',
      // **The two trigger functions, and neither is callable by anybody.** One issues the
      // readable reference on `before insert`; the other writes the row saying the club owes
      // somebody an email, in the same transaction as the payment that made it true.
      'enqueue_ticket_email',
      'expire_pending_holds',
      'issue_ticket_no',
      // **The oracle, granted to nobody.** `key_ok` answers whether a string is one of this
      // schema's keys. Callable, it would be a way to guess one a character at a time.
      'key_ok',
      'record_checkout_event',
      'record_send_result',
      'social_state',
    ]);
  });

  it('lets anon execute exactly seven of them', async () => {
    const rows = await query<{ routine_name: string }>(
      `select distinct routine_name
         from information_schema.routine_privileges
        where routine_schema = 'store' and grantee = 'anon'
        order by routine_name`,
    );

    // **Seven, and every one of them is argued for in the migration.** Four take a key,
    // because four of them either hold a ticket, record a payment, or hand back real email
    // addresses — and the anon key is published in page source.
    expect(rows.map((row) => row.routine_name)).toEqual([
      'attach_checkout_session',
      'claim_outbox_batch',
      'create_pending_purchase',
      'expire_pending_holds',
      'record_checkout_event',
      'record_send_result',
      'social_state',
    ]);
  });

  it('lets nobody at all execute the two triggers and the key oracle', async () => {
    const rows = await query<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
         from information_schema.routine_privileges
        where routine_schema = 'store'
          and routine_name in ('key_ok', 'issue_ticket_no', 'enqueue_ticket_email')
          and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );

    // **Not anon, not authenticated, not PUBLIC** — the three that a request can arrive as.
    // The owning role keeps EXECUTE on anything it created and cannot be revoked out of it,
    // which is why it is excluded above rather than asserted away: a test that expected no
    // row at all would be asserting something Postgres does not permit, and the honest
    // statement is about the roles a published key can reach.
    expect(rows).toEqual([]);
  });

  it('grants no table privilege to anon or authenticated', async () => {
    const rows = await query(
      `select table_name, privilege_type, grantee
         from information_schema.role_table_grants
        where table_schema = 'store' and grantee in ('anon', 'authenticated')`,
    );

    expect(rows).toEqual([]);
  });

  it('has row-level security on every table', async () => {
    const rows = await query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'store' and c.relkind = 'r'
        order by c.relname`,
    );

    expect(rows.map((row) => row.relname)).toEqual([...TABLES].sort());
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('has no policy on any table, which is what the refusals above rest on', async () => {
    const rows = await query(
      `select polname from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'store'`,
    );

    expect(rows).toEqual([]);
  });

  it('pins search_path on every function, so none can be hijacked by a schema on the path', async () => {
    const rows = await query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'store'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.proconfig?.join(',')).toContain('search_path=');
    }
  });
});

describe('the keys, which ship refusing everything', () => {
  it('holds a null digest for both, so nothing can be held and nothing can be paid', async () => {
    const rows = await query<{ name: string; key_sha256: string | null }>(
      'select name, key_sha256 from store.api_secrets order by name',
    );

    // **Null is the shipped state and it is the safe one.** A deployment where nobody has
    // installed a key sells no tickets, rather than selling them to anybody.
    expect(rows).toEqual([
      { name: 'entry', key_sha256: null },
      { name: 'stripe', key_sha256: null },
    ]);
  });

  it('refuses to hold a ticket when no entry key is installed', async () => {
    const { data, error } = await anon.schema('store').rpc('create_pending_purchase', {
      p_key: 'anything-at-all',
      p_social_slug: 'christmas-party-2026',
      p_ticket_code: 'standard',
      p_purchaser_name: 'Test Person',
      p_purchaser_email: 'test@example.com',
      p_quantity: 1,
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ ok: false, reason: 'bad_key' });
  });

  it('refuses to record a payment when no stripe key is installed', async () => {
    const { data, error } = await anon.schema('store').rpc('record_checkout_event', {
      p_key: 'anything-at-all',
      p_session_id: 'cs_test_nothing',
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ ok: false, result: 'bad_key' });
  });

  it('hands back nothing from the outbox without the key', async () => {
    const { data, error } = await anon.schema('store').rpc('claim_outbox_batch', {
      p_key: 'anything-at-all',
    });

    // **An empty list rather than an error.** The drain is written never to throw, and a
    // wrong key must look to it exactly like an empty queue.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('the 2026 Christmas party row', () => {
  it('holds every fact that has been supplied, and nothing that has not', async () => {
    const rows = await query<Record<string, unknown>>(
      `select social_date, start_time, end_time, venue, minimum_age, capacity,
              sales_open_at, sales_close_at
         from store.socials where slug = 'christmas-party-2026'`,
    );

    expect(rows).toHaveLength(1);

    // Supplied by a club volunteer on 5 September 2026 — Saturday 12 December 2026 at The
    // Cock & Tail, 7:30pm–1am, 18+.
    //
    // **`capacity` is null because nobody has said what the room holds**, and null means no
    // limit — the honest reading of "not supplied", and what the 2025 page implied by never
    // mentioning one. **`sales_open_at` is null because that is the switch**, and it stays
    // null until the runbook's step 4.
    //
    // Asserted as an exact object rather than field by field, so a value arriving here
    // silently — which is precisely what this file exists to catch — turns it red.
    expect(rows[0]).toEqual({
      social_date: new Date('2026-12-12T00:00:00.000Z'),
      start_time: '19:30:00',
      end_time: '01:00:00',
      venue: 'The Cock & Tail',
      minimum_age: 18,
      capacity: null,
      sales_open_at: null,
      sales_close_at: null,
    });
  });

  it('has one ticket type at the provisional price', async () => {
    const rows = await query<{ code: string; price_pence: number; active: boolean }>(
      `select kind.code, kind.price_pence, kind.active
         from store.ticket_types kind
         join store.socials social on social.id = kind.social_id
        where social.slug = 'christmas-party-2026'`,
    );

    // ⚠️ **£10, and provisional.** It was £12 when this row was first written and was changed
    // on 6 September with no statement that the new figure is final — so it is what the page
    // shows and is not a settled decision about what the club charges. **That it has already
    // moved once is the argument for re-confirming it before sales open**, which is a stop
    // condition on the runbook's step 4. It is safe today only because nothing can be sold; the moment
    // that changes, this integer is what a card is charged, and there is deliberately no
    // second copy of it in Stripe to disagree with.
    expect(rows).toEqual([{ code: 'standard', price_pence: 1000, active: true }]);
  });

  it('still cannot sell a ticket, because the window has never been opened', async () => {
    // **The invariant that actually matters, and the one to keep asserting whatever else
    // moves.** A price on the page is a soft commitment; a price somebody can pay is a
    // transaction. `sales_open_at` is null, a null there reads as *never opens* rather than
    // *no lower bound*, and that is the whole distance between the two.
    const { data, error } = await anon
      .schema('store')
      .rpc('social_state', { p_slug: 'christmas-party-2026' });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      slug: 'christmas-party-2026',
      display_name: 'SRC Christmas Party 2026',
      sales_state: 'pre_open',
      social_date: '2026-12-12',
      venue: 'The Cock & Tail',
      minimum_age: 18,
      ticket_types: [{ code: 'standard', label: 'Standard ticket', price_pence: 1000 }],
    });
  });

  it('refuses to hold a ticket even with a price and a valid ticket code', async () => {
    // Belt to the braces above: the window is tested *before* anything else in
    // `create_pending_purchase()`, so a caller with the published anon key and a correct
    // ticket code still gets nowhere. (`bad_key` would also refuse this — the entry digest
    // ships null — which is the second independent reason nothing can be sold today.)
    const { data, error } = await anon.schema('store').rpc('create_pending_purchase', {
      p_key: 'anything-at-all',
      p_social_slug: 'christmas-party-2026',
      p_ticket_code: 'standard',
      p_purchaser_name: 'Test Person',
      p_purchaser_email: 'test@example.com',
      p_quantity: 1,
    });

    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(false);
  });

  it('answers nothing at all for a slug that does not exist', async () => {
    const { data, error } = await anon
      .schema('store')
      .rpc('social_state', { p_slug: 'no-such-party' });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
