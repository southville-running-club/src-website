-- Transferring a place: the same entry, a different runner, and no money moving.
--
-- =========================================================================================
-- What a transfer is here, decided rather than inferred
-- =========================================================================================
-- **The runner on the entry changes. Nothing else does.** The purchase keeps its id, its
-- amount, its Stripe references and its place in the field; the entrant row is replaced and
-- the entry moves to a new email address. No refund is taken and no new payment is asked for,
-- which is what makes this different from cancelling and re-entering: the place never returns
-- to the pool, so it cannot be taken by somebody else in between.
--
-- That is one of three things "transfer" could have meant — the others being cancel-and-re-enter,
-- and deferring to another year — and it is the one the club chose.
--
-- =========================================================================================
-- The new runner does not need an account, and is not given one
-- =========================================================================================
-- `purchaser_email` becomes theirs and `person_id` is set to **null**, which is exactly the
-- state an entry bought by a signed-out runner sits in. `entries.my_entries()` matches on
-- `person_id` **or** on a `purchaser_email` equal to the caller's confirmed address, so the
-- moment that address registers and confirms, the entry appears on their account with no
-- further action by anybody.
--
-- **Creating an account here would be the wrong kind of helpful.** It would write an
-- unconfirmed `auth.users` row and fire the signup trigger, granting a role to an address
-- nobody has proved they control — a false statement in the table whose whole job is to say
-- who somebody is. CLAUDE.md says so about the entry path, and it holds here.
--
-- =========================================================================================
-- The medical note is deleted, and this is the part that would have been a defect
-- =========================================================================================
-- A medical note belongs to the runner who wrote it, not to the place. Carrying one across a
-- transfer would hand a stranger's condition to the first aiders **under the new runner's
-- name** — wrong about the person it describes and wrong about the person it is filed against,
-- which is the worst combination available. It goes, and the new runner supplies their own or
-- has none.
--
-- Nothing in the club's ask mentioned this. It falls out of what a transfer is.
--
-- =========================================================================================
-- Permission: `nn.entry.cancel`, reused deliberately
-- =========================================================================================
-- **An eighth permission is a stop-and-ask** — CLAUDE.md is explicit, and
-- `identity-permissions.test.ts` asserts the seven exactly. So this reuses the permission that
-- already means "may undo an entry somebody paid for", which `nn-admin` carries and
-- `super-admin` deliberately does not.
--
-- A dedicated `nn.entry.transfer` is the cleaner long-term answer, because cancelling and
-- transferring are different powers and somebody may one day want to grant one without the
-- other. **That is a decision, not a refactor**, and it belongs in a diff somebody takes on
-- purpose rather than in this one.

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
      'transfer_entry'
    )
  );

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
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_purchase entries.entry_purchases;
  v_event entries.events;
  v_entrants int;
  v_age int;
  v_previous text;
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

  select pg_catalog.count(*)::int
    into v_entrants
    from entries.entrants
   where purchase_id = p_purchase_id;

  -- **One runner only.** A paired entry has two people on one purchase and "transfer it" does
  -- not say which of them is leaving. Nightingale Nightmare is solo, so this refuses rather
  -- than guesses, and a relay would need its own answer anyway.
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

  -- **The note goes with the runner it belongs to.** See the head of this file: this is the
  -- line that stops a stranger's medical condition being filed against a new name.
  delete from entries.entrant_medical
   where entrant_id in (
     select id from entries.entrants where purchase_id = p_purchase_id
   );

  update entries.entrants
     set first_name = pg_catalog.btrim(p_first_name),
         last_name = pg_catalog.btrim(p_last_name),
         date_of_birth = p_date_of_birth,
         gender = p_gender,
         -- **`coalesce` and `nullif` bare, not `pg_catalog.`-qualified.** Both are SQL
         -- constructs rather than functions, so qualifying them is a syntax error the
         -- migration will not catch: plpgsql does not check a function body until it runs,
         -- so this created cleanly and failed on the first transfer.
         club = nullif(pg_catalog.btrim(coalesce(p_club, '')), ''),
         -- **Cleared, never carried.** An England Athletics number identifies the runner who
         -- registered it, and leaving the old one on a new person would put somebody else's
         -- affiliation against their name — and, on an affiliated fee, would look like a valid
         -- discount they are not entitled to.
         ea_number = null,
         emergency_contact_name = pg_catalog.btrim(p_emergency_contact_name),
         emergency_contact_phone = pg_catalog.btrim(p_emergency_contact_phone)
   where purchase_id = p_purchase_id;

  update entries.entry_purchases
     set purchaser_email = pg_catalog.btrim(p_email),
         purchaser_name = pg_catalog.btrim(p_first_name) || ' ' || pg_catalog.btrim(p_last_name),
         -- **Null, so the entry belongs to whoever proves that address.** Exactly the state a
         -- signed-out purchase sits in; `my_entries()` matches it the moment they register and
         -- confirm. Leaving the old `person_id` would keep the entry on the account of somebody
         -- who is no longer running it.
         person_id = null,
         -- The request that prompted this is answered.
         requested_action = null,
         requested_at = null,
         request_resolved_at = pg_catalog.now()
   where id = p_purchase_id;

  return jsonb_build_object('ok', true, 'previous_runner', v_previous);
end;
$$;

comment on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) is
  'Moves one paid entry to a different runner: replaces the entrant, deletes their predecessor''s medical note and England Athletics number, and re-points the purchase at the new email with person_id null. Takes no money and gives none back — the place never returns to the pool. Refuses unless the caller holds nn.entry.cancel, and re-applies the minimum age and the one-runner-one-place rule so a transfer cannot be a way around either.';

revoke all on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) from public;

grant execute on function entries.transfer_entry(uuid, text, text, text, date, text, text, text, text) to authenticated;
