/**
 * `/nn/<year>/results/` — one running's results. **Public once they are published, and the
 * same 404 as an address that does not exist until then.**
 *
 * ## Two pages at one address, and the race's own state decides which
 *
 * A Nightingale Nightmare result is published by an explicit act after the race is finished —
 * #241 and [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
 * Before that act this address answers **404 to everybody without `nn.results.read`**, the
 * signed-out public included; after it, it answers **the results to everybody**.
 *
 * | Visitor | Before publication | After publication |
 * | --- | --- | --- |
 * | Signed out, or holding nothing | 404 | the results |
 * | `nn.results.read` | the preview, with a banner naming the state | the results |
 *
 * **`timing.results_for_event()` is where that is actually enforced**, not here: it reads the
 * race's own `results_published_at`, consults the permission only when that is null, and
 * returns `null` rather than raising — so a caller reaching PostgREST directly with the
 * published anon key gets exactly what this page gets. The gate here is the page refusing to
 * render; the database is what keeps the data in.
 *
 * ⚠️ **404, never 403, and a refused read is indistinguishable from a race that does not
 * exist.** The function returns the same `null` for "you may not" and "no such event", and
 * this file cannot tell them apart on purpose — a 403 would confirm to somebody probing the
 * site that `/nn/2027/results/` is a real address with something behind it. Same rule as
 * `/admin/`, and the wording below is `admin-shell.ts`'s word for word.
 *
 * ## ⚠️ The published page is cacheable, and three things have to hold for that to be safe
 *
 * [C2](../../../../docs/foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
 * asks for a permanent public address, and a permanent public address that may not be cached
 * is a strange thing to publish. So a published race is served `public` and indexable. What
 * pays for that, all three of which are load-bearing:
 *
 *   1. **The answer does not vary by caller once published.** `results_for_event()` withholds
 *      `age_on_day` from every caller on a published race — [ADR-043](../../../../docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md)
 *      — so a permission holder and a stranger are handed the same bytes and a shared cache
 *      cannot serve one to the other.
 *   2. **A response that sets a cookie is never publicly cached.** `readSession()` rotates the
 *      refresh token when the access token is close to expiry, so a signed-in visitor's
 *      request can carry `Set-Cookie` on the way out — and a shared cache holding *that* would
 *      hand one person's refreshed session to the next. That request falls back to
 *      `private, no-store`. A crawler carries no cookies and never reaches the branch.
 *   3. **Sixty seconds, and it is chosen against the withdrawal rather than against load.**
 *      ADR-042's correction path is *unpublish, fix, publish*, and the page goes back to 404
 *      in between — but a cache already holding the table will serve it until it expires. A
 *      minute is the longest anybody should be reading a table the club has taken down.
 *
 * **Before publication none of that applies**: the preview is rendered for a handful of people
 * behind a permission, so it stays `private, no-store` and `noindex`, exactly as it was.
 *
 * ## It reads a session and never writes one
 *
 * `readSession()` owns minting, refreshing and sliding the idle window, and this asks it the
 * question and carries whatever it hands back. Every path out goes through `withCookies` for
 * the reason `handleAdmin` gives at length: `readSession` rotates the refresh token the moment
 * the access token is close to expiry, so the old cookie is spent whether or not this request
 * turns out to be for somebody who may read results — and a 404 needs the new pair exactly as
 * much as a rendered table does.
 *
 * ⚠️ **A request carrying no cookie at all skips the session read entirely**, which is what
 * makes the common public case one round trip rather than two — and is why a crawler or a
 * first-time visitor can never be handed a `Set-Cookie` on this address.
 */

