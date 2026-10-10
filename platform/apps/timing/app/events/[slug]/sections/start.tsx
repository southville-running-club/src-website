import { formatLondon, formatLondonClock } from '@src/shared';
import { startOutcomeFor } from '../../../../lib/start-outcomes';
import { statusOutcomeFor } from '../../../../lib/status-outcomes';
import { ConfirmStart } from './confirm-start';
import { RaceClock } from './race-clock';
import type { EventDetail } from './event-detail';

/**
 * Race control on `/timing/events/<slug>/start` — the countdown, the button, the clock after
 * it, and finishing.
 *
 * ⚠️ **A section of the race console after #308, and a page of its own again since ADR-055**:
 * Pass the Buck's navigation, which volunteers found easy, gives each of these its own tab.
 * The form still posts where it always did, carrying the same permission at the door and in
 * the database.
 *
 * **Pass the Buck's race control (ADR-055)**: the whole screen is club green, and it is in one
 * of three states, each with one big action — **Runners to the start.** (Start the race),
 * **Race in progress.** (the clock, and Mark race finished), **Race finished.** (Results, and
 * Reopen the race). The state's title is the page's `h1`, because it is what the page is about;
 * finishing and reopening are here rather than a second block below, as they are in Pass the
 * Buck. Their forms still post to `finish/update`, carrying `timing.event.manage` as before.
 *
 * Issue [#250](https://github.com/southville-running-club/src-website/issues/250), under
 * [ADR-034](../../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 * ⚠️ **Nothing here gates itself** — see `app/page.tsx`'s header for the measurement that
 * settled that.
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
// ⚠️ No `export const dynamic` — a section is not a route, and the page that draws it carries
// it. A stray copy here is ignored rather than refused, which is exactly the kind of
// dead declaration a later reader mistakes for something load-bearing.

export function StartSection({
  slug,
  event,
  outcomeCode,
  finishOutcomeCode,
  resultsHref,
}: {
  slug: string;
  event: EventDetail;
  /** `?outcome=` from `start/update`. */
  outcomeCode: string | undefined;
  /** `?outcome=` from `finish/update`, when `?section=finish` says it is that form's. */
  finishOutcomeCode: string | undefined;
  /** The results page, when this person may open it — the link a finished race offers. */
  resultsHref: string | null;
}) {
  const outcome = startOutcomeFor(outcomeCode) ?? statusOutcomeFor(finishOutcomeCode);
  const started = event.actually_started_at;
  const finished = event.finished_at;
  const startAction = `/timing/events/${encodeURIComponent(slug)}/start/update`;
  const finishAction = `/timing/events/${encodeURIComponent(slug)}/finish/update`;

  return (
    <div className="club-wrap timing-go-screen">
      <p className="timing-hub-eyebrow">Start · {event.name}</p>

      {outcome === null ? null : (
        <p
          className={
            outcome.tone === 'ok'
              ? 'timing-go-notice'
              : 'timing-go-notice timing-go-notice-bad'
          }
          // `role="status"` announces nothing here today and is the correct semantic for the
          // content: every path to this message is a full page load after the route handler's
          // 303, so a screen reader reads it in document order, above the block it is about.
          role="status"
        >
          {outcome.message}
        </p>
      )}

      {finished !== null ? (
        /*
         * ⚠️ **A finished race gets no start button and no ticking clock.** The old application
         * kept showing both after the finish, and #250 names fixing that as in scope from the
         * first version — an inconsistent screen on a start line is believed.
         */
        <section className="timing-go-hero" aria-labelledby="race-state">
          <h1 id="race-state">Race finished.</h1>
          <p className="timing-go-big">
            <span aria-hidden="true">✓ </span>Race marked finished at{' '}
            <span className="timing-mono">{formatLondonClock(finished)}</span>
          </p>
          {resultsHref === null ? null : (
            <p>
              <a className="club-btn timing-btn-dark timing-go-action" href={resultsHref}>
                Results <span aria-hidden="true">→</span>
              </a>
            </p>
          )}
          <form method="post" action={finishAction}>
            <input type="hidden" name="intent" value="reopen" />
            <button type="submit" className="club-btn timing-hub-outline">
              Reopen the race
            </button>
          </form>
          <p className="timing-go-small">
            Started {started === null ? '—' : formatLondon(started)}, finished{' '}
            {formatLondon(finished)}. Finishing is a label, not a cut-off: crossings can
            still be recorded and corrected. Reopen it only if it was called too early.
          </p>
        </section>
      ) : started !== null ? (
        <section className="timing-go-hero" aria-labelledby="race-state">
          <h1 id="race-state">Race in progress.</h1>
          <p className="timing-go-big">Have a great run.</p>

          <RaceClock mode="elapsed" atIso={started}>
            The elapsed clock needs JavaScript. The race started {formatLondon(started)}.
          </RaceClock>

          <form method="post" action={finishAction}>
            <input type="hidden" name="intent" value="finish" />
            <button type="submit" className="club-btn timing-btn-dark timing-go-action">
              Mark race finished
            </button>
          </form>
          <p className="timing-go-small">
            It started {formatLondon(started)}. Every time in this race is measured from
            that moment. Marking it finished is a <strong>label, not a cut-off</strong>:
            the last runner&rsquo;s crossing still counts, and it can be undone.
          </p>

          {event.counts.crossings === 0 ? (
            <form method="post" action={startAction} className="timing-go-secondary">
              <input type="hidden" name="intent" value="clear" />
              <h2>A false start</h2>
              <p className="timing-go-small">
                Nobody has been timed yet, so the start can still be cleared. That puts
                the race back to not started.
              </p>
              {/*
                ⚠️ **Not the full-width action, and away from it.** This one undoes a race and
                wants to be pressed on purpose.
              */}
              <button className="club-btn timing-hub-outline" type="submit">
                Clear the start
              </button>
            </form>
          ) : (
            <p className="timing-go-small timing-go-secondary">
              Somebody has already been timed in this race, so the start can no longer be
              cleared here. Every time recorded is measured from it, and clearing it now
              would silently re-time all of them.
            </p>
          )}
        </section>
      ) : (
        <section className="timing-go-hero" aria-labelledby="race-state">
          <h1 id="race-state">Runners to the start.</h1>
          <p className="timing-go-big">
            Scheduled for{' '}
            <span className="timing-mono">{formatLondonClock(event.start_at)}</span>
          </p>

          <RaceClock mode="countdown" atIso={event.start_at}>
            The countdown needs JavaScript. The scheduled start is{' '}
            {formatLondon(event.start_at)}, and this race has not started.
          </RaceClock>

          <form method="post" action={startAction}>
            <input type="hidden" name="intent" value="start" />
            {/* D4: asked twice with scripting on, once without — `confirm-start.tsx`. */}
            <ConfirmStart />
          </form>

          <p className="timing-go-small">
            {/*
              The migration's own rule, said where somebody can act on it: nothing here reads
              the scheduled time, and `now()` is what gets stored.
            */}
            A clock reaching zero starts nothing. Pressing the button is what records the
            moment. Pressing it twice does not move the clock: if somebody else has
            already started this race, this page shows their time rather than overwriting
            it.
          </p>
        </section>
      )}
    </div>
  );
}
