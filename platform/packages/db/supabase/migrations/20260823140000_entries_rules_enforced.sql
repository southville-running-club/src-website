-- Every rule the club has, enforced where a caller cannot get underneath it.
--
-- **This migration adds no feature and no interface.** It closes the gap between the rules
-- this platform says it has and the rules it can actually keep, and the distinction it turns
-- on is the one Slice E found by accident:
--
--   > `entries.create_pending_purchase` wrote `ea_number` straight through without ever
--   > consulting `fees.requires_ea_number`. The column permits null, the function is granted
--   > to anon, and the anon key is published in page source — so two PostgREST calls produced
--   > an affiliated entry with no England Athletics number, at £2 less, unverifiable.
--
-- The Zod schema did require it. **Zod is the form's control, not the system's.** Anything
-- that is only in `packages/shared/src/nn-entry.ts` is a rule about the page, and a script
-- with the published key never loads the page.
--
-- ---------------------------------------------------------------------------------------
-- What the audit found, and what this closes
-- ---------------------------------------------------------------------------------------
-- Every rule was tested by *attempting the bypass* with an anonymous PostgREST client rather
-- than by reading the code, because a rule that has only been read is a rule somebody has
-- assumed. Forty-two probes; six of the eight rules named in the brief already held. Nine
-- did not, and they are the nine below.
--
--   1. An affiliated entry with **no England Athletics number** — accepted, at the affiliated
--      price. The finding that prompted the slice.
--   2. An England Athletics number **stored against a fee that does not want one**. The
--      Worker drops it at the boundary; nothing under the Worker did.
--   3. **The entry terms were not enforced at all.** `p_consents = {}` was accepted and
--      stored as `{}`. So was `{"entryTerms": false}`. So was `{"entryTerms": "yes please"}`.
--      This is worse than (1): a £2 discount is spot-checkable against myAthletics, and this
--      is the club's record of what somebody agreed to.
--   4. A **medical note with no medical consent** — not through the function, which drops
--      them correctly, but through any other write path, because nothing tied the note to the
--      consent. Article 9 data, and the separate table was argued for on exactly this ground.
--   5. A **date of birth in the future**, wherever the event sets no minimum age.
--   6. A **birth year before 1900** — accepted even with a minimum age set, because a
--      200-year-old passes an "is at least 18" test.
--   7. **`leg` unrelated to `entrants_per_entry`**: leg 7 on a solo race.
--   8. An **emergency contact phone with no digits in it**. The field exists for one purpose.
--   9. A **purchaser email of `a@`** — `position('@' in …) > 1` is satisfied by it.
--
-- ---------------------------------------------------------------------------------------
-- Where each rule goes, and why not all of them go to the same place
-- ---------------------------------------------------------------------------------------
-- **A check constraint where the rule is static; a trigger where it needs another row.** A
-- CHECK may only see the row it is on, so every rule that spans `entrants → entry_purchases →
-- fees` or `→ events` — which is most of the interesting ones — cannot be a CHECK however much
-- one would prefer it. Those are triggers, and the triggers raise `check_violation` so that
-- `create_pending_purchase`'s existing handler turns them into the structured refusal it
-- already returns rather than a 500 carrying a Postgres string.
--
-- **The function keeps its own copy of the two rules a person needs a sentence about.** A
-- missing England Athletics number and an unagreed consent are things somebody can fix and
-- resubmit, so they get their own refusal reasons and reach the form as words. Everything else
-- collapses to `invalid_entrants`, which is what it already meant: the entrant block is wrong
-- in a way `packages/shared/src/nn-entry.ts` should have caught, so it is drift and is logged
-- as drift.
--
-- **Zod stays exactly as it is.** It is the form's convenience and it is good at that — it
-- reports every problem at once, in field order, in words written for somebody on a phone.
-- What changes is that it is no longer the only place any of these live.
--
-- ---------------------------------------------------------------------------------------
-- The entry terms are per event, not per platform
-- ---------------------------------------------------------------------------------------
-- The obvious fix for (3) is `check (consents -> 'entryTerms' = 'true')` on the table, and it
-- was rejected. `consents` is jsonb precisely because **the set of consents differs between
-- events and between years** — that is the argument the first entries migration makes for not
-- having a boolean column per checkbox — and a table constraint naming `entryTerms` would
-- write one race's checkbox list into the schema for every race that follows.
--
-- So `events.required_consents` says which consent keys that event requires, defaulting to
-- `{entryTerms}`, and the rule is "every key this event names is present and json `true`".
-- Nightingale Nightmare 2026 gets the default and nothing about it changes. A future event
-- with a different set is an `insert`, which is what every other event-varying rule here
-- already is — `minimum_age`, `entrants_per_entry`, `medical_retention`.
--
-- **What is still a flat table constraint is the type discipline**: every value in `consents`
-- must be a boolean, on every event, forever. `"yes please"` is not a considered answer to a
-- consent question under any race's wording, and that rule genuinely does not vary.
--
-- ---------------------------------------------------------------------------------------
-- Expand, migrate, contract — and the schema is live, so this is literal
-- ---------------------------------------------------------------------------------------
-- **Every check constraint below is added `NOT VALID`, and that is the whole of how this is
-- safe to deploy.** `NOT VALID` enforces the constraint on every insert and every update from
-- the moment it lands, and does **not** scan the rows already there. A validated
-- `ADD CONSTRAINT` takes an ACCESS EXCLUSIVE lock, reads the whole table, and **fails the
-- migration if one row disagrees** — which on this platform fails the deploy for everything,
-- not only for entries.
--
-- Nobody here can see the production rows. The reasoning says there are none —
-- `entries_open_at` is null in production and `create_pending_purchase` returns `closed` when
-- it is null, so nothing can have come through the entry path — but a row written by hand
-- through Studio is invisible to that argument, and a deploy is not the place to find out.
--
-- **Turning each one into a validated constraint is one documented command per constraint**,
-- run once somebody has looked at the table:
--
--     alter table entries.entry_purchases validate constraint <name>;
--
-- It takes only a SHARE UPDATE EXCLUSIVE lock, so it does not block reads or writes, and it
-- can be run in the middle of an entry window. The runbook carries the list and the query that
-- says whether it will succeed.
--
-- **The triggers need no such treatment**: a trigger only ever sees a write, so there is
-- nothing to scan and nothing that can fail on deploy. It is also their limitation, and it is
-- the reason the constraints are here as well — a trigger cannot tell you the rows you already
-- have are fine.
--
-- Both deploy orders survive, as every migration here must:
--
--   * **Migration first, Worker later.** The deployed Worker submits entries that already
--     satisfy every rule below, because Zod has been enforcing all nine on the form since the
--     entry path shipped. Stricter rules it already meets change nothing for it.
--   * **Worker first, migration later.** Nothing here is called by name. The column, the
--     constraints and the triggers are invisible to a Worker that does not know about them,
--     and `create_pending_purchase` keeps its exact signature — so PostgREST routes the same
--     call it routed yesterday.
--
-- Rolling the code back is safe for the same reason: an older Worker meets a stricter
-- database, and its own validation is stricter still.
--
-- ---------------------------------------------------------------------------------------
-- What this makes stale, and where it is corrected
-- ---------------------------------------------------------------------------------------
-- **`20260818120000_entries_admin_figures.sql` says of `affiliated_missing_ea`: "This is
-- reachable, and not by a legacy row… It is the one committee rule enforced in TypeScript
-- alone."** Both sentences were true when they were written and neither is now. That migration
-- is not edited — it has been applied locally, in CI and on the shared project, and editing an
-- applied migration changes what a fresh `db reset` produces without changing what any existing
-- database holds. It is corrected here, which is the same thing the webhook migration did to
-- Slice A's note about `hold_expires_at`.
--
-- **The panel itself stays, and this is the argument for keeping it.** A trigger only ever sees
-- a write, so it says nothing about the rows that were already there — and the four constraints
-- above are `NOT VALID` for exactly that reason. Until somebody has run the constraints runbook,
-- a pre-enforcement affiliated entry with no number is a state that can still exist and that
-- nothing else would surface. The count is now a backstop rather than a live alarm, and it
-- should read zero forever.
--
-- `entries-admin.test.ts` asserts both halves: that the row can no longer be created, and that
-- the panel still counts one written as history.

