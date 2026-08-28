-- ===========================================================================================
-- Reading the outbox, and asking for one message again — #73's second half
-- ===========================================================================================
-- **The outbox landed with nothing to look at it.** A volunteer whose runner says they never
-- heard anything had the Worker's logs and Resend's dashboard, neither of which is a place to
-- send somebody on a Sunday. This is `/admin/emails/`.
--
-- ## Two functions, on `authenticated`, and no new permission
--
-- **Reading the queue is `nn.entry.read`** — the permission that already opens the entry list,
-- which shows every one of these addresses beside a name, a date of birth and an emergency
-- contact. A dedicated `nn.email.read` would be a narrower word for a strictly smaller set of
-- the same data, and an eighth permission is a stop-and-ask.
--
-- **Asking for a message again is `nn.entry.cancel`.** That is not what the permission is
-- named for, and it is the same trade `transfer_entry()` made: a dedicated `nn.email.resend`
-- is the cleaner answer and it is a decision, so this reuses the permission that already means
-- *may act on an entry rather than only look at it*. `nn-admin` holds it; `people-admin` and
-- `nn-tester` do not, and neither does `super-admin` — which is deliberate and inherited, not
-- an oversight of this migration.
--
-- ## Why re-sending is not simply "set it back to pending"
--
-- It is exactly that, plus two things that make it honest:
--
--   * **`attempts` goes back to zero**, because a human deciding to try again is a new
--     judgement and not a fourth automatic go at something that failed three times.
--   * **It is audited.** `record_admin_action()` writes who asked and for which message, in the
--     same transaction. Sending somebody an email is an act with an outside effect, and the
--     admin surface audits those.
--
-- **Only a `failed` row may be re-sent.** A `pending` one is already owed and the drain will
-- reach it; offering a button that does nothing is how a volunteer learns not to trust the
-- page. A `sent` one is refused for a stronger reason — see `already_sent` below.

-- -------------------------------------------------------------------------------------------
-- The audit vocabulary gains a word
-- -------------------------------------------------------------------------------------------
-- **`entries.admin_audit.action` is a closed list, and every migration that adds an admin act
-- widens it on purpose.** `cancel_entry` added one word, `transfer_entry` added another, and
-- this adds `resend_email`.
--
-- ⚠️ **Forgetting this does not fail quietly, and it does not fail where you would look.** The
-- audit row is written *before* the change, so a word missing from this list raises inside
-- `admin_outbox_resend()` and the whole function aborts — the re-send silently does nothing and
-- PostgREST answers with a null body. It reads as the function being unreachable rather than as
-- a constraint refusing one value, which is exactly how it was found: four failing tests whose
-- shape pointed at the grant rather than at this.
--
-- That the list is closed is the point. It is what makes a new kind of admin act a thing
-- somebody writes down rather than a string that appears in the audit trail one day.
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
      'resend_email'
    )
  );

-- -------------------------------------------------------------------------------------------
-- entries.admin_outbox_list() — the queue, and the day's figures
-- -------------------------------------------------------------------------------------------
-- **The figures are computed in the same query that lists the rows**, which is the property
-- `/admin/nn/` already has and the reason two panels there cannot disagree.
--
-- `sent_today` is the one a volunteer actually needs during an entry rush, because it is the
-- number Resend's daily cap is counted against. ⚠️ **It is the club's own count and not
-- Resend's** — account emails (confirmations, password resets) go through the same Resend
-- account and are invisible here, so the real figure against the cap is this number *plus*
-- however many the account area sent. It is a floor, and the comment on the column says so.
--
-- **A day is `Europe/London`**, not UTC. The club reads this page in its own time, and a
-- "today" that rolls over at 01:00 BST is a figure nobody can reconcile with what they
-- remember happening. This is the one place in `entries` that needs a zone, and it is stated
-- here rather than left to the caller because a count is not a timestamp the Worker could
-- convert on its way out.
create or replace function entries.admin_outbox_list(
  p_limit int default 200
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_figures jsonb;
begin
  if not identity.has_permission('nn.entry.read') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    p_limit := 200;
  end if;

  select jsonb_build_object(
           'pending', pg_catalog.count(*) filter (where outbox.status = 'pending')::int,
           'sent', pg_catalog.count(*) filter (where outbox.status = 'sent')::int,
           'failed', pg_catalog.count(*) filter (where outbox.status = 'failed')::int,
           'sent_today', pg_catalog.count(*) filter (
             where outbox.status = 'sent'
               and outbox.sent_at at time zone 'Europe/London'
                   >= pg_catalog.date_trunc(
                        'day', pg_catalog.now() at time zone 'Europe/London'
                      )
           )::int,
           -- **The oldest thing still owed**, which is what says whether the queue is moving.
           -- Null when nothing is pending, rather than zero — "nothing waiting" and "something
           -- waiting no time at all" are different sentences on the page.
           'oldest_pending_at', pg_catalog.min(outbox.created_at)
             filter (where outbox.status = 'pending')
         )
    into v_figures
    from entries.email_outbox as outbox;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', row.id,
               'template', row.template,
               'recipient', row.recipient::text,
               'status', row.status,
               'attempts', row.attempts,
               'last_error', row.last_error,
               'created_at', row.created_at,
               'sent_at', row.sent_at,
               'purchase_reference', row.purchase_id::text,
               'event_name', row.event_name
             )
             order by row.created_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from (
      select outbox.id,
             outbox.template,
             outbox.recipient,
             outbox.status,
             outbox.attempts,
             outbox.last_error,
             outbox.created_at,
             outbox.sent_at,
             outbox.purchase_id,
             event.display_name as event_name
        from entries.email_outbox as outbox
        join entries.entry_purchases as purchase on purchase.id = outbox.purchase_id
        join entries.events as event on event.id = purchase.event_id
       order by outbox.created_at desc
       limit p_limit
    ) as row;

  return jsonb_build_object('ok', true, 'figures', v_figures, 'messages', v_rows);
