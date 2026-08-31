import {
  AGE_CATEGORY_CODES,
  NN_ENTRY_GENDERS,
  transferEntry,
  ageCategoryFor,
  ageCategoryLabel,
  cancelEntry,
  createAnonClient,
  createManualEntry,
  createUserClient,
  csvDocument,
  effectiveCategory,
  fetchCancellablePurchase,
  fetchCurrentEntryState,
  fetchEntryDetail,
  fetchEntryList,
  fetchExport,
  fetchInterestList,
  fetchMedicalNote,
  entryRequestWords,
  formatLondon,
  formatEntryReference,
  formatLondonDate,
  formatPence,
  isExportKind,
  medicalRetentionClause,
  ENTRY_STATUSES,
  type AdminDiscountCode,
  type AdminEntry,
  type AdminEntryDetail,
  type AdminEntryDetailEntrant,
  type AdminEntryList,
  type AdminEventFigures,
  type AdminExport,
  type AdminInterestList,
  type AdminMedicalNote,
  type AdminResult,
  type AgeCategoryCode,
  type EntryRequest,
  type ExportKind,
  type Gender,
  type ManualEntrant,
  type ManualEntryReason,
  type MedicalExportRow,
  type ResultPlacement,
  type StartListExportRow,
  type UnavailableCause,
} from '@src/shared';
import type { SupabaseConfig } from '@src/shared';
import { html, raw, type Html } from './html';
import { can, masthead, notFound, page, type AdminViewer } from './admin-shell';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { cookieValue } from './cookies';
import { refundPayment, stripeConfig, type StripeEnv } from './stripe';
import { ADMIN_PREFIX, NN_RACE_SLUG } from './routing';

/** Where this section lives, now that it is a section rather than the whole surface. */
const NN_SECTION = `${ADMIN_PREFIX}/nn`;

/**
 * `/admin/nn/` — the entries, the interest list, the exports, and nothing that changes a record.
 *
 * ## Who may reach it
 *
 * **One role: `nn-admin`.** #58 moved this surface out from under `/nn/admin` and behind the
 * session `/account/` mints, and `admin.ts` is what checks the role before any of this runs.
 * The two-credential arrangement ADR-013 built — a Worker secret plus a key per volunteer — is
 * gone from the Worker; #57 left its four database functions in place and #63 removes them.
 *
 * **The old addresses all still resolve.** Every `/nn/admin/*` address redirects here, because
 * they are in a published runbook and a runbook that 404s is worse than one that is out of
 * date. `routing.ts`'s `adminPathForNnAdminPath` is the whole of it.
 *
 * **A caller who may not be here discloses nothing about what is behind it.** `admin.ts`
 * answers 404 for every address under the prefix, so an event that exists and one that does
 * not are the same answer, and so are an entrant id that names a row and one that does not.
 *
 * ## One page, in one order, and the order is the design
 *
 * **The second pass replaced an index of links with a single page**, and the sequence is the
 * argument rather than a layout:
 *
 *   1. the shell — the masthead and the navigation, both `admin-shell.ts`'s since #58;
 *   2. the event bar — which running, when, and whether it is taking entries;
 *   3. **anything needing a human**, first, because it is the only thing here with a deadline
 *      attached to a person. It renders **only when there is something** — no empty state and no
 *      zero badge, because a panel that is usually empty is a panel nobody reads;
 *   4. where the race stands;
 *   5. **who has entered**, by category — the question the club is asked all autumn and had
 *      to answer by counting the list by eye;
 *   6. **race morning**, which is what somebody actually opens under pressure;
 *   7. the medical notes and the affiliation check;
 *   8. the entries;
 *   9. the interest list.
 *
 * The tenth thing the design asks for — **the audit trail — is deliberately absent**, and it is
 * not an oversight. `entries.admin_audit` has row-level security on, no policy and no grant, and
 * the anon role may execute thirteen functions of which none reads it. Rendering it needs a
 * fourteenth, and a fourteenth is a decision somebody takes in a diff rather than a side effect
 * of a layout — CLAUDE.md's stop-and-ask, and the test in `packages/db/tests/entries.test.ts` is
 * what forces it. Until then the trail is read through
 * `docs/delivery/runbooks/entries-admin.md`.
 *
 * ## The club brand, not the campaign theme
 *
 * `nn-theme.css` is not imported here and must not be. This is a tool rather than a page a
 * runner reads — all content and no frame — and it will serve Pass the Buck, which has nothing
 * to do with Halloween. Every colour is a `--colour-*` name out of `base.css`; there is not one
 * hex value in `nn-admin.css`. Every number is in the mono face with tabular figures, so a
 * count does not reflow as it changes.
 *
 * ## What it deliberately cannot do
 *
 * **Nothing here writes to an entry.** No editing, no refunds, no transfers, no manual entry,
 * no resend. Each of those is a decision about what it means to change a record somebody paid
 * for — a refund has to agree with Stripe, a transfer has to decide whose consent applies, a
 * correction has to decide whether the audit says who made it — and they belong together in a
 * slice that can think about them together. **The page is built to make that gap visible rather
 * than to hide it**: a status is a word, not a control, and every button on it reads rather than
 * writes.
 *
 * The one thing that does write is `entries.admin_audit`, and it is written by the database
 * inside the same transaction as the read it records.
 *
 * ## Personal data, and the rules this surface follows
 *
 *   * **No personal data in a URL or a query string, ever.** The filters are enumerated words,
 *     the event is a slug, and the one identifier that travels — an entrant id, to read a
 *     medical note — travels in a `POST` body for that reason.
 *   * **Medical notes are not in the list.** A note is one deliberate act on one entrant, and
 *     the act is recorded by the database before the note is returned.
 *   * **No personal data in any log, including error paths.** Every `console.error` below
 *     carries a PostgREST code or a classification. Nothing here logs the handle either: it is
 *     constrained to a slug rather than a name, but a log is not the place to find out somebody
 *     ignored that.
 *   * **`noindex` regardless of the site-wide setting**, as a header and as a meta element.
 */

/**
 * Everything this section reads, bound to the caller who is reading it.
 *
 * **One object rather than an env and a credential threaded through nine functions**, and the
 * reason is #57's: the club's entry list is reachable through two doors and there must be
 * exactly one room behind them. The database made the four reads one function each with two
 * wrappers; `packages/shared/src/admin.ts` gave each one parser and two callers; this is the
 * same move at the last layer, so a renderer cannot accidentally read through a door its
 * caller was not let in by.
 */
interface NnAdminReader {
  entryList(slug: string): ReturnType<typeof fetchEntryList>;
  interestList(): ReturnType<typeof fetchInterestList>;
  medicalNote(entrantId: string): ReturnType<typeof fetchMedicalNote>;
  takeExport(eventSlug: string, kind: ExportKind): ReturnType<typeof fetchExport>;
  currentSlug(): ReturnType<typeof fetchCurrentEntryState>;
}

function readerFor(cfg: SupabaseConfig, accessToken: string): NnAdminReader {
  const asPerson = createUserClient(cfg, accessToken);

  return {
    entryList: (slug) => fetchEntryList(asPerson, slug),
    interestList: () => fetchInterestList(asPerson),
    medicalNote: (entrantId) => fetchMedicalNote(asPerson, entrantId),
    takeExport: (eventSlug, kind) => fetchExport(asPerson, eventSlug, kind),
    // **The anon client, deliberately.** Which running is current is public configuration —
    // `/nn/` asks the same question on every page load — and asking it as the signed-in person
    // would imply it were privileged. `entry_state` is granted to `anon` and `authenticated`
    // alike for exactly this reason.
    currentSlug: () => fetchCurrentEntryState(createAnonClient(cfg), NN_RACE_SLUG),
  };
}

/**
 * Handle one request under `/admin/nn/`.
 *
 * The caller has already established that somebody is signed in and holds `nn-admin`; there is
 * no credential check here and no route that may be reached without one. `segments` is what
 * followed `/admin/nn`, so `[]` is this section's own front page.
 */
export async function handleNnSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  env: StripeEnv,
  segments: string[],
  url: URL,
  secure: boolean,
): Promise<Response> {
  const reader = readerFor(cfg, viewer.accessToken);

  // **The dashboard, and the same renderer for a named running.** `/admin/nn/` asks the database
  // which running of `nn` is current — no year in the route, for the reason `/nn/` has none — and
  // `/admin/nn/entries/<slug>/` is how a past running or a fixture is looked at. One page, two
  // ways in, so publishing 2027 is a row rather than an edit here.
  if (request.method === 'GET' && segments.length === 0) {
    return dashboardResponse(reader, viewer, null, url);
  }

  if (request.method === 'GET' && segments.length <= 2 && segments[0] === 'entries') {
    return dashboardResponse(reader, viewer, segments[1] ?? null, url);
  }

  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'interest') {
    return interestResponse(reader, viewer);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'medical') {
    return medicalResponse(request, reader, viewer);
  }

  // **The start list is a POST because rendering it writes an audit row.** Printing a sheet of
  // names and emergency contacts is taking a copy out of the platform, which is the same act the
  // CSV is, so it goes through `entries.export()` and is recorded the same way. A GET would let a
  // prefetch, a scanner or a link in a chat client file an export against somebody's account.
  if (
    request.method === 'POST' &&
    segments.length === 1 &&
    segments[0] === 'start-list'
  ) {
    return startListResponse(request, reader, viewer);
  }

  // **The medical sheet on paper, and it is a POST for exactly the reason the start list is.**
  // Rendering it takes a copy of every note out of the platform, so it goes through
  // `entries.export()` and is recorded as `medical_export` — the same audit row the CSV writes,
  // because it is the same disclosure in a different wrapper.
  //
  // **It exists because the CSV was the only way to read this sheet, and a CSV is not a
  // document.** A volunteer downloading it got a file their machine opened in whatever it felt
  // like — Quick Look renders one as a single mangled column — and the thing they wanted was a
  // sheet to hand a first aider. The start list has had a printable page since it was written;
  // this is the more sensitive of the two documents and had only the file.
  if (
    request.method === 'POST' &&
    segments.length === 1 &&
    segments[0] === 'medical-sheet'
  ) {
    return medicalSheetResponse(request, reader, viewer);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'export') {
    return exportResponse(request, reader, viewer);
  }

  // **One entry, in full, and it is a POST for the reason the medical note is.** No personal
  // data in a URL or a query string, ever — the purchase id travels in the body, exactly as
  // the entrant id does for `medical` and as the purchase id already does for `cancel` and
  // `transfer`. It reads and changes nothing, so it needs no CSRF token and mints none.
  //
  // Behind `nn.entry.read`, checked in `admin.ts` before this file runs and again inside
  // `entries.admin_entry_detail()`, which is the control. It discloses what the entry list and
  // the three exports already disclose to the same permission, which is why it needs no
  // permission of its own and writes no audit row — see ADR-024.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'entry') {
    return entryDetailResponse(request, cfg, viewer);
  }

  // **Cancelling, and it is the only thing under this prefix that changes a record.**
  // Everything else here reads. `nn.entry.cancel` is a separate permission from the reads even
  // though `nn-admin` carries both — so a future role that reads without undoing needs no
  // change here. It is checked before the handler runs, in the same place and for the same
  // reason the section itself is, and again inside `entries.cancel_entry()`, which is the
  // control. See ADR-018 for why it sits with the reads rather than with `super-admin`.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'cancel') {
    return can(viewer, 'nn.entry.cancel')
      ? cancelResponse(request, cfg, env, viewer, secure)
      : notFound();
  }

  // **Transferring, and it shares `nn.entry.cancel` rather than adding a permission.** It
  // reuses the one that already means "may undo an entry somebody paid for", because changing
  // who holds an existing place is within a hair of that. A dedicated `nn.entry.transfer` is
  // the cleaner answer and is a decision somebody should take on purpose — see the migration.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'transfer') {
    return can(viewer, 'nn.entry.cancel')
      ? transferResponse(request, cfg, viewer, secure)
      : notFound();
  }

  // **Giving a place away, and it is the one thing here with a permission of its own.**
  // `nn.entry.create` is the eighth, and it did not reuse `nn.entry.cancel` for the reason
  // ADR-028 gives: undoing an entry somebody bought and adding a runner to a course with a
  // hard limit are different powers, and this is the only one on the surface that costs the
  // club money rather than changing a record. Checked here and again inside
  // `entries.create_manual_entry()`, which is the control.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'assign') {
    return can(viewer, 'nn.entry.create')
      ? assignResponse(request, reader, cfg, viewer, secure)
      : notFound();
  }

  // An address under the prefix that is not one of the seven. Answered here rather than fallen
  // through, because falling through would hand it to the assets binding and the 404 page would
  // arrive without the `noindex` header this surface sets on everything.
  return notFound();
}

// -----------------------------------------------------------------------------------------
// The dashboard
// -----------------------------------------------------------------------------------------

/** The sorts on offer. Enumerated, because a sort key from a query string is an injection. */
const SORTS = ['name', 'entered', 'category', 'status'] as const;

type Sort = (typeof SORTS)[number];

/**
 * The statuses a filter link may name.
 *
 * `attention` is not one of the table's own statuses and is the reason this list exists
 * separately: "needs a human" is a flag on a purchase rather than a state of one, and it is the
 * filter somebody actually wants on the morning they find out the field is oversold.
 */
// **`requested` is a view, not a status**, exactly as `attention` is. A row it matches has a
// real status of its own — almost always `paid` — and the filter answers a different question:
// which entries has somebody asked the club to do something about, and nobody has yet.
const STATUS_FILTERS = ['all', ...ENTRY_STATUSES, 'attention', 'requested'] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * **What is out of the default view, and why each of them is a default rather than a rule.**
 *
 * The page is opened to look at *the field* — who is running on 1 November. Everything here is
 * a row about somebody who is not:
 *
 *   * `fee:tester` — a tester's place is a real place, and the capacity predicate counts it;
 *     excluding it from the thing being tested would make the test worthless. It is simply not
 *     what somebody opens this page to look at, and a race director scanning 250 names should
 *     not have the club's own probes among them.
 *   * `status:refunded` — a cancelled entry with its runner deleted, kept on the page so a
 *     volunteer can see the place came back. Useful once; noise every other time.
 *   * `status:expired` — a hold that lapsed. By the time it is on screen it has already
 *     released its place and there is nothing to do about it.
 *
 * On a race that fills, the last two together are the majority of the rows and none of the
 * work. **Nothing is filtered away permanently**: the line under the chips says what is being
 * left out and links to the view that includes it, which is the rule this page follows about
 * never hiding anything without saying so.
 *
 * Expressed as *hidden* codes rather than by pre-selecting the statuses and fees that remain,
 * because those are not all known here: fee codes come from the rows, so a fourth fee is a
 * migration and not a deploy.
 */
const HIDDEN_BY_DEFAULT: readonly string[] = [
  'fee:tester',
  'status:refunded',
  'status:expired',
];

/**
 * The two things the note offers to put back, each toggled as a unit.
 *
 * **Two lines rather than three chips.** A chip row would have to show a selection nobody made
 * in order to be honest about the default; a sentence says what is missing in the place
 * somebody reads. The refunded and expired rows move together because they are one question —
 * *do you want to see places that came back?* — and separating them would be two controls for
 * one decision.
 */
const HIDE_GROUPS = [
  {
    values: ['fee:tester'] as const,
    hidden: 'Test entries are not shown.',
    shown: 'Test entries are shown.',
  },
  {
    values: ['status:refunded', 'status:expired'] as const,
    hidden: 'Refunded entries and lapsed holds are not shown.',
    shown: 'Refunded entries and lapsed holds are shown.',
  },
] as const;

/**
 * **Every filter is a set now, and an empty set means "all".**
 *
 * Single-select could not answer the ordinary question — "paid and held" is what *who has a
 * place right now* means, and the page could not be asked it. Repeated query parameters carry
 * it (`?status=paid&status=pending`), which works with no JavaScript and leaves the state
 * legible in the address bar.
 *
 * **Exclusion is `hide`**, namespaced so one parameter covers both rows: `hide=fee:tester`,
 * `hide=status:refunded`. It is separate from the include sets rather than a third chip state,
 * because a link that cycles through three meanings cannot say what it does in its own text —
 * and this page is read by two volunteers a few times a year, not learned.
 *
 * `hide=none` is how "show me everything" is written, and it exists because the *absence* of
 * the parameter is not neutral: it means the default above.
 */
interface EntryFilters {
  /** Empty means every status. */
  status: ReadonlySet<string>;
  /** Empty means every entry type. */
  fee: ReadonlySet<string>;
  /** Namespaced `fee:` / `status:` values to leave out, whatever the include sets say. */
  hide: ReadonlySet<string>;
  /**
   * Whether `hide` is the default rather than something somebody asked for.
   *
   * ⚠️ **This distinction is a defect's worth of difference.** "Hidden beats included" is right
   * for a hide somebody *chose* — a volunteer who has asked not to see test entries should not
   * have a status chip quietly bring them back. It is wrong for the default: with `expired`
   * hidden out of the box, pressing the **Hold expired** chip returned an empty table and "0 of
   * 6 shown", which is a filter that can never match — the exact shape of #116, where the
   * Refunded filter could not match a refunded row and a volunteer concluded there had been no
   * refunds.
   *
   * So an *explicit* include overrules the default and never overrules a chosen hide.
   */
  hideIsDefault: boolean;
  sort: Sort;
}

function readFilters(url: URL): EntryFilters {
  const sort = url.searchParams.get('sort') ?? 'name';

  const status = new Set(
    url.searchParams
      .getAll('status')
      .filter((value) => value !== 'all')
      .filter((value) => (STATUS_FILTERS as readonly string[]).includes(value)),
  );

  // Not validated against a list written here — see the note the old reader carried: fee codes
  // come from the rows, so a fourth one is a migration and not also a deploy. An unknown code
  // simply matches nothing, which is the honest answer to a hand-typed address.
  const fee = new Set(url.searchParams.getAll('fee').filter((value) => value !== 'all'));

  const hidden = url.searchParams.getAll('hide');

  return {
    status,
    fee,
    hideIsDefault: hidden.length === 0,
    hide: new Set(
      hidden.length === 0
        ? HIDDEN_BY_DEFAULT
        : hidden.filter((value) => value !== 'none'),
    ),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : 'name',
  };
}

/** Whether this row is flagged and nobody has cleared the flag. */
export function needsAHuman(entry: AdminEntry): boolean {
  return entry.attention !== null && !entry.attentionResolved;
}

/**
 * Filter and sort in the Worker rather than in SQL.
 *
 * A couple of hundred rows, four enumerated sorts and two enumerated filters. Every variant done
 * in the function would be a branch somebody has to read before they can trust what the page is
 * showing them, and the data is already in memory.
 */
