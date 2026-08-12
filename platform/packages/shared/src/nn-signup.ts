import { z } from 'zod';

/**
 * The one definition of what a valid Nightingale Nightmare sign-up is.
 *
 * **One schema, both sides.** The Worker validates every submission with it, and a
 * client-side enhancement — if one is ever added — validates with the same object rather
 * than a second copy that drifts. Client-side validation is a convenience; this running in
 * the Worker is the control, and it runs whatever the browser did or did not do.
 *
 * **Three fields, and adding a fourth is a committee decision, not a build decision.** The
 * table has four columns and `created_at` is the database's own default, so there is
 * deliberately nothing here to collect a phone number or a date of birth into.
 *
 * Input is trimmed before it is judged. The database's checks —
 * `length(trim(name)) between 1 and 100` and `position('@' in email) > 1` — are a backstop
 * for anything that reaches Postgres by another route, not the validation. If a submission
 * ever fails at the database that passed here, these two have drifted and that is a defect.
 *
 * @see docs/architecture/principles.md#personal-data-is-minimised-at-the-boundary
 */

/** What the table's own check constraint allows, mirrored so the messages can say it. */
export const NN_SIGNUP_NAME_MAX_LENGTH = 100;

/**
 * The longest address RFC 5321 permits. The database does not constrain this, so without a
 * cap here an unbounded string reaches Postgres — a nuisance rather than a hazard, but a
 * free one to close on an endpoint anybody may post to.
 */
export const NN_SIGNUP_EMAIL_MAX_LENGTH = 254;

/**
 * Written for somebody on a phone, on bad signal, who has just lost a form submission.
 * Each says what to do rather than what went wrong, and none repeats the field's own label
 * — the error is announced next to the input it belongs to, so "Enter your name" reads
 * correctly there and "Name: name is invalid" does not.
 */
const MESSAGES = {
  nameMissing: 'Enter your name.',
  nameTooLong: `Your name is too long — ${NN_SIGNUP_NAME_MAX_LENGTH} characters at most.`,
  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter an email address, like you@example.com.',
  emailTooLong: 'That email address is too long.',
  consentMissing: 'Tick the box to say we can email you when entries open.',
} as const;

/**
 * `'on'` is what an unvalued HTML checkbox posts when it is ticked; an unticked one posts
 * nothing at all, so the field simply arrives absent. A JavaScript enhancement reading
 * `input.checked` would pass a real boolean instead, and both must mean the same thing.
 */
const consentCheckbox = z.preprocess(
  (value) => (value === 'on' ? true : value),
  // **The consent decision lives here, and reversing it is two lines.** Consent is
  // currently required to submit: `z.literal(true)` rejects both `false` and absent. If the
  // committee decides an unconsented submission should be stored instead — `consent` is
  // `not null` and `false` is a legitimate stored value, per the table's own comment —
  // change this to `z.boolean()` and drop `required` from the checkbox in
  // `src/pages/nn/index.astro`. Nothing else moves: the migration's `with check` is
  // deliberately neutral on consent, so no second migration is needed.
  z.literal(true, MESSAGES.consentMissing),
);

export const nnSignupSchema = z.object({
  name: z
    .string(MESSAGES.nameMissing)
    .trim()
    .min(1, MESSAGES.nameMissing)
    .max(NN_SIGNUP_NAME_MAX_LENGTH, MESSAGES.nameTooLong),

  // Trimmed but **not lower-cased**: what somebody typed is what the club writes back to,
  // and the unique index is on `lower(email)`, so a second submission in different case
  // still conflicts rather than creating a second row.
  email: z
    .string(MESSAGES.emailMissing)
    .trim()
    .min(1, MESSAGES.emailMissing)
    .max(NN_SIGNUP_EMAIL_MAX_LENGTH, MESSAGES.emailTooLong)
    .pipe(z.email(MESSAGES.emailInvalid)),

  consent: consentCheckbox,
});

/** Exactly the three columns the Worker may insert. Unknown keys are stripped, not stored. */
export type NnSignup = z.infer<typeof nnSignupSchema>;

/** The fields a message can be attached to, so a typo cannot invent a fourth. */
export type NnSignupField = keyof NnSignup;

/** At most one message per field — the first, because a list of four helps nobody. */
export type NnSignupErrors = Partial<Record<NnSignupField, string>>;

/**
 * The discriminated-union shape `fetchHealth` and `fetchPing` already use, for the same
 * reason: the caller has to look at `ok` before it can reach anything, and a validation
 * failure is an ordinary answer here rather than an exception.
 */
export type NnSignupResult =
  { ok: true; value: NnSignup } | { ok: false; errors: NnSignupErrors };

/**
 * Normalise and validate one submission.
 *
 * Takes `unknown` on purpose: the Worker hands it `Object.fromEntries(formData)`, which is
 * whatever was posted, and a submission that is not an object at all — a JSON body, an
 * empty request — must be rejected rather than crash.
 */
export function parseNnSignup(input: unknown): NnSignupResult {
  const parsed = nnSignupSchema.safeParse(input);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const errors: NnSignupErrors = {};

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    // A body that is not an object produces one issue with an empty path. Every field is
    // missing in that case, and saying so on each is more use than a form-level message.
    if (field === undefined) {
      return {
        ok: false,
        errors: {
          name: MESSAGES.nameMissing,
          email: MESSAGES.emailMissing,
          consent: MESSAGES.consentMissing,
        },
      };
    }

    // First message per field wins. `max` after `min` on the same input would otherwise
    // overwrite the more useful one.
    if (isNnSignupField(field) && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }

  return { ok: false, errors };
}

function isNnSignupField(key: PropertyKey): key is NnSignupField {
  return key === 'name' || key === 'email' || key === 'consent';
}
