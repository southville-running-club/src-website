import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * The `entries` schema, tested from **both sides**.
 *
 * A privileged connection checks what is actually in the tables; an anonymous client checks
 * what can be reached through the API. There is no tier between a browser and Postgres, so
 * this file *is* the access control being tested rather than a model of it.
 *
 * **The refusals are the point of this file, and they were written to outlive the slice that
 * added them — which they now have.** Entries are written to these tables today, and the
 * anon role still holds no privilege on a single one of them: every write goes through
 * `entries.create_pending_purchase()`, a `security definer` function that decides the price,
 * the capacity and the consent version itself. **That is what this file proves by still
 * being green.** If a refusal below ever starts failing, something granted a table privilege
 * that a published anon key would then carry.
 *
 * `entries-capacity.test.ts` covers what the function does; this covers what remains shut.
 * Each assertion names the **error code**, not merely that something failed — a test that
 * passes because a table stopped existing is a test that has quietly stopped testing.
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

/** Every table in the schema. The refusal tests walk this list rather than naming
 *  three of nine, so a tenth table cannot arrive without a decision about its grants.
 *
 *  **`webhook_secrets` and `admin_keys` are the two that would hurt most.** The first holds the
 *  digest of the key that lets the webhook write `paid` and the digest of the key that opens
 *  the admin surface; the second holds one digest per person who may read that surface. If
 *  their refusals ever start failing, those digests are readable with a key that is published
 *  in page source.
 *
 *  **`admin_audit` is the third.** It is the record of who read a medical note, and a table
 *  anybody can write to is an audit trail anybody can forge. */
const TABLES = [
  'events',
  'fees',
  'discount_codes',
  'entry_purchases',
  'entrants',
  'entrant_medical',
  'webhook_secrets',
  'admin_keys',
  'admin_audit',
] as const;

/**
 * One column each table really has, for the update and delete refusals below. `entrant_medical`
 * is keyed on `entrant_id` rather than `id`, and only three of the nine carry `active`.
 */
const UPDATABLE_COLUMN: Record<(typeof TABLES)[number], string> = {
  events: 'active',
  fees: 'active',
  discount_codes: 'active',
  entry_purchases: 'created_at',
  entrants: 'created_at',
  entrant_medical: 'created_at',
  webhook_secrets: 'updated_at',
  admin_keys: 'issued_at',
  admin_audit: 'at',
};

/** Fabricated events, used to exercise the window states without touching the real row. */
const FIXTURE_SLUGS = [
  'zz-window-open',
  'zz-window-closed',
  'zz-window-inactive',
  // The fabricated runnings that `current_entry_state()` chooses between. **None of them is a
  // running of `nn`**, so nothing here can change what the site's front door resolves to.
  'zz-current-past',
  'zz-current-soon',
  'zz-current-later',
  'zz-gone-old',
  'zz-gone-new',
  'zz-off-live',
  'zz-off-dead',
] as const;