export function viewEntries(entries: AdminEntry[], filters: EntryFilters): AdminEntry[] {
  const includedByStatus = (entry: AdminEntry): boolean =>
    filters.status.size === 0 ||
    [...filters.status].some((wanted) => {
      if (wanted === 'attention') {
        return needsAHuman(entry);
      }

      // **Outstanding only.** A request a volunteer has already dealt with is history, and a
      // filter that kept showing it would fill up with rows there is nothing left to do about
      // — which is how a filter stops being looked at.
      if (wanted === 'requested') {
        return entry.requestedAction !== null && !entry.requestResolved;
      }

      return entry.status === wanted;
    });

  // **Hidden beats included for a hide somebody chose, and never for the default.** See
  // `hideIsDefault`: a volunteer who has asked not to see test entries should not have a chip
  // quietly bring them back, but pressing **Hold expired** on a page that hides lapsed holds by
  // default has to show lapsed holds — otherwise it is a filter that can never match, which is
  // #116 in a new place.
  //
  // **A `pending` row whose hold has lapsed counts as expired here**, and that is not a
  // shortcut. It *is* an expired hold — the place is already back in the pool — and it stays
  // `pending` only until the five-minute sweep reaches it. Matching on the stored word alone
  // would leave the page's busiest kind of dead row on screen for anybody who asked not to see
  // dead rows, which is the whole of what this default is for.
  const lapsed = (entry: AdminEntry): boolean =>
    entry.status === 'pending' && (minutesLeft(entry.holdExpiresAt) ?? 1) <= 0;

  const askedFor = (value: string, set: ReadonlySet<string>): boolean =>
    filters.hideIsDefault && set.has(value);

  const hidden = (entry: AdminEntry): boolean => {
    if (askedFor(entry.feeCode, filters.fee) || askedFor(entry.status, filters.status)) {
      return false;
    }

    // The same escape for a lapsed hold, which is `pending` in the column and `expired` to
    // everybody looking at it.
    if (lapsed(entry) && askedFor('expired', filters.status)) {
      return false;
    }

    return (
      filters.hide.has(`fee:${entry.feeCode}`) ||
      filters.hide.has(`status:${entry.status}`) ||
      (filters.hide.has('status:expired') && lapsed(entry))
    );
  };

  const kept = entries.filter(
    (entry) =>
      includedByStatus(entry) &&
      (filters.fee.size === 0 || filters.fee.has(entry.feeCode)) &&
      !hidden(entry),
  );

  // **A cancelled entry has no name, and it sorts last in every order rather than in some
  // arbitrary place.** It is the one row on this page that is about a place which came back
  // rather than about somebody who is running, so a volunteer scanning for runners should not
  // meet it in the middle of the alphabet. Deterministic either way, which is what stops two
  // refunds swapping places between two loads of the same page.
  const byName = (a: AdminEntry, b: AdminEntry): number => {
    if (a.lastName === null || b.lastName === null) {
      return Number(a.lastName === null) - Number(b.lastName === null);
    }

    return (
      a.lastName.localeCompare(b.lastName, 'en-GB') ||
      (a.firstName ?? '').localeCompare(b.firstName ?? '', 'en-GB')
    );
  };

  // Same reason, for the age sort: an age derived from a date of birth that was deleted with
  // the entrant is null, and a null must not read as a newborn at the top of the list.
  const ageOf = (entry: AdminEntry): number => entry.age ?? Number.MAX_SAFE_INTEGER;

  return [...kept].sort((a, b) => {
    if (filters.sort === 'entered') {
      // Newest first: the interesting end of a list somebody is watching fill up.
      return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
    }

    if (filters.sort === 'category') {
      return ageOf(a) - ageOf(b) || byName(a, b);
    }

    if (filters.sort === 'status') {
      return a.status.localeCompare(b.status) || byName(a, b);
    }

    return byName(a, b);
  });
}

async function dashboardResponse(
  reader: NnAdminReader,
  viewer: AdminViewer,
  requestedSlug: string | null,
  url: URL,
): Promise<Response> {
  let slug = requestedSlug;

  if (slug === null) {
    const current = await reader.currentSlug();

    if (!current.ok) {
      console.error(`entries.current_entry_state unavailable — ${current.error}`);
      return page('Race admin', unavailablePage(viewer), { status: 503 });
    }

    slug = current.value.slug;
  }

  const list = await reader.entryList(slug);

  // **The interest count is a second read, and a failure of it is not a failure of the page.**
  // One panel out of eight depends on it; the seven that do not include the one an organiser
  // opens at nine in the morning. So it is asked for separately and its absence renders as "could
  // not be read" in its own panel rather than as a 503 over the start list.
  const interest = await reader.interestList();

  return listResponse(list, viewer, 'Race admin', (value) =>
    dashboardPage(viewer, value, interest, readFilters(url), url),
  );
}

// -----------------------------------------------------------------------------------------
// The interest list
// -----------------------------------------------------------------------------------------

async function interestResponse(
  reader: NnAdminReader,
  viewer: AdminViewer,
): Promise<Response> {
  const list = await reader.interestList();

  return listResponse(list, viewer, 'Interest', (value) => interestPage(viewer, value));
}

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

async function medicalResponse(
  request: Request,
  reader: NnAdminReader,
  viewer: AdminViewer,
): Promise<Response> {
  const form = await readForm(request);
  const entrantId = form?.get('entrantId');

  if (typeof entrantId !== 'string' || !isUuid(entrantId)) {
    return page('Medical note', medicalNotFoundPage(viewer), { status: 404 });
  }

  const note = await reader.medicalNote(entrantId);

  if (note.status === 'unavailable') {
    console.error(`entries.entrant_medical unavailable — ${note.error}`);
    return page('Medical note', unavailablePage(viewer), { status: 503 });
  }

  if (note.status !== 'ok') {
    return page('Medical note', medicalNotFoundPage(viewer), { status: 404 });
  }

  return page('Medical note', medicalPage(viewer, note), {});
}

// -----------------------------------------------------------------------------------------
// The exports, and the one that is a page rather than a file
// -----------------------------------------------------------------------------------------

async function exportResponse(
  request: Request,
  reader: NnAdminReader,
  viewer: AdminViewer,
): Promise<Response> {
  const form = await readForm(request);
  const kind = form?.get('kind');
  const event = form?.get('event');

  if (typeof kind !== 'string' || !isExportKind(kind) || typeof event !== 'string') {
    return notFound();
  }

  const taken = await reader.takeExport(event, kind);

  if (taken.status === 'unavailable') {
    console.error(`entries.export unavailable — ${taken.error}`);
    return page('Export', unavailablePage(viewer), { status: 503 });
  }

  if (taken.status !== 'ok') {
    return notFound();
  }

  return csvResponse(taken.export);
}

/**
 * The start list, as a page built to be printed.
 *
 * Same function, same audit row and same columns as the CSV — this differs only in that it comes
 * back as markup with a print stylesheet rather than as a file, because the thing a registration
 * desk wants at quarter past nine is paper on a clipboard.
 */
async function startListResponse(
  request: Request,
  reader: NnAdminReader,
  viewer: AdminViewer,
): Promise<Response> {
  const form = await readForm(request);
  const event = form?.get('event');

  if (typeof event !== 'string') {
    return notFound();
  }

  const taken = await reader.takeExport(event, 'start-list');

  if (taken.status === 'unavailable') {
    console.error(`entries.export unavailable — ${taken.error}`);
    return page('Start list', unavailablePage(viewer), { status: 503 });
  }

  if (taken.status !== 'ok' || taken.export.kind !== 'start-list') {
    return notFound();
  }

  return page('Start list', startListPage(viewer, taken.export), {});
}

/**
 * The medical sheet, as a page built to be printed.
 *
 * Same function, same audit row and same rows as the CSV — this differs only in that it comes
 * back as markup rather than as a file, because what a first aider needs at race HQ is a sheet
 * of paper and what a browser does with a downloaded CSV is not the club's to control.
 */
async function medicalSheetResponse(
  request: Request,
  reader: NnAdminReader,
  viewer: AdminViewer,
): Promise<Response> {
  const form = await readForm(request);
  const event = form?.get('event');

  if (typeof event !== 'string') {
    return notFound();
  }

  const taken = await reader.takeExport(event, 'medical');

  if (taken.status === 'unavailable') {
    console.error(`entries.export unavailable — ${taken.error}`);
    return page('Medical sheet', unavailablePage(viewer), { status: 503 });
  }

  if (taken.status !== 'ok' || taken.export.kind !== 'medical') {
    return notFound();
  }

  return page('Medical sheet', medicalSheetPage(viewer, taken.export), {});
}

