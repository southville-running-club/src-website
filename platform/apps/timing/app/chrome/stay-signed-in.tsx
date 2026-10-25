'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KEEP_ALIVE_MS,
  STAY_CHECK_MS,
  sendKeepAlive,
  shouldOfferStay,
} from '../../lib/keep-alive';
import { lastActivity, noteActivity, pageIsBeingWorkedOn } from '../../lib/page-activity';

/**
 * Keeps somebody working on a staff page under `/timing` signed in, and asks before it lets
 * them go — every page `AppShell` draws except the capture screen, which has its own.
 *
 * ## The problem, which was worse here than on the capture screen
 *
 * ⚠️ **These pages renewed nothing at all.** Cloudflare sends `/timing/*` to the timing Worker,
 * which reads the session and never writes one (`middleware.ts`), so a volunteer working only on
 * `/timing` sent the club's Worker nothing — and ADR-019's thirty minutes ran from the last page
 * they had opened on the club's own site, **however busy they were in here**. On race morning
 * that is whoever has the Start page or the Anomalies list open from the laptop, and the live
 * board, which may be open for two hours, went dead half an hour in. The capture screen was
 * given a keep-alive by #244; nothing else was.
 *
 * ## What it does — `lib/keep-alive.ts` has the numbers and their argument
 *
 * - **A keep-alive when the page opens, every five minutes, and when the page comes back into
 *   view** — only while the page counts as worked on: visible, and a tap or key in the last
 *   twenty-five minutes. Opening the page counts.
 * - **"Still there?" after twenty minutes with nothing touched**, with one button. Pressing it,
 *   or touching anything else, answers it. Nothing about ADR-019's idle window is widened: a
 *   page nobody is near still lapses, which on the live board means somebody taps it about
 *   once every half hour.
 *
 * ## Two things about the bar that are load-bearing
 *
 * ⚠️ **It is fixed to the bottom of the screen and takes no space**, so appearing moves
 * nothing: on the Start page, a bar that pushed the page down at the moment somebody reached
 * for the gun would move the gun.
 *
 * ⚠️ **A press on the bar is never treated as a press elsewhere.** Any tap answers the prompt,
 * and answering it removes the bar — so if the bar's own `pointerdown` removed it, the `click`
 * that follows would land on whatever the bar had been covering. On the Start page that could
 * be the button that starts the race. The bar answers to its own button's `click` alone.
 *
 * With scripting off this renders nothing and does nothing, and the page lapses as it always
 * did: these pages are plain forms, and a keep-alive needs a script.
 */
export function StaySignedIn() {
  const [offer, setOfferState] = useState(false);
  // Read by the activity listener, which is installed once and must see the current answer —
  // and kept beside the state rather than derived inside an updater, which React may run twice.
  const offerRef = useRef(false);
  const setOffer = useCallback((next: boolean) => {
    offerRef.current = next;
    setOfferState(next);
  }, []);

  /** One keep-alive, if somebody is working on this page and there is a network. */
  const keepAliveIfWorking = useCallback(() => {
    if (!navigator.onLine || !pageIsBeingWorkedOn()) {
      return;
    }
    void sendKeepAlive();
  }, []);

  useEffect(() => {
    // Opening the page is activity. Said to the club's Worker at once, because the cookies this
    // page arrived with may have only a few minutes left — nothing on `/timing` slides them.
    noteActivity();
    keepAliveIfWorking();

    const onActivity = (event: Event) => {
      // See the header: the bar answers to its own button's click, never to a press.
      if (
        event.target instanceof Element &&
        event.target.closest('[data-stay-signed-in]')
      ) {
        return;
      }
      noteActivity();
      if (offerRef.current) {
        // A tap that answers the prompt late may come after the poll has stopped, so it renews
        // at once rather than at the next tick.
        void sendKeepAlive();
        setOffer(false);
      }
    };

    const check = () => {
      if (shouldOfferStay(lastActivity(), Date.now())) {
        setOffer(true);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        keepAliveIfWorking();
        check();
      }
    };

    document.addEventListener('pointerdown', onActivity, {
      capture: true,
      passive: true,
    });
    document.addEventListener('keydown', onActivity, { capture: true });
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(keepAliveIfWorking, KEEP_ALIVE_MS);
    const prompt = window.setInterval(check, STAY_CHECK_MS);

    return () => {
      document.removeEventListener('pointerdown', onActivity, { capture: true });
      document.removeEventListener('keydown', onActivity, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
      window.clearInterval(prompt);
    };
  }, [keepAliveIfWorking, setOffer]);

  const stay = useCallback(() => {
    noteActivity();
    setOffer(false);
    void sendKeepAlive();
  }, [setOffer]);

  if (!offer) {
    return null;
  }

  return (
    <div className="timing-stay-bar" role="alert" data-stay-signed-in="">
      <div className="club-wrap timing-stay-bar-inner">
        <p>
          <strong>Still there?</strong> Nothing has happened on this page for a while, and
          the club&rsquo;s site will sign you out soon if that carries on.
        </p>
        <button type="button" className="club-btn club-btn-primary" onClick={stay}>
          Keep me signed in
        </button>
      </div>
    </div>
  );
}
