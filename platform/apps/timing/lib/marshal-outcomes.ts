/**
 * What the roster page says after a form has been posted to it.
 *
 * ## Why a closed list and not the reason string itself
 *
 * The route handler redirects, so the outcome crosses from the POST to the GET **through the
 * URL**, and a value in a URL is something anybody can type. Two rules fall out of that and
 * this module exists to hold both in one place:
 *
 * 1. ⚠️ **Nothing from the query string is ever rendered.** The parameter selects a sentence
 *    that is written here; it is never itself the sentence. React escapes what it interpolates,
 *    so this is not about markup injection — it is about a page that would otherwise repeat a
 *    stranger's words back to a volunteer in the club's own voice, above the club's own roster.
 * 2. **An unknown value says nothing at all**, rather than something generic and worrying.
 *    Somebody who edits the URL, or a stale link from a browser's history, gets the page —
 *    which is the truth — and not a message about an act that never happened.
 *
 * The reasons themselves come from `timing.assign_marshal()` and `timing.unassign_marshal()`,
 * and the list below is deliberately wider than the two functions can currently answer: a
 * reason this page has no wording for would otherwise fall through to silence, which is the
 * one failure mode a volunteer cannot tell from success.
 */

/** The tone a message is rendered in — `base.css`'s `.notice-ok` and `.notice-bad`. */
export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

/**
 * ⚠️ **`assigned` and `removed` are the only two that claim something changed**, and both are
 * only ever reached from a function that answered `ok: true`. Everything else is a refusal or
 * an outage, and each says which — because *"that did not work"* on a roster is the sentence
 * that gets somebody put on a start line who is not actually on it.
 */
const OUTCOMES: Record<string, Outcome> = {
  assigned: {
    tone: 'ok',
    message: 'They are on the roster for this race.',
  },
  removed: {
    tone: 'ok',
    message:
      'They are off the roster for this race. Anything they recorded is unchanged.',
  },
  not_a_marshal: {
    tone: 'bad',
    message:
      'That person cannot record a crossing, so they were not added. Being on a roster is not what makes somebody a marshal — the timing-marshal role is granted at /admin/people/, and this page can only narrow it to a race.',
  },
  not_on_roster: {
    tone: 'bad',
    message: 'That person was not on this roster, so nothing was changed.',
  },
  no_such_event: {
    tone: 'bad',
    message: 'There is no race at this address, so nothing was changed.',
  },
  incomplete: {
    tone: 'bad',
    message: 'Nobody was chosen, so nothing was changed.',
  },
  refused: {
    tone: 'bad',
    message: 'That was refused, so nothing was changed.',
  },
  unavailable: {
    tone: 'bad',
    // Word for word the read side's wording, because it is the same event and a volunteer
    // comparing two pages during an outage must not be told two different things.
    message:
      'The club’s database could not be reached, so nothing was changed. Try again in a moment.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * ⚠️ **`Object.hasOwn` rather than `OUTCOMES[value] ?? null`, and the difference is not
 * theoretical.** An object literal inherits from `Object.prototype`, so `OUTCOMES['toString']`
 * is a *function* — truthy, so `??` would hand it straight back, and this page would then read
 * `.message` off it and render `undefined` in a notice. `?outcome=constructor` is a URL
 * anybody can type. `lib/access.ts` carries the same fix for the same reason, found the same
 * way.
 */
export function outcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}