/** The three files, and the columns each one carries. */
function csvResponse(taken: AdminExport): Response {
  const body =
    taken.kind === 'ea'
      ? // **No number column since 29 August 2026, and the file is still worth downloading.**
        // The club stopped asking for England Athletics numbers, so there is nothing to check
        // a runner against — but this is the only document that says how many entries took
        // the affiliated price, which is the count ARC Rule 21(2)(b)'s Unattached Runner Levy
        // is assessed against. A treasurer needs that; nobody needs an empty column.
        csvDocument(
          ['Last name', 'First name', 'Club', 'Phone', 'Entry type', 'Paid (pence)'],
          taken.rows.map((row) => [
            row.lastName,
            row.firstName,
            row.club,
            row.phone,
            row.feeLabel,
            row.amountPence,
          ]),
        )
      : taken.kind === 'start-list'
        ? csvDocument(
            [
              'Last name',
              'First name',
              'Club',
              'Category',
              // **Named "Runner phone" beside "Emergency phone", not "Phone".** This file is
              // opened in a spreadsheet by somebody who did not build it, and two columns of
              // numbers where one of them is a next of kin is a mistake worth spending a word
              // on. ADR-025.
              'Runner phone',
              'Emergency contact',
              'Emergency phone',
            ],
            // **The same column the printed sheet shows, and it has to be the same.** The CSV
            // and the paper start list are two renderings of one export; a guide marked on
            // one and given an age category on the other is how two documents about the same
            // 250 people start disagreeing on race morning.
            taken.rows.map((row) => [
              row.lastName,
              row.firstName,
              row.club,
              startListCategory(row),
              row.phone,
              row.emergencyContactName,
              row.emergencyContactPhone,
            ]),
          )
        : csvDocument(
            ['Last name', 'First name', 'Club', 'Medical note'],
            taken.rows.map((row) => [row.lastName, row.firstName, row.club, row.notes]),
          );

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // **The filename carries the event and the kind and nothing else.** A file of entrants
      // ends up in a downloads folder, in a mail attachment and on a memory stick, and the one
      // thing its name must not do is describe a person.
      'content-disposition': `attachment; filename="${taken.event.slug}-${taken.kind}.csv"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

// -----------------------------------------------------------------------------------------
// The shell
// -----------------------------------------------------------------------------------------

/**
 * What this surface says when it could not ask its question.
 *
 * **`cause` exists because one of these is not an outage and telling somebody it is has cost
 * real hours, twice.** PostgREST answers `PGRST202` when the function a caller named is not in
 * its schema cache and `PGRST203` when it cannot choose between two candidates; both mean the
 * database has not got the thing this build of the Worker is asking for. That is a state this
 * repository deliberately tolerates — expand, migrate, contract, with nothing sequencing a
 * migration against the Cloudflare deploy — and therefore a state it will keep entering.
 *
 * Said as *"the database could not be reached — try again in a moment"* it is **false in both
 * halves**: the database is perfectly healthy, and trying again can never help. Somebody on
 * call retries, waits, retries, and eventually reads a Cloudflare log to find a code the page
 * never mentioned. Both halves of that happened here on 29 August 2026, on a deploy whose
 * migrations had not applied at all.
 */
function unavailablePage(viewer: AdminViewer, cause?: UnavailableCause): Html {
  if (cause === 'missing-function') {
    return html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <h1>The site is ahead of its database</h1>
        <p>
          This page asked the database for something it has not got yet, so it cannot say
          what is in it. <strong>It is not saying the list is empty</strong>, and nothing
          is wrong with any entry.
        </p>
        <p>
          <strong>Trying again will not help.</strong> It means a change to the site went
          live before the database change it needs — so the fix is to apply the waiting
          migrations, not to wait. Whoever looks after deploys will find it in the
          <span class="admin-mono">deploy-db</span> workflow.
        </p>
      </main>`;
  }

  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>That could not be read</h1>
      <p>
        The club’s database could not be reached, so this page cannot say what is in it.
        <strong>It is not saying the list is empty.</strong> Try again in a moment.
      </p>
    </main>`;
}

function medicalNotFoundPage(viewer: AdminViewer): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>No such entry</h1>
      <p>Nothing was found for that entry. It may have been removed.</p>
      <p><a href="${NN_SECTION}/">Back to race admin</a></p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// The page, section by section
// -----------------------------------------------------------------------------------------

function dashboardPage(
  viewer: AdminViewer,
  list: AdminEntryList,
  interest: AdminResult<AdminInterestList>,
  filters: EntryFilters,
  url: URL,
): Html {
  const figures = list.event.figures;
  const flagged = list.entries.filter(needsAHuman);

  return html`${masthead(viewer)} ${eventBar(list, figures)}
    <main class="admin-page" id="main">
      ${attentionSection(list, flagged)} ${raceStandsSection(list, figures, interest)}
      ${categoriesSection(list)} ${raceMorningSection(list)}
      ${medicalAndAffiliationSection(list, figures)} ${discountCodesSection(list)}
      ${entriesSection(list, filters, url, viewer)} ${interestSection(interest)}
    </main>`;
}

/**
 * 2. The event bar — which running, when, and whether it is taking entries.
 *
 * **Driven by the database, not written into the page.** The state comes from the same window
 * `entries.entry_state()` reports, derived here from the two timestamps the event carries.
 *
 * **There is no closing time, and the bar says so rather than guessing.**
 * `entries.events.entries_close_at` is null because the club has not decided, and a plausible
 * date on this bar is a date a volunteer would repeat to a runner. The mockup showed one; it was
 * invented, like every other number on it.
 */
function eventBar(list: AdminEntryList, figures: AdminEventFigures | null): Html {
  return html`<div class="admin-eventbar">
    <h1>${list.event.displayName}</h1>
    <p class="admin-eventbar-when">
      ${formatLondonDate(`${list.event.eventDate}T00:00:00Z`)}
    </p>
    ${entryWindowPill(figures)}
    <p class="admin-eventbar-closes">${entryWindowDetail(figures)}</p>
  </div>`;
}

function entryWindowPill(figures: AdminEventFigures | null): Html {
  if (figures === null) {
    return html`<span class="admin-pill admin-pill-shut">Entry window not known</span>`;
  }

  const now = Date.now();
  const open = figures.entriesOpenAt === null ? null : Date.parse(figures.entriesOpenAt);
  const close =
    figures.entriesCloseAt === null ? null : Date.parse(figures.entriesCloseAt);

  // The same three states `entry_state()` reports, and `pre_open` covers "not yet" and "nobody
  // has decided yet" together — which to somebody reading this bar are the same thing.
  if (open === null || now < open) {
    return html`<span class="admin-pill admin-pill-shut">Entries not open</span>`;
  }

  if (close !== null && now >= close) {
    return html`<span class="admin-pill admin-pill-shut">Entries closed</span>`;
  }

  return html`<span class="admin-pill admin-pill-open">Entries open</span>`;
}

function entryWindowDetail(figures: AdminEventFigures | null): Html {
  if (figures === null || figures.entriesOpenAt === null) {
    return html`Opening and closing times are <strong>not decided yet</strong>, so nothing
      is published about them.`;
  }

  if (figures.entriesCloseAt === null) {
    return html`Opened ${formatLondon(figures.entriesOpenAt)}. A closing time is
      <strong>not decided yet</strong>.`;
  }

  return html`Closes ${formatLondon(figures.entriesCloseAt)}`;
}

/**
 * 3. Anything needing a human — **first, and only when there is something.**
 *
 * No empty state and no zero badge. A panel that is usually empty is a panel somebody learns to
 * scroll past, and this is the one thing on the page with a deadline attached to a person: an
 * over-capacity payment means a runner has paid for a place the race did not have, and they
 * should hear it from the club rather than find out on the day.
 *
 * **Colour carries none of the meaning.** The words "NEEDS A HUMAN", the words "Over capacity",
 * a heavy rule and bold weight all survive a monochrome screen, a colour-blind reader and a
 * printout. `--colour-error` is on top of that rather than instead of it.
 */
function attentionSection(list: AdminEntryList, flagged: AdminEntry[]): Html {
  if (flagged.length === 0) {
    return html``;
  }

  const over = flagged.filter((entry) => entry.attention === 'over_capacity');

  return html`<section class="admin-attention" aria-labelledby="needs-a-human">
    <p class="admin-attention-badge">Needs a human</p>
    <h2 id="needs-a-human">
      ${
        over.length === flagged.length
          ? plural(
              over.length,
              'One payment arrived after its place had gone',
              `${over.length} payments arrived after their places had gone`,
            )
          : plural(
              flagged.length,
              'One entry is waiting for a person',
              `${flagged.length} entries are waiting for a person`,
            )
      }
    </h2>
    ${
      over.length === 0
        ? null
        : html`<p>
            Their hold lapsed, then the payment came through anyway. They have paid and
            they are counted, so the field is over. Somebody has to decide whether that
            stands or is refunded — and the runner should hear it from the club, not find
            out on the day. Neither decision can be taken on this page; the
            <span class="admin-mono">entries-attention</span> runbook has both.
          </p>`
    }
    <ul class="admin-attention-list">
      ${flagged.map(
        (entry) =>
          html`<li>
            <span class="admin-chip admin-chip-flag"
              >${attentionWords(entry.attention)}</span
            >
            <span class="admin-attention-what">
              ${
                entry.status === 'paid' && entry.paidAt !== null
                  ? html`Paid ${formatLondon(entry.paidAt)} ·`
                  : null
              }
              <span class="admin-mono">${formatPence(entry.amountPence)}</span> ·
              ${entry.feeLabel}
            </span>
            <span class="admin-mono admin-quiet">
              entry ${entryReference(entry, list.event.slug)}
            </span>
          </li>`,
      )}
    </ul>
    <p class="admin-quiet admin-attention-foot">
      Listed by entry reference rather than by name, because this panel is a queue of
      decisions rather than a list of people. The names are in the table below.
    </p>
    ${
      list.event.attention > flagged.length
        ? html`<p class="admin-error">
            <strong>${list.event.attention}</strong> purchases are flagged in the database
            and only ${flagged.length} are on this page — the rest are older than the most
            recent ${list.returned} entries. The exports carry every one of them.
          </p>`
        : null
    }
  </section>`;
}

function attentionWords(attention: string | null): string {
  if (attention === 'over_capacity') {
    return 'Over capacity';
  }

  return attention === null ? 'Needs a person' : `Needs a person — ${attention}`;
}

/**
 * 4. Where the race stands.
 *
 * **Every figure here is asked of the database rather than counted off the row array**, which is
 * capped at the most recent 2,000. Counting the array would put a fees total over 2,000 rows
 * beside a places-taken figure over all of them, and two numbers that disagree on one panel are
 * worse than one number that is missing.
 *
 * ## The bar is `aria-hidden`, and the numbers beside it are why
 *
 * It restates the figure above it and the legend below it, so announcing it as well would read
 * the same fact three times.
 *
 * The ordinary fill clears WCAG's 3:1 floor for non-text UI at 6.48:1 against its track — the
 * stylesheet uses the text-safe green rather than the raw brand green the design filled it with,
 * which measured 2.05:1. **The amber at full clears it on a dark page and not on a light one**
 * (7.61:1 against the dark track, 1.68:1 against the light), which is accepted only because every
 * quantity the bar encodes is stated in words in the same panel and the track keeps a rule so its
 * extent is visible without the hue. See `.admin-bar` in `nn-admin.css` and
 * `tests/unit/admin-contrast.test.ts`, which pins all four numbers.
 */
function raceStandsSection(
  list: AdminEntryList,
  figures: AdminEventFigures | null,
  interest: AdminResult<AdminInterestList>,
): Html {
  const full = list.event.taken >= list.event.capacity;
  const over = list.event.taken > list.event.capacity;
  // Clamped, because a field that is one over must not draw a bar 100.4% wide.
  const percent = Math.min(
    100,
    Math.round((list.event.taken / list.event.capacity) * 100),
  );

  return html`<h2 class="admin-h2">Where the race stands</h2>
    <div class="admin-figs">
      <div class="admin-fig admin-fig-wide">
        <p class="admin-fig-label" id="places-taken">Places taken</p>
        <p class="admin-fig-value">
          <span class="admin-mono">${list.event.taken}</span>
          <span class="admin-fig-of">of ${list.event.capacity}</span>
        </p>
        <div
          class="admin-bar ${over ? 'admin-bar-over' : full ? 'admin-bar-full' : ''}"
          aria-hidden="true"
        >
          <span style="width: ${percent}%"></span>
        </div>
        ${
          figures === null
            ? html`<p class="admin-quiet">
                The breakdown could not be read from this database.
              </p>`
            : html`<ul class="admin-legend">
                ${legendItem(figures.paid, 'paid')}
                ${
                  figures.overCapacity === 0
                    ? null
                    : legendItem(figures.overCapacity, 'over capacity')
                }
                ${legendItem(figures.held, 'held right now')}
                ${legendItem(
                  figures.holdsReturned,
                  plural(
                    figures.holdsReturned,
                    'hold expired and returned',
                    'holds expired and returned',
                  ),
                )}
                ${figures.refunded === 0 ? null : legendItem(figures.refunded, 'refunded')}
              </ul>`
        }
        ${
          full && !over
            ? html`<p class="admin-fig-note">
                <strong>The field is full.</strong> That is the goal rather than a fault —
                nothing needs doing.
              </p>`
            : null
        }
      </div>

      <div class="admin-fig">
        <p class="admin-fig-label">Taken in entry fees</p>
        <p class="admin-fig-value">
          <span class="admin-mono">
            ${figures === null ? 'Not known' : formatPence(figures.feesPence)}
          </span>
        </p>
        <p class="admin-fig-note">
          Paid entries only, at the price each was charged.
          <strong>Not net of card fees</strong> — Stripe's own figure is the one that
          reconciles with the bank.
        </p>
      </div>

      <div class="admin-fig">
        <p class="admin-fig-label">On the interest list</p>
        <p class="admin-fig-value">
          <span class="admin-mono">
            ${interest.status === 'ok' ? interest.total : 'Not known'}
          </span>
        </p>
        <p class="admin-fig-note">
          ${
            interest.status === 'ok'
              ? html`Promised <strong>one email</strong> when entries open.
                  <span class="admin-mono">${interest.consented}</span> said the club may
                  write to them.`
              : 'That list could not be read. It is not saying nobody has signed up.'
          }
        </p>
      </div>
    </div>`;
}

function legendItem(count: number, label: string): Html {
  return html`<li>
    <span class="admin-mono admin-legend-count">${count}</span> ${label}
  </li>`;
}

/**
 * 5. Who has entered, by category.
 *
 * **Counted off the rows rather than asked of the database, and that is the one figure on this
 * page that is.** Everything in "Where the race stands" is a `count(*)` in SQL, because those
 * numbers are about the whole event and the row array is capped at the most recent 2,000. This
 * panel is different: the band a runner falls in is named by
 * `packages/shared/src/age-category.ts` and by nothing else — the database returns an age and a
 * race category and deliberately does not know what a "Vet 40" is — so counting bands in SQL
 * would be a second copy of the prize list living in a migration.
 *
 * **So the panel says what it counted.** Below the cap it is every paid entry; above it, it
 * says so in words rather than presenting a partial total as a full one. At 250 places this
 * cannot happen for Nightingale Nightmare, and stating it is what stops the panel quietly
 * becoming wrong for a race that can.
 *
 * **Paid entries only, and guides counted apart.** A held place is somebody halfway through a
 * payment page and a lapsed one is a place that came back; neither is a runner. A guide is a
 * runner nobody will award anything to, and folding them into a band would put a number in
 * front of a prize list that the prize list cannot honour.
 *
 * **`hide` and the status chips do not touch this.** It answers "who has entered", which is a
 * question about the race rather than about the view somebody has filtered down to — a panel
 * that moved when a filter moved would be read as the field changing.
 */
function categoriesSection(list: AdminEntryList): Html {
  const paid = list.entries.filter((entry) => entry.status === 'paid');
  const runners = paid.filter((entry) => entry.role !== 'guide');
  const guides = paid.length - runners.length;
  const capped = list.returned < list.total;

  // The four bands in prize-list order, then the two honest non-answers, then anybody whose
  // details a refund removed. Built as an array rather than a `Map` so the order on the page is
  // the order it is written in here.
  const rows: { label: string; count: number }[] = [
    ...AGE_CATEGORY_CODES.map((code) => ({
      label: ageCategoryLabel(code),
      count: runners.filter((entry) => bandOf(entry) === code).length,
    })),
    {
      // `ageCategoryFor()` answers `gender-has-no-categories` for a non-binary runner, because
      // the club has no non-binary categories at any age. That is the club's own unfinished
      // decision rather than anything the entrant did, and it is counted and named rather than
      // dropped — a band nobody can be placed in is exactly the number that should be visible
      // when somebody asks whether to make one.
      label: 'No category yet',
      count: runners.filter((entry) => bandOf(entry) === 'no-category').length,
    },
    {
      label: 'Under 18',
      count: runners.filter((entry) => bandOf(entry) === 'under-18').length,
    },
    {
      label: 'No runner recorded',
      count: runners.filter((entry) => bandOf(entry) === null).length,
    },
  ];

  return html`<h2 class="admin-h2">Who has entered</h2>
    <section class="admin-panel" aria-labelledby="categories">
      <div class="admin-panel-head">
        <h3 id="categories">By category</h3>
        <p class="admin-panel-note">
          Paid entries only${capped ? ', of the rows on this page' : ''}
        </p>
      </div>
      <div class="admin-panel-body">
        ${
          capped
            ? html`<p class="admin-banner">
                This page holds the most recent
                <span class="admin-mono">${list.returned}</span> of
                <span class="admin-mono">${list.total}</span> entries, so these counts are
                of those rather than of the whole field.
              </p>`
            : null
        }
        <ul class="admin-legend">
          ${rows
            .filter((row) => row.count > 0 || row.label !== 'No runner recorded')
            .map((row) => legendItem(row.count, row.label))}
          ${
            /* **Beside the bands and never inside one.** A guide is on the course and takes a
            place, and is not competing for anything. */ null
          }
          ${guides === 0 ? null : legendItem(guides, plural(guides, 'guide', 'guides'))}
        </ul>
        <p class="admin-quiet">
          <span class="admin-mono">${runners.length}</span>
          ${plural(runners.length, 'paid runner', 'paid runners')}${
            guides === 0
              ? ''
              : html` and <span class="admin-mono">${guides}</span> ${plural(
                    guides,
                    'guide',
                    'guides',
                  )}`
          }.
          Categories are worked out from age on race day, exactly as the entry form shows
          them.
        </p>
      </div>
    </section>`;
}

/**
 * Which line of the panel above a row belongs on.
 *
 * Null for a cancelled entry, whose age and race category were deleted with the entrant — it is
 * a purchase with nobody on it, and counting it as a person would inflate the field.
 */
function bandOf(entry: AdminEntry): AgeCategoryCode | 'no-category' | 'under-18' | null {
  if (entry.age === null || entry.gender === null) {
    return null;
  }

  const category = ageCategoryFor(
    entry.age,
    effectiveCategory(entry.gender, entry.resultPlacement),
  );

  if (category.known) {
    return category.code;
  }

  return category.reason === 'not-placed' ? 'no-category' : 'under-18';
}

/**
 * 6. Race morning — the thing somebody opens under pressure.
 *
 * Placed above the medical sheet and the affiliation check because it is the only panel here
 * with a fixed hour attached to it, and below the two panels about the state of the race because
 * somebody printing a start list at nine on Sunday already knows the field is full.
 */
function raceMorningSection(list: AdminEntryList): Html {
  return html`<h2 class="admin-h2">Race morning</h2>
    <section class="admin-panel" aria-labelledby="race-morning">
      <div class="admin-panel-head">
        <h3 id="race-morning">The registration desk</h3>
        <p class="admin-panel-note">Paid entries only, sorted by surname</p>
      </div>
      <div class="admin-panel-body">
        <p class="admin-warn">
          <strong>Print it the night before.</strong> Race HQ has patchy signal, and a
          phone in a cold hall at quarter past nine is a worse tool than paper on a
          clipboard.
        </p>
        <p>
          Surname, first name, club, category, emergency contact, and a column to tick.
          <strong>No dates of birth, no email addresses and no medical notes</strong> —
          the notes are a separate sheet, below, for the first aiders.
        </p>
        <div class="admin-actions">
          ${postButton(
            `${NN_SECTION}/start-list/`,
            list.event.slug,
            'Print the start list',
            'admin-button',
          )}
          ${exportButton(list.event.slug, 'start-list', 'Download as CSV', 'admin-button-quiet')}
        </div>
        <p class="admin-quiet">
          Both are recorded against your role — who, when, and how many rows, never the
          contents.
        </p>
      </div>
    </section>`;
}

/**
 * 7. The medical notes and the affiliation check, side by side.
 *
 * **The medical panel is deliberately heavier than everything else on the page** — its own
 * border, its own warning, and the deletion date stated. It is the most sensitive thing the club
 * holds, and using it should feel like a deliberate act rather than a click.
 *
 * **The deletion date is computed from the enforced interval, and that is now the only thing it
 * could be computed from.** `entries.events.medical_retention` is what deletes, and
 * `packages/db/tests/entries-retention.test.ts` still ties it to `race.json`'s
 * `privacy.medicalRetention`. **`/nn/privacy/` no longer publishes a period at all** — since
 * 30 August 2026 that page reproduces the committee's own privacy document word for word, and
 * the document states one general retention policy and no per-item interval. So this panel
 * stopped saying the notice promises this date: it does not. The date is real, the deletion is
 * real, and what a runner has been told about it is a general statement rather than a period.
 */
function medicalAndAffiliationSection(
  list: AdminEntryList,
  figures: AdminEventFigures | null,
): Html {
  return html`<h2 class="admin-h2">Before the day</h2>
    <div class="admin-pair">
      <section class="admin-panel admin-panel-grave" aria-labelledby="medical-notes">
        <div class="admin-panel-head">
          <h3 id="medical-notes">Medical notes</h3>
        </div>
        <div class="admin-panel-body">
          <p class="admin-grave">
            <strong>A separate sheet, for the first aiders only.</strong> This is the
            easiest way for sensitive information to end up in a car park. Taking it is
            <strong>recorded against your role</strong>.
          </p>
          ${
            figures === null
              ? html`<p class="admin-quiet">
                  How many notes are held could not be read from this database.
                  <strong>That is not the same as none.</strong>
                </p>`
              : html`<p>
                  <span class="admin-mono">${figures.medicalCount}</span>
                  ${plural(
                    figures.medicalCount,
                    'paid entrant has written something.',
                    'paid entrants have written something.',
                  )}
                </p>`
          }
          ${
            figures === null
              ? null
              : html`<p class="admin-quiet">
                  Deleted automatically on
                  <strong class="admin-mono">
                    ${formatLondonDate(`${figures.medicalDeleteAfter}T00:00:00Z`)}</strong
                  >
                  — ${retentionWords(figures.medicalRetention)}, which is the period set
                  on this event.
                </p>`
          }
          ${
            /* **The page first and the file second**, which is the reverse of how this panel
            read before there was a page. The thing a first aider is handed is paper; the CSV
            exists for the volunteer who wants it in a spreadsheet, and it was doing both jobs
            badly. Both take the same read and write the same `medical_export` audit row. */ null
          }
          <div class="admin-actions">
            ${postButton(
              `${NN_SECTION}/medical-sheet/`,
              list.event.slug,
              'Print the medical sheet',
              'admin-button admin-button-grave',
            )}
            ${
              /* **Named differently from race morning's `Download as CSV`, and it is not
              decoration.** Two buttons with the same accessible name on one page are two rows
              a screen reader cannot tell apart, and one of these takes special category data.
              The distinct label is also what makes an assertion about either of them
              unambiguous. */ null
            }
            ${exportButton(
              list.event.slug,
              'medical',
              'Download the notes as CSV',
              'admin-button-quiet',
            )}
          </div>
        </div>
      </section>

      ${
        /* **"Affiliated entries" rather than "Affiliation check", since 29 August 2026.** The
           club stopped asking for England Athletics numbers, so there is nothing here to
           check — a runner says they are affiliated and the club takes their word for it. The
           count is not decoration though, and it is why the panel survives: it is how many
           entries the club owes no Unattached Runner Levy on under ARC Rule 21(2)(b), which
           is a figure a treasurer has to be able to produce. The file below it is the same
           count as a document, without the number column it used to carry. */ null
      }
      <section class="admin-panel" aria-labelledby="affiliation">
        <div class="admin-panel-head">
          <h3 id="affiliation">Affiliated entries</h3>
        </div>
        <div class="admin-panel-body">
          ${
            figures === null
              ? html`<p class="admin-quiet">
                  The affiliated count could not be read from this database.
                </p>`
              : html`<p>
                  <span class="admin-mono">${figures.affiliated}</span>
                  ${plural(figures.affiliated, 'paid entry took', 'paid entries took')}
                  the affiliated price. The club does not ask for an England Athletics
                  number and holds none — a runner states that they are affiliated and the
                  club takes their word for it. The privacy notice reserves the club's
                  right to ask somebody to produce theirs.
                </p>`
          }
          <div class="admin-actions">
            ${exportButton(
              list.event.slug,
              'ea',
              'Download the affiliated list',
              'admin-button-quiet',
            )}
          </div>
        </div>
      </section>
    </div>`;
}

/** `1 mon` → `one month after the race`, or words for an interval the module will not say. */
function retentionWords(interval: string): string {
  return medicalRetentionClause(interval) ?? 'the period the club has set';
}

/**
 * 8. The entries.
 *
 * ## The filters are links
 *
 * Not a form, not a `<select>`, and no script. Each is an `<a>` carrying a query parameter, so
 * the page works with scripting off, every filtered view is a URL somebody can bookmark or send
 * to the other volunteer, and the back button does what it looks like it does.
 *
 * **No filter carries a name.** The values are enumerated words — a status, a fee code, a sort
 * key — and a query string is the last place personal data should be, because it reaches server
 * logs, browser history and anything sitting in front of the origin.
 *
 * ## 320px: restructured, not scrolled
 *
 * **The table used to scroll sideways inside a focusable region and it no longer does.** That
 * arrangement worked and cost three things: a second scrolling region inside a page that already
 * scrolls, on a surface where 70% of visitors are on a phone; a `position: relative` on the
 * scroller that existed solely to stop absolutely-positioned hidden text escaping it and dragging
 * the whole document sideways; and a table nobody could read without dragging it.
 *
 * So below 48rem the table **drops to three columns** — runner, status, note — and the five it
 * drops reappear inside the runner cell, which is the only cell wide enough to hold them. Each
 * version is `display: none` at the width where the other is showing, so exactly one is in the
 * accessibility tree at any size and nothing is announced twice. The markup stays a real
 * `<table>` with real `<th scope="col">` and `<th scope="row">` at every width — no `display:
 * block` reflow, so the table semantics that make it navigable are never traded away.
 */
function entriesSection(
  list: AdminEntryList,
  filters: EntryFilters,
  url: URL,
  viewer: AdminViewer,
): Html {
  const shown = viewEntries(list.entries, filters);
  const fees = [...new Set(list.entries.map((entry) => entry.feeCode))].sort();

  return html`<h2 class="admin-h2">Entries</h2>
    <section class="admin-panel" aria-labelledby="all-entries">
      <div class="admin-panel-head">
        <h3 id="all-entries">All entries</h3>
        <p class="admin-panel-note">
          <span class="admin-mono">${shown.length}</span> of
          <span class="admin-mono">${list.entries.length}</span> shown
        </p>
      </div>

      ${
        /* **Rendered only for somebody who may actually use it.** `nn.entry.create` is the
        eighth permission and `nn-admin` is the only role carrying it, so a future read-only
        role meets no button — and the route answers 404 to them regardless, which is the
        control. A button that 404s is worse than no button: it reads as a broken page rather
        than as a thing this person cannot do. */ null
      }
      ${
        can(viewer, 'nn.entry.create')
          ? postButton(
              `${NN_SECTION}/assign/`,
              list.event.slug,
              'Assign a place',
              'admin-button-quiet',
            )
          : null
      }

      <nav class="admin-filters" aria-label="Filter the entries">
        <p class="admin-filters-label" id="filter-status">Status</p>
        <ul aria-labelledby="filter-status">
          ${STATUS_FILTERS.map((status) =>
            toggleLink(url, 'status', status, statusFilterLabel(status), filters.status),
          )}
        </ul>
        ${
          fees.length < 2
            ? null
            : html`<p class="admin-filters-label" id="filter-fee">Entry type</p>
                <ul aria-labelledby="filter-fee">
                  ${['all', ...fees].map((fee) =>
                    toggleLink(url, 'fee', fee, feeFilterLabel(fee, list), filters.fee),
                  )}
                </ul>`
        }
        <p class="admin-filters-label" id="filter-sort">Sort by</p>
        <ul aria-labelledby="filter-sort">
          ${SORTS.map((sort) => sortLink(url, sort, sortLabel(sort), filters.sort))}
        </ul>
        ${hideToggle(url, filters)}
      </nav>

      ${
        list.returned < list.total
          ? html`<p class="admin-banner">
              Showing the most recent <span class="admin-mono">${list.returned}</span> of
              <span class="admin-mono">${list.total}</span> entries. The rest are older
              and are in the exports, which have no cap.
            </p>`
          : null
      }

      <table class="admin-table">
        <caption class="admin-visually-hidden">
          Entries for ${list.event.displayName}
        </caption>
        <thead>
          <tr>
            <th scope="col">Runner</th>
            ${
              /* **`admin-col-wide`, like the other five, so the narrow layout still keeps
                 three columns.** A fourth at 320px is what starts the table scrolling
                 sideways, which drags the whole page with it — and an address is the longest
                 string on this page: the club's own is 47 characters, which is the exact
                 value that overflowed a 320px document in the sideways-scroll investigation.
                 It folds into `admin-stack` under the runner's name with `admin-break`, the
                 same pair the interest table's Email column has always used.

                 ADR-024 built `/admin/nn/entry/` because the facts a volunteer needs on the
                 phone were the ones that did not fit in a column, and named the address that
                 paid as one of them. **This reverses that for one field**, because telling two
                 runners of the same name apart is done while reading the list rather than
                 after opening a row. Issue #183. */ null
            }
            <th scope="col" class="admin-col-wide">Email</th>
            <th scope="col" class="admin-col-wide">Club</th>
            <th scope="col" class="admin-col-wide">Category</th>
            <th scope="col" class="admin-col-wide">Entry</th>
            <th scope="col" class="admin-col-wide">Code</th>
            <th scope="col" class="admin-col-wide">Paid</th>
            <th scope="col">Status</th>
            <th scope="col">Note</th>
            ${
              /* **`admin-col-wide`, so it folds away with Club, Category, Entry, Code
                 and Paid at 320px.** The phone layout keeps three columns on purpose — a
                 fourth is what starts the table scrolling sideways, and an absolutely
                 positioned visually-hidden span inside a scroller drags the whole page with
                 it, which is the trap CLAUDE.md spends a paragraph on.

                 Losing *Cancel* on a phone is the deliberate half of that, and it still is:
                 cancelling is a desk task with the Stripe dashboard open in another tab, not
                 something done one-handed at a race. The medical note, which *is* wanted on
                 race morning, keeps its column.

                 **What was not deliberate was losing Details with it** — issue #145 defect 5.
                 `/admin/nn/entry/` exists because ADR-024 found that the facts a volunteer
                 needs on a phone are exactly the ones that do not fit in a table, and folding
                 this cell away left that page with no door on the devices it was built for.
                 A second copy of the Details button rides in `admin-stack`, under the runner's
                 name, so the column count does not move. Cancel and Transfer are on that page
                 anyway, which is why one button is enough. */ null
            }
            <th scope="col" class="admin-col-wide">Cancel</th>
          </tr>
        </thead>
        <tbody>
          ${
            shown.length === 0
              ? html`<tr>
                  <td colspan="11">Nothing matches that filter.</td>
                </tr>`
              : shown.map((entry) => entryRow(entry, viewer, list.entries))
          }
        </tbody>
      </table>
    </section>`;
}

/**
 * What to put in the runner cell when there is no runner.
 *
 * **A cancelled entry has had its entrants deleted** — `entries.cancel_entry()` does that on
 * purpose, so the club stops holding personal data for a race somebody is not running — and
 * since #116 the row survives that deletion instead of vanishing from the page. So the cell
 * has to say something, and what it says is the same sentence `/account/entries/` has always
 * used for the same row, shortened to fit a table.
 *
 * **Not an em dash.** Every other cell on this page uses one for "nothing here", and this is
 * not nothing — it is a purchase the club took money for and gave back, and the words are
 * what stop it reading as a rendering fault.
 */
function runnerName(entry: AdminEntry): string {
  if (entry.lastName === null || entry.firstName === null) {
    return 'No runner recorded';
  }

  return `${entry.lastName}, ${entry.firstName}`;
}

/**
 * What the money column says for one row.
 *
 * **`amountPence` belongs to the purchase, and a purchase can be two rows.** A visually
 * impaired runner and their guide are one entry and two people, so printing the amount on
 * both would show £20.00 twice — while the figures panel above, which sums over purchases,
 * showed £20. The page would have disagreed with itself, and the total would have been the
 * half that was right.
 *
 * So the amount is rendered against the runner and the guide's row says what it is. Nothing
 * is subtracted or divided: the number is still exactly what `entries.fees` charged.
 */
function amountCell(entry: AdminEntry): string {
  return entry.role === 'guide' ? 'Guide — no charge' : formatPence(entry.amountPence);
}

function entryRow(entry: AdminEntry, viewer: AdminViewer, all: AdminEntry[]): Html {
  // Null together, for the same reason the name is: the category is computed from a date of
  // birth that was deleted with the entrant.
  // **A guide is in no category, so naming one would be inventing a result.** They are not
  // timed and are not placed; the row says what they are instead of what band they would be
  // in if they were. Null stays null for a cancelled entry, for the reason below.
  const category =
    entry.role === 'guide'
      ? 'Guide'
      : entry.age === null || entry.gender === null
        ? null
        : categoryLabel(entry.age, entry.gender, entry.resultPlacement);

  // **The England Athletics number was rendered here until 29 August 2026**, as a cell and as
  // a loud "EA number missing" in the stacked phone summary. The club stopped asking for it,
  // so there is nothing to render and nothing to warn about: every affiliated entry is a
  // runner's word, which is what the committee decided it should be. The entry type column
  // still says which price was paid, which is the part a volunteer actually acts on.

  // **Only where there is something to cancel.** An `expired` hold has already released its
  // place and has no entrant to remove, and a `refunded` row is the outcome of having pressed
  // this once already — offering the button on either would be offering a no-op that reads as
  // a destructive act.
  const cancellable =
    can(viewer, 'nn.entry.cancel') &&
    (entry.status === 'paid' || entry.status === 'pending');

  // **Transfer is narrower than cancel, and the difference is the guide.**
  // `entries.transfer_entry()` refuses a purchase with more than one entrant on it —
  // "transfer it" does not say which of a visually impaired runner and their guide is leaving
  // — so offering the button on such a row would be offering a refusal. A guide's own row is
  // the same purchase seen from the other side, so it is not offered there either. Cancelling
  // *is* offered on both, because cancelling the purchase is unambiguous: the place and both
  // people on it go.
  //
  // The database refuses it regardless; this stops the page promising something it cannot do.
  const transferable = cancellable && entry.role !== 'guide' && !hasGuide(entry, all);

  return html`<tr>
    <th scope="row">
      ${runnerName(entry)}
      <span class="admin-stack">
        ${
          /* First in the stack, because on a phone this is the whole reason the column was
          added: two runners with the same name, and one of them is the person on the other end
          of the call. */ null
        }
        <span class="admin-mono admin-break">${entry.email ?? 'No email recorded'}</span>
        <span>${entry.club ?? 'No club'}</span>
        <span>${category ?? 'No category'}</span>
        ${
          /* **Under the category, and only here.** The gender somebody recorded is not the
          category and must not read as one — it is a note about the runner, shown on this
          page because a field the club collects and never surfaces is a field collected for
          no purpose, and shown *nowhere else* because a start list or an export is read by
          people who have no business with it. Absent for most entries: not answering is an
          answer. See ADR-020. */ null
        }
        ${entry.genderIdentity === null ? null : html`<span>${entry.genderIdentity}</span>`}
        <span>${entry.feeLabel}</span>
        <span class="admin-mono">${amountCell(entry)}</span>
        ${
          entry.discountCode === null
            ? null
            : html`<span class="admin-mono">${entry.discountCode}</span>`
        }
        ${
          /* **The way in on a phone, and it costs no column.** The actions cell is
          `admin-col-wide`, so below 768px Details, Cancel and Transfer all fold away — and
          `/admin/nn/entry/` was built by ADR-024 precisely because the facts a volunteer needs
          at race HQ do not fit in a table. Its only door was a button a phone could not show.

          Un-hiding that cell is the wrong fix: the narrow layout keeps three columns because a
          fourth starts the table scrolling sideways, which drags the whole page with it. This
          rides in the stack that is already under the runner's name, so the column count does
          not move.

          **Details alone, not all three.** The detail page carries Cancel and Transfer itself,
          so one button reaches every act this surface allows — and reading before acting is
          the order these belong in anyway. `display: none` on the stack above 768px keeps
          exactly one copy of this button in the accessibility tree, the same arrangement every
          other value in here uses. */ null
        }
        <span class="admin-stack-action">
          <form method="post" action="${NN_SECTION}/entry/">
            <input type="hidden" name="purchaseId" value="${entry.purchaseId}" />
            <button type="submit" class="admin-linkish">
              Details
              <span class="admin-visually-hidden"
                >of the entry for ${runnerName(entry)}</span
              >
            </button>
          </form>
        </span>
      </span>
    </th>
    ${
      /* ⚠️ **Whose address this is was decided by the database, per row.** A runner's is the
      purchase's `purchaser_email`; a **guide's** is their own `entrants.email`, because a guide
      has no purchase of their own. Printing the buyer's address beside a guide's name would be
      wrong on the page a volunteer rings people from, so `read_entry_list()` resolves it and
      this cell prints what it resolved. Never substitute another field for a null here. */ null
    }
    <td class="admin-col-wide admin-mono admin-break">${entry.email ?? '—'}</td>
    <td class="admin-col-wide">${entry.club ?? '—'}</td>
    <td class="admin-col-wide">
      ${category}
      ${
        entry.genderIdentity === null
          ? null
          : html`<span class="admin-sub">${entry.genderIdentity}</span>`
      }
    </td>
    <td class="admin-col-wide">${entry.feeLabel}</td>
    ${
      /* **The code this entry was bought with, and a dash for the many that used none.**
      Beside the amount rather than in the stacked summary alone, because the question a
      volunteer opens this page with is "who used the Left Handed Giant allocation" and the answer
      is a column you can read down. */ null
    }
    <td class="admin-col-wide admin-mono">${entry.discountCode ?? '—'}</td>
    <td class="admin-col-wide admin-mono">${amountCell(entry)}</td>
    <td>${statusCell(entry)}</td>
    <td>
      ${
        entry.hasMedical
          ? html`<form method="post" action="${NN_SECTION}/medical/">
              <input type="hidden" name="entrantId" value="${entry.entrantId}" />
              <button type="submit" class="admin-linkish">
                Show note
                <span class="admin-visually-hidden"> for ${runnerName(entry)} </span>
              </button>
            </form>`
          : '—'
      }
    </td>
    <td class="admin-col-wide">
      ${
        /* **Offered on every row without exception, including a cancelled one.** The page
        behind it is a read, it needs only `nn.entry.read`, and a refunded purchase is exactly
        the row somebody most often needs the history of. It is first in the cell because it is
        the safe one: reading before acting is the order these three belong in. */ null
      }
      <form method="post" action="${NN_SECTION}/entry/">
        <input type="hidden" name="purchaseId" value="${entry.purchaseId}" />
        <button type="submit" class="admin-linkish">
          Details
          <span class="admin-visually-hidden">of the entry for ${runnerName(entry)}</span>
        </button>
      </form>
      ${
        cancellable
          ? html`<form method="post" action="${NN_SECTION}/cancel/">
              <input type="hidden" name="purchaseId" value="${entry.purchaseId}" />
              ${
                /* No CSRF token, and no need for one: this POST changes nothing. It renders
                 the confirmation, which mints the token the second POST has to echo. */ null
              }
              <button type="submit" class="admin-linkish">
                Cancel
                <span class="admin-visually-hidden">
                  the entry for ${runnerName(entry)}
                </span>
              </button>
            </form>`
          : /* **Null rather than a dash, since Details arrived.** The dash was there because
               the cell would otherwise have been empty, and it never is now — a row with a
               dash beside a working control reads as something broken rather than as
               something absent. */ null
      }
      ${
        /* **Transfer sits beside Cancel and only where Cancel does.** Both need a place that
        exists, and the two together are the whole of what this surface may do to an entry
        somebody paid for. Same two-step shape: this POST only asks. */ null
      }
      ${
        transferable
          ? html`<form method="post" action="${NN_SECTION}/transfer/">
              <input type="hidden" name="purchaseId" value="${entry.purchaseId}" />
              <button type="submit" class="admin-linkish">
                Transfer
                <span class="admin-visually-hidden">
                  the entry for ${runnerName(entry)} to somebody else
                </span>
              </button>
            </form>`
          : null
      }
    </td>
  </tr>`;
}

/**
 * What a status cell says.
 *
 * **Every one carries its own word, and the colour is on top of that rather than instead of it.**
 * A printed start list is black ink, a colour-blind reader gets no hue at all, and a phone in
 * November sunlight is close to monochrome — so "Over capacity" is the signal and the red is
 * emphasis. WCAG 1.4.1, and the practical version of it.
 */
function statusCell(entry: AdminEntry): Html {
  const flagged = needsAHuman(entry);
  const words = statusWords(entry);

  return html`<span class="admin-chip ${chipClass(entry)}">${words}</span>${
      entry.revived ? html` <span class="admin-quiet">paid late</span>` : null
    }${
      flagged && entry.attention !== 'over_capacity'
        ? html` <strong class="admin-error">${attentionWords(entry.attention)}</strong>`
        : null
    }${
      /* **What the entrant has asked for, beside the status and not instead of it.** A paid
      entry with a cancellation request against it is still paid and still holds a place — the
      request changes nothing until a volunteer acts, and showing it as a status would be a
      fifth value the capacity predicate cannot see.

      Struck through once dealt with rather than removed, because "somebody asked and it was
      handled" is what a volunteer needs to see on the row they are about to touch. */ null
    }${requestWording(entry)}`;
}

/**
 * Every ask on one row, beside the status and not instead of it.
 *
 * **A paid entry with a cancellation request against it is still paid and still holds a
 * place.** The request changes nothing until a volunteer acts, and showing it as a status would
 * be a fifth value the capacity predicate cannot see.
 *
 * **Every outstanding one, and this is the defect it closes.** `requested_action` holds one
 * word, so somebody who pressed *Transfer* and then thought better of it and pressed *Cancel*
 * left a row saying only the second — and the two want opposite things. A volunteer who can
 * see one of two disagreeing asks acts on the wrong one about half the time.
 *
 * **Falls back to the summary fields when the history is empty**, which is what a database
 * deployed ahead of the history migration answers. Nothing sequences a migration against the
 * Cloudflare deploy, and this row has to render either way.
 *
 * Struck through once dealt with rather than removed, because "somebody asked and it was
 * handled" is what a volunteer needs to see on the row they are about to touch. The reason
 * itself is never struck through: what somebody said stays true after it has been acted on.
 */
function requestWording(entry: AdminEntry): Html | null {
  const asks: EntryRequest[] =
    entry.requests.length > 0
      ? entry.requests
      : entry.requestedAction === null
        ? []
        : [
            {
              action: entry.requestedAction,
              reason: entry.requestReason,
              requestedAt: entry.createdAt,
              resolvedAt: entry.requestResolved ? entry.createdAt : null,
            },
          ];

  if (asks.length === 0) {
    return null;
  }

  return html`${asks.map(
    (ask) =>
      html` <span
          class="admin-quiet ${ask.resolvedAt === null ? '' : 'admin-request-done'}"
          >${entryRequestWords(ask.action)}${
            ask.resolvedAt === null ? '' : ' — dealt with'
          }</span
        >${
          /* **Their own words, and this is why an ask is worth recording at all.**
        "Cancellation asked for" is a word; "I broke my ankle on Tuesday" and "my friend
        would like my place" are two different afternoons, and a volunteer deciding between
        a refund and a transfer needs the second thing rather than the first. */ null
        }${
          ask.reason === null
            ? null
            : html` <span class="admin-sub">“${ask.reason}”</span>`
        }`,
  )}`;
}

/** Whether this purchase has a guide on it as well as a runner. */
function hasGuide(entry: AdminEntry, all: AdminEntry[]): boolean {
  return all.some(
    (other) => other.purchaseId === entry.purchaseId && other.role === 'guide',
  );
}

function statusWords(entry: AdminEntry): string {
  if (needsAHuman(entry) && entry.attention === 'over_capacity') {
    return 'Over capacity';
  }

  if (entry.status === 'paid') {
    return 'Paid';
  }

  if (entry.status === 'refunded') {
    return 'Refunded';
  }

  if (entry.status === 'expired') {
    return 'Hold expired';
  }

  // `pending`. Whether the hold is still live is the interesting half, and the status alone does
  // not say — a lapsed hold stays `pending` until the five-minute sweep reaches it.
  const left = minutesLeft(entry.holdExpiresAt);

  if (left === null) {
    return 'Held';
  }

  return left <= 0 ? 'Hold lapsed' : `Held · ${left} min left`;
}

/** Whole minutes until a hold runs out, or `null` if there is no hold to speak of. */
export function minutesLeft(
  holdExpiresAt: string | null,
  now = Date.now(),
): number | null {
  if (holdExpiresAt === null) {
    return null;
  }

  const at = Date.parse(holdExpiresAt);

  return Number.isNaN(at) ? null : Math.floor((at - now) / 60_000);
}

function chipClass(entry: AdminEntry): string {
  if (needsAHuman(entry)) {
    return 'admin-chip-flag';
  }

  if (entry.status === 'paid') {
    return 'admin-chip-paid';
  }

  if (entry.status === 'pending') {
    const left = minutesLeft(entry.holdExpiresAt);
    return left !== null && left <= 0 ? 'admin-chip-gone' : 'admin-chip-held';
  }

  return 'admin-chip-gone';
}

/**
 * 9. The interest list.
 *
 * **A count and the promise, not the addresses.** The addresses are on their own page, one click
 * away, because a dashboard somebody leaves open at a registration desk is the wrong place for a
 * column of email addresses — and because the only thing this panel has to answer is "how many
 * people are waiting to hear".
 *
 * **There is deliberately no CSV here.** The design showed one; adding it means a fourth export
 * kind, which is a new path for taking email addresses out of the platform and a decision about
 * a promise the club made to those people. `admin_export` takes three kinds and adding a fourth
 * belongs in a diff somebody argues, not in a layout.
 */
function interestSection(interest: AdminResult<AdminInterestList>): Html {
  return html`<h2 class="admin-h2">The interest list</h2>
    <section class="admin-panel" aria-labelledby="interest">
      <div class="admin-panel-head">
        <h3 id="interest">People waiting to hear</h3>
        ${
          interest.status === 'ok'
            ? html`<p class="admin-panel-note">
                <span class="admin-mono">${interest.total}</span> addresses, collected
                before entries opened
              </p>`
            : null
        }
      </div>
      <div class="admin-panel-body">
        ${
          interest.status === 'ok'
            ? html`<p>
                  Each of these people was told the club would email them
                  <strong>once, when entries opened</strong>, and nothing else. Using the
                  list for anything more means asking them again.
                  <span class="admin-mono">${interest.total - interest.consented}</span>
                  of them said no and must not be written to.
                </p>
                <p>
                  <a href="${NN_SECTION}/interest/"> Open the interest list</a>
                  — the addresses are on their own page rather than on this one.
                </p>`
            : html`<p class="admin-quiet">
                That list could not be read.
                <strong>It is not saying nobody has signed up.</strong>
              </p>`
        }
      </div>
    </section>`;
}

// -----------------------------------------------------------------------------------------
// The start list, built to be printed
// -----------------------------------------------------------------------------------------

/**
 * The start list as paper.
 *
 * **There is no print button, and its absence is the decision.** A button that calls
 * `window.print()` needs an inline handler or a script, and there is neither on any page this
 * Worker builds — every admin page works with scripting off because that is the primary path
 * here rather than a fallback. The browser's own print command does the same job on every device,
 * and `@media print` in `nn-admin.css` is what makes the result worth printing: the masthead and
 * the event bar drop out, the narrow layout is suppressed so nothing prints twice, black on white
 * regardless of the reader's scheme, and no row splits across a page break.
 */
function startListPage(
  viewer: AdminViewer,
  taken: Extract<AdminExport, { kind: 'start-list' }>,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page admin-print" id="main">
      <h1>Start list — ${taken.event.displayName}</h1>
      <p class="admin-quiet">
        ${formatLondonDate(`${taken.event.eventDate}T00:00:00Z`)} ·
        <span class="admin-mono">${taken.rows.length}</span>
        ${plural(taken.rows.length, 'paid entry', 'paid entries')}, sorted by surname
      </p>
      <p class="admin-noprint admin-quiet">
        Print with your browser's print command — <span class="admin-mono">⌘P</span> or
        <span class="admin-mono">Ctrl&nbsp;+&nbsp;P</span>. Taking this page has already
        been recorded against your role.
      </p>
      <p class="admin-warn admin-noprint">
        <strong>This sheet carries emergency contacts.</strong> It is for the registration
        desk and the finish line. Do not leave it anywhere it can be read by somebody who
        is not marshalling.
      </p>
      <table class="admin-table admin-table-print">
        <caption class="admin-visually-hidden">
          Start list for ${taken.event.displayName}
        </caption>
        <thead>
          <tr>
            <th scope="col">Runner</th>
            <th scope="col" class="admin-col-wide">Club</th>
            <th scope="col" class="admin-col-wide">Category</th>
            <th scope="col" class="admin-col-wide">Emergency contact</th>
            <th scope="col">Collected</th>
          </tr>
        </thead>
        <tbody>
          ${
            taken.rows.length === 0
              ? html`<tr>
                  <td colspan="5">No paid entries yet.</td>
                </tr>`
              : taken.rows.map((row) => startListRow(row))
          }
        </tbody>
      </table>
      <p class="admin-noprint">
        <a href="${NN_SECTION}/">Back to race admin</a>
      </p>
    </main>`;
}

