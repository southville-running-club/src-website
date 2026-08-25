import {
  createAnonClient,
  createUserClient,
  parseAccountChangePassword,
  parseAccountResetConfirm,
  parseAccountResetRequest,
  parseAccountSignIn,
  parseAccountSignUp,
  type AccountChangePasswordErrors,
  type AccountResetConfirmErrors,
  type AccountResetRequestErrors,
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
 * the auth layer. #54's `/account/reset/` is deliberately built the same way: one
 * acknowledgement, whatever the address turns out to be.
 *
 * ## #54 — reset, and changing a password from inside an account
 *
 * `/account/reset/` asks GoTrue for a reset link. `/account/reset/confirm/` is where that
 * link redirects to — with the new session's tokens in the URL **fragment**, which a
 * server never sees. The page ships the set-password form hidden and a plain-language
 * fallback visible; a small inline script reads `location.hash`, and only then reveals the
 * form and hides the fallback — one more instance of the honest-dead-end pattern above,
 * not a new one. On success the recovery session's own tokens become the account's session
 * cookies, because a person who has just proven they own the mailbox has proven who they
 * are.
 *
 * `/account/password/` changes a password from inside a signed-in account. It asks for the
 * **current** password and re-authenticates with it via `signInWithPassword` before calling
 * `updateUser()` — which is what actually enforces "changing a password requires the
 * current one" rather than trusting a stale session. `secure_password_change = true` in
 * `config.toml` layers GoTrue's own recently-signed-in requirement on top; re-authenticating
 * here satisfies it as a side effect, so the two controls reinforce rather than duplicate
 * each other.
 *
 * **This page carries Turnstile too, and it is behind a session — not a contradiction of
 * the rule above.** The widget is not there for bot defence; it is there because the
 * re-authentication step calls `signInWithPassword`, and GoTrue gates that endpoint by
 * captcha regardless of who calls it or why. Found by running this against the real local
 * stack, not by reading GoTrue's documentation: without a token the internal check failed
 * with `captcha_failed` even for the correct password, which read as "your current password
 * was not right" to whoever was changing it.
 *
 * **Neither route revokes other sessions itself.** GoTrue revokes a user's other refresh
 * tokens when a password changes — through `updateUser()`, whichever route calls it — so
 * this file does not reimplement that; `packages/db/tests/identity-sessions.test.ts`
 * documents the property in terms a database test can actually assert (a stale refresh
 * token is rejected after the change), because a session revocation cannot be observed from
 * inside the Worker in any other testable way.
 *
 * **And no notification email goes out — dying sessions are the only signal there is.**
 * `[auth.email.notification.password_changed]` is the thing that would tell somebody this
 * happened without their own knowledge, and it is **commented out** in `config.toml`: the
 * free tier with the default email provider refuses every email-template modification, so
 * leaving it on failed `supabase config push` and took the whole auth block with it (issue
 * #79). Turning it off was not enough — the CLI sends the section whenever it is present,
 * with an empty subject, which is a modification too. It was never this file's job and it
 * is not becoming one; **#50**, a custom SMTP provider, is what turns it back on.
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

  if (segments.length === 1 && segments[0] === 'reset') {
    if (request.method === 'GET' && url.searchParams.get('done') === 'ok') {
      return page('Check your inbox', resetRequestAcknowledgement(), {
        secure,
        cookies: refreshedCookies,
      });
    }
    if (request.method === 'GET') {
      return resetRequestPage(env, secure, null, {}, { email: '' }, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleResetRequest(request, env, cfg, secure);
    }
  }

  if (segments.length === 2 && segments[0] === 'reset' && segments[1] === 'confirm') {
    if (request.method === 'GET') {
      return resetConfirmPage(env, url, secure, null, {}, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleResetConfirm(request, env, cfg, secure);
    }
  }

  if (segments.length === 1 && segments[0] === 'password') {
    if (request.method === 'GET') {
      if (session === null) {
        return redirectTo('/account/sign-in/', secure, refreshedCookies);
      }
      return changePasswordPage(env, secure, null, {}, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleChangePassword(request, env, session, cfg, secure, refreshedCookies);
    }
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
      <p><a href="/account/password/">Change your password</a></p>
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

/**
 * **The privacy line is at the point of collection, not only in the site footer.** This form
 * is where the club starts holding a named person's details, and `/privacy/` is the notice
 * that says what it then does with them — the same line the entry and interest forms have
 * always carried to `/nn/privacy/`, on the form that creates the standing record rather than
 * the one that enters a race. `.signup-privacy` is base.css's, already, for that reason.
 */
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
      <p class="signup-privacy">
        <a href="/privacy/">What the club does with your details</a>
      </p>
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
      <p><a href="/account/reset/">Forgotten your password?</a></p>
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
// /account/reset/
// -----------------------------------------------------------------------------------------

async function handleResetRequest(
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
    return resetRequestPage(
      env,
      secure,
      'That form had expired. Please try again.',
      {},
      submitted,
      [],
    );
  }

  const parsed = parseAccountResetRequest(
    form === null
      ? {}
      : { email: form.get('email'), captchaToken: form.get('cf-turnstile-response') },
  );

  if (!parsed.ok) {
    return resetRequestPage(env, secure, null, parsed.errors, submitted, []);
  }

  try {
    const client = createAnonClient(cfg);
    const url = new URL(request.url);
    const { error } = await client.auth.resetPasswordForEmail(parsed.value.email, {
      redirectTo: `${url.origin}/account/reset/confirm`,
      captchaToken: parsed.value.captchaToken,
    });

    // **Every outcome but a captcha failure lands on the same acknowledgement.** GoTrue
    // answers this call the same way whether or not the address has an account — no error
    // for an unknown one — so there is nothing here to disclose even if we wanted to.
    if (error && isCaptchaError(error)) {
      return resetRequestPage(
        env,
        secure,
        null,
        { captchaToken: 'That verification check did not complete. Try again.' },
        submitted,
        [],
      );
    }

    return redirectTo('/account/reset/?done=ok', secure, []);
  } catch {
    return resetRequestPage(
      env,
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      submitted,
      [],
    );
  }
}

function resetRequestPage(
  env: Env,
  secure: boolean,
  message: string | null,
  errors: AccountResetRequestErrors,
  submitted: { email: string },
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Reset your password</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <form method="post" action="/account/reset/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        ${textField('email', 'Email address', submitted.email, errors.email, {
          type: 'email',
          autocomplete: 'email',
        })}
        ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
        <button class="button" type="submit">Send reset link</button>
      </form>
    </main>
  `;

  return page('Reset your password', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

function resetRequestAcknowledgement(): Html {
  return html`
    <main class="account-page">
      <h1>Check your inbox</h1>
      <p>
        If there is an account for that address, we have sent a link to reset its
        password. The link works once, and for one hour.
      </p>
    </main>
  `;
}

// -----------------------------------------------------------------------------------------
// /account/reset/confirm/
// -----------------------------------------------------------------------------------------

/** The two field names GoTrue's recovery redirect carries in the URL fragment — never sent
 *  to the server directly, which is the whole reason the inline script below exists. */
const RECOVERY_ACCESS_TOKEN_FIELD = 'access_token';
const RECOVERY_REFRESH_TOKEN_FIELD = 'refresh_token';

async function handleResetConfirm(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return resetConfirmPage(
      env,
      new URL(request.url),
      secure,
      'That form had expired. Please try again.',
      {},
      [],
    );
  }

  const parsed = parseAccountResetConfirm(
    form === null
      ? {}
      : {
          accessToken: form.get(RECOVERY_ACCESS_TOKEN_FIELD),
          refreshToken: form.get(RECOVERY_REFRESH_TOKEN_FIELD),
          password: form.get('password'),
          captchaToken: form.get('cf-turnstile-response'),
        },
  );

  if (!parsed.ok) {
    return resetConfirmPage(env, new URL(request.url), secure, null, parsed.errors, []);
  }

  try {
    // **`setSession()` before `updateUser()`, not a bearer header alone.** `updateUser()`
    // goes through GoTrue's own session tracking rather than a plain authenticated request
    // — `createUserClient()`'s header is enough for a PostgREST call like `my_roles()`
    // above, but `auth.*` methods ask the client's *internal* session, which is empty
    // until something sets it. The same shape `session.ts`'s `signOut()` already uses.
    const client = createAnonClient(cfg);
    const set = await client.auth.setSession({
      access_token: parsed.value.accessToken,
      refresh_token: parsed.value.refreshToken,
    });

    if (set.error) {
      return resetConfirmPage(
        env,
        new URL(request.url),
        secure,
        'That reset link has expired or was already used. Request a new one.',
        {},
        [],
      );
    }

    const { error } = await client.auth.updateUser({ password: parsed.value.password });

    if (error) {
      if (isCaptchaError(error)) {
        return resetConfirmPage(
          env,
          new URL(request.url),
          secure,
          null,
          { captchaToken: 'That verification check did not complete. Try again.' },
          [],
        );
      }

      // A token GoTrue itself has already refused — used once already, or the hour ran
      // out between the page loading and the form being submitted.
      return resetConfirmPage(
        env,
        new URL(request.url),
        secure,
        'That reset link has expired or was already used. Request a new one.',
        {},
        [],
      );
    }

    // The recovery session's own tokens become the account's session — proving ownership
    // of the mailbox is what this whole flow exists to establish.
    return redirectTo(
      '/account/',
      secure,
      newSessionCookies(
        parsed.value.accessToken,
        parsed.value.refreshToken,
        3600,
        secure,
      ),
    );
  } catch {
    return resetConfirmPage(
      env,
      new URL(request.url),
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      [],
    );
  }
}

function resetConfirmPage(
  env: Env,
  url: URL,
  secure: boolean,
  message: string | null,
  errors: AccountResetConfirmErrors,
  extraCookies: string[],
): Response {
  const failed = url.searchParams.get('error') !== null;
  const csrfToken = mintCsrfToken();

  if (failed) {
    const body = html`
      <main class="account-page">
        <h1>That link did not work</h1>
        <p>
          It may have expired, or already been used.
          <a href="/account/reset/">Request a new one</a>.
        </p>
      </main>
    `;
    return page('That link did not work', body, { secure, cookies: extraCookies });
  }

  const body = html`
    <main class="account-page">
      <h1>Choose a new password</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <p class="notice notice-bad" data-reset-needs-js>
        This link needs JavaScript to complete. If you have disabled it, please contact
        the club at
        <a href="mailto:info@southvillerunningclub.co.uk"
          >info@southvillerunningclub.co.uk</a
        >.
      </p>
      <form
        method="post"
        action="/account/reset/confirm/"
        class="signup"
        novalidate
        hidden
        data-reset-form
      >
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        <input type="hidden" name="${raw(RECOVERY_ACCESS_TOKEN_FIELD)}" value="" />
        <input type="hidden" name="${raw(RECOVERY_REFRESH_TOKEN_FIELD)}" value="" />
        ${passwordField('password', 'New password', errors.password)}
        ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
        <button class="button" type="submit">Set new password</button>
      </form>
      <script>
        (function () {
          var hash = window.location.hash.replace(/^#/, '');
          var params = new URLSearchParams(hash);
          var accessToken = params.get('${raw(RECOVERY_ACCESS_TOKEN_FIELD)}');
          var refreshToken = params.get('${raw(RECOVERY_REFRESH_TOKEN_FIELD)}');
          if (!accessToken || !refreshToken) return;
          var form = document.querySelector('[data-reset-form]');
          var fallback = document.querySelector('[data-reset-needs-js]');
          form.querySelector('input[name="${raw(RECOVERY_ACCESS_TOKEN_FIELD)}"]').value =
            accessToken;
          form.querySelector('input[name="${raw(RECOVERY_REFRESH_TOKEN_FIELD)}"]').value =
            refreshToken || '';
          form.hidden = false;
          fallback.hidden = true;
          history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );
        })();
      </script>
    </main>
  `;

  return page('Choose a new password', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

// -----------------------------------------------------------------------------------------
// /account/password/
// -----------------------------------------------------------------------------------------

async function handleChangePassword(
  request: Request,
  env: Env,
  session: Session | null,
  cfg: SupabaseConfig,
  secure: boolean,
  refreshedCookies: string[],
): Promise<Response> {
  if (session === null) {
    return redirectTo('/account/sign-in/', secure, refreshedCookies);
  }

  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return changePasswordPage(
      env,
      secure,
      'That form had expired. Please try again.',
      {},
      refreshedCookies,
    );
  }

  const parsed = parseAccountChangePassword(
    form === null
      ? {}
      : {
          currentPassword: form.get('current_password'),
          newPassword: form.get('new_password'),
          captchaToken: form.get('cf-turnstile-response'),
        },
  );

  if (!parsed.ok) {
    return changePasswordPage(env, secure, null, parsed.errors, refreshedCookies);
  }

  try {
    // **This is the check.** `updateUser()` on the existing session would succeed on
    // whatever `secure_password_change`'s own recently-signed-in window allows; asking for
    // and verifying the current password here is what makes "changing a password requires
    // the current one" true regardless of how old the session is.
    //
    // `getUser(jwt)` — the token passed explicitly — verifies that specific access token
    // without needing a client that has ever called `setSession()`. This is the same shape
    // `session.ts`'s `readSession()` already uses, and it is deliberately different from
    // `updateUser()` below: that one goes through GoTrue's own internal session tracking,
    // which needs `setSession()` first — a bearer header on its own is not enough.
    const { data: userData, error: userError } = await createAnonClient(cfg).auth.getUser(
      session.accessToken,
    );

    if (userError || !userData.user.email) {
      return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
    }

    // **Turnstile here is not for bot defence — this page is behind a session.** GoTrue
    // gates `/token?grant_type=password` by captcha regardless of who calls it, and this
    // re-authentication check calls exactly that endpoint. Confirmed against the real
    // local stack: without a token this failed with `captcha_failed` even for the correct
    // password, which read to the person changing it as "your current password was not
    // right" — a real defect, not a hypothetical one.
    const reauth = await createAnonClient(cfg).auth.signInWithPassword({
      email: userData.user.email,
      password: parsed.value.currentPassword,
      options: { captchaToken: parsed.value.captchaToken },
    });

    if (reauth.error || !reauth.data.session) {
      if (isCaptchaError(reauth.error)) {
        return changePasswordPage(
          env,
          secure,
          null,
          { captchaToken: 'That verification check did not complete. Try again.' },
          refreshedCookies,
        );
      }

      return changePasswordPage(
        env,
        secure,
        'Your current password was not right.',
        {},
        refreshedCookies,
      );
    }

    const fresh = reauth.data.session;
    const freshClient = createAnonClient(cfg);
    await freshClient.auth.setSession({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
    });
    const { error: updateError } = await freshClient.auth.updateUser({
      password: parsed.value.newPassword,
    });

    if (updateError) {
      return changePasswordPage(
        env,
        secure,
        'That could not be saved. Check what you typed and try again.',
        {},
        refreshedCookies,
      );
    }

    return redirectTo(
      '/account/',
      secure,
      newSessionCookies(
        fresh.access_token,
        fresh.refresh_token,
        fresh.expires_in,
        secure,
      ),
    );
  } catch {
    return changePasswordPage(
      env,
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      refreshedCookies,
    );
  }
}

function changePasswordPage(
  env: Env,
  secure: boolean,
  message: string | null,
  errors: AccountChangePasswordErrors,
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Change your password</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <form method="post" action="/account/password/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        ${passwordField(
          'current_password',
          'Current password',
          errors.currentPassword,
          'current-password',
        )}
        ${passwordField('new_password', 'New password', errors.newPassword)}
        ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
        <button class="button" type="submit">Change password</button>
      </form>
    </main>
  `;

  return page('Change your password', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
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
