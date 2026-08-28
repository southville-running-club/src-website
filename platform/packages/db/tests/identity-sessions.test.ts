import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * What the account area relies on GoTrue to do on its own, exercised against the real local
 * Supabase Auth rather than trusted from documentation. Two things, from two issues.
 *
 * **#54:** a password change revokes a person's *other* sessions. `worker/account.ts` never
 * calls anything to make this true — its own header comment says so — so this is the one
 * place that property is actually checked.
 *
 * **ADR-019:** the access token carries an `amr` claim whose timestamp is when somebody
 * authenticated, and that timestamp does not move when the session is refreshed.
 * `worker/session.ts` measures the twelve-hour absolute lifetime from it, and it is the only
 * part of that deadline a client cannot forge — so if GoTrue ever stops sending it, or
 * starts restamping it each hour, an expired session would quietly become an unexpiring one.
 * A mock cannot catch that, because a mock returns whatever it was told.
 *
 * **#54's claim is deliberately narrow**, and it is the one that is actually checkable
 * without a live browser: a stale session's refresh token is rejected after the password it
 * was issued under has changed. An already-issued access token is a stateless JWT and may
 * keep working for the rest of its own short lifetime regardless — that is a property of
 * JWTs in general, not a gap in this repository's own code, and #54's pages never rely on
 * it: `session.ts`'s access-token cookie tracks a one-hour expiry `[auth] jwt_expiry`
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

/** A second account, because the first one's password is a different value by the time the
 *  test above has finished with it and a suite that depends on describe order is a suite
 *  that breaks when somebody adds a case in the middle. */
const AMR_EMAIL = 'zz-identity-sessions-amr@example.com';
const AMR_PASSWORD = 'zz-identity-sessions-amr';

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

  const amrSignUp = await anonClient().auth.signUp({
    email: AMR_EMAIL,
    password: AMR_PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (amrSignUp.error) throw amrSignUp.error;

  await query('update auth.users set email_confirmed_at = now() where email = $1', [
    AMR_EMAIL,
  ]);
}, 30_000);

afterAll(async () => {
  await connected;
  await db.query('delete from auth.users where email = any($1)', [[EMAIL, AMR_EMAIL]]);
  await db.end();
});

/** The claims of a JWT, without checking its signature — the same read `worker/session.ts`
 *  makes, and for the same reason: this is about what GoTrue *put* in the token, not about
 *  whether the token is genuine, which the request that produced it already settles. */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<
    string,
    unknown
  >;
}

function authTimeOf(token: string): number | null {
  const amr = claimsOf(token)['amr'];
  if (!Array.isArray(amr)) return null;

  const stamps = amr
    .map((entry) =>
      typeof entry === 'object' && entry !== null ? entry.timestamp : null,
    )
    .filter((stamp): stamp is number => typeof stamp === 'number');

  return stamps.length === 0 ? null : Math.min(...stamps);
}

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

describe('the authentication time the absolute session lifetime is measured from', () => {
  it('is in the access token, and does not move when the session is refreshed', async () => {
    const before = Math.floor(Date.now() / 1000);

    const signIn = await anonClient().auth.signInWithPassword({
      email: AMR_EMAIL,
      password: AMR_PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    if (signIn.error || !signIn.data.session) throw signIn.error;

    const authTime = authTimeOf(signIn.data.session.access_token);

    // **Present at all.** `amr` is optional in GoTrue's own token type, and `session.ts`
    // falls back to the `src_ax` cookie without it — which still expires the session, and
    // stops being unforgeable while it does.
    expect(authTime).not.toBeNull();
    expect(authTime!).toBeGreaterThanOrEqual(before - 5);
    expect(authTime!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 5);

    const refreshed = await anonClient().auth.refreshSession({
      refresh_token: signIn.data.session.refresh_token,
    });
    if (refreshed.error || !refreshed.data.session) throw refreshed.error;

    // A different token — otherwise this proves nothing about what survives a refresh.
    expect(refreshed.data.session.access_token).not.toBe(
      signIn.data.session.access_token,
    );

    // **The whole property.** An hour of refreshing must not buy another twelve hours of
    // session: `iat` moves every time, and this does not.
    expect(authTimeOf(refreshed.data.session.access_token)).toBe(authTime);
  });
});
