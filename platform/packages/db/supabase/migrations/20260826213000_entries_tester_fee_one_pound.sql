-- The tester fee costs a pound, because a penny is below what Stripe will charge.
--
-- =========================================================================================
-- What was wrong
-- =========================================================================================
-- `20260826173000_entries_tester_person_and_cancel.sql` seeded this fee at 1p, so that a real
-- card could prove the club's live Stripe account before entries open without the club
-- meaningfully paying for it. **Stripe will not take 1p.** There is a minimum charge amount
-- per currency and for GBP it is £0.30, so `POST /v1/checkout/sessions` refuses the session
-- outright and the rehearsal that fee exists for cannot happen.
--
-- Nobody found this by reading the code, because the code is right: it sends the amount the
-- row says. It was found by setting up the live account and reading Stripe's own limits,
-- which is the only place the number lives.
--
-- =========================================================================================
-- Why this failed in the most expensive way it could
-- =========================================================================================
-- Worth writing down, because the ordering is not obvious and the same shape will recur for
-- any fee priced between zero and the floor.
--
-- `worker/nn-entry.ts` guards a *free* place before anything is written — a £0 fee never
-- reaches Stripe and never holds a place. 1p is not £0, so it passed that guard, passed the
-- zero-amount backstop after it, and **held a place under the advisory lock** before
-- `createCheckoutSession()` was called and refused. The result is a 503, a place gone from a
-- 250-runner field for thirty-one minutes, and an error that reads like an outage rather
-- than like a misconfigured row.
--
-- Nothing is lost — the hold lapses — but a rehearsal that consumes a place and reports an
-- outage is not a rehearsal anybody trusts.
--
-- =========================================================================================
-- Why £1 and not £0.30
-- =========================================================================================
-- 30p is the floor. A value sitting exactly on a floor is one currency-rounding rule or one
-- Stripe pricing update away from being under it again, and the failure mode is the one
-- above: a held place and a 503, discovered by whoever is rehearsing rather than by a test.
--
-- £1 is unambiguously chargeable, is still small enough that nobody minds it, and reads as
-- deliberate rather than as an amount somebody derived. The Stripe fee on it is about 22p,
-- which is the real cost of a rehearsal and is worth it.
--
-- **It stays permission-gated and it stays labelled "(do not use)".** Neither of those
-- changes here, and both are what keep it off a page a runner can reach.
--
-- =========================================================================================
-- The earlier migration's comment is now wrong, and it is deliberately not edited
-- =========================================================================================
-- `20260826173000` describes a 1p fee at length and has been applied to production. Editing
-- an applied migration is how a schema history stops matching what actually ran, so it is
-- left alone and this file is the correction. Anybody reading the fee's history reads both,
-- in order, which is the point of expand-migrate-contract applying to prose as well.
--
-- The documents a person actually reads — CLAUDE.md, the entries-open runbook, and
-- `apps/main/README.md`'s manual steps — are corrected in the same commit as this file.

update entries.fees as fee
   set price_pence = 100
  from entries.events as event
 where fee.event_id = event.id
   and event.slug = 'nn-2026'
   and fee.code = 'tester';