/**
 * One row of the start list.
 *
 * **It folds at narrow widths for the same reason the entries table does, and it matters more
 * here.** This is the registration-desk document: somebody will open it on a phone at the desk
 * even having been told to print it. Five columns do not fit 320px — measured at 445px of table
 * pushing the document to 461px — so four of them drop out below 48rem and reappear inside the
 * runner cell, leaving the runner and the tick box.
 *
 * **The emergency contact folds too, and that is a CI failure's doing rather than a preference.**
 * Keeping it as its own column left the table 297px inside a 288px container, saved only by the
 * container's own 16px offset — about seven pixels of headroom. A Linux runner does not have those
 * seven pixels: a classic vertical scrollbar takes ~15px off `clientWidth` and the font metrics are
 * a shade wider, so the same page overflowed by 4px there while measuring 0 on a laptop. **And this
 * table has no clipping ancestor** — unlike the entries table, which sits in an `overflow: hidden`
 * panel — so every excess pixel becomes document overflow instead of being absorbed. Folding the
 * contact takes the requirement to about 158px, which is slack rather than luck.
 *
 * The contact is still on screen at every width; below 48rem it is a line in the stack rather than
 * a column, which is what the desk needs it to be.
 *
 * `admin-col-wide` is the same class the entries table uses, which also means `@media print`
 * restores all five columns and suppresses the stack — a printed sheet is wide, and the duplicated
 * values must not print twice.
 */
