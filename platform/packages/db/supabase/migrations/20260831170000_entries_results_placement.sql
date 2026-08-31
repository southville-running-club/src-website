-- ===========================================================================================
-- Where a non-binary runner's result counts, if anywhere — Option A of PR E
-- ===========================================================================================
-- **The question the form has been silent about since ADR-020.** `entrants.gender` has
-- accepted `non_binary` since the very first migration, and `ageCategoryFor()` has always
-- answered `gender-has-no-categories` for it — an honest "the club has not decided", not a
-- refusal. That was right while nobody had asked the follow-up. This migration is the
-- follow-up: selecting non-binary now reveals a second question — place me in the men's
-- results, place me in the women's results, or do not place me in either — and the answer is
-- what age-category derivation, the admin surface and the exports read from now on, rather
-- than raw `gender`.
--
-- **Two columns, two questions, and neither is new to this schema's shape.** `gender` stays
-- exactly what ADR-020 made it: the closed list of three the club awards prizes in. This adds
-- `result_placement` beside it — nullable, two-valued when it is set at all
-- (`'female' | 'male'`), and the answer that decides which band, if any, an entrant's result
-- is published in. **`gender_identity` is a different field again and this does not touch
-- it** — that one is free text nothing derives a category from; this one is a closed choice
-- that a category is derived from, for exactly the entrants for whom `gender` alone cannot
-- say which.
--
-- **Constrained to only ever mean something for a non-binary entrant.** A female or male
-- runner has already answered the only question that decides their band; asking them a second
-- one would be inventing a question nobody asked them, and letting the column hold a value
-- for them would make "does this row have an opinion about placement" ambiguous with "was
-- this runner even asked". `entrants_result_placement_only_non_binary` is what refuses the
-- inconsistent state at the database, not merely at the form.
--
-- **Downstream reads `result_placement` where it used to read `gender` for banding purposes,
-- and gender_identity for nothing — this is the field that changes that.** Age category
-- derivation, the admin "by category" panel, the admin entry list's category cell, the entry
-- detail page, and the printed start list all resolve gender and placement into one effective,
-- two-valued-or-null category before asking which band an age falls in — see
-- `packages/shared/src/age-category.ts`'s new `effectiveCategory()`. **Nothing in any of them
-- needs a third branch**, because the resolution happens once, in one place, before any of
-- them sees the result.
--
-- **The transfer form does not ask for a fresh placement, and `transfer_entry()` clears the
-- column rather than carrying it across** — the same treatment `gender_identity` already
-- gets, for the same reason: a placement is an answer from a specific person, and carrying it
-- onto whoever the place moves to would file their answer under a new name. Asking the new
-- runner where their own result should count, if they are non-binary, is a decision this
-- migration does not take — the admin transfer form is unchanged, and a runner transferred
-- into a non-binary category lands with `result_placement` null until that is built.
--
-- **`create_manual_entry()` accepts it as an optional key on the entrant payload**, the same
-- way it already accepts `gender` and `gender_identity` — a volunteer assigning a
-- complimentary place can set it if they know the answer, and the row is simply unplaced if
-- they do not.
--
-- See ADR-031, which supersedes nothing in ADR-020 and extends the gap ADR-020's own
-- "Revisit when" section named.

alter table entries.entrants
  add column result_placement text;

comment on column entries.entrants.result_placement is
  'Where a non-binary entrant''s result counts, if anywhere: ''female'', ''male'', or null for '
  '"do not place me in either". Null and unasked for every runner whose gender is not '
  'non_binary. Never derives, groups, sorts or is published as a fact on its own — it is read '
  'alongside gender to resolve the effective age-category band. See ADR-031.';

alter table entries.entrants
  add constraint entrants_result_placement_only_non_binary
  check (result_placement is null or gender = 'non_binary');

alter table entries.entrants
  add constraint entrants_result_placement_shaped
  check (result_placement is null or result_placement in ('female', 'male'));


-- -------------------------------------------------------------------------------------------
-- entries.create_pending_purchase() — reads result_placement off the entrant payload
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from 20260831100000_entries_hold_takes_a_key.sql — byte-for-byte
-- apart from this header and the one new line in the insert.
--
-- ⚠️ **Rebased onto that migration rather than onto
-- 20260830160000_entries_one_place_per_email.sql**, which is what this branch was cut
-- against. #178 landed first and replaced the nine-argument form with a ten-argument one
-- taking `p_key`, so re-pasting the older body would not have replaced this function at
-- all — it would have created a second overload beside it. PostgREST refuses an ambiguous
-- call, and the spare overload would have been the unguarded, key-free hold ADR-029 exists
-- to close.

