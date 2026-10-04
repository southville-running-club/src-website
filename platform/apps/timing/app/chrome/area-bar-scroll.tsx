'use client';

import { useEffect } from 'react';

/**
 * On a phone the area bar scrolls sideways, and the tab somebody is on can start off-screen —
 * the problem the brief found on today's bar, where only "Overview" was visible (§6.2 #1). This
 * scrolls the bar itself, never the page, so the current tab is in view on load.
 *
 * **Sets `scrollLeft` on the bar rather than calling `scrollIntoView()`**, which can also move
 * the page vertically on some engines. Renders nothing; with scripting off the bar starts at its
 * first tab, as it always has.
 */
export function AreaBarScroll() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(
      '.app-area-bar .club-section-inner',
    );
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    const left = current.offsetLeft - (scroller.clientWidth - current.offsetWidth) / 2;
    scroller.scrollLeft = Math.max(0, left);
  }, []);

  return null;
}
