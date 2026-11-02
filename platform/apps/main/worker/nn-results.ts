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
  fetchPhotosReady,
  formatLondonDate,
  type SupabaseConfig,
} from '@src/shared';
import { effectiveBib } from '@src/shared/timing/bib';
import { deriveCategory } from '@src/shared/timing/categories';
import { placementFor } from '@src/shared/timing/gender';
import { resultLines, type GuideLine } from '@src/shared/timing/result-lines';
import {
  buildResults,
  formatDuration,
  type Result,
  type ResultStatus,
} from '@src/shared/timing/results';
import type {
  TimingCrossing,
  TimingEvent,
  TimingRunner,
  TimingTeam,
} from '@src/shared/timing/rows';
import race from '../src/content/race.json';
import { clubLogo } from './club-chrome';
import { html, type Html } from './html';
import {
  nnEventSlugForResultsPath,
  nnResultsPath,
  nnYearPathForEventSlug,
} from './routing';
import { readSession } from './session';
import { faviconLink, siteBanner, siteFooter } from './site-chrome';

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

/**
 * Whether a row has **no finish time on a race that is over** — the runners this page marks
 * with an asterisk and explains above the table.
 *
 * ⚠️ **"On course" stops being true the moment the race is called finished**, and before this
 * it was what a published table said for ever about anybody with no crossing: the race-night
 * runbook asks for every no-show to be marked DNS, and publication does not refuse one who was
 * not. What is left after that is a runner nobody can account for — a race number hidden under
 * a costume and missed at the line, or somebody who never came — and the club cannot tell
 * which. So the row claims neither: it says no time was recorded, which is the one thing that
 * is certainly true, and the note asks a runner who did finish to get in touch.
 *
 * **Keyed on `finished_at` rather than on publication**, so the preview a permission holder
 * reads before pressing publish shows exactly what the public will. A published race is always
 * finished — `publish_results()` refuses one that is not, and `reopen_event()` refuses a
 * published one — so the public page can never meet the other branch.
 *
 * **DNS, DNF and DQ are not this**: each is a decision somebody recorded, and the row says so.
 * A relay team with only leg A is, because it has no finish time either.
 */
function noTimeRecorded(status: ResultStatus, raceFinished: boolean): boolean {
  return raceFinished && (status === 'pending' || status === 'leg1');
}

/** Words for a row that has no time, so a blank cell never has to be interpreted. */
function statusWords(
  status: ResultStatus,
  format: TimingEvent['format'],
  raceFinished: boolean,
): string {
  if (noTimeRecorded(status, raceFinished)) {
    return 'No time recorded';
  }

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
  raceFinished: boolean,
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

  /**
   * **The asterisk goes on the name, because the name is what somebody looks for.** At 320px
   * the Time and Status columns are off the edge of a sideways-scrolling table, so a runner
   * scanning for themselves on a phone meets the asterisk before anything else — and the note
   * it points to is above the table rather than under two hundred rows. The Status cell says
   * the same thing in words, so nothing rests on the symbol alone.
   */
  const mark = noTimeRecorded(result.status, raceFinished)
    ? html`<span class="results-mark">*</span>`
    : null;

  return html`<tr>
    <td class="results-num">${position === null ? '—' : String(position)}</td>
    <td class="results-num">${bib ?? '—'}</td>
    <td class="results-name">${team?.name ? `${who} (${team.name})` : who}${mark}</td>
    <td>${teamCategory(team, format)}</td>
    <td class="results-num">${formatDuration(result.totalMs)}</td>
    <td class="results-status">
      ${statusWords(result.status, format, raceFinished)}${
        result.hasOpenAnomaly
          ? html` <span class="results-suspect">— being checked</span>`
          : ''
      }
    </td>
  </tr>`;
}

