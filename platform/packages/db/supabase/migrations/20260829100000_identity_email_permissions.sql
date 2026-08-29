-- The email queue gets permissions of its own — the ninth and the tenth.
--
-- =========================================================================================
-- The decision this takes, and who took it
-- =========================================================================================
-- `20260828190000_entries_admin_outbox.sql` built `/admin/emails/` behind two permissions it
-- had to borrow: `nn.entry.read` to open the page and `nn.entry.cancel` to press the re-send
-- button. Its own header called that *"the cleaner answer ... a decision the club can take
-- later"*, and CLAUDE.md lists a ninth permission as a stop-and-ask for exactly that reason.
--
-- **It was asked for and taken on 29 August 2026.** So there are two more:
--
--   * `nn.email.read` — open the queue, see what the club has sent and what it still owes.
--   * `nn.email.resend` — ask for one failed message again.
--
-- =========================================================================================
-- Why two rather than one
-- =========================================================================================
-- The same split the page already made and the same one `/admin/people/` makes: reading is
-- one act and doing is another. Collapsing them here would have made the finer of the two
-- controls the coarser one, which is the trade the borrowed pair was already making.
--
-- **`nn.entry.cancel` was the worse half of the borrow.** It means "may undo an entry
-- somebody paid for and move money", and re-sending an email is neither — so a volunteer
-- trusted to answer *"I never got my confirmation"* had to be trusted with refunds first.
-- That is backwards, and it is the shape of borrow that quietly widens a permission until it
-- means nothing.
--
-- =========================================================================================
-- Expand, and it is safe in both deploy orders
-- =========================================================================================
-- Both new permissions go to `nn-admin`, which already holds `nn.entry.read` and
-- `nn.entry.cancel`. So the set of people who can open the page and press the button is
-- **identical before and after** — nobody gains anything and nobody loses anything, whichever
-- of the migration and the Cloudflare deploy lands first. What changes is that the two acts
-- can now be granted apart, which is what a sixth role would need.
--
-- Nothing is revoked here. `nn.entry.read` and `nn.entry.cancel` go on meaning what they mean
-- on the entry list; they simply stop being asked about email.

insert into identity.permissions (slug, description) values
  ('nn.email.read',
   'Read the club''s email queue at /admin/emails/ — what has been sent, and what is owed.'),
  ('nn.email.resend',
   'Ask for one failed message from the email queue to be sent again.')
on conflict (slug) do nothing;

-- **Both on `nn-admin` and neither on `super-admin`**, for the reason every `nn.*` permission
-- is: a super-admin cannot read the entry list, and the queue is a list of the same people's
-- email addresses. Granting it here would be the inheritance `identity.role_permissions`
-- exists to refuse. A super-admin who needs the queue grants themselves `nn-admin`, and that
-- writes a row in `identity.audit`.
insert into identity.role_permissions (role, permission) values
  ('nn-admin', 'nn.email.read'),
  ('nn-admin', 'nn.email.resend')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------------------
-- entries.admin_outbox_list() — re-pasted whole, one line different
-- -----------------------------------------------------------------------------------------
-- Postgres replaces a function body entire, so this is #133's version with the permission it
-- asks about changed and nothing else touched. The `p_limit` default travels with it, because
-- a `create or replace` that omitted it would change the callable signature under PostgREST.
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
  if not identity.has_permission('nn.email.read') then
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
  'The email queue for the admin surface, newest first, with the counts computed in the same query. Behind nn.email.read since 29 August 2026, which is a permission of its own rather than the entry list''s. sent_today is the club''s own count against Resend''s daily cap and is a floor: account emails share the Resend account and are not in this table.';

revoke all on function entries.admin_outbox_list(int) from public;
grant execute on function entries.admin_outbox_list(int) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.admin_outbox_resend() — re-pasted whole, one line different
-- -----------------------------------------------------------------------------------------
-- The same one-line change, and this is the half the borrow was worst for: re-sending a
-- message is not moving money, and asking `nn.entry.cancel` about it meant a volunteer had to
-- be trusted with refunds before they could answer "I never got my confirmation".
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
  if not identity.has_permission('nn.email.resend') then
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
  'Puts one failed message back in the queue with its attempts reset, and audits who asked. Behind nn.email.resend since 29 August 2026 rather than the refund permission it used to borrow. Refuses a message that has already been sent: the club cannot un-send an email, so a duplicate confirmation is the worse failure.';

revoke all on function entries.admin_outbox_resend(uuid) from public;
grant execute on function entries.admin_outbox_resend(uuid) to authenticated;
