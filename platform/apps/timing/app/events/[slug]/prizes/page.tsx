import { prizeChoicesFrom, resolvePrizeAwards } from '../../../../lib/prizes';
import { readResultsPreview } from '../../../../lib/results-preview';
import { raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import { PrizesSection } from './prizes-section';
import { Presenter, presenterHref } from './presenter';

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
  const choices = prizeChoicesFrom(query);

  // ⚠️ **Presenter mode** (ADR-055) — one prize at a time on a dark screen, for the projector at
  // HQ. Its place is in the address too (`?present=1&prize=N&reveal=1`), so a refresh loses
  // nothing; `presenter.tsx` carries the rest.
  if (query.present === '1') {
    const prize = Number(typeof query.prize === 'string' ? query.prize : '1');
    return (
      <RaceFrame slug={slug} current="prizes" brand>
        <Presenter
          slug={slug}
          raceName={payload.event.name}
          awards={resolvePrizeAwards(payload, choices)}
          choices={choices}
          prize={Number.isInteger(prize) && prize >= 1 ? prize : 1}
          reveal={query.reveal === '1'}
        />
      </RaceFrame>
    );
  }

  return (
    <RaceFrame slug={slug} current="prizes" wide>
      <PageHead
        eyebrow={raceEyebrow(payload.event.name)}
        title="Prizes."
        intro={
          <p>
            The prizes in the order they are read out, with the winner under each. If a
            winner is not here, pass to the next and every prize below recomputes. Present
            them one at a time on the projector with Present the prizes.
          </p>
        }
      />
      <p className="club-btns">
        <a
          className="club-btn club-btn-primary"
          href={presenterHref(slug, choices, { prize: 1 })}
        >
          Present the prizes
        </a>
      </p>
      <PrizesSection slug={slug} payload={payload} choices={choices} />
    </RaceFrame>
  );
}
