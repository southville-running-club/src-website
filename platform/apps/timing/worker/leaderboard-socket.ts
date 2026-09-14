import { createUserClient } from '@src/shared';
import {
  ACCESS_COOKIE,
  EXPIRY_COOKIE,
  parseSessionExpiry,
} from '@src/shared/session-cookies';
import { holdsPermissionFor, surfaceFor } from '../lib/access';

/**
 * The one request under `/timing` that Next never sees, and why it has to be this one.
 *
 * ## ⚠️ A WebSocket upgrade cannot come out of a Next route handler
 *
 * The upgrade is a `101` response carrying a `webSocket` property — a Workers-runtime-specific
 * field on `Response`, not a header and not a body. Everything under `app/` is served by
 * OpenNext's Next server, which converts every response through Next's own request/response
 * pipeline; a `webSocket` on a `Response` has nowhere to live in that conversion and the client
 * half of the pair would be dropped with no error anywhere. `middleware.ts` cannot do it either
 * — it returns `NextResponse`, which is the same conversion one step earlier.
 *
 * So the socket is answered in the Worker's own entrypoint, **before** OpenNext is asked. That
 * is `worker-entry.js`, and this module is what it calls.
 *
 * ## ⚠️ Which means the door has to be here too, and that is the part to read carefully
 *
 * [ADR-037](../../../../docs/architecture/decisions/adr-037-timing-stays-on-next-under-opennext.md)
 * and [#243](https://github.com/southville-running-club/src-website/issues/243) put the refusal
 * in `middleware.ts` and nowhere else, because *a page here provably cannot refuse* —
 * `notFound()` during a dynamic render returns an empty shell. **This is not an exception to
 * that rule; it is the same rule applied to a request middleware never receives.** The refusal
 * is still in exactly one place per request, it still reads the permission from
 * `lib/access.ts`'s table rather than deciding for itself, and a spelling nobody wrote a row for
 * is refused here exactly as it is there.
 *
 * Three properties keep the two doors honest rather than merely similar:
 *
 * | | |
 * | --- | --- |
 * | **One table** | `surfaceFor()` and `holdsPermissionFor()` are the same functions `middleware.ts` calls. `access.test.ts` asserts the row for this address, so the socket and the snapshot it tells a screen to re-read cannot disagree about who may look |
 * | **One refusal** | a plain `404` with no body, which is what `middleware.ts` produces for the page beside it. Not a `403`: a 403 discloses that the address exists, which is the property `/timing` has held since 11 September 2026 |
 * | **No data on the socket** | see `durable-objects/leaderboard-room.ts`. Even a socket opened by somebody who should not have it learns only *"something changed"* — the race itself is read over the ordinary permissioned HTTP path, by `timing.leaderboard()`, which authorises for itself |
 *
 * ⚠️ **The third is the one that makes this safe rather than merely careful.** If this check were
 * wrong tomorrow, the disclosure is one bit per crossing and no name, no bib and no time.
 *
 * ## It reads a session and never writes one
 *
 * `middleware.ts`'s rule, for its reason: only `apps/main` mints, refreshes or slides a session,
 * and Cloudflare dispatches `/timing/*` here at the edge. A volunteer whose token lapsed mid-race
 * finds the socket refused and the page's own snapshot refused a moment later; they are put right
 * by opening any page on the club's side. **A socket may therefore outlive the session that
 * opened it**, which is deliberate — the alternative is dropping a screen at the finish line
 * because a twelve-hour deadline passed, and the screen carries no data of its own to protect.
 */

/** The address the client connects to, as the last segment under a race's leaderboard. */
const SOCKET_SEGMENT = 'live';

/** This application's own base path, as `next.config.ts` sets it. */
const BASE_PATH = '/timing';

/**
 * Whether this request is the leaderboard socket, and for which race.
 *
 * ⚠️ **The `Upgrade` header is part of the question rather than checked afterwards.** A plain
 * `GET` of the same address must fall through to Next — where it meets the ordinary door and
 * then Next's own not-found page — rather than be answered here with something a browser cannot
 * use. Two spellings of one address answered by two different things is how a surface grows a
 * hole nobody is looking at.
 */
