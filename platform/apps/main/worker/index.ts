import {
  buildHealthReport,
  createAnonClient,
  expirePendingHolds,
  healthReportFromFailure,
  healthResponse,
} from '@src/shared';
import {
  adminPathForNnAdminPath,
  isAccountPath,
  isAdminPath,
  isHealthPath,
  isNnAdminPath,
  isNnEntryCompletePath,
  isNnMastheadPath,
  isNnRacePath,
  isNnWebhookPath,
  isNnYearPath,
  isTimingPath,
  nnEventSlugForYearPath,
  nnYearPathForEventSlug,
  NN_PREFIX,
} from './routing';
import { handleAdmin } from './admin';
import { handleAccount } from './account';
import { sweepExpiredMedicalNotes } from './medical-retention';
import { handleStripeWebhook } from './stripe-webhook';
import { renderNnEntryComplete, resolveNnEntryCompleteView } from './nn-entry-complete';
import {
  isNnSignupSuccess,
  processNnSignup,
  renderNnSignupAcknowledgement,
  renderNnSignupErrors,
  renderNnSignupUnavailable,
  nnSignupSuccessPath,
  type NnSignupOutcome,
} from './nn-signup';
import {
  nnFormKind,
  processNnEntry,
  renderNnEntryClosed,
  renderNnEntryErrors,
  renderNnEntryStopped,
  renderNnEntryView,
  renderNnNav,
  renderNnRaceView,
  resolveNnEntryView,
  resolveNnRaceView,
  type NnEntryOutcome,
  type NnEntryViewer,
} from './nn-entry';
import { readSession } from './session';

