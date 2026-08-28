-- Three changes to the entry path: a discount code that knows which fee it is for, a way to
-- price one without holding a place, and a guide who rides on the runner's own entry.
--
-- ---------------------------------------------------------------------------------------
-- 1. A discount code is scoped to a fee
-- ---------------------------------------------------------------------------------------
-- `entries.discount_codes` has been empty since Slice A, and its own table comment says why:
-- *"A Left Handed Giant code existed in 2023: 10% off an unaffiliated entry, 22 places. Whether it
-- returns for 2026 has not been decided."* It has been decided — it returns — and the shape
-- it returns in exposes something the original table could not say.
--
-- **"10% off an unaffiliated entry" is two facts and the table held one.** `percent_off` said
-- ten; nothing said *unaffiliated*, so the code applied to whichever fee the person happened
-- to select and an affiliated entrant could take 10% off £18. `fee_id` is the missing half.
-- Null keeps the old meaning — any fee — so every future code that is genuinely unscoped
-- says so by omission rather than by a column nobody set.
--
-- **No code is seeded here, and none ever will be.** This repository is public. A code in a
-- migration is not an unguessable code, it is a published one, and the 22 places would be
-- gone before the club told anybody. The row is an `insert` a volunteer runs, which is what
-- the original table comment always intended — see
-- `docs/delivery/runbooks/entries-discount-codes.md`.
--
-- ---------------------------------------------------------------------------------------
-- 2. A use goes back when the place does
-- ---------------------------------------------------------------------------------------
-- `uses` has only ever incremented, in `create_pending_purchase()`, at the moment a *pending*
-- purchase is written. Nothing gave one back. So twenty-two people opening Stripe and closing
-- the tab would exhaust a twenty-two-place allocation with nobody entered, and the only
-- remedy was a volunteer editing a counter by hand in the middle of a live entry window.
--
-- Both paths that give a place back now give the use back with it: `expire_pending_holds()`
-- when a hold lapses, and `cancel_entry()` when a purchase is refunded. **Floored at zero**,
-- because a counter that can go negative is a counter that can be talked into extra places,
-- and the two are already race-safe under the same locks the places are.
--
-- ---------------------------------------------------------------------------------------
-- 3. A guide rides on the runner's entry
-- ---------------------------------------------------------------------------------------
-- A visually impaired runner runs with a guide, the guide is on the course, and the course
-- holds 250 people. Until now the only way a guide could be recorded was the `vi_guide` fee —
-- a separate £0 entry, which **cannot be completed**, because Stripe refuses a zero-total
-- Checkout session. So the club had no record of guides at all and the 250 was being counted
-- against runners who were not the only people running.
--
-- The guide is now a **second entrant on the runner's own purchase**. One payment, two rows,
-- no second fee. Three things fall out of that and none of them needed inventing:
--
--   * **capacity is already right.** `create_pending_purchase()` counts entrant *rows* rather
--     than purchases multiplied by `entrants_per_entry` — a decision taken in Slice B for an
--     unrelated reason — so a VI entry takes two of the 250 with no change to the count;
--   * **the minimum age and one-runner-one-place already apply**, because both loop over
--     every element of `p_entrants`. A guide under 18 is refused, and a guide who already
--     holds a place of their own is refused;
--   * **`entrant_medical` already works**, because `p_medical` is positional and the guide is
--     simply position two.
--
-- `entrants.role` is what tells them apart. Everything else about a guide is what it is about
-- any other person on the course, because that is what they are.
--
-- ---------------------------------------------------------------------------------------
-- The signature changes, and this is the one migration here that drops a function
-- ---------------------------------------------------------------------------------------
-- Every other migration in this directory replaces `create_pending_purchase()` in place, and
-- the one immediately before this one says why in as many words: *"The signature does not
-- change, so there is no second overload for PostgREST to choose between."* `p_preview`
-- changes it, so that protection has to be provided explicitly instead.
--
-- **`create or replace` with an extra defaulted parameter does not replace anything.** It
-- creates a *second* function, and PostgREST resolves an RPC call by the argument names in
-- the body — so a call naming the original eight would match both and Postgres would refuse
-- it as ambiguous. Every entry on the site would fail, at the one moment failing is most
-- expensive. The `drop` below is what stops that, and it is why it is here rather than a
-- tidy-up left for later.
--
-- **Expand, migrate, contract still holds.** The new function defaults `p_preview` to false,
-- and PostgREST calls by name, so the already-deployed Worker — which names eight arguments
-- and knows nothing about the ninth — resolves to it and behaves exactly as before. Rolling
-- the Worker back is safe; rolling this migration forward without the Worker is safe.
--
-- **A `drop` takes the grants with it**, which is why the grants are restated at the foot of
-- this file in full rather than left to `create or replace`'s inheritance. The list of
-- functions `anon` may call is still thirteen, and `packages/db/tests/entries.test.ts` is
-- what says so.
--
-- ---------------------------------------------------------------------------------------
-- What a preview is, and why it is not a fourteenth function
-- ---------------------------------------------------------------------------------------
-- Somebody who types a code should be told what it took off **before** they are sent to a
-- payment page, not after. That needs the priced amount, and the price lives in the database.
--
-- The obvious answer is a small `check_discount_code()` granted to `anon`. It was rejected:
-- adding to that list of thirteen is a decision the tests exist to force, and a function
-- whose entire job is to answer *"is this code real?"* is a brute-force oracle with a much
-- better signal-to-cost ratio than anything that exists today.
--
-- `p_preview` runs **the whole function** — the window, the entrants, the consents, the
-- capacity, the fee, the England Athletics number, the age, one-runner-one-place — and
-- returns immediately before the block that writes. So it discloses exactly what a real
-- submission already discloses, costs a full valid submission to reach, and holds no place
-- and burns no use when it gets there. It is the same attack surface, not a new one.
--
-- The control on guessing is the code itself: twelve characters from a 32-letter alphabet,
-- generated by the runbook. **There is no rate limiting live anywhere yet** — the rules in
-- `docs/reference/cloudflare-waf-rules.md` are written and not created — so the entropy is
-- doing all of the work, and the runbook says so where somebody choosing a code will read it.

