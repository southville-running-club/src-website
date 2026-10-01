import { canOpen } from './access';

/**
 * Which header every page under `/timing` wears, and which tabs the two section bars carry.
 * ADR-052's timing half.
 *
 * ## The route table, and why it is a table
 *
 * Every page here is wrapped in exactly one of three frames, and `tests/unit/chrome.test.ts`
 * reads every `page.tsx` under `app/` and fails unless it is listed below **and** imports the
 * frame listed for it. So a page added tomorrow cannot quietly ship with no header — or with
 * the club's navigation on a race-day screen a marshal is using mid-race.
 *
 * | Treatment | What it draws |
 * | --- | --- |
 * | `timing` | The club header, the "Race timing" bar, breadcrumbs, the club footer |
 * | `race` | The club header, the race's own bar with its tab current, breadcrumbs, the footer |
 * | `focus` | A slim dark header — the screen, the race and one way out — and nothing else |
 * | `club` | The club header and footer only: the not-found page and the error page |
 *
 * Keys are the page's path under `app/`, which is what the test can read off the disk.
 */
export type Treatment = 'timing' | 'race' | 'focus' | 'club';

export const PAGE_TREATMENTS: Readonly<Record<string, Treatment>> = {
  'page.tsx': 'timing',
  'events/page.tsx': 'timing',
  'events/[slug]/page.tsx': 'race',
  'events/[slug]/leaderboard/page.tsx': 'race',
  'events/[slug]/results/page.tsx': 'race',
  'events/[slug]/registration/page.tsx': 'race',
  'events/[slug]/marshals/page.tsx': 'race',
  'events/[slug]/danger-zone/page.tsx': 'race',
  // ⚠️ **The two screens used on a phone in the middle of a race.** No club navigation and no
  // section bar: one stray tap must not take a marshal or the race director off the race.
  'events/[slug]/console/page.tsx': 'focus',
  'marshal/[slug]/page.tsx': 'focus',
};

/** The frame component each treatment is drawn with, which the test checks a page imports. */
export const FRAME_FOR: Readonly<Record<Treatment, string>> = {
  timing: 'TimingFrame',
  race: 'RaceFrame',
  focus: 'FocusFrame',
  club: 'ClubFrame',
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
 * One race's bar, in the order the mockup sets.
 *
 * **"Captures" is not a tab**: captures and anomalies are sections of the race console since
 * ADR-045, so they are reached through it. **The danger zone is not a tab either**, on purpose:
 * wiping a race is linked from the race's overview page, and a tab beside "Results" is one tap
 * too easy to reach.
 */
export const RACE_TABS: readonly (Tab & { key: RaceTab })[] = [
  { key: 'overview', path: '', label: 'Overview' },
  { key: 'leaderboard', path: '/leaderboard', label: 'Live leaderboard' },
  { key: 'results', path: '/results', label: 'Results' },
  { key: 'registration', path: '/registration', label: 'Entry list' },
  { key: 'marshals', path: '/marshals', label: 'Marshals' },
  { key: 'console', path: '/console', label: 'Race console' },
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

/** The base path, for an `<a href>` — the club's own links are plain anchors, not `<Link>`. */
export const BASE_PATH = '/timing';

/** A path under `/timing` as an address a browser can follow. */
export function timingHref(path: string): string {
  return path === '/' || path === '' ? BASE_PATH : `${BASE_PATH}${path}`;
}