-- ---------------------------------------------------------------------------------------
-- What this migration does NOT do
-- ---------------------------------------------------------------------------------------
-- **It grants nothing to anon.** Three trigger functions are added and all three are granted
-- to nobody at all — they are reached only by the triggers that fire them. The thirteen
-- functions anon may execute are the same thirteen, and `tests/entries.test.ts` asserts it.
--
-- It changes no payment behaviour. The capacity lock, the hold, the pricing and the webhook
-- are untouched — this slice tightens what may be *written*, not how anything works.

-- =========================================================================================
-- events.required_consents — which consents this event's entrants must have agreed to
-- =========================================================================================
-- `text[]` rather than jsonb: it is a list of keys, order does not matter, and `&&` and
-- `array_position` are the operators the rule actually needs.
--
-- `not null default` on an existing table is applied without a rewrite in Postgres 11 and
-- later. One row exists and it takes the default, which is the rule that was already being
-- enforced by the form.
alter table entries.events
  add column required_consents text[] not null default array['entryTerms']::text[];

-- A null element would silently match nothing and a blank one would demand a consent whose
-- key is the empty string. Both are configuration mistakes that would read as "the form is
-- broken" from the outside, which is the expensive way to find them.
alter table entries.events
  add constraint events_required_consents_usable check (
    array_position(required_consents, null) is null
    and not (required_consents && array['']::text[])
  );

