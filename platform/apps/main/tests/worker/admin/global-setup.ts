import { createServer, type Server } from 'node:http';
import { clearAdminFixtures, medicalReadAudit, seedAdminFixtures } from '../../admin-db';

/**
 * The state the admin run needs, set rather than assumed, and put back afterwards.
 *
 * **Cleared before as well as after.** A run that failed halfway leaves rows behind, and
 * "exactly five entrants" would then be counting somebody else's — the lesson the entry window
 * taught during Slice A, two tables along.
 *
 * The teardown matters more here than in any other run, and since #58 for a second reason.
 * It still takes the admin key's digest back out of the local database; it also deletes the
 * three fixture **people**, one of whom holds `super-admin`. `identity.revoke_role()` refuses
 * to remove *the last* active super-admin grant, so a fixture super-admin left behind makes
 * `packages/db/tests/identity.test.ts`'s assertion about that refusal false two suites away
 * from anything that changed.
 */

/**
 * Where the audit bridge listens.
 *
 * **Written out here and again in `admin.test.ts`**, the same duplication the admin key
 * carried between this run's Vitest config and `admin-fixtures.ts`, and for a related reason:
 * the test runs inside `workerd` and this file runs in Node, and a module imported by both
 * would drag `pg` and `node:http` into the Workers runtime, where neither exists. A mismatch
 * fails loudly on the first fetch rather than quietly, which is what makes the duplication
 * safe.
 */
const AUDIT_BRIDGE_PORT = 54399;

/**
 * A read-only window onto `entries.admin_audit`, for the one assertion that cannot be made
 * from inside the Workers runtime.
 *
 * **Nothing may read that table through the API** — row-level security is on, there is no
 * policy, and none of the thirteen functions the anon role may execute touches it. That is
 * deliberate (ADR-013, and the note in `worker/nn-admin.ts` about the fourteenth function
 * being a stop-and-ask), and it means a Miniflare test has no route to the row a medical read
 * has just written. `pg` cannot run in `workerd` either, so the only thing left is to answer
 * the question in Node and let the test ask over HTTP — the same arrangement
 * `scripts/stripe-stub.mjs` uses to put a Node process in front of a Worker.
 *
 * It answers one question, takes no input, and exists only while this run does. It is not a
 * fixture the Worker can see: no binding names it, and nothing under `worker/` could reach it
 * without somebody writing the URL in.
 */
let bridge: Server | null = null;

export async function setup(): Promise<void> {
  await seedAdminFixtures();

  const server = createServer((_request, response) => {
    medicalReadAudit()
      .then((rows) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(rows));
      })
      .catch((cause: unknown) => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(cause) }));
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(AUDIT_BRIDGE_PORT, '127.0.0.1', () => {
      resolve();
    });
  });

  bridge = server;
}

export async function teardown(): Promise<void> {
  const server = bridge;
  bridge = null;

  if (server !== null) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  await clearAdminFixtures(null);
}
