'use client';

// **`layout.tsx` never runs here.** `global-error.tsx` replaces the whole root layout tree,
// which is why it draws its own `<html>` and `<body>` below — and why it needs its own
// import of the stylesheet rather than inheriting one. Without this line a race-night error
// page rendered in browser defaults: serif type, blue links, no brand at all, on the one
// page most likely to be seen while somebody is standing at a finish line.
import '@src/shared/styles/base.css';
import '@src/shared/styles/club-chrome.css';
import './styles/club-content.css';
import './styles/timing.css';
import { PlainFrame } from './chrome/app-shell';

/**
 * The last-resort error boundary — it replaces the whole document, so it renders its own
 * `<html>` and `<body>`.
 *
 * Defined explicitly rather than left to Next's built-in default, for two reasons. The
 * default fails to prerender in this combination of Next 16 and React 19, which is what
 * surfaced it; and a race-night error page saying something useful is worth more than a
 * stack trace, because the person reading it will be standing at a finish line.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body>
        {/* The plain shell, ADR-054 — the mark and the footer, the not-found page's frame.
            It reads nothing, because this is a client component and the session reads in
            `lib/reads.ts` cannot run here. `PlainFrame` draws `<main id="main">`. */}
        <PlainFrame>
          <h1>Something went wrong</h1>
          <p>
            The page could not be loaded. Nothing captured has been lost — try again, and
            if it keeps happening, tell whoever is running the timing.
          </p>
          <button type="button" className="button" onClick={reset}>
            Try again
          </button>
        </PlainFrame>
      </body>
    </html>
  );
}
