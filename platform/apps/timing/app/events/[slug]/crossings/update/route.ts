import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import {
  correctedTime,
  timeOnRaceDay,
  typedTimeOutcome,
} from '../../../../../lib/typed-time';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/crossings/update` — correct a bib or a time, restore a discard,
 * or add a crossing nobody captured.
 *
 * Issue [#252](https://github.com/southville-running-club/src-website/issues/252), and
 * [ADR-071](../../../../../../../../docs/architecture/decisions/adr-071-a-crossing-can-be-added-and-retimed-from-the-log.md)
 * for the time and the add. Behind `timing.crossing.resolve`, mapped in `lib/access.ts` and
 * enforced by `middleware.ts`, exactly as the page that posts here is.
 *
 * ## ⚠️ Why this is not the anomalies route with another branch
 *
 * The two surfaces take different **latches**, which is a difference in the database rather
 * than in the form. The triage list swaps on `resolved_at is null`; the log cannot, because a
 * row that was never flagged has that null for ever — so `edit_crossing()` swaps on the values
 * the editor was looking at instead. One route branching on which latch it meant is how the
 * wrong one gets used on the wrong surface. `20260913220000`'s header carries the argument.
 *
 * **Adding is an intent here rather than an address of its own** because it takes no latch at
 * all — `add_crossing()` is idempotent on the form's own id — and because a new address would
 * be a new row in `lib/access.ts` asking the same permission this one already asks.
 *
 * ## The time is a London clock on the race's day
 *
 * The edit form posts a `time` text box beside the bib — text, because the iPhone's time picker
 * has no seconds — and `lib/typed-time.ts` turns it into an
 * instant on the date the page drew into `race_date` — the London day the race's gun went.
 * **A time that matches what was drawn is carried through as the instant it already was**, so a
 * bib correction never moves a capture's milliseconds. That module's header carries the rest.
 */

/** The things this address can be asked to do. A closed record, for `INTENTS`' usual reason. */
const INTENTS = {
  add: true,
  edit: true,
  restore: true,
} as const;

/** A client-generated id, as the add form draws one. Anything else never reaches the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backTo(
  request: Request,
  slug: string,
  outcome: string,
  search: string,
): NextResponse {
  // The search is carried back so a correction made from a filtered view returns to it rather
  // than to the whole log — the same property that makes a searched view a URL somebody can
  // send. `basePath` is not applied to a URL built here, so `/timing` is written out, and every
  // part is encoded because the outcome can be a `reason` the database chose.
  // Back to the Timing log page — ADR-055. **This address did not move.**
  const query =
    search === ''
      ? `outcome=${encodeURIComponent(outcome)}`
      : `log_q=${encodeURIComponent(search)}&outcome=${encodeURIComponent(outcome)}`;

  return NextResponse.redirect(
    new URL(`/timing/events/${encodeURIComponent(slug)}/crossings?${query}`, request.url),
    303,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  // The view this was posted from, so the redirect can return to it. ⚠️ **`log_q`, not `q`** —
  // Named while #308 put this log and the race-status list on one page, where two controls named
  // `q` were one control wearing two hats; kept, because a searched view is a URL. Read off the URL rather than the body on purpose: a body that
  // fails to parse still has to redirect somewhere, and the catch below runs before there is a
  // form to read. `sections/crossings.tsx` is what puts it on the action.
  const search = new URL(request.url).searchParams.get('log_q') ?? '';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backTo(request, slug, 'incomplete', search);
  }

  const asked = String(form.get('intent') ?? '');
  if (!Object.hasOwn(INTENTS, asked)) {
    return backTo(request, slug, 'refused', search);
  }

  if (asked === 'add') {
    return add(request, slug, form, search);
  }

  const crossingId = String(form.get('crossing_id') ?? '');
  if (crossingId === '') {
    return backTo(request, slug, 'incomplete', search);
  }

  if (asked === 'restore') {
    const restored = await writeTiming('restore_crossing', { p_id: crossingId });

    if (restored.state === 'ok') {
      // ⚠️ **Advisory, after the response, and never branched on** — `lib/leaderboard-nudge.ts`. The
      // change is already durable; this is only how a board open on somebody's laptop finds out
      // seconds early rather than on its next reconnect.
      await scheduleLeaderboardNudge(slug);
      return backTo(request, slug, 'restored', search);
    }

    return backTo(
      request,
      slug,
      restored.state === 'unavailable' ? 'unavailable' : restored.reason,
      search,
    );
  }

  const expectedCapturedAt = String(form.get('expected_captured_at') ?? '');
  if (expectedCapturedAt === '') {
    return backTo(request, slug, 'incomplete', search);
  }

  // `null` when the form has no time box at all — a page the previous deploy drew — which is
  // `unchanged` rather than blank. `lib/typed-time.ts` says why.
  const typed = form.get('time');
  const time = correctedTime({
    typed: typed === null ? null : String(typed),
    drawn: expectedCapturedAt,
    raceDate: String(form.get('race_date') ?? ''),
    now: new Date(),
  });

  if (time.state !== 'ok' && time.state !== 'unchanged') {
    return backTo(request, slug, typedTimeOutcome(time.state), search);
  }

  const result = await writeTiming('edit_crossing', {
    p_id: crossingId,
    p_bib: String(form.get('bib') ?? ''),
    // The drawn value itself when nobody changed the time — milliseconds and all. The function
    // swaps on the drawn value either way, which is what makes a stale page's edit refuse
    // rather than apply.
    p_captured_at: time.state === 'ok' ? time.instant.toISOString() : expectedCapturedAt,
    p_expected_bib: String(form.get('expected_bib') ?? ''),
    p_expected_captured_at: expectedCapturedAt,
  });

  if (result.state === 'ok') {
    // ⚠️ **Advisory, after the response, and never branched on** — `lib/leaderboard-nudge.ts`. The
    // change is already durable; this is only how a board open on somebody's laptop finds out
    // seconds early rather than on its next reconnect.
    await scheduleLeaderboardNudge(slug);

    // An edited bib that still matches no team is resolved and incomplete at once, and the page
    // has to say so — what changes next is the entry list rather than this screen.
    return backTo(
      request,
      slug,
      result.data.orphan === true ? 'edited_orphan' : 'saved',
      search,
    );
  }

  // ⚠️ `unavailable` is never flattened into a refusal: one means the capture was not changed,
  // the other means nobody knows yet.
  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
    search,
  );
}

/**
 * A crossing nobody captured — `timing.add_crossing()`, ADR-071.
 *
 * ⚠️ **The log comes back searched for the bib that was added**, not to whatever view it was
 * posted from. The log is newest first by *crossing* time, so a finish copied off paper at
 * 18:00 for somebody who crossed at 11:47 lands deep in the list, and a volunteer who cannot
 * see what they just added will add it again. The same holds for `already_captured`: the
 * capture that already counts is the one to correct, so the page opens on it.
 */
async function add(
  request: Request,
  slug: string,
  form: FormData,
  search: string,
): Promise<NextResponse> {
  const id = String(form.get('crossing_id') ?? '');
  if (!UUID.test(id)) {
    return backTo(request, slug, 'incomplete', search);
  }

  const bib = String(form.get('bib') ?? '').trim();
  if (bib === '') {
    return backTo(request, slug, 'bib_required', search);
  }

  const time = timeOnRaceDay(
    String(form.get('time') ?? ''),
    String(form.get('race_date') ?? ''),
  );
  if (time.state !== 'ok') {
    // `unchanged` and `in_future` cannot come out of `timeOnRaceDay`; the database decides the
    // second, against its own clock.
    return backTo(
      request,
      slug,
      time.state === 'unchanged' || time.state === 'in_future'
        ? 'incomplete'
        : typedTimeOutcome(time.state),
      search,
    );
  }

  const result = await writeTiming('add_crossing', {
    p_id: id,
    p_event_slug: slug,
    p_bib: bib,
    p_captured_at: time.instant.toISOString(),
  });

  if (result.state === 'ok') {
    // ⚠️ **Advisory, after the response, and never branched on** — `lib/leaderboard-nudge.ts`.
    await scheduleLeaderboardNudge(slug);
    return backTo(request, slug, 'added', bib);
  }

  if (result.state === 'refused' && result.reason === 'already_captured') {
    return backTo(request, slug, 'already_captured', bib);
  }

  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
    search,
  );
}
