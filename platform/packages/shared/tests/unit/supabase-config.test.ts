import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Both front doors must reach the same database.**
 *
 * This is not a tidiness preference. The results archive has to be *derived from* timing
 * data rather than re-keyed, and two Supabase projects are two Postgres instances that
 * cannot join. If `src-main` and `src-timing` ever point at different projects, nothing
 * fails loudly — a results page simply comes back empty, months later, probably during a
 * race weekend.
 *
 * So it is asserted here rather than trusted to two people typing the same string into
 * two dashboards.
 *
 * See docs/architecture/decisions/adr-002-schema-layout.md
 */

const APPS = ['main', 'timing'] as const;

/** Minimal JSONC reader — strips `//` comments and trailing commas. */
function readWranglerConfig(app: string): Record<string, never> {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'apps',
    app,
    'wrangler.jsonc',
  );
  const jsonc = readFileSync(path, 'utf8');

  const withoutComments = jsonc
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(withoutTrailingCommas);
}

interface SupabaseVars {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

function productionVars(app: string): SupabaseVars {
  const config = readWranglerConfig(app) as unknown as {
    env?: { production?: { vars?: SupabaseVars } };
  };
  const vars = config.env?.production?.vars;
  if (!vars) {
    throw new Error(`apps/${app}/wrangler.jsonc has no env.production.vars`);
  }
  return vars;
}

describe('the two Workers share one database', () => {
  it('declares the same Supabase project in both production configs', () => {
    const [main, timing] = APPS.map(productionVars);

    expect(timing?.PUBLIC_SUPABASE_URL).toBe(main?.PUBLIC_SUPABASE_URL);
    expect(timing?.PUBLIC_SUPABASE_ANON_KEY).toBe(main?.PUBLIC_SUPABASE_ANON_KEY);
  });

  it.each(APPS)('points %s at a real Supabase project, over HTTPS', (app) => {
    const { PUBLIC_SUPABASE_URL } = productionVars(app);

    expect(PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });

  it.each(APPS)('never carries a service role key in %s', (app) => {
    // If a build appears to need one, the row-level security policy is wrong and that is
    // the thing to fix. This asserts nobody quietly resolved it the other way.
    const config = JSON.stringify(readWranglerConfig(app));

    expect(config).not.toMatch(/service_role/i);
    expect(config).not.toMatch(/sb_secret_/);
  });
});

describe('local development stays local', () => {
  it.each(APPS)('points %s at localhost at the top level', (app) => {
    // The top level is the safe default: a plain `wrangler deploy` should publish
    // something harmless, not put localhost config on a live hostname.
    const config = readWranglerConfig(app) as unknown as { vars?: SupabaseVars };

    expect(config.vars?.PUBLIC_SUPABASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it.each(APPS)('attaches no custom domain to %s outside production', (app) => {
    const config = readWranglerConfig(app) as unknown as { routes?: unknown[] };

    expect(config.routes).toBeUndefined();
  });
});