/**
 * What the category column says on the printed sheet.
 *
 * **A guide is not being timed and is in no category**, so printing one against them would put
 * a result category on somebody who will not have a result. The sheet is what a marshal reads
 * at two in the morning to account for everybody on the road, and "Guide" is the fact that
 * matters there.
 *
 * **The null-category branch is second, and it is a row the constraints say cannot exist.**
 * `entrants_gender_unless_guide` permits an absent race category for a guide and for nobody
 * else, so the only caller that can reach it is one whose `role` failed to come back — a
 * Worker reading a database from before guides existed. It answers with the same words a
 * non-binary entrant who chose neither category gets, rather than inventing a band or
 * throwing: the sheet must print, which is the whole lesson of the defect that made this
 * function's parameter nullable in the first place.
 */
function startListCategory(row: StartListExportRow): string {
  if (row.role === 'guide') {
    return 'Guide';
  }

  return row.gender === null
    ? 'No category yet'
    : categoryLabel(row.age, row.gender, row.resultPlacement);
}

function startListRow(row: StartListExportRow): Html {
  return html`<tr>
    <th scope="row">
      ${row.lastName}, ${row.firstName}
      ${
        /* **The runner's own number goes inside the runner cell, and not into a sixth
           column.** The comment above this function is the whole argument: five columns
           already do not fit 320px, four of them fold into this cell to make the sheet work
           at the registration desk, and the folded arrangement cleared a Linux runner by
           about seven pixels of headroom that a scrollbar and wider font metrics had already
           eaten once. A sixth column would spend that twice over on a page with no clipping
           ancestor, where every excess pixel becomes document overflow.

           So it is a line under the name, present at every width and in print, and it costs
           the table height rather than width. Null on a guide and on every entry taken before
           ADR-025, and rendered as nothing at all rather than as an empty line — a blank
           where a number should be reads as a number nobody wrote down. */ null
      }
      ${
        row.phone === null
          ? null
          : html`<span class="admin-sub admin-mono admin-nowrap">${row.phone}</span>`
      }
      <span class="admin-stack">
        <span>${row.club ?? 'No club'}</span>
        <span>${startListCategory(row)}</span>
        <span>
          ${row.emergencyContactName}
          <span class="admin-mono admin-nowrap">${row.emergencyContactPhone}</span>
        </span>
      </span>
    </th>
    <td class="admin-col-wide">${row.club ?? '—'}</td>
    <td class="admin-col-wide">${startListCategory(row)}</td>
    <td class="admin-col-wide">
      ${row.emergencyContactName}
      <span class="admin-mono admin-nowrap">${row.emergencyContactPhone}</span>
    </td>
    <!-- A box to tick with a biro. The whole reason this is paper. The "Collected" column
         header is what names it; an aria-label here would say the same thing twice. -->
    <td class="admin-tick"></td>
  </tr>`;
}

/**
 * The medical sheet, printed.
 *
 * **Heavier than the start list on purpose, exactly as the panel that offers it is.** Every row
 * is special category data under UK GDPR Article 9, on a page somebody is about to send to a
 * printer in a hall full of people. The warning is not decoration; it is the last thing between
 * a condition somebody wrote in confidence and a sheet left on a table.
 *
 * **It prints the warning too**, unlike the start list's, which is `admin-noprint`. A printed
 * start list left somewhere is embarrassing; a printed medical sheet left somewhere is a
 * disclosure the club has to report, and the paper itself should say what it is.
 */
