import Link from 'next/link';
import { formatLondonClock } from '@src/shared';
import { anomalyOutcomeFor } from '../../../../../lib/anomaly-outcomes';

/**
 * The **Timing log** section of `/timing/events/<slug>/console` — every capture on a race,
 * searchable, with inline correction.
 *
 * ⚠️ **Its own address until [#308](https://github.com/southville-running-club/src-website/issues/308)**.
 * Behind `timing.crossing.resolve`, now this *section's* requirement rather than the address's.
 * **The form still posts to `crossings/update`**, carrying the same permission it always did.
 *
 * ## ⚠️ Its search parameter is `log_q` and was `q`
 *
 * The race status section above it searches too. Two controls named `q` on one page are one
 * control wearing two hats — searching a bib here would silently filter that list as well, and
 * either "Show everyone" would clear both. See `status.tsx`'s header for the other half.
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
export interface LoggedCrossing {
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

export function CrossingsSection({
  slug,
  crossings,
  search,
  outcomeCode,
}: {
  slug: string;
  crossings: LoggedCrossing[];
  search: string;
  /** `?outcome=`, but only when `?section=crossings` says this section owns it. */
  outcomeCode: string | undefined;
}) {
  const outcome = anomalyOutcomeFor(outcomeCode);
  // ⚠️ **The search rides on the action, and it did not before — this was a real bug.**
  // `crossings/update` reads it off `request.url` rather than the body, deliberately, so that a
  // malformed body can still be redirected back to the view it came from. But the action was
  // built without a query string, so `search` there was **always** empty and the handler's own
  // comment — *"the search is carried back"* — described something that never happened. A
  // correction made from a filtered log returned to the whole log. Found while renaming this
  // parameter for #308; the rename is what made it visible.
  const base = `/timing/events/${encodeURIComponent(slug)}/crossings/update`;
  const action = search === '' ? base : `${base}?log_q=${encodeURIComponent(search)}`;

  return (
    <>
      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      {/* ⚠️ "Captures waiting to be resolved" removed by #308 — the triage list is the
          section directly above this one now. */}

      {/* A GET form, so a searched view is a URL somebody can send to the other volunteer —
          the same property `/admin/nn/`'s filters have, and for the same reason. */}
      <form method="get" className="log-search">
        {/* ⚠️ **A GET form submits its own fields and nothing else, so `?section=` is lost on
            submit — and the section this search belongs to collapses under the person using it.**
            #308. The hidden field puts it back. Searching is the one action on the console that
            navigates without a route handler in between, which is why this is the only place
            that needs it. */}
        <input type="hidden" name="section" value="crossings" />
        <div className="field">
          <label className="field-label" htmlFor="log_q">
            Search by bib or team number
          </label>
          <input
            className="field-input"
            id="log_q"
            name="log_q"
            type="text"
            inputMode="numeric"
            defaultValue={search}
          />
        </div>
        <button type="submit" className="button">
          Search
        </button>
        {search === '' ? null : (
          <Link
            className="button button-quiet"
            href={`/events/${slug}/console#crossings`}
          >
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
