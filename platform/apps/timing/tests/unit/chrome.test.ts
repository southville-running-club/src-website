import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FRAME_FOR,
  PAGE_TREATMENTS,
  appAreas,
  appNav,
  hubLive,
  hubTools,
  raceNav,
  showsBar,
  timingHref,
} from '../../lib/chrome';

/**
 * The route table in `lib/chrome.ts`, held against the pages that actually exist.
 *
 * ⚠️ **This is what stops a page shipping with no header or no nav.** The root layout draws no
 * chrome — each page wraps itself in its frame — so a page that forgets would render bare. It
 * fails here: every `page.tsx` under `app/` must be in the table, and must import the frame the
 * table names for it.
 */

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pages(path);
    return entry === 'page.tsx' ? [relative(APP, path).split('\\').join('/')] : [];
  });
}

describe('every page under /timing wears the header the table says', () => {
  const found = pages(APP).sort();

  it('finds the pages at all', () => {
    // A glob that silently found nothing would pass every assertion below.
    expect(found.length).toBeGreaterThanOrEqual(10);
  });

  it('has every page in the route table, and nothing in the table that is not a page', () => {
    expect(found).toEqual(Object.keys(PAGE_TREATMENTS).sort());
  });

  it.each(Object.entries(PAGE_TREATMENTS))(
    '%s is drawn in its %s frame',
    (page, treatment) => {
      const source = readFileSync(join(APP, page), 'utf8');
      const frame = FRAME_FOR[treatment];

      expect(source, `${page} must use <${frame}>`).toMatch(
        new RegExp(`<${frame}[\\s>]`),
      );
      for (const other of Object.values(FRAME_FOR)) {
        // `PlainFrame` is also every race page's not-found body, so only the three that carry
        // navigation are exclusive of each other.
        if (other === frame || other === 'PlainFrame') continue;
        expect(source, `${page} must not use <${other}>`).not.toMatch(
          new RegExp(`<${other}[\\s>]`),
        );
      }
    },
  );

  it('draws every race page, the capture screen included, in the race frame (ADR-055)', () => {
    // Pass the Buck keeps its nav on every page, the capture screen too; the console that used
    // to drop it is five pages of its own now.
    for (const [page, treatment] of Object.entries(PAGE_TREATMENTS)) {
      if (page.includes('[slug]')) expect(treatment, page).toBe('race');
    }
  });

  it('draws the not-found and error pages in the plain frame, which reads nothing', () => {
    for (const file of ['not-found.tsx', 'global-error.tsx']) {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(source, file).toMatch(/<PlainFrame[\s>]/);
    }
    // Prerendered, and imported by a client component, so it must not read the session.
    const shell = readFileSync(join(APP, 'chrome/app-shell.tsx'), 'utf8');
    expect(shell).not.toMatch(/readPermissions|readRoles|readSignedInAs|next\/headers/u);
  });
});

describe("the race-timing nav draws only what the reader may open, in Pass the Buck's order", () => {
  const SLUG = 'nn-2026';
  const ADMIN = [
    'timing.event.manage',
    'timing.roster.read',
    'timing.crossing.record',
    'timing.crossing.resolve',
    'timing.result.publish',
    'timing.registration.import',
    'timing.marshal.assign',
  ];
  const labels = (tabs: readonly { label: string }[]) => tabs.map((tab) => tab.label);

  it('gives an admin on the roster all twelve tabs, in order', () => {
    expect(labels(raceNav(ADMIN, SLUG, true))).toEqual([
      'Home',
      'Start',
      'Anomalies',
      'Timing log',
      'Results',
      'Prizes',
      'Marshal',
      'Live',
      'Staff',
      'Registrations',
      'Roster',
      'Danger',
    ]);
  });

  it("leaves Marshal out for an admin who is not on this race's roster", () => {
    // The door checks the roster too (ADR-036), so the tab would be a link to a 404.
    expect(labels(raceNav(ADMIN, SLUG, false))).not.toContain('Marshal');
  });

  it('points every tab at the page it names, under this race', () => {
    const paths = Object.fromEntries(
      raceNav(ADMIN, SLUG, true).map((tab) => [tab.key, tab.path]),
    );
    expect(paths).toEqual({
      home: '/events/nn-2026',
      start: '/events/nn-2026/start',
      anomalies: '/events/nn-2026/anomalies',
      crossings: '/events/nn-2026/crossings',
      results: '/events/nn-2026/results',
      prizes: '/events/nn-2026/prizes',
      marshal: '/marshal/nn-2026',
      live: '/events/nn-2026/leaderboard',
      staff: '/events/nn-2026/marshals',
      registrations: '/events/nn-2026/registration',
      roster: '/events/nn-2026/roster',
      danger: '/events/nn-2026/danger-zone',
    });
  });

  it('gives a rostered marshal Home, Marshal and Roster, with Home at their list of races', () => {
    // ADR-056: a marshal reads the roster, look-up only, on the races they marshal.
    const tabs = raceNav(['timing.crossing.record', 'timing.roster.read'], SLUG, true);
    expect(labels(tabs)).toEqual(['Home', 'Marshal', 'Roster']);
    // They cannot open the race's hub, which needs `timing.event.manage`.
    expect(tabs[0]?.path).toBe('/');
  });

  it('gives a marshal who is not rostered here nothing but Home, so no nav at all', () => {
    expect(
      showsBar(raceNav(['timing.crossing.record', 'timing.roster.read'], SLUG, false)),
    ).toBe(false);
  });

  it('gives somebody who only resolves crossings the two capture pages and Live', () => {
    expect(labels(raceNav(['timing.crossing.resolve'], SLUG, false))).toEqual([
      'Home',
      'Anomalies',
      'Timing log',
      'Live',
    ]);
  });

  it('gives nobody anything for no permission', () => {
    expect(showsBar(raceNav([], SLUG, false))).toBe(false);
    expect(showsBar(appNav([]))).toBe(false);
  });

  it('gives an admin Home and Races away from a race, and a marshal no nav there', () => {
    expect(labels(appNav(['timing.event.manage']))).toEqual(['Home', 'Races']);
    expect(showsBar(appNav(['timing.crossing.record']))).toBe(false);
  });

  it('writes addresses a browser can follow, with the base path', () => {
    expect(timingHref('/')).toBe('/timing');
    expect(timingHref('/events/nn-2026/results')).toBe('/timing/events/nn-2026/results');
  });
});

