import Link from 'next/link';
import type { TimingRunner } from '@src/shared/timing/rows';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import type { ResultsPreview } from '../../../../lib/results-preview';
// `prizeChoicesFrom` is `results/page.tsx`'s now — the page parses the query string once and
// hands the result to both views, so the presenter cannot read a different set of pass-overs
// than the page it is rendered inside.
import {
  drawablePool,
  resolvePrizeAwards,
  type PrizeChoices,
} from '../../../../lib/prizes';

/**
 * `/timing/events/<slug>/prizes/` — the list, in the order it is read out.
 *
 * Issue [#205](https://github.com/southville-running-club/src-website/issues/205). Behind
 * `timing.result.publish`, the same permission as the results preview beside it — a club that
 * lets somebody put the table on the internet is not withholding the order the same table is
 * read out in. `lib/access.ts` maps it; this page checks nothing.
 *
 * ## ⚠️ Every decision lives in the address, and that is the whole point of the screen
 *
 * #205 names the defect this replaces: *"the old 'pass to next' exclusions were component state
 * and a refresh lost them mid-ceremony."* A prize giving is twenty minutes in a loud room with
 * somebody's phone in one hand, and a screen that forgets which four teams have gone home is a
 * screen that makes you start again with a microphone in the other. So **pass to next** and
 * **the two spot draws** are both query parameters: they survive a reload, they can be sent to
 * whoever is holding the other phone, and the back button undoes the wrong one.
 *
 * `lib/prizes.ts` carries the argument for a URL over a row, and for why a draw has to be taken
 * rather than rolled at render time.
 *
 * ## ⚠️ Passing a team affects every prize, which is what somebody means by it
 *
 * `computeAwards()` applies the exclusion *"uniformly to every award"* — so passing the winner
 * of 1st Overall promotes second to first and third to second, and the fastest-leg awards
 * recompute around them. That is what *"they are not here"* means; an exclusion that only
 * skipped one line would leave the same people winning everything else.
 *
 * ## No JavaScript, on purpose
 *
 * Every link here is a plain link and the export is a plain form. The old application's
 * presenter was a client component; this one works on a phone with a bad signal and a browser
 * that has given up on scripts, which is the state a phone is in at the end of a race.
 */
export const dynamic = 'force-dynamic';

function nameOf(runner: TimingRunner): string {
  return `${runner.firstname} ${runner.lastname}`.trim();
}

function teamNames(runners: readonly TimingRunner[]): string {
  return runners
    .slice()
    .sort((a, b) => a.leg - b.leg)
    .map(nameOf)
    .filter((name) => name !== '')
    .join(' & ');
}

/**
 * The address this page is at, with one parameter added.
 *
 * ⚠️ **A `{ pathname, query }` object rather than a string with a `?` in it.** `next.config.ts`
 * sets `typedRoutes: true`, which checks a `<Link href>` against the union of the app's routes —
 * and a template literal carrying a query string matches none of them, so a perfectly correct
 * link is a build error. The object form keeps the pathname checkable and lets Next build the
 * query, which is also what encodes a team id without this file reaching for `URLSearchParams`.
 */
function withParam(
  slug: string,
  choices: PrizeChoices,
  extra: { pass?: string; draw?: { kind: string; team: string } },
): { pathname: `/events/${string}/results`; query: Record<string, string | string[]> } {
  const passed = [...choices.passed];
  if (extra.pass !== undefined) passed.push(extra.pass);

  const query: Record<string, string | string[]> = {};
  if (passed.length > 0) query.pass = passed;

  for (const [kind, id] of choices.draws) query[kind] = id;
  if (extra.draw !== undefined) query[extra.draw.kind] = extra.draw.team;

  // ⚠️ **`/results`, not `/prizes`, and this is load-bearing rather than tidying.** #308 made
  // the presenter a section of the results page and left `/prizes` as a redirect. A link built
  // to the old address would still *work* — and would lose every pass-over on the way, because
  // the redirect's destination carries a fragment and the query does not survive it. The
  // presenter's whole reason for keeping its state in the URL is that the old application lost
  // it mid-ceremony on a refresh; routing these links through a redirect would reintroduce
  // exactly that, one prize at a time.
  return { pathname: `/events/${slug}/results`, query };
}

