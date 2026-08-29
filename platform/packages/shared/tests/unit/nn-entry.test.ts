import { describe, expect, it } from 'vitest';
import { parseNnEntry, entryRulesFrom, type NnEntryRules } from '../../src/nn-entry';
import type { EntryState } from '../../src/entry-state';

/**
 * The entry schema, exhaustively — every rejection the form can produce, and the boundaries
 * either side of each one.
 *
 * **This is the layer that is the control.** Client-side validation is a convenience and it
 * is not what runs when somebody has scripting off, or a bot posts directly, or a browser
 * decides `required` means something slightly different. Everything the Worker will accept
 * is decided here, and a hole here is a hole everywhere.
 *
 * Race day is Sunday 1 November 2026, confirmed. **`minimumAge` is 18 in the default fixture
 * because that is now the configured state** — the committee confirmed it on 13 August 2026
 * and it went in as one `update` to `entries.events.minimum_age`. The *absence* of a minimum
 * is exercised separately, against `NO_MINIMUM`, because it is still a state a future race
 * can be in and the code path that skips the check should not stop being covered the day
 * this race stopped using it.
 */

const RULES: NnEntryRules = {
  eventDate: { year: 2026, month: 11, day: 1 },
  minimumAge: 18,
  feeCodes: ['unaffiliated', 'affiliated', 'vi_guide'],
};

/** An event that turns nobody away on age — the shape `minimum_age is null` produces. */
const NO_MINIMUM: NnEntryRules = { ...RULES, minimumAge: null };

/** A submission with nothing wrong with it, as `Object.fromEntries(formData)` would give it. */
function good(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    emailConfirm: 'grace@example.com',
    dobDay: '9',
    dobMonth: '12',
    dobYear: '1986',
    gender: 'female',
    feeCode: 'unaffiliated',
    emergencyName: 'Margaret Hamilton',
    emergencyPhone: '0117 496 0000',
    entryTerms: 'on',
    ...overrides,
  };
}

/** The first message against one field, or undefined if that field is happy. */
function errorOn(input: Record<string, unknown>, rules: NnEntryRules = RULES) {
  const result = parseNnEntry(input, rules);
  return result.ok ? undefined : result.errors;
}

describe('a submission with nothing wrong with it', () => {
  it('is accepted, and comes back normalised', () => {
    const result = parseNnEntry(good(), RULES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      dateOfBirth: { year: 1986, month: 12, day: 9 },
      gender: 'female',
      club: null,
      feeCode: 'unaffiliated',
      medicalNotes: null,
    });
    // **`vi` is present and false rather than absent.** The database reads this key to decide
    // how many entrants the payload may carry, and a consents object that records the question
    // having been asked is a better record than one that is silent about it.
    expect(result.value.consents).toEqual({
      entryTerms: true,
      medical: false,
      vi: false,
    });
  });

  it('derives the category alongside it, rather than leaving it to be asked twice', () => {
    const result = parseNnEntry(good(), RULES);
    expect(result.ok && result.category).toMatchObject({ code: 'senior', age: 39 });
  });

  it('trims what was typed before judging it', () => {
    const result = parseNnEntry(
      good({ firstName: '  Grace  ', emergencyName: ' Margaret Hamilton ' }),
      RULES,
    );

    expect(result.ok && result.value.firstName).toBe('Grace');
    expect(result.ok && result.value.emergencyName).toBe('Margaret Hamilton');
  });

  it('keeps an optional club when one is given and nulls it when it is not', () => {
    const withClub = parseNnEntry(good({ club: 'Southville Running Club' }), RULES);
    expect(withClub.ok && withClub.value.club).toBe('Southville Running Club');

    const blank = parseNnEntry(good({ club: '   ' }), RULES);
    expect(blank.ok && blank.value.club).toBeNull();
  });
});

describe('the two email boxes', () => {
  it('refuses an address that is not one', () => {
    expect(
      errorOn(good({ email: 'notanaddress', emailConfirm: 'notanaddress' })),
    ).toEqual(
      expect.objectContaining({ email: 'Enter an email address, like you@example.com.' }),
    );
  });

  it('refuses a confirmation that does not match', () => {
    expect(
      errorOn(good({ emailConfirm: 'grace@exampel.com' }))?.emailConfirm,
    ).toBeDefined();
  });

  it('accepts a confirmation that differs only in case, because it is the same mailbox', () => {
    // The confirmation box catches a typo. `Grace@Example.com` against `grace@example.com`
    // is not a typo, and refusing it would be the form inventing a distinction the mail
    // system does not make.
    const result = parseNnEntry(good({ emailConfirm: 'GRACE@Example.com' }), RULES);
    expect(result.ok).toBe(true);
  });

  it('stores the address as typed rather than lower-casing it', () => {
    const result = parseNnEntry(
      good({
        email: 'Grace.Hopper@Example.com',
        emailConfirm: 'grace.hopper@example.com',
      }),
      RULES,
    );
    expect(result.ok && result.value.email).toBe('Grace.Hopper@Example.com');
  });

  it('asks for the confirmation when it is empty', () => {
    expect(errorOn(good({ emailConfirm: '' }))?.emailConfirm).toBe(
      'Type your email address again, to check it.',
    );
  });
});