/**
 * The club's main Worker — the website, and Nightingale Nightmare under `/nn`.
 *
 * Six jobs. **The numbering was wrong here** — two fours and two fives, from a merge that
 * added the webhook and the return page in the same paragraph — and this slice needed to add a
 * seventh line to a list that could not be counted, so it is corrected rather than extended:
 *
 *   1. **Stand in for Cloudflare's router locally.** In production `/timing/*` is
 *      dispatched to the timing Worker at the edge and never arrives here. On a laptop
 *      there is no edge, so when `TIMING_ORIGIN` is set this Worker forwards those
 *      requests itself — which is what lets one port serve the whole site locally.
 *   2. **Take the Nightingale Nightmare sign-up, and the entry.** Two forms at two addresses
 *      now: a POST to `/nn/` is the interest form, which is about **the race**, and a POST to
 *      `/nn/<year>/` is the entry form, which is about **one running of it**. Both are handled
 *      here, **before `env.ASSETS.fetch`** — the static-assets binding will not serve a POST,
 *      so anything reaching it is already lost. See `nn-signup.ts` and `nn-entry.ts`.
 *   3. **Take Stripe's confirmation.** A POST to `/nn/stripe-webhook`, also before the assets
 *      binding, and **the only thing in this platform that records a payment**. It is not a
 *      page: no HTML, no rewriting, no redirect. See `stripe-webhook.ts`.
 *   4. **Serve `/admin/`, the club's back office.** The entries, the interest list, one
 *      medical note at a time, three exports and the roles page — the only pages on this site
 *      the Worker *builds* rather than paints, because a list of entries is a variable number
 *      of rows and there is deliberately no html-mode rewriting anywhere here. Answered to
 *      everybody, and every address under it answers 404 to a caller who is not signed in and
 *      holding a staff role — see `admin.ts` and ADR-013's amendment. `/nn/admin/*` is
 *      redirects only, to where #58 moved this.
 *   5. **Paint what only the database knows onto the pages that ship without it**, by
 *      rewriting the served HTML — which running is on, onto `/nn/`; which form applies, onto
 *      `/nn/<year>/`; and the recorded payment state, onto `/nn/<year>/entry/complete/`.
 *   6. **Answer `GET /_health`** with the two database round trips, as JSON.
 *   7. **Sweep lapsed holds, shout about anything needing a human, and delete the medical
 *      notes the club has promised to delete**, on a Cron Trigger every five minutes. See
 *      `scheduled()` at the foot of this file.
 *
 * The sixth is the skeleton's original reason for existing, moved. Doing those round trips
 * in the Worker rather than in the browser proves the **Worker itself** can reach Supabase,
 * in the real runtime, over the real network, and `intake.ping()` proves it a second time
 * for a migration added *after* the first deploy. What changed is only who reads the answer:
 * it was rendered into a "What this page proves" block on `/nn/` and on `/timing`, which put
 * a build-in-progress diagnostic on the page somebody pays on. **The check was never the
 * problem; its audience was.** See `packages/shared/src/health-report.ts`.
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
  /**
   * **A Worker secret, set by hand with `wrangler secret put`.** Never in `wrangler.jsonc`,
   * never in a `vars` block, never in this repository — and optional here because its
   * absence is a real, safe state: with no key the entry form validates and stops, exactly
   * as it did before payment was connected. `apps/main/README.md` records the manual step.
   */
  STRIPE_SECRET_KEY?: string;
  /**
   * Where the Stripe API is. Unset everywhere that matters; `npm run preview` points it at
   * `scripts/stripe-stub.mjs` so the local site and the acceptance suite run end to end
   * without a Stripe account. Passed on the `wrangler dev` command line, so no deployed
   * Worker can inherit it.
   */
  STRIPE_API_BASE?: string;
  /**
   * **A Worker secret**, and the thing that proves a webhook came from Stripe. Never in
   * `wrangler.jsonc`, never in a `vars` block, never in this repository.
   *
   * Optional, and its absence is a real state: the Stripe endpoint is created *after* this
   * Worker is deployed, because creating it first would post into a 404. Every delivery in
   * that window is answered **503 and retried**, never 400 — see `stripe-webhook.ts`.
   */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * **A second Worker secret**, and the least obvious thing in this file.
   *
   * `entries.record_checkout_event()` is granted to the anon role like every other function in
   * that schema — and the anon key is published in page source, while
   * `entries.create_pending_purchase()` hands any caller a real purchase id and its amount. So
   * without a second factor, two ordinary PostgREST calls would buy a free race entry. The
   * database holds only this key's SHA-256 digest. The full argument is in the migration.
   */
  ENTRIES_WEBHOOK_KEY?: string;
  /**
   * Public. The Cloudflare Turnstile widget key `worker/account.ts`'s forms render — a
   * `var`, like the Supabase anon key, never a secret. Its pair, the Turnstile *secret*
   * key, never appears in this repository: GoTrue holds it, via
   * `SUPABASE_AUTH_CAPTCHA_SECRET`, and verifies the token itself.
   */
  TURNSTILE_SITE_KEY: string;

  /**
   * `'on'` once the Google OAuth client exists and `[auth.external.google]` has reached
   * production — #56, and `docs/delivery/runbooks/google-oauth.md` turns it on.
   *
   * A `var`, and it holds no credential: the secret half is GoTrue's
   * `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. This only decides whether the button is offered,
   * because the provider and the button ship by two different routes at two different times.
   * Optional, and absent means off — a new environment is safe rather than broken.
   */
  GOOGLE_SIGN_IN?: string;
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
    //
    // The webhook is matched **before** the form path, and the two cannot collide —
    // `isNnYearPath` is four digits beneath `/nn/`, and this is `/nn/stripe-webhook`. The
    // order is stated rather than relied on: a future predicate that widened one of them
    // would otherwise turn payment confirmations into form submissions, silently.
    if (request.method === 'POST' && isNnWebhookPath(url.pathname)) {
      return handleStripeWebhook(request, env);
    }

    // **Where the admin surface used to be, and now nothing but a redirect.** #58 moved it to
    // `/admin/nn/`; these addresses are in a published runbook and a runbook that 404s is worse
    // than one that is out of date, so every one of them keeps resolving.
    //
    // **301 for a GET and 308 for anything else**, because a 301 permits a client to turn a
    // POST into a GET and three of these are POSTs carrying a body — an entrant id, an export
    // kind. A 308 preserves both. Matched before the assets binding for the same reason as
    // everything else here: some of these are POSTs, which the binding will not answer.
    if (isNnAdminPath(url.pathname)) {
      const moved = new URL(url);
      moved.pathname = adminPathForNnAdminPath(url.pathname);

      return new Response(null, {
        status: request.method === 'GET' || request.method === 'HEAD' ? 301 : 308,
        headers: {
          location: `${moved.pathname}${moved.search}`,
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex, nofollow',
        },
      });
    }

    // **The staff backend.** Always answered here — every address under it, including ones
    // nobody built, so a signed-out stranger cannot tell a page that exists from one that does
    // not. `admin.ts` decides who may see what; this only decides who answers.
    //
    // Before the assets binding, like everything else in this block: several of these are
    // POSTs, and every page is built in the Worker rather than served from `dist/`.
    if (isAdminPath(url.pathname)) {
      return handleAdmin(request, env, url);
    }

    // **The account area — always on, unlike `/nn/admin`.** There is no key that switches
    // this off: an account system with nowhere to register is not a deployable state the
    // way an admin surface with no key installed is. Matched before the assets binding for
    // the same reason as everything else here — some of these are POSTs, and the pages are
    // built in the Worker rather than served from `dist/`. See `account.ts`.
    if (isAccountPath(url.pathname)) {
      return handleAccount(request, env, url);
    }

    // **Both forms post to the running they belong to**, and the hidden `form` field is what
    // tells them apart. The interest form moved here with the entry form: interest in what —
    // the race in general, or this year's running? It is this year's.
    //
    // The body is read once, here, and handed on. Reading a request twice to avoid threading a
    // `FormData` through would be the worse trade.
    if (request.method === 'POST' && isNnYearPath(url.pathname)) {
      const form = await readForm(request);

      if (nnFormKind(form) !== 'entry') {
        // The interest form takes no money and asks the database nothing about who is
        // asking, so it is left exactly as it was — no session read, no cookies to carry.
        return handleNnSignup(form, env, url);
      }

      // **The same viewer the GET used**, so a form revealed to a tester is a form they can
      // actually submit. `create_pending_purchase()` re-checks the window itself and would
      // answer `closed` to an anonymous client whatever the page had shown.
      const { viewer, setCookies } = await nnViewerFor(request, env, url);

      return withSessionCookies(await handleNnEntry(form, env, url, viewer), setCookies);
    }

    // Also before the assets binding, for the plainer reason that there is nothing at this
    // address in `dist/` — it is an endpoint rather than a page. A non-GET falls through and
    // 404s, which is the right answer to anything but a monitor.
    if (request.method === 'GET' && isHealthPath(url.pathname)) {
      return handleHealth(env);
    }

    const response = await env.ASSETS.fetch(request);

    // Only HTML gets rewritten, and only when it was served successfully. An asset, a
    // redirect or a 404 passes straight through.
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('text/html')) {
      return response;
    }

    const rewriter = new HTMLRewriter();

    // -------------------------------------------------------------------------------------
    // The navigation, on every Nightingale Nightmare page that carries it
    // -------------------------------------------------------------------------------------
    // **The bar is the same bar everywhere, so it is painted everywhere.** Two of its five
    // controls point at the current running, and the pages that carry them include
    // `/nn/course/` and `/nn/privacy/`, which this Worker previously did nothing to at all.
    //
    // **That is one database round trip per content-page view, and it was a real trade.** The
    // alternative is a year written into a component — the thing the route split exists to
    // remove — or a navigation that differs by page, which is the thing this slice exists to
    // remove. The read is `entries.current_entry_state()`, which touches two small tables and
    // no personal data, and it is **resolved once and shared** with whatever else the page
    // needs it for.
    //
    // Every failure paints nothing: the bar keeps its two evergreen links and drops the rest.
    // Fewer doors, and never a door into a year nobody confirmed.
    const race = isNnMastheadPath(url.pathname) ? await resolveNnRaceView(env) : null;

    if (race !== null) {
      renderNnNav(rewriter, race);
    }

    if (isNnRacePath(url.pathname)) {
      // **Which running is on, and where it is, decided per request.** The race page holds no
      // year, so every link it makes to one — and every value in its panel — is painted here.
      renderNnRaceView(rewriter, race ?? { running: null });
    }

    const yearSlug = nnEventSlugForYearPath(url.pathname);

    // Carried out of the year-page branch so the final response can pick them up. Empty on
    // every request that did not refresh a session, which is nearly all of them.
    let refreshedCookies: string[] = [];

    if (yearSlug !== null) {
      // **Which of the year page's two forms somebody gets, decided per request.** The event
      // row says whether entries are open; nothing here is baked into the build. Every failure
      // resolves to the interest form, so a database this Worker cannot reach produces the
      // page that takes no money rather than an offer to take an entry it cannot record.
      // **Who is asking decides which form this is**, now that a permission can open it
      // early. Everything else about this branch is unchanged, including that every failure
      // — an unreadable session included — resolves to the page that takes no money.
      const { viewer, setCookies } = await nnViewerFor(request, env, url);
      refreshedCookies = setCookies;

      renderNnEntryView(rewriter, await resolveNnEntryView(env, yearSlug, viewer));

      // The other half of POST/Redirect/GET: the 303 lands back here as an ordinary GET, and
      // `?signup=ok` is what tells this pass to reveal the acknowledgement.
      if (isNnSignupSuccess(url)) {
        renderNnSignupAcknowledgement(rewriter);
      }
    }

    if (isNnEntryCompletePath(url.pathname)) {
      // **What the club has recorded, and never what the redirect implies.** The `confirming`
      // block ships visible, so an unreachable database paints nothing and the page says what
      // it said before this slice — which claims neither that a payment succeeded nor that it
      // failed. See `nn-entry-complete.ts`.
      renderNnEntryComplete(rewriter, await resolveNnEntryCompleteView(env, url));
    }

    return withSessionCookies(rewriter.transform(response), refreshedCookies);
  },

  /**
   * Every five minutes: move lapsed holds to `expired`, **shout about anything a person has to
   * deal with**, and **delete the medical notes the club has published a promise to delete**.
   *
   * ## Three jobs on one schedule, and none of them may stop another
   *
   * They share a Cron Trigger because a second schedule is a second thing to configure, to get
   * wrong, and to not notice has stopped. They share nothing else, and the code below is
   * written so that a failure in one still leaves the others having run — the retention sweep
   * in particular, because it is the one with a legal obligation behind it.
   *
   * ## The sweep is housekeeping, and the difference matters
   *
   * A place comes back into the pool the moment its hold lapses, because the capacity count
   * inside `entries.create_pending_purchase()` only counts a `pending` purchase while
   * `hold_expires_at` is still in the future. **If this cron never runs again, nobody is
   * turned away and nothing is double-sold.** What it does is stop a purchase somebody
   * abandoned at the payment page from reading as `pending` forever.
   *
   * That property is the one to preserve if this is ever changed. A future version that
   * capacity *depends* on would put a 250-place race at the mercy of a scheduler.
   *
   * ## The alarm is not housekeeping, and it is why this runs even when nothing expires
   *
   * **This is the only repeating channel this platform has.** There is no alerting stack, no
   * admin surface and no email until Slice D — so when the webhook meets something it cannot
   * resolve on its own (a payment that arrived after the last place had gone, an amount that
   * disagreed with Stripe, a completed event for something already refunded) it sets
   * `attention` on the row, and this line is what makes somebody find out.
   *
   * **It repeats until a human clears the flag**, and the age climbs in the message so a
   * glance says whether this is new or has been ignored since Tuesday. Repetition is the whole
   * mechanism: one line at 02:14 is an artefact nobody sees. It is silenced by setting
   * `attention_resolved_at`, never by the calendar — an alarm that goes quiet after a week
   * would go quiet exactly when both volunteers were away.
   *
   * ## A count and nothing else is logged
   *
   * These rows carry names, dates of birth and emergency contacts; the only things worth a
   * line are how many places came back and how many need a person. The quiet case logs
   * nothing at all — 288 "expired 0" lines a day is a free-tier observability allowance spent
   * on nothing. `console.warn` rather than the casual one, which the lint rule bans outright.
   */
  // **The third parameter is declared and unused, and it is not decoration.** Two of the
  // Miniflare tests already call this handler the way the runtime does — controller, env,
  // context — and with a two-parameter signature that is a type error nobody saw, because
  // nothing typechecked this file. It is the documented shape of a scheduled handler, and
  // `ctx.waitUntil` is the thing a future job here would need.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });

    const result = await expirePendingHolds(client);

    if (!result.ok) {
      console.error(`entries.expire_pending_holds failed — ${result.error}`);
    } else {
      if (result.expired > 0) {
        console.warn(`entries.expire_pending_holds released ${result.expired} hold(s)`);
      }

      // **`console.error`, and it says what to do.** A log line nobody knows how to act on is
      // a log line that gets scrolled past; the runbook is named in the message because that
      // is the only place the name will be when somebody needs it.
      if (result.attention > 0) {
        console.error(
          `entries: ${result.attention} purchase(s) need a human, oldest ${result.attentionOldestHours}h. ` +
            'Somebody may have paid and have no place. See docs/delivery/runbooks/entries-attention.md',
        );
      }
    }

    // **The published retention promise, kept — and it is not behind the sweep's failure.**
    // `/nn/privacy/` says a medical note is deleted separately from and sooner than the rest of
    // an entry; this is the thing that does it, and it rides on the schedule that already exists
    // rather than on a second one to configure and to notice has stopped.
    //
    // The early `return` this replaces was the reason it had to be restructured: a failed hold
    // sweep would otherwise have taken a **legal retention obligation** down with it, silently
    // and for as long as the first call kept failing. The two jobs share a schedule and share
    // nothing else, so neither may decide whether the other runs. On all but a handful of days
    // a year this deletes nothing and says nothing.
    await sweepExpiredMedicalNotes(env);
  },
} satisfies ExportedHandler<Env>;

