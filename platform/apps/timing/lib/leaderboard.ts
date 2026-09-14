import type { LeaderboardInput } from '@src/shared/timing/leaderboard';
import { readTiming, type TimingRead } from './reads';

/**
 * The one read behind the live leaderboard — [#204](https://github.com/southville-running-club/src-website/issues/204).
 *
 * ## ⚠️ `leaderboard()` and neither of the other two
 *
 * There are three functions in `timing` returning *"the teams, the runners and the crossings of
 * one race"*, and picking the wrong one is the mistake this file exists to prevent.
 * `20260914150000`'s header carries the table in full; the short version:
 *
 * | | |
 * | --- | --- |
 * | `results_for_event()` | the **published** shape, `anon`-callable once published, and `null` to a `timing-admin` before that — so it answers nothing to the person watching a race |
 * | `results_preview()` | behind `timing.result.publish`, a narrower audience than ADR-038 decided the leaderboard has, and it carries `result_placement`, which a board never uses |
 * | `leaderboard()` | behind `timing.event.manage` **or** `timing.crossing.resolve` — [ADR-038](../../../../docs/architecture/decisions/adr-038-the-leaderboard-is-staff-only-in-2026.md)'s own pair |
 *
 * ⚠️ **Staff only, and that is a decision with a stated cost.** ADR-038 declines the old
 * application's fully anonymous `/live/<slug>`, because a live leaderboard *is* provisional results
 * published continuously and the club's rule is that nobody sees a result before publication. The
 * record says out loud that
 * [C6](../../../../docs/foundations/requirements.md#c6--show-live-race-progress-to-spectators) is
 * **not met in 2026** rather than quietly re-scoping it: the finish-line spectator screen that
 * existed at Pass the Buck 2026 will not exist at Nightingale Nightmare 2026.
 *
 * ## The payload is the pure module's input type and nothing else
 *
 * {@link LeaderboardPayload} is `LeaderboardInput` plus the two keys a *page* needs and the
 * derivation does not — the race's name and its lifecycle timestamps. That split is deliberate:
 * `packages/shared/src/timing/leaderboard.ts` names only what it reads, so a column added for a
 * heading cannot silently become something a time is derived from.
 */

/** What `timing.leaderboard()` returns: the derivation's input, plus what a page's heading needs. */
export interface LeaderboardPayload extends LeaderboardInput {
  event: LeaderboardInput['event'] & {
    slug: string;
    name: string;
    finished_at: string | null;
    /** Set by `timing.publish_results()` — #241 and ADR-042. Null means not public. */
    results_published_at: string | null;
  };
  /**
   * How many captures on this race need a human.
   *
   * ⚠️ **From `open_anomaly_count()`, the same expression that refuses publication** — so the
   * figure on this board, the figure on the preview screen and the number in the refusal cannot
   * drift apart. It is a **superset** of the rows the board marks suspect: an orphan whose bib
   * matched no team carries no flag and appears on no row at all, because no team owns it.
   */
  open_anomalies: number;
}

export function readLeaderboard(slug: string): Promise<TimingRead<LeaderboardPayload>> {
  return readTiming<LeaderboardPayload>('leaderboard', { p_event_slug: slug });
}