function Prize({
  award,
  slug,
  choices,
}: {
  award: PrizeAward;
  slug: string;
  choices: PrizeChoices;
}) {
  const winner = award.winner;

  // The pool a spot prize may still be drawn from, minus whatever the other draw already took.
  const pool = drawablePool(award, choices);
  // ⚠️ **Offered at render time so that taking it fixes it.** Refreshing offers a different
  // team; the link is what makes a choice, and the address is what remembers it.
  const offer =
    pool.length === 0 ? undefined : pool[Math.floor(Math.random() * pool.length)];

  return (
    <li className="triage-card">
      <p className="triage-time">
        <strong>{award.title}</strong>
      </p>
      <p className="triage-reason">{award.subtitle}</p>

      {winner === null ? (
        <p className="triage-reason">
          {offer === undefined ? (
            <em>Nobody has won this.</em>
          ) : (
            <>
              <em>Not drawn yet.</em>{' '}
              <Link
                href={withParam(slug, choices, {
                  draw: { kind: award.kind, team: offer.id },
                })}
              >
                Draw {teamNames(offer.runners) || 'a team'}
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          <p className="triage-reason">
            <strong>
              {winner.type === 'runner'
                ? nameOf(winner.runner)
                : teamNames(winner.team.runners)}
            </strong>
            {winner.metricLabel === '' ? null : ` — ${winner.metricLabel}`}
          </p>
          <p className="triage-actions">
            {/* ⚠️ Reads "not here to claim" rather than "pass", because what it does is exclude
                the team from **every** award and the word has to say more than the button did in
                the application this replaces. */}
            <Link
              className="button button-quiet"
              href={withParam(slug, choices, { pass: winner.team.id })}
            >
              Not here — pass to the next
            </Link>
          </p>
        </>
      )}
    </li>
  );
}

/**
 * The **Prize giving** section of `/timing/events/<slug>/results`.
 *
 * ⚠️ **Its own address until [#308](https://github.com/southville-running-club/src-website/issues/308)**,
 * which merged it onto the results page. `lib/access.ts`'s row for `prizes` said the argument
 * for the merge before the merge existed: the prize list is *"the published results read a
 * second way"*, one dataset and one permission. **`prizes/export` did not move** and still
 * carries `timing.result.publish` of its own.
 *
 * ## ⚠️ The read moved out and the choices did not
 *
 * `results/page.tsx` does the one `readResultsPreview()` for both views, so the two cannot
 * disagree about a time. **The pass-overs and spot draws still live in the URL** — `?pass=` and
 * the draw parameters, parsed by `prizeChoicesFrom()` — because the old application held them in
 * component state and a refresh lost them mid-ceremony. They share a query string with the
 * results view now and collide with nothing in it: that view reads `?outcome=` and nothing else.
 */
export function PrizesSection({
  slug,
  payload,
  choices,
}: {
  slug: string;
  payload: ResultsPreview;
  choices: PrizeChoices;
}) {
  const awards = resolvePrizeAwards(payload, choices);
  const exportAction = `/timing/events/${encodeURIComponent(slug)}/prizes/export`;

  return (
    <>
      {choices.passed.size > 0 ? (
        <p className="notice notice-ok">
          {choices.passed.size === 1
            ? '1 team has been passed over and is out of every prize below.'
            : `${choices.passed.size} teams have been passed over and are out of every prize below.`}{' '}
          <Link href={`/events/${slug}/results`}>Start again</Link> puts them all back.
        </p>
      ) : null}

      {payload.open_anomalies > 0 ? (
        <p className="notice notice-bad">
          Some captures on this race are still to be resolved, so a time below may change.{' '}
          <Link href={`/events/${slug}/console#anomalies`}>Resolve them</Link> before
          reading these out.
        </p>
      ) : null}

      <ul className="triage">
        {awards.map((award) => (
          <Prize key={award.kind} award={award} slug={slug} choices={choices} />
        ))}
      </ul>

      <h3>Files</h3>

      {/* ⚠️ **The exclusions and the draws travel with the file.** Every choice made above is a
          hidden field here, so the export resolves the same awards this page is showing — which
          is #205's rule that the published table cannot disagree with what was announced. */}
      <form method="post" action={exportAction}>
        {[...choices.passed].map((id) => (
          <input key={id} type="hidden" name="pass" value={id} />
        ))}
        {[...choices.draws].map(([kind, id]) => (
          <input key={kind} type="hidden" name={kind} value={id} />
        ))}
        <p>
          <button type="submit" name="format" value="csv" className="button">
            Prizes as CSV
          </button>{' '}
          <button
            type="submit"
            name="format"
            value="xlsx"
            className="button button-quiet"
          >
            Prizes as a spreadsheet
          </button>
        </p>
      </form>

      <p>
        <Link href={`/events/${slug}/results`}>Results</Link>
        {' · '}
        <Link href={`/events/${slug}`}>Back to this race</Link>
      </p>
    </>
  );
}
