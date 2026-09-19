import { createUserClient, type SupabaseConfig } from '@src/shared';
import { plural } from '@src/shared';
import {
  PEOPLE_FILTERS,
  ROLE_GROUPS,
  grantable,
  groupFor,
  displayName,
  firstName,
  initialsFor,
  isUuid,
  matchesSearch,
  normaliseTypedName,
  parsePeopleQuery,
  peopleHref,
  pendingLabel,
  roleDiff,
  roleLabel,
  roleSummary,
  typedNameMatches,
  type PeopleFilter,
  type PeopleQuery,
  type PeopleView,
  type RoleGroup,
} from '@src/shared/people-roles';
import { html, raw, type Html } from './html';
import { can, masthead, notFound, page, type AdminViewer } from './admin-shell';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { cookieValue } from './cookies';

/**
 * `/admin/people/` — who holds which role, and the two acts that change it.
 *
 * ## Two readings of one page, and the permission that decides which
 *
 * **`identity.person.read` opens the page; `identity.role.grant` opens the controls on it.**
 * `people-admin` holds the first and not the second, and gets the same page with no switches
 * and no buttons — which is the whole of that role. `super-admin` holds both. Nobody holds the
 * second without the first, because granting a role to somebody means finding them in this
 * list first.
 *
 * **The page and the database ask the same question, and that is new.** `grant_role()`,
 * `revoke_role()` and `set_roles()` asked `has_role('super-admin')` until ADR-047; every other
 * gate on this surface had moved to a permission in #107 and these were left behind. So
 * `src-admin` — which carries `identity.role.grant` and not the role — was rendered controls
 * that all three refused, with a message telling a club director they were no longer a
 * super-admin. Nothing looked wrong to a `super-admin`, which is why it survived a fortnight.
 * All three ask the permission now, which is what the role's own published description has
 * claimed since 6 September 2026.
 *
 * ## Switches and one Save, which reverses what this file used to say
 *
 * This file carried a heading — *"One deliberate act per grant, and never a multi-select"* —
 * arguing that checkboxes and one Save make granting somebody the entry list *"a thing that
 * happens on the way past"*, and make an accidental revoke indistinguishable from a deliberate
 * one in the audit trail. **ADR-046 supersedes the first half and keeps the second.**
 *
 * The first half is superseded because the volunteer doing this changes several roles at once
 * anyway: handing a new committee member four roles was four page loads, and four separate
 * writes with no transaction around them is its own hazard — the third can fail and leave
 * somebody holding two of the four with nothing on screen saying so.
 *
 * The second half is kept in the database rather than in the shape of the form:
 * `identity.set_roles()` writes **one audit row per role changed**, using the two actions that
 * already existed, so a batch of four still reads in `identity.audit` as four acts.
 *
 * ## Progressive enhancement is the primary path, not a fallback
 *
 * Every spec in this repository runs in a `no-javascript` project, so this page is built to be
 * complete without scripting and to gain only decoration with it:
 *
 *   * the selected person, the view, the filter and the search live in the **query string**,
 *     and each is a real link or a GET form;
 *   * the switches are `<input type="checkbox" role="switch">` inside one `<form method="post">`,
 *     styled with CSS — they work natively, and an unchecked box is simply not submitted;
 *   * saving is POST → **303** → `?person=…&saved=1` → a `role="status"` banner, so a reload
 *     never repeats the act;
 *   * the super-admin confirmation is **its own address**, `?person=…&confirm=super`, with its
 *     own form. Phase 4 layers a `<dialog>` over that; the address stays.
 *
 * ## The person in the URL is a uuid and never an email address
 *
 * URLs reach logs, `Referer` headers and browser history. The id is already opaque, already
 * what every function here takes, and already what the audit trail records.
 */

/**
 * The roles come from the database, not from a list here.
 *
 * There used to be a constant at this point — `ROLES` — and ADR-017 removed it: a role is a
 * bundle of permissions and `identity.grantable_roles()` answers with the catalogue, so
 * **adding a role is a migration rather than a migration and a deploy.** A hand-maintained
 * copy in the Worker is exactly what that change was for.
 *
 * **The role a POST names is validated by the database**, not against a list here.
 * `identity.set_roles()` refuses an unknown slug with `unknown_role`, which `REFUSALS` has
 * words for. A second copy of that check here could only ever be the one that goes out of date.
 */
interface GrantableRole {
  slug: string;
  description: string;
  permissions: string[];
}

/**
 * Roles it would be pointless to offer a switch for.
 *
 * **`registered` is not a choice.** Every account gets it from the signup trigger and it grants
 * nothing on its own, so a switch for it would be a control that does nothing on a page whose
 * whole subject is access. `identity.set_roles()` refuses a batch that names it, so this is the
 * visible half of a rule the database keeps.
 *
 * **`super-admin` is withheld here and rendered on its own panel** — it is never part of the
 * batch, because a batch is how you change four things without reading any of them.
 */
const NOT_A_SWITCH = ['registered', 'super-admin'];

interface Person {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
}

/** What went wrong, in the words the person reading the page needs rather than the database's. */
const REFUSALS: Record<string, string> = {
  // **Not "you are no longer a super-admin"**, which is what this said while the database
  // asked for that role — and which was the sentence a club director met every time, holding
  // a role whose description says it grants roles. The gate is `identity.role.grant` now
  // (ADR-047), so the words are about the capability rather than about one role that carries
  // it.
  not_authorised: 'You can no longer change roles, so that change was not made.',
  unknown_role: 'That is not a role this club has.',
  unknown_person: 'That person no longer has an account.',
  reserved_role:
    'That role is not one this form can change. Super admin has its own button, and everybody with an account holds “registered”.',
  last_super_admin:
    'That is the last super-admin. Grant the role to somebody else first — a club with no super-admin has no way back in.',
  not_granted: 'They did not hold that role, so nothing changed.',
  stale:
    'Somebody else changed this person’s roles while this page was open, so nothing was saved. What they hold now is shown below — check it and try again.',
};

const HERE = '/admin/people/';

