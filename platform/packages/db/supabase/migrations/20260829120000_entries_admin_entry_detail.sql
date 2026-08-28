-- One entry, on one page, with everything the club holds about it.
--
-- =========================================================================================
-- The gap this closes
-- =========================================================================================
-- `/admin/nn/` is a table of 250 rows, and a table can only carry what fits in a column. So
-- the facts a volunteer actually needs when somebody rings up are the ones that are not on it:
-- **which address paid**, when the payment settled, what Stripe's references are, what the
-- entrant gave as an emergency contact, whether the club still owes them an email — and, since
-- the request slice, whether they have asked for anything and what happened next.
--
-- Every one of those was already in the database and readable by nobody. The answer a
-- volunteer had was to open the Stripe dashboard, the Resend console and the entry list in
-- three tabs and join them by eye.
--
-- **A purchase, not an entrant.** The row on the list is a runner; the thing with a status, an
-- amount, a payment and a history is the purchase they are on — which is also the only shape
-- that can render a cancelled entry, whose runner `cancel_entry()` has deleted. Same lesson as
-- #116, one page along.
--
-- =========================================================================================
-- The audit trail is on it now, and that is a change of position
-- =========================================================================================
-- CLAUDE.md has said since the admin surface was built that *"the audit trail is deliberately
-- not on it"* — the argument being that rendering `entries.admin_audit` would need another
-- function granted to `anon`, which is a decision rather than a layout choice.
--
-- **Half of that argument expired with the two-key scheme.** Nothing here is anon-callable;
-- this is granted to `authenticated` and refuses anybody without `nn.entry.read`, which is the
-- same door the entry list is behind. The other half — that it is a decision — is still true,
-- and this is it being taken, on 29 August 2026, because the question *"who cancelled this,
-- and when"* is one the club could not answer about its own records. See ADR-024.
--
-- **Scoped to one purchase, never the whole trail.** This returns the rows that name *this*
-- entry and nothing else, so it is a history of a record rather than a log of what each
-- volunteer has been doing. There is still no way to read `admin_audit` as a list, and adding
-- one would be a separate decision.
--
-- **The actor stays a pseudonym.** `auth.uid()` and not a name — ADR-013's amendment, which
-- this does not reopen. What a page can do is say when somebody is looking at their own row.
--
-- =========================================================================================
-- What is deliberately not here
-- =========================================================================================
--   * **The medical note.** `entrant_medical.notes` is Article 9 data and has one door:
--     `entries.entrant_medical()`, which writes an audit row every time it is opened. This
--     says only *whether* there is a note, exactly as the list does, so the note keeps its
--     single audited read.
--   * **`entry_purchases.consents`.** ADR-022 put the `vi` declaration in the consents object
--     rather than in a column precisely so that no read returns it: it is data about
--     disability, held as the lawful basis for the guide's row, and never a fact on a screen.
--     No read has ever returned this column and this one does not either. `consent_version` is
--     returned, because which version of the terms was in force is a fact about the terms.
--   * **`person_id`.** Whether the entry is linked to an account is worth knowing; whose
--     account it is, as a uuid, is not something a page can do anything with. So this answers
--     the boolean.
--
-- =========================================================================================
-- Not audited, and that is the line rather than an omission
-- =========================================================================================
-- Reading this writes no `admin_audit` row, for the same reason `read_entry_list()` does not:
-- it discloses what the entry list and the three exports already disclose to the same
-- permission, and auditing every navigation would bury the four acts that matter under
-- thousands of look-ups — including, absurdly, in the trail this very page renders.
--
-- The line is Article 9: the medical note is audited and stays audited. Everything here is
-- ordinary entry data.

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
               'club', entrant.club,
               'ea_number', entrant.ea_number,
               'role', entrant.role,
               'email', entrant.email::text,
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
      'event_slug', v_event.slug,
      'event_name', v_event.display_name,
      'event_date', v_event.event_date,
      'status', v_purchase.status,
      'attention', v_purchase.attention,
      'attention_resolved_at', v_purchase.attention_resolved_at,
      'amount_pence', v_purchase.amount_pence,
      'fee_code', v_fee.code,
      'fee_label', v_fee.label,
      'requires_ea_number', v_fee.requires_ea_number,
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

comment on function entries.admin_entry_detail(uuid) is
  'Everything the club holds about one entry purchase: the payment, the people on it, the emails it owes and the audit rows that name it. Behind nn.entry.read, granted to authenticated, and never anon. Returns whether there is a medical note and never the note; returns consent_version and never consents.';

revoke all on function entries.admin_entry_detail(uuid) from public;
grant execute on function entries.admin_entry_detail(uuid) to authenticated;
