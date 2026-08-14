import { describe, expect, it } from 'vitest';
import {
  NN_SIGNUP_NAME_MAX_LENGTH,
  parseNnSignup,
  type NnSignupErrors,
} from '../../src/nn-signup';

/**
 * The validation schema, which is the only thing standing between a public form and the
 * club's first table of personal data.
 *
 * **The rejection cases are the point.** That a well-formed submission passes proves very
 * little — the interesting question is what a form open to the whole internet does with
 * whitespace, with a name longer than the column allows, with an address that is not one,
 * and with the consent box left alone. Each of those is asserted on the *message* as well
 * as the failure, because a rejection nobody can act on is barely better than a crash.
 *
 * Server-side validation is never optional here, so this schema running is the control and
 * anything the browser did first is a convenience.
 */

/** A submission that should always pass, so each case below varies one thing from it. */
const VALID = { name: 'Ada Lovelace', email: 'ada@example.com', consent: 'on' } as const;

function errorsFor(input: unknown): NnSignupErrors {
  const result = parseNnSignup(input);
  if (result.ok) {
    throw new Error('Expected this submission to be rejected, and it was accepted.');
  }
  return result.errors;
}

describe('a submission that should be accepted', () => {
  it('takes a name, an address and a ticked box', () => {
    const result = parseNnSignup(VALID);

    expect(result).toEqual({
      ok: true,
      value: { name: 'Ada Lovelace', email: 'ada@example.com', consent: true },
    });
  });

  it('trims what somebody typed rather than rejecting it', () => {
    // A trailing space from a phone keyboard, or from pasting an address, is not an error
    // the person should be shown. It is normalised and the submission goes through.
    const result = parseNnSignup({
      name: '  Ada Lovelace  ',
      email: '  ada@example.com  ',
      consent: 'on',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.name).toBe('Ada Lovelace');
    expect(result.ok && result.value.email).toBe('ada@example.com');
  });

  it.each([
    ['an apostrophe', "Dara O'Sullivan"],
    ['a non-ASCII name', 'Émile Boisvert'],
    ['a name that is only non-ASCII', '大野 誠'],
    ['a hyphen and a space', 'Anne-Marie de Vries'],
  ])('accepts %s', (_label, name) => {
    // Ordinary names in a Bristol running club, and the ones a naive validator rejects.
    // Refusing somebody their own name is the failure this suite exists to prevent.
    const result = parseNnSignup({ ...VALID, name });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.name).toBe(name);
  });

  it('accepts a name of exactly the length the column allows', () => {
    const name = 'a'.repeat(NN_SIGNUP_NAME_MAX_LENGTH);
    const result = parseNnSignup({ ...VALID, name });

    expect(result.ok).toBe(true);
  });

  it('reads a real boolean as well as a checkbox', () => {
    // The Worker passes `'on'`, which is what an HTML checkbox posts. A client-side
    // enhancement reading `input.checked` would pass `true`, and both must mean the same
    // thing or the two paths validate differently.
    const result = parseNnSignup({ ...VALID, consent: true });

    expect(result.ok).toBe(true);
  });

  it('keeps the address as typed rather than lower-casing it', () => {
    // The club writes back to what somebody gave it. Case-insensitive *uniqueness* is the
    // database's job, through the index on `lower(email)` — normalising here as well would
    // be a second opinion about the same thing.
    const result = parseNnSignup({ ...VALID, email: 'Ada.Lovelace@Example.com' });

    expect(result.ok && result.value.email).toBe('Ada.Lovelace@Example.com');
  });
});

describe('the name', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['only spaces', '   '],
    ['only a tab and a newline', '\t\n'],
    ['not a string at all', 42],
  ])('is rejected when it is %s', (_label, name) => {
    // Whitespace-only is the one that matters: it passes an HTML `required` attribute and
    // reaches the server looking like input, which is exactly why the server validates
    // regardless of what the browser already checked.
    expect(errorsFor({ ...VALID, name }).name).toBe('Enter your name.');
  });

  it('is rejected when it is longer than the column allows', () => {
    const errors = errorsFor({
      ...VALID,
      name: 'a'.repeat(NN_SIGNUP_NAME_MAX_LENGTH + 1),
    });

    expect(errors.name).toBe('Your name is too long — 100 characters at most.');
  });

  it('is measured after trimming, not before', () => {
    // A hundred characters wrapped in spaces is a hundred characters. Measuring first
    // would reject a name the database would have accepted.
    const name = `  ${'a'.repeat(NN_SIGNUP_NAME_MAX_LENGTH)}  `;

    expect(parseNnSignup({ ...VALID, name }).ok).toBe(true);
  });
});

