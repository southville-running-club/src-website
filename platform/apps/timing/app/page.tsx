import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { canOpen } from '../lib/access';
import { readPermissions, readTiming } from '../lib/reads';
import { TimingFrame } from './chrome/frames';

/**
 * `/timing`, for the people allowed to see it — **the list of where each of them may go.**
 *
 * ## What changed, and why it had to
 *
 * This said *"the race-day tools are being built here. Nothing on this page records or changes
 * anything yet"* until 28 September 2026, a fortnight after every one of those tools was built,
 * and it linked to none of them. That mattered more once `/account/` began linking here for
 * anybody holding a timing role: the only page a timing volunteer could find their way to was
 * a dead end that told them the thing they had come to use did not exist.
 *
 * ## It lists only what the viewer may open
 *
 * `lib/access.ts`'s own comment on this address says so, and this is the page doing it. Every
 * link is decided by {@link canOpen} against the same table `middleware.ts` enforces, never by
 * a permission slug written here — **a link and the door behind it have to agree**, and a link
 * to a page that 404s tells somebody it exists and refuses them. So:
 *
 * - **Races**, for anybody the races list opens to (`timing.event.manage`).
 * - **The races they are marshalling**, from `timing.my_marshal_events()` — the caller's own
 *   roster rows, checked in `marshal_event()`'s order, so a race listed here is one the capture
 *   screen opens. That function is the only thing that answers *"which races am I on"* to the
 *   marshal asking; before it, the address of the screen had to reach them by message.
 *
 * ⚠️ **This is navigation and never protection.** Refusal happens in `middleware.ts` before
 * this file runs, and every page behind these links is gated again on its own row. A link left
 * off by mistake costs somebody a typed address; a link drawn by mistake is a 404, which is why
 * the rule is asked rather than restated.
 *
 * ⚠️ **This page must not gate itself**, and the temptation to add a belt-and-braces check is
 * the mistake that was already made: a `notFound()` thrown during a dynamic render returns an
 * empty error shell rather than the not-found page. The middleware's own header carries the
 * measurements.
 *
 * ## When a read fails
 *
 * **The permissions read failing draws no links**, and says so — the viewer got past the door
 * a moment ago, so this is an outage, not a refusal, and the page must not read as if they had
 * lost access. The roster read failing is said in the marshal section alone, because the races
 * list above it does not depend on it.
 */
export const dynamic = 'force-dynamic';

interface MarshalRace {
  slug: string;
  name: string;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
}

/** The same three words the races list uses, so a race reads the same on both pages. */
function stage(race: MarshalRace): string {
  if (race.finished_at !== null) {
    return 'Finished';
  }

  return race.actually_started_at === null ? 'Not started' : 'Running';
}

export default async function Page() {
  const permissions = await readPermissions();
  const mayManage = canOpen(permissions, '/events');
  // The capture screen's permission half. The roster half is what the read below answers.
  const mayCapture = canOpen(permissions, '/marshal/any');

  const races = mayCapture
    ? await readTiming<MarshalRace[]>('my_marshal_events')
    : ({ state: 'none' } as const);

  const rostered = races.state === 'ok' ? races.data : [];

  // An admin holds `timing.crossing.record` too, and is on no roster until they put
  // themselves on one — so "you are not on a race yet" is only said to somebody for whom
  // this section is the whole page.
  const showMarshalSection =
    mayCapture && (!mayManage || rostered.length > 0 || races.state === 'unavailable');

  return (
    <TimingFrame current={'/'}>
      <>
        <h1>Race timing</h1>

        {permissions.length === 0 ? (
          <p className="notice notice-bad">
            The club&rsquo;s database could not be reached, so this page cannot show where
            you can go. Nothing has been changed. Try again in a moment.
          </p>
        ) : (
          <p className="lede">
            You are signed in with access to the club&rsquo;s race-timing system.
          </p>
        )}

        {mayManage ? (
          <section aria-labelledby="timing-races">
            <h2 id="timing-races">Running a race</h2>
            <p>
              <Link href="/events">Races</Link> &mdash; the entry list, the start, the
              finish and the results for each race set up for timing.
            </p>
          </section>
        ) : null}

        {showMarshalSection ? (
          <section aria-labelledby="timing-marshalling">
            <h2 id="timing-marshalling">Marshalling</h2>

            {races.state === 'unavailable' ? (
              <p className="notice notice-bad">
                The races you are marshalling could not be read just now. Try again in a
                moment, or open the link the race organiser sent you.
              </p>
            ) : rostered.length === 0 ? (
              <p>
                You are not on a race yet. The race organiser puts you on one; once they
                have, it will be listed here.
              </p>
            ) : (
              <ul className="summary-list">
                {rostered.map((race) => (
                  <li key={race.slug}>
                    <h3>
                      <Link href={`/marshal/${race.slug}`}>{race.name}</Link>
                    </h3>
                    <dl>
                      <dt>Starts</dt>
                      {/* `formatLondon` and nothing else — the race is the weekend after the
                        clocks go back. */}
                      <dd>{formatLondon(race.start_at)}</dd>

                      <dt>Where it has got to</dt>
                      <dd>{stage(race)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <p>
          <a href="/">Southville Running Club</a>
        </p>
      </>
    </TimingFrame>
  );
}
