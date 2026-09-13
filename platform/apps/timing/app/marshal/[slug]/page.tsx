import { formatLondon } from '@src/shared';
import type { EventFormat } from '@src/shared/timing/anomaly';
import { readTiming } from '../../../lib/reads';
import { MarshalScreen } from './marshal-screen';

/**
 * `/timing/marshal/<slug>/` — the screen a marshal stands on a course holding.
 *
 * Issue [#203](https://github.com/southville-running-club/src-website/issues/203), under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * and [ADR-036](../../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
 *
 * ## The door, and why this page still makes the read it does
 *
 * `timing.crossing.record` **and** a `timing.marshals` row for this race. `lib/access.ts` maps
 * the address as `rosterScoped` and `middleware.ts` enforces both — this page does not gate
 * itself, for the measured reason `app/page.tsx`'s header carries.
 *
 * ⚠️ **`marshal_event()` is read here anyway, and not as a second gate.** The screen needs the
 * race's `format`: a relay bib is read leg-first (`147` is leg 1, team 47) and a solo bib
 * whole, so the anomaly a marshal is shown depends on it. Guessing would flag the wrong
 * crossings on the one morning being wrong cannot be undone. The read answers `null` for all
 * three refusals, indistinguishably, so it is also the reason the "Not found" below can be
 * written out inline rather than thrown.
 *
 * ## ⚠️ The fallback is the page, not a placeholder
 *
 * Every Playwright project here includes `no-javascript`, and **there is no version of an
 * offline queue that works without it** — so this is the one surface on this platform where
 * the answer is a sentence rather than a form. The sentence has to be *useful*: a marshal
 * whose phone will not run the screen still has a race to time, and the recoverable outcome is
 * a bib and a time written on paper. That instruction is the whole value of it, and it is
 * rendered on the server so it is there whatever happens to the bundle.
 */
export const dynamic = 'force-dynamic';

interface MarshalEvent {
  slug: string;
  name: string;
  format: EventFormat;
  start_at: string;
  actually_started_at: string | null;
  finished_at: string | null;
}

export default async function MarshalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  const read = await readTiming<MarshalEvent>('marshal_event', { p_event_slug: slug });

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage.** A marshal told the race does not exist, half an
    // hour before it starts, has no way to tell that from the truth. `lib/reads.ts`'s header
    // carries the whole argument.
    return (
      <>
        <h1>Recording crossings</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been lost. Try again in a moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    return (
      <>
        <h1>Not found</h1>
        <p>There is no race at this address.</p>
      </>
    );
  }

  const event = read.data;

  return (
    <>
      <h1>{event.name}</h1>

      <p className="capture-when">
        {event.finished_at !== null
          ? `This race finished at ${formatLondon(event.finished_at)}.`
          : event.actually_started_at !== null
            ? `Started at ${formatLondon(event.actually_started_at)}.`
            : `Scheduled to start at ${formatLondon(event.start_at)}. It has not started yet.`}
      </p>

      <MarshalScreen slug={event.slug} format={event.format}>
        {/* ⚠️ The server's own markup, and what a phone with no JavaScript is left with. It
            says what to do instead, because "this needs JavaScript" on its own is of no use to
            somebody standing on a course. */}
        <p className="notice notice-bad">
          This screen records crossings on the phone itself, so it needs JavaScript. If it
          does not appear, write each runner&rsquo;s bib and the time they crossed down on
          paper and give them to whoever is running the race — nothing is lost that way,
          and it is what the club did before there was a screen at all.
        </p>
      </MarshalScreen>
    </>
  );
}
