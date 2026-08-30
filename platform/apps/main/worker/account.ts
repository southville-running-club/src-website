import {
  ENTRY_REQUEST_REASON_MAX_LENGTH,
  createAnonClient,
  createPkceClient,
  createUserClient,
  entryStatusWording,
  requestEntryAction,
  fetchMyEntries,
  formatEventDate,
  formatEventStartTime,
  formatLondon,
  formatPence,
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
  type EntryRequest,
  type MyEntry,
  type SupabaseConfig,
} from '@src/shared';
import { html, raw, type Html } from './html';
import { cookieValue } from './cookies';
import { faviconLink, siteBanner, siteFooter, siteNav } from './site-chrome';
import {
  REFRESH_COOKIE,
  clearedSessionCookies,
  newSessionCookies,
  readSession,
  signOut as endSession,
  type Session,
} from './session';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { ACCOUNT_PREFIX, accountSegments } from './routing';

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

/**
 * The first segment of every `/account/` address that is *for* somebody who is not signed
 * in — where a stale session cookie is beside the point rather than the subject.
 *
 * Written out rather than inferred from `session === null`, because the two questions are
 * genuinely different: `/account/sign-in/` is reachable both by somebody who has never had
 * an account and by somebody whose session just ran out, and only the second is owed an
 * explanation. Everything not on this list needs a session, so everything not on this list
 * gets one when a session ends underneath it.
 */
const SIGNED_OUT_ADDRESSES = new Set([
  'sign-up',
  'sign-in',
  'link',
  'google',
  'confirm',
  'callback',
  'reset',
]);

