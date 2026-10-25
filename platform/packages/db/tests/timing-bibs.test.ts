import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { effectiveBib, type EventFormat, type Leg } from '@src/shared/timing/bib';
import { planBibAssignment } from '@src/shared/timing/registration/bib-assignment';

/**
 * Bibs — #249: assigning a field, overriding one at the desk, and the lockstep.
 *
 * ## ⚠️ Why the parity block is the point of this file
 *
 * [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * names the agreement between `bib.ts` and the database's own bib resolution as one of three
 * things the rewrite may not break — and it is the one with **no symptom until a result is
 * wrong**: a runner's time attributed to the wrong person, discovered after the prizes have
 * been given out. The old repository carried a *"parity (SQL trigger contract)"* block for
 * exactly this; this is it, ported against a real database.
 *
 * Two things have to agree, and they are different code:
 *
 * - `effectiveBib()` in TypeScript, which the screens render from;
 * - `timing.effective_bib()` in SQL, which `set_bib_override()`'s collision guard compares
 *   with — and `resolve_crossing_team_id()`, the trigger that decides whose crossing it is.
 *
 * So the cases below are asserted **three ways**: the TypeScript answer, the SQL function's
 * answer, and the team a real crossing on that bib actually resolves to.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const IMPORTER = '55555555-5555-4555-8555-555555555551';
const NOBODY = '55555555-5555-4555-8555-555555555552';
const SOLO_EVENT = '00000000-0000-4000-8000-0000000000b1';
const RELAY_EVENT = '00000000-0000-4000-8000-0000000000b2';
const SOLO_SLUG = 'zz-bibs-solo';
const RELAY_SLUG = 'zz-bibs-relay';

let db: Client;

type Envelope = { ok: boolean; reason?: string; [key: string]: unknown };

async function asPerson<T>(personId: string, sql: string, params: unknown[]): Promise<T> {
  await db.query("select set_config('role', 'authenticated', false)");
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [personId],
  );
  try {
    const { rows } = await db.query<{ answer: T }>(sql, params);
    return rows[0]?.answer as T;
  } finally {
    // ⚠️ Back to `postgres` before anything reads a `timing` table directly — `authenticated`
    // holds no grant on any of them, so a verification read left under the impersonated role
    // fails with `permission denied for table teams`, which reads as a broken function.
    await db.query("select set_config('role', 'postgres', false)");
    await db.query("select set_config('request.jwt.claims', null, false)");
  }
}

const assignBibsAs = (person: string, slug: string) =>
  asPerson<Envelope>(person, 'select timing.assign_bibs($1) as answer', [slug]);

/** Assign bibs with the **First number** box filled in — `20261023160000`. */
const assignFromAs = (person: string, slug: string, start: number) =>
  asPerson<Envelope>(person, 'select timing.assign_bibs($1, $2) as answer', [
    slug,
    start,
  ]);

const overrideAs = (
  person: string,
  slug: string,
  teamId: string,
  leg: number,
  bib: string | null,
) =>
  asPerson<Envelope>(
    person,
    'select timing.set_bib_override($1, $2, $3::smallint, $4) as answer',
    [slug, teamId, leg, bib],
  );

const walkInAs = (person: string, slug: string, first: string, last: string) =>
  asPerson<Envelope>(person, 'select timing.add_walk_in($1, $2, $3) as answer', [
    slug,
    first,
    last,
  ]);

