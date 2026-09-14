import { DurableObject } from 'cloudflare:workers';

/**
 * One room per race: the sockets watching a leaderboard, and a nudge when it changes.
 *
 * ## ⚠️ It is a delivery mechanism and nothing else, and that is
 * [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)'s
 * own instruction rather than a preference
 *
 * The Durable Objects leaderboard is the slice ADR-034 cuts if the race simulation fails, and
 * *"falling back to Supabase Realtime must stay possible"*. So this class holds **no
 * derivation, no race data and no state worth losing**. It broadcasts one word — *something
 * about this race changed* — and every connected screen answers it by re-reading
 * `timing.leaderboard()` through the ordinary permissioned HTTP path. Deleting this file and
 * the binding would leave a working, server-rendered leaderboard that no longer refreshes
 * itself; nothing else about the surface would have to be rewritten.
 *
 * ⚠️ **That is also why it carries no leaderboard payload.** A message holding names and times
 * would make the socket a second read of the race, with its own authorisation to get right and
 * its own shape to keep in step with the SQL. The nudge carries a monotonic counter and a
 * timestamp, and the screen asks the database what changed — one read path, one set of
 * permissions, one place where a guide's `role` is decided about.
 *
 * ## Hibernatable, because the race is two hours of nothing happening
 *
 * `ctx.acceptWebSocket()` rather than `server.accept()`: the Durable Object is evicted from
 * memory between messages and the sockets survive it, so a field of marshals' and volunteers'
 * screens open for two hours costs duration only while something is actually being delivered.
 * A plain `accept()` would pin this object in memory for the whole race. Supabase Realtime's
 * 200-connection cap is what this replaces, and paying for 200 idle connections instead would
 * have missed the point.
 *
 * ⚠️ **`setWebSocketAutoResponse` is what keeps that true under a keep-alive ping.** A browser
 * sending a heartbeat every thirty seconds would otherwise wake the object 240 times a race,
 * each wake costing a billed request and a cold start. The auto-response pair is answered by
 * the runtime without the object being woken at all — so the ping that proves the socket is
 * alive does not defeat the hibernation it exists to survive.
 *
 * ## No storage, and therefore nothing to migrate or wipe
 *
 * There is no `ctx.storage` write anywhere in this file. The room's whole state is "who is
 * connected", which the runtime keeps for us, plus a counter that is allowed to restart at zero
 * whenever the object is evicted — a screen that sees a lower sequence number than it had
 * simply re-reads, which is what it does for every other message too.
 *
 * ⚠️ **This is what keeps [#254](https://github.com/southville-running-club/src-website/issues/254)'s
 * danger zone honest.** `timing.reset_event()` wipes a rehearsal's crossings out of Postgres; if
 * this object held a copy of a leaderboard, wiping the race would leave a stale one being
 * broadcast from a place the reset function cannot reach. It holds none, so there is nothing to
 * wipe — and the nudge that follows a reset makes every screen re-read an empty field.
 *
 * ⚠️ **It is still declared as a SQLite-backed class in `wrangler.jsonc`** (`new_sqlite_classes`),
 * because that is the only storage backend the Workers free plan offers a *new* Durable Object
 * class — the club is on the free plan, and the key-value backend would be refused at deploy.
 * Declaring the backend is not the same as using it.
 */
export class LeaderboardRoom extends DurableObject<CloudflareEnv> {
  /**
   * How many nudges this room has sent since it was last created.
   *
   * ⚠️ **Deliberately not persisted, and it may go backwards.** A screen uses it only to notice
   * that it has missed something and to avoid re-reading twice for one message; it is never a
   * version of the data. Persisting it would be a storage write on the hottest path in the
   * application — a crossing at the finish line — to make a number pretty.
   */
  private sent = 0;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);

    // Answered by the runtime without waking this object. See the header — a heartbeat that
    // woke the room would defeat the hibernation it exists to survive.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * Two verbs on one address, decided by the `Upgrade` header rather than by a path.
   *
   * The Worker that forwards here has already decided who is asking and about which race —
   * `worker-entry.js` carries that, and it is the only caller. **This object authorises
   * nothing**, which is stated out loud because a Durable Object is reachable from its own
   * Worker and from nowhere else, and a second permission check here would be a third statement
   * of a rule the door and the database already hold.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Hibernatable. See the header: `server.accept()` would pin this object in memory for
      // the length of the race.
      this.ctx.acceptWebSocket(server);

      // A screen that connects mid-race must not sit blank until the next crossing, and it has
      // no other way to know the socket is live. `hello` is the nudge it answers exactly as it
      // answers a change — one code path on the client rather than two.
      server.send(JSON.stringify({ type: 'hello', seq: this.sent, at: Date.now() }));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method !== 'POST') {
      // Never rendered to anybody: the only caller is the Worker in front of this object, and a
      // request that is neither an upgrade nor a nudge is a bug in that file rather than
      // somebody's mistake.
      return new Response('expected a websocket upgrade or a POST', { status: 400 });
    }

    return Response.json({ delivered: this.broadcast() });
  }

  /**
   * Tell every screen in this room to re-read, and answer how many were told.
   *
   * The count goes back to the caller so the nudge is observable — a write path that silently
   * reached nobody is indistinguishable from one that reached fifty, and the difference is what
   * a volunteer wants to know when the board on the laptop has stopped moving.
   */
  private broadcast(): number {
    this.sent += 1;
    const message = JSON.stringify({ type: 'changed', seq: this.sent, at: Date.now() });

    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // A socket the runtime has not yet reaped. Closing it is the tidy answer and throwing
        // is not: one dead screen must never stop the other forty being told a runner finished.
        try {
          socket.close(1011, 'send failed');
        } catch {
          // Already gone. Nothing to do, and nothing worth logging — a closed socket is the
          // normal end of every connection this object ever holds.
        }
      }
    }

    return delivered;
  }

  /**
   * The client speaks only to say it is still there, and `ping` never reaches this method —
   * `setWebSocketAutoResponse` answers it without waking the object.
   *
   * ⚠️ **Anything else is ignored rather than acted on.** The socket is a one-way channel by
   * design: a screen that could ask this object for data would be a second read of the race
   * with its own authorisation to get right. Declared so that an inbound message does not
   * become an unhandled rejection in the runtime.
   */
  override webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer): void {
    // Deliberately nothing.
  }

  /**
   * Closing the other half is what lets the runtime stop counting this connection.
   *
   * Without it a screen that navigated away can sit in `getWebSockets()` until the runtime
   * notices, and every nudge tries to write to it.
   */
  override webSocketClose(
    socket: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // 1005 and 1006 are "no status" and "abnormal" — the runtime refuses to echo either back,
    // so a screen closed by a lost signal has to be closed with a code of our own.
    socket.close(code >= 1000 && code !== 1005 && code !== 1006 ? code : 1000, 'closing');
  }

  /**
   * A socket that failed rather than closed — a phone that lost signal at the finish line,
   * which is the normal case here rather than the exceptional one.
   *
   * Not logged. `console.error` on this path would write one line per marshal per signal drop
   * into the Worker's log, and the log is somewhere a volunteer's data must not end up — the
   * discipline `apps/main/worker/admin.ts` keeps. There is nothing a human would do with it.
   */
  override webSocketError(socket: WebSocket, _error: unknown): void {
    try {
      socket.close(1011, 'socket error');
    } catch {
      // Already gone.
    }
  }
}
