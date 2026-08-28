import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

/**
 * Every rule the club has, tested by **attempting the bypass** rather than by reading the
 * code.
 *
 * Slice E found by accident that `entries.create_pending_purchase` wrote `ea_number` straight
 * through without ever consulting `fees.requires_ea_number` — so two PostgREST calls with the
 * published anon key produced an affiliated entry with no England Athletics number, at £2
 * less, unverifiable. The Zod schema did require it. **Zod is the form's control, not the
 * system's**, and a rule that lives only there is a rule about the page.
 *
 * The audit that followed asked what else was like it, and the answer was eight more. This
 * file is what stops all nine coming back. Every test below is a *bypass attempt*: an
 * anonymous client, no browser, no Worker, no Zod — the shape a script with the page's own key
 * would take.
 *
 * ## What "passes" has to mean here
 *
 * **A Postgres error is never a refusal.** A broken function refuses everything, which reads
 * as every rule holding at once — the harness that produced this file scored three rules as
 * closed that way, off one `pg_catalog.coalesce` that does not exist. So each test asserts the
 * *specific* refusal reason or error code, never merely that something failed, and
 * `refusalFor` fails loudly on a Postgres error rather than treating it as a no.
 *
 * ## Fixtures
 *
 * **Every fixture is its own event**, created here and deleted in `afterAll`. A cross-file
 * race has bitten this suite twice — most recently a discount code selected across the whole
 * table — and a shared event that runs out of capacity is the same bug wearing a hat: it turns
 * every later probe into `sold_out`, which reads as a refusal for the reason being tested and
 * is not one. Hence a capacity far above the number of entries any test here makes.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Fabricated runnings, one per rule that needs its own configuration. **None of them is a
 * running of `nn`**, so nothing here can change what the site's front door resolves to.
 */
const OPEN = 'zzrules-open';
const NO_AGE = 'zzrules-no-age';
const PAIR = 'zzrules-pair';
const NO_CONSENTS = 'zzrules-no-consents';

const FIXTURE_SLUGS = [OPEN, NO_AGE, PAIR, NO_CONSENTS] as const;

/** The event date every fixture is run on, so the age boundaries below are readable. */
const EVENT_DATE = '2027-06-01';
/** Somebody who turns 18 on race day, and somebody who turns 18 the day after it. */
const EXACTLY_EIGHTEEN = '2009-06-01';
const A_DAY_TOO_YOUNG = '2009-06-02';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/**
 * The one row a query was expected to return.
 *
 * **It asserts the count rather than indexing and hoping.** `noUncheckedIndexedAccess` would
 * otherwise be answered with a `!` on every read-back, and a `!` on an empty result set turns
 * "the row this test just wrote is missing" into "cannot read property of undefined" twelve
 * lines later.
 */
async function single<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const rows = await query<T>(sql, values);
  expect(rows, 'expected exactly one row back').toHaveLength(1);
  return rows[0] as T;
}

async function removeFixtures(): Promise<void> {
  // Purchases first: `entry_purchases.event_id` has no cascade, deliberately — an event with
  // money taken against it is not something to delete by removing its parent row.
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug = any($1::text[]))`,
    [[...FIXTURE_SLUGS]],
  );
  await query('delete from entries.events where slug = any($1::text[])', [
    [...FIXTURE_SLUGS],
  ]);
}

async function makeEvent(
  slug: string,
  options: {
    minimumAge?: number | null;
    entrantsPerEntry?: number;
    requiredConsents?: string[];
  } = {},
): Promise<string> {
  const {
    minimumAge = 18,
    entrantsPerEntry = 1,
    requiredConsents = ['entryTerms'],
  } = options;

  // The capacity below is far above anything this file enters, deliberately: a fixture that
  // runs out of places reports every later refusal as sold_out, which reads as a refusal for
  // the reason being tested and is not one.
  const event = await single<{ id: string }>(
    `insert into entries.events (
       slug, race_slug, display_name, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, requires_dob, from_address,
       consent_version, active, required_consents
     ) values (
       $1, 'zzrules', $2, $3::date, time '11:00', $4, 5000,
       now() - interval '1 hour', now() + interval '1 hour', $5, true,
       'rules@example.com', 'zzrules-v1', true, $6::text[]
     ) returning id`,
    [
      slug,
      `Rules fixture ${slug}`,
      EVENT_DATE,
      entrantsPerEntry,
      minimumAge,
      requiredConsents,
    ],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
     values ($1, 'affiliated', 'Affiliated', 1500, true),
            ($1, 'unaffiliated', 'Unaffiliated', 1700, false)`,
    [event.id],
  );

  return event.id;
}

