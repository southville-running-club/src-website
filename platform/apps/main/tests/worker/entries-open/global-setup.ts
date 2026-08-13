import { closeEntries, openEntries } from '../../entries-window';

/**
 * Opens the entry window for the duration of this run, and closes it again afterwards.
 *
 * The window is moved by the same `update` the committee will run when entries open — there
 * is no preview flag and no local-only var, so the switch under test is the one production
 * uses.
 *
 * **A second config rather than a `beforeAll`**, for two reasons that are both about the
 * state being global: `pg` cannot run inside `workerd`, and `tests/worker/serves.test.ts`
 * asserts that `/nn/` quotes no price — true exactly while entries are *not* open. Two runs
 * against two fixed states are deterministic; one run against a moving one is not.
 */
export async function setup(): Promise<void> {
  await openEntries();
}

/**
 * Back to the seeded state, even when the run failed — so a broken run does not leave a
 * laptop showing an entry form that should not be there.
 */
export async function teardown(): Promise<void> {
  await closeEntries();
}
