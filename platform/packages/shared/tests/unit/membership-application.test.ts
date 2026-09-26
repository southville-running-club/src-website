import { describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_FIELDS,
  ageOn,
  normaliseUkPostcode,
  parseMembershipApplication,
  type MembershipRules,
} from '../../src/membership-application.js';

/**
 * The new member application, validated.
 *
 * ⚠️ **The refusals are the point of this file**, as they are in `entries-rules.test.ts` and
 * `phone.test.ts`. A form that accepts everything is a form the membership secretary has to
 * correct by hand, and the two fields most worth getting right — the phone number and the
 * date of birth — are the two a member is least likely to re-read before submitting.
 */

/** What the database answers today. Passed in rather than read, exactly as the schema takes it. */
const RULES: MembershipRules = {
  codes: ['club', 'club_ea'],
  minimumAge: 18,
  eaCutoffMonth: 4,
  eaCutoffDay: 1,
};

const TODAY = { year: 2026, month: 9, day: 21 };

/** A complete, valid application. Each test changes one thing about it. */
function application(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Mr',
    firstName: 'Henry',
    lastName: 'Finn',
    email: 'Henry.Finn@Example.com',
    phone: '07700 900123',
    dateOfBirth: '1992-05-09',
    addressLine1: 'Flat 6, Landmark Court',
    addressLine2: 'Caledonian Road',
    cityTown: 'Bristol',
    postcode: 'bs1 6jl',
    country: 'GB',
    membershipType: 'club',
    previousAffiliation: 'no',
    eaPortalConsent: 'yes',
    agreeCodeOfConduct: true,
    agreePrivacyPolicy: true,
    agreeDisciplinaryPolicy: true,
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}) {
  return parseMembershipApplication(application(overrides), RULES, TODAY);
}

describe('a complete application', () => {
  it('is accepted, and normalised on the way through', () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // An address is an identifier: `A@B.com` and `a@b.com` are one mailbox.
    expect(result.value.email).toBe('henry.finn@example.com');
    // E.164, so one number has one representation whichever way it was typed.
    expect(result.value.phone).toBe('+447700900123');
    // Uppercase, one space, so "have we got this address already" is answerable.
    expect(result.value.postcode).toBe('BS1 6JL');
  });

  it('names every field it collects, so nothing is asked for in silence', () => {
    // The list is what the form renders from and what the errors map is keyed by. A field
    // appearing in one and not the other is how a box arrives that nothing validates.
    expect(MEMBERSHIP_FIELDS).toContain('dateOfBirth');
    expect(MEMBERSHIP_FIELDS).toContain('eaPortalConsent');
    expect(new Set(MEMBERSHIP_FIELDS).size).toBe(MEMBERSHIP_FIELDS.length);
  });
});

describe('the postcode, which is only a UK postcode when the country is GB', () => {
  it.each(['BS3 1DB', 'bs31db', 'bs3  1db', ' BS3 1DB '])(
    '%s is stored as BS3 1DB',
    (typed) => {
      const result = parse({ postcode: typed });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.postcode).toBe('BS3 1DB');
    },
  );

  it.each(['BS3', 'NOT A POSTCODE', '12345', 'BS3 1D'])('refuses %s in GB', (typed) => {
    const result = parse({ postcode: typed });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.postcode).toMatch(/UK postcode/u);
  });

  /**
   * ⚠️ **The rule that would have refused a real member.**
   *
   * Applied to every country, the UK pattern rejects a French member's `75001` — which is
   * exactly the failure E.164 was chosen to avoid one field along. The postcode is free text
   * once the country is not GB, because this module has no business holding an opinion about
   * how Portuguese addresses are shaped.
   */
  it.each([
    ['FR', '75001'],
    ['IE', 'D02 AF30'],
    ['US', '90210-1234'],
    ['AU', '3000'],
  ])('accepts %s postcode %s as given', (country, postcode) => {
    const result = parse({ country, postcode });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.postcode).toBe(postcode);
  });

  it('normalises a UK postcode the same way wherever it is called', () => {
    expect(normaliseUkPostcode('bs31db')).toBe('BS3 1DB');
    expect(normaliseUkPostcode('GIR0AA')).toBe('GIR 0AA');
  });
});