create or replace function entries.create_pending_purchase(
  p_slug text,
  p_fee_code text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_entrants jsonb,
  p_medical jsonb,
  p_consents jsonb,
  p_discount_code text default null,
  p_preview boolean default false,
  -- **Last, and defaulted, because everything before it is what the entry *is*.** A caller
  -- that does not send it is refused rather than erroring, so the deployed Worker's calls
  -- during a deploy answer `unauthorised` — one of this function's own outcomes, which the
  -- Worker already knows how to render — instead of PostgREST reporting no such function.
  p_key text default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  -- The digest of the entry key, read once at the top of the body. `text` rather than
  -- `bytea` because that is what the column holds and what `encode(..., 'hex')` returns.
  v_key_digest text;
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
  -- --- the caller, before anything else ----------------------------------------------------
  -- **First, so a wrong key cannot be used to learn anything.** Checked before the event is
  -- looked up, exactly as `record_checkout_event()` checks before the purchase is: every
  -- refusal below this line discloses something a probe would like — whether a slug exists,
  -- whether the window is open, how many places are left, whether an address already holds a
  -- place. None of that is answerable without the key.
  --
  -- **A null digest refuses everything**, which is the state this ships in. See the header.
  select secret.key_sha256 into v_key_digest
    from entries.webhook_secrets as secret
   where secret.name = 'entry';

  if v_key_digest is null
     or p_key is null
     or pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
        ) is distinct from v_key_digest
  then
    -- **Not constant time, and it does not need to be** — the same argument the webhook's own
    -- check is written under. What a perfect timing oracle over PostgREST would leak is the
    -- *digest*, which is already assumed public; the preimage is 32 random bytes.
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;
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

  -- --- one place per email address ------------------------------------------------------------
  -- **A second rule beside the name one, not a replacement for it.** See this migration's
  -- header for the decision and for what it costs: the address is now an identity, so a card
  -- that legitimately pays for a partner is refused. That is the accepted trade.
  --
  -- ⚠️ **`pg_catalog.lower(…::text)`, and NOT the `citext` `=` this column's type invites.**
  -- This function runs `set search_path = ''`, and the `citext` equality operator lives in
  -- `extensions` — which is not on that path. Postgres does not raise: it resolves the
  -- comparison to plain **text** equality and carries on, so `Mark@example.com` and
  -- `mark@example.com` are two different addresses and each gets a place. The rule reads as
  -- correct, the obvious test passes because both sides happen to be byte-identical, and the
  -- whole thing is defeated by one capital letter.
  --
  -- The pattern here is the one `cancel_entry()` and `request_entry_action()` already use for
  -- exactly this column and exactly this reason. **Do not "simplify" it back to `=`.**
  --
  -- Trimmed, because a trailing space is a typing accident rather than a different person —
  -- `entry_purchases_purchaser_email_shape` refuses whitespace in a stored address anyway, so
  -- this only decides whether a padded submission is answered with words or with
  -- `invalid_entrants` from the insert.
  --
  -- Counted over **purchases**, not entrants: a purchase carrying a visually impaired runner
  -- and their guide is one place-holder with one address, and joining to entrants would count
  -- it twice for no reason. `paid`, or `pending` with a hold that has not lapsed — the same
  -- predicate as above, so a lapsed attempt or a cancelled entry lets somebody try again.
  if exists (
    select 1
      from entries.entry_purchases as purchase
     where purchase.event_id = v_event.id
       and pg_catalog.lower(purchase.purchaser_email::text)
           = pg_catalog.lower(pg_catalog.btrim(p_purchaser_email))
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
    return jsonb_build_object('ok', false, 'reason', 'email_already_entered');
  end if;

  -- --- a runner gives a phone number, and a guide is not asked for one ------------------------
  -- **The eighteenth field, and the rule that makes it one.** ADR-025: the entry form asks
  -- every runner for a number the club can reach them on, so `/nn/privacy/`'s claim to hold
  -- one is true of every entry rather than of some. `parseNnEntry` refuses a blank box first
  -- and this is what a submission arriving by any other route meets — the published anon key
  -- posting straight at PostgREST is the route that matters, and it is the one the form's own
  -- validation cannot see.
  --
  -- **Named rather than folded into `invalid_entrants`**, for the reason `consents_missing` is:
  -- a log line saying `phone_required` says the form and the database disagree about what was
  -- asked, and one saying `invalid_entrants` says something, somewhere, in the entrant block.
  --
  -- **Positions past `v_runners` are guides and are skipped.** A guide has their own email
  -- address and their own emergency contact, and asking a second person on somebody else's
  -- entry for a third contact detail is collecting what nothing uses — see ADR-022.
  for v_position, v_entrant in
    select ordinality, value
      from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
  loop
    if v_position <= v_runners
       and nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'phone', '')), '') is null
    then
      return jsonb_build_object('ok', false, 'reason', 'phone_required');
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

  -- --- a place that costs nothing is not held ------------------------------------------------
  -- **Last of the rules, and after the discount, because the total is what this is about
  -- rather than the fee.** A £0 fee reaches it, and so does a fee a code took to nothing.
  --
  -- **Placed here rather than beside the fee lookup so it cannot change another refusal.**
  -- Every rule above answers first for a submission that breaks two things at once — a free
  -- entry from somebody under 18 still says `under_age`, which is the more useful sentence and
  -- is what it said before this migration.
  --
  -- Stripe refuses a zero-total Checkout session outright, so a held place at £0 is a place
  -- that can never be completed: it sits out of the 250 for 31 minutes and lapses. The Worker
  -- has refused this since Slice A and refuses it again on the way back; what was missing is
  -- the database saying so to a caller that never meets the Worker. Completing a free entry
  -- some other way would mean deciding that an unpaid entry counts as paid, which is a
  -- committee decision and is what `create_manual_entry()` — a different function, definer,
  -- behind `nn.entry.create` — was built to take instead.
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'free_place');
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
        result_placement, club, ea_number, leg, emergency_contact_name,
        emergency_contact_phone, role, email, phone
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        -- **Null for a guide, and the check constraint is what allows only that.** A guide is
        -- in no prize category and is not published in the results, so asking them which one
        -- they would be in was collecting an answer nothing could ever use. A runner's is
        -- still required — `entrants_gender_unless_guide` is what says so.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'gender', '')), ''),
        -- **An untouched text input posts `''`, and `''` is not an answer.** Normalised the
        -- way `club` is, so "did not say" is one value in this column rather than two.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'gender_identity', '')), ''),
        -- **Only ever set alongside `gender = 'non_binary'`, and the check constraint —
        -- not this expression — is what enforces that.** A female or male runner and a
        -- guide have no follow-up question to answer; only somebody who chose non-binary
        -- above was asked where their result should count.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'result_placement', '')), ''),
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
        case when v_position <= v_runners then 'runner' else 'guide' end,
        -- **The guide's own address, and null for a runner.** A runner is reachable through
        -- `entry_purchases.purchaser_email`, which is the address that paid; a guide has no
        -- purchase of their own, so without this the club holds no way to reach the second
        -- person it has put on the course. Normalised the way `club` is, so "did not say" is
        -- one value rather than two.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'email', '')), '')::extensions.citext,
        -- **The runner's own number, and null for a guide.** Normalised the way `club` is, so
        -- "did not say" is one value in this column rather than two. A runner reaching here
        -- without one has already been refused above; a guide is not asked, because the club
        -- reaches them through their own address and their emergency contact.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'phone', '')), '')
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

-- -------------------------------------------------------------------------------------------
-- entries.create_manual_entry() — the same one new key, on the complimentary-place path
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from 20260830140000_entries_runner_phone.sql — byte-for-byte apart
-- from this header and the one new line in the insert.