-- -----------------------------------------------------------------------------------------
-- discount_codes.fee_id — which fee the code is for
-- -----------------------------------------------------------------------------------------
alter table entries.discount_codes
  add column fee_id uuid references entries.fees (id);

comment on column entries.discount_codes.fee_id is
  'Which fee this code discounts. Null means any fee. The 2026 Left Handed Giant code points at unaffiliated, because "10% off an unaffiliated entry" is two facts and percent_off is only one of them.';

comment on table entries.discount_codes is
  'Percentage discounts, per event, optionally scoped to one fee. Deliberately empty in every migration: this repository is public, so a seeded code is a published code. Rows are inserted by hand — see docs/delivery/runbooks/entries-discount-codes.md.';

-- -----------------------------------------------------------------------------------------
-- entrants.role — a runner, or the guide running with one
-- -----------------------------------------------------------------------------------------
-- **Defaulted and not null, so every row already in the table is correct without being
-- touched.** A previously deployed Worker inserts without naming it and gets `runner`, which
-- is what those entrants are.
--
-- **Two values, and a third is a decision.** A pacer, a marshal and a support runner are all
-- plausible fourth and fifth values and none of them is this. What this column exists to say
-- is that a place was taken by somebody who is not being timed and is not in a prize
-- category, and that is the whole of what reads it.
alter table entries.entrants
  add column role text not null default 'runner'
    check (role in ('runner', 'guide'));

comment on column entries.entrants.role is
  'runner, or guide — somebody guiding a visually impaired runner on the same purchase. A guide takes one of the event''s places, pays nothing, carries no England Athletics number and is in no prize category. Adding a third value is a decision, not a rendering choice.';

create index entrants_purchase_role_idx on entries.entrants (purchase_id, role);

