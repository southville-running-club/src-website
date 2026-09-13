import { Fragment } from 'react';
import Link from 'next/link';
import { effectiveBib, type EventFormat, type Leg } from '@src/shared/timing/bib';
import { normaliseTimingGender } from '@src/shared/timing/gender';
import { DROPPED_COLUMNS } from '@src/shared/timing/registration/parser';
import { readTiming } from '../../../../lib/reads';
import {
  findingsFrom,
  outcomeFor,
  type FindingSummary,
} from '../../../../lib/registration-outcomes';

/**
 * `/timing/events/<slug>/registration/` — the entry list for one race.
 *
 * Issue [#202](https://github.com/southville-running-club/src-website/issues/202), with
 * [#249](https://github.com/southville-running-club/src-website/issues/249)'s page half: the
 * bib column, the override per leg and the "Assign bibs" control, which landed as functions in
 * #272 and had no screen to live on. Behind `timing.registration.import`; `lib/access.ts` maps
 * it and `middleware.ts` enforces it. ⚠️ **This page does not gate itself** — see
 * `app/page.tsx`'s header for the measurement that settled that.
 *
 * ## ⚠️ Two ways in, and the CSV is no longer the important one
 *
 * [ADR-039](../../../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md)
 * changed what this screen is for. Nightingale Nightmare's roster is in `entries`, in this
 * same database, and crosses by `timing.import_from_entries()` — **the deciding argument was
 * the date of birth**, which a CSV round trip would put in a file and this one never lets
 * leave `entries`. So "Import from the club's entries" is first on the page and is the
 * critical path.
 *
 * **The upload stays, for Pass the Buck's archive and for a race entered somewhere else.** It
 * is a Full On Sport export, it is what #206 replays, and it is the path a desk types a
 * walk-in beside.
 *
 * ## ⚠️ The raw file is kept nowhere, and that is a question left open rather than answered
 *
 * The old application put the uploaded CSV in a private storage bucket as its audit trail.
 * #202 says files belong in R2 here and never in Postgres — **and that whether the raw file is
 * kept at all is a data-minimisation question to answer before the first upload, not after.**
 * It is not answered. So this path keeps nothing: the route handler parses the upload in
 * memory, hands the minimised rows to the database and lets the file go. Nothing is written to
 * R2, nothing to a cookie, nothing to a session. The findings survive the redirect as
 * severities, kinds and row numbers, which is why `lib/registration-outcomes.ts` re-words
 * every one of them in the club's own voice rather than carrying the parser's, which names
 * people.
 *
 * ## Why there is no drag-and-drop preview
 *
 * Every Playwright project in this repository runs with scripting off, and a file upload with
 * no JavaScript is a plain `<form enctype="multipart/form-data">` answered by a route handler
 * and a 303. That is what this is. **The two-step preview is two submits of the same form** —
 * "Check this file" reads it and imports nothing, "Import this file" does both — rather than a
 * parsed result held somewhere between two requests, because the only places to hold one are
 * the places the paragraph above says nothing may be kept.
 */
export const dynamic = 'force-dynamic';

interface RosterRunner {
  id: string;
  leg: number;
  firstname: string;
  lastname: string;
  gender: string | null;
  email: string | null;
  club_name: string | null;
  age_on_day: number | null;
  is_captain: boolean;
}

interface RosterTeam {
  id: string;
  team_number: string | null;
  name: string | null;
  category: string | null;
  entry_type: string | null;
  purchase_order_id: string | null;
  csv_row_index: number | null;
  bib_leg1: string | null;
  bib_leg2: string | null;
  runners: RosterRunner[];
}

interface Roster {
  event: { slug: string; name: string; format: string; start_at: string };
  teams: RosterTeam[];
}

/**
 * A query parameter as a small non-negative integer, or `undefined`.
 *
 * ⚠️ **Nothing off the query string is rendered, ever** — `lib/marshal-outcomes.ts`'s rule.
 * These numbers are not an exception to it: they are validated to digits, converted, and then
 * *interpolated by wording written in this repository*. A value that is not a plain number
 * becomes `undefined`, and the wording says "some entries" rather than a figure it was not
 * told.
 */
function intFrom(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^\d{1,7}$/.test(value)) return undefined;
  return Number(value);
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A team with no runner on it at all.
 *
 * ⚠️ **Possible, and rendered rather than crashed on.** `import_registration()` removes a leg
 * the file no longer carries, so a corrected relay pair can briefly be a team with nobody on
 * it, and `/admin/nn/` learned the same lesson expensively: a refunded purchase whose entrants
 * had been deleted could not appear on the page at all, and a volunteer concluded there had
 * been no refunds. A row with no runner says so.
 */
const NO_RUNNER: RosterRunner = {
  id: '',
  leg: 1,
  firstname: 'No runner recorded',
  lastname: '',
  gender: null,
  email: null,
  club_name: null,
  age_on_day: null,
  is_captain: false,
};

/** How a runner is named on this page. Both halves are always present in the column. */
function nameOf(runner: RosterRunner): string {
  return `${runner.firstname} ${runner.lastname}`.trim();
}

