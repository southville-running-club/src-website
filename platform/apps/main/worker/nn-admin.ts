import {
  ageCategoryFor,
  adminSignIn,
  createAnonClient,
  csvDocument,
  fetchAdminEntryList,
  fetchAdminExport,
  fetchAdminInterestList,
  fetchAdminMedicalNote,
  fetchCurrentEntryState,
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
// The subpath, as `ClubLogo.astro` and `SiteBanner.astro` use it — the wordmark's geometry is not
// re-exported through the package index, and adding it there for one caller would be the wrong
// direction of dependency for a Worker that needs one constant.
import { CLUB_LOGO } from '@src/shared/brand';
import { html, raw, type Html } from './html';
import {
  adminSessionCookie,
  clearedAdminSessionCookie,
  mintAdminSession,
  readAdminSession,
} from './admin-session';
import { NN_ADMIN_PREFIX, NN_RACE_SLUG, nnAdminSegments } from './routing';

/**
 * `/nn/admin` — the entries, the interest list, the exports, and nothing that changes a record.
 *
 * ## Who may reach it
 *
 * Two credentials, and ADR-013 is the argument for both.
 *
 *   1. **`ENTRIES_ADMIN_KEY`, a Worker secret.** It gates every route here and is what every
 *      database function behind them requires. **Unbound is not an error state — it is the
 *      shipped one**, and it makes this whole surface answer exactly as an address nobody has
 *      published: `handleNnAdmin` returns `null`, the request falls through to the assets
 *      binding, and the binding 404s. Production today is in that state.
 *   2. **A per-person key**, checked once by `entries.admin_sign_in()`. What comes back is a
 *      handle, which the Worker puts in a signed, twelve-hour, `HttpOnly` cookie. The person's
 *      key is never stored anywhere by anything.
 *
 * **A wrong or absent credential discloses nothing about what is behind it.** Every address
 * under this prefix answers with the same sign-in page and the same 401 when there is no valid
 * session — an event that exists and one that does not are the same page, and so are an entrant
 * id that names a row and one that does not.
 *
 * ## One page, in one order, and the order is the design
 *
 * **The second pass replaced an index of links with a single page**, and the sequence is the
 * argument rather than a layout:
 *
 *   1. the masthead — where you are and, in the mono face, **which role you are signed in as**;
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

export interface NnAdminEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /**
   * **A Worker secret**, set with `wrangler secret put`. Never in `wrangler.jsonc`, never in a
   * `vars` block, never in this repository. Optional, and its absence is the deployed state:
   * with no key there is no admin surface at all, which is the correct thing for a surface
   * whose digest nobody has installed yet.
   */
  ENTRIES_ADMIN_KEY?: string;
}

/**
 * Handle one request under `/nn/admin`, or decline it.
 *
 * `null` means "this Worker has nothing to say about this address", which the caller turns into
 * the ordinary assets-binding 404. It is returned for exactly one reason — no key bound — and
 * that is what makes an uninstalled admin surface indistinguishable from an absent one.
 */
