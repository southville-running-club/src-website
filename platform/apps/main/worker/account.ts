import {
  createAnonClient,
  createPkceClient,
  createUserClient,
  formatLondon,
  parseAccountChangePassword,
  parseAccountDetails,
  parseAccountMagicLink,
  parseAccountResetConfirm,
  parseAccountResetRequest,
  parseAccountSignIn,
  parseAccountSignUp,
  parseIsoDate,
  type AccountChangePasswordErrors,
  type AccountDetailsErrors,
  type AccountMagicLinkErrors,
  type AccountResetConfirmErrors,
  type AccountResetRequestErrors,
  type AccountSignInErrors,
  type AccountSignUpErrors,
  type SupabaseConfig,
} from '@src/shared';
import { html, raw, type Html } from './html';
import { cookieValue } from './cookies';
import { faviconLink, siteBanner, siteFooter } from './site-chrome';
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
 *
 * ## #61 — the profile: name, email, gender, date of birth, address
 *
 * `/account/details/` is the one page in this file that collects new personal data, which
 * is why it shipped last and blocked on #60's privacy notice rather than on code. **No
 * Turnstile** — #61's own issue body settles that: the page sits behind a session, and a
 * bot that already holds one has got past the widget once already.
 *
 * **Date of birth is three number boxes**, the same shape and the same reasoning
 * `NnEntryForm.astro`'s own comment gives for the entry form: a date picker opens on this
 * month and asks somebody to page back forty years, one on a phone. Unlike the entry
 * form's version every part is optional, together — leaving all three blank means "not
 * given" rather than an error, because principles.md's minimisation rule is what this whole
 * page is a recorded exception to (see #61 and #60's privacy notice), not a licence to
 * demand more than a member chooses to give.
 *
 * **Changing the email address does not write it — it asks GoTrue to.** `identity.people`
 * has no email column; `auth.users` does, and `double_confirm_changes = true` means
 * `updateUser({ email })` does not take effect until both the old and the new address have
 * confirmed it. That call needs a real session via `setSession()`, the same requirement
 * `handleChangePassword` documents at its own call to `updateUser()` — which is why this
 * handler reads the refresh-token cookie directly rather than trusting the bearer-only
 * client `createUserClient()` builds. Submitting the address unchanged is a no-op, checked
 * case-insensitively, so saving the rest of the profile never re-triggers a confirmation
 * mail nobody asked for.
 *
 * **`identity.people`'s `updated_at` has no trigger anywhere in this schema** — nothing
 * else in this repository has ever needed one, so this is the first `update` that sets it
 * itself, in the same statement as the columns it is timestamping.
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
  /**
   * `'on'` when the Google OAuth client actually exists — #56.
   *
   * **A `var`, not a secret, and it holds no credential.** The secret half lives in GoTrue as
   * `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`; this only says whether the button should be
   * offered. It exists because the button and the provider are switched on by two different
   * people at two different times: `[auth.external.google]` in `config.toml` ships on the next
   * merge touching a migration, while this is a Cloudflare deploy. Offering a button that
   * leads to a provider GoTrue does not know about is a dead end somebody has to debug, so
   * the button renders only when this says the far side is ready.
   *
   * Optional, and absent means off — a new environment is safe by default rather than broken.
   */
  GOOGLE_SIGN_IN?: string;
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
      return signInPage(
        env,
        secure,
        null,
        {},
        { email: '' },
        refreshedCookies,
        {},
        url.searchParams.get('sent') === 'ok'
          ? 'link-sent'
          : url.searchParams.get('deleted') === 'ok'
            ? 'deleted'
            : null,
      );
    }
    if (request.method === 'POST') {
      return handleSignIn(request, env, cfg, secure);
    }
  }

  // **A second address rather than a hidden field on `/account/sign-in/`.** The magic link's
  // form is rendered on the sign-in page, as #55 asks, but it submits here — because "the
  // address a submission arrives at is what tells them apart" is how this repository has
  // separated two forms since the entry pages stopped carrying a hidden `form` field.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'link') {
    return handleMagicLinkRequest(request, env, cfg, secure, url);
  }

  // Same reasoning, and a POST rather than a link because minting the PKCE verifier is a
  // state-changing act that sets a cookie — and because a bare `<a>` to Google could be
  // triggered from another origin, which is what the CSRF token here refuses.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'google') {
    return handleGoogleStart(request, env, cfg, secure, url);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'sign-out') {
    return handleSignOut(request, session, cfg, secure);
  }

  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'confirm') {
    return handleConfirm(cfg, url, secure);
  }

  // **The one address every non-password route lands on** — the magic link from #55 and
  // Google's return from #56. Built once, used twice, which is why #56 adds no address of its
  // own.
  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'callback') {
    return handleCallback(request, env, cfg, secure, url);
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

  if (segments.length === 1 && segments[0] === 'details') {
    if (request.method === 'GET') {
      if (url.searchParams.get('done') === 'ok') {
        const emailPending = url.searchParams.get('email') === 'pending';
        return page('Details saved', detailsAcknowledgement(emailPending), {
          secure,
          cookies: refreshedCookies,
        });
      }
      return handleShowDetails(session, cfg, secure, refreshedCookies);
    }
    if (request.method === 'POST') {
      return handleUpdateDetails(request, session, cfg, secure, refreshedCookies);
    }
  }

  if (segments.length === 1 && segments[0] === 'data') {
    if (request.method === 'GET') {
      if (session === null) {
        return redirectTo('/account/sign-in/', secure, refreshedCookies);
      }
      return dataPage(secure, null, refreshedCookies);
    }
  }

  // Two addresses, not one with a hidden field, and not one button that does both. The export
  // and the deletion have nothing in common except the page they are offered on: one hands
  // back a file, the other is irreversible.
  if (
    request.method === 'POST' &&
    segments.length === 2 &&
    segments[0] === 'data' &&
    segments[1] === 'export'
  ) {
    return handleExport(request, session, cfg, secure, refreshedCookies);
  }

  if (
    request.method === 'POST' &&
    segments.length === 2 &&
    segments[0] === 'data' &&
    segments[1] === 'delete'
  ) {
    return handleDeleteAccount(request, session, cfg, secure, refreshedCookies);
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
      <p><a href="/account/details/">Your details</a></p>
      <p><a href="/account/password/">Change your password</a></p>
      <p><a href="/account/data/">Your data — download or delete it</a></p>
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
      ${
        env.GOOGLE_SIGN_IN === 'on'
          ? html`<form method="post" action="/account/google/" class="signup" novalidate>
              <fieldset class="account-way">
                <legend>Or use your Google account</legend>
                <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
                <button class="button button-secondary" type="submit">
                  Continue with Google
                </button>
              </fieldset>
            </form>`
          : null
      }
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

/**
 * Three ways in on one page, and the structure is what makes that usable rather than
 * confusing.
 *
 * **Each way is its own `fieldset` with its own `legend`.** #55 is explicit that "two forms on
 * one page needs real fieldset and legend structure, not two lonely inputs" — a screen reader
 * announcing two unlabelled email boxes gives somebody no way to tell which one sends a link
 * and which one wants a password. The legends are what separate them.
 *
 * **Two `<form>` elements, submitting to two addresses.** Nested forms are not a thing HTML
 * has, and a single form with two submit buttons would have to be told apart by a hidden
 * field — which is the pattern this repository moved away from when the entry pages stopped
 * carrying one.
 *
 * @param magicLinkErrors kept separate from `errors` so a bad address in one form does not
 *   light up the identically-named field in the other.
 */
function signInPage(
  env: Env,
  secure: boolean,
  message: string | null,
  errors: AccountSignInErrors,
  submitted: { email: string },
  extraCookies: string[],
  magicLinkErrors: AccountMagicLinkErrors = {},
  notice: 'link-sent' | 'deleted' | null = null,
): Response {
  const csrfToken = mintCsrfToken();
  const googleOn = env.GOOGLE_SIGN_IN === 'on';
  const hasError =
    message !== null ||
    Object.keys(errors).length > 0 ||
    Object.keys(magicLinkErrors).length > 0;

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
      ${
        notice === 'link-sent'
          ? html`<div class="notice" role="status" tabindex="-1" autofocus>
              <p>
                If there is an account for that address, we have sent it a link to sign
                in. It can only be used once, and it has to be opened in this browser.
              </p>
            </div>`
          : null
      }
      ${
        notice === 'deleted'
          ? html`<div class="notice" role="status" tabindex="-1" autofocus>
              <p>
                Your account has been deleted. Any race entry you paid for is unaffected
                and you are still on the start list.
              </p>
            </div>`
          : null
      }

      <form method="post" action="/account/sign-in/" class="signup" novalidate>
        <fieldset class="account-way">
          <legend>Sign in with a password</legend>
          <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
          ${textField('email', 'Email address', submitted.email, errors.email, {
            type: 'email',
            autocomplete: 'email',
          })}
          ${passwordField('password', 'Password', errors.password, 'current-password')}
          ${turnstile(env.TURNSTILE_SITE_KEY, errors.captchaToken)}
          <button class="button" type="submit">Sign in</button>
        </fieldset>
      </form>

      <form method="post" action="/account/link/" class="signup" novalidate>
        <fieldset class="account-way">
          <legend>Or have a link emailed to you</legend>
          <p class="field-hint">
            No password to remember. The link signs you in on this device, and works once.
          </p>
          <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
          ${textField('email', 'Where to send the link', '', magicLinkErrors.email, {
            type: 'email',
            autocomplete: 'email',
            id: 'account-link-email',
          })}
          ${turnstile(env.TURNSTILE_SITE_KEY, magicLinkErrors.captchaToken, false)}
          <button class="button" type="submit">Email me a link</button>
        </fieldset>
      </form>

      ${
        googleOn
          ? html`<form method="post" action="/account/google/" class="signup" novalidate>
              <fieldset class="account-way">
                <legend>Or use your Google account</legend>
                <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
                <button class="button button-secondary" type="submit">
                  Sign in with Google
                </button>
              </fieldset>
            </form>`
          : null
      }

      <p><a href="/account/sign-up/">Create an account</a></p>
      <p><a href="/account/reset/">Forgotten your password?</a></p>
    </main>
  `;

  return page('Sign in', body, {
    status: hasError ? 422 : 200,
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

/**
 * **Two link shapes arrive here, and supporting both is what makes #101 an expand.**
 *
 * The old one is GoTrue's default: it verifies the token at `<project>.supabase.co` and
 * redirects here with nothing but `?error=` on a failure. **Links in that shape are sitting in
 * real inboxes** with an hour to run on them, so this keeps answering them.
 *
 * The new one is `?token_hash=…&type=signup`, built by
 * `packages/db/supabase/templates/confirmation.html`, and the whole point of it is that the
 * address a member is asked to click is the club's rather than a Supabase project id nobody
 * recognises. The verification moves here with it.
 *
 * ⚠️ **This deliberately does not sign anybody in, and that is a security decision rather
 * than an omission.** `/account/callback/` can hand out a session because PKCE's `HttpOnly`
 * verifier cookie proves the same browser started the flow — a prefetching mail scanner holds
 * a code and no verifier, so its exchange is refused. **`token_hash` has no such proof**:
 * anything that follows the link can spend the token. Consuming it early is tolerable for a
 * confirmation, because all it confirms is that the address exists and the account is
 * unusable without a password anyway. **Handing that scanner a session would not be.** The
 * page has always ended by asking the person to sign in, so nothing about the journey
 * changes.
 *
 * That trade is why #101 is confirmation-only. A magic link *is* a session, so the same
 * substitution there would be a different and much worse bargain.
 */
async function handleConfirm(
  cfg: SupabaseConfig,
  url: URL,
  secure: boolean,
): Promise<Response> {
  const tokenHash = url.searchParams.get('token_hash');

  // `?error=` is GoTrue's own refusal, arriving on the old link shape. Checked first so a
  // request carrying both is treated as the failure it is.
  let failed = url.searchParams.get('error') !== null;

  if (!failed && tokenHash !== null) {
    // `signup` and nothing else. The template sends that and only that, and accepting the
    // wider set `verifyOtp` allows would make this address a verification endpoint for
    // recovery and email-change tokens too — neither of which ends on this page.
    failed = url.searchParams.get('type') !== 'signup';

    if (!failed) {
      try {
        const { error } = await createAnonClient(cfg).auth.verifyOtp({
          type: 'signup',
          token_hash: tokenHash,
        });
        failed = error !== null;
      } catch {
        // The database being unreachable is not a bad link, and telling somebody to sign up
        // again would cost them their account for a transient fault.
        return page(
          'Confirm your email',
          html`
            <main class="account-page">
              <h1>That did not work</h1>
              <p>
                The club’s database could not be reached. Try the link again in a moment.
              </p>
            </main>
          `,
          { status: 503, secure, cookies: [] },
        );
      }
    }
  }

  const body = html`
    <main class="account-page">
      ${
        failed
          ? html`<h1>That link did not work</h1>
              <p>
                It may have expired, or it may already have been used —
                <a href="/account/sign-in/">try signing in</a>, because your address may
                be confirmed already.
              </p>
              <p>
                If that does not work, <a href="/account/sign-up/">sign up again</a> for a
                fresh link, or contact the club if this keeps happening.
              </p>`
          : html`<h1>Your email is confirmed</h1>
              <p><a href="/account/sign-in/">Sign in</a> to continue.</p>`
      }
    </main>
  `;

  return page('Confirm your email', body, { secure, cookies: [] });
}

// -----------------------------------------------------------------------------------------
// /account/link/, /account/google/ and /account/callback/ — #55 and #56
// -----------------------------------------------------------------------------------------

/**
 * The PKCE code verifier, on its way to a mail client and back.
 *
 * **`HttpOnly`, and that is the whole security argument.** A prefetching mail scanner that
 * follows the link holds a code and no verifier, so the exchange below refuses it — which is
 * how #55's "a scanner must not consume the token" is met without the email template that
 * finding 3 of `PLAN.md` explains is unavailable.
 *
 * **`SameSite=Lax`, for the reason `session.ts` gives about the session pair.** Arriving from
 * a mail client is a cross-site top-level navigation; `Strict` would drop this cookie on the
 * way in and the exchange would fail on a perfectly good code. Do not tighten it.
 *
 * **Ten minutes.** Long enough to open an email on a phone that has gone to sleep, short
 * enough that a shared machine does not keep a redeemable secret all day.
 */
const PKCE_COOKIE = 'src_pkce';
const PKCE_COOKIE_MAX_AGE_SECONDS = 60 * 10;

function pkceCookie(verifier: string, secure: boolean): string {
  return [
    `${PKCE_COOKIE}=${verifier}`,
    'Path=/account',
    `Max-Age=${PKCE_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function clearedPkceCookie(secure: boolean): string {
  return [
    `${PKCE_COOKIE}=`,
    'Path=/account',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Where to send somebody once they are signed in.
 *
 * **An unchecked `next` is an open redirect**, and this one is reachable from a link in an
 * email — the single most credible place to put one. The rule is that the value must resolve
 * to a path on this origin, so anything carrying a scheme or a host is refused outright
 * rather than sanitised: `//evil.example` is a protocol-relative URL that browsers treat as
 * another origin, and a backslash is treated as a slash by enough parsers to be worth
 * refusing too.
 *
 * Refusal is silent and falls back to `/account/`, because there is no useful thing to tell
 * somebody who did not construct the URL themselves.
 */
function safeNext(raw: string | null): string {
  if (raw === null || raw === '') {
    return '/account/';
  }

  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/account/';
  }

  // A backslash or whitespace anywhere is enough to refuse: no address in this
  // application contains either, and both are known ways of talking a URL parser into
  // reading a host where a path was meant.
  if (/[\\\s]/.test(raw)) {
    return '/account/';
  }

  // Control characters are refused by code point rather than by a character class,
  // because ESLint's `no-control-regex` is right that a literal control character inside
  // a pattern is nearly always a mistake — and a code-point test says the same thing more
  // plainly than an escape somebody has to decode. `\s` above has already taken tab,
  // newline and friends; this is the rest of C0, plus delete.
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return '/account/';
    }
  }

  return raw;
}

async function handleMagicLinkRequest(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
  url: URL,
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
      { email: '' },
      [],
    );
  }

  const parsed = parseAccountMagicLink(
    form === null
      ? {}
      : {
          email: form.get('email'),
          captchaToken: form.get('cf-turnstile-response'),
        },
  );

  if (!parsed.ok) {
    return signInPage(env, secure, null, {}, submitted, [], parsed.errors);
  }

  const next = safeNext(url.searchParams.get('next'));
  const { client, store } = createPkceClient(cfg, null);

  try {
    const { error } = await client.auth.signInWithOtp({
      email: parsed.value.email,
      options: {
        captchaToken: parsed.value.captchaToken,
        emailRedirectTo: `${url.origin}/account/callback/?next=${encodeURIComponent(next)}`,
        // **Never create an account from a magic link.** Registering is `/account/sign-up/`,
        // which collects a name and shows the terms; a link that silently created a nameless
        // account would put people in the members table who never agreed to anything.
        shouldCreateUser: false,
      },
    });

    if (error !== null && isCaptchaError(error)) {
      return signInPage(env, secure, null, {}, submitted, [], {
        captchaToken: 'That verification check did not complete. Try again.',
      });
    }
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

  const verifier = store.minted();

  // **The acknowledgement is the same whether or not that address has an account**, which is
  // the rule #54 established for reset and which matters more here: this form is on the sign-in
  // page, so a different answer for a real address would turn it into a membership oracle
  // anybody could query. `shouldCreateUser: false` means GoTrue quietly sends nothing to an
  // address it does not know, and this response cannot tell the two apart either.
  return redirectTo('/account/sign-in/?sent=ok', secure, [
    ...(verifier === null ? [] : [pkceCookie(verifier, secure)]),
  ]);
}

/**
 * #56 — hand somebody off to Google, having first minted the verifier that will redeem their
 * return.
 *
 * **A POST, not a link.** It sets a cookie and starts an authentication, so it carries a CSRF
 * token like every other state-changing form here. `skipBrowserRedirect` is what makes
 * supabase-js hand back the URL instead of trying to navigate a `window` a Worker does not
 * have.
 */
async function handleGoogleStart(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
  url: URL,
): Promise<Response> {
  const form = await readForm(request);
  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form?.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return signInPage(
      env,
      secure,
      'That form had expired. Please try again.',
      {},
      { email: '' },
      [],
    );
  }

  if (env.GOOGLE_SIGN_IN !== 'on') {
    return signInPage(
      env,
      secure,
      'Signing in with Google is not switched on yet.',
      {},
      { email: '' },
      [],
    );
  }

  const next = safeNext(url.searchParams.get('next'));
  const { client, store } = createPkceClient(cfg, null);

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${url.origin}/account/callback/?next=${encodeURIComponent(next)}`,
        skipBrowserRedirect: true,
        // **Email and profile, and nothing else.** #56 is explicit: no Drive, no Calendar, no
        // contacts. A consent screen asking for more than a name and an address is one people
        // are right to refuse.
        scopes: 'email profile',
      },
    });

    if (error !== null || data?.url === undefined || data.url === null) {
      return signInPage(
        env,
        secure,
        'Google sign-in could not be started. Try again in a moment.',
        {},
        { email: '' },
        [],
      );
    }

    const verifier = store.minted();

    return redirectTo(data.url, secure, [
      ...(verifier === null ? [] : [pkceCookie(verifier, secure)]),
    ]);
  } catch {
    return signInPage(
      env,
      secure,
      'Google sign-in could not be started. Try again in a moment.',
      {},
      { email: '' },
      [],
    );
  }
}

/**
 * The one address every non-password route lands on — #55's magic link and #56's Google
 * return both.
 *
 * **A query string, not a fragment.** `/account/reset/confirm/` has to ship a hidden form and
 * an inline script because GoTrue's recovery link uses the implicit flow and puts its tokens
 * in the URL fragment, which never reaches a server. PKCE puts a `code` on the query string
 * instead, so this handler reads it directly — no script, and therefore nothing that breaks
 * with scripting off.
 */
async function handleCallback(
  request: Request,
  env: Env,
  cfg: SupabaseConfig,
  secure: boolean,
  url: URL,
): Promise<Response> {
  const code = url.searchParams.get('code');
  const verifier = cookieValue(request.headers.get('cookie'), PKCE_COOKIE);

  // GoTrue reports its own refusals here rather than at the link — an expired or already-used
  // link arrives as an error on the query string, not as a missing code.
  const providerError =
    url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (providerError !== null) {
    return callbackFailurePage(secure, 'expired');
  }

  if (code === null) {
    return callbackFailurePage(secure, 'expired');
  }

  // **No verifier means this browser did not start this sign-in.** A mail scanner that
  // followed the link is the common case and gets nothing; so is somebody who asked for a
  // link on their laptop and opened it on their phone, which is why the message says so
  // rather than blaming them.
  if (verifier === null) {
    return callbackFailurePage(secure, 'other-browser');
  }

  const { client } = createPkceClient(cfg, verifier);

  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);

    if (error !== null || data.session === null) {
      return callbackFailurePage(secure, 'expired');
    }

    return redirectTo(safeNext(url.searchParams.get('next')), secure, [
      ...newSessionCookies(
        data.session.access_token,
        data.session.refresh_token,
        data.session.expires_in,
        secure,
      ),
      clearedPkceCookie(secure),
    ]);
  } catch {
    return page(
      'Sign in',
      html`
        <main class="account-page">
          <h1>That did not work</h1>
          <p>The club’s database could not be reached. Try again in a moment.</p>
          <p><a href="/account/sign-in/">Back to sign in</a></p>
        </main>
      `,
      { status: 503, secure, cookies: [clearedPkceCookie(secure)] },
    );
  }
}

/**
 * **A used link says so.** #55 asks that a second use be distinguishable from a blank
 * failure, because the alternative is somebody tapping a dead link repeatedly with no idea
 * why. The two reasons are told apart because the fixes differ: one needs a fresh link, the
 * other needs the same browser.
 */
function callbackFailurePage(
  secure: boolean,
  reason: 'expired' | 'other-browser',
): Response {
  const body = html`
    <main class="account-page">
      <h1>That link did not work</h1>
      ${
        reason === 'other-browser'
          ? html`<p>
              This link has to be opened in the same browser you asked for it from. If you
              asked on a laptop and opened it on a phone, ask again from the device you
              want to be signed in on.
            </p>`
          : html`<p>
              Links can only be used once, and they expire. Ask for a new one and it will
              work.
            </p>`
      }
      <p><a href="/account/sign-in/">Back to sign in</a></p>
    </main>
  `;

  return page('That link did not work', body, {
    status: 400,
    secure,
    cookies: [clearedPkceCookie(secure)],
  });
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
// /account/details/ — #61
// -----------------------------------------------------------------------------------------

interface DetailsFormValues {
  name: string;
  email: string;
  gender: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  address: string;
}

function blankDetailsForm(): DetailsFormValues {
  return {
    name: '',
    email: '',
    gender: '',
    dobDay: '',
    dobMonth: '',
    dobYear: '',
    address: '',
  };
}

async function handleShowDetails(
  session: Session | null,
  cfg: SupabaseConfig,
  secure: boolean,
  refreshedCookies: string[],
): Promise<Response> {
  if (session === null) {
    return redirectTo('/account/sign-in/', secure, refreshedCookies);
  }

  try {
    // The email address is `auth.users`', not `identity.people`'s — the same reason
    // `handleChangePassword` re-asks Supabase Auth rather than trusting anything cached
    // from `readSession()`, which never returns it.
    const { data: userData, error: userError } = await createAnonClient(cfg).auth.getUser(
      session.accessToken,
    );

    if (userError || !userData.user.email) {
      return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
    }

    const client = createUserClient(cfg, session.accessToken);
    const { data, error } = await client
      .from('people')
      .select('name, gender, date_of_birth, address, updated_at')
      .eq('id', session.userId)
      .single();

    if (error || !data) {
      return detailsPage(
        secure,
        'The club’s database could not be reached. Try again in a moment.',
        {},
        blankDetailsForm(),
        null,
        refreshedCookies,
      );
    }

    const dob = data.date_of_birth === null ? null : parseIsoDate(data.date_of_birth);

    return detailsPage(
      secure,
      null,
      {},
      {
        name: data.name ?? '',
        email: userData.user.email,
        gender: data.gender ?? '',
        dobDay: dob === null ? '' : String(dob.day),
        dobMonth: dob === null ? '' : String(dob.month),
        dobYear: dob === null ? '' : String(dob.year),
        address: data.address ?? '',
      },
      data.updated_at,
      refreshedCookies,
    );
  } catch {
    return detailsPage(
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      blankDetailsForm(),
      null,
      refreshedCookies,
    );
  }
}

async function handleUpdateDetails(
  request: Request,
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

  const submitted: DetailsFormValues = {
    name: readString(form, 'name'),
    email: readString(form, 'email'),
    gender: readString(form, 'gender'),
    dobDay: readString(form, 'dob_day'),
    dobMonth: readString(form, 'dob_month'),
    dobYear: readString(form, 'dob_year'),
    address: readString(form, 'address'),
  };

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return detailsPage(
      secure,
      'That form had expired. Please try again.',
      {},
      submitted,
      null,
      refreshedCookies,
    );
  }

  const parsed = parseAccountDetails(
    form === null
      ? {}
      : {
          name: form.get('name'),
          email: form.get('email'),
          gender: form.get('gender'),
          dobDay: form.get('dob_day'),
          dobMonth: form.get('dob_month'),
          dobYear: form.get('dob_year'),
          address: form.get('address'),
        },
  );

  if (!parsed.ok) {
    return detailsPage(secure, null, parsed.errors, submitted, null, refreshedCookies);
  }

  try {
    const { data: userData, error: userError } = await createAnonClient(cfg).auth.getUser(
      session.accessToken,
    );

    if (userError || !userData.user.email) {
      return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
    }

    const client = createUserClient(cfg, session.accessToken);
    const { error: peopleError } = await client
      .from('people')
      .update({
        name: parsed.value.name,
        gender: parsed.value.gender ?? null,
        date_of_birth: parsed.value.dateOfBirth ?? null,
        address: parsed.value.address ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.userId);

    if (peopleError) {
      return detailsPage(
        secure,
        'That could not be saved. Check what you typed and try again.',
        {},
        submitted,
        null,
        refreshedCookies,
      );
    }

    // **Case-insensitively, because email addresses are.** Resubmitting the form with the
    // same address unchanged must not re-trigger GoTrue's double confirmation — that would
    // mail somebody every time they only meant to update their address or date of birth.
    if (parsed.value.email.toLowerCase() === userData.user.email.toLowerCase()) {
      return redirectTo('/account/details/?done=ok', secure, refreshedCookies);
    }

    // **`updateUser()` needs a real session, via `setSession()`, not a bearer token
    // alone** — the same requirement `handleChangePassword` documents at its own call to
    // it. There is no current-password check here first: #61's issue body asks for none,
    // and the person changing this is already sitting behind the session cookie that
    // proves who they are.
    const refreshToken = cookieValue(request.headers.get('cookie'), REFRESH_COOKIE);

    if (refreshToken === null) {
      return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
    }

    const emailClient = createAnonClient(cfg);
    const { error: setError } = await emailClient.auth.setSession({
      access_token: session.accessToken,
      refresh_token: refreshToken,
    });

    if (setError) {
      return redirectTo('/account/sign-in/', secure, clearedSessionCookies(secure));
    }

    // **`emailRedirectTo`, not `config.toml`'s `site_url` default** — the same reason
    // `handleSignUp`'s own `signUp()` call sets it: a confirmation link that always points
    // at production would never land back on a local or CI run, and Mailpit would catch a
    // mail nobody could follow anywhere useful.
    const url = new URL(request.url);
    const { error: emailError } = await emailClient.auth.updateUser(
      { email: parsed.value.email },
      { emailRedirectTo: `${url.origin}/account/confirm` },
    );

    if (emailError) {
      return detailsPage(
        secure,
        'That could not be saved. Check what you typed and try again.',
        {},
        submitted,
        null,
        refreshedCookies,
      );
    }

    return redirectTo(
      '/account/details/?done=ok&email=pending',
      secure,
      refreshedCookies,
    );
  } catch {
    return detailsPage(
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      {},
      submitted,
      null,
      refreshedCookies,
    );
  }
}

function detailsPage(
  secure: boolean,
  message: string | null,
  errors: AccountDetailsErrors,
  submitted: DetailsFormValues,
  updatedAt: string | null,
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Your details</h1>
      <p>
        What each of these is for, and how long the club keeps it, is at
        <a href="/privacy/">the club’s privacy notice</a>.
      </p>
      ${
        updatedAt !== null
          ? html`<p class="field-hint">Last saved ${formatLondon(updatedAt)}.</p>`
          : null
      }
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }
      <form method="post" action="/account/details/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        ${textField('name', 'Your name', submitted.name, errors.name, {
          autocomplete: 'name',
        })}
        ${textField('email', 'Email address', submitted.email, errors.email, {
          type: 'email',
          autocomplete: 'email',
        })}
        <p class="field-hint">
          Changing this sends a confirmation link to both your current address and the new
          one — the change only takes effect once you have confirmed both.
        </p>
        ${textField('gender', 'Gender', submitted.gender, errors.gender, {
          autocomplete: 'sex',
        })}
        <p class="field-hint">Optional — free text, not a fixed list.</p>
        ${dobField(submitted, errors.dateOfBirth)}
        ${textField('address', 'Address', submitted.address, errors.address, {
          autocomplete: 'street-address',
        })}
        <p class="field-hint">Optional — so the club knows where to post club kit.</p>
        <button class="button" type="submit">Save changes</button>
      </form>
    </main>
  `;

  return page('Your details', body, {
    status: message !== null || Object.keys(errors).length > 0 ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

// -----------------------------------------------------------------------------------------
// /account/data/ — #62
// -----------------------------------------------------------------------------------------

/**
 * Export and deletion, on one page and behind a session.
 *
 * **The page states what deletion does not remove, before the button rather than after it.**
 * This is the part that is a promise rather than a feature, and getting it wrong is worse
 * than not offering deletion at all: somebody who deletes their account believing their race
 * entry disappears with it finds out at the start line, on a morning that cannot be re-run.
 *
 * **No Turnstile.** It is behind a session, and #53's rule holds — a bot with a valid session
 * has already got in. CSRF is what matters here, and both forms carry it.
 */
function dataPage(
  secure: boolean,
  message: string | null,
  extraCookies: string[],
): Response {
  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Your data</h1>
      ${
        message !== null
          ? html`<div class="notice notice-bad" role="alert" tabindex="-1" autofocus>
              <p>${message}</p>
            </div>`
          : null
      }

      <h2>Download what the club holds about you</h2>
      <p>
        Everything on your account, as a file. It downloads to this device — the club does
        not email it, because emailing somebody’s personal data is a disclosure with no
        way back.
      </p>
      <form method="post" action="/account/data/export/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        <button class="button" type="submit">Download my data</button>
      </form>

      <h2>Delete your account</h2>
      <p>This removes your account and your profile, and cannot be undone. It deletes:</p>
      <ul>
        <li>your sign-in, so you will be signed out everywhere immediately</li>
        <li>your name, gender, date of birth and address</li>
        <li>any club role you hold</li>
      </ul>
      <p><strong>It does not delete:</strong></p>
      <ul>
        <li>
          <strong>a race entry you have paid for.</strong> That is a financial record with
          its own retention, and it belongs to the transaction as much as to you. You will
          still be on the start list
        </li>
        <li>
          any medical note you gave with an entry — that is deleted automatically a month
          after the race, and this does not change when
        </li>
        <li>
          the interest list, if you asked to hear about a race. That has its own record
        </li>
        <li>
          the club’s record of roles granted and revoked. It will no longer name you, but
          the entries stay
        </li>
      </ul>
      <p>
        If you want something removed that is not on the first list, write to
        <a href="mailto:info@southvillerunningclub.co.uk"
          >info@southvillerunningclub.co.uk</a
        >
        and a person will deal with it. A request that reaches beyond your own account is
        a decision somebody takes with a legal test attached, not a button.
      </p>
      <p>
        <a href="/privacy/">What the club does with your details</a> explains why each
        thing is held, and for how long.
      </p>
      <form method="post" action="/account/data/delete/" class="signup" novalidate>
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
        <div class="field">
          <label class="field-label" for="account-delete-confirm">
            Type <strong>DELETE</strong> to confirm
          </label>
          <input
            class="field-input"
            id="account-delete-confirm"
            name="confirm"
            type="text"
            autocomplete="off"
          />
        </div>
        <button class="button button-danger" type="submit">Delete my account</button>
      </form>
    </main>
  `;

  return page('Your data', body, {
    status: message !== null ? 422 : 200,
    secure,
    cookies: [...extraCookies, csrfCookie(csrfToken, secure)],
  });
}

async function handleExport(
  request: Request,
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
    return dataPage(secure, 'That form had expired. Please try again.', refreshedCookies);
  }

  try {
    const client = createUserClient(cfg, session.accessToken);
    const { data, error } = await client.rpc('export_me');

    if (error !== null || data === null) {
      return dataPage(
        secure,
        'The club’s database could not be reached. Try again in a moment.',
        refreshedCookies,
      );
    }

    const result = data as { ok?: boolean };

    if (result.ok !== true) {
      return dataPage(
        secure,
        'That export could not be produced. Try signing in again.',
        refreshedCookies,
      );
    }

    // **An attachment, asserted on the response rather than on a download event.** The three
    // browser engines disagree about what an attachment is — and WebKit on a Linux runner
    // renders one in the tab where macOS WebKit downloads it — so the status, the content
    // type and the filename are what every engine agrees on. See CLAUDE.md's note on the
    // admin CSV exports; the same rule applies here.
    return new Response(`${JSON.stringify(data, null, 2)}\n`, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition':
          'attachment; filename="southville-running-club-account.json"',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  } catch {
    return dataPage(
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      refreshedCookies,
    );
  }
}

async function handleDeleteAccount(
  request: Request,
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
    return dataPage(secure, 'That form had expired. Please try again.', refreshedCookies);
  }

  // **Deliberately not reachable by one keystroke.** #62 asks for that explicitly, and a
  // typed word is the cheapest version that is not a modal nobody can use with a keyboard.
  if (readString(form, 'confirm').trim().toUpperCase() !== 'DELETE') {
    return dataPage(
      secure,
      'Type DELETE in the box to confirm you want the account removed.',
      refreshedCookies,
    );
  }

  try {
    const client = createUserClient(cfg, session.accessToken);
    const { data, error } = await client.rpc('delete_me');

    if (error !== null || data === null) {
      return dataPage(
        secure,
        'The club’s database could not be reached. Try again in a moment.',
        refreshedCookies,
      );
    }

    const result = data as { ok?: boolean; reason?: string };

    if (result.ok !== true) {
      if (result.reason === 'last_super_admin') {
        return dataPage(
          secure,
          'You are the club’s only super-admin. Give somebody else that role at /admin/people/ first, or nobody will be able to administer the site.',
          refreshedCookies,
        );
      }

      return dataPage(
        secure,
        'That account could not be deleted. Try signing in again.',
        refreshedCookies,
      );
    }

    // The `auth.users` row is gone, and its refresh tokens with it, so the session is already
    // dead server-side. Clearing the cookies is what stops the browser presenting a token
    // that now resolves to nobody on every subsequent request.
    return redirectTo(
      '/account/sign-in/?deleted=ok',
      secure,
      clearedSessionCookies(secure),
    );
  } catch {
    return dataPage(
      secure,
      'The club’s database could not be reached. Try again in a moment.',
      refreshedCookies,
    );
  }
}

function dobField(submitted: DetailsFormValues, error: string | undefined): Html {
  const describedBy =
    error !== undefined ? 'account-dob-hint account-dob-error' : 'account-dob-hint';

  return html`
    <fieldset class="field account-dob">
      <legend class="field-label">Date of birth</legend>
      <p class="field-hint" id="account-dob-hint">
        Optional — an England Athletics registration needs this.
      </p>
      ${
        error !== undefined
          ? html`<p class="field-error" id="account-dob-error">${error}</p>`
          : null
      }
      <div class="account-dob-parts">
        <span class="account-dob-part">
          <label class="field-label" for="account-dob-day">Day</label>
          <input
            class="field-input"
            id="account-dob-day"
            name="dob_day"
            type="text"
            inputmode="numeric"
            maxlength="2"
            autocomplete="bday-day"
            value="${submitted.dobDay}"
            aria-describedby="${describedBy}"
          />
        </span>
        <span class="account-dob-part">
          <label class="field-label" for="account-dob-month">Month</label>
          <input
            class="field-input"
            id="account-dob-month"
            name="dob_month"
            type="text"
            inputmode="numeric"
            maxlength="2"
            autocomplete="bday-month"
            value="${submitted.dobMonth}"
            aria-describedby="${describedBy}"
          />
        </span>
        <span class="account-dob-part account-dob-year">
          <label class="field-label" for="account-dob-year">Year</label>
          <input
            class="field-input"
            id="account-dob-year"
            name="dob_year"
            type="text"
            inputmode="numeric"
            maxlength="4"
            autocomplete="bday-year"
            value="${submitted.dobYear}"
            aria-describedby="${describedBy}"
          />
        </span>
      </div>
    </fieldset>
  `;
}

function detailsAcknowledgement(emailPending: boolean): Html {
  return html`
    <main class="account-page">
      <h1>Details saved</h1>
      ${
        emailPending
          ? html`<p>
              We’ve sent a confirmation link to both your current email address and your
              new one. The change only takes effect once you have confirmed both — until
              then, sign in with your current address.
            </p>`
          : null
      }
      <p><a href="/account/">Back to your account</a></p>
    </main>
  `;
}

// -----------------------------------------------------------------------------------------
// Shared markup
// -----------------------------------------------------------------------------------------

/**
 * @param attrs.id overrides the id derived from `name`. Needed exactly once, and for a reason
 *   worth stating: `/account/sign-in/` carries **two** fields called `email` — one on the
 *   password form and one on the magic-link form — and a name is what the server reads while
 *   an id is what the `<label>` points at. Left to derive, both would be `account-email`,
 *   which is a duplicate id: axe fails it, and a click on the second label focuses the first
 *   input. Two fields may share a name across two forms; they may not share an id.
 */
function textField(
  name: string,
  label: string,
  value: string,
  error: string | undefined,
  attrs: { type?: string; autocomplete?: string; id?: string },
): Html {
  const id = attrs.id ?? `account-${name}`;
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
/**
 * @param includeScript `false` for the second and subsequent widgets on one page.
 *   `/account/sign-in/` carries two — one per form — and Turnstile's `api.js` finds every
 *   `.cf-turnstile` on the document by itself, so the loader belongs there once. Emitting it
 *   twice is not fatal, but it is a second network entry and a second auto-render pass over
 *   the same two divs, which is exactly the sort of thing that turns into a flaky test.
 */
function turnstile(
  siteKey: string,
  error: string | undefined,
  includeScript = true,
): Html {
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
    ${
      includeScript
        ? html`<script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            async
            defer
          ></script>`
        : null
    }
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
        ${faviconLink()}
        <link rel="stylesheet" href="/account.css" />
      </head>
      <body>
        ${siteBanner()} ${body} ${siteFooter()}
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
