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
 * `decodeUnverified` below is the one place this file reads claims without checking the
 * signature. It is used for two things, and the difference between them matters:
 *
 * - **`exp`, to decide whether to *bother* asking for a refresh a little early.** A forged
 *   `exp` claim just means asking sooner or later than ideal; the `getUser`/`refreshSession`
 *   call is what actually decides who anybody is.
 * - **`amr`, to find out when this session was authenticated** — see the absolute lifetime
 *   below. That one *is* a security decision, so it is only ever read off a token that has
 *   already been verified in the same request: one `getUser()` has just accepted, or one
 *   `refreshSession()` has just handed back over TLS. A string that passes either of those
 *   is a genuine, signed GoTrue token, so its claims are GoTrue's rather than the caller's.
 *
 * ## The three cookies
 *
 * `src_at`, `src_rt` and `src_ax` — the access token, the refresh token, and the moment this
 * session stops being extendable, as a Unix timestamp in seconds. Separate cookies because
 * the access token is replaced far more often than the refresh token, and the deadline is
 * never replaced at all. All three `Path=/`, because a session has to work on `/account/`
 * and `/admin/` alike, unlike `nn_admin`'s `/nn/admin` scoping. All three `SameSite=Lax`,
 * not `Strict` — see ADR-015: a magic link and an OAuth callback are both cross-site
 * top-level navigations, which `Strict` would drop the cookie on. `worker/csrf.ts` is what a
 * `Lax` cookie has to be paired with on every state-changing `POST` from here on.
 *
 * ## Two timeouts, and why both — ADR-019
 *
 * A session used to last thirty days: the refresh cookie carried Supabase's own default
 * lifetime, so a browser that had signed in once was still signed in a fortnight later. It
 * now ends two ways, which are the two the standards name:
 *
 * - **Idle: 30 minutes.** NIST SP 800-63B's inactivity requirement at AAL2, and the loose
 *   end of OWASP's 15–30 minute band for a low-risk application. Every request carrying a
 *   live session re-issues all three cookies with a fresh `Max-Age`, so the window slides
 *   with activity and closes half an hour after the last of it.
 * - **Absolute: 12 hours.** NIST SP 800-63B again — reauthentication "at least once per 12
 *   hours during an extended usage session" — and it is the half that cannot be slid. The
 *   deadline is minted once, at authentication, and carried unchanged through every refresh.
 *
 * **Which of the two is enforced where is not the same, and pretending otherwise would be
 * the dishonest part.** The idle window is a cookie `Max-Age`: an ordinary browser forgets,
 * which is how session expiry works nearly everywhere, but a client that simply keeps
 * presenting the cookie is not stopped by it. The absolute deadline is checked here, on
 * every request, against **both** the `src_ax` cookie and the authentication time GoTrue
 * signed into the access token's `amr` claim — whichever is stricter. So stripping or
 * editing `src_ax`, which somebody holding a stolen cookie jar can do and the person whose
 * jar it is has no reason to, buys nothing: the signed claim still ends the session. The
 * cookie is what makes the deadline work if GoTrue ever stops sending `amr`; the claim is
 * what makes it unforgeable while it does. `identity-sessions.test.ts` is what checks the
 * claim is really there, and really survives a refresh, against the real local GoTrue rather
 * than against its documentation.
 *
 * **And an expiry revokes rather than merely forgets.** Reaching either deadline calls
 * `signOut()` on the way out, exactly as `/account/sign-out/` does, so the refresh token is
 * dead at Supabase and not merely missing from one browser.
 *
 * **The Pro-plan answer was the first one looked at and it is not available.** GoTrue has
 * both of these built in — "Time-box user sessions" and "Inactivity timeout" in the Auth
 * settings — which would end a session inside the identity provider, where it would bind
 * every client rather than every browser. They are Pro-plan features, the club is on the
 * free tier, and `[auth]` in `config.toml` is a stop-and-ask with no partial apply (#79), so
 * a setting the plan rejects would take `site_url` and the redirect allowlist down with it.
 * ADR-019 records that, and the day the club has a reason to be on Pro this file gets
 * smaller.
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
export const EXPIRY_COOKIE = 'src_ax';

/** Refresh proactively once the access token is this close to expiring. */
const REFRESH_WINDOW_SECONDS = 60;

/** How long a session survives with nothing happening on it. Slid on every request that
 *  carries a live session. NIST SP 800-63B AAL2's inactivity limit, and the loose end of
 *  OWASP's 15–30 minutes for a low-risk application — see the file header and ADR-019. */
export const IDLE_TIMEOUT_SECONDS = 30 * 60;

/** How long a session survives at all, however busy it is. Minted at authentication and
 *  never extended. NIST SP 800-63B AAL2's periodic reauthentication interval. */
export const ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60;

export interface Session {
  userId: string;
  accessToken: string;
}

export interface SessionResult {
  /** `null` for every reason there is: no cookie, a malformed one, an expired access token
   *  with nothing to refresh it, a refresh that itself failed, or either timeout above. The
   *  caller mostly cannot tell which, and mostly does not need to — every one of them means
   *  "sign in again". */
  session: Session | null;
  /** `Set-Cookie` values to append to the outgoing response. Three of them on every request
   *  that carries a live session, because the idle window is a `Max-Age` and a sliding
   *  window has to be re-issued to slide; three cleared ones when a session has just ended;
   *  none at all for a visitor who never had one, which is most of them. */
  setCookies: string[];
  /** True only where a session that existed has just been ended by one of the two timeouts,
   *  so `/account/` can say *why* somebody is looking at the sign-in page rather than
   *  dropping them there with no explanation. Never true for a visitor who simply is not
   *  signed in, and never true for a sign-out, which surprises nobody. */
  timedOut: boolean;
}

/** Nobody is signed in, and nobody was. A function rather than a constant, so no caller can
 *  ever be handed the same array twice. */
function noSession(): SessionResult {
  return { session: null, setCookies: [], timedOut: false };
}

/**
 * Reads claims out of a JWT without checking its signature.
 *
 * Safe for `exp`, which only decides whether to ask for a refresh early. Safe for `amr`
 * **only on a token something else has already verified in the same request** — see the file
 * header. `null` for anything that does not parse, which this file treats as "assume the
 * worst" in both readings: assume it is close to expiring, and assume it says nothing about
 * when anybody authenticated.
 */
function decodeUnverified(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const base64 = parts[1]!.replaceAll('-', '+').replaceAll('_', '/');
    const payload: unknown = JSON.parse(atob(base64));
    return typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function expiryOf(token: string): number | null {
  const exp = decodeUnverified(token)?.['exp'];
  return typeof exp === 'number' ? exp : null;
}

/**
 * When this session was authenticated, out of the access token's `amr` claim.
 *
 * GoTrue records an entry per authentication method with the second it was used, and rebuilds
 * the claim from the session's own rows on every refresh — so unlike `iat`, which moves each
 * hour, the earliest entry stays the moment somebody actually proved who they were. That is
 * `auth_time` under another name, and it is the only unforgeable anchor for an absolute
 * session lifetime available without a Pro plan or a table of our own.
 *
 * **`null` is not a failure.** `amr` is optional in GoTrue's own token type, and a custom
 * access token hook can replace the entries with plain strings, so this returns `null` for
 * anything it does not recognise and the `src_ax` cookie carries the deadline alone. What
 * that costs is the unforgeable half, not the timeout.
 */
function authTimeOf(token: string): number | null {
  const amr = decodeUnverified(token)?.['amr'];
  if (!Array.isArray(amr)) {
    return null;
  }

  const stamps = amr
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null
        ? (entry as { timestamp?: unknown }).timestamp
        : null,
    )
    .filter((stamp): stamp is number => typeof stamp === 'number');

  return stamps.length === 0 ? null : Math.min(...stamps);
}

/** The `src_ax` cookie, as a number. Anything that is not a run of digits is `null`, which
 *  every caller treats as "this session has no deadline and has therefore expired" — the
 *  safe direction, and the one an edited cookie lands in. */
function parseExpiry(raw: string | null): number | null {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
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

/** The three cookies, expired. Signing out is the browser forgetting — see `signOut` below
 *  for the other half, ending the refresh token server-side rather than merely locally. */
export function clearedSessionCookies(secure: boolean): string[] {
  return [
    sessionCookie(ACCESS_COOKIE, '', 0, secure),
    sessionCookie(REFRESH_COOKIE, '', 0, secure),
    sessionCookie(EXPIRY_COOKIE, '', 0, secure),
  ];
}

/**
 * The three cookies for a session that is to carry on: the idle window, or whatever is left
 * of the absolute one, whichever runs out first.
 *
 * One place builds a `Set-Cookie` triple for this session shape, so the attributes and the
 * two deadlines cannot drift between the sign-in path, the refresh path, and the ordinary
 * request that does nothing but slide the window.
 */
export function sessionCookies(
  accessToken: string,
  refreshToken: string,
  absoluteExpiry: number,
  nowSeconds: number,
  secure: boolean,
): string[] {
  const maxAge = Math.max(0, Math.min(IDLE_TIMEOUT_SECONDS, absoluteExpiry - nowSeconds));

  return [
    sessionCookie(ACCESS_COOKIE, accessToken, maxAge, secure),
    sessionCookie(REFRESH_COOKIE, refreshToken, maxAge, secure),
    sessionCookie(EXPIRY_COOKIE, String(absoluteExpiry), maxAge, secure),
  ];
}

/**
 * The three cookies for a session Supabase has just handed back to somebody who has *just
 * proved who they are* — a password, a magic link, an OAuth callback, a reset link, or the
 * current password typed into `/account/change-password/`.
 *
 * This is the only thing that mints an absolute deadline, which is what makes the deadline
 * mean "twelve hours since an authentication" rather than "twelve hours since the last time
 * anything happened". The refresh path below, and every ordinary request, carry the existing
 * one forward through `sessionCookies` instead.
 */
export function newSessionCookies(
  accessToken: string,
  refreshToken: string,
  nowSeconds: number,
  secure: boolean,
): string[] {
  return sessionCookies(
    accessToken,
    refreshToken,
    nowSeconds + ABSOLUTE_LIFETIME_SECONDS,
    nowSeconds,
    secure,
  );
}

/**
 * A session that has run out of one of its two windows: revoked at Supabase, and cleared
 * here.
 *
 * The revocation is what makes this an expiry rather than an amnesia — see the file header.
 * It is best effort, and it needs both tokens, which in any ordinary browser it has, because
 * all three cookies are written with the same `Max-Age` and go together. A request holding
 * one and not the other is hand-built, and this owes it nothing beyond the refusal.
 */
async function timeOut(
  config: SupabaseConfig,
  accessToken: string | null,
  refreshToken: string | null,
  secure: boolean,
): Promise<SessionResult> {
  if (accessToken !== null && refreshToken !== null) {
    await signOut(config, accessToken, refreshToken);
  }

  return { session: null, setCookies: clearedSessionCookies(secure), timedOut: true };
}

/** A session that has ended for a reason that is not a timeout — a refresh Supabase refused,
 *  or half a cookie pair. The cookies still go, because there is nothing here worth keeping;
 *  what does not go with them is the "you were signed out for inactivity" wording, which
 *  would be a guess. */
function ended(secure: boolean): SessionResult {
  return { session: null, setCookies: clearedSessionCookies(secure), timedOut: false };
}

/**
 * The last gate every live session goes through: the absolute deadline, taken as the stricter
 * of what the cookie says and what GoTrue signed.
 *
 * `accessToken` has been verified by the caller in this same request, which is what makes
 * reading a claim off it a security decision this file is allowed to take.
 */
async function keep(
  config: SupabaseConfig,
  userId: string,
  accessToken: string,
  refreshToken: string,
  cookieExpiry: number,
  nowSeconds: number,
  secure: boolean,
): Promise<SessionResult> {
  const authTime = authTimeOf(accessToken);
  const absoluteExpiry =
    authTime === null
      ? cookieExpiry
      : Math.min(cookieExpiry, authTime + ABSOLUTE_LIFETIME_SECONDS);

  if (nowSeconds >= absoluteExpiry) {
    return timeOut(config, accessToken, refreshToken, secure);
  }

  return {
    session: { userId, accessToken },
    setCookies: sessionCookies(
      accessToken,
      refreshToken,
      absoluteExpiry,
      nowSeconds,
      secure,
    ),
    timedOut: false,
  };
}

async function refresh(
  config: SupabaseConfig,
  refreshToken: string,
  cookieExpiry: number,
  nowSeconds: number,
  secure: boolean,
): Promise<SessionResult> {
  const { data, error } = await createAnonClient(config).auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return ended(secure);
  }

  const { session: newSession } = data;

  return keep(
    config,
    newSession.user.id,
    newSession.access_token,
    newSession.refresh_token,
    cookieExpiry,
    nowSeconds,
    secure,
  );
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
  const cookieExpiry = parseExpiry(cookieValue(cookieHeader, EXPIRY_COOKIE));

  if (accessToken === null && refreshToken === null) {
    return noSession();
  }

  // **Before anything is asked of Supabase.** A session past its absolute deadline is over
  // whatever its tokens say, and a session with no readable deadline is one this Worker did
  // not write — a cookie edited by hand, or the last of the thirty-day sessions ADR-019
  // replaced. Both end here, and both end revoked.
  if (cookieExpiry === null || nowSeconds >= cookieExpiry) {
    return timeOut(config, accessToken, refreshToken, secure);
  }

  if (accessToken !== null && refreshToken !== null) {
    const expiry = expiryOf(accessToken);
    const nearExpiry = expiry === null || expiry - nowSeconds <= REFRESH_WINDOW_SECONDS;

    if (!nearExpiry) {
      const { data, error } = await createAnonClient(config).auth.getUser(accessToken);

      if (!error && data.user) {
        return keep(
          config,
          data.user.id,
          accessToken,
          refreshToken,
          cookieExpiry,
          nowSeconds,
          secure,
        );
      }

      // Claimed a later expiry but did not verify — tampered, most likely. Falls through
      // to a refresh attempt below, same as a token that is genuinely close to expiring.
    }
  }

  if (refreshToken === null) {
    return ended(secure);
  }

  return refresh(config, refreshToken, cookieExpiry, nowSeconds, secure);
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