comment on column entries.events.required_consents is
  'Which keys in entry_purchases.consents must be present and json true for this event. Defaults to {entryTerms}. Per event rather than per platform because the set of consents differs between races — an event with different wording is an INSERT, not a deploy. Enforced by entries.assert_purchase_consents() and by create_pending_purchase().';

-- =========================================================================================
-- The static rules — check constraints, every one NOT VALID
-- =========================================================================================

-- --- consents are booleans ----------------------------------------------------------------
-- `jsonb_path_exists` is immutable, which is what makes it legal in a CHECK — the `_tz`
-- variants are only stable and would be refused. The path reads "is there any value in this
-- object whose type is not boolean", and the constraint is that there is not.
--
-- An empty object passes, and deliberately: *which* consents are required is the event's
-- business, one section down. This constraint is only about what a consent answer may be.
alter table entries.entry_purchases
  add constraint entry_purchases_consents_are_boolean check (
    not jsonb_path_exists(consents, '$.* ? (@.type() != "boolean")')
  ) not valid;

-- --- the purchaser's email ------------------------------------------------------------------
-- **Strictly weaker than what the form already applies**, which is the property that makes it
-- safe. Zod's `z.email()` requires a dot-separated domain and a two-character minimum on the
-- last label, so nothing this rejects could ever have got through the form — while `a@`,
-- which the original `position('@' in …) > 1` accepts, is now refused.
--
-- Deliberately not stricter than that. An over-tight email pattern rejects a real entrant at
-- the worst possible moment, and the club's actual check on an address is that a confirmation
-- arrives at it. The original constraint is left in place rather than replaced: this migration
-- adds locks, it does not remove any.
alter table entries.entry_purchases
  add constraint entry_purchases_purchaser_email_shape check (
    purchaser_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) not valid;

-- --- a birth year somebody could have --------------------------------------------------------
-- The form has refused a year before 1900 since it was written, on the grounds that below it a
-- typo is far likelier than a life. The database took 1823 without comment — and a minimum age
-- does not catch it, because a 200-year-old is comfortably over 18.
alter table entries.entrants
  add constraint entrants_date_of_birth_plausible check (
    date_of_birth >= date '1900-01-01'
  ) not valid;

-- --- an emergency contact number with a number in it -------------------------------------------
-- The digits are counted rather than the string matched, exactly as the form counts them, so
-- spaces, brackets, dashes and a leading `+` are all still fine. A single `-` is not: this is
-- the field somebody rings from the side of a course.
alter table entries.entrants
  add constraint entrants_emergency_phone_has_digits check (
    length(regexp_replace(emergency_contact_phone, '[^0-9]', '', 'g')) >= 7
  ) not valid;

