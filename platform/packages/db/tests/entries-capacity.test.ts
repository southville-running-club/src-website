import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { ENTRY_KEY, installEntryKey } from './entry-key';

/**
 * `entries.create_pending_purchase()` — capacity, price, consent, and the race that matters.
 *
 * ## Why this file exists at all
 *
 * 250 places, and Nightingale Nightmare sold out in 2023. **Two people pressing the button in
 * the same second must not both get the last place**, and "we take a lock" is a claim about
 * concurrency that only a concurrent test can support. Everything else here is important;
 * this is the part that would cost the club a runner turning up to a race with no number.
 *
 * ## The fixtures are fabricated events, not the real one
 *
 * Every test below runs against a `zz-cap-*` event it created, so nothing here can collide
 * with `entries.test.ts`, with the acceptance suite, or with a laptop somebody has left
 * `./dev up` running on. The advisory lock is taken per event id, so fabricated events do not
 * contend with each other either — which is what lets this file run its tests in the ordinary
 * order rather than in a carefully arranged one.
 *
 * The privileged connection is the local Docker Postgres and nothing else. Its credentials
 * are the fixed ones `supabase start` prints on every machine, and there is no version of
 * this file that talks to production.
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

/** Every fabricated event this file makes. Removed wholesale in `afterAll`. */
const FIXTURE_PREFIX = 'zz-cap-';

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await connected;
  const { rows } = await db.query(sql, values);
  return rows as T[];
}

/**
 * Remove the fabricated events and everything hanging off them.
 *
 * Purchases first: `entry_purchases.event_id` has **no** cascade, deliberately — an event
 * with money taken against it is not something to delete by removing its parent row, and the
 * restriction is the reminder. Entrants and medical notes do cascade from the purchase, which
 * is the retention story the schema was built around.
 */
async function removeFixtures(): Promise<void> {
  await query(
    `delete from entries.entry_purchases
      where event_id in (select id from entries.events where slug like $1)`,
    [`${FIXTURE_PREFIX}%`],
  );
  await query('delete from entries.events where slug like $1', [`${FIXTURE_PREFIX}%`]);
}

// **Holding a place takes the entry key since ADR-029**, and the digest ships null —
// which refuses everything. Installed once rather than per test: it is a property of the
// database this file talks to, not of any one fixture. Issue #178.
beforeAll(async () => {
  await connected;
  await installEntryKey(db);
});

beforeEach(removeFixtures);