end;
$function$;

comment on function entries.admin_outbox_list(int) is
  'The email queue for the admin surface, newest first, with the counts computed in the same query. sent_today is the club''s own count against Resend''s daily cap and is a floor: account emails share the Resend account and are not in this table.';

revoke all on function entries.admin_outbox_list(int) from public;
grant execute on function entries.admin_outbox_list(int) to authenticated;

-- -------------------------------------------------------------------------------------------
-- entries.admin_outbox_resend() — ask for one message again
-- -------------------------------------------------------------------------------------------
-- **`already_sent` is a refusal rather than a convenience.** A `sent` row has been delivered
-- once; putting it back in the queue sends a second identical confirmation to somebody who is
-- already entered, and the most likely reason a volunteer reaches for this is that a runner
-- said they never got it — which is far more often a spam folder than a failed send. **The
-- club cannot un-send an email**, so the direction to fail in is the one that sends fewer.
--
-- If somebody genuinely needs a second copy, the honest act is to forward it from the race's
-- own mailbox, where it is obvious to the recipient that a human did it.
create or replace function entries.admin_outbox_resend(
  p_id uuid
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_row entries.email_outbox;
begin
  if not identity.has_permission('nn.entry.cancel') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select * into v_row
    from entries.email_outbox
   where id = p_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_message');
  end if;

  if v_row.status = 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_row.status = 'pending' then
    -- Not an error and not a change: it is already owed and the drain will reach it. Said
    -- plainly so the page can say so, rather than reporting a success that did nothing.
    return jsonb_build_object('ok', false, 'reason', 'already_queued');
  end if;

  -- **Written before the change**, the ordering `cancel_entry()` established: an audit trail
  -- that only records what succeeded is a record of the times nothing went wrong.
  perform entries.record_admin_action(
    auth.uid()::text,
    'resend_email',
    jsonb_build_object(
      'outbox_id', p_id,
      'template', v_row.template,
      'previous_attempts', v_row.attempts,
      'previous_error', v_row.last_error
      -- **No recipient.** `entries.admin_audit` is the record of who did what, and it is not
      -- a second place the club's email addresses live. The outbox row holds it and the
      -- `outbox_id` above points at it.
    )
  );

  update entries.email_outbox
     set status = 'pending',
         -- Back to zero: a human deciding to try again is a new judgement, not a fourth
         -- automatic attempt at something that already failed three times.
         attempts = 0,
         last_error = null
   where id = p_id;

  return jsonb_build_object('ok', true, 'template', v_row.template);
end;
$function$;

comment on function entries.admin_outbox_resend(uuid) is
  'Puts one failed message back in the queue with its attempts reset, and audits who asked. Refuses a message that has already been sent: the club cannot un-send an email, so a duplicate confirmation is the worse failure.';

revoke all on function entries.admin_outbox_resend(uuid) from public;
grant execute on function entries.admin_outbox_resend(uuid) to authenticated;
