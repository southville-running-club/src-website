import Link from 'next/link';
import { formatLondonClock } from '@src/shared';
import { anomalyOutcomeFor } from '../../../../../lib/anomaly-outcomes';

/**
 * The **Anomalies** section of `/timing/events/<slug>/console` — the triage list, where a
 * flagged capture becomes a fact.
 *
 * ⚠️ **Its own address until [#308](https://github.com/southville-running-club/src-website/issues/308)**,
 * which merged it onto the console beside the timing log it used to link to. Behind
 * `timing.crossing.resolve`, which is now this *section's* requirement rather than the
 * address's — the console's door is `timing.event.manage` **or** this one, and somebody holding
 * only `event.manage` sees no triage list. **The form still posts to `anomalies/update`**,
 * carrying `timing.crossing.resolve` as it always did.
 *
 * Issue [#252](https://github.com/southville-running-club/src-website/issues/252), under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 * Behind `timing.crossing.resolve`; `lib/access.ts` maps it and `middleware.ts` enforces it.
 * This page does not gate itself — `app/page.tsx`'s header carries the measurement that settled
 * that.
 *
 * ## ⚠️ Two populations, and the second is the one a clean-looking list would hide
 *
 * A **flagged** capture is the obvious half. The other is an **orphan**: a bib that matched no
 * team, so the trigger left `team_id` null and nothing flagged it — `record_crossing()` stores
 * an unknown bib and never refuses one, because a validator at the line loses the moment. A
 * page showing only `anomaly_flag` would look finished while a runner sat unmatched to
 * anybody. `open_anomalies()` unions the two.
 *
 * ## A manual refresh, deliberately, and not a poll
 *
 * ⚠️ **Two volunteers on this page at once is the normal case**, not the edge one: a race has
 * one triage list and everybody free is looking at it. The answer is not to auto-refresh —
 * every spec here runs in a `no-javascript` project, and a list that moved under somebody
 * mid-decision is worse than one that is a minute old. It is the **database** that settles a
 * race, with a compare-and-swap; this page just has to say so afterwards, and offer a link to
 * look again.
 *
 * ## The reason is the marshal's own words
 *
 * #252 is explicit that the marshal-facing message *is* the reason stored, so there is no kind
 * to switch on and no per-kind UI. Adding an `anomaly_kind` column to make this page prettier
 * is a schema decision for after the race.
 */
export interface OpenAnomaly {
  id: string;
  bib: string | null;
  captured_at: string;
  anomaly_flag: boolean;
  anomaly_reason: string | null;
  source: string;
  orphan: boolean;
  team_number: string | null;
}

export function AnomaliesSection({
  slug,
  anomalies,
  outcomeCode,
}: {
  slug: string;
  anomalies: OpenAnomaly[];
  /** `?outcome=`, but only when `?section=anomalies` says this section owns it. */
  outcomeCode: string | undefined;
}) {
  const outcome = anomalyOutcomeFor(outcomeCode);
  const action = `/timing/events/${encodeURIComponent(slug)}/anomalies/update`;

  return (
    <>
      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      <p>
        A capture is here because a marshal&rsquo;s screen flagged it, or because its bib
        matches no team on this race. <strong>Nothing here is wrong by itself</strong> —
        an anomaly is a question, and resolving one records what somebody decided about
        it.
      </p>

      <p>
        {/* The manual refresh. A plain link to this page's own address, so it works with
            scripting off and cannot move the list under somebody mid-decision. */}
        <Link href={`/events/${slug}/console#anomalies`}>Look again</Link>
        {/* ⚠️ "Every capture on this race" removed by #308 — it is the section directly below
            this one now, and a link from a section to its own neighbour is how a merged screen
            grows back the navigation it was merged to remove. */}
      </p>

      {anomalies.length === 0 ? (
        <p className="notice notice-ok">
          Nothing is waiting to be resolved on this race.
        </p>
      ) : (
        <>
          <h2>
            {anomalies.length}{' '}
            {anomalies.length === 1 ? 'capture is waiting' : 'captures are waiting'}
          </h2>

          <ul className="triage">
            {anomalies.map((anomaly) => (
              <li key={anomaly.id} className="triage-card">
                <p className="triage-time">
                  <span className="triage-time-label">Crossed at</span>{' '}
                  {formatLondonClock(anomaly.captured_at)}
                  {anomaly.bib === null ? (
                    <span className="triage-bib">No bib</span>
                  ) : (
                    <span className="triage-bib">Bib {anomaly.bib}</span>
                  )}
                </p>

                {/* The marshal's own words, rendered as they were stored. See the header. */}
                {anomaly.anomaly_reason === null ? null : (
                  <p className="triage-reason">{anomaly.anomaly_reason}</p>
                )}

                {anomaly.orphan ? (
                  <p className="triage-reason">
                    This bib matches no team on this race, so the capture counts towards
                    nobody.
                  </p>
                ) : (
                  <p className="triage-reason">Team {anomaly.team_number}.</p>
                )}

                {/* ⚠️ **One form per card, with named submit buttons.** A plain
                    `<form method="post">` answered by a route handler and a 303 — not a Server
                    Action — because every spec here runs in a `no-javascript` project.
                    `lib/access.ts`'s `EVENT_SECTION_ACTIONS` carries the full argument. */}
                <form method="post" action={action} className="triage-form">
                  <input type="hidden" name="crossing_id" value={anomaly.id} />

                  <div className="field">
                    <label className="field-label" htmlFor={`bib-${anomaly.id}`}>
                      Corrected bib
                    </label>
                    <p className="field-hint" id={`bib-hint-${anomaly.id}`}>
                      Only needed if you are correcting it. A bib that still matches no
                      team is kept, and the entry list is what has to change next.
                    </p>
                    <input
                      className="field-input"
                      id={`bib-${anomaly.id}`}
                      name="new_bib"
                      type="text"
                      inputMode="numeric"
                      defaultValue={anomaly.bib ?? ''}
                      aria-describedby={`bib-hint-${anomaly.id}`}
                    />
                  </div>

                  <div className="triage-actions">
                    <button
                      type="submit"
                      name="intent"
                      value="marked_valid"
                      className="button"
                    >
                      Mark valid
                    </button>
                    <button type="submit" name="intent" value="edited" className="button">
                      Save corrected bib
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="discarded"
                      className="button button-quiet"
                    >
                      Discard
                    </button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
