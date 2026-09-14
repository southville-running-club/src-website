/**
 * The Worker's environment, as this application expects it.
 *
 * Written by hand rather than generated. It is two variables and one binding, and the two
 * variables are not going to grow: **if a third one appears here — and especially if it is a
 * service role key — the row-level security policy is wrong, and that is the thing to fix.**
 *
 * Both variables are safe to expose. Row-level security is what enforces access, not the key.
 */

/**
 * The Durable Object namespace behind the live leaderboard — one room per race.
 *
 * ## ⚠️ Why this is a hand-written shape rather than `DurableObjectNamespace`
 *
 * This file is read by **two TypeScript programs with incompatible globals**, and that is the
 * whole reason. `apps/timing/tsconfig.json` is the Next program: DOM types, no Workers runtime.
 * `apps/timing/worker/tsconfig.json` is the Workers program, `@cloudflare/workers-types` and no
 * DOM — `apps/main/worker/tsconfig.json`'s pattern exactly, and for the same reason it gives:
 * *"keeping it in its own project is what stops a Node API — which would not exist in
 * production — from typechecking here by accident"*.
 *
 * `DurableObjectNamespace` exists only in the second of those. Naming it here would break the
 * first, and adding `@cloudflare/workers-types` to the Next program is the fix that does not
 * work: it redeclares `Request`, `Response` and `WebSocket` on top of the DOM lib Next needs.
 *
 * So this declares **the one method this application actually uses**, and the real namespace
 * satisfies it structurally. A route handler in the Next program can nudge a room; the Workers
 * program passes the genuine binding in. Neither has to import the other's globals, and the day
 * something here needs more of the namespace than `getByName`, this is the one place that says
 * so out loud.
 */
declare global {
  interface LeaderboardRoomNamespace {
    /**
     * The room for one race, addressed by its event slug.
     *
     * `getByName` rather than `idFromName` + `get`, because the id type is the part that cannot
     * be described without the Workers globals — see above. One method, one round trip, and the
     * name is the slug so two screens on the same race provably land in the same room.
     */
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  }

  interface CloudflareEnv {
    PUBLIC_SUPABASE_URL: string;
    PUBLIC_SUPABASE_ANON_KEY: string;

    /**
     * ⚠️ **Optional, and every caller has to cope with its absence.** A binding declared in
     * `wrangler.jsonc` is present in the deployed Worker and under `wrangler dev`, and is
     * **not** present under `next dev` when `initOpenNextCloudflareForDev()` has not finished,
     * nor in a unit test that stubs the environment. The leaderboard degrades to a page that
     * does not refresh itself, which is the same thing it does with JavaScript switched off —
     * so a missing binding must never be an error a volunteer sees.
     */
    LEADERBOARD?: LeaderboardRoomNamespace;
  }
}

export {};
