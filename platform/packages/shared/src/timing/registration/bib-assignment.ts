/**
 * Bib assignment — deciding which team number each entry gets, before anybody pins a number on.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/registration/bib-assignment.ts`** under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its assertions and no dependencies of its own.
 *
 * This is the step between an imported entry list and a race: a team with no `team_number`
 * cannot derive a bib, so nothing about it can be captured at the line. `bib.ts` turns a
 * number into the bib strings; this decides the numbers.
 */

export type TeamForAssignment = {
  id: string;
  team_number: string | null;
  csv_row_index: number;
};

export type BibAssignment = {
  id: string;
  // Already in storage format (zero-padded to padWidth). Action writes
  // this string directly to teams.team_number.
  newTeamNumber: string;
};

export type AssignmentPlan = {
  assignments: BibAssignment[];
  // Teams already carrying any team_number (numeric or not) before this run.
  alreadyAssigned: number;
  totalCount: number;
  // First / last numeric team_number written this run. null when nothing
  // was assigned. The action surfaces these as "Assigned bibs 1{N}–1{M}
  // / 2{N}–2{M}" copy.
  assignedFirst: number | null;
  assignedLast: number | null;
  // Min / max numeric team_number across the event, post-plan. Lets the
  // UI surface "Assigned 31–47 (1–47 total)" without a second query.
  eventFirst: number | null;
  eventLast: number | null;
};

export type PlanOptions = {
  // First numeric team_number this run may assign (1-based). Idempotent
  // extension takes max(startFrom, existing max + 1) so a repeat call
  // can't double-assign.
  startFrom: number;
  // Zero-pad width for the stored team_number text. Derived from the
  // admin's bib suffix length (e.g. 101/201 → "01" → padWidth 2).
  padWidth: number;
};

/**
 * Plans a bib-assignment run for one event's teams.
 *
 * - Orders teams by csv_row_index (CSV row order — the canonical input).
 * - Picks up from max(startFrom, existing numeric max + 1).
 * - Skips already-numbered teams (idempotent extension).
 * - Stores team_number as zero-padded text of `padWidth` digits so the
 *   bib derived via `bibFromTeamNumber` has uniform width across the
 *   event.
 * - Non-numeric existing team_numbers (e.g. smoke-test "T1") are counted
 *   as "already assigned" but ignored when computing max. Their bibs
 *   stay whatever they were; new assignments don't collide because the
 *   unique constraint is on the literal text value.
 */
export function planBibAssignment(
  teams: TeamForAssignment[],
  options: PlanOptions,
): AssignmentPlan {
  const { startFrom, padWidth } = options;
  const sorted = [...teams].sort((a, b) => a.csv_row_index - b.csv_row_index);

  const numericValues: number[] = [];
  let alreadyAssigned = 0;
  for (const t of sorted) {
    if (t.team_number !== null) {
      alreadyAssigned++;
      const n = parseInt(t.team_number, 10);
      if (!Number.isNaN(n)) {
        numericValues.push(n);
      }
    }
  }

  const maxExisting = numericValues.length === 0 ? 0 : Math.max(...numericValues);
  let next = Math.max(startFrom, maxExisting + 1);

  const assignments: BibAssignment[] = [];
  for (const t of sorted) {
    if (t.team_number === null) {
      assignments.push({
        id: t.id,
        newTeamNumber: String(next).padStart(padWidth, '0'),
      });
      next++;
    }
  }

  const assignedNumeric = assignments.map((a) => parseInt(a.newTeamNumber, 10));
  // `?? null` on both: the length check proves the index is there and
  // `noUncheckedIndexedAccess` - on here, off in the repository this came from - cannot
  // see it. Coalescing keeps the declared `number | null` without an assertion.
  const assignedFirst = assignedNumeric.length > 0 ? (assignedNumeric[0] ?? null) : null;
  const assignedLast =
    assignedNumeric.length > 0
      ? (assignedNumeric[assignedNumeric.length - 1] ?? null)
      : null;

  const postRunNumeric = [...numericValues, ...assignedNumeric];
  const eventFirst = postRunNumeric.length > 0 ? Math.min(...postRunNumeric) : null;
  const eventLast = postRunNumeric.length > 0 ? Math.max(...postRunNumeric) : null;

  return {
    assignments,
    alreadyAssigned,
    totalCount: sorted.length,
    assignedFirst,
    assignedLast,
    eventFirst,
    eventLast,
  };
}

/**
 * Derives a bib number from a team number and leg.
 * `${leg}${team_number}` — see module header for examples.
 */
export function bibFromTeamNumber(teamNumber: number | string, leg: 1 | 2): string {
  return `${leg}${teamNumber}`;
}

// Upper bound on manually-added team numbers. There is NO bib COLLISION
// ceiling in the concat scheme — leg-1 bibs ("1"…) and leg-2 bibs ("2"…)
// can never collide (first digit differs), and `unique (event_id,
// team_number)` blocks in-leg dupes. Team 100 → "100" → bibs 1100 / 2100
// parses cleanly (crossings trigger's `substring(bib from 2)` recovers
// "100"). This cap is a DEFENSIVE sanity bound only: 999 keeps derived
// bibs at ≤4 digits (the widest form CLAUDE.md documents) and sits far
// above any plausible Pass the Buck field (~100 teams). Refusing past it
// is graceful ("beyond supported range"), never a half-assign.
export const MAX_TEAM_NUMBER = 999;

export type NextTeamNumber = {
  // Numeric next team number (max existing numeric + 1).
  next: number;
  // Pad width inferred from existing numbered teams so a new team's bib
  // shares their width. Grows naturally past the width only when `next`
  // itself is wider (e.g. 100 in a 2-digit event → "100").
  padWidth: number;
  // Storage-format team_number — `String(next).padStart(padWidth, "0")`,
  // the exact expression planBibAssignment uses. Ready to write to
  // teams.team_number and to feed bibFromTeamNumber.
  teamNumber: string;
};

/**
 * Computes the next team_number for a manually-added ("walk-up") team,
 * appended after the highest existing numeric team_number.
 *
 * Mirrors planBibAssignment's derivation exactly:
 *   - max of parsed numeric team_numbers, +1;
 *   - zero-padded via `padStart(padWidth, "0")`.
 * The one difference is where padWidth comes from: assignBibs takes it
 * from the admin's bib-suffix width; here we INFER it from the widest
 * existing numbered team_number, so walk-ups match the width the event
 * was assigned at. A parity test pins that computeNextTeamNumber picks up
 * exactly where a planBibAssignment run left off.
 *
 * Returns null when no numbered team exists yet — the caller refuses with
 * "assign starting bibs first", because without a numbered team there's
 * no scheme (padWidth) to extend. Non-numeric team_numbers (e.g. a
 * smoke-test "T1") are ignored for both max and width, same as
 * planBibAssignment ignores them for max.
 */
export function computeNextTeamNumber(
  teams: { team_number: string | null }[],
): NextTeamNumber | null {
  let maxNumeric = -Infinity;
  let padWidth = 0;
  for (const team of teams) {
    if (team.team_number === null) continue;
    const trimmed = team.team_number.trim();
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n)) continue;
    maxNumeric = Math.max(maxNumeric, n);
    padWidth = Math.max(padWidth, trimmed.length);
  }

  if (maxNumeric === -Infinity) return null;

  const next = maxNumeric + 1;
  return {
    next,
    padWidth,
    teamNumber: String(next).padStart(padWidth, '0'),
  };
}
