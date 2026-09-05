-- The 2026 Christmas party has a date and a venue.
--
-- **Supplied by a club volunteer on 5 September 2026**, who confirmed the booking has been held
-- since January: **Saturday 12 December 2026, at The Cock & Tail.**
--
-- `20260905100000_create_store_schema.sql` inserted this row with every fact null and said, at
-- length, that it publishes nothing about the occasion. That is still true *of that file* —
-- this is the separate, dated step where two of those facts were actually supplied, which is
-- what makes the provenance of a published claim reviewable on its own rather than buried in
-- the migration that happened to create the table.
--
-- ---------------------------------------------------------------------------------------
-- What is deliberately still null, and why it is not inferred from last year
-- ---------------------------------------------------------------------------------------
-- The 2025 party ran 7:30pm–1am, cost £12, and was 18+. **None of those is a fact about 2026**,
-- and carrying one forward because it is the obvious guess is exactly the failure the
-- stop-and-ask list exists to prevent — a start time is what somebody plans an evening around
-- and a price is what the club charges a card.
--
-- So `start_time`, `end_time`, `minimum_age` and `capacity` stay null, there is still no
-- `ticket_types` row, and `sales_open_at` is still null. **Nothing can be sold by this
-- migration.** The page renders the date and the venue and goes on saying the rest is to be
-- confirmed, which is the honest state.
--
-- Setting the rest is [the runbook](../../../../docs/delivery/runbooks/events-tickets.md),
-- steps 1 and 2, and it is an `update` with no deploy — which is the property the columns
-- exist for.
--
-- **The venue is recorded exactly as it was given.** The 2025 page said "The Cock & Tail,
-- Commercial Road"; the street was not supplied this time and is not added here, because a
-- venue string is what a page prints and not somewhere to quietly reassemble last year's copy.

update store.socials
   set social_date = date '2026-12-12',
       venue       = 'The Cock & Tail'
 where slug = 'christmas-party-2026';
