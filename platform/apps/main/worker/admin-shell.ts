import { CLUB_LOGO } from '@src/shared/brand';
import { html, type Html } from './html';
import { ADMIN_PREFIX } from './routing';
import { faviconLink } from './site-chrome';

/**
 * The frame every page of the staff backend is drawn in — the document, the masthead, and
 * the navigation.
 *
 * ## Why this is its own module
 *
 * `/nn/admin` was one page about one race, so its shell lived in the file that rendered it.
 * #58 made the club a back office with sections, and the moment there is more than one
 * section the frame stops belonging to any of them. `nn-admin.ts` renders the Nightingale
 * Nightmare section; `admin-people.ts` renders the roles page; neither owns the bar across
 * the top.
 *
 * ## The navigation is painted from what the person may open
 *
 * `identity.my_roles()`, per request, so somebody sees only the sections they can actually
 * reach. That is not decoration: a link to a page that 404s is worse than no link, because
 * it tells somebody the page exists and refuses them — the exact disclosure `/admin/`'s 404
 * rule exists to avoid.
 *
 * **"My account" is shown to everybody with a staff role**, and it is the one entry that
 * leaves this surface. A backend you can get into and not out of is a place people close the
 * tab on.
 *
 * ## This is a different bar from the site's, and deliberately so
 *
 * [ADR-012](../../../docs/architecture/decisions/adr-012-one-navigation-bar.md) and
 * [ADR-014](../../../docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md)
 * settle how a navigation bar behaves on the pages a runner reads: one bar, stuck to the top,
 * with a hand-written `scroll-padding-top` token per breakpoint that has to clear its height
 * at every width. **None of that applies here and this bar does not follow it.**
 *
 * It is not stuck. ADR-014's whole argument for sticking the campaign bar is that a runner
 * scrolls a long page of prose and needs the way out to stay in reach; this surface is a
 * table somebody scans and a form somebody submits, and a fixed bar at 320px would spend a
 * fifth of a phone screen on links nobody is reading. Not sticking it also means there is no
 * inset to keep in step — which is the defect ADR-014 spends three paragraphs on, and the
 * reason a navigation label here is free text where one in the campaign bar is a layout
 * change.
 *
 * ## Style
 *
 * `nn-admin.css`, which carries **not one hex value** — every colour is a `--colour-*` token,
 * asserted along with the contrast of every wash by
 * `packages/shared/tests/unit/admin-contrast.test.ts`. **`nn-theme.css` must never reach
 * this**: a tool, not a page a runner reads, and it will serve Pass the Buck too.
 */

/** What the signed-in person may open. The order is the order they are drawn in. */
export interface AdminSection {
  href: string;
  label: string;
  /**
   * Which **permission** opens it. `null` for the entries every staff role sees.
   *
   * **A permission, not a role, since ADR-017.** The link and the door behind it have to
   * agree, and the door asks `identity.has_permission()`. Naming a role here and a permission
   * there is two answers to one question, and the day they disagree is the day a volunteer
   * clicks a link into a 404.
   */
  permission: string | null;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: `${ADMIN_PREFIX}/`, label: 'Dashboard', permission: null },
  {
    href: `${ADMIN_PREFIX}/nn/`,
    label: 'Nightingale Nightmare',
    permission: 'nn.entry.read',
  },
  {
    href: `${ADMIN_PREFIX}/people/`,
    label: 'People and roles',
    permission: 'identity.role.grant',
  },
];

/**
 * The roles that open the backend at all.
 *
 * **`registered` is not one of them, and that is the whole of the 404 rule.** Everybody with an
 * account holds `registered`; holding it means being signed in and nothing else.
 */
export const STAFF_ROLES = ['nn-admin', 'super-admin'] as const;

/**
 * Whether somebody may be in the backend at all.
 *
 * **Still a role list rather than a permission**, and deliberately. Every other check on this
 * surface moved to a permission in ADR-017, because those answer "may this person do this
 * particular thing". This one answers "is this person staff", which is a question about the
 * shape of the door rather than about what is behind it: `nn-tester` holds a permission and is
 * emphatically not staff, and a `some(permissions.length > 0)` test would let it in.
 *
 * A fourth staff role is a line here and a row in `identity.role_permissions`, which is the
 * same two-place change granting any capability already is.
 */
export function isStaff(roles: string[]): boolean {
  return STAFF_ROLES.some((role) => roles.includes(role));
}

/** Whether the viewer holds one permission. The one thing every gate on this surface asks. */
export function can(viewer: AdminViewer, permission: string): boolean {
  return viewer.permissions.includes(permission);
}

