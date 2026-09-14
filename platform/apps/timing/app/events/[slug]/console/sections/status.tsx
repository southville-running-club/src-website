import Link from 'next/link';
import { statusOutcomeFor } from '../../../../../lib/status-outcomes';

/**
 * The **Race status** section of `/timing/events/<slug>/console` — DNS, DNF and DQ, and lifting
 * any of them.
 *
 * Issue [#253](https://github.com/southville-running-club/src-website/issues/253). ⚠️ **Its own
 * address until [#308](https://github.com/southville-running-club/src-website/issues/308)**.
 * `timing.event.manage` is now this *section's* requirement rather than the address's; the form
 * still posts to `status/update`, which still carries it.
 *
 * ## ⚠️ Its search parameter is `status_q` and was `q`
 *
 * The timing log below it searches too, and on one page two controls named `q` are one control
 * wearing two hats: searching for a bib in the log would silently filter this list as well, and
 * the "Show everyone" link would clear both. They are `status_q` and `log_q` now, and
 * `status/update/route.ts` carries the renamed field back so that marking somebody from a
 * filtered list still returns to that list.
 *
 * ## ⚠️ A label on top of crossings, and never a change to one
 *
 * `teamRaceStatus()` and `sortResults()` already read `race_status`: DNS suppresses every
 * derived time, and **DNF and DQ keep leg A**, because a captured fact stays captured. Nothing
 * on this page edits, hides or reorders a crossing, and nothing on it should ever learn to — a
 * crossing is what a marshal saw, and a status is what the club decided afterwards.
 *
 * ## ⚠️ A guide is marked and is still a runner
 *
 * A visually impaired runner's guide is in no category and never in a prize, and a status still
 * applies to them — #253 says so. A page that filtered them out would leave a person on the
 * course nobody could mark, so they are listed with their role beside them.
 *
 * ## Search, because a field of 250 is not a list anybody scrolls
 *
 * By bib or by name, whichever the runner gave the volunteer. A GET form, so a searched view is
 * a URL somebody can send to the other volunteer — the property `/admin/nn/`'s filters have.
 */
interface StatusRunner {
  leg: number;
  firstname: string;
  lastname: string;
  role: string | null;
}

export interface StatusTeam {
  team_id: string;
  team_number: string | null;
  name: string | null;
  race_status: string | null;
  bib_leg1: string | null;
  bib_leg2: string | null;
  runners: StatusRunner[];
}

/** What a status is called on screen. The database stores three short codes. */
const LABELS: Record<string, string> = {
  dns: 'Did not start',
  dnf: 'Did not finish',
  dq: 'Disqualified',
};

function labelFor(status: string | null): string {
  if (status === null) {
    return 'Running';
  }

  // `Object.hasOwn` rather than a bare index: an object literal inherits from
  // `Object.prototype`, and a value nobody wrote down must not render as a function.
  return Object.hasOwn(LABELS, status) ? (LABELS[status] ?? status) : status;
}

export function StatusSection({
  slug,
  teams,
  search,
  outcomeCode,
}: {
  slug: string;
  teams: StatusTeam[];
  search: string;
  /** `?outcome=`, but only when `?section=status` says this section owns it. */
  outcomeCode: string | undefined;
}) {
  const outcome = statusOutcomeFor(outcomeCode);
  const action = `/timing/events/${encodeURIComponent(slug)}/status/update`;

  return (
    <>
      {outcome === null ? null : (
        <p className={`notice notice-${outcome.tone}`}>{outcome.message}</p>
      )}

      <p>
        Marking somebody changes what the results say about them and{' '}
        <strong>never touches what was captured</strong>. A runner who did not finish
        keeps any handover time a marshal recorded; they simply have no finishing time.
      </p>

      <form method="get" className="log-search">
        {/* ⚠️ **A GET form submits its own fields and nothing else, so `?section=` is lost on
            submit — and the section this search belongs to collapses under the person using it.**
            #308. The hidden field puts it back. Searching is the one action on the console that
            navigates without a route handler in between, which is why this is the only place
            that needs it. */}
        <input type="hidden" name="section" value="status" />
        <div className="field">
          <label className="field-label" htmlFor="status_q">
            Search by bib, team number or name
          </label>
          <input
            className="field-input"
            id="status_q"
            name="status_q"
            type="text"
            defaultValue={search}
          />
        </div>
        <button type="submit" className="button">
          Search
        </button>
        {search === '' ? null : (
          <Link className="button button-quiet" href={`/events/${slug}/console#status`}>
            Show everyone
          </Link>
        )}
      </form>

      {teams.length === 0 ? (
        <p>
          {search === ''
            ? 'Nobody is on this race yet — import the entry list first.'
            : `Nobody on this race matches ${search}.`}
        </p>
      ) : (
        <ul className="triage">
          {teams.map((team) => (
            <li key={team.team_id} className="triage-card">
              <p className="triage-time">
                {team.team_number === null ? 'No number' : `Team ${team.team_number}`}
                <span className="triage-bib">{labelFor(team.race_status)}</span>
              </p>

              <p className="triage-reason">
                {team.runners.length === 0
                  ? 'No runner recorded'
                  : team.runners
                      .map(
                        (runner) =>
                          `${runner.firstname} ${runner.lastname}${
                            runner.role === 'guide' ? ' (guide)' : ''
                          }`,
                      )
                      .join(' · ')}
              </p>

              <form method="post" action={action} className="triage-form">
                <input type="hidden" name="team_id" value={team.team_id} />
                {/* The searched view is carried back, so marking somebody from a filtered list
                    returns to that list rather than to all 250. */}
                <input type="hidden" name="status_q" value={search} />

                <div className="triage-actions">
                  {team.race_status === 'dns' ? null : (
                    <button type="submit" name="status" value="dns" className="button">
                      Did not start
                    </button>
                  )}
                  {team.race_status === 'dnf' ? null : (
                    <button type="submit" name="status" value="dnf" className="button">
                      Did not finish
                    </button>
                  )}
                  {team.race_status === 'dq' ? null : (
                    <button type="submit" name="status" value="dq" className="button">
                      Disqualify
                    </button>
                  )}
                  {/* ⚠️ **Offered only when there is something to lift.** A "clear" beside a
                      runner with no status is a button that does nothing, on a page where every
                      other button changes a result. */}
                  {team.race_status === null ? null : (
                    <button
                      type="submit"
                      name="status"
                      value="clear"
                      className="button button-quiet"
                    >
                      Lift {labelFor(team.race_status).toLowerCase()}
                    </button>
                  )}
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