export async function handlePeopleSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  segments: string[],
  secure: boolean,
): Promise<Response> {
  if (segments.length > 0) {
    return notFound();
  }

  if (request.method === 'GET') {
    return listPage(request, viewer, cfg, secure, {});
  }

  if (request.method === 'POST') {
    // **The act is gated here, separately from the page.** `admin.ts` lets anybody holding
    // `identity.person.read` through to this file, which is what `people-admin` is for — and a
    // read-only viewer served a page with no forms on it can still hand-craft this POST. The
    // 404 is the same one the rest of the prefix gives: a forged request learns nothing from it.
    //
    // The database refuses them too, and *that* is the enforcement rather than this. This is
    // the door being shut in the right order.
    if (!can(viewer, 'identity.role.grant')) {
      return notFound();
    }

    return handlePost(request, viewer, cfg, secure);
  }

  return notFound();
}

/** What a failed POST carries back into the re-render, so nothing somebody typed is lost. */
interface Attempt {
  error?: string;
  status?: number;
  /** The roles the form submitted, so the switches come back as they were left. */
  wanted?: string[];
  /** Which person the attempt was about, when the query string does not say. */
  person?: string;
  /** What the confirmation box held, so a mistyped name is not retyped from scratch. */
  typed?: string;
  confirmError?: string;
  /**
   * ⚠️ **The view, the filter and the search, because a POST has no query string of its own.**
   * Without these a refused save re-renders the default view — and a refused *confirmation*
   * re-renders the person pane rather than the confirmation, so the message saying what went
   * wrong is attached to a screen nobody is looking at. That is not cosmetic: the typed-name
   * box is the whole of that screen, and losing it means the refusal is silent.
   */
  view?: PeopleView;
  filter?: PeopleFilter;
  q?: string;
  confirming?: boolean;
}

/** The page state a POST carries in hidden fields, read back through the same fallback rules. */
function stateFromForm(form: FormData): {
  view: PeopleView;
  filter: PeopleFilter;
  q: string;
} {
  const params = new URLSearchParams();
  for (const field of ['view', 'filter', 'q']) {
    const value = asText(form, field);
    if (value !== null) params.set(field, value);
  }
  const parsed = parsePeopleQuery(params);
  return { view: parsed.view, filter: parsed.filter, q: parsed.q };
}

async function handlePost(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);

  // **The CSRF check comes first**, before the form is read for anything else: a request that
  // failed it is not a request from this page and nothing in it should be acted on.
  if (
    form === null ||
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      asText(form, CSRF_FIELD),
    )
  ) {
    return notFound();
  }

  const action = asText(form, 'action');
  const person = asText(form, 'person');

  if (person === null || !isUuid(person)) {
    return notFound();
  }

  if (action === 'save') {
    return handleSave(request, viewer, cfg, secure, form, person);
  }

  if (action === 'super') {
    return handleSuperAdmin(request, viewer, cfg, secure, form, person);
  }

  return notFound();
}

/**
 * The batch.
 *
 * `expected` is what the page rendered and `role` is what the form submitted; the database
 * compares the first against what is actually held and refuses `stale` if they have parted.
 * **Neither is trusted here** — this function's job is to carry them, not to pre-judge them,
 * because a check in the Worker that the database does not also make is a check that is not
 * made at all.
 */
async function handleSave(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
  form: FormData,
  person: string,
): Promise<Response> {
  const state = stateFromForm(form);
  const expected = form.getAll('expected').filter(isString);
  const wanted = form.getAll('role').filter(isString);

  const asPerson = createUserClient(cfg, viewer.accessToken);
  const { data, error } = await asPerson.rpc('set_roles', {
    p_person: person,
    p_expected: expected,
    p_wanted: wanted,
  });

  if (error) {
    // **No personal data in the log, on this path or any other.** The code and the message are
    // the database's own; the person's id and address stay out of it.
    console.error(`identity.set_roles unavailable — ${error.code}: ${error.message}`);
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      wanted,
      error: 'That change could not be saved. Try again.',
      status: 503,
    });
  }

  const answer = data as { ok?: boolean; reason?: string } | null;

  if (answer?.ok !== true) {
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      wanted,
      error: refusalWords(answer?.reason),
      // **409 for a lost race, 422 for a bad payload**, and never a 500 — the request was
      // understood, it was refused. A stale save is the one a second person caused.
      status: answer?.reason === 'stale' ? 409 : 422,
    });
  }

  return seeOther(peopleHref(HERE, { ...state, person, saved: true }));
}

/**
 * Super admin, which is never part of the batch.
 *
 * **The typed name is checked here and the role change is the database's.** The box exists to
 * make somebody stop and read the sentence above it; it is a deliberation gesture rather than
 * an authorisation, and anybody who could skip it by calling PostgREST directly already holds
 * `super-admin` and could already call `revoke_role()`. Putting it in the database would make
 * it look like a control it is not — but it is checked on the server rather than only in the
 * browser, because a confirmation only the page enforces is no confirmation at all against a
 * POST that skipped the page.
 *
 * **The last-super-admin guard is `revoke_role()`'s and is not repeated here.** The button is
 * disabled and says why, which is the visible half; the refusal is the real one.
 */
async function handleSuperAdmin(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
  form: FormData,
  person: string,
): Promise<Response> {
  const state = stateFromForm(form);
  const typed = asText(form, 'typed') ?? '';
  const intent = asText(form, 'intent');

  if (intent !== 'grant' && intent !== 'revoke') {
    return notFound();
  }

  const asPerson = createUserClient(cfg, viewer.accessToken);
  const people = await readPeople(asPerson);

  if (people === null) {
    return unreachable(viewer);
  }

  const subject = people.people.find((candidate) => candidate.id === person);

  if (subject === undefined) {
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      error: refusalWords('unknown_person'),
      status: 422,
    });
  }

  if (!typedNameMatches(typed, displayName(subject))) {
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      typed,
      // Back to the confirmation, not to the pane behind it — see `Attempt.confirming`.
      confirming: true,
      status: 422,
      confirmError:
        'That did not match, so nothing was changed. Type the name exactly as it is shown.',
    });
  }

  const { data, error } = await asPerson.rpc(
    intent === 'grant' ? 'grant_role' : 'revoke_role',
    { p_person: person, p_role: 'super-admin' },
  );

  if (error) {
    console.error(
      `identity.${intent}_role unavailable — ${error.code}: ${error.message}`,
    );
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      error: 'That change could not be made. Try again.',
      status: 503,
    });
  }

  const answer = data as { ok?: boolean; reason?: string } | null;

  if (answer?.ok !== true) {
    return listPage(request, viewer, cfg, secure, {
      ...state,
      person,
      error: refusalWords(answer?.reason),
      status: 422,
    });
  }

  return seeOther(peopleHref(HERE, { ...state, person, saved: true }));
}

