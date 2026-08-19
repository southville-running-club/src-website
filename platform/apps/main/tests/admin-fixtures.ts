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

/** Two places, six purchases, and one of them paid for a place that had gone. */
export const ADMIN_CAPACITY = 2;

export const PAID_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000001';
export const PENDING_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000002';
export const EXPIRED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000003';
export const OVER_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000004';
export const REFUNDED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000005';
export const MISSING_EA_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000006';

export const PAID_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000011';
export const PENDING_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000012';
export const EXPIRED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000013';
export const OVER_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000014';
export const REFUNDED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000015';
export const MISSING_EA_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000016';

/**
 * The state the affiliation panel exists to catch: **paid, on a fee that requires an England
 * Athletics number, with no number.**
 *
 * It is written directly here for the same reason every other row is, but it is worth saying that
 * this one is **not merely a fabricated state — it is reachable in production.**
 * `packages/shared/src/nn-entry.ts` requires the number whenever the chosen fee does, and drops
 * it whenever the fee does not; but that is the *form's* control.
 * `entries.create_pending_purchase()` takes its entrants as `jsonb`, writes `ea_number` straight
 * through with no check that a fee requiring one got one, and **is granted to `anon`** — so two
 * ordinary PostgREST calls with the published anon key produce exactly this row. `minimum_age` is
 * re-checked inside that function and is the control; the England Athletics rule is not.
 *
 * That is why the count is on the page rather than removed as unreachable: it is the £2-a-runner
 * affiliation discount being claimed without the number that justifies it.
 */
export const MISSING_EA_LAST_NAME = 'Pemberton';

/**
 * A second event, with **nothing wrong with it**.
 *
 * The attention panel renders only when something is flagged, and "only" is half the requirement —
 * a panel that is always there is one people learn to scroll past. Proving the absence needs an
 * event with no flagged purchase in it, and proving it on the *same* event as the presence is not
 * possible: the flag is a column on a purchase, not a filter on a page.
 *
 * Its own `race_slug` again, so `entries.current_entry_state('nn')` cannot see it either. Ten
 * places and two paid entries, so the field is neither full nor over and the capacity bar is in
 * its ordinary state.
 */
export const CLEAN_EVENT_SLUG = 'zz-admin-clean';
export const CLEAN_RACE_SLUG = 'zz-admin-clean-race';
export const CLEAN_EVENT_NAME = 'Quiet Fixture Race';
export const CLEAN_EVENT_DATE = '2026-12-13';
export const CLEAN_CAPACITY = 10;

export const CLEAN_PAID_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000021';
export const CLEAN_HELD_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000022';
export const CLEAN_PAID_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000031';
export const CLEAN_HELD_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000032';

export const CLEAN_PAID_LAST_NAME = 'Ferreira';
export const CLEAN_HELD_LAST_NAME = 'Underhill';

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
