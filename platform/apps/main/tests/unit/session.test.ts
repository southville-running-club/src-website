import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `session.ts` never verifies a JWT signature itself — it asks Supabase Auth, which is what
 * actually holds the signing key. So every test here fakes *that* boundary rather than
 * hand-crafting valid tokens: `createAnonClient` is mocked, and each test controls what
 * `auth.getUser` / `auth.refreshSession` answers, exactly as a real GoTrue would for a
 * tampered token, an expired one, or a healthy one.
 *
 * The one thing this file does construct by hand is a JWT-*shaped* string, purely so the
 * unsigned, advisory reads have something to parse: `exp`, which only decides whether to
 * bother asking for a refresh early, and `amr`, which carries the authentication time
 * ADR-019's absolute lifetime is measured from. Neither is treated as proof of anything
 * here; the mocked `getUser`/`refreshSession` calls are what decide the outcome, and in the
 * Worker itself `amr` is only ever read off a token one of those two has just accepted.
 *
 * **That the real GoTrue sends `amr` at all, and keeps its timestamp across a refresh, is
 * not this file's claim to make** — a mock that returns whatever it was told proves nothing
 * about Supabase. `packages/db/tests/identity-sessions.test.ts` is where that is checked,
 * against the real local Auth.
 */

const getUser = vi.fn();
const refreshSession = vi.fn();
const setSession = vi.fn();
const signOut = vi.fn();

vi.mock('@src/shared', () => ({
  createAnonClient: () => ({
    auth: { getUser, refreshSession, setSession, signOut },
  }),
}));

const {
  ABSOLUTE_LIFETIME_SECONDS,
  ACCESS_COOKIE,
  EXPIRY_COOKIE,
  IDLE_TIMEOUT_SECONDS,
  REFRESH_COOKIE,
  clearedSessionCookies,
  newSessionCookies,
  readSession,
  signOut: endSession,
} = await import('../../worker/session');

const CONFIG = { url: 'http://127.0.0.1:54321', anonKey: 'zz-anon-key' };
const NOW = 1_800_000_000;

/** A deadline comfortably ahead of `NOW`, so a test that is about something else is not
 *  quietly about the absolute lifetime instead. */
const LIVE_DEADLINE = NOW + 6 * 60 * 60;

