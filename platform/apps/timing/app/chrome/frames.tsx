import type { ReactNode } from 'react';
import {
  appAreas,
  appNav,
  raceNav,
  showsBar,
  timingHref,
  type NavKey,
  type NavTab,
} from '../../lib/chrome';
import {
  readPermissions,
  readRoles,
  readRosteredSlugs,
  readSignedInAs,
} from '../../lib/reads';
import { AppFooter, AppHeader, SkipLink, TimingNav } from './app-shell';
import { AreaBarScroll } from './area-bar-scroll';

export { PlainFrame } from './app-shell';

/**
 * The three frames every page under `/timing` is drawn in. `lib/chrome.ts`'s route table says
 * which, and `tests/unit/chrome.test.ts` holds every page to it. ADR-054.
 *
 * The root layout draws none of this, only the document around it, because the frame a page
 * wears depends on things only the page knows: which race, what it is called, and which tab is
 * current. A page wraps each of its returns in its frame; its own content is untouched.
 *
 * **`.timing-ui` is set here**, on the shell's wrapper. It is the class `app/styles/timing.css`
 * scopes its restatements of the club's bare-element rules under, so it is what puts a page on
 * the club website's type and colours.
 *
 * **Content is held to `.club-wrap-narrow` and `.timing-legacy` until its page is restyled.**
 * The pages inside these frames were laid out for `base.css`'s 40rem column and its text
 * metrics, with `.button-wide` and forms sized to them. The club's 1200px wrap would stretch
 * them, and the club's tighter line height pulled a "Back to…" link to 23px from the button
 * above it on three pages, under axe's 24px target spacing, on CI's Linux fonts. A page
 * restyled in a later slice passes `wide` and leaves both behind.
 */

/** What every app-shell page shares: the header, the nav if there is one, and the footer. */
async function AppShell({
  nav,
  wide = false,
  tool = false,
  light = false,
  brand = false,
  children,
}: {
  nav: ReactNode;
  wide?: boolean;
  /**
   * The capture screen, as Pass the Buck draws it (ADR-055): **no app header and no footer**,
   * the nav at the very top, and the screen below it taking what is left of a column exactly
   * the height of the viewport, so only the queue scrolls. The screen draws its own status bar
   * and its own full-width bands, so `<main>` carries no wrap.
   */
  tool?: boolean;
  /**
   * Light under a phone set to dark (D5, 4 October 2026): the race-control and capture screens
   * are used outdoors in daylight. The capture screen is always light.
   */
  light?: boolean;
  /**
   * Pass the Buck's brand pages — the Home hub and Start (ADR-055): the area below the nav is
   * club green from edge to edge, with ink on it (`--club-on-brand`, 5.07:1). `<main>` carries no
   * wrap, so the page wraps its own content and the green reaches both edges.
   */
  brand?: boolean;
  children: ReactNode;
}) {
  const [permissions, roles, signedInAs] = await Promise.all([
    readPermissions(),
    readRoles(),
    readSignedInAs(),
  ]);

  return (
    <div
      className={[
        'timing-ui',
        tool || light ? 'timing-force-light' : '',
        tool ? 'timing-tool-page' : '',
        brand ? 'timing-brand-page' : '',
      ]
        .filter((name) => name !== '')
        .join(' ')}
    >
      <SkipLink />
      {tool ? null : (
        <AppHeader
          areas={appAreas(permissions, roles)}
          current="timing"
          signedInAs={signedInAs}
        />
      )}
      {nav}
      <main
        id="main"
        className={
          tool
            ? 'timing-tool'
            : brand
              ? 'timing-brand-main'
              : wide
                ? 'club-wrap timing-main'
                : 'club-wrap club-wrap-narrow timing-main timing-legacy'
        }
      >
        {children}
      </main>
      {tool ? null : <AppFooter />}
    </div>
  );
}

/** The nav, or nothing when it would hold one tab. */
function navOrNothing(tabs: readonly NavTab[], current: NavKey | null): ReactNode {
  if (!showsBar(tabs)) return null;
  return (
    <>
      <TimingNav
        tabs={tabs.map((tab) => ({
          href: timingHref(tab.path),
          label: tab.label,
          current: tab.key === current,
        }))}
      />
      <AreaBarScroll />
    </>
  );
}

/** The landing page and the races list: the app header, and the app-level nav. */
export async function TimingFrame({
  current,
  wide,
  brand,
  children,
}: {
  current: 'home' | 'races';
  wide?: boolean;
  /** The Home hub. See {@link AppShell}. */
  brand?: boolean;
  children: ReactNode;
}) {
  const permissions = await readPermissions();

  return (
    <AppShell nav={navOrNothing(appNav(permissions), current)} wide={wide} brand={brand}>
      {children}
    </AppShell>
  );
}

/**
 * One race's pages: the app header, and that race's nav with `current` marked — ADR-055.
 *
 * `name` is the race's name as the page read it, or `null` when the page could not read one —
 * the database unavailable. A race that does not exist (or that the reader may not see, which
 * the reads deliberately do not tell apart) is not this frame's business: the page renders
 * `PlainFrame` around `NotFoundBody`, so the body is the not-found page's exactly (ADR-044).
 *
 * `current` is the tab this page is; `null` for a page that is no tab of its own.
 */
export async function RaceFrame({
  slug,
  current,
  wide,
  tool,
  light,
  brand,
  children,
}: {
  slug: string;
  /** Kept so callers need not change: the race's name is the page's eyebrow, not the nav's. */
  name?: string | null;
  current: NavKey | null;
  /** Kept so callers need not change; the breadcrumbs that used it are gone (ADR-054). */
  page?: string;
  wide?: boolean;
  /** The capture screen. See {@link AppShell}. */
  tool?: boolean;
  /** Light under a phone set to dark — the Start page. See {@link AppShell}. */
  light?: boolean;
  /** The Home hub and Start. See {@link AppShell}. */
  brand?: boolean;
  children: ReactNode;
}) {
  const [permissions, rosteredSlugs] = await Promise.all([
    readPermissions(),
    readRosteredSlugs(),
  ]);
  const tabs = raceNav(permissions, slug, rosteredSlugs.includes(slug));

  return (
    <AppShell
      nav={navOrNothing(tabs, current)}
      wide={wide}
      tool={tool}
      light={light}
      brand={brand}
    >
      {children}
    </AppShell>
  );
}
