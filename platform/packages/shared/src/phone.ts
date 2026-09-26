/**
 * A phone number, accepted generously and stored in E.164.
 *
 * ## ⚠️ This deliberately restates rules that already exist in `nn-entry.ts`
 *
 * `normalisePhone()` in `nn-entry.ts` already parses UK and international numbers, and its
 * reasoning is good enough to copy rather than re-derive — the eleven-digit UK rule, the
 * `+44 (0)` trunk prefix, the refusal to invent opinions about foreign numbering plans. This
 * module is that logic with one thing changed and one constraint around it.
 *
 * **What changed: the output.** `nn-entry.ts` stores a UK number in national form,
 * `07700900123`, and argues correctly that one number written two ways makes *"is this the
 * number already on file"* a string comparison that gets the wrong answer. This module stores
 * **E.164** — `+447700900123` — because the club asked for it, with a reason that national
 * form cannot serve: *a member with a French number should be reachable on it*. National form
 * has no way to say which country a number belongs to; E.164 is the format that does.
 *
 * **What constrained it: `nn-entry.ts` is frozen.** Every page that takes money is unchanged
 * until after Nightingale Nightmare on 1 November 2026, and that file is the race entry
 * form's schema. Importing from it would also pull every race-entry Zod schema into the
 * membership page's browser bundle — the entry form's own bundle is 74 kB and carries Zod for
 * exactly that reason, which is the cost `money.ts` and `plural.ts` were both split out to
 * avoid paying twice.
 *
 * So: a leaf module, importing nothing, duplicating the parsing rules on purpose.
 *
 * ⚠️ **This is a debt with a due date, not an arrangement.** After the race, `nn-entry.ts`
 * adopts this module, its own `normalisePhone()` becomes a thin national-form renderer over
 * `parsePhone()` below, and the duplication goes. That is the same trade
 * [ADR-048](../../../../docs/architecture/decisions/adr-048-the-club-website-is-its-own-surface.md)
 * made for `club.css` against `base.css`, and it is recorded here so that leaving it undone
 * is visibly a choice rather than an oversight.
 *
 * ## What it will not do
 *
 * **No `libphonenumber`, and no table of national numbering plans.** Eight to fifteen digits
 * after a `+` is the whole of what this repository is willing to say about a number it did
 * not issue — `docs/architecture/principles.md`'s boundary-minimisation argument applies: a
 * club membership form has no business holding an opinion about how Portuguese numbers are
 * shaped, and a wrong opinion refuses a real member.
 *
 * **No extensions.** `nn-entry.ts` accepts `x123` because its field is an emergency contact,
 * dialled by somebody standing over a runner at the side of a course, and that might be a
 * switchboard. A membership application asks for the member's own number; E.164 has no
 * concept of an extension, and inventing a convention for one would put a string in a column
 * that claims to be E.164 and is not.
 */

/** The `tel:` prefix, in case somebody pastes a link rather than a number. */
const TEL_PREFIX = /^tel:/iu;

/** The punctuation people actually type in a phone number. */
const PHONE_PUNCTUATION = /[\s()\-./]/gu;

/** Anything left besides digits and a leading `+` once punctuation is stripped is a letter. */
const NOT_A_PHONE_CHARACTER = /[^\d+]/u;

/** The United Kingdom's country calling code, without the `+`. */
const UK_COUNTRY_CODE = '44';

/** A UK national number is exactly ten digits once the trunk `0` is removed. */
const UK_NATIONAL_DIGITS = 10;

/** With the trunk `0` still on the front, eleven. */
const UK_TRUNK_DIGITS = 11;

/** E.164 allows at most fifteen digits including the country code, and at least eight is the
 *  shortest thing this module is prepared to call a phone number. */
const MIN_INTERNATIONAL_DIGITS = 8;
const MAX_INTERNATIONAL_DIGITS = 15;

/**
 * Why a number was refused.
 *
 * ⚠️ **A code rather than a sentence.** The wording belongs to whichever form is asking, so
 * that one rule can be worded for a membership application and for anything later without
 * either of them owning the other's copy. `membership-application.ts` maps these to the words
 * a member reads.
 */
