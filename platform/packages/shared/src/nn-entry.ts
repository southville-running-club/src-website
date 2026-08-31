import { z } from 'zod';
import {
  deriveAgeCategory,
  isRealDate,
  compareCivilDates,
  ageOn,
  type CivilDate,
  type Gender,
  type AgeCategory,
  type ResultPlacement,
} from './age-category';
import type { EntryState } from './entry-state';

/**
 * The one definition of what a valid Nightingale Nightmare entry is.
 *
 * **One schema, both sides**, exactly as `nn-signup.ts` is: the Worker validates every
 * submission with it, and the progressive-enhancement script in the browser validates with
 * the same object rather than a second copy that drifts. Client-side validation is a
 * convenience. This running in the Worker is the control, and it runs whatever the browser
 * did or did not do — the form's whole argument is that it works with scripting off.
 *
 * ## Where the rules come from
 *
 * **Not from here.** The minimum age, which fees are on offer, what they cost and whether a
 * date of birth is wanted at all are `entries.events` and `entries.fees` columns, read at
 * request time through `entries.entry_state()` and handed in as {@link NnEntryRules}. A
 * second race is an `insert` and not an edit to this file, and Nightingale Nightmare's own
 * committee decisions can change without a deploy. What lives here is the *shape* of a valid
 * entry, which is the part that is genuinely the same for every race.
 *
 * ## The field list is the committee's, not the build's
 *
 * `intake.nn_interest` takes three fields and adding a fourth is a committee decision. That
 * rule has not been relaxed — the committee has *made* the decision, and this is the list it
 * made: name, email, phone number, date of birth, race category, gender, club, entry type,
 * emergency contact, and optional medical information under its own separate consent.
 * Anything not on that list is still a stop-and-ask.
 *
 * **The England Athletics number came off that list on 29 August 2026**, which is the only
 * time a field has ever gone the other way. It is described below.
 *
 * ## The runner's own phone number is the eighteenth field
 *
 * **Committee decision, 30 August 2026 — ADR-025, argued in issue #168.** `/nn/privacy/` has
 * said since it was written that the club collects a phone number and the club did not: what
 * `entries.entrants` held was an *emergency contact's* number, which belongs to somebody else
 * and is given for one thing. Deleting the claim was the cheaper way to make the notice true.
 * The club took the other, because a number it can reach a runner on — a start-time change, a
 * course change, somebody who has not come through registration — is a thing it has wanted on
 * every race it has put on, and ringing somebody's mother because the start moved by twenty
 * minutes is not what that number was for.
 *
 * **Required of a runner and not asked of a guide.** A guide already gives their own address
 * and their own emergency contact; a third contact detail for a second person on somebody
 * else's entry is one nothing uses. `entries.create_pending_purchase()` refuses a runner
 * without one, which is where this rule lives when the form is not the thing being posted to.
 *
 * **A nineteenth field is a new decision.**
 *
 * ## Race category and gender are two questions, and that is the fifteenth field
 *
 * They were one field until ADR-020. A required closed list is what the club can award prizes
 * and publish results in, and reusing it as the whole of "what is your gender" made a
 * three-item dropdown into a statement about how many genders there are. So `gender` is now
 * the **race category** — three values, because three is how many categories exist — and
 * `genderIdentity` is optional free text beside it that nothing groups, sorts or publishes
 * by. It is the same shape `/account/details/` has collected since #61, and the split is what
 * the GSS harmonised standard and HL7's Gender Harmony model both do.
 *
 * ## The England Athletics number is not asked for and not held
 *
 * **Committee decision, 29 August 2026.** A runner states that they are affiliated and the
 * club takes their word for it. Nothing here asks for a number, nothing stores one, and
 * `entries.entrants.ea_number` is null on every row behind a check constraint that keeps it
 * that way.
 *
 * The argument that ended it was that the number never bought what it looked like it bought.
 * **England Athletics publishes no verification API**, so the number was collected, its
 * format was checked, and that was the whole of what any software here could say about it —
 * a seven-digit string somebody typed, held against every runner who took the affiliated
 * price, doing no work. Under ARC Rule 21(2)(b) the club now has no record of *who* claimed
 * affiliation, only that they paid the affiliated £18, and the committee accepted that. What
 * replaces it is a sentence in the privacy notice: the club reserves the right to ask a
 * runner to produce their number or other evidence of affiliation.
 *
 * **The £18/£20 split is untouched**, and so is the £2 gap, which is ARC's Unattached Runner
 * Levy rather than the club's money. Which fee is the affiliated one is `entries.fees`'
 * business and is nothing about the person entering.
 *
 * @see docs/architecture/principles.md#personal-data-is-minimised-at-the-boundary
 */

// -----------------------------------------------------------------------------------------
// Limits, mirrored from the table's own constraints so the messages can quote them
// -----------------------------------------------------------------------------------------
// The database checks are a backstop for anything reaching Postgres by another route, not
// the validation. A submission that passes here and fails there means these two have
// drifted, and that is a defect rather than a bad submission.

export const NN_ENTRY_NAME_MAX_LENGTH = 60;
export const NN_ENTRY_EMAIL_MAX_LENGTH = 254;
export const NN_ENTRY_CLUB_MAX_LENGTH = 120;
export const NN_ENTRY_CONTACT_NAME_MAX_LENGTH = 120;
export const NN_ENTRY_PHONE_MAX_LENGTH = 40;
export const NN_ENTRY_MEDICAL_MAX_LENGTH = 2000;

/** The earliest birth year the form will take. Below it, a typo is far likelier than a life. */
export const NN_ENTRY_EARLIEST_BIRTH_YEAR = 1900;

/** What `entries.discount_codes.code`'s own check constraint allows. */
export const NN_ENTRY_DISCOUNT_CODE_MAX_LENGTH = 40;

/**
 * A trailing extension, kept apart from the number it belongs to.
 *
 * `x214` and `ext. 214` are both real ways people write one down, and neither is part of the
 * digits that get normalised into a canonical UK or international number — an extension has
 * no country code and no leading zero of its own.
 */
const PHONE_EXTENSION = /\s*(?:x|ext\.?)\s*(\d+)\s*$/i;

/** A leading `tel:` — real, because people paste rather than type. Case-insensitive. */
const TEL_PREFIX = /^tel:/i;

/** Anything left besides digits and a leading `+` once punctuation is stripped, is a letter. */
const HAS_A_LETTER_IN_A_PHONE = /[^\d+]/;