/**
 * A visually impaired runner's guide, on a row of their own —
 * [ADR-073](../../../../docs/architecture/decisions/adr-073-a-guide-has-a-time-of-their-own.md).
 *
 * **Their own number and their own time**, read from their own capture by `resultLines()`.
 *
 * ⚠️ **Nothing on this row says "guide", and that is the decision rather than a gap.** A row
 * saying so says *"the runner beside them is visually impaired"* about a named person, which is
 * Article 9 data (ADR-022, ADR-043), and whether the published table may ever say it is the
 * committee's call. So the row is what the club publishes for anybody — a name, a number and a
 * time — with a dash for the position, because a guide is in no prize and placing them would
 * move every runner behind them, and a dash for the category, because a guide is never asked
 * for one. The staff preview at `/timing/…/results` is where "Guide" is written.
 *
 * **It never carries the no-time asterisk**: `resultLines()` lists a guide only when their own
 * number was captured, so a guide's row is never one the club has no time for.
 *
 * **Nothing here branches on publication either**, which is `categoryWords()`'s rule: the
 * preview a permission holder reads on this page before publication is the table the public
 * will read.
 */
function guideRow(
  line: GuideLine<ResultsPayload['teams'][number]>,
  format: TimingEvent['format'],
  raceFinished: boolean,
): Html {
  return html`<tr>
    <td class="results-num">—</td>
    <td class="results-num">${line.bib}</td>
    <td class="results-name">${runnerName(line.guide)}</td>
    <td>—</td>
    <td class="results-num">${formatDuration(line.result.totalMs)}</td>
    <td class="results-status">
      ${statusWords(line.result.status, format, raceFinished)}${
        line.result.hasOpenAnomaly
          ? html` <span class="results-suspect">— being checked</span>`
          : ''
      }
    </td>
  </tr>`;
}

/**
 * What the asterisk means, and what to do about it — shown only when some row carries one.
 *
 * ⚠️ **Every clause is chosen so that it cannot be wrong about the runner it is read by.** The
 * club does not know whether a runner with no time finished unseen or never came, so the note
 * says neither: it says there is no time, gives the ordinary reason a time goes missing without
 * blaming anybody for it, and asks a runner who *did* finish to say so. It promises to look and
 * to update the result, and not to accept a time unseen — a correction is still *unpublish,
 * fix, publish* (ADR-042), made by a person who has checked.
 *
 * **The address is `race.json`'s `contact`**, the one the race's own pages publish, so a runner
 * writes to the inbox that already handles every other question about this race.
 */
function noTimeNote(): Html {
  return html`<p class="nn-card results-note">
    <span class="results-mark">*</span> We do not have a finish time for the runners
    marked with an asterisk. Race numbers can be hard to see at the finish — under a
    costume, for example — so a missing time does not mean somebody did not finish. If you
    ran and your time is missing, please email
    <a href="mailto:${race.contact}">${race.contact}</a> with your name and race number,
    and we will look into it and update your result.
  </p>`;
}

