import { createAnonClient, fetchHealth, fetchPing } from '@src/shared';
import { isNnSignupPath, isTimingPath, NN_PREFIX } from './routing';
import {
  isNnSignupSuccess,
  processNnSignup,
  renderNnSignupAcknowledgement,
  renderNnSignupErrors,
  renderNnSignupUnavailable,
  NN_SIGNUP_SUCCESS_PATH,
  type NnSignupOutcome,
} from './nn-signup';

/**
 * The club's main Worker — the website, and Nightingale Nightmare under `/nn`.
 *
 * Three jobs:
 *
 *   1. **Stand in for Cloudflare's router locally.** In production `/timing/*` is
 *      dispatched to the timing Worker at the edge and never arrives here. On a laptop
 *      there is no edge, so when `TIMING_ORIGIN` is set this Worker forwards those
 *      requests itself — which is what lets one port serve the whole site locally.
 *   2. **Take the Nightingale Nightmare sign-up.** A POST to `/nn/` is handled here,
 *      **before `env.ASSETS.fetch`** — the static-assets binding will not serve a POST, so
 *      anything reaching it is already lost. See `nn-signup.ts`.
 *   3. **Fill in the health timestamp and the pipeline-check marker**, server-side, by
 *      rewriting the served HTML.
 *
 * The third is the skeleton's reason for existing. Doing it in the Worker rather than in
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

    // **Before the assets binding, deliberately.** `run_worker_first` means this handler
    // sees the request first, and it has to: the binding serves `dist/`, which is static
    // HTML, and it will not answer a POST at all.
    if (request.method === 'POST' && isNnSignupPath(url.pathname)) {
      return handleNnSignup(request, env, url);
    }

    const response = await env.ASSETS.fetch(request);

    // Only HTML gets rewritten, and only when it was served successfully. An asset, a
    // redirect or a 404 passes straight through.
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('text/html')) {
      return response;
    }

    const rewriter = statusRewriter(env);

    // The other half of POST/Redirect/GET: the 303 lands back here as an ordinary GET, and
    // `?signup=ok` is what tells this pass to reveal the acknowledgement.
    if (isNnSignupPath(url.pathname) && isNnSignupSuccess(url)) {
      renderNnSignupAcknowledgement(rewriter);
    }

    return rewriter.transform(response);
  },
} satisfies ExportedHandler<Env>;

/**
 * Every HTML response gets the health and pipeline-check handlers, including the ones that
 * are reporting a failed sign-up.
 *
 * That is not incidental tidiness. Those two markers report whether this Worker can reach
 * Postgres at all, and **a submission that just failed is exactly when somebody wants to
 * know that** — a 503 from the form beside a broken health timestamp is a different problem
 * from a 503 beside a working one, and the page should be able to tell them apart.
 */
function statusRewriter(env: Env): HTMLRewriter {
  return new HTMLRewriter()
    .on('[data-health]', new HealthHandler(env))
    .on('[data-pipeline-check]', new PingHandler(env));
}

/**
 * The sign-up POST: validate, record, and answer with something a person can act on.
 *
 * A rejected or unrecorded submission is answered by **re-serving the page the form is on**
 * and painting the outcome onto it, rather than by redirecting somewhere. That is what
 * keeps the person's input in the boxes — a redirect would either lose it or put their name
 * and email address in a URL, and a query string is the one place personal data is
 * guaranteed to end up in a log.
 */
async function handleNnSignup(request: Request, env: Env, url: URL): Promise<Response> {
  const outcome: NnSignupOutcome = await processNnSignup(request, env);

  if (outcome.status === 'accepted') {
    // POST/Redirect/GET. Without it, a refresh re-posts and the person is left wondering
    // whether they have signed up twice — which they have not, because of the unique
    // index, but the form should not make them guess.
    return Response.redirect(new URL(NN_SIGNUP_SUCCESS_PATH, url).toString(), 303);
  }

  // A GET the assets binding will actually answer, for the canonical address of the page.
  const page = await env.ASSETS.fetch(
    new Request(new URL(`${NN_PREFIX}/`, url).toString(), { method: 'GET' }),
  );

  if (!page.ok) {
    return page;
  }

  const rewriter = statusRewriter(env);

  const status =
    outcome.status === 'invalid'
      ? // Unprocessable content: the request was understood and refused on its contents.
        422
      : // Service unavailable, and honest. The submission was good and the club could not
        // store it, which is a different thing from the submission being wrong.
        503;

  if (outcome.status === 'invalid') {
    renderNnSignupErrors(rewriter, outcome);
  } else {
    renderNnSignupUnavailable(rewriter, outcome);
  }

  const rendered = rewriter.transform(page);
  const headers = new Headers(rendered.headers);

  // **This page now contains what somebody typed.** It must not be held by a shared cache
  // between here and them, and a 422 or a 503 is not a useful thing to serve to the next
  // person regardless.
  headers.set('cache-control', 'no-store');

  return new Response(rendered.body, { status, headers });
}

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
