/**
 * Bib resolution — the one TypeScript source of truth for the bib a team owns.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/bib.ts`** under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * which makes that repository the specification for the rewrite and copies its tested pure
 * functions rather than re-deriving them. The behaviour below is unchanged; what changed is
 * where it lives and what it is compiled under.
 *
 * ## Why `packages/shared` rather than `apps/timing`
 *
 * Because the results are published on `/nn/2026/`, which `apps/main` serves. Both front
 * doors resolve bibs — `/timing` to record a crossing, `/nn/<year>/` to say who finished —
 * and a second implementation of this is the defect its own header has always warned about.
 * That is the same argument `formatPence()` and `formatEntryReference()` carry.
 *
 * ## The contract, unchanged and not negotiable
 *
 * **A bib is an opaque string. Exact equality only — never `parseInt`, never leading-zero
 * normalisation: `"0311" ≠ "311"`.** Two schemes coexist:
 *
 * - **derived** — relay: `${leg}${team_number}`, so team 47 is `147` and `247`, and team 100
 *   is `1100` and `2100`, which still parses. Solo: the `team_number` alone.
 * - **override** — an optional stored bib per leg, for a walk-in handed a physical bib at the
 *   desk, or any correction made on the roster.
 *
 * `effectiveBib(team, leg) = coalesce(override, derived)`.
 *
 * ⚠️ **Postgres mirrors this exactly**, in the trigger that resolves a crossing's team from
 * its bib. **The two must stay in lockstep** — ADR-034 names that as one of three things the
 * rewrite may not break, and it is the one with no symptom until a result is wrong.
 *
 * ## What the port had to change
 *
 * Nothing about the behaviour, and one thing about the types. This workspace compiles with
 * `noUncheckedIndexedAccess`, which the original did not: `targetBibs[0].bib` is
 * `string | undefined` here, so the within-team comparison destructures and checks both legs
 * are present rather than indexing twice. `bib.test.ts` is copied with it and is what says
 * the behaviour survived.
 */

export type EventFormat = 'relay' | 'solo';
export type Leg = 1 | 2;

/** The minimal team shape bib resolution needs. */
export type BibTeam = {
  team_number: string | null;
  bib_leg1: string | null;
  bib_leg2: string | null;
};

/**
 * The bib a leg DERIVES to when it has no override.
 *   relay → `${leg}${team_number}` (leg-first)
 *   solo  → the team_number alone (no leg prefix — the single crossing bib)
 * null when team_number is null (a team imported before bib assignment).
 */
export function derivedBib(
  teamNumber: string | null,
  leg: Leg,
  format: EventFormat,
): string | null {
  if (teamNumber === null) return null;
  if (format === 'solo') return teamNumber;
  return `${leg}${teamNumber}`;
}

/**
 * effectiveBib(team, leg) = coalesce(override, derived). Overrides are opaque
 * — returned verbatim, never normalised. An empty-string override is treated
 * as absent (the action layer stores null, not ""; this is a safety net).
 * null when there is neither an override nor a derivable bib.
 */
export function effectiveBib(
  team: BibTeam,
  leg: Leg,
  format: EventFormat,
): string | null {
  const override = leg === 1 ? team.bib_leg1 : team.bib_leg2;
  // `!= null` (loose) treats both null and undefined as "no override" — full
  // DB rows always carry the columns, but partial team projections may omit
  // them, and either must fall through to the derived bib.
  if (override != null && override.trim() !== '') return override;
  return derivedBib(team.team_number, leg, format);
}

/**
 * The bibs a team effectively owns, one entry per resolvable leg:
 *   relay → up to two ({leg:1}, {leg:2})
 *   solo  → one ({leg:1}); leg 2 has no meaning on a solo event.
 * Legs with no resolvable bib (null) are omitted.
 */
