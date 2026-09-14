import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { waitForStyledLayout } from './sideways-scroll';

/**
 * Axe, run once the page is actually a styled page, against one rule set.
 *
 * ## Three rule sets were live, and none of the difference was deliberate
 *
 * [#219](https://github.com/southville-running-club/src-website/issues/219). Before this file
 * there were **39 call sites and three configurations**: thirty-one on five WCAG tags, three
 * in `events.spec.ts` on four, and five in `account.spec.ts` on none at all. `account.spec.ts`
 * carried two of the three in one file — its own wrapper passed five tags and five direct
 * calls beside it passed none, with a comment saying routing them through the wrapper *"would
 * quietly change what they assert"*. That was true, and it was the whole problem: nobody knew
 * in which direction.
 *
 * ## ⚠️ The issue's own recommendation would have narrowed five sites rather than widening them
 *
 * #219 proposed the five WCAG tags everywhere, as *"the majority and the strictest"*. Measured
 * against `axe-core` 4.12.1, the majority is right and the strictest is backwards:
 *
 * | configuration | rules |
 * | --- | --- |
 * | no `withTags()` — `account.spec.ts`'s five bare calls | **105** |
 * | `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']` | **70** |
 * | the same without `wcag22aa` — `events.spec.ts`'s three | **69** |
 *
 * **The default set is a strict superset**: there is not one rule in the five-tag list that
 * axe does not already run by default. So applying the five tags to `account.spec.ts` would
 * have taken the account area from 105 rules to 70 — dropping `heading-order`,
 * `landmark-one-main`, `region`, `skip-link`, `page-has-heading-one`, `empty-heading` and
 * twenty-nine others — in a change whose stated purpose was to enforce *more*. `wcag22aa` adds
 * exactly one rule, `target-size`, so the four-tag sites were a real gap and a small one.
 *
 * ## So the list is the five tags plus `best-practice` — 100 rules
 *
 * The five the default set has and this does not are left out on purpose:
 *
 * | rule | why not |
 * | --- | --- |
 * | `color-contrast-enhanced`, `identical-links-same-purpose`, `meta-refresh-no-exceptions` | **WCAG AAA.** Holding the whole site to AAA is a decision the club has not taken. `nn-theme.css` aiming at 7:1 in places is not the same as the site committing to it everywhere, and the difference is a policy question rather than a build one |
 * | `duplicate-id`, `duplicate-id-active` | **Deprecated by axe itself**, tagged `wcag2a-obsolete`: WCAG 2.2 removed success criterion 4.1.1. Pinning the suite to a rule its own vendor has retired is a future failure with no fix |
 *
 * ⚠️ **`account.spec.ts`'s sign-in page was relying on `duplicate-id-active`** — its comment
 * names a duplicate id as the thing most likely to go wrong there, two email fields and two
 * Turnstile widgets on one page. That concern is real and it does not survive a deprecated
 * rule, so that spec asserts unique ids directly instead. A named assertion beats a rule that
 * happens to cover it.
 *
 * ## Why the wait is here and not at each call site
 *
 * **An axe run on a bare document reports the absence of CSS as a design failure**, which is
 * the defect `sideways-scroll.ts` was written for, one assertion type along. `readyState`
 * reaches `interactive` before `<link rel="stylesheet">` has landed — DOMContentLoaded waits
 * for scripts, not sheets — so an outcome block the Worker has revealed is already *visible*,
 * `toBeVisible()` resolves, and axe then measures a document with no CSS on it.
 *
 * **`target-size` is the rule that catches it, and it caught CI on #182.** A link in the error
 * summary is 19px tall unstyled and comfortably past the 24px minimum once `base.css` applies,
 * so the bare page fails a rule the real page passes. That failure named an `account.spec.ts`
 * assertion **byte-identical to the one green on `main`**, in a run whose log also shows the
 * web server dying mid-run — runner pressure widening a race that was always there.
 *
 * **The fonts matter more here than they do for overflow.** A fallback face and the web font
 * give different line boxes, so a target measured mid-swap is measured at neither size.
 *
 * ## What this is not
 *
 * It waits for a **defined state** — sheets applied, fonts settled, layout stopped moving —
 * never for the violation list to come good. A page whose styled state really does violate a
 * rule fails exactly as before. Retrying until the answer is the wanted one is the other thing
 * entirely, and `sideways-scroll.ts`'s header is written against it.
 *
 * **Zero, not "few".** Any threshold above zero becomes the new normal within a month.
 */
export const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

/** The violations on this page, once it is a styled page. Empty is the only passing answer. */
export async function axeViolations(page: Page) {
  await waitForStyledLayout(page);

  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  return violations;
}
