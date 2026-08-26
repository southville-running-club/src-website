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
const verifyOtp = vi.fn();
const rpc = vi.fn();

/** `identity.people`, read and written by #61's `/account/details/`. Two functions rather
 *  than a fully general fake postgrest-js builder — this file's `from()` only ever asks
 *  for one table, and a builder generic enough for any query would be more code than the
 *  two shapes it is standing in for. */
const peopleSelect = vi.fn();
const peopleUpdate = vi.fn();

/** #55 and #56's PKCE client. `minted()` answers a verifier by default because the real
 *  supabase-js mints one while *building* the request rather than after it succeeds — which
 *  is what makes the magic-link response identical for a known and an unknown address, right
 *  down to the `set-cookie`. A test that let the verifier depend on the outcome would be
 *  asserting against a fake that leaks what the real one does not. */
const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
const exchangeCodeForSession = vi.fn();
const mintedVerifier = vi.fn(() => 'zz-code-verifier');

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
        verifyOtp,
      },
    }),
    createPkceClient: () => ({
      client: { auth: { signInWithOtp, signInWithOAuth, exchangeCodeForSession } },
      store: { minted: mintedVerifier },
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

/**
 * The club's chrome on the pages the **Worker** renders.
 *
 * **`base.css` has carried these styles all along and `account.css` already concatenates it**,
 * so this was never a branding decision that went the other way — it was markup that no layout
 * put there, because `Base.astro` is an Astro layout and a Worker cannot reach it. Three
 * rendering paths, two layouts, and this is the third one catching up.
 */
describe('the club chrome, on every account page', () => {
  async function accountPage(): Promise<string> {
    const response = await handleAccount(
      get('/account/sign-in/'),
      ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );
    return response.text();
  }

  it('links the favicon, so the tab is not a blank glyph', async () => {
    // `apps/timing/app/layout.tsx` carries this exact link with a comment saying that without
    // it "`/timing` showed a browser's blank page glyph beside every other tab". The same
    // reasoning was never applied here, so `/account/` showed that glyph from the day it was
    // built. One file, three front doors.
    expect(await accountPage()).toContain('<link rel="icon" href="/favicon.svg"');
  });

  it('offers a way back to the club site', async () => {
    // **The part a member actually notices.** Before this there was no route from the account
    // area back to the website at all — no logo, no link, no breadcrumb. Somebody who signed
    // in and then wanted the race page had to edit the address bar.
    const markup = (await accountPage()).replace(/\s+/g, ' ');

    expect(markup).toContain('class="site-banner"');
    expect(markup).toContain('href="/" aria-label="Southville Running Club, home"');
  });

  it('carries the footer, and with it the privacy notice', async () => {
    // #60 published a site-wide privacy notice and every other page foots with a link to it.
    // The account area is where somebody's standing record actually lives, so it was the one
    // place the link was missing and the one place it matters most.
    const markup = (await accountPage()).replace(/\s+/g, ' ');

    expect(markup).toContain('class="site-footer"');
    expect(markup).toContain('href="/privacy/"');
  });

  it('names the club once, not twice, for a screen reader', async () => {
    // The wordmark is `aria-hidden` because the link around it is already labelled. Rendering
    // it with `role="img"` and its own `aria-label` as well would announce "Southville Running
    // Club" twice in a row — the exact thing `ClubLogo.astro`'s `labelled` prop exists to
    // avoid, and easy to lose when copying markup between frameworks.
    const markup = await accountPage();

    expect(markup).toContain('class="site-logo"');
    expect(markup).not.toContain('aria-label="Southville Running Club"');
  });
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

  /**
   * #101 — the link moves onto the club's hostname, and the verification moves with it.
   *
   * **The two cases above are the old shape and they still pass, which is the point.** Links
   * built by GoTrue's default template are in real inboxes with an hour to run on them; this
   * is an expand, so both shapes work until every old one has expired.
   */
  describe('the token_hash link that replaces the supabase.co one', () => {
    it('verifies the token and says so', async () => {
      verifyOtp.mockResolvedValue({ data: {}, error: null });

      const response = await handleAccount(
        get('/account/confirm/'),
        ENV,
        new URL('http://localhost:8787/account/confirm/?token_hash=zz-hash&type=signup'),
      );

      expect(verifyOtp).toHaveBeenCalledWith({ type: 'signup', token_hash: 'zz-hash' });
      expect(await response.text()).toContain('confirmed');
    });

    it('**never sets a session cookie**, however well the verification went', async () => {
      // **The security assertion of this change, and the reason it is confirmation-only.**
      // `/account/callback/` may hand out a session because PKCE's HttpOnly verifier proves
      // the same browser started the flow. `token_hash` proves nothing of the kind — a
      // prefetching mail scanner can spend the token. Confirming an address early is
      // tolerable; handing that scanner a signed-in session is not.
      verifyOtp.mockResolvedValue({
        data: { session: { access_token: 'zz-access', refresh_token: 'zz-refresh' } },
        error: null,
      });

      const response = await handleAccount(
        get('/account/confirm/'),
        ENV,
        new URL('http://localhost:8787/account/confirm/?token_hash=zz-hash&type=signup'),
      );

      const setCookies = response.headers.getSetCookie();
      expect(setCookies.some((c) => c.startsWith('src_at='))).toBe(false);
      expect(setCookies.some((c) => c.startsWith('src_rt='))).toBe(false);
    });

    it('says the address may already be confirmed when the token will not verify', async () => {
      // A scanner that spent the token leaves a real person with a link that fails and an
      // account that is fine. "Sign up again" would be the wrong advice, so the page offers
      // signing in first.
      verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Token has expired' } });

      const response = await handleAccount(
        get('/account/confirm/'),
        ENV,
        new URL('http://localhost:8787/account/confirm/?token_hash=zz-hash&type=signup'),
      );

      // Squashed before matching, for the reason `CLAUDE.md` gives about Prettier and the
      // `html` tag: formatting this file reflows the markup inside every template, so a
      // sentence written across a line break arrives with a newline in the middle of it.
      // This assertion passed unsquashed purely because the wrap fell elsewhere.
      const text = (await response.text()).replace(/\s+/g, ' ');
      expect(text).toContain('did not work');
      expect(text).toContain('confirmed already');
    });

    it('refuses any type but signup, without spending the token', async () => {
      // This address is reached from one template. Accepting the wider set `verifyOtp` allows
      // would quietly make it a verification endpoint for recovery and email-change tokens,
      // neither of which ends on a page that says "your email is confirmed".
      const response = await handleAccount(
        get('/account/confirm/'),
        ENV,
        new URL(
          'http://localhost:8787/account/confirm/?token_hash=zz-hash&type=recovery',
        ),
      );

      expect(verifyOtp).not.toHaveBeenCalled();
      expect(await response.text()).toContain('did not work');
    });

    it('answers 503 rather than blaming the link when the database is unreachable', async () => {
      // Telling somebody to sign up again over a transient fault costs them the account they
      // already made.
      verifyOtp.mockRejectedValue(new Error('fetch failed'));

      const response = await handleAccount(
        get('/account/confirm/'),
        ENV,
        new URL('http://localhost:8787/account/confirm/?token_hash=zz-hash&type=signup'),
      );

      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('Sign up again');
    });
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

// -----------------------------------------------------------------------------------------
// #55 — the magic link
// -----------------------------------------------------------------------------------------

/** Both cookie values, so a test can assert on the one it means. */
function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieNamed(response: Response, name: string): string | undefined {
  return setCookies(response).find((value) => value.startsWith(`${name}=`));
}

describe('POST /account/link/', () => {
  beforeEach(() => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
  });

  it('sends a link and acknowledges without saying whether the address exists', async () => {
    const { cookie, body } = withCsrf({
      email: 'zz-someone@example.com',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/link/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/?sent=ok');
  });

  it('never creates an account — registering is /account/sign-up/', async () => {
    const { cookie, body } = withCsrf({
      email: 'zz-someone@example.com',
      'cf-turnstile-response': 'zz-token',
    });

    await handleAccount(
      post('/account/link/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ shouldCreateUser: false }),
      }),
    );
  });

  it('carries the verifier out in an HttpOnly, Lax cookie', async () => {
    const { cookie, body } = withCsrf({
      email: 'zz-someone@example.com',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/link/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    const pkce = cookieNamed(response, 'src_pkce');
    expect(pkce).toContain('zz-code-verifier');
    expect(pkce).toContain('HttpOnly');
    // `Strict` would drop this on the cross-site navigation from a mail client, and the
    // exchange would then fail on a code that was perfectly good.
    expect(pkce).toContain('SameSite=Lax');
  });

  /**
   * **The one that matters.** This form is on the sign-in page, so an answer that differed
   * for a real address would turn it into a membership oracle anybody could query — worse
   * than the reset form, which at least sits on its own page.
   */
  it('answers identically for an address GoTrue does not know', async () => {
    const known = withCsrf({
      email: 'zz-known@example.com',
      'cf-turnstile-response': 'zz-token',
    });
    const knownResponse = await handleAccount(
      post('/account/link/', known.body, known.cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_disabled', message: 'Signups not allowed for otp' },
    });

    const unknown = withCsrf({
      email: 'zz-unknown@example.com',
      'cf-turnstile-response': 'zz-token',
    });
    const unknownResponse = await handleAccount(
      post('/account/link/', unknown.body, unknown.cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownResponse.headers.get('location')).toBe(
      knownResponse.headers.get('location'),
    );
    // Down to the cookie names set, because a `set-cookie` present in one case and absent in
    // the other is an oracle just as usable as a different status code.
    expect(setCookies(unknownResponse).map((value) => value.split('=')[0])).toEqual(
      setCookies(knownResponse).map((value) => value.split('=')[0]),
    );
  });

  it('refuses a stale form', async () => {
    const body = new URLSearchParams({ email: 'zz-someone@example.com' });

    const response = await handleAccount(
      post('/account/link/', body, `${CSRF_COOKIE}=zz-a-different-token`),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    expect(response.status).toBe(422);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('reports a malformed address on the link form, not the password form', async () => {
    const { cookie, body } = withCsrf({
      email: 'not-an-address',
      'cf-turnstile-response': 'zz-token',
    });

    const response = await handleAccount(
      post('/account/link/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/link/'),
    );

    expect(response.status).toBe(422);
    expect(signInWithOtp).not.toHaveBeenCalled();
    // The two email inputs are told apart by id, not by name — see `textField`'s `id`
    // override. This is what proves the error landed on the right one.
    expect(await response.text()).toContain('account-link-email');
  });
});

// -----------------------------------------------------------------------------------------
// #55 and #56 — the callback both of them land on
// -----------------------------------------------------------------------------------------

const CALLBACK_SESSION = {
  access_token: 'zz-new-access-token',
  refresh_token: 'zz-new-refresh-token',
  expires_in: 3600,
};

describe('GET /account/callback/', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: CALLBACK_SESSION },
      error: null,
    });
  });

  it('exchanges the code, signs the person in, and clears the verifier', async () => {
    const response = await handleAccount(
      get('/account/callback/?code=zz-code', 'src_pkce=zz-code-verifier'),
      ENV,
      new URL('http://localhost:8787/account/callback/?code=zz-code'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/');
    expect(cookieNamed(response, 'src_at')).toContain('zz-new-access-token');
    expect(cookieNamed(response, 'src_rt')).toContain('zz-new-refresh-token');
    expect(cookieNamed(response, 'src_pkce')).toContain('Max-Age=0');
  });

  /**
   * **A prefetching mail scanner is exactly this case**, and it is the property that replaces
   * the `token_hash` flow #55 asked for: the scanner follows the link, so it holds a code —
   * and it does not hold the `HttpOnly` cookie, so it cannot turn one into a session.
   */
  it('refuses a code with no verifier, and says which browser to use', async () => {
    const response = await handleAccount(
      get('/account/callback/?code=zz-code'),
      ENV,
      new URL('http://localhost:8787/account/callback/?code=zz-code'),
    );

    expect(response.status).toBe(400);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(await response.text()).toContain('same browser');
  });

  it('says a used link is used, rather than failing blankly', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid flow state' },
    });

    const response = await handleAccount(
      get('/account/callback/?code=zz-code', 'src_pkce=zz-code-verifier'),
      ENV,
      new URL('http://localhost:8787/account/callback/?code=zz-code'),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('only be used once');
  });

  it('treats an error handed back by the provider as a dead link', async () => {
    const response = await handleAccount(
      get('/account/callback/?error=access_denied', 'src_pkce=zz-code-verifier'),
      ENV,
      new URL('http://localhost:8787/account/callback/?error=access_denied'),
    );

    expect(response.status).toBe(400);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  /**
   * `next` arrives from a link in an email, which is the single most credible place to put an
   * open redirect. Each of these is a real technique rather than a theoretical one.
   */
  describe('the next parameter, which must be a path on this origin', () => {
    const refused = [
      ['an absolute URL', 'https://evil.example/'],
      ['a protocol-relative URL', '//evil.example/'],
      ['a backslash-smuggled host', '/\\evil.example/'],
      ['a scheme with no host', 'javascript:alert(1)'],
      ['a bare word', 'evil.example'],
    ] as const;

    for (const [description, value] of refused) {
      it(`refuses ${description}`, async () => {
        const path = `/account/callback/?code=zz-code&next=${encodeURIComponent(value)}`;
        const response = await handleAccount(
          get(path, 'src_pkce=zz-code-verifier'),
          ENV,
          new URL(`http://localhost:8787${path}`),
        );

        expect(response.headers.get('location')).toBe('/account/');
      });
    }

    it('allows an ordinary path, including one with a hyphen in it', async () => {
      const path = '/account/callback/?code=zz-code&next=%2Fadmin%2Fnn%2Fstart-list%2F';
      const response = await handleAccount(
        get(path, 'src_pkce=zz-code-verifier'),
        ENV,
        new URL(`http://localhost:8787${path}`),
      );

      expect(response.headers.get('location')).toBe('/admin/nn/start-list/');
    });
  });
});

// -----------------------------------------------------------------------------------------
// #56 — Google
// -----------------------------------------------------------------------------------------

describe('POST /account/google/', () => {
  const GOOGLE_ENV = { ...ENV, GOOGLE_SIGN_IN: 'on' };

  beforeEach(() => {
    signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/auth?zz' },
      error: null,
    });
  });

  it('hands off to Google and carries the verifier out', async () => {
    const { cookie, body } = withCsrf({});

    const response = await handleAccount(
      post('/account/google/', body, cookie),
      GOOGLE_ENV,
      new URL('http://localhost:8787/account/google/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('accounts.google.com');
    expect(cookieNamed(response, 'src_pkce')).toContain('zz-code-verifier');
  });

  it('asks for an email address and a name, and nothing else', async () => {
    const { cookie, body } = withCsrf({});

    await handleAccount(
      post('/account/google/', body, cookie),
      GOOGLE_ENV,
      new URL('http://localhost:8787/account/google/'),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        options: expect.objectContaining({ scopes: 'email profile' }),
      }),
    );
  });

  it('returns to /account/callback/ rather than an address of its own', async () => {
    const { cookie, body } = withCsrf({});

    await handleAccount(
      post('/account/google/', body, cookie),
      GOOGLE_ENV,
      new URL('http://localhost:8787/account/google/'),
    );

    const call = signInWithOAuth.mock.calls[0][0] as {
      options: { redirectTo: string };
    };
    expect(call.options.redirectTo).toContain('/account/callback/');
  });

  it('does nothing at all while the provider is not configured', async () => {
    const { cookie, body } = withCsrf({});

    const response = await handleAccount(
      post('/account/google/', body, cookie),
      ENV,
      new URL('http://localhost:8787/account/google/'),
    );

    expect(response.status).toBe(422);
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it('keeps the button off the sign-in page until then', async () => {
    const off = await handleAccount(
      get('/account/sign-in/'),
      ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );
    expect(await off.text()).not.toContain('/account/google/');

    const on = await handleAccount(
      get('/account/sign-in/'),
      GOOGLE_ENV,
      new URL('http://localhost:8787/account/sign-in/'),
    );
    expect(await on.text()).toContain('/account/google/');
  });

  it('refuses a stale form', async () => {
    const response = await handleAccount(
      post('/account/google/', new URLSearchParams({}), `${CSRF_COOKIE}=zz-other`),
      GOOGLE_ENV,
      new URL('http://localhost:8787/account/google/'),
    );

    expect(response.status).toBe(422);
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------------------
// #62 — /account/data/
// -----------------------------------------------------------------------------------------

const SIGNED_IN_COOKIE = `src_at=${HEALTHY_ACCESS_TOKEN}; src_rt=zz-refresh-token`;

function signedIn(): void {
  getUser.mockResolvedValue({ data: { user: { id: 'zz-person' } }, error: null });
}

describe('GET /account/data/', () => {
  it('is not reachable signed out', async () => {
    const response = await handleAccount(
      get('/account/data/'),
      ENV,
      new URL('http://localhost:8787/account/data/'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });

  /**
   * **The promise, not the feature.** Somebody who deletes an account believing their race
   * entry goes with it finds out at the start line, on a morning that cannot be re-run — so
   * the page has to say what survives, and it has to say it before the button.
   */
  it('says what deletion does not remove, before the button', async () => {
    signedIn();

    const response = await handleAccount(
      get('/account/data/', SIGNED_IN_COOKIE),
      ENV,
      new URL('http://localhost:8787/account/data/'),
    );

    expect(response.status).toBe(200);

    const markup = await response.text();
    const squashed = markup.replace(/\s+/g, ' ');

    expect(squashed).toContain('race entry you have paid for');
    expect(squashed).toContain('still be on the start list');
    expect(squashed).toContain('interest list');

    expect(markup.indexOf('does not delete')).toBeLessThan(
      markup.indexOf('Delete my account'),
    );
  });
});

describe('POST /account/data/export/', () => {
  it('hands back an attachment, and the assertion is on the response', async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: { ok: true, account: { id: 'zz-person', email: 'zz@example.com' } },
      error: null,
    });

    const { cookie, body } = withCsrf({});
    const response = await handleAccount(
      post('/account/data/export/', body, `${cookie}; ${SIGNED_IN_COOKIE}`),
      ENV,
      new URL('http://localhost:8787/account/data/export/'),
    );

    // Not on a download event: the three browser engines disagree about what an attachment
    // is, and WebKit on a Linux runner renders one in the tab. The status, the content type
    // and the filename are what every engine agrees on.
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain(
      'southville-running-club-account.json',
    );
    expect(JSON.parse(await response.text())).toMatchObject({ ok: true });
  });

  it('refuses a stale form without asking the database anything', async () => {
    signedIn();

    const response = await handleAccount(
      post(
        '/account/data/export/',
        new URLSearchParams({}),
        `${CSRF_COOKIE}=zz-other; ${SIGNED_IN_COOKIE}`,
      ),
      ENV,
      new URL('http://localhost:8787/account/data/export/'),
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /account/data/delete/', () => {
  it('deletes, ends the session, and says the entry is unaffected', async () => {
    signedIn();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });

    const { cookie, body } = withCsrf({ confirm: 'DELETE' });
    const response = await handleAccount(
      post('/account/data/delete/', body, `${cookie}; ${SIGNED_IN_COOKIE}`),
      ENV,
      new URL('http://localhost:8787/account/data/delete/'),
    );

    expect(rpc).toHaveBeenCalledWith('delete_me');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/?deleted=ok');
    expect(cookieNamed(response, 'src_at')).toContain('Max-Age=0');
    expect(cookieNamed(response, 'src_rt')).toContain('Max-Age=0');
  });

  it('is not reachable by one keystroke', async () => {
    signedIn();

    const { cookie, body } = withCsrf({ confirm: '' });
    const response = await handleAccount(
      post('/account/data/delete/', body, `${cookie}; ${SIGNED_IN_COOKIE}`),
      ENV,
      new URL('http://localhost:8787/account/data/delete/'),
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  /** The same hole `revoke_role()` already refuses through its own door. */
  it('tells the last super-admin to hand the role over first', async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: { ok: false, reason: 'last_super_admin' },
      error: null,
    });

    const { cookie, body } = withCsrf({ confirm: 'DELETE' });
    const response = await handleAccount(
      post('/account/data/delete/', body, `${cookie}; ${SIGNED_IN_COOKIE}`),
      ENV,
      new URL('http://localhost:8787/account/data/delete/'),
    );

    expect(response.status).toBe(422);
    expect((await response.text()).replace(/\s+/g, ' ')).toContain('only super-admin');
  });

  it('refuses a stale form without asking the database anything', async () => {
    signedIn();

    const response = await handleAccount(
      post(
        '/account/data/delete/',
        new URLSearchParams({ confirm: 'DELETE' }),
        `${CSRF_COOKIE}=zz-other; ${SIGNED_IN_COOKIE}`,
      ),
      ENV,
      new URL('http://localhost:8787/account/data/delete/'),
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