create or replace function entries.create_manual_entry(
  p_slug text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_entrants jsonb,
  p_medical jsonb,
  p_consents jsonb,
  p_reason text default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_event entries.events;
  v_fee entries.fees;
  v_wanted int;
  v_taken int;
  v_purchase_id uuid;
  v_medical_consent boolean;
  v_entrant jsonb;
  v_position int;
  v_notes text;
  v_entrant_id uuid;
  v_age int;
  v_consents jsonb;
  v_key text;
  v_runners int;
  v_expected int;
  v_guided boolean;
  v_role text;
  -- Assigned rather than written inline below — PL/pgSQL ends an `if` condition at the first
  -- `then` it meets, so a bare `case` expression in one does not compile. The note in
  -- `20260828140000_entries_discounts_and_guides.sql` has the error it produces.
  v_expected_role text;
begin
  -- **First, and through `auth.uid()` alone.** A permission read from a parameter would be a
  -- free place for anybody who can reach PostgREST with the published anon key.
  if not identity.has_permission('nn.entry.create') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select * into v_event from entries.events where slug = p_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- `active` only — see the header on why the entry window does not apply here.
  if not v_event.active then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- --- the consents, ticked by a volunteer and recorded as such -------------------------------
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

  -- **Added here rather than accepted from the caller.** A form that could choose whether to
  -- mark its own record as volunteer-recorded could choose not to, and the one property this
  -- object has to have is that it never claims a runner clicked something they never saw.
  v_consents := v_consents || jsonb_build_object('recorded_by_admin', true);

  -- --- the entrants, in exactly the shape the public path takes -------------------------------
  if p_entrants is null or pg_catalog.jsonb_typeof(p_entrants) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  v_wanted := pg_catalog.jsonb_array_length(p_entrants);

  v_guided := (v_consents -> 'vi') is not distinct from 'true'::jsonb;
  v_runners := v_event.entrants_per_entry;
  v_expected := case when v_guided then v_runners + 1 else v_runners end;

  if v_wanted <> v_expected then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

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

  -- --- the fee that says how this place got here ---------------------------------------------
  select * into v_fee
    from entries.fees
   where event_id = v_event.id
     and code = 'complimentary'
     and active;

  if not found then
    -- A distinct reason rather than `invalid_fee`, because this one is never the caller's
    -- fault: it means the row this migration inserts is missing from this event, which is a
    -- deployment problem and reads as one in the log.
    return jsonb_build_object('ok', false, 'reason', 'no_complimentary_fee');
  end if;

  -- --- the capacity lock, and the count it protects --------------------------------------------
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_event.id::text)
  );

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

  -- --- the minimum age, and the date itself ---------------------------------------------------
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

  -- --- one runner, one place, and a given place is not an exception to it -----------------------
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
  -- The loop above compares each entrant against what is committed, and both halves of this
  -- entry are written in the same transaction — so it cannot see one of them against the
  -- other. The note in `20260828140000_entries_discounts_and_guides.sql` has the full
  -- reasoning; this is the same check on the same three columns.
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

  -- --- the audit row, written before the thing it describes --------------------------------
  -- The same order `cancel_entry()` uses and for the same reason: an audit trail that only
  -- records successes is a record of the times nothing went wrong.
  perform entries.record_admin_action(
    auth.uid()::text,
    'create_manual_entry',
    jsonb_build_object(
      'event_slug', p_slug,
      'purchaser_email', p_purchaser_email,
      'entrants', v_wanted,
      'guided', v_guided,
      'reason', p_reason
    )
  );

  -- --- everything that writes, in one block that can be undone whole ------------------------
  begin
    insert into entries.entry_purchases (
      event_id, status, amount_pence, fee_id,
      purchaser_email, purchaser_name, consents, consent_version,
      hold_expires_at, paid_at, person_id
    ) values (
      v_event.id,
      -- **`paid`, literally, and the header says what that amends in ADR-010.** A fifth status
      -- would be invisible to the capacity predicate above and the place could be sold twice.
      'paid',
      -- From the fee row, never from an argument. There is no parameter that reaches this.
      v_fee.price_pence,
      v_fee.id,
      p_purchaser_email::extensions.citext,
      p_purchaser_name,
      v_consents,
      v_event.consent_version,
      -- Nothing is being held; it is already given. `entry_purchases_paid_has_timestamp`
      -- insists `paid_at` is set exactly when the status is `paid`, and this is when.
      null,
      pg_catalog.now(),
      -- **Null, and not the volunteer's.** `person_id` says whose entry this is, and it is
      -- the runner's — who very likely has no account. Left null, it behaves exactly as a
      -- signed-out purchase does: `my_entries()` matches on the confirmed address instead, so
      -- the place appears on their account the moment they register with it. Writing the
      -- volunteer's id here would file the club's gift under the volunteer's own name.
      null
    )
    returning id into v_purchase_id;

    v_medical_consent := coalesce((v_consents ->> 'medical')::boolean, false);

    for v_position, v_entrant in
      select ordinality, value
        from pg_catalog.jsonb_array_elements(p_entrants) with ordinality as parts(value, ordinality)
    loop
      insert into entries.entrants (
        purchase_id, first_name, last_name, date_of_birth, gender, gender_identity,
        result_placement, club, ea_number, leg, emergency_contact_name,
        emergency_contact_phone, role, phone
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        v_entrant ->> 'gender',
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'gender_identity', '')), ''),
        -- Same rule as `create_pending_purchase()`: only ever set alongside
        -- `gender = 'non_binary'`, enforced by the check constraint rather than here.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'result_placement', '')), ''),
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
        -- **Never, on any complimentary place.** The England Athletics number exists to
        -- justify the £2 affiliated rebate, and nothing here was charged, so collecting one
        -- would be collecting a number that decides nothing.
        null,
        (v_entrant ->> 'leg')::int,
        v_entrant ->> 'emergency_contact_name',
        v_entrant ->> 'emergency_contact_phone',
        case when v_position <= v_runners then 'runner' else 'guide' end,
        -- **Stored when it is given and never required here.** The entry form refuses a
        -- runner without one; a complimentary place is arranged by a volunteer who may only
        -- have an email address, and refusing the place over a phone number would make
        -- ADR-021's answer to Kinsi's two places conditional on ADR-025's field. The form on
        -- /admin/nn/ asks for one all the same.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'phone', '')), '')
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
    'entrants', v_wanted
  );
end;
$$;

-- -------------------------------------------------------------------------------------------
-- entries.transfer_entry() — result_placement is cleared, exactly like gender_identity
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from 20260830160000_entries_one_place_per_email.sql — byte-for-byte
-- apart from this header and the one new line in the update. Same eleven-argument signature;
-- the nine- and ten-argument wrappers are untouched and go on delegating to it.