afterAll(async () => {
  await removeFixtures();
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Fixtures — deterministic, invented, and awkward where it matters
// -----------------------------------------------------------------------------------------

interface EventOptions {
  capacity?: number;
  entrantsPerEntry?: number;
  minimumAge?: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
  active?: boolean;
}

/** One fabricated event with one fee — `unaffiliated`, £17, the price the real race charges. */
async function seedEvent(slug: string, options: EventOptions = {}): Promise<string> {
  const {
    capacity = 1,
    entrantsPerEntry = 1,
    minimumAge = 18,
    opensAt = '2020-01-01T00:00:00Z',
    closesAt = '2030-01-01T00:00:00Z',
    active = true,
  } = options;

  const rows = await query<{ id: string }>(
    // `race_slug` is a fixture race and never `nn` — a fixture claiming to be a running of
    // the real race would change what `entries.current_entry_state('nn')` answers, and the
    // site's front door reads that on every request.
    `insert into entries.events (
       slug, display_name, race_slug, event_date, start_time, entrants_per_entry, capacity,
       entries_open_at, entries_close_at, minimum_age, from_address, consent_version, active
     ) values ($1, $2, 'zz-fixture', date '2026-11-01', time '11:00', $3, $4, $5, $6, $7,
               'fixture@example.com', 'fixture-v1', $8)
     returning id`,
    [
      slug,
      `Fixture ${slug}`,
      entrantsPerEntry,
      capacity,
      opensAt,
      closesAt,
      minimumAge,
      active,
    ],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     values ($1, 'unaffiliated', 'Unaffiliated', 1700)`,
    [rows[0]!.id],
  );

  return rows[0]!.id;
}

/**
 * One runner. Born 9 December 1986, which is forty on race day and comfortably clear of the
 * minimum — the awkward ages are asked for explicitly by the tests that want them.
 */
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

function entrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    first_name: 'Grace',
    last_name: `O'Sullivan-${(entrantSerial += 1)}`,
    date_of_birth: '1986-12-09',
    gender: 'female',
    club: null,
    emergency_contact_name: 'Margaret Hamilton',
    emergency_contact_phone: '0117 496 0000',
    // The runner's own number, which `create_pending_purchase()` has required of a
    // runner since ADR-025 and refuses with `phone_required` without. Deliberately not
    // the emergency contact's: a fixture where the two agree cannot catch the two being
    // read the wrong way round.
    phone: '0117 496 0100',
    ...overrides,
  };
}

interface Refused {
  ok: false;
  reason: string;
}
interface Created {
  ok: true;
  purchase_id: string;
  amount_pence: number;
  fee_label: string;
  hold_expires_at: string;
}
type Result = Created | Refused;

interface CallOptions {
  entrants?: Record<string, unknown>[];
  medical?: (string | null)[] | null;
  consents?: Record<string, unknown>;
  feeCode?: string;
  discountCode?: string | null;
  email?: string;
}

/**
 * Call the function on a given connection.
 *
 * **jsonb arguments are stringified rather than passed as objects.** `pg` turns a JavaScript
 * array into a *Postgres array*, not into a JSON array, so `p_entrants` would arrive as
 * something `jsonb_array_length` cannot read. The `::jsonb` casts are what make the argument
 * types unambiguous to the parser as well.
 */
/** Keeps each default purchaser address distinct — see `call()`'s `email` default. */
let purchaserSerial = 0;

function call(client: Client, slug: string, options: CallOptions = {}): Promise<Result> {
  const {
    entrants = [entrant()],
    medical = null,
    consents = { entryTerms: true, medical: false },
    feeCode = 'unaffiliated',
    discountCode = null,
    // **A serial, because one place per email is a database rule since 30 August 2026.**
    // Several tests here enter the same event more than once on purpose — filling a capacity,
    // spending a discount code's allocation — and a fixture whose purchasers are all
    // `fixture@example.com` cannot do that any more: everything after the first is refused
    // with `email_already_entered`, on a rule the test was not written to exercise. The tests
    // that are *about* an address pass `email` themselves.
    email = `fixture-${(purchaserSerial += 1)}@example.com`,
  } = options;

  return client
    .query<{ result: Result }>(
      // **`p_key` by name, after the positional arguments.** It is the tenth parameter, past
      // `p_preview`, so a positional call would have to state a preview flag it does not care
      // about in order to reach it. Named notation says what this is instead of counting
      // commas — and the next parameter added cannot silently shift it. ADR-029.
      `select entries.create_pending_purchase(
         $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, p_key => $9
       ) as result`,
      [
        slug,
        feeCode,
        'Grace O’Sullivan',
        email,
        JSON.stringify(entrants),
        medical === null ? null : JSON.stringify(medical),
        JSON.stringify(consents),
        discountCode,
        ENTRY_KEY,
      ],
    )
    .then(({ rows }) => rows[0]!.result);
}

const enter = (slug: string, options: CallOptions = {}): Promise<Result> =>
  connected.then(() => call(db, slug, options));

// -----------------------------------------------------------------------------------------
// The race for the last place
// -----------------------------------------------------------------------------------------

describe('two people going for the last place at the same moment', () => {
  /**
   * Fire `attempts` calls at one event from `attempts` **separate connections**, all in
   * flight before any of them returns.
   *
   * Each call is a single statement, so it is its own implicit transaction and the advisory
   * lock is released when it commits — no explicit `begin`/`commit` to sequence, and no way
   * for the test to deadlock itself by holding a lock while waiting on the other side.
   */
  async function race(slug: string, attempts: number): Promise<Result[]> {
    const clients = Array.from(
      { length: attempts },
      () => new Client({ connectionString: LOCAL_DB }),
    );

    await Promise.all(clients.map((client) => client.connect()));

    try {
      return await Promise.all(
        clients.map((client, index) =>
          call(client, slug, { email: `racer-${index}@example.com` }),
        ),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }

  it('gives it to exactly one of them, and tells the other the race is full', async () => {
    // **The assertion this whole slice is built around.** Without the advisory lock both
    // transactions read "0 of 1 taken", both decide there is room, and both insert.
    await seedEvent(`${FIXTURE_PREFIX}two`, { capacity: 1 });

    const results = await race(`${FIXTURE_PREFIX}two`, 2);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: 'sold_out' },
    ]);
  });

  it('holds the line with eight of them, and writes exactly one row', async () => {
    // Two connections can serialise by luck on a fast machine. Eight cannot, and the row
    // count is the assertion that does not depend on how the results were shaped.
    await seedEvent(`${FIXTURE_PREFIX}eight`, { capacity: 1 });

    const results = await race(`${FIXTURE_PREFIX}eight`, 8);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok).map((result) => (result as Refused).reason),
    ).toEqual(Array(7).fill('sold_out'));

    const rows = await query(
      `select 1 from entries.entry_purchases p
         join entries.events e on e.id = p.event_id
        where e.slug = $1`,
      [`${FIXTURE_PREFIX}eight`],
    );
    expect(rows).toHaveLength(1);
  });

  it('fills the last two places of a larger field and refuses the third', async () => {
    // Capacity 3 with one place already gone, so the winners are decided by the count rather
    // than by "is this the very first row".
    await seedEvent(`${FIXTURE_PREFIX}three`, { capacity: 3 });
    await enter(`${FIXTURE_PREFIX}three`);

    const results = await race(`${FIXTURE_PREFIX}three`, 5);

    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toHaveLength(3);
  });

  /**
   * **The control, and it is not padding.**
   *
   * A concurrency test that never actually overlaps passes for the wrong reason and keeps
   * passing after somebody removes the lock. This runs the same shape of work — read the
   * count, pause, insert if there is room — from JavaScript with **no lock at all**, and
   * asserts that it *does* oversell. If this ever stops overselling, the harness has stopped
   * generating contention and every assertion above has quietly stopped testing.
   */
  it('would oversell without the lock, which is what proves the contention is real', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}control`, { capacity: 1 });

    async function checkThenInsert(email: string): Promise<void> {
      const client = new Client({ connectionString: LOCAL_DB });
      await client.connect();

      try {
        const { rows } = await client.query<{ taken: number }>(
          `select count(*)::int as taken
             from entries.entry_purchases p
             join entries.entrants e on e.purchase_id = p.id
            where p.event_id = $1 and p.status in ('paid', 'pending')`,
          [eventId],
        );

        // The window between deciding and acting, made wide enough to be certain rather than
        // likely. The real function closes this window with a lock; this one leaves it open.
        await new Promise((resolve) => setTimeout(resolve, 150));

        if (rows[0]!.taken >= 1) {
          return;
        }

        const purchase = await client.query<{ id: string }>(
          `insert into entries.entry_purchases (
             event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
             consents, consent_version, hold_expires_at
           )
           select $1, 'pending', 1700, f.id, $2, 'Control', '{"entryTerms":true}'::jsonb,
                  'fixture-v1', now() + interval '31 minutes'
             from entries.fees f
            where f.event_id = $1 and f.code = 'unaffiliated'
           returning id`,
          [eventId, email],
        );

        await client.query(
          `insert into entries.entrants (
             purchase_id, first_name, last_name, date_of_birth, gender,
             emergency_contact_name, emergency_contact_phone
           ) values ($1, 'Con', 'Trol', date '1986-12-09', 'female', 'Kin', '0117 496 0000')`,
          [purchase.rows[0]!.id],
        );
      } finally {
        await client.end();
      }
    }

    await Promise.all([
      checkThenInsert('control-a@example.com'),
      checkThenInsert('control-b@example.com'),
    ]);

    const rows = await query(
      'select 1 from entries.entry_purchases where event_id = $1',
      [eventId],
    );

    // Two rows in a one-place race. That is the bug the lock exists to prevent, reproduced on
    // purpose so the tests above cannot pass by accident.
    expect(rows).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------------------
// What counts as a place already taken
// -----------------------------------------------------------------------------------------

describe('which purchases consume a place', () => {
  it('gives a lapsed hold back without anything having to sweep it', async () => {
    // **The property the Cron Trigger must never become responsible for.** A place returns to
    // the pool the moment its hold lapses, because the count only sees a `pending` purchase
    // while `hold_expires_at` is in the future. `entries.expire_pending_holds()` is
    // housekeeping; if it never ran again, nobody would be turned away.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}lapse`, { capacity: 1 });

    expect((await enter(`${FIXTURE_PREFIX}lapse`)).ok).toBe(true);
    expect(await enter(`${FIXTURE_PREFIX}lapse`)).toEqual({
      ok: false,
      reason: 'sold_out',
    });

    await query(
      `update entries.entry_purchases set hold_expires_at = now() - interval '1 minute'
        where event_id = $1`,
      [eventId],
    );

    // Still `pending` — nothing has swept it — and the place is available again.
    expect((await enter(`${FIXTURE_PREFIX}lapse`)).ok).toBe(true);
  });

  it('never gives a paid place back', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}paid`, { capacity: 1 });

    expect((await enter(`${FIXTURE_PREFIX}paid`)).ok).toBe(true);

    await query(
      `update entries.entry_purchases
          set status = 'paid', paid_at = now(), hold_expires_at = null
        where event_id = $1`,
      [eventId],
    );

    // A paid purchase has no `hold_expires_at` at all, so a rule written as "the hold is in
    // the future" rather than "paid, or the hold is in the future" would hand out a place
    // somebody has already bought.
    expect(await enter(`${FIXTURE_PREFIX}paid`)).toEqual({
      ok: false,
      reason: 'sold_out',
    });
  });

  it('counts an expired purchase as gone', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}expired`, { capacity: 1 });

    expect((await enter(`${FIXTURE_PREFIX}expired`)).ok).toBe(true);
    await query(
      `update entries.entry_purchases set status = 'expired' where event_id = $1`,
      [eventId],
    );

    expect((await enter(`${FIXTURE_PREFIX}expired`)).ok).toBe(true);
  });

  it('counts entrants rather than purchases, so a paired entry takes two places', async () => {
    // **Stated because the alternative — purchases multiplied by `entrants_per_entry` —
    // agrees today and stops agreeing the moment that column changes.** Pass the Buck is the
    // known next event and it is two runners per entry.
    await seedEvent(`${FIXTURE_PREFIX}pairs`, { capacity: 3, entrantsPerEntry: 2 });

    const first = await enter(`${FIXTURE_PREFIX}pairs`, {
      entrants: [entrant(), entrant({ first_name: 'Ada' })],
    });
    expect(first.ok).toBe(true);

    // Two of three places gone; a second pair wants two and there is one.
    expect(
      await enter(`${FIXTURE_PREFIX}pairs`, {
        entrants: [entrant(), entrant({ first_name: 'Ada' })],
      }),
    ).toEqual({ ok: false, reason: 'sold_out' });
  });
});

