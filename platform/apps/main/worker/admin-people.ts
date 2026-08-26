import { createUserClient, type SupabaseConfig } from '@src/shared';
import { html, raw, type Html } from './html';
import { masthead, notFound, page, type AdminViewer } from './admin-shell';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { cookieValue } from './cookies';

/**
 * `/admin/people/` — who holds which role, and the two acts that change it.
 *
 * ## Why this page exists at all
 *
 * #51 made roles real and #57 made one of them mean something. Neither gave anybody a way to
 * hand one out, so granting somebody read access to two hundred entrants' emergency contacts
 * meant an `insert` in the Supabase SQL editor — database credentials, a runbook, and **two
 * people in the club who could ever do it**.
 * [No system is reachable by only one person](../../../docs/architecture/principles.md#no-system-is-reachable-by-only-one-person)
 * is a non-negotiable, and "the two people with SQL access" is one person's worth of
 * resilience away from being the complaint the club has about every other system it runs.
 *
 * ## Four rules, and only the first is this page's
 *
 * [Zod is the form's control, not the system's](../../../CLAUDE.md), and Slice G is why that
 * sentence exists in this repository — nine rules that lived in TypeScript alone turned out
 * not to be enforced at all. So three of these four are the database's, from #51:
 *
 *   | | Where |
 *   | --- | --- |
 *   | A CSRF token on every grant and revoke | **Here** |
 *   | Only a `super-admin` may grant or revoke | `identity.grant_role()` / `revoke_role()` |
 *   | The last `super-admin` grant cannot be revoked | `identity.revoke_role()` |
 *   | Every change is audited, in the same transaction | both |
 *
 * `packages/db/tests/identity.test.ts` re-attempts each bypass with an authenticated client
 * and asserts the **specific** refusal, exactly as `entries-rules.test.ts` does for Slice G's
 * nine. A page that stopped calling these functions would change nothing about who may grant a
 * role.
 *
 * ## One deliberate act per grant, and never a multi-select
 *
 * A form per role per person, each its own POST. The alternative — checkboxes and one Save —
 * makes granting somebody the entry list a thing that happens on the way past, and makes an
 * accidental revoke indistinguishable from a deliberate one in the audit trail. **`revoked_at`
 * rather than a delete**, so the audit rows go on pointing at something.
 *
 * ## What is deliberately not here
 *
 *   * **Editing somebody else's profile.** A super-admin correcting a member's address is a
 *     change to a record that person controls, and it needs its own thinking about
 *     notification and consent.
 *   * **Deleting an account.** #62's, and it belongs to the person rather than to an
 *     administrator.
 *   * **Creating an account on somebody's behalf.** `identity.reserved_grants` already
 *     pre-assigns a role to an address that has not signed up; inviting is a later thing.
 *   * **The audit trail, rendered.** The same argument ADR-013 made for `entries.admin_audit`:
 *     reading it needs another function granted to another role, and it is read when somebody
 *     asks a question about a disclosure — a moment that already involves this page's owner. A
 *     SQL query in the runbook is the interface until somebody argues otherwise.
 *   * **Anybody's date of birth or address.** This is a roles page, not a member list, and
 *     `identity.list_people()` does not return them.
 */

/**
 * The roles come from the database now, not from a list here.
 *
 * There used to be a constant at this point — `ROLES`, described as "the three, as
 * `identity.roles`' own check constraint spells them" — and a `GRANTABLE` beside it. ADR-017
 * removed that constraint and made a role a bundle of permissions, at which point a
 * hand-maintained copy of the role list in the Worker is exactly what the change was for:
 * **adding a role should be a migration, not a migration and a deploy.**
 *
 * `identity.grantable_roles()` answers with each role's description and the permissions it
 * carries, which is also what makes a new role legible on this page — granting somebody
 * `nn-tester` from a dropdown of bare slugs is granting a capability nobody at the keyboard
 * can see.
 *
 * **The role a POST names is validated by the database rather than against a list here.**
 * `identity.grant_role()` refuses an unknown slug through the foreign key to `identity.roles`
 * and answers `unknown_role`, which `REFUSALS` already has words for. A second copy of that
 * check here could only ever be the one that goes out of date.
 */
