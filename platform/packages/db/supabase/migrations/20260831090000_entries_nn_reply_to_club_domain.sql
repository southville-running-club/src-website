-- =========================================================================================
-- The reply-to address moves off Gmail, onto the club's own domain
-- =========================================================================================
-- `entries.events.from_address` becomes `Reply-To` on every entry email — never `From`, which
-- Resend restricts to the verified sending subdomain — and it has read
-- `nightingalenightmare@gmail.com` since the seed migration, a real address nobody ever
-- circled back to change once the club's own alias existed.
--
-- **The new address exists and delivery into it is proven.** The Fasthosts alias
-- `nightingalenightmare@southvillerunningclub.co.uk` forwards to `info@southvillerunningclub.co.uk`,
-- and `docs/delivery/runbooks/nn-email-aliases.md` records a passed delivery test on
-- 28 August 2026. It is already what `race.json`'s `contact` key publishes on every `/nn` page —
-- this migration is what makes the address a reply lands on agree with the address a page
-- prints.
--
-- **Scoped by value, not by slug.** Matching on the old address rather than naming `nn-2026`
-- is what makes this correct for any event a future migration inserts with the same
-- placeholder, without this file needing to know that event's name.
update entries.events
   set from_address = 'nightingalenightmare@southvillerunningclub.co.uk'
 where from_address = 'nightingalenightmare@gmail.com';
