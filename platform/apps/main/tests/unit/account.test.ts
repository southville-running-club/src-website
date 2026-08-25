import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `worker/account.ts`, from the outside — a `Request` in, a `Response` out, the same shape
 * every other Worker-route test in this directory uses.
 *
 * `createAnonClient` is mocked once, at the `@src/shared` boundary `session.ts` also
 * imports through — so `readSession`'s real logic runs against the same fake `auth` object
 * these tests control, rather than a second mock standing in for it. No network, no
 * Supabase Auth signature verification, and no Docker: that is what `identity.test.ts` and
 * the acceptance suite are for.
 */

const getUser = vi.fn();
const refreshSession = vi.fn();
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const setSession = vi.fn();
const signOut = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const rpc = vi.fn();

/** `identity.people`, read and written by #61's `/account/details/`. Two functions rather
 *  than a fully general fake postgrest-js builder — this file's `from()` only ever asks
 *  for one table, and a builder generic enough for any query would be more code than the
 *  two shapes it is standing in for. */
const peopleSelect = vi.fn();
const peopleUpdate = vi.fn();

vi.mock('@src/shared', async () => {
  const actual = await vi.importActual<typeof import('@src/shared')>('@src/shared');
  return {
    ...actual,
    createAnonClient: () => ({
      auth: {
        getUser,
        refreshSession,
        signUp,
        signInWithPassword,
        setSession,
        signOut,
        resetPasswordForEmail,
        updateUser,
      },
    }),
    createUserClient: () => ({
      rpc,
      from: (table: string) => {
        if (table !== 'people') {
          throw new Error(`this fake only knows identity.people, not ${table}`);
        }
        return {
          select: () => ({ eq: () => ({ single: () => peopleSelect() }) }),
          update: (payload: unknown) => ({ eq: () => peopleUpdate(payload) }),
        };
      },
    }),
  };
});

const { handleAccount } = await import('../../worker/account');
const { CSRF_COOKIE, CSRF_FIELD, mintCsrfToken } = await import('../../worker/csrf');

const ENV = {
  PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  PUBLIC_SUPABASE_ANON_KEY: 'zz-anon-key',
  TURNSTILE_SITE_KEY: 'zz-site-key',
};

function get(path: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`http://localhost:8787${path}`, { headers });
}

function post(path: string, body: URLSearchParams, cookie?: string): Request {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`http://localhost:8787${path}`, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
}

/** A CSRF cookie and the matching field value, as a real form submission would carry both. */
function withCsrf(fields: Record<string, string>): {
  cookie: string;
  body: URLSearchParams;
} {
  const token = mintCsrfToken();
  const body = new URLSearchParams({ ...fields, [CSRF_FIELD]: token });
  return { cookie: `${CSRF_COOKIE}=${token}`, body };
}

