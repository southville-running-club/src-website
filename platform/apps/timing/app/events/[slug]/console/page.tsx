import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readPermissions, readTiming } from '../../../../lib/reads';
import { NotFoundBody } from '../../../not-found-body';
import type { EventDetail } from './event-detail';
import { StartSection } from './sections/start';
import { FinishSection } from './sections/finish';
import { StatusSection, type StatusTeam } from './sections/status';
import { AnomaliesSection, type OpenAnomaly } from './sections/anomalies';
import { CrossingsSection, type LoggedCrossing } from './sections/crossings';

/**
 * `/timing/events/<slug>/console` — race night on one screen.
 *
 * [#308](https://github.com/southville-running-club/src-website/issues/308). **Five addresses
 * became this one**: `start`, `finish` and `status`, which are race state, and `anomalies` and
 * `crossings`, which are captures. The finding was a volunteer's, after the first end-to-end run
 * of a race on production — *"far too many sub-pages than was needed"* — and what made it
 * actionable rather than a matter of taste is that the five were only ever **two permissions**
 * between them.
 *
 * ## ⚠️ The door is wider than any section behind it
 *
 * `lib/access.ts` maps this address to `timing.event.manage` **or** `timing.crossing.resolve`,
 * because a page merging both kinds of work cannot demand one without shutting out half its own
 * audience. That is the one place in this application where the door admits somebody who may not
 * use everything behind it, and three things keep it honest:
 *
 * 1. **Sections are drawn per permission.** {@link readPermissions} says what this viewer holds
 *    and each section is rendered only if they hold its own. Somebody with `crossing.resolve`
 *    alone sees triage and the log and **no start button** — because the old application's
 *    defining bug was a nav tab that 403'd whoever tapped it.
 * 2. **No write moved.** Every form still posts to the address it always did — `start/update`,
 *    `finish/update`, `status/update`, `anomalies/update`, `crossings/update` — each still
 *    carrying its own permission in `lib/access.ts`, enforced at the same door. A forged POST to
 *    a section this page did not draw is refused exactly as it always was.
 * 3. **The database refuses anyway.** Every `timing` function re-checks with
 *    `identity.has_permission()` against `auth.uid()`. The conditional render is navigation, and
 *    it is never the thing standing between somebody and a write.
 *
 * ⚠️ **So `permissions` here is not a security boundary and must never be made to look like
 * one.** If a future section is added whose safety depends on this array, that section is wrong.
 *
 * ## Reads
 *
 * `event_detail()` always — it is this page's identity and its not-found answer. The other three
 * are fetched **only when the viewer's permissions make their section visible**, which is the
 * difference between one round trip and four for somebody holding half of them, and it means a
 * viewer is never the reason a read they cannot see happened. They run together rather than in
 * sequence; a console is opened on a start line.
 *
 * ## ⚠️ Which section is open is decided by the URL, not remembered
 *
 * A route handler redirects back here with `?section=…&outcome=…#…`, and that section is opened
 * so the message about what just happened is not hidden inside a collapsed block. The cost is
 * that any *other* section somebody had opened closes on every submit, which is the trade taken
 * deliberately: a result you cannot see reads as a button that did nothing, and that is the more
 * expensive of the two mistakes on a race night.
 *
 * With no `?section=`, **Start and Finish are open** and the rest are closed — the two anybody
 * opens this page to reach, against a timing log that is hundreds of rows long.
 *
 * `<details>` rather than a scripted accordion, because every acceptance spec here runs in a
 * `no-javascript` project and a menu that needs scripting does not open in it at all. The same
 * reasoning as `/events/`'s submenu in `apps/main`.
 */
export const dynamic = 'force-dynamic';

const MANAGE = 'timing.event.manage';
const RESOLVE = 'timing.crossing.resolve';

