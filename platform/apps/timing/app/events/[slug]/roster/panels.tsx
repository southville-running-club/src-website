import { categoryFor, type DeskRunner } from '../../../../lib/desk-roster';

/**
 * The Roster's two admin panels — ADR-056's admin half: **Edit runner** and **Add runner**.
 *
 * ⚠️ **Panels on the page, not a scripted modal.** Every acceptance spec here runs in a
 * `no-javascript` project, and a dialog that needs scripting does not open there at all. So Edit
 * is a link to `?edit=<runner>`, which draws this form at the top of the page with the search box
 * and the table still below it; Cancel is a link back. Both post to `roster/update`, which
 * answers with a 303 back to the list.
 *
 * Nothing here asks for a date of birth, contact details or medical details. An on-the-day
 * runner gives a name, how they want to be placed, and — optionally — their age, which is what
 * the race category's band is worked out from.
 */

const STATUS_OPTIONS: readonly { value: string; label: string; help: string }[] = [
  {
    value: 'normal',
    label: 'Normal',
    help: 'Running, or finished. Shown with a time in results.',
  },
  {
    value: 'dns',
    label: 'DNS',
    help: 'Withdrawn before the start. Shows as DNS in results, with no time.',
  },
  {
    value: 'dnf',
    label: 'DNF',
    help: 'Started and did not finish. Shows as DNF in results, with no finishing time.',
  },
  {
    value: 'dq',
    label: 'DQ',
    help: 'Disqualified. Shows as DQ in results, with no position. Recorded with who did it and when.',
  },
];

export function EditPanel({
  action,
  cancel,
  runner,
  query,
  mayMark,
}: {
  action: string;
  cancel: string;
  runner: DeskRunner;
  query: string;
  /** Whether this admin may set a race status — `timing.event.manage`. */
  mayMark: boolean;
}) {
  const status = runner.race_status ?? 'normal';

  return (
    <section
      className="club-card timing-roster-panel"
      aria-labelledby="edit-runner-title"
    >
      <h2 id="edit-runner-title">Edit runner</h2>
      <p className="club-small">
        Bib <span className="timing-mono">{runner.bib ?? '—'}</span> ·{' '}
        {categoryFor(runner)}
      </p>

      <form method="post" action={action} className="timing-roster-form">
        <input type="hidden" name="intent" value="edit" />
        <input type="hidden" name="q" value={query} />
        <input type="hidden" name="runner_id" value={runner.runner_id} />
        <input type="hidden" name="team_id" value={runner.team_id} />
        <input type="hidden" name="leg" value={runner.leg} />
        <input type="hidden" name="expected_firstname" value={runner.firstname} />
        <input type="hidden" name="expected_lastname" value={runner.lastname} />
        <input type="hidden" name="expected_bib" value={runner.bib ?? ''} />
        <input type="hidden" name="expected_status" value={status} />

        <div className="timing-roster-fields">
          <div className="field">
            <label className="field-label" htmlFor="edit-first">
              First name
            </label>
            <input
              className="field-input"
              id="edit-first"
              name="firstname"
              required
              defaultValue={runner.firstname}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-last">
              Last name
            </label>
            <input
              className="field-input"
              id="edit-last"
              name="lastname"
              required
              defaultValue={runner.lastname}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="edit-bib">
              Bib
            </label>
            <input
              className="field-input timing-mono"
              id="edit-bib"
              name="bib"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={runner.bib ?? ''}
              aria-describedby="edit-bib-hint"
              autoComplete="off"
            />
            <p className="club-small" id="edit-bib-hint">
              Digits only. Another runner&rsquo;s bib is refused, with who has it.
            </p>
          </div>
        </div>

        <p className="club-small">
          Category updates itself from how the runner asked to be placed and their age.
        </p>

        {mayMark ? (
          <fieldset className="timing-roster-status-field">
            <legend>Race status</legend>
            <div className="timing-segmented">
              {STATUS_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="status"
                    value={option.value}
                    defaultChecked={option.value === status}
                    aria-describedby={`status-help-${option.value}`}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {/* Each option's own help, so what is read matches what is chosen. With scripting
                off every line is shown; CSS shows only the checked one's where `:has()` runs. */}
            <ul className="timing-status-help">
              {STATUS_OPTIONS.map((option) => (
                <li
                  key={option.value}
                  id={`status-help-${option.value}`}
                  data-status={option.value}
                >
                  <strong>{option.label}:</strong> {option.help}
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <p className="club-btns">
          <button type="submit" className="club-btn club-btn-primary">
            Save
          </button>
          <a className="club-btn club-btn-secondary" href={cancel}>
            Cancel
          </a>
        </p>
      </form>
    </section>
  );
}

export function AddPanel({
  action,
  cancel,
  nextBib,
  prefill,
}: {
  action: string;
  cancel: string;
  /** The next unused bib, offered as a suggestion; the desk types the spare it is handing over. */
  nextBib: string;
  /** A search that found nobody: one word goes in Last name, more is split first / last. */
  prefill: { firstname: string; lastname: string };
}) {
  return (
    <section className="club-card timing-roster-panel" aria-labelledby="add-runner-title">
      <h2 id="add-runner-title">Add runner</h2>
      <p className="club-small">
        An on-the-day entry. They appear on this list, on the capture screen and in
        results like any other runner.
      </p>

      <form method="post" action={action} className="timing-roster-form">
        <input type="hidden" name="intent" value="add" />

        <div className="timing-roster-fields">
          <div className="field">
            <label className="field-label" htmlFor="add-first">
              First name
            </label>
            <input
              className="field-input"
              id="add-first"
              name="firstname"
              required
              defaultValue={prefill.firstname}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="add-last">
              Last name
            </label>
            <input
              className="field-input"
              id="add-last"
              name="lastname"
              required
              defaultValue={prefill.lastname}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="add-bib">
              Bib
            </label>
            <input
              className="field-input timing-mono"
              id="add-bib"
              name="bib"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={nextBib}
              aria-describedby="add-bib-hint"
              autoComplete="off"
            />
            <p className="club-small" id="add-bib-hint">
              The number on the spare bib you are handing over. Leave it blank to give
              them <span className="timing-mono">{nextBib}</span>, the next unused number.
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="add-age">
              Age on race day <span className="club-small">(optional)</span>
            </label>
            <input
              className="field-input timing-mono"
              id="add-age"
              name="age_on_day"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              aria-describedby="add-age-hint"
              autoComplete="off"
            />
            <p className="club-small" id="add-age-hint">
              An age, never a date of birth. It is what puts them in Senior, Vet 40, 50 or
              60.
            </p>
          </div>
        </div>

        <fieldset className="timing-roster-status-field">
          <legend>Race category</legend>
          <div className="timing-segmented">
            <label>
              <input type="radio" name="gender" value="female" />
              <span>Women</span>
            </label>
            <label>
              <input type="radio" name="gender" value="male" />
              <span>Men</span>
            </label>
            <label>
              <input type="radio" name="gender" value="non_binary" />
              <span>Non-binary</span>
            </label>
          </div>
        </fieldset>

        <p className="club-btns">
          <button type="submit" className="club-btn club-btn-primary">
            Add runner
          </button>
          <a className="club-btn club-btn-secondary" href={cancel}>
            Cancel
          </a>
        </p>
      </form>
    </section>
  );
}
