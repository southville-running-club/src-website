-- What the membership page may read, and the one function this schema grants anybody.
--
-- =========================================================================================
-- ⚠️ This is a new anon grant, which is a decision rather than a detail
-- =========================================================================================
-- `CLAUDE.md` makes granting the anon role a function a stop-and-ask, and the granted lists
-- are asserted **by name** in `packages/db/tests/entries.test.ts` and `store.test.ts` so that
-- adding one is something somebody does in a diff rather than as a side effect. This schema
-- gets its own list in `packages/db/tests/membership.test.ts`, and today it has one entry.
--
-- The grant is safe for the same reason `store.social_state()`'s is: it returns **published
-- prices and a minimum age**. There is no row here that is not already printed on the page
-- that calls it, and the anon role still holds no privilege on any table in this schema — so
-- the published anon key in page source can ask what membership costs and nothing else.
--
-- **A second function is a decision somebody takes in a diff.** The test names this one.
--
-- =========================================================================================
-- Why the page calls a function at all rather than reading the table
-- =========================================================================================
-- Because the anon role must never hold `select` on a table. Row-level security is the access
-- control here — there is no API tier between the browser and Postgres — and a definer
-- function with a pinned `search_path` is how a schema exposes exactly one shape of answer
-- without exposing the table it came from. Every other public read in this platform is built
-- the same way.
--
-- =========================================================================================
-- It returns inactive options as nothing, not as a flag
-- =========================================================================================
-- ⚠️ **An option the club has withdrawn does not come back at all.** The alternative — return
-- it with `active = false` and let the page filter — puts the decision in the caller, and
-- there are two callers already (the page and the form). One of them will eventually forget.
create or replace function membership.membership_state()
  returns table (
    code text,
    display_name text,
    price_pence integer,
    ea_fee_pence integer,
    summary text,
    sort_order integer,
    minimum_age integer
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
    s.minimum_age
  from membership.membership_types t
  cross join membership.settings s
  where t.active
  order by t.sort_order, t.code;
$$;

comment on function membership.membership_state() is
  'What club membership costs and the minimum age to join. Published facts only — the anon role holds nothing on any table in this schema.';

-- ⚠️ **Revoked from `public` first.** A function is executable by `public` by default, so
-- granting `anon` explicitly without this leaves the grant list in the test describing less
-- than reality. Every function in `entries` and `store` is written this way for that reason.
revoke all on function membership.membership_state() from public;

grant execute on function membership.membership_state() to anon, authenticated;
