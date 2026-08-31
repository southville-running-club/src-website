-- ---------------------------------------------------------------------------------------
-- entries.entry_state() — the medical retention interval, so the page that asks for the
-- consent can state the period the database actually enforces
-- ---------------------------------------------------------------------------------------
--
-- ## The chain this closes, and where it was broken
--
-- `entries.delete_expired_medical_notes()`'s own comment says the period *"is
-- `entries.events.medical_retention`, never a constant"*. Two live pages stated it as a
-- constant anyway:
--
--   * `/nn/2026/` — *"it is deleted **one month** after the race"*, hand-typed into
--     `NnEntryForm.astro`, **on the page somebody ticks the medical consent on**. That is the
--     retention promise attached to Article 9 special-category data, made at the moment of
--     consent.
--   * `/account/data/` — *"deleted automatically **a month** after the race"*, hand-typed into
--     `worker/account.ts`.
--
-- Neither imported `packages/shared/src/medical-retention.ts`, and neither could go red if the
-- column moved. **They had already drifted from each other in register** — "one month" against
-- "a month" — which is the tell that nothing was holding them to a common source. Issue #172.
--
-- `packages/db/tests/entries-retention.test.ts` ties the column to `race.json`'s
-- `privacy.medicalRetention` and always did; what it lost when `/nn/privacy/` became the
-- committee's document word for word was the last link, because that page stopped publishing a
-- period. **The record of 30 August 2026 then said a period is published nowhere.** It is
-- published on the two pages above, and this migration is half of what makes that true again by
-- derivation rather than by luck.
--
-- ## Why the interval belongs on `entry_state()`
--
-- `/account/data/` is not about one event and reads `race.json`, which the database test above
-- already holds to the column. **The entry form is about exactly one event**, and it is the
-- consent page, so it gets the strongest tie available: the interval itself, for the event
-- being entered, out of the row the deletion job applies. Change the column and the sentence on
-- the form changes with it, in the same request.
--
-- **It discloses nothing.** `entry_state()` is the public configuration read — window state,
-- capacity, minimum age, the fees on offer — and a retention period is a promise the club
-- publishes rather than a fact about anybody. It is also, in the most literal sense, the thing
-- the page is about to ask somebody to agree to.
--
-- `current_entry_state()` delegates to this function and needs no change of its own.
--
-- ## Expand, not migrate
--
-- One key added to a `jsonb` object. The deployed Worker parses this shape with Zod, which
-- strips a key it was not told about, so a Worker built before this migration is unaffected —
-- and the Worker built after it treats the key as optional for the same reason in reverse.
-- Nothing is removed and no signature moves.

-- Restated verbatim from 20260826173000_entries_tester_person_and_cancel.sql apart from the one
-- key the comment inside names. The permission-gated fee filter is unchanged.
create or replace function entries.entry_state(p_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'slug', event.slug,
    'display_name', event.display_name,
    'state',
      case
        when not event.active then 'closed'
        when event.entries_open_at is null then 'pre_open'
        when pg_catalog.now() < event.entries_open_at then 'pre_open'
        when event.entries_close_at is not null
             and pg_catalog.now() >= event.entries_close_at then 'closed'
        else 'open'
      end,
    'event_date', event.event_date,
    'start_time', event.start_time,
    'entrants_per_entry', event.entrants_per_entry,
    'capacity', event.capacity,
    'minimum_age', event.minimum_age,
    'requires_dob', event.requires_dob,
    'consent_version', event.consent_version,
    -- **The one new key, and it is the interval rather than a sentence.** Postgres renders it
    -- as `1 mon`; `packages/shared/src/medical-retention.ts` is the one module allowed to turn
    -- that into words, and it answers `null` for any interval it cannot say in one clause —
    -- which is a period the notice could not honestly describe either. The Worker paints the
    -- result onto the form. See the header for why this event's own row is the right source.
    'medical_retention', event.medical_retention::text,
    'fees', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', fee.code,
                   'label', fee.label,
                   'price_pence', fee.price_pence,
                   'requires_ea_number', fee.requires_ea_number
                 )
                 order by fee.price_pence desc, fee.code
               )
          from entries.fees as fee
         where fee.event_id = event.id
           and fee.active
           and (fee.valid_from is null or fee.valid_from <= pg_catalog.now())
           and (fee.valid_to is null or fee.valid_to > pg_catalog.now())
           -- False for `anon` always, so the public radio group is unchanged and a 1p entry
           -- never appears on a page a runner can reach.
           and (
             fee.requires_permission is null
             or identity.has_permission(fee.requires_permission)
           )
      ),
      '[]'::jsonb
    )
  )
  from entries.events as event
  where event.slug = p_slug;
$$;

comment on function entries.entry_state(text) is
  'Public configuration for one event: window state, the medical-note retention interval the deletion job enforces, and the fees this caller may buy. Reads no personal data and returns no table privilege. Caller-dependent only in that a permission-gated fee is hidden from everybody who does not hold its permission — anon sees strictly less than before, never more.';
