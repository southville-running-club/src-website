import Link from 'next/link';
import { formatLondon } from '@src/shared';
import '@src/shared/styles/nn-results.css';
import { effectiveBib } from '@src/shared/timing/bib';
import {
  buildResults,
  formatDuration,
  sortResults,
  type Result,
  type ResultStatus,
} from '@src/shared/timing/results';
import { isGuide, resultCategoryLabel } from '@src/shared/timing/result-category';
import type { TimingEvent, TimingRunner } from '@src/shared/timing/rows';
import { NotFoundBody } from '../../../not-found-body';
import {
  readResultsPreview,
  type PreviewTeam,
  type ResultsPreview,
} from '../../../../lib/results-preview';
import {
  LIFECYCLE_WORDS,
  lifecycleStateFor,
  resultsOutcomeFor,
} from '../../../../lib/results-outcomes';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead, raceEyebrow } from '../../../chrome/page-head';
import { raceMetadata } from '../../../../lib/titles';

export const generateMetadata = raceMetadata('Results');

/**
 * `/timing/events/<slug>/results/` — what somebody reads **before** they publish.
 *
 * Issue [#205](https://github.com/southville-running-club/src-website/issues/205), rung 4 of
 * [#257](https://github.com/southville-running-club/src-website/issues/257). Behind
 * `timing.result.publish`; `lib/access.ts` maps it and `middleware.ts` enforces it — this page
 * does not check, and `app/page.tsx`'s header says why a page here provably cannot.
 *
 * ## ⚠️ This reads `results_preview()` and not `results_for_event()`, and the reason is not
 * tidiness
 *
 * `identity-permissions.test.ts` says in as many words that `timing-admin` deliberately does
 * **not** hold `nn.results.read` — *"running a race and seeing its results before they are
 * public are different powers"*. `results_for_event()` consults exactly that permission before
 * publication, so it answers `null` to the person this screen is for: they would see an empty
 * page and a button offering to publish it. `20260914140000`'s header carries the whole finding.
 *
 * The preview answer also carries `runners.role` and `runners.result_placement`, which the
 * public one may never carry — a guide's role discloses their runner's disability by inference
 * (ADR-022), and a placement is
 * [ADR-031](../../../../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
 * raw answer rather than the category derived from it. Both are needed to get a category and a
 * prize list right, and neither is needed to read one.
 *
 * ## The three states, named rather than inferred
 *
 * #241's state machine is two nullable timestamps, and a volunteer should not have to add them
 * up. `lifecycleStateFor()` turns them into **capturing**, **finished** or **published**, and
 * `LIFECYCLE_WORDS` says what each means for who can see this table. The page is the same table
 * in all three; what changes is the sentence above it and which button is under it.
 *
 * ## ⚠️ The open-anomaly count is what will refuse the publish button, and it is shown before
 * the press
 *
 * `publish_results()` refuses `open_anomalies`, and until this page the only way to find that
 * out was to press it. The count comes back in the same read as the table — from
 * `open_anomaly_count()`, the one statement of that predicate — so the number on the button and
 * the number in the refusal are the same expression rather than two that agree today.
 *
 * ## Why the table looks like `/nn/<year>/results/`
 *
 * It imports the **same stylesheet**, deliberately. A preview whose job is *"is this what the
 * club should publish"* is worth less the less it resembles what will be published; two
 * stylesheets would be two things to keep in step for the sake of a staff page looking
 * different from the page it is a preview of.
 *
 * ⚠️ **The columns are not identical, and the extra ones are preview-only by construction.**
 * "Being checked" can only ever be non-empty before publication, because publication is refused
 * while an anomaly is open — so a published race renders the same information the public sees,
 * and the difference disappears exactly when it should.
 */
export const dynamic = 'force-dynamic';

