import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { statusOutcomeFor } from '../../../../lib/status-outcomes';
import { NotFoundBody } from '../../../not-found-body';

/**
 * `/timing/events/<slug>/finish/` — the race director calls it, and can take it back.
 *
 * Issue [#253](https://github.com/southville-running-club/src-website/issues/253). Behind
 * `timing.event.manage`; `lib/access.ts` maps it and `middleware.ts` enforces it.
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
export const dynamic = 'force-dynamic';

interface EventDetail {
  slug: string;
  name: string;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
  counts: { crossings: number };
}

export default async function FinishPage({
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
  const outcome = statusOutcomeFor(
    typeof outcomeParam === 'string' ? outcomeParam : undefined,
  );

  const read = await readTiming<EventDetail>('event_detail', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage** — and on this page the second sentence matters:
    // somebody who cannot tell an outage from a finished race may press again.
    return (
      <>
        <h1>Finish</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed, and the race has not been finished. Try again in a
          moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    return <NotFoundBody />;
  }

  const event = read.data;
  const action = `/timing/events/${encodeURIComponent(slug)}/finish/update`;

  return (
    <>
      <h1>Finish</h1>

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

      <p>
        <Link href={`/events/${slug}/status`}>Mark somebody DNS, DNF or DQ</Link>
        {' · '}
        <Link href={`/events/${slug}`}>Back to this race</Link>
      </p>
    </>
  );
}
