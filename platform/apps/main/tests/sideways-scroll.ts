import { expect, type Page } from '@playwright/test';

/**
 * Measuring a page at 320px, once it is actually a styled page.
 *
 * ## The defect this exists to remove
 *
 * `document.documentElement.scrollWidth > clientWidth` was asserted directly, once, straight
 * after an `expect(...).toBeVisible()`. That is a race, and it failed about one run in three
 * across `nn-signup.spec.ts` and `nn-entry.spec.ts` — two files, one assertion, always the
 * same shape.
 *
 * **`readyState` reaches `interactive` before the stylesheets are applied.** DOMContentLoaded
 * waits for scripts, not for `<link rel="stylesheet">`; with no blocking script on the page —
 * which is every page here in the `no-javascript` project, and the deferred-module case
 * everywhere else — it fires with both sheets still in flight. An element revealed by the
 * Worker is *visible* at that moment, so `toBeVisible()` resolves, and then
 * `page.evaluate(scrollWidth)` **forces a synchronous layout of a document that has no CSS**.
 * Reading a layout property is not gated on render-blocking; it just lays out what is there.
 *
 * Caught in the act, the sample reads:
 *
 * ```
 * overflow=19 scroll=339 client=320 ready=interactive sheets=[]
 *   a. left=8 right=339.13 w=331.13 :: nightingalenightmare@southvillerunningcl
 * ```
 *
 * `sheets=[]` is the whole story, and `left=8` is the corroboration — that is the browser's
 * default `body { margin: 8px }`, so the document is bare. The one thing that overflows a bare
 * 320px document is the club's 47-character address in a `mailto:` link, because
 * `a[href^='mailto:'] { overflow-wrap: anywhere }` lives in `base.css` and `base.css` has not
 * arrived. Milliseconds later it does, the address wraps, and the page is 320px wide for the
 * rest of its life.
 *
 * So the assertion was not finding a layout defect. It was measuring an unstyled document and
 * reporting the absence of CSS as a design failure — which is why re-running "fixed" it, and
 * why `main` and the branch both passed 190/190 on the second attempt.
 *
 * **This repository had already met it and paid for it twice.** `nn-privacy.spec.ts` and
 * `privacy.spec.ts` both carried a two-pass reload loop — *"an element laying out at its
 * intrinsic width before the stylesheet applied, about one run in four"* — which is the same
 * diagnosis and a retry for a fix. Both are single-pass now, waiting on this instead.
 *
 * ## Why waiting is a fix rather than a bigger retry
 *
 * It waits for a **defined state**, never for the assertion to come good: every
 * render-blocking stylesheet applied, the web fonts settled, and the measurement unchanged
 * across consecutive samples. A page whose *styled* layout scrolls sideways still fails, at
 * every width, exactly as before — the wait removes the vacuous measurement and nothing else.
 * Sampling until the number is the one you wanted would be the other thing entirely, and is
 * what this deliberately does not do.
 *
 * The three conditions are each load-bearing and none subsumes another:
 *
 * - **Stylesheets** is the one that was failing. `document.styleSheets` is populated as each
 *   sheet is applied, so counting it against the `<link rel="stylesheet">` elements in the
 *   document is a direct test of "is this page styled yet".
 * - **Fonts**, because `nn-theme.css` sets `font-display: swap` on all three faces. Text is
 *   laid out in a fallback until the real face arrives and then re-laid out at different
 *   metrics, and text width is precisely what these assertions are about. `document.fonts
 *   .status` reads `loaded` whenever the font set is *idle*, which includes before the
 *   stylesheet has asked for anything — so it is only meaningful alongside the check above,
 *   and only across more than one sample.
 * - **A number that has stopped moving**, as the general guard for whatever is not enumerated
 *   above: a late image, a scrollbar arriving with the last of the content. This repository
 *   has already lost a run to the `<img>` version of it, which is why the hands artwork is a
 *   CSS background now.
 *
 * ## Why the polling is on this side of the wire
 *
 * **`page.waitForFunction` cannot be used here, and that is not a style preference.** It works
 * by installing a polling loop *in the page*, so in the `no-javascript` project — which runs
 * every one of these tests, because progressive enhancement is the requirement rather than the
 * fallback — it never runs and every call times out at ten seconds. `page.evaluate` is fine
 * there (Playwright evaluates through the protocol rather than through the page's own script
 * execution), so the loop below is driven from Node and each sample is a single synchronous
 * expression. For the same reason nothing here schedules a `requestAnimationFrame`: its
 * callback would be page script too. Two samples fifty milliseconds apart is the substitute,
 * and it is the one that works in all three projects.
 */
const SETTLE_TIMEOUT_MS = 10_000;
const SETTLE_INTERVAL_MS = 50;
const SETTLED_SAMPLES = 3;

