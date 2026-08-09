'use client';

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
        <main>
          <h1>Something went wrong</h1>
          <p>
            The page could not be loaded. Nothing captured has been lost — try again, and
            if it keeps happening, tell whoever is running the timing.
          </p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
