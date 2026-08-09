import { createAnonClient, fetchHealth } from '@src/shared';
import { resolveRoute } from './routing';

/**
 * The club's main Worker.
 *
 * Two jobs, and for now that is all:
 *
 *   1. **Route by hostname.** `nn.<apex>` serves `/nn/` from the build; every other
 *      hostname passes through. See `routing.ts` for why.
 *   2. **Fill in the health timestamp**, server-side, by rewriting the served HTML.
 *
 * The second is the skeleton's whole reason for existing. Doing it in the Worker rather
 * than in the browser proves something a client-side `fetch` would not: that the **Worker
 * itself** can reach Supabase, in the real runtime, over the real network. It also means
 * the page works with JavaScript disabled, which is a requirement here rather than a
 * nicety — runners and marshals are on phones, on poor signal, sometimes in bright
 * sunlight with cold hands.
 *
 * `run_worker_first` is set in wrangler.jsonc, so this handler sees every request. That
 * costs one Worker invocation per request against a 100,000/day free allowance, which for
 * a running club is not a constraint.
 */

interface Env {
  ASSETS: Fetcher;
  /** Safe to expose. */
  PUBLIC_SUPABASE_URL: string;
  /** Safe to expose — row-level security is what enforces access. */
  PUBLIC_SUPABASE_ANON_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = resolveRoute(url.hostname, url.pathname);

    // One public URL per page. `/nn/` is a build location, not an address to publish.
    if (route.redirectTo) {
      const target = new URL(url);
      target.pathname = route.redirectTo;
      return Response.redirect(target.toString(), 301);
    }

    const assetUrl = new URL(url);
    assetUrl.pathname = route.path;
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));

    // Only HTML gets rewritten, and only when it was served successfully. An asset, a
    // redirect or a 404 passes straight through.
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('text/html')) {
      return response;
    }

    return new HTMLRewriter()
      .on('[data-health]', new HealthHandler(env))
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
