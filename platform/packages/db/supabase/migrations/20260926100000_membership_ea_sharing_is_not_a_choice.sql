-- ===========================================================================================
-- England Athletics is not a choice, so the form stops pretending it is
-- ===========================================================================================
--
-- ADR-050 built the application form asking **"May we pass your name, date of birth and email
-- address to England Athletics so they can set up your portal account?"** as a real yes/no,
-- and said in as many words that a consent which cannot be withheld is not freely given.
--
-- ⚠️ **It cannot be withheld.** The club confirmed on 26 September 2026 that **every** new
-- member is processed on the England Athletics portal, including a £4 club-only one — that is
-- how a membership is set up, and **England Athletics is what sends the applicant the payment
-- link**. The club takes no payment on this website at all.
--
-- So the question was asking permission for something that happens either way. That is worse
-- than not asking: it is invalid consent *and* it tells somebody their details stay with the
-- club if they answer no, which is false.
--
-- ## What replaces it
--
-- **Nothing asks. The form tells.** The lawful basis is the **contract** — passing the details
-- on is how the club gives somebody the membership they applied for — so the honest shape is a
-- statement in the privacy wording, not a box. UK GDPR asks that a person is *told*; it does
-- not ask their permission for something necessary to the thing they requested.
--
-- ## ⚠️ Expand, not contract
--
-- `ea_portal_consent` becomes **nullable** here and is not dropped. The deployed Worker still
-- sends the key, and dropping the column mid-deploy would refuse every application between the
-- database deploying and Cloudflare catching up — the two are not sequenced against each other,
-- which is exactly what expand-migrate-contract exists for.
--
-- **The contract step is owed** and is a migration that drops the column, once no deployed
-- Worker sends it. Nothing reads it from today.
-- ===========================================================================================

alter table membership.membership_applications
  alter column ea_portal_consent drop not null;

comment on column membership.membership_applications.ea_portal_consent is
  'RETIRED 26 September 2026 — the club processes every member on the England Athletics portal, so this was permission for something that happened either way. Null on every application from that date. Kept nullable rather than dropped because the deployed Worker still sends the key; the contract step is a migration that drops it.';

-- -------------------------------------------------------------------------------------------
-- submit_application — stops recording an answer nobody is asked for
-- -------------------------------------------------------------------------------------------
-- ⚠️ **A null rather than `false`.** `false` would read as *"this person refused"*, which is a
-- statement about somebody who was never asked — and the one reading it later would have no way
-- to tell the two apart. A null says "not asked", which is what happened.
create or replace function membership.submit_application(
  p_key text,
  p_application jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = membership, pg_catalog
as $$
declare
  v_type membership.membership_types%rowtype;
  v_minimum_age int;
  v_dob date;
  v_age int;
  v_id uuid;
begin
  if not membership.key_ok('entry', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select types.* into v_type
    from membership.membership_types as types
    where types.code = p_application ->> 'membershipType'
      and types.active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_membership_type');
  end if;

  select settings.minimum_age into v_minimum_age
    from membership.settings as settings
    where settings.id;

  begin
    v_dob := (p_application ->> 'dateOfBirth')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'date_of_birth_unreadable');
  end;

  v_age := extract(year from age(
    (pg_catalog.now() at time zone 'Europe/London')::date,
    v_dob
  ));

  if v_dob > (pg_catalog.now() at time zone 'Europe/London')::date then
    return jsonb_build_object('ok', false, 'reason', 'date_of_birth_future');
  end if;

  if v_age < v_minimum_age then
    return jsonb_build_object('ok', false, 'reason', 'too_young');
  end if;

  insert into membership.membership_applications (
    title, first_name, last_name, email, phone, date_of_birth,
    address_line1, address_line2, city_town, postcode, country,
    membership_type, price_pence,
    previous_affiliation, previous_club_name, ea_urn, ea_portal_consent,
    consents_version
  )
  values (
    p_application ->> 'title',
    p_application ->> 'firstName',
    p_application ->> 'lastName',
    p_application ->> 'email',
    p_application ->> 'phone',
    v_dob,
    p_application ->> 'addressLine1',
    nullif(trim(coalesce(p_application ->> 'addressLine2', '')), ''),
    p_application ->> 'cityTown',
    p_application ->> 'postcode',
    upper(p_application ->> 'country'),
    v_type.code,
    v_type.price_pence,
    coalesce((p_application ->> 'previousAffiliation')::boolean, false),
    nullif(trim(coalesce(p_application ->> 'previousClubName', '')), ''),
    nullif(trim(coalesce(p_application ->> 'eaUrn', '')), ''),
    -- Nobody is asked, so nobody has answered. Deliberately not `false`.
    null,
    coalesce(nullif(trim(coalesce(p_application ->> 'consentsVersion', '')), ''), 'unversioned')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'applicationId', v_id);
end;
$$;

revoke all on function membership.submit_application(text, jsonb) from public;
grant execute on function membership.submit_application(text, jsonb) to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- claim_outbox_batch — the club's copy stops carrying an answer nobody gave
-- -------------------------------------------------------------------------------------------
-- The Membership Officer's copy listed "May pass details: Yes". Printing that for somebody who
-- was never asked would be the email inventing a fact about them, so the key goes.
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
               'firstName', application.first_name,
               'lastName', application.last_name,
               'membershipName', types.display_name,
               'pricePence', application.price_pence,
               'replyTo', case
                 when marked.template = 'application_submitted'
                   then application.email::text
                 else settings.notification_email
               end,
               -- ⚠️ **Still only on the club's copy.** The applicant's acknowledgement gets
               -- `null` here, so an edit to that template cannot disclose a home address —
               -- the property this function exists to hold.
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

revoke all on function membership.claim_outbox_batch(text, int) from public;
grant execute on function membership.claim_outbox_batch(text, int) to anon;