function resultsTable(payload: ResultsPayload): Html {
  // **Position counts finished entries in finishing order, and a guide is never counted** —
  // `resultLines()` owns both, so a team still on the course, one that did not finish and a
  // guide are each given no number rather than a misleading one, and the staff preview cannot
  // number the field differently from this page.
  const lines = resultLines(payload.event, payload.teams, payload.crossings);

  if (lines.length === 0) {
    return html`<p class="nn-card results-empty">
      Nothing has been captured for this race yet.
    </p>`;
  }

  const raceFinished = payload.event.finished_at !== null;

  // The caption counts **entries**, as it always has. A guide is on their runner's entry, so a
  // guide's row is a person on the table rather than an entry of their own.
  const entries = lines.filter((line) => line.kind === 'entry').length;

  const rows = lines.map((line) =>
    line.kind === 'guide'
      ? guideRow(line, payload.event.format, raceFinished)
      : resultRow(
          line.result,
          line.team,
          payload.event.format,
          line.position,
          raceFinished,
        ),
  );

  const anyUnrecorded = lines.some((line) =>
    noTimeRecorded(line.result.status, raceFinished),
  );

  // ⚠️ **A scrollable region has to be reachable by keyboard, and this table contains nothing
  // focusable at all.** `.results-scroll` scrolls horizontally at narrow widths, and axe's
  // `scrollable-region-focusable` is satisfied either by the region being focusable itself or
  // by it *containing* something focusable — a results table is all text, so it is neither.
  // Somebody navigating by keyboard at 375px could not scroll it, and the Time and Status
  // columns were simply unreachable to them.
  //
  // **Only mobile-safari saw it**, because the table does not overflow at desktop width and a
  // region that does not scroll is not a scrollable region. `admin-people.ts` carries the
  // longer note: this is the second page to meet it, and the first to meet it with no
  // controls anywhere on the table rather than by taking the controls away.
  const table = html`<div
    class="results-scroll"
    tabindex="0"
    role="region"
    aria-labelledby="results-table-caption"
  >
    <table class="results-table">
      <caption class="results-meta" id="results-table-caption">
        ${String(entries)} entries
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

  return anyUnrecorded ? html`${noTimeNote()} ${table}` : table;
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

/**
 * The running a page belongs to, for the two things in its frame that name one: the masthead's
 * button and the footer's race block. **Null on a refusal**, which may name no year — a 404
 * whose footer said "Nightingale Nightmare 2027" would be the disclosure the refusal exists to
 * avoid.
 */
type Running = { name: string; yearPath: string };

/** `NnMasthead.astro`'s wordmark width, so the two mastheads are the same size. */
const NN_LOGO_WIDTH = 176;

/**
 * **`NnMasthead.astro`, rendered by the Worker** — the bar every other Nightingale Nightmare
 * page carries, so the results read as part of the race rather than as a club tool.
 *
 * ⚠️ **A second copy of that component's markup, deliberately**, for the reason
 * `club-chrome.ts` gives about `ClubHeader.astro`: this page is built as strings and Astro is
 * not in the request path. `nn-results.spec.ts` compares this bar's links with `/nn/`'s in a
 * browser, so the two cannot drift apart without a test going red.
 *
 * **The button is "Race details", pointing at the running's own page**, which is what the
 * Worker paints on the other campaign pages once entries have closed — and a running with
 * results has always closed. A refusal draws no button at all: it has no running to point at.
 *
 * **Sticky, like every campaign page but the year page.** `/nn/<year>/` unsticks the bar on a
 * phone only because it pins an entry bar at the bottom as well; this page has no second strip.
 */
function nnMasthead(running: Running | null): Html {
  return html`<header class="nn-masthead">
    <div class="nn-wrap">
      <a class="nn-masthead-mark" href="/" aria-label="Southville Running Club, home">
        ${clubLogo('nn-logo', NN_LOGO_WIDTH, false)}
      </a>
      <nav class="nn-nav" aria-label="Nightingale Nightmare">
        <ul class="nn-nav-links">
          <li><a href="/nn/">Race</a></li>
          <li><a href="/nn/privacy/">Privacy</a></li>
        </ul>
      </nav>
      ${
        running === null
          ? null
          : html`<a
              class="nn-nav-cta"
              href="${running.yearPath}"
              aria-label="Race details"
            >
              <span class="nn-nav-cta-long">Race details</span>
              <span class="nn-nav-cta-short">Details</span>
            </a>`
      }
    </div>
  </header>`;
}

/**
 * **The race's frame around a table that keeps the club's** — the gradient, the masthead, the
 * display face and the footer's race block are `/nn/<year>/`'s, and the table is unchanged.
 * See `nn-results.css` for why the table carries its own surface and ink.
 */
function page(
  title: string,
  body: Html,
  status: number,
  visibility: Visibility,
  running: Running | null,
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
      <body class="theme-nn">
        <a class="skip-link" href="#main">Skip to content</a>
        ${siteBanner()} ${nnMasthead(running)} ${body}
        ${siteFooter(
          running === null
            ? undefined
            : { name: running.name, privacy: '/nn/privacy/', contact: race.contact },
        )}
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
function notFound(): Response {
  return page(
    'Not found',
    html`<main class="results-page" id="main">
      <header class="nn-hero">
        <div class="nn-wrap">
          <h1>Not found</h1>
        </div>
      </header>
      <div class="nn-wrap results-body">
        <p class="nn-card">There is nothing at this address.</p>
      </div>
    </main>`,
    404,
    'private',
    null,
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
    ? html`<p class="nn-card results-banner">
        These results are not published, and this race is still being timed. This page is
        visible only to people the club has given permission to read them, and the times
        on it are provisional until the race director confirms them.
      </p>`
    : html`<p class="nn-card results-banner">
        These results are not published. The race has been called finished, and nobody has
        published its results yet. This page is visible only to people the club has given
        permission to read them, and the times on it are provisional until the race
        director confirms them.
      </p>`;
}

/**
 * The race photos are out — brief slice 4, decision 5 of its plan.
 *
 * ⚠️ **Shown only once the photos are published and the runners' links have gone** —
 * `photos.photos_ready()` — so it can never send somebody looking for a link that has not been
 * sent. The words are the brief's own draft subject line, **for Kayleigh's sign-off**; slice 5
 * adds the way to ask for a lost link, which is where this will point.
 */
function photosBanner(): Html {
  return html`<p class="nn-card results-photos">
    Your Nightingale Nightmare photos are ready
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
    return withCookies(notFound(), setCookies);
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
    return withCookies(notFound(), setCookies);
  }

  if (data === null) {
    return withCookies(notFound(), setCookies);
  }

  const payload = data as unknown as ResultsPayload;
  const published = payload.event.results_published_at !== null;

  // See the header: a response that sets a cookie may not be stored by a shared cache, whatever
  // the race's state. `setCookies` is empty on nearly every request, and always on one that
  // arrived without a cookie at all.
  const visibility: Visibility =
    published && setCookies.length === 0 ? 'public' : 'private';

  // Only a published race can say its photos are out, and only once they are.
  const photosReady = published
    ? await fetchPhotosReady(createAnonClient(cfg), slug)
    : false;

  // **The hero is `/nn/<year>/`'s**: the race's name in the display face and the day it was run
  // in the dateline's gold, both from the running's own row rather than from `race.json`, so a
  // later year's results never borrow this year's date.
  const body = html`<main class="results-page" id="main">
    <header class="nn-hero">
      <div class="nn-wrap">
        <h1>${payload.event.name} results</h1>
        <p class="nn-dateline">${formatLondonDate(payload.event.start_at)}</p>
      </div>
    </header>
    <div class="nn-wrap results-body">
      ${previewBanner(payload.event)} ${photosReady ? photosBanner() : null}
      ${resultsTable(payload)}
    </div>
  </main>`;

  // `nnEventSlugForResultsPath` only ever answers an `nn-<year>` slug, so this is never null in
  // practice — and if it were, the frame would simply draw no button and no race block.
  const yearPath = nnYearPathForEventSlug(slug);
  const running: Running | null =
    yearPath === null ? null : { name: payload.event.name, yearPath };

  return withCookies(
    page(`${payload.event.name} results`, body, 200, visibility, running),
    setCookies,
  );
}

