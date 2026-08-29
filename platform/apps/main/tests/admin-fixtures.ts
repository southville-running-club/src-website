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
 * The people the staff backend is tested through, one per role set the door has to tell apart.
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

/**
 * Holds `people-admin`, and that is the whole of it.
 *
 * **Staff, unlike `NN_TESTER_EMAIL`, and that is the pair worth having.** Both hold exactly one
 * permission and neither may grant a role, so the two of them are what tells `isStaff()`'s
 * question — "is this person staff" — apart from `can()`'s — "may they do this particular
 * thing". This person is let through the door at `/admin/` and gets `/admin/people/` with no
 * controls on it; the tester gets the same 404 as `REGISTERED_EMAIL`.
 *
 * They are also the reason the roles page has two readings to assert rather than one.
 */
export const PEOPLE_ADMIN_EMAIL = 'zz-admin-worker-people@example.com';

export const FIXTURE_PEOPLE_EMAILS = [
  NN_ADMIN_EMAIL,
  REGISTERED_EMAIL,
  SUPER_ADMIN_EMAIL,
  NN_TESTER_EMAIL,
  PEOPLE_ADMIN_EMAIL,
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
export const SECOND_AFFILIATED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000006';

export const PAID_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000011';
export const PENDING_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000012';
export const EXPIRED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000013';
export const OVER_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000014';
export const REFUNDED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000015';
export const SECOND_AFFILIATED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000016';

/**
 * A second paid affiliated entry, so the **Affiliated entries** figure counts past one.
 *
 * **This row modelled something else until 29 August 2026** and the change is worth recording,
 * because the row survived the thing it was written for. It was *paid, on a fee requiring an
 * England Athletics number, with no number* — a state `create_pending_purchase()` once permitted
 * through the published anon key and Slice G closed, so it had to be seeded with the entrant
 * triggers suppressed. The panel above it existed to surface exactly that.
 *
 * The club then stopped asking for numbers altogether, so there is no such state to model: every
 * affiliated entry has no number and that is now correct rather than a defect. The row is kept
 * as an ordinary second affiliated entry, written the ordinary way, because what the panel
 * counts — how many entries owe no Unattached Runner Levy under ARC Rule 21(2)(b) — still needs
 * a count that is not one.
 */
export const SECOND_AFFILIATED_LAST_NAME = 'Pemberton';

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
 * A third event, and **the only one anything is allowed to destroy**.
 *
 * Cancelling refunds a purchase and deletes its entrants; transferring replaces the runner and
 * deletes their medical note; assigning adds a place. All three are irreversible within a run,
 * so pointing them at the oversold event or the quiet one would leave every later assertion in
 * this file reading a table the earlier tests had already changed — and which tests those are
 * depends on the order Playwright happens to run them in.
 *
 * So the destructive tests get their own running with nothing else asserted about it. Its own
 * `race_slug` again, so `entries.current_entry_state('nn')` cannot see it either, and ten places
 * so that assigning one is nowhere near the capacity edge.
 */
export const ACTIONS_EVENT_SLUG = 'zz-admin-actions';
export const ACTIONS_RACE_SLUG = 'zz-admin-actions-race';
export const ACTIONS_EVENT_NAME = 'Actions Fixture Race';
export const ACTIONS_EVENT_DATE = '2026-12-20';
export const ACTIONS_CAPACITY = 10;

/** Paid, and cancelled by the test that proves the refund returns the place. */
export const CANCELLABLE_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000041';
export const CANCELLABLE_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000051';
export const CANCELLABLE_LAST_NAME = 'Banerjee';

/** Paid, **with a medical note**, so the transfer test can prove the note goes with the runner. */
export const TRANSFERABLE_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000042';
export const TRANSFERABLE_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000052';
export const TRANSFERABLE_LAST_NAME = 'Lindqvist';

/**
 * Paid, and **bought with `REGISTERED_EMAIL`'s address**, which is what puts it on that
 * person's `/account/entries/`. `my_entries()` matches on `person_id` *or* on a
 * `purchaser_email` equal to the caller's confirmed address, and this fixture is the second
 * of those — the state a purchase sits in when somebody entered without being signed in.
 */
export const OWNED_PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000043';
export const OWNED_ENTRANT_ID = '0b0b0b0b-0000-4000-8000-000000000053';
export const OWNED_LAST_NAME = 'Achterberg';

/** Who a transferred place ends up with. Nobody who already holds one. */
export const TRANSFER_TO_FIRST_NAME = 'Rosalind';
export const TRANSFER_TO_LAST_NAME = 'Nakamura';
export const TRANSFER_TO_EMAIL = 'rosalind@example.com';

/** Who a complimentary place is given to. */
export const ASSIGN_TO_FIRST_NAME = 'Kinsi';
export const ASSIGN_TO_LAST_NAME = 'Warsame';
export const ASSIGN_TO_EMAIL = 'kinsi@example.com';

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

/**
 * A well-formed England Athletics number that **must not appear anywhere**.
 *
 * It is not seeded — `entrants_ea_number_not_collected` refuses a value in that column, so it
 * cannot be. It is here so the assertions that the club neither asks for nor holds one have a
 * concrete string to look for, on the entry form and in every export, rather than asserting the
 * absence of a column name and calling that coverage.
 */
export const NEVER_STORED_EA_NUMBER = '1234567';

/**
 * The one entrant in the run who answered the optional gender question, and the answer.
 *
 * **On a paid entrant on purpose, which is the opposite of the usual reason.** Everywhere else
 * in this file "paid" means "reaches a CSV, so assert it survives the encoding". Here it means
 * "reaches a CSV *if something is wrong*" — the exports carry paid entries only, so putting the
 * value on a paid runner is what gives `nn-admin.spec.ts` a real chance to fail if
 * `read_export()` ever starts carrying it. On a pending entrant the absence assertion would
 * pass by the row not being in the file at all, which is the trap `AWKWARD_CLUB` above records.
 *
 * Deliberately a word that is on none of the three category options, because that is the whole
 * point of the field — see ADR-020.
 */
export const PAID_GENDER_IDENTITY = 'Genderqueer';