-- =========================================================================================
-- The contextual rules — triggers, because a CHECK cannot see another table
-- =========================================================================================
-- All three are `security definer` with `set search_path = ''` and every name qualified, for
-- the same reason every function in this schema is: an unpinned search_path on a definer
-- function is the standard Postgres escalation. A trigger does not strictly need `definer`
-- today, because nothing without table privilege can reach these tables — it has it so the
-- rule still holds on the day something does.
--
-- **Every message names the rule and never the value.** No name, no number, no date of birth
-- reaches an error string: an exception travels into a log, and no personal data goes in a log
-- on this platform, error paths included. That is why none of these says which entrant.
--
-- `check_violation` is the errcode on purpose. `create_pending_purchase` already handles it,
-- so an entry that trips one of these comes back as the structured `invalid_entrants` refusal
-- the Worker has rendered since Slice B, rather than as a 500.

-- --- entrants -------------------------------------------------------------------------------
create or replace function entries.assert_entrant_rules()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  -- Named columns rather than a `%rowtype` record: plpgsql cannot select a scalar and a
  -- whole row into a mixed target list, and these four are the whole of what the rules below
  -- need from two tables.
  v_requires_ea boolean;
  v_event_date date;
  v_minimum_age int;
  v_entrants_per_entry int;
begin
  select fee.requires_ea_number, event.event_date, event.minimum_age, event.entrants_per_entry
    into v_requires_ea, v_event_date, v_minimum_age, v_entrants_per_entry
    from entries.entry_purchases as purchase
    join entries.fees as fee on fee.id = purchase.fee_id
    join entries.events as event on event.id = purchase.event_id
   where purchase.id = new.purchase_id;

  if not found then
    -- An entrant with no purchase behind it cannot be judged against anything. The foreign
    -- key already refuses it; this is what happens if that is ever relaxed.
    raise exception 'an entrant must belong to a purchase'
      using errcode = 'check_violation';
  end if;

  -- **The biconditional, and both halves matter.** Missing where it is required is the £2
  -- the club does not get and cannot check. Present where it is not required is an
  -- identifier held for no purpose, which is the minimisation rule one floor down from
  -- where `parseNnEntry` applies it.
  if v_requires_ea and new.ea_number is null then
    raise exception 'this entry type requires an England Athletics number'
      using errcode = 'check_violation';
  end if;

  if not v_requires_ea and new.ea_number is not null then
    raise exception 'this entry type does not take an England Athletics number'
      using errcode = 'check_violation';
  end if;

  -- Nobody is born after the race they are entering.
  if new.date_of_birth > v_event_date then
    raise exception 'a date of birth cannot be after the event date'
      using errcode = 'check_violation';
  end if;

  -- The same rule `create_pending_purchase` applies and the same rule `ageOn` in
  -- packages/shared/src/age-category.ts applies: completed years at `event_date`, so a
  -- birthday on race day counts.
  if v_minimum_age is not null
     and pg_catalog.date_part(
           'year',
           pg_catalog.age(v_event_date::timestamp, new.date_of_birth::timestamp)
         )::int < v_minimum_age
  then
    raise exception 'this entrant is under the minimum age for the event'
      using errcode = 'check_violation';
  end if;

  -- A leg is which part of a relay somebody runs. On a solo race there is no such thing, and
  -- on a paired race there are exactly two. `leg > 0` was the whole of the old rule.
  if v_entrants_per_entry = 1 and new.leg is not null then
    raise exception 'a solo event has no legs'
      using errcode = 'check_violation';
  end if;

  if new.leg is not null and new.leg > v_entrants_per_entry then
    raise exception 'the leg is beyond the number of entrants this event takes'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function entries.assert_entrant_rules() is
  'Every entrant rule that needs the fee or the event row: the England Athletics number in both directions, a date of birth before the race and after 1900, the minimum age, and the leg. Granted to nobody — reached only by its trigger.';

revoke all on function entries.assert_entrant_rules() from public;

