import { formatLondonClock } from '@src/shared';
import { readPermissions, readTiming } from '../../../../lib/reads';
import { raceMetadata } from '../../../../lib/titles';
import {
  categoryFor,
  dirFrom,
  isExactBib,
  searchRoster,
  sortFrom,
  sortRoster,
  STATUS_LABEL,
  type DeskRoster,
  type SortDir,
  type SortKey,
} from '../../../../lib/desk-roster';
import { NotFoundBody } from '../../../not-found-body';
import { PlainFrame, RaceFrame } from '../../../chrome/frames';
import { PageHead } from '../../../chrome/page-head';
import { RaceUnavailable } from '../../../chrome/race-unavailable';
import { StatusSection, type StatusTeam } from '../sections/status';
import { PrintButton } from './print-button';

export const generateMetadata = raceMetadata('Roster');

/**
 * `/timing/events/<slug>/roster` — the registration desk's list. ADR-056.
 *
 * One row per runner — **Name, Status, Category, Bib** — readable by the race's **marshals**,
 * who look runners up and change nothing, and by admins. Behind `timing.roster.read`;
 * `desk_roster()` narrows a marshal to the races they are rostered on and answers `null`
 * otherwise, which renders the ordinary not-found page.
 *
 * - **Search** is a GET form, so it works with scripting off and a searched view is a URL. It
 *   is case-, accent- and order-insensitive across the name and the bib, an exact bib comes
 *   first, and a single match is highlighted so the bib can be read across a desk.
 * - **Sort** is the column headers, as links carrying `?sort=` and `?dir=`, with `aria-sort`.
 *   Surname by default.
 * - **Print** is the paper sheet bib collection is ticked off on: the print stylesheet hides
 *   everything but the heading and the table, and adds a Collected ✓ column.
 *
 * **Admins also mark DNS, DNF and DQ here**, in the list below the table, which is the race
 * status block the race console used to carry. A marshal never sees it.
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const MANAGE = 'timing.event.manage';

const COLUMNS: readonly { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'category', label: 'Category' },
  { key: 'bib', label: 'Bib' },
];

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const outcomeCode = one(query.outcome);
  const search = one(query.q) ?? '';
  const statusSearch = one(query.status_q) ?? '';
  const sort = sortFrom(one(query.sort));
  const dir = dirFrom(one(query.dir));

  const permissions = await readPermissions();
  const mayManage = permissions.includes(MANAGE);

  const [read, statusRead] = await Promise.all([
    readTiming<DeskRoster>('desk_roster', { p_event_slug: slug }),
    mayManage
      ? readTiming<StatusTeam[]>('team_status_list', {
          p_event_slug: slug,
          p_search: statusSearch === '' ? null : statusSearch,
        })
      : null,
  ]);

  if (read.state === 'unavailable') {
    return <RaceUnavailable slug={slug} current="roster" title="Roster." />;
  }

  if (read.state === 'none') {
    return (
      <PlainFrame>
        <NotFoundBody />
      </PlainFrame>
    );
  }

  const { event, runners } = read.data;
  const base = `/timing/events/${encodeURIComponent(slug)}/roster`;
  const found = searchRoster(runners, search);
  // A search keeps its own order — an exact bib first — and is otherwise sorted as asked.
  const rows = search.trim() === '' ? sortRoster(found, sort, dir) : found;
  const dns = runners.filter((r) => r.race_status === 'dns').length;
  const single = rows.length === 1;

  /** The address a header links to: this column, the other way round if it is already on. */
  const sortHref = (key: SortKey): string => {
    const next: SortDir = key === sort && dir === 'asc' ? 'desc' : 'asc';
    const params = new URLSearchParams();
    if (search !== '') params.set('q', search);
    params.set('sort', key);
    params.set('dir', next);
    return `${base}?${params.toString()}`;
  };

  return (
    <RaceFrame slug={slug} current="roster" wide>
      <div className="timing-roster">
        <PageHead
          eyebrow={`${mayManage ? 'Admin' : 'Registration desk'} · ${event.name}`}
          title="Roster."
          intro={
            <p>
              {runners.length} {runners.length === 1 ? 'runner' : 'runners'}.{' '}
              {mayManage
                ? 'Search by name or bib. Mark a runner as not started, not finished or disqualified below the list.'
                : 'Search by name or bib to look a runner up. This list is read-only.'}
            </p>
          }
          status={{
            count: `Showing ${rows.length} of ${runners.length}${dns === 0 ? '' : ` · ${dns} DNS`}`,
            refresh: base,
          }}
        />

        <form method="get" action={base} className="timing-roster-toolbar" role="search">
          <label className="timing-visually-hidden" htmlFor="roster-q">
            Search the roster
          </label>
          <input
            className="field-input timing-roster-search"
            id="roster-q"
            name="q"
            type="search"
            placeholder="Search name or bib"
            defaultValue={search}
            autoFocus
            autoComplete="off"
          />
          {sort === 'name' && dir === 'asc' ? null : (
            <>
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
            </>
          )}
          <button type="submit" className="club-btn club-btn-primary timing-roster-tool">
            Search
          </button>
          <PrintButton />
        </form>

        <p className="timing-print-only timing-print-title">
          {event.name} &mdash; roster, printed{' '}
          <span className="timing-mono">{formatLondonClock(new Date())}</span>
        </p>

        <div className="timing-roster-card">
          <table className="timing-roster-table">
            <caption className="timing-visually-hidden">
              Runners on {event.name}, sorted by {sort}
            </caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const current = column.key === sort && search.trim() === '';
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={`timing-roster-${column.key}`}
                      aria-sort={
                        current ? (dir === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      <a href={sortHref(column.key)}>
                        {column.label}
                        <span aria-hidden="true" className="timing-sort-mark">
                          {current ? (dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                        </span>
                      </a>
                    </th>
                  );
                })}
                <th scope="col" className="timing-print-only timing-roster-collected">
                  Collected ✓
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="timing-roster-empty">
                    {runners.length === 0
                      ? mayManage
                        ? 'No runners yet. Import entries on the Registrations page, or add a walk-in there.'
                        : 'No runners yet. Ask the race director to import entries.'
                      : `No runners match “${search.trim()}”.`}
                  </td>
                </tr>
              ) : (
                rows.map((runner) => {
                  const status = runner.race_status ?? 'normal';
                  const highlight = single || isExactBib(runner, search);
                  return (
                    <tr
                      key={runner.runner_id}
                      data-highlight={highlight ? 'yes' : undefined}
                    >
                      <td className="timing-roster-name">
                        <strong>{runner.lastname}</strong>, {runner.firstname}
                      </td>
                      <td className="timing-roster-status">
                        <span className="timing-roster-chip" data-status={status}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="timing-roster-category">{categoryFor(runner)}</td>
                      <td className="timing-roster-bib timing-mono">
                        {runner.bib ?? '—'}
                      </td>
                      <td className="timing-print-only timing-roster-collected">
                        <span className="timing-tick-box" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {mayManage ? (
          <section className="timing-roster-admin" aria-labelledby="mark-a-runner">
            <h2 id="mark-a-runner">Mark a runner</h2>
            {statusRead?.state === 'ok' ? null : (
              <p className="club-notice timing-notice-bad">
                The club&rsquo;s database could not be reached, so this list could not be
                read. Nothing has been changed. Try again in a moment.
              </p>
            )}
            <div id="status">
              <StatusSection
                slug={slug}
                teams={statusRead?.state === 'ok' ? statusRead.data : []}
                search={statusSearch}
                outcomeCode={outcomeCode}
              />
            </div>
          </section>
        ) : null}
      </div>
    </RaceFrame>
  );
}
