'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '../../../../../lib/elapsed';

/**
 * The ticking half of the start screen — the countdown to a start, and the clock since one.
 *
 * ## ⚠️ Progressive enhancement, and the fallback is not a placeholder
 *
 * **A clock that ticks needs JavaScript, and this page must still be true and useful without
 * it.** Every Playwright project in this repository includes `no-javascript`, and a volunteer
 * on a cold morning on a phone with a bad connection is the person this screen exists for. So
 * the fallback the caller passes as `children` is **the real content of this element until the
 * clock takes over** — a sentence naming the actual moment, in `Europe/London`, rendered on the
 * server. It is not "Loading…", and it is not hidden.
 *
 * ⚠️ **Nothing that matters is only in the tick.** The scheduled start, the moment the gun went
 * and whether the race is running are all rendered by the page itself in plain markup; this
 * element adds *how long*, which is convenience rather than fact. **Starting the race is a
 * plain `<form method="post">` and does not go near this component** — a clock reaching zero
 * starts nothing, which is the migration's own rule and is why there is no submit in here.
 *
 * ## Why the first render is deliberately the fallback
 *
 * `useState(null)` and a `useEffect` that sets the time, rather than reading the clock during
 * render. The server has no idea what `Date.now()` will be in the browser, so rendering a
 * duration on both sides is a guaranteed hydration mismatch — React would discard the markup
 * and warn. Rendering the fallback on both sides and swapping *after* mount is the version
 * where the server's HTML is correct HTML and the enhancement is additive.
 *
 * ## `role="timer"` rather than a live region
 *
 * A `status` or `alert` region announces its content every time it changes, which for a clock
 * is every second — a screen reader would be unusable on this page. `timer` is the role ARIA
 * defines for exactly this (a numerical counter of elapsed time) and its implicit `aria-live`
 * is `off`; the explicit attribute is here so nobody "fixes" it to `polite` on the way past.
 * The caption beside it is ordinary text, so the state of the race is readable without ever
 * polling the clock.
 */
export type ClockMode = 'countdown' | 'elapsed';

export function RaceClock({
  mode,
  atIso,
  children,
}: {
  mode: ClockMode;
  /** The instant being counted to, or from. ISO 8601 with an offset, as Postgres returns. */
  atIso: string;
  /** What this element says on the server, and with scripting off. Never a placeholder. */
  children: React.ReactNode;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const target = Date.parse(atIso);
    if (Number.isNaN(target)) {
      // An unparseable timestamp leaves the server's sentence in place rather than rendering
      // `NaN` over it. The page's own markup still names the moment.
      return;
    }

    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);

    return () => window.clearInterval(id);
  }, [atIso]);

  if (now === null) {
    return <p>{children}</p>;
  }

  const target = Date.parse(atIso);
  const ahead = target - now;

  // Two captions per mode, because the sign is what the words carry: `formatDuration` clamps
  // to zero and renders no sign, deliberately, since `-00:04:12` does not say whether the
  // start is coming or gone.
  const caption =
    mode === 'elapsed'
      ? 'Elapsed since the race started.'
      : ahead > 0
        ? 'Until the scheduled start.'
        : 'Past the scheduled start. A clock reaching zero starts nothing — the button below does.';

  const magnitude = mode === 'elapsed' ? -ahead : Math.abs(ahead);

  return (
    <>
      <p className="race-clock" role="timer" aria-live="off">
        {formatDuration(magnitude)}
      </p>
      <p>{caption}</p>
    </>
  );
}
