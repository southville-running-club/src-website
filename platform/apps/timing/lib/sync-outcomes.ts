/**
 * What a card on the marshal screen says when a sync did not land — #203.
 *
 * ## ⚠️ The defect this module exists to make impossible
 *
 * The old application put the failure straight on the card: `error.message` off whatever came
 * back from PostgREST. Two things are wrong with that and only one of them is cosmetic.
 *
 * A `PostgrestError` is **a plain object rather than an `Error`**, so a card once rendered
 * `[object Object]` — the bug `bindalshah/src-race-timing` recorded against itself and the one
 * #203 says to fix on the way past. The deeper problem is the version that "works": a marshal
 * on a finish line, in the cold, holding a phone, reading
 * `duplicate key value violates unique constraint`. There is exactly one decision that card
 * has to support — **keep going, or fetch somebody** — and a Postgres error supports neither.
 *
 * So nothing the database says is ever rendered. The reason **selects** a sentence written
 * here, exactly as `start-outcomes.ts` and `marshal-outcomes.ts` select theirs from a query
 * parameter, and a reason nobody has written wording for falls through to a sentence that is
 * still true.
 *
 * ## ⚠️ Every sentence has to be true of a crossing that is still safe
 *
 * A failed card is **not a lost crossing**. The time is in IndexedDB on the phone and will be
 * sent again — thirty seconds later by the drain, or by hand. So no wording here may suggest
 * anything has been lost, and none of it may suggest the marshal should re-tap: a second tap
 * is a second crossing with a second id, which is the one thing the idempotent insert cannot
 * protect against.
 */

/**
 * What each refusal from `record_crossing()` says to the person holding the phone.
 *
 * The reasons are the function's own — `20260912120000_timing_record_crossing.sql` — and the
 * list is deliberately complete rather than a default plus two special cases, so a reason that
 * stops being possible shows up as wording nobody reaches rather than as a silent gap.
 */
const REFUSALS: Record<string, string> = {
  // ADR-036's scope. It is worth naming outright, because it is the one a volunteer can
  // actually fix — somebody with the roster page open can put them on it in a few seconds.
  not_on_roster:
    'You are not on this race’s marshal list, so this crossing was not accepted. Ask whoever set the race up to add you, then retry — the time is still here.',
  no_such_event:
    'This race could not be found, so this crossing was not accepted. Check you are on the right screen — the time is still here.',
  incomplete:
    'This crossing was sent without everything it needs, so it was not accepted. Tell whoever is running the race — the time is still here.',
  invalid_source:
    'This crossing was sent in a form the club’s database does not accept. Tell whoever is running the race — the time is still here.',
  refused:
    'The club’s database refused this crossing. Tell whoever is running the race — the time is still here.',
};

/**
 * The sentence for a refusal, or the honest fallback.
 *
 * ⚠️ **`Object.hasOwn` rather than `REFUSALS[reason] ?? …`.** An object literal inherits from
 * `Object.prototype`, so `REFUSALS['toString']` is a function — truthy, so `??` would hand
 * back a function and the card would render `undefined`. The reason here comes off a JSON body
 * rather than a URL, which makes it less reachable and not less worth getting right;
 * `lib/access.ts` carries the same fix, found as a real defect.
 */
export function refusalWording(reason: string): string {
  return Object.hasOwn(REFUSALS, reason)
    ? (REFUSALS[reason] ?? REFUSALS.refused!)
    : // A reason nobody has written wording for. It says what is true of every one of them:
      // it did not land, nothing is lost, and somebody should be told.
      REFUSALS.refused!;
}

/**
 * The club could not be reached at all — no network, or the Worker answered an outage.
 *
 * ⚠️ **This is the ordinary case on a course, and it must not read as a problem.** A marshal
 * at Ashton Court with no signal is having a completely normal morning. The card still goes to
 * `failed` — an error that never surfaced is worse — but the sentence says plainly that this
 * is what being offline looks like and that the phone will keep trying.
 */
export const SYNC_UNAVAILABLE =
  'This crossing could not be sent just now — usually no signal. It is saved on this phone and will be sent again automatically.';

/**
 * The door has stopped letting this phone in. **Not a card failure**, and the screen says it
 * once rather than on every card.
 *
 * ⚠️ **It names two possibilities because the screen genuinely cannot tell them apart, and
 * guessing would state something false.** `middleware.ts` refuses by rewriting to an address
 * that matches no route, so what a sync receives is a **404 carrying HTML** — and that is the
 * answer both to a session that has lapsed and to a marshal who has been taken off this race's
 * roster. Making the refusals indistinguishable is deliberate and is what stops the door being
 * an oracle; the cost lands here, in a sentence that has to be true of either. **"You have
 * been signed out" alone would be a guess**, and a marshal who was actually unrostered would
 * sign in, be refused again, and have no idea why.
 *
 * Both have the same first move — open the club's site and sign in — and the second sentence
 * is the one that matters either way: nothing has been lost.
 */
export const SYNC_DOOR_REFUSED =
  'This phone is no longer being let in — either you have been signed out, or you have been taken off this race’s marshal list. Sign in again at the club’s site; if that does not help, ask whoever set the race up to check the marshal list. Every crossing on this screen is saved on this phone and will be sent once you are back.';

/**
 * The card has failed as often as it is going to, and wants a person.
 *
 * ⚠️ **It says what to do with it, not only that it stopped.** A card nobody can send still
 * holds a real time for a real runner, and the recoverable outcome is somebody writing the bib
 * and the time down on paper. That instruction is the whole value of this message.
 */
export const SYNC_MANUAL_REVIEW =
  'This crossing has failed too many times to keep trying on its own. Write the bib and the time down, tell whoever is running the race, and press Retry if you want to try again.';
