/**
 * What the entry-list page says after something has been posted to it, and how a parse's
 * findings survive the redirect.
 *
 * `lib/marshal-outcomes.ts` is the shape this follows and its header carries the argument:
 * the outcome crosses from the POST to the GET **through the URL**, a value in a URL is
 * something anybody can type, so **nothing from the query string is ever rendered** — the
 * parameter selects a sentence written here, and an unknown value says nothing at all.
 *
 * ## ⚠️ Why the findings are re-worded here rather than carried
 *
 * `parseRegistrationCsv()` produces a `message` per finding and **every one of them may name a
 * runner**: *"Team 4471 (Alex Doe) has only one runner"*, *"Email alex@example.com appears on
 * rows…"*. Carrying those across the redirect would put a name and an address in a URL — in a
 * browser's history, in a Worker's request log, in whatever a volunteer pastes to the other
 * volunteer. This platform's own rule is that personal data never goes in a query string, and
 * the registration slice exists precisely to hold a minimisation boundary.
 *
 * So what crosses is **a severity, a finding kind from a closed list, and row numbers** —
 * none of which is personal data — and the wording below is the club's own. A volunteer gets
 * *"Rows 3, 7 and 12 are missing something the import needs"* and goes and looks at rows 3, 7
 * and 12 in the file they still have open. That is the same information, minus the leak.
 *
 * ## ⚠️ And the file itself is kept nowhere
 *
 * [#202](https://github.com/southville-running-club/src-website/issues/202) notes that the old
 * application put the raw CSV in a private storage bucket as its audit trail, and that
 * **whether to keep the raw file at all is a data-minimisation question the club has not
 * answered**. Until it does, this path keeps nothing: the route handler parses the upload in
 * memory, imports the rows, and lets it go. That is why the findings have to fit in a URL —
 * there is deliberately nowhere else to put them.
 */

/** The tone a message is rendered in — `base.css`'s `.notice-ok` and `.notice-bad`. */
export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

/**
 * The numbers an outcome's wording may quote, read off the query string and validated as
 * non-negative integers before they reach here.
 *
 * **A missing count renders as nothing rather than as zero**: `{ teams: undefined }` means the
 * page was not told, and *"0 entries"* is a claim about a race.
 */
export interface OutcomeCounts {
  teams?: number | undefined;
  runners?: number | undefined;
  assigned?: number | undefined;
  already?: number | undefined;
}

