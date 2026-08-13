-- Holding a place, and giving it back — the three functions that let `/nn/` take money.
--
-- Slice A created the `entries` schema with **no grant on any table** and exactly one thing
-- the anon role could call: `entries.entry_state()`. That is still true of the tables. This
-- migration adds two more callable objects and no table privilege at all, so
-- `tests/entries.test.ts`'s refusals — every table, every verb, by error code — keep passing
-- untouched. **If one of them starts failing after this migration, this migration granted
-- something it should not have.**
--
-- ---------------------------------------------------------------------------------------
-- What is settled since Slice A
-- ---------------------------------------------------------------------------------------
-- **The minimum age is 18.** It is applied by `update` rather than by editing the migration
-- that seeded the row, because that migration has already been applied — locally, in CI and
-- on the shared project. Editing an applied migration changes what a fresh `db reset`
-- produces without changing what any existing database holds, which is how two environments
-- start disagreeing about a rule that turns entrants away.
--
-- `entries_open_at` and `entries_close_at` stay **null**. Nobody has decided when entries
-- open, and null still reads as `pre_open`, which is the interest form.
--
-- ---------------------------------------------------------------------------------------
-- The one risk in this migration, and where it is answered
-- ---------------------------------------------------------------------------------------
-- 250 places, and this race sold out in 2023. **Two people pressing the button in the same
-- second must not both get the last place.** Counting and then inserting is not enough on
-- its own: two transactions each read 249, each decide there is room, and each insert.
--
-- `entries.create_pending_purchase()` takes `pg_advisory_xact_lock` on a hash of the event
-- id before it counts, so the count-and-insert is serialised **per event** and nothing else
-- in the database is blocked. The lock is released when the transaction ends, whichever way
-- it ends. `packages/db/tests/entries-capacity.test.ts` proves it with real concurrent
-- connections, and proves the harness can detect overselling by overselling on purpose with
-- the lock left out.
--
-- ---------------------------------------------------------------------------------------
-- Expand, migrate, contract
-- ---------------------------------------------------------------------------------------
-- Nothing here removes or narrows anything, so both deploy orders survive:
--
--   * **Migration first, Worker later.** Three functions nobody calls, and a minimum age the
--     already-deployed Worker starts applying through `entry_state()` — which is the rule
--     the committee has confirmed, so applying it early is correct rather than merely safe.
--   * **Worker first, migration later.** `create_pending_purchase` does not exist, PostgREST
--     answers `PGRST202`, and `apps/main/worker/nn-entry.ts` renders "your entry could not be
--     completed, nothing has been charged" with every value preserved. **The failure
--     direction is towards taking no money**, which is the only safe direction for a page
--     with a card payment on the end of it.

-- ---------------------------------------------------------------------------------------
-- The minimum age
-- ---------------------------------------------------------------------------------------
-- Confirmed since Slice A. 18 on race day, computed against `event_date` — the same
-- "completed years, and a birthday on race day counts" rule as
-- `packages/shared/src/age-category.ts`, which is what the form checks with.
--
-- Scoped to the one event rather than set as a column default: a future race that admits
-- juniors is an `insert` with its own value, not an exception to a global rule.
update entries.events
   set minimum_age = 18
 where slug = 'nn-2026';

comment on column entries.events.minimum_age is
  'Null means no age check. 18 for NN 2026, confirmed by the committee on 13 August 2026 and applied against event_date. Enforced in three places: the form, the browser enhancement, and entries.create_pending_purchase().';

