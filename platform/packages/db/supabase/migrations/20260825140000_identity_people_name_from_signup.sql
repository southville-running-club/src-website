-- #61 fills in the profile. Before it can, the name sign-up already collects has to reach
-- `identity.people` — today it lands only in `auth.users.raw_user_meta_data`, because
-- `identity.handle_new_user()` has only ever inserted the bare `id` (see #51's migration
-- header: "nothing writes to them until #61"). Without this, #61's page would show every
-- existing account's name as blank, including the super-admin's.
--
-- Two changes, both expand-only:
--
-- 1. `identity.handle_new_user()` also copies `raw_user_meta_data->>'name'` on signup.
-- 2. A one-off backfill for the accounts the old trigger already created.
--
-- Gender, date of birth and address are untouched — nothing has ever written to them, and
-- #61's own page is what will.

create or replace function identity.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reserved_role text;
begin
  insert into identity.people (id, name) values (new.id, new.raw_user_meta_data->>'name');

  insert into identity.role_grants (person_id, role, granted_by)
  values (new.id, 'member', null);

  select reserved.role into v_reserved_role
    from identity.reserved_grants as reserved
   where reserved.email = new.email::extensions.citext;

  if v_reserved_role is not null then
    insert into identity.role_grants (person_id, role, granted_by)
    values (new.id, v_reserved_role, null);
  end if;

  return new;
end;
$$;

comment on function identity.handle_new_user() is
  'Creates the profile row and grants member on every signup, then applies any matching identity.reserved_grants row. The whole bootstrap mechanism for the super-admin: no seeded password, no manual SQL. Copies the name sign-up collected as of #61 — everything else on the profile stays null until a person fills it in themselves.';

revoke all on function identity.handle_new_user() from public;

-- The backfill. Idempotent by its own `where` clause, so re-running this migration (or a
-- future `db reset` that replays it) touches only rows that are still blank.
update identity.people as person
   set name = users.raw_user_meta_data->>'name'
  from auth.users as users
 where person.id = users.id
   and person.name is null
   and users.raw_user_meta_data->>'name' is not null;
