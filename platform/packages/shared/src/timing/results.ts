/**
 * Results — turning a pile of crossings into a leaderboard.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/results.ts`** under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its assertions, changed only where this workspace required it.
 *
 * ## The two rules worth knowing before reading the code
 *
 * **Splits are derived, never stored.** A = handover − start, B = finish − handover, total =
 * finish − start — and all three are measured against `coalesce(actually_started_at,
 * start_at)`, so a start delayed on the day does not inflate every runner's time. The timing
 * app got that right from its first migration and it is the kind of detail that is invisible
 * until the one year the start slips.
 *
 * ⚠️ **A row carrying an unresolved anomaly is marked suspect, not hidden and not shown as a
 * time.** `hasOpenAnomaly` is what a spectator sees as *"we know this row is wrong, the
 * marshals are on it"*. Showing a confidently-wrong time is worse than showing an uncertain
 * one, and dropping the row entirely is worse than both — somebody's runner vanishes from the
 * board while they are watching for them.
 *
 * ## What the port changed
 *
 * Row types only. The original read whole generated Supabase rows; these read the structural
 * shapes in `rows.ts`, for the reasons that file gives. No derivation, no ordering and no
 * formatting differs — `timing-results.test.ts` is copied unchanged and is what says so.
 */

import { effectiveBib } from './bib';
import type { TimingCrossing, TimingEvent, TimingTeam } from './rows';

type Event = TimingEvent;
type Team = TimingTeam;
type Crossing = TimingCrossing;

export type ResultStatus = 'pending' | 'leg1' | 'finished' | 'dns' | 'dnf' | 'dq';

/**
 * The three terminal race statuses (Slice 12): a whole-team label that replaces
 * the team time and sorts last. dns = registered, never started; dnf = started,
 * did not finish; dq = disqualified. Distinct from the crossing-derived
 * pending / leg1 / finished states.
 */
export type RaceStatus = 'dns' | 'dnf' | 'dq';

/**
 * A team's terminal race status, or null for a normal (finished/in-progress/
 * not-yet-started) team. race_status (Slice 12) is the canonical field; the
 * legacy dnf_at column — frozen (no app writer since Slice 5, set on zero rows
 * at Slice 12) — is honoured only as a fallback when race_status is null. So a
 * NULL-race_status team behaves EXACTLY as before this slice, and any
 * manually-set dnf_at data still renders as DNF.
 */
export function teamRaceStatus(
  team: Pick<Team, 'race_status' | 'dnf_at'>,
): RaceStatus | null {
  const rs = team.race_status;
  if (rs === 'dns' || rs === 'dnf' || rs === 'dq') return rs;
  if (team.dnf_at !== null) return 'dnf';
  return null;
}

/** Whether a ResultStatus is one of the terminal labels (dns / dnf / dq). */
export function isTerminalStatus(status: ResultStatus): boolean {
  return status === 'dns' || status === 'dnf' || status === 'dq';
}

export type Result = {
  team: Team;
  handoverAt: string | null;
  finishAt: string | null;
  splitAMs: number | null;
  splitBMs: number | null;
  totalMs: number | null;
  status: ResultStatus;
  /**
   * True iff a crossing contributing to this team's row carries an unresolved
   * anomaly_flag. Surfaced in the UI so spectators see "we know this row is
   * suspect, the marshals are looking at it" rather than a confidently-wrong
   * time.
   */
  hasOpenAnomaly: boolean;
};

export type SortKey = 'total' | 'splitA' | 'splitB' | 'category' | 'teamNumber';

/**
 * Race start used for split derivation: the official countdown-broadcast time
 * if Slice 4 has fired (events.actually_started_at), otherwise the scheduled
 * start. Mirrors the rule documented in the schema migration.
 */
export function raceStartIso(
  event: Pick<Event, 'actually_started_at' | 'start_at'>,
): string {
  return event.actually_started_at ?? event.start_at;
}

