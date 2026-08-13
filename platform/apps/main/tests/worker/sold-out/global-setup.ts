import { closeEntries, openEntries } from '../../entries-window';
import { restoreCapacity, sellOut } from '../../entries-db';

/**
 * Entries open, and every place gone.
 *
 * `sellOut()` sets the event's capacity to one and books it, which is the same state as far
 * as `entries.create_pending_purchase()` is concerned as 250 fabricated entries and is two
 * statements rather than five hundred. The place is `paid` rather than held, because a hold
 * would lapse partway through the run and turn a deterministic test into a slow flake.
 *
 * **Both halves are set rather than assumed, and both are put back.** A laptop left with a
 * capacity of one would make the next suite's first entry sell the race out, and the failure
 * would read as a bug in the page.
 */
export async function setup(): Promise<void> {
  await restoreCapacity();
  await openEntries();
  await sellOut();
}

export async function teardown(): Promise<void> {
  await restoreCapacity();
  await closeEntries();
}
