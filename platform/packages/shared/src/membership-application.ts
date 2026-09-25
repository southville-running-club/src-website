/**
 * What the club asks somebody who wants to join, and what it will accept as an answer.
 *
 * One schema, used by the form and by the server. `nn-entry.ts` is the shape this follows: a
 * field list, an errors map keyed by field, and a parse that returns either values or the
 * words a member reads beside the box they got wrong.
 *
 * ## ⚠️ Nothing here is stored yet, and that is deliberate
 *
 * A `membership.membership_applications` table would hold a date of birth, a home address and
 * a phone number. `CLAUDE.md` is explicit that adding a database column holding personal data
 * is a committee decision, and neither `/privacy/` nor `/nn/privacy/` currently covers this
 * collection or the England Athletics sharing a licence application involves.
 *
 * So this validates completely and stores nothing. The form submits to the club's existing
 * form on the old site through `links.json` until that decision lands, at which point
 * flipping it over is two fields in that file rather than a project.
 *
 * `packages/db/tests/membership.test.ts` asserts the applications table does **not** exist,
 * so the day somebody adds it, that fails for whoever has the committee's answer.
 *
 * ## Why the rules come from the database rather than from constants here
 *
 * The minimum age and the prices live in `membership.membership_types` and
 * `membership.settings`, because the club raises its fees about once a year and asked for
 * that to be a query rather than a deploy. They arrive here as `MembershipRules`, exactly the
 * way `nn-entry.ts` takes `NnEntryRules` — so the form and the server read the same numbers
 * and neither carries its own copy.
 */
import { z } from 'zod';

import { parsePhone, type PhoneProblem } from './phone.js';

/* -----------------------------------------------------------------------------------------
 * The shape of an answer
 * ----------------------------------------------------------------------------------------- */

export const MEMBERSHIP_NAME_MAX_LENGTH = 50;
export const MEMBERSHIP_EMAIL_MAX_LENGTH = 254;
export const MEMBERSHIP_PHONE_MAX_LENGTH = 40;
export const MEMBERSHIP_ADDRESS_MAX_LENGTH = 120;
export const MEMBERSHIP_CLUB_NAME_MAX_LENGTH = 120;

/** Nobody sensible was born before this, and a typo in a year is the usual cause. */
export const MEMBERSHIP_EARLIEST_BIRTH_YEAR = 1900;

/**
 * ⚠️ **A dropdown, where the club's current form has a free-text box.**
 *
 * A free-text title is a field that collects whatever somebody types into it — including
 * things that are not titles — on a form whose whole purpose is to be handed to England
 * Athletics. A closed list is the smaller collection and the more useful one.
 *
 * **"Prefer not to say" is on the list rather than implied by leaving it blank**, because a
 * required field with an opt-out says the club thought about it, and a blank says nobody did.
 */
export const MEMBERSHIP_TITLES = [
  'Mr',
  'Mrs',
  'Ms',
  'Miss',
  'Mx',
  'Dr',
  'Other',
  'Prefer not to say',
] as const;

export type MembershipTitle = (typeof MEMBERSHIP_TITLES)[number];

/**
 * The fields, in the order they are asked.
 *
 * ⚠️ **The country comes *after* the address lines**, which is the one reordering from the
 * club's current form. Asking for a country first makes somebody choose the format of an
 * address they have not started typing; asking last lets them write their address and then
 * say where it is.
 */
export const MEMBERSHIP_FIELDS = [
  'title',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'addressLine1',
  'addressLine2',
  'cityTown',
  'postcode',
  'country',
  'membershipType',
  'previousAffiliation',
  'previousClubName',
  'eaUrn',
  'eaPortalConsent',
  'agreeCodeOfConduct',
  'agreePrivacyPolicy',
  'agreeDisciplinaryPolicy',
] as const;

export type MembershipField = (typeof MEMBERSHIP_FIELDS)[number];

export type MembershipErrors = Partial<Record<MembershipField, string>>;