import {
  ageCategoryFor,
  ageCategoryLabel,
  createAnonClient,
  createUserClient,
  type SupabaseConfig,
} from '@src/shared';
import { effectiveBib } from '@src/shared/timing/bib';
import { deriveCategory } from '@src/shared/timing/categories';
import { placementFor } from '@src/shared/timing/gender';
import {
  buildResults,
  formatDuration,
  sortResults,
  type Result,
  type ResultStatus,
} from '@src/shared/timing/results';
import type {
  TimingCrossing,
  TimingEvent,
  TimingRunner,
  TimingTeam,
} from '@src/shared/timing/rows';
import { html, type Html } from './html';
import {
  nnEventSlugForResultsPath,
  nnResultsPath,
  nnYearPathForEventSlug,
} from './routing';
import { readSession } from './session';
import { faviconLink, siteBanner, siteFooter, siteNav } from './site-chrome';

export interface NnResultsEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * What `timing.results_for_event()` returns, named here because there is nothing to generate
 * from yet — the same reasoning `rows.ts` gives for the row shapes it declares.
 *
 * The team and runner rows are **wider** than the structural minimums the timing logic reads,
 * which is exactly what those `Pick`-shaped types are for: `buildResults` takes the fuller row
 * happily, and the extra columns are what this page prints.
 *
 * ⚠️ **`TimingRunner` requires `result_placement` and `role`, and until #242 the answer did
 * not carry either** — the cast below is `as unknown as`, so it compiled. Both are in the
 * payload now, which is what lets the category be `effectiveCategory()`'s answer rather than a
 * third branch invented here.
 */
type ResultsPayload = {
  event: TimingEvent & {
    slug: string;
    name: string;
    finished_at: string | null;
    /**
     * Set by `timing.publish_results()` — #241 and ADR-042. Null means this answer reached the
     * page because the caller holds `nn.results.read`, not because the race is public.
     */
    results_published_at: string | null;
  };
  teams: (TimingTeam & { name: string | null; runners: TimingRunner[] })[];
  crossings: TimingCrossing[];
};

/** Words for a row that has no time, so a blank cell never has to be interpreted. */
function statusWords(status: ResultStatus, format: TimingEvent['format']): string {
  switch (status) {
    case 'finished':
      return 'Finished';
    case 'pending':
      return 'On course';
    case 'leg1':
      // Only a relay reaches this, and saying "leg 2" to a solo field would be nonsense.
      return format === 'relay' ? 'On leg 2' : 'On course';
    case 'dns':
      return 'Did not start';
    case 'dnf':
      return 'Did not finish';
    case 'dq':
      return 'Disqualified';
  }
}

function runnerName(runner: TimingRunner | undefined): string {
  if (runner === undefined) return 'No runner recorded';
  return `${runner.firstname} ${runner.lastname}`.trim();
}

/**
 * The category a result counts in, and **every part of it comes from a module that already
 * owns that question.**
 *
 * ⚠️ **`teams.category` is not it, and reading it was the defect this replaces.**
 * `import_from_entries()` writes nothing to that column — its own header says there is nothing
 * on a team row the import is authoritative about — so every runner the club actually entered
 * rendered a dash.
 *
 * Three rules, none of them invented here:
 *
 *   * **Which of the two lists** is `placementFor()` — `normaliseTimingGender()` followed by
 *     `effectiveCategory()`, so
 *     [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
 *     placement decides where a non-binary runner's result counts and nothing grows a third
 *     branch. A runner who was asked and said neither is in no category, which is the honest
 *     answer rather than a guess.
 *   * **Which band** is `ageCategoryFor()` from `packages/shared/src/age-category.ts`, the one
 *     module allowed to name one.
 *   * ⚠️ **A guide is in no category at all** —
 *     [ADR-022](../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md).
 *     They run the course and wear a bib; they are in no band and no prize, exactly as
 *     `awards.ts` has them.
 *
 * ⚠️ **A published page shows the list and not the band, and that is ADR-043 rather than an
 * omission.** `age_on_day` is withheld from every caller once a race is published, so there is
 * no age to derive a band from — a published result carries a name, a category and a time, and
 * whether the four prize bands may join them is the club's decision. The preview, which has the
 * age, shows the full band. Nothing here branches on publication: it renders the band when it
 * was given an age and the list when it was not, which is the same code either way.
 */
