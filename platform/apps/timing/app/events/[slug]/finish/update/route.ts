import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/finish/update` — call the race finished, or take it back.
 *
 * Issue [#253](https://github.com/southville-running-club/src-website/issues/253). Behind
 * `timing.event.manage`, mapped in `lib/access.ts` and enforced by `middleware.ts`.
 *
 * ## ⚠️ Finishing is a label and never a gate
 *
 * `record_crossing()`, the resolution functions and `set_race_status()` are all untouched by
 * `finished_at`. **The last runner's crossing arrives after the race director has called it**,
 * and a finish that refused it would lose exactly the result it was declaring. The page says so
 * in as many words, because a volunteer who believed otherwise would stop capturing.
 *
 * ## Why this is a second address rather than an `intent` on the status form
 *
 * `lib/access.ts` carries the argument: the two write different things — one a label on a
 * runner, the other a label on the race — and on this pair the mistakes are "the wrong person is
 * disqualified" and "the race is declared over". Two addresses means a value nobody wrote down
 * falls through to a refusal rather than to the other one.
 */

/** The two presses. A closed record, for the reason every other `INTENTS` here is one. */
const INTENTS = {
  finish: { fn: 'finish_event', done: 'finished' },
  reopen: { fn: 'reopen_event', done: 'reopened' },
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
  return NextResponse.redirect(
    new URL(
      `/timing/events/${encodeURIComponent(slug)}/console?section=finish&outcome=${encodeURIComponent(outcome)}#finish`,
      request.url,
    ),
    303,
  );
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
    return backTo(request, slug, 'incomplete');
  }

  // ⚠️ `Object.hasOwn` rather than a bare index — `INTENTS['constructor']` is truthy and
  // `intent.fn` would then be `undefined`, which reaches PostgREST as a call to no function.
  const asked = String(form.get('intent') ?? '');
  const intent = Object.hasOwn(INTENTS, asked)
    ? INTENTS[asked as keyof typeof INTENTS]
    : undefined;

  if (intent === undefined) {
    return backTo(request, slug, 'refused');
  }

  const result = await writeTiming(intent.fn, { p_event_slug: slug });

  if (result.state === 'ok') {
    return backTo(request, slug, intent.done);
  }

  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
