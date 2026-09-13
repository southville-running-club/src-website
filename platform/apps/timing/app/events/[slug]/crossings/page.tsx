import Link from 'next/link';
import { formatLondonClock } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { anomalyOutcomeFor } from '../../../../lib/anomaly-outcomes';

/**
 * `/timing/events/<slug>/crossings/` — every capture on a race, searchable, with inline correction.
 *
 * Issue [#252](https://github.com/southville-running-club/src-website/issues/252). Behind
 * `timing.crossing.resolve`, like the triage list beside it, and gated by `middleware.ts`
 * rather than by this page.
 *
 * ## Why this shows what the anomalies page hides
 *
 * The triage list is the queue: open captures only. This is the **log**, so it shows resolved
 * rows and discarded ones too. ⚠️ **A log that hid what had been taken out would be a log
 * nobody could audit from** — and restoring a discard is only possible if somebody can see it.
 *
 * ## ⚠️ The compare-and-swap here is on the values, not on `resolved_at`
 *
 * A row that was never flagged has `resolved_at` null for ever, so the anomalies page's latch
 * would match every time and two admins correcting the same row would both be told they
 * succeeded, with the later write winning in silence. So each form carries the values it was
 * drawn with, and `edit_crossing()` swaps on those. `20260913220000`'s header carries the
 * argument in full; it is the reason this is a second function rather than an argument to the
 * first.
 *
 * ## ⚠️ The bib is editable here and the time is not, which is a scope boundary
 *
 * `edit_crossing()` takes a `captured_at` and swaps on it, so the contract is complete — this
 * page simply carries the value through unchanged. **Editing a time from a form means a
 * `datetime-local` input, which is a wall clock with no zone**, and this race is run the
 * weekend the clocks go back: an hour of drift on the one value every result is derived from
 * is exactly the foot-gun `packages/shared/src/london-time.ts` exists to prevent and that
 * ESLint bans a bare `toLocale*String` over. Correcting a time is a real need — the
 * before-the-gun marker below is what surfaces it — and it wants a control designed for it
 * rather than one added in passing.
 *
 * ## Cards rather than a table
 *
 * A wide table is what once made a whole page scroll sideways at 320px, through a
 * visually-hidden span inside the scroller. This is read on a phone on a race morning; the
 * cards carry the same facts and cannot overflow.
 */
export const dynamic = 'force-dynamic';

interface LoggedCrossing {
  id: string;
  bib: string | null;
  captured_at: string;
  anomaly_flag: boolean;
  anomaly_reason: string | null;
  resolved_at: string | null;
  resolved_action: string | null;
  source: string;
  team_number: string | null;
  before_start: boolean;
}

/** What one row's state is called on screen. Derived, because it is about the row as it is now. */
function stateOf(crossing: LoggedCrossing): string {
  if (crossing.resolved_action === 'discarded') {
    return 'Discarded — counts towards nothing';
  }

  if (crossing.resolved_action === 'marked_valid') {
    return 'Marked valid';
  }

  if (crossing.resolved_action === 'edited') {
    return 'Bib corrected';
  }

  if (crossing.anomaly_flag) {
    return 'Flagged, not yet resolved';
  }

  return 'Recorded';
}

export default async function CrossingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  const outcomeParam = query.outcome;
  const outcome = anomalyOutcomeFor(
    typeof outcomeParam === 'string' ? outcomeParam : undefined,
  );

  // A repeated parameter arrives as an array; only a single value can be a search.
  const searchParam = query.q;
  const search = typeof searchParam === 'string' ? searchParam : '';

  const read = await readTiming<LoggedCrossing[]>('crossing_log', {
    p_event_slug: slug,
    p_search: search === '' ? null : search,
  });

  if (read.state === 'unavailable') {
    return (
      <>
        <h1>Timing log</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so the log could not be read.
          Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const crossings = read.data;
  const action = `/timing/events/${encodeURIComponent(slug)}/crossings/update`;

  return (
    <>
      <h1>Timing log</h1>

      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      <p>
        <Link href={`/events/${slug}/anomalies`}>Captures waiting to be resolved</Link>
      </p>

      {/* A GET form, so a searched view is a URL somebody can send to the other volunteer —
          the same property `/admin/nn/`'s filters have, and for the same reason. */}
      <form method="get" className="log-search">
        <div className="field">
          <label className="field-label" htmlFor="q">
            Search by bib or team number
          </label>
          <input
            className="field-input"
            id="q"
            name="q"
            type="text"
            inputMode="numeric"
            defaultValue={search}
          />
        </div>
        <button type="submit" className="button">
          Search
        </button>
        {search === '' ? null : (
          <Link className="button button-quiet" href={`/events/${slug}/crossings`}>
            Show everything
          </Link>
        )}
      </form>

      {crossings.length === 0 ? (
        <p>
          {search === ''
            ? 'Nothing has been captured on this race yet.'
            : `No capture on this race carries the bib or team number ${search}.`}
        </p>
      ) : (
        <ul className="triage">
          {crossings.map((crossing) => (
            <li key={crossing.id} className="triage-card">
              <p className="triage-time">
                <span className="triage-time-label">Crossed at</span>{' '}
                {formatLondonClock(crossing.captured_at)}
                {crossing.bib === null ? (
                  <span className="triage-bib">No bib</span>
                ) : (
                  <span className="triage-bib">Bib {crossing.bib}</span>
                )}
              </p>

              <p className="triage-reason">
                {stateOf(crossing)}
                {crossing.team_number === null
                  ? ' · matches no team'
                  : ` · team ${crossing.team_number}`}
              </p>

              {/* ⚠️ A soft warning and never a refusal. A capture timed before the gun is almost
                  always a phone with a wrong clock — the old application found exactly that by
                  surfacing it rather than by rejecting it. */}
              {crossing.before_start ? (
                <p className="triage-reason">
                  <strong>Recorded before this race started.</strong> Usually a phone with
                  the wrong clock — the time is kept exactly as it was captured.
                </p>
              ) : null}

              {crossing.anomaly_reason === null ? null : (
                <p className="triage-reason">{crossing.anomaly_reason}</p>
              )}

              <form method="post" action={action} className="triage-form">
                <input type="hidden" name="crossing_id" value={crossing.id} />
                {/* The values this form was drawn with. `edit_crossing()` swaps on them, so an
                    edit made against a stale page is refused rather than applied on top of
                    somebody else's. */}
                <input type="hidden" name="expected_bib" value={crossing.bib ?? ''} />
                <input
                  type="hidden"
                  name="expected_captured_at"
                  value={crossing.captured_at}
                />

                {crossing.resolved_action === 'discarded' ? (
                  <div className="triage-actions">
                    <button
                      type="submit"
                      name="intent"
                      value="restore"
                      className="button"
                    >
                      Restore this capture
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label className="field-label" htmlFor={`log-bib-${crossing.id}`}>
                        Bib
                      </label>
                      <input
                        className="field-input"
                        id={`log-bib-${crossing.id}`}
                        name="bib"
                        type="text"
                        inputMode="numeric"
                        defaultValue={crossing.bib ?? ''}
                      />
                    </div>
                    <div className="triage-actions">
                      <button type="submit" name="intent" value="edit" className="button">
                        Save this bib
                      </button>
                    </div>
                  </>
                )}
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