-- -----------------------------------------------------------------------------------------
-- entries.assert_entrant_rules() — the England Athletics rule learns about guides
-- -----------------------------------------------------------------------------------------
-- **Slice G's trigger is what actually refuses a bad entrant, and it did not know a guide
-- could exist.** `create_pending_purchase()` above skips the guide when it checks for an
-- England Athletics number — a guide is not buying the affiliated price and is not claiming
-- the rebate — but this trigger checked every row, so a guide on a visually impaired runner's
-- **affiliated** entry was refused for not carrying a number nobody had asked them for.
--
-- The symptom is worse than the cause: the refusal came out of the insert block's exception
-- handler as `invalid_entrants`, which says "something, somewhere, in the entrant block" and
-- names nothing. **The £18 fee would simply have been the one price a visually impaired runner
-- could not use**, with no error saying why.
--
-- Replaced in place; the trigger that calls it is untouched, and it is still granted to
-- nobody — reachable only from that trigger. Byte-for-byte what Slice G left, apart from the
-- England Athletics block.
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

  --
  -- **A guide is outside both halves, and is given a rule of its own rather than an
  -- exemption.** They ride on a visually impaired runner's entry, which may well be the
  -- affiliated one — and they are not buying that price, are not claiming the England
  -- Athletics rebate, and are never asked for a number. Left inside the first half, this
  -- trigger refused every guide on an affiliated entry, which would have made the £18 fee the
  -- one price a visually impaired runner could not use. **`create_pending_purchase()` skipped
  -- the guide when it checked and this did not**, so the refusal arrived as `invalid_entrants`
  -- from the exception handler with nothing naming the cause — found by
  -- `entries-guides.test.ts` and not by anything else.
  --
  -- The half that still applies to them is the minimisation one, and it applies *always*: a
  -- guide's number is an identifier held for no purpose whatever the entry was sold as.
  if new.role = 'guide' then
    if new.ea_number is not null then
      raise exception 'a guide does not take an England Athletics number'
        using errcode = 'check_violation';
    end if;
  else
    -- **The biconditional, and both halves matter.** Missing where it is required is the £2
    -- the club does not get and cannot check. Present where it is not required is an
    -- identifier held for no purpose.
    if v_requires_ea and new.ea_number is null then
      raise exception 'this entry type requires an England Athletics number'
        using errcode = 'check_violation';
    end if;

    if not v_requires_ea and new.ea_number is not null then
      raise exception 'this entry type does not take an England Athletics number'
        using errcode = 'check_violation';
    end if;
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
  'Refuses an entrant that disagrees with the fee, the event date, the minimum age or the leg count. A guide is judged by its own England Athletics rule — never required, never permitted — because they ride on somebody else''s entry and pay nothing. Granted to nobody: reachable only from its trigger.';

-- -----------------------------------------------------------------------------------------
-- entries.create_pending_purchase() — dropped and recreated, for the reason in the header
-- -----------------------------------------------------------------------------------------
-- The old eight-argument function must go before the nine-argument one arrives, or PostgREST
-- has two candidates for every call naming eight and refuses them all as ambiguous. Both
-- statements are in this one migration, so they are in one transaction and there is no
-- instant at which neither exists.
drop function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
);

