import type { ResultStatus } from '@src/shared/timing/results';
import type { Leaderboard } from '@src/shared/timing/leaderboard';

/**
 * What the live leaderboard *says* — #204, and the seventh module of this shape.
 *
 * After `start-outcomes.ts`, `marshal-outcomes.ts`, `anomaly-outcomes.ts`,
 * `status-outcomes.ts`, `reset-outcomes.ts` and `results-outcomes.ts`. The rule they all carry
 * applies here too and this is the page it matters most on: **nothing the database says is ever
 * rendered to a volunteer as-is.** `sync-outcomes.ts` states it, and the old application's
 * `[object Object]` is where it came from.
 *
 * ## ⚠️ Every sentence here is about certainty, because a leaderboard's whole failure mode is
 * being believed
 *
 * A board is read at a glance, in the cold, by somebody about to tell a runner their time. So the
 * three things it must never do quietly:
 *
 * | | |
 * | --- | --- |
 * | A time derived from a start nobody recorded | {@link boardCaveats} says so above the table. `raceStartIso()` falls back to the **scheduled** start, which may be minutes out in either direction, and a number that is merely wrong is worse here than one that is missing — nobody re-checks a figure that looks fine |
 * | A row carrying an unresolved capture | {@link SUSPECT_WORDS} — *"being checked"*, beside the time rather than instead of it. `results.ts`'s own header: showing a confidently-wrong time is worse than showing an uncertain one, and dropping the row is worse than both |
 * | A board that has stopped updating | {@link CONNECTION_WORDS} — a screen whose socket has gone says so. A live board that has silently frozen is the one state where *stale* and *nothing has happened* look identical, and on a race night they mean opposite things |
 *
 * ⚠️ **`CONNECTION_WORDS.off` is not a failure message and must not read like one.** With
 * JavaScript disabled — a whole Playwright project here — the board is a correct server-rendered
 * snapshot, which is a perfectly good thing to be. What it needs to say is *how to see more*, not
 * that something is broken.
 */

/** Words for a row with no time, so a blank cell never has to be interpreted. */
export function statusWords(status: ResultStatus, format: 'relay' | 'solo'): string {
  switch (status) {
    case 'finished':
      return 'Finished';
    case 'pending':
      return 'On course';
    // On a relay this is the second runner; on a solo race the state does not arise at all, and
    // answering "On course" is the safe reading of a shape that should not occur.
    case 'leg1':
      return format === 'relay' ? 'On leg 2' : 'On course';
    case 'dns':
      return 'Did not start';
    case 'dnf':
      return 'Did not finish';
    case 'dq':
      return 'Disqualified';
  }
}

/**
 * What a suspect row wears.
 *
 * ⚠️ **Beside the time, never instead of it**, and the same two words the results preview already
 * uses — a volunteer moving between the two screens should not have to learn a second vocabulary
 * for the same fact.
 */
export const SUSPECT_WORDS = 'being checked';

/**
 * Whether the board is being pushed to, and what it says about that.
 *
 * `off` is the no-JavaScript state and the one a reader meets most often in testing; `live` is a
 * connected socket; `lost` is a socket that was connected and is not now.
 */
export type ConnectionState = 'off' | 'live' | 'lost';

export const CONNECTION_WORDS: Record<ConnectionState, string> = {
  // ⚠️ **Not an error, and not an apology.** A server-rendered snapshot is correct; it simply does
  // not move. The sentence says what to do rather than what is missing.
  off: 'This is how the race stood when the page loaded. Reload to see where it has got to.',
  live: 'Updating as crossings come in.',
  // ⚠️ **Says the board has stopped**, because a frozen live board and a race where nothing has
  // happened look identical, and on a race night they mean opposite things.
  lost: 'This board has stopped updating — the connection dropped. Reload to catch up.',
};

/**
 * The sentences that belong above the table, in the order they should be read.
 *
 * ⚠️ **Derived from the board rather than from a query string**, which is the rule every module of
 * this shape carries: nothing a caller passes in reaches a screen as words. Answers an empty array
 * for an ordinary, fully-trustworthy board, so the page renders nothing rather than reassurance
 * nobody asked for.
 */
export function boardCaveats(
  board: Pick<Leaderboard, 'startRecorded' | 'counts'>,
): string[] {
  const caveats: string[] = [];

  if (!board.startRecorded) {
    // ⚠️ **The most important sentence on this page.** Every duration below it was measured from
    // the *scheduled* start, so the whole board may be minutes out — and a board that looks
    // ordinary while being wrong by minutes is worse than no board.
    caveats.push(
      'The start of this race has not been recorded, so every time below is measured from the scheduled start rather than the gun. They are not results.',
    );
  }

  if (board.counts.suspect > 0) {
    caveats.push(
      board.counts.suspect === 1
        ? '1 row is marked as being checked. Its time is shown, and a marshal has flagged something about the capture behind it.'
        : `${board.counts.suspect} rows are marked as being checked. Their times are shown, and a marshal has flagged something about the captures behind them.`,
    );
  }

  return caveats;
}

/**
 * How the field stands, as one line under the table.
 *
 * ⚠️ **The handover is only mentioned on a relay**, because a solo race has none and *"0 on leg
 * 2"* invites a volunteer to wonder which leg they are looking at. Same reason
 * `Leaderboard.columns` drops the split columns.
 */
export function fieldSummary(
  board: Pick<Leaderboard, 'counts'>,
  format: 'relay' | 'solo',
): string {
  const { field, finished, handedOver, awaited, terminal } = board.counts;

  if (field === 0) {
    // Never "0 entries", which reads as a figure somebody should act on. The true statement is
    // that there is no entry list yet — and #254's danger zone puts a race back into this state
    // deliberately, so it is a normal thing for this page to say.
    return 'Nothing has been captured for this race yet.';
  }

  const parts = [
    `${field} ${field === 1 ? 'entry' : 'entries'}`,
    `${finished} finished`,
    ...(format === 'relay' ? [`${handedOver} on leg 2`] : []),
    `${awaited} yet to be seen`,
  ];

  if (terminal > 0) {
    parts.push(`${terminal} not placed`);
  }

  return `${parts.join(' · ')}.`;
}
