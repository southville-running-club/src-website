import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { ENTRY_KEY } from './entry-key-fixture';

/**
 * Opening and closing the Nightingale Nightmare entry window, for the tests that need one
 * state or the other.
 *
 * **The switch under test is the real one.** `/nn/` shows the entry form when
 * `entries.events.entries_open_at` and `entries_close_at` say entries are open, and the
 * interest form otherwise — read by the Worker on every request. A test that wants the entry
 * form moves that row, exactly as the committee will when entries open. There is no preview
 * flag, no query-string override and no local-only var, so there is nothing that could reach
 * production and force a form open that should not be.
 *
 * ## Every run sets the state it needs, rather than assuming it
 *
 * Both the worker configs and the acceptance suite call this in setup, including the ones
 * that want the *default* closed state. Assuming the seeded state instead cost half an hour
 * during this build: a run left the window open, and the next run's closed-state
 * assertions failed in a way that read as a bug in the page rather than as leftover state
 * on a laptop.
 *
 * ## Where each caller uses it
 *
 *   `vitest.worker.config.ts`              closed, for the default state
 *   `vitest.worker.entries-open.config.ts` open, and closed again on teardown
 *   `tests/e2e/nn-entry.spec.ts`           both, per describe block
 *
 * `pg` cannot run inside `workerd`, so the worker configs reach this through Vitest's
 * `globalSetup` — which runs in the ordinary Node process — rather than through a
 * `beforeAll` inside the runtime.
 *
 * The connection is the local Docker Postgres and nothing else. Its credentials are the
 * fixed ones `supabase start` prints on every machine, and there is no version of this file
 * that talks to production.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The event `/nn/` is about, and the slug `worker/nn-entry.ts` asks for. */
const SLUG = 'nn-2026';

/**
 * Open or close the window.
 *
 * Open uses offsets from `now()` rather than fixed timestamps: a hard-coded pair of dates
 * would start failing on whichever morning the clock passed the closing one, which is the
 * kind of test that fails on a Tuesday and teaches everybody to rerun the suite.
 *
 * Closed restores the state production is in: **a null `entries_open_at`, meaning nobody has
 * decided when entries open, and the `entries_close_at` the committee ratified** — a real
 * value in the schema since 27 August. Only the opening half is the switch.
 */
export async function setEntryWindow(open: boolean): Promise<void> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();

  try {
    await db.query(
      open
        ? `update entries.events
              set entries_open_at = now() - interval '1 day',
                  entries_close_at = now() + interval '30 days'
            where slug = $1`
        : // **The opening half alone**, so closing restores the shape production is in rather
          // than an emptier one. `entries_close_at` has been a real value since 27 August —
          // `20260827180000_nn_2026_entries_close_at.sql` — and nulling it here left every
          // suite that ran after a close asking questions of a row production never had. See
          // issue #145, defect 4.
          `update entries.events
              set entries_open_at = null
            where slug = $1`,
      [SLUG],
    );

    // **The entry key moves with the window, and that is the pairing production uses.**
    // Holding a place takes a key since ADR-029, and the digest ships null — which refuses
    // everything. Opening the window without installing it would give every local run an
    // entry form that cannot take an entry, and the failure would read as a bug in the form.
    //
    // **The two move together here, in one call, which is what makes them impossible to
    // forget locally.** Production keeps them apart and in a fixed order — the runbook
    // installs the secret and verifies it *before* `entries_open_at` is set, so there is no
    // moment in which entries are open and unprotected. Closing puts the digest back to null,
    // so a laptop is never left holding a working key for a test secret: the same rule
    // `clearWebhookKey` is called under.
    //
    // The digest, never the key. `createHash` rather than a hand-rolled one, because this has
    // to agree with `pg_catalog.sha256` and there is exactly one right answer.
    await db.query(
      open
        ? `insert into entries.webhook_secrets (name, key_sha256)
           values ('entry', $1)
           on conflict (name) do update
             set key_sha256 = excluded.key_sha256, updated_at = now()`
        : `update entries.webhook_secrets set key_sha256 = null where name = 'entry'`,
      open ? [createHash('sha256').update(ENTRY_KEY, 'utf8').digest('hex')] : [],
    );
  } finally {
    await db.end();
  }
}

export const openEntries = (): Promise<void> => setEntryWindow(true);
export const closeEntries = (): Promise<void> => setEntryWindow(false);
