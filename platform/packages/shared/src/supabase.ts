import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@src/db';

/**
 * The club's one way of building a Supabase client.
 *
 * Two rules are baked in rather than left to each caller:
 *
 * 1. **The anon key only.** The service role key never reaches the browser and never
 *    enters this repository. If something appears to need it, the row-level security
 *    policy is wrong and that is the thing to fix.
 * 2. **Configuration is passed in, never read from `process.env`.** Workers have no
 *    `process.env`, and a module that reaches for one works on a laptop and fails in
 *    production — which is the worst place to find out.
 *
 * @see docs/architecture/principles.md#row-level-security-is-the-access-control
 */

export interface SupabaseConfig {
  /** `PUBLIC_SUPABASE_URL`. Safe to expose. */
  url: string;
  /** `PUBLIC_SUPABASE_ANON_KEY`. Safe to expose — RLS is what enforces access. */
  anonKey: string;
}

/**
 * Typed against the schemas this repository owns, so calls are checked at compile time
 * and CI fails when the generated types drift from the migrations.
 *
 * The default schema is `intake` because it is the only one this repository exposes to a
 * browser — `club` is not reachable through PostgREST at all, and `public` belongs to the
 * timing platform. When the results archive starts reading timing data, `public` joins the
 * generated types and this default is worth revisiting.
 */
export type AnonClient = SupabaseClient<Database, 'intake'>;

export function createAnonClient(config: SupabaseConfig): AnonClient {
  const url = config.url?.trim();
  const anonKey = config.anonKey?.trim();

  // Failing loudly here beats a 401 from PostgREST that reads like a policy problem.
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY — see .env.example',
    );
  }

  if (anonKey.startsWith('sb_secret_') || anonKey.includes('service_role')) {
    throw new Error(
      'That looks like a service role key. It must never reach a client or this repository — see docs/architecture/principles.md',
    );
  }

  return createClient(url, anonKey, {
    auth: {
      // Nothing in the skeleton signs in, and a client that quietly persists a session is
      // a surprise waiting for whoever adds auth later.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