export function teamEffectiveBibs(
  team: BibTeam,
  format: EventFormat,
): { leg: Leg; bib: string }[] {
  const legs: Leg[] = format === 'solo' ? [1] : [1, 2];
  const out: { leg: Leg; bib: string }[] = [];
  for (const leg of legs) {
    const bib = effectiveBib(team, leg, format);
    if (bib !== null) out.push({ leg, bib });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision guard — hard block, run at BOTH walk-in create and roster edit.
// ---------------------------------------------------------------------------

export type GuardTeam = BibTeam & {
  /** null for a not-yet-created walk-in team. */
  id: string | null;
  name: string | null;
};

export type BibClash = {
  /** The bib string that clashes. */
  bib: string;
  /** Which leg of the TARGET team carries the clashing bib. */
  leg: Leg;
  /** true → the target's own leg 1 and leg 2 would share this bib. */
  sameTeam: boolean;
  /** The other team the bib already belongs to (null when sameTeam). */
  withTeamNumber: string | null;
  withTeamName: string | null;
  withLeg: Leg | null;
};

/**
 * Reject (return the first clash) if the target team's PROPOSED effective bibs
 * collide with any other team's effective bib on either leg, or if the target's
 * own two legs would share a bib. Returns null when the target's bibs are
 * unique and its legs differ.
 *
 * `target` carries the PROPOSED final override values as they would be stored
 * (bib_leg1 / bib_leg2; null means "derive from team_number"). `others` is
 * every OTHER team in the event with its current stored overrides — existing
 * teams are assumed already collision-free, so we only look for clashes that
 * INVOLVE the target. Self-matching by id is skipped so re-saving an unchanged
 * team never flags itself.
 */
export function findBibCollision(
  target: GuardTeam,
  others: GuardTeam[],
  format: EventFormat,
): BibClash | null {
  return findBibCollisionForBibs(
    {
      id: target.id,
      teamNumber: target.team_number,
      name: target.name,
      bibs: teamEffectiveBibs(target, format),
    },
    others,
    format,
  );
}

/**
 * The core of `findBibCollision`, taking the target's bibs EXPLICITLY rather
 * than deriving both legs. Callers that occupy only one leg — a solo walk-in,
 * or editing a team with a single runner — pass just that leg's bib so an
 * unoccupied leg's placeholder derived bib is never guarded (which would
 * false-block on a clash the team can't actually cause).
 */
export function findBibCollisionForBibs(
  target: {
    id: string | null;
    teamNumber: string | null;
    name: string | null;
    bibs: { leg: Leg; bib: string }[];
  },
  others: GuardTeam[],
  format: EventFormat,
): BibClash | null {
  const targetBibs = target.bibs;

  // 1. Within-team: leg 1 == leg 2 (only when both legs are present).
  //
  // Destructured rather than indexed: under `noUncheckedIndexedAccess` a `length === 2`
  // check does not narrow `[0]` and `[1]`, so indexing them is `string | undefined` however
  // obvious the guard looks to a reader.
  const [firstLeg, secondLeg] = targetBibs;
  if (
    firstLeg !== undefined &&
    secondLeg !== undefined &&
    firstLeg.bib === secondLeg.bib
  ) {
    return {
      bib: firstLeg.bib,
      leg: 2,
      sameTeam: true,
      withTeamNumber: target.teamNumber,
      withTeamName: target.name,
      withLeg: 1,
    };
  }

  // 2. Cross-team: any target bib equal to any other team's effective bib.
  for (const other of others) {
    if (other.id !== null && other.id === target.id) continue;
    for (const ob of teamEffectiveBibs(other, format)) {
      for (const tb of targetBibs) {
        if (tb.bib === ob.bib) {
          return {
            bib: tb.bib,
            leg: tb.leg,
            sameTeam: false,
            withTeamNumber: other.team_number,
            withTeamName: other.name,
            withLeg: ob.leg,
          };
        }
      }
    }
  }

  return null;
}

/** Human-facing message for a clash — names the clashing team (hard block). */
export function bibClashMessage(clash: BibClash): string {
  if (clash.sameTeam) {
    return `Leg 1 and leg 2 can't share bib ${clash.bib}.`;
  }
  const who = clash.withTeamNumber
    ? `team ${clash.withTeamNumber}${clash.withTeamName ? ` (${clash.withTeamName})` : ''}`
    : 'another team';
  return `Bib ${clash.bib} is already leg ${clash.withLeg} of ${who}.`;
}

// ---------------------------------------------------------------------------
// Stored-bib validation
// ---------------------------------------------------------------------------

/**
 * Decide what to STORE for a leg's override. Returns null when the typed bib
 * is empty or exactly equals the derived bib — so CSV teams stay null (a
 * name-only edit never persists a redundant override) and a walk-in handed
 * the sequential bib also stays derived. Any genuinely different bib is
 * stored verbatim (opaque). Callers validate the bib separately; this only
 * chooses null-vs-verbatim.
 */
export function normalizeOverride(
  typed: string,
  teamNumber: string | null,
  leg: Leg,
  format: EventFormat,
): string | null {
  const trimmed = typed.trim();
  if (trimmed === '') return null;
  return trimmed === derivedBib(teamNumber, leg, format) ? null : trimmed;
}

/**
 * Validate a bib the admin typed for a walk-in team or a roster edit. Walk-in
 * bibs are ADHOC physical pool bibs (e.g. 1–99), NOT the derived leg-prefixed
 * `${leg}${team_number}` form — the leg a crossing belongs to is decided by
 * which override column it matches (bib_leg1 vs bib_leg2), not the first digit.
 * So the only rule is: non-empty, digits only. Opaque otherwise — no length
 * cap, leading zeros preserved ("05" ≠ "5"). The marshal capture gate is
 * loosened to match (any digit bib is confirmable). See DECISIONS.md 2026-07-06.
 */
export function validateBib(
  bib: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = bib.trim();
  if (trimmed === '') return { ok: false, error: 'Enter a bib.' };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `Bib "${trimmed}" must be digits only.` };
  }
  return { ok: true, value: trimmed };
}
