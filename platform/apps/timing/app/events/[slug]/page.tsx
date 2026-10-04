import type { Route } from 'next';
import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { canOpen } from '../../../lib/access';
import { readPermissions, readTiming } from '../../../lib/reads';
import { NotFoundBody } from '../../not-found-body';
import { PlainFrame, RaceFrame } from '../../chrome/frames';
import { raceMetadata, readEventDetail } from '../../../lib/titles';

export const generateMetadata = raceMetadata(null);

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

/** One row of `timing.my_marshal_events()`, the caller's own roster. */
interface MarshalRace {
  slug: string;
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
  const read = await readEventDetail<EventDetail>(slug);

  if (read.state === 'unavailable') {
    return (
      <RaceFrame slug={slug} name={null} current="overview" page="Overview">
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
  const permissions = await readPermissions();
  const base = `/events/${event.slug}`;
  const may = (path: string) => canOpen(permissions, path);

  // Record crossings is offered only to somebody on this race's roster (ADR-054 §3): its door
  // checks the roster, and `canOpen()` cannot.
  const rostered = may('/marshal/any') ? await isRostered(event.slug) : false;

  const phase: Phase =
    event.actually_started_at === null
      ? 'before'
      : event.finished_at === null
        ? 'running'
        : 'finished';

  const raceDay: Card[] = [
    {
      title: 'Race console',
      href: route(`${base}/console`),
      text:
        phase === 'before'
          ? 'Start the race, and everything after the gun: statuses, captures, finishing.'
          : phase === 'running'
            ? 'The race is running. Mark DNS, DNF and DQ, resolve captures, and finish it.'
            : 'The race is finished. A finish can be undone here, and captures still corrected.',
      show: may(`${base}/console`),
    },
    {
      title: 'Record crossings',
      href: route(`/marshal/${event.slug}`),
      text: 'You are on this race’s roster. Open the capture screen on this phone.',
      badge: 'You’re rostered',
      show: rostered,
    },
    {
      title: 'Captures waiting to be resolved',
      href: route(`${base}/console#anomalies`),
      text: 'A capture is here because a marshal’s screen flagged it, or its bib matches nobody.',
      badge:
        event.counts.open_anomalies === 0
          ? undefined
          : `${event.counts.open_anomalies} open`,
      show: may(`${base}/console`),
    },
    {
      title: 'Live leaderboard',
      href: route(`${base}/leaderboard`),
      text: 'The provisional order as crossings arrive, for staff.',
      show: may(`${base}/leaderboard`),
    },
    {
      title: 'Results',
      href: route(`${base}/results`),
      text: 'Check the preview, publish, and run the prize giving.',
      badge: event.results_published_at === null ? undefined : 'Published',
      show: may(`${base}/results`),
    },
  ];

  const beforeRace: Card[] = [
    {
      title: 'Entry list',
      href: route(`${base}/registration`),
      text: 'Import the club’s entries, upload a file, take walk-ins and assign bibs.',
      badge: `${event.counts.teams} ${event.counts.teams === 1 ? 'entry' : 'entries'}`,
      show: may(`${base}/registration`),
    },
    {
      title: 'Marshals',
      href: route(`${base}/marshals`),
      text: 'Who may record crossings on this race.',
      badge: `${event.counts.marshals} rostered`,
      show: may(`${base}/marshals`),
    },
  ];

  const pills = phasePills(phase, base, may, rostered, event.slug);

  return (
    <RaceFrame slug={slug} name={event.name} current="overview" page="Overview" wide>
      <>
        <div className="club-phead">
          <h1>{event.name}</h1>
          <p className="club-lede">{stateLine(event, phase)}</p>
        </div>

        {pills.length === 0 ? null : (
          <p className="club-btns">
            {pills.map((pill, index) => (
              <Link
                key={pill.href}
                href={pill.href}
                className={`club-btn ${index === 0 ? 'club-btn-primary' : 'club-btn-secondary'}`}
              >
                {pill.label}
              </Link>
            ))}
          </p>
        )}
      </>

      {/* The club's facts band, as a rounded band inside the page's wrap rather than edge to
          edge: bleeding out of a wrap needs `100vw`, which counts the scrollbar and scrolls the
          page sideways. */}
      <section className="club-facts timing-facts" aria-labelledby="facts">
        <div>
          <h2 id="facts" className="club-visually-hidden">
            Where it has got to
          </h2>
          <ul>
            <li>
              <b>Starts</b> {formatLondon(event.start_at)}
            </li>
            <li>
              <b>State</b> {PHASE_WORDS[phase]}
            </li>
            <li>
              <b>Entries</b> <span className="club-num">{event.counts.teams}</span> (
              <span className="club-num">{event.counts.runners}</span> runners)
            </li>
            <li>
              <b>Marshals rostered</b>{' '}
              <span className="club-num">{event.counts.marshals}</span>
            </li>
            <li>
              <b>Crossings</b> <span className="club-num">{event.counts.crossings}</span>
            </li>
            <li>
              <b>Anomalies needing a human</b>{' '}
              <span className="club-num">{event.counts.open_anomalies}</span>
            </li>
          </ul>
        </div>
      </section>

      <CardGrid title="Race day" cards={raceDay} />
      <CardGrid title="Before the race" cards={beforeRace} />

      {event.editable ? null : (
        <p className="club-notice">
          This race has started, so its details can no longer be changed.
        </p>
      )}

      <h2 className="timing-section-title">Details</h2>
      <dl className="club-meta timing-details">
        <div>
          <dt>Format</dt>
          <dd>{event.format === 'relay' ? 'A relay' : 'A solo race'}</dd>
        </div>
        <div>
          <dt>Slug</dt>
          <dd>{event.slug}</dd>
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
          <dt>Distance</dt>
          <dd>{event.distance_m === null ? '—' : `${event.distance_m} m`}</dd>
        </div>
        <div>
          <dt>Course notes</dt>
          <dd>{event.course_notes ?? '—'}</dd>
        </div>
      </dl>

      {/*
        ⚠️ **Last, in its own section, styled as danger, and with no count beside it** — #254.
        Every other link on this page is a thing somebody is on their way to do; this one is a
        thing somebody has to go looking for, and the distance is part of the control. The page
        behind it shows the blast radius and asks for the slug to be typed, so the link itself is
        not a guard and is not pretending to be one. **Not hidden once the race has run**, because
        wiping a rehearsal is exactly the thing somebody does after one — see #207.
      */}
      {may(`${base}/danger-zone`) ? (
        <>
          <h2 className="timing-section-title">Starting again</h2>
          <p>
            <Link className="timing-danger-link" href={route(`${base}/danger-zone`)}>
              Wipe this race and start again
            </Link>
          </p>
          <p className="club-small">
            Removes every crossing and every entry. Used between rehearsals.
          </p>
        </>
      ) : null}
    </RaceFrame>
  );
}

type Phase = 'before' | 'running' | 'finished';

const PHASE_WORDS: Readonly<Record<Phase, string>> = {
  before: 'Not started',
  running: 'Running',
  finished: 'Finished',
};

/** The page's lede: where the race is, in one sentence. */
function stateLine(event: EventDetail, phase: Phase): string {
  if (event.results_published_at !== null) {
    return `Finished. Results published ${formatLondon(event.results_published_at)}.`;
  }
  if (phase === 'finished' && event.finished_at !== null) {
    return `Finished ${formatLondon(event.finished_at)}. Results not yet published.`;
  }
  if (phase === 'running' && event.actually_started_at !== null) {
    return `Running. Started ${formatLondon(event.actually_started_at)}.`;
  }
  return `Not started. Starts ${formatLondon(event.start_at)}.`;
}

interface Pill {
  label: string;
  /** A computed address, typed for `typedRoutes`; see {@link route}. */
  href: Route;
}

/**
 * The page's one or two buttons: the job this phase is about, then the next one. The brief's
 * §8.2, drawn only for what this person may open.
 */
function phasePills(
  phase: Phase,
  base: string,
  may: (path: string) => boolean,
  rostered: boolean,
  slug: string,
): Pill[] {
  const raceConsole = { label: 'Open the race console', href: route(`${base}/console`) };
  const options: Pill[] =
    phase === 'before'
      ? [raceConsole, { label: 'Entry list', href: route(`${base}/registration`) }]
      : phase === 'running'
        ? [
            ...(rostered
              ? [{ label: 'Record crossings', href: route(`/marshal/${slug}`) }]
              : []),
            raceConsole,
            {
              label: 'Timing log',
              href: route(`${base}/console?section=crossings#crossings`),
            },
          ]
        : [
            { label: 'Results', href: route(`${base}/results`) },
            { label: 'Live leaderboard', href: route(`${base}/leaderboard`) },
          ];

  const pathOf = (href: string) => href.split(/[?#]/u)[0] ?? href;
  return options
    .filter((pill) =>
      pill.href.startsWith('/marshal/') ? rostered : may(pathOf(pill.href)),
    )
    .slice(0, 2);
}

interface Card {
  title: string;
  /** A computed address, typed for `typedRoutes`; see {@link route}. */
  href: Route;
  text: string;
  badge?: string;
  show: boolean;
}

/** A section of job cards — filtered, never locked, like the area bar's tabs. */
function CardGrid({ title, cards }: { title: string; cards: readonly Card[] }) {
  const shown = cards.filter((card) => card.show);
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby={headingId(title)}>
      <h2 id={headingId(title)} className="timing-section-title">
        {title}
      </h2>
      <ul className="club-g2">
        {shown.map((card) => (
          <li key={card.href}>
            <Link className="club-card club-link-card timing-link-card" href={card.href}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              {card.badge === undefined ? null : (
                <span className="club-badge">{card.badge}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * An address built at runtime, as a `Route`. `typedRoutes` checks a `<Link>`'s href against
 * the app's routes only for literals; every address here is `/events/<slug>/…` or
 * `/marshal/<slug>`, both real routes, built from the slug the page read. `next build` is what
 * catches a wrong one, and `tsc` alone does not until `.next/types` exists (`CLAUDE.md`).
 */
function route(path: string): Route {
  return path as Route;
}

function headingId(title: string): string {
  return `section-${title.toLowerCase().replace(/[^a-z]+/gu, '-')}`;
}

/** Whether the caller is on this race's roster, from their own list. */
async function isRostered(slug: string): Promise<boolean> {
  const read = await readTiming<MarshalRace[]>('my_marshal_events');
  return read.state === 'ok' && read.data.some((race) => race.slug === slug);
}
