/**
 * What the status screen and the finish screen say afterwards — #253.
 *
 * The fourth module of this shape, after `start-outcomes.ts`, `marshal-outcomes.ts` and
 * `anomaly-outcomes.ts`, and the two rules those carry apply unchanged: **nothing from the query
 * string is ever rendered**, and **an unknown value says nothing at all**.
 *
 * ## ⚠️ The wording has to survive being read by somebody who is disputing it
 *
 * A DNS, a DNF and especially a DQ are decisions a runner may come back and argue about, and
 * the sentence a volunteer sees when they set one is the sentence they will remember making.
 * So each says **what it does to the result**, not merely that it was recorded — and the one
 * that clears a status says outright that the earlier decision has been lifted, because "saved"
 * would leave somebody unsure whether they had just applied one or removed one.
 */

export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

const OUTCOMES: Record<string, Outcome> = {
  dns: {
    tone: 'ok',
    message:
      'Recorded as did not start. They have no time in this race, and nothing that was captured for them counts towards one.',
  },
  dnf: {
    tone: 'ok',
    // ⚠️ **Says that leg A survives**, because that is the half people are surprised by — a
    // captured fact stays captured, and the handover time is still real.
    message:
      'Recorded as did not finish. Anything already captured for them stays captured — they simply have no finishing time.',
  },
  dq: {
    tone: 'ok',
    message:
      'Recorded as disqualified. Anything already captured for them stays captured, and they are out of every result and prize. This can be lifted again, and both the setting and the lifting are recorded.',
  },
  cleared: {
    tone: 'ok',
    message:
      'That has been lifted. They are back in the race as an ordinary runner, and the change is recorded alongside the original.',
  },
  unchanged: {
    tone: 'ok',
    // Pressing "clear" twice is an ordinary thing to do. Nothing happened and nothing is wrong.
    message: 'They were already recorded that way, so nothing was changed.',
  },
  finished: {
    tone: 'ok',
    // ⚠️ **Never a gate**, and the sentence says so: the last runner's crossing arrives after
    // somebody has called the race, and a volunteer who believed otherwise would stop capturing.
    message:
      'This race is finished. Crossings can still be recorded and corrected — finishing is a label, not a cut-off.',
  },
  already_finished: {
    tone: 'ok',
    message:
      'This race had already been finished, so nothing was changed. The time below is the one that stands.',
  },
  reopened: {
    tone: 'ok',
    message: 'This race is no longer marked finished.',
  },
  not_finished: {
    tone: 'bad',
    message: 'This race was not marked finished, so there was nothing to undo.',
  },
  invalid_status: {
    tone: 'bad',
    message: 'That is not a status this race can record, so nothing was changed.',
  },
  no_such_team: {
    tone: 'bad',
    message: 'There is no team on this race with that reference, so nothing was changed.',
  },
  no_such_event: {
    tone: 'bad',
    message: 'There is no race at this address, so nothing was changed.',
  },
  incomplete: {
    tone: 'bad',
    message: 'Nothing was asked for, so nothing was changed.',
  },
  refused: {
    tone: 'bad',
    message: 'That was refused, so nothing was changed.',
  },
  unavailable: {
    tone: 'bad',
    message:
      'The club’s database could not be reached, so nothing was changed. Try again in a moment — this page will say what the race holds once it can be read.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * `Object.hasOwn` rather than `OUTCOMES[value] ?? null` — an object literal inherits from
 * `Object.prototype`, so `OUTCOMES['toString']` is a function and `??` would hand it back.
 * Three sibling modules carry the same fix, found in `lib/access.ts` as a real defect.
 */
export function statusOutcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}
