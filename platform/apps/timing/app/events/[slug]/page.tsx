import { formatLondon } from '@src/shared';
import { hubLive, hubTools, timingHref } from '../../../lib/chrome';
import { readPermissions, readRosteredSlugs, readSignedInAs } from '../../../lib/reads';
import { NotFoundBody } from '../../not-found-body';
import { PlainFrame, RaceFrame } from '../../chrome/frames';
import { Hub, hubTitle } from '../../chrome/hub';
import { raceMetadata, readEventDetail } from '../../../lib/titles';

export const generateMetadata = raceMetadata(null);

/**
 * `/timing/events/<slug>/` — one race's **Home**: Pass the Buck's hub (ADR-055).
 *
 * Club green from edge to edge: the race, where it has got to in one line, the live board, who
 * is signed in, and the tools this admin may use as buttons — built from the nav's own tabs by
 * `hubTools()`, so the two cannot disagree. The race's details are a disclosure at the foot.
 * `app/chrome/hub.tsx` carries the layout's rules.
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
 * carries the measurements. So `app/not-found-body.tsx` — the one wording, rendered by this
 * page and by `app/not-found.tsx` alike — is returned instead, which survives with scripting
 * off. ⚠️ **It survives as a 200 and a refusal at the door is a 404**, which is ADR-044 rather
 * than an oversight; `not-found-body.tsx`'s own header carries the argument and the link.
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

/** Where the race has got to, in one line — Pass the Buck's status line. */
function statusLine(event: EventDetail, resultsHref: string | null) {
  if (event.finished_at !== null || event.results_published_at !== null) {
    return resultsHref === null ? (
      <p>Race complete.</p>
    ) : (
      <p>
        Race complete &mdash; <a href={resultsHref}>view final results</a>
      </p>
    );
  }
  if (event.actually_started_at !== null) {
    return <p>Race in progress. Started {formatLondon(event.actually_started_at)}.</p>;
  }
  return <p>Starts {formatLondon(event.start_at)}.</p>;
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;
  const read = await readEventDetail<EventDetail>(slug);

  if (read.state === 'unavailable') {
    return (
      <RaceFrame slug={slug} current="home">
        <>
          <h1>Race</h1>
          <p className="notice notice-bad">
            The club&rsquo;s database could not be reached, so this race could not be
            read. Nothing has been changed. Try again in a moment.
          </p>
        </>
      </RaceFrame>
    );
  }

  if (read.state === 'none') {
    // `NotFoundBody` rather than the two elements written out here, so the wording cannot
    // drift from `app/not-found.tsx`'s — `event_detail()` answers the same `null` for a
    // refusal and for a race that does not exist, and the body may not tell them apart either.
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const event = read.data;
  const [permissions, rosteredSlugs, signedInAs] = await Promise.all([
    readPermissions(),
    readRosteredSlugs(),
    readSignedInAs(),
  ]);
  const rostered = rosteredSlugs.includes(event.slug);
  const groups = hubTools(permissions, event.slug, rostered);
  const results = groups.flatMap((g) => g.tools).find((t) => t.key === 'results');

  return (
    <RaceFrame slug={slug} current="home" brand>
      <Hub
        eyebrow={event.name}
        title={hubTitle(event.name)}
        status={statusLine(
          event,
          results === undefined ? null : timingHref(results.path),
        )}
        live={hubLive(permissions, event.slug, rostered)}
        signedInAs={signedInAs}
        roleWord="admin"
        groups={groups}
      >
        <details className="timing-hub-details">
          <summary>Race details</summary>
          <dl className="club-meta timing-details">
            <div>
              <dt>Format</dt>
              <dd>{event.format === 'relay' ? 'A relay' : 'A solo race'}</dd>
            </div>
            <div>
              <dt>Scheduled start</dt>
              <dd>{formatLondon(event.start_at)}</dd>
            </div>
            <div>
              <dt>Actually started</dt>
              <dd>{orDash(event.actually_started_at)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{orDash(event.finished_at)}</dd>
            </div>
            <div>
              <dt>Results published</dt>
              <dd>{orDash(event.results_published_at)}</dd>
            </div>
            <div>
              <dt>Entries</dt>
              <dd>
                <span className="timing-mono">{event.counts.teams}</span> (
                <span className="timing-mono">{event.counts.runners}</span> runners)
              </dd>
            </div>
            <div>
              <dt>Marshals rostered</dt>
              <dd className="timing-mono">{event.counts.marshals}</dd>
            </div>
            <div>
              <dt>Crossings</dt>
              <dd className="timing-mono">{event.counts.crossings}</dd>
            </div>
            <div>
              <dt>Open anomalies</dt>
              <dd className="timing-mono">{event.counts.open_anomalies}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{event.distance_m === null ? '—' : `${event.distance_m} m`}</dd>
            </div>
            <div>
              <dt>Course notes</dt>
              <dd>{event.course_notes ?? '—'}</dd>
            </div>
          </dl>
          {event.editable ? null : (
            <p>This race has started, so its details can no longer be changed.</p>
          )}
        </details>
      </Hub>
    </RaceFrame>
  );
}
