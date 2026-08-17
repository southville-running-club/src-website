/**
 * The fixed values the admin run agrees on across a process boundary.
 *
 * **`pg` cannot run inside `workerd`**, so the rows a test asserts against are written by
 * Vitest's `globalSetup` in ordinary Node while the assertions run in the Workers runtime. The
 * only thing that can cross that boundary is a constant, which is why the ids here are fixed
 * rather than returned from an insert — the same arrangement `webhook-fixtures.ts` uses and for
 * the same reason.
 *
 * **Everything below is invented and authenticates to nothing.** The two keys exist only in this
 * file, in the Miniflare bindings that go with it, and — as digests — in a local Docker Postgres
 * that `global-setup.ts` cleans up afterwards.
 */

/** The Worker's shared key. Bound in `vitest.worker.admin.config.ts` under the same value. */
export const ADMIN_GATE_KEY = 'zz-admin-worker-gate-key-not-a-real-one';

/** One person's key, and the handle it belongs to. */
export const ADMIN_PERSON_KEY = 'zz-admin-worker-person-key-not-a-real-one';
export const ADMIN_HANDLE = 'zz-worker';

/** A second person, revoked, so the run can prove revocation shuts one door and not both. */
export const REVOKED_PERSON_KEY = 'zz-admin-worker-revoked-key-not-a-real-one';
export const REVOKED_HANDLE = 'zz-worker-gone';

/**
 * A fabricated running, and **never a running of `nn`**.
 *
 * `race_slug` is its own, so `entries.current_entry_state('nn')` cannot see it and the site's
 * front door does not depend on whether this run has happened. The purchases are against this
 * event rather than the real one for a second reason: `tests/entries-db.ts`'s `clearPurchases()`
 * deletes every purchase against `nn-2026` before each entry test, and a fixture there would
 * vanish partway through a suite.
 */
export const ADMIN_EVENT_SLUG = 'zz-admin-worker';
export const ADMIN_RACE_SLUG = 'zz-admin-worker-race';
export const ADMIN_EVENT_NAME = 'Worker Fixture Race';
export const ADMIN_EVENT_DATE = '2026-12-06';

/** Two places, four purchases, and one of them paid for a place that had gone. */
export const ADMIN_CAPACITY = 2;

export const PAID_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000001';
export const PENDING_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000002';
export const EXPIRED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000003';
export const OVER_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000004';
export const REFUNDED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000005';

export const PAID_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000011';
export const PENDING_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000012';
export const EXPIRED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000013';
export const OVER_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000014';
export const REFUNDED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000015';

/**
 * The awkward strings, split across two entrants **for a reason rather than for variety**.
 *
 * An apostrophe, an ampersand and a non-ASCII letter break naive HTML escaping; a comma and a
 * double quote break naive CSV. The two hazards have to be on entrants in different states,
 * because the two surfaces see different rows:
 *
 *   * the **list** shows every status, so the HTML hazard is on a `pending` entrant;
 *   * the **exports** carry paid entries only, so the CSV hazard is on a `paid` one.
 *
 * Putting both on one entrant is what the first version did, and the CSV assertion passed by
 * never having the row in the file at all.
 */
export const AWKWARD_FIRST_NAME = 'Inés';
export const AWKWARD_LAST_NAME = "O'Rourke";

/** On a **paid** entrant, so it reaches a CSV. A comma and a double quote in one field. */
export const AWKWARD_CLUB = 'Bristol & West AC, "the Bees"';

/** Also paid, and non-ASCII — which is what the byte-order mark exists for. */
export const PAID_NON_ASCII_LAST_NAME = 'Sørensen';

/** The entrant with a note, and the note. Nothing else in the run has one. */
export const MEDICAL_NOTE =
  'Asthma — blue inhaler in a waist belt. Allergic to ibuprofen.';

/** Format-checked, never verified — England Athletics publishes no verification API. */
export const PAID_EA_NUMBER = '1234567';
