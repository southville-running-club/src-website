/**
 * What the Roster says after an admin saves or adds — ADR-056's admin half.
 *
 * ⚠️ **A code in the address, a sentence here.** The handler redirects with `?outcome=` and, for
 * a bib somebody else holds, the holder's **runner id** — never a name, because a query string
 * is not somewhere personal data may go. The page looks the name up from the roster it has
 * already read. Nothing the database says is ever rendered: its `reason` selects a sentence.
 */
export interface RosterOutcome {
  tone: 'ok' | 'bad';
  message: string;
}

const OUTCOMES: Record<string, RosterOutcome> = {
  saved: { tone: 'ok', message: 'Saved.' },
  unchanged: { tone: 'ok', message: 'Nothing had changed, so nothing was saved.' },
  added: { tone: 'ok', message: 'Added.' },
  incomplete: {
    tone: 'bad',
    message: 'Enter a first name and a last name. Nothing was saved.',
  },
  bib_digits: {
    tone: 'bad',
    message: 'A bib is digits only. Nothing was saved for the bib.',
  },
  bib_taken: {
    tone: 'bad',
    message: 'That bib is already somebody else’s. Nothing was saved for the bib.',
  },
  changed_elsewhere: {
    tone: 'bad',
    message:
      'This runner was changed on another device, so nothing was saved. Their latest details are shown — check them and save again.',
  },
  no_such_runner: {
    tone: 'bad',
    message: 'That runner is no longer on this race. Nothing was saved.',
  },
  refused: {
    tone: 'bad',
    message: 'You are not able to change this, so nothing was saved.',
  },
  unavailable: {
    tone: 'bad',
    message:
      'The club’s database could not be reached, so nothing was saved. Try again in a moment.',
  },
};

/**
 * The sentence for an outcome code, or `null` for none. A code this file does not know — a
 * database refusal like `no_such_team` — reads as a refusal rather than as nothing, so a save
 * that did not happen never looks like one that did.
 */
export function rosterOutcomeFor(code: string | undefined): RosterOutcome | null {
  if (code === undefined || code === '') return null;
  return (Object.hasOwn(OUTCOMES, code) ? OUTCOMES[code] : OUTCOMES.refused) ?? null;
}

/** "Bib 123 is already assigned to Jane Smith." — the holder named, when the page knows them. */
export function bibTakenBy(bib: string, holder: { firstname: string; lastname: string }) {
  return `Bib ${bib} is already assigned to ${holder.firstname} ${holder.lastname}. Nothing was saved for the bib.`;
}
