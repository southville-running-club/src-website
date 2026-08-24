/**
 * The mechanism `/account/` and `/admin/` are built on. No pages here — #53 and #58 build
 * those — just what makes `auth.uid()` resolve to somebody across more than one request.
 *
 * ## What Supabase actually hands back
 *
 * A sign-in returns an access token (a JWT, one hour — `jwt_expiry` in config.toml) and a
 * refresh token (long-lived, rotating). PostgREST reads `auth.uid()` out of the access
 * token's claims, so the Worker has to hold both across requests, refresh before the access
 * token expires, and send the person's token rather than the anon key alone.
 *
 * ## Verification is never done by hand here
 *
 * There is no JWT-signature check anywhere in this file. `auth.getUser()` and
 * `auth.refreshSession()` both call Supabase Auth over HTTPS, which is what actually holds
 * the signing key — a tampered token and an expired one both fail there, indistinguishably,
 * for the same reason a wrong password and a locked account both fail at a login form
 * without saying which. Hand-rolling that check would mean holding the JWT secret in the
 * Worker for the first time; asking Supabase's own endpoint costs one network round trip and
 * needs no new secret at all.
 *
 * `decodeExpiryUnverified` below is the one place this file reads a claim without checking
 * the signature, and it never feeds a security decision — only whether to *bother* asking
 * for a refresh a little early. A forged `exp` claim just means asking sooner or later than
 * ideal; the `getUser`/`refreshSession` call is what actually decides who anybody is.
 *
 * ## The two cookies
 *
 * `src_at` and `src_rt` — separate because the access token is replaced far more often than
 * the refresh token. Both `Path=/`, because a session has to work on `/account/` and
 * `/admin/` alike, unlike `nn_admin`'s `/nn/admin` scoping. Both `SameSite=Lax`, not
 * `Strict` — see ADR-015: a magic link and an OAuth callback are both cross-site top-level
 * navigations, which `Strict` would drop the cookie on. `worker/csrf.ts` is what a `Lax`
 * cookie has to be paired with on every state-changing `POST` from here on.
 *
 * ## Refresh, and the thing that makes it awkward
 *
 * Refresh tokens rotate — using one invalidates it — so two requests racing to refresh with
 * the same token would ordinarily see the second fail. `refresh_token_reuse_interval = 10`
 * in config.toml is the grace window that exists for exactly this, and the fix for it is not
 * a lock: refresh only when the access token is within a minute of expiry, and tolerate a
 * failed refresh by treating the session as ended.
 */

import { createAnonClient, type SupabaseConfig } from '@src/shared';
import { cookieValue } from './cookies';

export const ACCESS_COOKIE = 'src_at';
export const REFRESH_COOKIE = 'src_rt';

/** Refresh proactively once the access token is this close to expiring. */
const REFRESH_WINDOW_SECONDS = 60;

/** Supabase's own default refresh-token lifetime. Outlives the access token by design. */
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface Session {
  userId: string;
  accessToken: string;
}

export interface SessionResult {
  /** `null` for every reason there is: no cookie, a malformed one, an expired access token
   *  with nothing to refresh it, or a refresh that itself failed. The caller cannot tell
   *  which, and does not need to — every one of them means "sign in again". */
  session: Session | null;
  /** `Set-Cookie` values to append to the outgoing response. Empty unless a refresh just
   *  happened — the common case, an unexpired access token, changes nothing about the
   *  response the caller was already going to send. */
  setCookies: string[];
}

/**
 * Reads the `exp` claim out of a JWT without checking its signature.
 *
 * Used only to decide whether to *ask* for a refresh a little early — see the file header
 * for why that is safe to get wrong. `null` for anything that does not parse, which this
 * file treats as "assume it is close to expiring" rather than "assume it is fine".
 */
function decodeExpiryUnverified(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const base64 = parts[1]!.replaceAll('-', '+').replaceAll('_', '/');
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function sessionCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** The two cookies, expired. Signing out is the browser forgetting — see `signOut` below for
 *  the other half, ending the refresh token server-side rather than merely locally. */
export function clearedSessionCookies(secure: boolean): string[] {
  return [
    sessionCookie(ACCESS_COOKIE, '', 0, secure),
    sessionCookie(REFRESH_COOKIE, '', 0, secure),
  ];
}

async function refresh(
  config: SupabaseConfig,
  refreshToken: string,
  secure: boolean,
): Promise<SessionResult> {
  const { data, error } = await createAnonClient(config).auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return { session: null, setCookies: [] };
  }

  const { session: newSession } = data;

  return {
    session: { userId: newSession.user.id, accessToken: newSession.access_token },
    setCookies: [
      sessionCookie(
        ACCESS_COOKIE,
        newSession.access_token,
        newSession.expires_in,
        secure,
      ),
      sessionCookie(
        REFRESH_COOKIE,
        newSession.refresh_token,
        REFRESH_COOKIE_MAX_AGE_SECONDS,
        secure,
      ),
    ],
  };
}

/**
 * The signed-in person, or `null`, and the cookies to attach to the outgoing response.
 *
 * `nowSeconds` and `secure` are arguments rather than read from the clock or the request
 * directly, so a test can pin both — the same shape `readAdminSession` uses.
 */
export async function readSession(
  config: SupabaseConfig,
  cookieHeader: string | null,
  nowSeconds: number,
  secure: boolean,
): Promise<SessionResult> {
  const accessToken = cookieValue(cookieHeader, ACCESS_COOKIE);
  const refreshToken = cookieValue(cookieHeader, REFRESH_COOKIE);

  if (accessToken === null && refreshToken === null) {
    return { session: null, setCookies: [] };
  }

  if (accessToken !== null) {
    const expiry = decodeExpiryUnverified(accessToken);
    const nearExpiry = expiry === null || expiry - nowSeconds <= REFRESH_WINDOW_SECONDS;

    if (!nearExpiry) {
      const { data, error } = await createAnonClient(config).auth.getUser(accessToken);

      if (!error && data.user) {
        return { session: { userId: data.user.id, accessToken }, setCookies: [] };
      }

      // Claimed a later expiry but did not verify — tampered, most likely. Falls through
      // to a refresh attempt below, same as a token that is genuinely close to expiring.
    }
  }

  if (refreshToken === null) {
    return { session: null, setCookies: [] };
  }

  return refresh(config, refreshToken, secure);
}

/**
 * Ends the session server-side, so the refresh token is dead rather than merely forgotten —
 * a browser that kept the cookie around, or a copy of it taken before sign-out, is refused
 * exactly as one presented after the token naturally expires.
 *
 * **No service-role key.** `auth.signOut()` calls Supabase Auth's `/logout` with the
 * caller's own tokens — `setSession()` first is what puts them where gotrue-js's client
 * looks for them, since this client is otherwise deliberately stateless
 * (`persistSession: false`). The admin sign-out endpoint would do this with one token
 * instead of two, and it needs the service-role key to call — precisely the credential this
 * repository never holds.
 */
export async function signOut(
  config: SupabaseConfig,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const client = createAnonClient(config);

  await client.auth
    .setSession({ access_token: accessToken, refresh_token: refreshToken })
    .then(() => client.auth.signOut())
    .catch(() => {
      // Best effort. The caller clears both cookies regardless — the browser forgets even
      // if Supabase could not be reached, and an access token this recent dies on its own
      // within the hour either way.
    });
}