create or replace function entries.transfer_entry(
  p_purchase_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_gender text,
  p_club text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_ea_number text,
  p_phone text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_purchase entries.entry_purchases;
  v_event entries.events;
  v_fee entries.fees;
  v_entrants int;
  v_age int;
  v_previous text;
  v_ea text;
begin
  if not identity.has_permission('nn.entry.cancel') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select * into v_purchase
    from entries.entry_purchases
   where id = p_purchase_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_purchase');
  end if;

  -- **Only a place that exists can be handed on.** A lapsed hold has already released its
  -- place and a refunded entry has no entrant to replace; both would be a transfer of nothing.
  if v_purchase.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_paid');
  end if;

  select * into v_event
    from entries.events
   where id = v_purchase.event_id;

  -- **The fee, because it is what decides the England Athletics number.** Read from the
  -- purchase rather than from anything the caller passes: a transfer never changes what was
  -- paid, so it never changes which fee's rules apply.
  select * into v_fee
    from entries.fees
   where id = v_purchase.fee_id;

  select pg_catalog.count(*)::int
    into v_entrants
    from entries.entrants
   where purchase_id = p_purchase_id;

  -- **One runner only.** An entry with two people on it — a visually impaired runner and their
  -- guide, or a relay pair — does not say which of them "transfer it" means. This refuses
  -- rather than guesses, and the admin surface does not offer the button on such a row.
  if v_entrants <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'not_a_solo_entry');
  end if;

  if p_email is null or pg_catalog.btrim(p_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrant');
  end if;

  if p_first_name is null or pg_catalog.btrim(p_first_name) = ''
     or p_last_name is null or pg_catalog.btrim(p_last_name) = ''
     or p_date_of_birth is null
     or p_gender is null or p_gender not in ('female', 'male', 'non_binary')
     or p_emergency_contact_name is null or pg_catalog.btrim(p_emergency_contact_name) = ''
     or p_emergency_contact_phone is null or pg_catalog.btrim(p_emergency_contact_phone) = ''
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrant');
  end if;

  if p_date_of_birth > v_event.event_date then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrant');
  end if;

  -- --- the England Athletics number, against the fee that was already paid ------------------
  -- **Normalised here and nowhere else.** An empty string from a text input is "did not say",
  -- and a number supplied against a fee that does not take one is dropped rather than refused —
  -- the person filling the form in cannot be expected to know which fee the purchase was on.
  v_ea := nullif(pg_catalog.btrim(coalesce(p_ea_number, '')), '');

  if v_fee.requires_ea_number then
    if v_ea is null then
      return jsonb_build_object('ok', false, 'reason', 'ea_number_required');
    end if;
  else
    v_ea := null;
  end if;

  -- **The same minimum age the entry path enforces**, because a transfer must not be a way
  -- round it. Completed years at the event date, so a birthday on race day counts.
  if v_event.minimum_age is not null then
    v_age := pg_catalog.date_part(
      'year',
      pg_catalog.age(v_event.event_date::timestamp, p_date_of_birth::timestamp)
    )::int;

    if v_age < v_event.minimum_age then
      return jsonb_build_object('ok', false, 'reason', 'under_minimum_age');
    end if;
  end if;

  -- **And the same one-runner-one-place rule.** Transferring into somebody who already holds a
  -- live place would give one person two, which the entry form refuses and this must not become
  -- the way around. Excludes this purchase, because replacing a runner with themselves is a
  -- correction rather than a duplicate.
  if exists (
    select 1
      from entries.entry_purchases as purchase
      join entries.entrants as entrant on entrant.purchase_id = purchase.id
     where purchase.event_id = v_purchase.event_id
       and purchase.id <> p_purchase_id
       and pg_catalog.lower(pg_catalog.btrim(entrant.first_name))
           = pg_catalog.lower(pg_catalog.btrim(p_first_name))
       and pg_catalog.lower(pg_catalog.btrim(entrant.last_name))
           = pg_catalog.lower(pg_catalog.btrim(p_last_name))
       and entrant.date_of_birth = p_date_of_birth
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

  -- --- and the address the place is moving to may not already hold one -------------------------
  -- The entry path's rule, applied to the row this function is about to write. Without it the
  -- transfer form is the way round the entry form.
  --
  -- **`purchase.id <> p_purchase_id` for the reason the name check above has it**: the purchase
  -- being transferred must not count against itself, or re-pointing a place at the address that
  -- already owns it — a correction of a typo, which is an ordinary thing to want — would be
  -- refused as a second entry.
  if exists (
    select 1
      from entries.entry_purchases as purchase
     where purchase.event_id = v_purchase.event_id
       and purchase.id <> p_purchase_id
       -- **`lower(…::text)` and not `citext` `=`** — see the entry path's copy of this check
       -- above for why, at length. Under `search_path = ''` the `citext` operator silently
       -- degrades to text equality and the rule becomes case-sensitive.
       and pg_catalog.lower(purchase.purchaser_email::text)
           = pg_catalog.lower(pg_catalog.btrim(p_email))
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
    return jsonb_build_object('ok', false, 'reason', 'email_already_entered');
  end if;

  select entrant.first_name || ' ' || entrant.last_name
    into v_previous
    from entries.entrants as entrant
   where entrant.purchase_id = p_purchase_id;

  -- **Written before anything changes**, and it names who is leaving as well as who is
  -- arriving. An audit trail that records only the destination cannot answer the question
  -- somebody actually asks afterwards, which is whose place this was.
  perform entries.record_admin_action(
    auth.uid()::text,
    'transfer_entry',
    jsonb_build_object(
      'purchase_id', p_purchase_id,
      'previous_runner', v_previous,
      'previous_email', v_purchase.purchaser_email,
      'amount_pence', v_purchase.amount_pence
    )
  );

  -- **The note goes with the runner it belongs to.** This is the line that stops a stranger's
  -- medical condition being filed against a new name.
  delete from entries.entrant_medical
   where entrant_id in (
     select id from entries.entrants where purchase_id = p_purchase_id
   );

  update entries.entrants
     set first_name = pg_catalog.btrim(p_first_name),
         last_name = pg_catalog.btrim(p_last_name),
         date_of_birth = p_date_of_birth,
         gender = p_gender,
         -- **Cleared, exactly like the medical note and for the same reason.** How the
         -- previous runner described themselves is a fact about them, and leaving it on the
         -- row would file one person's answer under another person's name.
         gender_identity = null,
         -- **Cleared for the same reason, and load-bearing here rather than tidy.** The
         -- transfer form does not ask the new runner where a non-binary result should
         -- count — that is a decision for its own PR — so there is no fresh value to set.
         -- Left uncleared, a placement chosen by the previous runner could survive onto a
         -- new runner whose own `gender` this statement just set to something other than
         -- `non_binary`, which `entrants_result_placement_only_non_binary` refuses outright.
         result_placement = null,
         -- **`coalesce` and `nullif` bare, not `pg_catalog.`-qualified.** Both are SQL
         -- constructs rather than functions, so qualifying them is a syntax error the
         -- migration will not catch: plpgsql does not check a function body until it runs.
         club = nullif(pg_catalog.btrim(coalesce(p_club, '')), ''),
         -- **The new runner's own, never the previous runner's.** Null on a fee that does not
         -- take one, which is what the biconditional in `assert_entrant_rules()` requires and
         -- what the unconditional null this replaces could not satisfy on an affiliated entry.
         ea_number = v_ea,
         emergency_contact_name = pg_catalog.btrim(p_emergency_contact_name),
         emergency_contact_phone = pg_catalog.btrim(p_emergency_contact_phone),
         -- **Replaced, never carried over, and that half is not optional.** A phone number is
         -- a fact about the person who gave it. Leaving the previous runner's on the row would
         -- file one person's number under another person's name and put it on the start list
         -- beside them — the same defect `gender_identity = null` two lines up exists to stop,
         -- on a field a marshal would actually ring.
         --
         -- **Null is allowed here and refused on the entry form**, because the two forms are
         -- not the same promise. `/nn/2026/` asks every runner and will not take an entry
         -- without one; a volunteer moving a place may be doing it from an email thread. The
         -- ten- and nine-argument wrappers below reach this line with null, which is what
         -- keeps a Worker deployed before this migration transferring places rather than
         -- meeting a refusal it has no wording for.
         phone = nullif(pg_catalog.btrim(coalesce(p_phone, '')), '')
   where purchase_id = p_purchase_id;

  update entries.entry_purchases
     set purchaser_email = pg_catalog.btrim(p_email),
         purchaser_name = pg_catalog.btrim(p_first_name) || ' ' || pg_catalog.btrim(p_last_name),
         -- **Null, so the entry belongs to whoever proves that address.** Exactly the state a
         -- signed-out purchase sits in; `my_entries()` matches it the moment they register and
         -- confirm.
         person_id = null,
         -- The request that prompted this is answered. The reason they gave stays, because it
         -- is the record of why this was done.
         requested_action = null,
         requested_at = null,
         request_resolved_at = pg_catalog.now()
   where id = p_purchase_id;

  return jsonb_build_object('ok', true, 'previous_runner', v_previous);
end;
$$;

-- -------------------------------------------------------------------------------------------
-- entries.admin_entry_detail() — result_placement on the page for one entry
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from
-- 20260831130000_entries_reads_show_the_email_and_the_number.sql — byte-for-byte apart from
-- this header and the one new key.
--
-- **Rebased onto that migration rather than onto 20260830140000_entries_runner_phone.sql**,
-- which is what this branch was cut against. #183 landed first; re-pasting the older body
-- would have silently taken the email and the entry number back off this read.

create or replace function entries.admin_entry_detail(p_purchase_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_purchase entries.entry_purchases;
  v_event entries.events;
  v_fee entries.fees;
  v_discount text;
  v_entrants jsonb;
  v_emails jsonb;
  v_requests jsonb;
  v_audit jsonb;
begin
  if not identity.has_permission('nn.entry.read') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_purchase_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  select * into v_purchase
    from entries.entry_purchases
   where id = p_purchase_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  select * into v_event from entries.events where id = v_purchase.event_id;
  select * into v_fee from entries.fees where id = v_purchase.fee_id;

  select code.code::text into v_discount
    from entries.discount_codes as code
   where code.id = v_purchase.discount_code_id;

  -- --- the people on it --------------------------------------------------------------------
  -- Ordered so the runner comes before the guide whatever their names are: `role` sorts
  -- `guide` before `runner` alphabetically, which is the wrong way round, so it is asked as a
  -- boolean instead.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'entrant_id', entrant.id,
               'first_name', entrant.first_name,
               'last_name', entrant.last_name,
               -- **The date itself, not only the age.** The age is what the page renders in a
               -- band and what the minimum-age rule is expressed in; the date is what
               -- one-runner-one-place is keyed on and what a volunteer needs when two people
               -- share a name. It is already in this table and already in the medical export.
               'date_of_birth', entrant.date_of_birth,
               -- The same expression `create_pending_purchase()` enforces the minimum age
               -- with: completed years at the event date, so a birthday on race day counts.
               'age', pg_catalog.date_part(
                        'year',
                        pg_catalog.age(
                          v_event.event_date::timestamp,
                          entrant.date_of_birth::timestamp
                        )
                      )::int,
               'gender', entrant.gender,
               'gender_identity', entrant.gender_identity,
               'result_placement', entrant.result_placement,
               'club', entrant.club,
               -- **No England Athletics number, and this function never had one.** The club
               -- stopped asking for and holding them on 29 August 2026 — ADR-023 — and the
               -- column survives only until the contract step, always null. A new read has no
               -- business selecting a dead column: it would render an empty row on the page
               -- for ever, and would have to be found and removed again when the column goes.
               -- Which fee was the affiliated price is `fees.affiliated`, and it is on the
               -- payment panel as the fee's own label.
               'role', entrant.role,
               'email', entrant.email::text,
               -- **The runner's own number, which this page is the natural home for.** The
               -- list is a table and a table carries what fits in a column; a number somebody
               -- rings on race morning is exactly the kind of fact that did not. Null on a
               -- guide, who is not asked, and null on every entry taken before ADR-025.
               'phone', entrant.phone,
               'emergency_contact_name', entrant.emergency_contact_name,
               'emergency_contact_phone', entrant.emergency_contact_phone,
               'created_at', entrant.created_at,
               -- Whether, never what. The note has one door and that door is audited.
               'has_medical', exists (
                 select 1 from entries.entrant_medical as medical
                  where medical.entrant_id = entrant.id
               )
             )
             order by (entrant.role = 'guide'), entrant.last_name, entrant.id
           ),
           '[]'::jsonb
         )
    into v_entrants
    from entries.entrants as entrant
   where entrant.purchase_id = p_purchase_id;

  -- --- what the club has told them, and what it still owes ----------------------------------
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', outbox.id,
               'template', outbox.template,
               'recipient', outbox.recipient::text,
               'status', outbox.status,
               'attempts', outbox.attempts,
               'last_error', outbox.last_error,
               'created_at', outbox.created_at,
               'sent_at', outbox.sent_at
             )
             order by outbox.created_at
           ),
           '[]'::jsonb
         )
    into v_emails
    from entries.email_outbox as outbox
   where outbox.purchase_id = p_purchase_id;

  -- --- what they have asked for -------------------------------------------------------------
  -- **Every ask, and this page is the only place the full list is legible.** The row on
  -- `/admin/nn/` can say that two asks exist; this is where a volunteer reads what each one
  -- said and when, which is the difference between "they want to cancel" and "they wanted to
  -- transfer on Tuesday, then changed their mind on Thursday".
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'action', request.action,
               'reason', request.reason,
               'requested_at', request.requested_at,
               'resolved_at', request.resolved_at
             )
             order by request.requested_at desc, request.id
           ),
           '[]'::jsonb
         )
    into v_requests
    from entries.entry_requests as request
   where request.purchase_id = p_purchase_id;

  -- --- what has been done to it -------------------------------------------------------------
  -- **Matched on what the detail names rather than on a foreign key**, because `admin_audit`
  -- has none: it is deliberately not referential, so a row outlives the thing it is about.
  -- Three ways an entry is named — the purchase, one of its entrants, one of its messages —
  -- and all three are asked.
  --
  -- ⚠️ **A medical read on an entrant who has since been deleted cannot be matched**, because
  -- the id it names no longer joins to anything on this purchase. That is a real gap and it is
  -- the price of `cancel_entry()` deleting the runner, which is the more important promise.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'at', audit.at,
               'action', audit.action,
               'actor', audit.actor,
               'detail', audit.detail
             )
             order by audit.at desc, audit.id
           ),
           '[]'::jsonb
         )
    into v_audit
    from entries.admin_audit as audit
   where audit.detail ->> 'purchase_id' = p_purchase_id::text
      or audit.detail ->> 'entrant_id' in (
           select entrant.id::text
             from entries.entrants as entrant
            where entrant.purchase_id = p_purchase_id
         )
      or audit.detail ->> 'outbox_id' in (
           select outbox.id::text
             from entries.email_outbox as outbox
            where outbox.purchase_id = p_purchase_id
         );

  return jsonb_build_object(
    'ok', true,
    'purchase', jsonb_build_object(
      'purchase_id', v_purchase.id,
      -- The readable half of the reference at the head of this page. The slug and `created_at`
      -- were already here; `packages/shared/src/entry-reference.ts` is what puts the three
      -- together. The purchase id stays, because it is what Stripe's metadata and the audit
      -- rows key on and a volunteer reconciling a payment needs it.
      'entry_no', v_purchase.entry_no,
      'event_slug', v_event.slug,
      'event_name', v_event.display_name,
      'event_date', v_event.event_date,
      'status', v_purchase.status,
      'attention', v_purchase.attention,
      'attention_resolved_at', v_purchase.attention_resolved_at,
      'amount_pence', v_purchase.amount_pence,
      'fee_code', v_fee.code,
      'fee_label', v_fee.label,
      'discount_code', v_discount,
      'purchaser_name', v_purchase.purchaser_name,
      'purchaser_email', v_purchase.purchaser_email::text,
      -- Whether it is claimed by an account, never which one. A uuid on a page is a fact
      -- nobody can act on; "they can see this at /account/entries/" is one they can.
      'linked_to_account', v_purchase.person_id is not null,
      -- **Which version of the terms was in force, and not what was agreed to.** See the
      -- header: no read returns `consents`, and this migration does not become the first.
      'consent_version', v_purchase.consent_version,
      'stripe_checkout_session_id', v_purchase.stripe_checkout_session_id,
      'stripe_payment_intent_id', v_purchase.stripe_payment_intent_id,
      'created_at', v_purchase.created_at,
      'hold_expires_at', v_purchase.hold_expires_at,
      'paid_at', v_purchase.paid_at,
      'revived_at', v_purchase.revived_at,
      'requested_action', v_purchase.requested_action,
      'requested_at', v_purchase.requested_at,
      'request_reason', v_purchase.request_reason,
      'request_resolved_at', v_purchase.request_resolved_at
    ),
    'entrants', v_entrants,
    'emails', v_emails,
    'requests', v_requests,
    'audit', v_audit
  );