interface GrantableRole {
  slug: string;
  description: string;
  permissions: string[];
}

/**
 * Roles it would be pointless to offer a button for.
 *
 * **`registered` is not one of them.** Every account gets it from the signup trigger and it
 * grants nothing on its own, so a control for it would be a button that does nothing on a page
 * whose whole subject is access.
 *
 * **And `member` is not here at all** — ADR-016. It used to be the role every account got,
 * which meant the club's word for somebody who has joined and paid was spent on "has signed
 * up". A grantable `member` that nothing verifies would let a super-admin record a claim the
 * system cannot back, so it is gone until membership brings its own record.
 *
 * **Everything else the club adds is offered automatically**, which is the property ADR-017
 * gave this page: the list below is what to *withhold*, not what to show.
 */
const NOT_WORTH_A_BUTTON = ['registered'];

interface Person {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
}

/** What went wrong, in the words the person reading the page needs rather than the database's. */
const REFUSALS: Record<string, string> = {
  not_authorised: 'You are no longer a super-admin, so that change was not made.',
  unknown_role: 'That is not a role this club has.',
  unknown_person: 'That person no longer has an account.',
  last_super_admin:
    'That is the last super-admin. Grant the role to somebody else first — a club with no super-admin has no way back in.',
  not_granted: 'They did not hold that role, so nothing changed.',
};

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
    return listPage(viewer, cfg, secure, null);
  }

  if (request.method === 'POST') {
    return handleChange(request, viewer, cfg, secure);
  }

  return notFound();
}

/**
 * Grant or revoke one role for one person.
 *
 * **The CSRF check comes first**, before the form is read for anything else, because a request
 * that failed it is not a request from this page and nothing in it should be acted on.
 */