/**
 * Accept generously, store canonically, reject clearly.
 *
 * **UK national form is exactly eleven digits starting `0`.** The brief this shipped against
 * floated a ten-digit exception for "a handful of old area codes" and then, in the same
 * breath, gave `07700 90012` — itself ten digits — as an example of a number that must be
 * *rejected* as too short. Both cannot be true without a lookup table of which ten-digit
 * numbers are genuinely valid, which is exactly the dependency this brief also forbids
 * (`libphonenumber` or equivalent). Eleven digits, no exception, is the only reading that
 * satisfies the brief's own worked example — and it matches the UK numbering plan since the
 * "phONEday" reforms, under which a ten-digit `0`-prefixed number is not a valid modern
 * number in the first place.
 *
 * **`+44` is a rewrite into that same national form, not a separate shape.** `+447700900123`
 * and `07700900123` are one number written two ways, and storing them differently would make
 * "is this the number already on file" a string comparison that gets the answer wrong.
 *
 * **Everything else beginning `+` is stored as given, digits only.** 8–15 digits after the
 * `+` is deliberately the whole of the rule — `docs/architecture/principles.md`'s own
 * boundary-minimisation argument applies here too: this form does not know how Portuguese or
 * Australian numbers are shaped and has no business inventing an opinion about it.
 */
function normalisePhone(value: string): { value: string; problem: string | null } {
  const withoutPrefix = value.replace(TEL_PREFIX, '').trim();

  if (withoutPrefix === '') {
    // Genuinely nothing typed — somebody else's message — `min(1)` on a required box, or the
    // guide's own "missing" branch. This function is never asked to explain an empty one.
    //
    // **Checked before anything is stripped, deliberately.** `'-'` alone is not empty — it is
    // content that happens to strip down to nothing — and the two must not read the same way.
    // A box containing only punctuation is not a phone number and has to say so, which is
    // exactly the "digits are counted rather than merely present" hole this file has already
    // had to close once.
    return { value: '', problem: null };
  }

  const extensionMatch = PHONE_EXTENSION.exec(withoutPrefix);
  const extension = extensionMatch?.[1] ?? null;
  const withoutExtension = extensionMatch
    ? withoutPrefix.slice(0, extensionMatch.index)
    : withoutPrefix;

  // Stripped of the punctuation people actually use — spaces, brackets, dashes, dots, a
  // forward slash — before anything is said about what is left.
  const stripped = withoutExtension.replace(/[\s()\-./]/g, '');

  if (HAS_A_LETTER_IN_A_PHONE.test(stripped)) {
    return { value: '', problem: MESSAGES.phoneHasLetters };
  }

  const suffix = extension === null ? '' : ` x${extension}`;

  if (stripped.startsWith('+44')) {
    // **The trunk prefix, optionally still there.** `+44 (0)7700 900123` is the standard way
    // to print a UK number for an international reader — the bracketed 0 is dialled at home
    // and dropped abroad — and it survives punctuation-stripping as a leading 0 on the digits
    // after `+44`. Both `+447700900123` and `+4407700900123` are the same number.
    const afterCountryCode = stripped.slice(3);
    const nationalDigits = afterCountryCode.startsWith('0')
      ? afterCountryCode.slice(1)
      : afterCountryCode;
    return nationalDigits.length === 10
      ? { value: `0${nationalDigits}${suffix}`, problem: null }
      : { value: '', problem: MESSAGES.phoneUkShape };
  }

  if (stripped.startsWith('0')) {
    return stripped.length === 11
      ? { value: `${stripped}${suffix}`, problem: null }
      : { value: '', problem: MESSAGES.phoneUkShape };
  }

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1);
    return digits.length >= 8 && digits.length <= 15
      ? { value: `+${digits}${suffix}`, problem: null }
      : { value: '', problem: MESSAGES.phoneInternationalShape };
  }

  return { value: '', problem: MESSAGES.phoneUnrecognised };
}

/**
 * At least one letter, in any alphabet.
 *
 * The whole of what this repository is willing to say about a name. It refuses `.`, `123` and
 * `-` — a box somebody filled in to get past a required field — and refuses nothing else: no
 * length floor beyond one character, no ban on digits, apostrophes, hyphens or spaces, and no
 * opinion about scripts. A validator cleverer than this about names is one that eventually
 * tells a real person they are not real.
 */
const HAS_A_LETTER = /\p{L}/u;

/**
 * The race categories — what the club awards prizes in and publishes results by, which is a
 * different and much smaller question than a person's gender. Three because three is how many
 * categories the club has, not because three is how many genders there are; `genderIdentity`
 * below is where that question is actually asked. Adding a fourth here is a decision about
 * prize lists and results, and it is the committee's.
 */
export const NN_ENTRY_GENDERS = ['female', 'male', 'non_binary'] as const;

/** Matches `identity.people.gender`'s own ceiling, because it is the same question asked of
 *  the same people in the other half of the platform — see `account.ts`. Free text and not a
 *  closed list, for the reason recorded there: a closed list of genders is a decision about
 *  people the club has not taken and does not need to take to record an answer. */
export const NN_ENTRY_GENDER_IDENTITY_MAX_LENGTH = 60;

// -----------------------------------------------------------------------------------------
// The fields, in the order they appear on the page
// -----------------------------------------------------------------------------------------
// **The order is load-bearing.** The error summary is rendered by walking this list, so it
// lists problems in the order somebody will meet them scrolling down rather than in whatever
// order the validator happened to find them. `dateOfBirth` is one entry rather than three,
// because the day, month and year are one question and one error message.

export const NN_ENTRY_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'emailConfirm',
  // **The runner's own number, and it sits with the other two ways of reaching them.** The
  // emergency contact's number is a different question about a different person, four
  // fieldsets down, and putting them side by side is how a form gets one written in the
  // other's box. See ADR-025.
  'phone',
  'dateOfBirth',
  'gender',
  // **Only ever asked, and only ever required, when `gender` is `non_binary`.** ADR-031. It
  // sits between the two other race-category questions because that is where the mockup put
  // it and where the client-side reveal shows it: directly under "Which results category do
  // you want to be placed in?", above "How you describe your gender".
  'resultPlacement',
  'genderIdentity',
  'club',
  'feeCode',
  'discountCode',
  'emergencyName',
  'emergencyPhone',
  // **The guide's block sits after everything about the runner and before the medical
  // section**, which is where it is on the page. A person answers about themselves, then says
  // whether somebody is running with them, and only then meets one medical section covering
  // both — because there is one medical consent and it has to be below everything it covers.
  'viGuide',
  'guideFirstName',
  'guideLastName',
  'guideDateOfBirth',
  'guideEmail',
  'guideEmergencyName',
  'guideEmergencyPhone',
  'medicalNotes',
  'guideMedicalNotes',
  'medicalConsent',
  'entryTerms',
] as const;

export type NnEntryField = (typeof NN_ENTRY_FIELDS)[number];

/** At most one message per field — the first, because a list of four helps nobody. */
export type NnEntryErrors = Partial<Record<NnEntryField, string>>;

