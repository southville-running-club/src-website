/**
 * The vocabulary `/admin/people/` reads a role list with, and the three pure questions its
 * page and its POST both have to answer the same way.
 *
 * ## Why this is a leaf module
 *
 * `money.ts`'s reason, two days on: ADR-046's page gains a JavaScript enhancement that has to
 * compute the same diff the server computes, and importing that from a module which builds Zod
 * schemas at module scope costs the browser six kilobytes for one function — nothing
 * tree-shakes them. So this file imports nothing at all, and *"re-implement it in the page,
 * then"* is the trade it exists to refuse: a second implementation of the diff is how the
 * pending pills come to disagree with what the save actually did.
 *
 * ## What is deliberately not here
 *
 * **The role list.** ADR-017 made adding a role a migration rather than a migration and a
 * deploy, and `identity.grantable_roles()` is what answers with one. A constant here naming
 * the club's roles would put that back — and `worker/admin-people.ts` already carries the note
 * about the `ROLES` constant that used to exist and why it does not.
 *
 * What *is* here is how to **group and label** whatever that function returns, which is
 * presentation and has nowhere else to live.
 */

/** A role nothing on this page's batch may carry. See `identity.set_roles()` for the argument. */
export const RESERVED_ROLES = ['super-admin', 'registered'] as const;

export interface RoleGroup {
  id: string;
  /** What the card is headed. */
  name: string;
  /** The word a pending pill uses, where the card's full name would not fit. */
  short: string;
  /** The slug prefix that puts a role in this group, or null for the group that takes the rest. */
  prefix: string | null;
}

/**
 * Three groups, and a role joins one **by its slug prefix** rather than by a column.
 *
 * `identity.roles` holds a slug and a description and nothing else, so grouping had to come
 * from somewhere. A prefix rule was chosen over a fourth column because the slugs already
 * encode it — `nn-admin`, `timing-marshal` — and because a column would be a second place to
 * keep in step with the name every permission in that area already starts with.
 *
 * ⚠️ **The consequence is that a future role with no known prefix lands in Club**, silently.
 * That is the right failure — a role appears on the page in a sensible place rather than
 * vanishing from it — but it is a failure rather than a decision, and the day the club adds an
 * area this list needs a line.
 */
export const ROLE_GROUPS: RoleGroup[] = [
  { id: 'nn', name: 'Nightingale Nightmare', short: 'NN', prefix: 'nn-' },
  { id: 'timing', name: 'Race timing', short: 'Timing', prefix: 'timing-' },
  { id: 'club', name: 'Club', short: 'Club', prefix: null },
];

/** The group a role is drawn in. Never throws: the last group takes whatever matched nothing. */
export function groupFor(slug: string): RoleGroup {
  return (
    ROLE_GROUPS.find((group) => group.prefix !== null && slug.startsWith(group.prefix)) ??
    ROLE_GROUPS[ROLE_GROUPS.length - 1]!
  );
}

/**
 * Initialisms that are not words, so humanising a slug does not turn them into one.
 *
 * **`src` is the club's own initialism** — it names this repository, the `src-admin` role and
 * the `--src-*` token layer — so "SRC admin" is the club's word rather than a coined one.
 * Without this, `src-admin` reads "Src admin".
 */
const INITIALISMS: Record<string, string> = { src: 'SRC', nn: 'NN' };

/**
 * A short label for a switch, derived from the slug.
 *
 * ⚠️ **Derived rather than written**, and that is the whole of the decision. A hand-kept map
 * from slug to label is exactly the constant ADR-017 removed from this page, and it goes stale
 * the first time somebody adds a role by migration alone — which is the thing that change made
 * possible. The description underneath is the database's, verbatim.
 *
 * The group prefix comes off because the card above already says it: inside the Nightingale
 * Nightmare card, `nn-admin` is "Admin". The key is rendered beside the label in full, so
 * nothing is lost by shortening it.
 */
