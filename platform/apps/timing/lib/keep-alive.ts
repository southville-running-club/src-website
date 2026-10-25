/**
 * Keeping a working volunteer signed in on `/timing` — the rules, apart from any screen.
 *
 * ## Why `/timing` needs this at all
 *
 * ADR-019 ends a session after thirty minutes with no request to the club's own Worker, and
 * only that Worker writes a session cookie. Cloudflare sends `/timing/*` to a different Worker
 * at the edge, which reads the session and never refreshes it, so a volunteer working only on
 * `/timing` sends the club's Worker nothing at all. [#244](https://github.com/southville-running-club/src-website/issues/244)
 * answered that with `GET /account/keep-alive/` on the club's Worker — same origin, so the
 * cookies are the volunteer's own — called from the page while somebody is working on it.
 *
 * ## What counts as working, which is ADR-019's line and not this file's
 *
 * **A tap, or a crossing that landed, in the last twenty-five minutes, on a page that is
 * visible.** A phone face-up on a table with nobody touching it is idle and lapses, exactly as
 * any other page on this platform would. Nothing here widens that.
 *
 * ## The two gaps this file closes — 25 October 2026
 *
 * 1. **The wait before the first runner.** A finish marshal who opens the screen at the 10:30
 *    briefing and touches nothing until the winner arrives was signed out at about 11:20 —
 *    before the winner. The keep-alive stopped at twenty-five minutes, the cookies ran out
 *    thirty minutes after the last one, and the first thing to meet the lapsed session was the
 *    first crossing of the day. **The answer is a prompt rather than a longer window**: after
 *    twenty minutes with nothing touched the screen offers a large "Keep me signed in" button,
 *    and pressing it *is* a tap — so ADR-019's definition of working is unchanged, and a
 *    marshal who is there has about half an hour to notice it.
 *
 * 2. **A false "signed out" banner once an hour.** The access token lives an hour, the timing
 *    Worker refuses an expired one, and the keep-alive only renewed it in its last sixty
 *    seconds — which a five-minute poll lands in about one time in five. The club's Worker now
 *    renews it ten minutes early for the keep-alive (`KEEP_ALIVE_REFRESH_WINDOW_SECONDS` in
 *    `apps/main/worker/session.ts`), and `throughDoor()` below is the backstop: a refusal is
 *    answered with one keep-alive and one retry before anybody is told they are signed out.
 */

/** How often a page that is being worked on calls the keep-alive. */
export const KEEP_ALIVE_MS = 5 * 60_000;

/**
 * How long after the last tap a page still counts as being worked on.
 *
 * ⚠️ **ADR-019's number, restated rather than chosen here.** Widening it is a decision about the
 * idle window, not a fix to this file.
 */
export const ACTIVE_WINDOW_MS = 25 * 60_000;

/**
 * How long after the last tap the "Keep me signed in" prompt appears.
 *
 * Before `ACTIVE_WINDOW_MS`, so the prompt is on screen while the keep-alive is still running —
 * the session then survives roughly another half an hour (the last keep-alive goes out by
 * twenty-five minutes, and the cookies last thirty after it), which is the time a marshal has
 * to notice the prompt.
 */
export const STAY_PROMPT_AFTER_MS = 20 * 60_000;

/** How often a page checks whether the prompt is due. Coarse is fine: it is a twenty-minute clock. */
export const STAY_CHECK_MS = 30_000;

/** The club's Worker, same origin. Never this Worker's own — only that one writes a cookie. */
export const KEEP_ALIVE_PATH = '/account/keep-alive/';

/** Whether a page whose last tap was at `lastActivity` still counts as being worked on. */
export function isActive(lastActivity: number, now: number): boolean {
  return now - lastActivity <= ACTIVE_WINDOW_MS;
}

/** Whether the "Keep me signed in" prompt is due. */
export function shouldOfferStay(lastActivity: number, now: number): boolean {
  return now - lastActivity >= STAY_PROMPT_AFTER_MS;
}

/**
 * One keep-alive. Never throws: offline, or the club's Worker having a moment, and the session
 * simply lapses on its own schedule — the capture queue survives that either way.
 *
 * ⚠️ **Its answer is deliberately not read.** `/account/keep-alive/` answers 204 to a live
 * session, a dead one and no session at all, so that it is not an oracle for a copied cookie
 * jar. What says whether somebody is still let in is the next request through the door.
 */
export async function sendKeepAlive(): Promise<void> {
  try {
    await fetch(KEEP_ALIVE_PATH, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    // See above.
  }
}

/**
 * A request to this Worker that the door might refuse, retried **once** after a keep-alive.
 *
 * ⚠️ **A refusal is a 404, and it is not always a lapsed session.** It is also what a token
 * that expired a minute ago looks like inside a session that is perfectly alive — the timing
 * Worker reads the token and never refreshes it. One keep-alive renews the token if the session
 * is still there, and the retry then gets in; if it still refuses, the session really has
 * ended, or the marshal has been taken off the roster, and the caller says so.
 *
 * `mayRenew` is asked before the keep-alive is sent, and a page passes its own answer to "is
 * somebody working on this" — so a retry can never keep a session alive that the poll itself
 * would have let go. Safe to resend: a refused request never reached a route, and the one write
 * that goes through here, `record_crossing()`, is idempotent by the crossing's own id.
 */
export async function throughDoor(
  send: () => Promise<Response>,
  mayRenew: () => boolean,
): Promise<Response> {
  const first = await send();
  if (first.status !== 404 || !mayRenew()) {
    return first;
  }

  await sendKeepAlive();
  return send();
}