// -----------------------------------------------------------------------------------------
// The window, and the fee
// -----------------------------------------------------------------------------------------

describe('the window, computed from the row and not from the caller', () => {
  it('refuses an event that has not opened', async () => {
    await seedEvent(`${FIXTURE_PREFIX}pre`, { opensAt: null, closesAt: null });

    expect(await enter(`${FIXTURE_PREFIX}pre`)).toEqual({ ok: false, reason: 'closed' });
  });

  it('refuses an event whose window has closed', async () => {
    await seedEvent(`${FIXTURE_PREFIX}shut`, {
      opensAt: '2020-01-01T00:00:00Z',
      closesAt: '2020-06-01T00:00:00Z',
    });

    expect(await enter(`${FIXTURE_PREFIX}shut`)).toEqual({ ok: false, reason: 'closed' });
  });

  it('refuses an inactive event however its window reads', async () => {
    await seedEvent(`${FIXTURE_PREFIX}off`, { active: false });

    expect(await enter(`${FIXTURE_PREFIX}off`)).toEqual({ ok: false, reason: 'closed' });
  });

  it('refuses a slug that is not an event', async () => {
    expect(await enter('no-such-race-at-all')).toEqual({
      ok: false,
      reason: 'no_such_event',
    });
  });
});

describe('the price, which comes from the fees table and from nowhere else', () => {
  it('charges what the row says', async () => {
    await seedEvent(`${FIXTURE_PREFIX}price`, { capacity: 5 });

    const result = await enter(`${FIXTURE_PREFIX}price`);

    expect(result).toMatchObject({
      ok: true,
      amount_pence: 1700,
      fee_label: 'Unaffiliated',
    });
  });

  it('refuses a fee code the event does not offer', async () => {
    await seedEvent(`${FIXTURE_PREFIX}fee`, { capacity: 5 });

    expect(await enter(`${FIXTURE_PREFIX}fee`, { feeCode: 'affiliated' })).toEqual({
      ok: false,
      reason: 'invalid_fee',
    });
  });

  it('refuses a fee whose window has passed', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}window`, { capacity: 5 });
    await query(
      `update entries.fees set valid_to = now() - interval '1 day' where event_id = $1`,
      [eventId],
    );

    expect(await enter(`${FIXTURE_PREFIX}window`)).toEqual({
      ok: false,
      reason: 'invalid_fee',
    });
  });

  it('refuses a withdrawn fee', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}withdrawn`, { capacity: 5 });
    await query('update entries.fees set active = false where event_id = $1', [eventId]);

    expect(await enter(`${FIXTURE_PREFIX}withdrawn`)).toEqual({
      ok: false,
      reason: 'invalid_fee',
    });
  });
});

