-- Race photos: emailing each runner their private link, and a new one when they ask
-- (brief slice 5, decision 9, ADR-069).
--
-- Slice 4 built the runners' pages, which answer only to an active link's hash. Nothing made
-- a link yet. This migration is everything that does, and nothing else:
--
--   * **`nn.photo.send`**, the photo-admin's fifth permission (ADR-066 named it for this slice);
--   * **`photos.email_outbox`**, the obligation to send one link email, holding a bib and no
--     address (brief §3);
--   * **`photos.send_links()`**, which queues a first link for every runner with a photo of
--     their own, once;
--   * **`photos.request_link()`**, the lost-link form's one call, which answers the same
--     whatever it is given;
--   * **`photos.claim_outbox_batch()` and `record_send_result()`**, the drain, which keeps the
--     first links inside a daily limit and makes a link active only once its email has gone.
--
-- ## ⚠️ The token is never in the database, not even for a moment
--
-- An email carries the token; `photos.link` holds only its SHA-256 (ADR-068). So the token is
-- made where the email is made, in the Worker, as `HMAC-SHA256(PHOTOS_LINK_KEY, outbox row
-- id)` — ADR-069. The drain can make the same token again on a retry from nothing but the row
-- id, which is what lets Resend's idempotency key stop a second copy rather than a second copy
-- going out with a different link. `record_send_result()` is told the hash once the email has
-- gone, and that is when the link becomes the runner's one active link: **the old link keeps
-- working until a new one has actually been sent**.
--
-- ## Addresses are read where entries keep them, at the moment they are needed
--
-- `photos.recipient_for()` is the one place a bib becomes an address. A runner's is their
-- paid purchase's `purchaser_email`; a guide's is their own `entrants.email`. A walk-in has
-- none (`timing.add_walk_in()` takes no address), and nor does a bib two people seem to share,
-- which is answered with nobody rather than with a guess. No address is copied into `photos`.
--
-- ## Keys, and why there are two
--
-- `request_link()` must be callable signed out, and it makes the club send an email. Without a
-- key, a loop with the anon key from page source would drain the account-wide daily allowance
-- the race shares — `runbooks/membership-keys.md`'s argument, applied before it was needed.
-- The drain's key is separate because one key opening two doors is one rotation closing both.
-- Both digests ship null, which refuses everything.
-- ===========================================================================================

