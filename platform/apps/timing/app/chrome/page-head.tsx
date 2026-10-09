import type { ReactNode } from 'react';
import { formatLondonClock } from '@src/shared';

/**
 * The top of every standard timing page, in Pass the Buck's order — ADR-055:
 *
 * 1. **Eyebrow** — small, upper-case, letter-spaced: where this page is. Upper-cased in CSS, so a
 *    screen reader reads the race's name rather than spelling capitals out.
 * 2. **H1** — one or two words ending in a full stop: "Anomalies.", "Timing log."
 * 3. **Intro** — one short paragraph: what the page is for, and what to do on it.
 * 4. **Status row** — a count, and when it was read, in monospace on the left; a **Refresh**
 *    on the right.
 *
 * **Refresh is a link to this page, not a script.** Every page here is rendered on the server
 * per request, so following the link is a re-read — and it works with scripting off, which every
 * acceptance spec here runs.
 *
 * **"Updated" is the time the page was read, in London**, rather than Pass the Buck's "just
 * now", which becomes untrue the moment the page is left open on a laptop at the finish.
 */
export function PageHead({
  eyebrow,
  title,
  intro,
  status,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  status?: { count: string; refresh: string };
}) {
  return (
    <header className="timing-phead">
      <p className="timing-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {intro === undefined ? null : <div className="timing-intro">{intro}</div>}
      {status === undefined ? null : (
        <div className="timing-statusrow">
          <p className="timing-statusrow-text">
            {status.count}
            <span aria-hidden="true"> · </span>
            <span className="timing-statusrow-when">
              updated {formatLondonClock(new Date())}
            </span>
          </p>
          <a className="club-btn club-btn-secondary" href={status.refresh}>
            Refresh
          </a>
        </div>
      )}
    </header>
  );
}

/** The eyebrow a race's admin pages carry: "Admin · Nightingale Nightmare 2026". */
export function raceEyebrow(name: string | null): string {
  return name === null ? 'Admin' : `Admin · ${name}`;
}