/**
 * Written for somebody on a phone, outdoors, who has just had a long form bounced. Each says
 * what to do rather than what went wrong, and none repeats the field's own label — the
 * message is announced beside the input it belongs to, so "Enter your first name" reads
 * correctly there and "First name: first name is invalid" does not.
 */
const MESSAGES = {
  firstNameMissing: 'Enter your first name.',
  firstNameTooLong: `Your first name is too long — ${NN_ENTRY_NAME_MAX_LENGTH} characters at most.`,
  lastNameMissing: 'Enter your last name.',
  lastNameTooLong: `Your last name is too long — ${NN_ENTRY_NAME_MAX_LENGTH} characters at most.`,

  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter an email address, like you@example.com.',
  emailTooLong: 'That email address is too long.',
  emailConfirmMissing: 'Type your email address again, to check it.',
  emailConfirmMismatch:
    'The two email addresses do not match. Check both, then try again.',

  // **"your own" is doing work.** The next number this form asks for belongs to somebody
  // else, and the two boxes are the likeliest pair on the page to be filled in the wrong way
  // round. The hint above the field says what the club uses it for; this only has to say
  // whose it is.
  phoneMissing: 'Enter your own phone number.',

  dobMissing: 'Enter your date of birth as a day, a month and a year.',
  dobNotADate: 'That is not a date. Check the day, the month and the year.',
  dobInFuture: 'A date of birth cannot be in the future.',
  dobImplausible: `Check the year — the earliest this form takes is ${NN_ENTRY_EARLIEST_BIRTH_YEAR}.`,

  // **The field's own name, and nothing else's.** This message used to read *"Choose a
  // category, so the club can work out your age category"* — which named neither the field it
  // is attached to nor anything else on screen. The field is labelled **Race category**;
  // directly beneath it is a different, optional field labelled **Gender**; and "your age
  // category" is a third thing again, derived from this answer and the date of birth. So the
  // one message somebody meets at the exact moment they are confused about which of the two
  // boxes is which explained itself in terms of two things that are not it.
  //
  // ADR-020 split race category and gender on purpose. This was the last place on the form
  // still blurring them. The hint above the field already says why the club asks, so the
  // error only has to say what to do. #148, finding 2.
  genderMissing: 'Choose your race category.',
  genderUnknown: 'Choose one of the categories listed.',

  // **Asked once, only of somebody who chose non-binary above.** The hint above the field
  // says why; the error only has to say what to do, the same rule `genderMissing` follows.
  resultPlacementMissing: 'Choose where your result should be placed.',
  resultPlacementUnknown: 'Choose one of the options listed.',

  genderIdentityTooLong: `That is too long — ${NN_ENTRY_GENDER_IDENTITY_MAX_LENGTH} characters at most.`,

  clubTooLong: `That club name is too long — ${NN_ENTRY_CLUB_MAX_LENGTH} characters at most.`,

  feeMissing: 'Choose an entry type.',
  feeUnknown: 'Choose one of the entry types listed.',

  emergencyNameMissing:
    'Enter the name of somebody the club can contact in an emergency.',
  emergencyNameTooLong: `That name is too long — ${NN_ENTRY_CONTACT_NAME_MAX_LENGTH} characters at most.`,
  emergencyPhoneMissing: 'Enter a phone number for your emergency contact.',
  phoneHasLetters: 'Enter a phone number using digits, not letters.',
  phoneUkShape:
    'That number is too short or too long. A UK number has 11 digits, starting 0.',
  phoneInternationalShape:
    'That number is too short or too long. An international number needs 8 to 15 digits after the +.',
  phoneUnrecognised:
    'Enter a UK number starting 0, or an international number starting +.',
  nameNoLetters: 'Enter the name as it should appear on the start list.',
  contactNameNoLetters: 'Enter the name of a person the club can ring on race day.',
  emergencyPhoneTooLong: `That phone number is too long — ${NN_ENTRY_PHONE_MAX_LENGTH} characters at most.`,

  medicalTooLong: `That is too long — ${NN_ENTRY_MEDICAL_MAX_LENGTH} characters at most.`,
  medicalConsentMissing:
    'You have written medical information. Tick the box to let the club hold it, or clear the box above.',

  discountCodeTooLong: `That is not a discount code — ${NN_ENTRY_DISCOUNT_CODE_MAX_LENGTH} characters at most.`,

  // **The guide's messages say "your guide" rather than repeating the runner's wording.**
  // Two sets of near-identical fields are the easiest thing on this form to lose your place
  // in, and the message beside the box is the cheapest way of saying which half you are in.
  guideFirstNameMissing: "Enter your guide's first name.",
  guideLastNameMissing: "Enter your guide's last name.",
  guideNameTooLong: `That name is too long — ${NN_ENTRY_NAME_MAX_LENGTH} characters at most.`,
  guideDobMissing: "Enter your guide's date of birth as a day, a month and a year.",
  guideDobNotADate: 'That is not a date. Check the day, the month and the year.',
  guideDobInFuture: 'A date of birth cannot be in the future.',
  guideDobImplausible: `Check the year — the earliest this form takes is ${NN_ENTRY_EARLIEST_BIRTH_YEAR}.`,
  // **The guide's own address, and the club has none without it.** A runner is reachable
  // through the address that paid; a guide has no purchase of their own, so this is the only
  // way to reach the second person on the course.
  guideEmailMissing: "Enter your guide's email address.",
  guideEmailInvalid: 'Enter an email address for your guide, like them@example.com.',
  guideEmailTooLong: 'That email address is too long.',
  guideEmergencyNameMissing:
    'Enter the name of somebody the club can contact about your guide in an emergency.',
  guideEmergencyPhoneMissing: "Enter a phone number for your guide's emergency contact.",
  guideEmergencyPhoneTooShort: 'Enter a phone number with at least seven digits in it.',
  // **The two must be different people, and this is the only place that can say so.**
  // `create_pending_purchase()` refuses somebody who already holds a place, but both halves
  // of one submission are written in the same transaction, so nothing in the database sees
  // the first when it checks the second. Enforced there too, within the payload; this is the
  // message a person actually reads.
  guideIsTheRunner:
    'Your guide cannot be you. Enter the details of the person running with you.',

  entryTermsMissing: 'Tick the box to accept the entry terms.',
} as const;

/** The message shown when a guide is too young for the course they would be on. */
export function guideMinimumAgeMessage(minimumAge: number): string {
  return `Your guide must be ${minimumAge} or over on race day.`;
}

