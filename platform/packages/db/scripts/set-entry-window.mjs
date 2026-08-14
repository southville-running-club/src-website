#!/usr/bin/env node
/**
 * Opens or closes the Nightingale Nightmare entry window on the **local** database.
 *
 * `/nn/` shows the entry form when `entries.events` says entries are open and the interest
 * form otherwise, decided by the Worker on every request. The seeded state is closed —
 * `entries_open_at` is null, because nobody has decided when entries open — so this is how
 * a laptop sees the entry form at all.
 *
 * **It moves the same row the committee will move.** There is no preview flag, no
 * query-string override and no local-only variable, which is what makes it impossible for
 * something in this repository to force a form open in production.
 *
 * Local only, and deliberately unable to be anything else: the connection string is the
 * fixed one `supabase start` prints on every machine, and nothing here reads a remote
 * project ref.
 *
 *   npm run entries:open  --workspace=packages/db
 *   npm run entries:close --workspace=packages/db
 */
import pg from 'pg';

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SLUG = 'nn-2026';
const open = process.argv[2] === 'open';

// Offsets from now() rather than fixed timestamps, so an open window does not quietly
// expire on whichever morning the clock passes a hard-coded date.
const SQL = open
  ? `update entries.events
        set entries_open_at = now() - interval '1 day',
            entries_close_at = now() + interval '30 days'
      where slug = $1
      returning entries_open_at, entries_close_at`
  : `update entries.events
        set entries_open_at = null, entries_close_at = null
      where slug = $1
      returning entries_open_at, entries_close_at`;

const db = new pg.Client({ connectionString: LOCAL_DB });

try {
  await db.connect();
} catch {
  console.error(
    'Could not reach the local database. Is it running? Try: npm run db:start',
  );
  process.exit(1);
}

try {
  const { rows } = await db.query(SQL, [SLUG]);

  if (rows.length === 0) {
    console.error(
      `No event with slug ${SLUG}. Has the migration applied? Try: npm run db:reset`,
    );
    process.exit(1);
  }

  console.log(
    open
      ? `Entries are open locally. /nn/ now serves the entry form.\n  opens  ${rows[0].entries_open_at.toISOString()}\n  closes ${rows[0].entries_close_at.toISOString()}`
      : 'Entries are closed locally, as the migration seeds them. /nn/ serves the interest form.',
  );
} finally {
  await db.end();
}
