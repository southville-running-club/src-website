import { createUserClient, type SupabaseConfig } from '@src/shared';
import { html } from './html';
import {
  isStaff,
  masthead,
  notFound,
  page,
  withRefreshedCookies,
  type AdminViewer,
} from './admin-shell';
import { handleNnSection } from './nn-admin';
import { handlePeopleSection } from './admin-people';
import { readSession } from './session';
import { adminSegments } from './routing';

/**
 * `/admin/` — the club's back office.
 *
 * ## What this file is, and what it is not
 *
 * It is the door and the dispatcher: it works out who is asking, whether they may be here at
 * all, and which section answers. **Every page under this prefix is rendered somewhere else** —
 * `nn-admin.ts` for Nightingale Nightmare, `admin-people.ts` for roles, `admin-shell.ts` for the
 * frame all of them sit in.
 *
 * ## 404 rather than 403, at every address, and it is a decision
 *
 * A plain member — which is everybody with an account — gets the ordinary not-found page. So
 * does somebody signed out, and so does an address under this prefix that nobody built.
 *
 * **A 403 discloses that the address exists**, which tells anybody who can register exactly
 * where the club's entry list lives and that it is worth attacking. This is the answer the
 * whole prefix gave when no admin key was installed, and it is consistent with ADR-013's own
 * reasoning about an unconfigured surface being *"indistinguishable from an absent one"* and
 * with `entries.admin_sign_in()` collapsing three failures into one answer.
 *
 * It costs one thing and the runbook says so: **a volunteer who has been granted `nn-admin` and
 * mistypes the address gets the same blank as an attacker.** That is the trade, taken
 * deliberately — the club's entry list holds two hundred people's emergency contacts.
 *
 * ## What replaced the two keys
 *
 * ADR-013 built this surface behind `ENTRIES_ADMIN_KEY` plus a key per volunteer, and #58
 * retires the Worker's half of that: there is no key here, no `admin-session.ts` cookie, and
 * `/nn/admin/*` is nothing but redirects. **The break-glass changes with it.** Installing the
 * two keys no longer opens anything — the way in is an account holding `nn-admin`, granted at
 * `/admin/people/` by the super-admin the migration bootstraps. #57 left the four key-gated
 * database functions in place and #63 removes them; nothing in the Worker calls them any more.
 *
 * ## Personal data
 *
 * The rules `nn-admin.ts` lists apply to every section here, and two are worth restating
 * because this file is where they are enforced rather than described:
 *
 *   * **No personal data in a URL or a query string, ever.** An entrant id travels in a POST
 *     body; so does the person id a role is granted to.
 *   * **No personal data in any log, including error paths.** Nothing below logs the viewer's
 *     email address or id.
 */

export interface AdminEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

function config(env: AdminEnv): SupabaseConfig {
  return { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY };
}

/**
 * Who is asking, if they may be here at all.
 *
 * **`identity.my_roles()` on every request rather than a claim baked into the token.** A role
 * granted or revoked at `/admin/people/` has to take effect on the next request, which is
 * #59's requirement and is the reason `identity.has_role()` reads `role_grants` rather than
 * the JWT. Doing the same here means the navigation and the door agree with each other and
 * with the database, without a session to invalidate.
 *
 * `null` for every reason there is — no session, a refresh that failed, a person with no staff
 * role — because the caller answers all of them identically.
 */
async function viewerFor(
  cfg: SupabaseConfig,
  session: { userId: string; accessToken: string },
): Promise<AdminViewer | null> {
  const asPerson = createUserClient(cfg, session.accessToken);

  const [{ data: roleData, error: roleError }, { data: user }] = await Promise.all([
    asPerson.rpc('my_roles'),
    asPerson.auth.getUser(),
  ]);

  if (roleError) {
    // A code and a message, never a row — the property the whole surface depends on.
    console.error(
      `identity.my_roles unavailable — ${roleError.code}: ${roleError.message}`,
    );
    return null;
  }

  const roles = Array.isArray(roleData) ? (roleData as string[]) : [];

  if (!isStaff(roles)) {
    return null;
  }

  return {
    id: session.userId,
    // The address they are signed in as. `getUser()` asks Supabase Auth, which is where the
    // confirmed address actually lives — `identity.people` deliberately does not hold one.
    label: user?.user?.email ?? 'your account',
    roles,
    accessToken: session.accessToken,
  };
}

/**
 * Handle one request under `/admin/`.
 *
 * **Every path out returns through one place**, so a refreshed session cannot be dropped by
 * whichever branch happens to answer. `readSession()` rotates the refresh token the moment the
 * access token is within a minute of expiry — the old cookie is spent whether or not this
 * particular request turns out to be for somebody staff, so a signed-out response and a 404
 * for a plain member need the new pair exactly as much as a real page does. See
 * `withRefreshedCookies`'s own comment for what silently discarding it costs.
 */
export async function handleAdmin(
  request: Request,
  env: AdminEnv,
  url: URL,
): Promise<Response> {
  const secure = url.protocol === 'https:';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cfg = config(env);

  const { session, setCookies: refreshedCookies } = await readSession(
    cfg,
    request.headers.get('cookie'),
    nowSeconds,
    secure,
  );

  if (session === null) {
    return withRefreshedCookies(notFound(), refreshedCookies);
  }

  const viewer = await viewerFor(cfg, session);

  if (viewer === null) {
    return withRefreshedCookies(notFound(), refreshedCookies);
  }

  const path = adminSegments(url.pathname);
  let response: Response;

  if (request.method === 'GET' && path.length === 0) {
    response = dashboard(viewer);
  } else if (path[0] === 'nn') {
    // **The role is checked here, before the section runs.** Each section then trusts its
    // viewer — `nn-admin.ts` has no credential check in it at all — which is the same
    // ordering discipline `entries.admin_key_ok()` established and `identity.has_role()`
    // continues: refuse before anything is resolved and before a row is read.
    response = viewer.roles.includes('nn-admin')
      ? await handleNnSection(request, viewer, cfg, path.slice(1), url)
      : notFound();
  } else if (path[0] === 'people') {
    response = viewer.roles.includes('super-admin')
      ? await handlePeopleSection(request, viewer, cfg, path.slice(1), secure)
      : notFound();
  } else {
    response = notFound();
  }

  return withRefreshedCookies(response, refreshedCookies);
}

/**
 * The dashboard.
 *
 * **Deliberately thin.** It is a way in and a statement of what somebody may open, not a
 * summary — a figure here would be a second place the club's numbers are stated and the first
 * one to go stale. The race's own figures are on `/admin/nn/`, computed by the database in the
 * same query that lists the entries, which is what stops two panels disagreeing.
 */
function dashboard(viewer: AdminViewer): Response {
  const body = html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Club admin</h1>
      <p>
        ${
          viewer.roles.includes('nn-admin')
            ? html`<a href="/admin/nn/">Nightingale Nightmare</a> — the entries, the
                interest list, the medical notes and the exports.`
            : null
        }
      </p>
      <p>
        ${
          viewer.roles.includes('super-admin')
            ? html`<a href="/admin/people/">People and roles</a> — who may open what.`
            : null
        }
      </p>
    </main>`;

  return page('Club admin', body);
}