export async function handleAccount(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const secure = url.protocol === 'https:';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cookieHeader = request.headers.get('cookie');
  const cfg = config(env);

  const {
    session,
    setCookies: refreshedCookies,
    timedOut,
  } = await readSession(cfg, cookieHeader, nowSeconds, secure);

  const segments = accountSegments(url.pathname);

  // **Why a timed-out session is turned away here rather than at each address.** Every
  // address that needs a session already redirects to `/account/sign-in/` when there is
  // none, and that redirect is right — but arriving at a sign-in page with no explanation,
  // having been signed in when the tab was left, reads as the site having lost something
  // rather than as the thing ADR-019 deliberately did. So it is said once, in one place.
  //
  // The addresses that are *for* somebody signed out are left alone, and that is the whole
  // reason this is a list rather than `session === null`: intercepting `/account/sign-in/`
  // or a magic link's callback with a stale cookie would break the very flow somebody is on
  // their way to when they arrive holding one.
  if (timedOut && !SIGNED_OUT_ADDRESSES.has(segments[0] ?? '')) {
    return redirectTo('/account/sign-in/?timed-out=ok', secure, refreshedCookies);
  }

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
            : url.searchParams.get('timed-out') === 'ok'
              ? 'timed-out'
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

  if (segments.length === 1 && segments[0] === 'entries') {
    if (request.method === 'GET') {
      return entriesPage(session, cfg, secure, refreshedCookies, url);
    }

    if (request.method === 'POST') {
      return requestOnEntry(request, session, cfg, secure, refreshedCookies);
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

  // **Which account, not what it may do.** This used to list the person's roles, and that was
  // the wrong answer to the question somebody actually arrives at this page with. A role slug
  // is the club's internal vocabulary — `nn-tester`, `registered` — and printing it to the
  // person who holds it either means nothing to them or invites the question "what is that and
  // why do I have it", which this page has no room to answer. It also stated a fact about
  // access in a second place: `/admin/`'s navigation is painted from `identity.my_permissions()`
  // per request, and two renderings of the same thing are two things that can disagree.
  //
  // What is useful here is the address. Somebody with a club account and a personal one — which
  // is the ordinary case for a volunteer — needs to know which of the two they are looking at
  // before they change a password or delete anything, and the rest of this page is exactly
  // those acts. It is the same reason `/admin/`'s masthead names the address rather than the
  // role, from the same read.
  //
  // **`getUser()` rather than a claim decoded out of the token.** It asks Supabase Auth, which
  // is where the confirmed address lives — `identity.people` deliberately does not hold one —
  // and it is the read `worker/admin.ts` already makes for the same purpose.
  const { data: user } = await client.auth.getUser();
  const email = user?.user?.email ?? null;

  const csrfToken = mintCsrfToken();

  const body = html`
    <main class="account-page">
      <h1>Your account</h1>
      <p>
        ${
          email === null
            ? /* The session is good — it got this far — but Supabase Auth did not answer.
                 Saying "signed in" alone is true and says less, which is the right direction
                 when the alternative is naming the wrong account.

                 **A plain string rather than an `html` template, and that is the trap in
                 `CLAUDE.md` rather than a preference.** Prettier reformats the contents of a
                 template tagged `html` and is not configurable, so this sentence arrived with
                 a newline between "signed" and "in" — perfectly correct markup that no
                 `toContain('You are signed in')` can match. A string literal is not reflowed.
                 There is no markup in it to lose. */
              'You are signed in.'
            : html`Signed in as <strong>${email}</strong>.`
        }
      </p>
      <p><a href="/account/entries/">Your race entries</a></p>
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
      ${problemNotice(message, Object.keys(errors).length === 0)}
      <form method="post" action="/account/sign-up/" class="signup" novalidate>
        ${errorSummary([
          ['account-name', errors.name],
          ['account-email', errors.email],
          ['account-password', errors.password],
          ['account-captcha', errors.captchaToken],
        ])}
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
        Math.floor(Date.now() / 1000),
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
  notice: 'link-sent' | 'deleted' | 'timed-out' | null = null,
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
      ${problemNotice(
        message,
        Object.keys(errors).length === 0 && Object.keys(magicLinkErrors).length === 0,
      )}
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
      ${
        /* **It says what happened, not how long the window is.** Somebody who left a tab
           open needs to know the club did this on purpose and that nothing is lost; the
           thirty minutes and the twelve hours are in ADR-019, where they can be changed
           without a copy edit. Naming them here would also tell anybody who asks exactly
           how long a stolen laptop stays useful, which is worth nothing to a runner. */
        notice === 'timed-out'
          ? html`<div class="notice" role="status" tabindex="-1" autofocus>
              <p>
                You were signed out because your session had been open a while. Sign in
                again to pick up where you left off — nothing has been lost.
              </p>
            </div>`
          : null
      }

      <form method="post" action="/account/sign-in/" class="signup" novalidate>
        <fieldset class="account-way">
          <legend>Sign in with a password</legend>
          ${errorSummary([
            ['account-email', errors.email],
            ['account-password', errors.password],
            ['account-captcha', errors.captchaToken],
          ])}
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
          ${errorSummary(
            [
              ['account-link-email', magicLinkErrors.email],
              ['account-link-captcha', magicLinkErrors.captchaToken],
            ],
            Object.keys(errors).length === 0,
          )}
          <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
          ${textField('email', 'Where to send the link', '', magicLinkErrors.email, {
            type: 'email',
            autocomplete: 'email',
            id: 'account-link-email',
          })}
          ${turnstile(
            env.TURNSTILE_SITE_KEY,
            magicLinkErrors.captchaToken,
            false,
            'account-link-captcha',
          )}
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
        Math.floor(Date.now() / 1000),
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
      ${problemNotice(message, Object.keys(errors).length === 0)}
      <form method="post" action="/account/reset/" class="signup" novalidate>
        ${errorSummary([
          ['account-email', errors.email],
          ['account-captcha', errors.captchaToken],
        ])}
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
    // — `createUserClient()`'s header is enough for a PostgREST call, and enough for the
    // `getUser()` in `accountHome()` above, which supabase-js answers straight from that
    // header. `updateUser()` is the one that does not: it has to hand back a *new* session,
    // so it asks the client's internal one, which is empty until something sets it. The same
    // shape `session.ts`'s `signOut()` already uses.
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
        Math.floor(Date.now() / 1000),
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
      ${problemNotice(message, Object.keys(errors).length === 0)}
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
        ${errorSummary([
          ['account-password', errors.password],
          ['account-captcha', errors.captchaToken],
        ])}
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
        Math.floor(Date.now() / 1000),
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
      ${problemNotice(message, Object.keys(errors).length === 0)}
      <form method="post" action="/account/password/" class="signup" novalidate>
        ${errorSummary([
          ['account-current_password', errors.currentPassword],
          ['account-new_password', errors.newPassword],
          ['account-captcha', errors.captchaToken],
        ])}
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
      ${problemNotice(message, Object.keys(errors).length === 0)}
      <form method="post" action="/account/details/" class="signup" novalidate>
        ${errorSummary([
          ['account-name', errors.name],
          ['account-email', errors.email],
          ['account-gender', errors.gender],
          ['account-dob-day', errors.dateOfBirth],
          ['account-address', errors.address],
        ])}
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
      ${problemNotice(message, true)}

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
/**
 * The list of links at the top of a form that was refused — #152.
 *
 * ## What was missing, and what was not
 *
 * The account forms already **announced** their errors: each bad field carries a
 * `.field-error` with `aria-invalid` and `aria-describedby` pointing at it, and the top-level
 * failure is a `role="alert"` that takes focus. So this was never a zero-violations breach.
 * What was missing is the **navigable summary** — the list that takes somebody straight to the
 * field that is wrong instead of leaving them to hunt a page for it.
 *
 * It matters most for exactly the people this area is for: in #56's words, the members most
 * likely to *"use the site once a year and forget they ever had one"*, who are also the most
 * likely to get a password wrong and the least likely to go looking for the reason.
 *
 * ## One summary per form, not one per page
 *
 * `/account/sign-in/` carries two forms — a password one and a magic-link one — with separate
 * error objects, deliberately, so a bad address in one does not mark up the other. Each gets
 * its own summary, as the **first child of its own form**.
 *
 * That is CLAUDE.md's rule about a container's message belonging to that container, and it is
 * the rule that was paid for twice on the entry form: a message that belonged to the wrong
 * container made the entry type impossible to change at all. It also gets
 * `/account/reset/confirm/` right for free — that form is `hidden` until its script has read
 * the recovery tokens out of the fragment, and a summary sitting outside it would be an error
 * list above a form nobody can see.
 *
 * ## The link text is the message
 *
 * Not the field's label. Somebody scanning a list of three wants to know what is wrong, and
 * "Email address" three times over says nothing. This is the shape `nn-signup.spec.ts`'s
 * *"links from the summary to the field it is about"* asserts, one framework along.
 *
 * ⚠️ **The traps this has already cost the repository, both in CLAUDE.md.** A CSS
 * `@view-transition` swallows the click on a summary link with JavaScript disabled — silently,
 * so the person simply finds that nothing happens; there is none on these pages and none may
 * be added. And a message that appears on `focusout` can swallow the click that caused it,
 * which is the other half of the container rule above.
 *
 * @param fields Every field the form has, **in the order they appear on it**, paired with its
 *   error or `undefined`. The order is what makes the summary read down the page rather than
 *   in whatever order an object happens to enumerate — the same reason `NN_ENTRY_FIELDS` is
 *   walked rather than `Object.keys`.
 * @param takesFocus `false` when a top-level `role="alert"` above it has already claimed the
 *   focus, so that two elements never carry `autofocus` and leave which one wins to tree order.
 */
function errorSummary(
  fields: ReadonlyArray<readonly [id: string, message: string | undefined]>,
  takesFocus = true,
): Html | null {
  const problems = fields.filter(
    (field): field is readonly [string, string] => field[1] !== undefined,
  );

  if (problems.length === 0) {
    return null;
  }

  return html`
    <div
      class="notice notice-bad"
      role="alert"
      tabindex="-1"
      ${takesFocus ? raw('autofocus') : null}
    >
      <h2>There is a problem</h2>
      <ul class="summary-list">
        ${problems.map(([id, message]) => html`<li><a href="#${id}">${message}</a></li>`)}
      </ul>
    </div>
  `;
}

/**
 * The top-level failure — the one that is about the submission rather than about a field.
 *
 * Extracted because it was six identical copies, and because #152 gave it a second parameter:
 * it may no longer claim the focus unconditionally, or a page with both a message and a field
 * summary would have two `autofocus` elements and leave the outcome to tree order.
 */
function problemNotice(message: string | null, takesFocus = true): Html | null {
  return message === null
    ? null
    : html`<div
        class="notice notice-bad"
        role="alert"
        tabindex="-1"
        ${takesFocus ? raw('autofocus') : null}
      >
        <p>${message}</p>
      </div>`;
}

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
/**
 * @param id What the error summary links to. A `div` is not focusable, so it carries
 *   `tabindex="-1"` — without it the jump scrolls the widget into view but leaves focus at the
 *   top of the document, which is the half of "go to the problem" that a screen reader needs.
 *   `/account/sign-in/` has two of these on one page, which is why it is a parameter.
 */
function turnstile(
  siteKey: string,
  error: string | undefined,
  includeScript = true,
  id = 'account-captcha',
): Html {
  return html`
    <div class="field account-captcha" id="${id}" tabindex="-1">
      ${
        error !== undefined
          ? html`<p class="field-error" id="${id}-error">${error}</p>`
          : null
      }
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
        ${siteBanner()}
        <!-- Every page this shell renders is under ACCOUNT_PREFIX, so the current-section
             marker is constant. Threading a pathname through thirty call sites to compute a
             value that cannot vary would be a parameter nobody could get right. -->
        ${siteNav(ACCOUNT_PREFIX)} ${body} ${siteFooter()}
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

// -----------------------------------------------------------------------------------------
// /account/entries/
// -----------------------------------------------------------------------------------------

/**
 * Every race entry this person has, and what the club has recorded about each.
 *
 * ## Why this page exists
 *
 * Until it did, somebody who paid £18 had a web page they could close and a Stripe receipt for
 * a charge from an entity they may not recognise. The confirmation email is #73 and is not
 * this; **this is the durable record that does not depend on mail being delivered at all**,
 * which matters on a free tier with a hundred-a-day account-wide cap and a rush of entries on
 * the day the window opens.
 *
 * ## An account is not required to enter, and is never created by entering
 *
 * So most entries have no account attached when they are made. `entries.my_entries()` matches
 * two ways — `person_id`, set when the buyer happened to be signed in, and a `purchaser_email`
 * equal to the caller's **confirmed** address. The second is the one that does the work: a
 * runner who entered signed-out and registers afterwards with the same address finds their
 * entry here without anybody linking anything by hand.
 *
 * The consequence worth stating is that this page can be empty for somebody who *has* entered:
 * they used a different address. So the empty state says that rather than "you have no
 * entries", and gives the club's address.
 *
 * ## What is not here
 *
 * No medical note, no emergency contact, no date of birth, no England Athletics number, no
 * Stripe reference. `entries.my_entries()` does not return them — they are dropped in the
 * database rather than filtered here, which is the same rule the entry form applies to
 * sensitive fields at the boundary. A read that fetched them and trimmed them in TypeScript
 * would be one refactor away from not trimming them.
 *
 * ## What it may say about money
 *
 * **No state makes a negative claim.** `entryStatusWording` in `packages/shared` owns the four
 * sentences and is unit-tested on its own, because the wording is where the risk is: telling
 * somebody nothing was charged when the webhook is merely late is how a person pays twice.
 */
/**
 * `POST /account/entries/` — somebody asking the club to do something with their own entry.
 *
 * ## What it is not
 *
 * **It does not cancel anything and it does not transfer anything.** It writes one word and a
 * timestamp against a purchase the caller owns. Cancelling is `entries.cancel_entry()`, behind
 * `nn.entry.cancel`, and a volunteer presses it; transferring has no implementation at all,
 * because whether this club transfers a place is a decision nobody has taken — CLAUDE.md keeps
 * transfers on the stop-and-ask list, and a request is not a transfer.
 *
 * ## Post, redirect, get
 *
 * The answer comes back as a query parameter on a 303 rather than as a rendered page, so a
 * refresh cannot re-send the request and the back button behaves. **The redirect is the whole
 * error handling**: there is no partial state to preserve, because there is no form to refill.
 *
 * ## The purchase id in the body is not what authorises this
 *
 * It names a row and nothing else. `entries.request_entry_action()` re-derives ownership from
 * `auth.uid()` and the caller's confirmed address — the same predicate `my_entries()` uses — so
 * a reference somebody has seen on a confirmation page cannot be used to touch a stranger's
 * race. The Worker passes the id through and trusts none of it.
 */
async function requestOnEntry(
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
    return redirectTo('/account/entries/?problem=1', secure, refreshedCookies);
  }

  const purchaseId = readString(form, 'purchaseId');
  const action = readString(form, 'action');

  if (purchaseId === '' || (action !== 'cancel' && action !== 'transfer')) {
    return redirectTo('/account/entries/?problem=1', secure, refreshedCookies);
  }

  // **Trimmed here and normalised again in the database.** The ceiling is the column's own
  // check constraint; this is the form's control, and refusing before the round trip is what
  // lets the page say which of two different things went wrong.
  const reason = readString(form, 'reason').trim();

  if (reason.length > ENTRY_REQUEST_REASON_MAX_LENGTH) {
    return redirectTo('/account/entries/?problem=reason', secure, refreshedCookies);
  }

  const outcome = await requestEntryAction(createUserClient(cfg, session.accessToken), {
    purchaseId,
    action,
    reason: reason === '' ? null : reason,
  });

  if (!outcome.ok) {
    // **The reason is logged and never shown.** `no_such_entry` covers "not yours" as well as
    // "not there", and echoing it back would turn the page into an oracle for whether a
    // reference names somebody else's paid entry.
    console.error(`entries.request_entry_action refused — ${outcome.error}`);

    // **One exception, and it is not about this person's entry at all.** The database has not
    // got the function this build is calling, which means a deploy landed ahead of its
    // migration. Telling somebody to "try again in a moment" then sends them round a loop that
    // can never end — so the page says the club has been told instead. Nothing is disclosed:
    // it is a fact about the site, not about any entry. See 29 August 2026.
    return redirectTo(
      outcome.cause === 'missing-function'
        ? '/account/entries/?problem=stale'
        : '/account/entries/?problem=1',
      secure,
      refreshedCookies,
    );
  }

  return redirectTo(
    `/account/entries/?asked=${outcome.action}`,
    secure,
    refreshedCookies,
  );
}

async function entriesPage(
  session: Session | null,
  cfg: SupabaseConfig,
  secure: boolean,
  refreshedCookies: string[],
  url: URL,
): Promise<Response> {
  if (session === null) {
    return redirectTo('/account/sign-in/', secure, refreshedCookies);
  }

  const result = await fetchMyEntries(createUserClient(cfg, session.accessToken));

  if (!result.ok) {
    // A code and a message, never a row. **And the page does not guess**: an unreadable answer
    // is said to be unreadable rather than rendered as an empty list, because an empty list is
    // a claim — "you have no entries" — and this is not in a position to make it.
    console.error(`entries.my_entries unavailable — ${result.error}`);

    return page(
      'Your entries',
      html`
        <main class="account-page">
          <h1>Your entries</h1>
          <p class="notice">
            The club cannot reach its entry records at the moment, so this page cannot
            show them. Nothing has changed about any entry you hold. Please try again
            shortly.
          </p>
          <p><a href="/account/">Back to your account</a></p>
        </main>
      `,
      { status: 503, secure, cookies: refreshedCookies },
    );
  }

  /**
   * **Demoted rather than hidden, and the difference is somebody paying twice.**
   *
   * A confirmed place is what somebody comes here to see, and a list led by lapsed attempts
   * buries it. But hiding the rest outright would show an **empty page** to the one person who
   * must not see one: somebody whose payment succeeded while the webhook was late. They would
   * conclude nothing was taken, and the next thing they would do is enter again.
   *
   * That is the same rule `/nn/<year>/entry/complete/` is built on — no state may make a
   * negative claim — applied to a list rather than to a page. Below the fold, quieter, and
   * still there.
   */
  const confirmed = result.entries.filter((entry) => entry.status === 'paid');

  /**
   * **Cancelled entries have a view of their own, reached by a query parameter.** #148,
   * finding 4.
   *
   * Before this they were invisible to anybody still holding another place: the rule below
   * shows non-confirmed entries only when there are *no* confirmed ones, so a runner who
   * cancelled one entry and kept another had no record of the cancellation on the club's site
   * at all — and, until the same change fixed the £0 wording, possibly none in their inbox
   * either.
   *
   * **A URL filter rather than tabs or a second page**, which is the reasoning `/admin/nn/`'s
   * filters were built on: it keeps working with scripting off, which everything else in this
   * area does, and a filtered view becomes a URL somebody can send — which matters when a
   * volunteer is helping a runner work out what happened to their entry.
   *
   * **Anything that is not `cancelled` is the open view**, rather than a third state or an
   * error. A URL somebody has edited or a stale link must not produce an empty list, which on
   * this page reads as "nothing was taken" and is how somebody comes to pay twice.
   */
  const view = url.searchParams.get('show') === 'cancelled' ? 'cancelled' : 'open';

  const cancelled = result.entries.filter((entry) => entry.status === 'refunded');

  /**
   * **Shown only when there is no confirmed place to show, and that exception is the design.**
   *
   * A lapsed attempt sitting beside a real ticket makes the page look broken, so once somebody
   * holds a place it is the only thing they see. But hiding these *unconditionally* would show
   * an **empty page** to the one person who must not get one: somebody whose payment succeeded
   * while the webhook was late. They would read an empty page as nothing having been taken, and
   * the next thing they would do is pay again.
   *
   * So the rule is "only successful tickets, unless there are none" — clean in every case where
   * a runner has a ticket, and never silent in the case where they might have paid for one.
   *
   * Same rule as `/nn/<year>/entry/complete/`, which may not make a negative claim either,
   * applied to a list rather than to a page.
   *
   * **`refunded` came out of this list when Cancelled became a view of its own**, and the two
   * must not be merged back together. A lapsed hold is not a cancellation, and filing it under
   * Cancelled would break the negative-claim rule in the most expensive direction — telling
   * somebody their place was cancelled when it may in fact have been paid for while the webhook
   * was late. It is not a third view either: `pending` and `expired` are what is left here, and
   * they keep exactly the rule above, underneath whichever view is open.
   */
  const unconfirmed =
    confirmed.length > 0
      ? []
      : result.entries.filter(
          (entry) => entry.status === 'pending' || entry.status === 'expired',
        );

  /**
   * **A token per render, and the cookie that pairs with it.** The two buttons on each card are
   * POSTs that change a record, so they need the same protection every other write in this area
   * has — a request triggered from another origin must not be able to lodge a cancellation
   * against somebody's race.
   */
  const csrfToken = mintCsrfToken();

  // Post/redirect/get: the outcome arrives as a query parameter so a refresh does not re-send
  // the request, and so the answer survives the redirect that stops it being re-sent.
  const asked = url.searchParams.get('asked');
  const problem = url.searchParams.get('problem') === '1';
  // **Its own answer rather than the generic one.** "That could not be recorded, try again"
  // is a lie about a reason somebody wrote 900 characters into: trying again does nothing, and
  // the page has to say what to change. Nothing was recorded either way.
  const tooLong = url.searchParams.get('problem') === 'reason';
  // **The site is ahead of its database.** Its own answer for the same reason `tooLong` has
  // one: "try again in a moment" is a lie when nothing a moment brings can help.
  const stale = url.searchParams.get('problem') === 'stale';

  const body = html`
    <main class="account-page">
      <h1>Your entries</h1>
      ${
        asked === 'cancel' || asked === 'transfer'
          ? html`<p class="account-note" role="status">
              <strong>The club has your request.</strong>
              ${
                asked === 'cancel'
                  ? 'Somebody will look at cancelling this entry and be in touch.'
                  : 'Somebody will be in touch about transferring this place. The club can move a place to a different runner — no money changes hands either way, so anything owed between the two of you is between the two of you.'
              }
              Your place is unchanged until they have.
            </p>`
          : null
      }
      ${
        problem
          ? html`<p class="account-note" role="alert">
              <strong>That could not be recorded just now.</strong> Nothing has changed.
              Please try again in a moment, or email the club and somebody will sort it
              out.
            </p>`
          : null
      }
      ${
        stale
          ? html`<p class="account-note" role="alert">
              <strong>The club’s site cannot record that at the moment.</strong> Nothing
              has changed and your place is unaffected. This is a fault at the club’s end
              rather than anything about your entry, and
              <strong>trying again will not help</strong> — please email the club and
              somebody will sort it out.
            </p>`
          : null
      }
      ${
        tooLong
          ? html`<p class="account-note" role="alert">
              <strong>That was too long to record.</strong> Nothing has changed. There is
              room for ${String(ENTRY_REQUEST_REASON_MAX_LENGTH)} characters — shorten
              what you wrote and ask again, and somebody will come back to you for the
              rest.
            </p>`
          : null
      }
      ${
        result.entries.length === 0
          ? html`<p>
                Nothing is showing here yet. An entry appears once it is matched to this
                account — either because you were signed in when you entered, or because
                you entered with this email address and have confirmed it.
              </p>
              <p>
                If you have entered a race with a different address and want it moved onto
                this account, get in touch and the club will sort it out.
              </p>`
          : html`${entriesViews(view)}
            ${
              view === 'cancelled'
                ? html`${
                    cancelled.length === 0
                      ? // **"Nothing here", and never "you have never cancelled an entry".**
                        // The second is a claim about a record, and a record that can be
                        // hidden by anything must not have claims made about it — the same
                        // rule that governs every status sentence on this page.
                        html`<p>Nothing here.</p>`
                      : // **No token, so no form.** There is nothing to ask the club about an
                        // entry it has already cancelled and refunded, and passing null is
                        // what makes that structural rather than a rule somebody remembers.
                        cancelled.map((entry) => entryCard(entry, false, null))
                  }`
                : html`${confirmed.map((entry) => entryCard(entry, false, csrfToken))}
                  ${
                    confirmed.length === 0 && unconfirmed.length === 0
                      ? html`<p>Nothing here.</p>`
                      : null
                  }`
            }
            ${
              /* **Underneath whichever view is open, and that is the decision rather than a
              convenience.** A lapsed hold is neither open nor cancelled, and making it a third
              view — or filing it under Cancelled — would tell somebody their place was
              cancelled when it may in fact have been paid for while the webhook was late.

              So it keeps exactly today's rule, on both views: shown only when there are no
              confirmed places. The reason it may not simply be hidden is the same one it has
              always been — somebody whose payment succeeded and whose webhook was late must
              not meet an empty page, because the next thing they do is pay again. That has to
              hold on `?show=cancelled` too, which is an address somebody can be sent. */ null
            }
            ${
              unconfirmed.length === 0
                ? null
                : html`<p class="account-note">
                      The club has not recorded a confirmed place for you yet. What it
                      does have is below — <strong>read it before entering again</strong>,
                      because a payment can reach the club after the page that took it has
                      given up.
                    </p>
                    ${unconfirmed.map((entry) => entryCard(entry, true))}`
            }`
      }
      <p><a href="/account/">Back to your account</a></p>
    </main>
  `;

  return page('Your entries', body, {
    secure,
    cookies: [...refreshedCookies, csrfCookie(csrfToken, secure)],
  });
}

/**
 * The two views, as links.
 *
 * **Links and a query parameter, not tabs and not two pages.** No JavaScript, no
 * `role="tablist"` to keep in step with a keyboard, and the address bar carries which view is
 * open — so a runner can send a volunteer the exact thing they are looking at. That is the
 * same reasoning `/admin/nn/`'s filters were built on.
 *
 * **`aria-current="page"` on the one that is open**, and it is still a link rather than a
 * disabled span: pressing it re-renders the same view, which is what somebody expects and is
 * one less state to get wrong. The open view is `/account/entries/` with no parameter at all
 * rather than `?show=open`, so the plain address stays the plain address and nothing has to
 * decide which of two spellings is canonical.
 */
function entriesViews(current: 'open' | 'cancelled'): Html {
  return html`<nav class="account-views" aria-label="Which entries to show">
    <a
      href="/account/entries/"
      aria-current="${current === 'open' ? 'page' : ''}"
      class="${current === 'open' ? 'account-view-current' : ''}"
      >Open race entries</a
    >
    <a
      href="/account/entries/?show=cancelled"
      aria-current="${current === 'cancelled' ? 'page' : ''}"
      class="${current === 'cancelled' ? 'account-view-current' : ''}"
      >Cancelled race entries</a
    >
  </nav>`;
}

/**
 * One entry.
 *
 * **The runner's name is shown and the purchaser's is not**, unless they differ — one person
 * entering themselves sees their name once, and somebody who entered on behalf of another sees
 * both, which is the only case where the distinction carries information.
 */
/**
 * Every ask this person has made about one entry, newest first.
 *
 * **The history where there is one, the summary where there is not.** `requests` is empty on a
 * database deployed before the history table, and on one deployed after it is the whole truth;
 * `requestedAction` is the single word the purchase row has always carried. Falling back keeps
 * this card rendering through a deploy that has landed ahead of its migration, which is a state
 * this repository deliberately tolerates and therefore keeps entering.
 *
 * **`requestedAt` is faked as `createdAt` in the fallback and that is fine**, because nothing
 * on this card renders the time of an ask — only its order, and a list of one has none.
 *
 * ⚠️ **This fallback was a live disclosure path and is now closed at the source.** #148's first
 * finding: `transfer_entry()` clears `requested_action` and deliberately keeps `request_reason`
 * — the record of why the place moved — so on a transferred entry the summary columns described
 * the *previous* runner. The fallback rendered nothing anyway, but only because it is keyed on
 * `requestedAction`, which that function happens to clear. **Luck, not design**, and one future
 * path resolving an ask without clearing that column would have brought a stranger's 500
 * characters back through this door.
 *
 * `entries.my_entries()` now derives all four request keys — the list *and* the three summary
 * fields — from the asks the caller owns, so neither branch of this function can be handed
 * somebody else's words. The fallback stays because it is still doing its original job: keeping
 * this card rendering against a database deployed behind this Worker, which is a state this
 * repository deliberately tolerates and therefore keeps entering.
 */
function asksFor(entry: MyEntry): EntryRequest[] {
  if (entry.requests.length > 0) {
    return entry.requests;
  }

  return entry.requestedAction === null
    ? []
    : [
        {
          action: entry.requestedAction,
          reason: entry.requestReason,
          requestedAt: entry.createdAt,
          resolvedAt: entry.requestResolved ? entry.createdAt : null,
        },
      ];
}

function entryCard(entry: MyEntry, quiet = false, csrfToken: string | null = null): Html {
  const runners = entry.entrants
    .map((runner) => `${runner.firstName} ${runner.lastName}`)
    .join(', ');

  const differentPurchaser =
    runners !== '' && runners.toLowerCase() !== entry.purchaserName.toLowerCase();

  return html`<section class="account-card ${quiet ? 'account-card-quiet' : ''}">
    <h2>${entry.eventName}</h2>
    <dl>
      <dt>Date</dt>
      <dd>
        ${formatEventDate(entry.eventDate)}, ${formatEventStartTime(entry.startTime)}
      </dd>

      <dt>${entry.entrants.length > 1 ? 'Runners' : 'Runner'}</dt>
      <dd>
        ${
          runners === ''
            ? // **An entry with no entrant rows is a cancelled one**, because cancelling
              // deletes them. Saying "the entry was cancelled" here would duplicate the
              // status line below and could contradict it, so it says only what it knows.
              'No runner is recorded against this entry.'
            : runners
        }
      </dd>

      ${
        differentPurchaser
          ? html`<dt>Entered by</dt>
              <dd>${entry.purchaserName}</dd>`
          : null
      }

      <dt>Entry type</dt>
      <dd>${entry.feeLabel}, ${formatPence(entry.amountPence)}</dd>

      ${
        /* **The reference, and it is the purchase id rather than a new short code.**

        Somebody emailing the club about an entry has had nothing to name it by except their
        own name, which is not unique and is exactly what a support email is trying to
        establish. This is unique, it already exists, and it is what `/admin/nn/` and the
        Stripe metadata both key on — so a volunteer can find the entry from it without a
        lookup table.

        **It is not a secret and it is not a credential.** It identifies a row; it authorises
        nothing. `entry_completion_state()` returns one word to anybody holding a session id
        for precisely this reason. A shorter, quotable code would be kinder over the phone and
        is a new column, which is a decision rather than a rendering choice — noted in #118. */ null
      }
      <dt>Reference</dt>
      <dd class="account-reference">${entry.purchaseId}</dd>

      <dt>Status</dt>
      <dd>
        ${entryStatusWording(entry.status)}
        ${
          entry.paidAt === null
            ? null
            : // **`formatLondon`, never a bare toLocale call.** ESLint bans those repository
              // wide, and this race is run the weekend after the clocks change.
              html`<br />Paid ${formatLondon(entry.paidAt)}.`
        }
      </dd>

      ${
        /* **Every ask, and not only the most recent one.**

        This used to read one column, which held one word — so somebody who asked about a
        transfer, thought better of it and asked to cancel came back to a page still saying the
        club had a transfer request. That reads exactly like the second press not having
        worked, and the next thing they do is press it again or email the club to ask why.

        `requests` is empty on a database deployed before the history table, which is why the
        summary fields below it are still the fallback: nothing sequences a migration against
        the Cloudflare deploy, and this card has to render either way.

        **"You asked" is only true because the read is now scoped to the asker.** On a
        transferred place this list used to be the previous runner's, addressed in the second
        person to whoever holds the entry now — which is false on its face and, worse, printed
        one runner's free text to another. `my_entries()` filters on the owner stamped on each
        ask; see `asksFor()` above and #148. */ null
      }
      ${asksFor(entry).map(
        (ask, index) =>
          html`<dt>
              ${index === 0 ? 'Asked for' : html`<span class="account-quiet">Before that</span>`}
            </dt>
            <dd>
              ${
                ask.action === 'cancel'
                  ? 'You asked the club to cancel this entry.'
                  : 'You asked the club about transferring this place.'
              }
              ${
                ask.resolvedAt === null
                  ? 'Nothing has changed yet — your place is still yours until the club acts.'
                  : 'The club has dealt with it.'
              }
              ${
                /* **Read back rather than merely stored.** Somebody who has explained a
                broken ankle to a form has no other way of knowing the club received the
                explanation and not just the button press. */ null
              }
              ${
                ask.reason === null
                  ? null
                  : html`<br /><span class="account-quiet"
                        >You told the club: ${ask.reason}</span
                      >`
              }
            </dd>`,
      )}
    </dl>

    ${
      /* **Only on a confirmed place, and only with a token.** There is nothing to ask about an
      entry the club has not recorded a place for, and the quiet cards below the fold are
      exactly those. `csrfToken` is null for them, which is what makes that structural rather
      than a rule somebody has to remember.

      **Both are asks and the copy says so.** Cancelling has an answer in the admin surface;
      transferring does not — whether this club transfers a place at all is undecided, and a
      button implying otherwise would be the page making a promise the committee has not.

      **The reason box is shared by both buttons and is one form.** Two forms would mean two
      textareas, and somebody typing into one and pressing the other button would lose what they
      wrote with nothing on screen explaining why. `name="action"` on the submit buttons is what
      carries which of the two was pressed, and it needs no JavaScript to do it. */ null
    }
    ${
      csrfToken === null
        ? null
        : html`<form method="post" action="/account/entries/" class="account-actions">
            <input type="hidden" name="${raw(CSRF_FIELD)}" value="${csrfToken}" />
            <input type="hidden" name="purchaseId" value="${entry.purchaseId}" />

            <h3 class="account-actions-heading">Ask the club about this entry</h3>

            ${
              /* **Said before the box rather than after the button.** Somebody about to ask
              for their money back should know what the club's position is while they are
              deciding what to write, not on a confirmation page afterwards. It says the
              honest thing — the club would rather not, and will look anyway — because a page
              that promised refunds would be making a commitment nobody has made, and one that
              refused them outright would be wrong about what the club actually does. */ null
            }
            <p class="account-note">
              <strong>Refunds are not the club's first answer.</strong> The place is paid
              for, the field has one fewer runner in it, and the card fee on the original
              payment does not come back to the club. Every request is looked at on its
              own facts and the club will do what is fair — so please say what has
              happened.
            </p>

            <div class="field">
              <label class="field-label" for="reason-${entry.purchaseId}">
                Why are you asking? (optional)
              </label>
              <textarea
                class="field-input"
                id="reason-${entry.purchaseId}"
                name="reason"
                rows="3"
                maxlength="${String(ENTRY_REQUEST_REASON_MAX_LENGTH)}"
              ></textarea>
            </div>

            <div class="account-action-buttons">
              <button type="submit" name="action" value="cancel" class="account-linkish">
                Ask to cancel this entry
              </button>
              <button
                type="submit"
                name="action"
                value="transfer"
                class="account-linkish"
              >
                Ask about transferring it
              </button>
            </div>
          </form>`
    }
  </section>`;
}
