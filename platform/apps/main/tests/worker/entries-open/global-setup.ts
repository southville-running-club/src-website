import type { ChildProcess } from 'node:child_process';
import { closeEntries, openEntries } from '../../entries-window';
import {
  clearDiscountCodes,
  clearPurchases,
  installDiscountCode,
} from '../../entries-db';
import { startStripeStub, stopStripeStub } from '../../stripe-stub';
// **The code this run exercises**: the shape of the club's actual Long Ashton one — 10% off,
// capped, and scoped to the unaffiliated fee, so applying it to the affiliated entry is refused.
// It lives in a module of its own because the test that asserts on it runs inside `workerd`,
// where this file's `pg` import cannot load.
import { FIXTURE_DISCOUNT } from './fixture-discount';

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
  await clearDiscountCodes();
  await installDiscountCode({
    code: FIXTURE_DISCOUNT,
    percentOff: 10,
    maxUses: 5,
    feeCode: 'unaffiliated',
  });
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
  await clearDiscountCodes();
  await closeEntries();
}
