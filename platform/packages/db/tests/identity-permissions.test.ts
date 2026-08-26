import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The permission model — the vocabulary, who holds what, and the guard that replaced a check
 * constraint.
 *
 * ## Why the exact sets are asserted rather than sampled
 *
 * ADR-017 removed `identity.roles`' check constraint, whose comment said *"a fourth is a
 * migration and a decision"*. **That decision still has to be made in a diff somebody reads**,
 * and this file is where it now is — the same shape `entries.test.ts` has used since the
 * beginning for the thirteen functions `anon` may call, and for the same reason: a list nobody
 * asserts is a list that grows by accident.
 *
 * So a fifth role, a seventh permission, or a change to which role carries which cannot land
 * without editing one of the three assertions below.
 *
 * ## Why the negative cases are most of the file
 *
 * `has_permission()` is the one authorisation primitive the whole platform now asks. Getting
 * it wrong in the permissive direction is not one bug — it is every gate at once. So it is
 * tested against an anonymous caller, against somebody signed in holding nothing, and against
 * somebody holding a role that carries a *different* permission, which is the case a naive
 * "does this person hold any grant" implementation would pass.
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

const TESTER_EMAIL = 'zzperm-tester@example.com';
const PLAIN_EMAIL = 'zzperm-plain@example.com';
const ADMIN_EMAIL = 'zzperm-admin@example.com';
/** Holds both staff roles, which is what makes the deduplication in `my_permissions` testable. */
const CANCELLER_EMAIL = 'zzperm-canceller@example.com';

const FIXTURE_EMAILS = [TESTER_EMAIL, PLAIN_EMAIL, ADMIN_EMAIL, CANCELLER_EMAIL] as const;

const PASSWORD = 'correct-horse-battery-staple-107';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

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

let tester: { id: string; client: SupabaseClient };
let plain: { id: string; client: SupabaseClient };
let admin: { id: string; client: SupabaseClient };
let canceller: { id: string; client: SupabaseClient };

beforeAll(async () => {
  await connected;
  await query('delete from auth.users where email = any($1::text[])', [
    [...FIXTURE_EMAILS],
  ]);

  tester = await fixturePerson(TESTER_EMAIL);
  plain = await fixturePerson(PLAIN_EMAIL);
  admin = await fixturePerson(ADMIN_EMAIL);
  canceller = await fixturePerson(CANCELLER_EMAIL);

  await grant(tester.id, 'nn-tester');
  await grant(admin.id, 'super-admin');
  await grant(canceller.id, 'super-admin');
  await grant(canceller.id, 'nn-admin');
}, 40_000);

afterAll(async () => {
  await connected;
  await query('delete from auth.users where email = any($1::text[])', [
    [...FIXTURE_EMAILS],
  ]);
  await db.end();
});

// -----------------------------------------------------------------------------------------
// The vocabulary, and the decision that adding to it is
// -----------------------------------------------------------------------------------------

