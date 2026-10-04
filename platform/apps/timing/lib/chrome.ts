import { holdsAnyTimingPermission } from '@src/shared/timing/door';
import { canOpen } from './access';
import { isStaff } from './staff-roles';

/**
 * Which frame every page under `/timing` wears, and which tabs the area bars carry.
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
 * | `timing` | The app header, the "Race timing" area bar, the slim footer |
 * | `race` | The app header, the race's own area bar with its tab current, the slim footer |
 * | `focus` | A slim dark header — the screen, the race and one way out — and nothing else |
 * | `plain` | The logo and the slim footer, reading nothing: the not-found and error pages |
 *
 * Keys are the page's path under `app/`, which is what the test can read off the disk.
 */
export type Treatment = 'timing' | 'race' | 'focus' | 'plain';

export const PAGE_TREATMENTS: Readonly<Record<string, Treatment>> = {
  'page.tsx': 'timing',
  'events/page.tsx': 'timing',
  'events/[slug]/page.tsx': 'race',
  'events/[slug]/leaderboard/page.tsx': 'race',
  'events/[slug]/results/page.tsx': 'race',
  'events/[slug]/registration/page.tsx': 'race',
  'events/[slug]/marshals/page.tsx': 'race',
  'events/[slug]/danger-zone/page.tsx': 'race',
  // ⚠️ **The two screens used on a phone in the middle of a race.** No app header and no area
  // bar: one stray tap must not take a marshal or the race director off the race.
  'events/[slug]/console/page.tsx': 'focus',
  'marshal/[slug]/page.tsx': 'focus',
};

/** The frame component each treatment is drawn with, which the test checks a page imports. */
export const FRAME_FOR: Readonly<Record<Treatment, string>> = {
  timing: 'TimingFrame',
  race: 'RaceFrame',
  focus: 'FocusFrame',
  plain: 'PlainFrame',
};

export interface Tab {
  /** Under `/timing`, without the base path — the form `lib/access.ts` matches against. */
  path: string;
  label: string;
}

/**
 * The "Race timing" bar: the landing page, and the races list for whoever may open it.
 *
 * There is no standalone leaderboard or results index — both exist per race only — so this bar
 * is two tabs rather than the mockup's three.
 */
export const TIMING_TABS: readonly Tab[] = [
  { path: '/', label: 'Overview' },
  { path: '/events', label: 'Races' },
];

export type RaceTab =
  'overview' | 'leaderboard' | 'results' | 'registration' | 'marshals' | 'console';

/**
 * One race's bar, in race-day order (D1, 4 October 2026): what is used on the day first, then
 * what is set up before it.
 *
 * **"Captures" is not a tab**: captures and anomalies are sections of the race console since
 * ADR-045, so they are reached through it. **The danger zone is not a tab either**, on purpose:
 * wiping a race is linked from the race's overview page, and a tab beside "Results" is one tap
 * too easy to reach.
 */
export const RACE_TABS: readonly (Tab & { key: RaceTab })[] = [
  { key: 'overview', path: '', label: 'Overview' },
  { key: 'console', path: '/console', label: 'Race console' },
  { key: 'leaderboard', path: '/leaderboard', label: 'Live leaderboard' },
  { key: 'results', path: '/results', label: 'Results' },
  { key: 'registration', path: '/registration', label: 'Entry list' },
  { key: 'marshals', path: '/marshals', label: 'Marshals' },
];

/**
 * The tabs somebody may actually open — **filtered, never locked**.
 *
 * Every page here needs a session and a permission, so a lock would sit on every tab and say
 * nothing. A link to a page that answers 404 tells somebody the page exists, which is the
 * disclosure this app's door is built not to make (ADR-036, #235); so a tab is drawn exactly
 * when `canOpen()` — the table `middleware.ts` enforces — says the door would open.
 */
export function openableTabs<T extends Tab>(
  tabs: readonly T[],
  permissions: readonly string[],
  base = '',
): T[] {
  return tabs.filter((tab) => canOpen(permissions, `${base}${tab.path}` || '/'));
}

/**
 * Whether an area bar is drawn at all. **A bar with one tab is not a bar**: it names the page
 * somebody is already on and offers nowhere else to go. That is what gives a marshal no area bar
 * (ADR-054): on `/timing` the only tab they may open is Overview.
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