/** One team row, created directly so a test can set up exactly the shape it needs. */
async function makeTeam(
  eventId: string,
  fields: {
    team_number?: string | null;
    bib_leg1?: string | null;
    bib_leg2?: string | null;
  } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into timing.teams (event_id, team_number, bib_leg1, bib_leg2)
     values ($1, $2, $3, $4) returning id`,
    [
      eventId,
      fields.team_number ?? null,
      fields.bib_leg1 ?? null,
      fields.bib_leg2 ?? null,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = new Client({ connectionString: LOCAL_DB });
  await db.connect();

  for (const [id, email] of [
    [IMPORTER, 'timing-bibs-importer@example.com'],
    [NOBODY, 'timing-bibs-nobody@example.com'],
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

  await db.query('delete from timing.events where id = any($1::uuid[])', [
    [SOLO_EVENT, RELAY_EVENT],
  ]);
  await db.query(
    `insert into timing.events (id, slug, name, format, start_at)
     values ($1, $2, 'Bibs Solo', 'solo', '2026-11-01T11:00:00Z'),
            ($3, $4, 'Bibs Relay', 'relay', '2026-11-01T11:00:00Z')`,
    [SOLO_EVENT, SOLO_SLUG, RELAY_EVENT, RELAY_SLUG],
  );
});

afterEach(async () => {
  await db.query('delete from timing.crossings where event_id = any($1::uuid[])', [
    [SOLO_EVENT, RELAY_EVENT],
  ]);
  await db.query('delete from timing.teams where event_id = any($1::uuid[])', [
    [SOLO_EVENT, RELAY_EVENT],
  ]);
  // Every test starts on a race with no width, which is every race but nn-2026.
  await db.query(
    'update timing.events set bib_pad_width = null where id = any($1::uuid[])',
    [[SOLO_EVENT, RELAY_EVENT]],
  );
});

afterAll(async () => {
  await db.query('delete from timing.events where id = any($1::uuid[])', [
    [SOLO_EVENT, RELAY_EVENT],
  ]);
  await db.query('delete from identity.role_grants where person_id = any($1::uuid[])', [
    [IMPORTER, NOBODY],
  ]);
  await db.end();
});

/**
 * ⚠️ **The constraint two ported modules already claimed existed.**
 * `bib-assignment.ts` says *"`unique (event_id, team_number)` blocks in-leg dupes"* and
 * `pairing.ts` says it *"makes it impossible for real rows"*. It was not in the schema
 * migration, so both guarantees rested on nothing until #249.
 */
describe('the constraint the code already believed in', () => {
  it('refuses two teams with the same number on one race, with 23505', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '12' });

    await expect(makeTeam(SOLO_EVENT, { team_number: '12' })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('allows the same number on a different race, because it is scoped per event', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '12' });
    await expect(makeTeam(RELAY_EVENT, { team_number: '12' })).resolves.toBeTruthy();
  });

  /**
   * **Nulls are distinct**, which is the half that makes this safe to add to a live field: a
   * roster imported before `assign_bibs()` runs is entirely unnumbered, and a constraint that
   * treated nulls as equal would refuse the second team of any import.
   */
  it('allows any number of teams with no number yet', async () => {
    await makeTeam(SOLO_EVENT);
    await makeTeam(SOLO_EVENT);
    await expect(makeTeam(SOLO_EVENT)).resolves.toBeTruthy();
  });
});

describe('assigning a field its numbers', () => {
  it('refuses somebody without the permission, and an anonymous caller', async () => {
    expect(await assignBibsAs(NOBODY, SOLO_SLUG)).toEqual({
      ok: false,
      reason: 'refused',
    });

    const { rows } = await db.query<{ answer: Envelope }>(
      'select timing.assign_bibs($1) as answer',
      [SOLO_SLUG],
    );
    expect(rows[0]?.answer).toEqual({ ok: false, reason: 'refused' });
  });

  it('names a race that does not exist', async () => {
    expect(await assignBibsAs(IMPORTER, 'zz-no-such-race')).toEqual({
      ok: false,
      reason: 'no_such_event',
    });
  });

  it('numbers an unnumbered field from one, in order', async () => {
    for (let i = 0; i < 3; i++) await makeTeam(SOLO_EVENT);

    const answer = await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(answer.ok).toBe(true);
    expect(answer.assigned).toBe(3);
    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number::integer`,
      [SOLO_EVENT],
    );
    expect(rows.map((r) => r.team_number)).toEqual(['1', '2', '3']);
  });

  /**
   * ⚠️ **The assertion the whole design exists for.** Somebody has pinned the first run's
   * numbers to their vest, so a second run must not renumber anybody.
   */
  it('gives the same numbers when run twice, and says it assigned none', async () => {
    for (let i = 0; i < 3; i++) await makeTeam(SOLO_EVENT);
    await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows: before } = await db.query<{ id: string; team_number: string }>(
      `select id, team_number from timing.teams where event_id = $1 order by id`,
      [SOLO_EVENT],
    );

    const second = await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows: after } = await db.query<{ id: string; team_number: string }>(
      `select id, team_number from timing.teams where event_id = $1 order by id`,
      [SOLO_EVENT],
    );

    expect(second.assigned).toBe(0);
    expect(second.already_assigned).toBe(3);
    expect(after).toEqual(before);
  });

  /**
   * A team added after the first run — a late entry, or a walk-in — carries on from the top
   * rather than reusing a number somebody is already wearing.
   */
  it('carries on from the highest number taken when a team is added later', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '7' });
    await makeTeam(SOLO_EVENT);

    await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number::integer`,
      [SOLO_EVENT],
    );
    expect(rows.map((r) => r.team_number)).toEqual(['7', '8']);
  });

  /**
   * The old application's smoke-test rows were `"T1"`. They count as assigned and are skipped
   * when finding the maximum — `planBibAssignment()`'s own rule — and the unique constraint is
   * on the literal text, so a numeric assignment cannot collide with one.
   */
  it('leaves a non-numeric number alone and does not trip over it', async () => {
    await makeTeam(SOLO_EVENT, { team_number: 'T1' });
    await makeTeam(SOLO_EVENT);

    const answer = await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(answer.assigned).toBe(1);
    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number`,
      [SOLO_EVENT],
    );
    expect(rows.map((r) => r.team_number).sort()).toEqual(['1', 'T1']);
  });
});

/**
 * ⚠️ **The numbers a marshal types are the numbers printed on the vest.** Nightingale Nightmare's
 * are zero-padded, 001 to 250, and a bib is matched as exact text — so a field numbered `'1'`
 * turns every crossing typed `'001'` into an orphan. `20261023120000` pads the number where it
 * is made, at `timing.events.bib_pad_width`, and leaves every comparison alone.
 */
