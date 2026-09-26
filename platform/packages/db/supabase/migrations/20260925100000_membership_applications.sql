-- ===========================================================================================
-- A person applies to join the club, and the club finds out
-- ===========================================================================================
--
-- The club has taken applications through a Squarespace form since it had a website. This
-- moves that collection onto the club's own platform: the same eighteen questions, stored in
-- a table the club controls, with an acknowledgement to the applicant and the filled form to
-- the Membership Officer.
--
-- ## ⚠️ This table holds personal data and it was a decision, not a build step
--
-- Eighteen fields, including a **date of birth** and a **home address**. Adding a column that
-- holds personal data is a committee decision under this repository's own stop-and-ask list,
-- and this one was taken by the club on **25 September 2026** — see ADR-050. What it is not is
-- a *new* collection: every field here is already asked on the club's live Squarespace form,
-- so what changed is who holds the answers, not what is asked.
--
-- ## Why a table at all, when the point is to send an email
--
-- Because the obligation to send a message is written in the same transaction as the thing it
-- is about — [ADR-021](../../../../docs/architecture/decisions/adr-021-the-club-tells-people-by-outbox.md).
-- The alternative is the Worker calling the email provider inline at submit time, and then a
-- provider that is down or rate-limited loses somebody's application **silently**: they saw a
-- confirmation page, the club never heard, and nobody finds out until they turn up to a run
-- expecting to be a member.
--
-- ⚠️ **Resend's free tier is 100 emails a day, account-wide**, shared with every race and
-- account email the platform sends. On a busy day a membership acknowledgement can be the one
-- that is refused, and the outbox is what makes that *late* rather than *lost*.
--
-- So the outbox holds an address and a pointer; everything a message says is joined from this
-- table at send time. That is what stops the queue becoming a second copy of the application
-- for retention to chase.
--
-- ## The date of birth
--
-- ⚠️ **Stored, like `entries.entrants` stores it, and for a reason this table can state.**
-- The principle is that an age is *derived* and never stored — a stored age is wrong the
-- moment a birthday passes, and wrong silently. So the column is the date and every age check
-- computes from it. Two things need it: the minimum age, and England Athletics, who register
-- a member on their date of birth and whom the applicant is asked explicitly about.
--
-- ## Two keys, and what each is for
--
-- `submit_application()` is granted to `anon` — it must be, an applicant is signed out — and
-- it inserts a row and enqueues two emails. Without a key, a loop against the published anon
-- key fills the table and burns the club's entire daily email allowance in seconds.
-- ⚠️ **That is ADR-029's finding applied before it was needed rather than four days after**:
-- `create_pending_purchase()` took 249 of 250 places in half a second from a key printed in
-- page source, and the only reason this path is not the same shape is that it has no capacity
-- to exhaust. It has a mailbox instead.
--
-- Cloudflare's one rate-limiting rule (C1) covers `POST` under `/account/`, `/admin/` and
-- `/nn/` — **not `/membership/`** — and the free plan allows exactly one rule, so there is no
-- edge control on this path and will not be one. The key is the control that exists.
--
-- ===========================================================================================

-- -------------------------------------------------------------------------------------------
-- api_secrets — the digests of the keys the Worker presents, never the keys
-- -------------------------------------------------------------------------------------------
-- `store.api_secrets`' shape exactly. Both ship **null**, which refuses everything: the safe
-- direction, and the reason the form cannot be opened before the runbook installs them.
create table if not exists membership.api_secrets (
  name text primary key check (name in ('entry', 'webhook')),
  key_sha256 text check (key_sha256 is null or key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table membership.api_secrets is
  'The digests of the keys the Worker presents, never the keys. RLS on, no policy, no grant — reachable only from the security definer functions below. If tests/membership.test.ts stops refusing this table, a credential digest became readable with a key that is published in page source.';

alter table membership.api_secrets enable row level security;

insert into membership.api_secrets (name) values ('entry'), ('webhook')
  on conflict (name) do nothing;

-- -------------------------------------------------------------------------------------------
-- Two settings the club changes without a deploy
-- -------------------------------------------------------------------------------------------
-- ⚠️ **The notification address is a column rather than a constant**, so moving it off
-- `membership@…` is an `update`. A club address written into a Worker is a deploy on the day
-- somebody leaves the committee.
alter table membership.settings
  add column if not exists notification_email text;

alter table membership.settings
  add column if not exists processed_retention interval not null default interval '90 days';

update membership.settings
  set notification_email = 'membership@southvillerunningclub.co.uk'
  where notification_email is null;

alter table membership.settings
  alter column notification_email set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'settings_notification_email_shaped'
  ) then
    alter table membership.settings
      add constraint settings_notification_email_shaped
      check (position('@' in notification_email) > 1);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'settings_retention_sane'
  ) then
    alter table membership.settings
      add constraint settings_retention_sane
      check (processed_retention > interval '0 days');
  end if;