describe('the phone number', () => {
  it('stores a UK number in E.164', () => {
    const result = parse({ phone: '07700900123' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phone).toBe('+447700900123');
  });

  /** The club's stated reason for E.164: a member abroad should be reachable. */
  it('stores an international number as given', () => {
    const result = parse({
      phone: '+33 6 12 34 56 78',
      country: 'FR',
      postcode: '75001',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phone).toBe('+33612345678');
  });

  it.each([
    ['ask my mum', /digits only/u],
    ['0770090012', /11 digits/u],
    ['7700900123', /Start a UK number with 0/u],
    ['0117 496 0123 x204', /direct number/u],
  ])('refuses %s with something to do about it', (typed, expected) => {
    const result = parse({ phone: typed });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.phone).toMatch(expected);
  });

  it('asks for one when the box is empty', () => {
    const result = parse({ phone: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.phone).toMatch(/Enter a phone number/u);
  });
});

describe('the date of birth, and the club’s minimum age', () => {
  it('accepts somebody comfortably over 18', () => {
    expect(parse({ dateOfBirth: '1992-05-09' }).ok).toBe(true);
  });

  /**
   * ⚠️ **The boundary, computed on a calendar rather than with date arithmetic.**
   *
   * Somebody whose eighteenth birthday is *today* may join; somebody whose is tomorrow may
   * not. Getting this wrong by a day is invisible until it refuses a real applicant on their
   * birthday, which is the worst possible day to be told no.
   */
  it('lets somebody join on their eighteenth birthday, and not the day before', () => {
    // TODAY is 21 September 2026.
    expect(parse({ dateOfBirth: '2008-09-21' }).ok, 'eighteen today').toBe(true);

    const dayEarly = parse({ dateOfBirth: '2008-09-22' });
    expect(dayEarly.ok, 'eighteen tomorrow').toBe(false);
    if (!dayEarly.ok) expect(dayEarly.errors.dateOfBirth).toMatch(/18 or over/u);
  });

  it('refuses a date in the future, and says to check the year', () => {
    const result = parse({ dateOfBirth: '2027-01-01' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dateOfBirth).toMatch(/in the future/u);
  });

  it('refuses an implausible year rather than computing an age from it', () => {
    const result = parse({ dateOfBirth: '1492-05-09' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dateOfBirth).toMatch(/Check the year/u);
  });

  /**
   * ⚠️ **`2026-02-31` passes every bound and is not a day.** Round-tripping the built date is
   * the only check that catches it without restating how many days each month has.
   */
  it.each(['2026-02-31', '2026-13-01', '09/05/1992', '1992-5-9', 'yesterday'])(
    'refuses %s as not a date',
    (typed) => {
      const result = parse({ dateOfBirth: typed });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.dateOfBirth).toBeDefined();
    },
  );

  it('counts whole years on a given day', () => {
    const born = { year: 2008, month: 9, day: 21 };

    expect(ageOn(born, { year: 2026, month: 9, day: 21 })).toBe(18);
    expect(ageOn(born, { year: 2026, month: 9, day: 20 })).toBe(17);
    expect(ageOn(born, { year: 2026, month: 12, day: 31 })).toBe(18);
    expect(ageOn(born, { year: 2027, month: 1, day: 1 })).toBe(18);
  });

  it('reads the minimum age from the rules rather than a constant of its own', () => {
    // The club can change it with a query. This is what proves the schema follows.
    const sixteen = parseMembershipApplication(
      application({ dateOfBirth: '2009-09-21' }),
      { ...RULES, minimumAge: 16 },
      TODAY,
    );

    expect(sixteen.ok, 'seventeen, against a minimum of sixteen').toBe(true);
  });
});

describe('the previous affiliation, and the fields that depend on it', () => {
  it('accepts yes with a club name and a URN', () => {
    const result = parse({
      previousAffiliation: 'yes',
      previousClubName: 'Bristol & West AC',
      eaUrn: '1234567',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.previousAffiliation).toBe(true);
    expect(result.value.previousClubName).toBe('Bristol & West AC');
    expect(result.value.eaUrn).toBe('1234567');
  });

  it('accepts yes with neither, because both follow-ups are optional', () => {
    // Somebody who ran for a club twenty years ago may genuinely not remember the URN.
    const result = parse({ previousAffiliation: 'yes' });

    expect(result.ok).toBe(true);
  });

  /**
   * ⚠️ **Dropped when the answer is no, rather than stored and ignored.**
   *
   * Somebody who ticks yes, types a club name, then changes to no has told the club that
   * their previous club is not relevant — and keeping it stores a fact they withdrew.
   * *Personal data is minimised at the boundary* is this repository's rule, and this is what
   * it looks like on a conditional field.
   */
  it('drops the follow-ups when the answer is no', () => {
    const result = parse({
      previousAffiliation: 'no',
      previousClubName: 'Bristol & West AC',
      eaUrn: '1234567',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.previousAffiliation).toBe(false);
    expect(result.value.previousClubName).toBeUndefined();
    expect(result.value.eaUrn).toBeUndefined();
  });

  it.each(['URN 1234', 'abc', '12-34'])('refuses %s as a URN', (typed) => {
    const result = parse({ previousAffiliation: 'yes', eaUrn: typed });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.eaUrn).toMatch(/digits only/u);
  });

  it('accepts a URN typed with spaces, because that is how people read them out', () => {
    const result = parse({ previousAffiliation: 'yes', eaUrn: '123 4567' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.eaUrn).toBe('1234567');
  });

  it('insists on an answer either way', () => {
    const result = parse({ previousAffiliation: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.previousAffiliation).toMatch(/yes or no/u);
  });
});

describe('consent, which has to be capable of being withheld', () => {
  /**
   * ⚠️ **The club's current form offers only "Yes".** Consent that cannot be refused is not
   * freely given, which is the whole of what UK GDPR asks of it — so "no" is an answer this
   * form accepts and the club acts on.
   */
  it('accepts no to the England Athletics portal', () => {
    const result = parse({ eaPortalConsent: 'no' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.eaPortalConsent).toBe(false);
  });

  it('still insists the question is answered', () => {
    const result = parse({ eaPortalConsent: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.eaPortalConsent).toMatch(/yes or no/u);
  });

  /**
   * The three agreements are different in kind from the consent above: they are the terms of
   * joining rather than an optional permission, so the form cannot proceed without them —
   * and each is a separate tick, because agreeing to three documents at once is agreeing to
   * none of them.
   */
  it.each([
    'agreeCodeOfConduct',
    'agreePrivacyPolicy',
    'agreeDisciplinaryPolicy',
  ] as const)('refuses an application with %s unticked', (field) => {
    const result = parse({ [field]: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toMatch(/agree to this/u);
  });
});

describe('the membership chosen', () => {
  it.each(['club', 'club_ea'])('accepts %s, which the database offers', (code) => {
    const result = parse({ membershipType: code });

    expect(result.ok).toBe(true);
  });

  /**
   * ⚠️ **An option the club has withdrawn is refused, not accepted at a price nobody sells.**
   * `membership_state()` returns only active rows, so `codes` is what is on offer today — a
   * cached page offering last season's option cannot buy it.
   */
  it('refuses a membership the database no longer offers', () => {
    const result = parse({ membershipType: 'club_ea_legacy' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.membershipType).toMatch(/not available/u);
  });
});

describe('what a bad submission looks like', () => {
  it('reports every problem at once, keyed by field', () => {
    // Moving focus to the first error only helps if every error is known — a form that
    // reveals them one at a time is a form somebody submits five times.
    const result = parseMembershipApplication(
      { title: 'Mr', firstName: '', email: 'nope', phone: 'ask my mum' },
      RULES,
      TODAY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.firstName).toBeDefined();
    expect(result.errors.email).toBeDefined();
    expect(result.errors.phone).toBeDefined();
    expect(result.errors.dateOfBirth).toBeDefined();
    expect(result.errors.agreeCodeOfConduct).toBeDefined();
  });

  it('survives a body that is not an object at all', () => {
    // A hand-rolled POST, or a bug. Every required field is missing, and saying so on each is
    // more use than one form-level message nobody can act on.
    const result = parseMembershipApplication('nonsense', RULES, TODAY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it('cannot be told what day it is by the submission', () => {
    // ⚠️ `today` is a closure variable rather than a field, so a body carrying its own
    // `today` cannot choose the date its author's age is measured against.
    const result = parseMembershipApplication(
      application({ dateOfBirth: '2020-01-01', today: { year: 2099, month: 1, day: 1 } }),
      RULES,
      TODAY,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dateOfBirth).toMatch(/18 or over/u);
  });
});