/**
 * What the club currently charges and requires, read from the database.
 *
 * `codes` is the set of membership types on offer *today* — a withdrawn option is not in it,
 * so an application naming one is refused rather than accepted against a price that is no
 * longer sold.
 */
export interface MembershipRules {
  /** The `code` of every active membership type, from `membership.membership_state()`. */
  codes: readonly string[];
  /** From `membership.settings`. 18 today, and the same 18 the race enforces. */
  minimumAge: number;
  /** The England Athletics registration year's cut-off, for the category calculation. */
  eaCutoffMonth: number;
  eaCutoffDay: number;
}

/* -----------------------------------------------------------------------------------------
 * The words a member reads
 * -----------------------------------------------------------------------------------------
 * Beside the box they got wrong, and written as something to do rather than as a complaint.
 */

const MESSAGES = {
  titleMissing: 'Choose a title, or “Prefer not to say”.',
  firstNameMissing: 'Enter your first name.',
  lastNameMissing: 'Enter your last name.',
  nameTooLong: `Use ${String(MEMBERSHIP_NAME_MAX_LENGTH)} characters or fewer.`,
  emailMissing: 'Enter your email address.',
  emailShape: 'Enter an email address in the form name@example.com.',
  emailTooLong: 'That email address is too long.',
  phoneMissing: 'Enter a phone number we can reach you on.',
  phoneTooLong: 'That phone number is too long.',
  dobMissing: 'Enter your date of birth.',
  dobShape: 'Enter your date of birth as a day, month and year.',
  dobFuture: 'Check the year — that date is in the future.',
  dobImplausible: 'Check the year.',
  addressMissing: 'Enter the first line of your address.',
  addressTooLong: `Use ${String(MEMBERSHIP_ADDRESS_MAX_LENGTH)} characters or fewer.`,
  cityMissing: 'Enter your town or city.',
  postcodeMissing: 'Enter your postcode.',
  postcodeUkShape: 'Enter a UK postcode, for example BS3 1DB.',
  countryMissing: 'Choose a country.',
  membershipTypeMissing: 'Choose which membership you want.',
  membershipTypeUnknown:
    'That membership is not available. Choose one of the options shown.',
  previousAffiliationMissing: 'Choose yes or no.',
  clubNameTooLong: `Use ${String(MEMBERSHIP_CLUB_NAME_MAX_LENGTH)} characters or fewer.`,
  eaUrnShape: 'A URN is digits only, with no spaces or letters.',
  eaPortalConsentMissing: 'Choose yes or no.',
  agreeRequired: 'You need to agree to this to join.',
} as const;

/** ⚠️ Worded here rather than in `phone.ts`, which returns a code so one rule can serve more
 *  than one form without either owning the other's copy. */
const PHONE_MESSAGES: Record<PhoneProblem, string> = {
  letters: 'Enter a phone number using digits only.',
  'uk-shape': 'A UK number is 11 digits, for example 07700 900123.',
  'international-shape':
    'Enter an international number with its country code, for example +33 6 12 34 56 78.',
  unrecognised:
    'Start a UK number with 0, or an international number with its country code, for example +33.',
  extension: 'Enter a direct number rather than one with an extension.',
};

/** What a member is told when they are under the club's minimum age. */
export function minimumAgeMessage(minimumAge: number): string {
  return `You need to be ${String(minimumAge)} or over to join the club.`;
}

/* -----------------------------------------------------------------------------------------
 * Postcodes
 * ----------------------------------------------------------------------------------------- */

/**
 * The UK postcode shape, as the Government Data Standards Catalogue gives it.
 *
 * ⚠️ **Checked only when the country is GB, and free text otherwise.** A form that applied
 * this to every country would refuse a French member's `75001` — which is exactly the failure
 * E.164 was chosen to avoid one field along, and it would be this module inventing an opinion
 * about a country it knows nothing about.
 */
const UK_POSTCODE =
  /^(GIR ?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9ABEHMNPRV-Y])?)|[0-9][A-HJKPS-UW]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/u;