describe('numbering a field at the width its numbers are printed', () => {
  const setWidth = (eventId: string, width: number | null) =>
    db.query('update timing.events set bib_pad_width = $2 where id = $1', [
      eventId,
      width,
    ]);

  const numbers = async (eventId: string) => {
    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number::integer`,
      [eventId],
    );
    return rows.map((r) => r.team_number);
  };

  it('pads a field to three digits on a race whose numbers have three', async () => {
    await setWidth(SOLO_EVENT, 3);
    for (let i = 0; i < 3; i++) await makeTeam(SOLO_EVENT);

    const answer = await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(answer).toMatchObject({ ok: true, assigned: 3 });
    expect(await numbers(SOLO_EVENT)).toEqual(['001', '002', '003']);
  });

  /**
   * **The assertion the change exists for**, made through the trigger rather than by reading
   * `team_number` back: a crossing typed off the vest resolves to the runner wearing it, and the
   * unpadded form resolves to nobody — which is right, because nobody is wearing a `1`.
   */
  it('resolves a crossing typed 001 to the runner given 001, and one typed 1 to nobody', async () => {
    await setWidth(SOLO_EVENT, 3);
    const teamId = await makeTeam(SOLO_EVENT);
    await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows } = await db.query<{ bib: string; team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '001', now()), ($1, '1', now())
       returning bib, team_id`,
      [SOLO_EVENT],
    );

    expect(rows.find((r) => r.bib === '001')?.team_id).toBe(teamId);
    expect(rows.find((r) => r.bib === '1')?.team_id).toBeNull();
  });

  it('carries on from a padded field without renumbering anybody in it', async () => {
    await setWidth(SOLO_EVENT, 3);
    await makeTeam(SOLO_EVENT, { team_number: '001' });
    await makeTeam(SOLO_EVENT, { team_number: '002' });
    await makeTeam(SOLO_EVENT);

    const answer = await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(answer).toMatchObject({ ok: true, assigned: 1, already_assigned: 2 });
    expect(await numbers(SOLO_EVENT)).toEqual(['001', '002', '003']);
  });

  /**
   * ⚠️ **Postgres' `lpad()` truncates**: `lpad('1000', 3, '0')` is `'100'`, which is somebody
   * else's number. A number longer than the width is written in full.
   */
  it('writes a number longer than the width in full rather than cutting it', async () => {
    await setWidth(SOLO_EVENT, 3);
    await makeTeam(SOLO_EVENT, { team_number: '999' });
    await makeTeam(SOLO_EVENT);

    await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(await numbers(SOLO_EVENT)).toEqual(['999', '1000']);
  });

  it('pads a walk-in at the desk to the same width', async () => {
    await setWidth(SOLO_EVENT, 3);
    await makeTeam(SOLO_EVENT, { team_number: '041' });

    const answer = await walkInAs(IMPORTER, SOLO_SLUG, 'Wal', 'Kin');

    expect(answer).toMatchObject({ ok: true, team_number: '042' });
  });

  /**
   * Why the width is a column on the race rather than a constant: Pass the Buck's bibs are
   * leg-first, `101` and `201`, so a width of two is what gives them — and three for everybody
   * would have made them `1001` and `2001`.
   */
  it('gives a relay at width two the leg-first bibs 101 and 201', async () => {
    await setWidth(RELAY_EVENT, 2);
    const teamId = await makeTeam(RELAY_EVENT);
    await assignBibsAs(IMPORTER, RELAY_SLUG);

    expect(await numbers(RELAY_EVENT)).toEqual(['01']);

    const { rows } = await db.query<{ bib: string; team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '101', now()), ($1, '201', now())
       returning bib, team_id`,
      [RELAY_EVENT],
    );
    expect(rows.map((r) => r.team_id)).toEqual([teamId, teamId]);
  });

  /**
   * ⚠️ **The lockstep with the rule the old application ran.** `planBibAssignment()` was ported
   * with its `padWidth` option and nothing called it; the database is what numbers a field now,
   * so the two are held to the same answer here rather than left to drift.
   */
  it('numbers a field exactly as planBibAssignment() does', async () => {
    await setWidth(SOLO_EVENT, 3);
    const teams: { id: string; team_number: null; csv_row_index: number }[] = [];
    // Inserted out of order, so the answer depends on `csv_row_index` rather than on luck.
    for (const csvRowIndex of [4, 1, 12, 3, 7, 2, 9, 5, 11, 6, 10, 8]) {
      const { rows } = await db.query<{ id: string }>(
        `insert into timing.teams (event_id, csv_row_index) values ($1, $2) returning id`,
        [SOLO_EVENT, csvRowIndex],
      );
      teams.push({ id: rows[0]!.id, team_number: null, csv_row_index: csvRowIndex });
    }

    await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows } = await db.query<{ id: string; team_number: string }>(
      `select id, team_number from timing.teams where event_id = $1`,
      [SOLO_EVENT],
    );
    const fromDatabase = Object.fromEntries(rows.map((r) => [r.id, r.team_number]));
    const plan = planBibAssignment(teams, { startFrom: 1, padWidth: 3 });
    const fromPlan = Object.fromEntries(
      plan.assignments.map((a) => [a.id, a.newTeamNumber]),
    );

    expect(fromDatabase).toEqual(fromPlan);
  });

  it('refuses a width of nothing or of more than six digits, with 23514', async () => {
    for (const width of [0, 7]) {
      await expect(setWidth(SOLO_EVENT, width)).rejects.toMatchObject({
        code: '23514',
      });
    }
  });
});

/**
 * ⚠️ **Assign bibs can be told where to start, and still never renumbers anybody** —
 * `20261023160000`. The old application asked for a first bib; the port dropped it. The rule is
 * `planBibAssignment()`'s: the first number is the greater of the one asked for and one above
 * the highest already given out, so a start below that is ignored rather than honoured by
 * renumbering somebody or handing a number out twice.
 */
describe('starting Assign bibs at a number the desk chooses', () => {
  const setWidth = (eventId: string, width: number | null) =>
    db.query('update timing.events set bib_pad_width = $2 where id = $1', [
      eventId,
      width,
    ]);

  const numbers = async (eventId: string) => {
    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number::integer`,
      [eventId],
    );
    return rows.map((r) => r.team_number);
  };

  it('starts an unnumbered field at the number asked for, and says where it ran to', async () => {
    for (let i = 0; i < 3; i++) await makeTeam(SOLO_EVENT);

    expect(await assignFromAs(IMPORTER, SOLO_SLUG, 150)).toEqual({
      ok: true,
      assigned: 3,
      guides_numbered: 0,
      already_assigned: 0,
      first: '150',
      last: '152',
    });
    expect(await numbers(SOLO_EVENT)).toEqual(['150', '151', '152']);
  });

  it("pads the first number to the race's width", async () => {
    await setWidth(SOLO_EVENT, 3);
    for (let i = 0; i < 2; i++) await makeTeam(SOLO_EVENT);

    expect(await assignFromAs(IMPORTER, SOLO_SLUG, 11)).toMatchObject({
      first: '011',
      last: '012',
    });
  });

  /**
   * ⚠️ **The half that keeps "never renumbers anybody" true.** Ten numbers are already worn; a
   * first number of 5 is ignored, nobody already numbered moves, and the answer says numbering
   * began at 11 so the page can tell the desk why.
   */
  it('never goes below a number already given out, and moves nobody', async () => {
    const worn = await makeTeam(SOLO_EVENT, { team_number: '10' });
    for (let i = 0; i < 2; i++) await makeTeam(SOLO_EVENT);

    expect(await assignFromAs(IMPORTER, SOLO_SLUG, 5)).toMatchObject({
      assigned: 2,
      already_assigned: 1,
      first: '11',
      last: '12',
    });
    expect(await numbers(SOLO_EVENT)).toEqual(['10', '11', '12']);

    const { rows } = await db.query<{ team_number: string }>(
      'select team_number from timing.teams where id = $1',
      [worn],
    );
    expect(rows[0]?.team_number).toBe('10');
  });

  it('leaves a field alone when everybody is numbered, whatever start is given', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '1' });

    expect(await assignFromAs(IMPORTER, SOLO_SLUG, 500)).toEqual({
      ok: true,
      assigned: 0,
      guides_numbered: 0,
      already_assigned: 1,
      first: null,
      last: null,
    });
    expect(await numbers(SOLO_EVENT)).toEqual(['1']);
  });

  it('still steps past a number a guide is wearing', async () => {
    await makeTeam(SOLO_EVENT, { bib_leg2: '151' });
    await makeTeam(SOLO_EVENT);

    await assignFromAs(IMPORTER, SOLO_SLUG, 150);

    // Two unnumbered teams: 150, then 151 is skipped because somebody wears it, so 152.
    expect(await numbers(SOLO_EVENT)).toEqual(['150', '152']);
  });

  it('refuses a first number of nothing, or of more than six digits', async () => {
    await makeTeam(SOLO_EVENT);

    for (const start of [0, -3, 1_000_000]) {
      expect(await assignFromAs(IMPORTER, SOLO_SLUG, start), String(start)).toEqual({
        ok: false,
        reason: 'invalid_start',
      });
    }
    // The one entry is still there and still unnumbered: refused means nothing was written.
    expect(await numbers(SOLO_EVENT)).toEqual([null]);
  });

  it('refuses somebody without the permission before reading the start', async () => {
    expect(await assignFromAs(NOBODY, SOLO_SLUG, 0)).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  /** The lockstep with the rule the old application ran, now with its `startFrom` given. */
  it('numbers a field exactly as planBibAssignment() does from a given start', async () => {
    await setWidth(SOLO_EVENT, 3);
    const teams: { id: string; team_number: null; csv_row_index: number }[] = [];
    for (const csvRowIndex of [3, 1, 4, 2, 6, 5]) {
      const { rows } = await db.query<{ id: string }>(
        `insert into timing.teams (event_id, csv_row_index) values ($1, $2) returning id`,
        [SOLO_EVENT, csvRowIndex],
      );
      teams.push({ id: rows[0]!.id, team_number: null, csv_row_index: csvRowIndex });
    }

    await assignFromAs(IMPORTER, SOLO_SLUG, 95);

    const { rows } = await db.query<{ id: string; team_number: string }>(
      `select id, team_number from timing.teams where event_id = $1`,
      [SOLO_EVENT],
    );
    const fromDatabase = Object.fromEntries(rows.map((r) => [r.id, r.team_number]));
    const plan = planBibAssignment(teams, { startFrom: 95, padWidth: 3 });
    const fromPlan = Object.fromEntries(
      plan.assignments.map((a) => [a.id, a.newTeamNumber]),
    );

    expect(fromDatabase).toEqual(fromPlan);
  });
});