/**
 * What a person is told when the database refuses their discount code.
 *
 * **One sentence for four different refusals, and that is deliberate rather than lazy.**
 * `entries.create_pending_purchase()` answers `invalid_discount` for a code that does not
 * exist, one that has been withdrawn, one whose places are gone, and one that is not for the
 * entry type chosen — because telling those four apart tells somebody who is guessing codes a
 * great deal and tells somebody who mistyped one nothing they can use. The message names the
 * two things a person can actually do about it.
 *
 * **Not a Zod rule**, because none of the four is knowable from the submission. This is a
 * refusal that arrives from the database and is rendered in the field's own error slot, which
 * is why it is a message rather than a validation.
 */
export const NN_ENTRY_DISCOUNT_REFUSED_MESSAGE =
  'That discount code cannot be used with this entry. Check it, or clear the box to enter at the standard price.';

/**
 * What a person is told when the address they gave already holds a place on this race.
 *
 * **It does not say "you have already entered", and the distinction is the whole message.**
 * The rule is about the address, not the person — so the somebody reading this may be a second
 * runner on a shared family address, who has entered nothing. Telling them they had already
 * entered would be a claim about a record that is not theirs, which is the failure this page
 * avoids everywhere else.
 *
 * **Not a Zod rule**, because whether an address already holds a place is not knowable from
 * the submission. It arrives from the database and is rendered in the email field's own error
 * slot, exactly as `NN_ENTRY_DISCOUNT_REFUSED_MESSAGE` is.
 */
export const NN_ENTRY_EMAIL_TAKEN_MESSAGE =
  'This email address already has a place for this race. Each entry needs its own email address — use a different one, or get in touch if you think this is wrong.';

/**
 * The same refusal, for somebody who is signed in — and it has to be a different sentence.
 *
 * ⚠️ **"Use a different one" is advice a signed-in person cannot take.** Their entry uses the
 * address on their account and the form does not offer a box to change it, so the message
 * above would name the one thing they are unable to do and leave them on a page with no way
 * forward. That is a dead end, and a dead end on the entry form on the morning entries open is
 * somebody emailing the club instead of entering.
 *
 * So this one names the two things that *are* open to them: look at the place they already
 * have, or — if they are entering for somebody else — sign out and use that person's own
 * address, which is what one place per email requires of them.
 */
export const NN_ENTRY_EMAIL_TAKEN_SIGNED_IN_MESSAGE =
  'Your account already has a place for this race — you can see it on your entries page. Entries use the address you are signed in with, so to enter somebody else, sign out and enter with their own email address.';

/** The message shown when a minimum age is configured and the entrant does not meet it. */
export function minimumAgeMessage(minimumAge: number): string {
  return `You must be ${minimumAge} or over on race day to enter.`;
}

// -----------------------------------------------------------------------------------------
// What the event says, rather than what this file assumes
// -----------------------------------------------------------------------------------------

export interface NnEntryRules {
  /** Civil, as published. Used to work out age on race day. */
  eventDate: CivilDate;
  /**
   * Null means no age check at all. **18 for Nightingale Nightmare 2026**, confirmed by the
   * committee on 13 August 2026 and applied as one `update` to `entries.events.minimum_age`
   * with no change to this file — which is the whole reason it is a column.
   */
  minimumAge: number | null;
  /** Which fee codes the form is offering. A code not in this list is not a valid answer. */
  feeCodes: readonly string[];
}

/** Lifts the rules straight off what `entries.entry_state()` returned, so nothing restates them. */
export function entryRulesFrom(state: EntryState): NnEntryRules {
  return {
    eventDate: state.eventDate,
    minimumAge: state.minimumAge,
    feeCodes: state.fees.map((fee) => fee.code),
  };
}

// -----------------------------------------------------------------------------------------
// What a valid entry is, once it has been read
// -----------------------------------------------------------------------------------------

/**
 * The person running with a visually impaired entrant.
 *
 * **Everything a runner gives, minus the one thing that is about money.** No club, because
 * nothing derives from it for somebody who is in no category. What is left is what the club
 * needs about anybody who is on a road in the dark: who they are, how old they are, and who
 * to ring.
 */
export interface NnEntryGuide {
  firstName: string;
  lastName: string;
  dateOfBirth: CivilDate;
  /**
   * The guide's own address.
   *
   * **A runner has none of these and a guide must.** A runner is reachable through the address
   * that paid, and a guide has no purchase of their own — so without this the club has put a
   * second person on an unlit course with no way to reach them.
   */
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  /** Null whenever the runner's medical consent was not given — the same consent covers both. */
  medicalNotes: string | null;
}

export interface NnEntry {
  firstName: string;
  lastName: string;
  email: string;
  /**
   * The runner's own number, for the club to reach them about the race.
   *
   * **Not the emergency contact's, and the club may use exactly one of them for this.**
   * `emergencyPhone` is somebody else's number, given for one thing, and ringing it because
   * the start moved by twenty minutes is not that thing. ADR-025, and it is the eighteenth
   * field.
   */
  phone: string;
  dateOfBirth: CivilDate;
  /** The race category, not the answer to "what is your gender" — see `genderIdentity`. */
  gender: Gender;
  /**
   * Where this runner's result should be placed, if `gender` is `non_binary` and they said —
   * null otherwise, always, including "do not place me in either". ADR-031. Read alongside
   * `gender` through `effectiveCategory()`, never on its own.
   */
  resultPlacement: ResultPlacement;
  /** How this runner describes their gender, in their own words. Null when they did not say,
   *  which is a real and common answer rather than a missing one. Never used to derive a
   *  category, never published, never sorted on. */
  genderIdentity: string | null;
  club: string | null;
  feeCode: string;
  emergencyName: string;
  emergencyPhone: string;
  /** Null whenever the separate medical consent was not given. Never stored otherwise. */
  medicalNotes: string | null;
  /** As typed, or null. Whether it is a real code is the database's to say, not this file's. */
  discountCode: string | null;
  /** The person running with them, or null. A guide takes one of the event's places. */
  guide: NnEntryGuide | null;
  consents: {
    entryTerms: true;
    medical: boolean;
    /**
     * That this entrant is visually impaired and is running with the guide above.
     *
     * **A consent rather than a column, and that is the decision.** It is a declaration about
     * disability — special category data under Article 9 — so it sits where the medical
     * consent sits, recorded as ticked under the event's own `consent_version`, rather than
     * becoming a boolean on `entrants` that every read would have to remember to omit. It is
     * also what `entries.create_pending_purchase()` reads to decide whether a second entrant
     * is allowed on the entry at all.
     */
    vi: boolean;
  };
}

export type NnEntryResult =
  | { ok: true; value: NnEntry; category: AgeCategory }
  | { ok: false; errors: NnEntryErrors };

// -----------------------------------------------------------------------------------------
// The schema
// -----------------------------------------------------------------------------------------
// Per-field rules on the object, cross-field rules in `superRefine`. Zod 4 runs the
// refinement **even when a field-level check has already failed**, which is what lets one
// submission come back with every problem on it at once. That matters more here than it did
// on the three-field interest form: this page is ten times as much to retype.

