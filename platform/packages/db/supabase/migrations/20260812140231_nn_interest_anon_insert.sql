-- The anonymous-insert policy that `intake.nn_interest` was deliberately created without.
--
-- That migration said this would arrive "with the sign-up form that needs it, in the pull
-- request that can test it". This is that pull request. Until now RLS was on with
-- no policy, which denied everyone — the safe state to have been in, and a useless one to
-- ship a form against.
--
-- **Two independent locks, and this migration opens exactly one door through both.**
--
--   1. The **grant** decides which statements the anon role may attempt at all. Without one
--      the request is refused before row-level security is consulted — `42501`, which is
--      what `tests/seed.test.ts` asserts today and must keep asserting for select, update
--      and delete.
--   2. The **policy** decides which rows survive the attempt.
--
-- Granting one and forgetting the other is the mistake this arrangement is proof against:
-- a policy added carelessly later still opens nothing without a grant to go with it.

-- ---------------------------------------------------------------------------------------
-- The grant — insert, three named columns, and nothing else
-- ---------------------------------------------------------------------------------------
-- **Column-scoped deliberately.** `id` and `created_at` are absent from the list, so they
-- keep their defaults and a caller cannot supply either. That is what stops a submission
-- back-dating itself or choosing its own primary key, and it costs nothing: PostgREST
-- rejects the attempt with `42501` rather than silently ignoring the column.
--
-- **No select, update or delete for anon. Not now, not later.** There is no API tier
-- between the browser and Postgres, so this grant *is* the access control. A select grant
-- here would make the interest list readable by anyone holding the anon key, which is
-- published in client code by design — it would be a personal-data incident, not a bug.
--
-- The absence of a select grant has one visible consequence, and it is the right one: an
-- insert chained with `.select()` fails. The Worker — `apps/main/worker/nn-signup.ts`, which
-- is the only thing here that writes to this table — never asks for the row back, and
-- `tests/nn-interest.test.ts` asserts that asking fails.

grant insert (name, email, consent) on table intake.nn_interest to anon;

-- ---------------------------------------------------------------------------------------
-- The policy — insert only, with an explicit check
-- ---------------------------------------------------------------------------------------
-- `with check` is stated rather than left to default, because a policy without one accepts
-- every row the grant let through, and "it was implied" is not something the next person
-- can read off the schema.
--
-- **It mirrors the table's own constraints and says nothing about consent.** That is
-- deliberate on both counts:
--
--   * Mirroring `length(trim(name)) between 1 and 100` and `position('@' in email) > 1`
--     means a row rejected by the policy is rejected for a reason already written into the
--     table, so the two cannot drift into disagreeing about what a valid row is.
--
--   * **Staying neutral on consent is what keeps the committee's decision reversible.**
--     The form currently requires the box to be ticked before it will submit, which is a
--     two-line change in the Zod schema to undo. Had that requirement been written into
--     this policy as `and consent`, undoing it would need a second migration against a
--     live table — and `consent` is `not null` with `false` a legitimate stored value, as
--     the table's own comment says. The form decides whether an unconsented submission is
--     offered; the database decides only that the field was answered.
--
-- Insert only. No `for select`, no `for update`, no `for delete` — and with no grant behind
-- them those statements are refused a step earlier anyway.

create policy "anon may record an expression of interest, and read nothing back"
  on intake.nn_interest
  for insert
  to anon
  with check (
    length(trim(name)) between 1 and 100
    and position('@' in email) > 1
  );

-- ---------------------------------------------------------------------------------------
-- Why this is safe to deploy in either order
-- ---------------------------------------------------------------------------------------
-- **Nothing sequences this migration against the Cloudflare deploy.** Workers Builds
-- triggers on the push, not on a green CI run, so this and the Worker that uses it go out
-- concurrently and in no guaranteed order. Both directions are survivable:
--
--   * **Migration first, Worker later.** The currently deployed code never inserts, so a
--     grant it does not use changes nothing for it.
--
--   * **Worker first, migration later.** Every insert fails with `42501` for as long as the
--     window lasts. The Worker treats that as `unavailable` — a 503 that keeps what the
--     person typed and tells them to try again, rather than a 500 or, far worse, a
--     confirmation for a row that was never written.
--
-- Expand, migrate, contract: this is the expand step, and it has no contract step to follow
-- because it removes nothing.