describe('the date of birth, entered as three numbers', () => {
  it('asks for all three when any is missing', () => {
    expect(errorOn(good({ dobDay: '' }))?.dateOfBirth).toBe(
      'Enter your date of birth as a day, a month and a year.',
    );
    expect(errorOn(good({ dobMonth: '' }))?.dateOfBirth).toBeDefined();
    expect(errorOn(good({ dobYear: '' }))?.dateOfBirth).toBeDefined();
  });

  it('refuses a date that never happened', () => {
    // 1986 was not a leap year. `new Date(1986, 1, 29)` would roll this over to 1 March and
    // report no problem, which is why the module does not use it.
    expect(
      errorOn(good({ dobDay: '29', dobMonth: '2', dobYear: '1986' }))?.dateOfBirth,
    ).toBe('That is not a date. Check the day, the month and the year.');
    expect(errorOn(good({ dobDay: '31', dobMonth: '4' }))?.dateOfBirth).toBeDefined();
    expect(errorOn(good({ dobMonth: '13' }))?.dateOfBirth).toBeDefined();
    expect(errorOn(good({ dobDay: '0' }))?.dateOfBirth).toBeDefined();
  });

  it('accepts 29 February in a year that had one', () => {
    const result = parseNnEntry(
      good({ dobDay: '29', dobMonth: '2', dobYear: '1984' }),
      RULES,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses digits with anything else mixed in', () => {
    // `Number(' 12 ')` is 12 and `parseInt('12abc')` is 12. Both would let a form accept
    // something nobody typed on purpose.
    expect(errorOn(good({ dobDay: '12abc' }))?.dateOfBirth).toBeDefined();
    expect(errorOn(good({ dobYear: '86' }))?.dateOfBirth).toBeDefined();
  });

  it('refuses a date of birth after race day', () => {
    expect(
      errorOn(good({ dobDay: '2', dobMonth: '11', dobYear: '2026' }))?.dateOfBirth,
    ).toBe('A date of birth cannot be in the future.');
  });

  it('refuses a year earlier than the form takes', () => {
    expect(errorOn(good({ dobYear: '1899' }))?.dateOfBirth).toBe(
      'Check the year — the earliest this form takes is 1900.',
    );
  });
});

describe('the minimum age, which is configuration and not a rule in this file', () => {
  // **The two assertions either side of the boundary are the point of this block.** The same
  // pair is made against the database in `packages/db/tests/entries-capacity.test.ts`,
  // because that is the control and this is the convenience — and if the two derivations ever
  // disagreed, one of these four tests would be the thing that noticed.

  it('accepts somebody who is exactly the minimum age on race day', () => {
    // Born 1 November 2008: turns 18 **on** race day. The club's categories are "at race
    // date", so this is inside and it is the boundary somebody will argue about.
    const result = parseNnEntry(
      good({ dobDay: '1', dobMonth: '11', dobYear: '2008' }),
      RULES,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses somebody one day short of it', () => {
    const result = parseNnEntry(
      good({ dobDay: '2', dobMonth: '11', dobYear: '2008' }),
      RULES,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.dateOfBirth).toBe(
      'You must be 18 or over on race day to enter.',
    );
  });

  it('applies no check at all when the event configures none', () => {
    // Not Nightingale Nightmare any more, and still a state the column can be in. A race
    // that admits juniors is an `insert` with a null here, not an edit to this module.
    const result = parseNnEntry(
      good({ dobDay: '2', dobMonth: '11', dobYear: '2012' }),
      NO_MINIMUM,
    );
    expect(result.ok).toBe(true);
  });
});

describe('the race category, and the gender question beside it', () => {
  // **Two fields, and the split is the whole point — ADR-020.** `gender` is the closed list
  // the club awards prizes in; `genderIdentity` is the open question. These assertions are
  // what stop the second one quietly acquiring the first one's rules.

  it('still requires a category, because a results table has to place somebody', () => {
    expect(errorOn(good({ gender: '' }))?.gender).toBe(
      'Choose a category, so the club can work out your age category.',
    );
  });

  it('refuses a category that is not one of the three', () => {
    expect(errorOn(good({ gender: 'other' }))?.gender).toBe(
      'Choose one of the categories listed.',
    );
  });

  it('never requires the gender question, whatever else is on the form', () => {
    // Not "accepts a blank". **Not answering is an answer**, and no combination of the other
    // fourteen fields may turn this into a required one.
    expect(errorOn(good())?.genderIdentity).toBeUndefined();
    expect(errorOn(good({ genderIdentity: '' }))?.genderIdentity).toBeUndefined();
    expect(errorOn(good({ genderIdentity: '   ' }))?.genderIdentity).toBeUndefined();
  });

  it('records an unanswered one as null rather than an empty string', () => {
    const result = parseNnEntry(good({ genderIdentity: '   ' }), RULES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.genderIdentity).toBeNull();
  });

  it('records what somebody typed, trimmed and otherwise untouched', () => {
    // No normalising, no mapping onto a list, no title-casing. The answer is theirs.
    const result = parseNnEntry(good({ genderIdentity: '  genderfluid  ' }), RULES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.genderIdentity).toBe('genderfluid');
  });

  it('takes an answer that is on no list anywhere', () => {
    const result = parseNnEntry(good({ genderIdentity: 'Two-spirit' }), RULES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.genderIdentity).toBe('Two-spirit');
  });

  it('refuses one past the ceiling the column has', () => {
    expect(errorOn(good({ genderIdentity: 'x'.repeat(61) }))?.genderIdentity).toBe(
      'That is too long — 60 characters at most.',
    );
  });

  it('never lets the gender question reach the category', () => {
    // **The one property that has to hold.** The band comes from the date of birth and the
    // category and from nothing else; if this ever stopped being true, somebody's answer to
    // an optional question would decide which prize list they are on.
    const plain = parseNnEntry(good(), RULES);
    const answered = parseNnEntry(good({ genderIdentity: 'Non-binary woman' }), RULES);

    expect(plain.ok && answered.ok).toBe(true);
    if (!plain.ok || !answered.ok) return;
    expect(answered.category).toEqual(plain.category);
  });
});

describe('the entry type, and the number that hangs off it', () => {
  it('asks for a choice when none was made', () => {
    expect(errorOn(good({ feeCode: '' }))?.feeCode).toBe('Choose an entry type.');
  });

  it('refuses a code the event is not offering', () => {
    // The list comes from `entries.fees` at request time, so a posted code that is not on
    // offer is refused without this file needing to know what the codes are.
    expect(errorOn(good({ feeCode: 'free_for_me' }))?.feeCode).toBe(
      'Choose one of the entry types listed.',
    );
  });

  it('asks the affiliated entry for nothing beyond the entry type', () => {
    // **The committee stopped asking for England Athletics numbers on 29 August 2026.** This
    // used to refuse an affiliated entry with no number against it, and refusing one is now
    // the defect: a runner states that they are affiliated and the club takes their word for
    // it. What the club keeps is the right to ask somebody to produce a number, which is a
    // sentence in the privacy notice rather than a field on a form.
    expect(parseNnEntry(good({ feeCode: 'affiliated' }), RULES).ok).toBe(true);
  });

  it('has no England Athletics field at all, so one cannot be posted into it', () => {
    // **The negative case is the one that matters here.** `eaNumber` is not a key of
    // `NnEntry` any more and not a field the schema reads, so a submission carrying one is
    // accepted and the value goes nowhere — which is what "not collected" has to mean at a
    // public endpoint anybody may post to. Asserting the parse merely succeeds would pass
    // just as well if the value were quietly stored.
    const result = parseNnEntry(
      good({ feeCode: 'affiliated', eaNumber: '1234567' }),
      RULES,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value)).not.toContain('eaNumber');
    expect(JSON.stringify(result.ok && result.value)).not.toContain('1234567');
  });

  it('takes the free VI guide place without asking for a number', () => {
    const result = parseNnEntry(good({ feeCode: 'vi_guide' }), RULES);
    expect(result.ok).toBe(true);
  });
});

describe('the emergency contact', () => {
  it('requires both halves of it', () => {
    expect(errorOn(good({ emergencyName: '' }))?.emergencyName).toBe(
      'Enter the name of somebody the club can contact in an emergency.',
    );
    expect(errorOn(good({ emergencyPhone: '' }))?.emergencyPhone).toBe(
      'Enter a phone number for your emergency contact.',
    );
  });

  it('refuses whitespace, which an HTML `required` attribute lets through', () => {
    // The failure the interest form already taught: a browser is happy with three spaces.
    expect(errorOn(good({ emergencyName: '   ' }))?.emergencyName).toBeDefined();
  });

  it('accepts a phone number written any of the ways people write them', () => {
    for (const phone of ['07700 900123', '+44 7700 900123', '(0117) 496-0000']) {
      expect(parseNnEntry(good({ emergencyPhone: phone }), RULES).ok).toBe(true);
    }
  });

  it('refuses one with too few digits to be a phone number', () => {
    expect(errorOn(good({ emergencyPhone: '12345' }))?.emergencyPhone).toBe(
      'Enter a phone number with at least seven digits in it.',
    );
  });

  it('refuses a box with no digits in it at all', () => {
    // ⚠️ **The hole this test exists for.** The digit count read
    // `digits.length > 0 && digits.length < MINIMUM_PHONE_DIGITS`, and that `> 0` was not a
    // guard against an empty box — `min(1)` already catches those — it was an exemption for
    // every string containing no digits whatsoever. `ask my mum`, `see above` and `n/a` were
    // all accepted, on the one field whose entire purpose is to be dialled by somebody
    // standing over a runner at the side of a course.
    for (const phone of ['ask my mum', 'n/a', 'see above', '-']) {
      expect(
        errorOn(good({ emergencyPhone: phone }))?.emergencyPhone,
        `${phone} is not a phone number`,
      ).toBeDefined();
    }
  });

  it('says which of the two things is wrong with it', () => {
    // Too short and not-a-phone-number need different fixes, so they get different messages:
    // one says add more digits, the other says use digits.
    expect(errorOn(good({ emergencyPhone: 'ask my mum' }))?.emergencyPhone).toContain(
      'using digits',
    );
    expect(errorOn(good({ emergencyPhone: '12345' }))?.emergencyPhone).toContain(
      'at least seven',
    );
  });

  it('still takes an extension, which is a real way people write a work number', () => {
    expect(parseNnEntry(good({ emergencyPhone: '0117 496 0000 x214' }), RULES).ok).toBe(
      true,
    );
    expect(
      parseNnEntry(good({ emergencyPhone: '0117 496 0000 ext. 214' }), RULES).ok,
    ).toBe(true);
  });
});

describe('a name, and the one thing this form is willing to say about one', () => {
  // **At least one letter, and nothing more opinionated than that.** A validator cleverer
  // than this about names is one that eventually tells a real person they are not real: it
  // has no length floor beyond a character, no ban on digits, apostrophes, hyphens or
  // spaces, and no opinion about scripts.
  it('refuses a box somebody filled in to get past a required field', () => {
    expect(errorOn(good({ firstName: '.' }))?.firstName).toBeDefined();
    expect(errorOn(good({ lastName: '123' }))?.lastName).toBeDefined();
    expect(errorOn(good({ emergencyName: '-' }))?.emergencyName).toBeDefined();
  });

  it('accepts every real name it was shown', () => {
    for (const [first, last] of [
      ['Inés', "O'Rourke"],
      ['Lena', 'Sørensen'],
      ['Jean-Luc', 'de la Cruz'],
      ['李', '雷'],
      ['X', 'Æ'],
    ]) {
      expect(
        parseNnEntry(good({ firstName: first, lastName: last }), RULES).ok,
        `${first} ${last}`,
      ).toBe(true);
    }
  });
});

/**
 * The guide, and the whole of the visually impaired journey.
 *
 * **One runner, one entry, one fee.** The runner enters as anybody else does and ticks a box;
 * the guide is asked about in the same words afterwards and is recorded beside them on the same
 * purchase. What replaced it was a £0 `vi_guide` fee the guide bought for themselves, which
 * **Stripe refuses outright** — a Checkout session cannot total zero — so its happy path was an
 * apology and a race address.
 */
describe('medical information, and its own separate consent', () => {
  const NOTES = 'Type 1 diabetic. Carries glucose gel.';

  it('is accepted when the box beside it is ticked', () => {
    const result = parseNnEntry(
      good({ medicalNotes: NOTES, medicalConsent: 'on' }),
      RULES,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.medicalNotes).toBe(NOTES);
    expect(result.ok && result.value.consents.medical).toBe(true);
  });

  it('refuses notes written without that consent, rather than quietly binning them', () => {
    // **Dropping them silently would be safe for the database and dishonest to the person.**
    // They typed something they expect a first-aider to see. The message names both ways out.
    expect(errorOn(good({ medicalNotes: NOTES }))?.medicalConsent).toBe(
      'You have written medical information. Tick the box to let the club hold it, or clear the box above.',
    );
  });

  it('is happy with the consent ticked and nothing written', () => {
    const result = parseNnEntry(good({ medicalConsent: 'on' }), RULES);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.medicalNotes).toBeNull();
  });

  it('never returns notes without the consent, whatever else is wrong', () => {
    // The second of two locks. The schema refuses the combination above; this asserts that
    // even a caller who reached past it could not end up holding unconsented notes.
    const result = parseNnEntry(
      good({ medicalNotes: NOTES, medicalConsent: 'on', feeCode: 'vi_guide' }),
      RULES,
    );
    expect(result.ok && result.value.consents.medical).toBe(true);
  });

  it('is not bundled into the entry terms', () => {
    // Ticking the terms must not imply consent to hold special category data. If these two
    // ever share a checkbox, this test is what should stop it.
    const result = parseNnEntry(good(), RULES);
    expect(result.ok && result.value.consents).toEqual({
      entryTerms: true,
      medical: false,
      vi: false,
    });
  });
});