// -----------------------------------------------------------------------------------------
// Discounts — a path that is unreachable today and is built and tested anyway
// -----------------------------------------------------------------------------------------

describe('a discount code', () => {
  // `entries.discount_codes` is empty in production, because whether the 2023 Left Handed Giant
  // code returns has not been decided. It is exercised here so that enabling it is one
  // `insert` after entries open rather than a deploy in the middle of a live entry window.

  async function seedDiscount(
    eventId: string,
    options: { code?: string; percentOff?: number; maxUses?: number | null } = {},
  ): Promise<void> {
    const { code = 'LHGRC10', percentOff = 10, maxUses = 22 } = options;

    await query(
      `insert into entries.discount_codes (event_id, code, percent_off, max_uses)
       values ($1, $2, $3, $4)`,
      [eventId, code, percentOff, maxUses],
    );
  }

  it('takes its percentage off the fee, in pence', async () => {
    // 10% of £17.00 is exactly 170, so £15.30. The 2023 code's own arithmetic.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}disc`, { capacity: 5 });
    await seedDiscount(eventId);

    expect(
      await enter(`${FIXTURE_PREFIX}disc`, { discountCode: 'LHGRC10' }),
    ).toMatchObject({ ok: true, amount_pence: 1530 });
  });

  it('rounds a fractional discount to the nearest penny rather than towards the club', async () => {
    // 33% of 1700 is 561.0 exactly; 3% is 51.0. The case that actually rounds is 1% of 1750,
    // so this uses a percentage that lands on a half: 15% of 1700 is 255, 7% is 119. The one
    // that exercises the `+ 50` is 3% of 1717 — expressed here by moving the fee instead of
    // inventing a fractional percentage, which is what a committee would actually do.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}round`, { capacity: 5 });
    await query('update entries.fees set price_pence = 1717 where event_id = $1', [
      eventId,
    ]);
    await seedDiscount(eventId, { code: 'ROUNDING', percentOff: 3 });

    // 3% of 1717 is 51.51 → 52 to the nearest penny, so £16.65 rather than £16.66.
    expect(
      await enter(`${FIXTURE_PREFIX}round`, { discountCode: 'ROUNDING' }),
    ).toMatchObject({ ok: true, amount_pence: 1665 });
  });

  it('is matched whatever case somebody typed it in, and ignores surrounding space', async () => {
    // Somebody reading a code off a newsletter should not have to match its case. The unique
    // index is over `citext`, so no two codes can differ only in case.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}case`, { capacity: 5 });
    await seedDiscount(eventId);

    expect(
      await enter(`${FIXTURE_PREFIX}case`, { discountCode: '  lhgrc10 ' }),
    ).toMatchObject({ ok: true, amount_pence: 1530 });
  });

  it('counts each use, and refuses the one past the cap', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}uses`, { capacity: 5 });
    await seedDiscount(eventId, { maxUses: 2 });

    expect((await enter(`${FIXTURE_PREFIX}uses`, { discountCode: 'LHGRC10' })).ok).toBe(
      true,
    );
    expect((await enter(`${FIXTURE_PREFIX}uses`, { discountCode: 'LHGRC10' })).ok).toBe(
      true,
    );

    expect(await enter(`${FIXTURE_PREFIX}uses`, { discountCode: 'LHGRC10' })).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });

    const rows = await query<{ uses: number }>(
      'select uses from entries.discount_codes where event_id = $1',
      [eventId],
    );
    expect(rows[0]?.uses).toBe(2);
  });

  it('refuses a withdrawn code and a code that does not exist, with the same answer', async () => {
    // One reason for all three. Which of them it is tells somebody guessing codes more than
    // it tells somebody who mistyped one.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}gone`, { capacity: 5 });
    await seedDiscount(eventId, { code: 'WITHDRAWN' });
    await query('update entries.discount_codes set active = false where event_id = $1', [
      eventId,
    ]);

    expect(await enter(`${FIXTURE_PREFIX}gone`, { discountCode: 'WITHDRAWN' })).toEqual({
      ok: false,
      reason: 'invalid_discount',
    });
    expect(
      await enter(`${FIXTURE_PREFIX}gone`, { discountCode: 'NEVER-EXISTED' }),
    ).toEqual({ ok: false, reason: 'invalid_discount' });
  });

  it('records which code was used against the purchase', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}link`, { capacity: 5 });
    await seedDiscount(eventId);

    await enter(`${FIXTURE_PREFIX}link`, { discountCode: 'LHGRC10' });

    const rows = await query<{ code: string }>(
      `select d.code::text as code
         from entries.entry_purchases p
         join entries.discount_codes d on d.id = p.discount_code_id
        where p.event_id = $1`,
      [eventId],
    );
    expect(rows[0]?.code).toBe('LHGRC10');
  });

  it('leaves the count alone when the entry is refused for another reason', async () => {
    // A sold-out race must not burn a discount somebody never got to use. The capacity check
    // comes first, before anything is written, which is what makes this true.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}nouse`, { capacity: 1 });
    await seedDiscount(eventId);

    await enter(`${FIXTURE_PREFIX}nouse`);
    expect(await enter(`${FIXTURE_PREFIX}nouse`, { discountCode: 'LHGRC10' })).toEqual({
      ok: false,
      reason: 'sold_out',
    });

    const rows = await query<{ uses: number }>(
      'select uses from entries.discount_codes where event_id = $1',
      [eventId],
    );
    expect(rows[0]?.uses).toBe(0);
  });
});

