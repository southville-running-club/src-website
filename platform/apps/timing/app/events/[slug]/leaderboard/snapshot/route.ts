import { NextResponse } from 'next/server';
import { readLeaderboard } from '../../../../../lib/leaderboard';

/**
 * `GET /timing/events/<slug>/leaderboard/snapshot` — the board as JSON, for a screen that has just
 * been told something changed.
 *
 * Issue [#204](https://github.com/southville-running-club/src-website/issues/204). Behind
 * `timing.event.manage` **or** `timing.crossing.resolve`, exactly like the page beside it;
 * `lib/access.ts` maps it and `middleware.ts` enforces it, and there is deliberately no
 * authorisation check in this file — `timing.leaderboard()` asks
 * `identity.has_permission()` for itself against the caller's own token. A third statement of one
 * rule is the one that goes stale.
 *
 * ## ⚠️ Why the socket does not simply carry the board
 *
 * This address is the answer to that question, and it is the property the whole design rests on.
 * The Durable Object's nudge says *"ask again"* and carries **no race data at all** — so there is
 * exactly **one** permissioned read of a race in this application, and one place where a decision
 * like *"may a guide's role travel to this audience"* is taken. A socket that pushed rows would be
 * a second read with its own authorisation to get right, its own shape to keep in step with the
 * SQL, and no `middleware.ts` in front of it.
 *
 * It also means a screen whose session lapsed mid-race finds out **here**, on an ordinary 404,
 * rather than going on receiving a race it may no longer look at.
 *
 * ## A GET, and the one address here that is
 *
 * Every other `fetch` target under `/timing` is a POST, because every other one writes. This reads,
 * so it is a GET — and `lib/access.ts` gates it by the same table rather than by the verb, which is
 * what makes `leaderboard/feed` a 404 rather than something nobody decided about.
 *
 * ⚠️ **Nothing links to it and nothing needs to.** With scripting off the page renders the same
 * board server-side and this address is never called; `live-board.tsx`'s header carries that
 * argument.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  const read = await readLeaderboard(slug);

  if (read.state === 'none') {
    // The ordinary refusal, and deliberately the same answer for "you may not" and "no such race"
    // — the property every read in `timing` holds, so a slug cannot be probed for existence. The
    // board keeps its last good state rather than emptying; `live-board.tsx` says why.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (read.state === 'unavailable') {
    // ⚠️ **503 and not 404**, because the two mean opposite things to the screen: a refusal is
    // permanent and an outage is not. The client treats both as *stop updating*, and a volunteer
    // reading a Worker log after a race deserves to be able to tell them apart.
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  return NextResponse.json(read.data, {
    // ⚠️ **`no-store`, and it is not housekeeping.** A cached snapshot is a board that answers a
    // nudge with the state it already had — the one failure this endpoint exists to rule out.
    headers: { 'cache-control': 'no-store' },
  });
}
