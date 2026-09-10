-- The 2026 Christmas party: the times, the age limit, and the ticket price.
--
-- Supplied by a club volunteer on 5 September 2026: **7:30pm–1am**, **18+**, and a price.
--
-- **The price is £10, and it is confirmed** — given as a provisional £12 on 5 September,
-- changed to £10 on 6 September and confirmed as settled the same day. None of it had been
-- deployed in between, so this file states the agreed figure rather than carrying two
-- corrections after it. See decision 010.
--
-- ---------------------------------------------------------------------------------------
-- The price, and why it lives only here
-- ---------------------------------------------------------------------------------------
-- **£10 a ticket, confirmed 6 September 2026** — decision 010, which also records what that
-- is against: the 2025 party sold 86 orders at £12 for £1,140, so the same turnout at £10
-- takes about £190 less before fees.
--
-- **This row is the only definition of the price.** It is passed as `price_data` when a
-- Checkout session is created, so what the club charges is what this row says at that
-- moment — there is deliberately no Stripe Product or Price object, because a price held in
-- two systems is a price that will disagree with itself and the copy that is wrong will be
-- the one in the dashboard nobody opened.
--
-- Changing it is an `update` on this row and no deploy. A price already *sold* at is a
-- different matter: `ticket_purchases.amount_pence` records what was actually charged,
-- precisely so a later edit here cannot rewrite somebody's receipt — but somebody who bought
-- at the old price paid the old price, and that is a conversation rather than a query. **The
-- practical window for repricing closes the day sales open**, which is decision 010's exit
-- cost and is the same shape as decision 006's for the race.
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
