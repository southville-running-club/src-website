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

/**
 * **What the free tier will not accept, asserted before a merge finds out.**
 *
 * With the default email provider in use, Supabase's management API refuses *every*
 * email-template modification:
 *
 *     unexpected status 400: {"message":"Email template modification is not available for
 *     free tier projects using the default email provider. Please upgrade your plan or
 *     configure a custom SMTP provider."}
 *
 * A `[auth.email.template.*]` subject or body is one. So is a
 * `[auth.email.notification.*]` switch, which the CLI sends with a `subject` of its own —
 * that is how #54's password-changed notification broke the deploy, in issue #79.
 *
 * **And it fails the whole file, not the line.** `config push` sends one request per
 * service; a rejected `[auth]` takes `site_url`, the redirect allowlist, `enable_signup`
 * and the captcha secret down with it, while `db push` — which runs first — goes on
 * succeeding. Nothing else in the pipeline reports that half of a deploy is missing, so
 * this is the guard: milliseconds, no Docker, on every branch.
 *
 * #50 (Resend over SMTP) is what lifts the restriction. Nothing else does — upgrading the
 * plan is the other half of the API's own sentence and is not the club's plan.
 */
describe('email templates, and the provider that forbids them', () => {
  /** Every uncommented `[section]` in the file, with the uncommented lines under it. */
  function sections(): { name: string; body: string[] }[] {
    const found: { name: string; body: string[] }[] = [];
    for (const line of CONFIG.split('\n')) {
      const header = /^\[([^\]]+)\]$/.exec(line.trim());
      if (header?.[1]) found.push({ name: header[1], body: [] });
      else if (!line.trim().startsWith('#')) found.at(-1)?.body.push(line.trim());
    }
    return found;
  }

  function enabled(body: string[]): boolean {
    return body.some((line) => /^enabled\s*=\s*true$/.test(line));
  }

  /** `[auth.email.smtp] enabled = true` — the thing that makes a template pushable. */
  function customSmtp(): boolean {
    const smtp = sections().find((section) => section.name === 'auth.email.smtp');
    return smtp !== undefined && enabled(smtp.body);
  }

  /**
   * Every email-template block that is **present at all**, enabled or not.
   *
   * **It used to ask whether the block was enabled, and that was the bug.** `enabled =
   * false` was the first attempt at #79 and the deploy went on failing: the CLI serialises
   * one of these sections whenever it is *present*, filling in the `subject` it was not
   * given, so `config push` sent `subject = ""` against production's real subject — and an
   * empty subject is still a template modification. The block being there is the hazard;
   * what it says inside is not the part the API objects to.
   *
   * So presence is what is asserted, which is also the state the CLI itself ships: every
   * one of these arrived commented out.
   */
  function templateModifications(): string[] {
    return sections()
      .filter((section) => /^auth\.email\.(template|notification)\./.test(section.name))
      .map((section) => section.name);
  }

  it('is on a custom email provider, which is what #50 changed', () => {
    // **This assertion was `toBe(false)` until #50**, and it was written to go red on
    // exactly this change rather than to be deleted by it: the guard below goes quiet the
    // moment a custom provider exists — correctly, because the restriction lifts with it —
    // and a guard that can go quiet needs something that fails loudly when its premise
    // moves. It moved. So this now asserts the premise in the other direction, and it is
    // still the thing that fails if somebody re-comments `[auth.email.smtp]` without
    // reinstating the template guard alongside it.
    expect(customSmtp()).toBe(true);
  });

  it('declares no email template block at all while on the default provider', () => {
    // **Uncommenting one of these is what fails here** — not enabling it. #79's first fix
    // set `[auth.email.notification.password_changed]` to `enabled = false` and left the
    // section in the file, this test passed, and the deploy failed twice more on `main`
    // with the same 400. Commenting the section out is the known-good state, because it is
    // the state the CLI shipped and the one every green deploy before #76 ran on.
    //
    // ⚠️ **Dormant since #50, and deliberately kept rather than deleted.** The custom
    // provider lifts the restriction, so this now short-circuits to `[]` and cannot fail —
    // which is the one shape this repository treats as worse than a missing test, because
    // the line still looks like coverage. It stays because it is the guard that comes back
    // on its own the day somebody re-comments `[auth.email.smtp]`: a rollback of #50 that
    // left a template block behind would otherwise ship the exact 400 that took production
    // down for four deploys. The assertion above is what keeps this honest — it fails
    // loudly whenever this one goes quiet for a reason nobody intended.
    expect(customSmtp() ? [] : templateModifications()).toEqual([]);
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
