import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/registration/update` — everything the entry-list page changes
 * that is not a file.
 *
 * Issue [#202](https://github.com/southville-running-club/src-website/issues/202), carrying
 * [#249](https://github.com/southville-running-club/src-website/issues/249)'s page half.
 * Behind `timing.registration.import`; `lib/access.ts` maps it and `middleware.ts` enforces
 * it, exactly as it does the page that posts here.
 *
 * ## Four intents on one address, the way `marshals/update` has two
 *
 * A closed record rather than a chain of `if`s, so an intent nobody wrote down falls through
 * to a refusal instead of matching the last branch by accident — and `Object.hasOwn` rather
 * than a bare index, because `INTENTS['constructor']` is a function and therefore truthy. A
 * hidden field is something anybody can re-post with a value of their choosing.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and every function below asks `identity.has_permission()` itself against the
 * caller's own token. A third check here would be a third statement of one rule, and the third
 * is the one that goes stale — `packages/db/tests/timing.test.ts` is what actually holds it.
 *
 * ## 303, and why it is not 302
 *
 * A POST answering 200 leaves the browser on a page whose reload re-posts the form — which
 * here means assigning a field of bibs twice, or adding a second walk-in with the same name.
 * 303 says *"go and GET this instead"*, so Back and Reload both do the harmless thing.
 */

/** A UUID as `timing.teams.id` spells one. Anything else never reaches the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The three race categories `entries` uses and `timing.runners.gender` speaks since ADR-039.
 *
 * ⚠️ **A closed list here as well as in the database.** `add_walk_in()` normalises anything it
 * does not recognise to null, which is the right direction — but a form that could post
 * `Gender: yes` and have it silently become *no prize band* is a form that looks like it
 * worked. Refused here, stored as null there, and neither is a guess.
 */
const CATEGORIES = new Set(['female', 'male', 'non_binary']);

function backTo(
  request: Request,
  slug: string,
  outcome: string,
  extra: Record<string, string | number> = {},
): NextResponse {
  // `basePath` is not applied to a URL built here, so `/timing` is written out.
  //
  // ⚠️ **Everything that reaches this URL is either from a closed list or a number.** The
  // outcome can be a `reason` the database chose, and a reason nobody has thought of yet must
  // not be able to put a `&` or a `#` into it — `URL.searchParams` encodes, and
  // `outcomeFor()` then answers `null` for anything it has no wording for, so an unknown
  // reason is silent rather than mangled.
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/registration`,
    request.url,
  );

  target.searchParams.set('outcome', outcome);
  for (const [key, value] of Object.entries(extra)) {
    target.searchParams.set(key, String(value));
  }

  return NextResponse.redirect(target, 303);
}

/** A form field as a trimmed string, or `null` when it was left blank. */
function text(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? '').trim();
  return value === '' ? null : value;
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

  const intent = String(form.get('intent') ?? '');

  if (intent === 'import-from-entries') {
    const result = await writeTiming('import_from_entries', { p_event_slug: slug });

    if (result.state === 'unavailable') return backTo(request, slug, 'unavailable');
    if (result.state === 'refused') return backTo(request, slug, result.reason);

    const created = Number(result.data['teams_created'] ?? 0);
    const updated = Number(result.data['teams_updated'] ?? 0);

    return backTo(request, slug, 'roster-imported', {
      teams: created + updated,
      runners: Number(result.data['runners_written'] ?? 0),
    });
  }

  if (intent === 'assign-bibs') {
    const result = await writeTiming('assign_bibs', { p_event_slug: slug });

    if (result.state === 'unavailable') return backTo(request, slug, 'unavailable');
    if (result.state === 'refused') return backTo(request, slug, result.reason);

    const assigned = Number(result.data['assigned'] ?? 0);
    const already = Number(result.data['already_assigned'] ?? 0);

    // ⚠️ **"Nothing was numbered" is a success and has to read like one.** `assign_bibs()` is
    // idempotent by skipping, so a second press is meant to do nothing — and a message saying
    // *"0 entries were numbered"* invites somebody to conclude it failed and go looking for a
    // problem that does not exist.
    return assigned === 0
      ? backTo(request, slug, 'bibs-already-assigned')
      : backTo(request, slug, 'bibs-assigned', { assigned, already });
  }

  if (intent === 'override-bib') {
    const teamId = String(form.get('team_id') ?? '');
    const legRaw = String(form.get('leg') ?? '');

    // ⚠️ **Shape-checked here rather than left to Postgres.** A non-UUID reaches `uuid` as a
    // cast failure, which is a thrown `PostgrestError` and would render as *"the database
    // could not be reached"* — an outage message for a field somebody typed wrong. The
    // database still enforces every rule that matters; this keeps a defect out of the one
    // path that cannot tell a refusal from an outage.
    if (!UUID.test(teamId)) return backTo(request, slug, 'no_such_team');
    if (legRaw !== '1' && legRaw !== '2') return backTo(request, slug, 'no_such_leg');

    const bib = text(form, 'bib');

    const result = await writeTiming('set_bib_override', {
      p_event_slug: slug,
      p_team_id: teamId,
      p_leg: Number(legRaw),
      // An empty box clears the override, which `set_bib_override()` stores as null and never
      // as `''`. Both read as absent, and one of them is a value that looks like a bib.
      p_bib: bib,
    });

    if (result.state === 'unavailable') return backTo(request, slug, 'unavailable');
    if (result.state === 'refused') return backTo(request, slug, result.reason);

    return backTo(request, slug, bib === null ? 'bib-cleared' : 'bib-set');
  }

  if (intent === 'walk-in') {
    const firstname = text(form, 'firstname');
    const lastname = text(form, 'lastname');

    if (firstname === null || lastname === null) {
      return backTo(request, slug, 'incomplete');
    }

    const gender = text(form, 'gender');
    if (gender !== null && !CATEGORIES.has(gender)) {
      return backTo(request, slug, 'incomplete');
    }

    // ⚠️ **An age, and never a date of birth.** The whole registration slice exists to hold
    // that boundary, and a desk form is exactly where somebody would helpfully add the field
    // back. A value that is not one to three digits is refused rather than sent as a null,
    // because silently dropping a typed age puts somebody in no prize band without saying so.
    const ageRaw = text(form, 'age_on_day');
    if (ageRaw !== null && !/^\d{1,3}$/.test(ageRaw)) {
      return backTo(request, slug, 'incomplete');
    }

    const result = await writeTiming('add_walk_in', {
      p_event_slug: slug,
      p_firstname: firstname,
      p_lastname: lastname,
      p_gender: gender,
      p_age_on_day: ageRaw === null ? null : Number(ageRaw),
      p_club_name: text(form, 'club_name'),
    });

    if (result.state === 'unavailable') return backTo(request, slug, 'unavailable');
    if (result.state === 'refused') return backTo(request, slug, result.reason);

    return backTo(request, slug, 'walk-in-added');
  }

  // An intent nobody wrote down. Nothing was read and nothing was written.
  return backTo(request, slug, 'refused');
}
