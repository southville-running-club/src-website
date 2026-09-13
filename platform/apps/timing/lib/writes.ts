import { cookies } from 'next/headers';
import { createUserClient } from '@src/shared';
import { ACCESS_COOKIE } from '@src/shared/session-cookies';
import { config, type TimingFunction } from './reads';

/**
 * Calling a `timing` function that **changes something**, as the signed-in person.
 *
 * ## Why this is a second file rather than a second export of `reads.ts`
 *
 * A read and a write are answered differently and the difference is not cosmetic.
 * {@link TimingRead} has three outcomes because a read's `null` means *"you may not, or it is
 * not there"* — deliberately indistinguishable. A write's refusal is **not** a secret in the
 * same way: by the time somebody posts this form the door has already admitted them, so the
 * function's own `reason` is something the page can and should say out loud. Two shapes, two
 * files, and neither tempted to grow the other's branch.
 *
 * ## What is not here, and must not be
 *
 * **No service key, ever, and no second authorisation check.** The call carries the person's
 * own access token, so `identity.has_permission()` inside each function resolves against
 * `auth.uid()`. Every refusal below is the database's — `packages/db/tests/timing.test.ts`
 * re-attempts each one anonymously, which is the assertion that actually holds the property.
 * A check in this file would be a third statement of a rule that already has two, and the
 * third is the one that goes stale.
 */

/**
 * What a `timing` write answers: the function's own `{ ok, reason }`, or that the call itself
 * did not complete.
 *
 * ⚠️ **`unavailable` is not a refusal and may never be rendered as one.** `reads.ts`'s header
 * carries the full argument; the write-side cost is worse than the read-side one, because a
 * page that says *"that was refused"* after an outage tells a volunteer they are not allowed
 * to do something they are allowed to do, on the morning they are building a start line.
 */
export type TimingWrite =
  | {
      state: 'ok';
      /**
       * What the function said besides `ok` — `teams_created`, `assigned`, and so on.
       *
       * ⚠️ **Added for #202 and deliberately not typed per function.** The entry-list page
       * quotes these back (*"12 entries and 12 runners on the start list"*), and a caller
       * that wants one reads it with `intFrom()` and renders nothing when it is absent —
       * because *"0 entries"* is a claim about a race and *"the page was not told"* is not.
       * A per-function type would be a fourth statement of shapes the migration, the
       * generated types and the test already carry.
       */
      data: Record<string, unknown>;
    }
  | { state: 'refused'; reason: string }
  | { state: 'unavailable' };

/** What every write function in `timing` returns. Narrower than `jsonb`, which is its type. */
interface WriteResult {
  ok?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

export async function writeTiming(
  fn: TimingFunction,
  args: Record<string, unknown>,
): Promise<TimingWrite> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    // The middleware refuses a request with no token long before this runs, so reaching here
    // means the cookie went missing between the gate and the post. Not an outage — and not a
    // silent success either, which is the half that matters for a write.
    return { state: 'refused', reason: 'refused' };
  }

  try {
    const asPerson = createUserClient(await config(), accessToken);
    // `.schema('timing')` is not optional — `createUserClient` pins `db.schema` to `identity`.
    // `reads.ts`'s header carries the whole class of bug.
    const { data, error } = await asPerson.schema('timing').rpc(fn, args as never);

    if (error) {
      // A code and a message, never a row — and never the arguments, which name a person.
      console.error(`timing: ${fn} unavailable — ${error.code}: ${error.message}`);
      return { state: 'unavailable' };
    }

    const result = (data ?? {}) as WriteResult;

    if (result.ok === true) {
      return { state: 'ok', data: result as Record<string, unknown> };
    }

    return {
      state: 'refused',
      reason: typeof result.reason === 'string' ? result.reason : 'refused',
    };
  } catch (cause) {
    console.error(
      `timing: ${fn} threw — ${cause instanceof Error ? cause.message : cause}`,
    );
    return { state: 'unavailable' };
  }
}
