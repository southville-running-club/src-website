import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `session.ts` never verifies a JWT signature itself — it asks Supabase Auth, which is what
 * actually holds the signing key. So every test here fakes *that* boundary rather than
 * hand-crafting valid tokens: `createAnonClient` is mocked, and each test controls what
 * `auth.getUser` / `auth.refreshSession` answers, exactly as a real GoTrue would for a
 * tampered token, an expired one, or a healthy one.
 *
 * The one thing this file does construct by hand is a JWT-*shaped* string, purely so
 * `decodeExpiryUnverified` — the unsigned, advisory read used only to decide whether to
 * bother asking for a refresh early — has something to parse. It is never treated as proof
 * of anything; the mocked `getUser`/`refreshSession` calls are what decide the outcome.
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
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearedSessionCookies,
  readSession,
  signOut: endSession,
} = await import('../../worker/session');

const CONFIG = { url: 'http://127.0.0.1:54321', anonKey: 'zz-anon-key' };
const NOW = 1_800_000_000;

function toBase64Url(json: string): string {
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A JWT-shaped string carrying a real, readable `exp` claim and a signature that is never
 *  checked by this file — only by the mocked `getUser`/`refreshSession` calls. */
function jwt(exp: number): string {
  return `${toBase64Url('{"alg":"none"}')}.${toBase64Url(JSON.stringify({ exp }))}.sig`;
}

function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('readSession, with no cookie at all', () => {
  it('returns null and asks Supabase nothing', async () => {
    const result = await readSession(CONFIG, null, NOW, true);

    expect(result.session).toBeNull();
    expect(result.setCookies).toEqual([]);
    expect(getUser).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('readSession, with a malformed access cookie', () => {
  it('returns null when there is no refresh token to fall back on', async () => {
    const header = cookieHeader({ [ACCESS_COOKIE]: 'not-a-jwt-at-all' });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.setCookies).toEqual([]);
    // An undecodable token is treated as "assume it is close to expiring" — it never
    // reaches getUser, because there is nothing to refresh it with either.
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('readSession, with an expired access token', () => {
  it('returns null when refreshing is not possible either', async () => {
    const header = cookieHeader({ [ACCESS_COOKIE]: jwt(NOW - 3600) });

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
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toEqual({ userId: 'zz-person', accessToken: 'zz-new-access' });
    expect(result.setCookies).toHaveLength(2);
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'zz-old-refresh' });
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
    const header = cookieHeader({ [ACCESS_COOKIE]: jwt(NOW + 3600) });

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
    });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session?.userId).toBe('zz-person');
  });
});

describe('readSession, with a healthy access token', () => {
  it('uses it directly and sets no cookies', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });

    const token = jwt(NOW + 3600);
    const header = cookieHeader({ [ACCESS_COOKIE]: token });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toEqual({ userId: 'zz-person', accessToken: token });
    expect(result.setCookies).toEqual([]);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('readSession, with a failed refresh', () => {
  it('treats the session as ended', async () => {
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'x' },
    });

    const header = cookieHeader({ [REFRESH_COOKIE]: 'zz-dead-refresh' });

    const result = await readSession(CONFIG, header, NOW, true);

    expect(result.session).toBeNull();
    expect(result.setCookies).toEqual([]);
  });
});

describe('Secure, over http and over https', () => {
  it('is present only when the request arrived over https', () => {
    expect(clearedSessionCookies(true).every((c) => c.includes('Secure'))).toBe(true);
    expect(clearedSessionCookies(false).some((c) => c.includes('Secure'))).toBe(false);
  });

  it('always sets SameSite=Lax, HttpOnly and Path=/', () => {
    for (const cookie of clearedSessionCookies(true)) {
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
    }
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
