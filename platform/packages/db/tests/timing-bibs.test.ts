import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { effectiveBib, type EventFormat, type Leg } from '@src/shared/timing/bib';

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
  it('refuses leg two on a solo race', async () => {
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
