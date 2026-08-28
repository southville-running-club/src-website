/**
 * The discount code this run exercises.
 *
 * **Its own module, and that is the whole reason it exists.** `global-setup.ts` installs it and
 * `nn-entry-open.test.ts` asserts on it, and those two run in different places: the setup runs
 * in Node, where it can reach Postgres, and the test runs inside `workerd`, where **`pg` cannot
 * load at all**. Importing the constant from the setup dragged `pg` into the Workers bundle and
 * the whole config died with `Cannot use import statement outside a module` — which reads as a
 * build problem and is really the runtime boundary this file exists to respect.
 *
 * So the string lives here, where nothing else does, and both sides import it. Restating it in
 * two places would be the other answer, and it is the one where the assertion and the row come
 * apart without anything saying so.
 *
 * A fixture string rather than anything resembling a real code, for the reason
 * `docs/delivery/runbooks/entries-discount-codes.md` gives at length: a code in this repository
 * is a published code, and this repository is public.
 */
export const FIXTURE_DISCOUNT = 'ZZ-FIXTURE-TENPERCENT';
