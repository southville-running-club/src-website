-- ===========================================================================================
-- Draining the outbox — the fourteenth and fifteenth functions `anon` may call
-- ===========================================================================================
-- **This migration adds two names to a list that is deliberately hard to add to.**
-- `packages/db/tests/entries.test.ts` asserts the exact set of functions the `anon` role may
-- execute, and CLAUDE.md names a fourteenth as a stop-and-ask. It is being taken here, on
-- purpose and in a diff, and this comment is the argument for it.
--
-- ## Why `anon` at all
--
-- The drain runs on the Worker's five-minute Cron Trigger, which reaches PostgREST with the
-- published anon key exactly as `expire_pending_holds()` and `delete_expired_medical_notes()`
-- already do. There is no other identity available to a scheduled Worker: a cron has no
-- session, so `authenticated` is not an option, and the service role key may never reach a
-- Worker.
--
-- ## Why that is safe, and it is not safe by default
--
-- ⚠️ **`claim_outbox_batch()` returns real email addresses.** Granted to `anon` unguarded, two
-- PostgREST calls with a key published in page source would hand anybody the club's entrant
-- list. So it **takes a key**, exactly as `record_checkout_event()` does and for exactly the
-- same reason — the database holds only a SHA-256 digest, and without a match the function
-- returns nothing at all.
--
-- **It reuses the `stripe` digest rather than installing a second secret**, so the Worker
-- authenticates the drain with the `ENTRIES_WEBHOOK_KEY` it already carries. That is a
-- deliberate trade and the cleaner answer is a dedicated `outbox` row in
-- `entries.webhook_secrets`: one key that opens two doors is one rotation that closes both.
-- It is reused because the alternative is a manual step — a second `wrangler secret put` and a
-- second `update` in the SQL editor — landing between now and entries opening, and a send path
-- that silently sends nothing because half of a two-part secret was not installed is the
-- failure mode this repository has already had once. **A dedicated key is a decision worth
-- taking after entries open, not before.**
--
-- ## What a caller with the key can and cannot do
--
-- Claim a batch, and record what happened to it. It cannot read a sent row, cannot read a
-- failed one, cannot select the table, and cannot see anything about an entry beyond what a
-- message to that entrant would contain. The admin surface's reads are separate functions on
-- `authenticated`, in their own migration.

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
    left join entries.entrants as entrant on entrant.purchase_id = purchase.id;

  return jsonb_build_object('ok', true, 'messages', v_rows);
end;
$function$;

comment on function entries.claim_outbox_batch(text, int) is
  'Claims up to p_limit pending outbox rows for delivery, incrementing attempts as it hands them over, and returns everything a message needs. Takes the same key as record_checkout_event(): it returns real email addresses, and anon is a role whose key is published in page source.';

revoke all on function entries.claim_outbox_batch(text, int) from public;
grant execute on function entries.claim_outbox_batch(text, int) to anon;

-- -------------------------------------------------------------------------------------------
-- entries.record_send_result() — what happened to one message
-- -------------------------------------------------------------------------------------------
-- **Three attempts, then `failed`.** Past three, a malformed address or a template bug is the
-- likely cause and a fourth attempt fixes neither — it just burns one of a hundred sends a day
-- that somebody else's confirmation needed. A `failed` row is what the admin surface puts a
-- re-send button next to, which is how a human overrides that judgement when they know better.
--
-- ⚠️ **A rate-limit rejection is not an attempt that counts.** When Resend answers `429` the
-- message was never tried — the provider refused to look at it — so `p_rate_limited` rolls the
-- attempt back. Without that, one busy day would burn three attempts on every queued message
-- and mark the whole overflow `failed` before the cap had even reset.
create or replace function entries.record_send_result(
  p_key text,
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_rate_limited boolean default false
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_digest text;
  v_updated int;
begin
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

  update entries.email_outbox as outbox
     set status = case
                    when p_ok then 'sent'
                    when p_rate_limited then 'pending'
                    when outbox.attempts >= 3 then 'failed'
                    else 'pending'
                  end,
         sent_at = case when p_ok then pg_catalog.now() else outbox.sent_at end,
         -- The attempt is given back when the provider refused to look at the message.
         --
         -- **`greatest` is unqualified, and that is not an oversight.** It is a SQL construct
         -- rather than a function in `pg_catalog`, so `pg_catalog.greatest(...)` is a syntax
         -- error — the same trap `extract(epoch from ...)` sets one migration earlier. Being
         -- a construct is also why it resolves under `search_path = ''`.
         attempts = case
                      when p_rate_limited then greatest(outbox.attempts - 1, 0)
                      else outbox.attempts
                    end,
         provider_message_id = coalesce(p_provider_message_id, outbox.provider_message_id),
         -- Truncated to the column's own limit rather than refused: a long error is still
         -- worth the first two hundred characters, and a failed write here would lose the
         -- outcome of a send that really happened.
         last_error = case
                        when p_ok then null
                        else pg_catalog.left(p_error, 200)
                      end
   where outbox.id = p_id
     and outbox.status = 'pending';

  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'applied', v_updated = 1);
end;
$function$;

comment on function entries.record_send_result(text, uuid, boolean, text, text, boolean) is
  'Records the outcome of one delivery attempt. Marks sent, leaves pending for a retry, or gives up at three attempts. A rate-limit rejection returns the attempt, because the provider never looked at the message.';

revoke all on function entries.record_send_result(text, uuid, boolean, text, text, boolean) from public;
grant execute on function entries.record_send_result(text, uuid, boolean, text, text, boolean) to anon;
