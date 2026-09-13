/**
 * What the start screen says after its form has been posted to it — #250.
 *
 * ## Why this is a second module and not a wider `marshal-outcomes.ts`
 *
 * The two lists share a shape and share nothing else. A roster's refusals are about a person;
 * these are about **the number every result in the race is derived from**, and every sentence
 * below has to be read on a start line by somebody who is about to decide whether to press
 * again. Merging them would put wording for two screens behind one lookup, and the way that
 * goes wrong is a page falling through to a sentence that belongs to the other one.
 *
 * The two rules `marshal-outcomes.ts`'s header argues apply here unchanged, and the second is
 * the one that costs money on this page:
 *
 * 1. ⚠️ **Nothing from the query string is ever rendered.** The parameter selects a sentence
 *    written here; it is never itself the sentence.
 * 2. **An unknown value says nothing at all**, rather than something generic — see below for
 *    why silence is nonetheless the wrong answer for a *known* refusal here.
 *
 * ## ⚠️ `already_started` is not a failure and must never read as one
 *
 * It is the answer the **losing** device gets when two people press at once, and it is the
 * single most likely refusal this screen will ever show. The race did start; the clock is
 * correct; nothing is owed. A sentence saying "that did not work" would send the second
 * volunteer looking for a button to press again, which is the exact outcome
 * `20260913170000_timing_start_race.sql` exists to make impossible — so this one is toned `ok`
 * and says plainly that the earlier press stands.
 */

/** The tone a message is rendered in — `base.css`'s `.notice-ok` and `.notice-bad`. */
export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

const OUTCOMES: Record<string, Outcome> = {
  started: {
    tone: 'ok',
    message:
      'The race has started. Every time in it is measured from the moment below, and pressing again will not move it.',
  },
  already_started: {
    tone: 'ok',
    // See the header: the losing tap of a double press, and the truthful answer to it.
    message:
      'This race had already started, so nothing was changed. The time below is the one the race is being timed from — it is the earlier press, which is the one that counts.',
  },
  cleared: {
    tone: 'ok',
    message:
      'The start has been cleared, so this race has not started. Its details can be corrected again.',
  },
  not_started: {
    tone: 'bad',
    message: 'This race had not started, so there was no start to clear.',
  },
  crossings_exist: {
    tone: 'bad',
    // ⚠️ **Says what it would have done, not only that it refused.** Somebody reading this is
    // holding a race that has gone wrong, and "no" without a reason is what gets worked around.
    message:
      'Somebody has already been timed in this race, so the start can no longer be cleared. Every time recorded is measured from it, and clearing it now would silently re-time all of them.',
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
    // ⚠️ **Word for word the read side's wording, and the second sentence is this page's own.**
    // An outage on the roster page costs a click; an outage here can leave somebody unsure
    // whether the gun went, so the message says outright that the screen will say if it did.
    message:
      'The club’s database could not be reached, so nothing was changed. Try again in a moment — if the race had already started, this page will say so once it can be read.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * ⚠️ **`Object.hasOwn` rather than `OUTCOMES[value] ?? null`.** An object literal inherits from
 * `Object.prototype`, so `OUTCOMES['toString']` is a *function* — truthy, so `??` would hand it
 * back and this page would read `.message` off it and render `undefined` in a notice.
 * `?outcome=constructor` is a URL anybody can type. `lib/access.ts` and
 * `lib/marshal-outcomes.ts` carry the same fix, found the same way.
 */
export function startOutcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}