function socketRequestFor(request: Request): string | null {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return null;
  }

  const { pathname } = new URL(request.url);
  const segments = pathname.split('/').filter(Boolean);

  // `/timing/events/<slug>/leaderboard/live`. The base path is present here and not in
  // `middleware.ts` — Next strips it before middleware sees it, and nothing strips it before the
  // Worker's own entrypoint does. `lib/access.ts`'s `segmentsOf` accepts both spellings for
  // exactly this reason.
  if (
    segments.length !== 5 ||
    `/${segments[0]}` !== BASE_PATH ||
    segments[1] !== 'events' ||
    segments[3] !== 'leaderboard' ||
    segments[4] !== SOCKET_SEGMENT
  ) {
    return null;
  }

  return segments[2] ?? null;
}

/** One cookie out of a raw `Cookie` header. `middleware.ts` gets this from Next's cookie store. */
function cookieFrom(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}

/**
 * Whether the session on this request may watch this race's leaderboard.
 *
 * The same three steps `middleware.ts` takes, in the same order and refusing on the same
 * answers: no readable access token, a deadline that has passed or will not parse, a permission
 * read that failed, or a permission the address's row does not name.
 */
async function mayWatch(
  request: Request,
  env: CloudflareEnv,
  eventSlug: string,
): Promise<boolean> {
  // Asked first, because an address nobody has written a rule for is refused whoever is asking
  // and there is no reason to call Supabase to find that out. `middleware.ts` does the same.
  const surface = surfaceFor(`/events/${eventSlug}/leaderboard/${SOCKET_SEGMENT}`);
  if (surface === null) {
    return false;
  }

  const cookies = request.headers.get('Cookie');
  const accessToken = cookieFrom(cookies, ACCESS_COOKIE);
  if (!accessToken) {
    return false;
  }

  const deadline = parseSessionExpiry(cookieFrom(cookies, EXPIRY_COOKIE));
  if (deadline === null || deadline <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const asPerson = createUserClient(
    { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
    accessToken,
  );

  const { data, error } = await asPerson.rpc('my_permissions');
  if (error) {
    // A code and a message, never a row — the discipline `apps/main/worker/admin.ts` keeps,
    // because a log line is somewhere a volunteer's data must not end up. Refusing on an outage
    // is the safe direction and costs a screen that does not live-update.
    console.error(`timing: leaderboard socket permission read failed — ${error.code}`);
    return false;
  }

  const permissions = Array.isArray(data)
    ? data.filter((p): p is string => typeof p === 'string')
    : [];

  return holdsPermissionFor(permissions, surface);
}

/**
 * Answer the leaderboard socket, or `null` to say *"this was not for me"*.
 *
 * ⚠️ **`null` and not a thrown error is the contract the entrypoint depends on**: every other
 * request under `/timing` — every page, every form, the health check, every asset — passes
 * through this function on its way to OpenNext, so anything but a cheap, certain `null` here is
 * a cost or a failure on the whole application. The two header reads and one `URL` parse above
 * are the whole of it before a request is known to be the socket.
 */
export async function handleLeaderboardSocket(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const eventSlug = socketRequestFor(request);
  if (eventSlug === null) {
    return null;
  }

  // ⚠️ **Not a 501 or a 503 when the binding is absent.** Under `next dev`, and in any
  // environment where the Durable Object is not bound, the honest answer is the same one a
  // refused socket gets — the screen falls back to the snapshot it already rendered. A distinct
  // status here would be a way to ask this Worker whether a race exists.
  const rooms = env.LEADERBOARD;
  if (!rooms) {
    return new Response(null, { status: 404 });
  }

  if (!(await mayWatch(request, env, eventSlug))) {
    // The ordinary 404 `middleware.ts` produces, with no body — a 403 would disclose that the
    // address exists, which is the property `/timing` has held since 11 September 2026.
    return new Response(null, { status: 404 });
  }

  // One room per race, named by the slug, so two screens on the same race land in the same room
  // and a nudge for one race never wakes another's.
  return rooms.getByName(eventSlug).fetch(request);
}