create function entries.create_pending_purchase(
  p_slug text,
  p_fee_code text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_entrants jsonb,
  p_medical jsonb,
  p_consents jsonb,
  p_discount_code text default null,
  p_preview boolean default false
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
  v_early boolean;
  v_runners int;
  v_expected int;
  v_guided boolean;
  v_role text;
  -- **Assigned rather than written inline in the `if` below, and that is a language rule
  -- rather than a style one.** PL/pgSQL ends an `if` condition at the *first* `then` token it
  -- meets, so `if x <> case when y then 'a' else 'b' end then` is read as the expression
  -- `x <> case when y` — which fails to compile as `syntax error at end of input`, pointing
  -- at the `case` and saying nothing about why.
  v_expected_role text;
begin
  -- --- the event, and whether it is taking entries at all ---------------------------------
  select * into v_event from entries.events where slug = p_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- **`active` and `entries_close_at` first, and they are absolute.** Whatever the caller
  -- holds, an event that has been withdrawn or whose window has shut is closed. Only the
  -- `pre_open` edge is negotiable, and only below.
  if not v_event.active
     or (
       v_event.entries_close_at is not null
       and pg_catalog.now() >= v_event.entries_close_at
     )
  then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  v_early := v_event.entries_open_at is null
             or pg_catalog.now() < v_event.entries_open_at;

  -- The bypass, and the only thing it consults is who the caller is. False for `anon`
  -- always, because `auth.uid()` is null and `has_permission()` joins nothing.
  if v_early and not identity.has_permission('nn.entry.before_open') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- --- the one consent that has to be read before the entrant list --------------------------
  -- **Only `vi`, and only because it decides how long that list is allowed to be.** The
  -- event's *required* consents are still checked below, in the order they always were:
  -- moving that loop up here as well changed which refusal a submission with two things
  -- wrong got back, so a bad entrant list with unticked terms started answering
  -- `consents_missing` where it had always answered `invalid_entrants`. Nobody meets that
  -- combination through the form, which is exactly why it would have gone unnoticed —
  -- `entries-capacity.test.ts` caught it.
  v_consents := coalesce(p_consents, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_consents) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- --- how many places this entry wants ----------------------------------------------------
  if p_entrants is null or pg_catalog.jsonb_typeof(p_entrants) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  v_wanted := pg_catalog.jsonb_array_length(p_entrants);

  -- **`vi` is not in `required_consents` and must not be.** It is a declaration a few people
  -- make, not a term everybody agrees to, and putting it in that array would refuse every
  -- entry from everybody who is not visually impaired. What it does instead is decide how
  -- long the entrant list is allowed to be.
  v_guided := (v_consents -> 'vi') is not distinct from 'true'::jsonb;
  v_runners := v_event.entrants_per_entry;
  v_expected := case when v_guided then v_runners + 1 else v_runners end;

  if v_wanted <> v_expected then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- **Position decides the role, and the payload only gets to agree with it.** Trusting a
  -- `role` key would let a submission mark its *runner* as a guide, which is a place with no
  -- fee attached to anybody. So the guide is the last element when one is declared and there
  -- is no other arrangement — a payload that says otherwise is refused rather than
  -- corrected, because a silently reordered entry is a place recorded against somebody
  -- nobody meant.
  for v_position, v_entrant in
    select ordinality, value
      from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
  loop
    v_role := coalesce(
      nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'role', '')), ''),
      'runner'
    );

    v_expected_role := case when v_position <= v_runners then 'runner' else 'guide' end;

    if v_role <> v_expected_role then
      return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
    end if;
  end loop;

  if p_medical is not null
     and pg_catalog.jsonb_typeof(p_medical) = 'array'
     and pg_catalog.jsonb_array_length(p_medical) <> v_wanted
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- --- the consents this event requires ------------------------------------------------------
  foreach v_key in array coalesce(v_event.required_consents, array[]::text[])
  loop
    if (v_consents -> v_key) is distinct from 'true'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'consents_missing');
    end if;
  end loop;

  -- --- the capacity lock ---------------------------------------------------------------------
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_event.id::text)
  );

  -- --- how many places have gone ---------------------------------------------------------
  -- **A tester's place is a real place and it is counted.** Excluding it would mean the thing
  -- being tested is not the thing that runs on 1 September — the capacity predicate is
  -- exactly what a rush of entries exercises, and a test that opts out of it proves nothing
  -- about the race that sold out in 2023. Removing a test entry afterwards is what
  -- `entries.cancel_entry()` below is for.
  --
  -- **A guide's place is a real place too, and it is counted by the same line.** This counts
  -- entrant rows rather than purchases, so it needed no change to start counting them — see
  -- the note on this in Slice B, which chose to count rows for an entirely different reason.
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

  -- The second lock on a gated price. `entry_state()` hid it; this refuses it, and the two
  -- are independent on purpose.
  if v_fee.requires_permission is not null
     and not identity.has_permission(v_fee.requires_permission)
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_fee');
  end if;

  -- **One fee for the entry, not one per person.** A guide pays nothing, so an entry with a
  -- guide on it costs exactly what the runner's own entry costs.
  v_amount := v_fee.price_pence;

  -- --- the England Athletics number, against the fee that was chosen -------------------------
  -- **The runners only.** A guide is not buying the affiliated price and is not claiming the
  -- England Athletics rebate, so asking them for a number would be asking for one nobody
  -- needs — and refusing the entry for its absence would turn the affiliated fee into a fee a
  -- visually impaired runner could not use.
  if v_fee.requires_ea_number then
    for v_position, v_entrant in
      select ordinality, value
        from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
    loop
      if v_position <= v_runners then
        v_ea := nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'ea_number', '')), '');

        if v_ea is null then
          return jsonb_build_object('ok', false, 'reason', 'ea_number_required');
        end if;
      end if;
    end loop;
  end if;

  -- --- the discount code, if one was typed ---------------------------------------------------
  if p_discount_code is not null and pg_catalog.btrim(p_discount_code) <> '' then
    -- **Matched on `lower()` rather than by letting `citext` do it.** With `search_path = ''`
    -- the citext equality operator — which lives in `extensions`, not `pg_catalog` — is not
    -- resolvable, and a definer function that unpins its search_path to get one operator has
    -- given away the property the pin was for.
    --
    -- **`fee_id` is the new half of the predicate, and it is a filter rather than a branch.**
    -- A code scoped to a fee the caller did not choose does not match, so it answers exactly
    -- as a code that does not exist does — "no such code", "withdrawn", "all gone" and "not
    -- for this fee" are one reason on purpose, because telling the four apart tells somebody
    -- who is guessing codes more than it tells somebody who mistyped one.
    select id, percent_off
      into v_discount_id, v_percent_off
      from entries.discount_codes
     where event_id = v_event.id
       and pg_catalog.lower(code::text) = pg_catalog.lower(pg_catalog.btrim(p_discount_code))
       and active
       and (max_uses is null or uses < max_uses)
       and (fee_id is null or fee_id = v_fee.id)
     for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_discount');
    end if;

    -- Integer arithmetic throughout — money in a float is a defect waiting for a percentage.
    -- `+ 50` before the division rounds the discount to the nearest penny rather than towards
    -- the club: 10% of £20.00 is exactly 200 and the rounding never fires, but a 33% code
    -- would otherwise quietly favour one side by a rule nobody had written down.
    v_amount := v_fee.price_pence - (v_fee.price_pence * v_percent_off + 50) / 100;
  end if;

  -- --- the minimum age, and the date itself ---------------------------------------------------
  -- Every element, the guide included. Somebody guiding a runner is on the same course for the
  -- same distance in the same dark, and the committee set 18 for the course rather than for
  -- the transaction.
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

  -- --- one runner, one place -----------------------------------------------------------------
  -- **The rule the form has claimed in prose since it was written, and never enforced.** The
  -- entry form says "One entry per runner." and until #115 that sentence was the only place in
  -- this platform the rule existed — not a constraint, not a trigger, not even Zod.
  --
  -- **Checked inside the advisory lock, which is what makes it sound.** The lock taken above
  -- serialises every entry for this event, so two simultaneous submissions cannot both find
  -- nothing and both insert.
  --
  -- **Keyed on name and date of birth, never on `gender` and never on `gender_identity`.**
  -- Neither is an identifier, and putting either in the key would make correcting an answer
  -- into a way of buying a second place.
  --
  -- **The guide is checked against the same rule and against the same rows**, so a guide
  -- cannot also hold an entry of their own and one person cannot guide two runners. Either
  -- would be one body in two places on a course with a hard limit on bodies.
  for v_entrant in
    select value from pg_catalog.jsonb_array_elements(p_entrants) as parts(value)
  loop
    if exists (
      select 1
        from entries.entry_purchases as purchase
        join entries.entrants as entrant
          on entrant.purchase_id = purchase.id
       where purchase.event_id = v_event.id
         and pg_catalog.lower(pg_catalog.btrim(entrant.first_name))
             = pg_catalog.lower(pg_catalog.btrim(v_entrant ->> 'first_name'))
         and pg_catalog.lower(pg_catalog.btrim(entrant.last_name))
             = pg_catalog.lower(pg_catalog.btrim(v_entrant ->> 'last_name'))
         and entrant.date_of_birth = (v_entrant ->> 'date_of_birth')::date
         and (
           purchase.status = 'paid'
           or (
             purchase.status = 'pending'
             and (
               purchase.hold_expires_at is null
               or purchase.hold_expires_at > pg_catalog.now()
             )
           )
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'already_entered');
    end if;
  end loop;

  -- --- and one person cannot be two of the entrants on this entry -----------------------------
  -- **The loop above cannot catch this, and the reason is worth stating.** It compares each
  -- entrant against what is *committed*, and both halves of this submission are written in
  -- the same transaction — so when it checks the guide, the runner it was just handed is not
  -- in any table yet and never will be until after this returns. A person entering as their
  -- own guide would therefore pass every check above and take two of the 250.
  --
  -- Keyed on the same three columns and compared the same way, so a father and son with the
  -- same name are still two people and still two places.
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as earlier(value, position)
      join pg_catalog.jsonb_array_elements(p_entrants) with ordinality as later(value, position)
        on earlier.position < later.position
     where pg_catalog.lower(pg_catalog.btrim(earlier.value ->> 'first_name'))
           = pg_catalog.lower(pg_catalog.btrim(later.value ->> 'first_name'))
       and pg_catalog.lower(pg_catalog.btrim(earlier.value ->> 'last_name'))
           = pg_catalog.lower(pg_catalog.btrim(later.value ->> 'last_name'))
       and (earlier.value ->> 'date_of_birth')::date
           = (later.value ->> 'date_of_birth')::date
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_entered');
  end if;

  -- --- a preview stops here, having proved everything and changed nothing ---------------------
  -- **The last statement before the first write, deliberately.** Every rule above has run, so
  -- what this returns is what a real submission a moment later would be charged — not a guess,
  -- and not a subset of the checks. What it has not done is hold a place, spend a use or write
  -- a row, so somebody who reads the total and closes the tab has cost the club nothing and
  -- taken nothing from anybody else.
  --
  -- `list_price_pence` is here so the page can say *"your code took £2.00 off"* without doing
  -- the arithmetic itself. A saving computed in the Worker from a price the Worker assumed is
  -- how two numbers start disagreeing.
  if p_preview then
    return jsonb_build_object(
      'ok', true,
      'preview', true,
      'amount_pence', v_amount,
      'list_price_pence', v_fee.price_pence,
      'fee_label', v_fee.label,
      'discount_applied', v_discount_id is not null
    );
  end if;

  -- --- everything that writes, in one block that can be undone whole ------------------------
  begin
    if v_discount_id is not null then
      update entries.discount_codes set uses = uses + 1 where id = v_discount_id;
    end if;

    v_hold_expires_at := pg_catalog.now() + interval '31 minutes';

    insert into entries.entry_purchases (
      event_id, status, amount_pence, fee_id, discount_code_id,
      purchaser_email, purchaser_name, consents, consent_version, hold_expires_at,
      person_id
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
      v_hold_expires_at,
      -- **Read, never passed.** A `p_person` argument on a function `anon` may call would let
      -- anybody attach their purchase to somebody else's account, which is the whole of
      -- `/account/entries/` given away. Null for every signed-out buyer, which is most.
      auth.uid()
    )
    returning id into v_purchase_id;

    v_medical_consent := coalesce((v_consents ->> 'medical')::boolean, false);

    for v_position, v_entrant in
      select ordinality, value
        from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
    loop
      insert into entries.entrants (
        purchase_id, first_name, last_name, date_of_birth, gender, gender_identity,
        club, ea_number, leg, emergency_contact_name, emergency_contact_phone, role
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        v_entrant ->> 'gender',
        -- **An untouched text input posts `''`, and `''` is not an answer.** Normalised the
        -- way `club` is, so "did not say" is one value in this column rather than two.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'gender_identity', '')), ''),
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
        case
          when v_fee.requires_ea_number and v_position <= v_runners
          then nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'ea_number', '')), '')
          else null
        end,
        (v_entrant ->> 'leg')::int,
        v_entrant ->> 'emergency_contact_name',
        v_entrant ->> 'emergency_contact_phone',
        -- Position, not payload — the loop above has already refused any list where the two
        -- disagree, so this restates the decision rather than taking it a second time.
        case when v_position <= v_runners then 'runner' else 'guide' end
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
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean
) is
  'Holds a place and records a pending purchase, in one transaction under a per-event advisory lock. Prices from entries.fees and never from the caller; a discount code scoped to a fee applies to that fee alone. A visually impaired runner declaring the vi consent may carry one extra entrant, stored with role = guide, who takes a place and pays nothing. Refuses a runner — or a guide — who already holds a live place with already_entered. p_preview runs every rule and returns the price without writing anything. Returns a structured result rather than raising.';