end $$;

comment on column membership.settings.notification_email is
  'Where a new application is sent. A column so that changing it is an update and no deploy.';
comment on column membership.settings.processed_retention is
  'How long a processed application is kept after it is marked processed. An application still marked new is never deleted by the sweep — it is outstanding work, and deleting it would lose somebody who is waiting to hear.';

-- -------------------------------------------------------------------------------------------
-- membership_applications — what somebody filled in
-- -------------------------------------------------------------------------------------------
-- ⚠️ **No age column and no category column**, for `entries.entrants`' reason: both are
-- derived from the date of birth at read time, and a stored one is wrong the moment a birthday
-- passes.
--
-- ⚠️ **`price_pence` is a snapshot and is not a second source of truth.** The price comes from
-- `membership_types` when the form is painted and is recorded here as *what this person was
-- quoted*. A fee rise later must not rewrite what somebody was asked to pay, which is exactly
-- why `store.ticket_purchases.amount_pence` exists beside `ticket_types.price_pence`.
create table if not exists membership.membership_applications (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(trim(title)) between 1 and 40),
  first_name text not null check (length(trim(first_name)) between 1 and 50),
  last_name text not null check (length(trim(last_name)) between 1 and 50),

  email extensions.citext not null check (position('@' in email::text) > 1),

  -- E.164, so one number has one representation whichever way it was typed — and so a member
  -- with a French number is reachable on it. packages/shared/src/phone.ts is the parser.
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),

  date_of_birth date not null check (date_of_birth >= date '1900-01-01'),

  address_line1 text not null check (length(trim(address_line1)) between 1 and 120),
  address_line2 text check (address_line2 is null or length(trim(address_line2)) <= 120),
  city_town text not null check (length(trim(city_town)) between 1 and 120),
  postcode text not null check (length(trim(postcode)) between 1 and 20),

  -- ISO 3166-1 alpha-2. ⚠️ **Not a foreign key to a country table and not checked against the
  -- form's own list**: a stored code must stay readable the day that list drops an entry, and
  -- the shape is the whole of what this column can honestly promise.
  country text not null check (country ~ '^[A-Z]{2}$'),

  -- ⚠️ **`on delete restrict`**, not cascade. Withdrawing a membership type must not delete
  -- the applications that chose it — those are people the club has heard from.
  membership_type text not null
    references membership.membership_types (code) on delete restrict,
  price_pence integer not null check (price_pence >= 0),

  previous_affiliation boolean not null,
  previous_club_name text
    check (previous_club_name is null or length(trim(previous_club_name)) <= 120),

  -- Digits only. A box that accepts `URN 1234` stores a string nothing can look up.
  ea_urn text check (ea_urn is null or ea_urn ~ '^[0-9]+$'),

  -- ⚠️ **A real yes and a real no.** Consent that cannot be withheld is not freely given,
  -- which is the whole of what UK GDPR asks of it, so `false` is a value this column holds and
  -- the club acts on rather than an absence.
  ea_portal_consent boolean not null,

  -- Which wording the three policy boxes were ticked against, so that changing a policy later
  -- does not silently restate what somebody agreed to. `entry_purchases.consents_version`'s
  -- reasoning exactly.
  consents_version text not null check (length(trim(consents_version)) between 1 and 40),

  -- ⚠️ **Three states and no fourth.** `new` is outstanding work, `processed` is done and
  -- starts the retention clock, `withdrawn` is somebody who asked not to join after all. A
  -- fourth value would be invisible to the sweep below, which is the shape of defect
  -- `entry_purchases.status` has a written warning about.
  status text not null default 'new' check (status in ('new', 'processed', 'withdrawn')),
  processed_at timestamptz,

  created_at timestamptz not null default pg_catalog.now(),

  -- The clock only runs once somebody has acted. Both directions are refused: a `new` row may
  -- not carry a timestamp, and a settled one may not be missing it.
  constraint applications_processed_coherent check (
    (status = 'new' and processed_at is null)
    or (status in ('processed', 'withdrawn') and processed_at is not null)
  ),

  -- A club name is only meaningful if somebody said they had been affiliated.
  constraint applications_previous_club_needs_affiliation check (
    previous_affiliation or previous_club_name is null
  )
);