/** `'on'` is what an unvalued HTML checkbox posts when ticked; an unticked one posts nothing. */
const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

/** Optional text fields arrive as `''` from an untouched input, which means "not answered". */
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

/**
 * Every text-shaped key, filled in as `''` when the submission left it out entirely.
 *
 * **This is not tidying, it is what keeps the error summary complete.** Zod treats a missing
 * key as a *fatal* type failure and stops before `superRefine`, where an empty string is a
 * continuable one and does not. Those two are the same thing to an HTML form —
 * `<input type="radio">` posts nothing at all when nothing is selected, and every text input
 * posts `''` — so without this, submitting without choosing an entry type would report the
 * entry type and **silently swallow the unticked terms box and the missing date of birth**.
 * Somebody on a phone would fix one problem, submit, and meet the next.
 */
const TEXT_KEYS = [
  'firstName',
  'lastName',
  'email',
  'emailConfirm',
  'phone',
  'dobDay',
  'dobMonth',
  'dobYear',
  'gender',
  'resultPlacement',
  'genderIdentity',
  'club',
  'feeCode',
  'discountCode',
  'emergencyName',
  'emergencyPhone',
  'medicalNotes',
  // The guide's, for the same reason: these inputs are in the DOM whatever the declaration
  // says, because JavaScript is what hides them and the form has to work without it.
  'guideFirstName',
  'guideLastName',
  'guideDobDay',
  'guideDobMonth',
  'guideDobYear',
  'guideEmail',
  'guideEmergencyName',
  'guideEmergencyPhone',
  'guideMedicalNotes',
] as const;

function absentTextAsEmpty(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    // Not an object at all — a JSON body, or nothing. Left alone so the object schema
    // rejects it at the root, which `parseNnEntry` turns into "every field is missing".
    return value;
  }

  const filled: Record<string, unknown> = { ...(value as Record<string, unknown>) };

  for (const key of TEXT_KEYS) {
    if (filled[key] === undefined || filled[key] === null) {
      filled[key] = '';
    }
  }

  return filled;
}

export function nnEntrySchema(rules: NnEntryRules) {
  return z.preprocess(absentTextAsEmpty, nnEntryObject(rules));
}

