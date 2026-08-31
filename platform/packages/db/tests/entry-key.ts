import type { Client } from 'pg';
import { createHash } from 'node:crypto';

/**
 * The entry key, for tests that hold a place.
 *
 * ## Why holding a place needs a key at all
 *
 * `entries.create_pending_purchase()` is granted to the anon role — it has to be, because a
 * signed-out runner reaches PostgREST as anon — and it holds a place *before* any money moves,
 * with a live hold counting against the 250. Until 31 August 2026 that meant a loop with the
 * published anon key could take the whole field in half a second, for nothing, without ever
 * touching the Worker or the rate-limiting rule in front of it: **249 holds in 0.5 seconds,
 * measured, and the next real runner refused `sold_out`.** Issue #178 and ADR-026.
 *
 * So the function takes a key, exactly as `record_checkout_event()` and the five admin reads
 * do. The grant stays; what the grant now means is "you may ask", and the key is what answers.
 *
 * ## Why every fixture has to install it
 *
 * The digest ships **null**, which refuses everything — the same shape as an unset
 * `STRIPE_SECRET_KEY`, and the safe direction for a control that would otherwise be off by
 * accident. A test that holds a place is therefore a test that has to install a digest first,
 * which is deliberate: it means the refusal is the default in the suite as well as in
 * production, and a fixture cannot drift into proving the door is open when it is not.
 *
 * **This value is a test fixture and nothing else.** The real key is a Worker secret, never in
 * this repository. The one property that matters here is that it is not the empty string,
 * because that is indistinguishable from unset.
 */
export const ENTRY_KEY = 'test-entry-key-not-a-real-one';

/** The digest the database stores — never the key. */
export const ENTRY_KEY_DIGEST = createHash('sha256')
  .update(ENTRY_KEY, 'utf8')
  .digest('hex');

/**
 * Install the test digest, so this file's fixtures may hold a place.
 *
 * Idempotent, and safe to call from more than one `beforeAll` in one run — the suites share a
 * database, and the row is a single upsert of the same value.
 */
export async function installEntryKey(db: Client): Promise<void> {
  await db.query(
    `insert into entries.webhook_secrets (name, key_sha256)
     values ('entry', $1)
     on conflict (name) do update set key_sha256 = excluded.key_sha256, updated_at = now()`,
    [ENTRY_KEY_DIGEST],
  );
}

/**
 * Put the digest back to null — the state the migration ships.
 *
 * **Only for a test that is about the refusal itself.** Files share a database, so a suite
 * that cleared this in `afterAll` would take the door out from under whatever ran next; the
 * one caller that needs it restores it in the same test.
 */
export async function clearEntryKey(db: Client): Promise<void> {
  await db.query(
    `update entries.webhook_secrets set key_sha256 = null where name = 'entry'`,
  );
}
