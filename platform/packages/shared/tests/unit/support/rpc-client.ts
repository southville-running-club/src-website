import type { AnonClient } from '../../../src/supabase';

/**
 * A stand-in for the anon client, so a hand-made PostgREST reply can be put through the
 * parsing in `admin.ts` and `entry-confirmation.ts`.
 *
 * ## What this is for, and what it is emphatically not for
 *
 * **It is not a mock of the database, and no test using it asserts anything about Postgres.**
 * Every one of these functions is proven against a real Postgres in `packages/db/tests/` and
 * through the real runtime in `apps/main/tests/worker/`, and those are the tests that say the
 * RPCs work. Nothing here duplicates them, and a test that started asserting what a function
 * returns for a *correct* reply would be doing exactly that and should be deleted.
 *
 * What it is for is the other half — **the replies a working database cannot produce.** Both
 * modules are largely made of degradation: `readEnvelope`'s three-way classification of a
 * failure, `z.enum(...).catch(...)` for a value a later migration adds, `.optional()` for a
 * column an earlier one lacks. Those paths exist because nothing sequences a migration against
 * the Cloudflare deploy — see the expand-migrate-contract rule in
 * `docs/architecture/principles.md` — and **a database that is behaving correctly cannot reach
 * any of them.** A hand-made payload is the only way in, which makes this a unit test and
 * nothing else.
 *
 * The `calls` array is there so a test can assert that a key was passed and that an absent
 * argument was omitted rather than sent as null, which is a real property of these call sites
 * (`exactOptionalPropertyTypes` and the functions' own `default null`) and is otherwise
 * invisible.
 */

/** PostgREST's answer. Exactly one of the two is ever meaningful. */
export interface RpcReply {
  data: unknown;
  error: { code?: string | null; message: string } | null;
}

/** One call, recorded so a test can assert on what was sent as well as what came back. */
export interface RpcCall {
  schema: string;
  fn: string;
  args: Record<string, unknown> | undefined;
}

export type RpcResponder = (call: RpcCall) => RpcReply;

/** A reply that parsed cleanly. The common case, and the uninteresting one. */
export function ok(data: unknown): RpcReply {
  return { data, error: null };
}

/** PostgREST reporting its own failure — a missing function, a refused connection. */
export function pgError(code: string | null, message: string): RpcReply {
  return { data: null, error: { code, message } };
}

/**
 * A client that answers every RPC with `responder`, and remembers what it was asked.
 *
 * The cast is the whole of the dishonesty here and it is confined to this line: the real
 * client's `rpc` returns a `PostgrestFilterBuilder`, which is a thenable with a large surface
 * these modules never touch — they `await` it immediately and read `data` and `error`. A
 * promise of the same two fields is the same thing as far as any caller in this repository is
 * concerned.
 */
export function rpcClient(responder: RpcReply | RpcResponder): {
  client: AnonClient;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const answer: RpcResponder =
    typeof responder === 'function' ? responder : () => responder;

  const client = {
    schema(schema: string) {
      return {
        rpc(fn: string, args?: Record<string, unknown>) {
          const call: RpcCall = { schema, fn, args };
          calls.push(call);
          return Promise.resolve(answer(call));
        },
      };
    },
  };

  return { client: client as unknown as AnonClient, calls };
}

/**
 * A client whose call rejects, which is what a network failure looks like from here.
 *
 * Worth its own helper because the `catch` in every one of these functions is load-bearing:
 * a throw out of a payment path becomes a 500 that tells Stripe nothing about whether a retry
 * would help, and a throw out of an admin read becomes a stack trace on a page a volunteer is
 * using. Both must come back as an ordinary failure value instead.
 */
export function failingRpcClient(cause: unknown): AnonClient {
  const client = {
    schema() {
      return {
        rpc() {
          return Promise.reject(cause);
        },
      };
    },
  };

  return client as unknown as AnonClient;
}
