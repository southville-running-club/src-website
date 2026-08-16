import { clearAdminFixtures, seedAdminFixtures } from '../../admin-db';

/**
 * The state the admin run needs, set rather than assumed, and put back afterwards.
 *
 * **Cleared before as well as after.** A run that failed halfway leaves rows behind, and
 * "exactly five entrants" would then be counting somebody else's — the lesson the entry window
 * taught during Slice A, two tables along.
 *
 * The teardown matters more here than in any other run: it is what takes the admin key's digest
 * back out of the local database. Left installed, a laptop would be sitting there with a working
 * admin surface whose key is written in a test file.
 */

export async function setup(): Promise<void> {
  await seedAdminFixtures();
}

export async function teardown(): Promise<void> {
  await clearAdminFixtures(null);
}
