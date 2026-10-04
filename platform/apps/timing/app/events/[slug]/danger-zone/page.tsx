import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { resetOutcomeFor } from '../../../../lib/reset-outcomes';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { WipeConfirm } from './wipe-confirm';
import { raceMetadata, readEventDetail } from '../../../../lib/titles';

export const generateMetadata = raceMetadata('Danger zone');

/**
 * `/timing/events/<slug>/danger-zone/` — wiping a rehearsal.
 *
 * Issue [#254](https://github.com/southville-running-club/src-website/issues/254). Behind
 * `timing.event.manage`; `lib/access.ts` maps both this address and the one the form posts to,
 * and `middleware.ts` enforces them. ⚠️ **This page does not gate itself** — `app/page.tsx`'s
 * header carries the measurement that settled that for every page here.
 *
 * ## ⚠️ The typing is the modal
 *
 * There is no "are you sure?" on top of the typed confirmation, deliberately. A confirm dialog
 * is a reflex — the second press is the same press — and it is also a scripted control, which
 * this application cannot rely on at all: every Playwright project here runs with JavaScript
 * off, and a `no-javascript` volunteer would be handed a button with no guard in front of it.
 * **Copying the slug out of the page and typing it back in is the one guard that is slower than
 * a reflex and works with scripting off**, and `reset_event()` checks the phrase itself, so a
 * POST that never saw this page meets exactly the same control.
 *
 * ## A published race is refused before the press now
 *
 * `reset_event()` refuses a published race with `published`. This page used to be unable to
 * say so beforehand, because `event_detail()` did not carry `results_published_at`, and its
 * header said that the day it did, the page should show it and stop offering the button. It
 * does now (#205), so a published race renders the button disabled with the reason beside it.
 * The refusal in the database is unchanged and still the guard.
 *
 * ## One read, and it is `event_detail()`
 *
 * It already carries every count the blast radius is made of — entries, runners, crossings,
 * marshals — plus the two timestamps the reset clears. A `reset_state()` would be a second
 * statement of the same query, which is what `finish/page.tsx` said about its own screen.
 */
export const dynamic = 'force-dynamic';

interface EventDetail {
  slug: string;
  name: string;
  actually_started_at: string | null;
  finished_at: string | null;
  results_published_at: string | null;
  counts: {
    teams: number;
    runners: number;
    crossings: number;
    open_anomalies: number;
    marshals: number;
  };
}

/** Null renders as an em dash, which is the convention every other page here uses. */
function orDash(value: string | null): string {
  return value === null ? '—' : formatLondon(value);
}

export default async function DangerZonePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  const outcomeParam = query.outcome;
  const outcome = resetOutcomeFor(
    typeof outcomeParam === 'string' ? outcomeParam : undefined,
  );

  const read = await readEventDetail<EventDetail>(slug);

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage**, and on this page the third sentence is the one
    // that matters: somebody who cannot tell an outage from a refusal presses again, and this
    // is the one button on the platform where pressing again is not free.
    return (
      <RaceFrame slug={slug} name={null} current={null} page="Danger zone">
        <>
          <h1>Danger zone</h1>
          <p className="notice notice-bad">
            The club&rsquo;s database could not be reached, so this race could not be
            read. Nothing has been changed and nothing has been wiped. Try again in a
            moment.
          </p>
        </>
      </RaceFrame>
    );
  }

  if (read.state === 'none') {
    // `NotFoundBody` is the one wording, so this cannot drift from `app/not-found.tsx`'s —
    // `event_detail()` answers the same `null` for a refusal and for a missing race.
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const event = read.data;
  const action = `/timing/events/${encodeURIComponent(slug)}/danger-zone/update`;
  // `reset_event()` refuses a published race with `published`, and since #205 `event_detail()`
  // carries the column, so the page can say so before the press rather than after it.
  const publishedReason =
    event.results_published_at === null
      ? null
      : 'This race’s results are published. Take them down on its Results page before wiping it.';

  return (
    <RaceFrame slug={slug} name={event.name} current={null} page="Danger zone">
      <>
        <h1>Danger zone</h1>

        <p className="lede">{event.name}</p>

        {outcome === null ? null : (
          <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
        )}

        <p>
          Wiping this race removes <strong>every crossing and every entry</strong>{' '}
          recorded against it and puts it back to not started and not finished. It is how
          the field is cleared between two runs of the same rehearsal. It cannot be
          undone, and there is no export of what it removes.
        </p>

        {/* ⚠️ **The blast radius is read from the database rather than described in prose.**
          The whole argument for a typed confirmation is that somebody has looked at what they
          are about to remove; a sentence saying "this will remove your crossings" is not
          something anybody can check themselves against. */}
        <h2>What would be removed</h2>

        <dl>
          <dt>Entries</dt>
          <dd>{event.counts.teams}</dd>

          <dt>Runners</dt>
          <dd>{event.counts.runners}</dd>

          <dt>Crossings recorded</dt>
          <dd>{event.counts.crossings}</dd>

          <dt>Anomalies needing a human</dt>
          <dd>{event.counts.open_anomalies}</dd>
        </dl>

        {/* ⚠️ **What survives is on the page beside what does not**, because "danger zone" reads
          as "delete the race" and the next thing this volunteer does is look for the race they
          just reset. The marshal count is here rather than above for the same reason: it is the
          number somebody would otherwise fear they had to rebuild. */}
        <h2>What would be kept</h2>

        <dl>
          <dt>Marshals rostered</dt>
          <dd>{event.counts.marshals}</dd>

          <dt>Actually started</dt>
          <dd>{orDash(event.actually_started_at)}</dd>

          <dt>Finished</dt>
          <dd>{orDash(event.finished_at)}</dd>
        </dl>

        <p>
          The race itself, its name, its start time and its marshals are kept. The two
          times above are cleared. What has been done to this race stays recorded, and
          wiping it is recorded too.
        </p>

        <form method="post" action={action}>
          <WipeConfirm slug={event.slug} blockedBy={publishedReason} />
        </form>

        <p>
          <Link href={`/events/${slug}`}>Back to this race</Link>
        </p>
      </>
    </RaceFrame>
  );
}
