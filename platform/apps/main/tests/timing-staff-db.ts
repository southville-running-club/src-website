import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  ADMIN_PASSWORD,
  TIMING_ADMIN_EMAIL,
  TIMING_MARSHAL_EMAIL,
} from './admin-fixtures';

/**
 * The two people `/timing`'s own pages are tested as, and nobody else.
 *
 * ## ⚠️ Why this is its own file rather than two more rows in `admin-db.ts`
 *
 * It was two more rows, and CI refused it. `timing.spec.ts` and `admin.spec.ts` both called
 * `seedAdminFixtures()`, so on whichever shard ran them together the two `beforeAll` hooks
 * raced to sign the same addresses up and the second got `AuthApiError: User already
 * registered` — a failure in setup, which takes the whole file down and reads like a broken
 * application rather than two tests fighting over one database.
 *
 * **One spec, one set of people it owns outright.** This file creates exactly two accounts and
 * deletes exactly those two; `admin-db.ts` never sees them and never deletes them. Nothing here
 * can make `admin.spec.ts` fail, which is the property that was missing.
 *
 * ## They hold timing roles and nothing else, deliberately
 *
 * Granting a timing role to one of the club-side fixtures would silently delete
 * `admin.spec.ts`'s "different doors" assertions — that `nn-admin`, `people-admin`,
 * `super-admin` and a plain `registered` account all get the ordinary 404 at `/timing`. Those
 * are the other half of this boundary and they have to keep meaning something.
 */

const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Cloudflare's published dummy token; `[auth.captcha]` locally holds the matching secret. */
const DUMMY_CAPTCHA_TOKEN = '1x00000000000000000000AA';

const PEOPLE: Record<string, string> = {
  [TIMING_ADMIN_EMAIL]: 'timing-admin',
  [TIMING_MARSHAL_EMAIL]: 'timing-marshal',
};

async function withClient<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/**
 * Cleared before as well as after — `admin-db.ts`'s rule, for its reason: a run that failed
 * halfway leaves the accounts behind, and the next `signUp` then answers "User already
 * registered" rather than doing anything useful.
 */
export async function seedTimingStaff(): Promise<void> {
  await clearTimingStaff();

  const anon = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Sequential, not parallel — each round trip is cheap, and running them concurrently would
  // race the confirmation update against whichever signUp it belongs to.
  for (const [email, role] of Object.entries(PEOPLE)) {
    const { error } = await anon.auth.signUp({
      email,
      password: ADMIN_PASSWORD,
      options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
    });
    if (error) throw error;

    await withClient(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'update auth.users set email_confirmed_at = now() where email = $1 returning id',
        [email],
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error(`signUp created no auth.users row for ${email}`);
      }

      await db.query(
        `insert into identity.role_grants (person_id, role) values ($1::uuid, $2)
         on conflict do nothing`,
        [id, role],
      );
    });
  }
}

/** Scoped to these two addresses by name, and never wider. */
export async function clearTimingStaff(): Promise<void> {
  await withClient(async (db) => {
    await db.query('delete from auth.users where email = any($1::text[])', [
      Object.keys(PEOPLE),
    ]);
  });
}
