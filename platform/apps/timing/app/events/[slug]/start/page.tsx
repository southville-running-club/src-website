import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { startOutcomeFor } from '../../../../lib/start-outcomes';
import { RaceClock } from './race-clock';

/**
 * `/timing/events/<slug>/start/` — the countdown, the button, and the clock after it.
 *
 * Issue [#250](https://github.com/southville-running-club/src-website/issues/250), under
 * [ADR-034](../../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 * Behind `timing.event.manage`; `lib/access.ts` maps it and `middleware.ts` enforces it. ⚠️
 * **This page does not gate itself** — see `app/page.tsx`'s header for the measurement that
 * settled that, and `app/events/[slug]/page.tsx` for why "Not found" is written out inline
 * rather than thrown.
 *
 * ## ⚠️ The three states are exclusive, and the order they are tested in is the point
 *
 * **Finished first.** `timing.events.finished_at` is a column a row can hold today whether or
 * not any function writes it — [#253](https://github.com/southville-running-club/src-website/issues/253)
 * owns finishing — and a screen offering to start a race that has already been run is the old
 * application's [#23](https://github.com/bindalshah/src-race-timing/issues/23) exactly: it went
 * on showing a start button and a running clock after the finish, and the inconsistency was
 * what people believed. So a finished race gets no button and no ticking clock, and #250 put
 * that in scope from the first version rather than after the first race.
 *
 * **Then started, then not started.** Each renders one block; there is never a page with two
 * buttons on it, which is what keeps a cold thumb from finding the wrong one.
 *
 * ## What this page reads, and why it is not a read of its own
 *
 * `event_detail()` already carries `start_at`, `actually_started_at`, `finished_at` and
 * `counts.crossings` — which is every fact this screen needs, including the one that decides
 * whether a false start can still be cleared. A `start_state()` would be a second statement of
 * the same query, and the rule it would restate (*has anybody been timed yet*) is enforced in
 * `clear_start()` regardless of what this page believes. **The page's job is to not offer what
 * the database would refuse**; the database's job is to refuse it anyway.
 *
 * ## Every instant goes through `london-time.ts`
 *
 * `formatLondon` and nothing else. A bare `toLocale*String` takes the ambient timezone and this
 * race is run the weekend **after** the clocks go back, so an hour of drift here is an hour
 * wrong on the one screen that decides what every result is measured from. The *durations* on
 * this page are `lib/elapsed.ts`, which is deliberately not a timezone question at all — its
 * header carries the argument.
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

export default async function StartPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  // A repeated parameter arrives as an array; only a single value can name an outcome, and an
  // array falls through to `undefined`, which renders nothing.
  const outcomeParam = query.outcome;
  const outcome = startOutcomeFor(
    typeof outcomeParam === 'string' ? outcomeParam : undefined,
  );

  const read = await readTiming<EventDetail>('event_detail', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    return (
      <>
        <h1>Start</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed, and the race has not been started. Try again in a
          moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    // Word for word `app/not-found.tsx`, because a refusal must be indistinguishable from an
    // address that does not exist — `event_detail()` answers the same `null` for both.
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const event = read.data;
  const started = event.actually_started_at;
  const finished = event.finished_at;
  const action = `/timing/events/${encodeURIComponent(slug)}/start/update`;

  return (
    <>
      <h1>Start</h1>

      <p className="lede">
        {event.name}, scheduled to start {formatLondon(event.start_at)}.
      </p>

      {outcome === null ? null : (
        <p
          className={outcome.tone === 'ok' ? 'notice notice-ok' : 'notice notice-bad'}
          // `role="status"` announces nothing here today and is the correct semantic for the
          // content: every path to this message is a full page load after the route handler's
          // 303, so a screen reader reads it in document order, above the block it is about.
          // The roster page's header carries the same note at length.
          role="status"
        >
          {outcome.message}
        </p>
      )}

      {finished !== null ? (
        /*
         * ⚠️ **A finished race gets no button and no ticking clock.** The old application kept
         * showing both after the finish, and #250 names fixing that as in scope from the first
         * version — an inconsistent screen on a start line is believed.
         */
        <section>
          <h2>Race finished</h2>

          <p>
            This race finished {formatLondon(finished)}. Nothing on this screen can change
            that.
          </p>

          <dl>
            <dt>Started</dt>
            <dd>{started === null ? '—' : formatLondon(started)}</dd>

            <dt>Finished</dt>
            <dd>{formatLondon(finished)}</dd>
          </dl>
        </section>
      ) : started !== null ? (
        <section>
          <h2>The race is running</h2>

          <p>
            It started {formatLondon(started)}. Every time in this race is measured from
            that moment, so it cannot be moved by pressing anything again.
          </p>

          <RaceClock mode="elapsed" atIso={started}>
            The elapsed clock needs JavaScript. The race started {formatLondon(started)}.
          </RaceClock>

          <h2>A false start</h2>

          {event.counts.crossings === 0 ? (
            <form method="post" action={action}>
              <input type="hidden" name="intent" value="clear" />

              <p>
                Nobody has been timed in this race yet, so the start can still be cleared.
                That puts the race back to not started and lets its details be corrected
                again.
              </p>

              {/*
                ⚠️ **Not `button-wide`, and not beside the start button.** The full-width
                control is for the one thing this screen is opened to do; this one undoes a
                race and wants to be pressed on purpose. The two are never on the page at
                once, because the states above are exclusive.
              */}
              <button className="button" type="submit">
                Clear the start
              </button>
            </form>
          ) : (
            <p className="notice">
              Somebody has already been timed in this race, so the start can no longer be
              cleared here. Every time recorded is measured from it, and clearing it now
              would silently re-time all of them.
            </p>
          )}
        </section>
      ) : (
        <section>
          <h2>Not started</h2>

          <RaceClock mode="countdown" atIso={event.start_at}>
            The countdown needs JavaScript. The scheduled start is{' '}
            {formatLondon(event.start_at)}, and this race has not started.
          </RaceClock>

          <p>
            {/*
              The migration's own rule, said where somebody can act on it: nothing here reads
              the scheduled time, and `now()` is what gets stored.
            */}
            A clock reaching zero starts nothing. Pressing the button below is what
            records the moment, and every time in the race is measured from it.
          </p>

          <form method="post" action={action}>
            <input type="hidden" name="intent" value="start" />

            <button className="button button-wide" type="submit">
              Start the race
            </button>
          </form>

          <p>
            Pressing it twice does not move the clock. If somebody else has already
            started this race, this page will say so and show their time rather than
            overwriting it.
          </p>
        </section>
      )}

      <p>
        <Link href={`/events/${event.slug}`}>Back to {event.name}</Link>
      </p>
    </>
  );
}
