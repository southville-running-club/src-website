-- A place the club gives rather than sells, assigned by a volunteer at `/admin/nn/`.
--
-- ---------------------------------------------------------------------------------------
-- Why this exists, and what it replaces
-- ---------------------------------------------------------------------------------------
-- The club has two places to give to Kinsi. The obvious answer was a 100% discount code, and
-- it does not work: **Stripe refuses a zero-total Checkout session**, and will not charge
-- below £0.30 in GBP at all. `apps/main/worker/nn-entry.ts` has carried a backstop for exactly
-- this since the entry path was built — *"a hundred-per-cent discount code would zero a fee
-- that is not itself free"* — which holds a place, charges nothing, and tells the person their
-- entry cannot be completed. Twenty-two Left Handed Giant places work through a code because they
-- are 10% off something; two free places cannot, because they are 100% off everything.
--
-- So a free place is not sold at a price of nothing. It is **given**, by somebody the club
-- trusts, from a page behind a role, with a row in the audit trail saying who gave it and why.
--
-- **This is the thing `CLAUDE.md` has listed as a stop-and-ask under "manual entries".** It
-- was asked and it was answered; ADR-021 records the decision and what it costs. Transfers,
-- corrections, resends and partial refunds are each still a stop-and-ask, and this migration
-- deliberately builds none of them.
--
-- ---------------------------------------------------------------------------------------
-- What this amends in ADR-010
-- ---------------------------------------------------------------------------------------
-- [ADR-010](docs/architecture/decisions/adr-010-webhook-writes-paid.md) says the Stripe
-- webhook is the only thing that may write `paid`, and the reason is exact: the redirect back
-- from Stripe is not proof of payment, so nothing that a browser can reach may promote a
-- purchase. **That reason does not reach this function**, because there is no payment to be
-- proof of. Nothing was charged, nothing can arrive late, and there is no state in which this
-- row's truth depends on something Stripe has not told us yet.
--
-- What survives unchanged is the sentence underneath it: **`paid` stays the only status that
-- consumes a place.** The capacity predicate counts `status = 'paid'`, so a fifth status for
-- "given" would make a given place invisible to the count and let it be sold to somebody else
-- — which is the same defect ADR-010 refused a fifth status for in the first place. A
-- complimentary place is `paid` at £0, and the `complimentary` fee is what says how it got
-- there.
--
-- ---------------------------------------------------------------------------------------
-- The consents, which are the part that needs care
-- ---------------------------------------------------------------------------------------
-- `assert_purchase_consents()` refuses a purchase that has not agreed everything in
-- `events.required_consents`, and it is right to. But a volunteer ticking those boxes is not
-- the runner agreeing to them, and a record that cannot tell the two apart is a record that
-- states something false about a person.
--
-- So the volunteer ticks each consent explicitly — they are not assumed, and the function
-- refuses without them exactly as the public path does — and the stored object carries
-- `recorded_by_admin: true` beside them. The consent is still the club's to obtain, out of
-- band, before the place is assigned; what this guarantees is that the record says how it was
-- obtained. `assert_purchase_consents()` checks the keys it requires are present and does not
-- mind the extra one.