/** A single string, or `undefined` — a repeated query parameter arrives as an array. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function ConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  const section = one(query.section);
  const outcomeCode = one(query.outcome);

  // ⚠️ Two searches on one page, so two parameter names. `status.tsx` and `crossings.tsx` both
  // carry the argument: a shared `q` would be one control wearing two hats.
  const statusSearch = one(query.status_q) ?? '';
  const logSearch = one(query.log_q) ?? '';

  const permissions = await readPermissions();
  const mayManage = permissions.includes(MANAGE);
  const mayResolve = permissions.includes(RESOLVE);

  const [detail, statusRead, anomaliesRead, logRead] = await Promise.all([
    readTiming<EventDetail>('event_detail', { p_event_slug: slug }),
    mayManage
      ? readTiming<StatusTeam[]>('team_status_list', {
          p_event_slug: slug,
          p_search: statusSearch === '' ? null : statusSearch,
        })
      : null,
    mayResolve
      ? readTiming<OpenAnomaly[]>('open_anomalies', { p_event_slug: slug })
      : null,
    mayResolve
      ? readTiming<LoggedCrossing[]>('crossing_log', {
          p_event_slug: slug,
          p_search: logSearch === '' ? null : logSearch,
        })
      : null,
  ]);

  if (detail.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage**, and said once rather than five times — the five
    // pages this replaced each carried their own copy of this sentence. `lib/reads.ts`'s header
    // carries the argument: a page that says the race does not exist, during a race, is the
    // worst of the three answers.
    return (
      <>
        <h1>Race console</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (detail.state === 'none') {
    // `event_detail()` answers the same `null` for a refusal and for a race that is not there,
    // and `NotFoundBody` is the one wording so this cannot drift from `app/not-found.tsx`.
    return <NotFoundBody />;
  }

  const event = detail.data;

  // ⚠️ A section whose own read failed is drawn with nothing in it rather than not drawn at all.
  // Not drawing it would say the viewer lacks the permission, which is a different and wrong
  // statement — and the notice above only covers `event_detail()`.
  const teams = statusRead?.state === 'ok' ? statusRead.data : [];
  const anomalies = anomaliesRead?.state === 'ok' ? anomaliesRead.data : [];
  const crossings = logRead?.state === 'ok' ? logRead.data : [];

  const openByDefault = new Set(['start', 'finish']);
  const isOpen = (name: string): boolean =>
    section === undefined ? openByDefault.has(name) : section === name;

  return (
    <>
      <h1>Race console</h1>

      <p className="lede">
        {event.name}, scheduled to start {formatLondon(event.start_at)}.
      </p>

      <dl>
        <dt>Crossings recorded</dt>
        <dd>{event.counts.crossings}</dd>
        <dt>Anomalies needing a human</dt>
        <dd>{event.counts.open_anomalies}</dd>
      </dl>

      {mayManage ? (
        <>
          <details className="console-section" id="start" open={isOpen('start')}>
            <summary>
              <h2>Start</h2>
            </summary>
            <StartSection
              slug={slug}
              event={event}
              outcomeCode={section === 'start' ? outcomeCode : undefined}
            />
          </details>

          <details className="console-section" id="finish" open={isOpen('finish')}>
            <summary>
              <h2>Finish</h2>
            </summary>
            <FinishSection
              slug={slug}
              event={event}
              outcomeCode={section === 'finish' ? outcomeCode : undefined}
            />
          </details>

          <details className="console-section" id="status" open={isOpen('status')}>
            <summary>
              <h2>Race status</h2>
            </summary>
            <StatusSection
              slug={slug}
              teams={teams}
              search={statusSearch}
              outcomeCode={section === 'status' ? outcomeCode : undefined}
            />
          </details>
        </>
      ) : null}

      {mayResolve ? (
        <>
          <details className="console-section" id="anomalies" open={isOpen('anomalies')}>
            <summary>
              <h2>Anomalies</h2>
            </summary>
            <AnomaliesSection
              slug={slug}
              anomalies={anomalies}
              outcomeCode={section === 'anomalies' ? outcomeCode : undefined}
            />
          </details>

          <details className="console-section" id="crossings" open={isOpen('crossings')}>
            <summary>
              <h2>Timing log</h2>
            </summary>
            <CrossingsSection
              slug={slug}
              crossings={crossings}
              search={logSearch}
              outcomeCode={section === 'crossings' ? outcomeCode : undefined}
            />
          </details>
        </>
      ) : null}

      <p>
        <Link href={`/events/${event.slug}`}>Back to {event.name}</Link>
      </p>
    </>
  );
}
