-- A social is not visible until somebody says so.
--
-- **The club asked to merge this without members seeing the Christmas party yet**, and the
-- honest answer had to be a column rather than a deploy: everything else about this occasion
-- — the date, the venue, the price — is an `update` a volunteer runs, and "is anybody allowed
-- to see it" is the same kind of fact.
--
-- =========================================================================================
-- Default false, which is the whole point
-- =========================================================================================
-- **A social is unpublished until somebody publishes it.** A new row inserted by a migration
-- is invisible on the day it lands, so building next year's party in advance is safe by
-- default rather than safe if somebody remembers to hide it — the same shape as
-- `sales_open_at` being null, and for the same reason: the state that costs something has to
-- be the one you opt into.
--
-- `christmas-party-2026` therefore goes out hidden, and stays hidden until the club runs the
-- `update` in the runbook.
--
-- =========================================================================================
-- It is a fourth lock, not a replacement for the other three
-- =========================================================================================
-- Nothing about selling changes here. `sales_open_at` is still null, there is still no entry
-- key installed, and the price is still separately required — this only decides whether the
-- page can be reached at all. A published social with no sales window is exactly the state
-- the party will be in between the club announcing it and tickets going on sale, which is a
-- state the club actually wants.
alter table store.socials
  add column if not exists published boolean not null default false;

comment on column store.socials.published is
  'Whether the public pages will show this social at all. False by default: a social is invisible until somebody publishes it, so a row added in advance cannot leak. Separate from sales_open_at, which decides whether tickets can be bought.';

-- -----------------------------------------------------------------------------------------
-- social_state() returns nothing at all for an unpublished social
-- -----------------------------------------------------------------------------------------
-- **Nothing, rather than the row with a flag on it.** Returning the row and letting the page
-- decide would leave the date, the venue and the price readable by anybody with the published
-- anon key — which is precisely what "not visible until I advise" rules out. An unpublished
-- social is indistinguishable, through this function, from one that does not exist.
--
-- ⚠️ **The Worker must not treat that as an outage**, and this is the sharp edge of the
-- change: an empty answer now means two different things — "no such social" and "not yet
-- published" — and `fetchSocialState` distinguishes both of those from "the database could
-- not be reached". A page that 404s on an unreachable database would delete itself during an
-- outage, which is the failure this platform spends most of its effort avoiding.
create or replace function store.social_state(p_slug text)
  returns table (
    slug text,
    display_name text,
    social_date date,
    start_time time,
    end_time time,
    venue text,
    minimum_age int,
    sales_state text,
    sales_open_at timestamptz,
    sales_close_at timestamptz,
    max_tickets_per_purchase int,
    required_consents text[],
    consent_version text,
    capacity int,
    tickets_remaining int,
    ticket_types jsonb
  )
  language plpgsql
  stable
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_social store.socials%rowtype;
  v_state text;
  v_sold int;
  v_remaining int;
begin
  select * into v_social
    from store.socials as social
   where social.slug = p_slug
     and social.active
     and social.published;

  if not found then
    return;
  end if;

  if v_social.sales_open_at is null then
    v_state := 'pre_open';
  elsif pg_catalog.now() < v_social.sales_open_at then
    v_state := 'pre_open';
  elsif v_social.sales_close_at is not null and pg_catalog.now() >= v_social.sales_close_at then
    v_state := 'closed';
  else
    v_state := 'open';
  end if;

  select coalesce(sum(purchase.quantity), 0) into v_sold
    from store.ticket_purchases as purchase
   where purchase.social_id = v_social.id
     and (
       purchase.status = 'paid'
       or (purchase.status = 'pending' and purchase.hold_expires_at > pg_catalog.now())
     );

  if v_social.capacity is null then
    v_remaining := null;
  else
    v_remaining := greatest(v_social.capacity - v_sold, 0);
  end if;

  return query
  select
    v_social.slug, v_social.display_name, v_social.social_date, v_social.start_time,
    v_social.end_time, v_social.venue, v_social.minimum_age, v_state,
    v_social.sales_open_at, v_social.sales_close_at, v_social.max_tickets_per_purchase,
    v_social.required_consents, v_social.consent_version, v_social.capacity, v_remaining,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('code', kind.code, 'label', kind.label,
                                    'price_pence', kind.price_pence)
                 order by kind.price_pence, kind.code
               )
          from store.ticket_types as kind
         where kind.social_id = v_social.id
           and kind.active
           and (kind.valid_from is null or kind.valid_from <= pg_catalog.now())
           and (kind.valid_to is null or kind.valid_to > pg_catalog.now())
      ),
      '[]'::jsonb
    );
end;
$$;

comment on function store.social_state(text) is
  'The public facts about one published social. Answers nothing for one that is unpublished, inactive or absent — the three are deliberately indistinguishable to an anonymous caller.';

