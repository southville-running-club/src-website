import {
  createAnonClient,
  createUserClient,
  parseAccountSignIn,
  parseAccountSignUp,
  type AccountSignInErrors,
  type AccountSignUpErrors,
  type SupabaseConfig,
} from '@src/shared';
import { html, raw, type Html } from './html';
import { cookieValue } from './cookies';
import {
  REFRESH_COOKIE,
  clearedSessionCookies,
  newSessionCookies,
  readSession,
  signOut as endSession,
  type Session,
} from './session';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { accountSegments } from './routing';

/**
 * `/account/` — register, sign in, sign out. #51 gave the database a person; #52 gave the
 * Worker a session; this is the three pages that turn a stranger into a signed-in account.
 *
 * Built the way `/nn/admin` is, and for the same reason: the content is per-request
 * (`is anybody signed in`, `what did the last submission get wrong`) rather than static
 * HTML, so it is built with `worker/html.ts`'s auto-escaping template rather than shipped
 * as a file in `dist/`. **No file exists under `apps/main/src/pages/account/`** other than
 * the stylesheet endpoint, `account.css.ts`.
 *
 * ## The JavaScript exception, made real
 *
 * Every unauthenticated form here carries a Cloudflare Turnstile widget, which has no
 * no-script mode. #48's ADR accepted that cost deliberately for this one area of the site;
 * this is where it becomes visible rather than theoretical. With scripting off the widget
 * never renders and the form says so plainly, with the club's address — an honest dead
 * end, not a button that silently does nothing.
 *
 * GoTrue verifies the token itself, via `options.captchaToken` on `signUp` and
 * `signInWithPassword` — there is no verification code in this file, and so no way to
 * forget to check it.
 *
 * ## Account enumeration
 *
 * Signing up with an address that already has a confirmed account does not disclose that
 * it does: GoTrue itself answers success either way (no email is sent to an address that
 * is already registered), so this file has nothing extra to get right here — the same
 * shape `intake.nn_interest`'s duplicate-address handling has, at the database rather than
 * the auth layer.
 */

function config(env: {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}): SupabaseConfig {
  return { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY };
}

interface Env {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /** Public. The Cloudflare Turnstile widget key — a `var`, like the Supabase anon key. */
  TURNSTILE_SITE_KEY: string;
}

