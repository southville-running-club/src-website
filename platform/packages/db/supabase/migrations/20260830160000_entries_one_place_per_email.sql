-- ===========================================================================================
-- One place per email address — on entry, and on transfer
-- ===========================================================================================
-- **This reverses a decision, and the decision it reverses is written down with its reasons.**
-- `20260827090000_entries_one_runner_one_place.sql` chose first name, last name and date of
-- birth as the identity a place is counted against, and said explicitly why the address was
-- not it: *"The purchaser is not the entrant, so `purchaser_email` is the wrong key. One card
-- legitimately pays for a partner, and refusing that would cost a real runner a place at the
-- moment they are paying."*
--
-- That reasoning has not become wrong. **It has been overruled**, deliberately and by the
-- club, on 30 August 2026: an email address may hold **one** live place on an event, and a
-- second is refused. What the club is buying is that one address is one entrant, which makes
-- the entry list, the start list and every message about a place addressable by the thing
-- people actually quote when they get in touch.
--
-- ⚠️ **What it costs, stated here because the next person to read this will not have been in
-- the conversation.** A couple entering together on one card, a parent entering two children,
-- and anybody entering on behalf of somebody without an address of their own are now refused
-- at the moment they pay. That is a real runner losing a place, which is the failure direction
-- this repository avoids everywhere else — and it is the accepted cost of the rule, not an
-- oversight in it. **If it starts happening, the answer is to revisit this decision**, not to
-- add an exception to the function.
--
-- **Name and date of birth stay exactly as they are.** This is a second rule beside the first,
-- not a replacement for it: `already_entered` still refuses the same runner submitting twice,
-- which is the case that actually happens, and it catches somebody who used a different
-- address the second time. The two overlap and neither subsumes the other.
--
-- ## The refusal is its own reason, and it is answered at the field
--
-- `email_already_entered` rather than folding into `already_entered`, because the two are
-- different sentences to a person: one says *you already have a place* and the other says
-- *this address already has a place, which may not be yours*. The Worker answers it beside the
-- email box the way `invalid_discount` is answered beside the code box, rather than as a page
-- state — it is a thing about one field, and the person can fix it by using another address.
--
-- ## Live, and only live
--
-- `paid`, or `pending` with a hold that has not lapsed — the same predicate the capacity count
-- and the name rule already use. An expired hold released its place and a refunded entry had
-- its entrants deleted, so an address whose attempt failed, or whose entry the club cancelled,
-- must be able to enter again. Anything stricter strands somebody permanently on the strength
-- of a payment that never completed.
--
-- ## Inside the lock, like every other capacity rule
--
-- The check sits with the others inside the per-event advisory lock, so two submissions from
-- one address a millisecond apart cannot both find nothing and both insert. Outside it this
-- would be a race with a thirty-one minute window — which is exactly the window somebody
-- re-submitting a form is inside.
--
-- ## What this does not touch
--
-- **`create_manual_entry()` is unchanged**, deliberately. Giving a place away is a volunteer
-- deciding, one at a time, from `/admin/nn/` — the club's two complimentary places and a
-- visually impaired runner's guide are exactly the cases a blanket address rule would refuse,
-- and there is a human on that path to judge it. A rule whose job is to catch somebody
-- double-submitting a public form has no business refusing a volunteer who means it.
--
-- **A guide is unaffected.** A guide rides on the runner's own purchase (ADR-022), so a
-- visually impaired runner and their guide are one purchase and one address, not two.
--
-- ## Re-pasted, not patched
--
-- Both functions are `create or replace` on migration-defined functions, so the bodies below
-- are byte-for-byte what `20260830140000_entries_runner_phone.sql` left, apart from the new
-- block in each and this header. Neither signature changes, so there is no second overload for
-- PostgREST to choose between; `transfer_entry()`'s ten-argument wrapper is untouched and goes
-- on delegating to the eleven-argument form replaced here.

-- -------------------------------------------------------------------------------------------
-- entries.create_pending_purchase() — an address may hold one place
-- -------------------------------------------------------------------------------------------
create or replace function entries.create_pending_purchase(
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
        club, ea_number, leg, emergency_contact_name, emergency_contact_phone, role, email,
        phone
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
-- entries.transfer_entry() — and a place may not be moved onto an address that has one
-- -------------------------------------------------------------------------------------------
-- The same rule on the other path. Without it the transfer form is simply the way round the
-- entry form: a place moved onto an address that already holds one leaves that address with
-- two, which is the state this migration exists to make unreachable.
--
-- **`p_email` is the new purchaser, and that is what makes it the right column to test.**
-- `transfer_entry()` re-points `purchaser_email` at the person receiving the place, so the row
-- it is about to write is the one the rule has to be true of afterwards. The purchase being
-- transferred is excluded from the count by `purchase.id <> p_purchase_id`, exactly as the
-- name rule beside it already does — moving a place onto the address that already holds *that
-- place* is a correction, not a second entry.

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

comment on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text, text) is
  'Moves one paid entry to a different runner: replaces the entrant, deletes their predecessor''s medical note, recorded gender and phone number, and re-points the purchase at the new email with person_id null. Takes the new runner''s own phone number, which may be null — the entry form requires one and this does not. Takes no money and gives none back — the place never returns to the pool. Refuses unless the caller holds nn.entry.cancel, and re-applies the minimum age, the one-runner-one-place rule and the one-place-per-email rule.';

revoke all on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text, text) from public;
grant execute on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text, text) to authenticated;
