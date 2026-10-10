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
import { bibTakenBy, rosterOutcomeFor } from '../../../../lib/roster-outcomes';
import { AddPanel, EditPanel } from './panels';
import { PrintButton } from './print-button';

export const generateMetadata = raceMetadata('Roster');

/**
 * `/timing/events/<slug>/roster` — the registration desk's list. ADR-056 and its admin half.
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
 * **Admins also change it.** An **Edit** link on each row (`?edit=<runner>`) opens a panel to
 * correct the name and bib and, for somebody holding `timing.event.manage`, set DNS / DNF / DQ;
 * **Add runner** (`?add=1`) takes an on-the-day entry. Both post to `roster/update`, behind
 * `timing.registration.import`. A marshal sees neither, and is refused at that door anyway.
 * `panels.tsx` carries why they are panels rather than a scripted modal.
 */
export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const MANAGE = 'timing.event.manage';
const IMPORT = 'timing.registration.import';

/** A search that found nobody, as a name: one word is a surname, more is first then last. */
function prefillFrom(query: string): { firstname: string; lastname: string } {
  const words = query
    .trim()
    .split(/\s+/u)
    .filter((w) => w !== '' && !/^\d+$/u.test(w));
  if (words.length === 0) return { firstname: '', lastname: '' };
  if (words.length === 1) return { firstname: '', lastname: words[0] ?? '' };
  return { firstname: words.slice(0, -1).join(' '), lastname: words.at(-1) ?? '' };
}

/** The next unused bib: one more than the highest numeric bib on the race. */
function nextBibOf(bibs: readonly (string | null)[]): string {
  const numbers = bibs
    .filter((b): b is string => b !== null && /^\d+$/u.test(b))
    .map(Number);
  return String((numbers.length === 0 ? 0 : Math.max(...numbers)) + 1);
}

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
  const sort = sortFrom(one(query.sort));
  const dir = dirFrom(one(query.dir));
  const editing = one(query.edit);
  const adding = one(query.add) === '1';
  const savedId = one(query.saved);
  const addedTeam = one(query.added_team);

  const permissions = await readPermissions();
  const mayManage = permissions.includes(MANAGE);
  const mayEdit = permissions.includes(IMPORT);

  const read = await readTiming<DeskRoster>('desk_roster', { p_event_slug: slug });

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
  const action = `${base}/update`;
  const back = search === '' ? base : `${base}?q=${encodeURIComponent(search)}`;
  const editRunner = mayEdit ? runners.find((r) => r.runner_id === editing) : undefined;

  // What just happened, named from the roster rather than from the address (no name in a URL).
  const outcome = rosterOutcomeFor(outcomeCode);
  const holder = runners.find((r) => r.runner_id === one(query.holder));
  const takenBib = one(query.bib);
  const added = runners.find((r) => r.team_id === addedTeam);
  const message =
    outcomeCode === 'bib_taken' && holder !== undefined && takenBib !== undefined
      ? bibTakenBy(takenBib, holder)
      : outcomeCode === 'added' && added !== undefined
        ? `Added ${added.firstname} ${added.lastname} · Bib ${added.bib ?? '—'}.`
        : (outcome?.message ?? null);
  const highlightId = savedId ?? added?.runner_id;

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
              {mayEdit
                ? 'Search by name or bib. Edit a row to fix a name or bib, or to mark a runner as not started, not finished or disqualified.'
                : 'Search by name or bib to look a runner up. This list is read-only.'}
            </p>
          }
          status={{
            count: `Showing ${rows.length} of ${runners.length}${dns === 0 ? '' : ` · ${dns} DNS`}`,
            refresh: base,
          }}
        />

        {message === null ? null : (
          <p
            className={
              outcome?.tone === 'bad' && outcomeCode !== 'added'
                ? 'club-notice timing-notice-bad'
                : 'club-notice'
            }
            role="status"
          >
            {message}
          </p>
        )}

        {editRunner === undefined ? null : (
          <EditPanel
            action={action}
            cancel={back}
            runner={editRunner}
            query={search}
            mayMark={mayManage}
          />
        )}

        {mayEdit && adding ? (
          <AddPanel
            action={action}
            cancel={back}
            nextBib={nextBibOf(runners.map((r) => r.bib))}
            prefill={prefillFrom(search)}
          />
        ) : null}

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
          {mayEdit ? (
            <a
              className="club-btn club-btn-secondary timing-roster-tool"
              href={`${base}?add=1`}
            >
              Add runner
            </a>
          ) : null}
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
                {mayEdit ? (
                  <th scope="col" className="timing-roster-actions">
                    <span className="timing-visually-hidden">Edit</span>
                  </th>
                ) : null}
                <th scope="col" className="timing-print-only timing-roster-collected">
                  Collected ✓
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={mayEdit ? 5 : 4} className="timing-roster-empty">
                    {runners.length === 0
                      ? mayEdit
                        ? 'No runners yet. Import entries on the Registrations page, or add a runner.'
                        : 'No runners yet. Ask the race director to import entries.'
                      : `No runners match “${search.trim()}”.`}
                    {mayEdit && runners.length > 0 ? (
                      <>
                        {' '}
                        <a
                          className="club-btn club-btn-secondary"
                          href={`${base}?add=1&q=${encodeURIComponent(search.trim())}`}
                        >
                          Add runner
                        </a>
                      </>
                    ) : null}
                  </td>
                </tr>
              ) : (
                rows.map((runner) => {
                  const status = runner.race_status ?? 'normal';
                  const highlight =
                    single ||
                    isExactBib(runner, search) ||
                    runner.runner_id === highlightId;
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
                      {mayEdit ? (
                        <td className="timing-roster-actions">
                          <a
                            className="club-btn club-btn-secondary timing-roster-edit"
                            href={`${base}?${new URLSearchParams({
                              ...(search === '' ? {} : { q: search }),
                              edit: runner.runner_id,
                            }).toString()}`}
                            aria-label={`Edit ${runner.firstname} ${runner.lastname}`}
                          >
                            Edit
                          </a>
                        </td>
                      ) : null}
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
      </div>
    </RaceFrame>
  );
}
