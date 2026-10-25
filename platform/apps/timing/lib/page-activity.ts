import { isActive } from './keep-alive';

/**
 * When somebody last did something on this page — the one clock every staff page under
 * `/timing` judges the keep-alive against, and the live board's retry with it.
 *
 * ## Why module state, which nothing else in this app keeps
 *
 * Two components on one page need the same answer: `app/chrome/stay-signed-in.tsx`, which
 * notices the taps and sends the keep-alive, and the live board, whose re-read retries through
 * the door only while the page counts as worked on (`throughDoor()` in `lib/keep-alive.ts`). A
 * clock in one component's state cannot be read by the other, and passing it down would thread
 * a ref through the frame into every page. One variable in the browser's copy of this module
 * is the whole of it.
 *
 * ⚠️ **Browser only.** On the server this module is imported and never asked anything: the
 * value it starts with is never read, so nothing about one request can leak into another.
 *
 * ⚠️ **The capture screen keeps its own clock** (`marshal-screen.tsx`), because it was built
 * first and counts its own taps; `AppShell` leaves `StaySignedIn` off that page, so the two are
 * never on one page together.
 */

let lastActivityAt = Date.now();

/** Somebody did something: a tap or a key anywhere on the page, or the page being opened. */
export function noteActivity(now: number = Date.now()): void {
  lastActivityAt = now;
}

/** When that last was, in epoch milliseconds. */
export function lastActivity(): number {
  return lastActivityAt;
}

/**
 * ADR-019's "working on it": visible, and a tap in the last twenty-five minutes. The same test
 * the capture screen asks of itself, so race control and the line are held to one rule.
 */
export function pageIsBeingWorkedOn(now: number = Date.now()): boolean {
  return document.visibilityState === 'visible' && isActive(lastActivityAt, now);
}
