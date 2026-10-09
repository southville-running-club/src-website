import { holdsAnyTimingPermission } from '@src/shared/timing/door';
import { canOpen } from './access';
import { isStaff } from './staff-roles';

/**
 * Which frame every page under `/timing` wears, and which tabs the race-timing nav carries.
 * ADR-054, which superseded ADR-053 §1: the club website's public header, footer and
 * breadcrumbs are gone from here, replaced by a signed-in app shell.
 *
 * ## The route table, and why it is a table
 *
 * Every page here is wrapped in exactly one of four frames, and `tests/unit/chrome.test.ts`
 * reads every `page.tsx` under `app/` and fails unless it is listed below **and** imports the
 * frame listed for it. So a page added tomorrow cannot quietly ship with no header, or with
 * navigation on a race-day screen a marshal is using mid-race.
 *
 * | Treatment | What it draws |
 * | --- | --- |
 * | `timing` | The app header, the race-timing nav, the slim footer |
 * | `race` | The app header, the race's nav with its tab current, the slim footer |
 * | `plain` | The logo and the slim footer, reading nothing: the not-found and error pages |
 *
 * ⚠️ **There is no `focus` frame any more** — ADR-055. The console and the capture screen used
 * to drop the nav so one stray tap could not take somebody off the race; Pass the Buck keeps its
 * nav on every page, volunteers found that easy, and the console is five pages now.
 *
 * Keys are the page's path under `app/`, which is what the test can read off the disk.
 */
export type Treatment = 'timing' | 'race' | 'plain';

export const PAGE_TREATMENTS: Readonly<Record<string, Treatment>> = {
  'page.tsx': 'timing',
  'events/page.tsx': 'timing',
  'events/[slug]/page.tsx': 'race',
  'events/[slug]/start/page.tsx': 'race',
  'events/[slug]/anomalies/page.tsx': 'race',
  'events/[slug]/crossings/page.tsx': 'race',
  'events/[slug]/results/page.tsx': 'race',
  'events/[slug]/prizes/page.tsx': 'race',
  'events/[slug]/leaderboard/page.tsx': 'race',
  'events/[slug]/marshals/page.tsx': 'race',
  'events/[slug]/registration/page.tsx': 'race',
  'events/[slug]/roster/page.tsx': 'race',
  'events/[slug]/danger-zone/page.tsx': 'race',
  // The capture screen wears the race frame too since ADR-055 — the nav sits above it, as it
  // does in Pass the Buck — and passes `tool`, which makes the screen fill what is left of the
  // viewport and keeps it light outdoors (D5).
  'marshal/[slug]/page.tsx': 'race',
};

/** The frame component each treatment is drawn with, which the test checks a page imports. */
export const FRAME_FOR: Readonly<Record<Treatment, string>> = {
  timing: 'TimingFrame',
  race: 'RaceFrame',
  plain: 'PlainFrame',
};

/** Every tab the race-timing nav can carry. */
export type NavKey =
  | 'home'
  | 'races'
  | 'start'
  | 'anomalies'
  | 'crossings'
  | 'results'
  | 'prizes'
  | 'marshal'
  | 'live'
  | 'staff'
  | 'registrations'
  | 'roster'
  | 'danger';

export interface NavTab {
  key: NavKey;
  label: string;
  /** Under `/timing`, without the base path — the form `lib/access.ts` matches against. */
  path: string;
}

/**
 * One race's tabs, in Pass the Buck's order — ADR-055. Volunteers who timed Pass the Buck know
 * this order; matching it is the whole point, so it is not race-day order or setup order but
 * theirs. Home comes first and is added by {@link raceNav}, because where it goes depends on who
 * is asking.
 *
 * | Tab | Page |
 * | --- | --- |
 * | Start | race control: start, the race clock, finish and reopen |
 * | Anomalies | the triage list |
 * | Timing log | every capture, searchable and correctable |
 * | Results | the export preview, the files, and publishing |
 * | Prizes | the prize giving |
 * | Marshal | the capture screen — only for somebody on this race's roster |
 * | Live | the live leaderboard, staff-only (ADR-038) |
 * | Staff | who is on this race's marshal roster |
 * | Registrations | the entry import, bibs and walk-ins |
 * | Roster | the registration desk's list; marshals read it on races they marshal (ADR-056) |
 * | Danger | wiping a rehearsal |
 */