function medicalSheetPage(
  viewer: AdminViewer,
  taken: Extract<AdminExport, { kind: 'medical' }>,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page admin-print" id="main">
      <h1>Medical notes — ${taken.event.displayName}</h1>
      <p class="admin-quiet">
        ${formatLondonDate(`${taken.event.eventDate}T00:00:00Z`)} ·
        <span class="admin-mono">${taken.rows.length}</span>
        ${plural(taken.rows.length, 'note', 'notes')}, sorted by surname
      </p>
      <p class="admin-noprint admin-quiet">
        Print with your browser's print command — <span class="admin-mono">⌘P</span> or
        <span class="admin-mono">Ctrl&nbsp;+&nbsp;P</span>. Taking this page has already
        been recorded against your role.
      </p>
      <p class="admin-grave">
        <strong>For the first aiders only.</strong> Everything on this sheet was written
        in confidence by the person it is about. It goes to the medical team and nowhere
        else, and it is destroyed after the race.
      </p>
      <table class="admin-table admin-table-print">
        <caption class="admin-visually-hidden">
          Medical notes for ${taken.event.displayName}
        </caption>
        <thead>
          <tr>
            <th scope="col">Runner</th>
            <th scope="col" class="admin-col-wide">Club</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          ${
            taken.rows.length === 0
              ? html`<tr>
                  <td colspan="3">
                    No paid entrant has written anything.
                    <strong>That is not the same as the notes being unreadable</strong> —
                    this page was built from a successful read.
                  </td>
                </tr>`
              : taken.rows.map((row) => medicalSheetRow(row))
          }
        </tbody>
      </table>
      <p class="admin-noprint">
        <a href="${NN_SECTION}/">Back to race admin</a>
      </p>
    </main>`;
}

/**
 * One row of the medical sheet.
 *
 * Folds at narrow widths the way the start list's does and for the same measured reason — this
 * one has three columns rather than five, and the note itself is the wide one, so only the club
 * folds into the runner cell.
 */
function medicalSheetRow(row: MedicalExportRow): Html {
  return html`<tr>
    <th scope="row">
      ${row.lastName}, ${row.firstName}
      <span class="admin-stack">
        <span>${row.club ?? 'No club'}</span>
      </span>
    </th>
    <td class="admin-col-wide">${row.club ?? '—'}</td>
    <td>${row.notes}</td>
  </tr>`;
}

// -----------------------------------------------------------------------------------------
// The interest list, on its own page
// -----------------------------------------------------------------------------------------

function interestPage(viewer: AdminViewer, list: AdminInterestList): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Register-your-interest sign-ups</h1>
      <p class="admin-quiet">
        <span class="admin-mono">${list.total}</span> sign-ups,
        <span class="admin-mono">${list.consented}</span> of whom said the club may write
        to them.
      </p>
      <p>
        The club promised these people <strong>one email when entries open</strong>. A row
        that says <strong>no</strong> below must not be written to — it is shown rather
        than hidden so that a list somebody is about to email is honest about who is not
        on it.
      </p>
      ${
        list.returned < list.total
          ? html`<p class="admin-banner">
              Showing the most recent <span class="admin-mono">${list.returned}</span> of
              <span class="admin-mono">${list.total}</span>.
            </p>`
          : null
      }
      <table class="admin-table">
        <caption class="admin-visually-hidden">
          Register-your-interest sign-ups
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" class="admin-col-wide">Email</th>
            <th scope="col" class="admin-col-wide">Signed up</th>
            <th scope="col">May we write?</th>
          </tr>
        </thead>
        <tbody>
          ${
            list.interest.length === 0
              ? html`<tr>
                  <td colspan="4">Nobody has signed up yet.</td>
                </tr>`
              : list.interest.map(
                  (row) =>
                    html`<tr>
                      <th scope="row">
                        ${row.name}
                        <span class="admin-stack">
                          <span class="admin-mono admin-break">${row.email}</span>
                          <span>${formatLondon(row.createdAt)}</span>
                        </span>
                      </th>
                      <td class="admin-col-wide admin-mono admin-break">${row.email}</td>
                      <td class="admin-col-wide">${formatLondon(row.createdAt)}</td>
                      <td>
                        ${
                          row.consent
                            ? html`<span class="admin-chip admin-chip-paid">Yes</span>`
                            : html`<span class="admin-chip admin-chip-flag"
                                >No — do not write</span
                              >`
                        }
                      </td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
      <p><a href="${NN_SECTION}/">Back to race admin</a></p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

function medicalPage(viewer: AdminViewer, note: AdminMedicalNote): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Medical note</h1>
      <p class="admin-quiet">
        ${note.firstName} ${note.lastName}${note.club === null ? null : ` · ${note.club}`}
      </p>
      ${
        note.notes === null
          ? html`<p>
              There is no note against this entry — either none was written, or the
              separate medical consent was not given, in which case nothing was ever
              stored.
            </p>`
          : html`<blockquote class="admin-note">${note.notes}</blockquote>`
      }
      <p class="admin-grave">
        This is <strong>special category data</strong>. Reading it has been recorded
        against your role.
      </p>
      <p>
        <a href="${NN_SECTION}/entries/${note.eventSlug}/">Back to the entries</a>
      </p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// One entry, in full
// -----------------------------------------------------------------------------------------

/**
 * `POST /admin/nn/entry/` — everything the club holds about one purchase.
 *
 * **The list is a table, and a table can only carry what fits in a column.** The facts a
 * volunteer needs when somebody rings up are the ones that did not fit: which address paid,
 * when the payment settled, Stripe's references, the emergency contact, what the club still
 * owes them by email, every ask that has been made about it, and what has already been done to
 * the record. Before this, the answer was three browser tabs and two more credentials.
 *
 * **A purchase and not an entrant**, for the reason #116 made the list purchase-driven: the
 * thing with a status, an amount, a payment and a history is the purchase, and it is the only
 * shape that can render a cancelled entry at all — `cancel_entry()` deletes the runner.
 *
 * It reads and changes nothing, so there is no CSRF token and none is minted. See ADR-024.
 */
async function entryDetailResponse(
  request: Request,
  cfg: SupabaseConfig,
  viewer: AdminViewer,
): Promise<Response> {
  const form = await readForm(request);
  const purchaseId = form?.get('purchaseId');

  if (typeof purchaseId !== 'string' || !isUuid(purchaseId)) {
    return notFound();
  }

  const detail = await fetchEntryDetail(
    createUserClient(cfg, viewer.accessToken),
    purchaseId,
  );

  if (detail.status === 'unavailable') {
    // A code and a message, never a row — the property the whole surface depends on.
    console.error(`entries.admin_entry_detail unavailable — ${detail.error}`);
    return page('Entry', unavailablePage(viewer, detail.cause), { status: 503 });
  }

  if (detail.status !== 'ok') {
    // `unauthorised` and `not-found` answer identically, exactly as every other read here does.
    return notFound();
  }

  return page('Entry', entryDetailPage(viewer, detail), {});
}

/** A fact and its label, or nothing at all when there is nothing to say. */
function fact(label: string, value: Html | string | null): Html | null {
  return value === null
    ? null
    : html`<dt>${label}</dt>
        <dd>${value}</dd>`;
}

/** A timestamp in the club's words, or a dash. `formatLondon` and nothing else, ever. */
function when(value: string | null): string {
  return value === null ? '—' : formatLondon(value);
}

function entryDetailPage(viewer: AdminViewer, detail: AdminEntryDetail): Html {
  const purchase = detail.purchase;
  const runner = detail.entrants.find((entrant) => entrant.role === 'runner') ?? null;

  // **The same two controls the row offers, and offered on the same conditions.** A page that
  // showed a Transfer button where the list does not would be a page promising something
  // `entries.transfer_entry()` refuses — see `entryRow` for why a guide narrows it.
  const cancellable =
    can(viewer, 'nn.entry.cancel') &&
    (purchase.status === 'paid' || purchase.status === 'pending');
  const transferable = cancellable && detail.entrants.length === 1;

  const open = detail.requests.filter((request) => request.resolvedAt === null);

  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>
        ${
          runner === null
            ? 'No runner recorded'
            : `${runner.firstName} ${runner.lastName}`
        }
      </h1>
      <p class="admin-quiet">
        ${purchase.eventName} ·
        <span class="admin-mono"
          >${formatEntryReference({
            eventSlug: purchase.eventSlug,
            entryNo: purchase.entryNo,
            createdAt: purchase.createdAt,
            purchaseId: purchase.purchaseId,
          })}</span
        >
        ${
          /* **The purchase id underneath, because this page is where a payment is
          reconciled.** The reference above is what a runner quotes; the id is what Stripe's
          metadata carries and what every `admin_audit` row keys on, so a volunteer with the
          Stripe dashboard open needs both. Only on this page: the list and the queue print the
          reference alone, which is the string somebody is reading out. */ null
        }
        ${
          purchase.entryNo === null
            ? null
            : html`<br /><span class="admin-mono admin-sub">${purchase.purchaseId}</span>`
        }
      </p>

      ${
        /* **The reference in full, and it is the one thing on this page somebody reads out
        loud.** `/account/entries/` and all four emails print the same string through the same
        function, so it is what a runner emailing the club names their entry by. */ null
      }
      ${
        open.length === 0
          ? null
          : html`<p class="admin-warn" role="status">
              <strong
                >${plural(open.length, 'One ask', `${open.length} asks`)} outstanding on
                this entry.</strong
              >
              ${
                /* **Keyed on whether the asks disagree, not on how many there are.** Two
                cancellations are one person pressing twice and want the same thing; a
                cancellation and a transfer want opposite things — a refund and deliberately no
                refund — and that is the pair a volunteer has to read before touching either.
                Counting instead would say "read both" about three asks and about two identical
                ones, which is the sentence that teaches somebody to skip it. */ null
              }
              ${
                disagree(open)
                  ? 'They do not agree with each other — read them before acting.'
                  : null
              }
            </p>`
      }

      <div class="admin-panel">
        <div class="admin-panel-head"><h3>The payment</h3></div>
        <div class="admin-panel-body">
          <dl class="admin-facts">
            ${fact('Status', purchaseStatusWords(purchase))}
            ${fact('Fee', purchase.feeLabel)}
            ${fact(
              'Amount',
              html`<span class="admin-mono">${formatPence(purchase.amountPence)}</span>`,
            )}
            ${fact(
              'Discount code',
              purchase.discountCode === null
                ? null
                : html`<span class="admin-mono">${purchase.discountCode}</span>`,
            )}
            ${fact('Entered', when(purchase.createdAt))}
            ${fact('Paid', when(purchase.paidAt))}
            ${fact(
              'Hold ran out',
              purchase.holdExpiresAt === null ? null : when(purchase.holdExpiresAt),
            )}
            ${fact(
              'Paid late',
              purchase.revivedAt === null
                ? null
                : `${when(purchase.revivedAt)} — after the hold had lapsed`,
            )}
            ${fact(
              'Needs a human',
              purchase.attention === null
                ? null
                : html`<strong class="admin-error"
                      >${attentionWords(purchase.attention)}</strong
                    >${
                      purchase.attentionResolvedAt === null
                        ? null
                        : html` — cleared ${when(purchase.attentionResolvedAt)}`
                    }`,
            )}
            ${fact(
              'Stripe checkout session',
              purchase.stripeCheckoutSessionId === null
                ? null
                : html`<span class="admin-mono"
                    >${purchase.stripeCheckoutSessionId}</span
                  >`,
            )}
            ${fact(
              'Stripe payment',
              purchase.stripePaymentIntentId === null
                ? null
                : html`<span class="admin-mono">${purchase.stripePaymentIntentId}</span>`,
            )}
            ${fact('Terms agreed to', purchase.consentVersion)}
          </dl>
          ${
            /* **What was agreed to is deliberately not here, and only the version is.** ADR-022
            put the visually impaired declaration in `entry_purchases.consents` rather than in a
            column precisely so that no read would return it: it is data about disability, held
            as the lawful basis for a guide's row, and never a fact on a screen. No read has ever
            returned that column and this page does not become the first. */ null
          }
        </div>
      </div>

      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Who paid</h3>
          <p class="admin-panel-note">
            Every message about this entry goes to this address.
          </p>
        </div>
        <div class="admin-panel-body">
          <dl class="admin-facts">
            ${fact('Name', purchase.purchaserName)}
            ${fact(
              'Email',
              html`<span class="admin-mono">${purchase.purchaserEmail}</span>`,
            )}
            ${fact(
              'Account',
              purchase.linkedToAccount
                ? 'Claimed — they can see this at /account/entries/'
                : /* **Not a fault, and the page says so.** An account is not required to enter
                     and is never created by entering, so most paid entries sit like this until
                     somebody registers with the same address and claims them. */
                  'No account yet. It appears on their account the moment they register with this address and confirm it.',
            )}
          </dl>
        </div>
      </div>

      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>${plural(detail.entrants.length, 'The runner', 'On this entry')}</h3>
        </div>
        <div class="admin-panel-body">
          ${
            detail.entrants.length === 0
              ? html`<p>
                  No runner is recorded against this entry. That is what a cancelled entry
                  looks like: the refund deleted the entrant, deliberately, so the club
                  stops holding somebody's details for a race they are not running.
                </p>`
              : detail.entrants.map((entrant) =>
                  entrantFacts(entrant, detail.entrants.length > 1),
                )
          }
        </div>
      </div>

      ${requestsPanel(detail.requests)} ${emailsPanel(detail)} ${auditPanel(detail)}
      ${
        /* **A `div` rather than a `p`, and it matters.** A `<form>` is flow content and a
        paragraph may hold only phrasing content, so a browser closes the `<p>` at the first
        form and reopens one after — which is a different tree from the one this code reads
        like, and the sort of thing that renders fine until a stylesheet depends on it. Every
        other `.admin-actions` on this surface is a `div` for the same reason. */ null
      }
      <div class="admin-actions">
        ${
          cancellable
            ? html`<form method="post" action="${NN_SECTION}/cancel/">
                <input type="hidden" name="purchaseId" value="${purchase.purchaseId}" />
                <button type="submit" class="admin-button">Cancel this entry</button>
              </form>`
            : null
        }
        ${
          transferable
            ? html`<form method="post" action="${NN_SECTION}/transfer/">
                <input type="hidden" name="purchaseId" value="${purchase.purchaseId}" />
                <button type="submit" class="admin-button admin-button-quiet">
                  Transfer this entry
                </button>
              </form>`
            : null
        }
      </div>

      <p>
        <a href="${NN_SECTION}/entries/${purchase.eventSlug}/">Back to the entries</a>
      </p>
    </main>`;
}

/**
 * Whether the outstanding asks on an entry want different things.
 *
 * **The pair that matters is a cancellation and a transfer**: one wants a refund and the other
 * deliberately does not, so acting on the wrong one either takes a place off somebody who
 * wanted to hand it to a friend, or hands on a place somebody wanted their money back for.
 * Two of the same word are one person pressing twice, and need no warning at all.
 */
function disagree(asks: EntryRequest[]): boolean {
  return new Set(asks.map((ask) => ask.action)).size > 1;
}

/**
 * The status of one purchase in words.
 *
 * **Its own function rather than `statusWords`**, which takes an `AdminEntry` off the list and
 * carries filter state this page has none of. Same vocabulary, so the two pages agree — and a
 * little more of it, because a page with room can say what a chip in a column cannot.
 */
function purchaseStatusWords(purchase: AdminEntryDetail['purchase']): string {
  if (purchase.attention === 'over_capacity' && purchase.attentionResolvedAt === null) {
    return 'Over capacity';
  }

  if (purchase.status === 'paid') return 'Paid';
  if (purchase.status === 'refunded') return 'Refunded — the place went back';
  if (purchase.status === 'expired') return 'Hold expired — the place went back';

  return 'Held, part way through paying';
}

/**
 * One person on the entry, and everything recorded about them.
 *
 * **`named` is false for a solo entry, and that is not a cosmetic choice.** The heading at the
 * top of the page is already this person's name, and the panel this sits in is already headed
 * "The runner" — so repeating it here gave the page two headings with the same accessible name
 * and nothing to tell them apart. A reader moving by heading hears the same words twice and
 * learns nothing the second time.
 *
 * It earns its place the moment there are two people: a visually impaired runner and their
 * guide are one entry and two sets of facts, and each set needs saying whose it is.
 */
function entrantFacts(entrant: AdminEntryDetailEntrant, named: boolean): Html {
  const category =
    entrant.role === 'guide'
      ? 'Guide — in no category, not timed and not placed'
      : entrant.gender === null
        ? 'No category — no race category recorded'
        : categoryLabel(entrant.age, entrant.gender, entrant.resultPlacement);

  return html`<section class="admin-entrant">
    ${
      named
        ? html`<h4>
            ${entrant.firstName} ${entrant.lastName}
            ${
              entrant.role === 'guide'
                ? html`<span class="admin-chip">Guide</span>`
                : /* Said only on the guide, because "runner" on every other entry is a word
                     that carries nothing. */ null
            }
          </h4>`
        : null
    }
    <dl class="admin-facts">
      ${fact('Date of birth', entrant.dateOfBirth)}
      ${fact('Age on race day', String(entrant.age))} ${fact('Category', category)}
      ${fact(
        'Race category',
        entrant.gender === null ? null : genderLabel(entrant.gender),
      )}
      ${
        /* **Shown only for a non-binary entrant, and only they can have answered it.**
        `entrants_result_placement_only_non_binary` is what makes a null here mean "female
        or male" everywhere else on this page — ADR-031. */
        fact(
          'Placement',
          entrant.gender === 'non_binary'
            ? entrant.resultPlacement === null
              ? 'Neither — asked, and chose not to be placed'
              : genderLabel(entrant.resultPlacement)
            : null,
        )
      }
      ${
        /* **The open question beside the closed one, and it is not a category** — ADR-020. It
        is shown here for the reason it is shown on the list: a field the club collects and
        never surfaces is a field collected for no purpose. It is on this surface and nowhere
        else, and never in an export. */ null
      }
      ${fact('Gender identity', entrant.genderIdentity)}
      ${fact('Club', entrant.club ?? 'Unattached')}
      ${
        /* **No England Athletics number here, and there never was one.** The club stopped
        asking for and holding them on 29 August 2026 — ADR-023 — so this page would have
        rendered an empty row for ever. Which fee was the affiliated price is the fee's own
        label, on the payment panel above. */ null
      }
      ${
        /* A guide's own address. Null for a runner, who is reached at the address that paid —
           which is on the panel above rather than repeated here. */ null
      }
      ${fact(
        'Their own email',
        entrant.email === null
          ? null
          : html`<span class="admin-mono">${entrant.email}</span>`,
      )}
      ${
        /* **Above the emergency contact, and labelled "Their own number" rather than "Phone".**
           Two numbers on one panel are worth telling apart in the label rather than in the
           order, because a volunteer scanning this on a phone at the registration desk is the
           person who rings the wrong one. Null for a guide, who is not asked, and null on
           every entry taken before ADR-025 — `fact` renders nothing at all for a null, which
           is what keeps an old entry from showing an empty row for ever. */ null
      }
      ${fact(
        'Their own number',
        entrant.phone === null
          ? null
          : html`<span class="admin-mono">${entrant.phone}</span>`,
      )}
      ${fact('Emergency contact', entrant.emergencyContactName)}
      ${fact(
        'Emergency number',
        html`<span class="admin-mono">${entrant.emergencyContactPhone}</span>`,
      )}
      ${fact('Added', when(entrant.createdAt))}
      <dt>Medical note</dt>
      <dd>
        ${
          entrant.hasMedical
            ? html`<form method="post" action="${NN_SECTION}/medical/">
                <input type="hidden" name="entrantId" value="${entrant.entrantId}" />
                <button type="submit" class="admin-linkish">
                  Show note
                  <span class="admin-visually-hidden">
                    for ${entrant.firstName} ${entrant.lastName}
                  </span>
                </button>
              </form>`
            : 'None'
        }
        ${
          /* **Whether, and never what.** The note has one door and that door writes an audit
          row every time it opens. Rendering the text here would be a second, unaudited read of
          special category data, which is the one thing this page must not become. */ null
        }
      </dd>
    </dl>
  </section>`;
}

/**
 * Every ask somebody has made about this entry.
 *
 * **This panel is the whole reason the history table exists.** `requested_action` held one
 * word, so somebody who pressed *Transfer* and then thought better of it and pressed *Cancel*
 * left a record saying only the second — and read the other way round, a volunteer looking at
 * *"transfer asked for"* had no way to know a cancellation had been asked for afterwards. The
 * two want opposite things, so acting on the wrong one either takes a place off somebody who
 * wanted to hand it to a friend, or hands on a place somebody wanted their money back for.
 */
function requestsPanel(requests: EntryRequest[]): Html {
  return html`<div class="admin-panel">
    <div class="admin-panel-head">
      <h3>What they have asked for</h3>
      <p class="admin-panel-note">
        Newest first. Asking changes nothing on its own — the entry still holds its place.
      </p>
    </div>
    <div class="admin-panel-body">
      ${
        requests.length === 0
          ? html`<p>Nothing has been asked about this entry.</p>`
          : html`<ol class="admin-timeline">
              ${requests.map(
                (request) =>
                  html`<li>
                    <strong>${entryRequestWords(request.action)}</strong>
                    <span class="admin-sub">${when(request.requestedAt)}</span>
                    ${
                      request.resolvedAt === null
                        ? html`<span class="admin-chip admin-chip-flag"
                            >Outstanding</span
                          >`
                        : html`<span class="admin-chip admin-chip-gone"
                            >Dealt with ${when(request.resolvedAt)}</span
                          >`
                    }
                    ${
                      /* **Their own words, and this is why an ask is worth recording at all.**
                    "Cancellation asked for" is a word; "I broke my ankle on Tuesday" and "my
                    friend would like my place" are two different afternoons. Never exported,
                    for the reason `gender_identity` is not. */ null
                    }
                    ${
                      request.reason === null
                        ? null
                        : html`<blockquote class="admin-note">
                            ${request.reason}
                          </blockquote>`
                    }
                  </li>`,
              )}
            </ol>`
      }
    </div>
  </div>`;
}

/**
 * What the club has told this person, and what it still owes them.
 *
 * **The same rows `/admin/emails/` shows, filtered to this entry.** Somebody looking at an
 * entry because a runner said they never heard anything should not have to go and find it in a
 * queue of every message the club has ever sent.
 */
function emailsPanel(detail: AdminEntryDetail): Html {
  return html`<div class="admin-panel">
    <div class="admin-panel-head">
      <h3>Emails about this entry</h3>
      <p class="admin-panel-note">
        <a href="${ADMIN_PREFIX}/emails/">The whole queue</a> is where a failed message is
        sent again.
      </p>
    </div>
    <div class="admin-panel-body">
      ${
        detail.emails.length === 0
          ? html`<p>
              The club owes no message about this entry. Only four things are written: an
              entry confirmed, an entry refunded, and the two halves of a transfer.
            </p>`
          : html`<ol class="admin-timeline">
              ${detail.emails.map(
                (message) =>
                  html`<li>
                    <strong>${emailTemplateWords(message.template)}</strong>
                    <span class="admin-sub admin-mono">${message.recipient}</span>
                    <span class="admin-chip">${emailStatusWords(message)}</span>
                    <span class="admin-sub">
                      Written
                      ${when(message.createdAt)}${
                        message.sentAt === null
                          ? null
                          : `, sent ${formatLondon(message.sentAt)}`
                      }
                    </span>
                    ${
                      /* **A code, never the provider's own message.** Resend's error text can
                    quote the address it rejected, which is how an email address ends up
                    somewhere that was never assessed to hold one. */ null
                    }
                    ${
                      message.lastError === null
                        ? null
                        : html`<span class="admin-sub admin-error"
                            >${message.lastError}</span
                          >`
                    }
                  </li>`,
              )}
            </ol>`
      }
    </div>
  </div>`;
}

/** What each template is, in the club's words rather than as a slug. */
function emailTemplateWords(template: string): string {
  if (template === 'entry_confirmed') return 'Entry confirmed';
  if (template === 'entry_refunded') return 'Entry cancelled and refunded';
  if (template === 'entry_transferred_out') return 'Place transferred away';
  if (template === 'entry_transferred_in') return 'Place transferred to them';

  // A row this build has not heard of is a database ahead of this Worker, and the slug is more
  // use than a word that says nothing.
  return template;
}

function emailStatusWords(message: AdminEntryDetail['emails'][number]): string {
  if (message.status === 'sent') return 'Sent';
  if (message.status === 'failed') {
    return `Failed after ${plural(message.attempts, '1 try', `${message.attempts} tries`)}`;
  }

  return 'Waiting to go';
}

/**
 * What has been done to this entry, and by whom.
 *
 * **This is a change of position and it was taken deliberately** — see ADR-024. The audit trail
 * was kept off this surface on the argument that reading `entries.admin_audit` would need
 * another function granted to `anon`; half that argument expired with the two-key scheme, and
 * the other half was that it is a decision, which this is.
 *
 * **Scoped to one entry, never the whole trail.** It is a history of a record rather than a log
 * of what each volunteer has been doing, and there is still no way to read the table as a list.
 *
 * **The actor is a pseudonym and stays one.** `auth.uid()`, which maps to a human only through
 * `identity.people` — ADR-013's amendment, which this does not reopen. What it can do is say
 * when the person reading is the person who acted.
 */
function auditPanel(detail: AdminEntryDetail): Html {
  return html`<div class="admin-panel">
    <div class="admin-panel-head">
      <h3>What has been done to it</h3>
      <p class="admin-panel-note">
        Newest first. Who did it is recorded as an account reference rather than a name.
      </p>
    </div>
    <div class="admin-panel-body">
      ${
        detail.audit.length === 0
          ? html`<p>
              Nothing has been done to this entry by anybody at the club. Entering, paying
              and asking for something are the runner's own acts and are not recorded here
              — they are above.
            </p>`
          : html`<ol class="admin-timeline">
              ${detail.audit.map(
                (row) =>
                  html`<li>
                    <strong>${auditWords(row.action)}</strong>
                    <span class="admin-sub">${when(row.at)}</span>
                    <span class="admin-sub admin-mono">${shortId(row.actor)}</span>
                    ${auditDetailWords(row.detail)}
                  </li>`,
              )}
            </ol>`
      }
      ${
        /* ⚠️ **One gap, and it is the price of a promise worth keeping.** A medical note read
        against an entrant who has since been deleted cannot be matched back to this purchase,
        because the id it names no longer joins to anything. `cancel_entry()` deleting the
        runner is the more important half of that trade. */ null
      }
    </div>
  </div>`;
}

function auditWords(action: string): string {
  if (action === 'cancel_entry') return 'Cancelled and refunded';
  if (action === 'transfer_entry') return 'Transferred to a new runner';
  if (action === 'create_manual_entry') return 'Given as a complimentary place';
  if (action === 'medical_note') return 'Medical note read';
  if (action === 'medical_export') return 'Medical sheet taken';
  if (action === 'export') return 'Exported';
  if (action === 'resend_email') return 'A message was sent again';
  if (action === 'sign_in') return 'Signed in';

  return action;
}

/**
 * The few keys from an audit row worth reading, in words.
 *
 * **Not the whole `detail` object.** It is written by the database for the database, and
 * rendering it raw would put ids and shapes on a page a volunteer reads — and would quietly
 * become the way a future key ends up on screen without anybody deciding it should.
 */
function auditDetailWords(detail: Record<string, unknown>): Html | null {
  const parts: string[] = [];

  if (typeof detail.previous_runner === 'string') {
    parts.push(`was ${detail.previous_runner}'s`);
  }

  if (typeof detail.amount_pence === 'number') {
    parts.push(formatPence(detail.amount_pence));
  }

  if (typeof detail.refund_reference === 'string') {
    parts.push(`refund ${detail.refund_reference}`);
  }

  if (typeof detail.kind === 'string') {
    parts.push(detail.kind);
  }

  if (typeof detail.reason === 'string') {
    parts.push(detail.reason);
  }

  return parts.length === 0
    ? null
    : html`<span class="admin-sub">${parts.join(' · ')}</span>`;
}

// -----------------------------------------------------------------------------------------
// Small pieces
// -----------------------------------------------------------------------------------------

/**
 * The category, named by `packages/shared/src/age-category.ts` and by nothing here.
 *
 * **Takes `gender` and `resultPlacement` both, and resolves them the one way anything on
 * this surface may** — `effectiveCategory()`, so the admin list, the start list and the
 * entry-detail page can never disagree about which of the two facts they read. "No category
 * yet" now covers both a non-binary entrant who was never asked and one who chose neither —
 * ADR-031 — which the club's own unfinished decision about a non-binary prize band still
 * covers either way.
 */
export function categoryLabel(
  age: number,
  gender: Gender,
  resultPlacement: ResultPlacement,
): string {
  const category = ageCategoryFor(age, effectiveCategory(gender, resultPlacement));

  if (category.known) {
    return category.label;
  }

  return category.reason === 'not-placed' ? 'No category yet' : 'Under 18';
}

function statusFilterLabel(status: StatusFilter): string {
  if (status === 'all') return 'All';
  if (status === 'paid') return 'Paid';
  if (status === 'pending') return 'Held';
  if (status === 'expired') return 'Hold expired';
  if (status === 'refunded') return 'Refunded';
  // **"Needs attention" here and "Needs a human" on the panel, deliberately different.** The panel
  // is an alarm and the filter is a view of the table; giving them the same words made a page with
  // nothing wrong with it contain the alarm's wording, which is exactly what the test asserting
  // the panel's *absence* is there to catch.
  if (status === 'requested') return 'Asked about';

  return 'Needs attention';
}

function feeFilterLabel(fee: string, list: AdminEntryList): string {
  if (fee === 'all') {
    return 'All';
  }

  return list.entries.find((entry) => entry.feeCode === fee)?.feeLabel ?? fee;
}

function sortLabel(sort: Sort): string {
  if (sort === 'entered') return 'Newest';
  if (sort === 'category') return 'Age';
  if (sort === 'status') return 'Status';
  return 'Name';
}

/**
 * One filter link, carrying the other two parameters forward.
 *
 * **Built from the request's own URL** so choosing a status keeps the sort somebody had already
 * chosen. `aria-current="true"` rather than a class alone, so the selected one is announced as
 * selected and not merely coloured.
 */
/**
 * Everything on this page's address except one parameter, preserved.
 *
 * **`append`, not `set`.** Every filter is multi-valued now, and `set` collapses repeated
 * parameters to the last one — so rebuilding a URL with it would silently drop every selection
 * but one on the *other* rows. That is the kind of defect that looks like a filter "not
 * sticking" and gets diagnosed for an hour.
 */
function withoutParameter(url: URL, parameter: string): URL {
  const next = new URL(url.toString());
  next.search = '';

  for (const [key, existing] of url.searchParams) {
    if (key !== parameter) {
      next.searchParams.append(key, existing);
    }
  }

  return next;
}

function chip(href: string, label: string, on: boolean): Html {
  return html`<li>
    <a
      href="${href}"
      class="admin-filter ${on ? 'admin-filter-on' : ''}"
      ${on ? raw('aria-current="true"') : null}
      >${label}</a
    >
  </li>`;
}

/**
 * One chip in a multi-select row: clicking adds the value, clicking again takes it away.
 *
 * **"All" is the empty set rather than a value.** It clears the parameter entirely, so the
 * address of an unfiltered page carries nothing — which is what makes a bookmarked or pasted
 * URL mean the same thing next month, and what lets `readFilters` treat *absent* as "every".
 */
function toggleLink(
  url: URL,
  parameter: string,
  value: string,
  label: string,
  selected: ReadonlySet<string>,
): Html {
  const next = withoutParameter(url, parameter);
  const on = value === 'all' ? selected.size === 0 : selected.has(value);

  if (value !== 'all') {
    const after = new Set(selected);

    if (after.has(value)) {
      after.delete(value);
    } else {
      after.add(value);
    }

    for (const kept of [...after].sort()) {
      next.searchParams.append(parameter, kept);
    }
  }

  return chip(`${next.pathname}${next.search}`, label, on);
}

/** Sort is the one control that is still one-of, because a list has one order. */
function sortLink(url: URL, value: string, label: string, selected: string): Html {
  const next = withoutParameter(url, 'sort');
  next.searchParams.append('sort', value);

  return chip(`${next.pathname}${next.search}`, label, value === selected);
}

/**
 * The control that turns the default off, and the reason it is a sentence rather than a chip.
 *
 * **The absence of `hide` is not neutral** — it means `fee:tester`, so a row of chips would have
 * to show a selection nobody made, in a row nobody looked at, to be honest about it. A line
 * saying what is being left out, with the link that stops it, says the same thing in the place
 * somebody will actually read it.
 *
 * `hide=none` is how "leave nothing out" is written. It has to be written down rather than
 * implied by an empty parameter, because empty and absent would otherwise mean opposite things.
 */