function categoryWords(runner: TimingRunner | undefined): string | null {
  if (runner === undefined || runner.role === 'guide') {
    return null;
  }

  const placement = placementFor(runner.gender, runner.result_placement);

  if (placement === null) {
    return null;
  }

  const list = placement === 'female' ? 'Women' : 'Men';

  if (runner.age_on_day === null) {
    return list;
  }

  const band = ageCategoryFor(runner.age_on_day, placement);

  // `known: false` here is only ever `younger-than-any-category`: `not-placed` needs a null
  // category, which the guard above has already returned on. A runner below the youngest band
  // is in the list and in no band, which is what the list alone says.
  return band.known ? `${list}'s ${ageCategoryLabel(band.code)}` : list;
}

/**
 * The category cell for one team.
 *
 * **A relay's category is the pair's and a solo entry's is the runner's**, which is the split
 * `categories.ts` spends its header on: `deriveCategory()` is the three pair categories the
 * club awards a relay in, and a solo race is placed by `age-category.ts`. Nightingale
 * Nightmare is solo — this page is only ever reached for an `nn-<year>` event — and the relay
 * branch is here so that reaching it with Pass the Buck's archive one day renders a category
 * rather than a dash.
 */
function teamCategory(
  team: ResultsPayload['teams'][number] | undefined,
  format: TimingEvent['format'],
): string {
  if (team === undefined) return '—';

  if (format === 'relay') {
    return deriveCategory(team.runners) ?? team.category ?? '—';
  }

  return categoryWords(team.runners[0]) ?? '—';
}

/**
 * One row. **The name comes from the payload rather than from the `Result`**, because
 * `buildResults` types `result.team` as the structural minimum it reads and that minimum
 * deliberately holds no names — so the fuller row is joined back on by id here.
 */
function resultRow(
  result: Result,
  team: ResultsPayload['teams'][number] | undefined,
  format: TimingEvent['format'],
  position: number | null,
): Html {
  const runners = team?.runners ?? [];
  // A solo entry is one runner on leg 1; a relay pair is both legs, in leg order.
  const who =
    format === 'solo'
      ? runnerName(runners[0])
      : runners.length === 0
        ? 'No runner recorded'
        : runners.map(runnerName).join(' & ');

  /**
   * **A solo entry has one bib and a relay pair has two, so the column says so rather than
   * picking one.** Nightingale Nightmare is solo — this page is only ever reached for an
   * `nn-<year>` event — and showing a relay's leg-2 bib alone would name the finisher's number
   * as though it were the team's. `effectiveBib` is what resolves an override the desk wrote
   * over the derived number, per leg.
   */
  const bib =
    team === undefined
      ? null
      : format === 'solo'
        ? effectiveBib(team, 1, format)
        : [effectiveBib(team, 1, format), effectiveBib(team, 2, format)]
            .filter((one): one is string => one !== null)
            .join(' / ') || null;

  return html`<tr>
    <td class="results-num">${position === null ? '—' : String(position)}</td>
    <td class="results-num">${bib ?? '—'}</td>
    <td class="results-name">${team?.name ? `${who} (${team.name})` : who}</td>
    <td>${teamCategory(team, format)}</td>
    <td class="results-num">${formatDuration(result.totalMs)}</td>
    <td class="results-status">
      ${statusWords(result.status, format)}${
        result.hasOpenAnomaly
          ? html` <span class="results-suspect">— being checked</span>`
          : ''
      }
    </td>
  </tr>`;
}

