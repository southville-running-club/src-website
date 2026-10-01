import { CLUB_LOGO } from '@src/shared/brand';
import { parseClub, type Club } from '@src/shared/club-content';
import {
  CLUB_BANNER,
  CLUB_CTA,
  CLUB_HOME,
  CLUB_NAV,
  activeClubNavItem,
} from '@src/shared/club-nav';
import { SOCIAL_ICON_VIEWBOX, SOCIAL_LINKS } from '@src/shared/social';
import club from '../src/content/club.json';
import { html, raw, type Html } from './html';

/**
 * The club website's header and footer, for the pages this Worker builds as strings —
 * `/account/**` and `/admin/**`. ADR-052.
 *
 * ## ⚠️ This is the second copy of the markup, and the items are not copied at all
 *
 * `src/components/club/ClubHeader.astro`, `ClubMenu.astro` and `ClubFooter.astro` are this
 * file's opposite numbers. One is Astro and one is a template literal in a Worker, so they
 * share **data** rather than a component — the same split `site-chrome.ts` has with
 * `SiteNav.astro`. The tags are duplicated; the labels, the hrefs, their order, the call to
 * action, the banner sentence and which item is current all come from
 * `packages/shared/src/club-nav.ts` and cannot drift. `club-chrome.spec.ts` compares the two
 * renderings in a browser, which is what catches the tags drifting.
 *
 * **Change the markup in one, change it in the other.** The class names are what
 * `club-chrome.css` styles, so a class that exists in only one copy is a header that looks
 * right on half the site.
 *
 * ## Styled by `club-chrome.css`, never by `club.css`
 *
 * The pages around this are styled by `base.css`, and `club.css` restyles bare `body`, `h1`,
 * `p`, `a` and `main` — so `/account.css` and `/admin.css` append the chrome file and only
 * that. Every rule in it is scoped to a `.club-*` class.
 */

/** The widths the Astro components render the two wordmarks at, so the pages match. */
const HEADER_LOGO_WIDTH = 132;
const FOOTER_LOGO_WIDTH = 150;

const [, , VIEWBOX_WIDTH, VIEWBOX_HEIGHT] = CLUB_LOGO.viewBox.split(' ').map(Number);

/**
 * The wordmark. `labelled` says whether it carries its own accessible name: not in the header,
 * where the link around it already says "Southville Running Club, home", and yes in the
 * footer, where nothing else names it. `ClubLogo.astro`'s rule, unchanged.
 */
