-- Entering before entries open, an entry that belongs to somebody, and undoing one.
--
-- =========================================================================================
-- Why any of this
-- =========================================================================================
-- Nobody has ever taken a payment through this platform. Every part of the path is built and
-- tested against fixtures, and none of it has met a real card, a real Stripe account or a
-- real webhook delivery. Entries open to the public on 1 September.
--
-- The obvious way to test — set `entries_open_at` to a moment in the past — is the one thing
-- that must not happen: CLAUDE.md is explicit that the proposed opening time is unratified
-- and that this column is *the switch* rather than configuration waiting to be switched on.
-- Setting it early publishes a claim the committee has not made.
--
-- So the door stays shut and a named person is let through it.
--
-- =========================================================================================
-- The bypass is keyed on auth.uid(), and that is the whole security argument
-- =========================================================================================
-- `entries.create_pending_purchase()` is granted to `anon`, whose key is published in page
-- source. So the bypass may not be a parameter, a header, a hidden form field or anything
-- else the caller supplies — every one of those is a free early entry for whoever reads the
-- page. It is `identity.has_permission('nn.entry.before_open')`, which resolves through
-- `auth.uid()` out of a JWT the caller cannot forge, and which answers false for `anon`
-- because `auth.uid()` is null and nothing joins.
--
-- **`entries_close_at` and `active` are never bypassed.** A tester enters early. They do not
-- enter a race that has closed, and they do not enter an event somebody has withdrawn. Only
-- the `pre_open` edge moves, and only for somebody the club granted a role to.
--
-- =========================================================================================
-- Expand, migrate, contract
-- =========================================================================================
-- Two nullable columns, three new functions, and four functions re-created with the same
-- signature. Nothing existing changes shape and nothing is removed:
--
--   * **Migration first, Worker later.** `requires_permission` is null on every existing fee,
--     so `entry_state()` returns exactly what it returned before to exactly the same callers.
--     `person_id` is null on every existing purchase. The deployed Worker calls
--     `create_pending_purchase()` as `anon`, which lands on the unchanged branch of the new
--     window check and gets `closed` — which is what it gets today.
--   * **Worker first, migration later.** The Worker's new reads answer `PGRST202`, and every
--     one of them is already written to treat an unreadable answer as "closed" or "nothing to
--     show". The failure direction is unchanged: towards taking no entries.
--
-- The `nn-2026` tester fee is seeded here rather than in a runbook because a 1p price is a
-- reviewable fact about what the club charges, and `entries.fees` is where CLAUDE.md says
-- prices live — "never in markup", and equally never in somebody's psql history.
--
-- See docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md and
-- docs/architecture/decisions/adr-018-cancelling-an-entry.md.

-- -----------------------------------------------------------------------------------------
-- fees.requires_permission — a price only some people may see, let alone buy
-- -----------------------------------------------------------------------------------------
-- **Not a boolean called `is_test`.** The club will want a members' price, and possibly a
-- volunteers' one; both are the same shape as this and neither is a test. Naming the column
-- after the mechanism rather than after today's only use is what stops a second boolean
-- appearing beside it in November.
--
-- No foreign key to `identity.permissions`, and that is deliberate. `entries` is a separate
-- schema with a separate blast radius — ADR-002's rule — and a hard reference would make a
-- permission undroppable because a fee row mentions it. A misspelled permission here fails
-- closed: `has_permission()` returns false for a word nobody holds, so the fee is invisible
-- and unbuyable, which is the safe direction. `entries-rules.test.ts` asserts exactly that.
alter table entries.fees add column requires_permission text;

comment on column entries.fees.requires_permission is
  'Null means anybody may see and buy this fee. Otherwise the identity permission a caller must hold — checked in entry_state() for visibility and again in create_pending_purchase() for the purchase, independently, because a rule enforced in one place is a rule that was not enforced.';

-- -----------------------------------------------------------------------------------------
-- fees.code — a fourth code, arriving the way that column asks for
-- -----------------------------------------------------------------------------------------
-- *"Adding a fourth code is a migration, deliberately. A fee code is what the form offers and
-- what the card is charged; it should arrive in a diff somebody approved rather than as a row
-- somebody inserted."* This is that diff, and the constraint did its job — the first attempt
-- at this migration was refused by it.
--
-- **Unlike `identity.roles`' constraint, this one stays.** The two look alike and are not:
-- role slugs are now a lookup table with a foreign key and a test asserting the set, whereas
-- a fee code is a bare string on a row that decides what a card is charged, with nothing
-- referencing it. The constraint is the only thing standing between a typo and a price.
alter table entries.fees drop constraint if exists fees_code_check;

