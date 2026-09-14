import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/start/update` — the gun, and the undo for a false start.
 *
 * Issue [#250](https://github.com/southville-running-club/src-website/issues/250). Behind
 * `timing.event.manage`; `lib/access.ts` maps it and `middleware.ts` enforces it, exactly as it
 * does for the page that posts here. ⚠️ **A write address is gated by the same table a page
 * is**, which is the property that makes adding one safe: an address nobody has written a row
 * for is refused rather than opened.
 *
 * ## Why a route handler and a plain form, rather than a Server Action
 *
 * `lib/access.ts`'s `EVENT_SECTION_ACTIONS` carries the argument in full. The short of it:
 * **every spec in this repository runs in a `no-javascript` Playwright project**, a plain
 * `<form method="post">` answered by a 303 is HTML that cannot fail with scripting off, and it
 * is what every other write on this platform already is. ⚠️ **On this address that is not a
 * preference.** The one thing this screen does is start a race, on a phone, outdoors; a control
 * that needed a script to work would fail in the one place there is no second try.
 *
 * ## 303, and why it matters more here than on the roster
 *
 * A POST that answers 200 leaves the browser on a page whose reload re-posts the form. On the
 * roster that re-assigns somebody harmlessly; here it re-presses the gun. **It cannot move the
 * clock** — `start_event()` refuses a second start in its own `where` clause, which is the
 * whole design of `20260913170000_timing_start_race.sql` — but a browser that silently re-posts
 * on Back is still a browser somebody cannot reason about. 303 is the status that says *"go and
 * GET this instead"*, so Back and Reload both do the harmless thing.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and both functions ask `identity.has_permission()` themselves against the caller's own
 * token. A third check here would be a third statement of one rule, and the third is the one
 * that goes stale — `packages/db/tests/timing.test.ts` is what actually holds it.
 */

/**
 * The two things this address can be asked to do, and the function each maps to.
 *
 * A closed record rather than an `if`, so an `intent` nobody wrote down falls through to the
 * refusal below instead of matching the last branch by accident — which on this address would
 * mean a stray value clearing a start.
 */
const INTENTS = {
  start: { fn: 'start_event', done: 'started' },
  clear: { fn: 'clear_start', done: 'cleared' },
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
  // ⚠️ **Both halves are encoded, and the outcome half is the one that is easy to miss.** The
  // slug came off the address; the outcome can be a `reason` string the *database* chose, and a
  // reason nobody has thought of yet must not be able to put a `&` or a `#` into this URL.
  // `startOutcomeFor()` then answers `null` for anything it has no wording for, so an unknown
  // reason is silent rather than mangled — see `lib/start-outcomes.ts`.
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/console?section=start&outcome=${encodeURIComponent(outcome)}#start`,
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

  // ⚠️ **`Object.hasOwn` rather than a bare index.** `INTENTS['constructor']` is a function
  // rather than `undefined` — truthy, so a bare guard would pass and `intent.fn` would be
  // `undefined`, which reaches PostgREST as a call to no function at all. A hidden field is
  // something anybody can re-post with a value of their choosing. Same fix as `lib/access.ts`.
  const asked = String(form.get('intent') ?? '');
  const intent = Object.hasOwn(INTENTS, asked)
    ? INTENTS[asked as keyof typeof INTENTS]
    : undefined;

  if (intent === undefined) {
    return backTo(request, slug, 'refused');
  }

  const result = await writeTiming(intent.fn, { p_event_slug: slug });

  if (result.state === 'ok') {
    // ⚠️ **Every time on the board is measured from this**, so a start — or a cleared false start —
    // changes every row at once rather than one of them. Advisory and after the response, like
    // every other nudge: `lib/leaderboard-nudge.ts`.
    await scheduleLeaderboardNudge(slug);

    return backTo(request, slug, intent.done);
  }

  // ⚠️ **`unavailable` is carried through as itself and never flattened into a refusal.** On
  // this address the difference is whether the race started: a refusal means it did not, and an
  // outage means nobody knows yet. `lib/start-outcomes.ts` says both, in words.
  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
