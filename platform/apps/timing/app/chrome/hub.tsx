import type { ReactNode } from 'react';
import { timingHref, type HubGroup } from '../../lib/chrome';

/**
 * Pass the Buck's Home hub, in the club's colours — ADR-055.
 *
 * Club green from edge to edge, the content left-aligned in a column: a small eyebrow, the race
 * in large type ending in a full stop, **one status line** that says where the race has got to,
 * the live board as the primary button, who is signed in, and then the tools this person may
 * use as full-width buttons — race-night tools solid, setup and after-the-race outline.
 *
 * ⚠️ **The tools come from `hubTools()`**, which is built from the nav's own tabs, so a button
 * here is exactly a tab there and exactly what the door would open.
 *
 * ⚠️ **Ink on green, never white**: `--club-on-brand` on `--club-brand` is 5.07:1, white on it
 * is 3.5:1 and fails for body text. The dark buttons are the page's ink as a fill.
 *
 * **No Sign out**, because signing out is a POST with a token only the club's own site issues
 * (HALT 2). Your account, where the button is, is the link at the foot instead.
 */
export function Hub({
  eyebrow,
  title,
  status,
  live,
  signedInAs,
  roleWord,
  groups,
  children,
}: {
  eyebrow: string;
  title: string;
  status: ReactNode;
  /** The live board's path, when this person may open it. */
  live: string | null;
  signedInAs: string | null;
  /** "admin" or "marshal" — what this person is here, in one word. */
  roleWord: string | null;
  groups: readonly HubGroup[];
  /** Anything a particular hub adds below its tools. */
  children?: ReactNode;
}) {
  return (
    <div className="club-wrap timing-hub">
      <p className="timing-hub-eyebrow">{eyebrow}</p>
      <h1 className="timing-hub-title">{title}</h1>
      <div className="timing-hub-status">{status}</div>

      {live === null ? null : (
        <p className="timing-hub-primary">
          <a
            className="club-btn timing-btn-dark timing-hub-button"
            href={timingHref(live)}
          >
            Live results
          </a>
        </p>
      )}

      {signedInAs === null ? null : (
        <p className="timing-hub-who">
          Signed in as <strong>{signedInAs}</strong>
          {roleWord === null ? null : <> ({roleWord})</>}
        </p>
      )}

      {groups.map((group) => (
        <nav
          key={group.key}
          className="timing-hub-group"
          data-group={group.key}
          aria-label={
            group.key === 'race-night'
              ? 'Race night'
              : group.key === 'setup'
                ? 'Setting up'
                : 'After the race'
          }
        >
          <ul>
            {group.tools.map((tool) => (
              <li key={tool.key}>
                <a
                  className={
                    group.key === 'race-night'
                      ? 'club-btn timing-btn-dark timing-hub-button'
                      : 'club-btn timing-hub-outline timing-hub-button'
                  }
                  href={timingHref(tool.path)}
                >
                  {tool.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ))}

      {children}

      <p className="timing-hub-account">
        <a href="/account/">Your account</a>
      </p>
    </div>
  );
}

/** "Nightingale Nightmare 2026" as a hub's title: the year comes off, a full stop goes on. */
export function hubTitle(name: string): string {
  return `${name.replace(/\s+\d{4}$/u, '').trim()}.`;
}
