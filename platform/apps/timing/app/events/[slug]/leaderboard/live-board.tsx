'use client';

import { useEffect, useState } from 'react';
import { formatLondonClock } from '@src/shared';
import { formatDuration } from '@src/shared/timing/results';
import {
  buildLeaderboard,
  type Leaderboard,
  type LeaderboardRow,
} from '@src/shared/timing/leaderboard';
import type { LeaderboardPayload } from '../../../../lib/leaderboard';
import {
  boardCaveats,
  CONNECTION_WORDS,
  fieldSummary,
  statusWords,
  SUSPECT_WORDS,
  type ConnectionState,
} from '../../../../lib/leaderboard-outcomes';

/**
 * The board itself — [#204](https://github.com/southville-running-club/src-website/issues/204).
 *
 * ## ⚠️ One component, rendered twice, and that is the whole no-JavaScript answer
 *
 * A client component in the App Router is **server-rendered for the initial HTML** and then
 * hydrated. So this file renders a complete, correct table into the response — the board as it
 * stood when the page was requested — and only *afterwards* does anything happen in a browser.
 *
 * With scripting off, `useEffect` never runs: no socket, no fetch, and the table stays exactly
 * what the server sent. ⚠️ **That is the fallback, and it is a snapshot rather than a sentence.**
 * The marshal capture screen is this platform's one surface that genuinely needs JavaScript
 * — an offline IndexedDB queue has nothing to degrade to — and its no-script fallback is
 * therefore a *sentence* telling a marshal to use paper. A leaderboard is not like that: a board
 * that does not move is still a board, so what the no-script case gets is the real thing, plus
 * `CONNECTION_WORDS.off` saying to reload for more. The two surfaces differ because what they
 * degrade to differs, not because the rule does.
 *
 * ⚠️ **So a second, server-only copy of this table must never be written.** Two implementations
 * of one table is how the snapshot and the live view come to disagree about who is winning, and
 * the whole reason `buildLeaderboard()` is pure is that one function can answer both.
 *
 * ## What comes down the socket, and what does not
 *
 * A nudge: `{"type":"changed"}` and a sequence number, and **never a row, a name or a time**.
 * `durable-objects/leaderboard-room.ts` carries the reasoning — a message holding the race would
 * be a second read of it, with its own authorisation to get right. This component answers a nudge
 * by re-reading the snapshot endpoint, which is an ordinary route handler behind `middleware.ts`,
 * so there is exactly one permissioned read of a race in the application.
 *
 * ⚠️ **A refused snapshot stops the board rather than emptying it.** If the session lapsed
 * mid-race the fetch answers 404, and the honest thing is to keep showing the last good board and
 * say it has stopped — clearing the table would tell a volunteer the field had vanished.
 */

/** How long to wait before trying the socket again after it closes. */
const RECONNECT_MS = 5_000;

/** A nudge, as the room sends it. Nothing here is a fact about the race. */
interface Nudge {
  type?: unknown;
  seq?: unknown;
}

function runnerName(runner: LeaderboardRow['runners'][number]): string {
  return `${runner.firstname} ${runner.lastname}`.trim();
}

/**
 * The Runner cell.
 *
 * ⚠️ **A guide is named as one.** On a solo race a visually impaired runner and their guide are
 * two runners on **one team** with one bib and one time — ADR-022 and `import_from_entries()` — so
 * without the marker the cell reads as a two-person entry in a solo race, and the time appears to
 * belong to both. The mark is a fact this staff-only screen may show and the published page may
 * not.
 */
function whoCell(row: LeaderboardRow): string {
  if (row.runners.length === 0) {
    // The same words `/admin/nn/` and `/account/entries/` use for a purchase with no entrant: a
    // claim about the record rather than a blank cell somebody has to interpret.
    return 'No runner recorded';
  }

  const names = row.runners.map((runner) =>
    runner.guide ? `${runnerName(runner)} (guide)` : runnerName(runner),
  );

  return row.teamName ? `${names.join(' & ')} (${row.teamName})` : names.join(' & ');
}

/**
 * The Bib cell — one number on a solo race, two joined on a relay.
 *
 * ⚠️ **The resolution is not here.** `row.bibs` comes out of `buildLeaderboard()`, which asks
 * `effectiveBib()` — the one definition the collision guard and the SQL/TS parity test share, and
 * the one that coalesces an override the registration desk typed over the derived number. A
 * template that rebuilt `${leg}${team_number}` would be a second implementation of the rule #249
 * spent a migration pinning.
 */
function bibCell(row: LeaderboardRow): string {
  return row.bibs.join(' / ') || '—';
}

function BoardRow({
  row,
  board,
  format,
}: {
  row: LeaderboardRow;
  board: Leaderboard;
  format: 'relay' | 'solo';
}) {
  return (
    <tr>
      <td className="results-num">
        {row.position === null ? '—' : String(row.position)}
      </td>
      <td className="results-num">{bibCell(row)}</td>
      <td className="results-name">{whoCell(row)}</td>
      <td>{row.category ?? '—'}</td>
      {board.columns.map((column) => (
        <td className="results-num" key={column}>
          {formatDuration(
            column === 'splitA'
              ? row.splitAMs
              : column === 'splitB'
                ? row.splitBMs
                : row.totalMs,
          )}
        </td>
      ))}
      <td className="results-status">
        {statusWords(row.status, format)}
        {row.suspect ? <span className="results-suspect"> — {SUSPECT_WORDS}</span> : null}
      </td>
    </tr>
  );
}

/** The column heading for each time column a race has. */
const COLUMN_HEADINGS: Record<Leaderboard['columns'][number], string> = {
  splitA: 'Leg 1',
  splitB: 'Leg 2',
  total: 'Total',
};

