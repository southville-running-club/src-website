import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../../lib/reads';

/**
 * `/timing/events/<slug>/` — one race, and where it has got to.
 *
 * Behind `timing.event.manage`; `lib/access.ts` maps it and `middleware.ts` enforces it. ⚠️
 * **This page does not gate itself** — see `app/page.tsx`'s header.
 *
 * ## ⚠️ Why "Not found" is rendered inline rather than thrown
 *
 * `notFound()` during a dynamic render — and reading cookies makes every render dynamic —
 * returns an empty `<html id="__next_error__">` shell with the page only in the streamed RSC
 * payload. Signed out that produced no `<h1>`, no banner and no footer in the HTML, and a blank
 * page with JavaScript off, which is a whole Playwright project here. The middleware's header
 * carries the measurements. So the same two sentences `app/not-found.tsx` renders are written
 * out here instead, which survives with scripting off.
 *
 * `event_detail()` answers the same `null` for "you may not" and "no such event", deliberately,
 * so a slug cannot be probed for existence — and this page cannot tell them apart either, which
 * is the point rather than a limitation.
 */
export const dynamic = 'force-dynamic';

interface EventDetail {
  slug: string;
  name: string;
  format: string;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
  /**
   * #241's column, reaching this read with
   * [#205](https://github.com/southville-running-club/src-website/issues/205) — which is where
   * `20260914100000` said the one-line addition belonged, *"in the change that has a page to
   * put it on"*.
   */
  results_published_at: string | null;
  distance_m: number | null;
  course_notes: string | null;
  created_at: string;
  editable: boolean;
  counts: {
    teams: number;
    runners: number;
    crossings: number;
    open_anomalies: number;
    marshals: number;
  };
}