/**
 * ⚠️ **The lockstep #249 asks for, and ADR-034 names as unbreakable.**
 *
 * Each case asserts the same bib three ways: `effectiveBib()` in TypeScript, the SQL function
 * the collision guard uses, and the team a real crossing on that bib actually resolves to
 * through the trigger. A disagreement between any two of them is a runner's time on somebody
 * else's name.
 */
describe('parity: effectiveBib() in TypeScript, and the database', () => {
  const CASES: Array<{
    name: string;
    format: EventFormat;
    team_number: string | null;
    bib_leg1: string | null;
    bib_leg2: string | null;
    leg: Leg;
  }> = [
    {
      name: 'no override, solo',
      format: 'solo',
      team_number: '12',
      bib_leg1: null,
      bib_leg2: null,
      leg: 1,
    },
    {
      name: 'no override, relay leg 1',
      format: 'relay',
      team_number: '12',
      bib_leg1: null,
      bib_leg2: null,
      leg: 1,
    },
    {
      name: 'no override, relay leg 2',
      format: 'relay',
      team_number: '12',
      bib_leg1: null,
      bib_leg2: null,
      leg: 2,
    },
    {
      name: 'override on leg 1',
      format: 'relay',
      team_number: '12',
      bib_leg1: '999',
      bib_leg2: null,
      leg: 1,
    },
    {
      name: 'override on both legs',
      format: 'relay',
      team_number: '12',
      bib_leg1: '998',
      bib_leg2: '999',
      leg: 2,
    },
    // ⚠️ The case `bib.ts` says twice: a bib is opaque, so `'0311'` is not `'311'`.
    {
      name: 'override to a leading-zero bib',
      format: 'solo',
      team_number: '311',
      bib_leg1: '0311',
      bib_leg2: null,
      leg: 1,
    },
    {
      name: 'no number and no override',
      format: 'solo',
      team_number: null,
      bib_leg1: null,
      bib_leg2: null,
      leg: 1,
    },
    {
      name: 'no number but an override',
      format: 'solo',
      team_number: null,
      bib_leg1: '0311',
      bib_leg2: null,
      leg: 1,
    },
    // An empty override is absent, not a bib — `effectiveBib()`'s own safety net.
    {
      name: 'an empty override falls through',
      format: 'solo',
      team_number: '12',
      bib_leg1: '',
      bib_leg2: null,
      leg: 1,
    },
    // ⚠️ ADR-061: on a solo race leg 2 is a guide, who wears a number of their own or none.
    // It derived the team number until 23 October 2026, which read as the runner's bib.
    {
      name: 'solo leg 2, a guide with no number of their own, derives nothing',
      format: 'solo',
      team_number: '12',
      bib_leg1: null,
      bib_leg2: null,
      leg: 2,
    },
    {
      name: "solo leg 2, a guide's own number",
      format: 'solo',
      team_number: '12',
      bib_leg1: null,
      bib_leg2: '9002',
      leg: 2,
    },
  ];

  it.each(CASES)('$name: SQL agrees with TypeScript', async (c) => {
    const expected = effectiveBib(
      { team_number: c.team_number, bib_leg1: c.bib_leg1, bib_leg2: c.bib_leg2 },
      c.leg,
      c.format,
    );

    const { rows } = await db.query<{ answer: string | null }>(
      'select timing.effective_bib($1, $2, $3::smallint, $4) as answer',
      [c.leg === 1 ? c.bib_leg1 : c.bib_leg2, c.team_number, c.leg, c.format],
    );

    expect(rows[0]?.answer).toBe(expected);
  });

  /**
   * The third way, and the one that actually decides a result: a crossing captured on that bib
   * must land on that team. `resolve_crossing_team_id()` inlines the rule rather than calling
   * `effective_bib()`, so this is a genuinely independent statement of it.
   */
  it.each(CASES.filter((c) => c.team_number !== null || c.bib_leg1))(
    '$name: a crossing on that bib resolves to that team',
    async (c) => {
      const eventId = c.format === 'solo' ? SOLO_EVENT : RELAY_EVENT;
      const teamId = await makeTeam(eventId, {
        team_number: c.team_number,
        bib_leg1: c.bib_leg1,
        bib_leg2: c.bib_leg2,
      });

      const bib = effectiveBib(
        { team_number: c.team_number, bib_leg1: c.bib_leg1, bib_leg2: c.bib_leg2 },
        c.leg,
        c.format,
      );
      if (bib === null) return;

      const { rows } = await db.query<{ team_id: string | null }>(
        `insert into timing.crossings (event_id, bib, captured_at)
         values ($1, $2, now()) returning team_id`,
        [eventId, bib],
      );

      expect(rows[0]?.team_id).toBe(teamId);
    },
  );

  /**
   * ⚠️ **The negative half, and it is the one that would fail silently.** A bib that belongs
   * to nobody must resolve to nobody — not to whichever team happens to sort first. The old
   * application's anomaly queue exists for exactly these.
   */
  it('resolves a bib nobody owns to nobody', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '12' });

    const { rows } = await db.query<{ team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '999', now()) returning team_id`,
      [SOLO_EVENT],
    );

    expect(rows[0]?.team_id).toBeNull();
  });

  /**
   * An override **beats** the derived bib on its own leg: once team 12 is handed physical bib
   * 999, a crossing on `'12'` is nobody's. Getting this backwards would attribute a time to a
   * runner who is wearing a different number.
   */
  it('lets an override beat the derived bib it replaces', async () => {
    const teamId = await makeTeam(SOLO_EVENT, { team_number: '12', bib_leg1: '999' });

    const { rows } = await db.query<{ bib: string; team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, '999', now()), ($1, '12', now())
       returning bib, team_id`,
      [SOLO_EVENT],
    );

    expect(rows.find((r) => r.bib === '999')?.team_id).toBe(teamId);
    expect(rows.find((r) => r.bib === '12')?.team_id).toBeNull();
  });
});

