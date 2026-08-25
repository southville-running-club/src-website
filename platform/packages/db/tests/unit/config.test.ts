import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The exposed-schema list, asserted directly.
 *
 * **One file governs three environments**, which is the property worth protecting:
 *
 *   local        `supabase start` reads config.toml into the Docker containers
 *   branch CI    `supabase start` in Actions does the same
 *   production   `deploy-db.yml` runs `supabase config push` on merge to main
 *
 * So a schema exposed here is exposed everywhere, and a schema missing here is missing
 * everywhere. That alignment is the whole argument for keeping it in the repository rather
 * than a dashboard.
 *
 * The database tests already catch a mistake here *by its effect* — an exposed `club` would
 * stop returning `PGRST106`. This one catches it at the source, in milliseconds, with no
 * Docker running, and says plainly what the rule is.
 */

const CONFIG = readFileSync(
  join(import.meta.dirname, '..', '..', 'supabase', 'config.toml'),
  'utf8',
);

/** The `schemas = [...]` line under `[api]`. */
function exposedSchemas(): string[] {
  const match = /^schemas\s*=\s*\[(.+)\]/m.exec(CONFIG);
  if (!match?.[1]) throw new Error('config.toml has no [api] schemas list');
  return match[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
}

describe('what the Data API can route to', () => {
  it('exposes intake, because a public form has to reach it', () => {
    expect(exposedSchemas()).toContain('intake');
  });

  it('**never exposes club**', () => {
    // This is the assertion that matters, and it is a second lock rather than the only
    // one: `club` also has no grants. But grants are easy to get wrong in a migration
    // written at speed, and this list is the thing that makes such a mistake unreachable.
    //
    // `club` will hold the membership list. Adding it here is a decision for a pull
    // request that explains itself, not a convenience — if this test is failing because
    // somebody added it, that is the test doing its job.
    expect(exposedSchemas()).not.toContain('club');
  });

  it('exposes entries, for one function and nothing else', () => {
    // `entries` is routable so that `/nn/` can call `entries.entry_state()` and find out
    // whether entries are open — the switch between the entry form and the interest form,
    // driven by an event row rather than by a deploy.
    //
    // **Exposing it routes its tables too, and that is safe rather than overlooked.** Every
    // table in the schema has RLS on from its first migration and the anon role holds no
    // grant on any of them, so PostgREST reaches Postgres and Postgres answers `42501`.
    // `tests/entries.test.ts` asserts exactly that, on all six, by error code. This list
    // being routable is what makes those assertions meaningful instead of vacuous — a
    // refusal that only happens because nothing can get as far as asking is not a refusal
    // that has been tested.
    expect(exposedSchemas()).toContain('entries');
  });

  it('exposes identity, for the account and role — never club', () => {
    // ADR-015: a profile has to be readable by its owner through PostgREST, so its schema
    // has to be exposed. `club` stays exactly as unexposed as ADR-002 left it.
    expect(exposedSchemas()).toContain('identity');
  });

  it('exposes nothing beyond public, graphql_public, intake, entries and identity', () => {
    // Deliberately exact rather than a subset check. A schema arriving on this list
    // silently is precisely the failure this file exists to prevent.
    expect(exposedSchemas().sort()).toEqual([
      'entries',
      'graphql_public',
      'identity',
      'intake',
      'public',
    ]);
  });
});

/**
 * The `[auth]` block, asserted for the same reason as the schema list: `deploy-db.yml`
 * pushes this **whole file** to production on every merge that touches a migration, so
 * whatever is committed here is not a local setting — it is what production runs with
 * from the next merge onward.
 *
 * `site_url` and `additional_redirect_urls` are what a Supabase Auth magic link is built
 * from. The CLI's own scaffolded default is `http://127.0.0.1:3000` — harmless while
 * nothing uses auth, and a silent production outage the moment
 * [ADR-008](../../../../docs/architecture/decisions/adr-008-timing-port-before-the-race.md)'s
 * port lands and somebody clicks a sign-in email. This is the guard that keeps a reverted
 * or freshly-scaffolded `config.toml` from shipping that placeholder again.
 */
function authConfig(): { key: string; value: string }[] {
  const lines = CONFIG.split('\n');
  const authStart = lines.findIndex((line) => line.trim() === '[auth]');
  if (authStart === -1) throw new Error('config.toml has no [auth] section');
  const nextSection = lines.findIndex(
    (line, i) => i > authStart && /^\[/.test(line.trim()),
  );
  const block = lines.slice(authStart, nextSection === -1 ? undefined : nextSection);

  return block
    .map((line) => /^(\w+)\s*=\s*(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ key: match[1]!, value: match[2]! }));
}

function authValue(key: string): string {
  const found = authConfig().find((entry) => entry.key === key);
  if (!found) throw new Error(`config.toml [auth] has no ${key}`);
  return found.value;
}

describe('the auth block that ships to production on every migration merge', () => {
  it('site_url is the club hostname, not the CLI placeholder', () => {
    // Not 127.0.0.1, not localhost, not port 3000 — the exact failure mode this test
    // exists to catch is the scaffolded default surviving into a committed file.
    expect(authValue('site_url')).toBe('"https://new.southvillerunningclub.co.uk"');
  });

  it('the redirect allowlist includes the production hostname', () => {
    expect(authValue('additional_redirect_urls')).toContain(
      'https://new.southvillerunningclub.co.uk',
    );
  });

  it('signup is open, decided by decision 005 and ADR-015', () => {
    // The anon key is public, so an open signup endpoint is reachable by anyone who can
    // see the client bundle — independent of RLS. That used to be the reason this stayed
    // closed; it is now safe because RLS, not this flag, is what stops a signed-up
    // account doing anything.
    expect(authValue('enabled')).toBe('true');
    expect(authValue('enable_signup')).toBe('true');
  });

  it('a password has to be twelve characters, and no composition rule is imposed', () => {
    // Length over composition rules — NCSC and NIST both advise against the latter, which
    // pushes people towards `Password1!` and a sticky note rather than a stronger password.
    expect(authValue('minimum_password_length')).toBe('12');
    expect(authValue('password_requirements')).toBe('""');
  });
});

describe('the auth.email block', () => {
  function emailConfig(): { key: string; value: string }[] {
    const lines = CONFIG.split('\n');
    const start = lines.findIndex((line) => line.trim() === '[auth.email]');
    if (start === -1) throw new Error('config.toml has no [auth.email] section');
    const nextSection = lines.findIndex(
      (line, i) => i > start && /^\[/.test(line.trim()),
    );
    const block = lines.slice(start, nextSection === -1 ? undefined : nextSection);

    return block
      .map((line) => /^(\w+)\s*=\s*(.+)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ key: match[1]!, value: match[2]! }));
  }

  function emailValue(key: string): string {
    const found = emailConfig().find((entry) => entry.key === key);
    if (!found) throw new Error(`config.toml [auth.email] has no ${key}`);
    return found.value;
  }

  it('requires a confirmed address before signing in', () => {
    // Without this, an unverified address is a signed-in account, and anybody can
    // register somebody else's email.
    expect(emailValue('enable_confirmations')).toBe('true');
  });

  it('requires reauthentication before a password change', () => {
    expect(emailValue('secure_password_change')).toBe('true');
  });
});

