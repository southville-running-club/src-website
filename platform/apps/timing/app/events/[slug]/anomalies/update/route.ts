import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/anomalies/update` — mark valid, correct the bib, or discard.
 *
 * Issue [#252](https://github.com/southville-running-club/src-website/issues/252). Behind
 * `timing.crossing.resolve`; `lib/access.ts` maps it and `middleware.ts` enforces it, exactly
 * as it does for the page that posts here. ⚠️ **A write address is gated by the same table a
 * page is** — an address nobody has written a row for is refused rather than opened.
 *
 * ## 303, and why Back and Reload matter more here than usual
 *
 * A POST that answers 200 leaves the browser on a page whose reload re-posts the form. Here
 * that would re-resolve a capture — and the second post would answer `already_resolved`, which
 * is harmless but tells somebody a story about a race between two volunteers that never
 * happened. 303 sends the browser to GET the list again, which is also the re-read the page
 * wants after any resolution.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and every function asks `identity.has_permission()` itself against the caller's own
 * token. A third check would be a third statement of one rule, and the third goes stale.
 */

/**
 * The three resolutions, as a closed record.
 *
 * An `intent` nobody wrote down falls through to a refusal rather than matching the last branch
 * by accident — which on this address would mean discarding a capture somebody meant to keep.
 * `Object.hasOwn` rather than a bare index, because `INTENTS['constructor']` is a function and
 * therefore truthy; `lib/access.ts` carries the same fix, found there as a real defect.
 */
const INTENTS = {
  marked_valid: true,
  edited: true,
  discarded: true,
} as const;

function backTo(request: Request, slug: string, outcome: string): NextResponse {
  // ⚠️ **Back to the console, not to this handler's own old page** —
  // [#308](https://github.com/southville-running-club/src-website/issues/308) merged five pages
  // into one. `?section=` says which section owns `?outcome=`, because five outcome vocabularies
  // now share one address and a bare `?outcome=` would be ambiguous between them; the fragment
  // opens that section and scrolls to it, so the message about what just happened is not hidden
  // inside a collapsed block.
  //
  // **This address did not move** — only where it sends somebody afterwards. `lib/access.ts`
  // still carries this section's own permission for it.
  // `basePath` is not applied to a URL built here, so `/timing` is written out.
  //
  // ⚠️ **Both halves are encoded**, and the outcome half is the one that is easy to miss: it can
  // be a `reason` the *database* chose, and a reason nobody has thought of yet must not be able
  // to put a `&` or a `#` into this URL. `anomalyOutcomeFor()` then answers `null` for anything
  // it has no wording for, so an unknown reason is silent rather than mangled.
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/console?section=anomalies&outcome=${encodeURIComponent(outcome)}#anomalies`,
    request.url,
  );

  return NextResponse.redirect(target, 303);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A body that is not a form at all. Nothing was read and nothing was written.
    return backTo(request, slug, 'incomplete');
  }

  const asked = String(form.get('intent') ?? '');
  if (!Object.hasOwn(INTENTS, asked)) {
    return backTo(request, slug, 'refused');
  }

  const crossingId = String(form.get('crossing_id') ?? '');
  if (crossingId === '') {
    return backTo(request, slug, 'incomplete');
  }

  const result = await writeTiming('resolve_crossing', {
    p_id: crossingId,
    p_action: asked,
    p_new_bib: String(form.get('new_bib') ?? ''),
  });

  if (result.state === 'ok') {
    // ⚠️ **Advisory, after the response, and never branched on** — `lib/leaderboard-nudge.ts`. The
    // change is already durable; this is only how a board open on somebody's laptop finds out
    // seconds early rather than on its next reconnect.
    await scheduleLeaderboardNudge(slug);

    // ⚠️ **An edit that still matches no team gets its own sentence.** It is not a failure —
    // the admin has recorded what they believe the bib was — but the screen would otherwise
    // look like it had finished the job, and what has to change next is the entry list.
    const orphaned = asked === 'edited' && result.data.orphan === true;
    return backTo(request, slug, orphaned ? 'edited_orphan' : asked);
  }

  // ⚠️ **`unavailable` is carried through as itself and never flattened into a refusal.** The
  // difference is whether the capture was resolved: a refusal means it was not, and an outage
  // means nobody knows yet. `lib/anomaly-outcomes.ts` says both, in words.
  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