/**
 * `GET /_health` — the two database round trips, as JSON, for `scripts/smoke.mjs`.
 *
 * **The audience is a monitor, and that is the whole design.** These same two calls used to
 * be rewritten into a `<dl>` on `/nn/` under the heading "What this page proves", where the
 * people who read them were runners deciding whether to trust the club with £17. A page that
 * reports its own plumbing reads as a page that is not finished.
 *
 * Nothing is lost by moving them: this runs in the same Worker, in the same runtime, against
 * the same project, on every request the smoke test makes. What it no longer does is run on
 * the *rendering* path — so a slow Supabase no longer slows down serving the race page, which
 * is a second, smaller win.
 */
async function handleHealth(env: Env): Promise<Response> {
  try {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });
    return healthResponse(await buildHealthReport(client));
  } catch (cause) {
    // A client that could not be constructed at all — an empty or malformed URL, which
    // throws before any request is made. Reported rather than thrown, like every other
    // failure this endpoint can have.
    return healthResponse(healthReportFromFailure(cause));
  }
}

/**
 * The submitted body, or `null` when there was not one.
 *
 * Not a form at all — a JSON body, or nothing — is treated by both handlers exactly the way
 * an empty submission is treated, which is the honest answer: there is no input to give back.
 *
 * A rejected or unrecorded submission is answered by **re-serving the page the form is on**
 * and painting the outcome onto it, rather than by redirecting somewhere. That is what
 * keeps the person's input in the boxes — a redirect would either lose it or put their name
 * and email address in a URL, and a query string is the one place personal data is
 * guaranteed to end up in a log.
 */
