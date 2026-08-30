import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { formatLondonDate, formatLondonTime, LONDON_TIME_ZONE } from '@src/shared';

/**
 * The entry window a runner is **told** about, against the one the database will **enforce**.
 *
 * `/nn/2026/` publishes its opening and closing times from `race.json`; the form opens and
 * shuts on `entries.events.entries_open_at` and `entries_close_at`. **Nothing read both until
 * this file**, and `entries-open.md` says so in as many words — *"there is no alarm, no failing
 * test, and no log line"* — describing people arriving at 07:00 to a page that says entries are
 * open, finding the interest form, and the club hearing about it from its inbox.
 *
 * This is the same arrangement `entries-retention.test.ts` uses for the medical retention
 * period, and for the same reason: two statements of one fact, in two places, with a test that
 * fails unless they agree.
 *
 * ## The error it is really here to catch
 *
 * **An hour.** The window is written `2026-09-01 07:00:00+01` — the runbook's own step 3 spells
 * the offset out and explains why, because 07:00 BST is 06:00Z and a timestamp typed without
 * the offset lands an hour late on a page that promised seven. The clocks then go back before
 * the window closes, so the two halves genuinely do not share an offset and neither can be
 * checked by eye against the other.
 *
 * Everything here is read in `Europe/London` through `packages/shared/src/london-time.ts`,
 * which is the only place this repository is allowed to turn an instant into words.
 *
 * ## Why the open date being null is not a failure
 *
 * It is the state production is in and the state the club has chosen: `entries_open_at` is the
 * switch that starts selling 250 places unattended, and it is set by hand, once, by the
 * entries-open runbook. So the assertion binds **when the column has a value** — from the
 * moment step 3 is run, a wrong instant is a red test rather than an email.
 *
 * The closing half is already applied, so that one binds today.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

/** The event `/nn/2026/` is about, and the row the runbook edits. */
const SLUG = 'nn-2026';

interface RaceContent {
  entriesOpen: string;
  entriesClose: string;
}

const race = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../apps/main/src/content/race.json', import.meta.url)),
    'utf8',
  ),
) as RaceContent;

/**
 * `Tuesday 1 September 2026, 07:00` — the shape `race.json` publishes.
 *
 * Composed from the two London formatters rather than a fourth one in `london-time.ts`: the
 * weekday is the only part they do not already produce, and adding a helper for one caller
 * would put a second definition of this wording in the repository, which is the thing this
 * file exists to prevent.
 */
function publishedWording(instant: Date): string {
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: LONDON_TIME_ZONE,
  }).format(instant);

  return `${weekday} ${formatLondonDate(instant)}, ${formatLondonTime(instant)}`;
}

async function windowRow(): Promise<{
  entries_open_at: Date | null;
  entries_close_at: Date | null;
}> {
  await connected;
  const { rows } = await db.query(
    'select entries_open_at, entries_close_at from entries.events where slug = $1',
    [SLUG],
  );

  expect(rows, `no event ${SLUG} — has the database been seeded?`).toHaveLength(1);
  return rows[0];
}

afterAll(async () => {
  await connected;
  await db.end();
});

describe('the published entry window and the enforced one', () => {
  it('closes when the page says it closes', async () => {
    const { entries_close_at } = await windowRow();

    expect(
      entries_close_at,
      'entries_close_at is applied — the committee ratified the window and this half was written in',
    ).not.toBeNull();

    expect(
      publishedWording(entries_close_at as Date),
      `race.json publishes "${race.entriesClose}" — the database must shut the form at the same instant`,
    ).toBe(race.entriesClose);
  });

  it('opens when the page says it opens, from the moment anybody sets it', async () => {
    const { entries_open_at } = await windowRow();

    if (entries_open_at === null) {
      // **The pre-open state, and it is deliberate rather than unfinished.** Asserted rather
      // than skipped: a skipped test reads as a pass, and this one is making a claim — that the
      // column really is null, so the page's promise is not yet enforced by anything and the
      // runbook's step 3 has not been run.
      expect(race.entriesOpen.trim().length).toBeGreaterThan(0);
      return;
    }

    expect(
      publishedWording(entries_open_at),
      `race.json publishes "${race.entriesOpen}" — the database must open the form at the same instant. ` +
        'An hour out here is 07:00Z where 07:00+01 was meant, which is the mistake entries-open.md step 3 warns about.',
    ).toBe(race.entriesOpen);
  });
});
