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
  ENTRY_STATUSES,
  type AdminEntry,
  type AdminEntryList,
  type AdminExport,
  type AdminInterestList,
  type AdminMedicalNote,
  type AdminResult,
  type EntryStatus,
  type ExportKind,
  type Gender,
} from '@src/shared';
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
 * ## What it deliberately cannot do
 *
 * **Nothing here writes to an entry.** No editing, no refunds, no transfers, no manual entry,
 * no resend. Each of those is a decision about what it means to change a record somebody paid
 * for — a refund has to agree with Stripe, a transfer has to decide whose consent applies, a
 * correction has to decide whether the audit says who made it — and they belong together in a
 * slice that can think about them together. **The list is built to make that gap visible rather
 * than to hide it**: a status is a word, not a control, and the only two buttons on the page
 * both read rather than write.
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

  if (request.method === 'GET' && segments.length === 0) {
    return page('Admin', dashboardPage(handle), {});
  }

  if (request.method === 'GET' && segments[0] === 'entries') {
    return entriesResponse(env, key, handle, segments[1] ?? null, url);
  }

  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'interest') {
    return interestResponse(env, key, handle);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'medical') {
    return medicalResponse(request, env, key, handle);
  }

  if (request.method === 'POST' && segments.length === 1 && segments[0] === 'export') {
    return exportResponse(request, env, key, handle);
  }

  // An address under the prefix that is not one of the six. Answered by this Worker rather than
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
    return page('Admin', dashboardPage(handle), {});
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

  return page('Admin', dashboardPage(outcome.name), {
    cookie: adminSessionCookie(
      await mintAdminSession(key, outcome.name, nowSeconds),
      secure,
    ),
  });
}

// -----------------------------------------------------------------------------------------
// The entries list
// -----------------------------------------------------------------------------------------

/** The sorts on offer. Enumerated, because a sort key from a query string is an injection. */
const SORTS = ['name', 'entered', 'category', 'status'] as const;

type Sort = (typeof SORTS)[number];

interface EntryFilters {
  status: EntryStatus | 'all';
  fee: string;
  sort: Sort;
}

