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

  it('exposes nothing beyond public, graphql_public and intake', () => {
    // Deliberately exact rather than a subset check. A schema arriving on this list
    // silently is precisely the failure this file exists to prevent.
    expect(exposedSchemas().sort()).toEqual(['graphql_public', 'intake', 'public']);
  });
});