describe('which areas the app header offers (ADR-054)', () => {
  it('offers a timing-admin Your account and Race timing, and not Club admin', () => {
    expect(
      appAreas(['timing.event.manage'], ['registered', 'timing-admin']).map(
        (a) => a.label,
      ),
    ).toEqual(['Your account', 'Race timing']);
  });

  it('offers a marshal Your account and Race timing', () => {
    expect(
      appAreas(['timing.crossing.record'], ['registered', 'timing-marshal']).map(
        (a) => a.label,
      ),
    ).toEqual(['Your account', 'Race timing']);
  });

  it('offers the club master role all three', () => {
    expect(
      appAreas(['timing.event.manage', 'nn.entry.read'], ['registered', 'src-admin']).map(
        (a) => a.href,
      ),
    ).toEqual(['/account/', '/timing', '/admin/']);
  });

  it('does not offer Club admin to a role that holds a permission but is not staff', () => {
    // `nn-tester` holds a permission and is not staff: the reason `isStaff()` is a role list.
    expect(appAreas(['nn.entry.before_open'], ['nn-tester']).map((a) => a.key)).toEqual([
      'account',
    ]);
  });
});

describe("the Home hub's buttons, built from the nav (ADR-055)", () => {
  const SLUG = 'nn-2026';
  const ADMIN = [
    'timing.event.manage',
    'timing.roster.read',
    'timing.crossing.record',
    'timing.crossing.resolve',
    'timing.result.publish',
    'timing.registration.import',
    'timing.marshal.assign',
  ];

  it('gives an admin race-night tools, then setup, then after the race', () => {
    expect(
      hubTools(ADMIN, SLUG, true).map((group) => [
        group.key,
        group.tools.map((tool) => tool.label),
      ]),
    ).toEqual([
      ['race-night', ['Roster', 'Anomalies', 'Marshal', 'Start screen', 'Timing log']],
      ['setup', ['Manage staff', 'Manage registrations']],
      ['after', ['Results', 'Prizes']],
    ]);
  });

  it('gives a rostered marshal their own two tools and nothing else', () => {
    expect(
      hubTools(['timing.crossing.record', 'timing.roster.read'], SLUG, true).map((g) =>
        g.tools.map((t) => t.label),
      ),
    ).toEqual([['Marshal', 'Roster']]);
  });

  it('never offers a button the nav would not, because it is built from the nav', () => {
    for (const permissions of [ADMIN, ['timing.crossing.record'], []]) {
      const nav = raceNav(permissions, SLUG, false).map((tab) => tab.path);
      for (const group of hubTools(permissions, SLUG, false)) {
        for (const tool of group.tools) expect(nav).toContain(tool.path);
      }
    }
  });

  it('offers the live board only to somebody who may open it', () => {
    expect(hubLive(ADMIN, SLUG, false)).toBe('/events/nn-2026/leaderboard');
    expect(
      hubLive(['timing.crossing.record', 'timing.roster.read'], SLUG, true),
    ).toBeNull();
  });
});
