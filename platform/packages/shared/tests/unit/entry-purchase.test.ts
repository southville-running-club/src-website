import { describe, expect, it } from 'vitest';
import { nnEntrantPayload, PENDING_PURCHASE_REASONS } from '../../src/entry-purchase';
import type { NnEntry } from '../../src/nn-entry';

/**
 * The mapping from a validated entry to the arguments `entries.create_pending_purchase()`
 * reads.
 *
 * **It is the seam where two naming conventions meet**, and a seam like that fails silently:
 * a key spelled `emergencyName` instead of `emergency_contact_name` is not an error, it is a
 * null the database refuses several layers later with nothing to point at. Asserting the keys
 * against the column names is the cheapest way to keep it honest.
 */

const ENTRY: NnEntry = {
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
  dateOfBirth: { year: 1986, month: 12, day: 9 },
  gender: 'female',
  genderIdentity: 'Woman',
  club: "O'Sullivan Runners",
  feeCode: 'affiliated',
  eaNumber: '1234567',
  emergencyName: 'Margaret Hamilton',
  emergencyPhone: '0117 496 0000',
  medicalNotes: 'Type 1 diabetic.',
  consents: { entryTerms: true, medical: true },
};

describe('one runner, in the column names the database uses', () => {
  it('maps every field onto the name entries.entrants actually has', () => {
    expect(nnEntrantPayload(ENTRY)).toEqual({
      first_name: 'Grace',
      last_name: 'Hopper',
      // `YYYY-MM-DD`, which is what Postgres returns for a `date` and what it accepts back.
      // The civil date never becomes a `Date` on the way — a timezone applied to a birthday
      // is how somebody turns 18 a day early in one country and a day late in another.
      date_of_birth: '1986-12-09',
      gender: 'female',
      // The race category and the recorded gender are two columns and two keys. A payload
      // that carried only the first would silently drop what somebody typed.
      gender_identity: 'Woman',
      club: "O'Sullivan Runners",
      ea_number: '1234567',
      emergency_contact_name: 'Margaret Hamilton',
      emergency_contact_phone: '0117 496 0000',
      leg: null,
    });
  });

  it('carries no medical information at all', () => {
    // **Special category data does not travel inside the entrant.** It is its own argument to
    // the function, so a reviewer can see in one line which parameter carries it — and this
    // assertion is what stops it quietly moving back in here later.
    const payload = JSON.stringify(nnEntrantPayload(ENTRY));

    expect(payload).not.toContain('diabetic');
    expect(payload).not.toContain('medical');
  });

  it('passes a dropped England Athletics number through as null rather than re-deriving it', () => {
    // `parseNnEntry` drops the number when the chosen fee does not want one. Re-deciding that
    // here would be a second rule about the same thing, and the second one is always the one
    // that drifts.
    const unaffiliated: NnEntry = { ...ENTRY, feeCode: 'unaffiliated', eaNumber: null };

    expect(nnEntrantPayload(unaffiliated).ea_number).toBeNull();
  });

  it('states an unanswered gender as null rather than dropping the key', () => {
    // **Not answering is an answer**, and it has to arrive as one. An omitted key and a null
    // reach `create_pending_purchase()` as the same thing today, so this is not load-bearing
    // for correctness — it is load-bearing for the next reader, who should not have to work
    // out whether a missing key means "did not say" or "the payload forgot".
    const unsaid: NnEntry = { ...ENTRY, genderIdentity: null };

    expect(nnEntrantPayload(unsaid)).toHaveProperty('gender_identity', null);
  });

  it('states leg rather than omitting it', () => {
    // Null because Nightingale Nightmare is a solo race. Stated so that the first paired race
    // meets a field to fill in rather than a field to discover.
    expect(nnEntrantPayload(ENTRY)).toHaveProperty('leg', null);
  });
});

describe('the reasons the database can refuse', () => {
  it('includes an unknown, so a newer migration cannot break an older Worker', () => {
    // **Nothing sequences a migration against the Cloudflare deploy.** A reason added later
    // can reach a Worker that has never heard of it, and the only safe answer there is "we
    // could not complete this" rather than a crash on a page somebody is mid-payment on.
    expect(PENDING_PURCHASE_REASONS).toContain('unknown');
    expect(PENDING_PURCHASE_REASONS).toContain('sold_out');
    expect(PENDING_PURCHASE_REASONS).toContain('closed');
  });
});