// -----------------------------------------------------------------------------------------
// The entrants themselves
// -----------------------------------------------------------------------------------------

describe('how many people one entry may cover', () => {
  it('refuses fewer than the event expects', async () => {
    await seedEvent(`${FIXTURE_PREFIX}few`, { capacity: 5, entrantsPerEntry: 2 });

    expect(await enter(`${FIXTURE_PREFIX}few`, { entrants: [entrant()] })).toEqual({
      ok: false,
      reason: 'invalid_entrants',
    });
  });

  it('refuses more than the event expects', async () => {
    await seedEvent(`${FIXTURE_PREFIX}many`, { capacity: 5 });

    expect(
      await enter(`${FIXTURE_PREFIX}many`, {
        entrants: [entrant(), entrant({ first_name: 'Ada' })],
      }),
    ).toEqual({ ok: false, reason: 'invalid_entrants' });
  });

  it('refuses an empty list and something that is not a list', async () => {
    await seedEvent(`${FIXTURE_PREFIX}none`, { capacity: 5 });

    expect(await enter(`${FIXTURE_PREFIX}none`, { entrants: [] })).toEqual({
      ok: false,
      reason: 'invalid_entrants',
    });

    const notAList = await query<{ result: Result }>(
      `select entries.create_pending_purchase(
         $1, 'unaffiliated', 'Grace', 'g@example.com',
         '{"first_name":"Grace"}'::jsonb, null, '{}'::jsonb, p_key => $2
       ) as result`,
      [`${FIXTURE_PREFIX}none`, ENTRY_KEY],
    );
    expect(notAList[0]?.result).toEqual({ ok: false, reason: 'invalid_entrants' });
  });

  it('refuses a value the tables themselves would not take, without writing half an entry', async () => {
    // **The check constraints are the backstop, and tripping one must not leave a purchase
    // behind with no runner on it.** Every write happens inside one subtransaction, so it all
    // goes back together.
    //
    // **This used to use a malformed England Athletics number and no longer can**, twice over.
    // Slice G made the number conditional on the fee, so it was dropped at the boundary rather
    // than reaching the format constraint; then on 29 August 2026 the club stopped asking for
    // one at all and `entrants_ea_number_not_collected` refuses any value in that column. An
    // over-long name is a value the tables still will not take, which is what this test is
    // actually about.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}bad`, { capacity: 5 });

    expect(
      await enter(`${FIXTURE_PREFIX}bad`, {
        entrants: [entrant({ first_name: 'x'.repeat(61) })],
      }),
    ).toEqual({ ok: false, reason: 'invalid_entrants' });

    expect(
      await query('select 1 from entries.entry_purchases where event_id = $1', [eventId]),
    ).toEqual([]);
  });

  it('refuses a date of birth that is not a date', async () => {
    await seedEvent(`${FIXTURE_PREFIX}dob`, { capacity: 5 });

    expect(
      await enter(`${FIXTURE_PREFIX}dob`, {
        entrants: [entrant({ date_of_birth: 'the nineties' })],
      }),
    ).toEqual({ ok: false, reason: 'invalid_entrants' });
  });

  it('keeps an apostrophe in a name intact', async () => {
    // One of the awkward states this repository's fixtures are required to include, and the
    // one most likely to break something between a form and a database.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}name`, { capacity: 5 });

    await enter(`${FIXTURE_PREFIX}name`);

    const rows = await query<{ last_name: string }>(
      `select e.last_name from entries.entrants e
         join entries.entry_purchases p on p.id = e.purchase_id
        where p.event_id = $1`,
      [eventId],
    );
    // **The apostrophe, not the whole string.** The surname now carries a serial so that
    // each fixture is a distinct runner — see the note on `entrantSerial` — and what this test
    // is about is that `O'` survives a round trip through a jsonb argument, a plpgsql insert
    // and a PostgREST read without being doubled, dropped or escaped into something else.
    expect(rows[0]?.last_name).toMatch(/^O'Sullivan-\d+$/);
  });
});

describe('the minimum age, re-checked here because this is the control', () => {
  // The same boundary is asserted against the schema module in
  // `packages/shared/tests/unit/nn-entry.test.ts`. **Both, deliberately**: the form is the
  // convenience and this is what runs whatever the browser did. If the two derivations ever
  // disagreed, one of these four tests is what would notice.

  it('accepts somebody who is exactly eighteen on race day', async () => {
    // Born 1 November 2008 for a race on 1 November 2026 — eighteen **on** the day, which is
    // the boundary somebody will write in to argue about.
    await seedEvent(`${FIXTURE_PREFIX}exact`, { capacity: 5, minimumAge: 18 });

    expect(
      (
        await enter(`${FIXTURE_PREFIX}exact`, {
          entrants: [entrant({ date_of_birth: '2008-11-01' })],
        })
      ).ok,
    ).toBe(true);
  });

  it('refuses somebody one day short of it', async () => {
    await seedEvent(`${FIXTURE_PREFIX}short`, { capacity: 5, minimumAge: 18 });

    expect(
      await enter(`${FIXTURE_PREFIX}short`, {
        entrants: [entrant({ date_of_birth: '2008-11-02' })],
      }),
    ).toEqual({ ok: false, reason: 'under_minimum_age' });
  });

  it('writes nothing when it refuses', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}young`, {
      capacity: 5,
      minimumAge: 18,
    });

    await enter(`${FIXTURE_PREFIX}young`, {
      entrants: [entrant({ date_of_birth: '2012-01-01' })],
    });

    expect(
      await query('select 1 from entries.entry_purchases where event_id = $1', [eventId]),
    ).toEqual([]);
  });

  it('applies no check at all when the event configures none', async () => {
    await seedEvent(`${FIXTURE_PREFIX}anyage`, { capacity: 5, minimumAge: null });

    expect(
      (
        await enter(`${FIXTURE_PREFIX}anyage`, {
          entrants: [entrant({ date_of_birth: '2012-01-01' })],
        })
      ).ok,
    ).toBe(true);
  });

  it('refuses the youngest of a pair rather than only looking at the first', async () => {
    await seedEvent(`${FIXTURE_PREFIX}pairage`, {
      capacity: 5,
      entrantsPerEntry: 2,
      minimumAge: 18,
    });

    expect(
      await enter(`${FIXTURE_PREFIX}pairage`, {
        entrants: [entrant(), entrant({ date_of_birth: '2012-01-01' })],
      }),
    ).toEqual({ ok: false, reason: 'under_minimum_age' });
  });
});

// -----------------------------------------------------------------------------------------
// Medical information — special category data under UK GDPR Article 9
// -----------------------------------------------------------------------------------------

describe('medical notes, and the consent that is the only thing that lets them exist', () => {
  async function notesFor(eventId: string): Promise<string[]> {
    const rows = await query<{ notes: string }>(
      `select m.notes
         from entries.entrant_medical m
         join entries.entrants e on e.id = m.entrant_id
         join entries.entry_purchases p on p.id = e.purchase_id
        where p.event_id = $1`,
      [eventId],
    );
    return rows.map((row) => row.notes);
  }

  it('stores them when the separate consent was given', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}med`, { capacity: 5 });

    await enter(`${FIXTURE_PREFIX}med`, {
      medical: ['Type 1 diabetic.'],
      consents: { entryTerms: true, medical: true },
    });

    expect(await notesFor(eventId)).toEqual(['Type 1 diabetic.']);
  });

  it('never lets them reach the database when it was not', async () => {
    // **The assertion that matters most in this block.** The notes are dropped rather than
    // stored and filtered later, so the absence of a row *is* the record of a withheld
    // consent — and a filter cannot be forgotten if there is nothing to filter. The Worker
    // drops them at the boundary too; this is the second of the two locks and neither
    // depends on the other.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}nomed`, { capacity: 5 });

    const result = await enter(`${FIXTURE_PREFIX}nomed`, {
      medical: ['Asthma. Carries an inhaler.'],
      consents: { entryTerms: true, medical: false },
    });

    expect(result.ok).toBe(true);
    expect(await notesFor(eventId)).toEqual([]);

    // And nowhere else either: no column on `entrants` quietly caught it.
    const anywhere = await query(
      `select 1 from entries.entrants e
         join entries.entry_purchases p on p.id = e.purchase_id
        where p.event_id = $1 and e::text like '%inhaler%'`,
      [eventId],
    );
    expect(anywhere).toEqual([]);
  });

  it('records the consent on the purchase even so', async () => {
    // The consent is a fact about what was ticked and belongs with the others; the notes are
    // what the consent governs. Recording one without the other would lose the record of a
    // decision somebody made.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}consent`, { capacity: 5 });

    await enter(`${FIXTURE_PREFIX}consent`, {
      consents: { entryTerms: true, medical: false },
    });

    const rows = await query<{
      consents: Record<string, unknown>;
      consent_version: string;
    }>(
      'select consents, consent_version from entries.entry_purchases where event_id = $1',
      [eventId],
    );
    expect(rows[0]?.consents).toEqual({ entryTerms: true, medical: false });
    // **The event's version, not the caller's.** A caller who could name a version could
    // name one they never saw.
    expect(rows[0]?.consent_version).toBe('fixture-v1');
  });

  it('writes no row for a blank note under a given consent', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}blank`, { capacity: 5 });

    await enter(`${FIXTURE_PREFIX}blank`, {
      medical: ['   '],
      consents: { entryTerms: true, medical: true },
    });

    expect(await notesFor(eventId)).toEqual([]);
  });

  it('refuses a medical list that does not line up with the entrants', async () => {
    // A shorter list would silently drop somebody's notes; a longer one means the caller
    // built the two from different lists and cannot be trusted about whose notes are whose.
    await seedEvent(`${FIXTURE_PREFIX}mismatch`, { capacity: 5 });

    expect(
      await enter(`${FIXTURE_PREFIX}mismatch`, {
        medical: ['One', 'Two'],
        consents: { entryTerms: true, medical: true },
      }),
    ).toEqual({ ok: false, reason: 'invalid_entrants' });
  });

  it('keeps each runner’s notes with that runner', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}pairmed`, {
      capacity: 5,
      entrantsPerEntry: 2,
    });

    await enter(`${FIXTURE_PREFIX}pairmed`, {
      entrants: [entrant({ first_name: 'Grace' }), entrant({ first_name: 'Ada' })],
      medical: [null, 'Carries an inhaler.'],
      consents: { entryTerms: true, medical: true },
    });

    const rows = await query<{ first_name: string; notes: string }>(
      `select e.first_name, m.notes
         from entries.entrants e
         join entries.entrant_medical m on m.entrant_id = e.id
         join entries.entry_purchases p on p.id = e.purchase_id
        where p.event_id = $1`,
      [eventId],
    );

    expect(rows).toEqual([{ first_name: 'Ada', notes: 'Carries an inhaler.' }]);
  });
});

