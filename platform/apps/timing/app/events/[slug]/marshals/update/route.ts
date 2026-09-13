import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/marshals/update` — the first thing in this application that
 * changes anything.
 *
 * Behind `timing.marshal.assign`; `lib/access.ts` maps it and `middleware.ts` enforces it,
 * exactly as it does for the page that posts here. ⚠️ **A write address is gated by the same
 * table a page is**, which is the property that makes this safe to add: an address nobody has
 * written a row for is refused rather than opened.
 *
 * ## Why a route handler and a plain form, rather than a Server Action
 *
 * `lib/access.ts`'s `EVENT_SECTION_ACTIONS` carries the argument. The short of it: **every
 * spec in this repository runs in a `no-javascript` Playwright project**, a plain
 * `<form method="post">` answered by a 303 is HTML that cannot fail with scripting off, and it
 * is what every other write on this platform already is.
 *
 * ## 303, and why it is not 302
 *
 * A POST that answers 200 leaves the browser on a page whose reload re-posts the form — which
 * on this page means assigning somebody twice, and `assign_marshal()` audits a repeat ask. 303
 * is the status that says *"go and GET this instead"*, so Back and Reload both do the harmless
 * thing. `apps/main/worker/admin.ts` answers 303 from every POST for the same reason.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and `assign_marshal()` asks `identity.has_permission()` itself against the caller's
 * own token. A third check here would be a third statement of one rule, and the third is the
 * one that goes stale — `packages/db/tests/timing.test.ts` is what actually holds it.
 */

/**
 * The two things this address can be asked to do, and the function each maps to.
 *
 * A closed record rather than an `if`, so an `intent` nobody wrote down falls through to the
 * refusal below instead of matching the last branch by accident.
 */
const INTENTS = {
  assign: { fn: 'assign_marshal', done: 'assigned' },
  remove: { fn: 'unassign_marshal', done: 'removed' },
} as const;

/** A UUID as `identity.people.id` spells one. Anything else never reaches the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backTo(request: Request, slug: string, outcome: string): NextResponse {
  // `basePath` is not applied to a URL built here, so `/timing` is written out.
  //
  // ⚠️ **Both halves are encoded, and the outcome half is the one that is easy to miss.** The
  // slug came off the address; the outcome can be a `reason` string the *database* chose, and
  // a reason nobody has thought of yet must not be able to put a `&` or a `#` into this URL.
  // `outcomeFor()` then answers `null` for anything it has no wording for, so an unknown
  // reason is silent rather than mangled — see `lib/marshal-outcomes.ts`.
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/marshals?outcome=${encodeURIComponent(outcome)}`,
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
  // rather than `undefined` — truthy, so the guard below would pass and `intent.fn` would be
  // `undefined`, which reaches PostgREST as a call to no function at all. A hidden field is
  // something anybody can re-post with a value of their choosing. Same fix as `lib/access.ts`.
  const asked = String(form.get('intent') ?? '');
  const intent = Object.hasOwn(INTENTS, asked)
    ? INTENTS[asked as keyof typeof INTENTS]
    : undefined;
  const personId = String(form.get('person_id') ?? '');

  if (intent === undefined) {
    return backTo(request, slug, 'refused');
  }

  // ⚠️ **Shape-checked here rather than left to Postgres.** A non-UUID reaches `uuid` as a
  // cast failure, which is a thrown `PostgrestError` and would render as *"the database could
  // not be reached"* — an outage message for somebody choosing nothing from a picker. The
  // database still enforces every rule that matters; this only keeps a defect out of the one
  // path that cannot tell a refusal from an outage.
  if (!UUID.test(personId)) {
    return backTo(request, slug, 'incomplete');
  }

  const result = await writeTiming(intent.fn, {
    p_event_slug: slug,
    p_person_id: personId,
  });

  if (result.state === 'ok') {
    return backTo(request, slug, intent.done);
  }

  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
