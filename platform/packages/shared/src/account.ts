import { z } from 'zod';

/**
 * The one definition of what a valid sign-up and a valid sign-in are, on the
 * `nn-signup.ts` pattern: one schema, both sides, and server-side validation is the
 * control — nothing here is a convenience the Worker trusts a browser to have already done.
 *
 * **Four fields, and adding a fifth is a committee decision.** `identity.people` has
 * `name`, `gender`, `date_of_birth` and `address`, and none of them is collected here —
 * #61 is the issue that does, blocked on the privacy notice in #60. This schema exists to
 * create an account, not a profile.
 */

/** Matches `minimum_password_length` in `packages/db/supabase/config.toml`. Kept as a
 *  named constant rather than a literal so the two cannot silently drift — `config.test.ts`
 *  asserts the config side of this number, and this constant is the other. */
export const ACCOUNT_PASSWORD_MIN_LENGTH = 12;

/** RFC 5321's own limit, the same cap `nn-signup.ts` uses and for the same reason: nothing
 *  here needs it, and an unbounded string reaching Supabase Auth is a free thing to close
 *  on an endpoint anybody may post to. */
export const ACCOUNT_EMAIL_MAX_LENGTH = 254;

export const ACCOUNT_NAME_MAX_LENGTH = 120;

const MESSAGES = {
  nameMissing: 'Enter your name.',
  nameTooLong: `Your name is too long — ${ACCOUNT_NAME_MAX_LENGTH} characters at most.`,
  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter an email address, like you@example.com.',
  emailTooLong: 'That email address is too long.',
  passwordMissing: 'Enter a password.',
  passwordTooShort: `Your password needs to be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`,
  captchaMissing: 'Complete the verification check.',
} as const;

const email = z
  .string(MESSAGES.emailMissing)
  .trim()
  .min(1, MESSAGES.emailMissing)
  .max(ACCOUNT_EMAIL_MAX_LENGTH, MESSAGES.emailTooLong)
  .pipe(z.email(MESSAGES.emailInvalid));

/** Long enough is the control; composition rules are not — the same reasoning
 *  `config.toml`'s comment on `password_requirements` gives, applied to the form. */
const password = z
  .string(MESSAGES.passwordMissing)
  .min(1, MESSAGES.passwordMissing)
  .min(ACCOUNT_PASSWORD_MIN_LENGTH, MESSAGES.passwordTooShort);

/** The Turnstile widget's own field name. Not optional: every unauthenticated account form
 *  carries the widget, and a submission without a token did not come from one — #48's ADR
 *  accepted the JavaScript requirement precisely so this could be a real control rather
 *  than decoration. */
const captchaToken = z.string(MESSAGES.captchaMissing).min(1, MESSAGES.captchaMissing);

export const accountSignUpSchema = z.object({
  name: z
    .string(MESSAGES.nameMissing)
    .trim()
    .min(1, MESSAGES.nameMissing)
    .max(ACCOUNT_NAME_MAX_LENGTH, MESSAGES.nameTooLong),
  email,
  password,
  captchaToken,
});

export const accountSignInSchema = z.object({
  email,
  // Not re-checked for length or shape on sign-in: a shorter or malformed password is
  // simply a wrong one, and GoTrue is what answers that — this schema's job here is only
  // "did somebody submit something".
  password: z.string(MESSAGES.passwordMissing).min(1, MESSAGES.passwordMissing),
  captchaToken,
});

export type AccountSignUp = z.infer<typeof accountSignUpSchema>;
export type AccountSignIn = z.infer<typeof accountSignInSchema>;

export type AccountSignUpField = keyof AccountSignUp;
export type AccountSignInField = keyof AccountSignIn;

export type AccountSignUpErrors = Partial<Record<AccountSignUpField, string>>;
export type AccountSignInErrors = Partial<Record<AccountSignInField, string>>;

export type AccountSignUpResult =
  { ok: true; value: AccountSignUp } | { ok: false; errors: AccountSignUpErrors };

export type AccountSignInResult =
  { ok: true; value: AccountSignIn } | { ok: false; errors: AccountSignInErrors };

const SIGN_UP_FIELDS: readonly AccountSignUpField[] = [
  'name',
  'email',
  'password',
  'captchaToken',
];
const SIGN_IN_FIELDS: readonly AccountSignInField[] = [
  'email',
  'password',
  'captchaToken',
];

export function parseAccountSignUp(input: unknown): AccountSignUpResult {
  const parsed = accountSignUpSchema.safeParse(input);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, errors: fieldErrors(parsed.error, SIGN_UP_FIELDS) };
}

export function parseAccountSignIn(input: unknown): AccountSignInResult {
  const parsed = accountSignInSchema.safeParse(input);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, errors: fieldErrors(parsed.error, SIGN_IN_FIELDS) };
}

/** First message per field wins, and only for a field this form actually has — the same
 *  shape `nn-signup.ts`'s `parseNnSignup` uses. */
function fieldErrors<Field extends string>(
  error: z.ZodError,
  fields: readonly Field[],
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && (fields as readonly string[]).includes(field)) {
      const key = field as Field;
      if (errors[key] === undefined) {
        errors[key] = issue.message;
      }
    }
  }

  return errors;
}
