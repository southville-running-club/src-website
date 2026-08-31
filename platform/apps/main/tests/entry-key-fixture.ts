/**
 * The entry key the acceptance and Worker runs are built on.
 *
 * **Constants only, and no import of anything** — the same rule `webhook-fixtures.ts` is
 * written under, and for the same reason. This module is read from two places that cannot
 * share code any other way: Vitest's `globalSetup`, which runs in ordinary Node and installs
 * the digest with `pg`, and the Worker config, which binds the value into `workerd`. A single
 * `import { Client } from 'pg'` here would break the second half.
 *
 * ## Why holding a place needs a key
 *
 * `entries.create_pending_purchase()` is granted to the anon role — a signed-out runner
 * reaches PostgREST as anon, so it has to be — and it holds a place *before* any money moves,
 * with a live hold counting against the 250. Until 31 August 2026 that meant a loop with the
 * anon key printed in every page's source could take the whole field in half a second for
 * nothing, never touching the Worker or the rate-limiting rule in front of it. Issue #178.
 *
 * The key is what separates the Worker from that loop. See ADR-029.
 *
 * **Obviously not a real one, and it authenticates to nothing.** The real key is a Worker
 * secret that never appears in this repository; what makes this one work is only that the
 * global setup installs *its* digest into `entries.webhook_secrets` for the length of the run.
 */
export const ENTRY_KEY = 'zz-worker-entry-key-not-a-real-one';