function nnEntryObject(rules: NnEntryRules) {
  return z
    .object({
      firstName: z
        .string(MESSAGES.firstNameMissing)
        .trim()
        .min(1, MESSAGES.firstNameMissing)
        .max(NN_ENTRY_NAME_MAX_LENGTH, MESSAGES.firstNameTooLong),

      lastName: z
        .string(MESSAGES.lastNameMissing)
        .trim()
        .min(1, MESSAGES.lastNameMissing)
        .max(NN_ENTRY_NAME_MAX_LENGTH, MESSAGES.lastNameTooLong),

      // Trimmed but **not lower-cased**: what somebody typed is what the club writes back
      // to. `entry_purchases.purchaser_email` is `citext`, so matching it later is
      // case-insensitive without the stored value being flattened.
      email: z
        .string(MESSAGES.emailMissing)
        .trim()
        .min(1, MESSAGES.emailMissing)
        .max(NN_ENTRY_EMAIL_MAX_LENGTH, MESSAGES.emailTooLong)
        .pipe(z.email(MESSAGES.emailInvalid)),

      // Only that it was answered. Whether it *matches* is a cross-field rule, and saying
      // "enter a valid email address" twice about the confirmation box helps nobody.
      emailConfirm: z
        .string(MESSAGES.emailConfirmMissing)
        .trim()
        .min(1, MESSAGES.emailConfirmMissing),

      // **Required, and the same ceiling the emergency contact's number has.** Whether what
      // was typed is shaped like a phone number is a cross-field-shaped rule rather than a
      // per-field one — it counts digits — so it is in `superRefine` below, through the same
      // `phoneProblem` the other two numbers on this form go through.
      phone: z
        .string(MESSAGES.phoneMissing)
        .trim()
        .min(1, MESSAGES.phoneMissing)
        .max(NN_ENTRY_PHONE_MAX_LENGTH, MESSAGES.emergencyPhoneTooLong),

      // **Three inputs, not a date picker.** A picker is hostile on a phone for a birth year
      // forty years back — it opens on this month and asks somebody to page backwards five
      // hundred times. Each part is taken as typed and judged together below, so the error
      // is one message about one question.
      dobDay: z.string().trim().catch(''),
      dobMonth: z.string().trim().catch(''),
      dobYear: z.string().trim().catch(''),

      gender: z.string(MESSAGES.genderMissing).trim().min(1, MESSAGES.genderMissing),

      // **Optional at this layer, and required by exactly one other field's answer.**
      // Whether it is required at all is a cross-field rule — `gender === 'non_binary'` —
      // so the "missing" case is judged in `superRefine` below, the same way the guide's
      // conditionally-required fields are. `'none'` is a real, distinct answer from
      // "did not say": it is what "do not place me in either" posts, and it resolves to a
      // stored `null` exactly as an entrant who was never asked does.
      resultPlacement: optionalText.pipe(
        z.enum(['female', 'male', 'none'], MESSAGES.resultPlacementUnknown).optional(),
      ),

      // **Optional, and never required by any combination of the other fields.** A person who
      // does not want to answer this has answered it. The only rule is a length ceiling, which
      // is there because this is an endpoint anybody may post to and not because 60 characters
      // is a judgement about what somebody may call themselves.
      genderIdentity: optionalText.pipe(
        z
          .string()
          .max(NN_ENTRY_GENDER_IDENTITY_MAX_LENGTH, MESSAGES.genderIdentityTooLong)
          .optional(),
      ),

      club: optionalText.pipe(
        z.string().max(NN_ENTRY_CLUB_MAX_LENGTH, MESSAGES.clubTooLong).optional(),
      ),

      feeCode: z.string(MESSAGES.feeMissing).trim().min(1, MESSAGES.feeMissing),

      // **Never required, and never checked for existence here.** Whether a code is real,
      // whether it has been withdrawn, whether its twenty-two places are gone and whether it
      // is even for the entry type chosen are four questions only
      // `entries.create_pending_purchase()` can answer, and it answers all four as one
      // refusal on purpose. What this can say is that forty-one characters is not a code —
      // a ceiling, because this is an endpoint anybody may post to.
      discountCode: optionalText.pipe(
        z
          .string()
          .max(NN_ENTRY_DISCOUNT_CODE_MAX_LENGTH, MESSAGES.discountCodeTooLong)
          .optional(),
      ),

      emergencyName: z
        .string(MESSAGES.emergencyNameMissing)
        .trim()
        .min(1, MESSAGES.emergencyNameMissing)
        .max(NN_ENTRY_CONTACT_NAME_MAX_LENGTH, MESSAGES.emergencyNameTooLong),

      emergencyPhone: z
        .string(MESSAGES.emergencyPhoneMissing)
        .trim()
        .min(1, MESSAGES.emergencyPhoneMissing)
        .max(NN_ENTRY_PHONE_MAX_LENGTH, MESSAGES.emergencyPhoneTooLong),

      medicalNotes: optionalText.pipe(
        z.string().max(NN_ENTRY_MEDICAL_MAX_LENGTH, MESSAGES.medicalTooLong).optional(),
      ),

      medicalConsent: checkbox,

      // --- the guide, and the declaration that asks for one ---------------------------------
      // **`viGuide` is a declaration and not a fee.** A visually impaired runner pays the same
      // affiliated or unaffiliated price everybody else pays; what ticking this says is that a
      // second person will be on the course with them, and the club needs to know who, for the
      // same reasons it needs to know who anybody on the course is.
      //
      // **Every guide field is optional here and conditional below.** They are in the DOM
      // whatever the box says — JavaScript only hides them — so a browser with scripting off
      // posts them empty, and requiring them at this level would refuse every entry from
      // everybody who is not bringing a guide.
      viGuide: checkbox,

      guideFirstName: optionalText.pipe(
        z.string().max(NN_ENTRY_NAME_MAX_LENGTH, MESSAGES.guideNameTooLong).optional(),
      ),
      guideLastName: optionalText.pipe(
        z.string().max(NN_ENTRY_NAME_MAX_LENGTH, MESSAGES.guideNameTooLong).optional(),
      ),

      guideDobDay: z.string().trim().catch(''),
      guideDobMonth: z.string().trim().catch(''),
      guideDobYear: z.string().trim().catch(''),

      guideEmail: optionalText.pipe(
        z.string().max(NN_ENTRY_EMAIL_MAX_LENGTH, MESSAGES.guideEmailTooLong).optional(),
      ),

      guideEmergencyName: optionalText.pipe(
        z
          .string()
          .max(NN_ENTRY_CONTACT_NAME_MAX_LENGTH, MESSAGES.emergencyNameTooLong)
          .optional(),
      ),
      guideEmergencyPhone: optionalText.pipe(
        z
          .string()
          .max(NN_ENTRY_PHONE_MAX_LENGTH, MESSAGES.emergencyPhoneTooLong)
          .optional(),
      ),

      // Under the runner's own medical consent rather than a second one. It is the same
      // question, asked of the second person on the same entry, kept for the same month and
      // deleted by the same cron.
      guideMedicalNotes: optionalText.pipe(
        z.string().max(NN_ENTRY_MEDICAL_MAX_LENGTH, MESSAGES.medicalTooLong).optional(),
      ),

      entryTerms: checkbox,
    })
    .superRefine((values, ctx) => {
      const fail = (field: NnEntryField, message: string): void => {
        ctx.addIssue({ code: 'custom', path: [field], message });
      };

      // --- the two email boxes ------------------------------------------------------------
      // Compared case-insensitively. The confirmation box exists to catch a typo, and
      // `Ada@Example.com` against `ada@example.com` is the same mailbox — refusing it would
      // be the form inventing a distinction the mail system does not make.
      if (values.email && values.emailConfirm) {
        if (values.email.toLowerCase() !== values.emailConfirm.toLowerCase()) {
          fail('emailConfirm', MESSAGES.emailConfirmMismatch);
        }
      }

      // --- the runner's own number ----------------------------------------------------------
      // **The same function the emergency contact's number goes through**, rather than a
      // third copy of the rule. The second copy is what let `ask my mum` through on the field
      // whose whole purpose is to be dialled; a third would be the same wait for the same bug.
      const ownPhoneIssue = phoneProblem(values.phone);
      if (ownPhoneIssue !== null) {
        fail('phone', ownPhoneIssue);
      }

      // --- the date of birth ---------------------------------------------------------------
      const dobIssue = dateOfBirthIssue(values, rules);
      if (dobIssue !== null) {
        fail('dateOfBirth', dobIssue);
      }

      // --- gender ---------------------------------------------------------------------------
      // Only checked for membership once it has been answered; an unanswered select has
      // already produced `genderMissing` above and does not need a second opinion.
      if (values.gender && !isGender(values.gender)) {
        fail('gender', MESSAGES.genderUnknown);
      }

      // --- where a non-binary entrant's result should be placed --------------------------------
      // **Asked once, of exactly the people `gender` says it should be asked of.** Anybody
      // else's answer here — if the request carries one at all — is never read; the output
      // construction below only consults `resultPlacement` when `gender` is `non_binary`,
      // which is the same rule `entrants_result_placement_only_non_binary` enforces at the
      // database.
      if (values.gender === 'non_binary' && !values.resultPlacement) {
        fail('resultPlacement', MESSAGES.resultPlacementMissing);
      }

      // --- the entry type ---------------------------------------------------------------------
      // **Nothing hangs off which one was chosen any more.** It used to decide whether an
      // England Athletics number was required; the club stopped asking for one on 29 August
      // 2026, so the entry type is now a price and nothing else about the person.
      if (values.feeCode && !rules.feeCodes.includes(values.feeCode)) {
        fail('feeCode', MESSAGES.feeUnknown);
      }

      // --- the names ------------------------------------------------------------------------
      // **At least one letter, and nothing more opinionated than that.** See `HAS_A_LETTER`:
      // this refuses a full stop typed to get past a required field, and refuses nothing else.
      for (const [field, value] of [
        ['firstName', values.firstName],
        ['lastName', values.lastName],
      ] as const) {
        if (value && !HAS_A_LETTER.test(value)) {
          fail(field, MESSAGES.nameNoLetters);
        }
      }

      if (values.emergencyName && !HAS_A_LETTER.test(values.emergencyName)) {
        fail('emergencyName', MESSAGES.contactNameNoLetters);
      }

      // --- the emergency phone ----------------------------------------------------------------
      // Digits are counted rather than the whole string being matched against a pattern.
      // Phone numbers are written with spaces, brackets, dashes and a leading `+` in every
      // combination, and a form that refuses one of them is wrong about the phone number
      // rather than the phone number being wrong.
      const phoneIssue = phoneProblem(values.emergencyPhone);
      if (phoneIssue !== null) {
        fail('emergencyPhone', phoneIssue);
      }

      // --- medical information, and its own consent ------------------------------------------
      // **Notes written without the consent ticked are refused rather than quietly dropped.**
      // Dropping them would be safe for the database and dishonest to the person: they typed
      // something they expect a first-aider to see, and the form would have thrown it away
      // without saying so. The message names both ways out. `parseNnEntry` drops them as well,
      // so no caller can reach a state where unconsented notes exist.
      // **Either box of notes trips it.** The consent covers both people on the entry, so
      // notes written about a guide and no consent is the same refusal, said in the same
      // place, as notes written about the runner.
      if (
        (values.medicalNotes !== undefined || values.guideMedicalNotes !== undefined) &&
        !values.medicalConsent
      ) {
        fail('medicalConsent', MESSAGES.medicalConsentMissing);
      }

      // --- the guide, when one has been declared ---------------------------------------------
      // **Nothing below runs unless the box is ticked**, which is what makes six required
      // fields safe to leave in the DOM for a browser with no JavaScript to hide them.
      if (values.viGuide) {
        if (values.guideFirstName === undefined) {
          fail('guideFirstName', MESSAGES.guideFirstNameMissing);
        }

        if (values.guideLastName === undefined) {
          fail('guideLastName', MESSAGES.guideLastNameMissing);
        }

        const guideDobIssue = dateOfBirthIssue(
          {
            dobDay: values.guideDobDay,
            dobMonth: values.guideDobMonth,
            dobYear: values.guideDobYear,
          },
          rules,
          GUIDE_DOB_MESSAGES,
        );

        if (guideDobIssue !== null) {
          fail('guideDateOfBirth', guideDobIssue);
        }

        if (values.guideEmail === undefined) {
          fail('guideEmail', MESSAGES.guideEmailMissing);
        } else if (!z.email().safeParse(values.guideEmail).success) {
          fail('guideEmail', MESSAGES.guideEmailInvalid);
        }

        if (values.guideEmergencyName === undefined) {
          fail('guideEmergencyName', MESSAGES.guideEmergencyNameMissing);
        } else if (!HAS_A_LETTER.test(values.guideEmergencyName)) {
          fail('guideEmergencyName', MESSAGES.contactNameNoLetters);
        }

        // **The same function the runner's number goes through**, rather than a second copy of
        // the rule. The copy is how the two came to differ: this branch was written by
        // duplicating the one above, and it duplicated the hole in it as well.
        if (values.guideEmergencyPhone === undefined) {
          fail('guideEmergencyPhone', MESSAGES.guideEmergencyPhoneTooShort);
        } else {
          const guidePhoneIssue = phoneProblem(values.guideEmergencyPhone);
          if (guidePhoneIssue !== null) {
            fail('guideEmergencyPhone', guidePhoneIssue);
          }
        }

        // **The guide and the runner cannot be the same person**, and this is the only layer
        // that can see both halves at once. `create_pending_purchase()` refuses an entrant who
        // already holds a live place, but both of these are written inside one transaction, so
        // the database checking the second against what is committed cannot see the first.
        // It is enforced within the payload there as well — this is the half that produces a
        // sentence somebody can act on.
        //
        // Keyed on the same three things the database keys on, and compared the same way:
        // case-insensitively, trimmed, name and date of birth. Anything looser would refuse a
        // father and son with the same name, who are two people and two places.
        const sameName =
          values.guideFirstName !== undefined &&
          values.guideLastName !== undefined &&
          values.guideFirstName.toLowerCase() === values.firstName.toLowerCase() &&
          values.guideLastName.toLowerCase() === values.lastName.toLowerCase();

        const sameDob =
          values.guideDobDay === values.dobDay &&
          values.guideDobMonth === values.dobMonth &&
          values.guideDobYear === values.dobYear;

        if (sameName && sameDob) {
          fail('guideFirstName', MESSAGES.guideIsTheRunner);
        }
      }

      // --- the entry terms -------------------------------------------------------------------
      if (!values.entryTerms) {
        fail('entryTerms', MESSAGES.entryTermsMissing);
      }
    });
}