describe('overriding a bib at the desk', () => {
  it('refuses somebody without the permission', async () => {
    const teamId = await makeTeam(SOLO_EVENT, { team_number: '1' });

    expect(await overrideAs(NOBODY, SOLO_SLUG, teamId, 1, '999')).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('stores an override and re-resolves a crossing already captured', async () => {
    const teamId = await makeTeam(SOLO_EVENT, { team_number: '12' });
    await db.query(
      `insert into timing.crossings (event_id, bib, captured_at) values ($1, '999', now())`,
      [SOLO_EVENT],
    );

    // Captured before the override existed, so it belongs to nobody yet.
    const { rows: before } = await db.query<{ team_id: string | null }>(
      `select team_id from timing.crossings where event_id = $1`,
      [SOLO_EVENT],
    );
    expect(before[0]?.team_id).toBeNull();

    const answer = await overrideAs(IMPORTER, SOLO_SLUG, teamId, 1, '999');

    expect(answer.ok).toBe(true);
    const { rows: after } = await db.query<{ team_id: string | null }>(
      `select team_id from timing.crossings where event_id = $1`,
      [SOLO_EVENT],
    );
    expect(after[0]?.team_id).toBe(teamId);
  });

  /**
   * ⚠️ **The clash that comparing overrides alone would miss.** Team 12's proposed override
   * `'13'` collides with team 13's *derived* bib — team 13 has no override at all. Two runners
   * would cross on one number.
   */
  it('refuses an override that clashes with another team derived bib', async () => {
    const twelve = await makeTeam(SOLO_EVENT, { team_number: '12' });
    await makeTeam(SOLO_EVENT, { team_number: '13' });

    const answer = await overrideAs(IMPORTER, SOLO_SLUG, twelve, 1, '13');

    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe('bib_taken');
    expect(answer.with_team_number).toBe('13');
  });

  it('refuses an override that clashes with another team own override', async () => {
    const twelve = await makeTeam(SOLO_EVENT, { team_number: '12' });
    await makeTeam(SOLO_EVENT, { team_number: '13', bib_leg1: '900' });

    expect((await overrideAs(IMPORTER, SOLO_SLUG, twelve, 1, '900')).reason).toBe(
      'bib_taken',
    );
  });

  it('refuses an override that would make a relay team two legs the same', async () => {
    const team = await makeTeam(RELAY_EVENT, { team_number: '12', bib_leg2: '500' });

    const answer = await overrideAs(IMPORTER, RELAY_SLUG, team, 1, '500');

    expect(answer.ok).toBe(false);
    expect(answer.same_team).toBe(true);
  });

  it('lets a team keep its own override when nothing changed', async () => {
    const team = await makeTeam(SOLO_EVENT, { team_number: '12', bib_leg1: '999' });

    expect((await overrideAs(IMPORTER, SOLO_SLUG, team, 1, '999')).ok).toBe(true);
  });

  it('clears an override when given nothing, and stores null rather than empty', async () => {
    const team = await makeTeam(SOLO_EVENT, { team_number: '12', bib_leg1: '999' });

    expect((await overrideAs(IMPORTER, SOLO_SLUG, team, 1, '   ')).ok).toBe(true);

    const { rows } = await db.query<{ bib_leg1: string | null }>(
      `select bib_leg1 from timing.teams where id = $1`,
      [team],
    );
    expect(rows[0]?.bib_leg1).toBeNull();
  });

  /** Leg 2 has no meaning on a solo race, and `effectiveBib()` says so. */
  // Since ADR-061 a solo entry *with a guide* takes leg 2 — see the guide block below.
  it('refuses leg two on a solo entry with no guide on it', async () => {
    const team = await makeTeam(SOLO_EVENT, { team_number: '12' });

    expect((await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '999')).reason).toBe(
      'no_such_leg',
    );
  });

  it('refuses a team that belongs to another race', async () => {
    const team = await makeTeam(RELAY_EVENT, { team_number: '12' });

    expect((await overrideAs(IMPORTER, SOLO_SLUG, team, 1, '999')).reason).toBe(
      'no_such_team',
    );
  });
});

/**
 * ⚠️ **A visually impaired runner's guide wears a race number of their own** — ADR-061, supplied
 * on 23 October 2026. `import_from_entries()` puts the guide on their runner's team as leg 2,
 * and on a solo race leg 2 used to derive the team number and refuse an override. So the desk
 * could not record the guide's number, and a guide handed the next vest would have been timed
 * as the next entry's runner.
 */
describe("a guide's own number on a solo race", () => {
  /** A runner and their guide on one entry, the shape `import_from_entries()` writes. */
  async function makeGuidedTeam(
    eventId: string,
    fields: { team_number?: string | null; bib_leg2?: string | null } = {},
  ): Promise<string> {
    const teamId = await makeTeam(eventId, fields);
    await db.query(
      `insert into timing.runners (team_id, leg, firstname, lastname, role)
       values ($1, 1, 'Perpetua', 'Zzguided', 'runner'),
              ($1, 2, 'Octavius', 'Zzguide', 'guide')`,
      [teamId],
    );
    return teamId;
  }

  const crossingOn = async (eventId: string, bib: string) => {
    const { rows } = await db.query<{ team_id: string | null }>(
      `insert into timing.crossings (event_id, bib, captured_at)
       values ($1, $2, now()) returning team_id`,
      [eventId, bib],
    );
    return rows[0]?.team_id ?? null;
  };

  const rosterAs = (person: string, slug: string) =>
    asPerson<{ runners: { role: string; bib: string | null }[] }>(
      person,
      'select timing.desk_roster($1) as answer',
      [slug],
    );

  it("takes the guide's own number, and a crossing on it lands on their entry", async () => {
    const team = await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });

    expect(await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '9002')).toMatchObject({
      ok: true,
      leg: 2,
      bib: '9002',
    });

    expect(await crossingOn(SOLO_EVENT, '9002')).toBe(team);
    expect(await crossingOn(SOLO_EVENT, '12')).toBe(team);
  });

  /**
   * The display half, through the Roster's own read: a guide with no number written in shows
   * none — never their runner's, which is what it showed until ADR-061.
   */
  it('shows a guide as wearing no number until one is written in, then that number', async () => {
    const team = await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });

    const before = await rosterAs(IMPORTER, SOLO_SLUG);
    expect(before.runners.find((r) => r.role === 'guide')?.bib).toBeNull();
    expect(before.runners.find((r) => r.role === 'runner')?.bib).toBe('12');

    await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '9002');

    const after = await rosterAs(IMPORTER, SOLO_SLUG);
    expect(after.runners.find((r) => r.role === 'guide')?.bib).toBe('9002');
  });

  it("refuses the runner's own number for the guide", async () => {
    const team = await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });

    expect(await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '12')).toEqual({
      ok: false,
      reason: 'bib_taken',
      same_team: true,
    });
  });

  /**
   * Both directions, because the guard used to read leg 2 on a relay only: a guide cannot be
   * handed another entry's number, and no entry can be handed a guide's.
   */
  it("refuses another entry's number for a guide, and a guide's number for another entry", async () => {
    const guided = await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });
    const other = await makeTeam(SOLO_EVENT, { team_number: '13' });

    expect(await overrideAs(IMPORTER, SOLO_SLUG, guided, 2, '13')).toMatchObject({
      ok: false,
      reason: 'bib_taken',
      same_team: false,
      with_team_number: '13',
    });

    await overrideAs(IMPORTER, SOLO_SLUG, guided, 2, '9002');

    expect(await overrideAs(IMPORTER, SOLO_SLUG, other, 1, '9002')).toMatchObject({
      ok: false,
      reason: 'bib_taken',
      with_team_number: '12',
    });
  });

  /**
   * A guide who comes off an entry leaves their number behind — `import_from_entries()` never
   * touches an override. Clearing it must still work, or that number is stranded where no page
   * shows it and nobody can be given it.
   */
  it('clears a leg-two number after the guide has come off the entry', async () => {
    const team = await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });
    await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '9002');
    await db.query('delete from timing.runners where team_id = $1 and leg = 2', [team]);

    expect(await overrideAs(IMPORTER, SOLO_SLUG, team, 2, null)).toMatchObject({
      ok: true,
      bib: null,
    });
    expect(await overrideAs(IMPORTER, SOLO_SLUG, team, 2, '9003')).toMatchObject({
      ok: false,
      reason: 'no_such_leg',
    });
  });

  /**
   * ⚠️ **The runbook re-runs Assign bibs after late entries**, and a guide's number sits in the
   * same 001–250 range as everybody's. Without the step, the next late entry would be given the
   * guide's number and two people would resolve to one bib.
   */
  it('steps Assign bibs past a number a guide is wearing', async () => {
    await db.query('update timing.events set bib_pad_width = 3 where id = $1', [
      SOLO_EVENT,
    ]);
    await makeGuidedTeam(SOLO_EVENT, { team_number: '001', bib_leg2: '002' });
    await makeTeam(SOLO_EVENT);

    await assignBibsAs(IMPORTER, SOLO_SLUG);

    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number`,
      [SOLO_EVENT],
    );
    expect(rows.map((r) => r.team_number)).toEqual(['001', '003']);
  });

  it('steps a walk-in past a number a guide is wearing', async () => {
    await db.query('update timing.events set bib_pad_width = 3 where id = $1', [
      SOLO_EVENT,
    ]);
    await makeGuidedTeam(SOLO_EVENT, { team_number: '041', bib_leg2: '042' });

    expect(await walkInAs(IMPORTER, SOLO_SLUG, 'Wal', 'Kin')).toMatchObject({
      ok: true,
      team_number: '043',
    });
  });

  /**
   * The relay half of the same step. Team 2's bibs are `12` and `22`, so a spare vest written in
   * as `22` on team 1 means team 2 would share it.
   */
  it('steps Assign bibs past a relay number written in as an override', async () => {
    await makeTeam(RELAY_EVENT, { team_number: '1', bib_leg2: '22' });
    await makeTeam(RELAY_EVENT);

    await assignBibsAs(IMPORTER, RELAY_SLUG);

    const { rows } = await db.query<{ team_number: string }>(
      `select team_number from timing.teams where event_id = $1 order by team_number`,
      [RELAY_EVENT],
    );
    expect(rows.map((r) => r.team_number)).toEqual(['1', '3']);
  });

  it('tells the registration page which runner is the guide', async () => {
    await makeGuidedTeam(SOLO_EVENT, { team_number: '12' });

    const roster = await asPerson<{
      teams: { runners: { leg: number; role: string }[] }[];
    }>(IMPORTER, 'select timing.event_roster($1) as answer', [SOLO_SLUG]);

    expect(roster.teams[0]?.runners).toEqual([
      expect.objectContaining({ leg: 1, role: 'runner' }),
      expect.objectContaining({ leg: 2, role: 'guide' }),
    ]);
  });

  // ---------------------------------------------------------------------------------------
  // ⚠️ ADR-067, 25 October 2026: Assign bibs numbers a guide in the same press — straight after
  // their runner, or the next free number on an entry already numbered — so the desk has
  // nothing to type afterwards. "Never renumbers anybody" is unchanged.
  // ---------------------------------------------------------------------------------------

  const pad3 = () =>
    db.query('update timing.events set bib_pad_width = 3 where id = $1', [SOLO_EVENT]);

  const bibsOf = async (teamId: string) => {
    const { rows } = await db.query<{
      team_number: string | null;
      bib_leg2: string | null;
    }>('select team_number, bib_leg2 from timing.teams where id = $1', [teamId]);
    return rows[0];
  };

  /** Fixes the numbering order, so the answer cannot depend on two inserts' timestamps. */
  const inOrder = async (...ids: string[]) => {
    for (const [index, id] of ids.entries()) {
      await db.query('update timing.teams set csv_row_index = $2 where id = $1', [
        id,
        index + 1,
      ]);
    }
  };

  it('numbers a guide straight after their runner, in the same press', async () => {
    await pad3();
    const guided = await makeGuidedTeam(SOLO_EVENT);
    const plain = await makeTeam(SOLO_EVENT);
    await inOrder(guided, plain);

    expect(await assignBibsAs(IMPORTER, SOLO_SLUG)).toEqual({
      ok: true,
      assigned: 2,
      guides_numbered: 1,
      already_assigned: 0,
      first: '001',
      last: '003',
    });
    expect(await bibsOf(guided)).toEqual({ team_number: '001', bib_leg2: '002' });
    expect(await bibsOf(plain)).toEqual({ team_number: '003', bib_leg2: null });

    // The number given is a real one: a crossing typed on it lands on the guide's entry.
    expect(await crossingOn(SOLO_EVENT, '002')).toBe(guided);
  });

  /**
   * A guide added to an entry after it was numbered — a late re-import, or a number cleared —
   * cannot sit beside their runner any more, because that number is somebody else's.
   */
  it('gives a guide on an entry already numbered the next free number', async () => {
    await pad3();
    const guided = await makeGuidedTeam(SOLO_EVENT, { team_number: '001' });
    await makeTeam(SOLO_EVENT, { team_number: '002' });

    expect(await assignBibsAs(IMPORTER, SOLO_SLUG)).toEqual({
      ok: true,
      assigned: 0,
      guides_numbered: 1,
      already_assigned: 2,
      first: '003',
      last: '003',
    });
    expect(await bibsOf(guided)).toEqual({ team_number: '001', bib_leg2: '003' });
  });

  it("keeps a guide's number once they have one, and moves nobody on a second press", async () => {
    await pad3();
    const typed = await makeGuidedTeam(SOLO_EVENT, { bib_leg2: '090' });
    const fresh = await makeGuidedTeam(SOLO_EVENT);
    await inOrder(typed, fresh);

    await assignBibsAs(IMPORTER, SOLO_SLUG);
    // The desk typed 090 for the first guide before pressing, and it stands.
    expect(await bibsOf(typed)).toEqual({ team_number: '001', bib_leg2: '090' });
    expect(await bibsOf(fresh)).toEqual({ team_number: '002', bib_leg2: '003' });

    expect(await assignBibsAs(IMPORTER, SOLO_SLUG)).toMatchObject({
      assigned: 0,
      guides_numbered: 0,
    });
    expect(await bibsOf(typed)).toEqual({ team_number: '001', bib_leg2: '090' });
    expect(await bibsOf(fresh)).toEqual({ team_number: '002', bib_leg2: '003' });
  });

  /** A spare vest written in as `003` means the guide who would have had it gets `004`. */
  it('steps a guide past a number somebody is already wearing', async () => {
    await pad3();
    await makeTeam(SOLO_EVENT, { team_number: '001', bib_leg1: '003' });
    const guided = await makeGuidedTeam(SOLO_EVENT);

    await assignBibsAs(IMPORTER, SOLO_SLUG);

    expect(await bibsOf(guided)).toEqual({ team_number: '002', bib_leg2: '004' });
  });

  it('starts at the first number given, with the guide straight after', async () => {
    await pad3();
    const guided = await makeGuidedTeam(SOLO_EVENT);
    const plain = await makeTeam(SOLO_EVENT);
    await inOrder(guided, plain);

    expect(await assignFromAs(IMPORTER, SOLO_SLUG, 150)).toMatchObject({
      assigned: 2,
      guides_numbered: 1,
      first: '150',
      last: '152',
    });
    expect(await bibsOf(guided)).toEqual({ team_number: '150', bib_leg2: '151' });
    expect(await bibsOf(plain)).toEqual({ team_number: '152', bib_leg2: null });
  });

  /** A relay's leg 2 is a runner who derives their own bib, so a relay is never touched. */
  it('gives nothing on a relay a leg-2 number of its own', async () => {
    const team = await makeTeam(RELAY_EVENT);
    await db.query(
      `insert into timing.runners (team_id, leg, firstname, lastname, role)
       values ($1, 2, 'Octavius', 'Zzrelay', 'guide')`,
      [team],
    );

    expect(await assignBibsAs(IMPORTER, RELAY_SLUG)).toMatchObject({
      assigned: 1,
      guides_numbered: 0,
    });
    expect(await bibsOf(team)).toEqual({ team_number: '1', bib_leg2: null });
  });

  /** The two helpers are reachable from `assign_bibs()` and from nobody directly. */
  it('refuses its two helpers to a signed-in caller, with 42501', async () => {
    await expect(
      asPerson(IMPORTER, 'select timing.padded_bib(1, 3::smallint) as answer', []),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asPerson(
        IMPORTER,
        "select timing.free_number_from($1, 'solo', 3::smallint, 1) as answer",
        [SOLO_EVENT],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('a walk-in at the desk', () => {
  it('refuses somebody without the permission', async () => {
    expect(await walkInAs(NOBODY, SOLO_SLUG, 'Wal', 'Kin')).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('takes the next free number and carries no purchase', async () => {
    await makeTeam(SOLO_EVENT, { team_number: '41' });

    const answer = await walkInAs(IMPORTER, SOLO_SLUG, 'Wal', 'Kin');

    expect(answer.ok).toBe(true);
    expect(answer.team_number).toBe('42');

    const { rows } = await db.query<{
      purchase_order_id: string | null;
      firstname: string;
    }>(
      `select t.purchase_order_id, r.firstname from timing.teams t
         join timing.runners r on r.team_id = t.id
        where t.id = $1`,
      [answer.team_id],
    );
    expect(rows[0]).toEqual({ purchase_order_id: null, firstname: 'Wal' });
  });

  /**
   * The old application stored `""` for a walk-in's email, which is a value that reads as an
   * address somebody has and is not one.
   */
  it('leaves the email null rather than storing an empty string', async () => {
    const answer = await walkInAs(IMPORTER, SOLO_SLUG, 'Wal', 'Kin');

    const { rows } = await db.query<{ email: string | null }>(
      `select r.email from timing.runners r where r.team_id = $1`,
      [answer.team_id],
    );
    expect(rows[0]?.email).toBeNull();
  });

  it('refuses a walk-in with no name', async () => {
    expect((await walkInAs(IMPORTER, SOLO_SLUG, '  ', 'Kin')).reason).toBe('incomplete');
  });
});