function BoardTable({ board, format }: { board: Leaderboard; format: 'relay' | 'solo' }) {
  if (board.rows.length === 0) {
    return <p className="results-empty">Nothing has been captured for this race yet.</p>;
  }

  return (
    // ⚠️ **A scrollable region has to be reachable by keyboard, and this table holds nothing
    // focusable.** axe's `scrollable-region-focusable` is satisfied either by the region being
    // focusable itself or by it *containing* something focusable; a board is all text, so it is
    // neither, and somebody navigating by keyboard at 375px could not scroll it at all. **Only
    // mobile-safari sees it**, because the table does not overflow at desktop width and a region
    // that does not scroll is not a scrollable region. This is the fourth instance in this
    // repository and all four are the same three attributes — `results/page.tsx` is the nearest.
    <div
      className="results-scroll"
      tabIndex={0}
      role="region"
      aria-labelledby="leaderboard-caption"
    >
      <table className="results-table">
        <caption className="results-meta" id="leaderboard-caption">
          {fieldSummary(board, format)}
        </caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Bib</th>
            <th scope="col">Runner</th>
            <th scope="col">Category</th>
            {board.columns.map((column) => (
              <th scope="col" key={column}>
                {COLUMN_HEADINGS[column]}
              </th>
            ))}
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <BoardRow key={row.teamId} row={row} board={board} format={format} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LiveBoard({
  slug,
  initial,
  sort,
}: {
  slug: string;
  initial: LeaderboardPayload;
  sort: 'total' | 'splitA' | 'splitB' | 'category' | 'teamNumber';
}) {
  const [payload, setPayload] = useState(initial);
  const [connection, setConnection] = useState<ConnectionState>('off');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // ⚠️ **The server sends a board and then the props change on the next request** — a reload with
  // a different `?sort=` re-renders this component with a new `initial`. Deriving the displayed
  // board from state alone would keep the first payload for ever; this keeps whichever is newer.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setPayload(initial);
  }

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    /**
     * Whether this screen has ever had a live socket.
     *
     * ⚠️ **`lost` is only ever reported after `live`, and that distinction is load-bearing.**
     * *"This board has stopped updating"* is a claim about something that was working, and a
     * socket that never connected at all did not stop — it never started. Reporting `lost` for
     * that would cry wolf on every environment where the upgrade does not reach the Worker,
     * which includes `apps/main`'s local stand-in for Cloudflare's edge router, and a warning
     * that is usually wrong is a warning nobody reads on the night it is right. Before a first
     * connection the wording stays `off`, which is honest for both cases: the board is a
     * snapshot, and reloading is the advice.
     */
    let everConnected = false;

    /**
     * Re-read the board over the ordinary permissioned HTTP path.
     *
     * ⚠️ **A refusal keeps the last good board.** A 404 here is a lapsed session or a race that
     * has gone; emptying the table would tell a volunteer the field had vanished, so the board
     * stays and the connection is reported as stopped.
     */
    async function refresh(): Promise<void> {
      try {
        const response = await fetch(
          `/timing/events/${encodeURIComponent(slug)}/leaderboard/snapshot`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          // A 404 here is a lapsed session or a race that has gone. Either way this screen is no
          // longer being told anything true, so it stops claiming to be live.
          if (!closed && everConnected) setConnection('lost');
          return;
        }

        const next = (await response.json()) as LeaderboardPayload;
        if (closed) return;

        setPayload(next);
        setUpdatedAt(new Date().toISOString());
      } catch {
        // Offline, or the tab is being torn down. Neither is worth a console line on a page that
        // may be open on a laptop at a finish line for two hours.
        if (!closed && everConnected) setConnection('lost');
      }
    }

    function connect(): void {
      if (closed) return;

      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${window.location.host}/timing/events/${encodeURIComponent(
        slug,
      )}/leaderboard/live`;

      let live: WebSocket;
      try {
        live = new WebSocket(url);
      } catch {
        // A browser that refuses to construct the socket at all — a blocked scheme, or a mixed
        // content rule. Nothing was ever live, so the wording stays `off`; see `everConnected`.
        retry = setTimeout(connect, RECONNECT_MS);
        return;
      }

      socket = live;

      live.addEventListener('open', () => {
        if (closed) return;
        everConnected = true;
        setConnection('live');
      });

      live.addEventListener('message', (event) => {
        // ⚠️ **Nothing from the socket is rendered and nothing is trusted.** The message says
        // *ask again*; the answer comes from the database. A malformed frame is ignored rather
        // than parsed defensively into something a screen might show.
        let nudge: Nudge;
        try {
          nudge = JSON.parse(String(event.data)) as Nudge;
        } catch {
          return;
        }

        if (nudge.type === 'changed' || nudge.type === 'hello') {
          void refresh();
        }
      });

      live.addEventListener('close', () => {
        if (closed) return;
        if (everConnected) setConnection('lost');
        // The room hibernates between messages and Cloudflare will close an idle socket
        // eventually, so a close is the normal case rather than a failure. Reconnecting is what
        // keeps a board open on a laptop for two hours actually live.
        retry = setTimeout(connect, RECONNECT_MS);
      });

      live.addEventListener('error', () => {
        if (!closed && everConnected) setConnection('lost');
      });
    }

    connect();

    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      socket?.close();
    };
  }, [slug]);

  const board = buildLeaderboard(payload, sort);
  const caveats = boardCaveats(board);

  return (
    <>
      {caveats.map((caveat) => (
        <p className="notice notice-bad" key={caveat}>
          {caveat}
        </p>
      ))}

      <p>
        {CONNECTION_WORDS[connection]}
        {updatedAt === null ? null : ` Last change ${formatLondonClock(updatedAt)}.`}
      </p>

      <BoardTable board={board} format={payload.event.format} />
    </>
  );
}
