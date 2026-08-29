-- Cancelling an entry answers the ask that prompted it.
--
-- =========================================================================================
-- The defect, and it predates the history table
-- =========================================================================================
-- `entries.cancel_entry()` has never touched `request_resolved_at`. So a runner asked the club
-- to cancel, a volunteer cancelled and refunded it — and the row on `/admin/nn/` went on saying
-- **"cancellation asked for"** with no "— dealt with" beside it, for ever. The one act that
-- most obviously answers a request was the one act that did not record having answered it.
--
-- `transfer_entry()` has always set it, which is what made this hard to see: half the surface
-- behaved correctly and the visible half of the other did too, because a refunded row is filtered
-- out of the default view.
--
-- **It is a defect on its own** — a flag with no way to clear it becomes a flag nobody looks at,
-- which is the reasoning `attention` and `attention_resolved_at` were paired for. It surfaced
-- here because `20260829110000_entries_request_history.sql` builds resolution *on* that column:
-- a trigger closes every outstanding row in `entries.entry_requests` when it is set, so a
-- cancellation would have left the whole history outstanding as well.
--
-- =========================================================================================
-- Why this is its own migration
-- =========================================================================================
-- **`20260828140000_entries_discounts_and_guides.sql` is applied and may not be edited.**
-- Editing an applied migration changes what a fresh `db reset` produces without changing what
-- any existing database holds, which is how two environments start disagreeing — the rule
-- `20260828200000_entries_audit_actions_reunited.sql` exists to restate. So the function is
-- re-pasted whole here, from that migration's version, with **three lines added to one update
-- and nothing else touched**.
--
-- Expand only: it widens what a cancellation records and removes nothing, so both deploy
-- orders are safe and every previously deployed code path is unaffected.

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
         hold_expires_at = null,
         -- **The ask this answers is answered.** A runner asked the club to cancel; the club
         -- has cancelled. Without this the row went on saying "cancellation asked for" for
         -- ever, which is the same defect a flag with no way to clear it always is — and it
         -- is what `attention_resolved_at` exists beside `attention` to avoid.
         --
         -- **`requested_action` is left alone deliberately.** What somebody asked for stays
         -- true after it has been acted on, and it is what the row is evidence of. Only
         -- whether it has been dealt with changes.
         request_resolved_at = pg_catalog.now()
   where id = p_purchase_id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'entrants_deleted', v_entrants
  );
end;
$$;


comment on function entries.cancel_entry(uuid, text) is
  'Refunds one purchase in full: audits it, deletes its entrants and their medical notes, returns the discount code use, moves the purchase to refunded so the place returns to capacity, and marks any outstanding request on it as dealt with. Refuses unless the caller holds nn.entry.cancel.';

revoke all on function entries.cancel_entry(uuid, text) from public;
grant execute on function entries.cancel_entry(uuid, text) to authenticated;
