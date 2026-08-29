import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * The navigation bar, in the real runtime, on every page that carries it.
 *
 * **One bar, four controls, and not a year in the markup.** The wordmark, `Race`, `Privacy`
 * and the button — and the button is the only one of the four the Worker paints, from whichever
 * running `entries.current_entry_state('nn')` says is current. It is the same four on
 * `/nn/privacy/` and `/nn/2026/spectators/` as on `/nn/`, because the bar is the same bar
 * everywhere.
 *
 * **It was six, then five, and it is four.** `Course` came out of the bar with the page it
 * pointed at, and `/nn/course/` is a 301 to `/nn/` now — so it is deliberately **not** in
 * `WITH_NAV` any more. `SELF.fetch` follows redirects, so an entry for it here would have gone
 * on passing while quietly asserting `/nn/` a second time under another name. Then `Race info`
 * and `Spooktators` came out on request, which is why the bar has **two** links inside `<nav>`
 * and why exactly one href in it names a year, where three used to.
 *
 * **The two pages those links named are still in `WITH_NAV`, and that is deliberate.**
 * `/nn/2026/race-day/` and `/nn/2026/spectators/` still exist, still serve 200 and still render
 * this bar; what changed is that the bar no longer holds an entry that *can* be current on
 * either of them. So the rows that used to assert the bar marks them are inverted below rather
 * than deleted — they now assert it marks nothing there, which is the same fact stated the way
 * round the bar is built.
 *
 * **`Privacy` is in the bar because of ADR-014**, and it is the one that changed an assertion
 * here rather than adding one: `/nn/privacy/` used to be the single page in the campaign whose
 * bar marked nothing as current, and it no longer is. With the painted pair gone it is also no
 * longer the last of four links but the second of two — its own list in `NnNav.astro` is still
 * the decision about order, and it is what would put it after a race link that came back.
 *
 * This file runs against the **seeded, closed** window, which is what production serves.
 * `tests/worker/entries-open/` carries the same bar's open-state assertions.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/**
 * Every page that renders the masthead. The bar must be identical on all of them.
 *
 * **Both evergreen pages are still here** — `/nn/` and `/nn/privacy/` — beside the three that
 * live under a year, and that mix is the point of the list: a bar asserted only on year pages
 * would stop proving it is the same bar everywhere. `/nn/course/` left it with the page it
 * named (see above); the other two year pages stayed, because losing a link in the bar is not
 * losing the page.
 */
const WITH_NAV = [
  '/nn/',
  '/nn/privacy/',
  '/nn/2026/',
  '/nn/2026/race-day/',
  '/nn/2026/spectators/',
] as const;

const page = (path: string) =>
  SELF.fetch(`${SITE}${path}`).then((response) => response.text());

/**
 * The bar's own markup, so a link elsewhere on the page cannot be mistaken for one of its.
 *
 * **The class is matched as the first of a list rather than as the whole attribute, and that
 * is a fix rather than a loosening.** This read `'<header class="nn-masthead"'`, closing quote
 * included, which stopped matching the moment a page gave the masthead a second class:
 * `/nn/2026/` passes `sticky={false}`, so it renders
 * `class="nn-masthead nn-masthead-unstuck-narrow"` and this returned `''` for it — taking every
 * assertion in this file about that page down with it, on a bar that was rendering perfectly.
 *
 * **It failed loudly, which is the only reason it was cheap.** Four tests went red naming the
 * page, and the empty string is what made the message (`expected '' to contain '>Race<'`) read
 * as the Worker having painted nothing rather than as the helper having found nothing. A
 * variant that had silently returned the *whole page* instead would have gone on passing while
 * asserting against every link on it.
 */
function bar(html: string): string {
  const start = html.search(/<header class="nn-masthead[ "]/);
  const end = html.indexOf('</header>', start);
  return start === -1 ? '' : html.slice(start, end);
}

/**
 * The `<nav>` inside the bar, which is a narrower thing than `bar()` returns.
 *
 * **The button is not in it.** It is the wordmark's sibling rather than this list's, so the two
 * can share a row at 320px — `NnMasthead.astro` has the reasoning. That split is exactly what
 * the year assertion below needs: every link a reader would call navigation is written down in
 * `NnNav.astro` and may never name a year, and the one control that may is outside the landmark
 * and is painted.
 *
 * Same empty-string failure mode as `bar()`, and it is guarded the same way — the assertion
 * that uses this compares an **exact ordered array** rather than filtering, so a helper that
 * found nothing goes red instead of reporting that no year reached a fragment it never had.
 */
function navList(html: string): string {
  const start = html.search(/<nav class="nn-nav"/);
  const end = html.indexOf('</nav>', start);
  return start === -1 ? '' : html.slice(start, end);
}

