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
 * **As of #50 there is exactly one deliberate exception, and it is worth stating here rather
 * than leaving somebody to find it at the foot of a 900-line file.** `[remotes.production]`
 * overrides `[auth.email.smtp] enabled` to `true` for the linked project only — because
 * production has a real Resend key and a laptop and a runner have a placeholder. Nothing
 * local resolves a remote block: `supabase start` is given no project ref, so `./dev` and CI
 * read the base document exactly as before.
 *
 * **The exception earns its keep by staying one key long.** Every assertion below reads the
 * base document, which is what those two environments actually run; `the production-only
 * override` block at the end is what asserts the difference, and it asserts the *whole* of
 * it. If that list ever grows past one, this comment is wrong and the tests should say so.
 *
 * The database tests already catch a mistake here *by its effect* — an exposed `club` would
 * stop returning `PGRST106`. This one catches it at the source, in milliseconds, with no
 * Docker running, and says plainly what the rule is.
 */

const CONFIG = readFileSync(
  join(import.meta.dirname, '..', '..', 'supabase', 'config.toml'),
  'utf8',
);

const CONFIRMATION_TEMPLATE = readFileSync(
  join(import.meta.dirname, '..', '..', 'supabase', 'templates', 'confirmation.html'),
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
 * `[auth.email.smtp]` — the base block, which is what a laptop and a runner run.
 *
 * The `enabled` half is asserted twice over, here and under the production override at the
 * end of this file, because the two say different things for different reasons and a reader
 * who finds only one of them would draw the wrong conclusion from it.
 */
describe('the sender, and the reply path it does not have', () => {
  it('sends as noreply@ on the sending subdomain, never a human mailbox', () => {
    // **Two separate rules, and the second is the one that gets undone by a tidy-up.**
    //
    // The *domain* is `send.southvillerunningclub.co.uk` because `docs/solutions/email.md`
    // exists to stop programmatic volume touching the reputation of the mailbox the
    // committee reads. Verifying the apex in Resend so mail could go out as `info@` is
    // possible and is exactly the failure that document is about.
    //
    // The *local part* is `noreply@` because **GoTrue has no `reply_to` field at all**, so
    // the `From` is where a reply goes — and it goes to a sending subdomain with no MX,
    // where it bounces. `accounts@`, which this was until #50, reads as a monitored mailbox
    // and is not one: the member has every reason to think somebody will read it, nobody
    // will, and the club is never told it happened. `noreply@` promises nothing it cannot
    // keep, and with only `admin_email` and `sender_name` to work with, the local part is
    // the one place that truth can be told.
    //
    // A working Reply button is #99 — the Send Email Hook, where `reply_to` is a field.
    expect(sectionValue('[auth.email.smtp]', 'admin_email')).toBe(
      '"noreply@send.southvillerunningclub.co.uk"',
    );
  });

  it('never carries the key itself, only a reference to it', () => {
    // Same rule as the captcha secret: the value comes from wherever `config push` runs.
    expect(sectionValue('[auth.email.smtp]', 'pass')).toBe(
      '"env(SUPABASE_AUTH_SMTP_PASSWORD)"',
    );
  });

  it('uses 587 with STARTTLS, because 465 broke CI', () => {
    // Not a preference. The first attempt used 465 with implicit TLS and every `signUp()`
    // in the database tests failed — a number of CI providers block 465 to fight spam.
    expect(sectionValue('[auth.email.smtp]', 'port')).toBe('587');
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

  /**
   * Whether **production** has a custom mail provider — the thing that makes a template
   * pushable at all.
   *
   * ⚠️ **This deliberately reads the remote override as well as the base block, and the
   * distinction is the one thing to understand here.** Those two `enabled` values answer
   * different questions:
   *
   *   base                  does *this machine* dial `smtp.resend.com`? No — CI and laptops
   *                         hold a placeholder key, so `[local_smtp]`'s catcher is used
   *   remotes.production    does the *project the API is judging* have a custom provider?
   *                         Yes, since #50, proven by a real delivery on 26 August 2026
   *
   * #79's restriction is a fact about the second. Asking the first — which is what this did
   * until #101 — would keep every template forbidden forever on the strength of a value that
   * is about something else entirely.
   */
  function customSmtp(): boolean {
    return ['auth.email.smtp', 'remotes.production.auth.email.smtp'].some((name) => {
      const smtp = sections().find((section) => section.name === name);
      return smtp !== undefined && enabled(smtp.body);
    });
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

  it('production has the custom provider that makes a template pushable at all', () => {
    // **This has been `false`, `true`, `false`, and is now `true` for a different reason
    // than last time — and every move was the point rather than churn.** The guard below
    // means nothing without a premise that fails loudly whenever it moves, and this is that
    // premise. It went red when #50 first enabled the base block, red again when #98 turned
    // it off, and red a third time when #50 landed the production override — which is
    // exactly the behaviour wanted from it.
    //
    // **The value it reads changed shape at #101.** It used to ask whether *this file's base
    // block* dials out, which is a question about laptops and CI runners. #79's restriction
    // is a fact about the project the management API is judging, and that is the override.
    // `customSmtp()`'s own comment has the two questions side by side.
    expect(customSmtp()).toBe(true);
  });

  it('declares exactly the email templates that have been argued for', () => {
    // **Not a short-circuit any more, and that matters more than the assertion.** This used
    // to read `customSmtp() ? [] : templateModifications()` — so the moment a custom provider
    // existed it compared `[]` to `[]` and could not fail. That is the shape this repository
    // treats as worse than a missing test, because the line still looks like coverage while
    // testing nothing. #101 is the first change to make a custom provider real, so it is the
    // change that has to fix it.
    //
    // **An exact list instead.** #79's lesson was that *presence* is the hazard, not
    // `enabled` — the CLI serialises a section whenever it is in the file, filling in the
    // `subject` it was not given, which is how `enabled = false` still failed the deploy
    // twice. So the thing to pin is which sections exist, and a new one becomes a decision
    // somebody takes in a diff rather than a line that rides along.
    //
    // ✅ **`confirmation` shipped as a stated risk and the risk paid.** It went onto this list
    // before any deploy had proved the API would accept it — `config push` sends
    // `smtp_enabled` and these fields in one request, and whether the API judged the request
    // against the config arriving or the config already there was unknown. It accepted them
    // together on 26 August 2026, and a real confirmation arrived carrying the club's own
    // hostname. **A template and its provider may travel in one request**, so a second entry
    // here is now an ordinary decision rather than a gamble against #79.
    expect(templateModifications()).toEqual(['auth.email.template.confirmation']);
  });

  it('still forbids every template if the custom provider ever goes away', () => {
    // The other half, and the reason the premise above is asserted rather than assumed. If
    // somebody removes the production override — a revert, a tidy-up, a merge gone wrong —
    // the restriction comes back and every block in this file becomes a failed deploy. This
    // says so in one line, so the two facts cannot drift apart silently.
    expect(customSmtp() || templateModifications().length === 0).toBe(true);
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

/**
 * **The production-only override — #50, and the one place this file stops describing what a
 * laptop runs.**
 *
 * `supabase config push` applies a `[remotes.<name>]` block whose `project_id` matches the
 * linked project. `deploy-db.yml` links immediately before pushing, so the merge happens
 * there and only there — no local command passes a project ref, which is why `./dev up`,
 * `./dev check` and `./dev test` all go on reading the base document.
 *
 * **This is the one mechanism in this file that no local check can prove**, and that is the
 * reason for asserting its shape so precisely. `supabase status` does not run the validation
 * `config push` does — a base `[auth.email.smtp]` with `enabled = true` and an empty password
 * passes `status` in silence, measured — so nothing here can tell you the override *worked*.
 * What these assertions can do is fail the moment its shape drifts: a renamed remote, a
 * mistyped project id, a second key quietly added to the override, or the base block flipped
 * on so that CI starts dialling Resend again.
 *
 * The proof that it worked is a green `deploy-db` run followed by a real confirmation email
 * arriving at a real inbox, and both are steps in `accounts-open.md`.
 */
describe('the production-only override', () => {
  /** Every uncommented `[section]` header in the file, in order. */
  function sectionNames(): string[] {
    return CONFIG.split('\n')
      .map((line) => /^\[([^\]]+)\]$/.exec(line.trim())?.[1])
      .filter((name): name is string => name !== undefined);
  }

  /** The keys declared under one section, in order. */
  function sectionKeys(section: string): string[] {
    const lines = CONFIG.split('\n');
    const start = lines.findIndex((line) => line.trim() === section);
    if (start === -1) throw new Error(`config.toml has no ${section} section`);
    const nextSection = lines.findIndex(
      (line, i) => i > start && /^\[/.test(line.trim()),
    );

    return lines
      .slice(start + 1, nextSection === -1 ? undefined : nextSection)
      .map((line) => /^(\w+)\s*=/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]!);
  }

  it('names the club project, in the form the CLI will accept', () => {
    // The CLI validates `project_id` against a twenty-lowercase-letter pattern, and refuses
    // two remotes naming the same project. A ref that is merely *wrong* rather than
    // malformed is the failure this assertion exists for: it passes the CLI's own check and
    // then silently matches nothing, so the push succeeds and production quietly keeps the
    // built-in sender — the exact silence #50 exists to remove.
    //
    // Not a secret, and not treated as one anywhere else: it is the host part of
    // `PUBLIC_SUPABASE_URL` in `apps/main/wrangler.jsonc`, which ships to every browser.
    const projectId = sectionValue('[remotes.production]', 'project_id').replace(
      /"/g,
      '',
    );
    expect(projectId).toBe('ketipxpyjjglwpqazsft');
    expect(projectId).toMatch(/^[a-z]{20}$/u);
  });

  it('turns on the custom mail provider that CI and a laptop cannot use', () => {
    // The single line the whole block exists for. Base is `false` because CI and every
    // laptop have a placeholder password and cannot reach Resend — with `true` there, every
    // `signUp()` in the database tests answers `Error sending confirmation email`, which is
    // three suites and 116 tests. Measured in #98, not predicted.
    expect(sectionValue('[remotes.production.auth.email.smtp]', 'enabled')).toBe('true');
  });

  it('overrides exactly one key, and nothing else about production differs', () => {
    // **The assertion that actually protects this.** A remote block deep-merges over the
    // base, so every key left out of it is stated once, in the base, where the rest of this
    // file's tests can see it. The moment a second key appears here, production runs
    // something no assertion above describes — and the divergence a reader has to hold in
    // their head goes from one boolean to a list nobody is keeping.
    //
    // Growing it is a decision rather than a convenience, and this test is what makes it
    // one — the same job `entries.test.ts` does for a fourteenth anon-callable function.
    expect(sectionNames().filter((name) => name.startsWith('remotes.'))).toEqual([
      'remotes.production',
      'remotes.production.auth.email.smtp',
    ]);
    expect(sectionKeys('[remotes.production]')).toEqual(['project_id']);
    expect(sectionKeys('[remotes.production.auth.email.smtp]')).toEqual(['enabled']);
  });

  it('leaves the base block off, so nothing local dials out', () => {
    // The other half of the same guarantee, asserted from this end too. If somebody
    // "helpfully" turns the base on to match production, CI goes red here — rather than in
    // three database suites, with an error about confirmation email that names no cause.
    expect(sectionValue('[auth.email.smtp]', 'enabled')).toBe('false');
  });
});

/**
 * **The confirmation email's template — #101, and the one artefact here that fails silently.**
 *
 * `[auth.email.template.confirmation]` names this file. Everything below guards the way it
 * breaks, which is not the way a file usually breaks: **GoTrue does not stop when a template
 * will not parse.** It logs `templatemailer_template_body_parse_error` into a container nothing
 * in this repository reads, falls back to its *built-in* template, and sends the `supabase.co`
 * link this file exists to remove. The mail still arrives and still works. The deploy is green.
 * Nothing anywhere says the club's template was ignored.
 *
 * That happened while building #101, and the cause is the trap worth pinning: **a Go template
 * parses the whole file, HTML comments included.** A comment explaining the template, written
 * with the braces in it, opens a block that is never closed — so the file that documents itself
 * best is the one most likely to do this.
 */
describe('the confirmation email template', () => {
  /** The file with its HTML comments removed. */
  function markup(): string {
    return CONFIRMATION_TEMPLATE.replace(/<!--[\s\S]*?-->/g, '');
  }

  /** Just the HTML comments. */
  function comments(): string {
    return (CONFIRMATION_TEMPLATE.match(/<!--[\s\S]*?-->/g) ?? []).join('\n');
  }

  it('has no template action anywhere in its comments', () => {
    // **The assertion that would have caught the real failure.** Prose about a template is
    // still template source to the parser, and what it causes is invisible.
    expect(comments()).not.toContain('{{');
  });

  it('balances every block it opens', () => {
    const opens = (markup().match(/\{\{\s*(if|range|with)\b/g) ?? []).length;
    const closes = (markup().match(/\{\{\s*end\s*\}\}/g) ?? []).length;

    expect(opens).toBe(closes);
  });

  it('sends people to the origin they signed up on, not a hard-coded hostname', () => {
    // `site_url` is the club's real hostname in every environment, so a link built from it
    // would send a laptop and a CI runner to the live site — and the acceptance test that
    // follows a confirmation link would leave the machine. `RedirectTo` is the validated
    // `emailRedirectTo` from the request, which is localhost locally.
    const href = /href="([^"]+)"/.exec(markup())?.[1] ?? '';

    expect(href).toContain('.RedirectTo');
    expect(href).toContain('token_hash={{ .TokenHash }}');
    expect(href).toContain('type=signup');
  });

  it('never links to supabase.co, which is the whole point of it existing', () => {
    // Checked on the markup rather than the whole file, deliberately: the comment discusses
    // `supabase.co` at length, and a naive match would forbid explaining what this is for.
    expect(markup()).not.toContain('supabase.co');
  });

  it('carries exactly one link, so there is one thing to click', () => {
    // A second link gives a hesitant reader something else to press and a prefetching scanner
    // something else to fetch — and a scanner that follows the real one spends the token.
    expect(markup().match(/href="/g) ?? []).toHaveLength(1);
  });
});