function readLayoutState() {
  const doc = document.documentElement;

  return {
    // `>=` rather than `===` at the call site: `document.styleSheets` also counts any
    // `<style>`, and a sheet whose `media` does not match is still applied — both make the
    // link count a lower bound rather than an equality.
    links: document.querySelectorAll('link[rel="stylesheet"]').length,
    sheets: document.styleSheets.length,
    fonts: document.fonts.status,
    overflow: doc.scrollWidth - doc.clientWidth,
  };
}

/**
 * Resolves once the page is styled, its fonts have settled, and its width has stopped moving.
 *
 * Falls through on timeout rather than throwing: whatever the caller measures next reports the
 * stylesheet count alongside its own failure, which is more use than a timeout that names
 * neither the page nor the reason.
 */
async function waitForStyledLayout(page: Page): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let previous: number | null = null;
  let agreements = 0;

  while (Date.now() < deadline) {
    const state = await page.evaluate(readLayoutState);
    const styled = state.links === 0 || state.sheets >= state.links;
    const settled = styled && state.fonts === 'loaded';

    if (settled && previous !== null && state.overflow === previous) {
      agreements += 1;
      if (agreements >= SETTLED_SAMPLES - 1) return;
    } else {
      agreements = 0;
    }

    previous = settled ? state.overflow : null;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
  }
}

/**
 * The document must not scroll sideways, measured once it is a styled document.
 *
 * `note` names the state under test and appears in the failure. `tolerance` is 0 by default: a
 * page either fits or it does not. `admin.spec.ts` and `nn-entry-complete.spec.ts` pass 1, for
 * the sub-pixel border on a fractional device ratio that is not a layout failure — the
 * reasoning is at their own call sites, and this helper does not have an opinion about which
 * of the two a given page deserves.
 *
 * **On failure it names what overflowed**, with the element's box, its computed wrapping, and
 * how many stylesheets were applied. The version this replaced reported `Expected: false,
 * Received: true` and nothing else, which is what made one run in three cost an afternoon
 * rather than a minute. A failure reporting zero stylesheets is this helper's own bug and not
 * the page's.
 */
export async function expectNoSidewaysScroll(
  page: Page,
  note: string,
  tolerance = 0,
): Promise<void> {
  await waitForStyledLayout(page);

  const measured = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    const round = (value: number) => Math.round(value * 100) / 100;

    for (const element of Array.from(document.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right <= doc.clientWidth + 0.01) continue;

      const styles = getComputedStyle(element);
      const classes =
        typeof element.className === 'string' && element.className !== ''
          ? `.${element.className}`
          : '';

      offenders.push(
        `${element.tagName.toLowerCase()}${classes}` +
          ` left=${round(box.left)} right=${round(box.right)} width=${round(box.width)}` +
          ` overflow-wrap=${styles.overflowWrap} white-space=${styles.whiteSpace}` +
          ` :: ${(element.textContent ?? '').trim().slice(0, 60)}`,
      );
    }

    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      clientWidth: doc.clientWidth,
      stylesheets: document.styleSheets.length,
      // The deepest few: an element that overflows drags every one of its ancestors into the
      // list, and the last ones are the ones that are actually too wide.
      offenders: offenders.slice(-5),
    };
  });

  expect(
    measured.overflow,
    `${note} scrolls sideways by ${measured.overflow}px at ${measured.clientWidth}px` +
      ` (${measured.stylesheets} stylesheets applied)` +
      (measured.offenders.length > 0 ? `\n  ${measured.offenders.join('\n  ')}` : ''),
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * The same wait, for a test that measures something of its own rather than the document.
 *
 * `nn-privacy.spec.ts` checks that three tables stay inside their card and that their rows
 * have stacked; `privacy.spec.ts` checks the widest block against the notice. Both readings
 * are as meaningless on an unstyled document as the overflow one — `display: block` on a table
 * row is a thing the stylesheet says — so both wait on this before they measure.
 *
 * **`account.spec.ts` is the third consumer, since 31 August 2026, and axe is the measurer.**
 * Everything in this file is written about `scrollWidth`, and none of it was ever specific to
 * overflow: an axe run reads the same unstyled document and reports the same absence of CSS as
 * a design failure. **`target-size` is the rule that catches it** — a link in an error summary
 * is 19px tall with no stylesheet and comfortably over the 24px minimum with one, so a bare
 * document fails a rule the styled page passes.
 *
 * That took CI red on #182 against an `account.spec.ts` assertion **byte-identical to the one
 * green on `main`**, in a run whose log also shows the web server dying mid-run — runner
 * pressure widening a race that was always there. **Fonts are the half that matters most to
 * axe**: a fallback face and the web font give different line boxes, so a target measured
 * mid-swap is measured at neither size.
 */
export { waitForStyledLayout };