// ===========================================================================================
// One runner's time, for their race photos page
// ===========================================================================================

/**
 * One bib's finish time, as this page prints it — or `null`.
 *
 * **For the runner's private photos page** (`nn-photos.ts`, brief slice 4), which shows the bib
 * and its time beside the photos. It reads the same `results_for_event()` this page does, as
 * `anon`, so it answers only for a race whose results are **published** and discloses nothing
 * the public table does not; and it builds the results the same way, so the two pages cannot
 * print different times for one runner.
 *
 * **Solo only, and a runner's leg-1 bib only.** A relay pair's time is not one runner's. ⚠️ **A
 * guide's own number is not looked up here, though the results table shows their time since
 * ADR-073** — giving it to a guide's photos page is a separate change nobody has asked for yet,
 * and until then that page shows their photos with no time rather than a different one. Every
 * failure is `null`: the photos page reads fine without a time, and a time that might be wrong
 * is worse than none.
 */
export async function finishTimeForBib(
  env: NnResultsEnv,
  eventSlug: string,
  bib: string,
): Promise<string | null> {
  try {
    const { data, error } = await createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    })
      .schema('timing')
      .rpc('results_for_event', { p_event_slug: eventSlug });

    if (error || data === null) {
      return null;
    }

    const payload = data as unknown as ResultsPayload;

    if (payload.event.results_published_at === null || payload.event.format !== 'solo') {
      return null;
    }

    const team = payload.teams.find(
      (candidate) =>
        effectiveBib(candidate, 1, 'solo') === bib &&
        candidate.runners[0]?.role !== 'guide',
    );

    if (team === undefined) {
      return null;
    }

    const result = buildResults(payload.event, payload.teams, payload.crossings).find(
      (candidate) => candidate.team.id === team.id,
    );

    return result?.status === 'finished' ? formatDuration(result.totalMs) : null;
  } catch (cause) {
    console.error(
      `timing: results read for a finish time threw — ${
        cause instanceof Error ? cause.name : 'unknown'
      }`,
    );
    return null;
  }
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
