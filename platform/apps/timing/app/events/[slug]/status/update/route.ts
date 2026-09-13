import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/status/update` — mark a team DNS, DNF or DQ, or lift one.
 *
 * Issue [#253](https://github.com/southville-running-club/src-website/issues/253). Behind
 * `timing.event.manage`; `lib/access.ts` maps it and `middleware.ts` enforces it, exactly as it
 * does for the page that posts here.
 *
 * ## ⚠️ A label, and never a change to a crossing
 *
 * `set_race_status()` writes one column on one team. Nothing here edits, hides or reorders a
 * capture, and nothing here should ever learn to: a crossing is what a marshal saw, and a status
 * is what the club decided afterwards. `teamRaceStatus()` and `sortResults()` already read the
 * column — DNS suppresses every derived time, and **DNF and DQ keep leg A**.
 *
 * ## 303, and why it matters on this address in particular
 *
 * A POST that answers 200 leaves the browser on a page whose reload re-posts the form. Here that
 * would re-apply a disqualification — harmless, because the function answers `changed: false`
 * when nothing moved, and still a browser somebody cannot reason about on a page where the
 * mistakes are "the wrong runner is out" and "the race is over".
 *
 * ⚠️ **No authorisation check in this file, deliberately.** The door has admitted the request and
 * the function asks `identity.has_permission()` itself against the caller's own token.
 */

/**
 * What the four buttons can ask for. `clear` is the only one that is not a database value: it
 * maps to `null`, which is how a status is lifted.
 *
 * A closed record, and `Object.hasOwn` rather than a bare index — `STATUSES['constructor']` is a
 * function and therefore truthy, and a hidden field is something anybody can re-post with a
 * value of their choosing. `lib/access.ts` carries the same fix, found there as a real defect.
 */
const STATUSES: Record<string, string | null> = {
  dns: 'dns',
  dnf: 'dnf',
  dq: 'dq',
  clear: null,
};

function backTo(
  request: Request,
  slug: string,
  outcome: string,
  search: string,
): NextResponse {
  // The searched view is carried back, so marking somebody from a filtered list returns to that
  // list rather than to all 250. `basePath` is not applied to a URL built here, so `/timing` is
  // written out; every part is encoded because the outcome can be a `reason` the database chose.
  const query =
    search === ''
      ? `outcome=${encodeURIComponent(outcome)}`
      : `q=${encodeURIComponent(search)}&outcome=${encodeURIComponent(outcome)}`;

  return NextResponse.redirect(
    new URL(`/timing/events/${encodeURIComponent(slug)}/status?${query}`, request.url),
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
    return backTo(request, slug, 'incomplete', '');
  }

  const search = String(form.get('q') ?? '');
  const asked = String(form.get('status') ?? '');

  if (!Object.hasOwn(STATUSES, asked)) {
    return backTo(request, slug, 'refused', search);
  }

  const teamId = String(form.get('team_id') ?? '');
  if (teamId === '') {
    return backTo(request, slug, 'incomplete', search);
  }

  const result = await writeTiming('set_race_status', {
    p_event_slug: slug,
    p_team_id: teamId,
    p_status: STATUSES[asked] ?? null,
  });

  if (result.state === 'ok') {
    // ⚠️ **Three outcomes rather than two.** Pressing a button that changes nothing is an
    // ordinary thing to do — and saying "recorded as disqualified" when they already were is a
    // sentence somebody would remember making about a decision they did not take.
    if (result.data.changed !== true) {
      return backTo(request, slug, 'unchanged', search);
    }

    return backTo(request, slug, asked === 'clear' ? 'cleared' : asked, search);
  }

  // ⚠️ `unavailable` is never flattened into a refusal: one means the runner was not marked, the
  // other means nobody knows yet.
  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
    search,
  );
}
