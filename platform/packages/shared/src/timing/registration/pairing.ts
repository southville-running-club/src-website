/**
 * Pairing — putting two solo entries together into one relay team.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/registration/pairing.ts`** under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its assertions.
 *
 * Pure arithmetic over a plan: the action layer wires the result to the database, and nothing
 * here reaches one. That split is what makes it testable at all, and it is the same split
 * `bib-assignment.ts` keeps.
 */

import { bibFromTeamNumber } from './bib-assignment';
import { effectiveBib } from '../bib';

export type SoloForPairing = {
  teamId: string;
  // Storage-format team_number (zero-padded text). Solos are numbered, so
  // this is non-null by construction; the caller guarantees it.
  teamNumber: string;
  // Per-leg stored bib overrides (null → derived). A solo occupies one leg;
  // its override (if any) lives on that leg's column.
  bibLeg1: string | null;
  bibLeg2: string | null;
  runnerId: string;
  runnerLeg: 1 | 2;
  // Display only — carried through so the preview/audit can name people.
  runnerName: string;
};

// The runner's actual (effective) bib on their occupied leg — an override if
// the desk handed them a physical bib, else derived.
function soloEffectiveBib(s: SoloForPairing): string {
  return (
    effectiveBib(
      { team_number: s.teamNumber, bib_leg1: s.bibLeg1, bib_leg2: s.bibLeg2 },
      s.runnerLeg,
      'relay',
    ) ?? bibFromTeamNumber(s.teamNumber, s.runnerLeg)
  );
}

export type PairingPlan = {
  survivorTeamId: string;
  survivorTeamNumber: string;
  // Team to delete once the absorbed runner has moved off it.
  removedTeamId: string;
  // The runner that stays put — number, leg, and bib all unchanged.
  keep: {
    runnerId: string;
    runnerName: string;
    leg: 1 | 2;
    bib: string;
  };
  // The runner that moves onto the surviving team at the vacant leg.
  moved: {
    runnerId: string;
    runnerName: string;
    fromLeg: 1 | 2;
    fromBib: string;
    toTeamId: string;
    toLeg: 1 | 2;
    toBib: string;
  };
};

/**
 * Plans pairing two solos into one team. Deterministic: the lower numeric
 * team_number survives; its runner is untouched; the other runner is
 * absorbed at the vacant leg.
 *
 * Throws if the two carry the same team number (would be a caller bug —
 * `unique (event_id, team_number)` makes it impossible for real rows) or
 * a non-numeric team number (solos are always numeric). Callers validate
 * both are distinct numbered solos before planning.
 */
export function planPairing(a: SoloForPairing, b: SoloForPairing): PairingPlan {
  const na = parseInt(a.teamNumber, 10);
  const nb = parseInt(b.teamNumber, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) {
    throw new Error('planPairing requires numeric team numbers.');
  }
  if (na === nb) {
    throw new Error('planPairing requires two distinct team numbers.');
  }

  const survivor = na < nb ? a : b;
  const absorbed = na < nb ? b : a;
  const vacantLeg: 1 | 2 = survivor.runnerLeg === 1 ? 2 : 1;

  return {
    survivorTeamId: survivor.teamId,
    survivorTeamNumber: survivor.teamNumber,
    removedTeamId: absorbed.teamId,
    keep: {
      runnerId: survivor.runnerId,
      runnerName: survivor.runnerName,
      leg: survivor.runnerLeg,
      // Survivor keeps its own bib — its override if it has one, else derived.
      bib: soloEffectiveBib(survivor),
    },
    moved: {
      runnerId: absorbed.runnerId,
      runnerName: absorbed.runnerName,
      fromLeg: absorbed.runnerLeg,
      // The physical bib the absorbed runner arrives wearing (to be collected).
      fromBib: soloEffectiveBib(absorbed),
      toTeamId: survivor.teamId,
      toLeg: vacantLeg,
      // Re-bibbed to the survivor's vacant leg — always derived (no override
      // on a vacant leg).
      toBib: bibFromTeamNumber(survivor.teamNumber, vacantLeg),
    },
  };
}