function resultsTable(payload: ResultsPayload): Html {
  const results = sortResults(
    buildResults(payload.event, payload.teams, payload.crossings),
    'total',
  );

  if (results.length === 0) {
    return html`<p class="results-empty">
      Nothing has been captured for this race yet.
    </p>`;
  }

  const byId = new Map(payload.teams.map((team) => [team.id, team]));

  // **Position counts finished rows in the order `sortResults` put them in.** It partitions
  // every terminal status below every timed and in-progress team and then sorts by total, so
  // a running count is the placing — and a team still on the course, or one that did not
  // finish, is given no number at all rather than a misleading one.
  let finished = 0;
  const rows = results.map((result) => {
    const placed = result.status === 'finished';
    if (placed) finished += 1;
    return resultRow(
      result,
      byId.get(result.team.id),
      payload.event.format,
      placed ? finished : null,
    );
  });

  return html`<div class="results-scroll">
    <table class="results-table">
      <caption class="results-meta">
        ${String(results.length)} entries
      </caption>
      <thead>
        <tr>
          <th scope="col">Pos</th>
          <th scope="col">Bib</th>
          <th scope="col">Runner</th>
          <th scope="col">Category</th>
          <th scope="col">Time</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

/**
 * How a response may be stored and whether a crawler may index it — the one thing publication
 * changes about the envelope rather than about the body.
 *
 * `private` is every refusal and every preview. `public` is a published race, and only on a
 * request that is not also setting a cookie: see the header's three conditions.
 */
type Visibility = 'private' | 'public';

/** See the header. Sixty seconds is chosen against ADR-042's withdrawal, not against load. */
const PUBLISHED_MAX_AGE_SECONDS = 60;

function page(
  title: string,
  body: Html,
  pathname: string,
  status: number,
  visibility: Visibility,
): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${
          visibility === 'public'
            ? // A published result is a permanent public record — C2 — so nothing here tells a
              // crawler to stay away. The header below says the same thing to one that does not
              // read markup.
              null
            : html`<meta name="robots" content="noindex, nofollow" />`
        }
        <title>${title} — Southville Running Club</title>
        ${faviconLink()}
        <link rel="stylesheet" href="/nn/results.css" />
      </head>
      <body>
        ${siteBanner()} ${siteNav(pathname)} ${body} ${siteFooter()}
      </body>
    </html>`;

  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control':
      visibility === 'public'
        ? `public, max-age=${String(PUBLISHED_MAX_AGE_SECONDS)}`
        : // Rendered per viewer, behind a permission: it may not be cached by anything.
          'private, no-store',
  };

  if (visibility !== 'public') {
    headers['x-robots-tag'] = 'noindex, nofollow';
  }

  return new Response(document.toString(), { status, headers });
}

/**
 * The refusal — `admin-shell.ts`'s wording, deliberately, so the two surfaces say the same
 * sentence to somebody who is not allowed to be at either.
 *
 * **Always `private`**, whatever the race's state: this is the answer to a caller the club has
 * not let in, and a shared cache holding it could go on refusing somebody the page was
 * published to.
 */
function notFound(pathname: string): Response {
  return page(
    'Not found',
    html`<main class="results-page" id="main">
      <h1>Not found</h1>
      <p>There is nothing at this address.</p>
    </main>`,
    pathname,
    404,
    'private',
  );
}

function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) {
    response.headers.append('set-cookie', cookie);
  }

  return response;
}

/**
 * The banner over an unpublished table, and **it names which of the two unpublished states the
 * race is in** — #242.
 *
 * ⚠️ **The sentence is a claim about a record, so it is only made while it is true.** Before
 * #241 the page had nothing to check and said "not published" unconditionally; a published race
 * would now be telling its readers the opposite of what the club had just decided. A published
 * race gets no banner at all — `null` renders as nothing, `html.ts`'s own rule, which is why
 * there is no empty paragraph left behind.
 *
 * **Both variants say the same two things**, because both are true either side of
 * `finish_event()`: that nobody has published this, and that the times are provisional.
 * `finished_at` is a label the race director can set and unset and it gates nothing about
 * capture — `20260913240000` — so what it changes here is one clause and not the warning.
 */