-- -----------------------------------------------------------------------------------------
-- create_pending_purchase() refuses an unpublished social too
-- -----------------------------------------------------------------------------------------
-- **Belt to the page's braces.** The form cannot be reached while a social is unpublished, so
-- this should be unreachable — which is exactly why it is here. `no_such_social` rather than a
-- reason of its own, so a caller probing with the published anon key cannot tell an
-- unpublished occasion from one that was never created.
create or replace function store.create_pending_purchase(
  p_key text,
  p_social_slug text,
  p_ticket_code text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_quantity int,
  p_consents jsonb default '{}'::jsonb,
  p_person_id uuid default null,
  p_preview boolean default false
)
  returns table (
    ok boolean, reason text, purchase_id uuid, amount_pence int,
    quantity int, ticket_label text, hold_expires_at timestamptz
  )
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_social store.socials%rowtype;
  v_type store.ticket_types%rowtype;
  v_sold int;
  v_amount int;
  v_expires timestamptz;
  v_id uuid;
  v_missing text[];
  v_consent text;
begin
  if not store.key_ok('entry', p_key) then
    return query select false, 'bad_key', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select * into v_social
    from store.socials as social
   where social.slug = p_social_slug
     and social.active
     and social.published;

  if not found then
    return query select false, 'no_such_social', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_social.id::text, 0));

  if v_social.sales_open_at is null or pg_catalog.now() < v_social.sales_open_at then
    return query select false, 'pre_open', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  if v_social.sales_close_at is not null and pg_catalog.now() >= v_social.sales_close_at then
    return query select false, 'closed', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > v_social.max_tickets_per_purchase then
    return query select false, 'invalid_quantity', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  v_missing := array[]::text[];

  foreach v_consent in array v_social.required_consents loop
    if coalesce((p_consents ->> v_consent)::boolean, false) is not true then
      v_missing := v_missing || v_consent;
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    return query select false, 'consents_missing', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select * into v_type
    from store.ticket_types as kind
   where kind.social_id = v_social.id
     and kind.code = p_ticket_code
     and kind.active
     and (kind.valid_from is null or kind.valid_from <= pg_catalog.now())
     and (kind.valid_to is null or kind.valid_to > pg_catalog.now());

  if not found then
    return query select false, 'invalid_ticket_type', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select coalesce(sum(purchase.quantity), 0) into v_sold
    from store.ticket_purchases as purchase
   where purchase.social_id = v_social.id
     and (
       purchase.status = 'paid'
       or (purchase.status = 'pending' and purchase.hold_expires_at > pg_catalog.now())
     );

  if v_social.capacity is not null and v_sold + p_quantity > v_social.capacity then
    return query select false, 'sold_out', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  v_amount := v_type.price_pence * p_quantity;

  if v_amount <= 0 then
    return query select false, 'free_place', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  if p_preview then
    return query select true, null::text, null::uuid, v_amount, p_quantity, v_type.label, null::timestamptz;
    return;
  end if;

  v_expires := pg_catalog.now() + interval '31 minutes';

  insert into store.ticket_purchases (
    social_id, ticket_type_id, status, amount_pence, quantity,
    purchaser_name, purchaser_email, person_id,
    consents, consents_version, hold_expires_at
  )
  values (
    v_social.id, v_type.id, 'pending', v_amount, p_quantity,
    trim(p_purchaser_name), p_purchaser_email, p_person_id,
    coalesce(p_consents, '{}'::jsonb), v_social.consent_version, v_expires
  )
  returning id into v_id;

  return query select true, null::text, v_id, v_amount, p_quantity, v_type.label, v_expires;
end;
$$;

grant execute on function store.create_pending_purchase(text, text, text, text, text, int, jsonb, uuid, boolean)
  to anon, authenticated;

-- -----------------------------------------------------------------------------------------
-- What this migration does NOT re-create, and why
-- -----------------------------------------------------------------------------------------
-- **`admin_social_list()` reports `published` and is not touched here.** It was written one
-- migration ago, in this same unmerged branch, and has never been applied anywhere but a
-- laptop — so the column went into that function's own definition rather than arriving as a
-- correction to it.
--
-- ⚠️ **That was not a preference: `create or replace` cannot change a function's return
-- type** (`42P13`, "Row type defined by OUT parameters is different"), so adding a column to
-- its result would have meant a `drop function` and a re-create. Dropping a function a
-- deployed Worker calls is what expand-migrate-contract forbids — it happens to be safe here
-- because nothing is deployed, and relying on that when the alternative is a one-line edit to
-- an unapplied file is how a habit forms that is not safe next time.
--
-- **It deliberately does not filter on `published` either.** A director has to be able to see
-- what is hidden; that is the point of the column.
