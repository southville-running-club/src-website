import { readTiming } from '../../../../lib/reads';
import { readEventDetail, raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import type { EventDetail } from '../sections/event-detail';
import { AnomaliesSection, type OpenAnomaly } from '../sections/anomalies';

export const generateMetadata = raceMetadata('Anomalies');

/**
 * `/timing/events/<slug>/anomalies` — the review queue. ADR-055: Pass the Buck's Anomalies page,
 * one of the five the race console became.
 *
 * ⚠️ **The door is `timing.crossing.resolve`, and the page also reads `event_detail()`, which
 * needs `timing.event.manage`.** So somebody holding resolve alone would get the not-found page.
 * That is the console's latent defect carried over unchanged, not a new one: no role holds
 * resolve without manage (`identity-permissions.test.ts`), so nobody meets it today. Inventory
 * §1.4 #1 records it; fixing it means a read resolve-holders may call, which is a grant.
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function AnomaliesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const outcomeCode = one(query.outcome);

  const [detail, list] = await Promise.all([
    readEventDetail<EventDetail>(slug),
    readTiming<OpenAnomaly[]>('open_anomalies', { p_event_slug: slug }),
  ]);

  if (detail.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="anomalies" title="Anomalies." />;
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
    <RaceFrame slug={slug} current="anomalies">
      <div className="timing-console">
        <PageHead
          eyebrow={raceEyebrow(event.name)}
          title="Anomalies."
          intro={
            <p>
              Captures land here when a marshal&rsquo;s screen flagged them, or when their
              bib matched no entry. Mark each one valid, give it the right bib, or discard
              it from the results.
            </p>
          }
          status={{
            count: `${rows.length} open ${rows.length === 1 ? 'anomaly' : 'anomalies'}`,
            refresh: `/timing/events/${encodeURIComponent(slug)}/anomalies`,
          }}
        />

        {unread ? (
          <p className="club-notice timing-notice-bad">
            The club&rsquo;s database could not be reached, so this list could not be
            read. Nothing has been changed. Try again in a moment.
          </p>
        ) : null}

        <div id="anomalies">
          <AnomaliesSection slug={slug} anomalies={rows} outcomeCode={outcomeCode} />
        </div>
      </div>
    </RaceFrame>
  );
}
