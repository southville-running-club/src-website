import {
  CLUB_BANNER,
  CLUB_CTA,
  CLUB_HOME,
  CLUB_NAV,
  activeClubNavItem,
} from '@src/shared/club-nav';
import { parseClub } from '@src/shared/club-content';
import club from '@src/shared/content/club.json';
import { SOCIAL_ICON_VIEWBOX, SOCIAL_LINKS } from '@src/shared/social';
import { ClubLogo } from '../club-logo';

/**
 * The club website's header, phone Menu and footer, for `/timing`. ADR-052.
 *
 * ## ⚠️ The third copy of this markup, and the items are not copied at all
 *
 * `apps/main/src/components/club/ClubHeader.astro` is the original and
 * `apps/main/worker/club-chrome.ts` the second, for `/account/` and `/admin/`. This app is a
 * different framework again, so it gets a third rendering of the same **data**: the labels,
 * hrefs, order, call to action, banner sentence and current item all come from
 * `@src/shared/club-nav`, and `timing.spec.ts` compares this header with the Astro one in a
 * browser. Change the markup in one, change it in all three — the class names are what
 * `club-chrome.css` styles.
 *
 * ## ⚠️ Plain `<a>`, never `<Link>`
 *
 * Every link here leaves this app — `/run-with-us/`, `/events/`, `/account/` are `apps/main`'s
 * pages on the same hostname — and Next prefixes a `<Link>`'s href with the base path, so a
 * `<Link href="/run-with-us/">` would go to `/timing/run-with-us/` and 404.
 *
 * ## The current item
 *
 * Every page here is under `/timing`, which `activeClubNavItem()` places in "Races and events"
 * with the same boundary `isTimingPath()` routes by. Asked rather than hard-coded, so the one
 * function that answers it for the other two copies answers it here too.
 */

const TIMING_PATH = '/timing';

export function ClubSkipLink() {
  return (
    <a className="club-skip" href="#main">
      Skip to content
    </a>
  );
}

export function ClubHeader() {
  const active = activeClubNavItem(TIMING_PATH);
  const links = CLUB_NAV.map((item) => (
    <li key={item.href}>
      <a href={item.href} aria-current={item === active ? 'page' : undefined}>
        {item.label}
      </a>
    </li>
  ));

  return (
    <header className="club-header">
      <div className="club-banner">
        <div className="club-wrap">
          <p>
            <strong>{CLUB_BANNER.welcome}</strong>
            {/* JSX drops the newlines between these three, and `lead` carries its own trailing
                space and `tail` its own leading one — `CLUB_BANNER`'s rule. */}
            <span>
              {CLUB_BANNER.lead}
              <a href={CLUB_BANNER.clubWebsite}>{CLUB_BANNER.linkLabel}</a>
              {CLUB_BANNER.tail}
            </span>
          </p>
        </div>
      </div>

      <div className="club-wrap club-header-inner">
        <a className="club-mark" href={CLUB_HOME.href} aria-label={CLUB_HOME.label}>
          <ClubLogo className="club-logo" width={132} labelled={false} />
        </a>

        <nav className="club-nav" aria-label="Southville Running Club">
          <ul>{links}</ul>
        </nav>

        <a className="club-btn club-btn-primary club-cta" href={CLUB_CTA.href}>
          {CLUB_CTA.label}
        </a>

        {/* A `<details>`, so it opens with scripting off — `ClubMenu.astro` says why it is a
            styled `<summary>` rather than a `<button>`. */}
        <details className="club-menu">
          <summary className="club-btn club-btn-secondary">Menu</summary>
          <nav aria-label="Southville Running Club, menu">
            <ul>{links}</ul>
            <a className="club-btn club-btn-primary" href={CLUB_CTA.href}>
              {CLUB_CTA.label}
            </a>
          </nav>
        </details>
      </div>
    </header>
  );
}

const { legalName, affiliation, meet } = parseClub(club);

export function ClubFooter() {
  return (
    <footer className="club-footer">
      <div className="club-wrap club-footer-grid">
        <div>
          <ClubLogo className="club-footer-mark" width={150} />
          <p className="club-footer-small">
            {legalName}
            <br />
            {affiliation}
          </p>
        </div>

        <div>
          <h2>Come and run</h2>
          <p>
            {meet.days}
            <br />
            {meet.time}
            <br />
            {`${meet.venue}, ${meet.street},`}
            <br />
            {`${meet.city} ${meet.postcode}`}
          </p>
          <p>
            <a href={meet.mapUrl}>Open in maps</a>
          </p>
        </div>

        <div>
          <h2>Follow the club</h2>
          <ul className="club-footer-social">
            {SOCIAL_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} aria-label={link.name}>
                  <svg
                    viewBox={SOCIAL_ICON_VIEWBOX}
                    width="24"
                    height="24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d={link.d} fill="currentColor" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
          <p className="club-footer-small">
            <a href="/privacy/">Privacy notice</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
