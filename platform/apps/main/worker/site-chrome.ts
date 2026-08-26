import { CLUB_LOGO, SITE_BANNER, SITE_NAV } from '@src/shared/brand';
import { SOCIAL_ICON_VIEWBOX, SOCIAL_LINKS } from '@src/shared/social';
import { html, raw, type Html } from './html';

/**
 * The club's banner and footer, for the pages the **Worker** renders.
 *
 * **This is a third copy of markup that already exists twice, and that is the established
 * shape here rather than a shortcut.** `src/components/SiteBanner.astro` is the Astro one and
 * `apps/timing/app/site-banner.tsx` is the Next one; its own header explains why:
 *
 * > The two apps are different frameworks and cannot share a component, so they share the
 * > thing that matters instead: every word below comes from `SITE_BANNER`.
 *
 * The Worker is a *third* framework — no framework at all, an auto-escaping template literal —
 * so it gets a third rendering of the same constants. **The tags are duplicated; the copy and
 * the geometry cannot drift**, because both come from `@src/shared` and a test asserts every
 * front door says the same sentence.
 *
 * ## Which surface gets what, and why they differ
 *
 * **`/account/` gets all of it. `/admin/` gets only the icon.** The back office is not missing
 * branding and never was: `admin-shell.ts` draws its own `admin-mast` with the same wordmark,
 * its own navigation and its own way out. Putting this banner above that would be a second
 * header and a second copy of the lockup on one page. What it lacked was a tab icon, which is
 * `faviconLink()` and nothing else.
 *
 * ## Why `/account/` had no chrome until now
 *
 * Not an oversight about branding, and worth stating because the obvious guess is wrong:
 * **`base.css` has carried `.site-banner` and `.site-footer` all along, and `account.css`
 * already concatenates it.** The styles were being served to these pages the whole time. What
 * was missing was the markup to hang them on and, in the `<head>`, the icon link — because
 * `Base.astro` is an Astro layout and a Worker cannot reach it. Three rendering paths, two
 * layouts.
 */

/** The width the Astro banner renders the wordmark at, so all three front doors match. */
const LOGO_WIDTH = 132;

const [, , VIEWBOX_WIDTH, VIEWBOX_HEIGHT] = CLUB_LOGO.viewBox.split(' ').map(Number);
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * VIEWBOX_HEIGHT!) / VIEWBOX_WIDTH!);

/**
 * The wordmark, inline.
 *
 * **Inline rather than `<img src="/logo.svg">`, for the reason `ClubLogo.astro` gives at
 * length**: an SVG referenced by `<img>` is a separate document, so `currentColor` inside it
 * resolves against nothing and falls back to black. Inline, the paths inherit from CSS, which
 * is what lets one piece of artwork be club green here and bone on the campaign hero.
 *
 * `aria-hidden`, because the only thing that renders it is a link whose `aria-label` already
 * says the club's name — announcing it twice in a row helps nobody.
 */
function clubLogo(): Html {
  return html`<svg
    class="site-logo"
    viewBox="${CLUB_LOGO.viewBox}"
    width="${String(LOGO_WIDTH)}"
    height="${String(LOGO_HEIGHT)}"
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    ${CLUB_LOGO.paths.map(
      (p) =>
        html`<path
          d="${p.d}"
          transform="${p.transform}"
          fill="currentColor"
          fill-rule="nonzero"
        />`,
    )}
  </svg>`;
}

/**
 * The bar that says which site this is.
 *
 * **A `div` rather than a `header`, matching the Astro component exactly**, and for the reason
 * it documents: a `<header>` outside `main` maps to the `banner` landmark, and these pages may
 * one day carry a masthead of their own. One `banner` per page or a screen reader offers the
 * same landmark twice with no way to tell them apart.
 *
 * **The mark links home, and on the account pages that matters more than anywhere else.** Until
 * now `/account/` had no route back to the club site at all — no logo, no link, no breadcrumb.
 * Somebody who signed in and then wanted the race page had to edit the address bar. `/admin/`
 * never had that problem: its own masthead links to the dashboard and carries "My account".
 */
export function siteBanner(): Html {
  return html`<div class="site-banner">
    <div class="site-banner-inner">
      <a class="site-banner-mark" href="/" aria-label="Southville Running Club, home">
        ${clubLogo()}
      </a>

      <p>
        <strong>${SITE_BANNER.welcome}</strong>
        <span
          >${SITE_BANNER.scope}<a href="${SITE_BANNER.clubWebsite}"
            >${SITE_BANNER.scopeLinkLabel}</a
          >${SITE_BANNER.scopeEnd}</span
        >
      </p>
    </div>
  </div>`;
}

/**
 * The social row and the privacy link.
 *
 * **On `/account/` and deliberately not on `/admin/`.** The account area is part of the
 * website a member reads, and the privacy link belongs at the foot of it. The back office is a
 * *tool* — `CLAUDE.md` says so in as many words — and a row of social icons under a table of
 * entries is furniture nobody working there wants.
 */
export function siteFooter(): Html {
  return html`<footer class="site-footer">
    <p class="site-footer-heading">Follow the club</p>
    <ul class="site-footer-social">
      ${SOCIAL_LINKS.map(
        (link) =>
          html`<li>
            <a href="${link.href}" aria-label="${link.name}">
              <svg
                viewBox="${SOCIAL_ICON_VIEWBOX}"
                width="24"
                height="24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="${link.d}" fill="currentColor" />
              </svg>
            </a>
          </li>`,
      )}
    </ul>
    <p class="site-footer-legal"><a href="/privacy/">Privacy notice</a></p>
  </footer>`;
}

/**
 * The bar that gets you between the parts of this site.
 *
 * **`src/components/SiteNav.astro` is this function's opposite number**, and the split is the
 * same one the banner has: one is Astro, one is a template literal in a Worker, so they share
 * `SITE_NAV` rather than a component. The tags are duplicated; the links and the labels cannot
 * drift.
 *
 * **On `/account/*` and nowhere else the Worker renders.** `/admin/` has its own bar, painted
 * per request from `identity.my_roles()` so nobody is offered a section that would 404 at them
 * — putting the club's bar beside it would be two navigations on one page, and the club's one
 * would be the one that does not know who is signed in.
 *
 * `aria-current="page"` on the section being read, so somebody using a screen reader is told
 * where they are rather than only shown.
 */
export function siteNav(pathname: string): Html {
  return html`<nav class="site-nav" aria-label="Southville Running Club">
    <ul>
      ${SITE_NAV.map(
        ({ href, label, match }) =>
          html`<li>
            <a href="${href}" ${match.test(pathname) ? raw('aria-current="page"') : ''}>
              ${label}
            </a>
          </li>`,
      )}
    </ul>
  </nav>`;
}

/**
 * The `<link>` that gives these pages a tab icon.
 *
 * **`/favicon.svg`, the same file both other front doors use** — served from
 * `apps/main/public/` by this very Worker's assets binding. `apps/timing`'s layout carries the
 * identical link with a comment saying that without it "`/timing` showed a browser's blank
 * page glyph beside every other tab". The reasoning was never applied here, so `/account/` has
 * been showing that same blank glyph since it was built. That is the whole of the favicon half
 * of this change.
 */
export function faviconLink(): Html {
  return html`<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`;
}
