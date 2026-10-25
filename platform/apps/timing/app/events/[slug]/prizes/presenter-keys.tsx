'use client';

import { useEffect } from 'react';
import { withSpin } from '../../../../lib/prize-reel';
import { motionAllowed } from './presenter-reel';

/**
 * The presenter's keys — ← and → between prizes, Enter to reveal — as Pass the Buck's had.
 *
 * A convenience over links already on the page: each key follows the same address its link does,
 * so with scripting off the presenter still works by tapping. Ignored while somebody is typing in
 * a field, and when a modifier is held, so the browser's own shortcuts still work.
 *
 * **Enter spins the reveal the way a click on Reveal does** (`presenter-reel.tsx`), and goes
 * straight to the winner for a browser that asks for less motion.
 */
export function PresenterKeys({
  prev,
  next,
  reveal,
  spin = false,
}: {
  prev: string | null;
  next: string | null;
  reveal: string | null;
  /** Whether the reveal has reels to spin — false for a winner with no number yet. */
  spin?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      const to =
        event.key === 'ArrowLeft'
          ? prev
          : event.key === 'ArrowRight'
            ? next
            : event.key === 'Enter' &&
                target?.tagName !== 'A' &&
                target?.tagName !== 'BUTTON'
              ? reveal
              : null;
      if (to === null) return;
      event.preventDefault();
      window.location.assign(
        to === reveal && spin && motionAllowed() ? withSpin(to) : to,
      );
    };
    window.addEventListener('keydown', onKey);
    // Says the keys are live, for a test that would otherwise press one before they are.
    document.documentElement.dataset.presenterKeys = 'on';
    return () => {
      window.removeEventListener('keydown', onKey);
      delete document.documentElement.dataset.presenterKeys;
    };
  }, [prev, next, reveal, spin]);

  return null;
}
