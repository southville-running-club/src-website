import {
  NN_ENTRY_GENDERS,
  transferEntry,
  ageCategoryFor,
  cancelEntry,
  createAnonClient,
  createUserClient,
  csvDocument,
  fetchCancellablePurchase,
  fetchCurrentEntryState,
  fetchEntryList,
  fetchExport,
  fetchInterestList,
  fetchMedicalNote,
  formatLondon,
  formatLondonDate,
  formatPence,
  isExportKind,
  medicalRetentionWording,
  ENTRY_STATUSES,
  type AdminEntry,
  type AdminEntryList,
  type AdminEventFigures,
  type AdminExport,
  type AdminInterestList,
  type AdminMedicalNote,
  type AdminResult,
  type ExportKind,
  type Gender,
  type StartListExportRow,
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
 *   5. **race morning**, which is what somebody actually opens under pressure;
 *   6. the medical notes and the affiliation check;
 *   7. the entries;
 *   8. the interest list.
 *
 * The ninth thing the design asks for — **the audit trail — is deliberately absent**, and it is
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

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'export') {
    return exportResponse(request, reader, viewer);
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

  // **Transferring, and it shares `nn.entry.cancel` rather than adding a permission.** An
  // eighth permission is a stop-and-ask, so this reuses the one that already means "may undo an
  // entry somebody paid for". A dedicated `nn.entry.transfer` is the cleaner answer and is a
  // decision somebody should take on purpose — see the migration.
  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'transfer') {
    return can(viewer, 'nn.entry.cancel')
      ? transferResponse(request, cfg, viewer, secure)
      : notFound();
  }

  // An address under the prefix that is not one of the six. Answered here rather than fallen
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
 * **The one entry type that is out of the default view, and why it is a default rather than a
 * rule.** A tester's place is a real place — the capacity predicate counts it, and #107 argues
 * that excluding it from the thing being tested makes the test worthless. It is simply not what
 * somebody opens this page to look at, and a race director scanning a field of 250 should not
 * have the club's own probes in the list unless they ask for them.
 *
 * Expressed as a *hidden* code rather than by pre-selecting the other fee codes, because those
 * are not known here: they come from the rows, so a fourth fee is a migration and not a deploy.
 */