export type PhoneProblem =
  'letters' | 'uk-shape' | 'international-shape' | 'unrecognised' | 'extension';

export interface PhoneResult {
  /** The number in E.164 — `+447700900123` — or an empty string when there is a problem. */
  value: string;
  /** Null when the number is fine. */
  problem: PhoneProblem | null;
}

/**
 * Parse a typed phone number into E.164.
 *
 * An empty box is **not** a problem here: absence is the caller's message to write, because
 * only the caller knows whether the field was required. Saying it twice would put two entries
 * in an error summary for one empty box.
 */
export function parsePhone(value: string): PhoneResult {
  const trimmed = value.replace(TEL_PREFIX, '').trim();

  // ⚠️ **Checked before anything is stripped.** `'-'` alone is not empty — it is content that
  // happens to strip down to nothing — and the two must not read the same way. A box holding
  // only punctuation is not a phone number and has to say so.
  if (trimmed === '') {
    return { value: '', problem: null };
  }

  const stripped = trimmed.replace(PHONE_PUNCTUATION, '');

  // An extension is refused rather than dropped, because dropping one silently stores a
  // number that will not reach the person who typed it.
  if (/x\d+$/iu.test(stripped)) {
    return { value: '', problem: 'extension' };
  }

  if (NOT_A_PHONE_CHARACTER.test(stripped)) {
    return { value: '', problem: 'letters' };
  }

  if (stripped.startsWith(`+${UK_COUNTRY_CODE}`)) {
    // **The trunk prefix, optionally still there.** `+44 (0)7700 900123` is the standard way
    // to print a UK number for an international reader — the bracketed 0 is dialled at home
    // and dropped abroad — and it survives punctuation-stripping as a leading 0 on the digits
    // after `+44`. Both `+447700900123` and `+4407700900123` are the same number.
    const afterCode = stripped.slice(1 + UK_COUNTRY_CODE.length);
    const national = afterCode.startsWith('0') ? afterCode.slice(1) : afterCode;

    return national.length === UK_NATIONAL_DIGITS
      ? { value: `+${UK_COUNTRY_CODE}${national}`, problem: null }
      : { value: '', problem: 'uk-shape' };
  }

  if (stripped.startsWith('0')) {
    // **UK national form is exactly eleven digits starting `0`, with no ten-digit
    // exception.** A ten-digit `0`-prefixed number has not been a valid UK number since the
    // "phONEday" reforms, and admitting one would need a lookup table of which old area codes
    // are genuinely ten digits — the dependency this module refuses at the top.
    return stripped.length === UK_TRUNK_DIGITS
      ? { value: `+${UK_COUNTRY_CODE}${stripped.slice(1)}`, problem: null }
      : { value: '', problem: 'uk-shape' };
  }

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1);

    // ⚠️ **This is the branch the club asked for.** A member living in France gives
    // `+33 6 12 34 56 78` and is stored reachable on it. National form could not have held
    // that number at all, which is the whole argument for E.164 here.
    return digits.length >= MIN_INTERNATIONAL_DIGITS &&
      digits.length <= MAX_INTERNATIONAL_DIGITS
      ? { value: `+${digits}`, problem: null }
      : { value: '', problem: 'international-shape' };
  }

  // Digits with no `0` and no `+`. This is where `7700900123` lands — a UK mobile with the
  // trunk zero left off — and it is refused rather than guessed at, because assuming `+44`
  // for any bare number would turn a mistyped foreign number into a plausible British one.
  return { value: '', problem: 'unrecognised' };
}

/**
 * Whether a number is a problem, for a caller that does not need the parsed value.
 *
 * The validation half, kept beside the parsing half so there is one rule rather than two that
 * agree today.
 */
export function phoneProblem(value: string | undefined): PhoneProblem | null {
  if (value === undefined || value === '') return null;
  return parsePhone(value).problem;
}