describe('the email address', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['only spaces', '  '],
  ])('is rejected when it is %s', (_label, email) => {
    expect(errorsFor({ ...VALID, email }).email).toBe('Enter your email address.');
  });

  it.each([
    ['no @ at all', 'ada.example.com'],
    ['an @ but no domain', 'ada@'],
    ['an @ but no local part', '@example.com'],
    ['a space in the middle', 'ada lovelace@example.com'],
    ['no top-level domain', 'ada@example'],
  ])('is rejected when it has %s', (_label, email) => {
    expect(errorsFor({ ...VALID, email }).email).toBe(
      'Enter an email address, like you@example.com.',
    );
  });

  it('is rejected when it is absurdly long', () => {
    // Not a security control — the point of a cap on an endpoint anyone may post to is
    // that an unbounded string never reaches Postgres, which has no length check here.
    const email = `${'a'.repeat(250)}@example.com`;

    expect(errorsFor({ ...VALID, email }).email).toBe('That email address is too long.');
  });
});

describe('consent', () => {
  it.each([
    ['the box was not ticked, so nothing was posted', undefined],
    ['something posted false', false],
    ['something posted the string "off"', 'off'],
    ['something posted an empty string', ''],
  ])('is rejected when %s', (_label, consent) => {
    // **This is the half of the consent decision that lives in code.** Consent is currently
    // required to submit. If the committee decides an unconsented submission should be
    // stored instead, this describe block is what changes with it — along with two lines,
    // one here in the schema and one on the checkbox. No migration is involved.
    expect(errorsFor({ ...VALID, consent }).consent).toBe(
      'Tick the box to say we can email you when entries open.',
    );
  });
});

describe('a submission that is wrong in several ways', () => {
  it('says so about each field rather than only the first', () => {
    // Somebody on bad signal should not have to submit three times to be told three
    // things. The error summary lists every one of them.
    const errors = errorsFor({ name: '', email: 'nope', consent: undefined });

    expect(Object.keys(errors).sort()).toEqual(['consent', 'email', 'name']);
  });

  it('rejects a body that is not a form at all, without throwing', () => {
    // A JSON post, or a bot. There is no field to attach a message to, so every field is
    // reported missing — which is true, and is what the page can actually render.
    for (const body of ['a string', 42, null, undefined, []]) {
      const result = parseNnSignup(body);

      expect(result.ok).toBe(false);
      expect(result.ok === false && Object.keys(result.errors).sort()).toEqual([
        'consent',
        'email',
        'name',
      ]);
    }
  });
});

describe('what the schema refuses to carry', () => {
  it('strips anything the form did not ask for', () => {
    // **The boundary where personal data is minimised.** A field added to the posted form
    // — by a browser extension, by a bot, or by somebody editing the HTML — must not
    // survive validation and reach an insert. The table has four columns by committee
    // decision, and this is what stops a fifth arriving by accident.
    const result = parseNnSignup({
      ...VALID,
      dateOfBirth: '1815-12-10',
      phone: '0117 496 0000',
      emergencyContact: 'Charles Babbage',
      englandAthleticsNumber: 'EA123456',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      'consent',
      'email',
      'name',
    ]);
  });

  it('cannot be told to supply an id or a timestamp', () => {
    // Both are the database's to decide — `id` defaults to a fresh UUID and `created_at`
    // to `now()`. The column-scoped grant refuses them at Postgres too, so this is the
    // inner of two locks rather than the only one.
    const result = parseNnSignup({
      ...VALID,
      id: '11111111-1111-4111-8111-111111111111',
      created_at: '2020-01-01T00:00:00Z',
    });

    expect(result.ok && result.value).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      consent: true,
    });
  });
});