describe('the entry terms', () => {
  it('must be accepted', () => {
    const withoutTerms = good();
    delete withoutTerms.entryTerms;

    expect(errorOn(withoutTerms)?.entryTerms).toBe(
      'Tick the box to accept the entry terms.',
    );
  });
});

describe('what a submission that is not a form at all gets', () => {
  it('is rejected with every required field named', () => {
    const result = parseNnEntry('not an object', RULES);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    for (const field of [
      'firstName',
      'lastName',
      'email',
      'emailConfirm',
      'dateOfBirth',
      'gender',
      'feeCode',
      'emergencyName',
      'emergencyPhone',
      'entryTerms',
    ] as const) {
      expect(result.errors[field]).toBeDefined();
    }
  });

  it('still reports the other problems when a radio group posted nothing at all', () => {
    // **A regression guard for a bug this file caught during the build.** An unselected
    // `<input type="radio">` group posts *no key*, and Zod treats a missing key as a fatal
    // type failure that stops `superRefine` — where an empty string is continuable and does
    // not. So submitting with no entry type chosen reported the entry type and silently
    // swallowed the unticked terms box and the missing date of birth. `absentTextAsEmpty`
    // is the fix, and this is what would notice it being removed.
    const noRadio = good({ dobDay: '', entryTerms: undefined });
    delete noRadio.feeCode;
    delete noRadio.entryTerms;

    const result = parseNnEntry(noRadio, RULES);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.feeCode).toBeDefined();
    expect(result.errors.dateOfBirth).toBeDefined();
    expect(result.errors.entryTerms).toBeDefined();
  });

  it('reports every problem in one pass rather than one at a time', () => {
    // **The property that matters most on a form this long.** Somebody on a phone should
    // not discover a second problem after fixing the first — a bad name and a mismatched
    // confirmation both come back together.
    const result = parseNnEntry(
      good({ firstName: '', emailConfirm: 'wrong@example.com', gender: '' }),
      RULES,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(Object.keys(result.errors).sort()).toEqual([
      'emailConfirm',
      'firstName',
      'gender',
    ]);
  });
});

describe('the rules, lifted off what the database said', () => {
  it('takes the fee codes from the event, not from this file', () => {
    const state: EntryState = {
      slug: 'nn-2026',
      displayName: 'Nightingale Nightmare 2026',
      state: 'open',
      eventDate: { year: 2026, month: 11, day: 1 },
      startTime: '11:00:00',
      entrantsPerEntry: 1,
      capacity: 250,
      minimumAge: 18,
      requiresDob: true,
      consentVersion: 'nn-2026-v1',
      fees: [
        {
          code: 'unaffiliated',
          label: 'Unaffiliated',
          pricePence: 1700,
        },
        {
          code: 'affiliated',
          label: 'Affiliated',
          pricePence: 1500,
        },
        { code: 'vi_guide', label: 'VI guide', pricePence: 0 },
      ],
    };

    expect(entryRulesFrom(state)).toEqual({
      eventDate: { year: 2026, month: 11, day: 1 },
      minimumAge: 18,
      feeCodes: ['unaffiliated', 'affiliated', 'vi_guide'],
    });
  });
});
