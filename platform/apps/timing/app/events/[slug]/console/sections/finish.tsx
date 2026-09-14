import { formatLondon } from '@src/shared';
import { statusOutcomeFor } from '../../../../../lib/status-outcomes';
import type { EventDetail } from '../event-detail';

/**
 * The **Finish** section of `/timing/events/<slug>/console` — the race director calls it, and
 * can take it back.
 *
 * Issue [#253](https://github.com/southville-running-club/src-website/issues/253). ⚠️ **Its own
 * address until [#308](https://github.com/southville-running-club/src-website/issues/308)**,
 * which merged five pages into the console after a volunteer ran a race end to end and found the
 * navigation the tiring part. Behind `timing.event.manage`, which is now the *section's*
 * requirement rather than the address's: the console's door is that permission **or**
 * `timing.crossing.resolve`, and `console/page.tsx` renders this only for somebody holding this
 * one. **The form still posts to `finish/update`**, which still carries `timing.event.manage` in
 * `lib/access.ts`, so nothing here is protected by the conditional render.
 *
 * ## ⚠️ Finishing is reversible, a label, and never a gate
 *
 * Nothing stops working when a race is finished: crossings still land, bibs are still corrected,
 * a status can still be set. **The last runner's crossing arrives after the race director has
 * called it** — a finish that refused it would lose exactly the result it was declaring. The
 * page says that in as many words under the button, because a volunteer who believed otherwise
 * would stop capturing, and that is the one misunderstanding this screen can cause.
 *
 * ## ⚠️ What #253 asks for and this does not do
 *
 * **Reopening is not refused while results are published.** `timing.events` has no
 * `results_published_at` column — publication is
 * [#241](https://github.com/southville-running-club/src-website/issues/241), which owns the
 * column and the state machine, and #253's own text calls that ordering *"the one ordering #241
 * enforces"*. Two migrations have already declined to invent it rather than render a lifecycle
 * state nothing can reach. `20260913240000`'s header carries the decision in full.
 *
 * ## One read, and it is `event_detail()`
 *
 * It already carries `finished_at` and `actually_started_at`, which is every fact this screen
 * needs. A `finish_state()` would be a second statement of the same query.
 */
// ⚠️ No `export const dynamic` — a section is not a route. `console/page.tsx` carries it for
// all five, and a stray copy here would be silently ignored rather than fail, which is the
// kind of dead declaration somebody later reads as load-bearing.

/**
 * ⚠️ **The read moved out and the outage wording went with it.** This used to answer
 * *"the club's database could not be reached … the race has not been finished"* for its own
 * failed read. `console/page.tsx` does the one `event_detail()` read for every section that
 * needs it and renders that message once, so a single outage says one thing rather than five.
 * The second sentence — *nothing has been changed* — still matters for exactly this section's
 * reason and is kept there.
 */
export function FinishSection({
  slug,
  event,
  outcomeCode,
}: {
  slug: string;
  event: EventDetail;
  /** `?outcome=` only when `?section=finish` says this section owns it. */
  outcomeCode: string | undefined;
}) {
  const outcome = statusOutcomeFor(outcomeCode);
  const action = `/timing/events/${encodeURIComponent(slug)}/finish/update`;

  return (
    <>
      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      <dl>
        <dt>Scheduled start</dt>
        <dd>{formatLondon(event.start_at)}</dd>
        <dt>Actually started</dt>
        <dd>
          {event.actually_started_at === null
            ? 'Not started'
            : formatLondon(event.actually_started_at)}
        </dd>
        <dt>Finished</dt>
        <dd>
          {event.finished_at === null ? 'Not finished' : formatLondon(event.finished_at)}
        </dd>
        <dt>Crossings recorded</dt>
        <dd>{event.counts.crossings}</dd>
      </dl>

      {event.finished_at === null ? (
        <>
          <form method="post" action={action}>
            <input type="hidden" name="intent" value="finish" />
            <button type="submit" className="button button-wide">
              Finish this race
            </button>
          </form>

          {/* ⚠️ The sentence that stops somebody putting their phone away. It is the one
              misunderstanding this screen can cause, so it sits under the button rather than
              somewhere further up the page. */}
          <p>
            Finishing is a <strong>label, not a cut-off</strong>. Crossings can still be
            recorded and corrected afterwards, which is what happens every time — the last
            runner crosses after somebody has called the race. It can be undone here too.
          </p>
        </>
      ) : (
        <>
          <p className="notice notice-ok">
            This race is finished. Marshals can still record crossings, and captures can
            still be corrected.
          </p>

          <form method="post" action={action}>
            <input type="hidden" name="intent" value="reopen" />
            <button type="submit" className="button button-quiet">
              This race is not finished after all
            </button>
          </form>
        </>
      )}

      {/* ⚠️ Two links removed by #308 rather than lost. "Mark somebody DNS, DNF or DQ" pointed
          at `status`, which is now the section directly below this one, and "Back to this race"
          is the console's own nav. A link to a sibling section on the same page is how a merged
          screen quietly becomes as tiring to use as the five it replaced. */}
    </>
  );
}