alter table entries.fees
  add constraint fees_code_check
  check (code in ('affiliated', 'unaffiliated', 'vi_guide', 'tester'));

-- The 1p tester fee. **Test-mode Stripe proves the integration; it does not prove the club's
-- live account, its payout settings or its webhook endpoint.** Finding out that one of those
-- is wrong on 1 September is finding out too late, and a real card against a real 1p charge
-- is the only thing that proves it.
--
-- "(do not use)" is in the label because the label is what Stripe puts on the Checkout page
-- and on the receipt. If this ever leaks onto a page a runner can reach, it should read as
-- what it is.
insert into entries.fees (event_id, code, label, price_pence, requires_ea_number, requires_permission)
select
  event.id, 'tester', 'Tester (do not use)', 1, false, 'nn.entry.before_open'
from entries.events as event
where event.slug = 'nn-2026'
on conflict (event_id, code) do nothing;

-- -----------------------------------------------------------------------------------------
-- entry_purchases.person_id — an entry that knows whose it is, when it can
-- -----------------------------------------------------------------------------------------
-- **Nullable, and it will stay mostly null, and that is the design.** Requiring an account
-- before entering puts a funnel step in front of a race that takes around 150 entries in a
-- rush; creating one from a purchase would write an `auth.users` row for an address nobody
-- confirmed and fire the signup trigger, granting whatever role a signup grants — which means
-- "this person signed up", and would be a false statement in the one table whose job is to say
-- who somebody is. The role in question is `registered` — ADR-016, which landed while this was
-- being built, and which is explicit that the word means "this person signed up" and nothing
-- more.
--
-- So the link is opportunistic: set when the buyer happened to be signed in, null otherwise,
-- and a signed-out buyer claims their entry later by registering with the same address. See
-- `entries.my_entries()` at the foot of this file for the other half.
--
-- `on delete set null` rather than cascade. Deleting an account must never delete the record
-- of a payment — #62 deletes a person, and an entry somebody paid for is the club's record of
-- a transaction, not a profile field. The purchaser's name and email are on the purchase row
-- already and are governed by the retention promise `/nn/privacy/` publishes.
alter table entries.entry_purchases
  add column person_id uuid references identity.people (id) on delete set null;

comment on column entries.entry_purchases.person_id is
  'The account that bought this entry, when there was one. Null for every signed-out purchase, which is most of them — see the migration header for why an account is not required and never created. on delete set null: deleting an account does not delete the record of a payment.';

create index entry_purchases_person_idx
  on entries.entry_purchases (person_id)
  where person_id is not null;

-- -----------------------------------------------------------------------------------------
-- entries.entry_state() — the fee list becomes a question about the caller
-- -----------------------------------------------------------------------------------------
-- Everything else is byte-for-byte what it was. The one change is the `requires_permission`
-- clause in the fee subquery, and with every existing row null it returns the same answer to
-- the same callers as before.
--
-- **This is now caller-dependent, which it was not.** Worth stating plainly because
-- `entry_state()` is the function whose comment says it "discloses nothing": that is still
-- true, and slightly more so — an anonymous caller now sees strictly less than before, never
-- more. A gated fee is invisible to everybody who does not hold its permission, including
-- `anon`, for whom `has_permission()` is false by construction.
--
-- It also means the answer must not be cached across callers. Nothing caches it today; the
-- Worker reads it per request, which is what makes the entry window a row rather than a
-- deploy in the first place.
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
           -- The one new line. False for `anon` always, so the public radio group is
           -- unchanged and a 1p entry never appears on a page a runner can reach.
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
  'Public configuration for one event: window state and the fees this caller may buy. Reads no personal data and returns no table privilege. Caller-dependent only in that a permission-gated fee is hidden from everybody who does not hold its permission — anon sees strictly less than before, never more.';