async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** The interest form: validate, record, and answer with something a person can act on. */
async function handleNnSignup(
  form: FormData | null,
  env: Env,
  url: URL,
): Promise<Response> {
  const outcome: NnSignupOutcome = await processNnSignup(form, env);

  if (outcome.status === 'accepted') {
    // POST/Redirect/GET. Without it, a refresh re-posts and the person is left wondering
    // whether they have signed up twice — which they have not, because of the unique
    // index, but the form should not make them guess.
    return Response.redirect(
      new URL(nnSignupSuccessPath(yearPath(url)), url).toString(),
      303,
    );
  }

  const page = await nnPage(env, url, yearPath(url));
  if (!page.ok) {
    return page;
  }

  const rewriter = new HTMLRewriter();

  // **The year links are not repainted here, and that is deliberate.** This response is the
  // race page re-served with a failed submission on it, and painting the links would mean a
  // second database round trip on the path where the database is most likely to be the reason
  // the submission failed. Somebody looking at "that could not be saved" is looking at the
  // notice, not at the navigation.
  //
  // The interest form itself only ever renders in the state where it is the visible one, so
  // no view rewriting is needed for it either: it ships visible.
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

  return typedPage(rewriter.transform(page), status);
}

/**
 * Who is asking, on the two Nightingale Nightmare paths where the database now cares.
 *
 * **This costs the signed-out visitor nothing.** `readSession` returns `null` without a
 * network call when neither session cookie is present, and that is everybody who has not
 * registered — which is the whole population of this page until 1 September and the large
 * majority of it afterwards. A signed-in visitor pays one `auth.getUser()` round trip, which
 * is the same one `/account/` and `/admin/` already make on every request.
 *
 * **The refreshed cookies come back and must be attached.** `readSession` rotates the refresh
 * token the moment the access token is within a minute of expiring, and the old one is spent
 * ten seconds later whether or not this particular request was for a page that needed it.
 * Dropping them here would sign somebody out of the *account* area by visiting a race page —
 * see `withRefreshedCookies`'s note in `admin-shell.ts` for the full shape of that bug.
 */