/**
 * Aggregate raw crossings into one Result per team. Pure: same inputs,
 * same output — easy to unit-test, and safe to re-run on every realtime
 * insert without worrying about hidden state.
 *
 * Two formats:
 *
 *   relay — bib "1" + team_number is the handover (partner A finishes leg 1,
 *           partner B starts leg 2); bib "2" + team_number is the team finish.
 *   solo  — bib is the team_number alone; the single crossing is the finish.
 *           Leg A / leg B don't apply, so splitAMs / splitBMs / handoverAt
 *           stay null and the renderer omits those columns.
 *
 * In both formats we pick the EARLIEST captured_at per (event, bib) — the
 * canonical first crossing — and ignore later duplicates. The marshal UI
 * flags duplicates as anomalies for an admin to resolve; in the meantime
 * the leaderboard stays decisive instead of flickering between candidate
 * times on every retap. Crossings the admin has discarded via the Slice 5
 * anomaly UI (resolved_action = 'discarded') are excluded entirely.
 */
export function buildResults(
  event: Pick<Event, 'actually_started_at' | 'start_at' | 'format'>,
  teams: Team[],
  crossings: Pick<
    Crossing,
    'bib' | 'captured_at' | 'anomaly_flag' | 'resolved_at' | 'resolved_action'
  >[],
): Result[] {
  const startMs = new Date(raceStartIso(event)).getTime();
  const isRelay = event.format === 'relay';

  type BibAgg = { earliest: string; openAnomaly: boolean };
  const byBib = new Map<string, BibAgg>();
  for (const c of crossings) {
    if (!c.bib) continue;
    // Admin-discarded resolutions semantically remove the crossing from
    // timing — see DECISIONS.md 2026-05-16 (Slice 5). Mark-valid and
    // edit-bib keep the row counted; only 'discarded' takes it out.
    if (c.resolved_action === 'discarded') continue;
    const prev = byBib.get(c.bib);
    // `=== true` because `rows.ts` types the column nullable, where the generated type it
    // replaced was `boolean`. Behaviour is identical - null was already falsy here - and
    // the comparison is what keeps `hasOpenAnomaly` a `boolean` rather than `boolean | null`.
    const isOpenAnomaly = c.anomaly_flag === true && !c.resolved_at;
    if (!prev || c.captured_at < prev.earliest) {
      byBib.set(c.bib, { earliest: c.captured_at, openAnomaly: isOpenAnomaly });
    } else if (isOpenAnomaly) {
      // Keep the canonical earliest time, but remember a later duplicate is
      // still flagged — the row should still wear the warning badge.
      prev.openAnomaly = true;
    }
  }

  return teams.map((team) => {
    if (!isRelay) {
      // team_number is nullable post-registration-import migration (a team
      // exists from CSV import before bib assignment runs). No bib = no
      // match in byBib = pending status, which is the correct state.
      // effectiveBib coalesces an override (teams.bib_leg1) over the derived
      // team_number; solo has no leg prefix (Slice 10).
      const soloBib = effectiveBib(team, 1, 'solo');
      const finish = soloBib ? (byBib.get(soloBib) ?? null) : null;
      const finishMs = finish ? new Date(finish.earliest).getTime() : null;
      // A terminal status (dns/dnf/dq) replaces the team time with its label
      // and sorts last (Slice 12). Solo has no leg splits, so there is nothing
      // to preserve — the total is simply suppressed.
      const terminal = teamRaceStatus(team);
      const totalMs = terminal ? null : finishMs !== null ? finishMs - startMs : null;
      const status: ResultStatus = terminal ? terminal : finish ? 'finished' : 'pending';
      return {
        team,
        handoverAt: null,
        finishAt: finish?.earliest ?? null,
        splitAMs: null,
        splitBMs: null,
        totalMs,
        status,
        hasOpenAnomaly: finish?.openAnomaly ?? false,
      };
    }

    // effectiveBib coalesces a per-leg override (teams.bib_leg1 / bib_leg2)
    // over the derived `${leg}${team_number}` — CSV teams (null overrides)
    // resolve exactly as before; walk-in teams resolve on their stored bib
    // (Slice 10). null when the team has no bib yet.
    const handoverBib = effectiveBib(team, 1, 'relay');
    const finishBib = effectiveBib(team, 2, 'relay');
    const handover = handoverBib ? (byBib.get(handoverBib) ?? null) : null;
    const finish = finishBib ? (byBib.get(finishBib) ?? null) : null;

    const handoverMs = handover ? new Date(handover.earliest).getTime() : null;
    const finishMs = finish ? new Date(finish.earliest).getTime() : null;

    const terminal = teamRaceStatus(team);
    // dns (never started) suppresses every derived time — the admin's "did not
    // start" judgment overrides any stray crossing. dnf/dq preserve leg A (the
    // handover is a real captured fact) but null leg B and total: a "—" cell
    // would imply "still pending" and a real B/total would imply "they
    // finished" — both wrong, and the label replaces the team time. Non-terminal
    // teams derive normally.
    const splitAMs =
      terminal === 'dns' ? null : handoverMs !== null ? handoverMs - startMs : null;
    const splitBMs = terminal
      ? null
      : finishMs !== null && handoverMs !== null
        ? finishMs - handoverMs
        : null;
    const totalMs = terminal ? null : finishMs !== null ? finishMs - startMs : null;

    const status: ResultStatus = terminal
      ? terminal
      : finish
        ? 'finished'
        : handover
          ? 'leg1'
          : 'pending';
    const hasOpenAnomaly =
      (handover?.openAnomaly ?? false) || (finish?.openAnomaly ?? false);

    return {
      team,
      handoverAt: handover?.earliest ?? null,
      finishAt: finish?.earliest ?? null,
      splitAMs,
      splitBMs,
      totalMs,
      status,
      hasOpenAnomaly,
    };
  });
}