function previewBanner(event: ResultsPayload['event']): Html | null {
  if (event.results_published_at !== null) {
    return null;
  }

  return event.finished_at === null
    ? html`<p class="results-meta">
        These results are not published, and this race is still being timed. This page is
        visible only to people the club has given permission to read them, and the times
        on it are provisional until the race director confirms them.
      </p>`
    : html`<p class="results-meta">
        These results are not published. The race has been called finished, and nobody has
        published its results yet. This page is visible only to people the club has given
        permission to read them, and the times on it are provisional until the race
        director confirms them.
      </p>`;
}

export async function handleNnResults(
  request: Request,
  env: NnResultsEnv,
  url: URL,
): Promise<Response> {
  const cfg: SupabaseConfig = {
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  };

  const cookie = request.headers.get('cookie');

  // **No cookie, no session read.** The signed-out visitor is the common case on a published
  // race, and asking GoTrue about a session nobody presented is a round trip that can only
  // answer "none" — and one that could hand a crawler a `Set-Cookie` on an address the club
  // wants cached.
  const { session, setCookies } =
    cookie === null
      ? { session: null, setCookies: [] as string[] }
      : await readSession(
          cfg,
          cookie,
          Math.floor(Date.now() / 1000),
          url.protocol === 'https:',
        );

  const slug = nnEventSlugForResultsPath(url.pathname);
  if (slug === null) {
    return withCookies(notFound(url.pathname), setCookies);
  }

  // ⚠️ **A signed-out visitor is no longer refused before anything is read**, which is #242's
  // whole change. Whether this address has anything behind it is the race's question rather
  // than the caller's, and `results_for_event()` is what answers it: `anon` reaches it since
  // #241 and gets `null` for every race that is not published.
  const client =
    session === null ? createAnonClient(cfg) : createUserClient(cfg, session.accessToken);

  const { data, error } = await client
    .schema('timing')
    .rpc('results_for_event', { p_event_slug: slug });

  if (error) {
    // **A 404 on an unreachable database, and that is the admin surface's answer rather than
    // an oversight.** The rule that a page must not delete itself for the length of an outage
    // is about a page that is known to exist; this address answers 404 to almost every caller
    // by design, and an error page here would itself disclose which years are real. A code and
    // a message, never a row.
    console.error(`timing: results read unavailable — ${error.code}: ${error.message}`);
    return withCookies(notFound(url.pathname), setCookies);
  }

  if (data === null) {
    return withCookies(notFound(url.pathname), setCookies);
  }

  const payload = data as unknown as ResultsPayload;
  const published = payload.event.results_published_at !== null;

  // See the header: a response that sets a cookie may not be stored by a shared cache, whatever
  // the race's state. `setCookies` is empty on nearly every request, and always on one that
  // arrived without a cookie at all.
  const visibility: Visibility =
    published && setCookies.length === 0 ? 'public' : 'private';

  const body = html`<main class="results-page" id="main">
    <h1>${payload.event.name} — results</h1>
    ${previewBanner(payload.event)} ${resultsTable(payload)}
  </main>`;

  return withCookies(
    page(`${payload.event.name} results`, body, url.pathname, 200, visibility),
    setCookies,
  );
}

// ===========================================================================================
// The link to this page, on the two pages that may carry one
// ===========================================================================================
// **`/nn/` and `/nn/<year>/` link to the results only once they are published** — #242. A link
// to a 404 is a claim about a record: the club's own front door saying a race's results exist,
// answering "there is nothing at this address" to everybody who follows it.
//
// ⚠️ **`/nn/` never names a year and nothing in its markup may**, which is why the anchor ships
// with `href=""` and is filled in here. The year comes off `entries.current_entry_state('nn')`
// by way of `worker/routing.ts`'s `nn-<year>` convention, exactly as every other year-bearing
// link on that page does — so publishing 2027 stays a row and a content page rather than an
// edit here.
//
// **The label names no year either**, which is what keeps `site.spec.ts`'s no-year guard
// honest: that guard reads the page's text, and a year in an `href` is not text.
//
// ⚠️ **Not in the navigation bar, and that is a layout decision rather than a copy one.**
// [ADR-014](../../../../docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md)
// answers arrow-keyed radios landing behind a sticky bar with a hand-written
// `scroll-padding-top` per breakpoint, so a fifth control in that bar is a change to every one
// of those tokens. Renaming one label to "Race instructions" once added forty-eight pixels at
// every width from 768 to 1440.