describe('the shape of the model', () => {
  it('has exactly these roles and no others', async () => {
    const rows = await query<{ slug: string }>(
      'select slug from identity.roles order by slug',
    );

    // **This replaces the check constraint, and it is the whole of the guard.** A fifth role
    // is a migration and a change to this line, which is exactly what the constraint's comment
    // asked for and what dropping it might otherwise have lost.
    //
    // **`registered`, not `member`** — ADR-016, which landed while this was being built. It is
    // what an account gets on signup and it carries no permissions at all, asserted below
    // rather than assumed here. `member` is not a role any more at all: ADR-016 deleted it
    // rather than keeping it as a spare, because a grantable `member` that nothing verifies
    // would let a super-admin record a membership claim the system cannot back.
    expect(rows.map((row) => row.slug)).toEqual([
      'nn-admin',
      'nn-tester',
      'registered',
      'super-admin',
    ]);
  });

  it('has exactly these permissions and no others', async () => {
    const rows = await query<{ slug: string }>(
      'select slug from identity.permissions order by slug',
    );

    expect(rows.map((row) => row.slug)).toEqual([
      'identity.role.grant',
      'nn.entry.before_open',
      'nn.entry.cancel',
      'nn.entry.export',
      'nn.entry.read',
      'nn.entry.read_medical',
    ]);
  });

  it('carries them exactly this way round', async () => {
    const rows = await query<{ role: string; permission: string }>(
      'select role, permission from identity.role_permissions order by role, permission',
    );

    const held = rows.map((row) => `${row.role} → ${row.permission}`);

    // **`nn-tester` holds one permission and it reads nothing.** That is what makes the role
    // cheap enough to hand out — and it is the line to look at if somebody ever reports that a
    // tester can see the entry list.
    //
    // **`super-admin` holds exactly one permission too, and it is the one about roles.** This
    // is the line that keeps *"a grant is not an inheritance"* true — the property
    // `tests/worker/admin/admin.test.ts` has asserted since #58. A super-admin who needs the
    // entry list grants themselves `nn-admin`, and that writes a row in `identity.audit`.
    expect(held).toEqual([
      'nn-admin → nn.entry.cancel',
      'nn-admin → nn.entry.export',
      'nn-admin → nn.entry.read',
      'nn-admin → nn.entry.read_medical',
      'nn-tester → nn.entry.before_open',
      'super-admin → identity.role.grant',
    ]);
  });

  it('no longer constrains roles.slug in DDL', async () => {
    // **Scoped to constraints that mention `slug`, not to every check on the table.**
    // `roles_description_check` is still there and should be — it bounds the length of a
    // description, which has nothing to do with which roles exist. The migration drops by the
    // same lookup, and asserting the same shape here is what keeps the two in step.
    const rows = await query<{ conname: string }>(
      `select con.conname
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'identity'
          and rel.relname = 'roles'
          and con.contype = 'c'
          and pg_get_constraintdef(con.oid) like '%slug%'`,
    );

    // Asserted rather than assumed, because the migration drops it by lookup: if the lookup
    // ever stopped matching, `grant_role()` would start refusing every new role with a check
    // violation and the reason would be invisible.
    expect(rows).toEqual([]);
  });

  it('still bounds a role description, which was never the thing in the way', async () => {
    // The other half, so "the constraint is gone" cannot quietly become "all the constraints
    // are gone" — the failure the assertion above would otherwise hide.
    const rows = await query<{ conname: string }>(
      `select con.conname
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'identity'
          and rel.relname = 'roles'
          and con.contype = 'c'`,
    );

    expect(rows.map((row) => row.conname)).toEqual(['roles_description_check']);
  });

  it('still enforces the foreign key that makes a role real', async () => {
    // Dropping the check constraint did not make the column free text. This is the referential
    // guarantee that replaced it, and it is what turns a typo in a grant into a refusal.
    await expect(
      query(
        `insert into identity.role_grants (person_id, role) values ($1, 'not-a-role')`,
        [plain.id],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

// -----------------------------------------------------------------------------------------
// What an anonymous client may not do
// -----------------------------------------------------------------------------------------

describe('what an anonymous client may not do', () => {
  it('cannot select from identity.role_permissions', async () => {
    const { error } = await anon.schema('identity').from('role_permissions').select('*');

    // 42501: no grant to anon on this schema at all, so the refusal comes before row-level
    // security is consulted. This table is what every authorisation check reads.
    expect(error?.code).toBe('42501');
  });

  it('cannot call identity.has_permission', async () => {
    const { error } = await anon
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.read' });

    expect(error?.code).toBe('42501');
  });

  it('cannot call identity.my_permissions', async () => {
    const { error } = await anon.schema('identity').rpc('my_permissions');

    expect(error?.code).toBe('42501');
  });

  it('cannot call identity.grantable_roles', async () => {
    const { error } = await anon.schema('identity').rpc('grantable_roles');

    expect(error?.code).toBe('42501');
  });
});

// -----------------------------------------------------------------------------------------
// has_permission, which is the one thing everything else asks
// -----------------------------------------------------------------------------------------

describe('has_permission', () => {
  it('is false for somebody signed in holding nothing but their account', async () => {
    const { data, error } = await plain.client
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.read' });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('is false for a role that carries a different permission', async () => {
    const { data } = await tester.client
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.read' });

    // **The case a lazy implementation passes.** `nn-tester` holds a grant, and a check that
    // asked "does this person hold any role" rather than "does any role they hold carry this
    // permission" would answer true here and open the entry list to a tester.
    expect(data).toBe(false);
  });

  it('is true for the permission the role actually carries', async () => {
    const { data } = await tester.client
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.before_open' });

    expect(data).toBe(true);
  });

  it('is false for a permission nobody has ever defined', async () => {
    const { data } = await admin.client
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.invented' });

    // **Fails closed on a word that does not exist**, which is what lets
    // `entries.fees.requires_permission` be a plain text column with no foreign key: a
    // misspelling there makes a fee invisible and unbuyable rather than universally buyable.
    expect(data).toBe(false);
  });

  it('goes false again the moment a grant is revoked', async () => {
    await query(
      `update identity.role_grants set revoked_at = now()
        where person_id = $1 and role = 'nn-tester'`,
      [tester.id],
    );

    const { data } = await tester.client
      .schema('identity')
      .rpc('has_permission', { p_permission: 'nn.entry.before_open' });

    // **On the next request, with no session to invalidate** — #59's requirement, and the
    // reason this reads `role_grants` rather than a JWT claim. The token in this client's hand
    // is the same one it held a line ago.
    expect(data).toBe(false);

    await query(
      `update identity.role_grants set revoked_at = null
        where person_id = $1 and role = 'nn-tester'`,
      [tester.id],
    );
  });
});

describe('my_permissions', () => {
  it('is empty for somebody holding nothing but their account', async () => {
    const { data } = await plain.client.schema('identity').rpc('my_permissions');

    expect(data).toEqual([]);
  });

  it('lists every permission the roles carry, deduplicated', async () => {
    // `canceller` holds both roles, which is the case the deduplication is for — and the one a
    // real volunteer ends up in, because reading the entry list and granting roles are two
    // different jobs one person often does.
    const { data } = await canceller.client.schema('identity').rpc('my_permissions');

    expect(data).toEqual([
      'identity.role.grant',
      'nn.entry.cancel',
      'nn.entry.export',
      'nn.entry.read',
      'nn.entry.read_medical',
    ]);
  });
});

describe('grantable_roles', () => {
  it('refuses somebody who may not grant roles', async () => {
    const { data, error } = await plain.client.schema('identity').rpc('grantable_roles');

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'not_authorised' });
  });

  it('answers a super-admin with every role and what it carries', async () => {
    const { data } = await admin.client.schema('identity').rpc('grantable_roles');

    const answer = data as {
      ok: boolean;
      roles: { slug: string; description: string; permissions: string[] }[];
    };

    expect(answer.ok).toBe(true);
    expect(answer.roles.map((role) => role.slug)).toEqual([
      'nn-admin',
      'nn-tester',
      'registered',
      'super-admin',
    ]);

    // **The permissions travel with it**, which is what stops `/admin/people/` offering a
    // dropdown of bare slugs — granting a capability nobody at the keyboard can see.
    const testerRole = answer.roles.find((role) => role.slug === 'nn-tester');
    expect(testerRole?.permissions).toEqual(['nn.entry.before_open']);

    const signupRole = answer.roles.find((role) => role.slug === 'registered');
    expect(signupRole?.permissions).toEqual([]);
  });
});
