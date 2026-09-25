-- ===========================================================================================
-- membership_state() carries the England Athletics cut-off
-- ===========================================================================================
--
-- The application form validates against `MembershipRules` — the membership codes on offer,
-- the minimum age, and the England Athletics registration year's cut-off. The first two came
-- from `membership_state()` already; the third did not, and the only other way for a Worker to
-- know it is to write **1 April** into a constant.
--
-- ⚠️ **A date written into a Worker is wrong in April of whichever year it moves.** England
-- Athletics sets its own registration year, `membership.settings` already holds the two
-- columns, and the alternative is a deploy on a date the club does not control. The same
-- argument the fees themselves are read for.
--
-- ## ⚠️ Why this drops and recreates rather than replacing
--
-- `create or replace function` **cannot change a return type**, and this adds two columns to
-- the returned table. Postgres refuses with *"cannot change return type of existing function"*,
-- which reads as a permissions problem and is not one. A drop is safe here because there is
-- exactly one `membership_state`, so no overload can be left behind for PostgREST to call
-- ambiguously — the trap `entries` hit when an extra defaulted parameter created a second
-- signature and every call naming the original eight was refused.
--
-- **It is a deploy-order risk and a small one**: between the drop and the create, a page asking
-- for prices paints nothing and says the price is confirmed on the club's own form. That is the
-- state the page already ships in, and it lasts one transaction.
-- ===========================================================================================

drop function if exists membership.membership_state();

create function membership.membership_state()
  returns table (
    code text,
    display_name text,
    price_pence integer,
    ea_fee_pence integer,
    summary text,
    sort_order integer,
    minimum_age integer,
    ea_cutoff_month integer,
    ea_cutoff_day integer
  )
  language sql
  stable
  security definer
  set search_path = membership, pg_catalog
as $$
  select
    t.code,
    t.display_name,
    t.price_pence,
    t.ea_fee_pence,
    t.summary,
    t.sort_order,
    s.minimum_age,
    s.ea_cutoff_month,
    s.ea_cutoff_day
  from membership.membership_types t
  cross join membership.settings s
  where t.active
  order by t.sort_order, t.code;
$$;

comment on function membership.membership_state() is
  'What the club charges for membership, the minimum age to join, and the England Athletics registration cut-off. Every row it returns is already printed on the page that calls it, which is what makes the anon grant safe.';

revoke all on function membership.membership_state() from public;
grant execute on function membership.membership_state() to anon, authenticated;