end;
$function$;

-- -------------------------------------------------------------------------------------------
-- entries.read_entry_list() — result_placement on the admin entry-list table
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from
-- 20260831130000_entries_reads_show_the_email_and_the_number.sql — byte-for-byte apart from
-- this header and the two new lines (the inner select, the outer object).
--
-- **Rebased onto that migration rather than onto 20260829140000_entries_request_history.sql**,
-- which is what this branch was cut against. #183 landed first; re-pasting the older body
-- would have silently taken the Email column and the entry number back off `/admin/nn/`.

create or replace function entries.read_entry_list(p_event_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with event as (
    select e.*
      from entries.events as e
     where e.slug = p_event_slug
  ),
  -- Every purchase against this event, once, with the two derived facts the counts below need.
  -- Pulled out rather than repeated so "a live hold" is written exactly once in this function.
  purchase as (
    select p.id,
           p.status,
           p.amount_pence,
           -- **The address that paid.** Carried down to the row so the list can show one; see
           -- the header for why a guide's row shows a different column instead.
           p.purchaser_email,
           -- The readable half of the reference. Rendered with the event slug and the creation
           -- date by `packages/shared/src/entry-reference.ts`, never here.
           p.entry_no,
           p.attention,
           p.attention_resolved_at,
           p.fee_id,
           p.discount_code_id,
           p.created_at,
           p.paid_at,
           p.revived_at,
           p.hold_expires_at,
           p.requested_action,
           p.request_reason,
           p.request_resolved_at,
           (
             p.status = 'pending'
             and (p.hold_expires_at is null or p.hold_expires_at > pg_catalog.now())
           ) as hold_live
      from entries.entry_purchases as p
      join event on event.id = p.event_id
  ),
  -- The capacity predicate, character for character the one `create_pending_purchase()` counts
  -- with: a paid purchase, or a pending one whose hold has not run out.
  holding as (
    select entrant.id
      from purchase
      join entries.entrants as entrant on entrant.purchase_id = purchase.id
     where purchase.status = 'paid'
        or purchase.hold_live
  ),
  rows_all as (
    select entrant.id as entrant_id,
           purchase.id as purchase_id,
           entrant.first_name,
           entrant.last_name,
           entrant.club,
           -- **The same expression `create_pending_purchase()` enforces the minimum age
           -- with.** Completed years at `event_date`, so a birthday on race day counts. The
           -- band it falls in is named in TypeScript, by the one module that owns that rule.
           pg_catalog.date_part(
             'year',
             pg_catalog.age(
               event.event_date::timestamp,
               entrant.date_of_birth::timestamp
             )
           )::int as age,
           entrant.gender,
           -- **The one read of this column anywhere.** Null for most rows, because most people
           -- will not answer an optional question, and the page renders nothing when it is.
           entrant.gender_identity,
           entrant.result_placement,
           -- **Which of the two people on this purchase the row is.** A visually
           -- impaired runner and their guide are two rows of one entry, and
           -- `amount_pence` below is a fact about the *purchase* — so without this
           -- the page renders £20.00 twice and a volunteer reading down the column
           -- counts £40. The figures panel sums over purchases and always did, so
           -- the page would have disagreed with itself and the total would have been
           -- the half that was right.
           --
           -- Null for a cancelled entry, because the entrant is left joined and
           -- `cancel_entry()` deletes them. That row already renders as "No runner
           -- recorded"; a role for nobody would be a fourth thing to explain.
           entrant.role,
           -- ⚠️ **Which address, decided by the row rather than by the purchase.** A runner is
           -- reachable at `entry_purchases.purchaser_email` — the address that paid, and what
           -- `my_entries()` matches on. A **guide** is reachable at `entrants.email`, their own
           -- address, because a guide has no purchase of their own (ADR-022 as amended on
           -- 28 August 2026).
           --
           -- Printing `purchaser_email` against a guide would put the buyer's address beside
           -- somebody else's name, on the page a volunteer rings people from. So the column
           -- resolves per row.
           --
           -- **Null is a real answer and the page renders a dash for it.** A guide entered
           -- before that amendment has no address of their own; falling back to the buyer's
           -- would be the exact defect this `case` exists to prevent.
           --
           -- **A cancelled entry has no entrant at all** — `cancel_entry()` deletes them — so
           -- `role` is null and this takes the `else`. That row shows the address that paid,
           -- which is deliberate: it is the only thing left on the page that identifies a
           -- purchase somebody is ringing about, and it is the address the refund notice went
           -- to. #183.
           case
             when entrant.role = 'guide' then entrant.email::text
             else purchase.purchaser_email::text
           end as email,
           purchase.entry_no,
           entrant.ea_number,
           -- **The code this entry was bought with, or null.** Left joined, because most
           -- entries carry none — and resolved to the code itself rather than left as an id,
           -- because the page shows it beside the amount and an id means nothing to a
           -- volunteer looking for who used the Left Handed Giant allocation.
           discount.code::text as discount_code,
           fee.code as fee_code,
           fee.label as fee_label,
           fee.requires_ea_number,
           purchase.amount_pence,
           purchase.status,
           purchase.attention,
           purchase.attention_resolved_at,
           purchase.created_at,
           purchase.paid_at,
           purchase.revived_at,
           -- **So the page can say how long a held place has left**, which is the difference
           -- between "somebody is paying right now" and "this place is about to come back". The
           -- status alone cannot tell those apart: a `pending` row whose hold has lapsed is still
           -- `pending` until the five-minute sweep reaches it. Not personal data, and the one
           -- fact on the row that is about the clock rather than about a person.
           purchase.hold_expires_at,
           -- **Which entries somebody has asked the club to do something about**, and whether a
           -- volunteer has marked it dealt with. The pair travels together for the same reason
           -- `attention` and `attention_resolved_at` do: a flag with no way to clear it becomes
           -- a flag nobody looks at.
           purchase.requested_action,
           purchase.request_reason,
           purchase.request_resolved_at is not null as request_resolved,
           exists (
             select 1 from entries.entrant_medical as medical
              where medical.entrant_id = entrant.id
           ) as has_medical
      -- **Purchase-driven, with the entrant left joined.** It was entrant-driven, and that is
      -- what made a cancelled entry vanish from the page entirely: `cancel_entry()` deletes
      -- the entrants, so an inner join here had nothing to match and the purchase stopped
      -- existing as far as `/admin/nn/` was concerned. The row is the *purchase* — it is what
      -- has a status, an amount and a Stripe reference — and the runner is a fact about it
      -- that a refund legitimately removes.
      from purchase
      left join entries.entrants as entrant on entrant.purchase_id = purchase.id
      cross join event
      join entries.fees as fee on fee.id = purchase.fee_id
      left join entries.discount_codes as discount on discount.id = purchase.discount_code_id
  ),
  -- Newest first for the cap, so what is dropped is the oldest rather than an arbitrary
  -- slice. `entrant_id` is the tiebreaker, which is what makes "the most recent 2,000" mean one
  -- specific set rather than whatever the planner felt like for two rows in the same millisecond.
  rows_capped as (
    -- `entrant_id` is null for a cancelled entry now, so it can no longer be the whole
    -- tiebreaker. `purchase_id` behind it keeps "the most recent 2,000" meaning one specific
    -- set rather than whatever the planner felt like for two rows in the same millisecond.
    select * from rows_all
     order by created_at desc, entrant_id nulls last, purchase_id
     limit 2000
  )
  select case
    when not exists (select 1 from event)
      then jsonb_build_object('ok', false, 'reason', 'no_such_event')
    else jsonb_build_object(
      'ok', true,
      'event', (
        select jsonb_build_object(
          'slug', event.slug,
          'display_name', event.display_name,
          'event_date', event.event_date,
          'capacity', event.capacity,
          'taken', (select pg_catalog.count(*)::int from holding),
          'attention', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.attention is not null
               and purchase.attention_resolved_at is null
          ),

          -- ---------------------------------------------------------------------------------
          -- The entry window, for the bar at the top of the page
          -- ---------------------------------------------------------------------------------
          -- **Both are null for Nightingale Nightmare today**, and that is a decision the club
          -- has not taken rather than a gap in this function. The page says so in those words;
          -- it does not invent a closing time, because a published claim about when a race
          -- closes is exactly the kind a runner arranges a weekend around.
          'entries_open_at', event.entries_open_at,
          'entries_close_at', event.entries_close_at,

          -- ---------------------------------------------------------------------------------
          -- Where the race stands
          -- ---------------------------------------------------------------------------------
          'paid', (
            select pg_catalog.count(*)::int from purchase where purchase.status = 'paid'
          ),
          -- Paid, flagged, and nobody has cleared the flag. A subset of `paid` rather than a
          -- fifth status — there deliberately is no fifth status, because the capacity predicate
          -- counts `status = 'paid'` and a new value would be invisible to it.
          'over_capacity', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.status = 'paid'
               and purchase.attention = 'over_capacity'
               and purchase.attention_resolved_at is null
          ),
          'held', (select pg_catalog.count(*)::int from purchase where purchase.hold_live),
          -- Every hold that is no longer holding: marked `expired`, or still `pending` with a
          -- lapsed hold because the sweep has not reached it. Both are places that came back.
          'holds_returned', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.status = 'expired'
                or (purchase.status = 'pending' and not purchase.hold_live)
          ),
          'refunded', (
            select pg_catalog.count(*)::int from purchase where purchase.status = 'refunded'
          ),
          -- **Paid only.** A pending hold is somebody halfway through a payment page and an
          -- expired one is a place that came back; neither is money the club has. Stripe's own
          -- figure is the authority on what actually settled, net of card fees, and the page
          -- says so rather than implying this is a bank balance.
          'fees_pence', (
            select coalesce(pg_catalog.sum(purchase.amount_pence), 0)::bigint
              from purchase
             where purchase.status = 'paid'
          ),

          -- ---------------------------------------------------------------------------------
          -- The two panels
          -- ---------------------------------------------------------------------------------
          -- A count of notes, never a note. Paid entries only: the medical sheet is a race-day
          -- document and a lapsed hold is not a runner.
          'medical_count', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.entrant_medical as medical on medical.entrant_id = entrant.id
             where purchase.status = 'paid'
          ),
          -- **Counted off `fee.affiliated` now, not off `fee.requires_ea_number`.** They were
          -- the same column until this migration and they were never the same fact: one is
          -- "this is the price for somebody registered with England Athletics", which the club
          -- still sells and still needs a count of, and the other was "ask them for their
          -- number", which the club has stopped doing. Freezing the second to false would have
          -- taken this figure to zero with it, and a volunteer would have read that as nobody
          -- having entered affiliated.
          'affiliated', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.fees as fee on fee.id = purchase.fee_id
             where purchase.status = 'paid'
               and fee.affiliated
          ),
          -- **Zero by construction, and the key survives only for the deploy window.** It
          -- counted affiliated entries carrying no England Athletics number. No entry carries
          -- one any more — `entrants_ea_number_not_collected` forbids it — so the honest answer
          -- to the question is zero for every event, for ever. It is a literal rather than a
          -- count so nobody reads the query and thinks the figure still means something.
          --
          -- It is still emitted because `packages/shared/src/admin.ts` parses it as a required
          -- key, and the Worker deployed when this migration lands is the one that still does.
          -- The contract step drops the key and the parse together; see
          -- docs/delivery/runbooks/entries-ea-number-contract.md.
          'affiliated_missing_ea', 0,

          -- ---------------------------------------------------------------------------------
          -- Retention — the mechanism, not the published sentence
          -- ---------------------------------------------------------------------------------
          'medical_retention', event.medical_retention::text,
          'medical_delete_after', (event.event_date + event.medical_retention)::date
        )
        from event
      ),
      -- ---------------------------------------------------------------------------------
      -- The codes on offer, and how much of each is left
      -- ---------------------------------------------------------------------------------
      -- **The whole point of putting them here rather than in a runbook nobody opens.** A code
      -- is generated by a migration and exists only in this database — it is deliberately not
      -- in the repository, which is public — so this read is the only way anybody finds out
      -- what it is in order to tell the club it belongs to.
      --
      -- `uses` is the live count and it goes **down** as well as up: a lapsed hold and a
      -- refund each give a use back. So a number that looks wrong in the middle of a rush is
      -- probably a hold that has not expired yet.
      --
      -- Safe to return here for the same reason every name on this page is: `read_entry_list`
      -- is granted to nobody and is reachable only behind `nn.entry.read`.
      'discount_codes', coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'code', code.code::text,
                     'percent_off', code.percent_off,
                     'max_uses', code.max_uses,
                     'uses', code.uses,
                     'active', code.active,
                     -- Which fee it applies to, or null for any. "10% off an unaffiliated
                     -- entry" is two facts and the page has to be able to say both.
                     'fee_code', fee.code
                   )
                   order by code.code::text
                 )
            from entries.discount_codes as code
            left join entries.fees as fee on fee.id = code.fee_id
           where code.event_id = (select id from event)
        ),
        '[]'::jsonb
      ),
      'total', (select pg_catalog.count(*)::int from rows_all),
      'returned', (select pg_catalog.count(*)::int from rows_capped),
      'entries', coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'entrant_id', listed.entrant_id,
                     'purchase_id', listed.purchase_id,
                     'first_name', listed.first_name,
                     'last_name', listed.last_name,
                     'club', listed.club,
                     'age', listed.age,
                     'gender', listed.gender,
                     'gender_identity', listed.gender_identity,
                     'result_placement', listed.result_placement,
                     'role', listed.role,
                     -- See `rows_all`: the runner's is the purchase's, the guide's is their
                     -- own, and a cancelled row keeps the address that paid.
                     'email', listed.email,
                     'entry_no', listed.entry_no,
                     -- ⚠️ **The defect this migration closes.** These three have been selected
                     -- into `rows_all` since requests were added and emitted by nothing, so
                     -- `/admin/nn/` rendered every row's request as null: the wording beside
                     -- the status never appeared and the **Asked about** filter could never
                     -- match. A volunteer clicking it concluded nobody had asked for anything.
                     --
                     -- Exactly the shape of the refunded-filter defect one column along — and
                     -- a request nobody can see is worse than no request at all, because the
                     -- person who made it believes the club has it.
                     'requested_action', listed.requested_action,
                     'request_reason', listed.request_reason,
                     'request_resolved', listed.request_resolved,
                     -- **Every ask, and not only the most recent.** The three keys above are
                     -- the summary the column has always held; this is the history beside it.
                     -- Somebody who pressed *Transfer* and then *Cancel* has asked for two
                     -- opposite things, and a volunteer who can only see the second will act
                     -- on the wrong one about half the time.
                     'requests', (
                       select coalesce(
                         jsonb_agg(
                           jsonb_build_object(
                             'action', request.action,
                             'reason', request.reason,
                             'requested_at', request.requested_at,
                             'resolved_at', request.resolved_at
                           )
                           order by request.requested_at desc, request.id
                         ),
                         '[]'::jsonb
                       )
                       from entries.entry_requests as request
                      where request.purchase_id = listed.purchase_id
                     ),
                     'ea_number', listed.ea_number,
                     'discount_code', listed.discount_code,
                     'fee_code', listed.fee_code,
                     'fee_label', listed.fee_label,
                     'requires_ea_number', listed.requires_ea_number,
                     'amount_pence', listed.amount_pence,
                     'status', listed.status,
                     'attention', listed.attention,
                     'attention_resolved', listed.attention_resolved_at is not null,
                     'has_medical', listed.has_medical,
                     'created_at', listed.created_at,
                     'paid_at', listed.paid_at,
                     'hold_expires_at', listed.hold_expires_at,
                     'revived', listed.revived_at is not null
                   )
                   order by listed.last_name, listed.first_name, listed.entrant_id
                 )
            from rows_capped as listed
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