/**
 * Sort results by the chosen key.
 *
 * Two tiers:
 *
 *   Tier 1 — {finished, leg1, pending}: ordered purely by the chosen sort
 *            key with nulls-last as the tiebreaker. A finished team's real
 *            totalMs naturally beats a leg1 team's null totalMs that way;
 *            we don't need an explicit status rank to push pending below
 *            finished. The status pill carries the visual signal.
 *
 *   Tier 2 — {dns, dnf, dq}: any team carrying a race status is always last
 *            regardless of sort key, ordered by team_number. A spectator
 *            scanning "total time" doesn't want no-show / withdrawn /
 *            disqualified teams interleaved with running ones. The three
 *            terminal kinds share one bucket (team_number order); their pills
 *            differentiate them visually.
 *
 * Ties broken by team_number throughout for determinism — realtime updates
 * shouldn't shuffle equal rows.
 */
export function sortResults(results: Result[], key: SortKey): Result[] {
  const teamNumberCompare = (a: Result, b: Result) => {
    // Unbib'd teams (team_number null) sort last among non-terminal — they
    // haven't been assigned a number yet, so any numbered team beats them
    // deterministically.
    const aTn = a.team.team_number;
    const bTn = b.team.team_number;
    if (aTn === null && bTn === null) return 0;
    if (aTn === null) return 1;
    if (bTn === null) return -1;
    const an = Number(aTn);
    const bn = Number(bTn);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return aTn.localeCompare(bTn);
  };

  // Push any team with a terminal race status (dns/dnf/dq) below every timed
  // and in-progress team, regardless of the chosen sort key.
  const terminalPartition = (a: Result, b: Result) => {
    const at = isTerminalStatus(a.status);
    const bt = isTerminalStatus(b.status);
    if (at && !bt) return 1;
    if (bt && !at) return -1;
    if (at && bt) return teamNumberCompare(a, b);
    return 0;
  };

  if (key === 'teamNumber') {
    return [...results].sort(
      (a, b) => terminalPartition(a, b) || teamNumberCompare(a, b),
    );
  }

  if (key === 'category') {
    return [...results].sort((a, b) => {
      const partition = terminalPartition(a, b);
      if (partition !== 0) return partition;
      const ac = a.team.category ?? '';
      const bc = b.team.category ?? '';
      const cmp = ac.localeCompare(bc);
      if (cmp !== 0) return cmp;
      return teamNumberCompare(a, b);
    });
  }

  const valueOf = (r: Result): number | null => {
    if (key === 'total') return r.totalMs;
    if (key === 'splitA') return r.splitAMs;
    return r.splitBMs;
  };

  return [...results].sort((a, b) => {
    const partition = terminalPartition(a, b);
    if (partition !== 0) return partition;
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null && bv === null) return teamNumberCompare(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return av - bv;
    return teamNumberCompare(a, b);
  });
}