create trigger entrants_obey_their_event
  after insert or update on entries.entrants
  for each row execute function entries.assert_entrant_rules();

-- --- medical notes ---------------------------------------------------------------------------
-- **The lock the separate table was argued for, finally fitted.** The first entries migration
-- says the absence of a row *is* the record of a withheld consent — "there is no state where
-- notes are stored and the consent that would have permitted them is false". That was true of
-- the path through `create_pending_purchase`, which drops them, and of no other path. It is
-- true of every path now.
create or replace function entries.assert_medical_consent()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_consented boolean;
begin
  select (purchase.consents -> 'medical') = 'true'::jsonb
    into v_consented
    from entries.entrants as entrant
    join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
   where entrant.id = new.entrant_id;

  if not coalesce(v_consented, false) then
    raise exception 'medical information may not be stored without the separate medical consent'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function entries.assert_medical_consent() is
  'Refuses a medical note whose purchase did not record the separate medical consent. Special category data under UK GDPR Article 9 — the consent is the lawful basis, and this is what makes the note and the basis inseparable. Granted to nobody.';

revoke all on function entries.assert_medical_consent() from public;

create trigger entrant_medical_needs_consent
  after insert or update on entries.entrant_medical
  for each row execute function entries.assert_medical_consent();

-- --- the consents on a purchase ---------------------------------------------------------------
create or replace function entries.assert_purchase_consents()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_required text[];
  v_key text;
begin
  select event.required_consents into v_required
    from entries.events as event
   where event.id = new.event_id;

  foreach v_key in array coalesce(v_required, array[]::text[])
  loop
    -- `= 'true'::jsonb` rather than a cast: it demands the json boolean `true` and refuses
    -- the string `"true"`, a number, and an absent key, in one comparison. The companion
    -- table constraint has already refused anything that is not a boolean at all.
    if (new.consents -> v_key) is distinct from 'true'::jsonb then
      raise exception 'a consent this event requires was not agreed'
        using errcode = 'check_violation';
    end if;
  end loop;

  return null;
end;
$$;

comment on function entries.assert_purchase_consents() is
  'Refuses a purchase that has not agreed every consent in events.required_consents. Per event rather than per platform, because the set of consents differs between races. Granted to nobody.';

revoke all on function entries.assert_purchase_consents() from public;

create trigger entry_purchases_have_their_consents
  after insert or update on entries.entry_purchases
  for each row execute function entries.assert_purchase_consents();

