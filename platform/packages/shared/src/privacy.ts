/**
 * What a privacy notice prints where the club has not decided yet.
 *
 * ## Why this is a module rather than a line in each page
 *
 * There are two notices now — `/privacy/` for the club and the account, `/nn/privacy/` for
 * one race — and both of them carry values the committee has not settled. Each page used to
 * declare its own `orTbc`, which was fine while there was one page and is a drift risk with
 * two: the marker is not decoration, it is the sentence a reader is meant to recognise on
 * *both* pages as "nobody has answered this yet". Two copies of a legal string is two
 * chances for one of them to be reworded on its own, and the reader who met the other
 * wording would have no way to know the two mean the same thing.
 *
 * Both acceptance specs pin `TO_BE_CONFIRMED` as a literal of their own — deliberately, and
 * for the reason `nn-privacy.spec.ts`'s header gives: a test that imports its expectation
 * from the thing it is testing asserts nothing. So rewording the marker here fails two files
 * loudly and at once, which is exactly the size of noise a change to published legal wording
 * should make.
 *
 * ## Never a blank, and never a plausible default
 *
 * A notice with a gap where a retention period should be reads as though somebody forgot;
 * one with a number nobody chose is worse, because it reads as a decision. This says which
 * it is, in words, in the reader's own language.
 *
 * **Every interpolated value goes through it, including the settled ones.** Those cannot be
 * `null` today, and wrapping them is not defensiveness about the current content files — it
 * is what makes emptying one by accident render a sentence somebody notices rather than a
 * sentence with a hole in it.
 *
 * **A wrong answer on either page is a legal claim, not a typo.** See
 * docs/architecture/principles.md#stop-and-ask
 */

/** What both notices print for a value the committee has not settled. */
export const TO_BE_CONFIRMED = 'To be confirmed by the club';

/**
 * The fact, or the marker — never an empty string, and never an invented value.
 *
 * **An empty string is not an answer either**, which is why this is not a bare `??`. A
 * content file acquires `""` by somebody deleting a value rather than setting it to `null`,
 * and that would render an empty cell: a notice that reads as though nothing is collected
 * for that row, with the page's marker count unchanged and every test still green. The one
 * failure direction a privacy notice must not have is the quiet one.
 */
export function orTbc(fact: string | null | undefined): string {
  const stated = fact?.trim() ?? '';
  return stated === '' ? TO_BE_CONFIRMED : stated;
}