-- **The grants, restated in full because the drop above took them with it.** This is the same
-- pair the function has held since Slice B and #64: `anon` for a signed-out runner,
-- `authenticated` for a signed-in one — the second because a signed-in caller reaches
-- PostgREST as `authenticated` rather than because they may do more. The list of functions
-- `anon` may call is still thirteen, and `packages/db/tests/entries.test.ts` asserts it
-- exactly. **If that test fails after this migration, this migration granted something it
-- should not have.**
revoke all on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean
) from public;

grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean
) to anon;

grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean
) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.expire_pending_holds() — a lapsed hold gives the discount use back
-- -----------------------------------------------------------------------------------------
-- **One statement rather than two, and that is the point.** Expiring the purchases and
-- returning their uses in separate statements would leave a window in which the place was
-- back and the use was not, and this function runs on a five-minute cron with nothing
-- watching it. A data-modifying CTE chain makes the two atomic without a lock of its own:
-- `expired` performs the update and hands its rows to `returned`, which groups them by code,
-- which `released` decrements. **A data-modifying CTE runs whether or not the main query
-- references it**, which is why `released` is not selected from below and still happens.
--
-- **Floored at zero.** `discount_codes_within_max_uses` polices the ceiling; nothing polices
-- the floor, and a counter that can go negative is a counter that can be talked into extra
-- places by expiring the same purchase twice. It cannot expire twice — the predicate is
-- `status = 'pending'` and the update moves it off — but the floor costs one word and removes
-- the need to have reasoned that out correctly.
create or replace function entries.expire_pending_holds()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_expired int;
  v_attention int;
  v_oldest int;