async function handleChange(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);

  if (
    form === null ||
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      asText(form, CSRF_FIELD),
    )
  ) {
    // The same answer the rest of this prefix gives. A forged POST learns nothing from it.
    return notFound();
  }

  const action = asText(form, 'action');
  const person = asText(form, 'person');
  const role = asText(form, 'role');

  if (
    (action !== 'grant' && action !== 'revoke') ||
    person === null ||
    !isUuid(person) ||
    role === null
  ) {
    return notFound();
  }

  const asPerson = createUserClient(cfg, viewer.accessToken);
  const { data, error } = await asPerson.rpc(
    action === 'grant' ? 'grant_role' : 'revoke_role',
    { p_person: person, p_role: role },
  );

  if (error) {
    console.error(
      `identity.${action}_role unavailable — ${error.code}: ${error.message}`,
    );
    return listPage(viewer, cfg, secure, 'That change could not be made. Try again.');
  }

  const answer = data as { ok?: boolean; reason?: string } | null;

  if (answer?.ok !== true) {
    return listPage(viewer, cfg, secure, refusalWords(answer?.reason));
  }

  // **303 rather than rendering the list here**, so a reload does not repeat the act. The same
  // reason every other write in this Worker answers with one.
  return new Response(null, {
    status: 303,
    headers: {
      location: '/admin/people/',
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

async function listPage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
  error: string | null,
): Promise<Response> {
  const asPerson = createUserClient(cfg, viewer.accessToken);

  // **Both reads together.** They answer two halves of one page — who exists, and what may be
  // handed to them — and a page that rendered the people while the role list was unreadable
  // would show a table with no controls, which reads as "you may not change anything" rather
  // than as a failure.
  const [{ data, error: readError }, { data: roleData, error: roleError }] =
    await Promise.all([asPerson.rpc('list_people'), asPerson.rpc('grantable_roles')]);

  if (readError || roleError) {
    const failure = readError ?? roleError;
    console.error(
      `identity people/roles read unavailable — ${failure?.code}: ${failure?.message}`,
    );
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

  const answer = data as { ok?: boolean; people?: Person[] } | null;

  if (answer?.ok !== true) {
    // The role was revoked between the door and this read. Same answer as everybody else.
    return notFound();
  }

  const roleAnswer = roleData as { ok?: boolean; roles?: GrantableRole[] } | null;

  if (roleAnswer?.ok !== true) {
    return notFound();
  }

  const people = answer.people ?? [];
  const grantable = (roleAnswer.roles ?? []).filter(
    (role) => !NOT_WORTH_A_BUTTON.includes(role.slug),
  );
  const token = mintCsrfToken();

  return page('People and roles', peopleBody(viewer, people, grantable, token, error), {
    cookies: [csrfCookie(token, secure)],
  });
}

function peopleBody(
  viewer: AdminViewer,
  people: Person[],
  grantable: GrantableRole[],
  token: string,
  error: string | null,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>People and roles</h1>
      <p>
        Everybody with an account.
        <strong>A role takes effect on their next request</strong> — there is no session
        to end and nothing for them to do.
      </p>
      ${error === null ? null : html`<p class="admin-error" role="alert">${error}</p>`}
      ${roleLegend(grantable)}
      ${
        people.length === 0
          ? html`<p>Nobody has registered yet.</p>`
          : html`<div class="admin-scroll">
              <table class="admin-table">
                <caption class="admin-visually-hidden">
                  Everybody with an account, the roles they hold, and the controls that
                  change them
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  ${people.map((person) => personRow(person, viewer, grantable, token))}
                </tbody>
              </table>
            </div>`
      }
    </main>`;
}

/**
 * One row, one person.
 *
 * **`<th scope="row">` on the person cell, not `<td>`** — the entries table, the interest
 * list and the start list all name their row this way, and a screen reader that can jump by
 * row header on those three could not on this one. A person's own identity is what a row on
 * this table is about, in the same sense a runner's name is what a row of the entries table
 * is about.
 */
function personRow(
  person: Person,
  viewer: AdminViewer,
  grantable: GrantableRole[],
  token: string,
): Html {
  return html`<tr>
    <th scope="row">
      ${person.name === null ? null : html`<span>${person.name}</span> `}
      <span class="admin-mono">${person.email}</span>
      ${person.id === viewer.id ? html`<span class="admin-chip">you</span>` : null}
    </th>
    <td>${person.roles.length === 0 ? 'none' : person.roles.join(', ')}</td>
    <td>${grantable.map((role) => roleControl(person, role, token))}</td>
  </tr>`;
}

/**
 * One button, for one role, for one person.
 *
 * **The accessible name names the person and the role**, which is #59's requirement and not a
 * nicety: without it a screen reader meets four buttons all called "Grant" and has to infer
 * from the table which row it is standing in. The visible label stays short because the column
 * is narrow at 320px, so the name is carried by a visually hidden span — inside a
 * `position: relative` scroller, per the trap in `CLAUDE.md` about an absolutely positioned
 * element in a horizontally scrolling table dragging the whole page sideways.
 */
function roleControl(person: Person, role: GrantableRole, token: string): Html {
  const held = person.roles.includes(role.slug);
  const action = held ? 'revoke' : 'grant';

  return html`<form method="post" action="/admin/people/" class="admin-inline-form">
    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
    <input type="hidden" name="action" value="${action}" />
    <input type="hidden" name="person" value="${person.id}" />
    <input type="hidden" name="role" value="${role.slug}" />
    <button type="submit" class="admin-button">
      ${held ? 'Revoke' : 'Grant'} ${role.slug}
      <span class="admin-visually-hidden">
        for ${person.email}. ${role.description}
      </span>
    </button>
  </form>`;
}

/**
 * What each role actually lets somebody do, once, above the table.
 *
 * **Not in every row.** Repeating it per person would be the same paragraph two hundred times
 * in a column that is already narrow at 320px. Once, before the table, is where somebody reads
 * it — and it is read from `identity.role_permissions` rather than written here, so a role
 * whose meaning changes cannot leave a stale description behind on this page.
 */
function roleLegend(grantable: GrantableRole[]): Html {
  return html`<details class="admin-details">
    <summary>What these roles allow</summary>
    <dl>
      ${grantable.map(
        (role) =>
          html`<dt class="admin-mono">${role.slug}</dt>
            <dd>
              ${role.description}
              ${
                role.permissions.length === 0
                  ? html`<em>Grants nothing on its own.</em>`
                  : html`<span class="admin-mono">${role.permissions.join(', ')}</span>`
              }
            </dd>`,
      )}
    </dl>
  </details>`;
}

function asText(form: FormData, field: string): string | null {
  const value = form.get(field);
  return typeof value === 'string' ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}
