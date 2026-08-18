import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * The navigation bar, in the real runtime, on every page that carries it.
 *
 * **One bar, six controls, and not a year in the markup.** Two of the six point at whichever
 * running `entries.current_entry_state('nn')` says is current, and the Worker paints them —
 * on `/nn/course/` and `/nn/privacy/` as much as on `/nn/`, because the bar is the same bar
 * everywhere and a runner does not care that race day lives inside a year directory.
 *
 * **The sixth is `Privacy`, added by ADR-014**, and it is the one that changes an assertion here
 * rather than adding one: `/nn/privacy/` used to be the single page in the campaign whose bar
 * marked nothing as current, and it no longer is.
 *
 * This file runs against the **seeded, closed** window, which is what production serves.
 * `tests/worker/entries-open/` carries the same bar's open-state assertions.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/** Every page that renders the masthead. The bar must be identical on all of them. */
const WITH_NAV = [
  '/nn/',
  '/nn/course/',
  '/nn/privacy/',
  '/nn/2026/',
  '/nn/2026/race-day/',
  '/nn/2026/spectators/',
] as const;

const page = (path: string) =>
  SELF.fetch(`${SITE}${path}`).then((response) => response.text());

/** The bar's own markup, so a link elsewhere on the page cannot be mistaken for one of its. */
function bar(html: string): string {
  const start = html.indexOf('<header class="nn-masthead"');
  const end = html.indexOf('</header>', start);
  return start === -1 ? '' : html.slice(start, end);
}