-- ---------------------------------------------------------------------------------------
-- entries.create_pending_purchase() — the whole of what an anonymous caller may write
-- ---------------------------------------------------------------------------------------
-- One call, one transaction: resolve the event, take the capacity lock, count the places
-- already gone, price the entry **from the fees table**, and write the purchase, its
-- entrants and — only under its own consent — their medical notes.
--
-- ## The security shape is `entry_state()`'s, and it is not decoration
--
-- `security definer` so it can write tables the caller holds no privilege on; `set
-- search_path = ''` with every reference schema-qualified, because an unpinned search_path
-- on a definer function is the standard Postgres escalation. `revoke all from public` first,
-- so the grant below is the complete list of who may call it.
--
-- **`volatile`, and that is load-bearing rather than a default that happened to be right.**
-- Under READ COMMITTED, a `stable` function's queries run against the *calling* statement's
-- snapshot — so the capacity count would be taken from before the transaction it just waited
-- behind committed, and the advisory lock would protect nothing. A `volatile` function takes
-- a fresh snapshot per statement, which is what makes "wait for the lock, then count" mean
-- what it reads like.
--
-- ## What it deliberately cannot do
--
-- The anon key is published in client code, so this function *is* the attack surface. It
-- cannot:
--
--   * read anything back — it returns the caller's own purchase id, the amount and the fee
--     label, and nothing about anybody else;
--   * choose a price. `p_fee_code` selects a row; `entries.fees.price_pence` is what is
--     charged. A price in the form is never consulted;
--   * choose a status, a paid timestamp, an id or a created_at — none is a parameter;
--   * write to a different event than the slug names;
--   * store medical notes without the separate medical consent, whatever the form sent.
--
-- **What it can do is hold places.** An anonymous caller can create pending purchases until
-- the field is held out, for as long as a hold lasts. That is the same exposure
-- `intake.nn_interest` already carries and it is answered the same way — a Cloudflare WAF
-- rate-limiting rule on `POST /nn/`, recorded in `apps/main/README.md`. Inventing a
-- per-address cap here would block a legitimate person retrying on bad signal, which is a
-- policy decision and not a build one.
--
-- ## The shape of the arguments
--
--   p_entrants  jsonb array, one object per runner, keys named exactly as the columns are:
--               first_name, last_name, date_of_birth (YYYY-MM-DD), gender, club, ea_number,
--               emergency_contact_name, emergency_contact_phone, leg. Its length must equal
--               the event's `entrants_per_entry`.
--   p_medical   jsonb array of the **same length and order**, each element the notes for the
--               entrant at that position or null. **Its own argument rather than a key
--               inside the entrant** so that a reviewer can see in one line which parameter
--               carries special category data. Ignored entirely unless
--               `p_consents ->> 'medical'` is true.
--   p_consents  jsonb object, recorded as ticked. The *content* is the form's to establish;
--               this function's job is to record it faithfully under the event's own
--               `consent_version`, so a later change to the wording cannot rewrite what
--               somebody actually agreed to.
--
-- ## The result
--
--   { "ok": true,  "purchase_id": uuid, "amount_pence": int, "fee_label": text,
--     "hold_expires_at": timestamptz }
--   { "ok": false, "reason": text }
--
-- **Structured rather than raised.** The caller has a page to render and a person waiting on
-- it; `sold_out` in particular has to come back as something a form can say in words with
-- every typed value still in the boxes. Reasons: `no_such_event`, `closed`, `sold_out`,
-- `invalid_fee`, `invalid_discount`, `invalid_entrants`, `under_minimum_age`.
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
begin
  -- --- the event, and whether it is taking entries at all ---------------------------------
  select * into v_event from entries.events where slug = p_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- **Computed from the row, never from anything the caller passed.** This is the same
  -- expression `entries.entry_state()` renders as `state`, restated here because this is the
  -- control and that one is the display. Somebody opens the page at 6:59 and presses the
  -- button at 7:01 on the last day, which is an ordinary sequence rather than an attack.
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

  -- One block per runner, and the event says how many there are. Nightingale Nightmare is
  -- 1; Pass the Buck will be 2. A form that sent three would be a form that had drifted from
  -- its event row, so this refuses rather than silently taking the first one.
  if v_wanted <> v_event.entrants_per_entry then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- The medical array travels alongside `p_entrants` and must line up with it. A shorter one
  -- would silently drop somebody's notes; a longer one means the caller built the two from
  -- different lists and cannot be trusted about which notes belong to whom.
  if p_medical is not null
     and pg_catalog.jsonb_typeof(p_medical) = 'array'
     and pg_catalog.jsonb_array_length(p_medical) <> v_wanted
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
  end if;

  -- --- the capacity lock ---------------------------------------------------------------------
  -- **Everything below this line, up to the commit, is serialised for this one event.**
  -- Without it two transactions each read 249 of 250 and each insert, and the race that
  -- sold out in 2023 sells 251 places. Taken *before* the count, because a lock taken after
  -- reading protects nothing.
  --
  -- Two int4 arguments rather than one bigint, so the lock is namespaced: the first is a
  -- hash of this function's own name and the second a hash of the event id. Nothing else in
  -- the database can collide with it by picking the same number for another purpose.
  -- `hashtext` is only required to agree with itself, which it does within a database — two
  -- concurrent callers compute the same value, and that is the whole requirement.
  --
  -- `_xact_` rather than `pg_advisory_lock`: it is released when the transaction ends,
  -- whether it commits, rolls back, or the connection dies mid-statement. A session-level
  -- lock leaked by a dropped connection would shut entries for everybody.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_event.id::text)
  );

  -- --- how many places have gone ---------------------------------------------------------
  -- **Entrants are counted directly rather than purchases multiplied by
  -- `entrants_per_entry`.** The entrant rows are the record of who is actually taking a
  -- place; `entrants_per_entry` is configuration that may legitimately change, and
  -- multiplying by today's value would mis-count purchases taken under yesterday's. The two
  -- agree today and only one of them stays right.
  --
  -- A purchase and its entrants are written in the same transaction, so there is no window
  -- where a committed purchase is visible with no entrants behind it.
  --
  -- **An expired hold does not consume a place, and the count is what says so** — not the
  -- cron below, which is housekeeping. A `pending` row with no `hold_expires_at` at all
  -- cannot be produced by this function and would have to have been written by hand; it is
  -- counted as taking a place, because holding a place that nobody wanted is recoverable and
  -- selling a place twice is not.
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
    -- Returned, not raised. The caller has a form full of somebody's typing to give back,
    -- and they may want to ask about a waiting list.
    return jsonb_build_object('ok', false, 'reason', 'sold_out');
  end if;

  -- --- the price, from the database and from nowhere else -----------------------------------
  -- `entries.fees.price_pence` is the only definition of what an entry costs. Nothing the
  -- form posted is consulted, and there is no Stripe Price object to disagree with this row.
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

  -- --- the discount code, if one was typed ---------------------------------------------------
  -- **`entries.discount_codes` is empty and this path is currently unreachable.** It is
  -- built and tested anyway: the 2023 Long Ashton code was 10% off an unaffiliated entry
  -- capped at 22 places, and if the committee brings it back after entries open, enabling it
  -- must be one `insert` rather than a deploy in the middle of a live entry window.
  if p_discount_code is not null and pg_catalog.btrim(p_discount_code) <> '' then
    -- **Matched on `lower()` rather than by letting `citext` do it.** With `search_path = ''`
    -- the citext equality operator — which lives in `extensions`, not `pg_catalog` — is not
    -- resolvable, and a definer function that unpins its search_path to get one operator has
    -- given away the property the pin was for. The unique index on (event_id, code) is over
    -- citext, so no two codes can differ only in case and the two are exactly equivalent.
    --
    -- `for update` locks the row for the rest of the transaction. The advisory lock above
    -- already serialises this event, so it is belt and braces — but a code is a limited
    -- quantity and "checked `uses < max_uses`, then incremented" is the same shape of race
    -- as the capacity check, one floor down.
    select id, percent_off
      into v_discount_id, v_percent_off
      from entries.discount_codes
     where event_id = v_event.id
       and pg_catalog.lower(code::text) = pg_catalog.lower(pg_catalog.btrim(p_discount_code))
       and active
       and (max_uses is null or uses < max_uses)
     for update;

    if not found then
      -- One reason for "no such code", "withdrawn" and "all gone". Which of the three it is
      -- tells somebody who is guessing codes more than it tells somebody who mistyped one.
      return jsonb_build_object('ok', false, 'reason', 'invalid_discount');
    end if;

    -- Integer arithmetic throughout — money in a float is a defect waiting for a percentage.
    -- `+ 50` before the division rounds the discount to the nearest penny rather than towards
    -- the club: 10% of £17.00 is exactly 170 and the rounding never fires, but a 33% code
    -- would otherwise quietly favour one side by a rule nobody had written down.
    v_amount := v_fee.price_pence - (v_fee.price_pence * v_percent_off + 50) / 100;
  end if;

  -- --- the minimum age, re-checked here because this is the control --------------------------
  -- The form checks it and the browser enhancement checks it; both are conveniences. This is
  -- the one that runs whatever the browser did or did not do.
  --
  -- Completed years at `event_date`, so a birthday **on** race day counts — the same rule as
  -- `ageOn` in packages/shared/src/age-category.ts, which is what the form validated with.
  -- The two must agree, and a boundary test on each side of exactly 18 is what says they do.
  --
  -- The narrow exception handler is what keeps this function total: a date of birth that is
  -- not a date reaches the cast, and an anonymous caller posting rubbish should get a
  -- structured refusal rather than a 500 carrying a Postgres error string. **No write has
  -- happened yet at this point**, so there is nothing to undo.
  if v_event.minimum_age is not null then
    begin
      for v_entrant in
        select value from pg_catalog.jsonb_array_elements(p_entrants) as parts(value)
      loop
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
      end loop;
    exception
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
        return jsonb_build_object('ok', false, 'reason', 'invalid_entrants');
    end;
  end if;

  -- --- everything that writes, in one block that can be undone whole ------------------------
  -- The tables carry their own check constraints — name lengths, the England Athletics
  -- format, the three genders, the medical note ceiling — and they are the backstop for
  -- anything reaching Postgres by another route. A caller that trips one gets a structured
  -- refusal and **no half-written entry**: the block is a subtransaction, so the discount
  -- increment, the purchase and any entrants already inserted all go back together.
  --
  -- A submission that passes `packages/shared/src/nn-entry.ts` and fails here means those
  -- two have drifted, and that is a defect rather than a bad submission.
  begin
    if v_discount_id is not null then
      update entries.discount_codes set uses = uses + 1 where id = v_discount_id;
    end if;

    -- **The hold is 31 minutes and the odd number is Stripe's, not ours.** A Checkout
    -- session's `expires_at` has to be at least 30 minutes ahead of Stripe's own clock, so a
    -- 30-minute hold is already too short by the time the request lands — Stripe refuses it.
    -- The Worker sets `expires_at` to exactly this timestamp, so the hosted page and the
    -- held place die together instead of the session outliving the place it was holding,
    -- which is the direction that sells one number to two people.
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
      coalesce(p_consents, '{}'::jsonb),
      -- **The event's, never the caller's.** What somebody agreed to is a fact about the
      -- wording that was on the page, and a caller who could name the version could name a
      -- version they never saw.
      v_event.consent_version,
      v_hold_expires_at
    )
    returning id into v_purchase_id;

    -- The medical consent is a fact about the purchase, recorded alongside the others; the
    -- notes are per entrant and live in their own table. **False here means the notes never
    -- reach the database at all** — not stored and filtered later, which is a filter somebody
    -- can forget. `apps/main/worker/nn-entry.ts` has already dropped them at the boundary;
    -- this is the second of the two locks.
    v_medical_consent := coalesce((p_consents ->> 'medical')::boolean, false);

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
        -- `nullif` and `coalesce` are SQL syntax rather than functions, so they are not
        -- schema-qualified like everything else here — there is no schema to qualify them
        -- with and `pg_catalog.nullif(...)` does not resolve.
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'ea_number', '')), ''),
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
  'Holds a place and records a pending purchase, in one transaction under a per-event advisory lock. Prices from entries.fees and never from the caller. Returns a structured result rather than raising, so a sold-out race can be rendered as a page. The only object in this schema that writes, and it grants no table privilege.';