// -----------------------------------------------------------------------------------------
// The hold, and the two smaller functions
// -----------------------------------------------------------------------------------------

describe('the hold on a place', () => {
  it('is thirty-one minutes, which is Stripe’s floor and not a preference', async () => {
    // A Checkout session's `expires_at` has to be at least thirty minutes ahead of Stripe's
    // clock, so a thirty-minute hold is already too short by the time the request lands. The
    // extra minute is what lets the session and the hold be set to the same instant, which is
    // what stops the session outliving the place it is holding.
    const eventId = await seedEvent(`${FIXTURE_PREFIX}hold`, { capacity: 5 });
    await enter(`${FIXTURE_PREFIX}hold`);

    const rows = await query<{ minutes: number }>(
      `select round(extract(epoch from (hold_expires_at - created_at)) / 60)::int as minutes
         from entries.entry_purchases where event_id = $1`,
      [eventId],
    );
    expect(rows[0]?.minutes).toBe(31);
  });
});

describe('entries.expire_pending_holds()', () => {
  it('moves a lapsed hold and leaves everything else alone', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}sweep`, { capacity: 5 });

    const lapsed = await enter(`${FIXTURE_PREFIX}sweep`);
    const live = await enter(`${FIXTURE_PREFIX}sweep`, { email: 'live@example.com' });

    await query(
      `update entries.entry_purchases set hold_expires_at = now() - interval '1 minute'
        where id = $1`,
      [(lapsed as Created).purchase_id],
    );

    const swept = await query<{ result: { expired: number } }>(
      'select entries.expire_pending_holds() as result',
    );
    expect(swept[0]?.result.expired).toBeGreaterThanOrEqual(1);

    const rows = await query<{ id: string; status: string }>(
      'select id, status from entries.entry_purchases where event_id = $1',
      [eventId],
    );

    expect(rows.find((row) => row.id === (lapsed as Created).purchase_id)?.status).toBe(
      'expired',
    );
    expect(rows.find((row) => row.id === (live as Created).purchase_id)?.status).toBe(
      'pending',
    );
  });

  it('leaves the lapse time in place, so an expired row can still say why', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}why`, { capacity: 5 });
    await enter(`${FIXTURE_PREFIX}why`);
    await query(
      `update entries.entry_purchases set hold_expires_at = now() - interval '1 minute'
        where event_id = $1`,
      [eventId],
    );

    await query('select entries.expire_pending_holds()');

    const rows = await query<{ hold_expires_at: Date | null }>(
      'select hold_expires_at from entries.entry_purchases where event_id = $1',
      [eventId],
    );
    expect(rows[0]?.hold_expires_at).not.toBeNull();
  });

  it('does nothing at all on a second call', async () => {
    const eventId = await seedEvent(`${FIXTURE_PREFIX}twice`, { capacity: 5 });
    await enter(`${FIXTURE_PREFIX}twice`);
    await query(
      `update entries.entry_purchases set hold_expires_at = now() - interval '1 minute'
        where event_id = $1`,
      [eventId],
    );

    await query('select entries.expire_pending_holds()');
    const second = await query<{ result: { expired: number } }>(
      'select entries.expire_pending_holds() as result',
    );

    // Which is what makes it safe to grant to the anon role: there is nothing here to abuse.
    expect(second[0]?.result.expired).toBe(0);
  });
});

