import { londonCivilDate } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { raceDateValue } from '../../../../lib/typed-time';
import { readEventDetail, raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import type { EventDetail } from '../sections/event-detail';
import { CrossingsSection, type LoggedCrossing } from '../sections/crossings';
import {
  CROSSING_LOG_LIMIT,
  crossingLogArgs,
  crossingLogCapped,
  crossingLogCount,
} from '../../../../lib/crossing-log';

export const generateMetadata = raceMetadata('Timing log');

/**
 * `/timing/events/<slug>/crossings` — every capture on the race, newest first, searchable and
 * correctable. ADR-055: Pass the Buck's Timing log, one of the five the race console became.
 *
 * Behind `timing.crossing.resolve`, with the same `event_detail()` caveat the anomalies page
 * carries in its header.
 *
 * ⚠️ **It asks for every capture, and until 1 November 2026 it asked for the newest 200** —
 * `crossing_log()`'s default, taken by not passing a limit. `lib/crossing-log.ts` says why
 * that hid the first finishers and what the status line now claims.
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function TimingLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const outcomeCode = one(query.outcome);
  const search = one(query.log_q) ?? '';

  const [detail, list] = await Promise.all([
    readEventDetail<EventDetail>(slug),
    readTiming<LoggedCrossing[]>('crossing_log', crossingLogArgs(slug, search)),
  ]);

  if (detail.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="crossings" title="Timing log." />;
  }

  if (detail.state === 'none') {
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const event = detail.data;
  // ADR-071: the London day the gun went, which is what a typed time is a time *on*. The
  // scheduled start stands in until the race has started, and the two are the same day.
  const raceDate = raceDateValue(
    londonCivilDate(event.actually_started_at ?? event.start_at),
  );
  // ⚠️ A list whose own read failed is drawn empty rather than not drawn — and says so, because
  // an empty list on its own reads as "nothing here", which is a claim about the race.
  const rows = list.state === 'ok' ? list.data : [];
  const unread = list.state !== 'ok';
  const capped = crossingLogCapped(rows.length);

  return (
    <RaceFrame slug={slug} current="crossings">
      <div className="timing-console">
        <PageHead
          eyebrow={raceEyebrow(event.name)}
          title="Timing log."
          intro={
            <p>
              Every capture recorded on this race. Search for one, then correct its bib or
              its time, or add a finish nobody captured. Times are Europe/London.
            </p>
          }
          status={{
            count: crossingLogCount(rows.length, search),
            refresh: `/timing/events/${encodeURIComponent(slug)}/crossings`,
          }}
        />

        {unread ? (
          <p className="club-notice timing-notice-bad">
            The club&rsquo;s database could not be reached, so this list could not be
            read. Nothing has been changed. Try again in a moment.
          </p>
        ) : null}

        {/* Said out loud rather than left to the count, because a list that stops is otherwise
            indistinguishable from a race that did. */}
        {capped ? (
          <p className="club-notice">
            Only the newest {CROSSING_LOG_LIMIT} captures are shown. Search by bib or team
            number to find an older one.
          </p>
        ) : null}

        <div id="crossings">
          <CrossingsSection
            slug={slug}
            crossings={rows}
            search={search}
            outcomeCode={outcomeCode}
            raceDate={raceDate}
            // A new id on every render — `force-dynamic` above — so each add form posts its own.
            newCrossingId={crypto.randomUUID()}
          />
        </div>
      </div>
    </RaceFrame>
  );
}
