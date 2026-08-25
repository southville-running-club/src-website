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

/** The three, as `identity.roles`' own check constraint spells them. */
const ROLES = ['super-admin', 'nn-admin', 'member'] as const;

/**
 * The two a human may hand out here.
 *
 * **`member` is not one of them.** Every account gets it from the signup trigger and it grants
 * nothing on its own, so a control for it would be a button that does nothing on a page whose
 * whole subject is access.
 */
const GRANTABLE = ['nn-admin', 'super-admin'] as const;

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
    role === null ||
    !(ROLES as readonly string[]).includes(role)
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
  const { data, error: readError } = await asPerson.rpc('list_people');

  if (readError) {
    console.error(
      `identity.list_people unavailable — ${readError.code}: ${readError.message}`,
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

  const people = answer.people ?? [];
  const token = mintCsrfToken();

  return page('People and roles', peopleBody(viewer, people, token, error), {
    cookies: [csrfCookie(token, secure)],
  });
}

function peopleBody(
  viewer: AdminViewer,
  people: Person[],
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
                  ${people.map((person) => personRow(person, viewer, token))}
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
function personRow(person: Person, viewer: AdminViewer, token: string): Html {
  return html`<tr>
    <th scope="row">
      ${person.name === null ? null : html`<span>${person.name}</span> `}
      <span class="admin-mono">${person.email}</span>
      ${person.id === viewer.id ? html`<span class="admin-chip">you</span>` : null}
    </th>
    <td>${person.roles.length === 0 ? 'none' : person.roles.join(', ')}</td>
    <td>${GRANTABLE.map((role) => roleControl(person, role, token))}</td>
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
function roleControl(person: Person, role: string, token: string): Html {
  const held = person.roles.includes(role);
  const action = held ? 'revoke' : 'grant';

  return html`<form method="post" action="/admin/people/" class="admin-inline-form">
    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
    <input type="hidden" name="action" value="${action}" />
    <input type="hidden" name="person" value="${person.id}" />
    <input type="hidden" name="role" value="${role}" />
    <button type="submit" class="admin-button">
      ${held ? 'Revoke' : 'Grant'} ${role}
      <span class="admin-visually-hidden">for ${person.email}</span>
    </button>
  </form>`;
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
