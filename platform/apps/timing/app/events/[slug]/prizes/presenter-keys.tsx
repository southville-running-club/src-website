'use client';

import { useEffect } from 'react';

/**
 * The presenter's keys — ← and → between prizes, Enter to reveal — as Pass the Buck's had.
 *
 * A convenience over links already on the page: each key follows the same address its link does,
 * so with scripting off the presenter still works by tapping. Ignored while somebody is typing in
 * a field, and when a modifier is held, so the browser's own shortcuts still work.
 */
export function PresenterKeys({
  prev,
  next,
  reveal,
}: {
  prev: string | null;
  next: string | null;
  reveal: string | null;
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
      window.location.assign(to);
    };
    window.addEventListener('keydown', onKey);
    // Says the keys are live, for a test that would otherwise press one before they are.
    document.documentElement.dataset.presenterKeys = 'on';
    return () => {
      window.removeEventListener('keydown', onKey);
      delete document.documentElement.dataset.presenterKeys;
    };
  }, [prev, next, reveal]);

  return null;
}
