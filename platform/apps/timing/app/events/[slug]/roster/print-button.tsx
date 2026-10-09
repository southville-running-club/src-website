'use client';

import { useEffect, useState } from 'react';

/**
 * **Print** — `window.print()`, which needs scripting, so the button is not drawn until the
 * page has it. With scripting off the browser's own Print still uses the print stylesheet, which
 * is where the Collected ✓ column and the rest of the paper sheet live.
 */
export function PrintButton() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready) return null;

  return (
    <button
      type="button"
      className="club-btn club-btn-secondary timing-roster-tool"
      onClick={() => window.print()}
    >
      Print
    </button>
  );
}
