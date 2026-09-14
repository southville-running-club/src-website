import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse, type NextRequest } from 'next/server';
import { createUserClient } from '@src/shared';
import {
  ACCESS_COOKIE,
  EXPIRY_COOKIE,
  parseSessionExpiry,
} from '@src/shared/session-cookies';
import { holdsPermissionFor, surfaceFor } from './lib/access';

/**
 * The door to `/timing`: staff with a timing permission, and an ordinary 404 for everybody
 * else.
 *
 * ## Why this file is called `middleware.ts` when Next 16 says it should not be
 *
 * ⚠️ **Do not run the codemod Next suggests.** Next 16 deprecates `middleware.ts` in favour of
 * `proxy.ts`, and the build prints a warning saying so on every run. `proxy.ts` **cannot be
 * used here**: it runs only on the Node.js runtime — setting `runtime` in a proxy file throws —
 * and `@opennextjs/cloudflare` refuses it outright:
 *
 *     ERROR Node.js middleware is not currently supported. Consider switching to Edge
 *     Middleware.
 *
 * That was tried, against this exact OpenNext version, and the build fails. OpenNext's own
 * `useNodeMiddleware()` looks for an entry in the **edge** middleware manifest first and only
 * rejects what is left, which is why the deprecated convention is the supported one. Rename
 * this file the day OpenNext supports a Node proxy, and not before.
 *
 * ## Why the gate is here rather than in a layout
 *
 * It was in `app/(staff)/layout.tsx`, and that looked right and was wrong.
 *
 * `notFound()` thrown during a **dynamic** render — and reading cookies makes the render
 * dynamic — does not server-render the not-found page. Next returns an empty error shell,
 * `<html id="__next_error__">`, with the entire page in the streamed RSC payload for the
 * client to render. Measured signed out against this Worker: **zero `<h1>` in the HTML**, no
 * banner, no footer, and the refusal text present only inside a `<script>`. With JavaScript
 * off — which is a whole Playwright project here, and a real visitor — the page was blank.
 * Moving the throw from the layout into the page changed nothing, because both are dynamic.
 *
 * So nothing throws. A refused request is **rewritten to an address that matches no route**,
 * and Next serves its *prerendered* not-found page: real server-rendered HTML, status 404,
 * with the banner, the footer and the privacy notice on it — byte for byte what a genuinely
 * missing address under `/timing` returns. That is the point: a refusal must be
 * indistinguishable from an address that does not exist, or it discloses that this one is a
 * door.
 *
 * ## What it reads, and what it deliberately does not do
 *
 * It **reads** the session and **never writes one**. `apps/main/worker/session.ts` mints,
 * refreshes and slides the idle window; this refuses anything it is not sure of: no access
 * token, no readable `src_ax` or one already past (ADR-019's deadline), or
 * `identity.my_permissions()` failing or holding no `timing.*` permission — Supabase validates
 * the access token on that call.
 *
 * ⚠️ **It never refreshes, so it can never extend a session.** A volunteer whose token lapsed
 * after thirty idle minutes is refused here and put right by opening any page on the club's
 * side. A small cost on the safe side, and it keeps the only code that writes a session cookie
 * in one file. Since [#244](https://github.com/southville-running-club/src-website/issues/244)
 * a marshal's page keeps its own session alive by polling `/account/keep-alive/` on the club's
 * Worker, which is the same origin — so the one case where thirty minutes was genuinely too
 * short is answered without this file learning to write a cookie.
 *
 * ## Why the permission check is here and not in each page — #243
 *
 * ⚠️ **This door used to admit anybody holding *any* `timing.*` permission**, which was right
 * for a holding page and wrong the moment a page does something: a `timing-marshal` holds one
 * permission and reached every address a `timing-admin` did. The obvious fix is for each page
 * to check itself, and **a page in this application cannot refuse** — see the section above:
 * `notFound()` from a dynamic render produces a blank page with JavaScript off, which is what
 * moved the gate here in the first place.
 *
 * So the refusal stays in the one place that has a proven mechanism, and what each page would
 * have checked lives in `lib/access.ts` as a table. `surfaceFor()` says what an address
 * demands; an address with no row is refused, so adding a page without adding a row is a page
 * that does not open rather than one that opens to anybody.
 *
 * ## What this door checks, what it costs, and the one thing it deliberately does not check
 *
 * Per request, against Supabase:
 *
 * | Address | Calls | What they are |
 * | --- | --- | --- |
 * | Everything under `/timing` | **1** | `identity.my_permissions()` |
 * | `/timing/marshal/<slug>/…` | **2** | and `timing.marshal_event()`, ADR-036's roster scope |
 *
 * ⚠️ **It does not check that the slug names a race, and that is
 * [ADR-044](../../../docs/architecture/decisions/adr-044-a-missing-race-under-timing-answers-200.md)
 * rather than an omission.** So `/timing` has two not-found answers with two statuses: a
 * refusal here is rewritten to an address matching no route and Next serves its *prerendered*
 * not-found page with a real **404**, while a caller who holds the permission and asks for a
 * race that is not there gets past this door, the page's own read answers `none`, and the page
 * renders `app/not-found-body.tsx` with a **200**. The bodies are identical — one component
 * renders both — and only the status differs.
 *
 * **Making the two agree means this door learning the answer, and the answer is a database
 * call.** The marshal branch below is the shape, and the reason it is affordable there is that
 * `marshal_event()` answers a question the door has to ask anyway: ADR-036's roster scope. No
 * event address has one of those. Buying it for the twelve event addresses would mean a
 * **second** call at this door on every one of their page views, and it is a strict duplicate of
 * the read the page then makes for itself — plus
 * a thirty-sixth granted function in `timing`, because none of the thirty-five answers
 * *"does this slug name a race"* at the permission each address actually demands:
 * `event_detail()` is behind `timing.event.manage`, so calling it here would silently `and`
 * that permission onto `/registration/`, `/marshals/`, `/anomalies/` and the rest. ADR-044
 * carries the trade and what would change our mind.
 */

