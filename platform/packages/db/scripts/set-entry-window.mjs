#!/usr/bin/env node
/**
 * Opens or closes the Nightingale Nightmare entry window on the **local** database.
 *
 * `/nn/` shows the entry form when `entries.events` says entries are open and the interest
 * form otherwise, decided by the Worker on every request. The seeded state is closed —
 * `entries_open_at` is null, because nobody has decided when entries open — so this is how
 * a laptop sees the entry form at all.
 *
 * **Closing puts back the seeded shape rather than an empty one**: a null open date and the
 * close date the committee ratified, which since 27 August is a real value in the schema. See
 * the comment on the SQL below.
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
  : // **Only the opening half is withheld, and the close date stays.** This used to null both,
    // on the reasoning that closed is what the migration seeded — true when it was written and
    // false since 27 August, when `20260827180000_nn_2026_entries_close_at.sql` set
    // `entries_close_at` to `2026-10-30 17:00:00+00`. Production holds a null open date and a
    // set close date: the committee ratified the window, and `entries_open_at` alone is the
    // switch.
    //
    // Nulling both left the laptop in a state nobody has deployed, and with **no symptom** —
    // `entry_state()` tests `entries_open_at is null` as an explicit branch before it compares
    // anything, so the page reads correctly either way. What broke was any question *about*
    // the close date, asked of a row that no longer had one.
    `update entries.events
        set entries_open_at = null
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
