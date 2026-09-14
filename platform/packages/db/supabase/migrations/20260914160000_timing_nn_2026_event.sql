-- ========================================================================================
-- The race exists: one `timing.events` row for `nn-2026`
-- ========================================================================================
--
-- Issue [#288](https://github.com/southville-running-club/src-website/issues/288), the last
-- change on [#257](https://github.com/southville-running-club/src-website/issues/257)'s
-- critical path before the simulation
-- ([#207](https://github.com/southville-running-club/src-website/issues/207)).
--
-- Rungs 1 to 4 of that ladder are built and tested against invented fixtures, and **none of
-- it can run against the actual race until this row exists**. Every address under `/timing`
-- addresses an event by slug: the roster, the registration import, the start screen,
-- capture, triage, status, finish, the preview and publication. `/timing/events/` therefore
-- lists nothing at all on production, and `timing.import_from_entries('nn-2026')` — the
-- first thing
-- [the race-night runbook](../../../../../docs/delivery/runbooks/timing-race-night.md) asks
-- a volunteer to press — answers `no_such_event`.
--
-- ## ⚠️ Why a migration, and what still owes a form
--
-- `timing.create_event()` has existed since `20260912090000`, behind `timing.event.manage`,
-- and **nothing calls it.** There is no create form, no route handler and no control
-- anywhere under `/timing`; a grep for `create_event` across `apps/` finds nothing at all,
-- and the only hits in this repository are the generated `packages/db/src/database.types.ts`
-- and the database tests covering the function itself. #288 weighed the two ways to close
-- that and **the migration is the one that fits the calendar**: the change freeze is about
-- 25 October, creating the row is a deploy either way, and a form is the larger change.
--
-- **The form is still owed, and it is Pass the Buck's
-- ([#206](https://github.com/southville-running-club/src-website/issues/206)) rather than
-- this race's.** It can follow after 1 November, it is what `create_event()` has been
-- waiting for since #247, and this migration does not retire it — `create_event()` remains
-- called by nothing. Written down here so #206 does not rediscover the gap from an empty
-- events list.
--
-- ⚠️ **This inserts rather than calling the function built for it, and it has to.**
-- `create_event()` is `security definer` and its first statement is
-- `identity.has_permission('timing.event.manage')`, which reads `auth.uid()` from the
-- request's own token. A migration runs as `postgres` with no token at all, so the call
-- would answer `{ok: false, reason: 'refused'}` and insert nothing — silently, because
-- `db push` does not read a function's return value. The `insert` below is deliberately the
-- same shape the function would have written, so the row a later form produces is
-- indistinguishable from this one.
--
-- ## Every value, and where each is confirmed
--
-- Not one of these is inferred. `entries` has held the same running under the same slug
-- since `20260813094500`, and `apps/main/src/content/race.json` is what `/nn/2026/`
-- publishes from.
--
--   * **`slug` — `nn-2026`.** `apps/main/worker/routing.ts` owns the `nn-<year>` convention
--     as two functions that are inverses of each other, and `/nn/2026/results/` resolves to
--     that slug and nothing else. A race set up under any other spelling publishes to an
--     address the club does not serve.
--   * **`name` — `Nightingale Nightmare 2026`.** `entries.events.display_name` for this
--     slug, character for character. `race.json`'s `name` is `Nightingale Nightmare`, which
--     is the **race**; this row is one running of it, so the year belongs — and the two
--     surfaces a volunteer reads must not disagree about what one running is called.
--   * **`format` — `solo`.** `20260911140000`'s own comment on the column: *"Pass the Buck
--     is a relay; Nightingale Nightmare is solo."* The whole platform branches on it — bibs,
--     prizes, and how many runners a row carries.
--   * **`start_at` — 11:00 on Sunday 1 November 2026, London.** `race.json`'s `date` and
--     `startTime`, and `entries.events`' own `event_date` and `start_time` for this slug.
--     Both are confirmed and quotable; the paragraph below is the part that is easy to get
--     wrong.
--   * **`distance_m` — 10000.** Argued below.
--   * **`course_notes` — left null.** Nothing has been supplied for it and this migration
--     invents nothing. `update_event()` fills it in with no deploy if the race director ever
--     wants something there.
--
-- ## ⚠️ The timezone, which is the trap here and is the invisible kind
--
-- **The clocks go back on Sunday 25 October 2026 and this race is the following Sunday**, so
-- 1 November runs in **GMT** — London and UTC coincide that day. A wrong offset would
-- therefore look perfectly right: `11:00+01:00` is the mistake that costs an hour, and
-- nothing on any screen would show it, because every *other* date this platform was
-- developed against is BST. `CLAUDE.md` calls an hour of drift here *"a real foot-gun, not a
-- theoretical one"* for exactly this reason.
--
-- The literal below is `+00`, and the `do` block above it is that sentence made executable:
-- it compares the instant against the same wall clock resolved through Postgres' own
-- timezone database, so the reasoning does not have to be re-derived by the next reader — and
-- a BST literal, or a tzdata disagreeing about the UK's 2026 rules, stops `db push` here
-- with a sentence saying so.
--
-- The column is `timestamptz`, stored UTC, and **nothing here renders it**:
-- `packages/shared/src/london-time.ts` is the one path a timestamp takes to `Europe/London`,
-- and no SQL in this repository turns a date into text.
--
-- ## `distance_m` is set, and the argument is narrow
--
-- 10 km is the advertised distance — `race.json`'s `distance` is `10 km, off-road` and the
-- race director's own copy says *"10km off road"* — so 10000 states a confirmed fact rather
-- than a measured one. It is set because the only thing that reads the column today is one
-- line on the race hub (`apps/timing/app/events/[slug]/page.tsx`, which renders `—` for a
-- null), and **runbook step 1.1 asks a volunteer to check this row against `race.json`**: a
-- dash there is a fact they have to carry in their head instead of read.
--
-- ⚠️ **Nothing derives a pace, a split or a published figure from it, and the day something
-- does, this value is the wrong input.** An advertised 10 km on an off-road course is not a
-- surveyed distance; that is the moment to measure the course, not to trust this column.
--
-- ## Two `nn-2026` rows, in two schemas, and nothing joins them
--
-- `entries.events` has held an `nn-2026` row since `20260813094500` — the entry window, the
-- fees, the capacity of 250 — and this adds a second row under the same slug in `timing`.
-- The glossary's word covers both: **an event is one running of one race in one year**, and
-- these two rows describe the same running from the two sides the club needs of it. One
-- sells a place; the other times somebody over the course.
--
-- **There is deliberately no foreign key and no join.** `timing.import_from_entries()`
-- matches the two on the slug at call time — `20260913100000` states that as the convention
-- and `/nn/<year>/` already relies on it — and a constraint tying them would be wrong in
-- both directions: Pass the Buck is timed here and was never entered here (a `timing` row
-- with no `entries` row, which that function names rather than raises), and a future race
-- could be entered here and timed elsewhere.
--
-- ## What this does not set, and why the row is inert
--
-- `actually_started_at`, `finished_at`, `results_published_at` and `results_published_by`
-- are all null: not started, not finished, not published. So the row changes nothing a
-- runner or a member of the public can see — `/nn/2026/results/` stays a 404 to everybody
-- without `nn.results.read` until somebody publishes (ADR-042), and `/nn/` paints no results
-- link because `timing.results_published_at()` still answers null. What it changes is that
-- the staff-only screens under `/timing` have a race to address.
--
-- ## Idempotent, and it never updates
--
-- `on conflict (slug) do nothing`, for two separate reasons:
--
--   1. This applies to a local database rebuilt from zero several times a day as well as
--      once to production, and a migration that fails on a second apply is a migration that
--      fails a `db reset`.
--   2. ⚠️ **A correction belongs to `update_event()`, not to this file.** A volunteer
--      holding `timing.event.manage` may fix the name, the start time, the distance or the
--      notes from `/timing/events/nn-2026/` before the race goes off. An upsert here would
--      silently undo that correction the next time anything re-applied the migration set,
--      which is the same argument `create_event()` makes for being insert-only.
--
-- ## ⚠️ One claim three earlier migrations make stops being true today
--
-- `20260913220000`, `20260914100000` and their neighbours each justified a **validated**
-- check constraint on the grounds that *"`timing` holds no production data at all"*, so
-- there was no row to disagree with one. From this migration onward there is one row, and it
-- is the real race. Nothing already applied is invalidated — every one of those constraints
-- is satisfied by the row below — but the next validated constraint on `timing.events` has
-- something to disagree with it, and `entries`' four `NOT VALID` constraints are the
-- precedent for what to do about that.
--
-- Purely additive: one row in one table in `timing`. No grant changes, no policy changes,
-- and nothing in `club`, `intake`, `entries`, `identity` or `store` is read or written. It
-- lands beside a live entry window, which is why it is timestamped to sort after
-- `20260914150000`.

-- ----------------------------------------------------------------------------------------
-- The clocks-change guard — see the header
-- ----------------------------------------------------------------------------------------
-- A statement about the literal and about Postgres' timezone database, and about nothing in
-- any table — so it cannot fail on a row somebody else wrote, and it says the same thing on
-- every apply.
do $$
begin
  if timestamptz '2026-11-01 11:00:00+00'
     <> (timestamp '2026-11-01 11:00:00' at time zone 'Europe/London') then
    raise exception using
      message = 'The start below is not 11:00 Europe/London on 1 November 2026',
      detail  = 'The clocks go back on 25 October 2026, so race day is GMT and the literal '
                || 'has to be +00 — which is what this compares it against, through this '
                || 'database''s own timezone data rather than anybody''s arithmetic.',
      hint    = 'Check the date and the start time against apps/main/src/content/race.json '
                || 'and entries.events'' own nn-2026 row before changing either side.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------------------
-- The race
-- ----------------------------------------------------------------------------------------
insert into timing.events (slug, name, format, start_at, distance_m)
values (
  'nn-2026',
  'Nightingale Nightmare 2026',
  'solo',
  timestamptz '2026-11-01 11:00:00+00',
  10000
)
on conflict (slug) do nothing;
