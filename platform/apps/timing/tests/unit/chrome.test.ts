import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FRAME_FOR,
  PAGE_TREATMENTS,
  RACE_TABS,
  TIMING_TABS,
  openableTabs,
  timingHref,
} from '../../lib/chrome';

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
        // `ClubFrame` is also every race page's not-found body, so only the three that carry
        // navigation are exclusive of each other.
        if (other === frame || other === 'ClubFrame') continue;
        expect(source, `${page} must not use <${other}>`).not.toMatch(
          new RegExp(`<${other}[\\s>]`),
        );
      }
    },
  );

  it('keeps the club navigation off the two race-day screens', () => {
    expect(PAGE_TREATMENTS['events/[slug]/console/page.tsx']).toBe('focus');
    expect(PAGE_TREATMENTS['marshal/[slug]/page.tsx']).toBe('focus');
  });

  it('draws the not-found and error pages in the club frame, which reads nothing', () => {
    for (const file of ['not-found.tsx', 'global-error.tsx']) {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(source, file).toMatch(/<ClubFrame[\s>]/);
    }
    // Prerendered, so it must not import the frames that read the session.
    expect(readFileSync(join(APP, 'chrome/club-frame.tsx'), 'utf8')).not.toContain(
      'readPermissions',
    );
  });
});

describe('the section bars draw only what the reader may open', () => {
  const RACE = '/events/nn-2026';

  it('gives a timing-admin every race tab', () => {
    const all = [
      'timing.event.manage',
      'timing.crossing.resolve',
      'timing.result.publish',
      'timing.registration.import',
      'timing.marshal.assign',
    ];
    expect(openableTabs(RACE_TABS, all, RACE).map((t) => t.label)).toEqual([
      'Overview',
      'Live leaderboard',
      'Results',
      'Entry list',
      'Marshals',
      'Race console',
    ]);
  });

  it('gives somebody who only resolves crossings the leaderboard and the console', () => {
    expect(
      openableTabs(RACE_TABS, ['timing.crossing.resolve'], RACE).map((t) => t.label),
    ).toEqual(['Live leaderboard', 'Race console']);
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
