-- ---------------------------------------------------------------------------------------------
-- Holding a place takes a key, and a place that costs nothing is not held at all
-- ---------------------------------------------------------------------------------------------
-- **`entries.create_pending_purchase()` was the whole field, free, to anybody who read the page
-- source.** Issue #178, found in the go-live readiness review on 31 August 2026 and reproduced
-- against a local stack: **249 anonymous holds in 0.5 seconds, 473 a second, the field at
-- 250/250, and the next real runner refused `sold_out`.** Nothing was charged, because nothing
-- is charged at hold time — that is the design, and it is what made the attack free.
--
-- Three facts, each of them right on its own, compose into it:
--
--   * the function is granted to `anon`, and it has to be — a signed-out runner reaches
--     PostgREST as `anon`, so this grant is the ordinary entry path rather than an oversight;
--   * it holds a place **before** any money moves, with a 31-minute hold. That is Stripe's
--     floor, not the club's: the Worker sets the Checkout session's `expires_at` to the same
--     timestamp so the hosted page and the held place lapse together;
--   * a live `pending` hold **counts against the 250**, which it must — otherwise the same
--     place is sold twice.
--
-- **Cloudflare's rate-limiting rule sits in front of the Worker, and this attack does not go
-- through the Worker.** `docs/reference/cloudflare-waf-rules.md`'s C1 covers `POST` under
-- `/nn/`; PostgREST is a different origin whose URL is in the same page source as the key. A
-- per-IP limit in the Worker protects the path the attacker will not use.
--
-- ---------------------------------------------------------------------------------------------
-- What this changes, and what it deliberately does not
-- ---------------------------------------------------------------------------------------------
-- **The key is the control, and the anon grant stays.** The readiness note proposed revoking
-- it; that would have broken real entries. The Worker has no service role key and must never
-- have one, so its signed-out path *is* an `anon` call — revoking the grant would refuse every
-- signed-out runner along with every attacker. What separates the Worker from a script is not
-- which role it reaches Postgres as; it is that the Worker holds a secret. So this is exactly
-- the shape `entries.record_checkout_event()` and the five admin reads already use: granted to
-- `anon`, and refusing anybody who cannot present the key.
--
-- **The digest ships null, which refuses everything, and that is the safe direction.** Same as
-- `webhook_secrets`' other two rows and same as an unset `STRIPE_SECRET_KEY`: a real state that
-- says "not connected yet" rather than a placeholder that half works. The alternative — treat a
-- null digest as "not armed yet, allow" — would leave the hole open on any day somebody forgot
-- the secret, and a forgotten install would look exactly like a working one. Everything in this
-- repository fails towards taking no money; a control that fails towards being off is not one.
--
-- ⚠️ **This refuses the deployed Worker until `ENTRIES_ENTRY_KEY` is installed**, which is a
-- break rather than an expansion, and it is taken deliberately with the window shut.
-- `entries_open_at` is null on `nn-2026` and the committee agreed on 31 August 2026 to hold it
-- there until this is deployed, so no runner can reach this function at all — `entry_state()`
-- and this function both answer `closed` while that column is null. The only caller who could
-- notice is somebody holding `nn.entry.before_open`, and the entries-open runbook installs the
-- secret before the window is opened. Doing this as a true expand step would mean a period in
-- which the old callable path still existed, which is the hole.
--
-- **The second refusal is a free place, and it is defence in depth rather than a new rule.**
-- The Worker already refuses a £0 fee *before* holding — `worker/nn-entry.ts`, the `chosenFee
-- .pricePence === 0` branch — and it already catches a 100% discount code afterwards. Neither
-- is in the database, so neither applies to a caller that never meets the Worker. This is the
-- house rule that Zod is never the only place a rule lives, applied to the one rule on this
-- path that was still only in TypeScript: a place that can never be paid for is a place that
-- must never be held.
--
-- **`vi_guide` keeps its price and its visibility, and that is a change of plan worth writing
-- down.** The readiness note proposed gating the £0 fee behind `requires_permission` the way
-- `complimentary` and `tester` are gated. That would close nothing this key does not already
-- close, and it would cost something: `vi_guide` is the last remaining subject of the Worker's
-- free-place backstop since ADR-022 took the entry type off the form, so gating it would drop
-- the fee out of `entry_state()` and make a crafted request fail at parse time instead —
-- retiring a tested refusal in order to re-close a door this migration bolts. Refusing a zero
-- total here is strictly better: it covers the £0 fee, a future 100% code, and any other route
-- to a free total, without touching what the form offers.
--
-- ---------------------------------------------------------------------------------------------
-- Why this drops the function rather than replacing it
-- ---------------------------------------------------------------------------------------------
-- **The second migration in this repository to drop a function, and for the same reason as the
-- first.** `20260828140000_entries_discounts_and_guides.sql` added `p_preview` and had to drop
-- first: `create or replace` with a different argument list does not replace anything, it
-- creates a **second overload**, and PostgREST then refuses every call that could match either
-- one as ambiguous. Adding `p_key` has exactly that shape, so the old signature goes first.
--
-- **A drop takes the grants with it**, which is why they are restated at the foot of this file.
-- The anon list is asserted exactly in `packages/db/tests/entries.test.ts` and is **unchanged
-- at thirteen** — this function was already on it. What changes is the count of those thirteen
-- that take a key: six becomes seven.
--
-- ADR-026. Issue #178.
insert into entries.webhook_secrets (name) values ('entry')
on conflict (name) do nothing;

comment on table entries.webhook_secrets is
  'The digests of the shared keys the Worker presents — never the keys. Three rows: stripe (the webhook), admin (the back office) and entry (holding a place). RLS on, no policy, no grant — reachable only from the security definer functions that read it. If tests/entries.test.ts stops refusing this table, a credential digest became readable with a key that is published in page source.';

drop function if exists entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean
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

comment on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean, text
) is
  'Price one entry, hold a place for it and record a pending purchase. Takes the entry key: granted to anon because a signed-out runner reaches PostgREST as anon, and refusing without the key is what stops that grant from being 250 free places to anybody holding the published key. Refuses a total of zero — Stripe cannot take one, so the place could never be completed. See ADR-026 and issue #178.';

-- **Restated because the drop above took them**, and unchanged from what they were. The anon
-- list is thirteen functions and this is one of them; `packages/db/tests/entries.test.ts`
-- asserts that set exactly, and would fail if this migration quietly changed it.
--
-- `authenticated` is granted for the reason it always was: a signed-in caller reaches
-- PostgREST as `authenticated` rather than as `anon`, so the grant says "you may ask" and not
-- "you may do more". Both roles meet the same key check on the first line of the body.
revoke all on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean, text
) from public;

grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean, text
) to anon;

grant execute on function entries.create_pending_purchase(
  text, text, text, text, jsonb, jsonb, jsonb, text, boolean, text
) to authenticated;