describe('entries.attach_checkout_session()', () => {
  it('writes the session id onto a pending purchase, once', async () => {
    await seedEvent(`${FIXTURE_PREFIX}attach`, { capacity: 5 });
    const created = (await enter(`${FIXTURE_PREFIX}attach`)) as Created;

    const first = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      [created.purchase_id, 'cs_test_first'],
    );
    expect(first[0]?.attached).toBe(true);

    // **Once, and the guard is `stripe_checkout_session_id is null`.** Without it, anybody
    // who learned a purchase id could point somebody else's entry at their own session.
    const second = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      [created.purchase_id, 'cs_test_second'],
    );
    expect(second[0]?.attached).toBe(false);

    const rows = await query<{ stripe_checkout_session_id: string }>(
      'select stripe_checkout_session_id from entries.entry_purchases where id = $1',
      [created.purchase_id],
    );
    expect(rows[0]?.stripe_checkout_session_id).toBe('cs_test_first');
  });

  it('refuses a session id that is already on another purchase, without raising', async () => {
    // The unique index is the second lock, and a collision has to come back as `false` rather
    // than as a 500 in the middle of somebody's payment.
    await seedEvent(`${FIXTURE_PREFIX}dup`, { capacity: 5 });
    const one = (await enter(`${FIXTURE_PREFIX}dup`)) as Created;
    const two = (await enter(`${FIXTURE_PREFIX}dup`, {
      email: 'two@example.com',
    })) as Created;

    await query('select entries.attach_checkout_session($1, $2)', [
      one.purchase_id,
      'cs_test_shared',
    ]);

    const clash = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      [two.purchase_id, 'cs_test_shared'],
    );
    expect(clash[0]?.attached).toBe(false);
  });

  it('refuses a purchase that is not pending, and one that does not exist', async () => {
    await seedEvent(`${FIXTURE_PREFIX}notpending`, { capacity: 5 });
    const created = (await enter(`${FIXTURE_PREFIX}notpending`)) as Created;
    await query(`update entries.entry_purchases set status = 'expired' where id = $1`, [
      created.purchase_id,
    ]);

    const expired = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      [created.purchase_id, 'cs_test_expired'],
    );
    expect(expired[0]?.attached).toBe(false);

    const missing = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      ['00000000-0000-4000-8000-000000000000', 'cs_test_missing'],
    );
    expect(missing[0]?.attached).toBe(false);
  });

  it('refuses an empty session id rather than storing one', async () => {
    await seedEvent(`${FIXTURE_PREFIX}empty`, { capacity: 5 });
    const created = (await enter(`${FIXTURE_PREFIX}empty`)) as Created;

    const blank = await query<{ attached: boolean }>(
      'select entries.attach_checkout_session($1, $2) as attached',
      [created.purchase_id, '   '],
    );
    expect(blank[0]?.attached).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// What this slice granted, and what it emphatically did not
// -----------------------------------------------------------------------------------------

describe('the security shape of the three new functions', () => {
  const FUNCTIONS = [
    'create_pending_purchase',
    'expire_pending_holds',
    'attach_checkout_session',
  ] as const;

  it.each(FUNCTIONS)('%s is security definer with a pinned search_path', async (name) => {
    // An unpinned `search_path` on a definer function is the standard Postgres escalation: a
    // caller who can create a function in a schema earlier on the path gets to choose what
    // `now()` means — and `now()` is what decides whether entries are open and whether a hold
    // has lapsed. `search_path=""` recorded exactly, because a function that merely *has* a
    // setting is not the same as one pinned to nothing.
    const rows = await query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries' and p.proname = $1`,
      [name],
    );

    expect(rows[0]?.prosecdef).toBe(true);
    expect(rows[0]?.proconfig).toEqual(['search_path=""']);
  });

  it.each(FUNCTIONS)(
    '%s is volatile, which is what makes the lock mean anything',
    async (name) => {
      // **Not a default that happened to be right.** Under READ COMMITTED a `stable` function's
      // queries run against the *calling* statement's snapshot, so the capacity count would be
      // taken from before the transaction it had just waited behind committed — and the
      // advisory lock would protect nothing at all.
      const rows = await query<{ provolatile: string }>(
        `select p.provolatile
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'entries' and p.proname = $1`,
        [name],
      );

      expect(rows[0]?.provolatile).toBe('v');
    },
  );

  it.each(FUNCTIONS)('%s may be executed by anon, and never by PUBLIC', async (name) => {
    const granted = await query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
        where routine_schema = 'entries' and routine_name = $1
        order by grantee`,
      [name],
    );

    const grantees = granted.map((row) => row.grantee);

    expect(grantees).not.toContain('PUBLIC');
    expect(grantees).toContain('anon');

    // **Two of these three are also granted to `authenticated`, and the third must not be.**
    // The sentence this replaced said "nothing in this platform signs in", which stopped
    // being true at #52 and stopped being irrelevant at #107: the pre-open bypass resolves
    // through `auth.uid()`, so the Worker makes the two entry-path calls with the person's
    // own token — and a signed-in caller reaches PostgREST as `authenticated`, not as `anon`.
    // Without the grant a tester is refused with `42501` before the function is entered.
    //
    // **`expire_pending_holds` stays `anon`-only**, and asserting that here rather than
    // waving at "the new grants" is the point: it is the five-minute cron's, it takes no
    // arguments, it sweeps the whole table, and no signed-in person has any business running
    // it. A blanket expectation across all three would have granted it by accident and this
    // test would have applauded.
    //
    // **The grant decides nothing either way.** `create_pending_purchase()` still computes
    // the window from the event row and admits `pre_open` only for `nn.entry.before_open`;
    // `packages/db/tests/entries-tester.test.ts` re-attempts that bypass as an anonymous
    // caller and as a signed-in one holding nothing, and asserts `closed` for both.
    if (name === 'expire_pending_holds') {
      expect(grantees).not.toContain('authenticated');
    } else {
      expect(grantees).toContain('authenticated');
    }
  });
});

describe('what an anonymous client can and cannot do after this slice', () => {
  it('may hold a place through the function', async () => {
    // The point of the whole arrangement: the door is a function, and it is the only thing
    // that opened.
    await seedEvent(`${FIXTURE_PREFIX}anon`, { capacity: 5 });

    const { data, error } = await anon.schema('entries').rpc('create_pending_purchase', {
      p_key: ENTRY_KEY,
      p_slug: `${FIXTURE_PREFIX}anon`,
      p_fee_code: 'unaffiliated',
      p_purchaser_name: 'Grace Hopper',
      p_purchaser_email: 'anon@example.com',
      p_entrants: [entrant()],
      p_medical: [null],
      p_consents: { entryTerms: true, medical: false },
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, amount_pence: 1700 });
  });

  it('still cannot read back the row it just created', async () => {
    // **The assertion that says this slice granted nothing it should not have.** An anon
    // client that could select from `entry_purchases` could read every name, email address
    // and payment reference the club holds, with a key that is published in page source.
    const { data, error } = await anon
      .schema('entries')
      .from('entry_purchases')
      .select('*');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('still cannot insert a purchase, an entrant or a medical note directly', async () => {
    for (const table of ['entry_purchases', 'entrants', 'entrant_medical'] as const) {
      const { error } = await anon.schema('entries').from(table).insert({});
      expect(error?.code).toBe('42501');
    }
  });

  it('cannot reach past the function to price its own entry', async () => {
    // The fee is resolved inside the transaction from `entries.fees`. A caller cannot read
    // that table, cannot write it, and cannot pass a price — there is no such parameter.
    const { error } = await anon.schema('entries').from('fees').select('price_pence');

    expect(error?.code).toBe('42501');
  });
});