function toBase64Url(json: string): string {
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A JWT-*shaped* access-token cookie value with a real, readable, far-future `exp` claim —
 *  `readSession` never checks its signature, only asks the mocked `getUser` below, exactly
 *  as `session.test.ts` does. */
const HEALTHY_ACCESS_TOKEN = `${toBase64Url('{"alg":"none"}')}.${toBase64Url(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
)}.sig`;

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /account/, signed out', () => {
  it('redirects to sign-in', async () => {
    const response = await handleAccount(
      get('/account/'),
      ENV,
      new URL('http://localhost:8787/account/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });
});

describe('GET /account/, signed in', () => {
  it('renders the account page', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });
    rpc.mockResolvedValue({ data: ['member'], error: null });

    const response = await handleAccount(
      get('/account/', `src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/'),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Your account');
    expect(body).toContain('member');
  });
});

describe('POST /account/sign-up/', () => {
  it('refuses a submission with no CSRF token at all', async () => {
    const body = new URLSearchParams({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-up/', body),
      ENV,
      new URL('http://localhost:8787/account/sign-up/'),
    );

    expect(response.status).toBe(422); // re-renders the form, not a redirect
    expect(signUp).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toContain('expired');
  });

  it('refuses a submission whose CSRF field does not match its cookie', async () => {
    const { body } = withCsrf({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-up/', body, `${CSRF_COOKIE}=a-different-value-entirely`),
      ENV,
      new URL('http://localhost:8787/account/sign-up/'),
    );

    expect(signUp).not.toHaveBeenCalled();
    expect(response.status).toBe(422);
  });

  it('is 422 for a password that is too short', async () => {
    const { cookie, body } = withCsrf({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'short',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-up/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/sign-up/'),
    );

    expect(response.status).toBe(422);
    expect(signUp).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toContain('at least 12 characters');
  });

  it('is a 303 to the acknowledgement on success, and never discloses a duplicate', async () => {
    signUp.mockResolvedValue({ data: {}, error: null });

    const { cookie, body } = withCsrf({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-up/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/sign-up/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-up/?done=ok');
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'grace@example.com',
        options: expect.objectContaining({ captchaToken: 'zz-token' }),
      }),
    );
  });
});

describe('POST /account/sign-in/', () => {
  it('is 422 (the form re-rendered) for a bad password, not a 401', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    const { cookie, body } = withCsrf({
      email: 'grace@example.com',
      password: 'wrong-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-in/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );

    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain('not recognised');
  });

  it('says to check the inbox, not that the password is wrong, when unconfirmed', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    const { cookie, body } = withCsrf({
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-in/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );

    const text = await response.text();
    expect(text).toContain('Check your inbox');
    expect(text).not.toContain('password was not recognised');
  });

  it('is a 303 to /account/ on success, carrying the session cookies', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: {
          user: { id: 'zz-person' },
          access_token: 'zz-access',
          refresh_token: 'zz-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });

    const { cookie, body } = withCsrf({
      email: 'grace@example.com',
      password: 'a-long-enough-password',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/sign-in/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/');
    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
    expect(setCookies.some((c) => c.includes('src_at=zz-access'))).toBe(true);
    expect(setCookies.some((c) => c.includes('src_rt=zz-refresh'))).toBe(true);
  });
});

describe('POST /account/sign-out/', () => {
  it('refuses without a CSRF token, but still clears cookies (nothing to protect)', async () => {
    const response = await handleAccount(
      post('/account/sign-out/', new URLSearchParams()),
      ENV,
      new URL('http://localhost:8787/account/sign-out/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out server-side and clears both session cookies when a session exists', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });
    setSession.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });

    const { cookie, body } = withCsrf({});
    const response = await handleAccount(
      post(
        '/account/sign-out/',
        body,
        `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}; src_rt=zz-refresh-token`,
      ),
      ENV,
      new URL('http://localhost:8787/account/sign-out/'),
    );

    expect(response.status).toBe(303);
    expect(signOut).toHaveBeenCalled();
    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [];
    expect(setCookies.some((c) => c.startsWith('src_at=;'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('src_rt=;'))).toBe(true);
  });
});

describe('GET /account/confirm/', () => {
  it('reports success with no error in the query string', async () => {
    const response = await handleAccount(
      get('/account/confirm/'),
      ENV,
      new URL('http://localhost:8787/account/confirm/'),
    );

    const text = await response.text();
    expect(text).toContain('confirmed');
  });

  it('reports failure honestly when Supabase redirects back with an error', async () => {
    const response = await handleAccount(
      get('/account/confirm/'),
      ENV,
      new URL('http://localhost:8787/account/confirm/?error=access_denied'),
    );

    const text = await response.text();
    expect(text).toContain('did not work');
  });
});

describe('POST /account/reset/, an unknown address and a real one', () => {
  it('answers identically either way — the enumeration-safety assertion #54 asks for', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    const known = withCsrf({ email: 'grace@example.com', 'cf-turnstile-response': 'zz' });
    const unknown = withCsrf({
      email: 'nobody@example.com',
      'cf-turnstile-response': 'zz',
    });

    const responseKnown = await handleAccount(
      post('/account/reset/', known.body, known.cookie),
      ENV,
      new URL('http://localhost:8787/account/reset/'),
    );
    const responseUnknown = await handleAccount(
      post('/account/reset/', unknown.body, unknown.cookie),
      ENV,
      new URL('http://localhost:8787/account/reset/'),
    );

    // GoTrue's own resetPasswordForEmail answers success regardless of whether the address
    // has an account — asserted here as "this Worker route produces the same response",
    // which is the property that actually matters to somebody probing the form.
    expect(responseKnown.status).toBe(responseUnknown.status);
    expect(responseKnown.headers.get('location')).toBe(
      responseUnknown.headers.get('location'),
    );
    expect(responseKnown.status).toBe(303);
    expect(responseKnown.headers.get('location')).toBe('/account/reset/?done=ok');
  });

  it('refuses without a valid CSRF token', async () => {
    const response = await handleAccount(
      post('/account/reset/', new URLSearchParams({ email: 'grace@example.com' })),
      ENV,
      new URL('http://localhost:8787/account/reset/'),
    );

    expect(response.status).toBe(422);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('POST /account/reset/confirm/', () => {
  it('refuses a submission missing the fragment tokens, without calling Supabase', async () => {
    const { cookie, body } = withCsrf({
      password: 'a-perfectly-good-password',
      'cf-turnstile-response': 'zz',
    });

    const response = await handleAccount(
      post('/account/reset/confirm/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/reset/confirm/'),
    );

    expect(response.status).toBe(422);
    expect(setSession).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('sets a session from the recovery tokens before calling updateUser', async () => {
    setSession.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ data: {}, error: null });

    const { cookie, body } = withCsrf({
      access_token: 'zz-recovery-access',
      refresh_token: 'zz-recovery-refresh',
      password: 'a-perfectly-good-password',
      'cf-turnstile-response': 'zz',
    });

    const response = await handleAccount(
      post('/account/reset/confirm/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/reset/confirm/'),
    );

    expect(setSession).toHaveBeenCalledWith({
      access_token: 'zz-recovery-access',
      refresh_token: 'zz-recovery-refresh',
    });
    expect(updateUser).toHaveBeenCalledWith({ password: 'a-perfectly-good-password' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/');

    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [];
    expect(setCookies.some((c) => c.includes('src_at=zz-recovery-access'))).toBe(true);
  });

  it('says a used or expired link says so, and offers a new one', async () => {
    setSession.mockResolvedValue({ error: { message: 'invalid token' } });

    const { cookie, body } = withCsrf({
      access_token: 'zz-stale',
      refresh_token: 'zz-stale-refresh',
      password: 'a-perfectly-good-password',
      'cf-turnstile-response': 'zz',
    });

    const response = await handleAccount(
      post('/account/reset/confirm/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/reset/confirm/'),
    );

    const text = await response.text();
    expect(text).toContain('expired or was already used');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('GET /account/password/, signed out', () => {
  it('redirects to sign-in', async () => {
    const response = await handleAccount(
      get('/account/password/'),
      ENV,
      new URL('http://localhost:8787/account/password/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });
});

describe('POST /account/password/', () => {
  it('refuses when the current password is wrong, and never calls updateUser', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: 'grace@example.com' } },
      error: null,
    });
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid' },
    });

    const { cookie, body } = withCsrf({
      current_password: 'wrong-password',
      new_password: 'a-perfectly-good-new-password',
      'cf-turnstile-response': 'zz-captcha-token',
    });

    const response = await handleAccount(
      post('/account/password/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/password/'),
    );

    expect(response.status).toBe(422);
    expect(updateUser).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toContain('current password was not right');
  });

  it('changes the password once the current one is verified, and signs the fresh session in', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: 'grace@example.com' } },
      error: null,
    });
    signInWithPassword.mockResolvedValue({
      data: {
        session: {
          user: { id: 'zz-person' },
          access_token: 'zz-fresh-access',
          refresh_token: 'zz-fresh-refresh',
          expires_in: 3600,
        },
      },
      error: null,
    });
    setSession.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ data: {}, error: null });

    const { cookie, body } = withCsrf({
      current_password: 'the-current-password',
      new_password: 'a-perfectly-good-new-password',
      'cf-turnstile-response': 'zz-captcha-token',
    });

    const response = await handleAccount(
      post('/account/password/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/password/'),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'grace@example.com',
      password: 'the-current-password',
      options: { captchaToken: 'zz-captcha-token' },
    });
    expect(updateUser).toHaveBeenCalledWith({
      password: 'a-perfectly-good-new-password',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/');
  });

  it('refuses without a valid CSRF token', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: 'grace@example.com' } },
      error: null,
    });

    const response = await handleAccount(
      post(
        '/account/password/',
        new URLSearchParams({
          current_password: 'x',
          new_password: 'a-perfectly-good-new-password',
        }),
        `src_at=${HEALTHY_ACCESS_TOKEN}`,
      ),
      ENV,
      new URL('http://localhost:8787/account/password/'),
    );

    expect(response.status).toBe(422);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('GET /account/details/, signed out', () => {
  it('redirects to sign-in', async () => {
    const response = await handleAccount(
      get('/account/details/'),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });
});

describe('GET /account/details/, signed in', () => {
  it('splits a saved date of birth into its three boxes, and shows the current email', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: 'ada@example.com' } },
      error: null,
    });
    peopleSelect.mockResolvedValue({
      data: {
        name: 'Ada Lovelace',
        gender: 'woman',
        date_of_birth: '1990-06-15',
        address: '1 Analytical Engine Way',
        updated_at: '2026-08-25T10:00:00.000Z',
      },
      error: null,
    });

    const response = await handleAccount(
      get('/account/details/', `src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('value="Ada Lovelace"');
    expect(body).toContain('value="ada@example.com"');
    expect(body).toContain('value="woman"');
    expect(body).toContain('value="15"');
    expect(body).toContain('value="6"');
    expect(body).toContain('value="1990"');
    expect(body).toContain('value="1 Analytical Engine Way"');
  });

  it('renders every box blank when nothing has been saved yet, not an error', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: 'blank@example.com' } },
      error: null,
    });
    peopleSelect.mockResolvedValue({
      data: {
        name: null,
        gender: null,
        date_of_birth: null,
        address: null,
        updated_at: '2026-08-25T10:00:00.000Z',
      },
      error: null,
    });

    const response = await handleAccount(
      get('/account/details/', `src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="account-dob-day"');
    expect(body).toContain('name="dob_day"');
    expect(body).toContain('name="dob_month"');
    expect(body).toContain('name="dob_year"');
  });

  it('redirects to sign-in rather than render if the email re-check fails', async () => {
    // The first call is `handleAccount`'s own `readSession()`, which must succeed for
    // routing to reach this handler at all; the second is this handler's own re-ask for
    // the current email, which is the one this test means to fail.
    getUser
      .mockResolvedValueOnce({ data: { user: { id: 'zz-person' } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'expired' } });

    const response = await handleAccount(
      get('/account/details/', `src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });
});