export async function handleNnAdmin(
  request: Request,
  env: NnAdminEnv,
  url: URL,
): Promise<Response | null> {
  const key = env.ENTRIES_ADMIN_KEY?.trim();

  if (!key) {
    return null;
  }

  const secure = url.protocol === 'https:';
  const segments = nnAdminSegments(url.pathname);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const handle = await readAdminSession(key, request.headers.get('cookie'), nowSeconds);

  // The sign-in post is the one thing somebody without a session may do.
  if (request.method === 'POST' && segments.length === 0) {
    return handleSignIn(request, env, key, handle, secure, nowSeconds);
  }

  if (handle === null) {
    // **The same answer at every address**, so that a wrong credential cannot be used to map
    // what is here. 401 rather than 404: the surface is known to exist once the key is
    // installed, and pretending otherwise to somebody who has simply timed out is a worse page.
    return page('Sign in', signInPage(null), { status: 401 });
  }

  // **The dashboard, and the same renderer for a named running.** `/nn/admin/` asks the database
  // which running of `nn` is current — no year in the route, for the reason `/nn/` has none — and
  // `/nn/admin/entries/<slug>/` is how a past running or a fixture is looked at. One page, two
  // ways in, so publishing 2027 is a row rather than an edit here.
  if (request.method === 'GET' && segments.length === 0) {
    return dashboardResponse(env, key, handle, null, url);
  }

  if (request.method === 'GET' && segments.length <= 2 && segments[0] === 'entries') {
    return dashboardResponse(env, key, handle, segments[1] ?? null, url);
  }

  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'interest') {
    return interestResponse(env, key, handle);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'medical') {
    return medicalResponse(request, env, key, handle);
  }

  // **The start list is a POST because rendering it writes an audit row.** Printing a sheet of
  // names and emergency contacts is taking a copy out of the platform, which is the same act the
  // CSV is, so it goes through `entries.admin_export()` and is recorded the same way. A GET would
  // let a prefetch, a scanner or a link in a chat client file an export against somebody's
  // handle — the reason signing out is a POST too.
  if (
    request.method === 'POST' &&
    segments.length === 1 &&
    segments[0] === 'start-list'
  ) {
    return startListResponse(request, env, key, handle);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'export') {
    return exportResponse(request, env, key, handle);
  }

  // An address under the prefix that is not one of the seven. Answered by this Worker rather than
  // fallen through, because falling through would hand it to the assets binding and the 404
  // page would arrive without the `noindex` header this surface sets on everything.
  return page('Not found', notFoundPage(), { status: 404 });
}

// -----------------------------------------------------------------------------------------
// Signing in and out
// -----------------------------------------------------------------------------------------

async function handleSignIn(
  request: Request,
  env: NnAdminEnv,
  key: string,
  handle: string | null,
  secure: boolean,
  nowSeconds: number,
): Promise<Response> {
  const form = await readForm(request);

  // Signing out is a POST too. A GET would mean a prefetch, a scanner or a link in a chat
  // client could sign somebody out, which is a small thing that happens at the worst moment.
  if (form?.get('action') === 'sign-out') {
    return page('Signed out', signedOutPage(), {
      status: 200,
      cookie: clearedAdminSessionCookie(secure),
    });
  }

  if (handle !== null) {
    // Already in. Nothing to do and nothing to say about the key that was posted.
    return redirectToDashboard();
  }

  const presented = form?.get('key');
  const personKey = typeof presented === 'string' ? presented : '';

  if (personKey === '') {
    return page('Sign in', signInPage('Enter your admin key.'), { status: 401 });
  }

  const client = anonClient(env);
  const outcome = await adminSignIn(client, key, personKey);

  if (outcome.status === 'unavailable') {
    console.error(`entries.admin_sign_in unavailable — ${outcome.error}`);
    return page(
      'Sign in',
      signInPage('The club’s database could not be reached. Try again in a moment.'),
      { status: 503 },
    );
  }

  if (outcome.status !== 'ok') {
    // **`unauthorised` and `not-found` are one answer here.** The first means this Worker's own
    // key is wrong or uninstalled and the second means the person's key is; telling them apart
    // on the page would say which half of the arrangement is missing.
    if (outcome.status === 'unauthorised') {
      console.error(
        'entries.admin_sign_in refused the Worker key — check ENTRIES_ADMIN_KEY',
      );
    }

    return page('Sign in', signInPage('That key was not recognised.'), { status: 401 });
  }

  // **A redirect rather than the page**, so the dashboard is reached by a GET and a refresh does
  // not re-post a credential. The cookie rides on the 303.
  return redirectToDashboard({
    cookie: adminSessionCookie(
      await mintAdminSession(key, outcome.name, nowSeconds),
      secure,
    ),
  });
}