/**
 * The four messages a date of birth can produce, so the same rules can be applied to the
 * runner's and to the guide's without a second copy of them.
 *
 * **A copy is what this exists to avoid.** The runner's date of birth and the guide's are
 * judged against the same calendar, the same earliest year and the same minimum age, and two
 * implementations of that would be two things to keep in step — with the one that drifts
 * being the one nobody is looking at.
 */
interface DateOfBirthMessages {
  missing: string;
  notADate: string;
  inFuture: string;
  implausible: string;
  tooYoung: (minimumAge: number) => string;
}

const RUNNER_DOB_MESSAGES: DateOfBirthMessages = {
  missing: MESSAGES.dobMissing,
  notADate: MESSAGES.dobNotADate,
  inFuture: MESSAGES.dobInFuture,
  implausible: MESSAGES.dobImplausible,
  tooYoung: minimumAgeMessage,
};

const GUIDE_DOB_MESSAGES: DateOfBirthMessages = {
  missing: MESSAGES.guideDobMissing,
  notADate: MESSAGES.guideDobNotADate,
  inFuture: MESSAGES.guideDobInFuture,
  implausible: MESSAGES.guideDobImplausible,
  tooYoung: guideMinimumAgeMessage,
};

/**
 * The validation half of `normalisePhone`, for the three call sites that only need to know
 * whether a number is a problem, not what it normalises to. Null means it is fine.
 *
 * Shared between the runner's own contact and the guide's, because they are the same question
 * asked twice — and a second copy of the rule is exactly how a past defect here came to exist
 * in two places: `ask my mum`, `n/a` and `see above` were once accepted, on the one field
 * whose entire purpose is to be dialled by somebody standing over a runner at the side of a
 * course.
 */
function phoneProblem(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    // Absence is somebody else's message: `min(1)` on the runner's box, and the guide's own
    // "missing" branch. Saying it twice would put two entries in the summary for one empty box.
    return null;
  }

  if (value.length > NN_ENTRY_PHONE_MAX_LENGTH) {
    return MESSAGES.emergencyPhoneTooLong;
  }

  return normalisePhone(value).problem;
}