-- -------------------------------------------------------------------------------------------
-- The permission
-- -------------------------------------------------------------------------------------------
insert into identity.permissions (slug, description) values
  ('nn.photo.send',
   'Email every runner the private link to their race photos. Only once the photos are published.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('nn-photo-admin', 'nn.photo.send'),
  ('src-admin', 'nn.photo.send')
on conflict (role, permission) do nothing;

-- The role's own description is what `/admin/people/` shows somebody granting it.
update identity.roles
   set description = 'Publish the race photos, email the runners their links, and take a photo down. Sees photos and bib numbers, never the entry list.'
 where slug = 'nn-photo-admin';

-- -------------------------------------------------------------------------------------------
-- photos.event: who sent the links, and how many first links may go in a day
-- -------------------------------------------------------------------------------------------
-- ⚠️ **The limit is a column so changing it is an update and no deploy.** 80 a day leaves room
-- under Resend's free tier, 100 a day for the whole account and shared with every race and
-- account email. Whether the club is on that tier is the treasurer's to say (brief §15); if it
-- pays, setting this to null lifts the limit. A new link somebody asked for is not counted:
-- those are few, rate-limited per bib, and wanted now.
alter table photos.event
  add column if not exists links_sent_by uuid references auth.users (id) on delete set null,
  add column if not exists daily_send_limit integer default 80;

alter table photos.event drop constraint if exists event_daily_send_limit_sane;
alter table photos.event
  add constraint event_daily_send_limit_sane
  check (daily_send_limit is null or daily_send_limit > 0);

-- -------------------------------------------------------------------------------------------
-- photos.api_secrets: the digests of the keys the Worker presents, never the keys
-- -------------------------------------------------------------------------------------------
-- `membership.api_secrets`' shape exactly.
create table if not exists photos.api_secrets (
  name text primary key check (name in ('entry', 'webhook')),
  key_sha256 text check (key_sha256 is null or key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

comment on table photos.api_secrets is
  'The digests of the keys the Worker presents, never the keys. RLS on, no policy, no grant: reachable only from the definer functions below.';

alter table photos.api_secrets enable row level security;

insert into photos.api_secrets (name) values ('entry'), ('webhook')
  on conflict (name) do nothing;

-- -------------------------------------------------------------------------------------------
-- photos.email_outbox: one link email the club owes
-- -------------------------------------------------------------------------------------------
-- ADR-021's mechanism, in this schema. ⚠️ **A bib and a reason, and no address**: the address
-- is read from `entries` when the row is claimed, so a place that changed hands is emailed to
-- whoever holds it now, and `photos` still holds no runner's address (brief §3).
--
-- `first_link` is the photo-admin's send, at most one per bib per running — the `dedupe_key`
-- is what makes pressing the button twice queue nothing new. `new_link` is somebody asking on
-- the lost-link form, which may happen more than once.
create table if not exists photos.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references photos.event (slug) on delete cascade,
  bib text not null,
  reason text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  provider_message_id text,
  -- **A status and a short code, never the provider's own words**, which can quote an address.
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  dedupe_key text not null unique,

  constraint email_outbox_bib_shaped check (bib ~ '^[0-9]{1,8}$'),
  constraint email_outbox_reason_shaped check (reason in ('first_link', 'new_link')),
  constraint email_outbox_status_shaped check (status in ('pending', 'sent', 'failed')),
  constraint email_outbox_attempts_sane check (attempts >= 0),
  constraint email_outbox_error_short check (last_error is null or length(last_error) <= 200),
  constraint email_outbox_sent_has_a_time check (status <> 'sent' or sent_at is not null)
);

comment on table photos.email_outbox is
  'One race photos link email the club owes. Holds a bib and a reason, never an address; the address is read from entries when the row is claimed.';

create index if not exists photos_outbox_pending
  on photos.email_outbox (reason, created_at)
  where status = 'pending';

alter table photos.email_outbox enable row level security;

-- -------------------------------------------------------------------------------------------
-- Helpers, granted to nobody
-- -------------------------------------------------------------------------------------------

-- ⚠️ Callable, this would be an oracle for the key. `membership.key_ok()` exactly.
create or replace function photos.key_ok(p_name text, p_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_digest text;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;

  select secret.key_sha256 into v_digest
    from photos.api_secrets as secret
   where secret.name = p_name;

  -- A null digest refuses everything, which is what ships.
  if v_digest is null then
    return false;
  end if;

  return v_digest = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
  );
end;
$$;

revoke all on function photos.key_ok(text, text) from public, anon, authenticated;

-- **The one place a bib becomes an email address.** Through the race's own roster, because
-- that is what holds the bib: `timing.effective_bib()` is the rule a crossing is matched by, so
-- a guide's own number (ADR-061) reaches the guide. Then to where entries keep the address,
-- for the same running, on a paid purchase only.
--
-- ⚠️ **Leg 2 is reachable only as a guide.** On a relay, leg 2 is a second runner whose
-- address is not the purchase's, and emailing the captain a link to somebody else's photos
-- would be the wrong person. Nightingale Nightmare is solo; a relay's leg 2 gets nothing.
-- ⚠️ **Two different addresses for one bib is nobody**, not the first of them.
create or replace function photos.recipient_for(p_event_slug text, p_bib text)
  returns text
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  with holders as (
    select r.leg, r.role, t.purchase_order_id
      from timing.events e
      join timing.teams t on t.event_id = e.id
      join timing.runners r on r.team_id = t.id
     where e.slug = p_event_slug
       and timing.effective_bib(
             case when r.leg = 1 then t.bib_leg1 else t.bib_leg2 end,
             t.team_number,
             r.leg,
             e.format
           ) = p_bib
  ),
  addresses as (
    select case
             when h.role = 'guide' then (
               select min(en.email::text)
                 from entries.entrants en
                where en.purchase_id = p.id
                  and en.role = 'guide'
             )
             when h.leg = 1 then p.purchaser_email::text
           end as address
      from holders h
      join entries.entry_purchases p on p.id::text = h.purchase_order_id
      join entries.events ev on ev.id = p.event_id
     where ev.slug = p_event_slug
       and p.status = 'paid'
  )
  select case when count(distinct lower(address)) = 1 then min(address) end
    from addresses
   where address is not null;
$$;

revoke all on function photos.recipient_for(text, text) from public, anon, authenticated;

-- How many photos a link for this bib shows as the runner's own. **The predicate is
-- `runner_photos()`'s `mine`**: a confirmed row for the bib, on a photo not taken down.
-- `photos-links.test.ts` holds the two to the same answer, because an email saying "we found
-- you in 3 photos" above a page showing two is the club contradicting itself.
create or replace function photos.own_photo_count(p_event_slug text, p_bib text)
  returns integer
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select count(*)::integer
    from photos.photo p
   where p.event_slug = p_event_slug
     and p.hidden_at is null
     and exists (
       select 1 from photos.photo_bib b
        where b.photo_id = p.id and b.confirmed and b.bib_text = p_bib
     );
$$;

revoke all on function photos.own_photo_count(text, text) from public, anon, authenticated;

-- Every bib that has a photo of its own in a running: who a first link is for.
create or replace function photos.bibs_with_photos(p_event_slug text)
  returns setof text
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select distinct b.bib_text
    from photos.photo_bib b
    join photos.photo p on p.id = b.photo_id
   where p.event_slug = p_event_slug
     and p.hidden_at is null
     and b.confirmed;
$$;

revoke all on function photos.bibs_with_photos(text) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- send_links: the photo-admin's button
-- -------------------------------------------------------------------------------------------
-- **Idempotent by `dedupe_key`**: a second press queues only a runner who has become reachable
-- since — an address that was missing and is not now — and never anybody twice. It never
-- returns an address, only how many.
create or replace function photos.send_links(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_event photos.event%rowtype;
  v_runners integer;
  v_reachable integer;
  v_queued integer;
begin
  if not identity.has_permission('nn.photo.send') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from photos.event where slug = p_event_slug for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- The pages answer nothing before publishing, so a link sent then would not work.
  if v_event.published_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_published');
  end if;

  with runners as (
    select bib from photos.bibs_with_photos(p_event_slug) as bib
  ),
  reachable as (
    select bib from runners where photos.recipient_for(p_event_slug, bib) is not null
  ),
  queued as (
    insert into photos.email_outbox (event_slug, bib, reason, dedupe_key)
    select p_event_slug, bib, 'first_link', 'first:' || p_event_slug || ':' || bib
      from reachable
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select (select count(*) from runners),
         (select count(*) from reachable),
         (select count(*) from queued)
    into v_runners, v_reachable, v_queued;

  -- **Set once, by the first press that queued anybody**, and never moved by a later one. It
  -- is what the results page's banner waits for (slice 4), so it must not be set by a press
  -- that reached nobody.
  if v_event.links_sent_at is null and v_queued > 0 then
    update photos.event
       set links_sent_at = now(), links_sent_by = auth.uid()
     where slug = p_event_slug;
  end if;

  return jsonb_build_object(
    'ok', true,
    'queued', v_queued,
    'runners', v_runners,
    'no_address', v_runners - v_reachable
  );
end;
$$;

comment on function photos.send_links(text) is
  'Queue the first link email for every runner with a photo of their own, once. Behind nn.photo.send, and only once the photos are published. Returns counts, never an address.';

revoke all on function photos.send_links(text) from public, anon;
grant execute on function photos.send_links(text) to authenticated;

-- -------------------------------------------------------------------------------------------
-- send_figures: what the photo-admin sees about the sending, per running
-- -------------------------------------------------------------------------------------------
create or replace function photos.send_figures()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
begin
  if not identity.has_permission('nn.photo.send') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  return jsonb_build_object(
    'ok', true,
    'events', coalesce(
      (select jsonb_agg(row_to_json(figures) order by figures.slug collate "C")
         from (
           select
             e.slug,
             e.links_sent_at,
             e.daily_send_limit,
             (select count(*) from photos.bibs_with_photos(e.slug)) as runners,
             (select count(*)
                from photos.bibs_with_photos(e.slug) as bib
               where photos.recipient_for(e.slug, bib) is null) as no_address,
             (select count(*)
                from photos.bibs_with_photos(e.slug) as bib
               where photos.recipient_for(e.slug, bib) is not null
                 and not exists (
                   select 1 from photos.email_outbox o
                    where o.dedupe_key = 'first:' || e.slug || ':' || bib
                 )) as to_send,
             count(o.id) filter (where o.status = 'pending') as waiting,
             count(o.id) filter (where o.status = 'sent') as sent,
             count(o.id) filter (where o.status = 'failed') as failed,
             count(o.id) filter (
               where o.status = 'sent'
                 and o.reason = 'first_link'
                 and o.sent_at > now() - interval '24 hours'
             ) as sent_last_day
           from photos.event e
           left join photos.email_outbox o on o.event_slug = e.slug
           group by e.slug, e.links_sent_at, e.daily_send_limit
         ) figures),
      '[]'::jsonb)
  );
end;
$$;

comment on function photos.send_figures() is
  'How the link emails are going, per running: counts only. Behind nn.photo.send.';

revoke all on function photos.send_figures() from public, anon;
grant execute on function photos.send_figures() to authenticated;

-- -------------------------------------------------------------------------------------------
-- request_link: the lost-link form
-- -------------------------------------------------------------------------------------------
-- ⚠️ **It answers `{ ok: true }` whatever it is given**, once the key is right, so it cannot be
-- used to learn who ran (brief §10). A matching address on a running whose links have gone, for
-- a bib with a photo of its own, queues a new link — at most three a day per bib, so it cannot
-- be used to flood somebody's inbox or the club's daily allowance. Cloudflare's C1 rule covers
-- the form's POST as well.
--
-- **Every bib is checked through `recipient_for()`** rather than by a second lookup from an
-- address to a bib: two lookups that mostly agree are how a link reaches the wrong person.
create or replace function photos.request_link(p_key text, p_event_slug text, p_email text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_email text;
  v_event photos.event%rowtype;
  v_bib text;
  v_recent integer;
begin
  if not photos.key_ok('entry', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if length(v_email) = 0 or length(v_email) > 254 or position('@' in v_email) < 2 then
    return jsonb_build_object('ok', true);
  end if;

  select * into v_event from photos.event where slug = p_event_slug;
  if not found or v_event.published_at is null or v_event.links_sent_at is null then
    return jsonb_build_object('ok', true);
  end if;

  for v_bib in select bib from photos.bibs_with_photos(p_event_slug) as bib loop
    if lower(coalesce(photos.recipient_for(p_event_slug, v_bib), '')) <> v_email then
      continue;
    end if;

    select count(*) into v_recent
      from photos.email_outbox o
     where o.event_slug = p_event_slug
       and o.bib = v_bib
       and o.reason = 'new_link'
       and o.created_at > now() - interval '24 hours';

    if v_recent >= 3 then
      continue;
    end if;

    insert into photos.email_outbox (event_slug, bib, reason, dedupe_key)
    values (p_event_slug, v_bib, 'new_link', 'new:' || gen_random_uuid()::text);
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function photos.request_link(text, text, text) is
  'The lost-link form. Takes the entry key. Answers the same whatever it is given; a matching address queues a new link, at most three a day per bib.';

revoke all on function photos.request_link(text, text, text) from public, authenticated;
grant execute on function photos.request_link(text, text, text) to anon;

-- -------------------------------------------------------------------------------------------
-- claim_outbox_batch: what the drain is to send now
-- -------------------------------------------------------------------------------------------
-- **New links first**, oldest first: somebody is waiting for one. **Then first links, within
-- each running's daily limit**, counted over a rolling 24 hours so no time zone is involved —
-- sent, plus any claimed in the last ten minutes and not yet recorded, so two drains cannot
-- both spend the same allowance. The advisory lock makes the counting and the claiming one
-- step.
--
-- A row whose bib no longer has an address, or no photo of its own, is marked `failed` with a
-- short code instead of being sent. Everything else is handed over with what its email says.
create or replace function photos.claim_outbox_batch(p_key text, p_limit integer default 10)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_ids uuid[] := '{}';
  v_more uuid[];
  v_event record;
  v_used integer;
  v_allowed integer;
  v_room integer;
  v_row photos.email_outbox%rowtype;
  v_recipient text;
  v_count integer;
  v_messages jsonb := '[]'::jsonb;
begin
  if not photos.key_ok('webhook', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    p_limit := 10;
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtext('photos.claim_outbox_batch'));

  select coalesce(array_agg(pending.id), '{}') into v_ids
    from (
      select o.id
        from photos.email_outbox o
       where o.status = 'pending' and o.reason = 'new_link'
       order by o.created_at, o.id
       limit p_limit
       for update skip locked
    ) pending;

  for v_event in
    select e.slug, e.daily_send_limit from photos.event e order by e.slug collate "C"
  loop
    v_room := p_limit - cardinality(v_ids);
    exit when v_room <= 0;

    if v_event.daily_send_limit is null then
      v_allowed := v_room;
    else
      select count(*) into v_used
        from photos.email_outbox o
       where o.event_slug = v_event.slug
         and o.reason = 'first_link'
         and (
           (o.status = 'sent' and o.sent_at > now() - interval '24 hours')
           or (o.status = 'pending' and o.last_attempt_at > now() - interval '10 minutes')
         );

      v_allowed := least(v_room, greatest(v_event.daily_send_limit - v_used, 0));
    end if;

    continue when v_allowed <= 0;

    select coalesce(array_agg(pending.id), '{}') into v_more
      from (
        select o.id
          from photos.email_outbox o
         where o.status = 'pending'
           and o.reason = 'first_link'
           and o.event_slug = v_event.slug
         order by o.created_at, o.id
         limit v_allowed
         for update skip locked
      ) pending;

    v_ids := v_ids || v_more;
  end loop;

  -- Handed over in the order they were claimed, new links first, so a drain stopped by a
  -- rate limit part-way through has sent the ones somebody is waiting for.
  for v_row in
    select * from photos.email_outbox o
     where o.id = any (v_ids)
     order by (o.reason = 'first_link'), o.created_at, o.id
  loop
    v_recipient := photos.recipient_for(v_row.event_slug, v_row.bib);
    v_count := photos.own_photo_count(v_row.event_slug, v_row.bib);

    if v_recipient is null or v_count = 0 then
      update photos.email_outbox
         set status = 'failed',
             attempts = attempts + 1,
             last_attempt_at = now(),
             last_error = case when v_recipient is null then 'no_address' else 'no_photos' end
       where id = v_row.id;
      continue;
    end if;

    update photos.email_outbox
       set attempts = attempts + 1, last_attempt_at = now()
     where id = v_row.id;

    v_messages := v_messages || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'reason', v_row.reason,
      'event_slug', v_row.event_slug,
      'event_name', (select t.name from timing.events t where t.slug = v_row.event_slug),
      'bib', v_row.bib,
      'recipient', v_recipient,
      -- The race's own reply address, as the entry emails use it, so a takedown request by
      -- reply reaches the race mailbox.
      'reply_to', (select ev.from_address::text from entries.events ev where ev.slug = v_row.event_slug),
      'photo_count', v_count,
      'attempts', v_row.attempts + 1
    ));
  end loop;

  return jsonb_build_object('ok', true, 'messages', v_messages);
end;
$$;

comment on function photos.claim_outbox_batch(text, integer) is
  'Claims the link emails to send now: new links first, then first links within each running''s daily limit. Takes the webhook key: it returns email addresses.';

revoke all on function photos.claim_outbox_batch(text, integer) from public, authenticated;
grant execute on function photos.claim_outbox_batch(text, integer) to anon;

-- -------------------------------------------------------------------------------------------
-- record_send_result: what happened, and the link becoming the runner's
-- -------------------------------------------------------------------------------------------
-- ⚠️ **On a sent email the hash it carries becomes the bib's one active link**, and the one
-- before it is marked replaced — after the email has gone, never before, so a send that fails
-- never takes a working link away. Recording the same send twice changes nothing. The lock is
-- per bib, because a first link and a new link can be recorded at once and only one may be
-- active.
--
-- A rate-limit rejection gives the attempt back, as in the other three outboxes: the provider
-- never looked at the message.
create or replace function photos.record_send_result(
  p_key text,
  p_id uuid,
  p_sent boolean,
  p_token_hash text default null,
  p_provider_message_id text default null,
  p_error text default null,
  p_rate_limited boolean default false
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_row photos.email_outbox%rowtype;
  v_status text;
begin
  if not photos.key_ok('webhook', p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select * into v_row from photos.email_outbox where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_message');
  end if;

  if p_sent then
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('ok', false, 'reason', 'bad_hash');
    end if;

    if v_row.status = 'sent' then
      return jsonb_build_object('ok', true, 'status', 'sent', 'already', true);
    end if;

    perform pg_advisory_xact_lock(
      pg_catalog.hashtext('photos.link:' || v_row.event_slug || ':' || v_row.bib)
    );

    if not exists (select 1 from photos.link where token_hash = p_token_hash) then
      update photos.link
         set replaced_at = now()
       where event_slug = v_row.event_slug
         and bib = v_row.bib
         and replaced_at is null;

      insert into photos.link (token_hash, event_slug, bib)
      values (p_token_hash, v_row.event_slug, v_row.bib);
    end if;

    update photos.email_outbox
       set status = 'sent',
           sent_at = now(),
           provider_message_id = p_provider_message_id,
           last_error = null
     where id = p_id;

    return jsonb_build_object('ok', true, 'status', 'sent', 'already', false);
  end if;

  if p_rate_limited then
    update photos.email_outbox
       set attempts = greatest(v_row.attempts - 1, 0),
           last_error = pg_catalog.left(coalesce(p_error, 'rate limited'), 200)
     where id = p_id;

    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;

  -- Three attempts, then it stops and waits for a person, as the other outboxes do.
  v_status := case when v_row.attempts >= 3 then 'failed' else 'pending' end;

  update photos.email_outbox
     set status = v_status,
         last_error = pg_catalog.left(coalesce(p_error, 'unknown error'), 200)
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

comment on function photos.record_send_result(text, uuid, boolean, text, text, text, boolean) is
  'Records one delivery attempt. On a sent email, the hash it carries becomes the bib''s one active link and the previous link is replaced. A rate-limit rejection returns the attempt.';

revoke all on function photos.record_send_result(text, uuid, boolean, text, text, text, boolean) from public, authenticated;
grant execute on function photos.record_send_result(text, uuid, boolean, text, text, text, boolean) to anon;
