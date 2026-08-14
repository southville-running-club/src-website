import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **No Stripe credential is ever committed, and this is what says so.**
 *
 * The rule is easy to state and easy to break in a hurry: the secret key and the webhook
 * signing secret are Worker secrets, set with `wrangler secret put`, and they never appear in
 * `wrangler.jsonc`, in a `vars` block, or anywhere else in this repository. The day somebody
 * pastes one in to "just try it locally", the failure has to be a red pipeline rather than a
 * key in the git history — because a secret that was ever committed is compromised and has to
 * be **rotated**, not deleted.
 *
 * The local development path needs no exception. `apps/main`'s `preview` script passes a
 * stub key and a stub API base on the `wrangler dev` command line, and there is no route from
 * a dev-server flag to a deployed Worker.
 *
 * `packages/shared/tests/unit/supabase-config.test.ts` reads the same file for the same kind
 * of reason and is where the JSONC reader below came from.
 */

/** Minimal JSONC reader — strips `//` comments and trailing commas. */
function readWranglerConfig(): Record<string, unknown> {
  const path = join(import.meta.dirname, '..', '..', 'wrangler.jsonc');
  const jsonc = readFileSync(path, 'utf8');

  const withoutComments = jsonc
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');

  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'));
}

interface WranglerConfig {
  vars?: Record<string, string>;
  triggers?: { crons?: string[] };
  env?: {
    production?: {
      vars?: Record<string, string>;
      triggers?: { crons?: string[] };
    };
  };
}

const config = () => readWranglerConfig() as WranglerConfig;

describe('Stripe credentials are not in this repository', () => {
  it('names no Stripe variable in either block', () => {
    const parsed = config();

    for (const vars of [parsed.vars, parsed.env?.production?.vars]) {
      expect(Object.keys(vars ?? {}).filter((key) => key.startsWith('STRIPE'))).toEqual(
        [],
      );
    }
  });

  it('carries nothing that looks like a Stripe key anywhere in the file', () => {
    // The whole file rather than the `vars` blocks, because a key pasted into a comment is
    // just as committed as one pasted into configuration.
    const raw = readFileSync(
      join(import.meta.dirname, '..', '..', 'wrangler.jsonc'),
      'utf8',
    );

    // `sk_` live and test, restricted keys, and webhook signing secrets. Written as separated
    // fragments so this file does not itself contain a string that a secret scanner would
    // flag — and so the assertion cannot pass by matching itself.
    for (const prefix of ['sk_' + 'live_', 'sk_' + 'test_', 'rk_' + 'live_', 'whsec_']) {
      expect(raw).not.toContain(prefix);
    }
  });
});

describe('the Cron Trigger that sweeps lapsed holds', () => {
  it('runs every five minutes, in both blocks', () => {
    // **Declared twice because Wrangler does not inherit `triggers` into an environment.**
    // A cron that only existed at the top level would run on a laptop and nowhere else, and
    // nobody would notice: capacity does not depend on it, so its absence in production is
    // silent by design.
    const parsed = config();

    expect(parsed.triggers?.crons).toEqual(['*/5 * * * *']);
    expect(parsed.env?.production?.triggers?.crons).toEqual(['*/5 * * * *']);
  });
});
