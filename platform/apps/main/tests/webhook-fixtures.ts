/**
 * The fixed values the webhook run is built on.
 *
 * **Constants only, and no import of anything.** This module is read from two places that
 * cannot share code any other way: Vitest's `globalSetup`, which runs in ordinary Node and
 * seeds the rows, and the tests themselves, which run **inside `workerd`** and cannot use `pg`.
 * A single `import { Client } from 'pg'` here would break the second half.
 *
 * **Fixed UUIDs rather than generated ones**, as everywhere else in this repository's
 * fixtures. A random id would make a failing assertion unreproducible, and these have to be
 * agreed on across a process boundary in any case.
 */

/** The secrets the pool binds. Neither authenticates to anything — see the config. */
export const WEBHOOK_SECRET = 'whsec_TEST_NOT_A_REAL_SIGNING_SECRET_000000';
export const WEBHOOK_KEY = 'zz-worker-test-key-not-a-real-one';

/** A purchase with a live hold, waiting for its payment. The ordinary case. */
export const PENDING_PURCHASE_ID = '11111111-1111-4111-8111-111111111111';
export const PENDING_SESSION_ID = 'cs_test_worker_pending';

/** A second one, so a test can pay one without disturbing the other. */
export const SECOND_PURCHASE_ID = '22222222-2222-4222-8222-222222222222';
export const SECOND_SESSION_ID = 'cs_test_worker_second';

/** Already `paid`, for the complete page's confirmed state. */
export const PAID_PURCHASE_ID = '33333333-3333-4333-8333-333333333333';
export const PAID_SESSION_ID = 'cs_test_worker_paid';

/** A hold that ran out. The state that must never say "nothing was charged". */
export const LAPSED_PURCHASE_ID = '44444444-4444-4444-8444-444444444444';
export const LAPSED_SESSION_ID = 'cs_test_worker_lapsed';

/** Names nothing at all. What somebody who types the address gets. */
export const UNKNOWN_SESSION_ID = 'cs_test_worker_never_existed';

/**
 * The amount every fixture purchase is for, in pence. The `unaffiliated` fee, which is what
 * `entries.fees` charges for the real race.
 */
export const FIXTURE_AMOUNT_PENCE = 1700;

/**
 * The address on every fixture purchase.
 *
 * **`@example.com`, and the acceptance and worker suites assert it never reaches a page.** It
 * is here so that "no personal data leaks" is testable at all: a fixture without an address
 * could not prove the absence of one.
 */
export const FIXTURE_EMAIL = 'worker-webhook@example.com';
export const FIXTURE_FIRST_NAME = 'Grace';
export const FIXTURE_LAST_NAME = 'Hopper';