revoke all on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) from public;

-- **anon and nothing else.** `entry_state()` is granted to `authenticated` as well because
-- it is public configuration; this one writes, and nothing in this platform signs in —
-- `enable_signup` is off in config.toml and whether member-facing authentication is wanted
-- at all is undecided. A grant handed out before there is a role to use it is a grant nobody
-- reviews again.
grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text
) to anon;

-- ---------------------------------------------------------------------------------------
-- entries.expire_pending_holds() — housekeeping, and emphatically not the mechanism
-- ---------------------------------------------------------------------------------------
-- **Capacity does not depend on this having run.** `create_pending_purchase` counts a
-- pending hold only while `hold_expires_at` is still in the future, so an abandoned place is
-- back in the pool the instant it lapses whether or not anything swept it. This exists so
-- that a row abandoned at the payment page stops reading as `pending` forever — for the
-- treasurer looking at the table, and for Slice C's webhook, which should meet `expired` and
-- not a stale hold.
--
-- If this function is never called again, nobody is turned away and nothing is double-sold.
-- That is the property to preserve if it is ever changed.
--
-- Granted to anon because a Cron Trigger in `apps/main` calls it with the same anon key
-- every other request uses, and there is no privileged credential in this platform to call
-- it with instead. **That is safe because there is nothing here to abuse**: it can only move
-- a hold that has *already* lapsed, it takes no arguments, it returns a count and no row,
-- and calling it a second time updates nothing.
create or replace function entries.expire_pending_holds()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_expired int;
begin
  update entries.entry_purchases
     set status = 'expired'
   where status = 'pending'
     and hold_expires_at is not null
     and hold_expires_at < pg_catalog.now();

  get diagnostics v_expired = row_count;

  -- `hold_expires_at` is left as it was. It is the record of when the place went back, and
  -- clearing it would leave an `expired` row that cannot say why.
  return jsonb_build_object('expired', v_expired);
