import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

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
 * **That particular rule is gone**, because on 29 August 2026 the club stopped asking for the
 * number at all — see section 1 below, which now tests the opposite thing by the same method.
 * The method is what this file is for and it is unchanged.
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
    `insert into entries.fees (event_id, code, label, price_pence, affiliated)
     values ($1, 'affiliated', 'Affiliated', 1500, true),
            ($1, 'unaffiliated', 'Unaffiliated', 1700, false)`,
    [event.id],
  );

  return event.id;
}

beforeAll(async () => {
  // **Holding a place takes the entry key since ADR-029**, and the digest ships null —
  // which refuses everything. Installing it is what makes this file's fixtures able to
  // hold a place at all; without it every call below answers `unauthorised`. Issue #178.
  await installEntryKey(db);
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
  /** Where a non-binary entrant's result counts, if anywhere. Only ever meaningful alongside
   *  `gender: 'non_binary'` — see ADR-031. */
  result_placement?: string | null;
  /** The open question beside it. Optional, free text, on no list. See ADR-020. */
  gender_identity?: string | null;
  club?: string | null;
  /** **Not a field anybody is asked for.** Kept so a test can post one and prove it is
   *  refused — this file's whole method is attempting the bypass, and `create_pending_purchase`
   *  is granted to `anon`. See section 1. */
  ea_number?: string | null;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  /** The runner's own number — required of a runner since ADR-025, and refused with
   *  `phone_required`. Distinct from the emergency contact's above, which is somebody else's
   *  number given for one thing. */
  phone?: string | null;
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

/** The same counter idea for the purchaser's address, and see `create()` for why it exists. */
let purchaserSerial = 0;

function entrant(overrides: EntrantOverrides = {}): Record<string, unknown> {
  return {
    first_name: 'Ada',
    last_name: `O'Brien-${(entrantSerial += 1)}`,
    date_of_birth: '1990-01-01',
    gender: 'female',
    club: null,
    emergency_contact_name: 'Mary Somerville',
    emergency_contact_phone: '07700 900123',
    // The runner's own number, which `create_pending_purchase()` has required of a
    // runner since ADR-025 and refuses with `phone_required` without. Deliberately not
    // the emergency contact's: a fixture where the two agree cannot catch the two being
    // read the wrong way round.
    phone: '07700 900124',
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
    p_key: ENTRY_KEY,
    p_slug: slug,
    p_fee_code: options.feeCode ?? 'unaffiliated',
    p_purchaser_name: 'Ada O’Brien',
    // **A serial on the address, for the reason the surname above carries one.** One place
    // per email is a database rule since 30 August 2026, so a suite whose purchasers are all
    // `ada@example.com` cannot hold two places on one event — every second call would be
    // refused with `email_already_entered`, on a rule the test was not written to exercise.
    // The tests that *are* about that rule pass `email` explicitly.
    p_purchaser_email: options.email ?? `ada-${(purchaserSerial += 1)}@example.com`,
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
// 1. The England Athletics number — the rule that prompted the slice, and the rule that ended
// =========================================================================================
// **This section used to assert the number was required, and it now asserts it cannot exist.**
// The club decided on 29 August 2026 to stop asking for and holding England Athletics numbers:
// a runner states that they are affiliated and the club takes their word for it. Under ARC
// Rule 21(2)(b) that leaves no record of *who* claimed affiliation, only that they paid the
// affiliated £18, and the committee accepted it. The privacy notice reserves the club's right
// to ask somebody to produce a number instead.
//
// The tests are inverted rather than deleted, because the bypass they attempt is the same one:
// `create_pending_purchase()` is granted to `anon`, so "the form has no box" says nothing. What
// has to be true is that a number posted straight at PostgREST with the published key reaches
// no column.

describe('the England Athletics number, which is no longer asked for or held', () => {
  it('accepts an affiliated entry with no number, which used to be the refusal', async () => {
    // The exact submission that answered `ea_number_required` before the decision. Refusing it
    // is the defect now — the affiliated price is sold on a runner's word.
    // `acceptedPurchaseId` fails loudly on any refusal, which is the assertion.
    expect(await acceptedPurchaseId(OPEN, { feeCode: 'affiliated' })).toBeTruthy();
  });

  it('drops a number posted at the affiliated fee, and stores nothing', async () => {
    // **The affiliated fee, because it is the one that used to keep the value.** Accepted
    // rather than refused, which is the same minimisation the boundary has always applied —
    // and then the column is read back, because "the call succeeded" would pass just as well
    // on a call that wrote it.
    const id = await acceptedPurchaseId(OPEN, {
      feeCode: 'affiliated',
      entrants: [entrant({ ea_number: '1234567' })],
    });

    const row = await single<{ ea_number: string | null }>(
      'select ea_number from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.ea_number).toBeNull();
  });

  it('drops one posted at the unaffiliated fee too', async () => {
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
    // **The constraint, tested directly**, standing in for every write path that is not
    // `create_pending_purchase` — which is what the function's own dropping cannot cover. It is
    // a check constraint rather than the trigger's biconditional precisely so that suppressing
    // triggers does not open it; `entries-admin.test.ts` asserts that half.
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

  it('refuses a fee that says it requires one', async () => {
    // The other half, and it is what stops the first half being re-opened by a migration
    // nobody read twice: a fee marked `requires_ea_number` would demand a number that
    // `entrants_ea_number_not_collected` forbids, so it would be a fee nobody could enter on.
    await expect(
      query(
        `update entries.fees set requires_ea_number = true
          where event_id = (select id from entries.events where slug = $1)`,
        [OPEN],
      ),
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

describe('where a non-binary entrant’s result should be placed — ADR-031', () => {
  // **Same method as the gender tests above: attempt the bypass with the anon key.** Zod
  // validates the form; `entrants_result_placement_only_non_binary` and
  // `entrants_result_placement_shaped` are what refuse a crafted payload that never met it.

  it('stores the chosen placement for a non-binary entrant', async () => {
    const id = await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ gender: 'non_binary', result_placement: 'female' })],
    });

    const row = await single<{ gender: string; result_placement: string | null }>(
      'select gender, result_placement from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.gender).toBe('non_binary');
    expect(row.result_placement).toBe('female');
  });

  it('stores null for a non-binary entrant who chose neither', async () => {
    const id = await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ gender: 'non_binary', result_placement: null })],
    });

    const row = await single<{ result_placement: string | null }>(
      'select result_placement from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.result_placement).toBeNull();
  });

  it('accepts an entry that never mentions the key at all', async () => {
    // **The expand step, asserted, the same way `gender_identity` above already is.** A
    // Worker deployed before this migration sends a payload with no `result_placement` in
    // it, and that has to keep working and mean "not placed" for a non-binary entrant.
    const id = await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ gender: 'non_binary' })],
    });

    const row = await single<{ result_placement: string | null }>(
      'select result_placement from entries.entrants where purchase_id = $1',
      [id],
    );
    expect(row.result_placement).toBeNull();
  });

  it('refuses a placement given for a female or male entrant, by table constraint', async () => {
    // **`entrants_result_placement_only_non_binary`, reached through the function's own
    // handler.** The form never offers this question to a female or male entrant; this is
    // the backstop for a payload that named one anyway.
    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ gender: 'female', result_placement: 'male' })],
      }),
    ).toBe('invalid_entrants');
  });

  it('refuses a placement that is not one of the two categories', async () => {
    // `entrants_result_placement_shaped` — the same "closed list, checked at the boundary"
    // discipline `gender`'s own inline check already has.
    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ gender: 'non_binary', result_placement: 'non_binary' })],
      }),
    ).toBe('invalid_entrants');
  });

  // **The transfer-clears-it test lives in `entries-transfer-and-requests.test.ts`**, where
  // the authenticated client this rule needs already exists — this file's whole method is
  // the anonymous bypass, and `transfer_entry()` is granted to `authenticated`, never `anon`.
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

  it('refuses a runner with no phone number of their own', async () => {
    // **The eighteenth field, and the bypass it has to survive** — ADR-025, argued in #168.
    // `parseNnEntry` requires it, and Zod is the form's control rather than the system's: this
    // function is granted to `anon` and reachable through PostgREST with the key published in
    // the page source, so the form having a required box is not an answer on its own.
    //
    // **Refused by name rather than as `invalid_entrants`.** A log line saying `phone_required`
    // says the form and the database disagree about what is asked; one saying
    // `invalid_entrants` says something, somewhere, in the entrant block.
    const { phone: _dropped, ...noPhone } = entrant();
    expect(await refusalFor(OPEN, { entrants: [noPhone] })).toBe('phone_required');

    // An empty box and a box of spaces are the same answer as no key at all — an untouched
    // text input posts `''`, and a browser is happy with three spaces.
    expect(await refusalFor(OPEN, { entrants: [entrant({ phone: '' })] })).toBe(
      'phone_required',
    );
    expect(await refusalFor(OPEN, { entrants: [entrant({ phone: '   ' })] })).toBe(
      'phone_required',
    );
  });

  it("stores the runner's number apart from the emergency contact's", async () => {
    // **The silent failure this guards.** Two numbers of the same shape mapped onto each other
    // produce a valid entry, a valid start list, and a volunteer ringing somebody's next of kin
    // about a start time. Nothing about the row would look wrong.
    const purchaseId = await acceptedPurchaseId(OPEN, {
      entrants: [
        entrant({ phone: '0117 496 0100', emergency_contact_phone: '0117 496 0000' }),
      ],
    });

    const rows = await query<{ phone: string; emergency_contact_phone: string }>(
      'select phone, emergency_contact_phone from entries.entrants where purchase_id = $1',
      [purchaseId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone).toBe('0117 496 0100');
    expect(rows[0]!.emergency_contact_phone).toBe('0117 496 0000');
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
      p_key: ENTRY_KEY,
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

  it('will not hold a place for the published key alone, which is what #178 was', async () => {
    // **The bypass this file exists for, and the one that could have taken race day down.**
    // `create_pending_purchase()` is granted to anon and must stay granted — a signed-out
    // runner reaches PostgREST as anon — and it holds a place *before* any money moves, with
    // a live hold counting against the 250. So until 31 August 2026 this loop, with nothing
    // but the key printed in every page's source, took the whole field in half a second for
    // nothing: measured at 249 holds in 0.5s, and the next real runner refused `sold_out`.
    // Cloudflare's rate-limiting rule never saw it, because PostgREST is not the Worker.
    //
    // **Asserted as the specific refusal, not merely as a failure.** A broken function refuses
    // everything, which reads as every rule holding at once — the house rule this whole file
    // is written under. `unauthorised` is the key check and nothing else. ADR-029.
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        anon.schema('entries').rpc('create_pending_purchase', {
          p_slug: OPEN,
          p_fee_code: 'unaffiliated',
          p_purchaser_name: `Flood ${n}`,
          p_purchaser_email: `flood${n}@example.com`,
          // The serial on the surname is `entrant()`'s own, and it is what lets five
          // submissions be five different people — one runner, one place is keyed on name
          // and date of birth, so five identical fixtures could not all be held even if the
          // key were right, and the test would pass for the wrong reason.
          p_entrants: [entrant()],
          p_medical: [null],
          p_consents: { entryTerms: true },
        }),
      ),
    );

    for (const { data, error } of attempts) {
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
    }

    // **And nothing was held**, which is the half that matters. A refusal that still consumed
    // a place would be the same denial of service wearing a different answer.
    const [held] = await query<{ count: string }>(
      `select count(*) as count
         from entries.entry_purchases as purchase
         join entries.events as event on event.id = purchase.event_id
        where event.slug = $1 and purchase.purchaser_email like 'flood%@example.com'`,
      [OPEN],
    );

    expect(held?.count).toBe('0');
  });

  it('will not hold a place for a wrong key either, and says the same thing', async () => {
    // **A wrong key and no key answer identically**, so the response cannot be used to learn
    // whether a digest is installed at all.
    const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
      p_key: `${ENTRY_KEY}-wrong`,
      p_slug: OPEN,
      p_fee_code: 'unaffiliated',
      p_purchaser_name: 'Ada',
      p_purchaser_email: 'ada-wrong-key@example.com',
      p_entrants: [entrant()],
      p_medical: [null],
      p_consents: { entryTerms: true },
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('refuses the key before it discloses anything else about the event', async () => {
    // **Ordering, asserted.** The key is checked before the slug is looked up, so a caller
    // without one cannot use this function to find out which events exist, whether entries
    // are open, or how many places are left. A slug nobody created still answers
    // `unauthorised` rather than `no_such_event`.
    const { data } = await anon.schema('entries').rpc('create_pending_purchase', {
      p_slug: 'zz-no-such-event-at-all',
      p_fee_code: 'unaffiliated',
      p_purchaser_name: 'Ada',
      p_purchaser_email: 'ada-probe@example.com',
      p_entrants: [entrant()],
      p_medical: [null],
      p_consents: { entryTerms: true },
    });

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('refuses every hold while the digest is null, which is the state it ships in', async () => {
    // **The safe direction, and the one design decision here that could have gone the other
    // way.** Treating a null digest as "not armed yet, allow" would have kept the deployed
    // Worker working through the deploy — and left #178 open on any day somebody forgot the
    // secret, with a forgotten install looking exactly like a working one. Everything in this
    // repository fails towards taking no money, so a null digest refuses everything.
    //
    // **Inside a transaction that rolls back**, because the files in this run share one
    // database: clearing the row outright would take the door out from under whatever else is
    // mid-fixture. The row lock makes any concurrent installer wait rather than see this.
    // Called through the privileged connection rather than PostgREST for the same reason —
    // an HTTP call could not join this transaction.
    await query('begin');
    try {
      await query(
        `update entries.webhook_secrets set key_sha256 = null where name = 'entry'`,
      );

      const rows = await query<{ result: { ok: boolean; reason?: string } }>(
        `select entries.create_pending_purchase(
           $1, 'unaffiliated', 'Ada', 'null-digest@example.com',
           $2::jsonb, null, $3::jsonb, p_key => $4
         ) as result`,
        [
          OPEN,
          JSON.stringify([entrant()]),
          JSON.stringify({ entryTerms: true }),
          ENTRY_KEY,
        ],
      );

      // **The correct key, and it is still refused** — which is the whole assertion. Nothing
      // a caller presents can matter while the club has installed nothing to compare it to.
      expect(rows[0]?.result).toEqual({ ok: false, reason: 'unauthorised' });
    } finally {
      await query('rollback');
    }
  });

  it('will not hold a place that costs nothing, whatever the key', async () => {
    // **The other half of #178, and the rule that was only ever in TypeScript.** The Worker
    // refuses a £0 fee before it calls, so a caller that never meets the Worker never met the
    // rule — and a free place is one Stripe cannot take a payment for, so it could only ever
    // sit out of the 250 until it lapsed. Now the database refuses it too, before writing.
    //
    // **`vi_guide` deliberately keeps its price and its place in `entry_state()`** — the fee
    // was not gated, because a gate would close nothing the key does not and would retire the
    // Worker's own free-place backstop with it. See ADR-029.
    //
    // `makeEvent` builds the two fees every other test here needs, so the free one is made
    // where it is used rather than given to every fabricated event — a £0 fee on all of them
    // would change what `entry_state()` returns for tests that have nothing to do with this.
    await query(
      `insert into entries.fees (event_id, code, label, price_pence, affiliated)
       select event.id, 'vi_guide', 'VI guide', 0, false
         from entries.events as event
        where event.slug = $1
       on conflict (event_id, code) do nothing`,
      [OPEN],
    );

    const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
      p_key: ENTRY_KEY,
      p_slug: OPEN,
      p_fee_code: 'vi_guide',
      p_purchaser_name: 'Grace Hopper',
      p_purchaser_email: 'free-place@example.com',
      p_entrants: [entrant()],
      p_medical: [null],
      p_consents: { entryTerms: true },
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, reason: 'free_place' });
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

  it('fires a trigger on each of the three tables a rule spans, and lists the rest', async () => {
    const rows = await query<{ tgname: string; relname: string }>(
      `select t.tgname, c.relname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'entries' and not t.tgisinternal
        order by t.tgname`,
    );

    expect(rows).toEqual([
      // **Four of these seven are not rules, and that is why they read oddly here.**
      //
      // #73's outbox trigger enforces nothing — it records that the club owes somebody an
      // email, in the same transaction as the payment, refund or transfer that made it true.
      //
      // **And it is two triggers rather than one, since #150.** The `after update` half fires
      // on the transition into `paid`, which is right for a place that is held and then paid
      // for — and never fires for a complimentary place, which `create_manual_entry()`
      // *inserts* already `paid`. So a place the club gave away was never confirmed to
      // anybody. The insert half is guarded on `new.status = 'paid'` and shares the update
      // path's dedupe key, so no place can be confirmed twice.
      { tgname: 'enqueue_entry_email_after_insert', relname: 'entry_purchases' },
      { tgname: 'enqueue_entry_email_after_update', relname: 'entry_purchases' },
      { tgname: 'entrant_medical_needs_consent', relname: 'entrant_medical' },
      { tgname: 'entrants_obey_their_event', relname: 'entrants' },
      // ADR-030's, and it enforces nothing either: it issues the per-event number the printed
      // reference is built from, `before insert` so the value is in the row that is written.
      // A trigger rather than a line in `create_pending_purchase()` and another in
      // `create_manual_entry()`, because a third writer would silently leave a null and a
      // reference is not a thing a page may render half of.
      { tgname: 'entry_purchases_assign_number', relname: 'entry_purchases' },
      { tgname: 'entry_purchases_have_their_consents', relname: 'entry_purchases' },
      // ADR-024's, and it enforces nothing either: it closes every outstanding row in
      // `entries.entry_requests` at the moment a volunteer deals with the entry. A trigger
      // rather than two edits, so `cancel_entry()` and `transfer_entry()` need no change and
      // any future path that resolves a request is covered by the same rule.
      { tgname: 'resolve_entry_requests_after_update', relname: 'entry_purchases' },
    ]);
    // **They are all here because the list is every non-internal trigger in the schema**, not
    // only the rule ones — a test that named the rules alone would stop noticing an eighth. It
    // caught #150's insert trigger, and it caught ADR-030's number trigger, which is the same
    // job working a third time.
  });

  it('grants the seven trigger functions to nobody at all', async () => {
    // They are reached only by the triggers that fire them. A grant would make them callable
    // with a key that is published in page source, and two of them read a person.
    //
    // **The two `enqueue_entry_email` functions and `resolve_entry_requests` are here for a
    // different reason than the other three.** They write rather than read. A caller who could
    // reach either of the first two directly could make the club email anybody, about an entry
    // that does not exist, from the club's own verified sending domain; one who could reach the
    // third could mark somebody else's outstanding cancellation as dealt with, which is how an
    // ask quietly stops being one. Same treatment as `raise_attention`.
    const granted = await query(
      `select grantee from information_schema.routine_privileges
        where routine_schema = 'entries'
          and routine_name in (
            'assert_entrant_rules', 'assert_medical_consent', 'assert_purchase_consents',
            'assign_entry_number', 'enqueue_entry_email', 'enqueue_entry_email_on_insert',
            'resolve_entry_requests'
          )
          and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );

    expect(granted).toEqual([]);
  });

  it('pins the search_path on every trigger function, as every definer function here must', async () => {
    // An unpinned search_path on a `security definer` function is the standard Postgres
    // escalation. **Asked of all seven rather than of the three rule triggers**, because the
    // property is about being a definer function and has nothing to do with enforcing a rule.
    const rows = await query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries'
          and p.proname in (
            'assert_entrant_rules', 'assert_medical_consent', 'assert_purchase_consents',
            'assign_entry_number', 'enqueue_entry_email', 'enqueue_entry_email_on_insert',
            'resolve_entry_requests'
          )
        order by p.proname`,
    );

    expect(rows).toHaveLength(7);
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
/**
 * One place per email address — `20260830160000_entries_one_place_per_email.sql`.
 *
 * **A second rule beside the one below, and it reverses that migration's own reasoning.**
 * `20260827090000` said the address was the wrong key because a card legitimately pays for a
 * partner; the club overruled that on 30 August 2026 and accepted the cost. So what is
 * asserted here is a rule that deliberately refuses somebody a place, and the tests say so
 * rather than pretending the trade does not exist.
 *
 * The negative cases matter as much as the positive ones: a lapsed hold and a refunded entry
 * must both let an address try again, or somebody whose payment never completed is locked out
 * of the race permanently on the strength of an attempt that took no money.
 */
describe('one place per email address', () => {
  it('refuses a second entry from the same address, with its own reason', async () => {
    await acceptedPurchaseId(OPEN, { email: 'shared@example.com' });

    // **`email_already_entered`, not `already_entered`.** A different runner entirely — the
    // name rule below is not what is firing here, and the two reasons are different sentences
    // to the person reading them.
    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ first_name: 'Grace', last_name: 'Hopper-Shared' })],
        email: 'shared@example.com',
      }),
    ).toBe('email_already_entered');
  });

  it('is not fooled by the case of an address', async () => {
    // ⚠️ **This is the test that caught the rule being case-sensitive, and it is worth saying
    // how.** `purchaser_email` is `citext`, so the obvious way to write the check is `=` and
    // let the type do the work. It does not: the function runs `set search_path = ''`, the
    // `citext` equality operator lives in `extensions`, and Postgres resolves the comparison
    // to plain **text** equality without raising anything at all. `Mark@example.com` and
    // `mark@example.com` were two addresses and each got a place.
    //
    // The test above passes under both spellings, because both its addresses are
    // byte-identical — which is exactly why asserting only the obvious case is not enough.
    await acceptedPurchaseId(OPEN, { email: 'MixedCase@example.com' });

    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ last_name: 'Casefolded-Email' })],
        email: 'mixedcase@example.com',
      }),
    ).toBe('email_already_entered');
  });

  it('answers a padded address in words rather than as a bad entrant', async () => {
    // **Whitespace never reaches a stored address** — `entry_purchases_purchaser_email_shape`
    // refuses it — so without the trim in the check a padded resubmission would sail past this
    // rule and be refused by that constraint instead, arriving as `invalid_entrants`: "there is
    // something wrong with the entrant block", about the email box, to somebody who has simply
    // pasted an address with a space on the end.
    await acceptedPurchaseId(OPEN, { email: 'padded@example.com' });

    expect(
      await refusalFor(OPEN, {
        entrants: [entrant({ last_name: 'Padded-Email' })],
        email: '  padded@example.com  ',
      }),
    ).toBe('email_already_entered');
  });

  it('lets a different address enter, which is the case that must not break', async () => {
    await acceptedPurchaseId(OPEN, { email: 'first-of-two@example.com' });

    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ last_name: 'SecondAddress' })],
      email: 'second-of-two@example.com',
    });
  });

  it('lets an address enter again once its hold has lapsed', async () => {
    // **The place went back into the pool, so the address has to be free with it.** Anything
    // stricter strands somebody permanently on the strength of a payment that never happened —
    // and this is the ordinary case of a Stripe page abandoned or timed out.
    const purchaseId = await acceptedPurchaseId(OPEN, { email: 'lapsed@example.com' });

    await query(
      `update entries.entry_purchases
          set hold_expires_at = now() - interval '1 minute'
        where id = $1`,
      [purchaseId],
    );

    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ last_name: 'AfterLapse' })],
      email: 'lapsed@example.com',
    });
  });

  it('lets an address enter again after its entry was refunded', async () => {
    // The club cancelled it and gave the money back. Refusing them a fresh entry would be the
    // platform holding a cancellation against somebody for the rest of the year.
    const purchaseId = await acceptedPurchaseId(OPEN, { email: 'refunded@example.com' });

    await query(`update entries.entry_purchases set status = 'refunded' where id = $1`, [
      purchaseId,
    ]);

    await acceptedPurchaseId(OPEN, {
      entrants: [entrant({ last_name: 'AfterRefund' })],
      email: 'refunded@example.com',
    });
  });
});

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

    // **The key is the runner, not the card**, and this rule is still keyed that way — which
    // is what this asserts. Two addresses, one runner, refused on the *name*.
    //
    // The second half of this comment used to say that keying on `purchaser_email` would
    // refuse a partner paying for a partner, and that the club would not do that. **The club
    // did**, on 30 August 2026 — see the describe above. The reasoning was not wrong and it
    // was overruled; both rules now run, and this test proves the older one still fires on its
    // own terms rather than being shadowed by the newer.
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
