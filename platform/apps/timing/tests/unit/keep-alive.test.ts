import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  KEEP_ALIVE_MS,
  KEEP_ALIVE_PATH,
  STAY_PROMPT_AFTER_MS,
  isActive,
  sendKeepAlive,
  shouldOfferStay,
  throughDoor,
} from '../../lib/keep-alive';

/**
 * Keeping a working marshal signed in — `lib/keep-alive.ts`, 25 October 2026.
 *
 * Two gaps signed a marshal out mid-race: the wait before the first runner, when nothing is
 * tapped for long enough that the keep-alive stopped, and an access token that expired between
 * two polls and made the door refuse a session that was still alive. What only a browser can
 * show is in `apps/main/tests/e2e/timing.spec.ts`; the rules are here.
 */

const MINUTE = 60_000;

/** ADR-019's idle window, restated: `IDLE_TIMEOUT_SECONDS` in `apps/main/worker/session.ts`. */
const IDLE_WINDOW_MS = 30 * MINUTE;

describe('what counts as being worked on', () => {
  it('is twenty-five minutes from the last tap, and not a moment more', () => {
    expect(isActive(0, 0)).toBe(true);
    expect(isActive(0, 25 * MINUTE)).toBe(true);
    expect(isActive(0, 25 * MINUTE + 1)).toBe(false);
  });

  it("is ADR-019's number, which this change deliberately did not widen", () => {
    expect(ACTIVE_WINDOW_MS).toBe(25 * MINUTE);
  });
});

describe('the "Keep me signed in" prompt', () => {
  it('appears after twenty minutes with nothing tapped', () => {
    expect(shouldOfferStay(0, 20 * MINUTE - 1)).toBe(false);
    expect(shouldOfferStay(0, 20 * MINUTE)).toBe(true);
  });

  /**
   * ⚠️ **The prompt has to arrive while the keep-alive is still running**, or it would be asking
   * about a session that had already stopped being renewed — and there has to be at least one
   * poll between the two, so the window is still being slid while it is on screen.
   */
  it('appears at least one poll before the keep-alive stops', () => {
    expect(ACTIVE_WINDOW_MS - STAY_PROMPT_AFTER_MS).toBeGreaterThanOrEqual(KEEP_ALIVE_MS);
  });

  /**
   * **How long a marshal has to notice it.** The last poll goes out somewhere after
   * `ACTIVE_WINDOW_MS - KEEP_ALIVE_MS`, and the cookies last ADR-019's thirty minutes after it.
   * A quarter of an hour is the floor this asserts; the real figure is about half an hour.
   */
  it('leaves at least a quarter of an hour before the session can end', () => {
    const earliestEnd = ACTIVE_WINDOW_MS - KEEP_ALIVE_MS + IDLE_WINDOW_MS;
    expect(earliestEnd - STAY_PROMPT_AFTER_MS).toBeGreaterThanOrEqual(15 * MINUTE);
  });
});

describe('the keep-alive', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("calls the club's Worker, never this one, and never from a cache", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await sendKeepAlive();

    expect(fetchMock).toHaveBeenCalledWith('/account/keep-alive/', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(KEEP_ALIVE_PATH.startsWith('/account/')).toBe(true);
  });

  it('never throws — no signal is an ordinary morning on a course', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(sendKeepAlive()).resolves.toBeUndefined();
  });
});

describe('a request through the door', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const status = (code: number) => new Response(null, { status: code });

  it('is sent once and left alone when the door lets it in', async () => {
    const send = vi.fn().mockResolvedValue(status(200));

    const response = await throughDoor(send, () => true);

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **The case that used to tell a working marshal they had been signed out.** The token
   * expired a minute ago inside a live session; one keep-alive renews it, and the retry gets in.
   */
  it('is retried once after a keep-alive when the door refuses it', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(status(404))
      .mockResolvedValueOnce(status(200));

    const response = await throughDoor(send, () => true);

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(KEEP_ALIVE_PATH, expect.anything());
  });

  /**
   * **The retry must not hide a real refusal.** A session that has ended, or a marshal taken off
   * the roster, still comes back as a 404 — once, not in a loop — and the screen says so.
   */
  it('hands back the refusal when the retry is refused too, and tries no more', async () => {
    const send = vi.fn().mockResolvedValue(status(404));

    const response = await throughDoor(send, () => true);

    expect(response.status).toBe(404);
    expect(send).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **A page nobody is working on gets no keep-alive from a retry either**, or a stuck queue
   * on an idle phone would hold a session open that ADR-019 says should lapse.
   */
  it('sends no keep-alive for a page that is not being worked on', async () => {
    const send = vi.fn().mockResolvedValue(status(404));

    const response = await throughDoor(send, () => false);

    expect(response.status).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry anything that is not a refusal', async () => {
    const send = vi.fn().mockResolvedValue(status(503));

    const response = await throughDoor(send, () => true);

    expect(response.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