const hrefsIn = (fragment: string): string[] =>
  [...fragment.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

describe('the same six controls, wherever you are standing', () => {
  it.each(WITH_NAV)('renders the whole bar on %s', async (path) => {
    const html = bar(await page(path));

    expect(html).toContain('>Race<');
    expect(html).toContain('>Course<');
    expect(html).toContain('>Race day<');
    expect(html).toContain('>Spectators<');
    expect(html).toContain('>Privacy<');
    expect(html).toContain('data-nn-nav-cta');
  });

  it.each(WITH_NAV)('paints the same destinations on %s', async (path) => {
    // **Identical on every page.** The old bar grew a second row beneath a year, which was the
    // routes leaking into the interface; this asserts that they no longer do.
    const html = bar(await page(path));

    expect(hrefsIn(html)).toEqual([
      // **The wordmark, and it goes to the club rather than to the campaign.** It pointed at
      // `/nn/` — the same place as the bar's first link, which left these pages with no
      // route out at all: the cross-site banner hides its own mark here precisely because
      // this one exists.
      '/',
      // Race.
      '/nn/',
      '/nn/course/',
      '/nn/2026/race-day/',
      '/nn/2026/spectators/',
      // **Privacy, and it is last in the list rather than beside `Course`.** The order is
      // ADR-014's decision, not an accident of which array it went into — see `NnNav.astro`.
      '/nn/privacy/',
      '/nn/2026/',
    ]);
  });

  it.each(WITH_NAV)(
    'reveals the two painted items and the button on %s',
    async (path) => {
      // They ship `hidden`. If one is still hidden, the paint did not reach this page — which
      // is what would happen if the Worker only rewrote `/nn/`, as it used to.
      const html = bar(await page(path));

      expect(html).not.toMatch(/data-nn-nav-item="race-day"[^>]*hidden/);
      expect(html).not.toMatch(/data-nn-nav-item="spectators"[^>]*hidden/);
      expect(html).not.toMatch(/data-nn-nav-cta[^>]*hidden/);
    },
  );
});

describe('no year reaches the bar except through the Worker', () => {
  it.each(WITH_NAV)(
    'carries a year on exactly the three painted controls, on %s',
    async (path) => {
      // **Three of the seven hrefs in the bar may name a year, and they are the three the Worker
      // paints.** The wordmark and the three evergreen links may never. That a year is absent
      // from the *source* is asserted where it can actually be read — `tests/unit/nn-nav.test.ts`
      // greps the components, because a Worker test only ever sees the painted result.
      const painted = bar(await page(path));
      const withYear = hrefsIn(painted).filter((href) => /\d{4}/.test(href));

      expect(withYear).toEqual([
        '/nn/2026/race-day/',
        '/nn/2026/spectators/',
        '/nn/2026/',
      ]);
    },
  );

  it('marks exactly one control as the current page, on each of them', async () => {
    for (const path of WITH_NAV) {
      const html = bar(await page(path));
      const current = [...html.matchAll(/aria-current="page"/g)];

      // **No exception any more, and losing the exception is the point of this slice.**
      // `/nn/privacy/` used to be the one page in the campaign whose bar marked nothing,
      // because it was the one page the bar did not link to — somebody who got there had no
      // way to tell from the header where they were. Every page that carries the bar is now
      // in it. On `/nn/2026/` the marker is on the **button**, a destination like any other.
      expect(current.length, path).toBe(1);
    }
  });

  it.each([
    ['/nn/', 'Race'],
    ['/nn/course/', 'Course'],
    ['/nn/2026/race-day/', 'Race day'],
    ['/nn/2026/spectators/', 'Spectators'],
    ['/nn/privacy/', 'Privacy'],
  ] as const)('marks %s as %s', async (path, label) => {
    // The marker is derived from the **shape** of the page's own path, not from the painted
    // href — so it is right before the Worker has painted anything, including with the
    // database down.
    const html = bar(await page(path));

    expect(html).toMatch(
      new RegExp(`aria-current="page"[^>]*>${label}<|>${label}<`.replace(/ /g, '\\s')),
    );
    const marked = /<a[^>]*aria-current="page"[^>]*>([^<]*)</.exec(html)?.[1]?.trim();
    expect(marked).toBe(label);
  });
});

describe('the pages that do not get the bar', () => {
  it.each(['/', '/404.html'])('leaves %s without any of it', async (path) => {
    const html = await page(path);

    expect(html).not.toContain('nn-masthead');
    expect(html).not.toContain('nn-nav');
  });

  it('gives the return page the wordmark and no links', async () => {
    // **Somebody has just paid.** Four ways to wander off before reading what the club has
    // recorded is not what that page is for; the mark stays so it is visibly still the club's.
    const html = await page('/nn/2026/entry/complete/');

    expect(html).toContain('nn-masthead');
    expect(html).toContain('nn-masthead-mark');
    expect(html).not.toContain('nn-nav');
    expect(html).not.toContain('data-nn-nav-cta');
  });
});

describe('what the button offers, before entries open', () => {
  it('offers to register an interest rather than to enter', async () => {
    // **An "Enter" that does not let you enter is a small dishonesty on a site that is about
    // to ask for money.** The interest form is on the year page, so this is exactly what the
    // destination has.
    const html = bar(await page('/nn/'));

    expect(html).toContain('aria-label="Register interest"');
    expect(html).toContain('>Register interest<');
    expect(html).toContain('>Interest<');
    expect(html).not.toContain('Enter the race');
  });

  it('keeps the short label inside the long one, which is WCAG 2.5.3', async () => {
    // What somebody says out loud has to appear in what the machine reads. The accessible
    // name is the long label at every width; the short one is what is drawn at 320px.
    const html = bar(await page('/nn/'));

    const cta = /<a class="nn-nav-cta"[\s\S]*$/.exec(html)?.[0] ?? '';
    const long = /aria-label="([^"]*)"/.exec(cta)?.[1] ?? '';
    const short = /data-nn-nav-cta-short>([^<]*)</.exec(cta)?.[1] ?? '';

    expect(long).not.toBe('');
    expect(short).not.toBe('');
    expect(long.toLowerCase()).toContain(short.toLowerCase());
  });

  it('sends the button to the running itself, not to a fragment on it', async () => {
    const html = bar(await page('/nn/'));

    expect(html).toMatch(/class="nn-nav-cta" href="\/nn\/2026\/"/);
  });
});