-- =========================================================================================
-- entries.create_pending_purchase() — the same function, with two rules it did not have
-- =========================================================================================
-- **Replaced rather than reopened for tidying.** The advisory lock, the capacity count, the
-- pricing, the discount arithmetic, the hold and the write block are character for character
-- what they were; the lock literal `'entries.create_pending_purchase'` is untouched, because
-- `record_checkout_event` shares it and renaming it would silently unserialise a revival from
-- a live entry. What is added is two refusals and one drop, and they are marked where they sit.
--
-- Two new reasons, and `packages/shared/src/entry-purchase.ts` parses the reason with
-- `.catch('unknown')` — so a Worker deployed before this migration meets one of them and
-- degrades to "we could not complete this" rather than throwing. Nothing sequences the two.
--
--   `ea_number_required`  the chosen fee wants an England Athletics number and none came.
--   `consents_missing`    a consent this event requires was not agreed.
--
-- Both are drift if they ever reach the deployed form, because Zod refuses both first. They
-- are separate reasons rather than `invalid_entrants` because they are the two a person could
-- act on, and because a log line naming them is the difference between "the form and the
-- database disagree about consents" and "something in the entrant block was wrong".
create or replace function entries.create_pending_purchase(
  p_slug text,
  p_fee_code text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_entrants jsonb,
  p_medical jsonb,
  p_consents jsonb,
  p_discount_code text default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_event entries.events;
  v_fee entries.fees;
  v_discount_id uuid;
  v_percent_off int;
  v_wanted int;
  v_taken int;
  v_amount int;
  v_purchase_id uuid;
  v_hold_expires_at timestamptz;
  v_medical_consent boolean;
  v_entrant jsonb;
  v_position int;
  v_notes text;
  v_entrant_id uuid;
  v_age int;
  v_consents jsonb;
  v_key text;
  v_ea text;
begin
  -- --- the event, and whether it is taking entries at all ---------------------------------
  select * into v_event from entries.events where slug = p_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if not v_event.active
     or v_event.entries_open_at is null
     or pg_catalog.now() < v_event.entries_open_at
     or (
       v_event.entries_close_at is not null
       and pg_catalog.now() >= v_event.entries_close_at
     )
  then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- --- how many places this entry wants ----------------------------------------------------
  if p_entrants is null or pg_catalog.jsonb_typeof(p_entrants) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  v_wanted := pg_catalog.jsonb_array_length(p_entrants);

  if v_wanted <> v_event.entrants_per_entry then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  if p_medical is not null
     and pg_catalog.jsonb_typeof(p_medical) = 'array'
     and pg_catalog.jsonb_array_length(p_medical) <> v_wanted
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- --- NEW: the consents this event requires ------------------------------------------------
  -- **Checked before anything is written and before the lock is taken**, because it is a fact
  -- about the submission rather than about the field, and a submission that never agreed the
  -- terms should not queue behind anybody.
  --
  -- Recorded as it arrives, exactly as before — this function's job is to record faithfully
  -- what was ticked. What is new is that it will not record a *missing* answer to a question
  -- the event insists on asking.
  v_consents := coalesce(p_consents, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_consents) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  foreach v_key in array coalesce(v_event.required_consents, array[]::text[])
  loop
    if (v_consents -> v_key) is distinct from 'true'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'consents_missing');
    end if;
  end loop;

  -- --- the capacity lock ---------------------------------------------------------------------
  -- Unchanged, including the literal. `record_checkout_event` takes the same one, and that is
  -- the point rather than a duplication to tidy — see the note in the webhook migration.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_event.id::text)
  );

  -- --- how many places have gone ---------------------------------------------------------
  select pg_catalog.count(*)::int
    into v_taken
    from entries.entry_purchases as purchase
    join entries.entrants as entrant on entrant.purchase_id = purchase.id
   where purchase.event_id = v_event.id
     and (
       purchase.status = 'paid'
       or (
         purchase.status = 'pending'
         and (
           purchase.hold_expires_at is null
           or purchase.hold_expires_at > pg_catalog.now()
         )
       )
     );

  if v_taken + v_wanted > v_event.capacity then
    return jsonb_build_object('ok', false, 'reason', 'sold_out');
  end if;

  -- --- the price, from the database and from nowhere else -----------------------------------
  select * into v_fee
    from entries.fees
   where event_id = v_event.id
     and code = p_fee_code
     and active
     and (valid_from is null or valid_from <= pg_catalog.now())
     and (valid_to is null or valid_to > pg_catalog.now());

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_fee');
  end if;

  v_amount := v_fee.price_pence;

  -- --- NEW: the England Athletics number, against the fee that was chosen ---------------------
  -- **The rule Slice E found missing, and the one this slice is named after.** `p_fee_code`
  -- selects the fee; the fee says whether a number is wanted; and until now nothing compared
  -- the two, so an affiliated entry with no number was accepted at the affiliated price.
  --
  -- Checked here rather than only in the trigger so that a person gets a sentence they can act
  -- on. The trigger is what makes it true for every other way into the table.
  if v_fee.requires_ea_number then
    for v_entrant in
      select value from pg_catalog.jsonb_array_elements(p_entrants) as parts(value)
    loop
      v_ea := nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'ea_number', '')), '');

      if v_ea is null then
        return jsonb_build_object('ok', false, 'reason', 'ea_number_required');
      end if;
    end loop;
  end if;

  -- --- the discount code, if one was typed ---------------------------------------------------
  if p_discount_code is not null and pg_catalog.btrim(p_discount_code) <> '' then
    select id, percent_off
      into v_discount_id, v_percent_off
      from entries.discount_codes
     where event_id = v_event.id
       and pg_catalog.lower(code::text) = pg_catalog.lower(pg_catalog.btrim(p_discount_code))
       and active
       and (max_uses is null or uses < max_uses)
     for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_discount');
    end if;

    v_amount := v_fee.price_pence - (v_fee.price_pence * v_percent_off + 50) / 100;
  end if;

  -- --- the minimum age, and now the date itself ----------------------------------------------
  -- The age check is unchanged. **What is new is that the date is judged even when no minimum
  -- age is set** — an event that admits juniors still does not admit somebody born after the
  -- race, and `minimum_age is null` used to mean this whole block was skipped.
  begin
    for v_entrant in
      select value from pg_catalog.jsonb_array_elements(p_entrants) as parts(value)
    loop
      if (v_entrant ->> 'date_of_birth')::date > v_event.event_date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
      end if;

      if v_event.minimum_age is not null then
        v_age := pg_catalog.date_part(
          'year',
          pg_catalog.age(
            v_event.event_date::timestamp,
            (v_entrant ->> 'date_of_birth')::date::timestamp
          )
        )::int;

        if v_age < v_event.minimum_age then
          return jsonb_build_object('ok', false, 'reason', 'under_minimum_age');
        end if;
      end if;
    end loop;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end;

  -- --- everything that writes, in one block that can be undone whole ------------------------
  -- The tables carry their own check constraints and, since this migration, their own
  -- triggers. Both raise `check_violation`, which this handler already turns into a structured
  -- refusal with no half-written entry behind it.
  begin
    if v_discount_id is not null then
      update entries.discount_codes set uses = uses + 1 where id = v_discount_id;
    end if;

    v_hold_expires_at := pg_catalog.now() + interval '31 minutes';

    insert into entries.entry_purchases (
      event_id, status, amount_pence, fee_id, discount_code_id,
      purchaser_email, purchaser_name, consents, consent_version, hold_expires_at
    ) values (
      v_event.id,
      'pending',
      v_amount,
      v_fee.id,
      v_discount_id,
      p_purchaser_email::extensions.citext,
      p_purchaser_name,
      v_consents,
      v_event.consent_version,
      v_hold_expires_at
    )
    returning id into v_purchase_id;

    v_medical_consent := coalesce((v_consents ->> 'medical')::boolean, false);

    for v_position, v_entrant in
      select ordinality, value
        from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
    loop
      insert into entries.entrants (
        purchase_id, first_name, last_name, date_of_birth, gender, club, ea_number, leg,
        emergency_contact_name, emergency_contact_phone
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        v_entrant ->> 'gender',
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
        -- **NEW: dropped rather than refused when the fee does not want one.** Minimisation
        -- happens at the boundary on this platform — `parseNnEntry` already drops it, and a
        -- caller that reaches here another way gets the same treatment rather than an error
        -- about a field it should not have sent. The trigger refuses what survives, and
        -- nothing survives this.
        case
          when v_fee.requires_ea_number
          then nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'ea_number', '')), '')
          else null
        end,
        (v_entrant ->> 'leg')::int,
        v_entrant ->> 'emergency_contact_name',
        v_entrant ->> 'emergency_contact_phone'
      )
      returning id into v_entrant_id;

      if v_medical_consent and p_medical is not null then
        v_notes := pg_catalog.btrim(coalesce(p_medical ->> (v_position - 1)::int, ''));

        if v_notes <> '' then
          insert into entries.entrant_medical (entrant_id, notes)
          values (v_entrant_id, v_notes);
        end if;
      end if;
    end loop;
  exception
    when check_violation or not_null_violation or invalid_text_representation
      or invalid_datetime_format or datetime_field_overflow or string_data_right_truncation then
      return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase_id,
    'amount_pence', v_amount,
    'fee_label', v_fee.label,
    'hold_expires_at', v_hold_expires_at
  );
end;
$$;

comment on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) is
  'Holds a place and records a pending purchase, in one transaction under a per-event advisory lock. Prices from entries.fees and never from the caller; refuses an entry that has not agreed the event''s required consents or that lacks an England Athletics number the chosen fee requires. Returns a structured result rather than raising, so a sold-out race can be rendered as a page.';

-- The grant is unchanged and is restated so the complete list is readable in one place.
revoke all on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) from public;

grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) to anon;
