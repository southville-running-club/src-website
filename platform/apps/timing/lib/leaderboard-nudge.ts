import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Tell every screen watching one race that something about it changed — #204.
 *
 * ## ⚠️ Advisory, always, and never allowed to fail the thing it follows
 *
 * Every caller has already written to Postgres by the time this runs. A crossing is recorded, an
 * anomaly is resolved, a runner is disqualified — **the fact is durable before the nudge is
 * attempted**, and the nudge is only how a board finds out seconds early rather than on its next
 * reconnect. So nothing here throws, nothing here is branched on, and no caller reports it:
 *
 * ⚠️ **A marshal's capture must never be reported as failed because a leaderboard nobody is
 * watching could not be told about it.** That is the whole contract, and it is why this is a
 * separate module from `writes.ts` — a write's outcome is something a volunteer reads, and this is
 * not.
 *
 * ## Why a Durable Object at all, and what the room is holding
 *
 * [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md):
 * Supabase Realtime caps at 200 concurrent connections and hibernatable WebSockets on Durable
 * Objects are close to free at this scale. The room holds **no race data** — see
 * `durable-objects/leaderboard-room.ts` — so this nudge carries none either. A screen answers it by
 * re-reading `timing.leaderboard()` over the ordinary permissioned HTTP path, which is what keeps
 * one read, one set of permissions, and one place where a decision like *"may a guide's role travel
 * to this audience"* is taken.
 *
 * ⚠️ **And it is what keeps the slice cuttable.** ADR-034 makes this the thing the race simulation
 * cuts if it fails. Deleting this module and the binding leaves a server-rendered board that
 * refreshes when somebody reloads it — which is exactly what it does today with JavaScript off.
 */

/** The nudge itself. Answers whether a room was reached, for a caller that wants to know. */
async function deliver(
  rooms: LeaderboardRoomNamespace,
  eventSlug: string,
): Promise<boolean> {
  try {
    // The host is never resolved: a Durable Object stub's `fetch` is routed by the stub rather
    // than by DNS, and the URL exists only because `Request` requires one. `.invalid` is the
    // reserved TLD for exactly this, so a future change that accidentally made this a real
    // network call would fail loudly rather than reach somebody's server.
    const response = await rooms
      .getByName(eventSlug)
      .fetch(new Request('https://leaderboard.invalid/nudge', { method: 'POST' }));

    return response.ok;
  } catch (cause) {
    // A code and a message, never a row — the discipline `apps/main/worker/admin.ts` keeps,
    // because a log line is somewhere a volunteer's data must not end up. The slug is the club's
    // own and names nobody.
    console.error(
      `timing: leaderboard nudge for ${eventSlug} failed — ${
        cause instanceof Error ? cause.message : cause
      }`,
    );
    return false;
  }
}

/**
 * Nudge one race's room **after the response has gone**, and never before it.
 *
 * ⚠️ **`ctx.waitUntil` rather than an `await` in the handler, and the marshal sync path is why.**
 * That address drains an offline queue over whatever signal a phone has at a junction; adding a
 * round trip to it before the response would make the slowest path on the platform slower for the
 * benefit of a screen on somebody else's laptop. `waitUntil` keeps the Worker alive for the nudge
 * without the client waiting for it.
 *
 * ⚠️ **`ctx.waitUntil` and not Next's `after()`, deliberately.** `after()` would read better and
 * this repository's rule is to measure rather than assume: the `ExecutionContext` is what
 * `@opennextjs/cloudflare` provably puts in its request-context store — `runWithCloudflareRequestContext`
 * — and whether Next's own hook is wired through that adapter is a thing to find out on a laptop
 * rather than on a race night. Revisit it if `after()` is ever confirmed here.
 *
 * ⚠️ **A missing binding and a missing context are both silent.** `LEADERBOARD` is absent under
 * `next dev` before OpenNext's dev bridge has attached, and in any environment where the Durable
 * Object is not bound; the board then degrades to not refreshing itself, which is the same thing it
 * does with JavaScript off. Never an error a volunteer sees.
 */
export async function scheduleLeaderboardNudge(eventSlug: string): Promise<void> {
  try {
    const { env, ctx } = await getCloudflareContext({ async: true });
    const rooms = env.LEADERBOARD;

    if (!rooms) {
      return;
    }

    ctx.waitUntil(deliver(rooms, eventSlug));
  } catch {
    // No Cloudflare context — `next dev` before the bridge attaches, or a unit test. Nothing to
    // log: the write has already succeeded and this was never the point of the request.
  }
}