const hrefsIn = (fragment: string): string[] =>
  [...fragment.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

describe('the same four controls, wherever you are standing', () => {
  it.each(WITH_NAV)('renders the whole bar on %s', async (path) => {
    const html = bar(await page(path));

    expect(html).toContain('>Race<');
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
      // **Privacy, and it is last rather than a second entry in `evergreen`.** The order is
      // ADR-014's decision, not an accident of which array it went into — it has a list of its
      // own in `NnNav.astro` for exactly that reason, and that is what would keep it last if a
      // race link ever came back. `Race info` and `Spooktators` were the two entries between
      // these, painted; they are gone and their array is empty.
      '/nn/privacy/',
      // **The button, and the only href in the whole bar the Worker fills in.** It is the
      // masthead's rather than the navigation's, so it is last in the DOM as well as here.
      '/nn/2026/',
    ]);
  });

  it.each(WITH_NAV)(
    'reveals the button, the one painted control, on %s',
    async (path) => {
      // It ships `hidden`. Still hidden means the paint did not reach this page — which is what
      // would happen if the Worker only rewrote `/nn/`, as it used to.
      const html = bar(await page(path));

      expect(html).toContain('data-nn-nav-cta');
      expect(html).not.toMatch(/data-nn-nav-cta[^>]*hidden/);

      // **And there is nothing else left waiting to be painted.** The Worker is unchanged —
      // `renderNnNav` still registers `[data-nn-nav-item="race-day"]` and
      // `[data-nn-nav-item="spectators"]` — but `running` in `NnNav.astro` is empty, so
      // `HTMLRewriter` finds neither and reveals nothing. Asserting the elements are **absent**
      // is the only version of this that means anything now: the `not.toMatch(…hidden)` pair
      // that stood here would pass on markup that had never contained them.
      expect(html).not.toContain('data-nn-nav-item');
    },
  );
});

describe('no year reaches the bar except through the Worker', () => {
  it.each(WITH_NAV)('writes no year into the navigation at all, on %s', async (path) => {
    // **A flat statement now, not an allowance.** This used to permit three painted hrefs; the
    // navigation is two hard-coded evergreen links, so the honest assertion is that *nothing*
    // in it names a year — before painting or after, on every page.
    //
    // Compared as an exact ordered array rather than filtered for four digits, because a
    // filter over a fragment `navList()` failed to find would report zero years and pass.
    const links = navList(await page(path));

    expect(hrefsIn(links)).toEqual(['/nn/', '/nn/privacy/']);
  });

  it.each(WITH_NAV)(
    'carries a year on the button and nowhere else, on %s',
    async (path) => {
      // **One href in the bar may name a year, and it is the one the Worker paints.** The
      // wordmark, `Race` and `Privacy` may never. That a year is absent from the *source* is
      // asserted where it can actually be read — `tests/unit/nn-nav.test.ts` greps the
      // components, because a Worker test only ever sees the painted result.
      const painted = bar(await page(path));
      const withYear = hrefsIn(painted).filter((href) => /\d{4}/.test(href));

      expect(withYear).toEqual(['/nn/2026/']);
    },
  );

  it.each(['/nn/', '/nn/privacy/', '/nn/2026/'] as const)(
    'marks exactly one control as the current page, on %s',
    async (path) => {
      const html = bar(await page(path));
      const current = [...html.matchAll(/aria-current="page"/g)];

      // **`/nn/privacy/` is here because of ADR-014**, and that is the change that put it
      // here: it used to be the one page in the campaign whose bar marked nothing, because it
      // was the one page the bar did not link to — somebody who got there had no way to tell
      // from the header where they were. On `/nn/2026/` the marker is on the **button**, a
      // destination like any other; the test below says so.
      expect(current.length, path).toBe(1);
    },
  );

  it.each(['/nn/2026/race-day/', '/nn/2026/spectators/'] as const)(
    'marks nothing at all on %s, which the bar no longer links to',
    async (path) => {
      const html = bar(await page(path));
      const current = [...html.matchAll(/aria-current="page"/g)];

      // **This is the inverse of the assertion that used to stand here, and it is the same
      // fact.** These two rows asserted that the bar marked `Race info` and `Spooktators`
      // current on their own pages. Both links are gone, so no control in the bar can be
      // current on either page, and marking one would mean something had started matching too
      // loosely — `Race`'s `/^\/nn\/$/`, say, or a painted link quietly returning.
      //
      // **Nothing about the pages changed**: they still serve 200 and still render this bar,
      // which is why they are still in `WITH_NAV` and why this is an inversion rather than a
      // deletion. What a reader loses is the header telling them where they are, and that is
      // the accepted cost of the shorter bar rather than an oversight.
      expect(current.length, path).toBe(0);
    },
  );

  it.each([
    ['/nn/', 'Race'],
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

  it('marks the button, on the running it goes to', async () => {
    // **The one page whose marker is not on a link in `<nav>`**, so it cannot be read by the
    // text between the tags — the button's own label is two `<span>`s. The element is
    // identified by its hook instead, which is also what makes this robust to the label the
    // Worker paints changing with the entry window.
    const html = bar(await page('/nn/2026/'));
    const marked = /<a[^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? '';

    expect(marked).toContain('data-nn-nav-cta');
  });
});

describe('the pages that do not get the bar', () => {
  it.each(['/', '/404.html'])('leaves %s without any of it', async (path) => {
    const html = await page(path);

    expect(html).not.toContain('nn-masthead');
    expect(html).not.toContain('nn-nav');
  });

  it('gives the return page the wordmark and no links', async () => {
    // **Somebody has just paid.** Three ways to wander off before reading what the club has
    // recorded — `Race`, `Privacy` and the button — is not what that page is for; the mark
    // stays so it is visibly still the club's.
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
