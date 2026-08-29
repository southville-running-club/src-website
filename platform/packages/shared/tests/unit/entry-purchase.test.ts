import { describe, expect, it } from 'vitest';
import {
  nnEntrantPayload,
  nnGuidePayload,
  PENDING_PURCHASE_REASONS,
} from '../../src/entry-purchase';
import type { NnEntry, NnEntryGuide } from '../../src/nn-entry';

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
  emergencyName: 'Margaret Hamilton',
  emergencyPhone: '0117 496 0000',
  medicalNotes: 'Type 1 diabetic.',
  discountCode: null,
  guide: null,
  consents: { entryTerms: true, medical: true, vi: false },
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
      emergency_contact_name: 'Margaret Hamilton',
      emergency_contact_phone: '0117 496 0000',
      leg: null,
      // **Stated rather than left to the column default.** `create_pending_purchase()` checks
      // the role against the entrant's position and refuses a payload where the two disagree,
      // so a runner that said nothing would be agreeing by accident.
      role: 'runner',
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

  it('sends no England Athletics key at all, on any fee', () => {
    // **The club stopped asking for the number on 29 August 2026**, so there is none to send
    // and no key to send it under. `toEqual` above would catch an extra key on the affiliated
    // entry; this says the same thing about the fee that most nearly had a reason to carry
    // one, and says it as the absence it is rather than as a null that reads like a value
    // somebody decided to blank.
    const unaffiliated: NnEntry = { ...ENTRY, feeCode: 'unaffiliated' };

    expect(nnEntrantPayload(unaffiliated)).not.toHaveProperty('ea_number');
    expect(nnEntrantPayload(ENTRY)).not.toHaveProperty('ea_number');
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

const GUIDE: NnEntryGuide = {
  firstName: 'Katherine',
  lastName: 'Johnson',
  dateOfBirth: { year: 1988, month: 8, day: 26 },
  email: 'katherine@example.com',
  emergencyName: 'Dorothy Vaughan',
  emergencyPhone: '0117 496 0001',
  medicalNotes: 'Asthmatic.',
};

describe('the guide, in the same column names', () => {
  it('maps every field the club needs about somebody on the course', () => {
    expect(nnGuidePayload(GUIDE)).toEqual({
      first_name: 'Katherine',
      last_name: 'Johnson',
      date_of_birth: '1988-08-26',
      // **The one key a runner's payload does not carry**, and the club has no way to reach
      // this person without it: a runner is reachable through the address that paid, and a
      // guide has no purchase of their own.
      email: 'katherine@example.com',
      // **Four nulls, and each is null for a reason rather than because the form did not
      // ask.** `gender` is the race category and a guide is in none — asking was collecting an
      // answer nothing could use; `gender_identity` and `club` derive nothing for somebody in
      // no category either; `leg` is a paired-race field on a solo race.
      gender: null,
      gender_identity: null,
      club: null,
      leg: null,
      emergency_contact_name: 'Dorothy Vaughan',
      emergency_contact_phone: '0117 496 0001',
      // **The last element, and it must say so.** `create_pending_purchase()` refuses a
      // payload whose roles and positions disagree rather than reordering it, because a
      // silently reordered entry records a place against somebody nobody meant.
      role: 'guide',
    });
  });

  it('never carries an England Athletics number, whatever else changes', () => {
    // A guide never had one and now nobody does: the club stopped asking on 29 August 2026,
    // and `entrants_ea_number_not_collected` refuses a value in the column. This is the
    // boundary keeping the payload on the right side of that rather than finding out from a
    // `check_violation`.
    expect(nnGuidePayload(GUIDE)).not.toHaveProperty('ea_number');
  });

  it('carries no medical information at all', () => {
    // Special category data does not travel inside the entrant, for the runner or the guide.
    // It is its own positional argument, so a reviewer can see in one line which parameter
    // carries it.
    const payload = JSON.stringify(nnGuidePayload(GUIDE));

    expect(payload).not.toContain('Asthmatic');
    expect(payload).not.toContain('medical');
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