/** A small handler pair, local for the reason every other module in this Worker has its own. */
class RevealHandler {
  element(element: Element): void {
    element.removeAttribute('hidden');
  }
}

class AttributeHandler {
  constructor(
    private readonly name: string,
    private readonly value: string,
  ) {}

  element(element: Element): void {
    element.setAttribute(this.name, this.value);
  }
}

export type NnResultsLink = { published: false } | { published: true; path: string };

/** Nothing to paint: the link stays hidden with its empty `href`, which is the shipped page. */
const NO_LINK: NnResultsLink = { published: false };

/**
 * Whether this running's results are published, and where they are.
 *
 * ⚠️ **`timing.results_published_at()` rather than `results_for_event()`**, and that is the whole
 * of what the second `anon`-callable function in `timing` buys —
 * [ADR-043](../../../../docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).
 * The question is one bit; the results read answers it by returning every team, every runner and
 * every crossing, which on a full field is two hundred and fifty teams of payload to decide
 * whether to render one anchor — on two pages, for every visitor, on every view.
 *
 * **An anonymous client, deliberately**, even for a signed-in visitor: the answer is a public
 * fact and does not vary by caller, so signing the call with somebody's token would buy nothing
 * and would make a painted page depend on who asked for it.
 *
 * **Every failure paints nothing**, which is the direction every other read behind these two
 * pages takes: a database this Worker cannot reach leaves the page exactly as it shipped, with
 * one fewer door in it. A missing link is a recoverable disappointment; a link to a 404 is the
 * club appearing to have lost a race's results.
 */
export async function resolveNnResultsLink(
  env: NnResultsEnv,
  eventSlug: string | null,
): Promise<NnResultsLink> {
  if (eventSlug === null) {
    return NO_LINK;
  }

  const yearPath = nnYearPathForEventSlug(eventSlug);

  if (yearPath === null) {
    // A running of this race named some other way. `resolveNnRaceView` logs and gives up for
    // the same reason: there is no page for it, so linking to a guess is a 404 on the front
    // door — worse than the missing link.
    return NO_LINK;
  }

  try {
    const { data, error } = await createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    })
      .schema('timing')
      .rpc('results_published_at', { p_event_slug: eventSlug });

    if (error) {
      console.error(`timing: results_published_at — ${error.code}: ${error.message}`);
      return NO_LINK;
    }

    // `null` is a race that is not published **and** a race with no `timing.events` row at
    // all, which are deliberately the same answer — see the function's own comment.
    return data === null ? NO_LINK : { published: true, path: nnResultsPath(yearPath) };
  } catch (cause) {
    console.error(
      `timing: results_published_at threw — ${
        cause instanceof Error ? cause.name : 'unknown'
      }`,
    );
    return NO_LINK;
  }
}

/**
 * Reveal the results link and point it at this running, or leave the page as it shipped.
 *
 * One selector doing both jobs, the way `renderNnPreviousYears` does: the anchor is hidden in
 * the markup with an empty `href`, so an unpainted page has no link rather than a broken one.
 */
export function renderNnResultsLink(
  rewriter: HTMLRewriter,
  link: NnResultsLink,
): HTMLRewriter {
  if (!link.published) {
    return rewriter;
  }

  return rewriter
    .on('[data-nn-results-link]', new RevealHandler())
    .on('[data-nn-results-link]', new AttributeHandler('href', link.path));
}
