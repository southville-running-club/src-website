-- Transferring an affiliated place could not be done at all, and the page said the database
-- was down.
--
-- =========================================================================================
-- The defect, exactly
-- =========================================================================================
-- `transfer_entry()` set `ea_number = null` on the entrant unconditionally, on the argument
-- that an England Athletics number identifies the runner who registered it and must not be
-- carried onto somebody else. That argument is right. What it missed is that
-- `assert_entrant_rules()` enforces a **biconditional**: a fee that requires a number must have
-- one, and a fee that does not must not.
--
-- So on an affiliated entry — the fee the club sells most of — the update raised
-- `check_violation`, plpgsql let it out of the function, PostgREST returned an error rather
-- than a refusal envelope, and `readCancelEnvelope` mapped an error to `unavailable`. The
-- volunteer got **"That could not be read — the club's database could not be reached"** on a
-- database that was perfectly healthy, doing exactly what it was told.
--
-- **Every affiliated transfer failed, and it failed as an outage.** That is the worst possible
-- shape for a rule working correctly: nothing to act on, nothing in the message that names the
-- real cause, and an on-call reflex — try again in a moment — that can never help.
--
-- =========================================================================================
-- The fix is to ask, not to exempt
-- =========================================================================================
-- The tempting fix is to make the trigger tolerate a null on a transfer. That would be wrong:
-- the biconditional is what stops an affiliated place — £2 under, and £2 of ARC's money —
-- being held by somebody with no registration to check. A transferred affiliated place is
-- still an affiliated place.
--
-- So the transfer form asks the new runner for **their own** number, and this function refuses
-- with `ea_number_required` when the fee wants one and none was given. A fee that does not want
-- one ignores anything supplied, which is the same normalisation `create_pending_purchase()`
-- applies at the same point — the caller never decides whether the column is filled, the fee
-- does.
--
-- =========================================================================================
-- Expand: a tenth argument, and the nine-argument form kept as a wrapper
-- =========================================================================================
-- **Not a default argument.** A `p_ea_number text default null` on the same function would
-- leave two candidates for a nine-argument call and PostgREST would have to choose; two
-- explicit overloads have nothing to resolve. The old form delegates with a null number, which
-- means a Worker deployed before this migration goes on behaving exactly as it does today —
-- refusing an affiliated transfer, now with a reason a person can read instead of a 503.

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
  p_ea_number text
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
         emergency_contact_phone = pg_catalog.btrim(p_emergency_contact_phone)
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

comment on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text) is
  'Moves one paid entry to a different runner: replaces the entrant, deletes their predecessor''s medical note and recorded gender, and re-points the purchase at the new email with person_id null. Takes the new runner''s own England Athletics number and refuses with ea_number_required when the fee paid for needs one. Takes no money and gives none back — the place never returns to the pool. Refuses unless the caller holds nn.entry.cancel, and re-applies the minimum age and the one-runner-one-place rule.';

revoke all on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text) from public;
grant execute on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- The nine-argument form stays, as a wrapper
-- -----------------------------------------------------------------------------------------
-- A Worker deployed before this migration calls nine arguments. It goes on working, and on an
-- affiliated entry it now gets `ea_number_required` — a refusal a person can read — where it
-- used to get an unhandled `check_violation` reported as an outage.

create or replace function entries.transfer_entry(
  p_purchase_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_gender text,
  p_club text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
) returns jsonb
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select entries.transfer_entry(
    p_purchase_id,
    p_email,
    p_first_name,
    p_last_name,
    p_date_of_birth,
    p_gender,
    p_club,
    p_emergency_contact_name,
    p_emergency_contact_phone,
    null::text
  );
$$;

comment on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) is
  'The numberless form, kept so a Worker deployed before the England Athletics argument goes on working. Delegates with a null number, which an affiliated fee refuses with ea_number_required.';

revoke all on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) from public;
grant execute on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) to authenticated;
