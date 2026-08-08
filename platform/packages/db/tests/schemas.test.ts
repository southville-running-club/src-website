import { describe, expect, it, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * Database tests, against a real Postgres.
 *
 * These need the local stack — `npm run db:start`. That Docker dependency is the one
 * genuinely awkward thing in otherwise-boring tooling, and it buys the only thing that
 * matters here: grants and policies tested rather than mocked. There is no API tier
 * between the browser and Postgres, so this *is* the access control. A mock would test
 * the mock.
 *
 * The assertion that matters most is the negative one. That `intake.health()` works
 * proves the pipeline; that `club` is unreachable proves the boundary, and it is worth
 * having that assertion passing before there is anything in `club` to leak.
 */

// Fixed local credentials — every machine's `supabase start` prints these same values.
// They are demo keys for a database that lives in Docker and holds nothing.
const LOCAL_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const anon = createClient(LOCAL_URL, LOCAL_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

beforeAll(() => {
  if (!LOCAL_ANON_KEY) {
    throw new Error(
      'SUPABASE_ANON_KEY is not set. Run `npm run db:start` and export the anon key it prints.',
    );
  }
});

describe('intake — reachable, but only just', () => {
  it('lets an anonymous client call health()', async () => {
    const { data, error } = await anon.schema('intake').rpc('health');

    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    // It returns now(), so it should be within a minute of now.
    expect(Math.abs(Date.now() - new Date(data as string).getTime())).toBeLessThan(
      60_000,
    );
  });

  it('returns a timestamp Postgres agrees is UTC', async () => {
    const { data } = await anon.schema('intake').rpc('health');
    // PostgREST renders timestamptz with an explicit offset. Storing UTC is the
    // requirement; what the page does with it is london-time.ts's problem.
    expect(data as string).toMatch(/(\+00:00|Z)$/);
  });
});

describe('club — closed', () => {
  it('is not exposed through PostgREST at all', async () => {
    // `club` is deliberately absent from config.toml's api.schemas, so PostgREST has no
    // route to it regardless of what grants say. This is the outer of two locks.
    const { error } = await anon.schema('club').from('members').select('*');

    expect(error).not.toBeNull();
    // Asserting the code, not merely that something failed. Without this the test would
    // keep passing if `club` were exposed and the failure became "table does not exist" —
    // which is the moment it stops testing anything.
    expect(error?.code).toBe('PGRST106');
    expect(error?.hint).not.toContain('club');
  });

  it('cannot be reached by an anonymous client even by name', async () => {
    const { data, error } = await anon.schema('club').rpc('anything');

    expect(error?.code).toBe('PGRST106');
    expect(data).toBeNull();
  });
});

describe('the timing platform is not touched', () => {
  it('leaves public.events readable, exactly as the timing app left it', async () => {
    // The website reads timing data; it never writes it. This asserts the skeleton has
    // not disturbed the public-read policy the live leaderboard depends on.
    //
    // Locally `public` is empty — the timing app's migrations live in `src-race-timing`
    // and are not applied here — so a missing-table error is the expected local result.
    // What must never happen is a *permission* error, which would mean this repository
    // had changed something it does not own.
    const { error } = await anon.from('events').select('id').limit(1);

    if (error) {
      expect(error.message).not.toMatch(/permission denied/i);
    }
  });
});