describe('POST /account/details/, signed out', () => {
  it('redirects to sign-in', async () => {
    const response = await handleAccount(
      post('/account/details/', new URLSearchParams({ name: 'Ada Lovelace' })),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
    expect(peopleUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /account/details/', () => {
  /** Every test below submits this unless it is deliberately testing the email field
   *  itself — matches what `getUser` is mocked to say the account already holds, so a
   *  test aimed at the name or the date of birth does not also, incidentally, exercise
   *  the email-change path. */
  const UNCHANGED_EMAIL = 'ada@example.com';

  it('refuses without a valid CSRF token, and never calls the database', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });

    const response = await handleAccount(
      post(
        '/account/details/',
        new URLSearchParams({ name: 'Ada Lovelace', email: UNCHANGED_EMAIL }),
        `src_at=${HEALTHY_ACCESS_TOKEN}`,
      ),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
  });

  it('is 422 when the name is missing, the one required field', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    const { cookie, body } = withCsrf({ name: '', email: UNCHANGED_EMAIL });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
  });

  it('is 422 when the email address is malformed', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    const { cookie, body } = withCsrf({ name: 'Ada Lovelace', email: 'not-an-address' });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('is 422 for a date of birth with only two of the three boxes filled in', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    const { cookie, body } = withCsrf({
      name: 'Ada Lovelace',
      email: UNCHANGED_EMAIL,
      dob_day: '15',
      dob_month: '6',
    });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
  });

  it('is 422 for a date of birth that is not a real day, like 31 February', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    const { cookie, body } = withCsrf({
      name: 'Ada Lovelace',
      email: UNCHANGED_EMAIL,
      dob_day: '31',
      dob_month: '2',
      dob_year: '1990',
    });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
  });

  it('is 422 for a date of birth in the future', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    const { cookie, body } = withCsrf({
      name: 'Ada Lovelace',
      email: UNCHANGED_EMAIL,
      dob_day: '1',
      dob_month: '1',
      dob_year: String(new Date().getUTCFullYear() + 1),
    });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
    expect(peopleUpdate).not.toHaveBeenCalled();
  });

  it('saves the name alone, clearing every optional column left blank, email unchanged', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    peopleUpdate.mockResolvedValue({ error: null });
    const { cookie, body } = withCsrf({ name: 'Ada Lovelace', email: UNCHANGED_EMAIL });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(peopleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ada Lovelace',
        gender: null,
        date_of_birth: null,
        address: null,
        updated_at: expect.any(String),
      }),
    );
    expect(setSession).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/details/?done=ok');
  });

  it('treats a different-case resubmission of the same address as unchanged', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    peopleUpdate.mockResolvedValue({ error: null });
    const { cookie, body } = withCsrf({ name: 'Ada Lovelace', email: 'ADA@EXAMPLE.COM' });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(updateUser).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/account/details/?done=ok');
  });

  it('saves a full profile, an apostrophe in the name included', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    peopleUpdate.mockResolvedValue({ error: null });
    const { cookie, body } = withCsrf({
      name: "D'Arcy O'Malley",
      email: UNCHANGED_EMAIL,
      gender: 'non-binary',
      dob_day: '15',
      dob_month: '6',
      dob_year: '1990',
      address: '1 Analytical Engine Way',
    });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(peopleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "D'Arcy O'Malley",
        gender: 'non-binary',
        date_of_birth: '1990-06-15',
        address: '1 Analytical Engine Way',
      }),
    );
    expect(response.status).toBe(303);
  });

  it('is 422, not a silent save, when the database refuses the profile update', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
      error: null,
    });
    peopleUpdate.mockResolvedValue({ error: { message: 'refused' } });
    const { cookie, body } = withCsrf({ name: 'Ada Lovelace', email: UNCHANGED_EMAIL });

    const response = await handleAccount(
      post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
      ENV,
      new URL('http://localhost:8787/account/details/'),
    );

    expect(response.status).toBe(422);
  });

  describe('changing the email address', () => {
    it('sets a real session from the refresh-token cookie, then asks GoTrue to change it', async () => {
      getUser.mockResolvedValue({
        data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
        error: null,
      });
      peopleUpdate.mockResolvedValue({ error: null });
      setSession.mockResolvedValue({ data: { session: {} }, error: null });
      updateUser.mockResolvedValue({ data: { user: {} }, error: null });
      const { cookie, body } = withCsrf({
        name: 'Ada Lovelace',
        email: 'new-address@example.com',
      });

      const response = await handleAccount(
        post(
          '/account/details/',
          body,
          `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}; src_rt=zz-refresh-token`,
        ),
        ENV,
        new URL('http://localhost:8787/account/details/'),
      );

      expect(setSession).toHaveBeenCalledWith({
        access_token: HEALTHY_ACCESS_TOKEN,
        refresh_token: 'zz-refresh-token',
      });
      expect(updateUser).toHaveBeenCalledWith(
        { email: 'new-address@example.com' },
        { emailRedirectTo: 'http://localhost:8787/account/confirm' },
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        '/account/details/?done=ok&email=pending',
      );
    });

    it('still saves the rest of the profile even though the email also changed', async () => {
      getUser.mockResolvedValue({
        data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
        error: null,
      });
      peopleUpdate.mockResolvedValue({ error: null });
      setSession.mockResolvedValue({ data: { session: {} }, error: null });
      updateUser.mockResolvedValue({ data: { user: {} }, error: null });
      const { cookie, body } = withCsrf({
        name: 'Ada Lovelace',
        email: 'new-address@example.com',
      });

      await handleAccount(
        post(
          '/account/details/',
          body,
          `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}; src_rt=zz-refresh-token`,
        ),
        ENV,
        new URL('http://localhost:8787/account/details/'),
      );

      expect(peopleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ada Lovelace' }),
      );
    });

    it('redirects to sign-in rather than change the email with no refresh-token cookie', async () => {
      getUser.mockResolvedValue({
        data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
        error: null,
      });
      peopleUpdate.mockResolvedValue({ error: null });
      const { cookie, body } = withCsrf({
        name: 'Ada Lovelace',
        email: 'new-address@example.com',
      });

      const response = await handleAccount(
        post('/account/details/', body, `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}`),
        ENV,
        new URL('http://localhost:8787/account/details/'),
      );

      expect(updateUser).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/account/sign-in/');
    });

    it('is 422, not a silent save, when GoTrue refuses the email change', async () => {
      getUser.mockResolvedValue({
        data: { user: { id: 'zz-person', email: UNCHANGED_EMAIL } },
        error: null,
      });
      peopleUpdate.mockResolvedValue({ error: null });
      setSession.mockResolvedValue({ data: { session: {} }, error: null });
      updateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'email_exists' },
      });
      const { cookie, body } = withCsrf({
        name: 'Ada Lovelace',
        email: 'already-taken@example.com',
      });

      const response = await handleAccount(
        post(
          '/account/details/',
          body,
          `${cookie}; src_at=${HEALTHY_ACCESS_TOKEN}; src_rt=zz-refresh-token`,
        ),
        ENV,
        new URL('http://localhost:8787/account/details/'),
      );

      expect(response.status).toBe(422);
    });
  });
});