begin
  with expired as (
    update entries.entry_purchases
       set status = 'expired'
     where status = 'pending'
       and hold_expires_at is not null
       and hold_expires_at < pg_catalog.now()
    returning discount_code_id
  ),
  returned as (
    select discount_code_id, pg_catalog.count(*)::int as given_back
      from expired
     where discount_code_id is not null
     group by discount_code_id
  ),
  released as (
    update entries.discount_codes as code
       set uses = greatest(0, code.uses - returned.given_back)
      from returned
     where code.id = returned.discount_code_id
    returning code.id
  )
  select pg_catalog.count(*)::int into v_expired from expired;

  -- The age of the oldest unresolved flag, in whole hours, so a glance at the log line says
  -- whether this is new or has been ignored for two days.
  select pg_catalog.count(*)::int,
         coalesce(
           pg_catalog.max(
             pg_catalog.floor(
               pg_catalog.date_part('epoch', pg_catalog.now() - purchase.attention_at) / 3600
             )
           ),
           0
         )::int
    into v_attention, v_oldest
    from entries.entry_purchases as purchase
   where purchase.attention is not null
     and purchase.attention_resolved_at is null;

  -- `hold_expires_at` is left as it was. It is the record of when the place went back, and
  -- clearing it would leave an `expired` row that cannot say why.
  return jsonb_build_object(
    'expired', v_expired,
    'attention', v_attention,
    'attention_oldest_hours', v_oldest
  );