/**
 * Stored uppercase with exactly one space before the final three characters.
 *
 * `bs31db`, `BS31DB` and `bs3  1db` are one postcode, and storing them differently makes
 * "have we got this address already" a comparison that gets the wrong answer — the same
 * argument E.164 settles for phone numbers.
 */
export function normaliseUkPostcode(value: string): string {
  const compact = value.replace(/\s+/gu, '').toUpperCase();

  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/* -----------------------------------------------------------------------------------------
 * Dates and ages
 * ----------------------------------------------------------------------------------------- */

/**
 * Whole years old on a given day.
 *
 * ⚠️ **Both dates are civil dates, not instants.** An age is a fact about a calendar, and
 * doing this with `Date` arithmetic across a timezone is how somebody becomes eligible an
 * hour early on a British Summer Time morning. `londonCivilDate()` is what answers "what day
 * is it" elsewhere in this repository; this takes the answer rather than deriving its own.
 */
export function ageOn(
  birth: { year: number; month: number; day: number },
  on: { year: number; month: number; day: number },
): number {
  let age = on.year - birth.year;

  const hadBirthday =
    on.month > birth.month || (on.month === birth.month && on.day >= birth.day);

  if (!hadBirthday) age -= 1;

  return age;
}

/**
 * The England Athletics registration year's cut-off, for the year an application is made in.
 *
 * A racing category is a fact about a season rather than about today, so an applicant's age
 * is quoted against the cut-off. The date itself comes from `membership.settings`, because
 * England Athletics move it independently of the club.
 */
export function eaCutoffFor(year: number, rules: MembershipRules) {
  return { year, month: rules.eaCutoffMonth, day: rules.eaCutoffDay };
}

/** `1992-05-09` as its three parts, or null when it is not a date at all. */
function civilDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // ⚠️ **Round-tripped rather than range-checked.** `2026-02-31` passes every bound and is
  // not a day; building the date and asking what it came back as is the only check that
  // catches it without restating how many days each month has.
  const built = new Date(Date.UTC(year, month - 1, day));
  if (
    built.getUTCFullYear() !== year ||
    built.getUTCMonth() !== month - 1 ||
    built.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/* -----------------------------------------------------------------------------------------
 * The schema
 * ----------------------------------------------------------------------------------------- */

const requiredText = (max: number, missing: string, tooLong: string) =>
  z
    .string({ error: missing })
    .transform((value) => value.trim())
    .refine((value) => value !== '', { error: missing })
    .refine((value) => value.length <= max, { error: tooLong });

const yesNo = (missing: string) =>
  z
    .union([z.boolean(), z.literal('yes'), z.literal('no')], { error: missing })
    .transform((value) => value === true || value === 'yes');

/**
 * ⚠️ **`today` is a closure variable, not a field on the parsed object.**
 *
 * The first draft threaded it through the input so `superRefine` could read `value.today` —
 * which Zod strips, because it is not in the object's shape, so every age check silently
 * compared against `undefined`. A closure is both simpler and impossible to get wrong that
 * way: it cannot be stripped, and it cannot arrive from a submitted body either, which
 * matters because a caller-supplied "today" reaching the schema from the wire would let
 * somebody choose the date their own age is measured against.
 */
function membershipSchema(
  rules: MembershipRules,
  today: { year: number; month: number; day: number },
) {
  return z
    .object({
      title: z.enum(MEMBERSHIP_TITLES, { error: MESSAGES.titleMissing }),

      firstName: requiredText(
        MEMBERSHIP_NAME_MAX_LENGTH,
        MESSAGES.firstNameMissing,
        MESSAGES.nameTooLong,
      ),
      lastName: requiredText(
        MEMBERSHIP_NAME_MAX_LENGTH,
        MESSAGES.lastNameMissing,
        MESSAGES.nameTooLong,
      ),

      // Trimmed and lower-cased, because an address is a identifier and `A@B.com` and
      // `a@b.com` are one mailbox.
      email: z
        .string({ error: MESSAGES.emailMissing })
        .transform((value) => value.trim().toLowerCase())
        .refine((value) => value !== '', { error: MESSAGES.emailMissing })
        .refine((value) => value.length <= MEMBERSHIP_EMAIL_MAX_LENGTH, {
          error: MESSAGES.emailTooLong,
        })
        .refine((value) => z.email().safeParse(value).success, {
          error: MESSAGES.emailShape,
        }),

      phone: z
        .string({ error: MESSAGES.phoneMissing })
        .transform((value) => value.trim())
        .refine((value) => value !== '', { error: MESSAGES.phoneMissing })
        .refine((value) => value.length <= MEMBERSHIP_PHONE_MAX_LENGTH, {
          error: MESSAGES.phoneTooLong,
        })
        .superRefine((value, ctx) => {
          const problem = parsePhone(value).problem;
          if (problem !== null) {
            ctx.addIssue({ code: 'custom', message: PHONE_MESSAGES[problem] });
          }
        })
        // Stored in E.164, so one number has one representation whichever way it was typed.
        .transform((value) => parsePhone(value).value),

      dateOfBirth: z
        .string({ error: MESSAGES.dobMissing })
        .transform((value) => value.trim())
        .refine((value) => value !== '', { error: MESSAGES.dobMissing })
        .refine((value) => civilDate(value) !== null, { error: MESSAGES.dobShape }),

      addressLine1: requiredText(
        MEMBERSHIP_ADDRESS_MAX_LENGTH,
        MESSAGES.addressMissing,
        MESSAGES.addressTooLong,
      ),
      addressLine2: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => value.length <= MEMBERSHIP_ADDRESS_MAX_LENGTH, {
          error: MESSAGES.addressTooLong,
        })
        .optional(),
      cityTown: requiredText(
        MEMBERSHIP_ADDRESS_MAX_LENGTH,
        MESSAGES.cityMissing,
        MESSAGES.addressTooLong,
      ),
      postcode: z
        .string({ error: MESSAGES.postcodeMissing })
        .transform((value) => value.trim())
        .refine((value) => value !== '', { error: MESSAGES.postcodeMissing }),

      // ISO 3166-1 alpha-2, stored as the code. The list itself belongs to the form.
      country: z
        .string({ error: MESSAGES.countryMissing })
        .transform((value) => value.trim().toUpperCase())
        .refine((value) => /^[A-Z]{2}$/u.test(value), { error: MESSAGES.countryMissing }),

      membershipType: z
        .string({ error: MESSAGES.membershipTypeMissing })
        .refine((value) => value !== '', { error: MESSAGES.membershipTypeMissing })
        .refine((value) => rules.codes.includes(value), {
          error: MESSAGES.membershipTypeUnknown,
        }),

      previousAffiliation: yesNo(MESSAGES.previousAffiliationMissing),
      previousClubName: z
        .string()
        .transform((value) => value.trim())
        .refine((value) => value.length <= MEMBERSHIP_CLUB_NAME_MAX_LENGTH, {
          error: MESSAGES.clubNameTooLong,
        })
        .optional(),
      // ⚠️ Digits only. An England Athletics URN is a number, and a box that accepts
      // `URN 1234` stores a string nothing can look up.
      eaUrn: z
        .string()
        .transform((value) => value.replace(/\s/gu, ''))
        .refine((value) => value === '' || /^\d+$/u.test(value), {
          error: MESSAGES.eaUrnShape,
        })
        .optional(),

      // ⚠️ **A real yes or no, where the club's current form offers only "Yes".** Consent
      // that cannot be withheld is not freely given, which is the whole of what UK GDPR
      // asks of it — so "no" is an answer the form accepts and the club acts on.
      eaPortalConsent: yesNo(MESSAGES.eaPortalConsentMissing),

      agreeCodeOfConduct: z.literal(true, { error: MESSAGES.agreeRequired }),
      agreePrivacyPolicy: z.literal(true, { error: MESSAGES.agreeRequired }),
      agreeDisciplinaryPolicy: z.literal(true, { error: MESSAGES.agreeRequired }),
    })
    .superRefine((value, ctx) => {
      const born = civilDate(value.dateOfBirth);
      if (born === null) return;

      if (born.year < MEMBERSHIP_EARLIEST_BIRTH_YEAR) {
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: MESSAGES.dobImplausible,
        });
        return;
      }

      // Against the club's own day rather than the machine's, which is what stops an age
      // being computed in UTC on a BST morning.
      if (
        born.year > today.year ||
        (born.year === today.year &&
          (born.month > today.month ||
            (born.month === today.month && born.day > today.day)))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: MESSAGES.dobFuture,
        });
        return;
      }

      if (ageOn(born, today) < rules.minimumAge) {
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: minimumAgeMessage(rules.minimumAge),
        });
      }
    })
    .superRefine((value, ctx) => {
      // ⚠️ **The postcode rule depends on the country, so it cannot live on the field.**
      // Applied to every country it would refuse a French member's `75001`.
      if (value.country !== 'GB') return;

      if (!UK_POSTCODE.test(normaliseUkPostcode(value.postcode))) {
        ctx.addIssue({
          code: 'custom',
          path: ['postcode'],
          message: MESSAGES.postcodeUkShape,
        });
      }
    });
}

