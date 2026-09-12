import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../lib/reads';

/**
 * `/timing/events/` — every race this system knows about.
 *
 * Behind `timing.event.manage`, which `lib/access.ts` already maps and `middleware.ts` already
 * enforces. ⚠️ **This page does not gate itself**, for the reason `app/page.tsx`'s header
 * gives: `notFound()` from a dynamic render returns an empty shell, which is blank with
 * JavaScript off. Refusal happens before this file runs.
 *
 * ## Why a description list and not a table
 *
 * `base.css` has no table system, and that is a decision rather than a gap — its own header
 * says *"Description lists, not tables"*. The alternative was importing `nn-admin.css`, which
 * needs `class="admin"` on `<body>`, which would change every page in this application
 * including the not-found page that a refused request is served. Two pages are not worth that,
 * and a list of races reads perfectly well as a list.
 */
export const dynamic = 'force-dynamic';

interface EventRow {
  slug: string;
  name: string;
  format: string;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
  teams: number;
  open_anomalies: number;
}

/**
 * Where a race has got to, from the two timestamps that exist.
 *
 * ⚠️ **There is deliberately no "published" state here.** Publication is
 * [#241](https://github.com/southville-running-club/src-website/issues/241), which owns both
 * the column and the state machine; `timing.events` has no `results_published_at` yet.
 * Inventing a fourth word for a state nothing can reach would be a page describing a lifecycle
 * the database does not have.
 */
function stage(row: EventRow): string {
  if (row.finished_at !== null) {
    return 'Finished';
  }

  return row.actually_started_at === null ? 'Not started' : 'Running';
}

export default async function EventsPage() {
  const read = await readTiming<EventRow[]>('list_events');

  if (read.state === 'unavailable') {
    return (
      <>
        <h1>Races</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this list is not available.
          Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  // `none` reaches here only if the cookie went missing between the gate and the render, since
  // `list_events()` answers `[]` rather than null for somebody who may look and has no races.
  const events = read.state === 'ok' ? read.data : [];

  return (
    <>
      <h1>Races</h1>

      <p className="lede">Every race set up for timing, most recent first.</p>

      {events.length === 0 ? (
        <p>No races have been set up yet.</p>
      ) : (
        <ul className="summary-list">
          {events.map((row) => (
            <li key={row.slug}>
              <h2>
                <Link href={`/events/${row.slug}`}>{row.name}</Link>
              </h2>
              <dl>
                <dt>Starts</dt>
                {/* `formatLondon` and nothing else. A bare `toLocale*String` takes the
                    ambient timezone, and this race is the weekend after the clocks go back. */}
                <dd>{formatLondon(row.start_at)}</dd>

                <dt>Where it has got to</dt>
                <dd>{stage(row)}</dd>

                <dt>Entries</dt>
                <dd>{row.teams}</dd>

                {row.open_anomalies > 0 ? (
                  <>
                    <dt>Needing a human</dt>
                    <dd>{row.open_anomalies}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
