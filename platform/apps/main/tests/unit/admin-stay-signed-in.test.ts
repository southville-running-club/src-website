import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  KEEP_ALIVE_MS,
  STAY_CHECK_MS,
  STAY_PROMPT_AFTER_MS,
  staySignedIn,
} from '../../worker/admin-stay-signed-in';
import { IDLE_TIMEOUT_SECONDS } from '../../worker/session';

/**
 * "Still there? Keep me signed in" on `/admin/` — `worker/admin-stay-signed-in.ts`,
 * 25 October 2026. Where it appears is `tests/worker/admin/admin.test.ts`'s, and what it does
 * in a browser is `tests/e2e/admin.spec.ts`'s; what is here is the rule and the script itself.
 */

const MINUTE = 60_000;

describe('the numbers', () => {
  it("counts twenty-five minutes since the last tap as working, ADR-019's number", () => {
    expect(ACTIVE_WINDOW_MS).toBe(25 * MINUTE);
  });

  it('asks before the keep-alive stops, with at least one poll in between', () => {
    expect(STAY_PROMPT_AFTER_MS).toBeLessThan(ACTIVE_WINDOW_MS);
    expect(ACTIVE_WINDOW_MS - STAY_PROMPT_AFTER_MS).toBeGreaterThanOrEqual(KEEP_ALIVE_MS);
  });

  /**
   * How long somebody has to notice the prompt: the last poll goes out after
   * `ACTIVE_WINDOW_MS - KEEP_ALIVE_MS`, and the session lasts the idle window after it.
   */
  it('leaves at least a quarter of an hour to answer it', () => {
    const earliestEnd = ACTIVE_WINDOW_MS - KEEP_ALIVE_MS + IDLE_TIMEOUT_SECONDS * 1000;
    expect(earliestEnd - STAY_PROMPT_AFTER_MS).toBeGreaterThanOrEqual(15 * MINUTE);
  });

  it('checks for the prompt often enough to be on time', () => {
    expect(STAY_CHECK_MS).toBeLessThanOrEqual(MINUTE);
  });
});

describe('the markup', () => {
  const markup = staySignedIn().toString();

  it('starts hidden, so a page with scripting off is the page it always was', () => {
    expect(markup).toMatch(/<div class="admin-stay-bar"[^>]*data-stay-signed-in hidden>/);
  });

  it('carries the numbers into the script rather than a second copy of them', () => {
    expect(markup).toContain(`var KEEP_ALIVE_MS = ${KEEP_ALIVE_MS};`);
    expect(markup).toContain(`var ACTIVE_WINDOW_MS = ${ACTIVE_WINDOW_MS};`);
    expect(markup).toContain(`var STAY_PROMPT_AFTER_MS = ${STAY_PROMPT_AFTER_MS};`);
  });

  it("calls this Worker's own keep-alive, which slides the window as a page load does", () => {
    expect(markup).toContain("fetch('/account/keep-alive/'");
  });

  /**
   * A syntax error in an inline script fails silently on every admin page at once, and nothing
   * else would notice: the page still renders. Compiled here, never run.
   */
  it('is a script that compiles', () => {
    const script = /<script data-stay-signed-in-script>([\s\S]*?)<\/script>/.exec(
      markup,
    )?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
  });
});