/**
 * Format a duration as HH:MM:SS or MM:SS.cs depending on length. Returns "—"
 * for null so the JSX stays branch-free at the call site. Tabular figures
 * mean the dash sits in the same character cell as a digit — no row reflow
 * when results land.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Compact MM:SS / H:MM:SS formatting for the mobile splits row, where
 * centisecond precision is too noisy to scan one-handed in sunlight.
 * The desktop table keeps the full-precision formatDuration so the data
 * is still there for anyone who wants it.
 */
export function formatDurationCompact(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Assign within-category positions to an already-overall-sorted result
 * set. Returns a parallel `number[]` aligned with the input array:
 * index `i` of the return is the input row's position within its
 * category.
 *
 * The input is expected to be pre-sorted by the overall ordering
 * criterion (typically total_time ascending, ties broken by team_number
 * per `sortResults(_, 'total')`). The helper preserves that order
 * within each category bucket, so a category's positions reflect the
 * same tie-break the overall positions use.
 *
 * Null-category rows cluster into one group keyed by the empty string
 * — they share their own running counter rather than scattering across
 * other categories or sharing one with a real category. In practice
 * `teams.category` is set during CSV import; a null arriving here means
 * a row predates that field or was created out-of-band, and grouping
 * the lot together is the least-surprise behaviour.
 *
 * Generic on T plus a category accessor so callers don't need to
 * pre-project. `Result[]` carries category as `team.category`, raw
 * test fixtures can carry it at the top level — one helper handles
 * both via the accessor.
 */
export function assignCategoryPositions<T>(
  rows: T[],
  getCategory: (row: T) => string | null,
): number[] {
  const counters = new Map<string, number>();
  return rows.map((r) => {
    const key = getCategory(r) ?? '';
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  });
}

/**
 * Uniform HH:MM:SS.ss formatting for the Slice 6 results export.
 *
 * Distinct from formatDuration (which switches shape MM:SS.cs ↔ H:MM:SS
 * by length for readability on the live leaderboard): the export needs
 * one fixed shape so the CSV column sorts as text and parses identically
 * regardless of which row you point a parser at. HH is zero-padded too —
 * a 23-minute split renders "00:23:45.12", not "23:45.12".
 *
 * `nullValue` is parametrised so the same helper serves both the preview
 * table (renders "—" for any missing duration, matching formatDuration's
 * dash convention) and the CSV path (emits "" so empty Excel cells stay
 * empty rather than carrying a literal em-dash that breaks downstream
 * numeric tooling).
 *
 * In practice the finishers-only export filter means leg1/leg2/total
 * are never null for a relay row; leg2 on a solo event is blanked at
 * row-construction time (no leg-2 concept), not by passing null here.
 * The null path still has a stated contract for the rare preview path
 * during mid-race export.
 */
export function durationToHMSss(
  ms: number | null,
  opts?: { nullValue?: string },
): string {
  const nullValue = opts?.nullValue ?? '—';
  if (ms === null || !Number.isFinite(ms)) return nullValue;
  if (ms < 0) return nullValue;
  const totalSeconds = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}
