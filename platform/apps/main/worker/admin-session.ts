/**
 * The signed cookie that carries who is signed in, and nothing else.
 *
 * ## What is in it, and what deliberately is not
 *
 * `<handle>.<expiry>.<signature>` — the handle from `entries.admin_keys`, a Unix expiry in
 * seconds, and an HMAC-SHA256 over the two. **The person's own key is not in it.** They present
 * that once, to `entries.admin_sign_in()`, and it is never stored, cached or echoed: a cookie
 * that carried a live credential would be a credential in browser storage, in a screenshot and
 * in whatever a phone syncs, for the sake of saving one database call.
 *
 * The handle is not a person's name — `entries.admin_keys` constrains it to a slug and the
 * runbook holds the mapping — so this cookie carries no personal data either.
 *
 * ## Why the Worker signs anything at all
 *
 * The database has no notion of a session and should not grow one. What it can answer is "does
 * this key belong to somebody who may look, and what are they called"; turning that single
 * answer into a browsing session is HTTP's problem, and HMAC over a Worker secret is the boring
 * way to solve it. The alternative — presenting the person's key on every request — is the
 * thing the paragraph above rules out.
 *
 * ## One secret, two uses, kept apart
 *
 * `ENTRIES_ADMIN_KEY` is the Worker's shared key to the database *and* the signing key here.
 * Two uses of one secret is worth being careful about, so the signed message is prefixed with a
 * fixed label: nothing this signs can be mistaken for anything else signed with the same key,
 * and the database only ever sees a SHA-256 of the key rather than an HMAC under it. The
 * alternative was a second Worker secret for signing, which is one more thing to install, one
 * more thing to lose, and no more secure.
 */

import { cookieValue } from './cookies';

/** The cookie's name, and the path it is scoped to. Not sent with any other request. */
export const ADMIN_COOKIE = 'nn_admin';

/** Scoped so the cookie is never attached to a page a runner loads. */
export const ADMIN_COOKIE_PATH = '/nn/admin';

/**
 * Twelve hours.
 *
 * **Long enough for race day, which is the day it has to survive** — somebody signs in before
 * the start and is still looking things up when the last finisher is in. Short enough that a
 * phone left on a table at the finish is not signed in next weekend.
 */
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

/** Domain separation, so an HMAC minted here cannot be reused as one minted anywhere else. */
const LABEL = 'nn-admin-session-v1';

/** The shape `entries.admin_keys.name` is constrained to, re-checked on the way back in. */
const HANDLE = /^[a-z][a-z0-9-]{0,39}$/;

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function signature(secret: string, payload: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    new TextEncoder().encode(`${LABEL}|${payload}`),
  );

  return toBase64Url(mac);
}

/**
 * Compare two signatures without leaking where they diverge.
 *
 * Both are base64url of a SHA-256 HMAC, so the length is fixed and a length check discloses
 * nothing. The loop runs over the whole string regardless, because `===` on strings is allowed
 * to stop at the first difference and this is the one comparison in the file where that matters.
 */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

/** Mint a session for one handle. `nowSeconds` is an argument so a test can pin it. */
export async function mintAdminSession(
  secret: string,
  handle: string,
  nowSeconds: number,
): Promise<string> {
  const expiry = nowSeconds + ADMIN_SESSION_SECONDS;
  const payload = `${handle}.${expiry}`;
  return `${payload}.${await signature(secret, payload)}`;
}

/**
 * The handle this cookie names, or `null`.
 *
 * `null` for every reason: no cookie, the wrong shape, a handle that is not a handle, an expiry
 * that is not a number, a signature that does not verify, or a session that has run out. **The
 * caller cannot tell which**, and does not need to — every one of them means "sign in again".
 */
export async function readAdminSession(
  secret: string,
  cookie: string | null,
  nowSeconds: number,
): Promise<string | null> {
  const value = cookieValue(cookie, ADMIN_COOKIE);

  if (value === null) {
    return null;
  }

  const parts = value.split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [handle, expiry, presented] = parts as [string, string, string];

  if (!HANDLE.test(handle) || !/^\d+$/.test(expiry)) {
    return null;
  }

  // **Verified before the expiry is trusted.** The expiry is inside the signed payload, so
  // checking it first would be reading a number an unauthenticated caller chose — harmless
  // here, and the wrong habit to write down.
  if (!equalConstantTime(presented, await signature(secret, `${handle}.${expiry}`))) {
    return null;
  }

  return Number(expiry) > nowSeconds ? handle : null;
}

/**
 * The `Set-Cookie` value for a session.
 *
 * **`Secure` only when the request arrived over HTTPS**, which is every request in production
 * and none on a laptop. Setting it unconditionally would mean the cookie is dropped at
 * `http://localhost:8787`, so the acceptance suite would exercise a sign-in that never signs
 * anybody in — a test that passes by never getting as far as the thing it is testing.
 *
 * `SameSite=Strict` rather than `Lax`: nothing links to this surface from anywhere, so there is
 * no navigation to preserve, and Strict is what stops a cross-site request carrying the session
 * at all. Every action that reads special category data or takes an export is a `POST`, and
 * with this attribute none of them can be made from another site.
 */
export function adminSessionCookie(value: string, secure: boolean): string {
  return [
    `${ADMIN_COOKIE}=${value}`,
    `Path=${ADMIN_COOKIE_PATH}`,
    `Max-Age=${ADMIN_SESSION_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** The same cookie, expired. Signing out is the browser forgetting, and it is enough. */
export function clearedAdminSessionCookie(secure: boolean): string {
  return [
    `${ADMIN_COOKIE}=`,
    `Path=${ADMIN_COOKIE_PATH}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
