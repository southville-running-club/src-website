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

  it('exposes nothing beyond public, graphql_public, intake and entries', () => {
    // Deliberately exact rather than a subset check. A schema arriving on this list
    // silently is precisely the failure this file exists to prevent.
    expect(exposedSchemas().sort()).toEqual([
      'entries',
      'graphql_public',
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

  it('signup is closed until the platform decides it needs member-facing auth', () => {
    // The anon key is public, so an open signup endpoint is reachable by anyone who can
    // see the client bundle — independent of RLS. Whether the platform needs
    // member-facing authentication at all is still an open question; until it is
    // answered, this stays closed rather than defaulting open.
    expect(authValue('enabled')).toBe('true');
    expect(authValue('enable_signup')).toBe('false');
  });
});