const HIDDEN_BY_DEFAULT = 'fee:tester';

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
    hide: new Set(
      hidden.length === 0
        ? [HIDDEN_BY_DEFAULT]
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

  // **Hidden beats included**, deliberately. Somebody who has asked not to see the club's own
  // test entries has asked for that, and a status chip should not quietly bring them back.
  const hidden = (entry: AdminEntry): boolean =>
    filters.hide.has(`fee:${entry.feeCode}`) ||
    filters.hide.has(`status:${entry.status}`);

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

/** The three files, and the columns each one carries. */
function csvResponse(taken: AdminExport): Response {
  const body =
    taken.kind === 'ea'
      ? csvDocument(
          ['Last name', 'First name', 'Club', 'EA number', 'Entry type', 'Paid (pence)'],
          taken.rows.map((row) => [
            row.lastName,
            row.firstName,
            row.club,
            row.eaNumber,
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
              'Emergency contact',
              'Emergency phone',
            ],
            taken.rows.map((row) => [
              row.lastName,
              row.firstName,
              row.club,
              categoryLabel(row.age, row.gender),
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

function unavailablePage(viewer: AdminViewer): Html {
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
      ${raceMorningSection(list)} ${medicalAndAffiliationSection(list, figures)}
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
              entry ${shortId(entry.purchaseId)}
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
 * 5. Race morning — the thing somebody opens under pressure.
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
 * 6. The medical notes and the affiliation check, side by side.
 *
 * **The medical panel is deliberately heavier than everything else on the page** — its own
 * border, its own warning, and the deletion date stated. It is the most sensitive thing the club
 * holds, and using it should feel like a deliberate act rather than a click.
 *
 * **The deletion date is computed from the enforced interval, not from the published wording.**
 * `entries.events.medical_retention` is what deletes; `race.json`'s `privacy.medicalRetention`
 * is what `/nn/privacy/` promises. `packages/db/tests/entries-retention.test.ts` already fails if
 * the two disagree, and a panel that read the promise instead of the mechanism would be trusting
 * the half that cannot delete anything.
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
                  — ${retentionWords(figures.medicalRetention)}, which is what
                  <a href="/nn/privacy/">the privacy notice</a> promises.
                </p>`
          }
          <div class="admin-actions">
            ${exportButton(
              list.event.slug,
              'medical',
              'Take the medical sheet',
              'admin-button-grave',
            )}
          </div>
        </div>
      </section>

      <section class="admin-panel" aria-labelledby="affiliation">
        <div class="admin-panel-head">
          <h3 id="affiliation">Affiliation check</h3>
        </div>
        <div class="admin-panel-body">
          ${
            figures === null
              ? html`<p class="admin-quiet">
                  The affiliated count could not be read from this database.
                </p>`
              : html`<p>
                    <span class="admin-mono">${figures.affiliated}</span>
                    ${plural(
                      figures.affiliated,
                      'paid entry claims',
                      'paid entries claim',
                    )}
                    the affiliated price. Nothing verifies a number automatically —
                    <strong>England Athletics publishes no verification API</strong> — so
                    this is the list to work through against the club's own myAthletics
                    access.
                  </p>
                  ${
                    figures.affiliatedMissingEa === 0
                      ? null
                      : html`<p class="admin-error">
                          <strong class="admin-mono"
                            >${figures.affiliatedMissingEa}</strong
                          >
                          claimed the affiliated price
                          <strong>without giving a number.</strong> Neither the form nor
                          the database will accept one like this any more, so these were
                          recorded before that rule landed — which makes them exactly the
                          rows this check is for.
                        </p>`
                  }`
          }
          <div class="admin-actions">
            ${exportButton(
              list.event.slug,
              'ea',
              'Download the check list',
              'admin-button-quiet',
            )}
          </div>
        </div>
      </section>
    </div>`;
}

/** `1 mon` → `one month after the race`, lower-cased into the sentence it sits in. */
function retentionWords(interval: string): string {
  const wording = medicalRetentionWording(interval);

  return wording === null
    ? 'the period the club has set'
    : wording.charAt(0).toLowerCase() + wording.slice(1);
}

/**
 * 7. The entries.
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
            <th scope="col" class="admin-col-wide">Club</th>
            <th scope="col" class="admin-col-wide">Category</th>
            <th scope="col" class="admin-col-wide">Entry</th>
            <th scope="col" class="admin-col-wide">EA number</th>
            <th scope="col" class="admin-col-wide">Paid</th>
            <th scope="col">Status</th>
            <th scope="col">Note</th>
            ${
              /* **`admin-col-wide`, so it folds away with Club, Category, Entry, EA number
                 and Paid at 320px.** The phone layout keeps three columns on purpose — a
                 fourth is what starts the table scrolling sideways, and an absolutely
                 positioned visually-hidden span inside a scroller drags the whole page with
                 it, which is the trap CLAUDE.md spends a paragraph on.

                 Losing it on a phone is the deliberate half of that. Cancelling an entry is a
                 desk task with the Stripe dashboard open in another tab, not something done
                 one-handed at a race; the medical note, which *is* wanted on race morning,
                 keeps its column. */ null
            }
            <th scope="col" class="admin-col-wide">Cancel</th>
          </tr>
        </thead>
        <tbody>
          ${
            shown.length === 0
              ? html`<tr>
                  <td colspan="9">Nothing matches that filter.</td>
                </tr>`
              : shown.map((entry) => entryRow(entry, viewer))
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

function entryRow(entry: AdminEntry, viewer: AdminViewer): Html {
  // Null together, for the same reason the name is: the category is computed from a date of
  // birth that was deleted with the entrant.
  const category =
    entry.age === null || entry.gender === null
      ? null
      : categoryLabel(entry.age, entry.gender);
  const ea = entry.requiresEaNumber ? entry.eaNumber : null;

  // **Only where there is something to cancel.** An `expired` hold has already released its
  // place and has no entrant to remove, and a `refunded` row is the outcome of having pressed
  // this once already — offering the button on either would be offering a no-op that reads as
  // a destructive act.
  const cancellable =
    can(viewer, 'nn.entry.cancel') &&
    (entry.status === 'paid' || entry.status === 'pending');

  return html`<tr>
    <th scope="row">
      ${runnerName(entry)}
      <span class="admin-stack">
        <span>${entry.club ?? 'No club'}</span>
        <span>${category ?? 'No category'}</span>
        <span>${entry.feeLabel}</span>
        <span class="admin-mono">${formatPence(entry.amountPence)}</span>
        ${
          entry.requiresEaNumber
            ? ea === null
              ? html`<strong class="admin-error">EA number missing</strong>`
              : html`<span class="admin-mono">EA ${ea}</span>`
            : null
        }
      </span>
    </th>
    <td class="admin-col-wide">${entry.club ?? '—'}</td>
    <td class="admin-col-wide">${category}</td>
    <td class="admin-col-wide">${entry.feeLabel}</td>
    <td class="admin-col-wide admin-mono">
      ${
        entry.requiresEaNumber
          ? ea === null
            ? html`<strong class="admin-error">missing</strong>`
            : ea
          : '—'
      }
    </td>
    <td class="admin-col-wide admin-mono">${formatPence(entry.amountPence)}</td>
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
          : '—'
      }
      ${
        /* **Transfer sits beside Cancel and only where Cancel does.** Both need a place that
        exists, and the two together are the whole of what this surface may do to an entry
        somebody paid for. Same two-step shape: this POST only asks. */ null
      }
      ${
        cancellable
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
    }${
      entry.requestedAction === null
        ? null
        : html` <span
            class="admin-quiet ${entry.requestResolved ? 'admin-request-done' : ''}"
            >${
              entry.requestedAction === 'cancel'
                ? 'cancellation asked for'
                : 'transfer asked for'
            }${entry.requestResolved ? ' — dealt with' : ''}</span
          >`
    }`;
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
 * 8. The interest list.
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
function startListRow(row: StartListExportRow): Html {
  return html`<tr>
    <th scope="row">
      ${row.lastName}, ${row.firstName}
      <span class="admin-stack">
        <span>${row.club ?? 'No club'}</span>
        <span>${categoryLabel(row.age, row.gender)}</span>
        <span>
          ${row.emergencyContactName}
          <span class="admin-mono admin-nowrap">${row.emergencyContactPhone}</span>
        </span>
      </span>
    </th>
    <td class="admin-col-wide">${row.club ?? '—'}</td>
    <td class="admin-col-wide">${categoryLabel(row.age, row.gender)}</td>
    <td class="admin-col-wide">
      ${row.emergencyContactName}
      <span class="admin-mono admin-nowrap">${row.emergencyContactPhone}</span>
    </td>
    <!-- A box to tick with a biro. The whole reason this is paper. The "Collected" column
         header is what names it; an aria-label here would say the same thing twice. -->
    <td class="admin-tick"></td>
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
// Small pieces
// -----------------------------------------------------------------------------------------

/**
 * The category, named by `packages/shared/src/age-category.ts` and by nothing here.
 *
 * The two answers that are not a band are the club's own unfinished decisions rather than
 * anything the entrant did, and they are written as such: a non-binary runner has no category
 * because the club has not made any, and that is what the cell should say.
 */
export function categoryLabel(age: number, gender: Gender): string {
  const category = ageCategoryFor(age, gender);

  if (category.known) {
    return category.label;
  }

  return category.reason === 'gender-has-no-categories' ? 'No category yet' : 'Under 18';
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
  const next = withoutParameter(url, 'hide');
  const after = new Set(filters.hide);
  const hidingTesters = after.has(HIDDEN_BY_DEFAULT);

  if (hidingTesters) {
    after.delete(HIDDEN_BY_DEFAULT);
  } else {
    after.add(HIDDEN_BY_DEFAULT);
  }

  if (after.size === 0) {
    next.searchParams.append('hide', 'none');
  } else {
    for (const kept of [...after].sort()) {
      next.searchParams.append('hide', kept);
    }
  }

  const href = `${next.pathname}${next.search}`;

  return html`<p class="admin-filters-note">
    ${
      hidingTesters
        ? html`Test entries are not shown. <a href="${href}">Show them</a>`
        : html`Test entries are shown. <a href="${href}">Hide them</a>`
    }
  </p>`;
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
 * The last four characters of an id, for a queue of decisions.
 *
 * **An entry reference rather than a name**, because the attention panel is a list of things to
 * decide rather than a list of people, and a purchase id is not personal data on its own. It is
 * enough to find the row in the table below and in the runbook's query.
 */
function shortId(id: string): string {
  return `…${id.slice(-4)}`;
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
    read('emergencyPhone') === ''
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
    },
  );

  if (outcome.status === 'unavailable') {
    console.error(`entries.transfer_entry unavailable — ${outcome.error}`);
    return page('Transfer entry', unavailablePage(viewer), { status: 503 });
  }

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
      `It was ${outcome.previousRunner}'s and is now recorded against the details you entered. No money moved, and the place never went back into the race. Any medical note the previous runner had written has been deleted, and their England Athletics number has been cleared.`,
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
        <strong>The previous runner's medical note is deleted</strong>, along with their
        England Athletics number. A note belongs to the person who wrote it, and the new
        runner supplies their own or has none.
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

        <p>
          <label for="transfer-dob">Date of birth</label>
          <input type="date" id="transfer-dob" name="dateOfBirth" required />
        </p>

        <fieldset>
          <legend>Gender</legend>
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
        <button type="submit" class="admin-button admin-button-grave">
          Cancel this entry and refund it
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
