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

/**
 * The two credentials the surface used to be opened by.
 *
 * **Nothing in the Worker reads either of them any more.** #58 moved the surface to `/admin/`
 * and behind `identity`'s roles; #57 left the four key-gated database functions in place and
 * #63 removes them. They are still seeded because the audit trail is the thing that has to
 * survive the change of identity scheme: a row written under the key scheme carries a handle
 * and a row written under the role scheme carries a uuid, and the runbook's "who has read
 * medical data" query must return both — `admin-db.ts`'s `medicalReadAudit()` is that
 * query, and `tests/worker/admin/admin.test.ts` asserts that it returns both shapes.
 */
export const ADMIN_GATE_KEY = 'zz-admin-worker-gate-key-not-a-real-one';
export const ADMIN_PERSON_KEY = 'zz-admin-worker-person-key-not-a-real-one';
export const ADMIN_HANDLE = 'zz-worker';
export const REVOKED_PERSON_KEY = 'zz-admin-worker-revoked-key-not-a-real-one';
export const REVOKED_HANDLE = 'zz-worker-gone';

/**
 * The three people the staff backend is tested through, one per role set the door has to tell
 * apart.
 *
 * **Real accounts, created through `signUp()` and confirmed the way a mailbox click would**, so
 * `identity.handle_new_user()` fires exactly as production will and the `registered` grant every
 * account gets is real rather than fabricated. The roles on top are inserted directly, because
 * `identity.grant_role()` needs a caller who already holds `super-admin` and the only address
 * the migration reserves that for is the club's own.
 *
 * **The super-admin is the reason teardown matters more here than anywhere else.**
 * `identity.revoke_role()` refuses to remove *the last* active super-admin grant, so
 * `packages/db/tests/identity.test.ts`'s assertion about that refusal is a claim about the
 * whole table — the one property in this repository that cannot be scoped to an invented
 * address. A super-admin left behind by a failed run makes it false. `seedAdminFixtures` clears
 * before it seeds and `clearAdminFixtures` runs whatever happened, for that reason and not for
 * tidiness.
 */
export const ADMIN_PASSWORD = 'zz-admin-worker-fixture-password';

/** Holds `nn-admin`. The person the Nightingale Nightmare section is read as. */
export const NN_ADMIN_EMAIL = 'zz-admin-worker-nn@example.com';

/** Holds `registered` and nothing else — everybody with an account. Gets the 404. */
export const REGISTERED_EMAIL = 'zz-admin-worker-member@example.com';

/** Holds `super-admin` and **not** `nn-admin`, which is what makes #59's page testable and
 *  what proves granting a role is not inheriting one. */
export const SUPER_ADMIN_EMAIL = 'zz-admin-worker-super@example.com';

/**
 * Holds `nn-tester`, and that is the whole of it.
 *
 * **Not staff**, which is the property worth having a fixture for: `nn-tester` carries a
 * permission, so an `isStaff()` written as "holds any permission" would let this person into
 * `/admin/`. They get the same 404 as `REGISTERED_EMAIL`, and what they *can* do is see the entry
 * form on `/nn/2026/` while entries are shut to everybody else.
 */
export const NN_TESTER_EMAIL = 'zz-admin-worker-tester@example.com';

export const FIXTURE_PEOPLE_EMAILS = [
  NN_ADMIN_EMAIL,
  REGISTERED_EMAIL,
  SUPER_ADMIN_EMAIL,
  NN_TESTER_EMAIL,
] as const;

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
 * It is written directly here for the same reason every other row is. **It used to be reachable
 * in production and no longer is.** `packages/shared/src/nn-entry.ts` required the number whenever
 * the chosen fee did — but that was the *form's* control, and
 * `entries.create_pending_purchase()` wrote `ea_number` straight through with no reference to
 * `fees.requires_ea_number` while being granted to `anon`, so two ordinary PostgREST calls with
 * the published anon key produced exactly this row. Slice G closed it, in the function and again
 * in `entries.assert_entrant_rules()`.
 *
 * **So this row is now seeded as history**, with `preEnforcement: true` suppressing the trigger —
 * and that is precisely why the count stays on the page. A trigger only ever sees a write, and
 * Slice G's check constraints are `NOT VALID` because nobody could see production's existing rows.
 * A pre-enforcement affiliated entry with no number is a state that can still *exist*, and this
 * count is the only thing that would surface it.
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
