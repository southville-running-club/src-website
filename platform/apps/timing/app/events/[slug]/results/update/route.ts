import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/results/update` — publish these results, or take them down.
 *
 * Issue [#205](https://github.com/southville-running-club/src-website/issues/205), calling
 * [#241](https://github.com/southville-running-club/src-website/issues/241)'s two functions.
 * Behind `timing.result.publish`, mapped in `lib/access.ts` and enforced by `middleware.ts`.
 *
 * ## ⚠️ This is the one press on this platform whose effect leaves the club
 *
 * Everything else under `/timing` changes a record a handful of volunteers can see. Publishing
 * makes a table of names, categories and times readable by anybody with the address — which is
 * the club's decision to make and exactly why it is a separate act behind a separate permission
 * rather than a consequence of finishing. `results-outcomes.ts` says so in the sentence
 * afterwards, and the page says so under the button.
 *
 * **Nothing is guarded here.** `publish_results()` refuses `not_finished` and `open_anomalies`
 * and `unpublish_results()` refuses `not_published`, each in the database, and a second opinion
 * in this file would be a third statement of a rule that already has two — the third being the
 * one that goes stale. The page shows the same conditions *before* the press so nobody is
 * surprised by a refusal; it does not act on them.
 *
 * ## One address for both presses
 *
 * `start/update`'s reason: one screen, one permission, and the `intent` field says which. A
 * spelling nobody wrote down falls through to a refusal rather than to the other press — which
 * matters more here than anywhere, because the two are "make this public" and "take it down".
 */

/** The two presses. A closed record, for the reason every other `INTENTS` here is one. */
const INTENTS = {
  publish: { fn: 'publish_results', done: 'published' },
  unpublish: { fn: 'unpublish_results', done: 'unpublished' },
} as const;

function backTo(request: Request, slug: string, outcome: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/timing/events/${encodeURIComponent(slug)}/results?outcome=${encodeURIComponent(outcome)}`,
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

  // ⚠️ **The refusal's own `reason` and never its `open` count.** The page reads the live count
  // out of `results_preview()` in the same render, so carrying a number across the redirect
  // would put a stale figure beside a fresh one — and a value in a query string is a value
  // somebody can type.
  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