/**
 * The `[auth.rate_limit]` block — #64.
 *
 * These used to be the CLI's defaults, and the reason to assert them now is that **a
 * default and a decision look identical in a TOML file**. Each value below is argued in a
 * comment beside it in `config.toml`; this is what stops a later `supabase init`, a revert,
 * or a "tidy up the config" pass putting the defaults back without anybody noticing that a
 * deliberate number has gone.
 *
 * The argument they mostly share: **"per IP address" is not the runner's IP address.**
 * Every GoTrue call the account area makes is made from the Worker, so a per-IP limit is a
 * project-wide limit, and a number that reads as tight for one attacker is a cap on the
 * whole club. The per-person limiting is Cloudflare's, recorded in
 * [the WAF rules](../../../../../docs/reference/cloudflare-waf-rules.md).
 *
 * A generic section reader, rather than a fourth copy of the closure each block above
 * carries. Those are left alone deliberately — this file is one change at a time too.
 */
function sectionValue(section: string, key: string): string {
  const lines = CONFIG.split('\n');
  const start = lines.findIndex((line) => line.trim() === section);
  if (start === -1) throw new Error(`config.toml has no ${section} section`);
  const nextSection = lines.findIndex((line, i) => i > start && /^\[/.test(line.trim()));
  const found = lines
    .slice(start, nextSection === -1 ? undefined : nextSection)
    .map((line) => /^(\w+)\s*=\s*(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .find((match) => match[1] === key);

  if (!found) throw new Error(`config.toml ${section} has no ${key}`);
  return found[2]!;
}

describe('the auth.rate_limit block, chosen rather than defaulted', () => {
  function rateLimit(key: string): string {
    return sectionValue('[auth.rate_limit]', key);
  }

  it('allows sixty account emails an hour, for the day Resend makes this the real cap', () => {
    // Per project, not per IP — Supabase documents it as a project limit whatever the CLI's
    // own comment beside it says. Two is the free tier's built-in cap and shadows this
    // today; #50 is the day it stops being shadowed. The failure mode of a number set too
    // low is silent: the person never receives the mail and sees no error at all.
    expect(rateLimit('email_sent')).toBe('60');
  });

  it('floors the three limits whose features are switched off', () => {
    // SMS, anonymous sign-ins and Web3 are off at every switch that could reach them, so
    // none of these is reachable. The floor is what makes a switch flipped by mistake cost
    // one request rather than thirty. Not zero, which a Go rate limiter is liable to read
    // as "no limit".
    expect(rateLimit('sms_sent')).toBe('1');
    expect(rateLimit('anonymous_users')).toBe('1');
    expect(rateLimit('web3')).toBe('1');
  });

  it('raises token_refresh well above the synchronised hourly burst', () => {
    // `worker/session.ts` refreshes from the Worker, so every signed-in person counts
    // against one address — and `jwt_expiry` being an hour means the refreshes arrive
    // together: everybody who signed in as entries opened comes back in the same minute an
    // hour later. Being refused a refresh means being signed out, plausibly mid-entry.
    expect(rateLimit('token_refresh')).toBe('600');
  });

  it('raises sign_in_sign_ups, because behind the Worker it is a club-wide cap', () => {
    // The value most likely to be "corrected" downwards by somebody reading it as a
    // credential-stuffing control. It is not one: thirty in five minutes is thirty for the
    // *whole club*, about one sign-in every ten seconds shared between everybody, which the
    // morning entries open would reach on legitimate traffic alone — and GoTrue's refusal
    // reads to somebody with the right password as the site being broken.
    //
    // Stuffing is answered by the WAF rule on `POST /account/sign-in/`, and by Turnstile on
    // the form. What is left for this layer is a project-wide ceiling of one a second.
    expect(rateLimit('sign_in_sign_ups')).toBe('300');
  });

  it('lowers token_verifications, the one value that is genuinely per person', () => {
    // A confirmation, reset or magic link points at GoTrue's own `/auth/v1/verify` and the
    // browser follows it directly — the Worker is not in that path, so the address counted
    // is the person's own. It is also what an OTP guess attacks: `otp_length` is 6, so
    // thirty per five minutes is 8,640 attempts a day from one address, and ten is 2,880.
    //
    // **Revisit if a PKCE code exchange ever moves into the Worker** (#55, #56): this value
    // would go back behind the proxy, where ten would be ten for everybody.
    expect(rateLimit('token_verifications')).toBe('10');
    expect(sectionValue('[auth.email]', 'otp_length')).toBe('6');
  });
});

describe('the auth.captcha block', () => {
  function captchaConfig(): { key: string; value: string }[] {
    const lines = CONFIG.split('\n');
    const start = lines.findIndex((line) => line.trim() === '[auth.captcha]');
    if (start === -1) throw new Error('config.toml has no [auth.captcha] section');
    const nextSection = lines.findIndex(
      (line, i) => i > start && /^\[/.test(line.trim()),
    );
    const block = lines.slice(start, nextSection === -1 ? undefined : nextSection);

    return block
      .map((line) => /^(\w+)\s*=\s*(.+)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ key: match[1]!, value: match[2]! }));
  }

  function captchaValue(key: string): string {
    const found = captchaConfig().find((entry) => entry.key === key);
    if (!found) throw new Error(`config.toml [auth.captcha] has no ${key}`);
    return found.value;
  }

  it('is Turnstile, enabled, with the secret read from the environment', () => {
    // Never a literal secret in the repository. `env(...)` substitution means the value
    // comes from wherever `supabase config push`/`supabase start` runs, never from this
    // file — the club's real secret in production, Cloudflare's own published testing
    // secret locally and in CI (see `dev` and `ci.yml`).
    expect(captchaValue('enabled')).toBe('true');
    expect(captchaValue('provider')).toBe('"turnstile"');
    expect(captchaValue('secret')).toBe('"env(SUPABASE_AUTH_CAPTCHA_SECRET)"');
  });
});
