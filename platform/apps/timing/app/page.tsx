import { formatLondon } from '@src/shared';
import { canOpen } from '../lib/access';
import { hubTools, timingHref } from '../lib/chrome';
import { readPermissions, readSignedInAs, readTiming } from '../lib/reads';
import { TimingFrame } from './chrome/frames';
import { Hub, hubTitle } from './chrome/hub';

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

  const signedInAs = await readSignedInAs();
  const roleWord = mayManage ? 'admin' : mayCapture ? 'marshal' : null;

  // **A marshal on one race is shown that race's hub** — Pass the Buck's: the race, where it
  // has got to, and the buttons for what they may do on it. Anybody else gets the timing hub,
  // which says where they may go.
  const only = !mayManage && rostered.length === 1 ? rostered[0] : undefined;
  if (only !== undefined) {
    return (
      <TimingFrame current="home" brand>
        <Hub
          eyebrow={only.name}
          title={hubTitle(only.name)}
          status={<p>{whereItIs(only)}</p>}
          live={null}
          signedInAs={signedInAs}
          roleWord={roleWord}
          groups={hubTools(permissions, only.slug, true)}
        />
      </TimingFrame>
    );
  }

  return (
    <TimingFrame current="home" brand>
      <Hub
        eyebrow="Southville Running Club"
        title="Race timing."
        status={
          permissions.length === 0 ? (
            <p>
              The club&rsquo;s database could not be reached, so this page cannot show
              where you can go. Nothing has been changed. Try again in a moment.
            </p>
          ) : (
            <p>You are signed in to the club&rsquo;s race timing.</p>
          )
        }
        live={null}
        signedInAs={signedInAs}
        roleWord={roleWord}
        groups={
          mayManage
            ? [
                {
                  key: 'race-night',
                  tools: [{ key: 'races', label: 'Races', path: '/events' }],
                },
              ]
            : []
        }
      >
        {showMarshalSection ? (
          <section className="timing-hub-section" aria-labelledby="timing-marshalling">
            <h2 id="timing-marshalling">Marshalling</h2>

            {races.state === 'unavailable' ? (
              <p>
                The races you are marshalling could not be read just now. Try again in a
                moment, or open the link the race organiser sent you.
              </p>
            ) : rostered.length === 0 ? (
              <p>
                You are not on a race yet. The race organiser puts you on one; once they
                have, it will be listed here.
              </p>
            ) : (
              <ul className="timing-hub-races">
                {rostered.map((race) => (
                  <li key={race.slug}>
                    <h3>{race.name}</h3>
                    <p>{whereItIs(race)}</p>
                    <ul className="timing-hub-race-tools">
                      {hubTools(permissions, race.slug, true)
                        .flatMap((group) => group.tools)
                        .filter((tool) => tool.key === 'marshal' || tool.key === 'roster')
                        .map((tool) => (
                          <li key={tool.key}>
                            <a
                              className="club-btn timing-btn-dark timing-hub-button"
                              href={timingHref(tool.path)}
                            >
                              {tool.label}
                            </a>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </Hub>
    </TimingFrame>
  );
}

/** Where a race has got to, in one line — Pass the Buck's status line. */
function whereItIs(race: MarshalRace): string {
  if (race.finished_at !== null) return 'Race complete.';
  if (race.actually_started_at !== null) return 'Race in progress.';
  // `formatLondon` and nothing else — the race is the weekend after the clocks go back.
  return `Starts ${formatLondon(race.start_at)}.`;
}
