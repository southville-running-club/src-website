import Link from 'next/link';
import { formatLondon } from '@src/shared';
import '@src/shared/styles/nn-results.css';
import type { SortKey } from '@src/shared/timing/results';
import { readLeaderboard } from '../../../../lib/leaderboard';
import { LiveBoard } from './live-board';

/**
 * `/timing/events/<slug>/leaderboard/` — the race as it stands, for the people running it.
 *
 * Issue [#204](https://github.com/southville-running-club/src-website/issues/204), rung 3 of
 * [#257](https://github.com/southville-running-club/src-website/issues/257), under
 * [ADR-034](../../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * and [ADR-038](../../../../../../../docs/architecture/decisions/adr-038-the-leaderboard-is-staff-only-in-2026.md).
 *
 * Behind `timing.event.manage` **or** `timing.crossing.resolve`; `lib/access.ts` maps it and
 * `middleware.ts` enforces it — this page does not check, and `app/page.tsx`'s header says why a
 * page here provably cannot.
 *
 * ## ⚠️ Staff only in 2026, and the cost is recorded rather than hidden
 *
 * The old application's `/live/<slug>` was **fully anonymous**, and spectators at Ashton Court
 * watched it on their phones. ADR-038 declines that for this race: a live leaderboard *is*
 * provisional results published continuously, and the club's rule is that nobody outside
 * `nn.results.read` sees a result until somebody publishes. So
 * [C6](../../../../../../../docs/foundations/requirements.md#c6--show-live-race-progress-to-spectators)
 * is **not met in 2026** — the record says so in as many words rather than quietly re-scoping it —
 * and the only public surface for anything about a race stays `/nn/<year>/results/` after
 * publication.
 *
 * **Reversing it is one grant and one policy**, which is why this is the safe way round: opening a
 * board later is cheap, and closing one spectators have already used is not.
 *
 * ## What is on this page and what is not
 *
 * Everything the board shows comes out of `buildLeaderboard()` in
 * `packages/shared/src/timing/leaderboard.ts`, which is pure and knows nothing about Durable
 * Objects. **That is ADR-034's instruction rather than a preference** — the live transport is the
 * slice the race simulation cuts if it fails, and the fallback is Supabase Realtime rather than
 * nothing. `live-board.tsx` is the delivery half; deleting it and reloading by hand would leave
 * this page working.
 *
 * ## ⚠️ The sort order is a query parameter, and it has to be
 *
 * Like `/admin/nn/`'s filters and `/account/entries/`'s two views: it works with scripting off, and
 * a board sorted a particular way is a URL somebody can send to the other volunteer. A control
 * that only worked with JavaScript would be a control the `no-javascript` project cannot reach.
 *
 * **An unrecognised value falls back to total time** rather than being rendered or refused — the
 * rule every `lib/*-outcomes.ts` module here carries: nothing from the query string reaches a
 * screen.
 */
export const dynamic = 'force-dynamic';

/** The orderings the board offers, and the label for each. Total is what a leaderboard means. */
const SORTS: { key: SortKey; label: string; relayOnly?: boolean }[] = [
  { key: 'total', label: 'Total time' },
  { key: 'splitA', label: 'Leg 1', relayOnly: true },
  { key: 'splitB', label: 'Leg 2', relayOnly: true },
  { key: 'category', label: 'Category' },
  { key: 'teamNumber', label: 'Number' },
];

/**
 * The `?sort=` value, or total time.
 *
 * ⚠️ **Nothing from the query string is trusted or echoed.** An unknown value is silently total
 * time, which is the ordering the page means anyway; refusing would turn a mistyped URL into an
 * error page on a race night.
 */
function sortFrom(raw: string | string[] | undefined): SortKey {
  const wanted = typeof raw === 'string' ? raw : undefined;
  return SORTS.some((sort) => sort.key === wanted) ? (wanted as SortKey) : 'total';
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;
  const sort = sortFrom(query.sort);

  const read = await readLeaderboard(slug);

  if (read.state === 'unavailable') {
    // ⚠️ **Never "Not found" for an outage** — `lib/reads.ts`' header. On a race night the cost of
    // getting this wrong is a volunteer concluding the race they set up has been deleted.
    return (
      <>
        <h1>Leaderboard</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this race could not be read.
          Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (read.state === 'none') {
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const payload = read.data;
  const { event } = payload;
  const relay = event.format === 'relay';

  return (
    <>
      <h1>Leaderboard</h1>
      <p>{event.name}</p>

      <dl>
        <dt>Started</dt>
        <dd>
          {event.actually_started_at === null
            ? 'Not started'
            : formatLondon(event.actually_started_at)}
        </dd>
        <dt>Finished</dt>
        <dd>
          {event.finished_at === null ? 'Not finished' : formatLondon(event.finished_at)}
        </dd>
        <dt>Open captures</dt>
        <dd>{payload.open_anomalies}</dd>
      </dl>

      {/* ⚠️ **Plain links rather than a form**, and it is the same decision `/admin/nn/`'s filter
          chips took: a sorted board is a URL somebody can send, and it works with scripting off.
          The two leg orderings are hidden on a solo race because a solo race has no legs — see
          `Leaderboard.columns`. */}
      <p>
        Order by:{' '}
        {SORTS.filter((option) => relay || !option.relayOnly).map((option, index) => (
          <span key={option.key}>
            {index === 0 ? null : ' · '}
            {option.key === sort ? (
              <strong>{option.label}</strong>
            ) : (
              <Link href={`/events/${slug}/leaderboard?sort=${option.key}`}>
                {option.label}
              </Link>
            )}
          </span>
        ))}
      </p>

      <LiveBoard slug={slug} initial={payload} sort={sort} />

      {payload.open_anomalies > 0 ? (
        <p>
          <Link href={`/events/${slug}/anomalies`}>
            {payload.open_anomalies === 1
              ? '1 capture is waiting to be resolved'
              : `${payload.open_anomalies} captures are waiting to be resolved`}
          </Link>
          . A race cannot be published while any of them is open.
        </p>
      ) : null}

      <p>
        <Link href={`/events/${slug}/results`}>Results and publishing</Link>
        {' · '}
        <Link href={`/events/${slug}/crossings`}>Timing log</Link>
        {' · '}
        <Link href={`/events/${slug}`}>Back to this race</Link>
      </p>
    </>
  );
}
