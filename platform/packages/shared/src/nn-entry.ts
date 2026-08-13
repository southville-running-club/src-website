import { z } from 'zod';
import {
  deriveAgeCategory,
  isRealDate,
  compareCivilDates,
  ageOn,
  type CivilDate,
  type Gender,
  type AgeCategory,
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
 * made: name, email, date of birth, gender, club, entry type, England Athletics number,
 * emergency contact, and optional medical information under its own separate consent.
 * Anything not on that list is still a stop-and-ask.
 *
 * ## The England Athletics number is checked, not verified
 *
 * **England Athletics publishes no verification API.** The number is collected, its format
 * is checked, and that is the whole of what any software here can say about it. The £2
 * affiliated discount is spot-checked afterwards by a human against the club's myAthletics
 * portal access. Nothing in this repository should be read as confirming that a number is
 * real, belongs to the person who typed it, or is currently registered.
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

/** What the `entrants.ea_number` check constraint allows. Format only — see the note above. */
export const EA_NUMBER_PATTERN = /^[0-9]{6,8}$/;

/** Enough digits to be a phone number, whatever spaces and brackets are around them. */
const MINIMUM_PHONE_DIGITS = 7;

export const NN_ENTRY_GENDERS = ['female', 'male', 'non_binary'] as const;

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
  'dateOfBirth',
  'gender',
  'club',
  'feeCode',
  'eaNumber',
  'emergencyName',
  'emergencyPhone',
  'medicalNotes',
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

  dobMissing: 'Enter your date of birth as a day, a month and a year.',
  dobNotADate: 'That is not a date. Check the day, the month and the year.',
  dobInFuture: 'A date of birth cannot be in the future.',
  dobImplausible: `Check the year — the earliest this form takes is ${NN_ENTRY_EARLIEST_BIRTH_YEAR}.`,

  genderMissing: 'Choose an option, so the club can work out your age category.',
  genderUnknown: 'Choose one of the options listed.',

  clubTooLong: `That club name is too long — ${NN_ENTRY_CLUB_MAX_LENGTH} characters at most.`,

  feeMissing: 'Choose an entry type.',
  feeUnknown: 'Choose one of the entry types listed.',

  eaMissing:
    'Enter your England Athletics number, or choose the unaffiliated entry instead.',
  // **Guidance, not a rule, and the difference is deliberate.** Every number the club has
  // seen is seven digits, and the national range below that is unknown — so the check stays
  // at 6 to 8 while the message says what somebody should actually go and look at. Quoting
  // "6 to 8 digits" as though it were the rule invites somebody with a genuine six-digit
  // number to doubt it, and a false reject here blocks a paying entrant at the worst
  // possible moment.
  eaFormat:
    'England Athletics numbers are seven digits — check the one on your registration email.',

  emergencyNameMissing:
    'Enter the name of somebody the club can contact in an emergency.',
  emergencyNameTooLong: `That name is too long — ${NN_ENTRY_CONTACT_NAME_MAX_LENGTH} characters at most.`,
  emergencyPhoneMissing: 'Enter a phone number for your emergency contact.',
  emergencyPhoneTooShort: 'Enter a phone number with at least seven digits in it.',
  emergencyPhoneTooLong: `That phone number is too long — ${NN_ENTRY_PHONE_MAX_LENGTH} characters at most.`,

  medicalTooLong: `That is too long — ${NN_ENTRY_MEDICAL_MAX_LENGTH} characters at most.`,
  medicalConsentMissing:
    'You have written medical information. Tick the box to let the club hold it, or clear the box above.',

  entryTermsMissing: 'Tick the box to accept the entry terms.',
} as const;

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
  /** The subset of those codes for which an England Athletics number is required. */
  eaRequiredForFeeCodes: readonly string[];
}

/** Lifts the rules straight off what `entries.entry_state()` returned, so nothing restates them. */
export function entryRulesFrom(state: EntryState): NnEntryRules {
  return {
    eventDate: state.eventDate,
    minimumAge: state.minimumAge,
    feeCodes: state.fees.map((fee) => fee.code),
    eaRequiredForFeeCodes: state.fees
      .filter((fee) => fee.requiresEaNumber)
      .map((fee) => fee.code),
  };
}

// -----------------------------------------------------------------------------------------
// What a valid entry is, once it has been read
// -----------------------------------------------------------------------------------------

