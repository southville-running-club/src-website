import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * What #54 relies on GoTrue to do on its own: a password change revokes a person's *other*
 * sessions. `worker/account.ts` never calls anything to make this true — its own header
 * comment says so — so this is the one place that property is actually exercised, against
 * the real local Supabase Auth rather than trusted from documentation.
 *
 * The claim tested here is deliberately narrow and the one that is actually checkable
 * without a live browser: **a stale session's refresh token is rejected after the password
 * it was issued under has changed.** An already-issued access token is a stateless JWT and
 * may keep working for the rest of its own short lifetime regardless — that is a property
 * of JWTs in general, not a gap in this repository's own code, and #54's pages never rely
 * on it: `session.ts`'s access-token cookie tracks a one-hour expiry `[auth] jwt_expiry`
 * already sets.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const PASSWORD = 'zz-identity-sessions-original';
const NEW_PASSWORD = 'zz-identity-sessions-changed';
const EMAIL = 'zz-identity-sessions@example.com';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

function anonClient() {
  return createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

beforeAll(async () => {
  await connected;

  const signUp = await anonClient().auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  await query('update auth.users set email_confirmed_at = now() where email = $1', [
    EMAIL,
  ]);
}, 30_000);

afterAll(async () => {
  await connected;
  await db.query('delete from auth.users where email = $1', [EMAIL]);
  await db.end();
});

describe('a password change and the sessions that outlive it', () => {
  it("rejects a stale session's refresh token once the password has changed", async () => {
    // Two independent sign-ins — two browsers, or a phone and a laptop.
    const sessionA = await anonClient().auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    if (sessionA.error || !sessionA.data.session) throw sessionA.error;

    const sessionB = await anonClient().auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    if (sessionB.error || !sessionB.data.session) throw sessionB.error;

    // Session A changes the password — the same shape `worker/account.ts`'s
    // `/account/password/` uses: `setSession()` before `updateUser()`, because `updateUser()`
    // asks the client's own internal session rather than trusting a bearer header alone.
    const asSessionA = anonClient();
    const set = await asSessionA.auth.setSession({
      access_token: sessionA.data.session.access_token,
      refresh_token: sessionA.data.session.refresh_token,
    });
    expect(set.error).toBeNull();

    const update = await asSessionA.auth.updateUser({ password: NEW_PASSWORD });
    expect(update.error).toBeNull();

    // Session B's refresh token — issued before the change — is refused now.
    const refreshB = await anonClient().auth.refreshSession({
      refresh_token: sessionB.data.session.refresh_token,
    });
    expect(refreshB.error).not.toBeNull();
    expect(refreshB.data.session).toBeNull();

    // The new password actually works, and the old one no longer does.
    const signInOld = await anonClient().auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    expect(signInOld.error).not.toBeNull();

    const signInNew = await anonClient().auth.signInWithPassword({
      email: EMAIL,
      password: NEW_PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    expect(signInNew.error).toBeNull();
  });
});
