import { closeEntries } from '../entries-window';

/**
 * Puts the entry window into the state the migration seeds — **null, meaning nobody has
 * decided when entries open** — before the default worker run.
 *
 * Set rather than assumed. `tests/worker/serves.test.ts` asserts that `/nn/` quotes no
 * price and `tests/worker/nn-entry.test.ts` asserts it shows the interest form, and both are
 * true only while entries are shut. Leaving that to whatever the last run happened to do is
 * how a green suite starts failing on a laptop for reasons that read as a bug in the page.
 *
 * `pg` cannot run inside `workerd`, so this has to be a `globalSetup` — Vitest runs those in
 * the ordinary Node process before the pool starts — rather than a `beforeAll`.
 */
export async function setup(): Promise<void> {
  await closeEntries();
}