end;
$$;

comment on function entries.expire_pending_holds() is
  'Moves lapsed pending purchases to expired. Housekeeping only — capacity already excludes a lapsed hold, so nothing depends on this having run. Returns a count and no rows.';

revoke all on function entries.expire_pending_holds() from public;
grant execute on function entries.expire_pending_holds() to anon;

-- ---------------------------------------------------------------------------------------
-- entries.attach_checkout_session() — the one column the Worker writes after the fact
-- ---------------------------------------------------------------------------------------
-- The Checkout session cannot be created until the purchase exists, because the purchase id
-- is what `client_reference_id` carries — so the session id has to be written back
-- afterwards. This is the narrowest object that can do it: one column, on one row, once.
--
-- `stripe_checkout_session_id is null` is what makes it once. A purchase that already has a
-- session id is left alone, so nobody who learned a purchase id can point somebody else's
-- entry at their own Checkout session. The unique index on the column is the second lock,
-- and a collision returns `false` rather than a 500.
--
-- **Failing to attach is not a reason to fail a payment.** Slice C's webhook finds the
-- purchase by `client_reference_id`, which is set at session creation and cannot go missing;
-- the session id is a convenience for reconciliation. The Worker logs and redirects anyway.
create or replace function entries.attach_checkout_session(
  p_purchase_id uuid,
  p_session_id text
) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_purchase_id is null or p_session_id is null or pg_catalog.btrim(p_session_id) = '' then
    return false;
  end if;

  update entries.entry_purchases
     set stripe_checkout_session_id = pg_catalog.btrim(p_session_id)
   where id = p_purchase_id
     and status = 'pending'
     and stripe_checkout_session_id is null;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
exception
  when unique_violation then
    return false;
end;
$$;

comment on function entries.attach_checkout_session(uuid, text) is
  'Writes the Stripe Checkout session id onto a pending purchase that has none. One column, one row, once — a purchase that already has a session id is left alone.';

revoke all on function entries.attach_checkout_session(uuid, text) from public;
grant execute on function entries.attach_checkout_session(uuid, text) to anon;