function hideToggle(url: URL, filters: EntryFilters): Html {
  return html`${HIDE_GROUPS.map((group) => {
    const hiding = group.values.every((value) => filters.hide.has(value));
    const after = new Set(filters.hide);

    // **The group moves as a unit and the other group is carried forward untouched**, which is
    // what makes two lines two independent controls rather than two ways of writing over each
    // other. Same reasoning as `toggleLink`'s `append` over `set`.
    for (const value of group.values) {
      if (hiding) {
        after.delete(value);
      } else {
        after.add(value);
      }
    }

    const next = withoutParameter(url, 'hide');

    if (after.size === 0) {
      next.searchParams.append('hide', 'none');
    } else {
      for (const kept of [...after].sort()) {
        next.searchParams.append('hide', kept);
      }
    }

    const href = `${next.pathname}${next.search}`;

    return html`<p class="admin-filters-note">
      ${hiding ? group.hidden : group.shown}
      <a href="${href}">${hiding ? 'Show them' : 'Hide them'}</a>
    </p>`;
  })}`;
}

function exportButton(
  slug: string,
  kind: ExportKind,
  label: string,
  className: string,
): Html {
  return html`<form method="post" action="${NN_SECTION}/export/">
    <input type="hidden" name="event" value="${slug}" />
    <input type="hidden" name="kind" value="${kind}" />
    <button type="submit" class="admin-button ${className}">${label}</button>
  </form>`;
}

function postButton(
  action: string,
  slug: string,
  label: string,
  className: string,
): Html {
  return html`<form method="post" action="${action}">
    <input type="hidden" name="event" value="${slug}" />
    <button type="submit" class="${className}">${label}</button>
  </form>`;
}

/** One or the other. Written out rather than concatenated, so each reads as a sentence. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The last four characters of an id, for somewhere a whole one would not earn its space.
 *
 * **The attention panel does not use this any more** — see `entryReference()` below. What is
 * left is the audit trail's actor, which is a pseudonym rather than a reference: nobody types
 * it, nobody quotes it, and its last four characters are enough to see that two rows were
 * written by the same person.
 */
function shortId(id: string): string {
  return `…${id.slice(-4)}`;
}

/**
 * What to call one entry on this surface — the same string the runner was emailed.
 *
 * **The attention panel used to print `…5555`**, the tail of a purchase id, and the note under
 * it explained that the names were in the table below. That was the best a 36-character
 * hexadecimal reference allowed. `NN2026-0042-01092026` is short enough to print whole, and
 * printing it whole is what lets a volunteer match this queue against the email a runner is
 * quoting at them.
 *
 * The tail is still the fallback for a purchase written before `entry_no` existed, because the
 * alternative — `formatEntryReference()`'s own fallback — is the full id, which is the length
 * this panel could not afford in the first place.
 */
function entryReference(entry: AdminEntry, eventSlug: string): string {
  return entry.entryNo === null
    ? shortId(entry.purchaseId)
    : formatEntryReference({
        eventSlug,
        entryNo: entry.entryNo,
        createdAt: entry.createdAt,
        purchaseId: entry.purchaseId,
      });
}

/**
 * The three failures a list can meet, mapped the same way for both lists.
 *
 * **`unauthorised` is a 404 now, and that is the change #58 makes here.** Under the key scheme
 * it meant the Worker's own key had stopped matching the digest — a half-finished rotation —
 * and the answer was the sign-in page. Under the role scheme the caller has already been
 * checked for `nn-admin` by `admin.ts` before any of this runs, so a refusal from the database
 * means the grant was revoked between that check and this read. The honest answer to somebody
 * who no longer holds the role is the same one everybody without it gets: the address does not
 * exist. The log line is where the cause goes.
 */
function listResponse<T>(
  result: AdminResult<T>,
  viewer: AdminViewer,
  title: string,
  render: (value: T) => Html,
): Response {
  if (result.status === 'unavailable') {
    console.error(`entries admin read unavailable — ${result.error}`);
    return page(title, unavailablePage(viewer), { status: 503 });
  }

  if (result.status === 'unauthorised') {
    console.error('entries admin read refused a caller admin.ts had let through');
    return notFound();
  }

  if (result.status === 'not-found') {
    return notFound();
  }

  return page(title, render(result), {});
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** A body that is not a form is treated exactly as an empty one. */
async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------------------
// Cancelling an entry
// -----------------------------------------------------------------------------------------

/**
 * Cancel one entry: refund it through Stripe, then record it.
 *
 * ## The order, and why it is this way round
 *
 * **Stripe first, the database second.** ADR-018 argues it in full; the short version is that
 * this ordering is the one a retry repairs. The refund is idempotent on the purchase id, so
 * running the whole thing again after a failure in the second half returns the same refund and
 * completes the record. The other ordering — mark it cancelled, then call Stripe — leaves a
 * released place, a deleted entrant and the club holding the money, with nothing on the row
 * saying a refund is owed.
 *
 * ## Two POSTs, not one
 *
 * The button on the entry list is a `GET`-safe link to nothing; the first POST here renders a
 * confirmation naming the amount and the entry's own reference, and the second does it.
 * **A single-click destructive control on a table of two hundred rows is a mis-tap away from
 * refunding a stranger**, and unlike every other control on this surface there is no undo:
 * the entrant row and their medical note are gone, and re-entering is a fresh purchase at
 * whatever the price is that day.
 *
 * ## What is checked, and where
 *
 *   * `nn.entry.cancel`, in `handleNnSection` before this runs — the ordering discipline the
 *     whole surface uses.
 *   * The CSRF token, here, because this is a state-changing POST and the session cookie is
 *     `SameSite=Lax`. Same double-submit scheme `/admin/people/` uses.
 *   * `nn.entry.cancel` **again**, inside `entries.cancel_entry()`, which is the control. This
 *     one is the only one that matters; the two above are what make the page honest.
 */
/**
 * `POST /admin/nn/transfer/` — the same place, a different runner.
 *
 * **Two POSTs, exactly as cancelling is.** The first carries no token and changes nothing: it
 * renders the form and mints the token the second has to echo. That is what makes a transfer
 * impossible to trigger by following a link.
 *
 * **No Stripe call anywhere on this path.** The money stays where it is and the place never
 * returns to the pool, which is the whole difference between this and cancelling — a
 * transferred place cannot be taken by somebody else in between.
 */
async function transferResponse(
  request: Request,
  cfg: SupabaseConfig,
  viewer: AdminViewer,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const purchaseId = form?.get('purchaseId');

  if (typeof purchaseId !== 'string' || !isUuid(purchaseId)) {
    return notFound();
  }

  if (form?.get('confirm') !== 'yes') {
    const token = mintCsrfToken();

    return page('Transfer entry', transferFormPage(viewer, purchaseId, token, null), {
      cookies: [csrfCookie(token, secure)],
    });
  }

  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    const token = mintCsrfToken();

    return page(
      'Transfer entry',
      transferFormPage(
        viewer,
        purchaseId,
        token,
        'That form had expired. Please try again.',
      ),
      { cookies: [csrfCookie(token, secure)] },
    );
  }

  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };

  const gender = read('gender');
  const dateOfBirth = read('dateOfBirth');

  // **The form's own control, and it is not the system's.** Everything here is re-checked
  // inside `entries.transfer_entry()` — the permission, the minimum age, one-runner-one-place
  // — because this function is reachable only through a browser and that one is reachable
  // through PostgREST.
  if (
    read('email') === '' ||
    read('firstName') === '' ||
    read('lastName') === '' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
    !(NN_ENTRY_GENDERS as readonly string[]).includes(gender) ||
    read('emergencyName') === '' ||
    read('emergencyPhone') === '' ||
    read('phone') === ''
  ) {
    const token = mintCsrfToken();

    return page(
      'Transfer entry',
      transferFormPage(
        viewer,
        purchaseId,
        token,
        'Every box except the club is needed, and the date of birth has to be a real date.',
      ),
      { cookies: [csrfCookie(token, secure)] },
    );
  }

  const outcome = await transferEntry(
    createUserClient(cfg, viewer.accessToken),
    purchaseId,
    {
      email: read('email'),
      firstName: read('firstName'),
      lastName: read('lastName'),
      dateOfBirth,
      gender: gender as (typeof NN_ENTRY_GENDERS)[number],
      club: read('club') === '' ? null : read('club'),
      emergencyContactName: read('emergencyName'),
      emergencyContactPhone: read('emergencyPhone'),
      // **Required by this form and not by `transfer_entry()`**, which takes a null and simply
      // clears the previous runner's number. The split is deliberate: the function has to keep
      // working for a Worker deployed before ADR-025, and this form is the Worker that came
      // after. A place that moves should arrive with a way to reach whoever it moved to.
      phone: read('phone'),
    },
  );

  if (outcome.status === 'unavailable') {
    console.error(`entries.transfer_entry unavailable — ${outcome.error}`);
    return page('Transfer entry', unavailablePage(viewer, outcome.cause), {
      status: 503,
    });
  }

  // **There is no `ea-number-required` branch here any more, and its absence is a fix.**
  // An affiliated place could not be transferred at all: `transfer_entry()` cleared the
  // previous runner's number, `assert_entrant_rules()` refused the fee without one, and a
  // volunteer was told the club's database could not be reached. Asking the new runner for a
  // number of their own was what closed that; the club stopped asking for numbers on 29 August
  // 2026, so no fee requires one and an affiliated transfer is now an ordinary transfer.

  if (outcome.status !== 'ok') {
    // `unauthorised` and `not-found` answer identically, exactly as every other read and write
    // on this surface does.
    return notFound();
  }

  return page(
    'Transfer entry',
    cancelOutcomePage(
      viewer,
      'The place has a new runner',
      `It was ${outcome.previousRunner}'s and is now recorded against the details you entered. No money moved, and the place never went back into the race. Any medical note the previous runner had written has been deleted, along with how they described their gender.`,
    ),
    {},
  );
}

/**
 * The three gender values in words.
 *
 * **Local rather than shared, because it is a form label and not a category.**
 * `packages/shared`'s `categoryLabel` names a *prize* category, which is a different question
 * with a different answer — the 2023 form offered non-binary and there were no non-binary
 * categories to put those entrants in, which is a committee matter and not a rendering one.
 */
function genderLabel(value: (typeof NN_ENTRY_GENDERS)[number]): string {
  if (value === 'female') {
    return 'Female';
  }

  return value === 'male' ? 'Male' : 'Non-binary';
}

/** The form, and what it warns about before somebody fills it in. */
function transferFormPage(
  viewer: AdminViewer,
  purchaseId: string,
  token: string,
  problem: string | null,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Transfer this entry</h1>

      ${
        problem === null
          ? null
          : html`<p class="admin-error" role="alert"><strong>${problem}</strong></p>`
      }

      <p>
        The place stays exactly where it is — the same purchase, the same amount, the same
        spot in the field. <strong>No money is taken and none is given back.</strong> If
        the runner who is leaving is owed anything, that is between them and whoever is
        taking it on.
      </p>

      <p>
        The entry moves to the email address below. That address does not need an account,
        and one is not created for it: if it ever registers and confirms, the entry
        appears on that account by itself.
      </p>

      <p>
        <strong>The previous runner's medical note is deleted</strong>, along with how
        they described their gender. Each of those belongs to the person who wrote it, and
        the new runner supplies their own or has none.
      </p>

      <form method="post" action="${NN_SECTION}/transfer/" class="admin-form">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
        <input type="hidden" name="purchaseId" value="${purchaseId}" />
        <input type="hidden" name="confirm" value="yes" />

        <p>
          <label for="transfer-email">Email address of the new runner</label>
          <input
            type="email"
            id="transfer-email"
            name="email"
            required
            autocomplete="off"
          />
        </p>

        <p>
          <label for="transfer-first">First name</label>
          <input
            type="text"
            id="transfer-first"
            name="firstName"
            required
            autocomplete="off"
          />
        </p>

        <p>
          <label for="transfer-last">Last name</label>
          <input
            type="text"
            id="transfer-last"
            name="lastName"
            required
            autocomplete="off"
          />
        </p>

        ${
          /* **The new runner's own number, beside their name rather than beside the emergency
          contact's.** The same arrangement the entry form uses and for the same reason: two
          phone boxes on one page are the likeliest pair to be filled in the wrong way round,
          and distance is the cheapest defence. `transfer_entry()` replaces the number rather
          than carrying the previous runner's across — see ADR-025. */ null
        }
        <p>
          <label for="transfer-phone">Their own phone number</label>
          <input
            type="tel"
            id="transfer-phone"
            name="phone"
            required
            autocomplete="off"
          />
        </p>

        <p>
          <label for="transfer-dob">Date of birth</label>
          <input type="date" id="transfer-dob" name="dateOfBirth" required />
        </p>

        ${
          /* **"Race category", the same words the entry form uses — ADR-020.** This asks the
          new runner's category because a results table has to place them. It deliberately does
          **not** ask how they describe their gender: `transfer_entry()` clears the previous
          runner's answer rather than carrying it across, and collecting the new one is its own
          decision rather than something to add here quietly. */ null
        }
        <fieldset>
          <legend>Race category</legend>
          ${NN_ENTRY_GENDERS.map(
            (value: (typeof NN_ENTRY_GENDERS)[number]) =>
              html`<p>
                <input
                  type="radio"
                  id="transfer-gender-${value}"
                  name="gender"
                  value="${value}"
                />
                <label for="transfer-gender-${value}">${genderLabel(value)}</label>
              </p>`,
          )}
        </fieldset>

        <p>
          <label for="transfer-club">Running club (optional)</label>
          <input type="text" id="transfer-club" name="club" autocomplete="off" />
        </p>

        <p>
          <label for="transfer-emergency-name">Emergency contact name</label>
          <input
            type="text"
            id="transfer-emergency-name"
            name="emergencyName"
            required
            autocomplete="off"
          />
        </p>

        <p>
          <label for="transfer-emergency-phone">Emergency contact number</label>
          <input
            type="tel"
            id="transfer-emergency-phone"
            name="emergencyPhone"
            required
            autocomplete="off"
          />
        </p>

        ${
          /* **An England Athletics box was here, and it was the whole of the transfer
          defect.** `transfer_entry()` used to clear the previous runner's number, which
          `assert_entrant_rules()` refused on an affiliated entry — so every affiliated
          transfer raised a `check_violation` that arrived here as "That could not be read: the
          club's database could not be reached". A healthy database, a rule working correctly,
          and a message that named neither. Asking the new runner for their own number was the
          fix; the club stopped asking for numbers on 29 August 2026, so the box is gone and an
          affiliated place transfers like any other. */ null
        }
        <button type="submit" class="admin-button admin-button-grave">
          Move the place to this runner
        </button>
      </form>

      <p><a href="${NN_SECTION}/">Leave it alone and go back to the entries</a></p>
    </main>`;
}

async function cancelResponse(
  request: Request,
  cfg: SupabaseConfig,
  env: StripeEnv,
  viewer: AdminViewer,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);
  const purchaseId = form?.get('purchaseId');

  if (typeof purchaseId !== 'string' || !isUuid(purchaseId)) {
    return notFound();
  }

  const asPerson = createUserClient(cfg, viewer.accessToken);
  const purchase = await fetchCancellablePurchase(asPerson, purchaseId);

  if (purchase.status === 'unavailable') {
    console.error(`entries.cancellable_purchase unavailable — ${purchase.error}`);
    return page('Cancel entry', unavailablePage(viewer), { status: 503 });
  }

  if (purchase.status === 'already-cancelled') {
    return page(
      'Cancel entry',
      cancelOutcomePage(
        viewer,
        'Already cancelled',
        'That entry had already been cancelled and refunded. Nothing has changed.',
      ),
      {},
    );
  }

  if (purchase.status !== 'ok') {
    // `unauthorised` and `not-found` answer identically, exactly as the reads do. A volunteer
    // who may not cancel learns nothing about whether the entry exists.
    return notFound();
  }

  // **The first POST only asks.** No token is required to reach this page — it changes
  // nothing — and the token it mints is what the second POST has to echo back.
  if (form?.get('confirm') !== 'yes') {
    const token = mintCsrfToken();

    return page(
      'Cancel entry',
      cancelConfirmPage(
        viewer,
        purchaseId,
        purchase.amountPence,
        purchase.paymentIntentId,
        token,
      ),
      { cookies: [csrfCookie(token, secure)] },
    );
  }

  if (
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      typeof form.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null,
    )
  ) {
    // Asked again rather than explained, the same answer a missing session gets.
    return notFound();
  }

  // --- Stripe, first ------------------------------------------------------------------------
  let refundReference: string | null = null;

  if (purchase.paymentIntentId !== null) {
    const stripe = stripeConfig(env);

    if (stripe === null) {
      // **Refuse rather than cancel without refunding.** A purchase with a payment intent was
      // paid for with a real card; marking it refunded while no refund can be issued would
      // produce a row that says the money went back when it did not. This is the deployed
      // state today, and it is why the message names the missing secret rather than blaming
      // the volunteer.
      console.error('entries: cancel attempted with no Stripe secret configured');
      return page(
        'Cancel entry',
        cancelOutcomePage(
          viewer,
          'Nothing was cancelled',
          'This entry was paid by card and no Stripe key is configured, so the refund cannot be made. The entry is untouched. Install STRIPE_SECRET_KEY and try again.',
        ),
        { status: 503 },
      );
    }

    const refund = await refundPayment(stripe, {
      purchaseId,
      paymentIntentId: purchase.paymentIntentId,
    });

    if (!refund.ok) {
      // The status and Stripe's classification, never its message — an error message can
      // quote the value that was rejected. Same rule as `createCheckoutSession`.
      console.error(`stripe refund failed — ${refund.error}`);
      return page(
        'Cancel entry',
        cancelOutcomePage(
          viewer,
          'Nothing was cancelled',
          'Stripe refused the refund, so the entry has been left exactly as it was. Nothing was deleted and the place is still taken. Try again, or check the payment in the Stripe dashboard.',
        ),
        { status: 503 },
      );
    }

    refundReference = refund.refundId;
  }

  // --- the record, second -------------------------------------------------------------------
  const cancelled = await cancelEntry(asPerson, purchaseId, refundReference);

  if (cancelled.status === 'unavailable') {
    // **The money is already back and the record still says paid.** Saying so plainly is the
    // whole point: the fix is to press the button again, which refunds nothing the second
    // time because the idempotency key is the purchase id, and completes the record.
    console.error(`entries.cancel_entry unavailable after refund — ${cancelled.error}`);
    return page(
      'Cancel entry',
      cancelOutcomePage(
        viewer,
        'Refunded, but not recorded',
        'The refund was made and the club could not update its own record of it. The entry still shows as paid and the place is still taken. Press Cancel on it again — the refund will not be repeated.',
      ),
      { status: 503 },
    );
  }

  if (cancelled.status === 'already-cancelled' || cancelled.status === 'not-found') {
    return notFound();
  }

  if (cancelled.status !== 'ok') {
    return notFound();
  }

  return page(
    'Cancel entry',
    cancelOutcomePage(
      viewer,
      'Cancelled',
      refundReference === null
        ? 'The entry has been cancelled and the place released. There was no card payment to refund.'
        : 'The entry has been cancelled, the payment refunded and the place released. A card refund can take a few days to appear.',
    ),
    {},
  );
}

/**
 * The confirmation, and it names the money rather than the person.
 *
 * **No name here, deliberately.** This page is reached by a POST carrying a purchase id and
 * nothing else; rendering the entrant's name would mean a second read of personal data purely
 * to decorate a button. The amount and the entry's own reference are what somebody needs to
 * check they are cancelling the right row, and they came back from the call that authorised
 * this one.
 */
function cancelConfirmPage(
  viewer: AdminViewer,
  purchaseId: string,
  amountPence: number,
  paymentIntentId: string | null,
  token: string,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Cancel this entry?</h1>

      <p>
        <strong>This cannot be undone.</strong> The runner is removed from the entry list
        and the start list, any medical note the club holds for them is deleted, and the
        place goes back into the race.
      </p>

      <p>
        Amount:
        <span class="admin-mono">${formatPence(amountPence)}</span>
        ${
          paymentIntentId === null
            ? html`— not paid by card, so there is nothing to refund.`
            : html`— this will be refunded in full to the card it was paid with.`
        }
      </p>

      <form method="post" action="${NN_SECTION}/cancel/">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
        <input type="hidden" name="purchaseId" value="${purchaseId}" />
        <input type="hidden" name="confirm" value="yes" />
        ${
          /* **The button says what will actually happen.** A complimentary place has no
          payment intent, so nothing is refunded — and offering to refund one is how a
          volunteer ends up looking for money that was never taken. The paragraph above
          already made the distinction; the control has to make it too. */ null
        }
        <button type="submit" class="admin-button admin-button-grave">
          ${
            paymentIntentId === null
              ? 'Cancel this entry'
              : 'Cancel this entry and refund it'
          }
        </button>
      </form>

      <p><a href="${NN_SECTION}/">Leave it alone and go back to the entries</a></p>
    </main>`;
}

