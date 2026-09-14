import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { resetOutcomeFor } from '../../../../lib/reset-outcomes';
import { NotFoundBody } from '../../../not-found-body';

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
 * ## What this page deliberately does not show
 *
 * **Whether the race's results are published.** `reset_event()` refuses a published race with
 * `published` and the wording module says what to do about it — but this page cannot say so
 * *before* the press, because `event_detail()` does not carry `results_published_at` and
 * widening it here would be this change restating a function
 * [#241](https://github.com/southville-running-club/src-website/issues/241) owns. Two branches
 * would then write the same `create or replace` and the one applied second would silently drop
 * the other's keys, which is the merge conflict git cannot see that this repository has already
 * paid for once. So the refusal is rendered after the fact, and the day `event_detail()` grows
 * the key — #241's change or a later one — this page should show it and stop offering the
 * button.
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

  const read = await readTiming<EventDetail>('event_detail', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage**, and on this page the third sentence is the one
    // that matters: somebody who cannot tell an outage from a refusal presses again, and this
    // is the one button on the platform where pressing again is not free.
    return (
      <>
        <h1>Danger zone</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed and nothing has been wiped. Try again in a moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    // `NotFoundBody` is the one wording, so this cannot drift from `app/not-found.tsx`'s —
    // `event_detail()` answers the same `null` for a refusal and for a missing race.
    return <NotFoundBody />;
  }

  const event = read.data;
  const action = `/timing/events/${encodeURIComponent(slug)}/danger-zone/update`;

  return (
    <>
      <h1>Danger zone</h1>

      <p className="lede">{event.name}</p>

      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      <p>
        Wiping this race removes <strong>every crossing and every entry</strong> recorded
        against it and puts it back to not started and not finished. It is how the field
        is cleared between two runs of the same rehearsal. It cannot be undone, and there
        is no export of what it removes.
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
        The race itself, its name, its start time and its marshals are kept. The two times
        above are cleared. What has been done to this race stays recorded, and wiping it
        is recorded too.
      </p>

      <form method="post" action={action}>
        <div className="field">
          <label className="field-label" htmlFor="confirmation">
            Type <strong>{event.slug}</strong> to confirm
          </label>
          <p className="field-hint" id="confirmation-hint">
            Exactly as it appears above, in lower case.
          </p>
          <input
            className="field-input"
            id="confirmation"
            name="confirmation"
            type="text"
            required
            /* ⚠️ Three attributes rather than taste. A phone keyboard capitalises the first
               letter of a text field and offers to correct an unfamiliar word, and the
               function compares the phrase exactly — so without these the control would
               refuse a volunteer who typed precisely what the page asked for. */
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            aria-describedby="confirmation-hint"
          />
        </div>

        <button type="submit" className="button button-wide">
          Wipe this race
        </button>
      </form>

      <p>
        <Link href={`/events/${slug}`}>Back to this race</Link>
      </p>
    </>
  );
}
