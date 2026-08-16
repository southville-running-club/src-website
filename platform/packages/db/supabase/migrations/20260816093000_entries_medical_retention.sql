-- Deleting the medical notes on time — the promise `/nn/privacy/` publishes and nothing keeps.
--
-- Section 4 of the published notice says, in the club's own words, that anything written in
-- the medical box is *"deleted — separately from, and sooner than, the rest of your entry"*,
-- and section 6 puts a period on it. **Nothing in this platform did that.** The separate table
-- was built for exactly this — Slice A's migration says so: *"Delete the medical information
-- one month after the race is `delete from entries.entrant_medical` joined to the event"* —
-- and this is that sentence, made executable.
--
-- =========================================================================================
-- The retention period is a column, and the published words are checked against it
-- =========================================================================================
-- **`race.json`'s `privacy.medicalRetention` is the published wording and this column is the
-- enforced value, and the whole risk is that the two drift.** A club that changes the notice
-- to "three months" and forgets the schema is publishing a claim it does not keep; a club that
-- changes the schema and forgets the notice is deleting data sooner than it said it would.
-- Neither is visible in a diff on its own.
--
-- So they are tied together by a test rather than by hope. `packages/shared/src/medical-
-- retention.ts` turns an enforced interval into exactly one English phrase, and
-- `packages/db/tests/entries-retention.test.ts` reads this column out of Postgres, reads the
-- published string out of `race.json`, and fails unless the second is what the first
-- generates. **Changing either alone goes red.** Changing both together is one commit that a
-- reviewer can see the whole of, which is the property that was missing.
--
-- The value is per event rather than global: a race that collected no medical information, or
-- one whose committee decides differently, is a row rather than an exception.
--
-- =========================================================================================
-- Expand, migrate, contract
-- =========================================================================================
--   * **Migration first, Worker later.** A column the deployed Worker never names and a
--     function it never calls. The cron keeps calling `expire_pending_holds()` exactly as it
--     did yesterday.
--   * **Worker first, migration later.** `delete_expired_medical_notes` does not exist,
--     PostgREST answers `PGRST202`, and `scheduled()` logs it and carries on — the hold sweep
--     is a separate call and is not taken down with it. Nothing is deleted early and nothing
--     that should have been deleted is lost; it happens on the next run after the migration
--     lands.
--
-- `not null default` on an existing table: one row, and a default that is applied without a
-- rewrite in Postgres 11 and later. Nothing reads the column until the function below does.

-- -----------------------------------------------------------------------------------------
-- events.medical_retention — how long after the race the notes are kept
-- -----------------------------------------------------------------------------------------
-- **An `interval` rather than a number of days, because "one month" is what was published.**
-- A month is not 30 days and Postgres knows it: `date '2026-11-01' + interval '1 month'` is
-- 1 December, which is what somebody reading the notice would work out on a calendar. Storing
-- 30 and rendering "one month" would be a small lie in the direction of deleting early, which
-- is the safer direction but is still not what the page says.
alter table entries.events
  add column medical_retention interval not null default interval '1 month';

alter table entries.events
  add constraint events_medical_retention_positive
    check (medical_retention > interval '0');

comment on column entries.events.medical_retention is
  'How long after event_date the medical notes are kept before entries.delete_expired_medical_notes() removes them. The ENFORCED value; the PUBLISHED wording is race.json''s privacy.medicalRetention, and packages/db/tests/entries-retention.test.ts fails if the two disagree.';

-- -----------------------------------------------------------------------------------------
-- entries.delete_expired_medical_notes() — the job itself
-- -----------------------------------------------------------------------------------------
-- **It deletes rows from one table and touches nothing else.** Not the entrant, not the
-- purchase, not the consent that was recorded on the purchase — the record that somebody
-- consented is a fact about what the club was permitted to do and outlives the data it
-- permitted. That separation is the reason `entrant_medical` is its own table.
--
-- ## Which rows
--
-- An event whose `event_date + medical_retention` is **strictly before today**, where today is
-- a civil date in `Europe/London`. The comparison is civil for the same reason
-- `current_entry_state()`'s is: for an hour every winter night UTC and London disagree about
-- what day it is, and this is a deletion — the wrong side of that hour is a day early.
--
-- Strictly before, so the notes survive the whole of the last day. A person reading "one month
-- after the race" for a race on 1 November expects the notes to exist on 1 December.
--
-- ## Safe to run repeatedly, and it is going to be
--
-- The five-minute cron calls this alongside the hold sweep, which is 288 times a day for a
-- deletion that fires once a year. That is deliberate: the alternative is a second schedule to
-- configure, to get wrong, and to notice has stopped. The second run deletes nothing because
-- the rows are gone, `row_count` is 0, and nothing is logged.
--
-- ## Granted to anon, and there is nothing here to abuse
--
-- The same argument `expire_pending_holds()` makes, and it holds for the same reasons: it
-- takes no arguments, it returns a count and no row, and it can only delete what the club has
-- **published a promise to delete**. Bringing a deletion forward would need `event_date` or
-- `medical_retention` to move, and no role reachable from a browser can write either — there
-- is no grant on `entries.events` and no function that updates it.
--
-- The cron calls it with the same anon key every other request uses, because there is no
-- privileged credential in this platform to call it with instead. Gating it behind the admin
-- key was considered and refused: it would make a legal retention obligation stop being kept
-- on any day the admin key was not installed, which is exactly the wrong dependency.
create or replace function entries.delete_expired_medical_notes()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_deleted int;
  v_events int;
begin
  -- Counted before the delete, because after it there is nothing left to count. This is how
  -- many events were past their retention period and still had notes against them — the number
  -- worth having in a log line, since "deleted 40 notes" says nothing about whether that was
  -- one race or four.
  select pg_catalog.count(distinct event.id)::int
    into v_events
    from entries.entrant_medical as medical
    join entries.entrants as entrant on entrant.id = medical.entrant_id
    join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
    join entries.events as event on event.id = purchase.event_id
   where event.event_date + event.medical_retention
         < (pg_catalog.now() at time zone 'Europe/London')::date;

  delete from entries.entrant_medical as medical
   where medical.entrant_id in (
     select entrant.id
       from entries.entrants as entrant
       join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
       join entries.events as event on event.id = purchase.event_id
      where event.event_date + event.medical_retention
            < (pg_catalog.now() at time zone 'Europe/London')::date
   );

  get diagnostics v_deleted = row_count;

  -- **A count, and never anything else.** These rows are special category data; the only thing
  -- worth writing down about their deletion is that it happened and how much of it there was.
  return jsonb_build_object('deleted', v_deleted, 'events', v_events);
end;
$$;

comment on function entries.delete_expired_medical_notes() is
  'Deletes medical notes for events more than their retention period past — the promise /nn/privacy/ publishes. Touches entries.entrant_medical and nothing else, is safe to run repeatedly, and returns a count and no rows. The period is entries.events.medical_retention, never a constant.';

revoke all on function entries.delete_expired_medical_notes() from public;
grant execute on function entries.delete_expired_medical_notes() to anon;
