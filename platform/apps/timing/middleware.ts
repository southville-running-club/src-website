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
 */

/**
 * An address that matches no route. Rewriting to it is what produces the prerendered
 * not-found page — the refusal is the site's ordinary 404 and not a page of its own.
 */
const REFUSED_PATH = '/__refused';

/**
 * What this request's session holds, or `null` for every reason there is: no access token, a
 * deadline that is missing, unreadable or past, or a permission read that failed.
 *
 * `null` rather than an empty array, so "this person holds nothing" and "we could not find
 * out" cannot be confused by a caller. Both refuse, and only one is worth a log line.
 */
async function permissionsOf(request: NextRequest): Promise<string[] | null> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return null;
  }

  const deadline = parseSessionExpiry(request.cookies.get(EXPIRY_COOKIE)?.value);
  if (deadline === null || deadline <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const { env } = getCloudflareContext();
  const asPerson = createUserClient(
    { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
    accessToken,
  );

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

async function mayOpen(request: NextRequest): Promise<boolean> {
  // Asked **before** the session is read, because an address nobody has written a rule for is
  // refused whoever is asking, and there is no reason to call Supabase to find that out.
  const surface = surfaceFor(request.nextUrl.pathname);
  if (surface === null) {
    return false;
  }

  const permissions = await permissionsOf(request);
  if (permissions === null) {
    return false;
  }

  if (!holdsPermissionFor(permissions, surface)) {
    return false;
  }

  // ⚠️ **An address whose roster scope is not yet enforceable is refused, not admitted.**
  // ADR-036 makes `timing.marshals` a scope checked *after* the permission, and reading it as
  // the marshal themselves needs a function that does not exist. The choice here is between
  // admitting on the permission alone until then, and refusing until the second half exists.
  // **Refusing is the only one that cannot be shipped by accident**: the other leaves a door
  // that is open by omission, discovered when a marshal opens somebody else's event. It costs
  // nothing today, because no page is served under `/timing/marshal/` at all.
  //
  // ⚠️ **This used to say #245 would replace the branch, and #245 did not.** That issue built
  // the roster page's four functions, all behind `timing.marshal.assign`, which is an admin's
  // permission — none of them answers *"am I on this roster"* for the marshal asking. The
  // screen that needs that answer is
  // [#203](https://github.com/southville-running-club/src-website/issues/203), and the read
  // belongs with it. The `rosterScoped` flag exists so that removing this is a deliberate act
  // rather than a line somebody deletes while passing.
  return !surface.rosterScoped;
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
   */
  matcher: ['/', '/((?!health|_next/static|_next/image|favicon).*)'],
};