/** Every date-of-birth rule, in the order they should be reported. Null means it is fine. */
function dateOfBirthIssue(
  values: { dobDay: string; dobMonth: string; dobYear: string },
  rules: NnEntryRules,
  messages: DateOfBirthMessages = RUNNER_DOB_MESSAGES,
): string | null {
  const { dobDay, dobMonth, dobYear } = values;

  if (dobDay === '' || dobMonth === '' || dobYear === '') {
    return messages.missing;
  }

  // `Number('12abc')` is `NaN` but `Number(' 12 ')` is 12, and both arrive here as strings
  // from a form. A digits-only test is the honest one — `parseInt` would read "12abc" as 12.
  if (!/^\d+$/.test(dobDay) || !/^\d+$/.test(dobMonth) || !/^\d{4}$/.test(dobYear)) {
    return messages.notADate;
  }

  const date: CivilDate = {
    year: Number(dobYear),
    month: Number(dobMonth),
    day: Number(dobDay),
  };

  if (date.year < NN_ENTRY_EARLIEST_BIRTH_YEAR) {
    return messages.implausible;
  }

  // Rolls over rather than refusing is what `new Date(y, m, d)` would do — 31 February
  // becoming 3 March. `isRealDate` refuses. See age-category.ts.
  if (!isRealDate(date)) {
    return messages.notADate;
  }

  if (compareCivilDates(date, rules.eventDate) > 0) {
    return messages.inFuture;
  }

  // **Null still means no check; Nightingale Nightmare's is now 18.** The value arrived as
  // one `update` to `entries.events.minimum_age` with no deploy and no change to this file,
  // which is what a column buys. `entries.create_pending_purchase()` re-checks it against the
  // same `event_date` before it holds a place, because this one is a convenience and that one
  // is the control — a boundary test on each side of exactly 18 is what says the two agree.
  if (rules.minimumAge !== null && ageOn(date, rules.eventDate) < rules.minimumAge) {
    return messages.tooYoung(rules.minimumAge);
  }

  return null;
}

function isGender(value: string): value is Gender {
  return (NN_ENTRY_GENDERS as readonly string[]).includes(value);
}

function isNnEntryField(key: PropertyKey): key is NnEntryField {
  return (NN_ENTRY_FIELDS as readonly PropertyKey[]).includes(key);
}

/**
 * Normalise and validate one submission.
 *
 * Takes `unknown` on purpose: the Worker hands it `Object.fromEntries(formData)`, which is
 * whatever was posted, and a submission that is not an object at all — a JSON body, an empty
 * request — must be rejected rather than crash.
 *
 * Returns the derived age category alongside a valid entry, because every caller that wants
 * one wants it at the same moment and deriving it twice is how the confirmation page and the
 * form end up disagreeing.
 */
export function parseNnEntry(input: unknown, rules: NnEntryRules): NnEntryResult {
  const parsed = nnEntrySchema(rules).safeParse(input);

  if (!parsed.success) {
    const errors: NnEntryErrors = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path[0];

      // A body that is not an object at all produces one issue with an empty path. Every
      // required field is missing in that case, and saying so on each is more use than one
      // form-level message nobody can act on.
      if (field === undefined) {
        return { ok: false, errors: emptySubmissionErrors(rules) };
      }

      // First message per field wins. `max` after `min` on the same input would otherwise
      // overwrite the more useful one.
      if (isNnEntryField(field) && errors[field] === undefined) {
        errors[field] = issue.message;
      }
    }

    return { ok: false, errors };
  }

  const values = parsed.data;

  // Narrowing rather than casting: the schema checked membership in `superRefine`, and this
  // is what makes that check visible to the type system too.
  if (!isGender(values.gender)) {
    return { ok: false, errors: { gender: MESSAGES.genderUnknown } };
  }

  const dateOfBirth: CivilDate = {
    year: Number(values.dobYear),
    month: Number(values.dobMonth),
    day: Number(values.dobDay),
  };

  // **Minimised here, before anything can store it.** One field is dropped rather than
  // carried: the medical notes, when the separate consent was not given. The schema already
  // refuses that combination, so this is the second of two locks rather than the only one.
  //
  // There were two until 29 August 2026. The other was the England Athletics number against a
  // fee that did not want one, and it is not dropped here now because it is not read here at
  // all — the club stopped asking, so there is nothing arriving to drop.

  // **Built only when the declaration was made, so an untouched set of guide inputs cannot
  // become a second person on the entry.** `superRefine` has already refused a ticked box with
  // anything missing, so every field here is present by the time this runs — the narrowing
  // below is what makes that visible to the type system rather than a second opinion about it.
  let guide: NnEntryGuide | null = null;

  if (values.viGuide) {
    if (
      values.guideFirstName === undefined ||
      values.guideLastName === undefined ||
      values.guideEmail === undefined ||
      values.guideEmergencyName === undefined ||
      values.guideEmergencyPhone === undefined
    ) {
      return { ok: false, errors: { guideFirstName: MESSAGES.guideFirstNameMissing } };
    }

    guide = {
      firstName: values.guideFirstName,
      lastName: values.guideLastName,
      dateOfBirth: {
        year: Number(values.guideDobYear),
        month: Number(values.guideDobMonth),
        day: Number(values.guideDobDay),
      },
      // **No race category, deliberately.** A guide is in none — not timed, not placed — so
      // asking which one they would be in was collecting an answer nothing could use. The
      // column allows null for exactly this row and no other. See ADR-022.
      email: values.guideEmail,
      emergencyName: values.guideEmergencyName,
      emergencyPhone: normalisePhone(values.guideEmergencyPhone).value,
      medicalNotes: values.medicalConsent ? (values.guideMedicalNotes ?? null) : null,
    };
  }

  // **Read only when `gender` is `non_binary`, and never trusted otherwise.** The same rule
  // `entrants_result_placement_only_non_binary` enforces at the database — a payload that
  // named a placement for a female or male entrant is not an error, it is simply not this
  // entrant's answer to read. `'none'` — "do not place me in either" — resolves to the same
  // stored `null` an entrant who was never asked the question would have.
  const resultPlacement: ResultPlacement =
    values.gender === 'non_binary' &&
    values.resultPlacement &&
    values.resultPlacement !== 'none'
      ? values.resultPlacement
      : null;

  return {
    ok: true,
    value: {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: normalisePhone(values.phone).value,
      dateOfBirth,
      gender: values.gender,
      resultPlacement,
      genderIdentity: values.genderIdentity ?? null,
      club: values.club ?? null,
      feeCode: values.feeCode,
      emergencyName: values.emergencyName,
      emergencyPhone: normalisePhone(values.emergencyPhone).value,
      medicalNotes: values.medicalConsent ? (values.medicalNotes ?? null) : null,
      discountCode: values.discountCode ?? null,
      guide,
      consents: {
        entryTerms: true,
        medical: values.medicalConsent,
        // **False rather than absent when the box was not ticked.** The database reads this
        // key to decide how many entrants the payload is allowed to carry, and `is distinct
        // from 'true'` treats absent and false alike — but a consents object that records the
        // question having been asked is a better record than one that is silent about it.
        vi: values.viGuide,
      },
    },
    category: deriveAgeCategory(
      dateOfBirth,
      values.gender,
      resultPlacement,
      rules.eventDate,
    ),
  };
}

function emptySubmissionErrors(rules: NnEntryRules): NnEntryErrors {
  const parsed = nnEntrySchema(rules).safeParse({});
  if (parsed.success) {
    return {};
  }

  const errors: NnEntryErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field !== undefined && isNnEntryField(field) && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