beforeAll(async () => {
  await removeFixtures();
  await makeEvent(OPEN);
  await makeEvent(NO_AGE, { minimumAge: null });
  await makeEvent(PAIR, { entrantsPerEntry: 2 });
  await makeEvent(NO_CONSENTS, { requiredConsents: [] });
});

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Calling the function the way a script with the published key would
// -----------------------------------------------------------------------------------------

interface EntrantOverrides {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  /** The race category — three values, and what the prize list is grouped by. */
  gender?: string | null;
  /** The open question beside it. Optional, free text, on no list. See ADR-020. */
  gender_identity?: string | null;
  club?: string | null;
  ea_number?: string | null;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  leg?: number | null;
}

/**
 * **A distinct runner per call, because one entry per runner is a database rule now.**
 *
 * `entries.create_pending_purchase()` refuses a second entry for a runner who already holds a
 * live place on the same event, keyed on first name, last name and date of birth. Every
 * fixture in this file used to be the same person, so the second entry against any one event
 * was refused with `already_entered` and dozens of tests failed on a rule they were not
 * written to exercise.
 *
 * **The counter goes on the surname rather than the date of birth**, deliberately. The default
 * date of birth is chosen to sit comfortably clear of the minimum age and several tests read a
 * category derived from it; moving it would make those tests depend on how many entries ran
 * before them. A surname is read back by exactly one test, which asserts the apostrophe rather
 * than the whole string.
 *
 * **The apostrophe stays in every generated name**, so the escaping it exists to prove is
 * still exercised on every single call rather than only where somebody remembered to ask.
 *
 * Deterministic: a counter, not a random value, so a failing run can be read.
 */
let entrantSerial = 0;

