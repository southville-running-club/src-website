import type { ReactNode } from 'react';
import {
  RACE_TABS,
  TIMING_TABS,
  openableTabs,
  timingHref,
  type RaceTab,
} from '../../lib/chrome';
import { canOpen } from '../../lib/access';
import { readPermissions } from '../../lib/reads';
import { ClubSkipLink } from './club-chrome';
import { ClubFrame, SectionBar, TIMING_TRAIL, type Crumb } from './club-frame';

export { ClubFrame } from './club-frame';

/**
 * The four frames every page under `/timing` is drawn in — `lib/chrome.ts`'s route table says
 * which, and `tests/unit/chrome.test.ts` holds every page to it. ADR-052.
 *
 * The root layout draws none of this and only the document around it, because the frame a
 * page wears depends on things only the page knows: which race, what it is called, and which
 * tab is current. A page wraps each of its returns in its frame; its own content is untouched.
 */

/** The landing page and the races list: the club header, and the "Race timing" bar. */
export async function TimingFrame({
  current,
  children,
}: {
  current: '/' | '/events';
  children: ReactNode;
}) {
  const permissions = await readPermissions();
  const tabs = openableTabs(TIMING_TABS, permissions).map((tab) => ({
    href: timingHref(tab.path),
    label: tab.label,
    current: tab.path === current,
  }));

  const trail: Crumb[] =
    current === '/'
      ? [TIMING_TRAIL[0]!, { label: 'Race timing' }]
      : [...TIMING_TRAIL, { label: 'Races' }];

  return (
    <ClubFrame bar={<SectionBar name="Race timing" tabs={tabs} />} trail={trail}>
      {children}
    </ClubFrame>
  );
}

/**
 * One race's pages: the club header, and that race's bar with `current` marked.
 *
 * `name` is the race's name as the page read it, or `null` when the page could not read one —
 * the database unavailable. A race that does not exist (or that the reader may not see, which
 * the reads deliberately do not tell apart) is not this frame's business: the page renders
 * `ClubFrame` around `NotFoundBody`, so the body is the not-found page's exactly (ADR-044).
 *
 * `current` is `null` on the danger zone, which has no tab of its own; `page` names it in the
 * breadcrumbs.
 */
export async function RaceFrame({
  slug,
  name,
  current,
  page,
  children,
}: {
  slug: string;
  name: string | null;
  current: RaceTab | null;
  page: string;
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
  const mayOpenOverview = canOpen(permissions, base);
  const trail: Crumb[] =
    current === 'overview'
      ? [...TIMING_TRAIL, { label: raceLabel }]
      : [
          ...TIMING_TRAIL,
          { label: raceLabel, href: mayOpenOverview ? timingHref(base) : undefined },
          { label: page },
        ];

  return (
    <ClubFrame bar={<SectionBar name={raceLabel} tabs={tabs} />} trail={trail}>
      {children}
    </ClubFrame>
  );
}

/**
 * The race-day screens: a slim dark header and nothing else.
 *
 * ⚠️ **No club navigation, no section bar and no footer**, and that is the point of it. These
 * are used on a phone by a marshal at the line or by the race director mid-race, and one stray
 * tap on "News" takes them off the race. What is left is which screen this is, which race, and
 * one deliberate way out.
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
      <ClubSkipLink />
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
