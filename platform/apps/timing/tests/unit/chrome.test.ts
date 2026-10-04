import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FRAME_FOR,
  PAGE_TREATMENTS,
  RACE_TABS,
  TIMING_TABS,
  appAreas,
  openableTabs,
  showsBar,
  timingHref,
} from '../../lib/chrome';
import { shortRaceName } from '../../app/chrome/frames';

/**
 * The route table in `lib/chrome.ts`, held against the pages that actually exist.
 *
 * ⚠️ **This is what stops a page shipping with no header, or with the club's navigation on a
 * race-day screen.** The root layout draws no chrome — each page wraps itself in its frame — so
 * a page that forgets would render bare, and a console that took `RaceFrame` by habit would put
 * "News" one tap from the start button. Both fail here: every `page.tsx` under `app/` must be in
 * the table, and must import the frame the table names for it.
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

  it('keeps the app header and area bar off the two race-day screens', () => {
    expect(PAGE_TREATMENTS['events/[slug]/console/page.tsx']).toBe('focus');
    expect(PAGE_TREATMENTS['marshal/[slug]/page.tsx']).toBe('focus');
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

describe('the area bars draw only what the reader may open', () => {
  const RACE = '/events/nn-2026';

  it('gives a timing-admin every race tab', () => {
    const all = [
      'timing.event.manage',
      'timing.crossing.resolve',
      'timing.result.publish',
      'timing.registration.import',
      'timing.marshal.assign',
    ];
    // Race-day order (D1, 4 October 2026).
    expect(openableTabs(RACE_TABS, all, RACE).map((t) => t.label)).toEqual([
      'Overview',
      'Race console',
      'Live leaderboard',
      'Results',
      'Entry list',
      'Marshals',
    ]);
  });

  it('gives somebody who only resolves crossings the leaderboard and the console', () => {
    expect(
      openableTabs(RACE_TABS, ['timing.crossing.resolve'], RACE).map((t) => t.label),
    ).toEqual(['Race console', 'Live leaderboard']);
  });

  it('gives a marshal no race tab at all, because every one of them would 404', () => {
    expect(openableTabs(RACE_TABS, ['timing.crossing.record'], RACE)).toEqual([]);
  });

  it('gives a marshal the landing page and not the races list', () => {
    expect(
      openableTabs(TIMING_TABS, ['timing.crossing.record']).map((t) => t.label),
    ).toEqual(['Overview']);
  });

  it('gives nobody anything for no permission', () => {
    expect(openableTabs(TIMING_TABS, [])).toEqual([]);
    expect(openableTabs(RACE_TABS, [], RACE)).toEqual([]);
  });

  it('writes addresses a browser can follow, with the base path', () => {
    expect(timingHref('/')).toBe('/timing');
    expect(timingHref('/events/nn-2026/results')).toBe('/timing/events/nn-2026/results');
  });
});

describe('which bars and areas the app shell draws (ADR-054)', () => {
  it('draws no bar with a single tab, which is what gives a marshal none', () => {
    const marshal = openableTabs(TIMING_TABS, ['timing.crossing.record']);
    expect(showsBar(marshal)).toBe(false);
    expect(showsBar(openableTabs(TIMING_TABS, ['timing.event.manage']))).toBe(true);
    expect(showsBar([])).toBe(false);
  });

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

describe('the short form of a race name on a phone', () => {
  it('keeps the year and initials the rest', () => {
    expect(shortRaceName('Nightingale Nightmare 2026')).toBe('NN 2026');
    expect(shortRaceName('Pass the Buck 2027')).toBe('PTB 2027');
  });

  it('leaves a name it cannot shorten sensibly alone', () => {
    expect(shortRaceName('Pass the Buck')).toBe('Pass the Buck');
    expect(shortRaceName('NN 2026')).toBe('NN 2026');
  });
});