/** Words for a row that has no time, so a blank cell never has to be interpreted. */
function statusWords(status: ResultStatus, format: TimingEvent['format']): string {
  switch (status) {
    case 'finished':
      return 'Finished';
    case 'pending':
      return 'On course';
    case 'leg1':
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
 * The Category cell.
 *
 * ⚠️ **A guide is named as one rather than left blank.** `resultCategoryLabel()` answers `null`
 * for a guide, which is right — they are in no category and no prize (ADR-022) — but a blank
 * cell on a preview reads as *the club has not worked out their band yet*, and a volunteer
 * would go looking. Saying "Guide" is the fact, and it is a fact this screen may show and the
 * published page may not.
 */
function categoryCell(
  team: PreviewTeam | undefined,
  format: TimingEvent['format'],
): string {
  const runners = team?.runners ?? [];
  if (runners.length > 0 && runners.every(isGuide)) return 'Guide';

  return resultCategoryLabel(runners, format, team?.category ?? null) ?? '—';
}

function ResultRow({
  result,
  team,
  format,
  position,
}: {
  result: Result;
  team: PreviewTeam | undefined;
  format: TimingEvent['format'];
  position: number | null;
}) {
  const runners = team?.runners ?? [];
  const who =
    format === 'solo'
      ? runnerName(runners[0])
      : runners.length === 0
        ? 'No runner recorded'
        : runners.map(runnerName).join(' & ');

  // A solo entry has one bib and a relay pair has two, so the column says so rather than
  // picking one. `effectiveBib` resolves an override the desk wrote over the derived number.
  const bib =
    team === undefined
      ? null
      : format === 'solo'
        ? effectiveBib(team, 1, format)
        : [effectiveBib(team, 1, format), effectiveBib(team, 2, format)]
            .filter((one): one is string => one !== null)
            .join(' / ') || null;

  return (
    <tr>
      <td className="results-num">{position === null ? '—' : String(position)}</td>
      <td className="results-num">{bib ?? '—'}</td>
      <td className="results-name">{team?.name ? `${who} (${team.name})` : who}</td>
      <td>{categoryCell(team, format)}</td>
      <td className="results-num">{formatDuration(result.totalMs)}</td>
      <td className="results-status">
        {statusWords(result.status, format)}
        {result.hasOpenAnomaly ? (
          <span className="results-suspect"> — being checked</span>
        ) : null}
      </td>
    </tr>
  );
}

function PreviewTable({ payload }: { payload: ResultsPreview }) {
  const results = sortResults(
    buildResults(payload.event, payload.teams, payload.crossings),
    'total',
  );

  if (results.length === 0) {
    return <p className="results-empty">Nothing has been captured for this race yet.</p>;
  }

  const byId = new Map(payload.teams.map((team) => [team.id, team]));

  // **Position counts finished rows in the order `sortResults` put them in** — the identical
  // rule `/nn/<year>/results/` and `buildExportRows()` use, so the preview, the published page
  // and the file cannot disagree about who came third.
  let finished = 0;

  return (
    // ⚠️ **A scrollable region has to be reachable by keyboard, and this table holds nothing
    // focusable.** axe's `scrollable-region-focusable` is satisfied either by the region being
    // focusable itself or by it *containing* something focusable; a results table is all text,
    // so it is neither, and somebody navigating by keyboard at 375px could not scroll it at
    // all. **Only mobile-safari sees it**, because the table does not overflow at desktop width
    // and a region that does not scroll is not a scrollable region.
    //
    // `admin-people.ts` carries the original note and `nn-results.ts` the second instance —
    // this is the third, and all three are the same three attributes.
    <div
      className="results-scroll"
      tabIndex={0}
      role="region"
      aria-labelledby="results-table-caption"
    >
      <table className="results-table">
        <caption className="results-meta" id="results-table-caption">
          {results.length} entries
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
          {results.map((result) => {
            const placed = result.status === 'finished';
            if (placed) finished += 1;
            return (
              <ResultRow
                key={result.team.id}
                result={result}
                team={byId.get(result.team.id)}
                format={payload.event.format}
                position={placed ? finished : null}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "12 finishers · + 3 DNS / DNF / DQ" — Pass the Buck's results count. */
function resultsCount(payload: ResultsPreview): string {
  // The same `buildResults()` the table below is drawn from, so the count cannot disagree
  // with the rows.
  const results = buildResults(payload.event, payload.teams, payload.crossings);
  const finishers = results.filter((result) => result.status === 'finished').length;
  const statuses = results.filter((result) =>
    ['dns', 'dnf', 'dq'].includes(result.status),
  ).length;
  return `${finishers} ${finishers === 1 ? 'finisher' : 'finishers'}${
    statuses === 0 ? '' : ` · + ${statuses} DNS / DNF / DQ`
  }`;
}

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  const outcomeParam = query.outcome;
  const outcome = resultsOutcomeFor(
    typeof outcomeParam === 'string' ? outcomeParam : undefined,
  );

  const read = await readResultsPreview(slug);

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage** — `lib/reads.ts`' header. On this page the second
    // sentence matters: nothing has been published, and somebody who could not tell the two
    // apart might press again.
    return (
      <RaceFrame slug={slug} name={null} current="results" page="Results">
        <>
          <h1>Results</h1>
          <p className="notice notice-bad">
            The club&rsquo;s database could not be reached, so this race could not be
            read. Nothing has been changed, and nothing has been published. Try again in a
            moment.
          </p>
        </>
      </RaceFrame>
    );
  }

  if (read.state === 'none') {
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const payload = read.data;
  const state = lifecycleStateFor(payload.event);
  const words = LIFECYCLE_WORDS[state];
  const action = `/timing/events/${encodeURIComponent(slug)}/results/update`;
  const exportAction = `/timing/events/${encodeURIComponent(slug)}/results/export`;
  const open = payload.open_anomalies;
  // Which of the notices below say why publishing would be refused, by id.
  const blockers = [
    ...(payload.event.finished_at === null ? ['publish-not-finished'] : []),
    ...(open > 0 ? ['publish-open-anomalies'] : []),
  ];

  return (
    <RaceFrame
      slug={slug}
      name={payload.event.name}
      current="results"
      page="Results"
      wide
    >
      <div>
        <PageHead
          eyebrow={raceEyebrow(payload.event.name)}
          title="Results."
          intro={
            <p>
              A preview of the results file. Runners marked as being checked are flagged,
              and anybody who did not start, did not finish or was disqualified sits at
              the foot with a status and no position or time. Publish it when the race is
              finished and every capture is resolved.
            </p>
          }
          status={{
            count: resultsCount(payload),
            refresh: `/timing/events/${encodeURIComponent(slug)}/results`,
          }}
        />

        {outcome === null ? null : (
          <p
            className={
              outcome.tone === 'ok' ? 'club-notice' : 'club-notice timing-notice-bad'
            }
          >
            {outcome.message}
          </p>
        )}

        <dl className="club-meta timing-details">
          <div>
            <dt>State</dt>
            <dd>{words.label}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>
              {payload.event.finished_at === null
                ? 'Not finished'
                : formatLondon(payload.event.finished_at)}
            </dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>
              {payload.event.results_published_at === null
                ? 'Not published'
                : formatLondon(payload.event.results_published_at)}
            </dd>
          </div>
          <div>
            <dt>Open captures</dt>
            <dd>{open}</dd>
          </div>
        </dl>

        <p>{words.detail}</p>

        <PreviewTable payload={payload} />

        <section className="club-card timing-job" aria-labelledby="results-files">
          <h2 id="results-files">Files</h2>

          {/* ⚠️ **A POST rather than a link**, like every other write-shaped thing here: a plain
          `<form method="post">` answered by a route handler is HTML that cannot fail with
          scripting off, which is the property the whole `no-javascript` project exists to keep.
          Downloading is not a write, and the two presses are two buttons in one form rather
          than two forms, because they ask for the same rows in two shapes. */}
          <form method="post" action={exportAction}>
            <p className="club-btns">
              <button
                type="submit"
                name="format"
                value="csv"
                className="club-btn club-btn-primary"
              >
                Results as CSV
              </button>
              <button
                type="submit"
                name="format"
                value="xlsx"
                className="club-btn club-btn-secondary"
              >
                Results as a spreadsheet
              </button>
            </p>
          </form>

          <p>
            A spreadsheet keeps a bib of <code>0311</code> as <code>0311</code>; a CSV
            opened in Excel becomes <code>311</code>. Use the spreadsheet if the numbers
            matter, and the CSV if something else is going to read the file.
          </p>
        </section>

        <section className="club-card timing-job" aria-labelledby="results-publish">
          <h2 id="results-publish">
            {state === 'published' ? 'Take these results down' : 'Publish these results'}
          </h2>

          {state === 'published' ? (
            <>
              <p className="club-notice">
                These results are public. A correction is{' '}
                <strong>unpublish, fix, publish</strong> — the results page goes back to
                not found in between, rather than serving a table somebody is editing.
              </p>

              <form method="post" action={action}>
                <input type="hidden" name="intent" value="unpublish" />
                <button type="submit" className="club-btn club-btn-secondary">
                  Unpublish these results
                </button>
              </form>
            </>
          ) : (
            <>
              {payload.event.finished_at === null ? (
                <p className="club-notice timing-notice-bad" id="publish-not-finished">
                  This race has not been marked finished, so its results cannot be
                  published yet. Finishing and publishing are two separate decisions.{' '}
                  <Link href={`/events/${slug}/start#finish`}>Finish this race</Link>{' '}
                  first.
                </p>
              ) : null}

              {open > 0 ? (
                <p className="club-notice timing-notice-bad" id="publish-open-anomalies">
                  {open === 1
                    ? 'There is 1 capture still to be resolved'
                    : `There are ${open} captures still to be resolved`}
                  , so these results cannot be published.{' '}
                  <Link href={`/events/${slug}/anomalies`}>Resolve them</Link> first.
                </p>
              ) : null}

              {/*
              ⚠️ **Disabled whenever `publish_results()` would refuse**, with the reasons above
              named as its description — brief §6.2 #6: a blocked action no longer looks
              pressable. The two conditions are the function's own `not_finished` and
              `open_anomalies`, read off the same payload the notices above render from, so the
              page and the refusal cannot disagree about why. **Rendered disabled on the server**,
              with or without scripting: unlike the wipe's typed phrase, there is nothing here
              to wait for. The function still refuses a POST that never saw this page.
            */}
              <form method="post" action={action}>
                <input type="hidden" name="intent" value="publish" />
                <button
                  type="submit"
                  className="club-btn club-btn-primary"
                  disabled={blockers.length > 0}
                  aria-describedby={blockers.length > 0 ? blockers.join(' ') : undefined}
                >
                  Publish these results
                </button>
              </form>

              {/* The sentence that stops somebody pressing this to see what it does. */}
              <p>
                Publishing puts this table on the <strong>open internet</strong>, readable
                by anybody signed in or not. It can be undone here, and a correction is
                unpublish, fix, publish.
              </p>
            </>
          )}
        </section>
      </div>
    </RaceFrame>
  );
}
