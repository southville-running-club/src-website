import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_WINDOW_MS } from '../../lib/keep-alive';
import { lastActivity, noteActivity, pageIsBeingWorkedOn } from '../../lib/page-activity';

/**
 * The one clock every staff page under `/timing` is judged against — `lib/page-activity.ts`,
 * 25 October 2026. The prompt and the poll are `app/chrome/stay-signed-in.tsx`'s and are driven
 * in a browser by `apps/main/tests/e2e/timing.spec.ts`; what is here is the rule.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function pageIs(visibilityState: 'visible' | 'hidden'): void {
  vi.stubGlobal('document', { visibilityState });
}

describe('the page activity clock', () => {
  it('remembers the last thing somebody did', () => {
    noteActivity(1_000);
    expect(lastActivity()).toBe(1_000);
  });

  it("counts a visible page touched in the last twenty-five minutes as worked on, ADR-019's rule", () => {
    pageIs('visible');
    noteActivity(0);

    expect(pageIsBeingWorkedOn(ACTIVE_WINDOW_MS)).toBe(true);
    expect(pageIsBeingWorkedOn(ACTIVE_WINDOW_MS + 1)).toBe(false);
  });

  /**
   * A hidden page is nobody's: a laptop lid closed on the Start page must not go on renewing a
   * session, however recently it was touched.
   */
  it('never counts a hidden page as worked on', () => {
    pageIs('hidden');
    noteActivity(0);

    expect(pageIsBeingWorkedOn(0)).toBe(false);
  });
});