/** What happened, in a sentence, with the way back. */
function cancelOutcomePage(viewer: AdminViewer, heading: string, detail: string): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>${heading}</h1>
      <p>${detail}</p>
      <p><a href="${NN_SECTION}/">Back to the entries</a></p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// Assigning a complimentary place
// -----------------------------------------------------------------------------------------

/**
 * Read one person out of the form, or null when a field is missing.
 *
 * **The runner's block and the guide's are one function on purpose.** They collect the same
 * facts about two people who will be on the same road at the same time, and two copies of
 * that would be two things to keep in step — with the one that drifts being the guide's,
 * because it is the one nobody tests by hand. `prefix` is `''` for the runner and `'guide'`
 * for the guide, which is the whole of the difference.
 *
 * **The same fields the public entry form collects, minus the ones that are about money.** No
 * discount code, because nothing is being charged; no medical information, for the reason
 * `createManualEntry` gives at length.
 */
function readAssignPerson(
  read: (name: string) => string,
  prefix: '' | 'guide',
): ManualEntrant | null {
  const field = (name: string): string =>
    prefix === '' ? name : `${prefix}${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`;

  const firstName = read(field('firstName'));
  const lastName = read(field('lastName'));
  const dateOfBirth = read(field('dateOfBirth'));
  const gender = read(field('gender'));
  const emergencyName = read(field('emergencyName'));
  const emergencyPhone = read(field('emergencyPhone'));
  const club = read(field('club'));
  // **Asked of the runner and not of the guide, which is the one field this function treats
  // the two halves differently over.** A guide is not asked on the public form either — they
  // have their own emergency contact and, on that form, their own email address — and asking
  // a volunteer for a third contact detail about a second person is asking for what nothing
  // reads. See ADR-022 and ADR-025.
  const phone = prefix === '' ? read(field('phone')) : '';

  if (
    firstName === '' ||
    lastName === '' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
    !(NN_ENTRY_GENDERS as readonly string[]).includes(gender) ||
    emergencyName === '' ||
    emergencyPhone === ''
  ) {
    return null;
  }

  return {
    firstName,
    lastName,
    dateOfBirth,
    gender: gender as (typeof NN_ENTRY_GENDERS)[number],
    club: club === '' ? null : club,
    emergencyContactName: emergencyName,
    emergencyContactPhone: emergencyPhone,
    // **Not in the refusal above, and that is the decision.** The public form will not take an
    // entry without a number; this one will, because a complimentary place is arranged by a
    // volunteer who may have nothing but an email thread — and refusing Kinsi a place over a
    // phone number would make ADR-028's answer conditional on ADR-025's field.
    phone: phone === '' ? null : phone,
  };
}

/**
 * What each refusal from `create_manual_entry()` reads as on the page.
 *
 * **Named individually rather than collapsed into one message**, which is the opposite of what
 * the entry form does with `invalid_discount` — and the difference is who is reading. Out
 * there, telling four refusals apart helps somebody guessing codes; in here, every fact
 * concerned was typed by this volunteer a moment ago, and "the race is full" and "this runner
 * already has a place" ask for completely different things next.
 */
function assignRefusalWords(reason: ManualEntryReason): string {
  if (reason === 'sold_out') {
    return 'The race is full. A place that is given still takes one of the 250, so there is nothing to give until one comes back.';
  }

  if (reason === 'already_entered') {
    return 'That runner already has a place in this race — the club has an entry against that name and date of birth. Nothing has been given.';
  }

  if (reason === 'under_minimum_age') {
    return 'That date of birth is under the minimum age for race day. The age rule applies to a place that is given exactly as it does to one that is bought.';
  }

  if (reason === 'no_complimentary_fee') {
    // Not the volunteer's fault: the fee row is missing from this running, which is a
    // deployment state rather than a bad submission, and the words say so.
    return 'This running has no complimentary fee set up, so there is nothing to record a free place against. Nothing has been given — this one is for whoever looks after the database.';
  }

  if (reason === 'closed') {
    return 'This running is not taking entries of any kind. Nothing has been given.';
  }

  return 'The club could not record that place. Nothing has been given. Check every box and try again.';
}

/**
 * Assign a complimentary place — the form, then the place.
 *
 * **Two passes through one handler**, exactly as `transferResponse` is: a POST without
 * `confirm` renders the form and mints a CSRF token, and the form posts back with it. There
 * is deliberately no GET — a page that gives away places should not be reachable by a link
 * somebody can be sent, prefetched, or scanned.
 *
 * **The running is the current one, read rather than named.** Hardcoding `nn-2026` here would
 * be the one place on this surface that had to be edited to publish 2027, and it would be
 * silent when it was wrong.
 */
async function assignResponse(
  request: Request,
  reader: NnAdminReader,
  cfg: SupabaseConfig,
  viewer: AdminViewer,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);

  const again = (problem: string | null): Response => {
    const token = mintCsrfToken();

    return page('Assign a place', assignFormPage(viewer, token, problem), {
      cookies: [csrfCookie(token, secure)],
    });
  };

  if (form?.get('confirm') !== 'yes') {
    return again(null);
  }

  const csrfCookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  const fieldToken =
    typeof form.get(CSRF_FIELD) === 'string' ? (form.get(CSRF_FIELD) as string) : null;

  if (!csrfOk(csrfCookieToken, fieldToken)) {
    return again('That form had expired. Please try again.');
  }

  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };

  const email = read('email');
  const runner = readAssignPerson(read, '');

  // **The form's own control, and it is not the system's.** Everything here is re-checked
  // inside `entries.create_manual_entry()` — the permission, capacity, the minimum age,
  // one-runner-one-place — because this function is reachable only through a browser and that
  // one is reachable through PostgREST with the published anon key.
  if (email === '' || runner === null) {
    return again(
      'Every box except the club is needed, and the date of birth has to be a real date.',
    );
  }

  // **Ticked explicitly, and it is the whole reason the stored consents are marked
  // `recorded_by_admin`.** The volunteer is stating that they hold this person's agreement,
  // which is a different fact from the person having clicked something — and a record that
  // cannot tell the two apart says something false about somebody.
  if (form.get('entryTerms') !== 'yes') {
    return again(
      'Confirm that the runner has agreed to the entry terms. A place cannot be recorded without it.',
    );
  }

  const wantsGuide = form.get('withGuide') === 'yes';
  const guide = wantsGuide ? readAssignPerson(read, 'guide') : null;

  if (wantsGuide && guide === null) {
    return again(
      'Every box except the club is needed for the guide too, and their date of birth has to be a real date.',
    );
  }

  const current = await reader.currentSlug();

  if (!current.ok) {
    console.error(`entries.current_entry_state unavailable — ${current.error}`);
    return page('Assign a place', unavailablePage(viewer), { status: 503 });
  }

  const outcome = await createManualEntry(createUserClient(cfg, viewer.accessToken), {
    slug: current.value.slug,
    // **The runner is the purchaser, because there is no purchaser.** Nobody paid, so the
    // only honest name to put on the transaction is the person the place is for — and it is
    // their address that makes the entry appear on their account if they ever register.
    purchaserName: `${runner.firstName} ${runner.lastName}`,
    purchaserEmail: email,
    runner,
    guide,
    reason: read('reason') === '' ? null : read('reason'),
  });

  if (outcome.status === 'unavailable') {
    console.error(`entries.create_manual_entry unavailable — ${outcome.error}`);
    return page('Assign a place', unavailablePage(viewer), { status: 503 });
  }

  if (outcome.status === 'refused') {
    // `unauthorised` answers 404, like every other refusal of the right to be here — a 403
    // would disclose that the address exists. The rest are things this volunteer needs told,
    // and are said in words on the form they came from.
    if (outcome.reason === 'unauthorised') {
      return notFound();
    }

    return again(assignRefusalWords(outcome.reason));
  }

  const one = outcome.entrants === 1;

  return page(
    'Assign a place',
    cancelOutcomePage(
      viewer,
      one ? 'The place is recorded' : 'Both places are recorded',
      `${one ? 'It is' : 'They are'} in the entries now, at no charge, and ${one ? 'it counts' : 'they count'} towards the 250. The entry will appear on ${email}'s account if that address ever registers and confirms. Nothing has been emailed to them — tell them yourself.`,
    ),
    {},
  );
}

/** The boxes for one person, runner or guide, so the two cannot drift apart. */
function assignPersonFields(prefix: '' | 'guide', idPrefix: string): Html {
  const name = (field: string): string =>
    prefix === '' ? field : `${prefix}${field[0]?.toUpperCase() ?? ''}${field.slice(1)}`;

  return html`<p>
      <label for="${idPrefix}-first">First name</label>
      <input
        type="text"
        id="${idPrefix}-first"
        name="${raw(name('firstName'))}"
        autocomplete="off"
      />
    </p>

    <p>
      <label for="${idPrefix}-last">Last name</label>
      <input
        type="text"
        id="${idPrefix}-last"
        name="${raw(name('lastName'))}"
        autocomplete="off"
      />
    </p>

    <p>
      <label for="${idPrefix}-dob">Date of birth</label>
      <input type="date" id="${idPrefix}-dob" name="${raw(name('dateOfBirth'))}" />
    </p>

    <fieldset>
      <legend>Race category</legend>
      ${NN_ENTRY_GENDERS.map(
        (value: (typeof NN_ENTRY_GENDERS)[number]) =>
          html`<p>
            <input
              type="radio"
              id="${idPrefix}-gender-${value}"
              name="${raw(name('gender'))}"
              value="${value}"
            />
            <label for="${idPrefix}-gender-${value}">${genderLabel(value)}</label>
          </p>`,
      )}
    </fieldset>

    ${
      /* **The runner's own number, and the runner's block only.** `readAssignPerson` reads
      this for the runner and never for the guide, so rendering it under the guide's heading
      would be a box whose contents are dropped. Optional here and required on the public
      form — see `readAssignPerson`. */ null
    }
    ${
      prefix === ''
        ? html`<p>
            <label for="${idPrefix}-phone">Their own phone number (optional)</label>
            <input
              type="tel"
              id="${idPrefix}-phone"
              name="${raw(name('phone'))}"
              autocomplete="off"
            />
          </p>`
        : null
    }

    <p>
      <label for="${idPrefix}-club">Running club (optional)</label>
      <input
        type="text"
        id="${idPrefix}-club"
        name="${raw(name('club'))}"
        autocomplete="off"
      />
    </p>

    <p>
      <label for="${idPrefix}-emergency-name">Emergency contact name</label>
      <input
        type="text"
        id="${idPrefix}-emergency-name"
        name="${raw(name('emergencyName'))}"
        autocomplete="off"
      />
    </p>

    <p>
      <label for="${idPrefix}-emergency-phone">Emergency contact number</label>
      <input
        type="tel"
        id="${idPrefix}-emergency-phone"
        name="${raw(name('emergencyPhone'))}"
        autocomplete="off"
      />
    </p>`;
}

function assignFormPage(
  viewer: AdminViewer,
  token: string,
  problem: string | null,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Assign a place</h1>

      ${
        problem === null
          ? null
          : html`<p class="admin-error" role="alert"><strong>${problem}</strong></p>`
      }

      <p>
        This gives somebody a place <strong>at no charge</strong>. It is recorded as a
        complimentary entry, it appears in the entries, the exports and the start list
        like any other, and <strong>it takes one of the 250</strong>.
      </p>

      <p>
        <strong>Nothing is emailed to them.</strong> The club's outbox only sends when a
        purchase is paid for, and a place that is given never goes through that — so tell
        them yourself, and use the address below if they want it on an account later.
      </p>

      <p>
        <strong>Do not type anybody's medical information here.</strong> This form does
        not collect it and it is not stored. If they have something the first aiders
        should know, ask them to email the race organisers directly.
      </p>

      <form method="post" action="${NN_SECTION}/assign/" class="admin-form">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
        <input type="hidden" name="confirm" value="yes" />

        <p>
          <label for="assign-email">Their email address</label>
          <input type="email" id="assign-email" name="email" autocomplete="off" />
        </p>

        <fieldset>
          <legend>The runner</legend>
          ${assignPersonFields('', 'assign')}
        </fieldset>

        ${
          /* **The guide's block is always in the page, and the checkbox is only a statement.**
          There is no JavaScript on this surface at all, so nothing hides it — `withGuide` is
          what the handler reads, the boxes below are ignored entirely when it is unticked,
          and a volunteer who ticks it and leaves them empty is told so. That is the same
          arrangement the public form falls back to with scripting off. */ null
        }
        <fieldset>
          <legend>A guide, if one is running with them</legend>
          <p>
            <input type="checkbox" id="assign-with-guide" name="withGuide" value="yes" />
            <label for="assign-with-guide">
              This runner is visually impaired and a guide runs with them
            </label>
          </p>
          <p>
            The guide pays nothing and <strong>takes a second one of the 250</strong>.
            Leave the boxes below empty unless the box above is ticked.
          </p>
          ${assignPersonFields('guide', 'assign-guide')}
        </fieldset>

        <fieldset>
          <legend>Before you record it</legend>
          <p>
            <input type="checkbox" id="assign-terms" name="entryTerms" value="yes" />
            <label for="assign-terms">
              I have this runner's agreement to the entry terms
            </label>
          </p>
          <p>
            It is recorded as agreed <em>on their behalf</em> — marked as entered by a
            volunteer rather than clicked by them. Get the agreement first.
          </p>

          <p>
            <label for="assign-reason">Why this place is being given (optional)</label>
            <input type="text" id="assign-reason" name="reason" autocomplete="off" />
          </p>
          <p>
            Goes in the audit trail, and never to the runner. "Kinsi partnership place",
            say.
          </p>
        </fieldset>

        <button type="submit" class="admin-button admin-button-grave">
          Give this place
        </button>
      </form>

      <p><a href="${NN_SECTION}/">Go back to the entries without giving one</a></p>
    </main>`;
}

/**
 * The discount codes on this running, and how much of each is left.
 *
 * **This panel is the only place a code can be read.** A code is minted by a migration and is
 * deliberately never written into the repository, which is public — so without this, the only
 * copy would be wherever somebody happened to paste it, and the volunteer who needs to tell
 * Left Handed Giant what it is would have nowhere to look.
 *
 * **Rendered only when there is one**, rather than as an empty panel saying "no codes". A
 * running with no codes is the ordinary case — most races have none — and a permanent empty
 * box is a thing to scroll past for ever.
 *
 * `uses` goes **down** as well as up: a lapsed hold and a refund each give one back, which the
 * note says so that a volunteer who watches the number move does not report it as a defect.
 */
function discountCodesSection(list: AdminEntryList): Html {
  if (list.discountCodes.length === 0) {
    return html``;
  }

  return html`<h2 class="admin-h2">Discount codes</h2>
    <section class="admin-panel" aria-labelledby="discount-codes">
      <div class="admin-panel-head">
        <h3 id="discount-codes">Codes on this running</h3>
      </div>
      <div class="admin-panel-body">
        <p>
          <strong>This is the only place these are written down.</strong> A code is
          generated when the club's database is built and is never put in the code
          repository, which anybody can read. Copy it from here to give it out.
        </p>
        <div class="admin-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col" class="admin-col-wide">Takes off</th>
                <th scope="col" class="admin-col-wide">Applies to</th>
                <th scope="col">Used</th>
              </tr>
            </thead>
            <tbody>
              ${list.discountCodes.map((code) => discountCodeRow(code))}
            </tbody>
          </table>
        </div>
        <p class="admin-panel-note">
          A use is spent when a place is held and <strong>given back</strong> when a hold
          lapses or an entry is refunded — so a number that looks wrong in the middle of a
          rush is most likely a hold that has not expired yet.
        </p>
      </div>
    </section>`;
}

/** One code, with what is left of it. */
function discountCodeRow(code: AdminDiscountCode): Html {
  const left = code.maxUses === null ? null : code.maxUses - code.uses;

  return html`<tr>
    <th scope="row">
      <span class="admin-mono">${code.code}</span>
      ${code.active ? null : html`<span class="admin-sub">Withdrawn</span>`}
    </th>
    <td class="admin-col-wide">${String(code.percentOff)}%</td>
    ${
      /* **Which fee it is for, in words rather than a code.** "10% off an unaffiliated entry"
      is two facts, and a volunteer telling somebody about the code has to be able to say the
      second one — the database refuses it against any other entry type. */ null
    }
    <td class="admin-col-wide">
      ${code.feeCode === null ? 'Any entry type' : feeCodeWords(code.feeCode)}
    </td>
    <td>
      <span class="admin-mono">${String(code.uses)}</span>
      ${
        code.maxUses === null
          ? html` of unlimited`
          : html` of <span class="admin-mono">${String(code.maxUses)}</span>
              <span class="admin-sub">
                ${left === 0 ? 'all gone' : `${String(left)} left`}
              </span>`
      }
    </td>
  </tr>`;
}

/**
 * A fee code in the words a person uses.
 *
 * **Local, and deliberately not read from the fee rows.** A code can be scoped to a fee that
 * this event no longer offers, and the panel still has to say what it was for rather than
 * render a blank. The three codes are fixed by `entries.fees`' own check constraint, so this
 * cannot drift far without a migration somebody reviewed.
 */
function feeCodeWords(code: string): string {
  if (code === 'affiliated') {
    return 'Affiliated entries';
  }

  if (code === 'unaffiliated') {
    return 'Unaffiliated entries';
  }

  if (code === 'vi_guide') {
    return 'Guide places';
  }

  return code;
}
