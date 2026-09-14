import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * The `timing.events` row for the race the club is actually timing — #288.
 *
 * ## Why this file exists at all, when every other timing test invents its own event
 *
 * ⚠️ **This row is not a fixture.** It arrives by migration, it is the real Nightingale
 * Nightmare, and it is the only production data `timing` holds — which is exactly what
 * `entries.events` and `store.socials` both did before it, and why `store.test.ts` asserts
 * every supplied value as an exact object rather than trusting the `update` that supplied it.
 * Nothing here creates or deletes it; the assertions read what `20260914160000` wrote.
 *
 * ## The two things being held
 *
 *   1. **The values, exactly** — `slug`, `name`, `format`, `start_at`, `distance_m`, and the
 *      five columns that must still be null, because the row's whole point is to be inert
 *      until somebody presses something.
 *   2. ⚠️ **That `import_from_entries('nn-2026')` is past `no_such_event`.** That refusal is
 *      the symptom #288 closes — the first press [the race-night
 *      runbook](../../../../docs/delivery/runbooks/timing-race-night.md) asks for — so it is
 *      the assertion that proves the row is doing its job rather than merely existing.
 *
 * ## `start_at` is asserted as an instant, twice, and that is the point of the file
 *
 * **The clocks go back on 25 October 2026 and this race is 1 November**, so race day is GMT
 * and London coincides with UTC — which means a value an hour out would render as a perfectly
 * plausible time and read correctly in every report. A test comparing formatted text would
 * pass against it. So the instant is compared to a `Date` **and** to the same wall clock
 * resolved by Postgres' own timezone database: on any other date of the year those two
 * assertions would disagree with each other, which is what makes them worth writing twice.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SLUG = 'nn-2026';

/** 11:00 in Europe/London on race day, which is 11:00Z because race day is GMT. */
const START_AT = new Date('2026-11-01T11:00:00Z');

/**
 * Deterministic and invented, like every other id in these files — and unlike the row under
 * test, which is neither.
 */
const IMPORTER = '0f0f2026-0000-4000-8000-000000000001';
const NOBODY = '0f0f2026-0000-4000-8000-000000000002';

const db = new Client({ connectionString: LOCAL_DB });