/**
 * What the club records about this runner's race category, in words.
 *
 * ⚠️ **Through `normaliseTimingGender()` and never by comparing the string**, since ADR-039
 * gave the column one vocabulary and Pass the Buck's archive still spells it the old way. An
 * unrecognised or absent value reads as **"Not recorded"** rather than as a guess — the same
 * direction `awards.ts` takes, because guessing is discovered at the prize-giving.
 */
function categoryOf(runner: RosterRunner): string {
  const gender = normaliseTimingGender(runner.gender);
  if (gender === null) return 'Not recorded';
  return gender === 'non_binary' ? 'Non-binary' : gender === 'female' ? 'Female' : 'Male';
}

/** `base.css` has no visually-hidden utility, so an accessible name is an `aria-label`. */
function legLabel(team: RosterTeam, leg: Leg, format: EventFormat): string {
  const runner = team.runners.find((r) => r.leg === leg);
  const who =
    runner === undefined
      ? `entry ${team.team_number ?? '(not numbered)'}`
      : nameOf(runner);
  return format === 'solo' ? who : `${who}, leg ${leg}`;
}

function FindingList({ findings }: { findings: FindingSummary[] }) {
  if (findings.length === 0) return null;

  return (
    <ul className="summary-list">
      {findings.map((finding) => (
        <li key={`${finding.severity}.${finding.kind}`}>
          <p>
            <strong>
              {finding.severity === 'block'
                ? 'Has to be fixed'
                : finding.severity === 'warn'
                  ? 'Worth a look'
                  : 'For information'}
              :
            </strong>{' '}
            {finding.message}
          </p>
          <p>
            {finding.rows.length === 0
              ? `${finding.total} of these.`
              : `${finding.total === 1 ? 'Row' : 'Rows'} ${finding.rows.join(', ')}${
                  finding.total > finding.rows.length
                    ? `, and ${finding.total - finding.rows.length} more`
                    : ''
                }.`}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function RegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  const outcome = outcomeFor(single(query.outcome), {
    teams: intFrom(query.teams),
    runners: intFrom(query.runners),
    assigned: intFrom(query.assigned),
    already: intFrom(query.already),
  });
  const findings = findingsFrom(query.f);

  const roster = await readTiming<Roster>('event_roster', { p_event_slug: slug });

  if (roster.state === 'unavailable') {
    return (
      <>
        <h1>Entry list</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this entry list could not be
          read. Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (roster.state === 'none') {
    // Word for word `app/not-found.tsx`, because a refusal must be indistinguishable from an
    // address that does not exist — `event_roster()` answers the same `null` for both.
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const { event, teams } = roster.data;
  const format: EventFormat = event.format === 'relay' ? 'relay' : 'solo';
  const legs: Leg[] = format === 'solo' ? [1] : [1, 2];

  const numbered = teams.filter((team) => team.team_number !== null).length;
  const runners = teams.reduce((total, team) => total + team.runners.length, 0);

  const importAction = `/timing/events/${encodeURIComponent(slug)}/registration/import`;
  const updateAction = `/timing/events/${encodeURIComponent(slug)}/registration/update`;

  return (
    <>
      <h1>Entry list</h1>

      <p className="lede">Who is on the start line for {event.name}.</p>

      {outcome === null ? null : (
        <div
          className={outcome.tone === 'ok' ? 'notice notice-ok' : 'notice notice-bad'}
          // `role="status"` for `marshals/page.tsx`'s reason, and with its caveat: every path
          // here is a full page load after a 303, so a screen reader reads this in document
          // order. The role is the correct semantic and is what makes it announce properly if
          // this page is ever updated in place; it is not standing in for a live region.
          role="status"
        >
          <p>{outcome.message}</p>
          <FindingList findings={findings} />
        </div>
      )}

      <h2>Import from the club&rsquo;s entries</h2>

      <p>
        For a race entered through the club&rsquo;s own entry form, the roster comes
        straight from the entries — no file, and no date of birth ever leaves the entry
        system. Run it again whenever an entry is transferred, cancelled or added; it
        never touches a number somebody is already wearing.
      </p>

      <form method="post" action={updateAction}>
        <input type="hidden" name="intent" value="import-from-entries" />
        <button className="button" type="submit">
          Import from entries
        </button>
      </form>

      <h2>Upload an entry list</h2>

      <p>
        For a race entered somewhere else. The file is a Full On Sport CSV export.{' '}
        <strong>Nothing about the file itself is kept</strong> — it is read here, the
        entry list is written, and the file is let go.
      </p>

      <form method="post" action={importAction} encType="multipart/form-data">
        <div className="field">
          <label className="field-label" htmlFor="file">
            The CSV file
          </label>
          <p className="field-hint" id="file-hint">
            Check it first if you want to see what it contains without importing anything.
          </p>
          <input
            className="field-input"
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            aria-describedby="file-hint"
            required
          />
        </div>
        {/* Two submits on one form: the clicked button's own name and value are what is
            posted, which needs no JavaScript at all. */}
        <button className="button" type="submit" name="intent" value="check">
          Check this file
        </button>{' '}
        <button className="button" type="submit" name="intent" value="import">
          Import this file
        </button>
      </form>

      <h3>What is never taken from the file</h3>

      <p>
        These columns are dropped as the file is read and never reach the club&rsquo;s
        database. An age is worked out against the race date and the date of birth is
        thrown away in the same breath.
      </p>

      <p className="field-hint">{DROPPED_COLUMNS.join(', ')}.</p>

      <h2>On the start list</h2>

      {teams.length === 0 ? (
        <p>Nothing has been imported for this race yet.</p>
      ) : (
        <>
          <dl>
            <dt>Entries</dt>
            <dd>{teams.length}</dd>

            <dt>Runners</dt>
            <dd>{runners}</dd>

            <dt>Numbered</dt>
            <dd>
              {numbered} of {teams.length}
            </dd>
          </dl>

          <form method="post" action={updateAction}>
            <input type="hidden" name="intent" value="assign-bibs" />
            <button className="button" type="submit">
              Assign bibs
            </button>
          </form>

          <p className="field-hint">
            Numbering carries on from the highest number already given out, skips anybody
            who has one, and never renumbers a field. A bib written in below always beats
            the number an entry derives.
          </p>

          <ul className="summary-list">
            {teams.map((team) => (
              <li key={team.id}>
                <h3>{team.name ?? nameOf(team.runners[0] ?? NO_RUNNER)}</h3>

                <dl>
                  <dt>Number</dt>
                  <dd>{team.team_number ?? 'Not numbered yet'}</dd>

                  {legs.map((leg) => (
                    <Fragment key={leg}>
                      <dt>{format === 'solo' ? 'Bib' : `Bib, leg ${leg}`}</dt>
                      <dd>{effectiveBib(team, leg, format) ?? '—'}</dd>
                    </Fragment>
                  ))}

                  <dt>Entry type</dt>
                  <dd>{team.entry_type ?? '—'}</dd>

                  {team.runners.map((runner) => (
                    <Fragment key={runner.id}>
                      <dt>{format === 'solo' ? 'Runner' : `Leg ${runner.leg}`}</dt>
                      <dd>
                        {nameOf(runner)} — {categoryOf(runner)}
                        {runner.age_on_day === null ? '' : `, ${runner.age_on_day}`}
                        {runner.club_name === null ? '' : `, ${runner.club_name}`}
                      </dd>
                    </Fragment>
                  ))}
                </dl>

                {legs.map((leg) => (
                  <form key={leg} method="post" action={updateAction}>
                    <input type="hidden" name="intent" value="override-bib" />
                    <input type="hidden" name="team_id" value={team.id} />
                    <input type="hidden" name="leg" value={String(leg)} />
                    <div className="field">
                      <input
                        className="field-input"
                        name="bib"
                        type="text"
                        inputMode="numeric"
                        maxLength={16}
                        defaultValue={(leg === 1 ? team.bib_leg1 : team.bib_leg2) ?? ''}
                        aria-label={`Bib written on for ${legLabel(team, leg, format)}`}
                      />
                    </div>
                    <button
                      className="button"
                      type="submit"
                      aria-label={`Save the bib for ${legLabel(team, leg, format)}`}
                    >
                      Save bib
                    </button>
                  </form>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Add a walk-in</h2>

      <p>
        Somebody who turned up at the desk. They get the next free number, no entry behind
        them, and no email address — which is the truth rather than a gap.
      </p>

      <form method="post" action={updateAction}>
        <input type="hidden" name="intent" value="walk-in" />

        <div className="field">
          <label className="field-label" htmlFor="firstname">
            First name
          </label>
          <input
            className="field-input"
            id="firstname"
            name="firstname"
            type="text"
            maxLength={80}
            autoComplete="off"
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="lastname">
            Last name
          </label>
          <input
            className="field-input"
            id="lastname"
            name="lastname"
            type="text"
            maxLength={80}
            autoComplete="off"
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="gender">
            Race category
          </label>
          <p className="field-hint" id="gender-hint">
            The two categories the club awards prizes in, and the answer somebody gives
            when neither is right. Leave it unanswered and they are in no prize band,
            which is better than a guess.
          </p>
          <select
            className="field-input"
            id="gender"
            name="gender"
            aria-describedby="gender-hint"
            defaultValue=""
          >
            <option value="">Not recorded</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="age_on_day">
            Age on race day
          </label>
          <p className="field-hint" id="age_on_day-hint">
            The age, not the date of birth. The club does not hold a date of birth for
            timing and is not going to.
          </p>
          <input
            className="field-input"
            id="age_on_day"
            name="age_on_day"
            type="text"
            inputMode="numeric"
            maxLength={3}
            aria-describedby="age_on_day-hint"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="club_name">
            Club
          </label>
          <input
            className="field-input"
            id="club_name"
            name="club_name"
            type="text"
            maxLength={120}
            autoComplete="off"
          />
        </div>

        <button className="button" type="submit">
          Add this walk-in
        </button>
      </form>

      <p>
        <Link href={`/events/${slug}`}>Back to {event.name}</Link>
      </p>
    </>
  );
}
