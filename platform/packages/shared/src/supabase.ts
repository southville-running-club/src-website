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

/**
 * Either client, for the reads in `entries` that are now asked by both.
 *
 * **Every one of them chains `.schema('entries')` explicitly**, so the client's own default
 * schema — the only thing these two types differ in — is irrelevant to them. What is not
 * irrelevant is *who is asking*: `entries.entry_state()` hides a permission-gated fee from a
 * caller who does not hold its permission, and `entries.create_pending_purchase()` admits a
 * pre-open event only for one who does. Both resolve that through `auth.uid()`, which is null
 * unless the request carried somebody's access token.
 *
 * So a route that has a session must pass `createUserClient`'s client and a route that has
 * none must pass `createAnonClient`'s — and this type is what lets one function take either
 * without the caller reaching for a cast. See `worker/nn-entry.ts`'s `entriesClientFor`.
 */
export type DbClient = AnonClient | UserClient;

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

/**
 * The suffix supabase-js appends to `storageKey` when it stores a PKCE code verifier. Matched
 * by suffix rather than compared to one exact string, because the prefix is the library's to
 * choose and a version that changes it should not silently stop the flow working.
 */
const CODE_VERIFIER_SUFFIX = '-code-verifier';

/**
 * Somewhere for one request to leave a code verifier and the next request to find it.
 *
 * `createPkceClient` hands one back rather than returning a bare client, because the verifier
 * supabase-js mints is a value the Worker has to get hold of — it goes into an `HttpOnly`
 * cookie so it survives the trip to the mail client and back, and there is no other way to
 * read it out of the library.
 */
export interface PkceVerifierStore {
  /** The verifier supabase-js minted during this request, or `null` if it minted none. */
  minted(): string | null;
}

/**
 * The client the magic link (#55) and Google (#56) both sign in through.
 *
 * **PKCE rather than the implicit flow, and the reason is not the usual one.** #55 asks that a
 * prefetching mail scanner — and some corporate scanners follow every URL in a message before
 * a human sees it — must not consume a single-use token. The issue proposes GoTrue's
 * `token_hash` flow for that, which needs the email template to emit `{{ .TokenHash }}`; and
 * declaring an email-template block is exactly what took production's auth configuration down
 * for four deploys in #79, and what `tests/unit/config.test.ts` now fails on even when the
 * block is disabled. That route is closed until a custom SMTP provider exists.
 *
 * PKCE reaches the same property by a different road and needs no template. The code arrives
 * on the **query string**, where the Worker can read it directly, and redeeming it requires a
 * `code_verifier` that never left this origin. **A scanner that follows the link holds a code
 * and nothing to redeem it with**, so it cannot obtain a session — which is the property #55
 * actually wanted. It is also the shape the OAuth return needs, so `/account/callback/` is
 * genuinely built once and used twice.
 *
 * **In-memory storage, and that is not a compromise.** A Worker has no `localStorage`, and it
 * must not have one here: the verifier is a per-person secret for the length of one sign-in,
 * and anything shared between requests would hand one person's verifier to the next caller.
 * The map below lives and dies inside a single request; the cookie is what carries the value
 * across the gap, `HttpOnly` so no script can read it.
 *
 * **`SameSite=Lax` is load-bearing on that cookie**, for the same reason `session.ts` gives
 * for the session pair: arriving from a mail client is a cross-site top-level navigation, and
 * `Strict` would drop the cookie on the way in. The exchange would then fail with a valid
 * code, which is the least debuggable outcome available.
 *
 * @param verifier the verifier read back from the cookie, when redeeming a code. `null` when
 *   starting a sign-in, which is when supabase-js mints one and `store.minted()` returns it.
 */
export function createPkceClient(
  config: SupabaseConfig,
  verifier: string | null,
): { client: AnonClient; store: PkceVerifierStore } {
  const { url, anonKey } = assertUsableConfig(config);

  const cells = new Map<string, string>();
  let mintedVerifier: string | null = null;

  // `storageKey` is pinned so the verifier's cell has a name this file chooses rather than one
  // derived from the project reference. Nothing persists between requests either way; it makes
  // the seeding below exact instead of a guess.
  const storageKey = 'src-account';

  if (verifier !== null) {
    cells.set(`${storageKey}${CODE_VERIFIER_SUFFIX}`, verifier);
  }

  const client = createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      storageKey,
      // `true` so supabase-js writes the verifier to the storage below at all — with
      // `persistSession: false` it mints one and drops it, and the exchange then fails on a
      // code that was perfectly good. The storage is a per-request map, so nothing is
      // persisted in any sense that matters.
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (key: string) => cells.get(key) ?? null,
        setItem: (key: string, value: string) => {
          cells.set(key, value);
          if (key.endsWith(CODE_VERIFIER_SUFFIX)) {
            mintedVerifier = value;
          }
        },
        removeItem: (key: string) => {
          cells.delete(key);
        },
      },
    },
    db: {
      schema: 'intake',
    },
  });

  return { client, store: { minted: () => mintedVerifier } };
}
