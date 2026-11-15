import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { comingUpOn, parseEvents } from '@src/shared/club-content';

/**
 * Whether the home page still carries the card that links to the race at `/nn/`.
 *
 * ⚠️ **The card expires on purpose, and three tests assumed it never would.** Its entry in
 * `events.json` has a `showUntil` — the night of the race — and `index.astro` resolves
 * `comingUpOn()` at build time, so the first build after race day ships a home page with no
 * race card and no link to `/nn/`. That is the design: the front page must not advertise a
 * race that has been run. The tests that asserted the link unconditionally went red on every
 * branch on 2 November 2026, the first morning after the race, `main` included, while no code
 * had changed.
 *
 * **So the question is asked of the same data the page is built from**, with the same
 * function, rather than with a date written into a test. A later running gets a new
 * `showUntil` in `events.json` and every caller follows it with no edit here.
 *
 * **Read from disk rather than `import`ed**, `club-pages.spec.ts`'s reason: a bare JSON import
 * fails in a Playwright spec with *"needs an import attribute of type: json"*.
 *
 * ⚠️ **Asked at test time of a page built earlier**, so a build before midnight UTC on the
 * `showUntil` night and a test after it would disagree. Builds and runs are minutes apart, and
 * the one night it could happen is the night after a race.
 */
export function raceCardIsCurrent(now: Date = new Date()): boolean {
  const events = parseEvents(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../src/content/events.json', import.meta.url)),
        'utf8',
      ),
    ),
  );

  return comingUpOn(events, now).some((entry) => entry.href === '/nn/');
}