/** Who is signed in, and what they may do. Threaded through every renderer here. */
export interface AdminViewer {
  /** The person's own id. Shown nowhere; it is what the audit trail records, and the reason
   *  it is not rendered is ADR-013's — that column is a pseudonym on purpose. */
  id: string;
  /** How the surface addresses them — their email address, which is what makes a person
   *  recognisable to somebody granting a role. */
  label: string;
  roles: string[];
  /**
   * Every permission those roles carry, read per request from `identity.my_permissions()`.
   *
   * **Per request rather than baked into the token**, for #59's requirement: a role granted or
   * revoked at `/admin/people/` takes effect on the next request, with no session to
   * invalidate. That is why `identity.has_permission()` reads `role_grants` rather than a JWT
   * claim, and doing the same here keeps the navigation, the buttons and the database in
   * agreement.
   */
  permissions: string[];
  /**
   * The access token every read here is made with.
   *
   * **This is the whole of the authorisation, not a convenience.** `identity.has_role()`
   * resolves `auth.uid()` out of this token inside Postgres, so a renderer that built its own
   * client from the anon key alone would be asking as nobody — and the four `entries`
   * functions would refuse it. Carried on the viewer rather than fetched again so there is
   * one place the session is turned into a client per request.
   */
  accessToken: string;
}

/**
 * The masthead: the club lockup, what this is, who is signed in, and the way out.
 *
 * **The email address rather than a role, and that is a change from `/nn/admin`.** That
 * surface showed a handle from `entries.admin_keys` because a handle was the only identity it
 * had and the runbook held the mapping to a human. This one knows who somebody is, and
 * showing them which account they are signed in as is what stops a volunteer granting a role
 * from the wrong one of two accounts. **The audit trail still records `auth.uid()`**, not
 * this — see ADR-013's amendment on why that column stays a pseudonym.
 */
export function masthead(viewer: AdminViewer): Html {
  const open = ADMIN_SECTIONS.filter(
    (section) => section.permission === null || can(viewer, section.permission),
  );

  return html`<header class="admin-mast">
      <a class="admin-mast-mark" href="${ADMIN_PREFIX}/">
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
      <p class="admin-mast-title">Club admin</p>
      <div class="admin-mast-who">
        <span class="admin-mast-role">
          <span class="admin-mast-role-label">Signed in as</span>
          <span class="admin-mono">${viewer.label}</span>
        </span>
        <a class="admin-mast-out" href="/account/">My account</a>
      </div>
    </header>
    <nav class="admin-nav" aria-label="Club admin">
      <ul>
        ${open.map(
          (section) => html`<li><a href="${section.href}">${section.label}</a></li>`,
        )}
      </ul>
    </nav>`;
}

/**
 * The document.
 *
 * `no-store` and `noindex` on every page without exception — each one of them holds
 * somebody's details, and nothing between the Worker and the person reading it may keep a
 * copy. The `x-robots-tag` header **and** the meta element, because the two are read by
 * different things and neither covers the other.
 */
export function page(
  title: string,
  body: Html,
  options: { status?: number; cookies?: string[] } = {},
): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} — Southville Running Club</title>
        ${faviconLink()}
        <link rel="stylesheet" href="/admin.css" />
      </head>
      <body class="admin">
        ${body}
      </body>
    </html>`;

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });

  for (const cookie of options.cookies ?? []) {
    headers.append('set-cookie', cookie);
  }

  return new Response(document.toString(), {
    status: options.status ?? 200,
    headers,
  });
}

/**
 * What this surface says to somebody who may not be here.
 *
 * **404, not 403, and it is a decision rather than laziness.** A 403 discloses that the
 * address exists, which tells anybody with an account exactly where the club's entry list
 * lives and that it is worth attacking. This is the same answer the whole prefix gave when no
 * admin key was installed, and the same reasoning ADR-013 used for an unconfigured surface
 * being *"indistinguishable from an absent one"* and for `entries.admin_sign_in()` collapsing
 * three failures into one answer.
 *
 * It is deliberately **not** the site's own 404 page: that one carries the club navigation and
 * the campaign theme, and this must not link a signed-out stranger into anything.
 */
export function notFound(): Response {
  return page(
    'Not found',
    html`<main class="admin-page" id="main">
      <h1>Not found</h1>
      <p>There is nothing at this address.</p>
    </main>`,
    { status: 404 },
  );
}

/**
 * Carry a refreshed session onto whatever response the surface was already going to send.
 *
 * **Every response under `/admin/` passes through this, once, at the one place a session is
 * read.** `worker/account.ts` threads `refreshedCookies` explicitly through every renderer it
 * has; the sections here are three files deep by the time a response comes back, and adding
 * the same parameter to every one of them would be a second way to carry the same value. A
 * `Response` from `page()` or `notFound()` has ordinary, mutable headers — nothing in this
 * tree constructs one any other way — so appending here is equivalent and touches one call
 * site instead of a dozen.
 *
 * **Why this has to happen even on a 404.** `readSession()` rotates the refresh token the
 * moment the access token is within a minute of expiry, and `refresh_token_reuse_interval` is
 * ten seconds — so the *old* refresh cookie stops working almost immediately whether or not
 * this request turns out to be for somebody who may see the page. Sending the response without
 * the new cookies would leave the browser holding a token the database already treats as
 * spent, and the next request — plausibly one that would otherwise have succeeded — fails
 * exactly as it would after an idle timeout, with nothing on the page explaining why.
 */
export function withRefreshedCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) {
    response.headers.append('set-cookie', cookie);
  }

  return response;
}
