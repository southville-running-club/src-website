/**
 * Anomalies — what the marshal screen says when a crossing looks wrong, and what it does not do
 * about it.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/anomaly.ts`** under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its 330 lines of assertions, unchanged apart from two type declarations and the import
 * path.
 *
 * ## The rule this module exists to hold
 *
 * ⚠️ **An anomaly flags and never blocks.** A duplicate bib, or a leg-2 crossing before that
 * team's leg 1, marks the card and says why — and the marshal resolves it and confirms anyway.
 * ADR-034 names that as a decision rather than an implementation detail, and it is the one a
 * rewrite is most likely to "improve" by accident: refusing a suspicious crossing at the line
 * loses the moment, and the moment is the thing that cannot be recovered. An admin clears
 * flags afterwards, when there is time to be right.
 *
 * ## What the port changed, and it is types rather than behaviour
 *
 * The original read `Pick<Tables<"crossings">, "bib" | "captured_at">` from the generated
 * Supabase types. Those do not exist here yet — the `timing` schema is written rather than
 * moved, per
 * [ADR-035](../../../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md)
 * — so the shape is declared structurally instead, exactly as `bib.ts` declares `BibTeam`.
 *
 * **That is worth keeping even after the schema lands.** A pure function that names the two
 * columns it reads is testable without a database and says what it depends on; one that takes
 * a whole generated row says only "something from the crossings table". When the generated
 * types arrive, the assertion worth adding is that they remain *assignable* to these.
 */

import { formatLondonClock } from '../london-time';

/** The two columns a crossing is judged on. Structural, for the reason in the header. */
type Crossing = { bib: string | null; captured_at: string };

export type EventFormat = 'relay' | 'solo';

export type ParsedBib =
  | { valid: true; kind: 'relay-1' | 'relay-2'; teamNumber: string }
  | { valid: true; kind: 'solo'; teamNumber: string }
  | { valid: false };

export type AnomalyReason =
  | { kind: 'duplicate-bib'; bib: string; existingCapturedAt: string }
  | { kind: 'leg2-before-leg1'; bib: string; teamNumber: string }
  | { kind: 'leg1-after-leg2'; bib: string; teamNumber: string };

export type AnomalyResult =
  { flag: false; reason: null } | { flag: true; reason: AnomalyReason };

const NO_ANOMALY: AnomalyResult = { flag: false, reason: null };

/**
 * Parse a bib string into its structured form. Trims whitespace; rejects
 * empty / partially-numeric / out-of-range inputs.
 *
 * Relay convention: first digit = leg (must be 1 or 2), remaining digits
 * = team number. So "147" → leg 1, team "47"; "1100" → leg 1, team "100".
 *
 * Solo convention: the entire string is the team number. "147" on a solo
 * event is just team 147 — the leg-prefix semantics don't apply.
 *
 * Leading zeros in the team number portion are preserved — fixture data
 * uses team numbers like "01" and "02", and the leaderboard aggregator
 * matches on string equality of `1` + team_number.
 */
export function parseBib(bib: string, format: EventFormat): ParsedBib {
  const trimmed = bib.trim();
  if (!/^\d+$/.test(trimmed)) return { valid: false };

  if (format === 'solo') {
    return { valid: true, kind: 'solo', teamNumber: trimmed };
  }

  // Relay: must be at least 2 chars (1 leg digit + ≥1 team digit) and
  // start with 1 or 2. "0147" is rejected because there is no leg 0;
  // "347" is rejected because there is no leg 3.
  if (trimmed.length < 2) return { valid: false };
  const leg = trimmed[0];
  if (leg !== '1' && leg !== '2') return { valid: false };
  return {
    valid: true,
    kind: leg === '1' ? 'relay-1' : 'relay-2',
    teamNumber: trimmed.slice(1),
  };
}

