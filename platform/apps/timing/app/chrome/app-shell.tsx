import type { ReactNode } from 'react';
import { BASE_PATH, type Area, type AreaKey } from '../../lib/chrome';
import { ClubLogo } from '../club-logo';

/**
 * The signed-in app shell's read-free parts: the header, the area bar, the footer, and
 * `PlainFrame`. ADR-054, which superseded ADR-053 §1.
 *
 * **Everything here renders from props alone.** `app/global-error.tsx` is a client component
 * and cannot import the session reads in `lib/reads.ts`; and the not-found page must stay
 * prerendered, because every refusal at the door is rewritten to it (ADR-044). The frames that
 * read live in `frames.tsx` and pass what they read in.
 *
 * **Self-contained, to travel.** The classes are `.app-*`, painted only with `--club-*` tokens
 * in `app/styles/timing.css`, so `/account/*` and `/admin/*` can adopt the same shell after the
 * race (ADR-054 §6).
 *
 * **Every club link is a plain `<a>`**, as ADR-053 found: Next's `<Link>` would prefix it with
 * the `/timing` base path.
 */

export function SkipLink() {
  return (
    <a className="club-skip" href="#main">
      Skip to content
    </a>
  );
}

/** The club's mark, linking to the public home page. Its own name, so it reads once. */
function HomeMark() {
  return (
    <a className="club-mark" href="/" aria-label="Southville Running Club, club website">
      <ClubLogo className="club-logo" width={132} labelled={false} />
    </a>
  );
}

/**
 * The header of every signed-in page: the mark, the areas this person may use, and who they
 * are signed in as.
 *
 * - **Areas** come from `appAreas()` in `lib/chrome.ts`. The current one carries
 *   `aria-current="page"` and the club's 3px underline.
 * - **"Signed in as"** is plain text (HALT 2). Signing out is a POST with a token only the main
 *   site issues, so the real Sign out is on Your account, which is already in the header. A
 *   link labelled "Sign out" that only led to another page would promise what it does not do.
 * - **On a phone** the areas fold into a `<details>` Menu, which opens with scripting off, and
 *   the current area is named beside the mark. Somebody with one area gets no Menu: there is
 *   nothing to switch to.
 */
export function AppHeader({
  areas,
  current,
  signedInAs,
}: {
  areas: readonly Area[];
  current: AreaKey;
  signedInAs: string | null;
}) {
  const links = areas.map((area) => (
    <li key={area.key}>
      <a href={area.href} aria-current={area.key === current ? 'page' : undefined}>
        {area.label}
      </a>
    </li>
  ));
  const currentArea = areas.find((area) => area.key === current);
  const who =
    signedInAs === null ? null : (
      <>
        Signed in as <strong>{signedInAs}</strong>
      </>
    );

  return (
    <header className="app-header" data-areas={areas.length}>
      <div className="club-wrap app-header-inner">
        <HomeMark />
        {currentArea === undefined ? null : (
          <p className="app-area-name">{currentArea.label}</p>
        )}
        <nav className="app-areas" aria-label="Areas">
          <ul>{links}</ul>
        </nav>
        {who === null ? null : <p className="app-user">{who}</p>}
        {areas.length > 1 ? (
          <details className="club-menu app-menu">
            <summary className="club-btn club-btn-secondary">Menu</summary>
            <nav aria-label="Areas, menu">
              <ul>{links}</ul>
              {who === null ? null : <p className="app-menu-user">{who}</p>}
            </nav>
          </details>
        ) : null}
      </div>
    </header>
  );
}

export interface AreaTab {
  href: string;
  label: string;
  current: boolean;
}

/**
 * The bar under the header: the pages of the current area that this person may open.
 *
 * Its name links back to the races list's landing page, `/timing`. A race's long name is
 * shortened on a phone (`shortName`), so the bar's tabs, not its title, get the width; the
 * long form is `display: none` there, which also takes it out of the accessibility tree, so
 * the link is always named by what is on screen. On a phone the bar scrolls sideways with an
 * edge fade, and the current tab is the one that matters, so it is scrolled into view by
 * `area-bar-scroll.tsx`, a few lines of script that change nothing when scripting is off.
 */
export function AreaBar({
  name,
  shortName,
  tabs,
}: {
  name: string;
  shortName?: string;
  tabs: readonly AreaTab[];
}) {
  return (
    <nav className="club-section app-area-bar" aria-label={name}>
      <div className="club-wrap club-section-inner">
        <p className="club-section-name">
          <a href={BASE_PATH}>
            {shortName === undefined || shortName === name ? (
              name
            ) : (
              <>
                <span className="timing-wide">{name}</span>
                <span className="timing-narrow">{shortName}</span>
              </>
            )}
          </a>
        </p>
        <ul>
          {tabs.map((tab) => (
            <li key={tab.href}>
              <a href={tab.href} aria-current={tab.current ? 'page' : undefined}>
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** Two links, not the club website's footer: this is a tool, and the public site is one away. */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="club-wrap">
        <ul>
          <li>
            <a href="/privacy/">Privacy notice</a>
          </li>
          <li>
            <a href="/">Club website</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}

/**
 * The shell around a page that cannot know who is reading it: the not-found page and the error
 * page. **No reads**: the not-found page is prerendered and is what every refusal at the door is
 * rewritten to (ADR-044), so it must not need a session — and must not say anything a signed-out
 * visitor should not learn. So it names no area and offers no areas: the mark, the page, the
 * footer.
 */
export function PlainFrame({ children }: { children: ReactNode }) {
  return (
    <div className="timing-ui">
      <SkipLink />
      <header className="app-header">
        <div className="club-wrap app-header-inner">
          <HomeMark />
        </div>
      </header>
      <main id="main" className="club-wrap club-wrap-narrow timing-main">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
