-- Left Handed Giant's allocation is 25 places, not 22.
--
-- =========================================================================================
-- The change
-- =========================================================================================
-- Agreed 30 August 2026 — [#157]. The code itself is untouched: same code, same 10%, same
-- `unaffiliated` fee scoping, same 2026 event. Only how many times it may be used moves.
--
-- **It cannot fail.** `discount_codes_within_max_uses` is `uses <= max_uses`, so *raising* the
-- cap can never conflict with places already taken. The reverse would not be true, and a
-- migration lowering this one would need to read `uses` first.
--
-- =========================================================================================
-- Why this is a migration and not a hand-run update
-- =========================================================================================
-- [#157] proposes the `update` below as a step somebody runs against production and confirms
-- on `/admin/nn/`. That works, and it leaves every other environment at 22 — including the one
-- a fresh `db reset` produces, which is what `packages/db/tests/entries.test.ts` asserts
-- against. The test asserts the **number**, not merely a comment about it, so a hand-run edit
-- would have put the club's own documentation and its own test suite on opposite sides of the
-- same fact: CLAUDE.md and the entries-open runbook saying 25, a green test saying 22.
--
-- That is exactly the failure [#17] is about — an exact count quoted in living documentation,
-- wrong the moment somebody changes it, with nothing failing to say so — reappearing one layer
-- down in the thing that was supposed to catch it. A migration makes every environment agree
-- and makes the assertion true everywhere, and "any step done by hand is written down" is
-- better served by a file that performs the step than by a runbook describing it.
--
-- =========================================================================================
-- Why 20260828210000 is not edited
-- =========================================================================================
-- It is applied. Editing an applied migration changes what a fresh `db reset` produces without
-- changing what any existing database holds, which is how two environments start disagreeing —
-- the rule `20260828200000_entries_audit_actions_reunited.sql` exists to restate. It minted 22
-- and that stays true about the day it ran.
--
-- Expand only: it widens what the code may do and removes nothing.

-- **`code like 'LHG-10-%'` rather than an id**, because the id is minted per environment and
-- the value is deliberately not in this repository. Scoped to the 2026 event as well, so a
-- future year's Left Handed Giant code is a decision somebody takes rather than something this
-- line reaches by accident.
update entries.discount_codes as discount
   set max_uses = 25
 where discount.code::text like 'LHG-10-%'
   and discount.event_id = (
     select event.id from entries.events as event where event.slug = 'nn-2026'
   );
