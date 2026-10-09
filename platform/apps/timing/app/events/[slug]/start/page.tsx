import { formatLondon } from '@src/shared';
import { readEventDetail, raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import type { EventDetail } from '../sections/event-detail';
import { StartSection } from '../sections/start';
import { FinishSection } from '../sections/finish';

export const generateMetadata = raceMetadata('Start');

/**
 * `/timing/events/<slug>/start` — race control: the start, the race clock, and finishing.
 *
 * ADR-055: Pass the Buck's Start page, one of the five the race console became. Its two forms
 * still post where they always did — `start/update` and `finish/update`, each behind
 * `timing.event.manage` at the door and again in the database — and both come back here with
 * `?section=` naming which of the two the `?outcome=` is about, so a message is shown above the
 * block it describes and nowhere else.
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function StartPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const section = one(query.section);
  const outcomeCode = one(query.outcome);

  const detail = await readEventDetail<EventDetail>(slug);

  if (detail.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="start" title="Start." />;
  }

  if (detail.state === 'none') {
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const event = detail.data;

  return (
    <RaceFrame slug={slug} current="start" light>
      <div className="timing-console">
        <PageHead
          eyebrow={raceEyebrow(event.name)}
          title="Start."
          intro={
            <p>
              Start the race when the gun goes, and mark it finished when the last runner
              is in. It is scheduled to start {formatLondon(event.start_at)}.
            </p>
          }
        />

        <div id="start">
          <StartSection
            slug={slug}
            event={event}
            outcomeCode={section === 'finish' ? undefined : outcomeCode}
          />
        </div>

        <div id="finish">
          <h2>Finish</h2>
          <FinishSection
            slug={slug}
            event={event}
            outcomeCode={section === 'finish' ? outcomeCode : undefined}
          />
        </div>
      </div>
    </RaceFrame>
  );
}
