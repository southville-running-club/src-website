import { closeEntries, openEntries } from '../../entries-window';
import {
  clearPurchases,
  clearWebhookKey,
  installWebhookKey,
  seedPurchase,
} from '../../entries-db';
import {
  FIXTURE_AMOUNT_PENCE,
  FIXTURE_EMAIL,
  FIXTURE_FIRST_NAME,
  FIXTURE_LAST_NAME,
  LAPSED_PURCHASE_ID,
  LAPSED_SESSION_ID,
  PAID_PURCHASE_ID,
  PAID_SESSION_ID,
  PENDING_PURCHASE_ID,
  PENDING_SESSION_ID,
  SECOND_PURCHASE_ID,
  SECOND_SESSION_ID,
  WEBHOOK_KEY,
} from '../../webhook-fixtures';

/**
 * The state the webhook run needs, set rather than assumed, and put back afterwards.
 *
 * Four purchases with **fixed ids**, so tests running inside `workerd` can name them without
 * `pg` — see `webhook-fixtures.ts` for why that matters. Each is in a state the Worker must
 * handle differently, and each is written directly rather than through
 * `entries.create_pending_purchase()`, which would choose its own ids and could not produce a
 * `paid` row at all.
 *
 * **The window is opened** because `/nn/` is not what this run is about but the fixtures are
 * against the real event, and a closed window would make `create_pending_purchase` refuse if
 * anything here ever reached for it.
 *
 * **The webhook key digest is installed here and nowhere else.** It is removed in teardown even
 * when the run failed, so a laptop is never left holding a working key for a test secret.
 */

export async function setup(): Promise<void> {
  // Cleared before as well as after: a run that failed halfway leaves rows behind, and
  // "exactly one paid purchase" would then be counting somebody else's. The same lesson the
  // entry window taught during Slice A, one table along.
  await clearPurchases();
  await openEntries();
  await installWebhookKey(WEBHOOK_KEY);

  const common = {
    amountPence: FIXTURE_AMOUNT_PENCE,
    email: FIXTURE_EMAIL,
    firstName: FIXTURE_FIRST_NAME,
    lastName: FIXTURE_LAST_NAME,
  };

  await seedPurchase({
    ...common,
    id: PENDING_PURCHASE_ID,
    sessionId: PENDING_SESSION_ID,
    status: 'pending',
  });

  await seedPurchase({
    ...common,
    id: SECOND_PURCHASE_ID,
    sessionId: SECOND_SESSION_ID,
    status: 'pending',
  });

  await seedPurchase({
    ...common,
    id: PAID_PURCHASE_ID,
    sessionId: PAID_SESSION_ID,
    status: 'paid',
  });

  // A hold that ran out four minutes ago and which nothing has swept. **The state that must
  // never tell somebody nothing was charged**, because the webhook may simply be late.
  await seedPurchase({
    ...common,
    id: LAPSED_PURCHASE_ID,
    sessionId: LAPSED_SESSION_ID,
    status: 'pending',
    holdMinutes: -4,
  });
}

export async function teardown(): Promise<void> {
  await clearWebhookKey();
  await clearPurchases();
  await closeEntries();
}