beforeAll(async () => {
  await db.connect();

  for (const [id, email] of [
    [IMPORTER, 'timing-nn-2026-importer@example.com'],
    [NOBODY, 'timing-nn-2026-nobody@example.com'],
  ]) {
    await db.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, 'not-a-password', now(), now(), now())
       on conflict (id) do nothing`,
      [id, email],
    );
    await db.query(
      'insert into identity.people (id) values ($1) on conflict (id) do nothing',
      [id],
    );
  }

  await db.query(
    `insert into identity.role_grants (person_id, role, granted_by)
     values ($1, 'timing-admin', $1), ($2, 'registered', $2)
     on conflict do nothing`,
    [IMPORTER, NOBODY],
  );
});

afterAll(async () => {
  await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
    [IMPORTER, NOBODY],
  ]);
  await db.end();
});

describe('the nn-2026 timing event', () => {
  it('holds the race, with every value exactly as it was supplied', async () => {
    const { rows } = await db.query<{
      slug: string;
      name: string;
      format: string;
      start_at: Date;
      distance_m: number | null;
      course_notes: string | null;
      actually_started_at: Date | null;
      finished_at: Date | null;
      results_published_at: Date | null;
      results_published_by: string | null;
    }>(
      `select slug, name, format, start_at, distance_m, course_notes,
              actually_started_at, finished_at, results_published_at, results_published_by
         from timing.events
        where slug = $1`,
      [SLUG],
    );

    // **One row, and the count is asserted before the object.** A `slug` unique index makes a
    // second impossible, so this is really a claim that the migration ran at all — and it is
    // what tells a reader whose suite fails here that the row is missing rather than wrong.
    expect(rows, 'the nn-2026 timing event is not in the database').toHaveLength(1);

    expect(rows[0]).toEqual({
      slug: 'nn-2026',
      // `entries.events.display_name` for the same slug, character for character. The two
      // surfaces a volunteer reads must not disagree about what one running is called.
      name: 'Nightingale Nightmare 2026',
      // Nightingale Nightmare is solo; Pass the Buck is the relay.
      format: 'solo',
      start_at: START_AT,
      // The advertised 10 km, off-road. Nothing derives a pace from it — see the migration.
      distance_m: 10000,
      // Nothing has been supplied, and the migration invents nothing.
      course_notes: null,
      // ⚠️ **The row is inert, and these five nulls are what that means.** Not started, not
      // finished, not published: `/nn/2026/results/` stays a 404 to everybody without
      // `nn.results.read`, and `/nn/` paints no results link. A migration that shipped any of
      // these set would publish a race nobody has run.
      actually_started_at: null,
      finished_at: null,
      results_published_at: null,
      results_published_by: null,
    });
  });

  /**
   * ⚠️ **The half a `Date` comparison cannot show on its own.** `2026-11-01T11:00:00Z` and
   * `11:00 Europe/London` are the same instant only because the clocks went back the Sunday
   * before; asking Postgres to resolve the wall clock through its own tzdata is what asserts
   * the *intent* rather than the literal somebody typed.
   */
  it('starts at 11:00 in Europe/London on race day, not an hour either side', async () => {
    const { rows } = await db.query<{
      london_eleven: boolean;
      an_hour_out: boolean;
    }>(
      `select start_at = (timestamp '2026-11-01 11:00:00' at time zone 'Europe/London')
                as london_eleven,
              start_at = (timestamp '2026-11-01 11:00:00' at time zone 'Europe/London')
                         + interval '1 hour'
                as an_hour_out
         from timing.events
        where slug = $1`,
      [SLUG],
    );

    expect(rows[0]?.london_eleven, 'start_at is not 11:00 London on race day').toBe(true);
    // The negative case, because the positive one would also pass on a row that is right by
    // accident on a day whose offset happens to agree.
    expect(rows[0]?.an_hour_out).toBe(false);
  });
});

/**
 * The symptom #288 closes.
 *
 * ⚠️ **Every call here runs in a transaction that is rolled back**, because
 * `import_from_entries()` writes: against the real `nn-2026` it would create a team per paid
 * purchase in `entries`, and this file may not leave a start list behind on the row the
 * results page reads. The rollback is also what makes the answer safe to assert on a database
 * whose `entries` side has any number of purchases against that event.
 */
describe('import_from_entries() is past no_such_event', () => {
  type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

  async function importAs(personId: string, slug = SLUG): Promise<Envelope> {
    await db.query('begin');

    try {
      await db.query("select set_config('role', 'authenticated', true)");
      await db.query(
        "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
        [personId],
      );

      const { rows } = await db.query<{ answer: Envelope }>(
        'select timing.import_from_entries($1) as answer',
        [slug],
      );
      return rows[0]!.answer;
    } finally {
      await db.query('rollback');
    }
  }

  // **The negative cases first**, for `timing-import.test.ts`' reason: that the roster can be
  // imported proves less than that the permission is still the door. Neither of these says
  // anything about the row existing — the permission check is the function's first statement —
  // which is why they are not the assertion this file was written for.
  it('still refuses somebody signed in holding nothing', async () => {
    expect(await importAs(NOBODY)).toEqual({ ok: false, reason: 'refused' });
  });

  it('still names no_such_event for a slug that is not a race', async () => {
    // ⚠️ **This is what stops the assertion below going quietly vacuous.** If the refusal were
    // unreachable — a broken function, a renamed reason string — "it is not `no_such_event`"
    // would pass for the wrong reason, and pass for ever.
    expect(await importAs(IMPORTER, 'zz-no-such-race')).toEqual({
      ok: false,
      reason: 'no_such_event',
    });
  });

  /**
   * ⚠️ **The counts are deliberately not asserted.** How many teams this writes depends on how
   * many paid purchases `entries` holds against `nn-2026` at the moment the suite runs, which
   * is zero on a laptop and is not a fact about this migration. What is asserted is that the
   * function got past the two refusals that name a missing row: an empty roster is a
   * legitimate answer and `no_such_event` is not one any more.
   */
  it('gets past the refusal for the real race, whatever the roster holds', async () => {
    const answer = await importAs(IMPORTER);

    expect(answer['reason']).not.toBe('no_such_event');
    // `no_such_entries_event` is the other half of the same symptom — it would mean the
    // `entries` row this shares a slug with had gone — so it is ruled out by name too.
    expect(answer['reason']).not.toBe('no_such_entries_event');
    expect(answer).toMatchObject({ ok: true });
  });
});