-- -----------------------------------------------------------------------------------------
-- nn.entry.create — the eighth permission
-- -----------------------------------------------------------------------------------------
-- **A separate permission rather than a reuse of `nn.entry.cancel`.** `transfer_entry()` chose
-- the reuse and said why: a transfer changes who holds a place that already exists, which is
-- within a hair of the power to cancel one. Giving a place away is not — it is the power to
-- add a runner to a course with a hard limit, and it is the only permission here that makes
-- the club money go down rather than a record change.
--
-- Carried by `nn-admin` and **not** by `super-admin`, for the reason
-- `identity_permissions.sql` gives at length: a super-admin cannot read the entry list, so
-- granting them this would mean granting them `nn.entry.read` too, which is precisely the
-- inheritance that file refuses. A super-admin who needs to give a place grants themselves
-- `nn-admin` and leaves a row in `identity.audit` doing it.
insert into identity.permissions (slug, description) values
  ('nn.entry.create',
   'Assign a complimentary place at /admin/nn/, without payment.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('nn-admin', 'nn.entry.create')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------------------
-- The complimentary fee
-- -----------------------------------------------------------------------------------------
-- **A fee row rather than a nullable `fee_id`.** `entry_purchases.fee_id` is `not null` and
-- should stay that way: every purchase says what it was sold as, and a null there would make
-- "given" indistinguishable from "we lost the record". A £0 fee with a name is the honest
-- shape, and it reads correctly everywhere a fee label already renders — the entry list, the
-- three exports and the start list all say **Complimentary** rather than borrowing the guide's
-- label or leaving a blank.
--
-- The constraint on `code` is widened rather than dropped, for the reason it was written:
-- *"A fee code is what the form offers and what the card is charged; it should arrive in a
-- diff somebody approved rather than as a row somebody inserted."* This is that diff.
alter table entries.fees drop constraint if exists fees_code_check;

alter table entries.fees
  add constraint fees_code_check
  check (code in ('affiliated', 'unaffiliated', 'vi_guide', 'tester', 'complimentary'));

-- **`requires_permission` is what keeps this off the public form**, and it is the mechanism
-- the £1 tester fee already proved rather than a new one. `entry_state()` omits a fee whose
-- permission the caller does not hold, so a runner never sees it; `create_pending_purchase()`
-- refuses it with `invalid_fee`, so somebody reading the page source and posting the code
-- straight at PostgREST with the published anon key gets nothing. The two are independent on
-- purpose — hiding a price and refusing it are different jobs.
insert into entries.fees (event_id, code, label, price_pence, requires_ea_number, requires_permission)
select
  event.id, 'complimentary', 'Complimentary', 0, false, 'nn.entry.create'
from entries.events as event
where event.slug = 'nn-2026'
on conflict (event_id, code) do nothing;

-- -----------------------------------------------------------------------------------------
-- The audit trail has to be able to record this
-- -----------------------------------------------------------------------------------------
-- **`entries.admin_audit.action` is a closed list, and that is the point of it.** Every action
-- the surface can take has to arrive in a diff somebody approved, exactly as a fee code does —
-- so a new one is a constraint change rather than a string somebody types.
--
-- Widened rather than dropped, and widened *before* the function that writes it. The function
-- audits before it writes the entry, so without this every attempt to give a place would fail
-- on the audit row — refusing the whole transaction, which is the safe direction, but only
-- discoverable by trying it. `entries-manual-entry.test.ts` is what tried it.
alter table entries.admin_audit
  drop constraint if exists admin_audit_action_check;

alter table entries.admin_audit
  add constraint admin_audit_action_check
  check (
    action in (
      'sign_in',
      'medical_note',
      'medical_export',
      'export',
      'cancel_entry',
      'transfer_entry',
      'create_manual_entry'
    )
  );

-- -----------------------------------------------------------------------------------------
-- entries.create_manual_entry() — the whole of what a volunteer may give away
-- -----------------------------------------------------------------------------------------
-- Shaped after `entries.transfer_entry()`, which is the nearest thing that already exists: a
-- definer function granted to `authenticated`, authorising inside itself against a permission
-- resolved through `auth.uid()` and never through anything the caller passes.
--
-- **Granted to `authenticated` and never to `anon`.** The list of functions the anon role may
-- call is still thirteen; `packages/db/tests/entries.test.ts` asserts it exactly, and if that
-- test moves after this migration then this migration granted something it should not have.
--
-- ## What it re-checks, and why every one of them
--
--   * **capacity**, under the same per-event advisory lock the entry path takes. The 250 is a
--     number of bodies on a road at night, and a place the club gave is a body like any other.
--     A given place that oversold the course would be a real person turned round on the day.
--   * **the minimum age**, because 18 is a condition of being on the course, not of paying.
--   * **one runner, one place**, because somebody who already holds a place and is then given
--     one has two, and the second came out of the 250.
--   * **the consents**, for the reason in the header.
--
-- ## What it deliberately does not check
--
-- **The entry window.** `entries_open_at` and `entries_close_at` are when the public may buy,
-- and a complimentary place is not a purchase — a partnership place agreed in July and a
-- replacement given the week before the race are both ordinary. `active` still holds: an event
-- the club has withdrawn is not one to be adding people to.
--
-- ## What it cannot do
--
--   * choose a price. `p_amount_pence` is not a parameter; the `complimentary` row is;
--   * choose a status. `paid` is written literally, and there is no argument that reaches it;
--   * name somebody else as the volunteer. The audit row is `auth.uid()`;
--   * touch an existing purchase. It only ever inserts.
--
-- ## The arguments
--
--   p_entrants  jsonb array, one object per person, keys named exactly as the columns are —
--               the same shape `create_pending_purchase()` takes, including the optional
--               trailing `role = 'guide'` element when a guide is being recorded with them.
--   p_medical   jsonb array of the same length and order, ignored without the medical consent.
--   p_consents  jsonb object. The volunteer ticks each one; `recorded_by_admin` is added here
--               and is not the caller's to send.
--   p_reason    free text, for the audit trail. Why this place was given — "Kinsi partnership
--               place", "replacement for a cancelled entry". Not shown to the runner.
--
-- ## The result
--
--   { "ok": true,  "purchase_id": uuid, "entrants": int }
--   { "ok": false, "reason": text }
--
-- Reasons: `unauthorised`, `no_such_event`, `closed`, `no_complimentary_fee`, `sold_out`,
-- `invalid_entrants`, `under_minimum_age`, `consents_missing`, `already_entered`.
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
        club, ea_number, leg, emergency_contact_name, emergency_contact_phone, role
      ) values (
        v_purchase_id,
        v_entrant ->> 'first_name',
        v_entrant ->> 'last_name',
        (v_entrant ->> 'date_of_birth')::date,
        v_entrant ->> 'gender',
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'gender_identity', '')), ''),
        nullif(pg_catalog.btrim(coalesce(v_entrant ->> 'club', '')), ''),
        -- **Never, on any complimentary place.** The England Athletics number exists to
        -- justify the £2 affiliated rebate, and nothing here was charged, so collecting one
        -- would be collecting a number that decides nothing.
        null,
        (v_entrant ->> 'leg')::int,
        v_entrant ->> 'emergency_contact_name',
        v_entrant ->> 'emergency_contact_phone',
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
    'entrants', v_wanted
  );
end;
$$;

comment on function entries.create_manual_entry(text, text, text, jsonb, jsonb, jsonb, text) is
  'Assigns a complimentary place: one paid purchase at £0 on the complimentary fee, with its entrants and any guide, in one transaction under the per-event advisory lock. Refuses unless the caller holds nn.entry.create. Re-checks capacity, the minimum age, one-runner-one-place and the event''s required consents, and records recorded_by_admin against the consents so the record never claims the runner ticked them. The entry window deliberately does not apply. Writes entries.admin_audit before it writes the entry.';

revoke all on function entries.create_manual_entry(
  text, text, text, jsonb, jsonb, jsonb, text
) from public;

-- **`authenticated` and nothing else.** It is a role anybody who registers holds, so the grant
-- only says "you may ask" — `identity.has_permission('nn.entry.create')` above is what answers.
grant execute on function entries.create_manual_entry(
  text, text, text, jsonb, jsonb, jsonb, text
) to authenticated;
