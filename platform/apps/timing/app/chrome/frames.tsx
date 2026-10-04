import type { ReactNode } from 'react';
import {
  RACE_TABS,
  TIMING_TABS,
  appAreas,
  openableTabs,
  showsBar,
  timingHref,
  type RaceTab,
} from '../../lib/chrome';
import { canOpen } from '../../lib/access';
import { readPermissions, readRoles, readSignedInAs } from '../../lib/reads';
import { AppFooter, AppHeader, AreaBar, SkipLink, type AreaTab } from './app-shell';
import { AreaBarScroll } from './area-bar-scroll';

export { PlainFrame } from './app-shell';

/**
 * The four frames every page under `/timing` is drawn in. `lib/chrome.ts`'s route table says
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

/** What every app-shell page shares: the header, the bar if there is one, and the footer. */
async function AppShell({
  bar,
  wide = false,
  children,
}: {
  bar: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const [permissions, roles, signedInAs] = await Promise.all([
    readPermissions(),
    readRoles(),
    readSignedInAs(),
  ]);

  return (
    <div className="timing-ui">
      <SkipLink />
      <AppHeader
        areas={appAreas(permissions, roles)}
        current="timing"
        signedInAs={signedInAs}
      />
      {bar}
      <main
        id="main"
        className={
          wide
            ? 'club-wrap timing-main'
            : 'club-wrap club-wrap-narrow timing-main timing-legacy'
        }
      >
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

function barOrNothing(name: string, tabs: AreaTab[], shortName?: string): ReactNode {
  if (!showsBar(tabs)) return null;
  return (
    <>
      <AreaBar name={name} shortName={shortName} tabs={tabs} />
      <AreaBarScroll />
    </>
  );
}

/** The landing page and the races list: the app header, and the "Race timing" area bar. */
export async function TimingFrame({
  current,
  wide,
  children,
}: {
  current: '/' | '/events';
  wide?: boolean;
  children: ReactNode;
}) {
  const permissions = await readPermissions();
  const tabs = openableTabs(TIMING_TABS, permissions).map((tab) => ({
    href: timingHref(tab.path),
    label: tab.label,
    current: tab.path === current,
  }));

  return (
    <AppShell bar={barOrNothing('Race timing', tabs)} wide={wide}>
      {children}
    </AppShell>
  );
}

/**
 * A short form of a race's name for a phone's area bar: "Nightingale Nightmare 2026" becomes
 * "NN 2026". The initials of every word but a trailing year, which the year keeps. A name that
 * is already short, or has no year, is left alone.
 */
export function shortRaceName(name: string): string {
  const words = name.trim().split(/\s+/u);
  const year = words.at(-1);
  if (words.length < 3 || year === undefined || !/^\d{4}$/u.test(year)) return name;
  const initials = words
    .slice(0, -1)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return `${initials} ${year}`;
}

/**
 * One race's pages: the app header, and that race's area bar with `current` marked.
 *
 * `name` is the race's name as the page read it, or `null` when the page could not read one —
 * the database unavailable. A race that does not exist (or that the reader may not see, which
 * the reads deliberately do not tell apart) is not this frame's business: the page renders
 * `PlainFrame` around `NotFoundBody`, so the body is the not-found page's exactly (ADR-044).
 *
 * `current` is `null` on the danger zone, which has no tab of its own.
 */
export async function RaceFrame({
  slug,
  name,
  current,
  wide,
  children,
}: {
  slug: string;
  name: string | null;
  current: RaceTab | null;
  /** Kept so callers need not change; the breadcrumbs that used it are gone (ADR-054). */
  page?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const permissions = await readPermissions();
  const base = `/events/${slug}`;
  const tabs = openableTabs(RACE_TABS, permissions, base).map((tab) => ({
    href: timingHref(`${base}${tab.path}`),
    label: tab.label,
    current: tab.key === current,
  }));

  const raceLabel = name ?? 'This race';

  return (
    <AppShell
      bar={barOrNothing(raceLabel, tabs, name === null ? undefined : shortRaceName(name))}
      wide={wide}
    >
      {children}
    </AppShell>
  );
}

/**
 * The race-day screens: a slim dark header and nothing else.
 *
 * ⚠️ **No app header, no area bar and no footer**, and that is the point of it. These are used
 * on a phone by a marshal at the line or by the race director mid-race, and one stray tap takes
 * them off the race. What is left is which screen this is, which race, and one deliberate way
 * out. Slice D restyles the screens themselves.
 *
 * **The way out goes where the reader can actually go.** The race's overview needs
 * `timing.event.manage`; a marshal and somebody who only resolves crossings would get a 404
 * there, so for them it is `/timing`, which lists what they may open.
 */
export async function FocusFrame({
  screen,
  slug,
  name,
  leaveLabel,
  children,
}: {
  screen: string;
  slug: string;
  name: string | null;
  leaveLabel: string;
  children: ReactNode;
}) {
  const permissions = await readPermissions();
  const overview = `/events/${slug}`;
  const leaveHref = canOpen(permissions, overview)
    ? timingHref(overview)
    : timingHref('/');

  return (
    <>
      <SkipLink />
      <header className="club-focus">
        <div className="club-wrap club-focus-inner">
          <p className="club-focus-title">
            <span className="club-focus-club">Southville RC</span>
            <span aria-hidden="true"> · </span>
            <strong>{screen}</strong>
            {name === null ? null : <span className="club-focus-race">{name}</span>}
          </p>
          <a className="club-focus-leave" href={leaveHref}>
            {leaveLabel}
          </a>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