/**
 * Check a candidate bib against the set of already-committed crossings.
 *
 * Duplicate fires before leg2-before-leg1 because it's the more specific
 * signal: a duplicate is unambiguously the same bib captured twice; a
 * missing handover could just be a marshal logging out of order.
 *
 * Empty and unparseable bibs return no-anomaly so the caller doesn't
 * need to special-case them — the UI gating layer is responsible for
 * blocking submission of those.
 */
export function checkAnomaly(
  bib: string,
  format: EventFormat,
  knownCrossings: Crossing[],
): AnomalyResult {
  const trimmed = bib.trim();
  if (!trimmed) return NO_ANOMALY;

  // O(n) scan over knownCrossings; fine at race scale (≤600 crossings).
  const duplicate = knownCrossings.find((c) => c.bib === trimmed);
  if (duplicate) {
    return {
      flag: true,
      reason: {
        kind: 'duplicate-bib',
        bib: trimmed,
        existingCapturedAt: duplicate.captured_at,
      },
    };
  }

  if (format === 'relay') {
    const parsed = parseBib(trimmed, 'relay');

    // 2XX captured before any 1XX for the same team. Triggers when the
    // marshal logs the finish before the handover was recorded.
    if (parsed.valid && parsed.kind === 'relay-2') {
      const handoverBib = `1${parsed.teamNumber}`;
      const hasHandover = knownCrossings.some((c) => c.bib === handoverBib);
      if (!hasHandover) {
        return {
          flag: true,
          reason: {
            kind: 'leg2-before-leg1',
            bib: trimmed,
            teamNumber: parsed.teamNumber,
          },
        };
      }
    }

    // Symmetric inverse: 1XX captured AFTER the 2XX for the same team
    // is already recorded. Suggests the marshal tapped a 2XX first by
    // mistake (e.g. read the bib wrong) or is logging out of order.
    // Either way the team's leg-A and leg-B times can't be computed
    // until the admin resolves which crossing belongs to which leg.
    if (parsed.valid && parsed.kind === 'relay-1') {
      const finishBib = `2${parsed.teamNumber}`;
      const hasFinish = knownCrossings.some((c) => c.bib === finishBib);
      if (hasFinish) {
        return {
          flag: true,
          reason: {
            kind: 'leg1-after-leg2',
            bib: trimmed,
            teamNumber: parsed.teamNumber,
          },
        };
      }
    }
  }

  return NO_ANOMALY;
}

/**
 * Render a marshal-facing message for an anomaly. Wall-clock time only
 * — race-relative formatting (e.g. "+18:42") is the renderer's concern,
 * since that needs the event's actually_started_at, which this pure
 * module doesn't know about.
 *
 * ⚠️ **The time is Europe/London, and this is the one place the port changes behaviour.**
 *
 * The original read the browser's default timezone - `new Date(...).toLocaleTimeString()` -
 * and its comment called that deliberate: *"so a marshal at the venue sees venue local
 * time"*, with `TZ=UTC` pinned in the test script to make the assertions deterministic.
 *
 * This repository forbids that, repository-wide, with an ESLint rule that refused this file
 * on the first commit. The reason is on the rule: a bare `toLocale*String` takes the ambient
 * timezone, and Nightingale Nightmare is raced the weekend after the clocks change. A
 * marshal's device is not a reliable source of "venue local" - a phone with the wrong zone
 * set, or a visiting marshal's, reports an hour that the card beside it does not.
 *
 * So it renders through `formatLondonClock`, and the assertion for this function is the one
 * place `timing-anomaly.test.ts` deliberately differs from the file it was copied from.
 */
export function formatAnomalyMessage(reason: AnomalyReason): string {
  switch (reason.kind) {
    case 'duplicate-bib': {
      const time = formatLondonClock(reason.existingCapturedAt);
      return `Duplicate bib ${reason.bib} — already captured at ${time}`;
    }
    case 'leg2-before-leg1':
      return `Bib ${reason.bib} — no handover recorded for team ${reason.teamNumber}`;
    case 'leg1-after-leg2':
      return `Bib ${reason.bib} — leg-2 already recorded for team ${reason.teamNumber}`;
  }
}
