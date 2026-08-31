-- ---------------------------------------------------------------------------------------
-- nn-2026 — the entry terms move to version 2, so the column says which wording was ticked
-- ---------------------------------------------------------------------------------------
--
-- ## What changed in the document
--
-- The race director supplied amended entry terms on 31 August 2026. Against version 1,
-- published on the 28th, **two clauses differ and nothing else does**:
--
--   1. Race Rules bullet 1 now names **ARC's Rules of Competition** and gives an address for
--      them, beside the Event Terms & Conditions it already named.
--   2. The publicity clause reads *"we will not use ones we know you are in"*, where the
--      transcription published on the 28th had the singular.
--
-- Every other clause, in both sections, is character-for-character what was published. The
-- clause counts are unchanged — thirteen and seven — which is what `nn-terms.spec.ts` asserts.
--
-- ## Why a migration at all
--
-- **`entry_purchases.consents_version` records the wording a person ticked against**, and it is
-- stamped from `entries.events.consent_version` by `create_pending_purchase()`. The document's
-- own last sentence says it is subject to change, so the club has to be able to answer *"which
-- version did I agree to?"* — and it can only do that if the column moves when the copy moves.
--
-- ⚠️ **Changing the copy without moving the column is the failure this pair exists to prevent,
-- and it would be invisible.** Every entry taken afterwards would claim to have agreed to
-- wording that did not exist when it was made, with nothing anywhere disagreeing. A purchase
-- made under version 1 keeps `nn-2026-v1`; this only decides what the next one is stamped with.
--
-- **No entry has been taken yet** — `entries_open_at` is still null on this event — so in
-- practice nothing carries `nn-2026-v1` outside the fixtures. That is a fact about today rather
-- than a reason to skip the bump: the mechanism has to be right on the day it is not.
--
-- ## What this does not touch
--
-- `required_consents` is unchanged. The amended document asks for nothing new to be ticked: the
-- publicity clause was in version 1 and is a term of entry rather than a consent, and the ARC
-- rules reference is a document to abide by rather than a box.
--
-- ⚠️ **The publicity clause's opt-out has no mechanism, and this migration does not build one.**
-- *"Tell us if you would rather not appear"* is an instruction with no field, no consent and no
-- route except the contact address on the page. A nineteenth entry field is a committee
-- decision — see CLAUDE.md's stop-and-ask list — so what exists is what the terms say and the
-- contact address beside it.

update entries.events
   set consent_version = 'nn-2026-v2'
 where slug = 'nn-2026'
   and consent_version = 'nn-2026-v1';