function entrant(overrides: EntrantOverrides = {}): Record<string, unknown> {
  return {
    first_name: 'Ada',
    last_name: `O'Brien-${(entrantSerial += 1)}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    club: null,
    ea_number: null,
    emergency_contact_name: 'Mary Somerville',
    emergency_contact_phone: '07700 900123',
    leg: null,
    ...overrides,
  };
}

interface CreateOptions {
  feeCode?: string;
  email?: string;
  entrants?: Record<string, unknown>[];
  medical?: (string | null)[];
  consents?: unknown;
}

async function create(
  slug: string,
  options: CreateOptions = {},
): Promise<{ data: Record<string, unknown> | null; errorCode: string | undefined }> {
  const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
    p_slug: slug,
    p_fee_code: options.feeCode ?? 'unaffiliated',
    p_purchaser_name: 'Ada O’Brien',
    p_purchaser_email: options.email ?? 'ada@example.com',
    p_entrants: options.entrants ?? [entrant()],
    p_medical: options.medical ?? [null],
    p_consents:
      options.consents === undefined
        ? { entryTerms: true, medical: false }
        : options.consents,
  });

  return { data: data as Record<string, unknown> | null, errorCode: error?.code };
}

/**
 * The reason the database gave, with a Postgres error treated as a failure of the test rather
 * than as a refusal. See the note at the top of this file — this assertion is the reason the
 * suite cannot go green on a function that is broken for everybody.
 */
async function refusalFor(slug: string, options: CreateOptions = {}): Promise<unknown> {
  const { data, errorCode } = await create(slug, options);
  expect(errorCode, 'the call errored rather than being refused').toBeUndefined();
  expect(data, 'the function returned nothing at all').not.toBeNull();
  expect(data?.ok, `expected a refusal, got ${JSON.stringify(data)}`).toBe(false);
  return data?.reason;
}

async function acceptedPurchaseId(
  slug: string,
  options: CreateOptions = {},
): Promise<string> {
  const { data, errorCode } = await create(slug, options);
  expect(errorCode).toBeUndefined();
  expect(data?.ok, `expected acceptance, got ${JSON.stringify(data)}`).toBe(true);
  return data?.purchase_id as string;
}

// =========================================================================================
// 1. The England Athletics number — the rule that prompted the slice
// =========================================================================================

describe('the England Athletics number, against the fee that was chosen', () => {
  it('refuses an affiliated entry with no number, which is the Slice E finding', async () => {
    // **The bypass, exactly as it was found.** Before this slice it returned `ok: true` and
    // wrote a £15 affiliated entry with `ea_number` null.
    expect(await refusalFor(OPEN, { feeCode: 'affiliated' })).toBe('ea_number_required');
  });

  it('refuses one whose number is only whitespace', async () => {
    expect(
      await refusalFor(OPEN, {
        feeCode: 'affiliated',
        entrants: [entrant({ ea_number: '   ' })],
      }),
    ).toBe('ea_number_required');
  });

  it('accepts an affiliated entry that has one, and stores it', async () => {
    const id = await acceptedPurchaseId(OPEN, {
      feeCode: 'affiliated',
      entrants: [entrant({ ea_number: '1234567' })],
    });

    const row = await single<{ ea_number: string }>(
      'select ea_number from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.ea_number).toBe('1234567');
  });

  it('still refuses a number that is not six to eight digits', async () => {
    // The check constraint, reached through the function's own handler. This held before the
    // slice and must keep holding.
    expect(
      await refusalFor(OPEN, {
        feeCode: 'affiliated',
        entrants: [entrant({ ea_number: 'NOTANUMBER' })],
      }),
    ).toBe('invalid_entrants');
  });

  it('drops a number sent against a fee that does not want one', async () => {
    // **Dropped rather than refused, because minimisation happens at the boundary here.** An
    // England Athletics number identifies a person and has no purpose against an unaffiliated
    // entry, so it does not travel — the same thing `parseNnEntry` does one floor up.
    const id = await acceptedPurchaseId(OPEN, {
      feeCode: 'unaffiliated',
      entrants: [entrant({ ea_number: '1234567' })],
    });

    const row = await single<{ ea_number: string | null }>(
      'select ea_number from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.ea_number).toBeNull();
  });

  it('refuses one written into the table by any other route', async () => {
    // The trigger, tested directly. A privileged insert stands in for every write path that
    // is not `create_pending_purchase` — which is what the function's own check cannot cover.
    const id = await acceptedPurchaseId(OPEN, { feeCode: 'unaffiliated' });
    const row = await single<{ id: string }>(
      'select id from entries.entrants where purchase_id = $1',
      [id],
    );

    await expect(
      query('update entries.entrants set ea_number = $1 where id = $2', [
        '7654321',
        row.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// =========================================================================================
// 2. The consents — the record of what somebody agreed to
// =========================================================================================

describe('the race category, and the gender question beside it', () => {
  // **Two columns, and the rules on them are deliberately different — ADR-020.** `gender` is
  // the closed list the prize table is grouped by; `gender_identity` is the open question. The
  // assertions here are what stop the second one acquiring the first one's rules, and they run
  // through the function an anonymous caller actually reaches rather than through Zod.

  it('still refuses a category that is not one of the three', async () => {
    expect(await refusalFor(OPEN, { entrants: [entrant({ gender: 'other' })] })).toBe(
      'invalid_entrants',
    );
  });

  it('stores the gender somebody typed, exactly as they typed it', async () => {
    // No mapping onto the three, no normalising, no title-casing. The answer is theirs, and a
    // database that tidied it would be answering a question nobody asked it.
    const id = await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ gender: 'non_binary', gender_identity: 'Agender' })],
    });

    const row = await single<{ gender: string; gender_identity: string | null }>(
      'select gender, gender_identity from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.gender).toBe('non_binary');
    expect(row.gender_identity).toBe('Agender');
  });

  it('accepts an entry that never mentions the key at all', async () => {
    // **The expand step, asserted.** A Worker deployed before this migration sends a payload
    // with no `gender_identity` in it, and that has to keep working and mean "did not say".
    const id = await acceptedPurchaseId(OPEN, { entrants: [entrant()] });

    const row = await single<{ gender_identity: string | null }>(
      'select gender_identity from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.gender_identity).toBeNull();
  });

  it('normalises an empty answer to null rather than storing two kinds of nothing', async () => {
    // An untouched text input posts `''`. Stored as-is it would be a second value meaning
    // "did not say", and every later count of who answered would be wrong in a way nothing
    // reports.
    const id = await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ gender_identity: '   ' })],
    });

    const row = await single<{ gender_identity: string | null }>(
      'select gender_identity from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.gender_identity).toBeNull();
  });

  it('refuses one past the column ceiling, whatever the form allowed', async () => {
    // The check constraint, reached through the function's own handler — the backstop for a
    // caller who never met the form. Zod is the form's control; this is the system's.
    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ gender_identity: 'x'.repeat(61) })],
      }),
    ).toBe('invalid_entrants');
  });

  it('never lets either gender field become part of one-runner-one-place', async () => {
    // **The rule is keyed on name and date of birth and must stay that way.** If either column
    // were in the key, changing an answer would be a way of buying a second place out of 250 —
    // the defect #115 closed, reopened through a different door.
    //
    // **The surname is pinned rather than left to `entrant()`'s serial**, which exists to make
    // every other test in this file a *different* runner. This is the one test that needs the
    // same one twice, so it says so.
    const same = { last_name: "O'Brien-samerunner", date_of_birth: '1990-01-01' };

    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ ...same, gender: 'female', gender_identity: 'Woman' })],
    });

    expect(
      await refusalFor(OPEN, {
        entrants: [
          entrant({ ...same, gender: 'non_binary', gender_identity: 'Genderfluid' }),
        ],
      }),
    ).toBe('already_entered');
  });
});

describe('the consents an event requires', () => {
  it('refuses a submission that sent no consents at all', async () => {
    // **Accepted before this slice, and stored as `{}`.** The worst of the nine: the column
    // is the club's record of what a person agreed to, and it was entirely caller-controlled.
    expect(await refusalFor(OPEN, { consents: {} })).toBe('consents_missing');
  });

  it('refuses one that explicitly declined the entry terms', async () => {
    expect(
      await refusalFor(OPEN, { consents: { entryTerms: false, medical: false } }),
    ).toBe('consents_missing');
  });

  it('refuses a consent answered with a string rather than a boolean', async () => {
    // `"yes please"` is not a considered answer to a consent question. It was stored verbatim.
    expect(
      await refusalFor(OPEN, { consents: { entryTerms: 'yes please', medical: false } }),
    ).toBe('consents_missing');
  });

  it('refuses consents that are not an object at all', async () => {
    expect(await refusalFor(OPEN, { consents: ['entryTerms'] })).toBe('invalid_entrants');
  });

  it('accepts an event that requires none, so the rule is the event’s and not the schema’s', async () => {
    // **The reason this is `events.required_consents` rather than a flat table constraint.**
    // The set of consents differs between races; a constraint naming `entryTerms` would write
    // one race's checkbox list into the schema for every race after it.
    await acceptedPurchaseId(NO_CONSENTS, { consents: {} });
  });

  it('refuses a purchase written by any other route without the consents', async () => {
    // The trigger. A privileged update stands in for every non-function write path.
    const id = await acceptedPurchaseId(OPEN);

    await expect(
      query('update entries.entry_purchases set consents = $1 where id = $2', ['{}', id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a non-boolean consent value by table constraint, whatever the event requires', async () => {
    // The type discipline is flat and universal, even where the *requirement* is per event —
    // so `NO_CONSENTS`, which demands nothing, still cannot hold `"maybe"`.
    const id = await acceptedPurchaseId(NO_CONSENTS, { consents: {} });

    await expect(
      query('update entries.entry_purchases set consents = $1 where id = $2', [
        '{"photography": "maybe"}',
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('still records the event’s consent_version and never the caller’s', async () => {
    const id = await acceptedPurchaseId(OPEN);
    const row = await single<{ consent_version: string }>(
      'select consent_version from entries.entry_purchases where id = $1',
      [id],
    );
    expect(row.consent_version).toBe('zzrules-v1');
  });
});

// =========================================================================================
// 3. Medical notes and the consent that permits them
// =========================================================================================

describe('medical information, and the separate consent it needs', () => {
  it('drops notes sent without the medical consent', async () => {
    const id = await acceptedPurchaseId(OPEN, {
      medical: ['Asthma — carries an inhaler'],
      consents: { entryTerms: true, medical: false },
    });

    const row = await single<{ n: string }>(
      `select count(*) as n from entries.entrant_medical m
         join entries.entrants e on e.id = m.entrant_id
        where e.purchase_id = $1`,
      [id],
    );
    expect(row.n).toBe('0');
  });

  it('stores them where the consent was given', async () => {
    const id = await acceptedPurchaseId(OPEN, {
      medical: ['Asthma — carries an inhaler'],
      consents: { entryTerms: true, medical: true },
    });

    const row = await single<{ notes: string }>(
      `select m.notes from entries.entrant_medical m
         join entries.entrants e on e.id = m.entrant_id
        where e.purchase_id = $1`,
      [id],
    );
    expect(row.notes).toBe('Asthma — carries an inhaler');
  });

  it('refuses a note written against an entrant whose purchase withheld consent', async () => {
    // **The lock the separate table was argued for, and did not have.** The first entries
    // migration says the absence of a row *is* the record of a withheld consent — "there is no
    // state where notes are stored and the consent that would have permitted them is false".
    // That was true of the function and of nothing else. Special category data under Article 9.
    const id = await acceptedPurchaseId(OPEN, {
      consents: { entryTerms: true, medical: false },
    });
    const row = await single<{ id: string }>(
      'select id from entries.entrants where purchase_id = $1',
      [id],
    );

    await expect(
      query('insert into entries.entrant_medical (entrant_id, notes) values ($1, $2)', [
        row.id,
        'no consent was given for this',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// =========================================================================================
// 4. Dates of birth, and the ages derived from them
// =========================================================================================

describe('the date of birth', () => {
  it('refuses somebody a day under the minimum age on race day', async () => {
    expect(
      await refusalFor(OPEN, { entrants: [entrant({ date_of_birth: A_DAY_TOO_YOUNG })] }),
    ).toBe('under_minimum_age');
  });

  it('accepts somebody who turns eighteen on race day', async () => {
    // A birthday **on** race day counts — the same rule as `ageOn` in
    // packages/shared/src/age-category.ts, which is what the form validates with. The pair of
    // boundary tests is what says the two agree.
    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ date_of_birth: EXACTLY_EIGHTEEN })],
    });
  });

  it('refuses a date of birth after the race, even where no minimum age is set', async () => {
    // **Accepted and stored before this slice.** `minimum_age is null` skipped the whole
    // block, so an event admitting juniors would have taken an entrant born in 2030.
    expect(
      await refusalFor(NO_AGE, { entrants: [entrant({ date_of_birth: '2030-01-01' })] }),
    ).toBe('invalid_entrants');
  });

  it('refuses a birth year before 1900, which a minimum age cannot catch', async () => {
    // A 200-year-old is comfortably over 18, so the age check never fired. Below 1900 a typo
    // is far likelier than a life, which is the rule the form has always applied.
    expect(
      await refusalFor(NO_AGE, { entrants: [entrant({ date_of_birth: '1823-12-10' })] }),
    ).toBe('invalid_entrants');
  });

  it('refuses one written into the table by any other route', async () => {
    const id = await acceptedPurchaseId(OPEN);
    const row = await single<{ id: string }>(
      'select id from entries.entrants where purchase_id = $1',
      [id],
    );

    await expect(
      query('update entries.entrants set date_of_birth = $1 where id = $2', [
        '2030-01-01',
        row.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// =========================================================================================
// 5. The rest of what a caller controls
// =========================================================================================

describe('the fields a caller fills in', () => {
  it('refuses an emergency contact number with no digits in it', async () => {
    // The field exists so somebody can be rung from the side of a course.
    expect(
      await refusalFor(OPEN, { entrants: [entrant({ emergency_contact_phone: '-' })] }),
    ).toBe('invalid_entrants');
  });

  it('accepts a real number however it is punctuated', async () => {
    // Digits are counted rather than the string matched, so spaces, brackets, dashes and a
    // leading `+` are all fine. A form that refuses one of those is wrong about the phone
    // number rather than the phone number being wrong.
    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ emergency_contact_phone: '+44 (0)7700 900123' })],
    });
  });

  it('refuses a purchaser email that is not an address', async () => {
    // `a@` satisfied the original `position('@' in …) > 1` and was stored.
    expect(await refusalFor(OPEN, { email: 'a@' })).toBe('invalid_entrants');
  });

  it('accepts an awkward but real address', async () => {
    // The pattern is strictly weaker than the `z.email()` the form applies, which is what
    // makes it safe: nothing it rejects could have got through the form.
    await acceptedPurchaseId(OPEN, { email: "o'brien+race@sub.example.co.uk" });
  });

  it('refuses a leg on a solo event', async () => {
    // `leg > 0` was the whole of the old rule, so leg 7 on a one-runner race was stored.
    expect(await refusalFor(OPEN, { entrants: [entrant({ leg: 7 })] })).toBe(
      'invalid_entrants',
    );
  });

  it('refuses a leg beyond the number of entrants a paired event takes', async () => {
    expect(
      await refusalFor(PAIR, {
        entrants: [entrant({ leg: 1 }), entrant({ leg: 3 })],
        medical: [null, null],
      }),
    ).toBe('invalid_entrants');
  });

  it('accepts the legs a paired event does take', async () => {
    await acceptedPurchaseId(PAIR, {
      entrants: [entrant({ leg: 1 }), entrant({ leg: 2 })],
      medical: [null, null],
    });
  });
});

// =========================================================================================
// 6. What did not change, restated so a later slice cannot quietly move it
// =========================================================================================

describe('what this slice deliberately left exactly as it was', () => {
  it('still prices from entries.fees and never from the caller', async () => {
    const id = await acceptedPurchaseId(OPEN, { feeCode: 'unaffiliated' });
    const row = await single<{ amount_pence: number; price_pence: number }>(
      `select p.amount_pence, f.price_pence
         from entries.entry_purchases p
         join entries.fees f on f.id = p.fee_id
        where p.id = $1`,
      [id],
    );
    expect(row.amount_pence).toBe(row.price_pence);
    expect(row.amount_pence).toBe(1700);
  });

  it('still writes a pending purchase with no payment against it', async () => {
    const id = await acceptedPurchaseId(OPEN);
    const row = await single<{
      status: string;
      paid_at: Date | null;
      stripe_checkout_session_id: string | null;
    }>(
      `select status, paid_at, stripe_checkout_session_id
         from entries.entry_purchases where id = $1`,
      [id],
    );

    expect(row.status).toBe('pending');
    expect(row.paid_at).toBeNull();
    expect(row.stripe_checkout_session_id).toBeNull();
  });

  it('still has no amount, status or Stripe reference among its arguments', async () => {
    // `PGRST202` is PostgREST saying no function of that name takes those arguments. It is the
    // signature doing the work, which is the strongest form this rule can take.
    const { error } = await anon.schema('entries').rpc('create_pending_purchase', {
      p_slug: OPEN,
      p_fee_code: 'unaffiliated',
      p_purchaser_name: 'Ada',
      p_purchaser_email: 'ada@example.com',
      p_entrants: [entrant()],
      p_medical: [null],
      p_consents: { entryTerms: true },
      p_amount_pence: 1,
      p_status: 'paid',
    } as never);

    expect(error?.code).toBe('PGRST202');
  });

  it('still refuses every table to the anon role, which is the assertion that outlives slices', async () => {
    // Restated here as a bypass attempt rather than left to `entries.test.ts` alone, because
    // this slice added three functions and two of them read tables holding a person.
    for (const table of ['entry_purchases', 'entrants', 'entrant_medical'] as const) {
      const { data, error } = await anon.schema('entries').from(table).select('*');
      expect(error?.code, `${table} was readable`).toBe('42501');
      expect(data).toBeNull();
    }
  });
});

// =========================================================================================
// 7. The locks themselves, read from the catalogue
// =========================================================================================

describe('the constraints and triggers, as the catalogue holds them', () => {
  it('added every check constraint NOT VALID, which is what makes the deploy safe', async () => {
    // **The point of `NOT VALID` is that it never scans the rows already there.** A validated
    // ADD CONSTRAINT reads the whole table and fails the migration if one row disagrees, which
    // on this platform fails the deploy for everything. Nobody here can see the production
    // rows, so none of these may be convalidated until somebody has looked.
    const rows = await query<{ conname: string; convalidated: boolean }>(
      `select c.conname, c.convalidated
         from pg_constraint c
         join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'entries'
          and c.conname in (
            'entry_purchases_consents_are_boolean',
            'entry_purchases_purchaser_email_shape',
            'entrants_date_of_birth_plausible',
            'entrants_emergency_phone_has_digits'
          )
        order by c.conname`,
    );

    expect(rows.map((row) => row.conname)).toEqual([
      'entrants_date_of_birth_plausible',
      'entrants_emergency_phone_has_digits',
      'entry_purchases_consents_are_boolean',
      'entry_purchases_purchaser_email_shape',
    ]);
    expect(rows.every((row) => row.convalidated === false)).toBe(true);
  });

  it('fires a trigger on each of the three tables a rule spans', async () => {
    const rows = await query<{ tgname: string; relname: string }>(
      `select t.tgname, c.relname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'entries' and not t.tgisinternal
        order by t.tgname`,
    );

    expect(rows).toEqual([
      // **The fourth is not a rule, and that is why it sorts first and reads oddly here.**
      // #73's outbox trigger enforces nothing — it records that the club owes somebody an
      // email, in the same transaction as the payment, refund or transfer that made it true.
      // It is in this list because the list is every non-internal trigger in the schema, and
      // a test that named only the rule triggers would stop noticing a fifth.
      { tgname: 'enqueue_entry_email_after_update', relname: 'entry_purchases' },
      { tgname: 'entrant_medical_needs_consent', relname: 'entrant_medical' },
      { tgname: 'entrants_obey_their_event', relname: 'entrants' },
      { tgname: 'entry_purchases_have_their_consents', relname: 'entry_purchases' },
    ]);
  });

  it('grants the four trigger functions to nobody at all', async () => {
    // They are reached only by the triggers that fire them. A grant would make them callable
    // with a key that is published in page source, and two of them read a person.
    //
    // **`enqueue_entry_email` is the fourth, and it is here for a different reason than the
    // other three.** It writes rather than reads: a caller who could reach it directly could
    // make the club email anybody, about an entry that does not exist, from the club's own
    // verified sending domain. Same treatment as `raise_attention`.
    const granted = await query(
      `select grantee from information_schema.routine_privileges
        where routine_schema = 'entries'
          and routine_name in (
            'assert_entrant_rules', 'assert_medical_consent', 'assert_purchase_consents',
            'enqueue_entry_email'
          )
          and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );

    expect(granted).toEqual([]);
  });

  it('pins the search_path on all three, as every definer function here must', async () => {
    // An unpinned search_path on a `security definer` function is the standard Postgres
    // escalation.
    const rows = await query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
          and p.proname in (
            'assert_entrant_rules', 'assert_medical_consent', 'assert_purchase_consents'
          )
        order by p.proname`,
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Postgres stores `set search_path = ''` as the two-character empty string, quotes and
      // all. Asserting the literal it really holds rather than the one the migration typed.
      expect(row.proconfig, `${row.proname} has an unpinned search_path`).toEqual([
        'search_path=""',
      ]);
    }
  });
});

// -----------------------------------------------------------------------------------------
// One runner, one place
// -----------------------------------------------------------------------------------------
/**
 * **The tenth rule, and the first one that a person is meant to meet.**
 *
 * The other nine on this page are bypasses: things `parseNnEntry` refuses that an anonymous
 * PostgREST caller could once write anyway. This one is different — the form has claimed
 * *"One entry per runner."* in prose since it was written, and until #115 that sentence was
 * the only place in this platform the rule existed. Not a constraint, not a trigger, not even
 * Zod. Somebody who already had a place could fill the form in again and take a second one out
 * of 250.
 *
 * So the bypass being attempted here is the ordinary one: entering twice.
 */
describe('one runner, one place', () => {
  it('refuses a second entry for the same runner, with that specific reason', async () => {
    const runner = entrant({ last_name: 'Twice' });

    await acceptedPurchaseId(OPEN, { entrants: [runner] });

    // **`already_entered`, and not `invalid_entrants`.** The distinction is the whole reason
    // the reason exists: one of them is a sentence the form can show somebody, and the other
    // is a defect. See `packages/shared/src/entry-purchase.ts`.
    expect(await refusalFor(OPEN, { entrants: [runner] })).toBe('already_entered');
  });

  it('is not fooled by a different email, because the purchaser is not the entrant', async () => {
    const runner = entrant({ last_name: 'Payer' });

    await acceptedPurchaseId(OPEN, { entrants: [runner], email: 'first@example.com' });

    // **The key is the runner, not the card.** Keying on `purchaser_email` would have let this
    // through — and would separately have refused a partner paying for a partner, which is the
    // failure direction that costs somebody a place.
    expect(
      await refusalFor(OPEN, { entrants: [runner], email: 'second@example.com' }),
    ).toBe('already_entered');
  });

  it('is not fooled by the case or the spacing of a name', async () => {
    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ first_name: 'Ada', last_name: 'Casefold' })],
    });

    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ first_name: '  ADA ', last_name: 'casefold  ' })],
      }),
    ).toBe('already_entered');
  });

  it('lets a different runner enter, which is the case that must not break', async () => {
    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ first_name: 'Ada', last_name: 'Distinct' })],
    });

    // **The expensive failure is the false positive**, not the false negative: refusing a real
    // runner at the moment they are paying. A shared surname, a shared first name and a shared
    // birthday are each fine on their own.
    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ first_name: 'Grace', last_name: 'Distinct' })],
    });

    await acceptedPurchaseId(OPEN, {
      entrants: [
        entrant({
          first_name: 'Ada',
          last_name: 'Distinct',
          date_of_birth: '1991-02-03',
        }),
      ],
    });
  });

  it('lets a runner enter again once the first hold has lapsed', async () => {
    const runner = entrant({ last_name: 'Lapsed' });
    const purchaseId = await acceptedPurchaseId(OPEN, { entrants: [runner] });

    // A hold that ran out released its place, so the person it belonged to must be able to try
    // again. Anything stricter strands somebody whose payment failed halfway.
    await query(
      `update entries.entry_purchases set hold_expires_at = now() - interval '1 minute'
        where id = $1`,
      [purchaseId],
    );

    await acceptedPurchaseId(OPEN, { entrants: [runner] });
  });
});
