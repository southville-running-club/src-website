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

/** The same client shape, but its RPCs and reads default to `identity` — what a signed-in
 *  caller from #52 onward is overwhelmingly asking about. */
export type UserClient = SupabaseClient<Database, 'identity'>;

function assertUsableConfig(config: SupabaseConfig): { url: string; anonKey: string } {
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

  return { url, anonKey };
}

export function createAnonClient(config: SupabaseConfig): AnonClient {
  const { url, anonKey } = assertUsableConfig(config);

  return createClient(url, anonKey, {
    auth: {
      // Nothing in the skeleton signs in, and a client that quietly persists a session is
      // a surprise waiting for whoever adds auth later. #52's worker/session.ts is what
      // actually carries a session now — across a request, not inside this client.
      persistSession: false,
      autoRefreshToken: false,
    },
    // `AnonClient`'s comment claims `intake` by default; `db.schema` is what actually makes
    // that true rather than only the type parameter. Every current caller chains
    // `.schema('entries')` or `.schema('intake')` explicitly and is unaffected — see
    // `createUserClient`'s comment for the class of bug leaving this unset invites.
    db: {
      schema: 'intake',
    },
  });
}

/**
 * A client that reads and writes as one signed-in person, via the access token
 * `worker/session.ts` holds on their behalf.
 *
 * **Still the anon key.** The `Authorization: Bearer <access token>` header is what tells
 * PostgREST which row `auth.uid()` resolves to; row-level security is what an authenticated
 * caller may then do with that, exactly as it is for `anon`. This function accepts no
 * service-role key for the same reason `createAnonClient` does not — if a route appears to
 * need one, the RLS policy is wrong.
 *
 * **`db.schema` is set to `identity`, not left to the type alone.** `UserClient`'s own
 * comment has said "its RPCs and reads default to `identity`" since #52, and until #58 that
 * was true of the type parameter and nothing else — `SupabaseClient<Database, 'identity'>`
 * tells TypeScript what a bare `.rpc()` call resolves to, but postgrest-js reads the schema
 * to actually request from `db.schema` at the client, not from the generic. Every bare call
 * — `client.rpc('my_roles')` in `worker/account.ts`, written for #53 — was quietly asking
 * `public.my_roles`, which does not exist, and reading the refusal as "no roles" rather than
 * as a failure: `/account/` has told every signed-in person, super-admins included, that
 * they held nothing beyond being signed in. #59's `identity.list_people()` and
 * `identity.grant_role()` calls in `worker/admin-people.ts` were written the same way and
 * would have failed identically. `packages/db/tests/identity.test.ts` proves the functions
 * work; nothing proved a caller here could reach them until this.
 *
 * A call that still needs `entries` chains `.schema('entries')` explicitly, as it always
 * has — that escape hatch is unaffected by what the client's own default is.
 */
export function createUserClient(
  config: SupabaseConfig,
  accessToken: string,
): UserClient {
  const { url, anonKey } = assertUsableConfig(config);

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    db: {
      schema: 'identity',
    },
  });
}