function toBase64Url(json: string): string {
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * A JWT-shaped string carrying a real, readable `exp` claim, optionally the `amr` claim
 * GoTrue puts the authentication time in, and a signature that is never checked by
 * `session.ts` — only by the mocked `getUser`/`refreshSession` calls.
 */
function jwt(exp: number, authTime?: number): string {
  const claims =
    authTime === undefined
      ? { exp }
      : { exp, amr: [{ method: 'password', timestamp: authTime }] };

  return `${toBase64Url('{"alg":"none"}')}.${toBase64Url(JSON.stringify(claims))}.sig`;
}

function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** The `Max-Age` off one `Set-Cookie` line, as a number. */
function maxAgeOf(cookie: string): number {
  return Number(/Max-Age=(\d+)/.exec(cookie)?.[1] ?? NaN);
}

function cookieNamed(cookies: string[], name: string): string {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`))!;
}

beforeEach(() => {
  // Every expiry revokes at Supabase on its way out, so the two calls that does have to
  // answer in any test that ends a session — including the ones that are about something
  // else and merely pass through it.
  setSession.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readSession, with no cookie at all', () => {
  it('returns null and asks Supabase nothing', async () => {
    const result = await readSession(CONFIG, null, NOW, true);

    expect(result.session).toBeNull();
    expect(result.setCookies).toEqual([]);
    expect(result.timedOut).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('readSession, with a malformed access cookie', () => {
  it('returns null when there is no refresh token to fall back on', async () => {
    const header = cookieHeader({
      [ACCESS_COOKIE]: 'not-a-jwt-at-all',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    // An undecodable token is treated as "assume it is close to expiring" — it never
    // reaches getUser, because there is nothing to refresh it with either.
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('readSession, with an expired access token', () => {
  it('returns null when refreshing is not possible either', async () => {
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW - 3600),
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('refreshes when a refresh token is present, and returns the new session', async () => {
    refreshSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'zz-person' },
          access_token: 'zz-new-access',
          refresh_token: 'zz-new-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW - 3600),
      [REFRESH_COOKIE]: 'zz-old-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toEqual({ userId: 'zz-person', accessToken: 'zz-new-access' });
    expect(result.setCookies).toHaveLength(3);
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'zz-old-refresh' });
  });

  it('carries the absolute deadline through the refresh rather than minting a new one', async () => {
    refreshSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'zz-person' },
          access_token: 'zz-new-access',
          refresh_token: 'zz-new-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW - 3600),
      [REFRESH_COOKIE]: 'zz-old-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    // The whole point of the absolute half: an hour of refreshing does not buy another
    // twelve. Only an authentication moves this number.
    expect(cookieNamed(result.setCookies, EXPIRY_COOKIE)).toContain(
      `${EXPIRY_COOKIE}=${LIVE_DEADLINE}`,
    );
  });
});

describe('readSession, with a tampered access token', () => {
  it('treats a getUser refusal as invalid, indistinguishably from expired', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });

    // A generous, unexpired-looking exp — the tampering is in the (unchecked) signature,
    // not the claims, exactly as a real forged token would look to this file.
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'x' },
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(getUser).toHaveBeenCalledWith(expect.stringContaining('.'));
  });

  it('falls back to a refresh token if one is present', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });
    refreshSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'zz-person' },
          access_token: 'zz-new-access',
          refresh_token: 'zz-new-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-old-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session?.userId).toBe('zz-person');
  });
});

describe('readSession, with a healthy access token', () => {
  it('uses it directly, and re-issues all three cookies so the idle window slides', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    const token = jwt(NOW + 3600);
    const header = cookieHeader({
      [ACCESS_COOKIE]: token,
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toEqual({ userId: 'zz-person', accessToken: token });
    expect(refreshSession).not.toHaveBeenCalled();

    // Three, every time — a window that is not re-issued is not a sliding window, and the
    // one this replaced set nothing at all on the common path.
    expect(result.setCookies).toHaveLength(3);
    for (const cookie of result.setCookies) {
      expect(maxAgeOf(cookie)).toBe(IDLE_TIMEOUT_SECONDS);
    }
  });

  it('shortens the idle window to whatever is left of the absolute one', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    // Ten minutes to go on a thirty-minute window: the cookies must not outlive the
    // deadline they are carrying, or the last of them would be presented after it.
    const nearly = NOW + 600;
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(nearly),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).not.toBeNull();
    for (const cookie of result.setCookies) {
      expect(maxAgeOf(cookie)).toBe(600);
    }
  });
});

describe('readSession, past the absolute lifetime', () => {
  it('ends a session whose deadline cookie has passed, and revokes it at Supabase', async () => {
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(NOW - 1),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.timedOut).toBe(true);
    // Not merely forgotten. A copy of the cookie jar taken before the deadline is refused
    // afterwards too, which is the difference between an expiry and an amnesia.
    expect(signOut).toHaveBeenCalled();
    // Asked nothing about who this was — the deadline is decided before Supabase is.
    expect(getUser).not.toHaveBeenCalled();
    for (const cookie of result.setCookies) {
      expect(maxAgeOf(cookie)).toBe(0);
    }
  });

  it('ends a session carrying no deadline at all, which is what a thirty-day one looks like now', async () => {
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(signOut).toHaveBeenCalled();
  });

  it('ends a session whose deadline cookie is not a number', async () => {
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: 'the-thirty-second-of-never',
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.timedOut).toBe(true);
  });

  it('ends it on the signed authentication time even where the cookie says otherwise', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    // The case the cookie alone cannot answer: somebody holding a stolen jar writes
    // themselves a deadline a year out. GoTrue signed the authentication time into the
    // token, thirteen hours ago, and that is what decides it.
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600, NOW - 13 * 60 * 60),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(NOW + 365 * 24 * 60 * 60),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(signOut).toHaveBeenCalled();
  });

  it('keeps a session whose signed authentication time is still inside the window', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    const authTime = NOW - 11 * 60 * 60;
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600, authTime),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(authTime + ABSOLUTE_LIFETIME_SECONDS),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session?.userId).toBe('zz-person');
    // An hour left of the twelve, so the half-hour idle window is the shorter of the two.
    expect(maxAgeOf(cookieNamed(result.setCookies, ACCESS_COOKIE))).toBe(
      IDLE_TIMEOUT_SECONDS,
    );
  });

  it('falls back to the cookie when GoTrue sends no authentication time', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    // `amr` is optional in GoTrue's own token type. Losing it costs the unforgeable half
    // of the deadline, not the deadline — this session carries on to its cookie's own.
    const header = cookieHeader({
      [ACCESS_COOKIE]: jwt(NOW + 3600),
      [REFRESH_COOKIE]: 'zz-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session?.userId).toBe('zz-person');
  });
});

describe('readSession, with a failed refresh', () => {
  it('treats the session as ended, but not as timed out', async () => {
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'x' },
    });

    const header = cookieHeader({
      [REFRESH_COOKIE]: 'zz-dead-refresh',
      [EXPIRY_COOKIE]: String(LIVE_DEADLINE),
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    // A refusal from GoTrue is not the club's timeout, and saying "you were signed out
    // because your session had been open a while" about a revoked token would be a guess.
    expect(result.timedOut).toBe(false);
    for (const cookie of result.setCookies) {
      expect(maxAgeOf(cookie)).toBe(0);
    }
  });
});

describe('newSessionCookies', () => {
  it('mints a deadline twelve hours out, and an idle window of thirty minutes', () => {
    const cookies = newSessionCookies('zz-access', 'zz-refresh', NOW, true);

    expect(cookies).toHaveLength(3);
    expect(cookieNamed(cookies, EXPIRY_COOKIE)).toContain(
      `${EXPIRY_COOKIE}=${NOW + ABSOLUTE_LIFETIME_SECONDS}`,
    );
    for (const cookie of cookies) {
      expect(maxAgeOf(cookie)).toBe(IDLE_TIMEOUT_SECONDS);
    }
  });

  it('is the numbers ADR-019 names, in seconds', () => {
    expect(IDLE_TIMEOUT_SECONDS).toBe(30 * 60);
    expect(ABSOLUTE_LIFETIME_SECONDS).toBe(12 * 60 * 60);
  });
});

describe('Secure, over http and over https', () => {
  it('is present only when the request arrived over https', () => {
    expect(clearedSessionCookies(true).every((c) => c.includes('Secure'))).toBe(true);
    expect(clearedSessionCookies(false).some((c) => c.includes('Secure'))).toBe(false);
  });

  it('always sets SameSite=Lax, HttpOnly and Path=/', () => {
    for (const cookie of [
      ...clearedSessionCookies(true),
      ...newSessionCookies('zz-access', 'zz-refresh', NOW, true),
    ]) {
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
    }
  });

  it('clears all three, so no half a session is left behind', () => {
    const names = clearedSessionCookies(true).map((cookie) => cookie.split('=')[0]);

    expect(names).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, EXPIRY_COOKIE]);
  });
});

describe('signOut', () => {
  it('sets the session before signing out, so gotrue-js has a token to revoke', async () => {
    setSession.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });

    await endSession(CONFIG, 'zz-access', 'zz-refresh');

    expect(setSession).toHaveBeenCalledWith({
      access_token: 'zz-access',
      refresh_token: 'zz-refresh',
    });
    expect(signOut).toHaveBeenCalled();
  });

  it('does not throw when Supabase cannot be reached', async () => {
    setSession.mockRejectedValue(new Error('network down'));

    await expect(endSession(CONFIG, 'zz-access', 'zz-refresh')).resolves.toBeUndefined();
  });
});
