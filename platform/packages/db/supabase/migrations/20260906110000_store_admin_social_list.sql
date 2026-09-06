-- `/admin/events/` becomes a list of socials, and the tickets move underneath the one they
-- are for.
--
-- **The first shape was flat and it was wrong the moment there is a second social.** One
-- table of every ticket ever sold, across every occasion, ordered by date — which reads
-- fine with one party in the database and becomes unusable with three, because the question
-- a volunteer actually has is never "who has bought anything" but "who is coming to *this*".
--
-- So this adds the index: every social, with what has been sold against it. The ticket list
-- keeps the `p_social_slug` argument it already had — it was written to take one from the
-- first day and nothing was passing it.
--
-- =========================================================================================
-- Why a function rather than aggregating what admin_ticket_list() already returns
-- =========================================================================================
-- The Worker could group the ticket rows by `social_slug` and count them, and that answer is
-- wrong in the one case that matters: **a social with no tickets sold would not appear at
-- all**. The Christmas party is in exactly that state today, and a page that vanishes an
-- occasion the moment it has no sales is a page that is empty precisely when somebody is
-- checking whether sales have started.
--
-- It also pulls every ticket row across every social to render a summary that needs none of
-- them, which is a page that gets slower for a reason nobody can see.
--
-- **This is granted to `authenticated`, not `anon`**, so the seven-function anon list is
-- unchanged and this is not the stop-and-ask an eighth anon-callable function would be. It
-- is behind the same `store.ticket.read` the detail is behind: the counts are derived from
-- the rows that permission already opens, so a second permission would be guarding a fact
-- rather than a disclosure.
create or replace function store.admin_social_list()
  returns table (
    slug text,
    display_name text,
    social_date date,
    venue text,
    sales_open_at timestamptz,
    sales_close_at timestamptz,
    capacity int,
    price_pence int,
    paid_tickets int,
    paid_orders int,
    taken_pence int,
    held_tickets int
  )
  language plpgsql
  stable
  security definer
  set search_path = store, pg_catalog
as $$
begin
  if not identity.has_permission('store.ticket.read') then
    -- Nothing rather than an error, for the reason `admin_ticket_list()` gives: the page
    -- above answers 404 to anybody who may not be there.
    return;
  end if;

  return query
  select
    social.slug,
    social.display_name,
    social.social_date,
    social.venue,
    social.sales_open_at,
    social.sales_close_at,
    social.capacity,
    -- **The cheapest active ticket type, which is the figure the page calls "Price".** Null
    -- when no price has been confirmed, which is a state the index has to render rather than
    -- hide — it is the difference between "nothing sold yet" and "nothing can be sold yet".
    (
      select min(kind.price_pence)
        from store.ticket_types as kind
       where kind.social_id = social.id and kind.active
    ),
    -- **Counted here rather than in the Worker**, so a social with no purchases still gets a
    -- row of zeroes instead of disappearing. `coalesce` on each, because a `left join` with
    -- no matching rows sums to null and a page showing "null tickets" is worse than one
    -- showing none.
    coalesce(sum(purchase.quantity) filter (where purchase.status = 'paid'), 0)::int,
    coalesce(count(*) filter (where purchase.status = 'paid'), 0)::int,
    coalesce(sum(purchase.amount_pence) filter (where purchase.status = 'paid'), 0)::int,
    coalesce(
      sum(purchase.quantity) filter (
        where purchase.status = 'pending' and purchase.hold_expires_at > pg_catalog.now()
      ),
      0
    )::int
  from store.socials as social
  left join store.ticket_purchases as purchase on purchase.social_id = social.id
  where social.active
  group by social.id, social.slug, social.display_name, social.social_date, social.venue,
           social.sales_open_at, social.sales_close_at, social.capacity
  -- Soonest first, and an unconfirmed date last rather than first: a social with no date is
  -- the one furthest from happening, not the most urgent.
  order by social.social_date asc nulls last, social.display_name asc;
end;
$$;

comment on function store.admin_social_list() is
  'Every active social with what has been sold against it, behind store.ticket.read. A social with no purchases gets a row of zeroes rather than no row — which is the state every social starts in.';

revoke all on function store.admin_social_list() from public, anon;
grant execute on function store.admin_social_list() to authenticated;
