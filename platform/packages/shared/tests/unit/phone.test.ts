import { describe, expect, it } from 'vitest';

import { parsePhone, phoneProblem } from '../../src/phone.js';

/**
 * E.164 parsing, tested against the numbers people actually type.
 *
 * ⚠️ **The fixtures are the point.** `nn-entry.ts`'s own phone rule was written after a form
 * accepted `ask my mum`, `n/a` and `see above` on the one field whose entire purpose is to be
 * dialled — so the refusals below are at least as important as the acceptances, and each one
 * is a shape somebody has actually typed into a form rather than an invented edge case.
 */

describe('a UK number, however it is written', () => {
  /**
   * All of these are one number. The whole reason to store E.164 is that "is this the number
   * already on file" becomes a string comparison that gets the right answer.
   */
  it.each([
    '07700900123',
    '07700 900123',
    '07700 900 123',
    '(07700) 900123',
    '07700-900-123',
    '0 7 7 0 0 9 0 0 1 2 3',
    '+447700900123',
    '+44 7700 900123',
    '+44 (0)7700 900123',
    '+44 (0) 7700 900 123',
    '+4407700900123',
    'tel:+447700900123',
    '  07700900123  ',
  ])('%s is +447700900123', (typed) => {
    expect(parsePhone(typed)).toEqual({ value: '+447700900123', problem: null });
  });

  it('keeps a landline as readily as a mobile', () => {
    // Eleven digits starting 0 is the rule; nothing here cares whether it is a mobile.
    expect(parsePhone('0117 496 0123').value).toBe('+441174960123');
    expect(parsePhone('020 7946 0123').value).toBe('+442079460123');
  });

  /**
   * ⚠️ **Ten digits is refused, and the reasoning is worth keeping.**
   *
   * A brief once asked for a ten-digit exception "for the handful of old area codes that are
   * genuinely 10" and, in the same breath, gave `07700 90012` — itself ten digits — as an
   * example of a number that must be **rejected** as too short. Both cannot be true without a
   * lookup table of which ten-digit numbers are valid, which is the dependency this module
   * refuses outright. Eleven digits, no exception.
   */
  it.each(['0770090012', '077009001234', '+4477009001', '+447700900123456'])(
    'refuses %s as the wrong length for a UK number',
    (typed) => {
      expect(parsePhone(typed)).toEqual({ value: '', problem: 'uk-shape' });
    },
  );
});

describe('an international number, which is why this stores E.164 at all', () => {
  /**
   * ⚠️ **The club's stated reason for choosing E.164**: a member with a French number should
   * be reachable on it. National form — `07700900123` — has no way to express which country a
   * number belongs to, so it could not have held this at all.
   */
  it('keeps a French number as given', () => {
    expect(parsePhone('+33 6 12 34 56 78')).toEqual({
      value: '+33612345678',
      problem: null,
    });
  });

  it.each([
    ['+353 86 123 4567', '+353861234567'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['+61 412 345 678', '+61412345678'],
  ])('keeps %s as %s', (typed, stored) => {
    expect(parsePhone(typed).value).toBe(stored);
  });

  /**
   * Eight to fifteen digits is the whole of the rule. This module has no table of national
   * numbering plans and no business inventing an opinion about one — a wrong opinion refuses
   * a real member, which is worse than accepting a number that turns out not to ring.
   */
  it.each(['+1234567', '+1234567890123456'])(
    'refuses %s as an implausible length',
    (typed) => {
      expect(parsePhone(typed)).toEqual({ value: '', problem: 'international-shape' });
    },
  );
});

describe('what it refuses, and why each one has happened', () => {
  it.each(['ask my mum', 'n/a', 'see above', 'my mobile'])(
    'refuses %s, which is not a phone number',
    (typed) => {
      expect(parsePhone(typed).problem).toBe('letters');
    },
  );

  it('refuses a bare number with no trunk zero and no country code', () => {
    // ⚠️ Assuming `+44` here would turn a mistyped foreign number into a plausible British
    // one, which is the failure mode that is hardest to notice and worst to have.
    expect(parsePhone('7700900123')).toEqual({ value: '', problem: 'unrecognised' });
  });

  it('refuses an extension rather than dropping one', () => {
    // Dropping it silently stores a number that will not reach the person who typed it. And
    // E.164 has no concept of an extension, so a column claiming to be E.164 would not be.
    expect(parsePhone('0117 496 0123 x204')).toEqual({ value: '', problem: 'extension' });
    expect(parsePhone('+441174960123x204').problem).toBe('extension');
  });

  /**
   * ⚠️ **Punctuation alone is not an empty box.** `'-'` is content that happens to strip down
   * to nothing, and the two must not read the same way — a box holding only punctuation is a
   * number somebody got wrong, not a box they left alone.
   */
  it('tells punctuation apart from emptiness', () => {
    expect(parsePhone('')).toEqual({ value: '', problem: null });
    expect(parsePhone('   ')).toEqual({ value: '', problem: null });
    expect(parsePhone('-')).toEqual({ value: '', problem: 'unrecognised' });
    expect(parsePhone('()')).toEqual({ value: '', problem: 'unrecognised' });
  });
});

describe('phoneProblem, the validation half', () => {
  it('says nothing about an absent value, because that is the caller’s message', () => {
    // Absence is `min(1)` on a required box. Saying it twice puts two entries in an error
    // summary for one empty field.
    expect(phoneProblem(undefined)).toBeNull();
    expect(phoneProblem('')).toBeNull();
  });

  it('agrees with parsePhone on everything else', () => {
    for (const typed of [
      '07700900123',
      '+33612345678',
      'ask my mum',
      '0770090012',
      '7700900123',
      '+1234567',
    ]) {
      expect(phoneProblem(typed), typed).toBe(parsePhone(typed).problem);
    }
  });
});

describe('the property that made E.164 worth choosing', () => {
  it('gives one number one representation, however it was typed', () => {
    const written = [
      '07700900123',
      '07700 900 123',
      '+447700900123',
      '+44 (0)7700 900123',
      'tel:+44 7700 900123',
    ];

    const stored = new Set(written.map((value) => parsePhone(value).value));

    // ⚠️ One entry. This is what makes "is this the number already on file" answerable with a
    // string comparison — the property `nn-entry.ts` argues for and which this module keeps,
    // just in a different format.
    expect(stored.size).toBe(1);
  });
});