comment on table membership.membership_applications is
  'Somebody asking to join the club. Eighteen fields, all of them already asked on the club''s Squarespace form — ADR-050. Age is derived from date_of_birth at read time and never stored.';

create index if not exists membership_applications_new_first
  on membership.membership_applications (created_at desc)
  where status = 'new';

create index if not exists membership_applications_sweep
  on membership.membership_applications (processed_at)
  where status in ('processed', 'withdrawn');

alter table membership.membership_applications enable row level security;

-- -------------------------------------------------------------------------------------------
-- email_outbox — the obligation to tell somebody, written with the thing it is about
-- -------------------------------------------------------------------------------------------
-- ADR-021's mechanism, for membership. ⚠️ **The row holds an address and a pointer and nothing
-- else**: every fact a message states is joined from `membership_applications` at send time,
-- so the queue never becomes a second copy of the application for retention to chase.
create table if not exists membership.email_outbox (
  id uuid primary key default gen_random_uuid(),

  application_id uuid not null
    references membership.membership_applications (id) on delete cascade,

  -- `application_received` goes to the applicant; `application_submitted` goes to the club.
  template text not null check (
    template in ('application_received', 'application_submitted')
  ),

  recipient extensions.citext not null
    check (position('@' in recipient::text) > 1),

  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),

  attempts int not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text check (last_error is null or length(last_error) <= 200),

  created_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,

  -- The club cannot un-send an email, so the guard against sending one twice is a constraint
  -- rather than a convention.
  dedupe_key text not null unique
);

comment on table membership.email_outbox is
  'One message the club owes about one application. Holds an address and a pointer; everything a message says is joined at send time.';

create index if not exists membership_outbox_pending
  on membership.email_outbox (created_at)
  where status = 'pending';

alter table membership.email_outbox enable row level security;

-- -------------------------------------------------------------------------------------------
-- key_ok — granted to nobody
-- -------------------------------------------------------------------------------------------
-- ⚠️ Callable, this would be an oracle for the key: a few thousand calls and a published anon
-- key is a credential. It is reachable only from the definer functions below.
create or replace function membership.key_ok(p_name text, p_key text)
  returns boolean
  language plpgsql
  security definer
  set search_path = membership, pg_catalog
as $$
declare
  v_digest text;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;

  select secret.key_sha256 into v_digest
    from membership.api_secrets as secret
    where secret.name = p_name;

  -- A null digest refuses everything, which is what ships and is the safe direction.
  if v_digest is null then
    return false;
  end if;

  -- `pg_catalog.sha256(bytea)` is core Postgres; no extension is added for this, which is
  -- the same call `store.key_ok()` makes.
  return v_digest = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
  );
end;
$$;