function readFilters(url: URL): EntryFilters {
  const status = url.searchParams.get('status') ?? 'all';
  const sort = url.searchParams.get('sort') ?? 'name';

  return {
    status: (ENTRY_STATUSES as readonly string[]).includes(status)
      ? (status as EntryStatus)
      : 'all',
    // Matched against the fee codes the answer actually carries rather than against a list
    // written here, so a fourth fee code is a migration and not also a deploy.
    fee: url.searchParams.get('fee') ?? 'all',
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : 'name',
  };
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
      (filters.status === 'all' || entry.status === filters.status) &&
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

async function entriesResponse(
  env: NnAdminEnv,
  key: string,
  handle: string,
  requestedSlug: string | null,
  url: URL,
): Promise<Response> {
  const client = anonClient(env);

  // **No year in the route, for the reason `/nn/` has none.** With no slug this asks the
  // database which running of `nn` is current, exactly as the race page does, so publishing 2027
  // is a row rather than an edit here. A named slug is still accepted, which is how a past
  // running — or a fixture — is looked at.
  let slug = requestedSlug;

  if (slug === null) {
    const current = await fetchCurrentEntryState(client, NN_RACE_SLUG);

    if (!current.ok) {
      console.error(`entries.current_entry_state unavailable — ${current.error}`);
      return page('Entries', unavailablePage(handle), { status: 503 });
    }

    slug = current.value.slug;
  }

  const list = await fetchAdminEntryList(client, key, slug);

  return listResponse(list, handle, 'Entries', (value) =>
    entriesPage(handle, value, readFilters(url), url),
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
// The exports
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
// Pages
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
        <title>${title} — Nightingale Nightmare</title>
        <link rel="stylesheet" href="/nn/admin.css" />
      </head>
      <body class="admin">
        <main class="admin-page" id="main">${body}</main>
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

/** The bar at the top of every signed-in page: where you are, who you are, and the way out. */
function chrome(handle: string): Html {
  return html`<nav class="admin-bar" aria-label="Admin">
    <a href="${NN_ADMIN_PREFIX}/">Admin</a>
    <a href="${NN_ADMIN_PREFIX}/entries/">Entries</a>
    <a href="${NN_ADMIN_PREFIX}/interest/">Interest</a>
    <form method="post" action="${NN_ADMIN_PREFIX}/" class="admin-signout">
      <input type="hidden" name="action" value="sign-out" />
      <button type="submit" class="admin-linkish">
        Sign out <span class="admin-quiet">(${handle})</span>
      </button>
    </form>
  </nav>`;
}

function signInPage(error: string | null): Html {
  return html`<h1>Nightingale Nightmare admin</h1>
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
    </form>`;
}

function signedOutPage(): Html {
  return html`<h1>Signed out</h1>
    <p>Your session has been forgotten on this device.</p>
    <p><a href="${NN_ADMIN_PREFIX}/">Sign in again</a></p>`;
}

function dashboardPage(handle: string): Html {
  return html`${chrome(handle)}
    <h1>Nightingale Nightmare admin</h1>
    <ul class="admin-index">
      <li>
        <a href="${NN_ADMIN_PREFIX}/entries/">Entries</a> — who has entered the current
        running, what they paid, and anything that needs a person. Exports are on this
        page.
      </li>
      <li>
        <a href="${NN_ADMIN_PREFIX}/interest/">Interest</a> — everybody who asked to be
        told when entries open.
      </li>
    </ul>
    <h2>What this cannot do</h2>
    <p>
      Nothing here changes a record. There is no editing, no refund, no transfer and no
      manual entry — each of those has to agree with Stripe and with what somebody
      consented to, and they are deliberately left for a change that can think about them
      together. A refund is still the Stripe dashboard and the query in the
      <span class="admin-quiet">entries-attention</span> runbook.
    </p>`;
}

function unavailablePage(handle: string): Html {
  return html`${chrome(handle)}
    <h1>That could not be read</h1>
    <p>
      The club’s database could not be reached, so this page cannot say what is in it.
      <strong>It is not saying the list is empty.</strong> Try again in a moment.
    </p>`;
}

function notFoundPage(): Html {
  return html`<h1>Not found</h1>
    <p>There is nothing at this address.</p>
    <p><a href="${NN_ADMIN_PREFIX}/">Back to the admin pages</a></p>`;
}

function medicalNotFoundPage(handle: string): Html {
  return html`${chrome(handle)}
    <h1>No such entry</h1>
    <p>Nothing was found for that entry. It may have been removed.</p>
    <p><a href="${NN_ADMIN_PREFIX}/entries/">Back to the entries</a></p>`;
}

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

/** What a status cell says, and the one that has to be impossible to miss. */
function statusCell(entry: AdminEntry): Html {
  const flagged = entry.attention !== null && !entry.attentionResolved;

  return html`${entry.status}${
    entry.revived ? html` <span class="admin-quiet">(paid late)</span>` : null
  }${
    flagged
      ? html`<strong class="admin-flag">
          ${
            entry.attention === 'over_capacity'
              ? '⚠ OVER CAPACITY — paid for a place the race did not have'
              : `⚠ needs a person — ${entry.attention}`
          }
        </strong>`
      : null
  }`;
}

function entriesPage(
  handle: string,
  list: AdminEntryList,
  filters: EntryFilters,
  url: URL,
): Html {
  const shown = viewEntries(list.entries, filters);
  const over = list.event.taken > list.event.capacity;
  const fees = [...new Set(list.entries.map((entry) => entry.feeCode))].sort();

  return html`${chrome(handle)}
    <h1>${list.event.displayName}</h1>
    <p class="admin-quiet">
      ${formatLondonDate(`${list.event.eventDate}T00:00:00Z`)} ·
      <span class="admin-count">${list.event.taken} of ${list.event.capacity}</span>
      places taken
    </p>

    ${
      over
        ? html`<p class="admin-flag admin-banner" role="alert">
            ⚠ This race is <strong>${list.event.taken - list.event.capacity}</strong> over
            its field. Somebody has paid for a place that had gone. Do not set out bibs
            from the capacity figure — see the entries-attention runbook.
          </p>`
        : null
    }
    ${
      list.event.attention > 0
        ? html`<p class="admin-flag admin-banner" role="alert">
            ⚠ ${list.event.attention} purchase(s) are waiting for a person.
          </p>`
        : null
    }
    ${
      list.returned < list.total
        ? html`<p class="admin-banner">
            Showing the most recent ${list.returned} of ${list.total} entries. The rest
            are older and are in the exports.
          </p>`
        : null
    }

    <form method="get" action="${url.pathname}" class="admin-filters">
      <div class="admin-field">
        <label for="status">Status</label>
        <select id="status" name="status">
          ${option('all', 'All', filters.status)}
          ${ENTRY_STATUSES.map((status) => option(status, status, filters.status))}
        </select>
      </div>
      <div class="admin-field">
        <label for="fee">Entry type</label>
        <select id="fee" name="fee">
          ${option('all', 'All', filters.fee)}
          ${fees.map((fee) => option(fee, fee, filters.fee))}
        </select>
      </div>
      <div class="admin-field">
        <label for="sort">Sort by</label>
        <select id="sort" name="sort">
          ${option('name', 'Name', filters.sort)}
          ${option('entered', 'Newest', filters.sort)}
          ${option('category', 'Age', filters.sort)}
          ${option('status', 'Status', filters.sort)}
        </select>
      </div>
      <button type="submit" class="admin-button">Apply</button>
    </form>

    <p class="admin-quiet" role="status">
      ${shown.length} of ${list.entries.length} entries shown.
    </p>

    <div
      class="admin-scroll"
      tabindex="0"
      role="region"
      aria-label="Entries, scrollable sideways"
    >
      <table>
        <caption class="admin-visually-hidden">
          Entries for ${list.event.displayName}
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Club</th>
            <th scope="col">Category</th>
            <th scope="col">Entry type</th>
            <th scope="col">EA number</th>
            <th scope="col">Paid</th>
            <th scope="col">Status</th>
            <th scope="col">Medical</th>
          </tr>
        </thead>
        <tbody>
          ${
            shown.length === 0
              ? html`<tr>
                  <td colspan="8">Nothing matches that filter.</td>
                </tr>`
              : shown.map(
                  (entry) =>
                    html`<tr>
                      <th scope="row">${entry.lastName}, ${entry.firstName}</th>
                      <td>${entry.club ?? '—'}</td>
                      <td>${categoryLabel(entry.age, entry.gender)}</td>
                      <td>${entry.feeLabel}</td>
                      <td class="admin-mono">
                        ${
                          entry.requiresEaNumber
                            ? (entry.eaNumber ??
                              html`<strong class="admin-flag">missing</strong>`)
                            : '—'
                        }
                      </td>
                      <td class="admin-mono">${formatPence(entry.amountPence)}</td>
                      <td>${statusCell(entry)}</td>
                      <td>
                        ${
                          entry.hasMedical
                            ? html`<form
                                method="post"
                                action="${NN_ADMIN_PREFIX}/medical/"
                              >
                                <input
                                  type="hidden"
                                  name="entrantId"
                                  value="${entry.entrantId}"
                                />
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
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>

    <h2 id="exports">Exports</h2>
    <p>
      Each one is a CSV of <strong>paid</strong> entries only. Taking one is recorded —
      who, when, which file and how many rows, never the contents.
    </p>
    <ul class="admin-exports">
      <li>
        ${exportButton(list.event.slug, 'ea', 'England Athletics check')} Names, clubs and
        England Athletics numbers for affiliated entries. No contact details.
      </li>
      <li>
        ${exportButton(list.event.slug, 'start-list', 'Start list')} Names, clubs,
        categories and <strong>emergency contacts</strong>, which are needed on race day
        and nowhere else.
      </li>
      <li>
        ${exportButton(list.event.slug, 'medical', 'Medical notes')}
        <strong
          >Special category data. A separate file on purpose, and a printed copy is the
          easiest way for it to end up in a car park.</strong
        >
        Take it on the day, keep it with the first aiders, and destroy it afterwards.
      </li>
    </ul>`;
}

function exportButton(slug: string, kind: ExportKind, label: string): Html {
  return html`<form
    method="post"
    action="${NN_ADMIN_PREFIX}/export/"
    class="admin-export"
  >
    <input type="hidden" name="event" value="${slug}" />
    <input type="hidden" name="kind" value="${kind}" />
    <button type="submit" class="admin-button">${label}</button>
  </form>`;
}

function option(value: string, label: string, selected: string): Html {
  return html`<option value="${value}" ${value === selected ? raw('selected') : null}>
    ${label}
  </option>`;
}

function interestPage(handle: string, list: AdminInterestList): Html {
  return html`${chrome(handle)}
    <h1>Register-your-interest sign-ups</h1>
    <p class="admin-quiet">
      <span class="admin-count">${list.total}</span> sign-ups, ${list.consented} of whom
      said the club may write to them.
    </p>
    <p>
      The club promised these people <strong>one email when entries open</strong>. A row
      that says <strong>no</strong> below must not be written to — it is shown rather than
      hidden so that a list somebody is about to email is honest about who is not on it.
    </p>
    ${
      list.returned < list.total
        ? html`<p class="admin-banner">
            Showing the most recent ${list.returned} of ${list.total}.
          </p>`
        : null
    }
    <div
      class="admin-scroll"
      tabindex="0"
      role="region"
      aria-label="Sign-ups, scrollable sideways"
    >
      <table>
        <caption class="admin-visually-hidden">
          Register-your-interest sign-ups
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Signed up</th>
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
                      <th scope="row">${row.name}</th>
                      <td class="admin-mono">${row.email}</td>
                      <td>${formatLondon(row.createdAt)}</td>
                      <td>
                        ${
                          row.consent
                            ? 'Yes'
                            : html`<strong class="admin-flag">No — do not write</strong>`
                        }
                      </td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>`;
}

function medicalPage(handle: string, note: AdminMedicalNote): Html {
  return html`${chrome(handle)}
    <h1>Medical note</h1>
    <p class="admin-quiet">
      ${note.firstName} ${note.lastName}${note.club === null ? null : ` · ${note.club}`}
    </p>
    ${
      note.notes === null
        ? html`<p>
            There is no note against this entry — either none was written, or the separate
            medical consent was not given, in which case nothing was ever stored.
          </p>`
        : html`<blockquote class="admin-note">${note.notes}</blockquote>`
    }
    <p class="admin-quiet">
      This is <strong>special category data</strong>. Reading it has been recorded against
      your handle.
    </p>
    <p>
      <a href="${NN_ADMIN_PREFIX}/entries/${note.eventSlug}/">Back to the entries</a>
    </p>`;
}

// -----------------------------------------------------------------------------------------
// Odds and ends
// -----------------------------------------------------------------------------------------

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