function clubLogo(className: string, width: number, labelled: boolean): Html {
  const height = Math.round((width * VIEWBOX_HEIGHT!) / VIEWBOX_WIDTH!);

  return html`<svg
    class="${className}"
    viewBox="${CLUB_LOGO.viewBox}"
    width="${String(width)}"
    height="${String(height)}"
    ${labelled ? html`role="img" aria-label="${CLUB_LOGO.title}"` : raw('aria-hidden="true"')}
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

function current(isCurrent: boolean): Html | '' {
  return isCurrent ? raw('aria-current="page"') : '';
}

/** The way past the header. It lands on `<main id="main">`, which every page here carries. */
export function clubSkipLink(): Html {
  return html`<a class="club-skip" href="#main">Skip to content</a>`;
}

/**
 * The header: the notice about the old site, the wordmark, the bar, the call to action and the
 * phone Menu. One `<header>`, and it is the page's `banner` landmark — so nothing else on a page
 * that renders this may be a `<header>` outside `<main>`, which is why `/admin/`'s masthead is a
 * `<div>` since ADR-052.
 *
 * The Menu is a `<details>`, so it opens with scripting off; `ClubMenu.astro` says why it is a
 * styled `<summary>` and not a `<button>`.
 */
export function clubHeader(pathname: string): Html {
  const active = activeClubNavItem(pathname);
  const links = CLUB_NAV.map(
    (item) =>
      html`<li><a href="${item.href}" ${current(item === active)}>${item.label}</a></li>`,
  );

  // ⚠️ The banner sentence is written wall to wall, for the reason `CLUB_BANNER` gives: the
  // join between `lead`, the link and `tail` carries its own spacing, and Prettier reflowing
  // it across lines would put a newline where a space belongs.
  return html`<header class="club-header">
    <div class="club-banner">
      <div class="club-wrap">
        <p>
          <strong>${CLUB_BANNER.welcome}</strong>
          <span
            >${CLUB_BANNER.lead}<a href="${CLUB_BANNER.clubWebsite}"
              >${CLUB_BANNER.linkLabel}</a
            >${CLUB_BANNER.tail}</span
          >
        </p>
      </div>
    </div>

    <div class="club-wrap club-header-inner">
      <a
        class="club-mark"
        href="${CLUB_HOME.href}"
        aria-label="${CLUB_HOME.label}"
        ${current(CLUB_HOME.match.test(pathname))}
      >
        ${clubLogo('club-logo', HEADER_LOGO_WIDTH, false)}
      </a>

      <nav class="club-nav" aria-label="Southville Running Club">
        <ul>
          ${links}
        </ul>
      </nav>

      <a class="club-btn club-btn-primary club-cta" href="${CLUB_CTA.href}"
        >${CLUB_CTA.label}</a
      >

      <details class="club-menu">
        <summary class="club-btn club-btn-secondary">Menu</summary>

        <nav aria-label="Southville Running Club, menu">
          <ul>
            ${links}
          </ul>

          <a class="club-btn club-btn-primary" href="${CLUB_CTA.href}"
            >${CLUB_CTA.label}</a
          >
        </nav>
      </details>
    </div>
  </header>`;
}

/**
 * `club.json`, parsed on first use rather than at module load. The Astro build parses the same
 * file through the same schema, so a malformed one fails the build before it can be deployed;
 * parsing lazily here means that if it somehow did not, only a page carrying this footer would
 * fail — never the Worker's module load, which every path on the site shares, the payment paths
 * included.
 */
let parsedClub: Club | undefined;

function clubContent(): Club {
  parsedClub ??= parseClub(club);
  return parsedClub;
}

/** The footer: the wordmark, where the club meets, its profiles and the privacy notice. */
export function clubFooter(): Html {
  const { legalName, affiliation, meet } = clubContent();
  // Built the way `ClubFooter.astro` builds them, so the two read identically.
  const where = `${meet.venue}, ${meet.street},`;
  const town = `${meet.city} ${meet.postcode}`;

  return html`<footer class="club-footer">
    <div class="club-wrap club-footer-grid">
      <div>
        ${clubLogo('club-footer-mark', FOOTER_LOGO_WIDTH, true)}
        <p class="club-footer-small">${legalName}<br />${affiliation}</p>
      </div>

      <div>
        <h2>Come and run</h2>
        <p>${meet.days}<br />${meet.time}<br />${where}<br />${town}</p>
        <p><a href="${meet.mapUrl}">Open in maps</a></p>
      </div>

      <div>
        <h2>Follow the club</h2>
        <ul class="club-footer-social">
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

        <p class="club-footer-small"><a href="/privacy/">Privacy notice</a></p>
      </div>
    </div>
  </footer>`;
}

export interface SectionTab {
  href: string;
  label: string;
}

/**
 * The bar under the header that moves between the pages of one section.
 *
 * **Links, not tabs in the ARIA sense.** Each is a page with its own address, so it is a
 * `<nav>` of links with `aria-current="page"` on the one being read, and the browser's own
 * history and middle-click work. A `role="tablist"` would promise arrow-key behaviour that a
 * set of page links does not have.
 *
 * **It scrolls sideways on a phone rather than wrapping**, and the current tab is not scrolled
 * into view: that needs a script, and every page here must work with scripting off. The tabs
 * stay in the same order on every page, because a bar that reorders itself to put the current
 * page first is harder to learn than one that sometimes needs a swipe.
 */
export function sectionBar(
  name: string,
  tabs: readonly SectionTab[],
  currentHref: string,
  /** Further `<li>`s after the tabs — or a slot for them, which `account.ts` fills per person. */
  extra: Html | '' = '',
): Html {
  return html`<nav class="club-section" aria-label="${name}">
    <div class="club-wrap club-section-inner">
      <p class="club-section-name">${name}</p>
      <ul>
        ${tabs.map(
          (tab) =>
            html`<li>
              <a href="${tab.href}" ${current(tab.href === currentHref)}>${tab.label}</a>
            </li>`,
        )}
        ${extra}
      </ul>
    </div>
  </nav>`;
}

export interface Crumb {
  label: string;
  /** Absent on the last crumb, which is the page being read and therefore not a link. */
  href?: string;
}

/**
 * Where this page sits. The first thing inside `<main>`, so it lines up with the page's own
 * column. The last crumb is the current page: `aria-current="page"` and not a link, because a
 * link to the page you are on is a control that does nothing. The chevrons are `aria-hidden`
 * markup rather than CSS `content`, which some screen readers announce, so a screen reader
 * reads a list of places and not the arrows between them.
 */
export function breadcrumbs(trail: readonly Crumb[]): Html {
  const chevron = raw(
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>',
  );

  return html`<nav class="club-crumbs" aria-label="Breadcrumb">
    <ol>
      ${trail.map((crumb, index) => {
        const separator = index === 0 ? '' : chevron;
        return crumb.href === undefined
          ? html`<li>${separator}<span aria-current="page">${crumb.label}</span></li>`
          : html`<li>${separator}<a href="${crumb.href}">${crumb.label}</a></li>`;
      })}
    </ol>
  </nav>`;
}