afterAll(async () => {
  await connected;
  await db.query('delete from entries.events where slug = any($1::text[])', [
    [...FIXTURE_SLUGS],
  ]);
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

// -----------------------------------------------------------------------------------------
// What an anonymous client must never be able to do
// -----------------------------------------------------------------------------------------

describe('what an anonymous client may not do, on every table in the schema', () => {
  // **The most important assertions in this pull request.** The anon key is public and
  // appears in client code by design. If any of these starts passing, the club's entry
  // list — names, dates of birth, emergency contacts, medical notes — is readable or
  // writable by anybody who can open the page source.

  for (const table of TABLES) {
    it(`cannot select from ${table}`, async () => {
      const { data, error } = await anon.schema('entries').from(table).select('*');

      // `42501 permission denied`, not an empty result set. There is no grant on any of
      // these tables, so the request is refused before row-level security is consulted —
      // two independent locks, and this is the outer one.
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
    });

    it(`cannot insert into ${table}`, async () => {
      const { error } = await anon.schema('entries').from(table).insert({});

      expect(error?.code).toBe('42501');
    });

    it(`cannot update ${table}`, async () => {
      // The column has to be one the table really has: PostgREST checks the payload against
      // its schema cache **before** the request reaches Postgres, and answers `PGRST204` for
      // an unknown column. That would be a test passing for the wrong reason — it would
      // prove PostgREST rejected a malformed request, not that Postgres refused a
      // well-formed one.
      const { error } = await anon
        .schema('entries')
        .from(table)
        .update({ [UPDATABLE_COLUMN[table]]: null })
        .not(UPDATABLE_COLUMN[table], 'is', null);

      expect(error?.code).toBe('42501');
    });

    it(`cannot delete from ${table}`, async () => {
      const { error } = await anon
        .schema('entries')
        .from(table)
        .delete()
        .not(UPDATABLE_COLUMN[table], 'is', null);

      expect(error?.code).toBe('42501');
    });
  }

  it('is refused despite the schema being routable, which is what makes that meaningful', async () => {
    // `entries` is on config.toml's exposed list so `/nn/` can call `entry_state()`. That
    // means PostgREST really does reach Postgres for the tables too, and Postgres is what
    // says no. A refusal that only happened because nothing could get as far as asking
    // would not be a refusal anybody had tested — `PGRST106` here would mean exactly that.
    const { error } = await anon.schema('entries').from('entrants').select('*');

    expect(error?.code).not.toBe('PGRST106');
    expect(error?.code).toBe('42501');
  });
});

describe('the locks themselves, read straight from the catalogue', () => {
  it('has row-level security enabled on every table', async () => {
    const rows = await query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'entries' and c.relkind = 'r'
        order by c.relname`,
    );

    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('has no policies at all, which is what makes RLS deny everybody', async () => {
    // RLS on with no policy denies every role, anon and authenticated alike. A policy
    // appearing here means somebody has opened something, and it should have to be argued
    // for in a diff rather than noticed later.
    const policies = await query(
      "select policyname from pg_policies where schemaname = 'entries'",
    );

    expect(policies).toEqual([]);
  });

  it('gives the anon and authenticated roles no privilege on any table', async () => {
    // Asserted against `information_schema` rather than inferred from behaviour above, so
    // the shape of the grants is written down somewhere a reviewer can check in one place.
    const granted = await query(
      `select table_name, privilege_type, grantee
         from information_schema.table_privileges
        where table_schema = 'entries' and grantee in ('anon', 'authenticated')`,
    );

    expect(granted).toEqual([]);
  });

  it('gives them no column-level privilege either', async () => {
    // A column-scoped grant is the shape `intake.nn_interest` uses and it would not show up
    // in the table-level view above. There is none here yet, and when one arrives it should
    // arrive with the policy that needs it.
    const granted = await query(
      `select table_name, column_name, privilege_type
         from information_schema.column_privileges
        where table_schema = 'entries' and grantee in ('anon', 'authenticated')`,
    );

    expect(granted).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// The doors, as a set rather than one at a time
// -----------------------------------------------------------------------------------------

describe('exactly which functions exist here, and exactly who may call them', () => {
  // **This is the assertion the prose had been standing in for.** CLAUDE.md, three READMEs and
  // two migrations all say some version of "anon may call these functions and nothing else",
  // and until now not one line of code checked it. A slice that adds a function granted to
  // anon should have to change this list in a diff somebody reviews, which is the whole point
  // of naming the set rather than testing members of it.

  it('has exactly these functions and no others', async () => {
    const rows = await query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
        order by p.proname`,
    );

    expect(rows.map((row) => row.proname)).toEqual([
      'admin_entrant_medical',
      'admin_entry_list',
      'admin_export',
      'admin_interest_list',
      'admin_key_ok',
      'admin_sign_in',
      // **The three trigger functions, and none of them is callable by anybody.** They enforce
      // the rules that span more than one table — the England Athletics number against the
      // fee, the medical note against its consent, the consents against the event — which a
      // check constraint cannot see. `entries-rules.test.ts` covers what they do.
      'assert_entrant_rules',
      'assert_medical_consent',
      'assert_purchase_consents',
      'attach_checkout_session',
      'cancel_entry',
      'cancellable_purchase',
      'create_pending_purchase',
      'current_entry_state',
      'delete_expired_medical_notes',
      // **The four role counterparts, granted to `authenticated`.** Same reads, different
      // door: `identity.has_role('nn-admin')` rather than a key. There is deliberately no
      // counterpart to `admin_sign_in` — signing in is `/account/`'s job now.
      'entrant_medical',
      'entry_completion_state',
      'entry_list',
      'entry_state',
      'expire_pending_holds',
      'export',
      'interest_list',
      'my_entries',
      'raise_attention',
      // **The four reads, without either door, granted to nobody.** Each key-gated function
      // and its role counterpart authorise and then call the same one of these, so the two
      // doors cannot come to disagree about how many people are running.
      'read_entrant_medical',
      'read_entry_list',
      'read_export',
      'read_interest_list',
      'record_admin_action',
      'record_checkout_event',
      'request_entry_action',
    ]);
  });

  it('lets anon execute exactly thirteen of the twenty-seven, and never PUBLIC', async () => {
    // **This list went from six to seven when `current_entry_state()` was added, and from seven
    // to thirteen when the admin surface did.** That is the change this test exists to force,
    // and this is the largest it will ever have been asked to force at once — so the argument
    // for each of the six belongs here rather than only in the migration:
    //
    //   * **Five of them require the admin key** and check it before they read anything.
    //     `anon` is the grant because it is the only role a Worker can reach Postgres as —
    //     ADR-010 settled that and ADR-013 extends it — and the key, not the role, is the
    //     control. `packages/db/tests/entries-admin.test.ts` asserts every one of the five
    //     refuses a wrong key, a null key, and an uninstalled digest.
    //
    //   * **`delete_expired_medical_notes` takes no key, and that is deliberate.** It can only
    //     delete what `/nn/privacy/` has published a promise to delete, it takes no arguments
    //     and returns a count, and gating it behind the admin key would make a legal retention
    //     obligation stop being kept on any day that key was not installed. It is
    //     `expire_pending_holds`'s argument exactly.
    //
    // The two that are **not** on this list are the ones that would each be a hole on their
    // own: `admin_key_ok` is an oracle for the key, and `record_admin_action` is a way to forge
    // an audit trail. Both are granted to nobody, like `raise_attention`.
    //
    // **#57 added eight functions and none of them is here.** Four are granted to
    // `authenticated` and asserted separately below; four are granted to nobody. The count in
    // this test's name moved and the list did not, which is the shape an expand-only change
    // should have.
    const rows = await query<{ routine_name: string }>(
      `select distinct routine_name
         from information_schema.routine_privileges
        where routine_schema = 'entries' and grantee = 'anon'
        order by routine_name`,
    );

    expect(rows.map((row) => row.routine_name)).toEqual([
      'admin_entrant_medical',
      'admin_entry_list',
      'admin_export',
      'admin_interest_list',
      'admin_sign_in',
      'attach_checkout_session',
      'create_pending_purchase',
      'current_entry_state',
      'delete_expired_medical_notes',
      'entry_completion_state',
      'entry_state',
      'expire_pending_holds',
      'record_checkout_event',
    ]);

    const publicly = await query(
      `select routine_name from information_schema.routine_privileges
        where routine_schema = 'entries' and grantee = 'PUBLIC'`,
    );

    expect(publicly).toEqual([]);
  });

  it('lets authenticated execute exactly twelve, and still no table read', async () => {
    // **The first assertion this file has ever made about `authenticated`**, and it is here for
    // the reason the anon list above is: a slice that grants a role something should have to
    // change a list in a diff somebody reviews.
    //
    // Two of the six predate #57 and disclose nothing — `entry_state` and `current_entry_state`
    // answer whether entries are open, which is public configuration and is granted to `anon`
    // as well. **The four that matter are the role counterparts**, and the argument for each
    // belongs here rather than only in the migration:
    //
    //   * Each is the **same read** its key-gated counterpart performs — literally, through the
    //     same `read_*` helper — behind `identity.has_role('nn-admin')` instead of a key.
    //     `packages/db/tests/entries-admin.test.ts` asserts that an anonymous client, a plain
    //     `registered` and a `super-admin` without `nn-admin` are each refused by all four.
    //
    //   * **`authenticated` is a role anybody who registers holds.** That is exactly why the
    //     grant is safe only in the company of the check inside the function: the grant says
    //     "you may ask", `has_role` says "you may know". A grant here without the check would
    //     hand the club's entry list to anybody with an account.
    //
    // There is deliberately no counterpart to `admin_sign_in` — signing in is `/account/`'s
    // job now, and a second way to mint a session is what #63 exists to remove.
    //
    // **Five more arrived with the `nn-tester` role, and none of them widens what `anon` may
    // do — that list is still thirteen and is asserted above.** The argument for each:
    //
    //   * `create_pending_purchase` and `attach_checkout_session` were already granted to
    //     `anon`, and a signed-in caller reaches PostgREST as `authenticated` rather than as
    //     `anon`. Without these two grants a tester's submission would fail with `42501`
    //     before the function was entered — and the *reason* the Worker signs the call at all
    //     is that the pre-open bypass resolves through `auth.uid()`, which is null otherwise.
    //     **The grant does not decide anything**: the window check inside the function does,
    //     and it admits a pre-open event only for `nn.entry.before_open`.
    //
    //   * `my_entries` is the runner-facing read behind `/account/entries/`. It is scoped to
    //     the caller inside the function — `person_id = auth.uid()`, or a `purchaser_email`
    //     matching their **confirmed** address — and returns no medical note, no emergency
    //     contact, no date of birth, no England Athletics number and no Stripe reference.
    //
    //   * `cancellable_purchase` and `cancel_entry` both refuse unless the caller holds
    //     `nn.entry.cancel`, which only `super-admin` carries. Same shape as the four reads:
    //     the grant says "you may ask", the permission check says "you may".
    //
    // `entries-tester.test.ts` re-attempts every one of these bypasses with an anonymous
    // client and with a signed-in one holding nothing, and asserts the specific refusal.
    //
    // **The twelfth is `request_entry_action`, and it is the first one on this list that a
    // runner rather than a volunteer calls.** It records that somebody has asked the club to
    // cancel or transfer one of their own entries, and it **performs neither** — cancelling is
    // `cancel_entry` above, behind `nn.entry.cancel`, and transferring has no implementation at
    // all because whether this club transfers a place is undecided.
    //
    // The grant is safe for the reason every grant on this list is: the function authorises
    // inside itself. Ownership is re-derived from `auth.uid()` and the caller's **confirmed**
    // address — the same predicate `my_entries` uses — and never from the purchase id in the
    // argument, which is printed on the confirmation page and is not a credential. It refuses
    // "not yours", "not there" and "not paid" with one identical answer, so a reference cannot
    // be used to learn whether it names somebody else's paid entry.
    const rows = await query<{ routine_name: string }>(
      `select distinct routine_name
         from information_schema.routine_privileges
        where routine_schema = 'entries' and grantee = 'authenticated'
        order by routine_name`,
    );

    expect(rows.map((row) => row.routine_name)).toEqual([
      'attach_checkout_session',
      'cancel_entry',
      'cancellable_purchase',
      'create_pending_purchase',
      'current_entry_state',
      'entrant_medical',
      'entry_list',
      'entry_state',
      'export',
      'interest_list',
      'my_entries',
      'request_entry_action',
    ]);

    // **And still not one grant on a table.** Asserted again here rather than only above,
    // because this is the test somebody reads when they add the fifth function — and the whole
    // reason these are definer functions rather than row-level security on the entry tables.
    const tables = await query(
      `select table_name, privilege_type
         from information_schema.table_privileges
        where table_schema = 'entries' and grantee = 'authenticated'`,
    );

    expect(tables).toEqual([]);
  });

  it('lets nobody at all execute the ten internal helpers', async () => {
    // **The ten granted to no role.** The first three would each be a hole on its own; the
    // next three are the rule enforcement Slice G added, and a grant on any of them would put
    // a function that reads a purchase, an entrant and a medical consent behind a key that is
    // published in page source. The last four are #57's.
    //
    //   `raise_attention`     writes the flag that says a human must look at a purchase. A
    //                         grant would let anybody clear or forge an alarm.
    //   `admin_key_ok`        answers whether a string is the admin key. That single bit is
    //                         the whole of the admin surface's security.
    //   `record_admin_action` writes the audit trail. A grant would make it forgeable, which
    //                         is worse than not having one.
    //
    //   `assert_entrant_rules`      reads the fee and the event behind an entrant.
    //   `assert_medical_consent`    reads the consent recorded against a medical note.
    //   `assert_purchase_consents`  reads the consents an event requires.
    //
    //   `read_entry_list`       the entry list and every figure on the admin page.
    //   `read_interest_list`    the interest sign-ups, with their email addresses.
    //   `read_entrant_medical`  one entrant's medical note.
    //   `read_export`           any of the three CSVs, medical notes included.
    //
    // **The last four are the reads with no door on them at all**, which is precisely what
    // must not be callable: they take no key, check no role, and answer whatever they are
    // asked. They exist so that the key path and the role path cannot come to disagree, and
    // the price of that is that this assertion is now the thing standing between the club's
    // entry list and the anon key published in page source.
    //
    // The first three are reachable only from the definer functions that call them; the next
    // three only from their triggers; the last four only from their two wrappers each. All ten
    // run as this schema's owner.
    const granted = await query(
      `select grantee from information_schema.routine_privileges
        where routine_schema = 'entries'
          and routine_name in (
            'raise_attention', 'admin_key_ok', 'record_admin_action',
            'assert_entrant_rules', 'assert_medical_consent', 'assert_purchase_consents',
            'read_entry_list', 'read_interest_list', 'read_entrant_medical', 'read_export'
          )
          and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );

    expect(granted).toEqual([]);

    const { error } = await anon.schema('entries').rpc('raise_attention', {
      p_purchase_id: '00000000-0000-4000-8000-000000000000',
      p_reason: 'over_capacity',
      p_detail: {},
    });

    // **`42501 permission denied`, and not `PGRST202`.** The distinction is worth asserting
    // rather than assuming: PostgREST does put the function in its schema cache and does send
    // the call to Postgres, and *Postgres* is what refuses it. A `PGRST202` here would mean the
    // request never got as far as being denied, which is a refusal nobody has tested — the
    // same argument the table walk above makes about `PGRST106`.
    expect(error?.code).toBe('42501');

    // **And the doorless read, tried the way somebody would actually try it.** `read_entry_list`
    // is the single most valuable function in this schema to an attacker — it answers with every
    // entrant's name, club, age and England Athletics number, and it asks nothing in return. If
    // this ever returns rows, the grant assertion above has been quietly undone.
    const doorless = await anon
      .schema('entries')
      .rpc('read_entry_list', { p_event_slug: 'nn-2026' });

    expect(doorless.error?.code).toBe('42501');
    expect(doorless.data).toBeNull();
  });

  it('pins search_path on every one of them, without exception', async () => {
    // Walked over the whole schema rather than a list, so a function added without the pin
    // fails here rather than being noticed by whoever happens to read the migration.
    const rows = await query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select p.proname, p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
        order by p.proname`,
    );

    for (const row of rows) {
      expect(row.prosecdef, `${row.proname} must be security definer`).toBe(true);
      expect(row.proconfig, `${row.proname} must pin search_path`).toEqual([
        'search_path=""',
      ]);
    }
  });

  it('makes every reader stable and every writer volatile', async () => {
    // **Volatility is load-bearing here rather than a default that happened to be right.**
    // Under READ COMMITTED a `stable` function's queries run against the *calling* statement's
    // snapshot — so a writer that waited behind another transaction would read state from
    // before it committed, and the advisory lock would protect nothing. The two readers take
    // no lock and write nothing, so `stable` is correct for them and says so.
    const rows = await query<{ proname: string; provolatile: string }>(
      `select p.proname, p.provolatile
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
        order by p.proname`,
    );

    const volatility = Object.fromEntries(
      rows.map((row) => [row.proname, row.provolatile]),
    );

    expect(volatility).toEqual({
      // The two admin reads that write an audit row are volatile because of the write, and
      // the two lists are stable because rendering a list is deliberately not audited.
      admin_entrant_medical: 'v',
      admin_entry_list: 's',
      admin_export: 'v',
      admin_interest_list: 's',
      admin_key_ok: 's',
      admin_sign_in: 'v',
      // **The three trigger functions are volatile**, and for a trigger that is the only
      // honest answer: it runs inside somebody else's write and must see that write's own
      // statement, not the snapshot the calling statement started with.
      assert_entrant_rules: 'v',
      assert_medical_consent: 'v',
      assert_purchase_consents: 'v',
      attach_checkout_session: 'v',
      // **#107's three.** `cancel_entry` writes, deletes and takes the same per-event advisory
      // lock the entry path does, so `volatile` is load-bearing here for the reason the comment
      // above gives — a `stable` version would count places against a snapshot taken before the
      // transaction it had just waited behind committed. The other two only read.
      cancel_entry: 'v',
      cancellable_purchase: 's',
      create_pending_purchase: 'v',
      current_entry_state: 's',
      delete_expired_medical_notes: 'v',
      // **#57's four role counterparts take their volatility from the read, not the door.**
      // Each is a thin wrapper around a `read_*` helper, so an entry list stays `stable` behind
      // a role exactly as it is behind a key, and a medical read stays `volatile` because it
      // writes the audit row that says it happened.
      entrant_medical: 'v',
      entry_completion_state: 's',
      entry_list: 's',
      entry_state: 's',
      expire_pending_holds: 'v',
      export: 'v',
      interest_list: 's',
      my_entries: 's',
      // **Volatile, because it writes.** It is the only function on the runner's side of this
      // schema that changes a row, and what it changes is one word about what somebody has
      // asked for — never the entry's status, never its place.
      request_entry_action: 'v',
      raise_attention: 'v',
      // The four reads themselves, granted to nobody. Same volatility as both their doors,
      // which is what makes the doors thin.
      read_entrant_medical: 'v',
      read_entry_list: 's',
      read_export: 'v',
      read_interest_list: 's',
      record_admin_action: 'v',
      record_checkout_event: 'v',
    });
  });
});

// -----------------------------------------------------------------------------------------
// The one door
// -----------------------------------------------------------------------------------------

describe('entries.entry_state(), the only object anon may reach', () => {
  it('is executable by anon and answers for the real event', async () => {
    const { data, error } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'nn-2026' });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      slug: 'nn-2026',
      display_name: 'Nightingale Nightmare 2026',
      event_date: '2026-11-01',
      start_time: '11:00:00',
      capacity: 250,
      entrants_per_entry: 1,
      requires_dob: true,
    });
  });

  it('is security definer with a pinned search_path', async () => {
    // A definer function is how this schema stays grant-free, and an unpinned `search_path`
    // on one is the standard Postgres escalation: a caller who can create a function in a
    // schema earlier on the path gets to choose what `now()` means. The timing platform pins
    // it on every one of its helpers and `intake.health()` pins it here.
    const rows = await query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries' and p.proname = 'entry_state'`,
    );

    expect(rows[0]?.prosecdef).toBe(true);
    // `set search_path = ''` is recorded as `search_path=""`. Asserted exactly: a function
    // that merely *has* a search_path setting is not the same as one pinned to nothing,
    // which is what forces every reference inside it to be schema-qualified.
    expect(rows[0]?.proconfig).toEqual(['search_path=""']);
  });

  it('leaks nothing operational and nothing personal', async () => {
    // Minimisation applies to configuration too. `from_address` would be an address in page
    // source for a scraper to collect, and the event's primary key is of no use to a browser
    // that cannot write with it.
    const { data } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'nn-2026' });
    const keys = Object.keys(data as Record<string, unknown>).sort();

    expect(keys).toEqual([
      'capacity',
      'consent_version',
      'display_name',
      'entrants_per_entry',
      'event_date',
      'fees',
      'minimum_age',
      'requires_dob',
      'slug',
      'start_time',
      'state',
    ]);
  });

  it('answers null for an event that does not exist, rather than erroring', async () => {
    const { data, error } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'no-such-race' });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('grants execute to nobody beyond anon and authenticated', async () => {
    const granted = await query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
        where routine_schema = 'entries' and routine_name = 'entry_state'
        order by grantee`,
    );

    // `postgres` owns it, so it appears here too. What matters is that PUBLIC does not.
    expect(granted.map((g) => g.grantee)).not.toContain('PUBLIC');
    expect(granted.map((g) => g.grantee)).toEqual(
      expect.arrayContaining(['anon', 'authenticated']),
    );
  });
});

// -----------------------------------------------------------------------------------------
// The second door: which running of a race is the current one
// -----------------------------------------------------------------------------------------

describe('entries.current_entry_state(), the door that does not need a year', () => {
  // **The whole point of this function is that `/nn/` never names a year.** If it did, the
  // year would be in markup and publishing 2027 would mean editing every page that mentions
  // it. These assertions are about the *choice* it makes, which is the part with a rule in it.

  it('answers for the real race, and says which running it chose', async () => {
    const { data, error } = await anon
      .schema('entries')
      .rpc('current_entry_state', { p_race_slug: 'nn' });

    expect(error).toBeNull();
    expect(data).toMatchObject({ slug: 'nn-2026', state: 'pre_open' });
  });

  it('returns exactly what entry_state returns, and nothing more', async () => {
    // **This is the assertion that keeps the new grant honest.** A function anon may call
    // that disclosed one field more than the one anon may already call would be a widening
    // nobody argued for, and it would not look like one in a diff.
    const { data: viaRace } = await anon
      .schema('entries')
      .rpc('current_entry_state', { p_race_slug: 'nn' });
    const { data: viaEvent } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'nn-2026' });

    expect(viaRace).toEqual(viaEvent);
  });

  it('answers null for a race that does not exist, rather than erroring', async () => {
    const { data, error } = await anon
      .schema('entries')
      .rpc('current_entry_state', { p_race_slug: 'no-such-race' });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  describe('which running it picks, on fabricated races rather than the real one', () => {
    // Fixed dates, an invented race slug, and the real `nn` row untouched — mutating that
    // would make the site's front door depend on whether this block had run.
    const RACE = 'zz-current';

    async function seedRunning(
      race: string,
      slug: string,
      eventDate: string,
      active = true,
    ): Promise<void> {
      await query(
        `insert into entries.events (
           slug, display_name, race_slug, event_date, start_time, capacity,
           from_address, consent_version, active
         ) values ($1, $2, $3, $4::date, time '11:00', 250,
                   'fixture@example.com', 'fixture-v1', $5)
         on conflict (slug) do nothing`,
        [slug, `Fixture ${slug}`, race, eventDate, active],
      );
    }

    async function currentSlug(race: string): Promise<string | null> {
      const { data } = await anon
        .schema('entries')
        .rpc('current_entry_state', { p_race_slug: race });
      return data === null ? null : (data as { slug: string }).slug;
    }

    // Far enough either side of today that these never depend on the calendar — a fixture
    // dated "next month" is a test that starts failing on a Tuesday.
    const wellPast = '2020-11-01';
    const recentPast = '2024-11-03';
    const soon = '2099-11-01';
    const later = '2100-10-31';

    it('prefers a forthcoming running over a past one', async () => {
      await seedRunning(RACE, 'zz-current-past', recentPast);
      await seedRunning(RACE, 'zz-current-soon', soon);

      expect(await currentSlug(RACE)).toBe('zz-current-soon');
    });

    it('prefers the nearest forthcoming running when there are two', async () => {
      await seedRunning(RACE, 'zz-current-later', later);

      // `zz-current-soon` from the case above is still the nearer of the two.
      expect(await currentSlug(RACE)).toBe('zz-current-soon');
    });

    it('falls back to the most recent past running when none is forthcoming', async () => {
      // **The months between one November and next year's row being added.** Returning
      // nothing there would make `/nn/` a dead end exactly when somebody is looking for what
      // happened last time, so the rule is "the last time this happened" rather than silence.
      await seedRunning('zz-gone', 'zz-gone-old', wellPast);
      await seedRunning('zz-gone', 'zz-gone-new', recentPast);

      expect(await currentSlug('zz-gone')).toBe('zz-gone-new');
    });

    it('never picks an inactive running', async () => {
      // `zz-off-dead` is the nearer of the two and is skipped because it is switched off —
      // which is the same answer `entry_state()` gives for an inactive event, arrived at a
      // step earlier so a shut-down running is not merely reported as closed but not chosen.
      await seedRunning('zz-off', 'zz-off-live', later);
      await seedRunning('zz-off', 'zz-off-dead', soon, false);

      expect(await currentSlug('zz-off')).toBe('zz-off-live');
    });

    it('answers null for a race whose only runnings are somebody else’s', async () => {
      expect(await currentSlug('zz-no-such')).toBeNull();
    });
  });
});

describe('entries.events.race_slug', () => {
  it('says which recurring race the real running belongs to', async () => {
    const rows = await query<{ race_slug: string }>(
      "select race_slug from entries.events where slug = 'nn-2026'",
    );

    // The same two letters the path has used since the first deploy. The URL and the row
    // agree, and neither was chosen to fit the other.
    expect(rows[0]?.race_slug).toBe('nn');
  });

  it('refuses an event that does not say which race it is a running of', async () => {
    // **`not null` is the point of the column.** A running with no race is a row `/nn/` can
    // never find, which would present as a page that quietly stopped linking anywhere.
    await expect(
      query(
        `insert into entries.events (
           slug, display_name, event_date, start_time, capacity,
           from_address, consent_version
         ) values ('zz-raceless', 'Raceless', date '2026-11-01', time '11:00', 250,
                   'f@example.com', 'v1')`,
      ),
    ).rejects.toThrow(/race_slug/);
  });

  it('refuses a race slug that could not be a path segment', async () => {
    await expect(
      query(
        `insert into entries.events (
           slug, display_name, race_slug, event_date, start_time, capacity,
           from_address, consent_version
         ) values ('zz-badrace', 'Bad race', 'Nightingale Nightmare',
                   date '2026-11-01', time '11:00', 250, 'f@example.com', 'v1')`,
      ),
    ).rejects.toThrow(/events_race_slug_format/);
  });
});

describe('the window states, on fabricated events rather than the real one', () => {
  // Deterministic fixtures with fixed timestamps, inserted and removed by this file. The
  // real `nn-2026` row is left alone: mutating it would make this suite's answer depend on
  // whether it had finished before something else read the page.

  async function seedWindow(
    slug: string,
    opensAt: string | null,
    closesAt: string | null,
    active = true,
  ): Promise<void> {
    await query(
      // **`race_slug` is a fixture race and never `nn`, deliberately.** A fixture claiming to
      // be a running of the real race would change what `current_entry_state('nn')` answers,
      // and the acceptance suite reads that on every `/nn/` request — so the site's front
      // door would start depending on whether this file had run.
      `insert into entries.events (
         slug, display_name, race_slug, event_date, start_time, capacity,
         entries_open_at, entries_close_at, from_address, consent_version, active
       ) values ($1, $2, 'zz-fixture', date '2026-11-01', time '11:00', 250, $3, $4, 'fixture@example.com', 'fixture-v1', $5)
       on conflict (slug) do nothing`,
      [slug, `Fixture ${slug}`, opensAt, closesAt, active],
    );
  }

  async function stateOf(slug: string): Promise<string> {
    const { data } = await anon.schema('entries').rpc('entry_state', { p_slug: slug });
    return (data as { state: string }).state;
  }

  it('reads a window that has opened and not closed as open', async () => {
    await seedWindow('zz-window-open', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
    expect(await stateOf('zz-window-open')).toBe('open');
  });

  it('reads a window that has closed as closed', async () => {
    await seedWindow('zz-window-closed', '2020-01-01T00:00:00Z', '2020-06-01T00:00:00Z');
    expect(await stateOf('zz-window-closed')).toBe('closed');
  });

  it('reads an inactive event as closed however its window reads', async () => {
    await seedWindow(
      'zz-window-inactive',
      '2020-01-01T00:00:00Z',
      '2030-01-01T00:00:00Z',
      false,
    );
    expect(await stateOf('zz-window-inactive')).toBe('closed');
  });

  it('refuses a window that closes before it opens', async () => {
    await expect(
      query(
        `insert into entries.events (
           slug, display_name, race_slug, event_date, start_time, capacity,
           entries_open_at, entries_close_at, from_address, consent_version
         ) values ('zz-backwards', 'Backwards', 'zz-fixture', date '2026-11-01', time '11:00', 250,
                   '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z', 'f@example.com', 'v1')`,
      ),
    ).rejects.toThrow(/events_window_ordered/);
  });
});

// -----------------------------------------------------------------------------------------
// What the migration seeded
// -----------------------------------------------------------------------------------------

describe('the Nightingale Nightmare 2026 event row', () => {
  it('holds the confirmed facts', async () => {
    const rows = await query<{
      display_name: string;
      event_date: Date;
      capacity: number;
      entrants_per_entry: number;
      requires_dob: boolean;
      active: boolean;
    }>("select * from entries.events where slug = 'nn-2026'");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      display_name: 'Nightingale Nightmare 2026',
      capacity: 250,
      entrants_per_entry: 1,
      requires_dob: true,
      active: true,
    });
  });

  it('leaves the entry window null, because nobody has ratified it', async () => {
    // **The assertion that stops a plausible placeholder**, and as of 24 August 2026 it is
    // holding back a real proposal rather than a hypothetical one: the race director has
    // proposed opening 1 September 2026 at 07:00 and closing 30 October at 17:00, and the
    // committee has not ratified it.
    //
    // **It stays null because this column is not configuration, it is the switch.**
    // `entry_state()` resolves `pre_open` until `now()` passes `entries_open_at` and `open`
    // afterwards, so a date here is a dated instruction to start selling places — unattended,
    // with no deploy and nobody present. The entries-open runbook makes that moment the
    // committee's and lists stop conditions that are not met: no WAF rate-limiting rule, no
    // payment ever completed end to end, and no entry terms. The runbook carries the exact
    // `update` for the day they are.
    //
    // Null is also the honest state meanwhile, and it is what the site shows today.
    const rows = await query<{
      entries_open_at: Date | null;
      entries_close_at: Date | null;
    }>(
      "select entries_open_at, entries_close_at from entries.events where slug = 'nn-2026'",
    );

    expect(rows[0]?.entries_open_at).toBeNull();
    expect(rows[0]?.entries_close_at).toBeNull();
  });

  it('carries the confirmed minimum age of 18', async () => {
    // **It arrived exactly the way the column was built for.** 18 was *implied* by the
    // youngest prize category and unconfirmed when this schema landed; the committee settled
    // it on 13 August 2026 and it went in as one `update` in a later migration — no change to
    // the schema module, no change to the form, no deploy required to have made it.
    //
    // Applied by `update` rather than by editing the migration that seeded the row, because
    // that migration has already run everywhere. Editing it would change what a fresh
    // `db reset` produces without changing any existing database, which is how two
    // environments start disagreeing about a rule that turns entrants away.
    const rows = await query<{ minimum_age: number | null }>(
      "select minimum_age from entries.events where slug = 'nn-2026'",
    );

    expect(rows[0]?.minimum_age).toBe(18);
  });

  it('shows as pre_open through the public function', async () => {
    const { data } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'nn-2026' });
    expect((data as { state: string }).state).toBe('pre_open');
  });
});

describe('the fees', () => {
  // **£18 and £20 since 24 August 2026**, confirmed by the race director and recorded as
  // decision 006 — the schema seeded £15/£17 and `20260825090000_nn_2026_entry_fees.sql`
  // repriced them.
  //
  // **The £2 gap is not a discount and not club income.** It is ARC's Unattached Runner Levy:
  // Rule 21(2)(b) makes the promoter impose it, 21(2)(c) makes the club remit it to ARC within
  // 30 days with the entry list. The club nets £18 whichever box a runner ticks. That is why
  // the gap is asserted below as well as the two prices — it is an obligation, so a change to
  // it is a change to what the club owes rather than to what it charges.
  it('are seeded at the confirmed prices, in pence', async () => {
    const rows = await query<{
      code: string;
      label: string;
      price_pence: number;
      requires_ea_number: boolean;
    }>(
      // **Ungated only, which is what "what the club charges" means.** The £1 tester fee is a
      // fourth row on this event and is nobody's price — it is asserted on its own below, so a
      // repricing diff cannot be confused with a change to it, and so this list goes on saying
      // exactly what a runner pays.
      `select f.code, f.label, f.price_pence, f.requires_ea_number
         from entries.fees f
         join entries.events e on e.id = f.event_id
        where e.slug = 'nn-2026'
          and f.requires_permission is null
        order by f.code`,
    );

    expect(rows).toEqual([
      {
        code: 'affiliated',
        label: 'Affiliated',
        price_pence: 1800,
        requires_ea_number: true,
      },
      {
        code: 'unaffiliated',
        label: 'Unaffiliated',
        price_pence: 2000,
        requires_ea_number: false,
      },
      { code: 'vi_guide', label: 'VI guide', price_pence: 0, requires_ea_number: false },
    ]);
  });

  it('has a fourth row nobody can see, and it is the tester fee', async () => {
    // **Asserted separately from the three above**, because it is a different kind of thing:
    // those are what the club charges and this is a £1 probe that exists to prove the live
    // Stripe account works before entries open. Folding it into that list would make a
    // repricing diff look like a change to what a runner pays.
    const [row] = await query<{
      code: string;
      price_pence: number;
      requires_permission: string | null;
    }>(
      `select f.code, f.price_pence, f.requires_permission
         from entries.fees f
         join entries.events e on e.id = f.event_id
        where e.slug = 'nn-2026' and f.code = 'tester'`,
    );

    expect(row).toEqual({
      code: 'tester',
      price_pence: 100,
      // **The gate, and it is the only thing keeping a £1 entry off a public page.** The
      // "dearest first" test below reads `entry_state()` as `anon` and gets three fees, which
      // is the other half of this assertion.
      requires_permission: 'nn.entry.before_open',
    });
  });

  it('leaves every other fee ungated, so nothing changed for a runner', async () => {
    const rows = await query<{ code: string }>(
      `select f.code
         from entries.fees f
         join entries.events e on e.id = f.event_id
        where e.slug = 'nn-2026' and f.requires_permission is not null
        order by f.code`,
    );

    expect(rows.map((row) => row.code)).toEqual(['tester']);
  });

  it('differ by exactly the levy the club has to remit to ARC', async () => {
    // **Asserted as a difference, not as two numbers.** Rule 21(2)(b) sets what the promoter
    // must impose on an unattached runner and 21(2)(c) says it goes to ARC; a repricing that
    // moved one fee without the other would quietly change what the club owes ARC per entry,
    // and the two-number assertion above would still read as "the prices were updated".
    const [gap] = await query<{ levy_pence: number }>(
      `select u.price_pence - a.price_pence as levy_pence
         from entries.fees a
         join entries.fees u on u.event_id = a.event_id and u.code = 'unaffiliated'
         join entries.events e on e.id = a.event_id
        where a.code = 'affiliated' and e.slug = 'nn-2026'`,
    );

    expect(gap?.levy_pence).toBe(200);
  });

  it('reach the browser through the function, dearest first', async () => {
    // A stable order, so the radio group cannot reshuffle itself between two page loads.
    const { data } = await anon
      .schema('entries')
      .rpc('entry_state', { p_slug: 'nn-2026' });
    const fees = (data as { fees: { code: string }[] }).fees;

    expect(fees.map((f) => f.code)).toEqual(['unaffiliated', 'affiliated', 'vi_guide']);
  });

  it('refuses a fee code the schema does not know', async () => {
    await expect(
      query(
        `insert into entries.fees (event_id, code, label, price_pence)
         select id, 'mates_rates', 'Mates rates', 100 from entries.events where slug = 'nn-2026'`,
      ),
    ).rejects.toThrow(/fees_code_check/);
  });
});

describe('the discount codes table', () => {
  it('is empty for the real event, because the 2023 code has not been confirmed for 2026', async () => {
    // A Long Ashton code existed in 2023 — 10% off unaffiliated, 22 places. Whether it
    // returns has not been decided, and seeding one would be a discount the club is offering.
    //
    // **Scoped to `nn-2026` rather than asserted over the whole table.**
    // `entries-capacity.test.ts` seeds codes against fabricated events to exercise the
    // redemption path, and Vitest runs the two files at the same time — an unscoped `select`
    // here would fail on whichever machine happened to interleave them.
    const rows = await query(
      `select 1 from entries.discount_codes d
         join entries.events e on e.id = d.event_id
        where e.slug = 'nn-2026'`,
    );
    expect(rows).toEqual([]);
  });

  it('matches a code whatever case it was typed in', async () => {
    // `citext`, so somebody reading a code off a newsletter does not have to match its case.
    await query(
      `insert into entries.discount_codes (event_id, code, percent_off, max_uses)
       select id, 'LHGRC10', 10, 22 from entries.events where slug = 'nn-2026'`,
    );

    // **Scoped to `nn-2026`, for the reason the test above says out loud and this one used
    // to ignore.** `entries-capacity.test.ts` seeds its own `LHGRC10` against fabricated
    // events, Vitest runs the two files at the same time, and an unscoped select here counted
    // both — intermittently, on whichever machine interleaved them. Found by it failing about
    // one run in three.
    const found = await query(
      `select 1 from entries.discount_codes d
         join entries.events e on e.id = d.event_id
        where d.code = 'lhgrc10' and e.slug = 'nn-2026'`,
    );
    expect(found).toHaveLength(1);

    // **The cleanup was the half that stayed unscoped, and it was the more dangerous half.**
    // The `select` above was narrowed to `nn-2026` when this file's own assertion started
    // failing about one run in three; this `delete` was left matching **every** `LHGRC10` in
    // the table — including the one `entries-capacity.test.ts` seeds against its own fabricated
    // event, moments before it redeems it.
    //
    // A test reading somebody else's row fails its own assertion. A test **deleting** somebody
    // else's row fails *theirs*, in another file, with `invalid_discount` — which reads as a
    // bug in `create_pending_purchase` rather than as tidy-up in a file nobody was looking at.
    // It surfaced when two more files joined this project and changed the interleaving.
    //
    // Scope every fixture query to its own event, cleanup included.
    await query(
      `delete from entries.discount_codes
        where code = 'LHGRC10'
          and event_id = (select id from entries.events where slug = 'nn-2026')`,
    );
  });
});

// -----------------------------------------------------------------------------------------
// The shape the tables enforce
// -----------------------------------------------------------------------------------------

describe('what the tables refuse regardless of who is asking', () => {
  it('refuses a paid purchase with no paid_at, and an unpaid one that has one', async () => {
    // The two facts always travel together. A `paid` row with a null timestamp is the kind
    // of thing only a reconciliation finds, months later.
    const insert = (status: string, paidAt: string | null) =>
      query(
        `insert into entries.entry_purchases (
           event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
           consents, consent_version, paid_at
         )
         select e.id, $1, 1700, f.id, 'zz@example.com', 'Zed Zero', '{}'::jsonb, 'v1', $2
           from entries.events e
           join entries.fees f on f.event_id = e.id and f.code = 'unaffiliated'
          where e.slug = 'nn-2026'`,
        [status, paidAt],
      );

    await expect(insert('paid', null)).rejects.toThrow(
      /entry_purchases_paid_has_timestamp/,
    );
    await expect(insert('pending', '2026-09-01T10:00:00Z')).rejects.toThrow(
      /entry_purchases_paid_has_timestamp/,
    );
  });

  it('deletes the entrant and the medical notes with the purchase they belong to', async () => {
    // **The retention story, proved rather than described.** Removing an entry is one
    // `delete` and it must not leave a runner, or their medical information, behind.
    const purchase = await query<{ id: string }>(
      `insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version
       )
       select e.id, 'pending', 1700, f.id, 'zz-cascade@example.com', 'Zed Cascade',
              '{"entryTerms":true,"medical":true}'::jsonb, 'v1'
         from entries.events e
         join entries.fees f on f.event_id = e.id and f.code = 'unaffiliated'
        where e.slug = 'nn-2026'
       returning id`,
    );

    const entrant = await query<{ id: string }>(
      `insert into entries.entrants (
         purchase_id, first_name, last_name, date_of_birth, gender,
         emergency_contact_name, emergency_contact_phone
       ) values ($1, 'Zed', 'Cascade', date '1986-03-07', 'female', 'Next Of Kin', '0117 496 0000')
       returning id`,
      [purchase[0]!.id],
    );

    await query(
      "insert into entries.entrant_medical (entrant_id, notes) values ($1, 'Fabricated note')",
      [entrant[0]!.id],
    );

    await query('delete from entries.entry_purchases where id = $1', [purchase[0]!.id]);

    expect(
      await query('select 1 from entries.entrants where id = $1', [entrant[0]!.id]),
    ).toEqual([]);
    expect(
      await query('select 1 from entries.entrant_medical where entrant_id = $1', [
        entrant[0]!.id,
      ]),
    ).toEqual([]);
  });

  it('holds medical notes in their own table and nowhere else', async () => {
    // Special category data under UK GDPR Article 9. If a `medical` column ever appears on
    // `entrants`, "delete the medical information one month after the race" stops being a
    // DELETE on one table and this test is what should notice.
    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'entries' and table_name = 'entrants'
        order by column_name`,
    );

    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('medical_notes');
    expect(names).not.toContain('notes');

    // And no derived age or stored category — both are read-time derivations.
    expect(names).not.toContain('age');
    expect(names).not.toContain('category');
  });

  it('refuses an England Athletics number that is not the right shape', async () => {
    const purchase = await query<{ id: string }>(
      `insert into entries.entry_purchases (
         event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
         consents, consent_version
       )
       select e.id, 'pending', 1500, f.id, 'zz-ea@example.com', 'Zed Ea',
              '{"entryTerms":true}'::jsonb, 'v1'
         from entries.events e
         join entries.fees f on f.event_id = e.id and f.code = 'affiliated'
        where e.slug = 'nn-2026'
       returning id`,
    );

    await expect(
      query(
        `insert into entries.entrants (
           purchase_id, first_name, last_name, date_of_birth, gender, ea_number,
           emergency_contact_name, emergency_contact_phone
         ) values ($1, 'Zed', 'Ea', date '1986-03-07', 'male', 'ABC123', 'Kin', '0117 496 0000')`,
        [purchase[0]!.id],
      ),
    ).rejects.toThrow(/entrants_ea_number_check/);

    await query('delete from entries.entry_purchases where id = $1', [purchase[0]!.id]);
  });
});
