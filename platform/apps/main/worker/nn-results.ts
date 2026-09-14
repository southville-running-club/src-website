/**
 * `/nn/<year>/results/` — one running's results, for the people allowed to read them.
 *
 * ## Locked until the results are published, and locked at the database rather than here
 *
 * **The club has decided how and when a result is published** — after the race is finished, by
 * somebody holding `timing.result.publish` deciding to, which is #241 and
 * [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
 * Until that act this address answers **404 to everybody without `nn.results.read`** — the
 * signed-out public included. `timing.results_for_event()` is where that is actually enforced:
 * it reads the race's own `results_published_at`, consults the permission only when that is
 * null, and returns `null` rather than raising — so a caller reaching PostgREST directly with
 * the published anon key gets exactly what this page gets. The gate here is the page refusing
 * to render, not the thing keeping the data in.
 *
 * ⚠️ **This file does not yet open to a signed-out visitor, and that is
 * [#242](https://github.com/southville-running-club/src-website/issues/242) rather than an
 * oversight.** `handleNnResults` still refuses before it reads anything when there is no
 * session, and the response is still `no-store` and `noindex`. #241 built the state machine and
 * widened the *database* read to `anon`; the public page, its link from `/nn/` and the caching
 * headers that go with a permanent address are #242's, in one change that can be reviewed as
 * one. The one thing that could not wait is the banner below: a page that went on saying
 * "these results are not published" about a race the club had just published would be stating
 * something false to the people who can already read it.
 *
 * ⚠️ **404, never 403, and a refused read is indistinguishable from a race that does not
 * exist.** The function returns the same `null` for "you may not" and "no such event", and
 * this file cannot tell them apart on purpose — a 403 would confirm to somebody probing the
 * site that `/nn/2026/results/` is a real address with something behind it. Same rule as
 * `/admin/`, and the wording below is `admin-shell.ts`'s word for word.
 *
 * ## It reads a session and never writes one
 *
 * `readSession()` owns minting, refreshing and sliding the idle window, and this asks it the
 * question and carries whatever it hands back. Every path out goes through `withCookies` for
 * the reason `handleAdmin` gives at length: `readSession` rotates the refresh token the moment
 * the access token is close to expiry, so the old cookie is spent whether or not this request
 * turns out to be for somebody who may read results — and a 404 needs the new pair exactly as
 * much as a rendered table does.
 */

import { createUserClient, type SupabaseConfig } from '@src/shared';
import { effectiveBib } from '@src/shared/timing/bib';
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
import { nnEventSlugForResultsPath } from './routing';
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
    <td>${team?.category ?? '—'}</td>
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

function page(title: string, body: Html, pathname: string, status: number): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <!-- Not published, so not indexed. The header below says the same thing to a crawler
             that does not read markup. -->
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} — Southville Running Club</title>
        ${faviconLink()}
        <link rel="stylesheet" href="/nn/results.css" />
      </head>
      <body>
        ${siteBanner()} ${siteNav(pathname)} ${body} ${siteFooter()}
      </body>
    </html>`;

  return new Response(document.toString(), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Rendered per viewer, behind a permission: it may not be cached by anything.
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

/**
 * The refusal — `admin-shell.ts`'s wording, deliberately, so the two surfaces say the same
 * sentence to somebody who is not allowed to be at either.
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
  );
}

function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) {
    response.headers.append('set-cookie', cookie);
  }

  return response;
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

  const { session, setCookies } = await readSession(
    cfg,
    request.headers.get('cookie'),
    Math.floor(Date.now() / 1000),
    url.protocol === 'https:',
  );

  if (session === null) {
    return withCookies(notFound(url.pathname), setCookies);
  }

  const slug = nnEventSlugForResultsPath(url.pathname);
  if (slug === null) {
    return withCookies(notFound(url.pathname), setCookies);
  }

  const asPerson = createUserClient(cfg, session.accessToken);
  const { data, error } = await asPerson
    .schema('timing')
    .rpc('results_for_event', { p_event_slug: slug });

  if (error) {
    // **A 404 on an unreachable database, and that is the admin surface's answer rather than
    // an oversight.** The rule that a page must not delete itself for the length of an outage
    // is about pages the public reads; this one is already invisible to them, and the
    // alternative — an error page at an address that answers 404 to almost everybody — is
    // itself a disclosure. A code and a message, never a row.
    console.error(`timing: results read unavailable — ${error.code}: ${error.message}`);
    return withCookies(notFound(url.pathname), setCookies);
  }

  if (data === null) {
    return withCookies(notFound(url.pathname), setCookies);
  }

  const payload = data as unknown as ResultsPayload;

  // ⚠️ **The sentence is a claim about a record, so it is only made while it is true.** Before
  // #241 the page had nothing to check and said "not published" unconditionally; a published
  // race would now be telling its readers the opposite of what the club had just decided. The
  // *richer* banner #242 asks for — naming capturing against finished, and the signed-out
  // render underneath it — is that issue's, deliberately not built here.
  const preview =
    payload.event.results_published_at === null
      ? html`<p class="results-meta">
          These results are not published. This page is visible only to people the club
          has given permission to read them, and the times on it are provisional until the
          race director confirms them.
        </p>`
      : // `null` renders as nothing at all — `html.ts`'s own rule, and the reason there is no
        // empty paragraph left behind on a published page.
        null;

  const body = html`<main class="results-page" id="main">
    <h1>${payload.event.name} — results</h1>
    ${preview} ${resultsTable(payload)}
  </main>`;

  return withCookies(
    page(`${payload.event.name} results`, body, url.pathname, 200),
    setCookies,
  );
}
