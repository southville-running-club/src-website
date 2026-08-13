import type { ChildProcess } from 'node:child_process';
import { closeEntries, openEntries } from '../../entries-window';
import { clearPurchases } from '../../entries-db';
import { startStripeStub, stopStripeStub } from '../../stripe-stub';

/**
 * Opens the entry window and starts the fake Stripe for the duration of this run, then puts
 * both back.
 *
 * The window is moved by the same `update` the committee will run when entries open — there
 * is no preview flag and no local-only var, so the switch under test is the one production
 * uses.
 *
 * **A second config rather than a `beforeAll`**, for two reasons that are both about the
 * state being global: `pg` cannot run inside `workerd`, and `tests/worker/serves.test.ts`
 * asserts that `/nn/` quotes no price — true exactly while entries are not open. Two runs
 * against two fixed states are deterministic; one run against a moving one is not.
 *
 * **The purchases are cleared before the run as well as after it.** A run that failed halfway
 * leaves rows behind, and "exactly one pending purchase" would then be counting somebody
 * else's — the same lesson the entry window taught during Slice A, one table along.
 */

let stub: ChildProcess | null = null;

export async function setup(): Promise<void> {
  await clearPurchases();
  await openEntries();
  stub = await startStripeStub();
}

/**
 * Back to the seeded state, even when the run failed — so a broken run does not leave a
 * laptop showing an entry form that should not be there, or a stray Node process on 8789.
 */
export async function teardown(): Promise<void> {
  await stopStripeStub(stub);
  await clearPurchases();
  await closeEntries();
}