-- -----------------------------------------------------------------------------------------
-- entries.create_pending_purchase() — three changes, and the rest is unchanged
-- -----------------------------------------------------------------------------------------
--   1. The window check admits `pre_open` for a caller holding `nn.entry.before_open`.
--   2. A permission-gated fee is refused with `invalid_fee` unless the caller holds it.
--   3. `person_id` is stamped from `auth.uid()`, which is null for the anonymous majority.
--
-- **The fee check is not "the form would not have offered it".** Slice E found
-- `create_pending_purchase` writing `ea_number` without ever consulting
-- `fees.requires_ea_number`, because Zod required it and nothing else did; Slice G audited
-- every rule by attempting the bypass and found eight more. The lesson is written into
-- CLAUDE.md — "Zod is the form's control, not the system's" — and this is the same shape:
-- two PostgREST calls with the published anon key, naming `tester`, would buy a place for a
-- penny. So the fee's permission is re-checked here, in the control.
--
-- **`invalid_fee`, not a new reason.** A caller who names a fee they may not buy is told
-- exactly what a caller who names a fee that does not exist is told, which is what stops the
-- refusal being an oracle for which gated prices an event has.
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
  v_early boolean;
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

  -- --- the consents this event requires ------------------------------------------------------
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

  v_amount := v_fee.price_pence;

  -- --- the England Athletics number, against the fee that was chosen -------------------------
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
        purchase_id, first_name, last_name, date_of_birth, gender, club, ea_number, leg,
        emergency_contact_name, emergency_contact_phone
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        v_entrant ->> 'gender',
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
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
  'Holds a place and records a pending purchase, in one transaction under a per-event advisory lock. Prices from entries.fees and never from the caller. A pre-open event is admitted only for a caller holding nn.entry.before_open; entries_close_at and active are never bypassed. Returns a structured result rather than raising.';

-- **The grant widens to `authenticated`, and the `anon` grant stays.** The signed-out runner
-- is the whole population until 1 September and their path is unchanged. A signed-in caller
-- needs their own grant because PostgREST sends their JWT and their role is `authenticated`,
-- not `anon` — without this the tester path fails with `42501` before the function is entered.
-- This does not lengthen the list of functions `anon` may call, which is still thirteen.
grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) to authenticated;

-- `attach_checkout_session` is the second half of the same request, so it needs the same
-- widening for the same reason. It takes a purchase id issued moments earlier by the call
-- above and writes one Stripe reference; it reads and returns nothing about anybody.
grant execute on function entries.attach_checkout_session(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.my_entries() — what a runner may see about their own entry
-- -----------------------------------------------------------------------------------------
-- **Two ways a purchase is yours**, and the second is what makes this work for the ninety-odd
-- percent of entries bought signed-out:
--
--   1. `person_id = auth.uid()` — you were signed in when you bought it.
--   2. `purchaser_email` matches your **confirmed** address in `auth.users`.
--
-- `email_confirmed_at is not null` is doing real work in (2). Without it, registering with
-- somebody else's address and never confirming it would show you their entry — their name,
-- their club, what they paid. Supabase will not issue a session for an unconfirmed address on
-- the password route, but the magic-link and OAuth routes are a different shape and this
-- function must not depend on which door somebody came through.
--
-- **What it deliberately does not return:** the medical note (that is
-- `nn.entry.read_medical`, audited, one at a time, and deleted a month after the race), the
-- emergency contact, the date of birth, the England Athletics number, the Stripe references,
-- and anything at all about anybody else's entry. A page a runner reaches is not where those
-- belong, and a function that returned them would be one bug away from being where they leak.
--
-- **It never makes a negative claim about money.** `status` comes back as it is stored and
-- the page words it; a lapsed hold is "not completed", never "you were not charged", because
-- the webhook may simply be late and somebody who believes that pays twice. That rule is
-- `/nn/<year>/entry/complete/`'s and it governs here too.
create or replace function entries.my_entries()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  -- **`text`, lowered, rather than `citext`.** With `search_path = ''` the citext equality
  -- operator — which lives in `extensions`, not `pg_catalog` — is not resolvable, and a
  -- definer function that unpins its search_path to get one operator has given away the
  -- property the pin was for. The same trap `create_pending_purchase()` documents on the
  -- discount code, and the same answer.
  v_email text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select pg_catalog.lower(account.email::text)
    into v_email
    from auth.users as account
   where account.id = auth.uid()
     and account.email_confirmed_at is not null;

  return jsonb_build_object(
    'ok', true,
    'entries', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'purchase_id', purchase.id,
            'event_slug', event.slug,
            'event_name', event.display_name,
            'event_date', event.event_date,
            'start_time', event.start_time,
            'status', purchase.status,
            'amount_pence', purchase.amount_pence,
            'fee_label', fee.label,
            'purchaser_name', purchase.purchaser_name,
            'paid_at', purchase.paid_at,
            'created_at', purchase.created_at,
            'entrants', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'first_name', entrant.first_name,
                    'last_name', entrant.last_name,
                    'club', entrant.club
                  )
                  order by entrant.leg, entrant.last_name
                ),
                '[]'::jsonb
              )
              from entries.entrants as entrant
             where entrant.purchase_id = purchase.id
            )
          )
          -- Newest first. Somebody with three years of entries wants this year's at the top.
          order by event.event_date desc, purchase.created_at desc
        ),
        '[]'::jsonb
      )
      from entries.entry_purchases as purchase
      join entries.events as event on event.id = purchase.event_id
      join entries.fees as fee on fee.id = purchase.fee_id
     where purchase.person_id = auth.uid()
        or (
          v_email is not null
          and pg_catalog.lower(purchase.purchaser_email::text) = v_email
        )
    )
  );
