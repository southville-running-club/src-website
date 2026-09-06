-- The 2026 Christmas party: the times, the age limit, and a **provisional** price.
--
-- Supplied by a club volunteer on 5 September 2026: **7:30pm–1am**, **18+**, and a price.
--
-- **The price is £10.** It was £12 when this migration was first written and was changed on
-- 6 September, before any of it had been deployed — so this file states the current figure
-- rather than carrying a correction after it. **That it has already moved once is the
-- clearest evidence it is not settled.**
--
-- ---------------------------------------------------------------------------------------
-- ⚠️ The price is provisional, and it was supplied as provisional
-- ---------------------------------------------------------------------------------------
-- The volunteer's words when the figure was first given were *"I will confirm the price later,
-- just go with £12 now"*, and nothing since has confirmed one — the change to £10 came with no
-- statement that it is final. So the £10 below is what the page should show today and **is not
-- a confirmed decision about what the club charges**.
--
-- **That is safe only while tickets cannot be sold, and today they cannot**: `sales_open_at`
-- is null, and none of the three Worker secrets is installed, so no card can be charged
-- anything at all. What this row does is put a figure on a page somebody reads and plans
-- around — a soft commitment rather than a transaction.
--
-- **It stops being safe at exactly one moment: opening sales.** From then on this integer is
-- what a card is charged, and there is deliberately no second copy of it in Stripe to
-- disagree with. So the entries in the runbook that open the window carry re-confirming this
-- as a stop condition, and `docs/delivery/runbooks/events-tickets.md` step 4 will not let
-- somebody walk past it.
--
-- Changing it is an `update` on this row and no deploy. A price that has already been *sold*
-- at is a different matter — `ticket_purchases.amount_pence` records what was actually
-- charged, precisely so that a later edit here cannot rewrite somebody's receipt.
--
-- ---------------------------------------------------------------------------------------
-- The age limit is displayed and is not enforced, deliberately
-- ---------------------------------------------------------------------------------------
-- `minimum_age` puts "Entry requirements: 18+" on the page and **nothing in this schema
-- checks it**, because nothing here collects a date of birth to check it against — and
-- collecting one to sell a party ticket is the minimisation breach `store` exists to avoid.
--
-- That is what the club already does: the 2025 page stated 18+ as prose and the door enforced
-- it. If the committee later wants it asked at the point of sale, the mechanism is a
-- `required_consents` entry rather than a column, and it needs wording first.
--
-- ---------------------------------------------------------------------------------------
-- What is still null after this
-- ---------------------------------------------------------------------------------------
-- `capacity` — nobody has said what the room holds. Null means no limit, which is the honest
-- reading of "not supplied" and is also what the 2025 page implied by never mentioning one.
--
-- `sales_open_at` — still the switch, still null, still gated on the runbook.

update store.socials
   set start_time  = time '19:30',
       end_time    = time '01:00',
       minimum_age = 18
 where slug = 'christmas-party-2026';

-- **One ticket type, and the price lives only here** — never as a Stripe Product or Price
-- object. A price held in two systems is a price that will disagree with itself, and the copy
-- that is wrong will be the one in the dashboard nobody opened. It is passed as `price_data`
-- when a Checkout session is created, read inside the same transaction that held the ticket.
insert into store.ticket_types (social_id, code, label, price_pence)
select social.id, 'standard', 'Standard ticket', 1000
  from store.socials as social
 where social.slug = 'christmas-party-2026'
    on conflict (social_id, code) do update set price_pence = excluded.price_pence;