-- -------------------------------------------------------------------------------------------
-- entries.read_export() — result_placement on the start-list branch only
-- -------------------------------------------------------------------------------------------
-- Re-pasted, not patched, from 20260830140000_entries_runner_phone.sql — byte-for-byte apart
-- from this header and the one new key. The `ea` and `medical` branches are untouched: per
-- ADR-020 neither carries gender at all, and this is no different.

create or replace function entries.read_export(
  p_actor text,
  p_event_slug text,
  p_kind text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_event entries.events;
  v_rows jsonb;
begin
  if p_kind is null or p_kind not in ('ea', 'start-list', 'medical') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
  end if;

  select * into v_event from entries.events where slug = p_event_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if p_kind = 'ea' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 -- **Null for every row, and the key stays only for the deploy window.** The
                 -- club has stopped asking for the number, so there is none to put here; the
                 -- Worker deployed when this migration lands parses `ea_number` as a required
                 -- nullable key and a missing one would fail the parse and take the export
                 -- down. The contract step drops the key and the column together.
                 -- `null::text`, not a bare `null`: jsonb_build_object is variadic "any", so
                 -- an untyped null is `unknown` and Postgres refuses the call with "could not
                 -- determine polymorphic type". The cast is what makes it a JSON null.
                 'ea_number', null::text,
                 -- **On this file because the club asked for it on every export.** It is the
                 -- one document that says how many entries took the affiliated price, and a
                 -- treasurer reconciling ARC's levy against a name they cannot place needs a
                 -- way to ask. Null on every entry taken before ADR-025.
                 'phone', entrant.phone,
                 'fee_label', fee.label,
                 'amount_pence', purchase.amount_pence
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
      join entries.fees as fee on fee.id = purchase.fee_id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid'
       -- **`fee.affiliated`, because `fee.requires_ea_number` is false everywhere now.**
       -- Selecting on the old column would have returned an empty file for ever, and an
       -- export that is silently always empty is worse than one that has been removed.
       and fee.affiliated
       -- **Guides are not on this list, and leaving them on it would break the list's job.**
       -- A guide rides on a visually impaired runner's entry, which may well be the affiliated
       -- one, while paying nothing themselves — so counting them here would overstate how many
       -- affiliated entries were sold, which is the whole of what this file is now for.
       and entrant.role <> 'guide';

  elsif p_kind = 'start-list' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 -- Age and gender, not a category: the band is named by
                 -- packages/shared/src/age-category.ts and by nothing else.
                 'age', pg_catalog.date_part(
                          'year',
                          pg_catalog.age(
                            v_event.event_date::timestamp,
                            entrant.date_of_birth::timestamp
                          )
                        )::int,
                 'gender', entrant.gender,
                 'result_placement', entrant.result_placement,
                 -- **Guides are on this sheet and are marked on it.** They are on the road,
                 -- so a marshal at two in the morning has to be able to account for them —
                 -- but they are not being timed and are in no category, and a name with
                 -- nothing beside it is the one shape that helps nobody.
                 'role', entrant.role,
                 'emergency_contact_name', entrant.emergency_contact_name,
                 'emergency_contact_phone', entrant.emergency_contact_phone,
                 -- **The runner's own number beside the contact the club would ring instead.**
                 -- Two numbers on one row are worth telling apart, which is what the printed
                 -- sheet's own labels do. Null on a guide and on every entry taken before
                 -- ADR-025.
                 'phone', entrant.phone
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid';

  else
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 'notes', medical.notes
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
      join entries.entrant_medical as medical on medical.entrant_id = entrant.id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid';
  end if;

  -- **The count and never the contents.** Written in the same transaction as the read, so an
  -- export cannot leave this database without a row saying who took it and how big it was.
  --
  -- **The medical export records `medical_export`, not `export`.** The question an access
  -- review asks is "who has read medical data", and the person who downloaded every note is a
  -- larger disclosure than the person who clicked one. With a single `export` value that query
  -- has to know to look inside `detail ->> 'kind'` — and the runbook's did not, so the file was
  -- invisible while the single note was not. The kind is still recorded either way; the action
  -- is what makes the two medical reads findable together.
  perform entries.record_admin_action(
    p_actor,
    case when p_kind = 'medical' then 'medical_export' else 'export' end,
    jsonb_build_object(
      'event', v_event.slug,
      'kind', p_kind,
      'rows', pg_catalog.jsonb_array_length(v_rows)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'display_name', v_event.display_name,
      'event_date', v_event.event_date
    ),
    'rows', v_rows
  );
end;
$$;