export interface MembershipApplication {
  title: MembershipTitle;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164. */
  phone: string;
  dateOfBirth: string;
  addressLine1: string;
  // ⚠️ `| undefined` alongside `?`, because this package sets `exactOptionalPropertyTypes`.
  // Without it an optional property may be *absent* but not explicitly `undefined`, and the
  // parse below assigns `undefined` deliberately to drop a withdrawn answer.
  addressLine2?: string | undefined;
  cityTown: string;
  /** Uppercase with one space, for GB. As typed otherwise. */
  postcode: string;
  country: string;
  membershipType: string;
  previousAffiliation: boolean;
  previousClubName?: string | undefined;
  eaUrn?: string | undefined;
  eaPortalConsent: boolean;
  agreeCodeOfConduct: true;
  agreePrivacyPolicy: true;
  agreeDisciplinaryPolicy: true;
}

export type MembershipResult =
  { ok: true; value: MembershipApplication } | { ok: false; errors: MembershipErrors };

/**
 * Parse a submitted application.
 *
 * `today` is the caller's — the club's own civil date in `Europe/London` — rather than read
 * from the clock here, so an age is never computed against a UTC day that has already
 * turned over.
 */
export function parseMembershipApplication(
  input: unknown,
  rules: MembershipRules,
  today: { year: number; month: number; day: number },
): MembershipResult {
  const parsed = membershipSchema(rules, today).safeParse(input);

  if (!parsed.success) {
    const errors: MembershipErrors = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path[0];

      // A body that is not an object at all produces one issue with an empty path. Every
      // required field is missing in that case, and saying so on each is more use than one
      // form-level message nobody can act on.
      if (field === undefined) {
        for (const name of MEMBERSHIP_FIELDS) {
          errors[name] ??= MESSAGES.titleMissing;
        }
        continue;
      }

      const name = field as MembershipField;
      if (MEMBERSHIP_FIELDS.includes(name)) errors[name] ??= issue.message;
    }

    return { ok: false, errors };
  }

  const value = parsed.data as MembershipApplication;

  return {
    ok: true,
    value: {
      ...value,
      postcode:
        value.country === 'GB' ? normaliseUkPostcode(value.postcode) : value.postcode,
      // ⚠️ **Dropped unless the answer was yes.** Somebody who ticks "yes", types a club
      // name, then changes to "no" has told the club their previous club is not relevant —
      // and keeping it would store a fact they withdrew. Minimised at the boundary, which is
      // this repository's rule for personal data.
      previousClubName: value.previousAffiliation ? value.previousClubName : undefined,
      eaUrn: value.previousAffiliation
        ? value.eaUrn === ''
          ? undefined
          : value.eaUrn
        : undefined,
    },
  };
}