/** 303 rather than rendering here, so a reload does not repeat the act. */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function refusalWords(reason: string | undefined): string {
  return reason !== undefined && reason in REFUSALS
    ? REFUSALS[reason]!
    : 'That change was refused.';
}

interface PeopleRead {
  people: Person[];
}

async function readPeople(
  asPerson: ReturnType<typeof createUserClient>,
): Promise<PeopleRead | null> {
  const { data, error } = await asPerson.rpc('list_people');
  if (error) {
    console.error(`identity.list_people unavailable — ${error.code}: ${error.message}`);
    return null;
  }
  const answer = data as { ok?: boolean; people?: Person[] } | null;
  if (answer?.ok !== true) return null;
  return { people: answer.people ?? [] };
}

function unreachable(viewer: AdminViewer): Response {
  return page(
    'People and roles',
    html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <h1>People and roles</h1>
        <p>
          The club’s database could not be reached, so this page cannot say who holds
          what.
          <strong>It is not saying nobody does.</strong> Try again in a moment.
        </p>
      </main>`,
    { status: 503 },
  );
}

async function listPage(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
  attempt: Attempt,
): Promise<Response> {
  const asPerson = createUserClient(cfg, viewer.accessToken);

  // **Both reads together.** They answer two halves of one page — who exists, and what may be
  // handed to them — and a page that rendered the people while the role list was unreadable
  // would show switches with no labels, which reads as a broken page rather than a failure.
  const [peopleResult, { data: roleData, error: roleError }] = await Promise.all([
    readPeople(asPerson),
    asPerson.rpc('grantable_roles'),
  ]);

  if (peopleResult === null || roleError) {
    if (roleError) {
      console.error(
        `identity.grantable_roles unavailable — ${roleError.code}: ${roleError.message}`,
      );
    }
    return unreachable(viewer);
  }

  const roleAnswer = roleData as { ok?: boolean; roles?: GrantableRole[] } | null;
  if (roleAnswer?.ok !== true) {
    // The role was revoked between the door and this read. Same answer as everybody else.
    return notFound();
  }

  // **The attempt wins over the query string**, because a POST has none of its own: it lands
  // on `/admin/people/` with an empty search, and everything the page was showing travels in
  // hidden fields instead.
  const fromUrl = parsePeopleQuery(new URL(request.url).searchParams);
  const query: PeopleQuery = {
    ...fromUrl,
    view: attempt.view ?? fromUrl.view,
    filter: attempt.filter ?? fromUrl.filter,
    q: attempt.q ?? fromUrl.q,
    confirming: attempt.confirming ?? fromUrl.confirming,
  };
  const people = peopleResult.people;
  const roles = roleAnswer.roles ?? [];

  // **No token for somebody who cannot act, and no cookie either.** A CSRF token exists to bind
  // a form to this browser; a page with no forms has nothing to bind, and minting one anyway
  // would set a cookie on every read a `people-admin` makes without a POST ever being able to
  // spend it.
  const token = can(viewer, 'identity.role.grant') ? mintCsrfToken() : null;

  // An attempt knows which person it was about even when the query string does not, because a
  // POST carries no search parameters of its own.
  const selectedId = attempt.person ?? query.person;
  const selected = people.find((person) => person.id === selectedId) ?? null;

  const body = peopleBody({
    viewer,
    people,
    roles,
    token,
    query: { ...query, person: selectedId },
    selected,
    attempt,
  });

  return page('People and roles', body, {
    status: attempt.status ?? 200,
    cookies: token === null ? [] : [csrfCookie(token, secure)],
  });
}

interface PageModel {
  viewer: AdminViewer;
  people: Person[];
  roles: GrantableRole[];
  token: string | null;
  query: PeopleQuery;
  selected: Person | null;
  attempt: Attempt;
}

function peopleBody(model: PageModel): Html {
  const { viewer, people, query, attempt } = model;

  const supers = people.filter((person) => person.roles.includes('super-admin')).length;
  const withRoles = people.filter((person) => grantable(person.roles).length > 0).length;

  // **The phone's two screens are one document and one render.** Which of them is on screen is
  // a CSS question answered from this class, rather than a second address or a second template
  // — a detail screen that is its own page would need its own permission check, its own 404 and
  // its own copy of the list's filters in the URL.
  const chosen = query.view === 'person' && model.selected !== null;

  return html`${masthead(viewer)}
    <main
      class="${chosen ? 'admin-people admin-people-chosen' : 'admin-people'}"
      id="main"
    >
      ${hero(model, people.length, withRoles, supers)}
      ${
        attempt.error === undefined
          ? null
          : html`<p class="admin-error" role="alert">${attempt.error}</p>`
      }
      ${query.saved && attempt.error === undefined ? savedBanner(model) : null}
      ${
        query.confirming && model.selected !== null && model.token !== null
          ? confirmView(model, model.selected, supers)
          : query.view === 'role'
            ? roleView(model)
            : personView(model)
      }
    </main>`;
}

/**
 * The band across the top: what this page is, and three figures counted from the rows.
 *
 * **Counted server-side from real data, never written down.** A hard-coded figure on a page
 * about access is a claim somebody will act on.
 */
function hero(model: PageModel, total: number, withRoles: number, supers: number): Html {
  const { query } = model;

  const back =
    query.view === 'person' && query.person !== null
      ? peopleHref(HERE, { ...query, person: null, saved: false, confirming: false })
      : null;

  return html`<section class="admin-hero" aria-labelledby="people-title">
    ${
      back === null
        ? null
        : html`<a class="admin-hero-back" href="${back}"
            ><span aria-hidden="true">‹</span> People and roles</a
          >`
    }
    <div class="admin-hero-say">
      <h1 id="people-title">People and roles</h1>
      <p class="admin-hero-lede">
        Who can do what across the club. A change applies on that person’s next request.
      </p>
    </div>
    <div class="admin-hero-aside">
      ${viewToggle(query)}
      <dl class="admin-figs admin-hero-figs">
        ${figure('people', total)} ${figure('with admin roles', withRoles)}
        ${figure('super admins', supers)}
      </dl>
    </div>
  </section>`;
}

function figure(label: string, value: number): Html {
  return html`<div class="admin-fig">
    <dt class="admin-fig-label">${label}</dt>
    <dd class="admin-fig-value admin-mono">${String(value)}</dd>
  </div>`;
}

/**
 * By person / By role.
 *
 * **Links rather than buttons**, because each is a different address for the same data and
 * that is what a link is. `aria-current="page"` carries which one you are on; the fill is the
 * visible half of the same fact.
 */
function viewToggle(query: PeopleQuery): Html {
  const options: { view: 'person' | 'role'; label: string }[] = [
    { view: 'person', label: 'By person' },
    { view: 'role', label: 'By role' },
  ];

  return html`<nav class="admin-seg" aria-label="View">
    <ul>
      ${options.map((option) => {
        const on = query.view === option.view;
        return html`<li>
          <a
            class="${on ? 'admin-seg-link admin-seg-on' : 'admin-seg-link'}"
            href="${peopleHref(HERE, { ...query, view: option.view, saved: false, confirming: false })}"
            ${on ? raw('aria-current="page"') : null}
            >${option.label}</a
          >
        </li>`;
      })}
    </ul>
  </nav>`;
}

function savedBanner(model: PageModel): Html {
  const who = model.selected === null ? null : firstName(model.selected);

  return html`<p class="admin-saved" role="status">
    <span class="admin-saved-tick" aria-hidden="true">✓</span>
    ${
      who === null
        ? 'Saved. The roles change on their next request.'
        : html`Saved. ${who}’s roles change on their next request.`
    }
  </p>`;
}

// -----------------------------------------------------------------------------------------
// By person
// -----------------------------------------------------------------------------------------

function personView(model: PageModel): Html {
  return html`<div class="admin-split">${personList(model)} ${detailPane(model)}</div>`;
}

function personList(model: PageModel): Html {
  const { people, query } = model;

  const shown = people.filter((person) => {
    const held = grantable(person.roles).length;
    if (query.filter === 'roles' && held === 0) return false;
    if (query.filter === 'none' && held > 0) return false;
    return matchesSearch(person, query.q);
  });

  return html`<aside class="admin-people-list" aria-label="People">
    <form class="admin-people-search" method="get" action="${HERE}">
      ${hiddenState(query, ['q'])}
      <label for="people-q">Search people</label>
      <div class="admin-people-search-row">
        <input
          id="people-q"
          type="search"
          name="q"
          value="${query.q}"
          placeholder="Name or email"
          autocomplete="off"
        />
        <button type="submit" class="admin-button admin-button-quiet">Search</button>
      </div>
    </form>
    ${filterPills(query)}
    ${
      shown.length === 0
        ? html`<p class="admin-quiet admin-people-empty">
            Nobody matches that. Try part of a name or email.
          </p>`
        : html`<ul class="admin-people-rows">
            ${shown.map((person) => personRow(person, model))}
          </ul>`
    }
  </aside>`;
}

/**
 * The filters, as links.
 *
 * They keep the search and the view and drop `saved`, because a filter press is not a save and
 * the banner must not survive one — a `role="status"` that reappears on every navigation is a
 * page that announces something which did not just happen.
 */
function filterPills(query: PeopleQuery): Html {
  return html`<div class="admin-filters admin-people-filters">
    <ul>
      ${PEOPLE_FILTERS.map((filter) => {
        const on = query.filter === filter.id;
        return html`<li>
          <a
            class="${on ? 'admin-filter admin-filter-on' : 'admin-filter'}"
            href="${peopleHref(HERE, { ...query, filter: filter.id, saved: false, confirming: false })}"
            ${on ? raw('aria-current="true"') : null}
            >${filter.label}</a
          >
        </li>`;
      })}
    </ul>
  </div>`;
}

/** The view, filter and search a POST has to carry, because a POST has no query string. */
function postState(query: PeopleQuery): Html {
  return html`${
    query.view === 'role' ? html`<input type="hidden" name="view" value="role" />` : null
  }
  ${
    query.filter === 'all'
      ? null
      : html`<input type="hidden" name="filter" value="${query.filter}" />`
  }
  ${query.q === '' ? null : html`<input type="hidden" name="q" value="${query.q}" />`}`;
}

/** Carries the rest of the page's state through a GET form, which only submits its own fields. */
function hiddenState(query: PeopleQuery, except: string[]): Html {
  const fields: [string, string][] = [];
  if (query.view === 'role') fields.push(['view', 'role']);
  if (query.person !== null) fields.push(['person', query.person]);
  if (query.filter !== 'all') fields.push(['filter', query.filter]);
  if (query.q !== '') fields.push(['q', query.q]);

  return html`${fields
    .filter(([name]) => !except.includes(name))
    .map(
      ([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`,
    )}`;
}

function personRow(person: Person, model: PageModel): Html {
  const on = person.id === model.query.person;

  return html`<li>
    <a
      class="${on ? 'admin-person-row admin-person-row-on' : 'admin-person-row'}"
      href="${peopleHref(HERE, { ...model.query, person: person.id, saved: false, confirming: false })}"
      ${on ? raw('aria-current="true"') : null}
    >
      <span class="admin-avatar" aria-hidden="true">${initialsFor(person)}</span>
      <span class="admin-person-who">
        <span class="admin-person-name">${displayName(person)}</span>
        <span class="admin-person-email admin-mono">${person.email}</span>
      </span>
      <span class="admin-person-has">
        ${roleGlyph(person, model.roles)}
        <span class="admin-person-summary">${roleSummary(person.roles)}</span>
      </span>
    </a>
  </li>`;
}

/**
 * Eight bars saying which roles somebody holds, at a glance.
 *
 * **`aria-hidden`, and the summary beside it carries the meaning.** It is a shape, not a
 * reading: eight unlabelled bars announced one by one would be noise, and "3 roles" is the
 * fact. The same rule every chip on this surface follows — the tint is emphasis, the word is
 * the signal.
 *
 * The bars are drawn from the **catalogue** rather than from a fixed eight, so a ninth role
 * appears here the day it is added. `super-admin` is drawn last and apart, which is what the
 * gap in the middle of the glyph is.
 */
function roleGlyph(person: Person, roles: GrantableRole[]): Html {
  return html`<span class="admin-glyph" aria-hidden="true">
    ${ROLE_GROUPS.map((group) => {
      const inGroup = roles.filter(
        (role) =>
          !NOT_A_SWITCH.includes(role.slug) && groupFor(role.slug).id === group.id,
      );
      if (inGroup.length === 0) return null;

      return html`<span class="admin-glyph-group" data-group="${group.id}">
        ${inGroup.map(
          (role) =>
            html`<span
              class="${
                person.roles.includes(role.slug)
                  ? 'admin-glyph-seg admin-glyph-held'
                  : 'admin-glyph-seg'
              }"
            ></span>`,
        )}
      </span>`;
    })}
    <span class="admin-glyph-group" data-group="super">
      <span
        class="${
          person.roles.includes('super-admin')
            ? 'admin-glyph-seg admin-glyph-held'
            : 'admin-glyph-seg'
        }"
      ></span>
    </span>
  </span>`;
}

// -----------------------------------------------------------------------------------------
// The selected person
// -----------------------------------------------------------------------------------------

function detailPane(model: PageModel): Html {
  const { selected } = model;

  if (selected === null) {
    return html`<section
      class="admin-detail admin-detail-empty"
      aria-label="Selected person"
    >
      <p class="admin-quiet">
        Choose somebody from the list to see and change what they can do.
      </p>
    </section>`;
  }

  const supers = model.people.filter((p) => p.roles.includes('super-admin')).length;

  return html`<section class="admin-detail" aria-labelledby="person-name">
    ${personHeading(selected, model)}
    ${
      model.token === null
        ? readOnlyRoles(selected, model)
        : roleForm(selected, model, supers)
    }
  </section>`;
}

function personHeading(person: Person, model: PageModel): Html {
  return html`<div class="admin-detail-head">
    <span class="admin-avatar admin-avatar-lg" aria-hidden="true"
      >${initialsFor(person)}</span
    >
    <div class="admin-detail-who">
      <h2 id="person-name">${displayName(person)}</h2>
      <p class="admin-detail-email admin-mono">${person.email}</p>
    </div>
    <span class="admin-chip">${roleSummary(person.roles)}</span>
    ${
      person.id === model.viewer.id
        ? html`<span class="admin-chip admin-chip-you">you</span>`
        : null
    }
  </div>`;
}

/**
 * What a `people-admin` sees: the same facts, no controls.
 *
 * **Said rather than left as an absence.** A pane whose switches are simply missing reads as a
 * page that failed to load, and somebody who thinks that goes looking for a second way to do
 * the thing.
 */
function readOnlyRoles(person: Person, model: PageModel): Html {
  const held = model.roles.filter(
    (role) => !NOT_A_SWITCH.includes(role.slug) && person.roles.includes(role.slug),
  );

  return html`<p>
      <strong>You can see who holds what, and not change it</strong> — ask a super-admin
      to grant or revoke a role.
    </p>
    ${
      held.length === 0 && !person.roles.includes('super-admin')
        ? html`<p class="admin-quiet">No admin roles.</p>`
        : html`<dl class="admin-role-read">
            ${held.map(
              (role) =>
                html`<dt class="admin-mono">${role.slug}</dt>
                  <dd>${role.description}</dd>`,
            )}
            ${
              person.roles.includes('super-admin')
                ? html`<dt class="admin-mono">super-admin</dt>
                    <dd>Every role, including managing other admins.</dd>`
                : null
            }
          </dl>`
    }`;
}

/**
 * The switches, in one form.
 *
 * **One `<form method="post">` around every group**, so Save submits the whole set and the
 * browser needs no help doing it. The expected set travels as hidden fields: it is what this
 * render saw, and `identity.set_roles()` compares it against what is actually held.
 */
function roleForm(person: Person, model: PageModel, supers: number): Html {
  const token = model.token!;
  const attempted = model.attempt.wanted;

  // On a re-render after a refusal the switches come back as they were **left**, not as the
  // database has them — otherwise a mistyped save silently discards four decisions.
  const checkedNow = attempted ?? grantable(person.roles);
  const diff = roleDiff(person.roles, checkedNow);
  const pendingCount = diff.added.length + diff.removed.length;

  return html`<form method="post" action="${HERE}" class="admin-role-form" data-role-form>
      <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
      <input type="hidden" name="action" value="save" />
      <input type="hidden" name="person" value="${person.id}" />
      ${postState(model.query)}
      ${grantable(person.roles).map(
        (role) => html`<input type="hidden" name="expected" value="${role}" />`,
      )}

      <div class="admin-role-groups">
        ${ROLE_GROUPS.map((group) => groupCard(group, model, checkedNow, person))}
      </div>

      ${unsavedBar(diff, pendingCount, peopleHref(HERE, { ...model.query, person: person.id, saved: false, confirming: false }))}
    </form>

    ${superPanel(person, model, supers)} ${superDialog(model, person, supers)}
    ${enhancement()}`;
}

function groupCard(
  group: RoleGroup,
  model: PageModel,
  checked: string[],
  person: Person,
): Html {
  const inGroup = model.roles.filter(
    (role) => !NOT_A_SWITCH.includes(role.slug) && groupFor(role.slug).id === group.id,
  );

  if (inGroup.length === 0) return html``;

  return html`<fieldset class="admin-role-card" data-group="${group.id}">
    <legend>
      <span class="admin-role-dot" aria-hidden="true"></span>
      <span class="admin-eyebrow">${group.name}</span>
    </legend>
    ${inGroup.map((role) => switchRow(role, checked, person))}
  </fieldset>`;
}

/**
 * One switch.
 *
 * **A real checkbox with `role="switch"`**, styled with CSS — it submits natively, it is
 * operable by keyboard without a line of script, and `aria-checked` is the browser's to keep
 * in step rather than ours. The label wraps the whole text so the target is the row, which is
 * what makes 76px of it pressable rather than a 30px track.
 *
 * The description is **the database's, verbatim** — `identity.roles.description`, the same
 * text the legend on the old page rendered. Nothing here writes copy about what a role means.
 */
function switchRow(role: GrantableRole, checked: string[], person: Person): Html {
  const id = `role-${role.slug}`;
  const on = checked.includes(role.slug);
  const was = person.roles.includes(role.slug);

  // **The pill's word comes from here rather than from the browser.** The enhancement builds
  // "+ NN results" out of this attribute instead of deriving it again — the rule
  // `outboxAttemptsWords()` established when two admin pages called one `attempts` row "3
  // attempts" and "Failed after 3 tries". Sharing the conditional stops a surface re-deriving
  // it; sharing the **noun** stops a third surface picking a third word.
  return html`<div
    class="${on !== was ? 'admin-switch-row admin-switch-changed' : 'admin-switch-row'}"
    data-pending-label="${pendingLabel(role.slug)}"
  >
    <input
      type="checkbox"
      role="switch"
      class="admin-switch"
      id="${id}"
      name="role"
      value="${role.slug}"
      ${on ? raw('checked') : null}
    />
    <label for="${id}">
      <span class="admin-switch-name" data-switch-name>
        ${roleLabel(role.slug)}
        ${
          on !== was
            ? html`<span class="admin-tag-pending" data-pending-tag>Unsaved</span>`
            : null
        }
      </span>
      <span class="admin-switch-desc">${role.description}</span>
      <span class="admin-switch-key admin-mono">${role.slug}</span>
    </label>
  </div>`;
}

/**
 * The bar under the switches.
 *
 * **A labelled region, and it announces politely.** Without scripting it is only ever drawn
 * with a pending set on a re-render after a refusal — the ordinary path shows the helper line
 * — so `aria-live` is what makes the enhanced version announce a change rather than the region
 * re-reading itself.
 */
function unsavedBar(
  diff: { added: string[]; removed: string[] },
  count: number,
  discardHref: string,
): Html {
  return html`<div
    class="admin-unsaved"
    role="region"
    aria-label="Unsaved changes"
    data-unsaved
    data-one="unsaved change"
    data-many="unsaved changes"
  >
    <p class="admin-unsaved-count" aria-live="polite" data-unsaved-count>
      ${
        count === 0
          ? html`<span class="admin-quiet"
              >Flip a switch to change a role. Nothing is saved until you press
              Save.</span
            >`
          : html`<strong
              >${String(count)} unsaved ${count === 1 ? 'change' : 'changes'}</strong
            >`
      }
    </p>
    <ul class="admin-unsaved-pills" data-unsaved-pills>
      ${diff.added.map(
        (role) => html`<li class="admin-pill-pending">+ ${pendingLabel(role)}</li>`,
      )}
      ${diff.removed.map(
        (role) => html`<li class="admin-pill-pending">− ${pendingLabel(role)}</li>`,
      )}
    </ul>
    <div class="admin-unsaved-actions">
      ${
        /* ⚠️ **A link, not a submit with `formmethod="get"`.** That was the first shape of this
           control and it is a disclosure: a GET submit serialises *every* field in the form
           into the query string — the CSRF token included — so the token would land in the
           address bar, in the browser's history and in any `Referer` this page sent. Re-reading
           the person from the database is what discarding means anyway. */ null
      }
      <a class="admin-button admin-button-quiet" href="${discardHref}">Discard</a>
      <button type="submit" class="admin-button">Save changes</button>
    </div>
  </div>`;
}

/**
 * Super admin, on its own and never in the batch.
 *
 * **The disabled button explains itself in visible text**, not in a tooltip: a `title` is
 * unreachable by keyboard, invisible on a touch screen and unread by most screen readers, and
 * "why can I not press this" is exactly the question somebody has at that moment.
 */
function superPanel(person: Person, model: PageModel, supers: number): Html {
  const isSuper = person.roles.includes('super-admin');
  const locked = isSuper && supers <= 1;

  return html`<section class="admin-super" aria-labelledby="super-heading">
    <div class="admin-super-say">
      <h3 id="super-heading">
        Super admin <span class="admin-mono admin-super-key">super-admin</span>
      </h3>
      <p>
        ${
          locked
            ? 'The only super admin. Grant the role to somebody else before removing it here — a club with no super admin has no way back in.'
            : isSuper
              ? 'Has every role, including managing other admins.'
              : 'Every role, including managing other admins.'
        }
      </p>
    </div>
    ${
      locked
        ? html`<p class="admin-super-locked">Cannot be removed</p>`
        : html`<a
            class="admin-button admin-button-grave"
            href="${peopleHref(HERE, { ...model.query, person: person.id, saved: false, confirming: true })}"
            data-super-open
            >${isSuper ? 'Remove super admin…' : 'Make super admin…'}</a
          >`
    }
  </section>`;
}

// -----------------------------------------------------------------------------------------
// The super-admin confirmation, as its own address
// -----------------------------------------------------------------------------------------

/**
 * **Its own page rather than a dialog**, because a dialog is scripting and every spec here runs
 * in a `no-javascript` project. Phase 4 layers a `<dialog>` in front of this; the address and
 * the form stay exactly as they are, which is what makes the enhancement removable.
 */
function confirmView(model: PageModel, person: Person, supers: number): Html {
  const isSuper = person.roles.includes('super-admin');
  const locked = isSuper && supers <= 1;
  const name = displayName(person);
  const first = firstName(person);
  const back = peopleHref(HERE, {
    ...model.query,
    person: person.id,
    confirming: false,
    saved: false,
  });

  if (locked) {
    return html`<section class="admin-confirm" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Cannot remove the last super admin</h2>
      <p>
        ${name} is the only super admin. Grant the role to somebody else first — a club
        with no super admin has no way back in.
      </p>
      <p><a class="admin-linkish" href="${back}">Back to ${first}</a></p>
    </section>`;
  }

  return html`<section class="admin-confirm" aria-labelledby="confirm-title">
    ${confirmBody(model, person, isSuper, back)}
  </section>`;
}

/**
 * The confirmation itself, rendered into two containers and written once.
 *
 * Without scripting it is a `<section>` on its own address; with scripting it is the body of a
 * `<dialog>` on the person's own screen. **The two are never on one page** — `peopleBody`
 * branches — so the ids below cannot collide, and the form is identical in both, which is what
 * makes the dialog removable rather than a second implementation of the same act.
 */
function confirmBody(
  model: PageModel,
  person: Person,
  isSuper: boolean,
  cancelHref: string,
): Html {
  const name = displayName(person);
  const first = firstName(person);

  return html`<p class="admin-eyebrow admin-confirm-eyebrow">Full control</p>
    <h2 id="confirm-title">
      ${isSuper ? html`Remove ${first} as super admin?` : html`Make ${first} a super admin?`}
    </h2>
    <p id="confirm-detail">
      ${
        isSuper
          ? html`${first} keeps any other roles that are switched on, but can no longer
            manage other admins.`
          : html`${first} will be able to do everything on this site, including giving and
            taking away anyone’s roles — yours too. It applies on their next request.`
      }
    </p>
    ${
      model.attempt.confirmError === undefined
        ? null
        : html`<p class="admin-error" role="alert">${model.attempt.confirmError}</p>`
    }
    <form method="post" action="${HERE}" class="admin-confirm-form">
      <input type="hidden" name="${raw(CSRF_FIELD)}" value="${model.token!}" />
      <input type="hidden" name="action" value="super" />
      <input type="hidden" name="person" value="${person.id}" />
      ${postState(model.query)}
      <input type="hidden" name="intent" value="${isSuper ? 'revoke' : 'grant'}" />
      <label for="confirm-name">
        Type <span class="admin-mono">${name}</span> to confirm
      </label>
      ${
        /* **`data-expect` is the expected name already normalised by the server.** The
           enhancement compares against it so only the *typed* side is normalised in the
           browser — see `normaliseTypedName`, which is the authority and says why that one
           line is duplicated. The server checks the real thing either way. */ null
      }
      <input
        id="confirm-name"
        type="text"
        name="typed"
        value="${model.attempt.typed ?? ''}"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-describedby="confirm-detail"
        data-confirm-input
        data-expect="${normaliseTypedName(name)}"
        required
      />
      <div class="admin-actions">
        <a class="admin-button admin-button-quiet" href="${cancelHref}" data-super-cancel
          >Cancel</a
        >
        <button type="submit" class="admin-button admin-button-grave" data-confirm-submit>
          ${isSuper ? 'Remove super admin' : 'Make super admin'}
        </button>
      </div>
    </form>`;
}

/**
 * The same confirmation as a modal, for a browser that can run the script.
 *
 * **Closed by default and `display: none` until `showModal()`**, so with scripting off it is
 * not reachable at all and the link beside it goes to the address instead. Focus trapping and
 * Esc are the element's own; returning focus to the opener is the one part that is not, and
 * the script does it on `close`.
 */
function superDialog(model: PageModel, person: Person, supers: number): Html {
  const isSuper = person.roles.includes('super-admin');
  if (isSuper && supers <= 1) return html``;

  const back = peopleHref(HERE, {
    ...model.query,
    person: person.id,
    confirming: false,
    saved: false,
  });

  return html`<dialog
    class="admin-confirm admin-dialog"
    data-super-dialog
    aria-labelledby="confirm-title"
    aria-describedby="confirm-detail"
  >
    ${confirmBody(model, person, isSuper, back)}
  </dialog>`;
}

// -----------------------------------------------------------------------------------------
// By role
// -----------------------------------------------------------------------------------------

/**
 * One card per role, with everybody who holds it.
 *
 * **`super-admin` gets a card too**, because "who can do everything" is the first question
 * somebody opens this view to answer — and it is drawn dark, the way its panel is, so the two
 * readings of the same fact look like the same fact.
 */
function roleView(model: PageModel): Html {
  const cards = model.roles.filter((role) => role.slug !== 'registered');

  // **A list, not eight landmarks.** A `<section>` with an accessible name is a `region`, and
  // eight of them is eight stops in a landmark rota — while two of the club's roles legitimately
  // shorten to the same word, so two of those regions had the same name and axe refused them
  // (`landmark-unique`). A list says "eight roles" once and is navigated by heading, which is
  // what somebody is looking for here. Found by running axe over this view for the first time:
  // the desktop pass only ever visited the person view.
  return html`<ul class="admin-role-cards">
    ${cards.map((role) => roleCard(role, model))}
  </ul>`;
}

function roleCard(role: GrantableRole, model: PageModel): Html {
  const isSuper = role.slug === 'super-admin';
  const group = groupFor(role.slug);
  const holders = model.people.filter((person) => person.roles.includes(role.slug));

  const area = isSuper ? 'Full control' : group.name;

  return html`<li
    class="${isSuper ? 'admin-role-tile admin-role-tile-super' : 'admin-role-tile'}"
    data-group="${isSuper ? 'super' : group.id}"
  >
    <p class="admin-role-tile-top">
      <span class="admin-role-dot" aria-hidden="true"></span>
      ${
        /* **`aria-hidden`, because the heading below carries this word too.** It stays here as
           the visible eyebrow the design asks for, and reading it twice is the only thing that
           would otherwise cost. */ null
      }
      <span class="admin-eyebrow" aria-hidden="true">${area}</span>
      <span class="admin-mono admin-role-tile-count"
        >${String(holders.length)}<span class="admin-visually-hidden">
          ${plural(holders.length, 'person holds this role', 'people hold this role')}</span
        ></span
      >
    </p>
    ${
      /* **The area is part of the heading, and it is what makes the name unique.** `nn-admin`
         and `timing-admin` both shorten to "Admin", so a heading of the label alone gives two
         cards the same name — which is what axe refused while these were landmarks, and is no
         better for somebody navigating by heading now that they are not. */ null
    }
    <h2>
      <span class="admin-visually-hidden">${area} </span>${
        isSuper ? 'Super admin' : roleLabel(role.slug)
      }
    </h2>
    <p class="admin-mono admin-role-tile-key">${role.slug}</p>
    <p class="admin-role-tile-desc">${role.description}</p>
    ${
      holders.length === 0
        ? html`<p class="admin-quiet">Nobody yet.</p>`
        : html`<ul class="admin-role-holders">
            ${holders.map(
              (person) =>
                html`<li>
                  <a
                    href="${peopleHref(HERE, { ...model.query, view: 'person', person: person.id, saved: false, confirming: false })}"
                  >
                    <span class="admin-avatar admin-avatar-sm" aria-hidden="true"
                      >${initialsFor(person)}</span
                    >
                    <span>${displayName(person)}</span>
                  </a>
                </li>`,
            )}
          </ul>`
    }
  </li>`;
}

// -----------------------------------------------------------------------------------------

/**
 * The enhancement, and the four things it is allowed to do.
 *
 * **The server stays the source of truth for every one of them.** This adds the "Unsaved" tag,
 * the pending pills and their undo, the `<dialog>`, and enabling the confirm button as somebody
 * types. Take the whole thing away and the page still grants and revokes roles — which is the
 * property every spec in the `no-javascript` project is asserting.
 *
 * ## Why it re-derives almost nothing
 *
 * **Whether a switch has changed is `checked !== defaultChecked`.** `defaultChecked` *is* the
 * `checked` attribute the server sent, so the browser reads the stored state out of the DOM
 * rather than computing a diff of its own. That is what keeps `roleDiff()` the only
 * implementation: a second one in here is exactly how pending state comes to disagree with what
 * a save actually did.
 *
 * **The words come from the markup too.** Each row carries `data-pending-label` — "NN results" —
 * and the bar carries the singular and plural nouns. That is `outboxAttemptsWords()`'s rule:
 * sharing the conditional stops a surface re-deriving it, and sharing the *noun* stops a third
 * surface picking a third word.
 *
 * ⚠️ **One line is duplicated and it is the name normaliser.** There is no bundler reaching a
 * Worker-rendered page — `account.ts` carries the only other inline script here for the same
 * reason — so the trimming-and-lower-casing rule exists once in `normaliseTypedName` and once
 * below. The *expected* value arrives already normalised in `data-expect`, so only the typed
 * side is done twice, and `people-roles.test.ts` pins the contract both have to meet. If that
 * rule ever grows past one line it stops being worth duplicating, and the button should stop
 * being disabled instead.
 */
function enhancement(): Html {
  return html`<script>
    ${raw(ENHANCEMENT)};
  </script>`;
}

const ENHANCEMENT = `
(function () {
  var form = document.querySelector('[data-role-form]');

  if (form) {
    var bar = form.querySelector('[data-unsaved]');
    var countEl = bar.querySelector('[data-unsaved-count]');
    var pills = bar.querySelector('[data-unsaved-pills]');
    var one = bar.getAttribute('data-one') || 'change';
    var many = bar.getAttribute('data-many') || 'changes';
    var rows = Array.prototype.slice.call(form.querySelectorAll('[data-pending-label]'));

    var draw = function () {
      var changed = [];

      rows.forEach(function (row) {
        var box = row.querySelector('input[type="checkbox"]');
        if (!box) return;

        var isChanged = box.checked !== box.defaultChecked;
        row.classList.toggle('admin-switch-changed', isChanged);

        var tag = row.querySelector('[data-pending-tag]');
        if (isChanged && !tag) {
          tag = document.createElement('span');
          tag.className = 'admin-tag-pending';
          tag.setAttribute('data-pending-tag', '');
          tag.textContent = 'Unsaved';
          var name = row.querySelector('[data-switch-name]');
          if (name) name.appendChild(tag);
        } else if (!isChanged && tag) {
          tag.remove();
        }

        if (isChanged) {
          changed.push({
            box: box,
            added: box.checked,
            label: row.getAttribute('data-pending-label') || '',
          });
        }
      });

      pills.textContent = '';
      changed.forEach(function (change) {
        var item = document.createElement('li');
        item.className = 'admin-pill-pending';
        item.appendChild(
          document.createTextNode((change.added ? '+ ' : '\\u2212 ') + change.label)
        );

        var undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'admin-pill-undo';
        undo.setAttribute(
          'aria-label',
          'Undo ' + (change.added ? 'adding ' : 'removing ') + change.label
        );
        undo.textContent = '\\u00d7';
        undo.addEventListener('click', function () {
          change.box.checked = change.box.defaultChecked;
          draw();
          change.box.focus();
        });

        item.appendChild(undo);
        pills.appendChild(item);
      });

      countEl.textContent = '';
      if (changed.length === 0) {
        var quiet = document.createElement('span');
        quiet.className = 'admin-quiet';
        quiet.textContent =
          'Flip a switch to change a role. Nothing is saved until you press Save.';
        countEl.appendChild(quiet);
      } else {
        var strong = document.createElement('strong');
        strong.textContent =
          String(changed.length) + ' ' + (changed.length === 1 ? one : many);
        countEl.appendChild(strong);
      }
    };

    form.addEventListener('change', function (event) {
      var target = event.target;
      if (target && target.type === 'checkbox') draw();
    });

    draw();
  }

  var opener = document.querySelector('[data-super-open]');
  var dialog = document.querySelector('[data-super-dialog]');

  if (opener && dialog && typeof dialog.showModal === 'function') {
    opener.addEventListener('click', function (event) {
      event.preventDefault();
      dialog.showModal();
      var first = dialog.querySelector('[data-confirm-input]');
      if (first) first.focus();
    });

    // Focus back to what opened it. Trapping and Esc are the element's own.
    dialog.addEventListener('close', function () {
      opener.focus();
    });

    var cancel = dialog.querySelector('[data-super-cancel]');
    if (cancel) {
      cancel.addEventListener('click', function (event) {
        event.preventDefault();
        dialog.close();
      });
    }
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('[data-confirm-input]'),
    function (input) {
      var owner = input.form;
      if (!owner) return;
      var submit = owner.querySelector('[data-confirm-submit]');
      if (!submit) return;

      var expected = input.getAttribute('data-expect') || '';

      var check = function () {
        // The one line duplicated from normaliseTypedName. See the header above.
        var typed = input.value.trim().replace(/\\s+/g, ' ').toLowerCase();
        submit.disabled = expected === '' || typed !== expected;
      };

      input.addEventListener('input', check);
      check();
    }
  );
})();
`;

function asText(form: FormData, field: string): string | null {
  const value = form.get(field);
  return typeof value === 'string' ? value : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}