async function nnViewerFor(
  request: Request,
  env: Env,
  url: URL,
): Promise<{ viewer: NnEntryViewer | null; setCookies: string[] }> {
  const { session, setCookies } = await readSession(
    { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
    request.headers.get('cookie'),
    Math.floor(Date.now() / 1000),
    url.protocol === 'https:',
  );

  return {
    viewer: session === null ? null : { accessToken: session.accessToken },
    setCookies,
  };
}

/**
 * Append `Set-Cookie` headers to a response whose own headers may be immutable.
 *
 * `withRefreshedCookies` in `admin-shell.ts` appends in place, which is correct there because
 * every response under `/admin/` is constructed by that tree. The responses here come from
 * `env.ASSETS.fetch` and from `HTMLRewriter.transform`, and an asset response's headers are
 * not guaranteed to be mutable — so this rebuilds rather than mutates.
 */
function withSessionCookies(response: Response, cookies: string[]): Response {
  if (cookies.length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);

  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The entry form: validate, hold a place, and send somebody to Stripe.
 *
 * **The only success is a 303 to `checkout.stripe.com`**, and it is a success only in the
 * sense that a place is held and a payment page exists. Nothing here has been paid for —
 * `/nn/<year>/entry/complete/` says so in as many words, and the webhook is what changes it.
 *
 * Every other outcome re-serves **the year page this was posted to** with the person's input
 * still in it. Which status each carries is in `nn-entry.ts`; the mapping to HTTP is here
 * because that is the layer that speaks HTTP.
 */
async function handleNnEntry(
  form: FormData | null,
  env: Env,
  url: URL,
  viewer: NnEntryViewer | null = null,
): Promise<Response> {
  const outcome: NnEntryOutcome = await processNnEntry(form, env, url, viewer);

  if (outcome.status === 'redirect') {
    // POST/Redirect/GET, as everywhere else here — and this one leaves the site, so the
    // browser must not keep it. The URL is one person's payment page and nothing in front of
    // it has any business holding a copy.
    return new Response(null, {
      status: 303,
      headers: { location: outcome.url, 'cache-control': 'no-store' },
    });
  }

  const yearSlug = nnEventSlugForYearPath(url.pathname);

  const page = await nnPage(env, url, yearPath(url));
  if (!page.ok) {
    return page;
  }

  const rewriter = new HTMLRewriter();

  if (outcome.status === 'closed') {
    // 409, not 422 or 503: the submission was well-formed and the state of the world moved.
    // Somebody opened the page at 6:59 and pressed the button at 7:01, which is an ordinary
    // sequence rather than a mistake or an outage.
    renderNnEntryClosed(rewriter);
    return typedPage(rewriter.transform(page), 409);
  }

  // Every remaining outcome renders the entry form, so the view has to be painted first —
  // the section ships hidden and this POST did not go through the GET path that reveals it.
  // `processNnEntry` has already established that the window is open, so this second read is
  // answering "with what fees", not "should this be here". `yearSlug` is non-null on every
  // path that reaches here, because `worker/index.ts` only routes a year path to this handler.
  renderNnEntryView(rewriter, await resolveNnEntryView(env, yearSlug ?? '', viewer));

  if (outcome.status === 'invalid') {
    renderNnEntryErrors(rewriter, outcome);
    return typedPage(rewriter.transform(page), 422);
  }

  renderNnEntryStopped(rewriter, outcome);

  // **409 for sold out, and it is the right code rather than a near-enough one.** The
  // request was understood and refused because the state of the world moved between the page
  // being served and the button being pressed — which is what 409 means, and is the same
  // thing "entries closed" above is saying. The other three are outages of one kind or
  // another and 503 says so.
  return typedPage(rewriter.transform(page), outcome.status === 'sold-out' ? 409 : 503);
}

/**
 * **The canonical spelling of the address a form posted to.**
 *
 * A form posting to `/nn/2026` without the trailing slash is accepted, and the page it is
 * re-served from — or redirected to — has to be the one Astro actually built:
 * `trailingSlash: 'always'` means there is only ever the one. Round-tripped through the slug
 * rather than patched onto `url.pathname`, so there is one rule and it is `routing.ts`'s.
 */
function yearPath(url: URL): string {
  const slug = nnEventSlugForYearPath(url.pathname);
  return slug === null ? `${NN_PREFIX}/` : (nnYearPathForEventSlug(slug) ?? url.pathname);
}

/** A GET the assets binding will actually answer, for the canonical address of a page. */
function nnPage(env: Env, url: URL, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(path, url).toString(), { method: 'GET' }));
}

/**
 * **This page now contains what somebody typed.** It must not be held by a shared cache
 * between here and them, and a 422, a 409 or a 503 is not a useful thing to serve to the
 * next person regardless.
 */
function typedPage(rendered: Response, status: number): Response {
  const headers = new Headers(rendered.headers);
  headers.set('cache-control', 'no-store');
  return new Response(rendered.body, { status, headers });
}