end;
$$;

comment on function entries.my_entries() is
  'Every entry belonging to the signed-in caller — by person_id, or by a purchaser_email matching their confirmed address. Returns no medical note, no emergency contact, no date of birth, no England Athletics number and no Stripe reference. Never says anything about anybody else.';

revoke all on function entries.my_entries() from public;
grant execute on function entries.my_entries() to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.cancellable_purchase() — what the Worker needs before it refunds
-- -----------------------------------------------------------------------------------------
-- **The refund happens before the record changes, and this function is why that is possible.**
-- The ordering matters and it is the one genuinely interesting decision in the cancel path:
--
--   * *Mark refunded, then call Stripe.* If Stripe fails, the place is free, the entrant is
--     deleted and the club has kept the money. Nothing on the row says a refund is owed.
--   * *Call Stripe, then mark refunded.* If the mark fails, the money is back and the row
--     still says `paid`. **Retrying is safe** — Stripe's idempotency key is the purchase id,
--     so the second refund is a no-op that returns the first one, and the mark then succeeds.
--
-- The second is recoverable by doing the same thing again, which is the property worth having
-- in a path a volunteer runs by hand. It is also the direction this repository already fails
-- in everywhere money is involved: towards the runner.
--
-- Returns the payment intent and nothing else that could identify anybody — no name, no
-- email. The caller already knows which purchase it asked about.
create or replace function entries.cancellable_purchase(p_purchase_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_purchase entries.entry_purchases;
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

  if v_purchase.status = 'refunded' then
    -- Already done. Said plainly rather than refused, so a volunteer who pressed the button
    -- twice is told what happened rather than shown an error about a thing that worked.
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_purchase.status,
    'amount_pence', v_purchase.amount_pence,
    -- Null for a `pending` or `expired` purchase, which never reached a card. The Worker
    -- skips the refund and goes straight to the cancel — there is nothing to send back.
    'payment_intent_id', v_purchase.stripe_payment_intent_id
  );
end;
$$;

comment on function entries.cancellable_purchase(uuid) is
  'What the Worker needs to refund one purchase: its status, its amount and its payment intent. Refuses unless the caller holds nn.entry.cancel. Returns no name and no email — the caller already knows which purchase it asked about.';

