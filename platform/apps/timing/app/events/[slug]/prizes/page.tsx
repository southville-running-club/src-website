import { prizeChoicesFrom } from '../../../../lib/prizes';
import { readResultsPreview } from '../../../../lib/results-preview';
import { raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import { PrizesSection } from './prizes-section';

export const generateMetadata = raceMetadata('Prizes');

/**
 * `/timing/events/<slug>/prizes` — the prize giving, read out in order. ADR-055: Pass the Buck's
 * Prizes tab, a section of the results page since #308 and its own page again.
 *
 * Behind `timing.result.publish`, the results page's own permission, and it reads the same
 * `results_preview()`. `prizes-section.tsx`' header carries the presenter's own rules: every
 * choice lives in the address, and nothing here needs JavaScript.
 */
export const dynamic = 'force-dynamic';

export default async function PrizesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const read = await readResultsPreview(slug);

  if (read.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="prizes" title="Prizes." />;
  }

  if (read.state === 'none') {
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const payload = read.data;

  return (
    <RaceFrame slug={slug} current="prizes" wide>
      <PageHead
        eyebrow={raceEyebrow(payload.event.name)}
        title="Prizes."
        intro={
          <p>
            The prizes in the order they are read out, with the winner under each. If a
            winner is not here, pass to the next and every prize below recomputes.
          </p>
        }
      />
      <PrizesSection slug={slug} payload={payload} choices={prizeChoicesFrom(query)} />
    </RaceFrame>
  );
}