/** Null renders as an em dash, which is `apps/main`'s admin convention for "nothing recorded". */
function orDash(value: string | null): string {
  return value === null ? '—' : formatLondon(value);
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;
  const read = await readTiming<EventDetail>('event_detail', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    return (
      <>
        <h1>Race</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    // Word for word `app/not-found.tsx`, because a refusal must be indistinguishable from an
    // address that does not exist.
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const event = read.data;

  return (
    <>
      <h1>{event.name}</h1>

      <p className="lede">
        {event.format === 'relay' ? 'A relay' : 'A solo race'}, starting{' '}
        {formatLondon(event.start_at)}.
      </p>

      <dl>
        <dt>Slug</dt>
        <dd>{event.slug}</dd>

        <dt>Scheduled start</dt>
        <dd>{formatLondon(event.start_at)}</dd>

        <dt>Actually started</dt>
        <dd>{orDash(event.actually_started_at)}</dd>

        <dt>Finished</dt>
        <dd>{orDash(event.finished_at)}</dd>

        <dt>Results published</dt>
        <dd>{orDash(event.results_published_at)}</dd>

        <dt>Distance</dt>
        <dd>{event.distance_m === null ? '—' : `${event.distance_m} m`}</dd>

        <dt>Course notes</dt>
        <dd>{event.course_notes ?? '—'}</dd>
      </dl>

      <h2>Where it has got to</h2>

      <dl>
        <dt>Entries</dt>
        <dd>{event.counts.teams}</dd>

        <dt>Runners</dt>
        <dd>{event.counts.runners}</dd>

        <dt>Marshals rostered</dt>
        <dd>{event.counts.marshals}</dd>

        <dt>Crossings recorded</dt>
        <dd>{event.counts.crossings}</dd>

        <dt>Anomalies needing a human</dt>
        <dd>{event.counts.open_anomalies}</dd>
      </dl>

      {/*
        ⚠️ **Two links, and the rest are still deliberately absent.** #247 asks this hub to show
        "the next action and nothing that is not yet possible", and linking to a page that does
        not exist is precisely the old application's bug: its marshal navigation carried a
        "Start" tab that 403'd every marshal who tapped it. The roster page exists as of #245,
        the start screen since #250, the entry list since #202, the two resolution surfaces since
        #252, finishing and status since #253 and the danger zone since #254, so all eight are
        linked. Results are #205, which adds its own link here when its page exists.

        The link is unconditional because this address demands `timing.event.manage` and the
        roster demands `timing.marshal.assign`, and nothing guarantees one implies the other.
        `canOpen()` in `lib/access.ts` is what a conditional link would have to ask, and it
        needs the viewer's permissions, which this page does not read — the door does. Showing
        a link that 404s for somebody holding only one of the two would reintroduce exactly the
        bug above, so **if the two permissions ever come apart in practice, this is the line
        that has to learn to ask.** Today `timing-admin` carries all three — the entry list
        demands `timing.registration.import`, which is a third permission again.
      */}
      <h2>Set up</h2>

      <p>
        <Link href={`/events/${event.slug}/registration`}>Entry list for this race</Link>
      </p>

      <p>
        <Link href={`/events/${event.slug}/marshals`}>Marshals for this race</Link>
      </p>

      {/*
        ⚠️ **The start screen is linked whether or not the race has started**, which is the
        opposite of hiding it once it is done. It is the page that says *when* the race started
        and how long it has been running, and it is where a false start is cleared — so a
        volunteer looking for any of those after the gun must not find the link gone. The page
        itself decides what it offers; this is a route to it, not a button.
      */}
      <p>
        <Link href={`/events/${event.slug}/start`}>
          {event.actually_started_at === null
            ? 'Start this race'
            : 'The start of this race'}
        </Link>
      </p>

      {/*
        ⚠️ **The count above is a figure and this is the queue it counts** — #252. They are
        deliberately not one link with a number in it.

        ⚠️ **This note used to say the two disagreed, and since #205 they do not.**
        `event_detail`'s `open_anomalies` counted only the *flagged* half while the anomalies
        page also shows orphans, so the hub could read "0" beside a queue with three rows on it
        — and, worse, beside a publish button refusing for open anomalies. `20260914140000`
        moved both to `timing.open_anomaly_count()`, which is the one statement of that
        predicate. A link carrying the number would now be honest; it is still two things
        because a figure and a queue are two things.

        Both demand `timing.crossing.resolve`, which is a fourth permission again — see the
        note above about what has to change here if these ever come apart in practice.
      */}
      <h2>During and after the race</h2>

      <p>
        <Link href={`/events/${event.slug}/anomalies`}>
          Captures waiting to be resolved
        </Link>
      </p>

      <p>
        <Link href={`/events/${event.slug}/crossings`}>Timing log for this race</Link>
      </p>

      {/*
        ⚠️ **Both are linked whether or not the race has finished**, for the start screen's
        reason one section up: finishing is a label rather than a state that closes anything, and
        the pages behind these links are where a status is set *and* where a finish is undone. A
        volunteer looking for either after the gun must not find the link gone.
      */}
      <p>
        <Link href={`/events/${event.slug}/status`}>Mark somebody DNS, DNF or DQ</Link>
      </p>

      <p>
        <Link href={`/events/${event.slug}/finish`}>
          {event.finished_at === null ? 'Finish this race' : 'This race is finished'}
        </Link>
      </p>

      {/*
        ⚠️ **Linked in every state, like the two above and for the same reason.** The results
        preview is where somebody checks the times *before* calling the race over, where they
        publish once it is, and where they take a published table down to correct it — so it is
        useful at every point on #241's state machine and the link may never be conditional on
        one of them.
      */}
      <p>
        <Link href={`/events/${event.slug}/results`}>
          {event.results_published_at === null
            ? 'Results for this race'
            : 'Results for this race — published'}
        </Link>
      </p>

      <p>
        <Link href={`/events/${event.slug}/prizes`}>Prize giving for this race</Link>
      </p>

      {event.editable ? null : (
        <p className="notice">
          This race has started, so its details can no longer be changed.
        </p>
      )}

      {/*
        ⚠️ **Linked from the bottom, in its own section, and with no count beside it** — #254.
        Every other link on this page is a thing somebody is on their way to do; this one is a
        thing somebody has to go looking for, and the distance is part of the control. The page
        behind it shows the blast radius and asks for the slug to be typed, so the link itself
        is not a guard and is not pretending to be one.

        Unconditional, like the six above, and for the same reason: `timing.event.manage` is
        what both this address and that one demand, so a viewer reading this page can open it.
        **Not hidden once the race has run**, because wiping a rehearsal is exactly the thing
        somebody does after one — see #207.
      */}
      <h2>Starting again</h2>

      <p>
        <Link href={`/events/${event.slug}/danger-zone`}>
          Wipe this race and start again
        </Link>
      </p>

      <p>
        <Link href="/events">All races</Link>
      </p>
    </>
  );
}
