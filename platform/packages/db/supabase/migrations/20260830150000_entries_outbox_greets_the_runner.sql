-- ===========================================================================================
-- The outbox greets the runner — a guide's name could stand in for theirs
-- ===========================================================================================
-- **A runner could receive an email addressed to somebody else**, greeted by the name of the
-- guide running with them, on a message about their own entry. #170.
--
-- `entries.claim_outbox_batch()` left joined `entries.entrants` on `purchase_id` alone, with no
-- role filter and no tie-break. A visually impaired runner and their guide are two rows on one
-- purchase — ADR-022, `docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md`
-- — so one outbox message came back **twice**, with a different `entrant_first_name` on each
-- copy, and the `order by marked.id` on the surrounding `jsonb_agg` ordered by the *outbox* id,
-- which is identical for both. Nothing decided which name won, and the plan was free to change
-- its mind between calls.
--
-- ## What makes it dangerous is that it looks fine
--
-- Resend's idempotency key is `outbox:` plus the message id, which is the same string for both
-- copies, so the duplicate *send* is suppressed and exactly one email leaves. Nothing is
-- logged, no message is doubled, no counter moves. The only symptom is the wrong name in the
-- greeting, on the small number of entries that carry a guide — and the guide places sit
-- inside the 250 ceiling and are managed by hand, so those pairs will exist this year.
--
-- Two further consequences went with it, and both close here rather than in the Worker:
-- `record_send_result()` was called twice for one message id, because the Worker iterates the
-- array it was handed; and the claimed batch is capped at ten rows while the returned array
-- could be longer than the number of rows claimed, so a batch could quietly exceed its own
-- limit.
--
-- ## `role <> 'guide'`, not `role = 'runner'`
--
-- The two are equivalent today — `role` is `not null default 'runner'` with
-- `check (role in ('runner', 'guide'))` — and they stop being equivalent the moment that closed
-- list is widened, which is a change that arrives without much ceremony. `= 'runner'` would
-- silently drop a third role's entrants from the join; the left join means the message still
-- goes out, with a null name and nothing logged, which is this defect again wearing a different
-- hat. `<> 'guide'` keeps them, which is the behaviour every template already copes with. It is
-- also what the rest of this schema says: `role = 'runner'` appears nowhere, `role <> 'guide'`
-- appears in three migrations, and `entrants_gender_unless_guide` is written from the same
-- side. **A guide is the exception; everything else is an ordinary entrant.**
--
-- ## And a tie-break, which the filter alone does not give
--
-- The filter closes the guide case. It does not close the *class*: `events.entrants_per_entry`
-- and `entrants.leg` already permit a paired race, where two non-guide entrants share a purchase
-- and fan out in exactly the same way, silently, for exactly the same reason. So the join is a
-- `left join lateral … limit 1` rather than a filtered left join — one row per message whatever
-- the roles do and however many people are on the entry. `created_at, id` because there is no
-- position column on `entrants` and an arbitrary-but-stable answer is worth more than an
-- arbitrary one.
--
-- **The join stays outer, and that half is not optional.** `cancel_entry()` deletes the
-- entrants and `transfer_entry()` replaces them, so the runner a message is about may be gone
-- by the time it is sent. An inner join would make the row undrainable and leave it pending for
-- ever. `on true` with the `limit 1` inside preserves that exactly: no matching entrant yields
-- one row with a null name, which is what every template already handles.
--
-- ## Re-pasted, not patched
--
-- `create or replace function` on a function a migration defines, so the body below is
-- byte-for-byte what `20260828170100_entries_email_outbox_drain.sql` left, apart from the join
-- at the foot and this header. The signature is unchanged, so there is no second overload for
-- PostgREST to choose between and no grant to restate — the `revoke`/`grant` pair is repeated
-- only because `create or replace` on an existing function leaves privileges alone and stating
-- them is cheaper than making a reader check.