/** `12 entries` / `1 entry`, or `some entries` when the count did not survive the redirect. */
function count(n: number | undefined, one: string, many: string): string {
  if (n === undefined) return `some ${many}`;
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

type Wording = (counts: OutcomeCounts) => Outcome;

const ok =
  (message: string): Wording =>
  () => ({ tone: 'ok', message });
const bad =
  (message: string): Wording =>
  () => ({ tone: 'bad', message });

/**
 * ⚠️ **Only the `ok`-toned entries claim something changed**, and each is reached only from a
 * function that answered `ok: true` or from a parse that imported nothing on purpose.
 * Everything else is a refusal or an outage and says which — *"that did not work"* on an entry
 * list is the sentence that leaves somebody off a start line.
 *
 * The list is deliberately wider than the functions can currently answer, for
 * `marshal-outcomes.ts`'s reason: a reason with no wording falls through to silence, which is
 * the one failure mode a volunteer cannot tell from success.
 */
const OUTCOMES: Record<string, Wording> = {
  // --- the upload path -------------------------------------------------------------------
  checked: ok(
    'That file was read and nothing was imported. Anything worth knowing about it is listed below.',
  ),
  imported: (counts) => ({
    tone: 'ok',
    message: `The entry list was imported: ${count(counts.teams, 'entry', 'entries')} and ${count(
      counts.runners,
      'runner',
      'runners',
    )} on the start list. Re-importing the same file changes nothing, and never touches a number somebody is already wearing.`,
  }),
  blocked: bad(
    'Nothing was imported. The file has problems that have to be fixed first, and they are listed below — the whole import is refused rather than half applied, because nobody can tell by looking which half landed.',
  ),
  'no-file': bad('No file was chosen, so nothing was read.'),
  'not-csv': bad(
    'That does not look like a CSV file, so nothing was read. Export the entry list as CSV and try again.',
  ),
  'too-big': bad(
    'That file is larger than this page will read, so nothing was read. An entry list for a race this size is a few hundred kilobytes at most.',
  ),
  unreadable: bad('That file could not be read as text, so nothing was read.'),

  // --- importing from the club's own entries ----------------------------------------------
  'roster-imported': (counts) => ({
    tone: 'ok',
    message: `The roster was imported from the club's entries: ${count(
      counts.teams,
      'entry',
      'entries',
    )} and ${count(
      counts.runners,
      'runner',
      'runners',
    )} on the start list. Run it again whenever an entry is transferred, cancelled or added.`,
  }),
  no_such_entries_event: bad(
    'This race has no entries in the club’s own entry system, so there is nothing to import from. A race entered somewhere else is imported from its CSV instead.',
  ),
  too_many_entrants: bad(
    'One entry in the club’s entry system has more runners on it than this race has legs, so nothing was imported. That needs a look at the entry itself.',
  ),

  // --- bibs --------------------------------------------------------------------------------
  'bibs-assigned': (counts) => ({
    tone: 'ok',
    message: `Bibs were assigned: ${count(
      counts.assigned,
      'entry was numbered',
      'entries were numbered',
    )}, and ${count(
      counts.already,
      'already had a number',
      'already had numbers',
    )}. Running this again never renumbers anybody.`,
  }),
  'bibs-already-assigned': ok(
    'Every entry already has a number, so nothing was changed. Running this again never renumbers anybody.',
  ),
  'bib-set': ok('That bib is recorded against the leg you chose.'),
  'bib-cleared': ok(
    'That override is gone, so the leg is back to the bib its number derives.',
  ),
  bib_taken: bad(
    'Another entry already has that bib, so nothing was changed. Bibs are compared as they are actually resolved, so a clash can be with a number that is derived rather than written down.',
  ),
  no_such_leg: bad('There is no such leg on this race, so nothing was changed.'),
  no_such_team: bad('That entry is not on this race, so nothing was changed.'),

  // --- walk-ins ----------------------------------------------------------------------------
  'walk-in-added': ok(
    'That walk-in is on the start list with the next free number. They have no entry behind them, which is the truth rather than a gap.',
  ),

  // --- the shared refusals ------------------------------------------------------------------
  no_such_event: bad('There is no race at this address, so nothing was changed.'),
  malformed: bad(
    'That import was not shaped the way it has to be, so nothing was changed.',
  ),
  missing_purchase_order_id: bad(
    'One of the entries has no reference to anchor it to, so nothing was imported. That reference is what makes re-importing safe.',
  ),
  incomplete: bad('Something the form needs was left blank, so nothing was changed.'),
  refused: bad('That was refused, so nothing was changed.'),
  unavailable: bad(
    // Word for word the read side's wording, because it is the same race and a volunteer
    // comparing two pages during an outage must not be told two different things.
    'The club’s database could not be reached, so nothing was changed. Try again in a moment.',
  ),
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * ⚠️ **`Object.hasOwn` rather than `OUTCOMES[value] ?? null`** — an object literal inherits
 * from `Object.prototype`, so `OUTCOMES['toString']` is a function rather than `undefined`.
 * `?outcome=constructor` is a URL anybody can type. Same fix as `lib/access.ts` and
 * `lib/marshal-outcomes.ts`, found the same way.
 */
export function outcomeFor(
  value: string | undefined,
  counts: OutcomeCounts = {},
): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  const wording = OUTCOMES[value];
  return wording === undefined ? null : wording(counts);
}

/* ==========================================================================================
 * Findings
 * ======================================================================================== */

/**
 * The club's own wording for each finding kind the parser can produce.
 *
 * ⚠️ **Every `FindingKind` in `packages/shared/src/timing/registration/types.ts` has a row
 * here, and a kind with no row renders nothing at all** — which is silence about a problem,
 * so `registration-outcomes.test.ts` asserts the two lists are the same set. That test is the
 * only thing stopping a new finding kind from being invisible on this page.
 *
 * **No sentence here names a person, a team or an address**, which is the property that lets
 * findings cross the redirect at all. Where the parser's own message says *"Team 4471 (Alex
 * Doe)"*, this says *"an entry"* and the row numbers say which.
 */
const FINDING_WORDING: Record<string, string> = {
  'missing-required-field':
    'Missing something every row needs — a first name, a last name, an email address, a race category or the purchase reference.',
  'multi-row-team':
    'More runners on one entry than this race has legs. The entry was not imported.',
  'lone-runner': 'A relay entry with one runner on it, to be paired on the day.',
  'cross-team-duplicate-email':
    'One email address appears on more than one entry. Worth a look before the day.',
  'within-pair-duplicate-email':
    'One email address is shared by both runners on an entry. Couples do this and it is fine.',
  'pair-not-adjacent':
    'An entry’s rows are not next to each other in the file. The entry still resolves correctly; the file has been edited.',
  'empty-team-name':
    'No team name. The results will fall back to the runners’ own names.',
  'no-captain-match':
    'No captain could be worked out for an entry. Both runners are imported with no captain marked.',
  'unexpected-columns':
    'The file has columns this import does not know about. They were ignored.',
  'malformed-csv': 'The file could not be read as a CSV at that point.',
  'invalid-dob':
    'A date of birth could not be read, so that runner has no age and therefore no age band. The date itself is never stored either way.',
};

export type FindingSeverity = 'block' | 'warn' | 'info';

export interface FindingSummary {
  severity: FindingSeverity;
  kind: string;
  /** Which rows of the file, 1-based and excluding the header. Empty for a file-level finding. */
  rows: number[];
  /** How many findings of this kind there were, which may exceed `rows.length`. */
  total: number;
  /** The club's own wording — never the parser's, which names people. */
  message: string;
}

const SEVERITIES = new Set(['block', 'warn', 'info']);

/**
 * How many rows one finding kind carries across the redirect.
 *
 * ⚠️ **A cap rather than everything, because a URL has a length and a bad export has 250 bad
 * rows.** Twelve is enough to find the problem in a spreadsheet and short enough that a dozen
 * kinds together stay well inside what any proxy will carry; the total is sent separately, so
 * the page says *"and 238 more"* rather than quietly losing them.
 */
export const MAX_FINDING_ROWS = 12;

/** How many distinct severity/kind groups cross. Past this the file has one problem, not ten. */
export const MAX_FINDING_GROUPS = 12;

/**
 * One group, as it is written into the query string: `severity.kind.total.row-row-row`.
 *
 * Dots and dashes rather than anything that needs escaping, and every part is either a value
 * from a closed list or a non-negative integer — so this string can never carry a name, an
 * address, a `&` or a `#`.
 */
export function encodeFindingGroup(
  severity: FindingSeverity,
  kind: string,
  total: number,
  rows: readonly number[],
): string {
  return `${severity}.${kind}.${total}.${rows.slice(0, MAX_FINDING_ROWS).join('-')}`;
}

function parseGroup(raw: string): FindingSummary | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;

  const [severity, kind, totalRaw, rowsRaw] = parts as [string, string, string, string];

  // Both halves are closed lists, so a typed URL selects wording written here or nothing.
  if (!SEVERITIES.has(severity)) return null;
  if (!Object.hasOwn(FINDING_WORDING, kind)) return null;

  const message = FINDING_WORDING[kind];
  if (message === undefined) return null;

  const total = /^\d{1,6}$/.test(totalRaw) ? Number(totalRaw) : null;
  if (total === null) return null;

  const rows =
    rowsRaw === ''
      ? []
      : rowsRaw.split('-').map((n) => (/^\d{1,7}$/.test(n) ? Number(n) : -1));
  if (rows.some((n) => n < 0)) return null;

  return { severity: severity as FindingSeverity, kind, rows, total, message };
}

/**
 * The findings this query string names, in the order they were written, ignoring anything
 * it has no wording for.
 *
 * A repeated parameter arrives as an array and a single one as a string; both are accepted,
 * and anything else is no findings at all.
 */
export function findingsFrom(raw: string | string[] | undefined): FindingSummary[] {
  const groups = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  return groups
    .slice(0, MAX_FINDING_GROUPS)
    .map(parseGroup)
    .filter((group): group is FindingSummary => group !== null);
}

/** The kinds this module has wording for — what `registration-outcomes.test.ts` pins. */
export const WORDED_FINDING_KINDS = Object.keys(FINDING_WORDING);
