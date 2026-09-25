-- ===========================================================================================
-- Draining the membership outbox
-- ===========================================================================================
--
-- `entries.claim_outbox_batch()` and `record_send_result()`, one schema along. The shape is
-- deliberately the same so that a volunteer reading one has read both, and so that the Worker
-- can reuse `email-outbox.ts`'s loop rather than growing a second one.
--
-- ## What is different, and it is one thing
--
-- ⚠️ **The notification carries the whole application; the acknowledgement carries almost
-- nothing.** A membership message is not a receipt for a payment — one of the two is the
-- Membership Officer's working copy of a form, so it holds an address, a date of birth and a
-- phone number, and the other says "we have got it" to the person who sent it.
--
-- `claim_outbox_batch()` therefore returns **different fields per template**, and the branch
-- is here rather than in the Worker: a query that returned the applicant's home address for
-- both would put it in the acknowledgement the day somebody edited a template, and nothing
-- would look wrong.
--
-- ## ⚠️ Both take the key, and it is checked before anything is read
--
-- `claim_outbox_batch()` returns real email addresses and, for one template, a home address.
-- Granted to `anon` unguarded, two PostgREST calls with the key printed in page source would
-- hand over the club's applicant list. The check is first so that a wrong key cannot be used
-- to learn whether anything is queued.
--
-- ===========================================================================================

create or replace function membership.claim_outbox_batch(
  p_key text,
  p_limit int default 10
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = membership, pg_catalog
as $function$
declare
  v_rows jsonb;
begin
  if not membership.key_ok('webhook', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  -- Bounded, and not by the caller's optimism. A batch larger than this is a burst at a
  -- provider that rate-limits, and the drain runs every five minutes anyway.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    p_limit := 10;
  end if;

  with claimed as (
    select outbox.id
      from membership.email_outbox as outbox
     where outbox.status = 'pending'
     order by outbox.created_at
     limit p_limit
     for update skip locked
  ),
  marked as (
    update membership.email_outbox as outbox
       set attempts = outbox.attempts + 1,
           last_attempt_at = pg_catalog.now()
      from claimed
     where outbox.id = claimed.id
    returning
      outbox.id,
      outbox.template,
      outbox.recipient,
      outbox.application_id,
      outbox.attempts
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', marked.id,
               'template', marked.template,
               'recipient', marked.recipient::text,
               'attempts', marked.attempts,

               -- Both messages name the person, because both are read by somebody who needs
               -- to know which application this is.
               'firstName', application.first_name,
               'lastName', application.last_name,
               'membershipName', types.display_name,
               'pricePence', application.price_pence,

               -- ⚠️ **`Reply-To` on the club's copy is the applicant**, so a Membership
               -- Officer answering a new-member email reaches the new member rather than the
               -- club's own inbox. On the applicant's copy it is the club, for the mirror
               -- reason. `email-outbox.ts` reads this and never decides it.
               'replyTo', case
                 when marked.template = 'application_submitted'
                   then application.email::text
                 else settings.notification_email
               end,

               -- ⚠️ **The form's own answers, and only on the club's copy.** This is the
               -- branch this function exists for: the acknowledgement gets `null` for every
               -- one of these, so an edit to that template cannot disclose a home address.
               'details', case
                 when marked.template = 'application_submitted' then jsonb_build_object(
                   'title', application.title,
                   'email', application.email::text,
                   'phone', application.phone,
                   'dateOfBirth', pg_catalog.to_char(application.date_of_birth, 'YYYY-MM-DD'),
                   'addressLine1', application.address_line1,
                   'addressLine2', application.address_line2,
                   'cityTown', application.city_town,
                   'postcode', application.postcode,
                   'country', application.country,
                   'membershipType', application.membership_type,
                   'previousAffiliation', application.previous_affiliation,
                   'previousClubName', application.previous_club_name,
                   'eaUrn', application.ea_urn,
                   'eaPortalConsent', application.ea_portal_consent,
                   'consentsVersion', application.consents_version
                 )
                 else null
               end
             )
             order by marked.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from marked
    join membership.membership_applications as application
      on application.id = marked.application_id
    join membership.membership_types as types
      on types.code = application.membership_type
    cross join membership.settings as settings;

  return jsonb_build_object('ok', true, 'messages', v_rows);
end;
$function$;

comment on function membership.claim_outbox_batch(text, int) is
  'Claims up to p_limit pending rows for delivery, incrementing attempts as it hands them over. Returns the application''s own answers only for the club''s copy, never for the applicant''s acknowledgement. Takes the webhook key: it returns real email addresses and one home address, and anon is a role whose key is published in page source.';

revoke all on function membership.claim_outbox_batch(text, int) from public;
grant execute on function membership.claim_outbox_batch(text, int) to anon;

-- -------------------------------------------------------------------------------------------
-- record_send_result — what happened to one attempt
-- -------------------------------------------------------------------------------------------
-- ⚠️ **A rate-limit rejection returns the attempt.** The provider never looked at the message,
-- so counting it would spend one of three tries on the club's own daily cap — and with
-- Resend's free tier at 100 a day, account-wide, that is the failure most likely to happen on
-- a busy day.
create or replace function membership.record_send_result(
  p_key text,
  p_id uuid,
  p_sent boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_rate_limited boolean default false
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = membership, pg_catalog
as $function$
declare
  v_status text;
  v_attempts int;
begin
  if not membership.key_ok('webhook', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select outbox.attempts into v_attempts
    from membership.email_outbox as outbox
    where outbox.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_message');
  end if;

  if p_sent then
    update membership.email_outbox
       set status = 'sent',
           sent_at = pg_catalog.now(),
           provider_message_id = p_provider_message_id,
           last_error = null
     where id = p_id;

    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  if p_rate_limited then
    -- Give the attempt back and leave it pending. The cron picks it up within five minutes.
    update membership.email_outbox
       set attempts = greatest(v_attempts - 1, 0),
           last_error = pg_catalog.left(coalesce(p_error, 'rate limited'), 200)
     where id = p_id;

    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;

  -- Three attempts, then it stops and waits for a person. `/admin/membership/` is where a
  -- volunteer sees it; the application itself is safe either way, which is the whole point of
  -- writing the obligation down rather than sending inline.
  v_status := case when v_attempts >= 3 then 'failed' else 'pending' end;

  update membership.email_outbox
     set status = v_status,
         last_error = pg_catalog.left(coalesce(p_error, 'unknown error'), 200)
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$function$;

comment on function membership.record_send_result(text, uuid, boolean, text, text, boolean) is
  'Records the outcome of one delivery attempt. Marks sent, leaves pending for a retry, or gives up at three attempts. A rate-limit rejection returns the attempt, because the provider never looked at the message.';

revoke all on function membership.record_send_result(text, uuid, boolean, text, text, boolean) from public;
grant execute on function membership.record_send_result(text, uuid, boolean, text, text, boolean) to anon;
