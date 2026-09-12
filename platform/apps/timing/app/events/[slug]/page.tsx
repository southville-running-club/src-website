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
        ⚠️ **No section navigation, deliberately.** #247 asks this hub to show "the next action
        and nothing that is not yet possible" — and none of the sections it would link to is
        built: the entry list is #202, the roster page is #245, starting is #250, finishing is
        #253, results are #205. Linking to them would be linking to 404s, which is precisely
        the old application's bug: its marshal navigation carried a "Start" tab that 403'd every
        marshal who tapped it. Each issue adds its own link here when its page exists.
      */}
      {event.editable ? null : (
        <p className="notice">
          This race has started, so its details can no longer be changed.
        </p>
      )}

      <p>
        <Link href="/events">All races</Link>
      </p>
    </>
  );
}
