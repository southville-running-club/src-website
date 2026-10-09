import { readTiming } from '../../../../lib/reads';
import { readEventDetail, raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import type { EventDetail } from '../sections/event-detail';
import { CrossingsSection, type LoggedCrossing } from '../sections/crossings';

export const generateMetadata = raceMetadata('Timing log');

/**
 * `/timing/events/<slug>/crossings` — every capture on the race, newest first, searchable and
 * correctable. ADR-055: Pass the Buck's Timing log, one of the five the race console became.
 *
 * Behind `timing.crossing.resolve`, with the same `event_detail()` caveat the anomalies page
 * carries in its header.
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
    readTiming<LoggedCrossing[]>('crossing_log', {
      p_event_slug: slug,
      p_search: search === '' ? null : search,
    }),
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
  // ⚠️ A list whose own read failed is drawn empty rather than not drawn — and says so, because
  // an empty list on its own reads as "nothing here", which is a claim about the race.
  const rows = list.state === 'ok' ? list.data : [];
  const unread = list.state !== 'ok';

  return (
    <RaceFrame slug={slug} current="crossings">
      <div className="timing-console">
        <PageHead
          eyebrow={raceEyebrow(event.name)}
          title="Timing log."
          intro={
            <p>
              Every capture recorded on this race. Search for one, then correct its bib.
              Times are Europe/London.
            </p>
          }
          status={{
            count: `${rows.length} ${rows.length === 1 ? 'capture' : 'captures'}${search === '' ? '' : ' matching'}`,
            refresh: `/timing/events/${encodeURIComponent(slug)}/crossings`,
          }}
        />

        {unread ? (
          <p className="club-notice timing-notice-bad">
            The club&rsquo;s database could not be reached, so this list could not be
            read. Nothing has been changed. Try again in a moment.
          </p>
        ) : null}

        <div id="crossings">
          <CrossingsSection
            slug={slug}
            crossings={rows}
            search={search}
            outcomeCode={outcomeCode}
          />
        </div>
      </div>
    </RaceFrame>
  );
}
