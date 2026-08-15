import type { AnonClient } from './supabase';
import { fetchHealth } from './health';
import { fetchPing } from './ping';

/**
 * The two database round trips, as a machine-readable report rather than as page furniture.
 *
 * ## Why this is not on a page any more
 *
 * `intake.health()` and `intake.ping()` used to be rendered into a "What this page proves"
 * block on `/nn/` and on `/timing`. They proved something worth proving — the migration
 * applied, `intake` is exposed through PostgREST, the anon key and the grant are right, and
 * the Worker can reach the network in the real runtime — and they proved it in the one place
 * that must never look like a build in progress: **the page somebody pays on.**
 *
 * The check was never the problem; its audience was. Both applications now answer it at
 * `/health` and `/timing/health`, where the smoke test reads it and a runner never does.
 *
 * ## One function, so two apps cannot drift
 *
 * `apps/main` is a Worker and `apps/timing` is Next under `@opennextjs/cloudflare`. They have
 * no code in common except this package, so a report assembled twice would be two shapes
 * within a release — and `scripts/smoke.mjs` parses both with one function. This is the same
 * argument that gives the club one `Europe/London` module instead of two.
 *
 * ## What is deliberately in it, and what is not
 *
 * `at` is UTC and `formatted` is `Europe/London` — the storage-and-display rule, kept in the
 * payload because a smoke test that reads the wrong hour on the clocks-change weekend should
 * be able to say so. Nightingale Nightmare is raced the weekend after the clocks go back.
 *
 * **No personal data can appear here.** Neither function reads a row; `health()` returns
 * `now()` and `ping()` returns a constant. That is what makes it safe to serve this without
 * a credential, and it is a property to preserve rather than a coincidence — see the note on
 * exposure in `apps/main/README.md`.
 *
 * @see docs/architecture/decisions/adr-002-schema-layout.md
 */

export interface HealthReport {
  /** True only when **both** round trips succeeded. The one field a check need read. */
  ok: boolean;
  database: { ok: true; at: string; formatted: string } | { ok: false; error: string };
  pipeline: { ok: true; value: string } | { ok: false; error: string };
}

export async function buildHealthReport(client: AnonClient): Promise<HealthReport> {
  // Sequential rather than concurrent, and it is not an oversight: two round trips against
  // one free-tier project, on a path anybody can request. Nothing here is latency-sensitive.
  const health = await fetchHealth(client);
  const ping = await fetchPing(client);

  return {
    ok: health.ok && ping.ok,
    database: health.ok
      ? { ok: true, at: health.at.toISOString(), formatted: health.formatted }
      : { ok: false, error: health.error },
    pipeline: ping.ok
      ? { ok: true, value: ping.value }
      : { ok: false, error: ping.error },
  };
}

/**
 * The report as an HTTP response, identical in both applications.
 *
 * **503 rather than 200 when either half failed.** A monitor that only reads status codes
 * has to get the same answer as one that parses the body — a health endpoint that answers
 * 200 while saying `"ok": false` is the shape that lets an outage sit unnoticed behind a
 * green tick.
 *
 * `no-store` because a cached answer to "can you reach the database" is not an answer, and
 * `noindex` because this is an endpoint rather than a page and has no business in a search
 * result.
 */
export function healthResponse(report: HealthReport): Response {
  return new Response(`${JSON.stringify(report, null, 2)}\n`, {
    status: report.ok ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

/**
 * The report for a client that could not be built at all — a missing or malformed Supabase
 * URL, which throws before any request is made.
 *
 * Rendered rather than thrown, for the reason the two fetchers already are: this endpoint's
 * whole job is to say whether the connection works, so "it does not, and here is why" is the
 * useful answer and a 500 with a stack trace is not.
 */
export function healthReportFromFailure(cause: unknown): HealthReport {
  const error = cause instanceof Error ? cause.message : String(cause);
  return {
    ok: false,
    database: { ok: false, error },
    pipeline: { ok: false, error },
  };
}