export function roleLabel(slug: string): string {
  const group = groupFor(slug);
  const stem =
    group.prefix !== null && slug.startsWith(group.prefix)
      ? slug.slice(group.prefix.length)
      : slug;

  const words = stem.split('-').filter((word) => word.length > 0);
  if (words.length === 0) return slug;

  return words
    .map((word, index) => {
      const initialism = INITIALISMS[word];
      if (initialism !== undefined) return initialism;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

/** What a pending change reads as: "NN results", "Timing marshal". */
export function pendingLabel(slug: string): string {
  return `${groupFor(slug).short} ${roleLabel(slug).toLowerCase()}`;
}

export interface RoleDiff {
  added: string[];
  removed: string[];
}

/**
 * What a save would change, from two sets.
 *
 * **Order and repetition are not differences.** The wanted set arrives from a form, where a
 * checkbox may appear once or not at all but the order is the document's; the current set
 * arrives from the database sorted. Comparing them without normalising would report a change
 * nobody made, which on this page means an "Unsaved" tag on a switch somebody has not touched.
 *
 * Reserved roles are dropped from both sides rather than reported: the batch cannot carry
 * them, so a difference in one is not a change this page is able to offer.
 */
export function roleDiff(current: string[], wanted: string[]): RoleDiff {
  const from = new Set(grantable(current));
  const to = new Set(grantable(wanted));

  return {
    added: [...to].filter((role) => !from.has(role)).sort(),
    removed: [...from].filter((role) => !to.has(role)).sort(),
  };
}

/** The roles this page may change: sorted, de-duplicated, and without the two reserved ones. */
export function grantable(roles: string[]): string[] {
  return [
    ...new Set(
      roles.filter((role) => !(RESERVED_ROLES as readonly string[]).includes(role)),
    ),
  ].sort();
}

/** Whether two role sets are the same set, whatever order they arrived in. */
export function sameRoles(a: string[], b: string[]): boolean {
  const left = grantable(a);
  const right = grantable(b);
  return left.length === right.length && left.every((role, i) => role === right[i]);
}

/**
 * Whether what somebody typed into the super-admin confirmation matches the name it asked for.
 *
 * **Trimmed and case-insensitive**, because the box exists to make somebody stop and read the
 * sentence above it rather than to test their typing. Whitespace inside the name is collapsed
 * for the same reason — a name pasted out of the table can arrive with a double space in it.
 *
 * **An empty expected name never matches anything.** A person with no name recorded would
 * otherwise be confirmable by typing nothing at all, which is the confirmation removing itself
 * exactly where it is least able to be checked.
 */
export function typedNameMatches(typed: string, expected: string | null): boolean {
  const wanted = normaliseTypedName(expected ?? '');
  if (wanted === '') return false;
  return normaliseTypedName(typed) === wanted;
}

/**
 * The normalisation both sides of that comparison go through.
 *
 * ⚠️ **Exported because the browser has to agree with it.** `/admin/people/` enables its
 * confirm button as somebody types, and there is no bundler reaching a Worker-rendered page —
 * so the enhancement carries its own copy of this one line, and the server hands it the
 * *expected* value already normalised so only the typed side is done twice. That is the whole
 * of the duplication and it is deliberate; `people-roles.test.ts` pins the contract both must
 * meet. If this rule ever grows past one line, it stops being worth duplicating and the
 * button should stop being disabled instead.
 */
export function normaliseTypedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** How somebody's roles read in one phrase, beside their name. */
export function roleSummary(roles: string[]): string {
  if (roles.includes('super-admin')) return 'Super admin';

  const held = grantable(roles).length;
  if (held === 0) return 'Member';
  return held === 1 ? '1 role' : `${held} roles`;
}

export type PeopleView = 'person' | 'role';
export type PeopleFilter = 'all' | 'roles' | 'none';

export const PEOPLE_FILTERS: { id: PeopleFilter; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'roles', label: 'Has roles' },
  { id: 'none', label: 'Members' },
];

export interface PeopleQuery {
  view: PeopleView;
  /** The selected person, or null. A uuid — **never an email address**, because URLs are logged. */
  person: string | null;
  filter: PeopleFilter;
  q: string;
  saved: boolean;
  /** Whether the super-admin confirmation is the thing being asked for. */
  confirming: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The whole of this page's state, read off the query string.
 *
 * **Every value falls back rather than refusing.** A hand-edited or truncated URL is not an
 * attack and must not be a 400: an unknown view is the default view, an unparseable person is
 * no person, and the page renders. The one thing that is validated strictly is the person id,
 * because it is passed to the database — and a malformed one is dropped here rather than
 * carried down to be refused there.
 */
export function parsePeopleQuery(params: URLSearchParams): PeopleQuery {
  const view = params.get('view');
  const filter = params.get('filter');
  const person = params.get('person');

  return {
    view: view === 'role' ? 'role' : 'person',
    person: person !== null && isUuid(person) ? person : null,
    filter: filter === 'roles' || filter === 'none' ? (filter as PeopleFilter) : 'all',
    // Trimmed, and capped so a pathological query string cannot become the page's own title
    // attribute or a thousand-character round trip through the form.
    q: (params.get('q') ?? '').trim().slice(0, 100),
    saved: params.get('saved') === '1',
    confirming: params.get('confirm') === 'super',
  };
}

/** The query string for a link back into this page, with the empty values left out. */
export function peopleHref(
  base: string,
  query: Partial<PeopleQuery> & { person?: string | null },
): string {
  const params = new URLSearchParams();

  if (query.view === 'role') params.set('view', 'role');
  if (query.person) params.set('person', query.person);
  if (query.filter !== undefined && query.filter !== 'all')
    params.set('filter', query.filter);
  if (query.q) params.set('q', query.q);
  if (query.saved) params.set('saved', '1');
  if (query.confirming) params.set('confirm', 'super');

  const search = params.toString();
  return search === '' ? base : `${base}?${search}`;
}

/** Whether a person matches the search box: name or email, case-insensitive substring. */
export function matchesSearch(
  person: { name: string | null; email: string },
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;

  return (
    (person.name ?? '').toLowerCase().includes(needle) ||
    person.email.toLowerCase().includes(needle)
  );
}

/**
 * How somebody is named on this page, and the one place that question is answered.
 *
 * ⚠️ **Every caller must use this, including the server-side check on the confirmation box.**
 * A name column that is an empty string rather than null is the case that separates `name ??
 * email` from `name || email`: the first keeps the empty string. Two callers disagreeing that
 * way means the page asks somebody to type an address while the server compares against
 * nothing — and `typedNameMatches` refuses an empty expected name, so the confirmation could
 * never be completed by anybody. Found before it shipped, by noticing that no fixture in this
 * repository has a name at all.
 */
export function displayName(person: { name: string | null; email: string }): string {
  const name = (person.name ?? '').trim();
  return name === '' ? person.email : name;
}

/** The first word of somebody's name, for a sentence that addresses them. */
export function firstName(person: { name: string | null; email: string }): string {
  const name = (person.name ?? '').trim();
  if (name === '') return person.email;
  return name.split(/\s+/)[0] ?? person.email;
}

/** The initials drawn in the avatar. Never more than two, and never empty. */
export function initialsFor(person: { name: string | null; email: string }): string {
  const name = (person.name ?? '').trim();

  if (name !== '') {
    const words = name.split(/\s+/).filter((word) => word.length > 0);
    const first = words[0]?.charAt(0) ?? '';
    const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
    return (first + last).toUpperCase();
  }

  // No name recorded, which is every account that signed up before #61. The address is the
  // only thing there is, and its first character is more use than a blank circle.
  return person.email.charAt(0).toUpperCase();
}