export interface NnEntry {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: CivilDate;
  gender: Gender;
  club: string | null;
  feeCode: string;
  /** Null unless the chosen fee requires one — see the dropping rule in `parseNnEntry`. */
  eaNumber: string | null;
  emergencyName: string;
  emergencyPhone: string;
  /** Null whenever the separate medical consent was not given. Never stored otherwise. */
  medicalNotes: string | null;
  consents: {
    entryTerms: true;
    medical: boolean;
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
  'dobDay',
  'dobMonth',
  'dobYear',
  'gender',
  'club',
  'feeCode',
  'eaNumber',
  'emergencyName',
  'emergencyPhone',
  'medicalNotes',
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

      // **Three inputs, not a date picker.** A picker is hostile on a phone for a birth year
      // forty years back — it opens on this month and asks somebody to page backwards five
      // hundred times. Each part is taken as typed and judged together below, so the error
      // is one message about one question.
      dobDay: z.string().trim().catch(''),
      dobMonth: z.string().trim().catch(''),
      dobYear: z.string().trim().catch(''),

      gender: z.string(MESSAGES.genderMissing).trim().min(1, MESSAGES.genderMissing),

      club: optionalText.pipe(
        z.string().max(NN_ENTRY_CLUB_MAX_LENGTH, MESSAGES.clubTooLong).optional(),
      ),

      feeCode: z.string(MESSAGES.feeMissing).trim().min(1, MESSAGES.feeMissing),

      // Never required by itself. Whether this field is required at all depends on the fee
      // chosen, which is a cross-field rule and is applied below.
      eaNumber: optionalText,

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

      // --- the entry type, and the number that depends on it ---------------------------------
      if (values.feeCode && !rules.feeCodes.includes(values.feeCode)) {
        fail('feeCode', MESSAGES.feeUnknown);
      }

      // **Conditional on the server, always present in the DOM.** The field is rendered
      // whatever is selected and JavaScript only hides it; a browser with scripting off shows
      // it, and this is what decides whether it had to be filled in.
      if (rules.eaRequiredForFeeCodes.includes(values.feeCode)) {
        if (values.eaNumber === undefined) {
          fail('eaNumber', MESSAGES.eaMissing);
        } else if (!EA_NUMBER_PATTERN.test(values.eaNumber)) {
          fail('eaNumber', MESSAGES.eaFormat);
        }
      }

      // --- the emergency phone ----------------------------------------------------------------
      // Digits are counted rather than the whole string being matched against a pattern.
      // Phone numbers are written with spaces, brackets, dashes and a leading `+` in every
      // combination, and a form that refuses one of them is wrong about the phone number
      // rather than the phone number being wrong.
      if (values.emergencyPhone) {
        const digits = values.emergencyPhone.replace(/\D/g, '');
        if (digits.length > 0 && digits.length < MINIMUM_PHONE_DIGITS) {
          fail('emergencyPhone', MESSAGES.emergencyPhoneTooShort);
        }
      }

      // --- medical information, and its own consent ------------------------------------------
      // **Notes written without the consent ticked are refused rather than quietly dropped.**
      // Dropping them would be safe for the database and dishonest to the person: they typed
      // something they expect a first-aider to see, and the form would have thrown it away
      // without saying so. The message names both ways out. `parseNnEntry` drops them as well,
      // so no caller can reach a state where unconsented notes exist.
      if (values.medicalNotes !== undefined && !values.medicalConsent) {
        fail('medicalConsent', MESSAGES.medicalConsentMissing);
      }

      // --- the entry terms -------------------------------------------------------------------
      if (!values.entryTerms) {
        fail('entryTerms', MESSAGES.entryTermsMissing);
      }
    });
}

/** Every date-of-birth rule, in the order they should be reported. Null means it is fine. */
function dateOfBirthIssue(
  values: { dobDay: string; dobMonth: string; dobYear: string },
  rules: NnEntryRules,
): string | null {
  const { dobDay, dobMonth, dobYear } = values;

  if (dobDay === '' || dobMonth === '' || dobYear === '') {
    return MESSAGES.dobMissing;
  }

  // `Number('12abc')` is `NaN` but `Number(' 12 ')` is 12, and both arrive here as strings
  // from a form. A digits-only test is the honest one — `parseInt` would read "12abc" as 12.
  if (!/^\d+$/.test(dobDay) || !/^\d+$/.test(dobMonth) || !/^\d{4}$/.test(dobYear)) {
    return MESSAGES.dobNotADate;
  }

  const date: CivilDate = {
    year: Number(dobYear),
    month: Number(dobMonth),
    day: Number(dobDay),
  };

  if (date.year < NN_ENTRY_EARLIEST_BIRTH_YEAR) {
    return MESSAGES.dobImplausible;
  }

  // Rolls over rather than refusing is what `new Date(y, m, d)` would do — 31 February
  // becoming 3 March. `isRealDate` refuses. See age-category.ts.
  if (!isRealDate(date)) {
    return MESSAGES.dobNotADate;
  }

  if (compareCivilDates(date, rules.eventDate) > 0) {
    return MESSAGES.dobInFuture;
  }

  // **Null still means no check; Nightingale Nightmare's is now 18.** The value arrived as
  // one `update` to `entries.events.minimum_age` with no deploy and no change to this file,
  // which is what a column buys. `entries.create_pending_purchase()` re-checks it against the
  // same `event_date` before it holds a place, because this one is a convenience and that one
  // is the control — a boundary test on each side of exactly 18 is what says the two agree.
  if (rules.minimumAge !== null && ageOn(date, rules.eventDate) < rules.minimumAge) {
    return minimumAgeMessage(rules.minimumAge);
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

  // **Minimised here, before anything can store it.** Two fields are dropped rather than
  // carried:
  //
  //   * the England Athletics number when the chosen fee does not want one — it identifies a
  //     person and has no purpose against an unaffiliated entry, so it does not travel;
  //   * the medical notes when the separate consent was not given. The schema already refuses
  //     that combination, so this is the second of two locks rather than the only one.
  const eaRequired = rules.eaRequiredForFeeCodes.includes(values.feeCode);

  return {
    ok: true,
    value: {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      dateOfBirth,
      gender: values.gender,
      club: values.club ?? null,
      feeCode: values.feeCode,
      eaNumber: eaRequired ? (values.eaNumber ?? null) : null,
      emergencyName: values.emergencyName,
      emergencyPhone: values.emergencyPhone,
      medicalNotes: values.medicalConsent ? (values.medicalNotes ?? null) : null,
      consents: {
        entryTerms: true,
        medical: values.medicalConsent,
      },
    },
    category: deriveAgeCategory(dateOfBirth, values.gender, rules.eventDate),
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
