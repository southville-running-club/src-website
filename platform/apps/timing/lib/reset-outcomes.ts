/**
 * What the danger zone says afterwards — [#254](https://github.com/southville-running-club/src-website/issues/254).
 *
 * The fifth module of this shape, after `start-outcomes.ts`, `marshal-outcomes.ts`,
 * `anomaly-outcomes.ts` and `status-outcomes.ts`, and the two rules those carry apply
 * unchanged: **nothing from the query string is ever rendered**, and **an unknown value says
 * nothing at all**.
 *
 * ## ⚠️ Why the successful message carries no numbers
 *
 * `reset_event()` returns the counts it removed, and the obvious thing would be to put them in
 * the redirect so the page could say *"42 crossings and 12 entries removed"*. It does not, for
 * two reasons and the second is the one that decides it:
 *
 *   * the page re-reads `event_detail()` on the way back and renders the counts the race holds
 *     **now**, which are zeros — a figure read from the database beats a figure carried in a
 *     URL, every time;
 *   * a query string is not somewhere a page's facts should come from at all. `#202` made the
 *     same call for the registration import's findings and this repository has the general rule
 *     written down: what crosses a redirect is a key into wording that lives in a module, never
 *     the wording and never the data.
 *
 * So one message covers the wipe that removed a thousand rows and the second press that removed
 * none, and it is honest about both because it makes no claim about how much there was.
 *
 * ## ⚠️ The refusals are the half that has to be right
 *
 * `published` is not a failure and must not read as one. It is the club's rule arriving on time:
 * a published race is the permanent record, and the way past it is to unpublish deliberately,
 * which is somebody else's permission. The wording says what to do next rather than that
 * something went wrong, because a volunteer told only "refused" in a rehearsal will go looking
 * for a bug in the button.
 */

export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

const OUTCOMES: Record<string, Outcome> = {
  wiped: {
    tone: 'ok',
    // ⚠️ Says what survived as well as what went, because "wiped" on its own reads as "the race
    // is gone" — and the next thing this volunteer does is look for the race they just reset.
    message:
      'This race has been wiped. Every crossing and every entry has been removed, and it is no longer marked started or finished. The race itself, its marshals and the record of what has been done to it are all still here — the counts below are what it holds now.',
  },
  not_confirmed: {
    tone: 'bad',
    // The phrase is checked in the database, so this can happen to a post that never saw the
    // page. Says what to type rather than that something was wrong with what was typed.
    message:
      'Nothing was changed. To wipe a race you have to type its slug exactly as it appears above.',
  },
  published: {
    tone: 'bad',
    // ⚠️ **Not a failure — the rule arriving on time.** Says what to do next, because a
    // volunteer told only "refused" goes looking for a bug in the button.
    message:
      'This race cannot be wiped, because its results are published. A published result is the club’s permanent record. Somebody who can publish results has to unpublish them first, and that is recorded separately.',
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
    // ⚠️ **Never rendered as a refusal.** On this page the second sentence is the one that
    // matters: somebody who cannot tell an outage from a refusal presses again, and this is the
    // one button on the platform where pressing again is not free.
    message:
      'The club’s database could not be reached, so nothing was wiped. Try again in a moment — the counts below are what this page was last able to read.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * `Object.hasOwn` rather than `OUTCOMES[value] ?? null` — an object literal inherits from
 * `Object.prototype`, so `OUTCOMES['toString']` is a function and `??` would hand it back.
 * Four sibling modules carry the same fix, found in `lib/access.ts` as a real defect.
 */
export function resetOutcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}
