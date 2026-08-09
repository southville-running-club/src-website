import { createAnonClient, fetchHealth, fetchPing } from '@src/shared';
import { isTimingPath } from './routing';

/**
 * The club's main Worker — the website, and Nightingale Nightmare under `/nn`.
 *
 * Two jobs:
 *
 *   1. **Stand in for Cloudflare's router locally.** In production `/timing/*` is
 *      dispatched to the timing Worker at the edge and never arrives here. On a laptop
 *      there is no edge, so when `TIMING_ORIGIN` is set this Worker forwards those
 *      requests itself — which is what lets one port serve the whole site locally.
 *   2. **Fill in the health timestamp and the pipeline-check marker**, server-side, by
 *      rewriting the served HTML.
 *
 * The second is the skeleton's reason for existing. Doing it in the Worker rather than in
 * the browser proves the **Worker itself** can reach Supabase, in the real runtime, over
 * the real network — and it means the page works with JavaScript disabled, which is a
 * requirement here rather than a nicety. `intake.ping()` exists alongside
 * `intake.health()` to prove the same thing a second time, for a migration added *after*
 * the first deploy rather than only the original one.
 *
 * `run_worker_first` is set in wrangler.jsonc, so this handler sees every request that is
 * not routed away. That costs one Worker invocation per request against a 100,000/day
 * free allowance.
 */

interface Env {
  ASSETS: Fetcher;
  /** Safe to expose. */
  PUBLIC_SUPABASE_URL: string;
  /** Safe to expose — row-level security is what enforces access. */
  PUBLIC_SUPABASE_ANON_KEY: string;
  /**
   * Where the timing Worker is, **for local development only**.
   *
   * Absent in production, where Cloudflare's own route dispatches `/timing/*` before this
   * Worker runs. If this is ever set in `env.production`, something has gone wrong: it
   * would mean the platform proxying itself through an extra hop.
   */
  TIMING_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (env.TIMING_ORIGIN && isTimingPath(url.pathname)) {
      const target = new URL(url.pathname + url.search, env.TIMING_ORIGIN);
      return fetch(new Request(target, request));
    }

    const response = await env.ASSETS.fetch(request);

    // Only HTML gets rewritten, and only when it was served successfully. An asset, a
    // redirect or a 404 passes straight through.
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('text/html')) {
      return response;
    }

    return new HTMLRewriter()
      .on('[data-health]', new HealthHandler(env))
      .on('[data-pipeline-check]', new PingHandler(env))
      .transform(response);
  },
} satisfies ExportedHandler<Env>;

/**
 * Replaces the contents of `<... data-health>` with the result of `intake.health()`.
 *
 * A failure is rendered rather than thrown. This page's entire job is to report whether
 * the connection works, so "it did not" is the useful answer, not a 500. Nothing in the
 * message can contain personal data — the function reads none.
 */
class HealthHandler {
  constructor(private readonly env: Env) {}

  async element(element: Element): Promise<void> {
    try {
      const client = createAnonClient({
        url: this.env.PUBLIC_SUPABASE_URL,
        anonKey: this.env.PUBLIC_SUPABASE_ANON_KEY,
      });
      const health = await fetchHealth(client);

      if (health.ok) {
        element.setAttribute('data-health', 'ok');
        // UTC in the attribute, Europe/London in the text.
        element.setAttribute('datetime', health.at.toISOString());
        element.setInnerContent(health.formatted);
      } else {
        element.setAttribute('data-health', 'error');
        element.setInnerContent(`Could not reach the database — ${health.error}`);
      }
    } catch (cause) {
      element.setAttribute('data-health', 'error');
      element.setInnerContent(
        `Could not reach the database — ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}

/**
 * Replaces the contents of `<... data-pipeline-check>` with the result of `intake.ping()`.
 *
 * `intake.ping()` exists to prove that a *new* migration — added after the skeleton's
 * first deploy — reaches this Worker through the same path `intake.health()` proved once
 * already. Same rendering shape as `HealthHandler`, deliberately: a failure here is read
 * the same way a reader has already learned to read a health failure.
 */
class PingHandler {
  constructor(private readonly env: Env) {}

  async element(element: Element): Promise<void> {
    try {
      const client = createAnonClient({
        url: this.env.PUBLIC_SUPABASE_URL,
        anonKey: this.env.PUBLIC_SUPABASE_ANON_KEY,
      });
      const ping = await fetchPing(client);

      if (ping.ok) {
        element.setAttribute('data-pipeline-check', 'ok');
        element.setInnerContent(ping.value);
      } else {
        element.setAttribute('data-pipeline-check', 'error');
        element.setInnerContent(`Could not reach the database — ${ping.error}`);
      }
    } catch (cause) {
      element.setAttribute('data-pipeline-check', 'error');
      element.setInnerContent(
        `Could not reach the database — ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}