revoke all on function membership.key_ok(text, text) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- The trigger that owes the two messages
-- -------------------------------------------------------------------------------------------
-- ⚠️ **`after insert`, not `after update`.** An application has no state to transition
-- through — it arrives complete. `entries` needed an insert trigger as a *second* one, bolted
-- on after complimentary places were given and silently told nobody; starting here means that
-- gap never exists.
create or replace function membership.enqueue_application_emails()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_club_address text;
begin
  select settings.notification_email into v_club_address
    from membership.settings as settings
    where settings.id;

  -- The applicant, first. They are the one waiting.
  insert into membership.email_outbox (application_id, template, recipient, dedupe_key)
  values (
    new.id,
    'application_received',
    new.email,
    'application_received:' || new.id::text
  )
  on conflict (dedupe_key) do nothing;

  -- And the club. ⚠️ **If the address is somehow unset this enqueues nothing rather than
  -- failing the insert**: refusing the application would lose the person entirely, where a
  -- missing notification leaves a row a volunteer can still find on the admin page.
  if v_club_address is not null then
    insert into membership.email_outbox (application_id, template, recipient, dedupe_key)
    values (
      new.id,
      'application_submitted',
      v_club_address,
      'application_submitted:' || new.id::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function membership.enqueue_application_emails() from public, anon, authenticated;

drop trigger if exists enqueue_application_emails
  on membership.membership_applications;

create trigger enqueue_application_emails
  after insert on membership.membership_applications
  for each row
  execute function membership.enqueue_application_emails();

-- -------------------------------------------------------------------------------------------
-- submit_application — the one door an applicant comes through
-- -------------------------------------------------------------------------------------------
-- ⚠️ **Every rule is enforced here as well as in Zod.** Slice G found `create_pending_purchase`
-- trusting the form on a rule the database never checked, and two PostgREST calls with the
-- published anon key bought an affiliated place £2 under. Zod is the form's control, not the
-- system's — so the minimum age, the membership type and the price are all re-derived from the
-- database here, whatever the caller sent.
--
-- ⚠️ **The price is never taken from the caller.** It is read from `membership_types` inside
-- this function, so a submission naming £0 is recorded at the real price.
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
    -- Indistinguishable from any other refusal on purpose: a caller probing with a wrong key
    -- learns nothing about whether one is installed.
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

  -- ⚠️ **Against the club's own day.** `current_date` on this server is UTC, which names
  -- yesterday for an hour on a BST morning — the error ESLint bans `toISOString().slice(0,10)`
  -- for in the application code. `timezone` is how SQL asks the same question properly.
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
    coalesce((p_application ->> 'eaPortalConsent')::boolean, false),
    coalesce(nullif(trim(coalesce(p_application ->> 'consentsVersion', '')), ''), 'unversioned')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'applicationId', v_id);
end;
$$;

comment on function membership.submit_application(text, jsonb) is
  'Records an application to join the club and enqueues the two emails it owes. Takes the entry key: it is granted to anon, and without one a loop against the published anon key fills the table and burns the club''s daily email allowance.';

revoke all on function membership.submit_application(text, jsonb) from public;
grant execute on function membership.submit_application(text, jsonb) to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- The retention sweep
-- -------------------------------------------------------------------------------------------
-- ⚠️ **It never touches a `new` row.** An application nobody has acted on is outstanding work,
-- and deleting one loses somebody who is waiting to hear back. The clock starts when a human
-- marks it settled, not when it arrives.
create or replace function membership.delete_old_applications()
  returns integer
  language plpgsql
  security definer
  set search_path = membership, pg_catalog
as $$
declare
  v_retention interval;
  v_deleted integer;
begin
  select settings.processed_retention into v_retention
    from membership.settings as settings
    where settings.id;

  if v_retention is null then
    return 0;
  end if;

  delete from membership.membership_applications
    where status in ('processed', 'withdrawn')
      and processed_at is not null
      and processed_at < pg_catalog.now() - v_retention;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function membership.delete_old_applications() is
  'Deletes applications a volunteer has settled, once the retention period has passed. Never deletes one still marked new. Takes no key for delete_expired_medical_notes()''s reason: it can only remove what the club has published a promise to remove, and gating it would make a retention obligation stop being kept on any day a key was not installed.';

revoke all on function membership.delete_old_applications() from public;
grant execute on function membership.delete_old_applications() to anon, authenticated;