export async function handleAccount(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const secure = url.protocol === 'https:';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cookieHeader = request.headers.get('cookie');
  const cfg = config(env);

  const { session, setCookies: refreshedCookies } = await readSession(
    cfg,
    cookieHeader,
    nowSeconds,
    secure,
  );

  const segments = accountSegments(url.pathname);

  if (request.method === 'GET' && segments.length === 0) {
    return accountHome(session, cfg, secure, refreshedCookies);
  }

  if (segments.length === 1 && segments[0] === 'sign-up') {
    if (request.method === 'GET' && url.searchParams.get('done') === 'ok') {
      return page('Check your inbox', signUpAcknowledgement(), {
        secure,
        cookies: refreshedCookies,
      });
    }
    if (request.method === 'GET') {
      return signUpPage(env, secure, null, {}, { name: '', email: '' }, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleSignUp(request, env, cfg, secure);
    }
  }

  if (segments.length === 1 && segments[0] === 'sign-in') {
    if (request.method === 'GET') {
      return signInPage(env, secure, null, {}, { email: '' }, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleSignIn(request, env, cfg, secure);
    }
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'sign-out') {
    return handleSignOut(request, session, cfg, secure);
  }

  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'confirm') {
    return confirmPage(url, secure);
  }

  return page('Not found', notFoundBody(), { status: 404, secure, cookies: [] });
}

// -----------------------------------------------------------------------------------------
// /account/
// -----------------------------------------------------------------------------------------

async function accountHome(
  session: Session | null,
  cfg: SupabaseConfig,
  secure: boolean,
  refreshedCookies: string[],
): Promise<Response> {
  if (session === null) {
    return redirectTo('/account/sign-in/', secure, refreshedCookies);
  }

  const client = createUserClient(cfg, session.accessToken);
  const { data, error } = await client.rpc('my_roles');
  const roles = !error && Array.isArray(data) ? (data as string[]) : [];

  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Your account</h1>
      <p>
        You are signed in.
        ${
          roles.length > 0
            ? html`Roles: ${roles.join(', ')}.`
            : html`No roles beyond being signed in.`
        }
      </p>
      <form method="post" action="/account/sign-out/">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        <button class="button" type="submit">Sign out</button>
      </form>
    </main>
  `;

  return page('Your account', body, {
    secure,
    cookies: [...refreshedCookies, csrfCookie(csrfToken, secure)],
  });
}

// -----------------------------------------------------------------------------------------
// /account/sign-up/
// -----------------------------------------------------------------------------------------

async function handleSignUp(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  const submitted = {
    name: readString(form, 'name'),
    email: readString(form, 'email'),
  };

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return signUpPage(
      env,
      secure,
      'That form had expired. Please try again.',
      {},
      submitted,
      [],
    );
  }

  const parsed = parseAccountSignUp(
    form === null
      ? {}
      : {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          captchaToken: form.get('cf-turnstile-response'),
        },
  );

  if (!parsed.ok) {
    return signUpPage(env, secure, null, parsed.errors, submitted, []);
  }

  try {
    const client = createAnonClient(cfg);
    const url = new URL(request.url);
    const { error } = await client.auth.signUp({
      email: parsed.value.email,
      password: parsed.value.password,
      options: {
        data: { name: parsed.value.name },
        captchaToken: parsed.value.captchaToken,
        emailRedirectTo: `${url.origin}/account/confirm`,
      },
    });

    if (error) {
      if (isCaptchaError(error)) {
        return signUpPage(
          env,
          secure,
          null,
          { captchaToken: 'That verification check did not complete. Try again.' },
          submitted,
          [],
        );
      }

      // Every other failure — including a weak password GoTrue itself rejects, and a rate
      // limit — is shown as a form-level message rather than disclosing which. Nothing
      // here can be about "this address already has an account": GoTrue answers success
      // for that case, deliberately, so there is nothing to catch.
      return signUpPage(
        env,
        secure,
        'That could not be saved. Check what you typed and try again.',
        {},
        submitted,
        [],
      );
    }

    return redirectTo('/account/sign-up/?done=ok', secure, []);
  } catch {
    return signUpPage(
      env,
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      submitted,
      [],
    );
  }
}

function signUpPage(
  env: Env,
  secure: boolean,
  message: string | null,
  errors: AccountSignUpErrors,
  submitted: { name: string; email: string },
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Create an account</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <form method="post" action="/account/sign-up/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        ${textField('name', 'Your name', submitted.name, errors.name, { autocomplete: 'name' })}
        ${textField('email', 'Email address', submitted.email, errors.email, {
          type: 'email',
          autocomplete: 'email',
        })}
        ${passwordField('password', 'Password', errors.password)}
        ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
        <button class="button" type="submit">Create account</button>
      </form>
    </main>
  `;

  return page('Create an account', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

function signUpAcknowledgement(): Html {
  return html`
    <main class="account-page">
      <h1>Check your inbox</h1>
      <p>
        If that email address does not already have an account, we have sent a
        confirmation link to it. Follow it, then <a href="/account/sign-in/">sign in</a>.
      </p>
    </main>
  `;
}

// -----------------------------------------------------------------------------------------
// /account/sign-in/
// -----------------------------------------------------------------------------------------

async function handleSignIn(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  const submitted = { email: readString(form, 'email') };

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return signInPage(
      env,
      secure,
      'That form had expired. Please try again.',
      {},
      submitted,
      [],
    );
  }

  const parsed = parseAccountSignIn(
    form === null
      ? {}
      : {
          email: form.get('email'),
          password: form.get('password'),
          captchaToken: form.get('cf-turnstile-response'),
        },
  );

  if (!parsed.ok) {
    return signInPage(env, secure, null, parsed.errors, submitted, []);
  }

  try {
    const client = createAnonClient(cfg);
    const { data, error } = await client.auth.signInWithPassword({
      email: parsed.value.email,
      password: parsed.value.password,
      options: { captchaToken: parsed.value.captchaToken },
    });

    if (error || !data.session) {
      if (isCaptchaError(error)) {
        return signInPage(
          env,
          secure,
          null,
          { captchaToken: 'That verification check did not complete. Try again.' },
          submitted,
          [],
        );
      }

      // **The one place this file tells two failures apart, and it is required to.**
      // "Wrong password" and "not confirmed yet" need different next actions from the
      // person reading them, unlike sign-up's account-enumeration case above.
      if (error?.code === 'email_not_confirmed') {
        return signInPage(
          env,
          secure,
          'Check your inbox and confirm your email address before signing in.',
          {},
          submitted,
          [],
        );
      }

      return signInPage(
        env,
        secure,
        'That email or password was not recognised.',
        {},
        submitted,
        [],
      );
    }

    return redirectTo(
      '/account/',
      secure,
      newSessionCookies(
        data.session.access_token,
        data.session.refresh_token,
        data.session.expires_in,
        secure,
      ),
    );
  } catch {
    return signInPage(
      env,
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      submitted,
      [],
    );
  }
}

function signInPage(
  env: Env,
  secure: boolean,
  message: string | null,
  errors: AccountSignInErrors,
  submitted: { email: string },
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Sign in</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <form method="post" action="/account/sign-in/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        ${textField('email', 'Email address', submitted.email, errors.email, {
          type: 'email',
          autocomplete: 'email',
        })}
        ${passwordField('password', 'Password', errors.password, 'current-password')}
        ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
        <button class="button" type="submit">Sign in</button>
      </form>
      <p><a href="/account/sign-up/">Create an account</a></p>
    </main>
  `;

  return page('Sign in', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

// -----------------------------------------------------------------------------------------
// /account/sign-out/
// -----------------------------------------------------------------------------------------

async function handleSignOut(
  request: Request,
  session: Session | null,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  // A missing session or a failed CSRF check both land the same place a successful sign-out
  // does: signed out. There is nothing to protect by refusing a sign-out.
  if (session !== null && csrfOk(csrfCookieToken, fieldToken)) {
    const refreshToken = cookieValue(request.headers.get('cookie'), REFRESH_COOKIE);
    if (refreshToken !== null) {
      await endSession(cfg, session.accessToken, refreshToken);
    }
  }

  return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
}

// -----------------------------------------------------------------------------------------
// /account/confirm/
// -----------------------------------------------------------------------------------------

function confirmPage(url: URL, secure: boolean): Response {
  const failed = url.searchParams.get('error') !== null;

  const body = html`
    <main class="account-page">
      ${
        failed
          ? html`<h1>That link did not work</h1>
              <p>
                It may have expired. <a href="/account/sign-up/">Sign up again</a> for a
                fresh one, or contact the club if this keeps happening.
              </p>`
          : html`<h1>Your email is confirmed</h1>
              <p><a href="/account/sign-in/">Sign in</a> to continue.</p>`
      }
    </main>
  `;

  return page('Confirm your email', body, { secure, cookies: [] });
}

// -----------------------------------------------------------------------------------------
// Shared markup
// -----------------------------------------------------------------------------------------

function textField(
  name: string,
  label: string,
  value: string,
  error: string | undefined,
  attrs: { type?: string; autocomplete?: string },
): Html {
  const id = `account-${name}`;
  return html`
    <div class="field">
      <label class="field-label" for="${id}">${label}</label>
      ${
        error !== undefined
          ? html`<p class="field-error" id="${id}-error">${error}</p>`
          : null
      }
      <input
        class="field-input"
        id="${id}"
        name="${name}"
        type="${attrs.type ?? 'text'}"
        autocomplete="${attrs.autocomplete ?? 'off'}"
        value="${value}"
        aria-invalid="${error !== undefined ? 'true' : 'false'}"
        aria-describedby="${error !== undefined ? `${id}-error` : ''}"
      />
    </div>
  `;
}

function passwordField(
  name: string,
  label: string,
  error: string | undefined,
  autocomplete: string = 'new-password',
): Html {
  const id = `account-${name}`;
  return html`
    <div class="field">
      <label class="field-label" for="${id}">${label}</label>
      ${
        error !== undefined
          ? html`<p class="field-error" id="${id}-error">${error}</p>`
          : null
      }
      <input
        class="field-input"
        id="${id}"
        name="${name}"
        type="password"
        autocomplete="${autocomplete}"
        aria-invalid="${error !== undefined ? 'true' : 'false'}"
        aria-describedby="${error !== undefined ? `${id}-error` : ''}"
      />
    </div>
  `;
}

/**
 * Cloudflare's own widget. With scripting disabled the `<script>` never runs, the `<div>`
 * stays an empty box, and `noscript` says plainly what to do instead — an honest dead end
 * rather than a form that silently fails.
 */
function turnstile(siteKey: string, error: string | undefined): Html {
  return html`
    <div class="field account-captcha">
      ${error !== undefined ? html`<p class="field-error">${error}</p>` : null}
      <div class="cf-turnstile" data-sitekey="${siteKey}"></div>
      <noscript>
        <p class="field-hint">
          This form needs JavaScript for the verification check. Please enable it, or
          contact the club at
          <a href="mailto:info@southvillerunningclub.co.uk"
            >info@southvillerunningclub.co.uk</a
          >.
        </p>
      </noscript>
    </div>
    <script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js"
      async
      defer
    ></script>
  `;
}

function notFoundBody(): Html {
  return html`<main class="account-page"><h1>Not found</h1></main>`;
}

function page(
  title: string,
  body: Html,
  options: { status?: number; secure: boolean; cookies: string[] },
): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} — Southville Running Club</title>
        <link rel="stylesheet" href="/account.css" />
      </head>
      <body>
        ${body}
      </body>
    </html>`;

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });

  for (const cookie of options.cookies) {
    headers.append('set-cookie', cookie);
  }

  return new Response(document.toString(), {
    status: options.status ?? 200,
    headers,
  });
}

function redirectTo(location: string, secure: boolean, cookies: string[]): Response {
  const headers = new Headers({
    location,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });

  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }

  return new Response(null, { status: 303, headers });
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function readString(form: FormData | null, field: string): string {
  const value = form?.get(field);
  return typeof value === 'string' ? value : '';
}

function isCaptchaError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 'captcha_failed' ||
    (typeof message === 'string' && message.toLowerCase().includes('captcha'))
  );
}