function redirectToDashboard(options: { cookie?: string } = {}): Response {
  const headers = new Headers({
    location: `${NN_ADMIN_PREFIX}/`,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });

  if (options.cookie !== undefined) {
    headers.append('set-cookie', options.cookie);
  }

  return new Response(null, { status: 303, headers });
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
const STATUS_FILTERS = ['all', ...ENTRY_STATUSES, 'attention'] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

interface EntryFilters {
  status: StatusFilter;
  fee: string;
  sort: Sort;
}

function readFilters(url: URL): EntryFilters {
  const status = url.searchParams.get('status') ?? 'all';
  const sort = url.searchParams.get('sort') ?? 'name';

  return {
    status: (STATUS_FILTERS as readonly string[]).includes(status)
      ? (status as StatusFilter)
      : 'all',
    // Matched against the fee codes the answer actually carries rather than against a list
    // written here, so a fourth fee code is a migration and not also a deploy.
    fee: url.searchParams.get('fee') ?? 'all',
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
  const kept = entries.filter(
    (entry) =>
      (filters.status === 'all' ||
        (filters.status === 'attention'
          ? needsAHuman(entry)
          : entry.status === filters.status)) &&
      (filters.fee === 'all' || entry.feeCode === filters.fee),
  );

  const byName = (a: AdminEntry, b: AdminEntry): number =>
    a.lastName.localeCompare(b.lastName, 'en-GB') ||
    a.firstName.localeCompare(b.firstName, 'en-GB');

  return [...kept].sort((a, b) => {
    if (filters.sort === 'entered') {
      // Newest first: the interesting end of a list somebody is watching fill up.
      return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
    }

    if (filters.sort === 'category') {
      return a.age - b.age || byName(a, b);
    }

    if (filters.sort === 'status') {
      return a.status.localeCompare(b.status) || byName(a, b);
    }

    return byName(a, b);
  });
}

async function dashboardResponse(
  env: NnAdminEnv,
  key: string,
  handle: string,
  requestedSlug: string | null,
  url: URL,
): Promise<Response> {
  const client = anonClient(env);

  let slug = requestedSlug;

  if (slug === null) {
    const current = await fetchCurrentEntryState(client, NN_RACE_SLUG);

    if (!current.ok) {
      console.error(`entries.current_entry_state unavailable — ${current.error}`);
      return page('Race admin', unavailablePage(handle), { status: 503 });
    }

    slug = current.value.slug;
  }

  const list = await fetchAdminEntryList(client, key, slug);

  // **The interest count is a second read, and a failure of it is not a failure of the page.**
  // One panel out of eight depends on it; the seven that do not include the one an organiser
  // opens at nine in the morning. So it is asked for separately and its absence renders as "could
  // not be read" in its own panel rather than as a 503 over the start list.
  const interest = await fetchAdminInterestList(client, key);

  return listResponse(list, handle, 'Race admin', (value) =>
    dashboardPage(handle, value, interest, readFilters(url), url),
  );
}

// -----------------------------------------------------------------------------------------
// The interest list
// -----------------------------------------------------------------------------------------

async function interestResponse(
  env: NnAdminEnv,
  key: string,
  handle: string,
): Promise<Response> {
  const list = await fetchAdminInterestList(anonClient(env), key);

  return listResponse(list, handle, 'Interest', (value) => interestPage(handle, value));
}

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

async function medicalResponse(
  request: Request,
  env: NnAdminEnv,
  key: string,
  handle: string,
): Promise<Response> {
  const form = await readForm(request);
  const entrantId = form?.get('entrantId');

  if (typeof entrantId !== 'string' || !isUuid(entrantId)) {
    return page('Medical note', medicalNotFoundPage(handle), { status: 404 });
  }

  const note = await fetchAdminMedicalNote(anonClient(env), key, handle, entrantId);

  if (note.status === 'unavailable') {
    console.error(`entries.admin_entrant_medical unavailable — ${note.error}`);
    return page('Medical note', unavailablePage(handle), { status: 503 });
  }

  if (note.status !== 'ok') {
    return page('Medical note', medicalNotFoundPage(handle), { status: 404 });
  }

  return page('Medical note', medicalPage(handle, note), {});
}

// -----------------------------------------------------------------------------------------
// The exports, and the one that is a page rather than a file
// -----------------------------------------------------------------------------------------

async function exportResponse(
  request: Request,
  env: NnAdminEnv,
  key: string,
  handle: string,
): Promise<Response> {
  const form = await readForm(request);
  const kind = form?.get('kind');
  const event = form?.get('event');

  if (typeof kind !== 'string' || !isExportKind(kind) || typeof event !== 'string') {
    return page('Export', notFoundPage(), { status: 404 });
  }

  const taken = await fetchAdminExport(anonClient(env), key, handle, event, kind);

  if (taken.status === 'unavailable') {
    console.error(`entries.admin_export unavailable — ${taken.error}`);
    return page('Export', unavailablePage(handle), { status: 503 });
  }

  if (taken.status !== 'ok') {
    return page('Export', notFoundPage(), { status: 404 });
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
  env: NnAdminEnv,
  key: string,
  handle: string,
): Promise<Response> {
  const form = await readForm(request);
  const event = form?.get('event');

  if (typeof event !== 'string') {
    return page('Start list', notFoundPage(), { status: 404 });
  }

  const taken = await fetchAdminExport(anonClient(env), key, handle, event, 'start-list');

  if (taken.status === 'unavailable') {
    console.error(`entries.admin_export unavailable — ${taken.error}`);
    return page('Start list', unavailablePage(handle), { status: 503 });
  }

  if (taken.status !== 'ok' || taken.export.kind !== 'start-list') {
    return page('Start list', notFoundPage(), { status: 404 });
  }

  return page('Start list', startListPage(handle, taken.export), {});
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

/**
 * The shell every admin response shares.
 *
 * **`noindex` twice, deliberately.** The header is what a crawler that never renders the page
 * obeys and what covers the CSV as well; the meta element is what survives somebody saving the
 * page. The site has no site-wide robots directive that could conflict, and this does not depend
 * on that staying true.
 */
function page(
  title: string,
  body: Html,
  options: { status?: number; cookie?: string },
): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} — Southville Running Club</title>
        <link rel="stylesheet" href="/nn/admin.css" />
      </head>
      <body class="admin">
        ${body}
      </body>
    </html>`;

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    // Every page here holds somebody's details. Nothing between the Worker and the person
    // reading it may keep a copy.
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });

  if (options.cookie !== undefined) {
    headers.append('set-cookie', options.cookie);
  }

  return new Response(document.toString(), {
    status: options.status ?? 200,
    headers,
  });
}

/**
 * 1. The masthead — the club lockup, what this is, and which role is signed in.
 *
 * **The role rather than a name, and that is a data-protection decision.** `entries.admin_keys`
 * constrains a handle to a slug and the runbook holds the mapping to a human, because the handle
 * is what lands in every row of `entries.admin_audit`. Showing it here — in the mono face, where
 * it reads as an identifier rather than as a greeting — is what makes the audit trail legible to
 * the person generating it.
 *
 * The lockup is `CLUB_LOGO`, filled with `currentColor` like every other rendering of it, so one
 * piece of artwork serves the site banner, the campaign masthead and this.
 *
 * **`null` is the signed-out masthead**, and it is a real state rather than a tidy default: the
 * sign-in page and the signed-out page both carry this bar, and an earlier version handed it the
 * string `'nobody'`, which rendered "Signed in as nobody" above a form asking somebody to sign in.
 * There is no role to name and no session to end, so neither half is drawn.
 */
function masthead(handle: string | null): Html {
  return html`<header class="admin-mast">
    <a class="admin-mast-mark" href="${NN_ADMIN_PREFIX}/">
      <svg
        viewBox="${CLUB_LOGO.viewBox}"
        role="img"
        aria-label="${CLUB_LOGO.title}"
        focusable="false"
      >
        ${CLUB_LOGO.paths.map(
          (path) =>
            html`<path
              d="${path.d}"
              transform="${path.transform}"
              fill="currentColor"
            />`,
        )}
      </svg>
    </a>
    <p class="admin-mast-title">Race admin</p>
    ${
      handle === null
        ? null
        : html`<div class="admin-mast-who">
            <span class="admin-mast-role">
              <span class="admin-mast-role-label">Signed in as</span>
              <span class="admin-mono">${handle}</span>
            </span>
            <form method="post" action="${NN_ADMIN_PREFIX}/">
              <input type="hidden" name="action" value="sign-out" />
              <button type="submit" class="admin-mast-out">Sign out</button>
            </form>
          </div>`
    }
  </header>`;
}

function signInPage(error: string | null): Html {
  return html`${masthead(null)}
    <main class="admin-page" id="main">
      <h1>Sign in</h1>
      ${
        error === null
          ? null
          : html`<p class="admin-error" role="alert" id="key-error">${error}</p>`
      }
      <form method="post" action="${NN_ADMIN_PREFIX}/" class="admin-signin">
        <div class="admin-field">
          <label for="key">Your admin key</label>
          <p class="admin-hint" id="key-hint">
            The key issued to you, not a club password. If you have not got one, ask the
            other volunteer.
          </p>
          <input
            type="password"
            id="key"
            name="key"
            autocomplete="current-password"
            required
            autocapitalize="off"
            spellcheck="false"
            aria-describedby="${error === null ? 'key-hint' : 'key-error key-hint'}"
            ${error === null ? null : raw('aria-invalid="true"')}
          />
        </div>
        <button type="submit" class="admin-button">Sign in</button>
      </form>
    </main>`;
}

function signedOutPage(): Html {
  return html`${masthead(null)}
    <main class="admin-page" id="main">
      <h1>Signed out</h1>
      <p>Your session has been forgotten on this device.</p>
      <p><a href="${NN_ADMIN_PREFIX}/">Sign in again</a></p>
    </main>`;
}

function unavailablePage(handle: string): Html {
  return html`${masthead(handle)}
    <main class="admin-page" id="main">
      <h1>That could not be read</h1>
      <p>
        The club’s database could not be reached, so this page cannot say what is in it.
        <strong>It is not saying the list is empty.</strong> Try again in a moment.
      </p>
    </main>`;
}

function notFoundPage(): Html {
  return html`<main class="admin-page" id="main">
    <h1>Not found</h1>
    <p>There is nothing at this address.</p>
    <p><a href="${NN_ADMIN_PREFIX}/">Back to race admin</a></p>
  </main>`;
}

function medicalNotFoundPage(handle: string): Html {
  return html`${masthead(handle)}
    <main class="admin-page" id="main">
      <h1>No such entry</h1>
      <p>Nothing was found for that entry. It may have been removed.</p>
      <p><a href="${NN_ADMIN_PREFIX}/">Back to race admin</a></p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// The page, section by section
// -----------------------------------------------------------------------------------------

function dashboardPage(
  handle: string,
  list: AdminEntryList,
  interest: AdminResult<AdminInterestList>,
  filters: EntryFilters,
  url: URL,
): Html {
  const figures = list.event.figures;
  const flagged = list.entries.filter(needsAHuman);

  return html`${masthead(handle)} ${eventBar(list, figures)}
    <main class="admin-page" id="main">
      ${attentionSection(list, flagged)} ${raceStandsSection(list, figures, interest)}
      ${raceMorningSection(list)} ${medicalAndAffiliationSection(list, figures)}
      ${entriesSection(list, filters, url)} ${interestSection(interest)}
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
            `${NN_ADMIN_PREFIX}/start-list/`,
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
function entriesSection(list: AdminEntryList, filters: EntryFilters, url: URL): Html {
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
            filterLink(url, 'status', status, statusFilterLabel(status), filters.status),
          )}
        </ul>
        ${
          fees.length < 2
            ? null
            : html`<p class="admin-filters-label" id="filter-fee">Entry type</p>
                <ul aria-labelledby="filter-fee">
                  ${['all', ...fees].map((fee) =>
                    filterLink(url, 'fee', fee, feeFilterLabel(fee, list), filters.fee),
                  )}
                </ul>`
        }
        <p class="admin-filters-label" id="filter-sort">Sort by</p>
        <ul aria-labelledby="filter-sort">
          ${SORTS.map((sort) =>
            filterLink(url, 'sort', sort, sortLabel(sort), filters.sort),
          )}
        </ul>
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
          </tr>
        </thead>
        <tbody>
          ${
            shown.length === 0
              ? html`<tr>
                  <td colspan="8">Nothing matches that filter.</td>
                </tr>`
              : shown.map((entry) => entryRow(entry))
          }
        </tbody>
      </table>
    </section>`;
}

function entryRow(entry: AdminEntry): Html {
  const category = categoryLabel(entry.age, entry.gender);
  const ea = entry.requiresEaNumber ? entry.eaNumber : null;

  return html`<tr>
    <th scope="row">
      ${entry.lastName}, ${entry.firstName}
      <span class="admin-stack">
        <span>${entry.club ?? 'No club'}</span>
        <span>${category}</span>
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
          ? html`<form method="post" action="${NN_ADMIN_PREFIX}/medical/">
              <input type="hidden" name="entrantId" value="${entry.entrantId}" />
              <button type="submit" class="admin-linkish">
                Show note
                <span class="admin-visually-hidden">
                  for ${entry.firstName} ${entry.lastName}
                </span>
              </button>
            </form>`
          : '—'
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
                  <a href="${NN_ADMIN_PREFIX}/interest/"> Open the interest list</a>
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
  handle: string,
  taken: Extract<AdminExport, { kind: 'start-list' }>,
): Html {
  return html`${masthead(handle)}
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
        <a href="${NN_ADMIN_PREFIX}/">Back to race admin</a>
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

function interestPage(handle: string, list: AdminInterestList): Html {
  return html`${masthead(handle)}
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
      <p><a href="${NN_ADMIN_PREFIX}/">Back to race admin</a></p>
    </main>`;
}

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

function medicalPage(handle: string, note: AdminMedicalNote): Html {
  return html`${masthead(handle)}
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
        <a href="${NN_ADMIN_PREFIX}/entries/${note.eventSlug}/">Back to the entries</a>
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
function filterLink(
  url: URL,
  parameter: string,
  value: string,
  label: string,
  selected: string,
): Html {
  const next = new URL(url.toString());
  next.search = '';

  for (const [key, existing] of url.searchParams) {
    if (key !== parameter) {
      next.searchParams.set(key, existing);
    }
  }

  if (value !== 'all' || parameter === 'sort') {
    next.searchParams.set(parameter, value);
  }

  const here = value === selected;

  return html`<li>
    <a
      href="${`${next.pathname}${next.search}`}"
      class="admin-filter ${here ? 'admin-filter-on' : ''}"
      ${here ? raw('aria-current="true"') : null}
      >${label}</a
    >
  </li>`;
}

function exportButton(
  slug: string,
  kind: ExportKind,
  label: string,
  className: string,
): Html {
  return html`<form method="post" action="${NN_ADMIN_PREFIX}/export/">
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

function anonClient(env: NnAdminEnv) {
  return createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * The three failures a list can meet, mapped the same way for both lists.
 *
 * **`unauthorised` renders the sign-in page**, and not an error: it means the Worker's own key
 * has stopped matching the digest — a half-finished rotation — and the person reading the page
 * can do nothing about it but try again. The log line is where the cause goes.
 */
function listResponse<T>(
  result: AdminResult<T>,
  handle: string,
  title: string,
  render: (value: T) => Html,
): Response {
  if (result.status === 'unavailable') {
    console.error(`entries admin read unavailable — ${result.error}`);
    return page(title, unavailablePage(handle), { status: 503 });
  }

  if (result.status === 'unauthorised') {
    console.error('entries admin read refused the Worker key — check ENTRIES_ADMIN_KEY');
    return page('Sign in', signInPage('That key was not recognised.'), { status: 401 });
  }

  if (result.status === 'not-found') {
    return page(title, notFoundPage(), { status: 404 });
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
