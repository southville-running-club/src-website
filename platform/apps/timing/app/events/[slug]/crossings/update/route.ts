import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/crossings/update` — correct a bib, or restore a discard.
 *
 * Issue [#252](https://github.com/southville-running-club/src-website/issues/252). Behind
 * `timing.crossing.resolve`, mapped in `lib/access.ts` and enforced by `middleware.ts`, exactly
 * as the page that posts here is.
 *
 * ## ⚠️ Why this is not the anomalies route with another branch
 *
 * The two surfaces take different **latches**, which is a difference in the database rather
 * than in the form. The triage list swaps on `resolved_at is null`; the log cannot, because a
 * row that was never flagged has that null for ever — so `edit_crossing()` swaps on the values
 * the editor was looking at instead. One route branching on which latch it meant is how the
 * wrong one gets used on the wrong surface. `20260913220000`'s header carries the argument.
 *
 * ## The time is carried through, not edited
 *
 * `p_captured_at` is posted back as the value the page was drawn with. The function takes a new
 * one and swaps on the old, so the contract is whole — what is missing is a *control*, and a
 * `datetime-local` is a wall clock with no zone on a race run the weekend the clocks go back.
 * The page's header carries the argument.
 */

/** The two things this address can be asked to do. A closed record, for `INTENTS`' usual reason. */
const INTENTS = {
  edit: true,
  restore: true,
} as const;

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
  const query =
    search === ''
      ? `outcome=${encodeURIComponent(outcome)}`
      : `q=${encodeURIComponent(search)}&outcome=${encodeURIComponent(outcome)}`;

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

  // The view this was posted from, so the redirect can return to it.
  const search = new URL(request.url).searchParams.get('q') ?? '';

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

  const result = await writeTiming('edit_crossing', {
    p_id: crossingId,
    p_bib: String(form.get('bib') ?? ''),
    // Carried through unchanged — see the header. The function still swaps on it, which is what
    // makes a stale page's edit refuse rather than apply.
    p_captured_at: expectedCapturedAt,
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