const RACE_NAV: readonly { key: NavKey; label: string; at: (slug: string) => string }[] =
  [
    { key: 'start', label: 'Start', at: (slug) => `/events/${slug}/start` },
    { key: 'anomalies', label: 'Anomalies', at: (slug) => `/events/${slug}/anomalies` },
    { key: 'crossings', label: 'Timing log', at: (slug) => `/events/${slug}/crossings` },
    { key: 'results', label: 'Results', at: (slug) => `/events/${slug}/results` },
    { key: 'prizes', label: 'Prizes', at: (slug) => `/events/${slug}/prizes` },
    { key: 'marshal', label: 'Marshal', at: (slug) => `/marshal/${slug}` },
    { key: 'live', label: 'Live', at: (slug) => `/events/${slug}/leaderboard` },
    { key: 'staff', label: 'Staff', at: (slug) => `/events/${slug}/marshals` },
    {
      key: 'registrations',
      label: 'Registrations',
      at: (slug) => `/events/${slug}/registration`,
    },
    { key: 'roster', label: 'Roster', at: (slug) => `/events/${slug}/roster` },
    { key: 'danger', label: 'Danger', at: (slug) => `/events/${slug}/danger-zone` },
  ];

/**
 * The tabs somebody may actually open on one race's pages — **filtered, never locked**.
 *
 * Every page here needs a session and a permission, so a lock would sit on every tab and say
 * nothing. A link to a page that answers 404 tells somebody the page exists, which is the
 * disclosure this app's door is built not to make (ADR-036, #235); so a tab is drawn exactly
 * when `canOpen()` — the table `middleware.ts` enforces — says the door would open.
 *
 * - **Home** is the race's hub for anybody who may open it, and `/timing` — which lists the
 *   races they may work on — for everybody else, such as a marshal.
 * - **Marshal** also needs `rostered`: the door checks the race's roster as well as the
 *   permission (ADR-036), and `canOpen()` deliberately answers the permission half only, so a
 *   tab drawn on the permission alone would 404 for an admin who is not marshalling this race.
 * - **Roster** needs `rostered` too for a marshal (ADR-056) — `desk_roster()` answers `null` on
 *   a race they do not marshal — and not for an admin, who reads every race's.
 */
export function raceNav(
  permissions: readonly string[],
  slug: string,
  rostered: boolean,
): NavTab[] {
  const hub = `/events/${slug}`;
  const tabs: NavTab[] = [
    { key: 'home', label: 'Home', path: canOpen(permissions, hub) ? hub : '/' },
  ];
  for (const tab of RACE_NAV) {
    const path = tab.at(slug);
    // Marshal and Roster are both scoped to the race's roster for a marshal (ADR-036, ADR-056),
    // which `canOpen()` deliberately does not check. An admin reads any race's roster.
    const scoped = tab.key === 'marshal' || tab.key === 'roster';
    const open =
      canOpen(permissions, path) &&
      (!scoped || rostered || (tab.key === 'roster' && canOpen(permissions, hub)));
    if (open) tabs.push({ key: tab.key, label: tab.label, path });
  }
  return tabs;
}

/** The pages that belong to no race: the landing page, and the races list for an admin. */
export function appNav(permissions: readonly string[]): NavTab[] {
  const tabs: NavTab[] = [{ key: 'home', label: 'Home', path: '/' }];
  if (canOpen(permissions, '/events')) {
    tabs.push({ key: 'races', label: 'Races', path: '/events' });
  }
  return tabs;
}

/**
 * Whether the nav is drawn at all. **A nav with one tab is not a nav**: it names the page
 * somebody is already on and offers nowhere else to go.
 */
export function showsBar(tabs: readonly unknown[]): boolean {
  return tabs.length > 1;
}

/** The areas of the signed-in club site, as the app header names them. ADR-054 §1. */
export type AreaKey = 'account' | 'timing' | 'admin';

export interface Area {
  key: AreaKey;
  label: string;
  href: string;
}

/**
 * Which areas somebody's header offers, from the same two questions `/account/`'s own bar asks
 * (`apps/main/worker/account.ts`'s `withStaffTabs()`), so the two can never disagree:
 *
 * - **Race timing** when `holdsAnyTimingPermission()` — the predicate the timing app's door and
 *   the account bar both use. Anybody on a page drawn by this app already holds one, so in
 *   practice it is always here; it is asked anyway so the function means the same thing
 *   wherever it is called from.
 * - **Club admin** when `isStaff()` — a role list, not a permission, for the reason
 *   `admin-shell.ts` gives: it answers "may this person through the backend's door at all".
 *   So a `timing-admin` sees two areas and `src-admin` three.
 *
 * Your account is always offered: everybody here is signed in.
 */
export function appAreas(
  permissions: readonly string[],
  roles: readonly string[],
): Area[] {
  const areas: Area[] = [{ key: 'account', label: 'Your account', href: '/account/' }];
  if (holdsAnyTimingPermission(permissions)) {
    areas.push({ key: 'timing', label: 'Race timing', href: BASE_PATH });
  }
  if (isStaff(roles)) {
    areas.push({ key: 'admin', label: 'Club admin', href: '/admin/' });
  }
  return areas;
}

/** The base path, for an `<a href>` — the club's own links are plain anchors, not `<Link>`. */
export const BASE_PATH = '/timing';

/** A path under `/timing` as an address a browser can follow. */
export function timingHref(path: string): string {
  return path === '/' || path === '' ? BASE_PATH : `${BASE_PATH}${path}`;
}