revoke all on function entries.cancellable_purchase(uuid) from public;
grant execute on function entries.cancellable_purchase(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------
-- admin_audit.action — a fifth kind of act, and the first one that is not a read
-- -----------------------------------------------------------------------------------------
-- The constraint enumerates what may be written here, which is the same discipline
-- `entries.fees.code` and `identity.roles.slug` shipped with: an audit trail whose vocabulary
-- is open is one where a typo becomes a category nobody queries for.
--
-- **Every existing value is a read** — `sign_in`, `medical_note`, `medical_export`, `export`.
-- `cancel_entry` is the first entry in this table that records a *change*, which is worth
-- noticing rather than smoothing over: the runbook's "who has read medical data" query filters
-- on the read actions by name and is unaffected, and a future "what has been changed" query has
-- exactly one value to ask for.
alter table entries.admin_audit drop constraint if exists admin_audit_action_check;

alter table entries.admin_audit
  add constraint admin_audit_action_check
  check (action in ('sign_in', 'medical_note', 'medical_export', 'export', 'cancel_entry'));

-- -----------------------------------------------------------------------------------------
-- entries.cancel_entry() — the decision CLAUDE.md refused to take by inference
-- -----------------------------------------------------------------------------------------
-- *"Editing people is still not settled. No refunds, transfers, corrections, manual entries
-- or resends — each is a decision about changing a record somebody paid for."* This is that
-- decision, taken for exactly one of those five and no others, because the club is about to
-- create test entries against a live race and the way to remove them must not be a volunteer
-- with a psql prompt on a Sunday.
--
-- **`nn.entry.cancel` is carried by `nn-admin`, not by `super-admin`.** ADR-018 argues it: a
-- super-admin cannot see the entry list at all — that is #58's *a grant is not an inheritance* —
-- so putting cancel there would have meant granting them the reads as well, buying a narrower
-- control by widening a wider one.
--
-- **`refunded`, and no fifth status.** CLAUDE.md gives the reason and it is load-bearing: the
-- capacity predicate counts `status = 'paid'`, so a value it has never heard of would be
-- invisible to it and let an oversold place be sold twice. `refunded` is already in the check
-- constraint, already not counted, and already what the schema meant by this.
--
-- **The entrant and the medical note go with it.** A cancelled entry is not a runner, and
-- keeping somebody's emergency contact and their medical history after refunding them is
-- holding special category data for no purpose anybody could state to the ICO. The purchase
-- row stays, because it is the club's record of a transaction — that is what `on delete
-- restrict` from `entrants` to `purchases` has always been about.
--
-- **The audit row is written before anything is removed**, so a cancellation that fails
-- half-way still says who tried. `entries.admin_audit.actor` takes `auth.uid()::text`, which
-- is the shape #57 established — pseudonymous, and resolvable through `identity.people`
-- behind row-level security rather than through a handle in a runbook.
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
      'refund_reference', p_refund_reference
    )
  );

  -- `entrant_medical` cascades from `entrants`, which cascades from nothing — the delete here
  -- is explicit because `entrants.purchase_id` is `on delete cascade` and this is the parent
  -- going nowhere. Deleting the entrants is what releases the place: the capacity count joins
  -- purchases to entrants, so a purchase with none takes none.
  delete from entries.entrants where purchase_id = p_purchase_id;

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
  'Cancels one purchase: audits it, deletes its entrants and their medical notes, and moves it to refunded so the place returns to capacity. Refuses unless the caller holds nn.entry.cancel. Idempotent by state guard — a retry after a failed mark is the expected path. The Stripe refund is the Worker''s, and it happens first.';

revoke all on function entries.cancel_entry(uuid, text) from public;
grant execute on function entries.cancel_entry(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- The four role-checked admin reads now ask a permission
-- -----------------------------------------------------------------------------------------
-- Same signatures, same grants, same answers, same helpers underneath. The only change is
-- that each asks `identity.has_permission('nn.entry.…')` where it asked
-- `identity.has_role('nn-admin')` — so `super-admin`, which could not read the entry list
-- yesterday without also being granted `nn-admin`, can today, and a race director role added
-- next month needs no edit to any of them.
--
-- `entries-admin.test.ts` runs unchanged against these, which is what says the answers did
-- not move.
do $$
declare
  v_body text;
  v_target record;
begin
  for v_target in
    select 'entry_list' as name, 'nn.entry.read' as permission
    union all select 'interest_list', 'nn.entry.read'
    union all select 'entrant_medical', 'nn.entry.read_medical'
    union all select 'export', 'nn.entry.export'
  loop
    -- The bodies are long and they are not being changed, so they are rewritten from
    -- `pg_get_functiondef` with one string swapped rather than copied into this file, where a
    -- transcription slip would silently reintroduce a rule Slice G closed.
    select pg_catalog.pg_get_functiondef(p.oid)
      into v_body
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'entries'
       and p.proname = v_target.name;

    if v_body is null then
      raise exception 'entries.% not found — the admin reads migration has not run', v_target.name;
    end if;

    -- `strpos`, not `position(x in y)`. The latter is SQL *syntax* rather than a function, so
    -- it cannot be schema-qualified — the same class of thing as `nullif` and `coalesce`,
    -- which `create_pending_purchase()` already carries a note about. Under `search_path = ''`
    -- an unqualified call is not resolvable and a qualified one is a syntax error, so the
    -- function spelling is the only one that works here.
    if pg_catalog.strpos(v_body, 'identity.has_role(''nn-admin'')') = 0 then
      raise exception 'entries.% does not check has_role(nn-admin) — refusing to guess', v_target.name;
    end if;

    execute pg_catalog.replace(
      v_body,
      'identity.has_role(''nn-admin'')',
      pg_catalog.format('identity.has_permission(%L)', v_target.permission)
    );
  end loop;
end;
$$;
