import { readTiming } from '../../../../lib/reads';
import { readEventDetail, raceMetadata } from '../../../../lib/titles';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import type { EventDetail } from '../sections/event-detail';
import { StatusSection, type StatusTeam } from '../sections/status';

export const generateMetadata = raceMetadata('Roster');

/**
 * `/timing/events/<slug>/roster` — every entry on the race, and DNS, DNF and DQ. ADR-055: Pass
 * the Buck's Roster, which is where its volunteers fixed an entry on the night.
 *
 * Behind `timing.event.manage`, because `team_status_list()` is — the race status section the
 * console carried, on a page of its own. Fixing a name or a bib stays on Registrations, where
 * `timing.registration.import` already governs it; a marshal does not see this page, because
 * nobody has decided a marshal should read the field's names (ADR-055).
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const outcomeCode = one(query.outcome);
  const search = one(query.status_q) ?? '';

  const [detail, list] = await Promise.all([
    readEventDetail<EventDetail>(slug),
    readTiming<StatusTeam[]>('team_status_list', {
      p_event_slug: slug,
      p_search: search === '' ? null : search,
    }),
  ]);

  if (detail.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="roster" title="Roster." />;
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
    <RaceFrame slug={slug} current="roster">
      <div className="timing-console">
        <PageHead
          eyebrow={raceEyebrow(event.name)}
          title="Roster."
          intro={
            <p>
              Every entry on this race. Search for a runner by bib or name, and mark them
              as not started, not finished or disqualified &mdash; or lift a mark made in
              error.
            </p>
          }
          status={{
            count: `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}${search === '' ? '' : ' matching'}`,
            refresh: `/timing/events/${encodeURIComponent(slug)}/roster`,
          }}
        />

        {unread ? (
          <p className="club-notice timing-notice-bad">
            The club&rsquo;s database could not be reached, so this list could not be
            read. Nothing has been changed. Try again in a moment.
          </p>
        ) : null}

        <div id="status">
          <StatusSection
            slug={slug}
            teams={rows}
            search={search}
            outcomeCode={outcomeCode}
          />
        </div>
      </div>
    </RaceFrame>
  );
}
