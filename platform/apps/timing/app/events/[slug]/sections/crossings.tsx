import Link from 'next/link';
import { formatLondonClock } from '@src/shared';
import { anomalyOutcomeFor } from '../../../../lib/anomaly-outcomes';

/**
 * The timing log on `/timing/events/<slug>/crossings` — every capture on a race, searchable,
 * with inline correction.
 *
 * ⚠️ **A section of the race console after #308, and a page of its own again since ADR-055**:
 * Pass the Buck's navigation, which volunteers found easy, gives each of these its own tab.
 * The form still posts where it always did, carrying the same permission at the door and in
 * the database.
 *
 * ## Its search parameter is `log_q`
 *
 * Named while it shared a page with the roster's search (`status_q`), and kept: the route
 * handler carries it back, and a searched view is a URL somebody may already have sent.
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
 * ## ⚠️ The time is editable since race day, and a crossing can be added
 *
 * [ADR-071](../../../../../../../docs/architecture/decisions/adr-071-a-crossing-can-be-added-and-retimed-from-the-log.md),
 * 1 November 2026. **This section said the time was not editable, and why**: a `datetime-local`
 * is a wall clock with no zone, on a race run the weekend the clocks go back. That reasoning
 * stands and is what the control below is built around rather than against. The box takes a
 * **time and nothing else**; the date is the race's, drawn into `race_date` from the London day
 * its gun went; and `londonWallClockInstant()` in `london-time.ts` is the one conversion, which
 * refuses the repeated and the skipped hour rather than guessing. `lib/typed-time.ts` carries
 * the rest, including why a time nobody touched is posted back as the instant it already was.
 *
 * **A text box, not `type="time"`**, because the iPhone's time picker has no seconds and the
 * marshals' paper does.
 *
 * The add form at the top is for a finish nobody captured — the marshals' paper, copied in
 * afterwards. It posts a uuid drawn fresh into the page, so a double press adds once, and
 * `timing.add_crossing()` refuses a bib nobody wears, a bib that already has a crossing, and a
 * time before the gun or after now.
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

/** The hint under every time box — the three ways a phone's keyboard can type one. */
const TIME_HINT =
  'London time, to the second — 11:47:32, or 114732 on a number pad. The date is the race’s.';

export function CrossingsSection({
  slug,
  crossings,
  search,
  outcomeCode,
  raceDate,
  newCrossingId,
}: {
  slug: string;
  crossings: LoggedCrossing[];
  search: string;
  /** `?outcome=`, from `crossings/update`'s redirect back to the log. */
  outcomeCode: string | undefined;
  /** `YYYY-MM-DD`, the London day the race's gun went — what a typed time is a time *on*. */
  raceDate: string;
  /** Drawn fresh on every render, so a double press of **Add** adds once. */
  newCrossingId: string;
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

      {/* ADR-071. Always open rather than behind a link, because it is used in a run — one
          finish after another, copied off the marshals' paper. ⚠️ **`log-add`, never
          `triage-card`**: the log's tests count `.triage-card` to say how many captures a
          search found, and this is not one. */}
      <section className="log-add" aria-labelledby="log-add-title">
        <h2 id="log-add-title">Add a crossing nobody captured</h2>
        <p className="field-hint">
          For a finish that is on the marshals&rsquo; paper and not below. If the bib is
          already here, correct its time instead.
        </p>
        <form method="post" action={action} className="triage-form">
          <input type="hidden" name="crossing_id" value={newCrossingId} />
          <input type="hidden" name="race_date" value={raceDate} />
          <div className="field">
            <label className="field-label" htmlFor="log-add-bib">
              Bib
            </label>
            <input
              className="field-input"
              id="log-add-bib"
              name="bib"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="log-add-time">
              Time crossed
            </label>
            <p className="field-hint" id="log-add-time-hint">
              {TIME_HINT}
            </p>
            <input
              className="field-input"
              id="log-add-time"
              name="time"
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="log-add-time-hint"
              required
            />
          </div>
          <div className="triage-actions">
            <button type="submit" name="intent" value="add" className="button">
              Add this crossing
            </button>
          </div>
        </form>
      </section>

      {/* A GET form, so a searched view is a URL somebody can send to the other volunteer —
          the same property `/admin/nn/`'s filters have, and for the same reason. */}
      <form method="get" className="log-search">
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
                {/* `record_crossing()` has always allowed `manual` and nothing wrote it until
                    `add_crossing()`, so on this race it means exactly "added from this page". */}
                {crossing.source === 'manual' ? ' · added by hand' : ''}
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
                <input type="hidden" name="race_date" value={raceDate} />

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
                    <div className="field">
                      <label className="field-label" htmlFor={`log-time-${crossing.id}`}>
                        Time crossed
                      </label>
                      <p className="field-hint" id={`log-time-hint-${crossing.id}`}>
                        {TIME_HINT}
                      </p>
                      <input
                        className="field-input"
                        id={`log-time-${crossing.id}`}
                        name="time"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={`log-time-hint-${crossing.id}`}
                        defaultValue={formatLondonClock(crossing.captured_at)}
                      />
                    </div>
                    <div className="triage-actions">
                      <button type="submit" name="intent" value="edit" className="button">
                        Save changes
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
