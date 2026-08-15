-- =========================================================================================
-- Which running of a race is the current one
-- =========================================================================================
-- **One column and one function, and the column is the interesting half.**
--
-- The glossary has said since the beginning that a *race* is the recurring thing and an
-- *event* is one running of it in one year. `entries.events` held only the second: a row per
-- running, with a slug, and nothing at all saying which recurring race it was a running *of*.
-- That was survivable while there was exactly one row. It stops being survivable the moment
-- the site has an evergreen page for the race and a year page for the running, because the
-- evergreen page has to answer "which running is the current one?" without the answer being
-- written into markup — otherwise publishing 2027 means editing every page that mentions it.
--
-- So `race_slug` is the missing half of the glossary's distinction, put where the distinction
-- can be queried. `/nn/` asks for the current running of race `nn` and gets whatever the
-- table says. Publishing 2027 is then an `insert` here plus that year's own content pages, and
-- **no edit to the evergreen page at all** — which is the property this column exists for.
--
-- ## Expand, migrate, contract — and this is the expand step
--
-- Added nullable, backfilled, then constrained, in that order and in one transaction. The
-- currently deployed Worker never names `race_slug` and never writes to `entries.events` —
-- it has no grant on the table and no function that inserts one — so a column it cannot see
-- changes nothing for it. `not null` is safe for the same reason: the only thing that has ever
-- inserted an event row is a migration, and a new event that does not say which race it
-- belongs to is exactly the mistake worth refusing at the boundary.
--
-- Nothing is removed and no existing object changes shape, so there is nothing to contract.
--
-- ## Deploying this and the Worker in either order is safe
--
-- As with every migration here, nothing sequences this against the Cloudflare deploy.
--
--   * **Migration first, Worker later.** A column the old Worker never reads and a function it
--     never calls.
--   * **Worker first, migration later.** `current_entry_state()` does not exist, the RPC fails
--     with `PGRST202`, and `apps/main/worker/nn-entry.ts` treats an unreadable answer exactly
--     as it treats a closed window: `/nn/` shows the interest form and paints no link to a
--     year page. The failure direction is unchanged — towards taking no entries.
-- =========================================================================================

-- -----------------------------------------------------------------------------------------
-- events.race_slug — the recurring race this running belongs to
-- -----------------------------------------------------------------------------------------
alter table entries.events add column race_slug text;

-- The one row that exists. `nn` is the same two letters the path has used since the first
-- deploy, which is deliberate: the URL and the row now agree, and neither was chosen to fit
-- the other.
update entries.events set race_slug = 'nn' where slug = 'nn-2026';

alter table entries.events alter column race_slug set not null;

-- The same shape as `slug`, because it is the same kind of name and lands in the same kind of
-- URL. A race slug and an event slug are drawn from one alphabet on purpose: `nn` and
-- `nn-2026` read as what they are — a race, and a running of it.
alter table entries.events
  add constraint events_race_slug_format check (race_slug ~ '^[a-z0-9][a-z0-9-]*$');

comment on column entries.events.race_slug is
  'The recurring race this event is one running of. A race is the recurring thing; an event is one running of it in one year — see docs/foundations/glossary.md. Publishing next year is an INSERT with this set, not an edit to a page.';

-- **No index, and that is a decision rather than an oversight.** This table holds one row and
-- will hold one per race per year — single figures for years. A planner reading three rows
-- sequentially is faster than one reading an index, and an index here would be a line somebody
-- has to maintain in exchange for nothing measurable.

-- -----------------------------------------------------------------------------------------
-- entries.current_entry_state() — the seventh function, and the second anon may call
-- -----------------------------------------------------------------------------------------
-- **This is a grant to a role whose key is published in page source, so it is worth being
-- explicit about what it discloses: nothing new.** It returns exactly what
-- `entries.entry_state()` already returns, for an event the caller could have named itself —
-- the slug is in the page's own URL. What it adds is that the caller no longer has to *know*
-- the slug, which is the whole point: knowing it is what would hard-code the year.
--
-- `packages/db/tests/entries.test.ts` names the set of functions anon may execute, so this
-- takes that list from six to seven in a diff somebody reviews. That test exists precisely to
-- make this a decision rather than a side effect, and this is it being made.
--
-- ## Which running is "current"
--
--   1. **A forthcoming running beats a past one.** Somebody reading `/nn/` in September 2026
--      wants November 2026, not last year.
--   2. **Then the nearest in time**, so with 2027 and 2028 both published, `/nn/` follows 2027
--      and moves on by itself the day after it is run.
--   3. **Then the slug**, purely so the answer cannot depend on physical row order.
--
-- **A past running is still an answer, and that is deliberate.** Between one November and the
-- day next year's row is added there is no forthcoming event, and returning nothing would make
-- `/nn/` a dead end for the months when somebody is most likely to be looking for last year's
-- race. So it falls back to the most recent past running, which reads as "the last time this
-- happened" — true, and more use than an empty page.
--
-- **Today is a civil date in Europe/London, not UTC.** For an hour every winter night the two
-- disagree about what day it is, and the day this comparison flips is the day after the race.
-- The storage-UTC rule governs instants; `event_date` is civil time, as published — see the
-- note on that column in the first entries migration.
--
-- `security definer` and `set search_path = ''` for the same reason every function in this
-- schema has them: an unpinned search_path on a definer function is the standard Postgres
-- escalation. `stable` because it reads tables and reads the clock.
create or replace function entries.current_entry_state(p_race_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select entries.entry_state(event.slug)
    from entries.events as event
   where event.race_slug = p_race_slug
     and event.active
   order by
     (event.event_date >= (pg_catalog.now() at time zone 'Europe/London')::date) desc,
     pg_catalog.abs(
       event.event_date - (pg_catalog.now() at time zone 'Europe/London')::date
     ),
     event.slug
   limit 1;
$$;

comment on function entries.current_entry_state(text) is
  'Public configuration for the current running of one race — the forthcoming one, else the most recent past one. Returns exactly what entry_state() returns, so it discloses nothing entry_state() does not.';

-- `from public` is the PUBLIC pseudo-role — everyone — not a schema. Revoking first means the
-- grant below is the complete list of who may call this.
revoke all on function entries.current_entry_state(text) from public;
grant execute on function entries.current_entry_state(text) to anon, authenticated;