end;
$$;

comment on function entries.expire_pending_holds() is
  'Moves lapsed pending holds to expired, returns any discount code use each was holding, and reports how many purchases are still flagged for a human. Anon-callable and takes no key: it can only undo a hold this schema created, and gating it would let places stay held on any day the key was not installed.';

-- -----------------------------------------------------------------------------------------
-- entries.cancel_entry() — a refund gives the discount use back too
-- -----------------------------------------------------------------------------------------
-- Byte-for-byte what #64 left, plus the release. It sits inside the advisory lock alongside
-- the delete that frees the place, because the place and the use are the same decision being
-- undone and a volunteer who cancels an entry has undone both.
create or replace function entries.cancel_entry(
  p_purchase_id uuid,
  p_refund_reference text default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_purchase entries.entry_purchases;
  v_entrants int;
begin
  if not identity.has_permission('nn.entry.cancel') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select * into v_purchase
    from entries.entry_purchases
   where id = p_purchase_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_purchase');
  end if;

  if v_purchase.status = 'refunded' then
    -- Idempotent by state guard, the same shape `record_checkout_event()` uses for a webhook
    -- delivered twice. A retry after a failed mark is the expected path, not an error.
    --
    -- **This is also what keeps the release below sound.** A second call returns here, so the
    -- use is given back exactly once however many times a volunteer presses the button.
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- **Under the same per-event advisory lock the entry path takes**, so a cancellation cannot
  -- interleave with `create_pending_purchase()` counting places. Freeing a place while
  -- somebody else is deciding whether the last one is gone is exactly the race the lock
  -- exists for, run backwards.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_purchase.event_id::text)
  );

  select pg_catalog.count(*)::int
    into v_entrants
    from entries.entrants
   where purchase_id = p_purchase_id;

  -- Written first, and it names what is about to be destroyed rather than what survives —
  -- an audit trail that only records successes is a record of the times nothing went wrong.
  perform entries.record_admin_action(
    auth.uid()::text,
    'cancel_entry',
    jsonb_build_object(
      'purchase_id', p_purchase_id,
      'previous_status', v_purchase.status,
      'amount_pence', v_purchase.amount_pence,
      'entrants_deleted', v_entrants,
      'refund_reference', p_refund_reference,
      'discount_code_id', v_purchase.discount_code_id
    )
  );

  -- `entrant_medical` cascades from `entrants`, which cascades from nothing — the delete here
  -- is explicit because `entrants.purchase_id` is `on delete cascade` and this is the parent
  -- going nowhere. Deleting the entrants is what releases the place: the capacity count joins
  -- purchases to entrants, so a purchase with none takes none. **A guide's row goes with the
  -- runner's**, which is right — the guide was never entering on their own account and has
  -- nobody left to guide.
  delete from entries.entrants where purchase_id = p_purchase_id;

  -- The place is back, so the use is back. Floored for the reason
  -- `expire_pending_holds()` gives, though the `refunded` guard above already makes a second
  -- release unreachable.
  if v_purchase.discount_code_id is not null then
    update entries.discount_codes
       set uses = greatest(0, uses - 1)
     where id = v_purchase.discount_code_id;
  end if;

  update entries.entry_purchases
     set status = 'refunded',
         -- `entry_purchases_paid_has_timestamp` insists that `paid_at` is set exactly when
         -- the status is `paid`. Moving off `paid` therefore has to clear it, and that is
         -- right rather than merely necessary: the row no longer asserts that this was paid.
         paid_at = null,
         hold_expires_at = null
   where id = p_purchase_id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'entrants_deleted', v_entrants
  );
end;
$$;

comment on function entries.cancel_entry(uuid, text) is
  'Cancels one purchase: audits it, deletes its entrants and their medical notes, returns any discount code use it was holding, and moves it to refunded so the place returns to capacity. Refuses unless the caller holds nn.entry.cancel. Idempotent by state guard — a retry after a failed mark is the expected path. The Stripe refund is the Worker''s, and it happens first.';