-- -------------------------------------------------------------------------------------------
-- entries.claim_outbox_batch() — hand the Worker what it should send next
-- -------------------------------------------------------------------------------------------
-- **Claiming, not reading.** The function increments `attempts` and stamps `last_attempt_at`
-- in the same statement that selects the rows, so a batch handed out is a batch already
-- counted. If the Worker dies mid-flight the attempt is still recorded, which is what stops a
-- row that reliably crashes the sender from being retried forever.
--
-- `for update skip locked` because two overlapping cron invocations must not both claim the
-- same row and send the same person the same message twice. It is the standard queue idiom and
-- it is the reason this is one statement rather than a select followed by an update.
create or replace function entries.claim_outbox_batch(
  p_key text,
  p_limit int default 10
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_digest text;
  v_rows jsonb;
begin
  -- --- the caller, before anything else --------------------------------------------------
  -- Checked first, so a wrong key cannot be used to learn whether anything is queued.
  select secret.key_sha256 into v_digest
    from entries.webhook_secrets as secret
   where secret.name = 'stripe';

  if v_digest is null
     or p_key is null
     or pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
        ) is distinct from v_digest
  then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  -- **Bounded, and not by the caller's optimism.** A batch larger than this is a burst at a
  -- provider that rate-limits, and the drain runs every five minutes anyway.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    p_limit := 10;
  end if;

  with claimed as (
    select outbox.id
      from entries.email_outbox as outbox
     where outbox.status = 'pending'
     order by outbox.created_at
     limit p_limit
     for update skip locked
  ),
  marked as (
    update entries.email_outbox as outbox
       set attempts = outbox.attempts + 1,
           last_attempt_at = pg_catalog.now()
      from claimed
     where outbox.id = claimed.id
    returning
      outbox.id,
      outbox.template,
      outbox.recipient,
      outbox.purchase_id,
      outbox.attempts
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', marked.id,
               'template', marked.template,
               'recipient', marked.recipient::text,
               'attempts', marked.attempts,
               -- **The purchase id is the reference a runner quotes**, and it is already
               -- printed on the confirmation page and on `/account/entries/`. It is not a
               -- credential — `request_entry_action()`'s comment says so explicitly — so
               -- putting it in an email discloses nothing new.
               'purchase_reference', marked.purchase_id::text,
               'event_name', event.display_name,
               'event_date', pg_catalog.to_char(event.event_date, 'FMDay FMDD FMMonth YYYY'),
               'amount_pence', purchase.amount_pence,
               -- **Null after a refund or a transfer, and every template must cope.**
               -- `cancel_entry()` deletes the entrants and `transfer_entry()` replaces them,
               -- so the runner a message is about may no longer exist by the time it is sent.
               -- A left join and a nullable name, rather than an inner join that would make
               -- the row undrainable and leave it pending forever.
               'entrant_first_name', entrant.first_name,
               -- The race's own monitored address. It becomes `Reply-To` rather than `From`:
               -- Resend may only send as the verified subdomain, and this is a Gmail.
               'reply_to', event.from_address
             )
             order by marked.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from marked
    join entries.entry_purchases as purchase on purchase.id = marked.purchase_id
    join entries.events as event on event.id = purchase.event_id
    -- **One entrant per message, chosen rather than stumbled upon.** See the header: a plain
    -- left join on `purchase_id` fans a message out across every person on the entry, and a
    -- guide's name could be the one that reached the runner. The lateral is what makes the
    -- row count structural — one message, one greeting, whatever the roles list grows into and
    -- however many people a future event puts on one purchase.
    left join lateral (
      select entrant.first_name
        from entries.entrants as entrant
       where entrant.purchase_id = purchase.id
         and entrant.role <> 'guide'
       order by entrant.created_at, entrant.id
       limit 1
    ) as entrant on true;

  return jsonb_build_object('ok', true, 'messages', v_rows);
end;
$function$;

comment on function entries.claim_outbox_batch(text, int) is
  'Claims up to p_limit pending outbox rows for delivery, incrementing attempts as it hands them over, and returns everything a message needs — exactly one row per message, greeting the runner rather than whoever the plan happened to join first. Takes the same key as record_checkout_event(): it returns real email addresses, and anon is a role whose key is published in page source.';

revoke all on function entries.claim_outbox_batch(text, int) from public;
grant execute on function entries.claim_outbox_batch(text, int) to anon;