/**
 * An address that matches no route. Rewriting to it is what produces the prerendered
 * not-found page — the refusal is the site's ordinary 404 and not a page of its own.
 */
const REFUSED_PATH = '/__refused';

/** A Supabase client carrying this request's own session, or `null` if there is not one. */
type PersonClient = ReturnType<typeof createUserClient>;

/**
 * The signed-in caller this request carries, or `null` for a session this door will not act
 * on: no access token, or a `src_ax` deadline that is missing, unreadable or already past.
 *
 * ⚠️ **One client for both reads, rather than one per question.** A `rosterScoped` address asks
 * two things of the database and the second must be asked as the same person as the first;
 * building the client twice from the same cookie would work and would be two places for that
 * to stop being true.
 */
function callerFor(request: NextRequest): PersonClient | null {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return null;
  }

  const deadline = parseSessionExpiry(request.cookies.get(EXPIRY_COOKIE)?.value);
  if (deadline === null || deadline <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const { env } = getCloudflareContext();
  return createUserClient(
    { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
    accessToken,
  );
}

/**
 * What this caller holds, or `null` when the read itself failed.
 *
 * `null` rather than an empty array, so "this person holds nothing" and "we could not find
 * out" cannot be confused by a caller. Both refuse, and only one is worth a log line.
 */
async function permissionsOf(asPerson: PersonClient): Promise<string[] | null> {
  const { data, error } = await asPerson.rpc('my_permissions');
  if (error) {
    // A code and a message, never a row — the discipline `apps/main/worker/admin.ts` keeps,
    // because a log line is somewhere a volunteer's data must not end up.
    console.error(
      `timing: permission read unavailable — ${error.code}: ${error.message}`,
    );
    return null;
  }

  return Array.isArray(data)
    ? data.filter((p): p is string => typeof p === 'string')
    : [];
}

/**
 * Whether this caller is on that event's roster — ADR-036's scope, checked after the
 * permission and never instead of it.
 *
 * ⚠️ **`marshal_event()` answers `null` for all three refusals** — no permission, no such
 * event, not rostered — and this function does not try to tell them apart, because the door
 * must not. All three are the ordinary 404, which is the only answer that does not disclose
 * which slugs name a race.
 *
 * ⚠️ **`.schema('timing')` is not optional.** `createUserClient` pins `db.schema` to
 * `identity`, which is what lets the permission read above be a bare `.rpc()`; a bare call
 * here would look for `identity.marshal_event` and fail in a way that reads as a missing
 * function. `lib/reads.ts` carries the whole class of bug.
 *
 * An error refuses, like every other unknown here. A marshal whose door read failed sees the
 * 404 and tries again; the alternative — admitting on an error — is a door that opens during
 * an outage.
 */
async function isRostered(asPerson: PersonClient, eventSlug: string): Promise<boolean> {
  const { data, error } = await asPerson
    .schema('timing')
    .rpc('marshal_event', { p_event_slug: eventSlug });

  if (error) {
    console.error(`timing: roster read unavailable — ${error.code}: ${error.message}`);
    return false;
  }

  return data !== null;
}

async function mayOpen(request: NextRequest): Promise<boolean> {
  // Asked **before** the session is read, because an address nobody has written a rule for is
  // refused whoever is asking, and there is no reason to call Supabase to find that out.
  const surface = surfaceFor(request.nextUrl.pathname);
  if (surface === null) {
    return false;
  }

  const asPerson = callerFor(request);
  if (asPerson === null) {
    return false;
  }

  const permissions = await permissionsOf(asPerson);
  if (permissions === null) {
    return false;
  }

  if (!holdsPermissionFor(permissions, surface)) {
    return false;
  }

  // ⚠️ **The roster is a second check and never a substitute for the first.** ADR-036 makes
  // `timing.marshals` a scope checked *after* the permission, for everybody — a `timing-admin`
  // holds `timing.crossing.record` and is refused here on an event they are not rostered to,
  // exactly as `record_crossing()` refuses them. They add themselves at
  // `/timing/events/<slug>/marshals/`.
  //
  // ⚠️ **This branch used to refuse outright**, because nothing answered *"am I on this
  // roster"* to the marshal asking — #245's four functions are all behind an admin's
  // permission. #203's `timing.marshal_event()` is that read, and the second call is what a
  // `rosterScoped` address costs. Every other address makes one call and is unaffected.
  if (surface.rosterScoped) {
    // A `rosterScoped` surface always names an event — `surfaceFor` only sets the flag on
    // `/timing/marshal/<slug>/…`, where the slug is the second segment. Refusing a null is the
    // safe reading of a shape that should not occur.
    return surface.eventSlug !== null && (await isRostered(asPerson, surface.eventSlug));
  }

  return true;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (await mayOpen(request)) {
    return NextResponse.next();
  }

  const refused = request.nextUrl.clone();
  refused.pathname = REFUSED_PATH;
  return NextResponse.rewrite(refused);
}

export const config = {
  /**
   * ⚠️ **`'/'` is a separate entry and is load-bearing.** With `basePath: '/timing'` Next
   * prefixes every matcher, so the pattern below becomes `/timing/…` and needs a trailing
   * segment — bare `/timing`, which is the address people actually visit, matched nothing and
   * sailed straight past the gate. Measured: without this entry the middleware never ran on
   * `/timing` and set no header at all. The documentation does not mention the interaction.
   *
   * `health` is excluded on purpose: `scripts/smoke.mjs` reads it daily against production and
   * Playwright waits on it before running anything — and a readiness check does not accept a
   * 404, so gating it would stop every test from starting. The `_next` and favicon exclusions
   * keep the gate off this Worker's own assets, which the refusal page itself needs to load.
   *
   * ⚠️ **`sw.js` and `manifest.webmanifest` are excluded because gating them breaks them
   * silently** — #203. A refused request here is *rewritten* rather than errored, so a gated
   * service worker would be served the not-found page's **HTML** with a 404: the browser
   * refuses to register it, `navigator.serviceWorker.register()` rejects, and the capture
   * screen's catch swallows it. The symptom is no symptom at all until a marshal reloads with
   * no signal. Neither file discloses anything — the worker is static caching rules and the
   * manifest is a name and a colour — and the page they cache is still behind this door.
   */
  matcher: [
    '/',
    '/((?!health|sw\\.js|manifest\\.webmanifest|_next/static|_next/image|favicon).*)',
  ],
};
