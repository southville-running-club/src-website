-- ===========================================================================================
-- identity.export_me() and identity.delete_me() — #62
-- ===========================================================================================
-- [C10](docs/foundations/requirements.md#c10--hold-personal-data-lawfully) is done when
-- personal data is "collected minimally, retained to a written policy, **deletable on
-- request**". Since #61 the club holds a standing record of a named person — name, gender,
-- date of birth, address — and until this migration the only way to act on a request about it
-- was a volunteer opening the Supabase SQL editor. That is a favour, not a rights process,
-- and it is the sort of favour that gets slower exactly when somebody is annoyed enough to
-- ask formally.
--
-- **#62's issue body says #51 created `delete_me()`. It did not.** #51's header is explicit
-- that "a delete is #62's function, later, once there is a reason to think hard about what
-- deleting an account has to also do to their entries". This is that migration, and the
-- thinking is below.
--
-- **Both functions are granted to `authenticated` and to nobody else.** `anon` holds nothing
-- anywhere in this schema and that does not change here — a function that deletes an account
-- is the last one that should be callable by a caller who has not proved they own it.
--
-- **Neither takes an argument that names a person.** `delete_me()` takes no arguments at all:
-- there is nothing to pass that could be wrong, and no way to name somebody else. `auth.uid()`
-- is the only input, and it comes from a verified JWT rather than from the caller's keyboard.

-- -----------------------------------------------------------------------------------------
-- identity.export_me() — everything the club holds about the caller, as one jsonb document
-- -----------------------------------------------------------------------------------------
-- **A function rather than four `select`s from the Worker**, for one reason: `role_grants`
-- and `audit` have no policy and no grant to anybody (#51 deliberately, to keep `has_role()`
-- from recursing). A person cannot read their own roles through PostgREST at all, so an
-- export assembled client-side would silently omit them and nobody would notice.
--
-- **`granted_by` is not exported.** It holds another person's id, and who granted somebody a
-- role is the club's record rather than theirs. The grant itself is theirs and is included.
--
-- **`audit` rows where they are the *subject* are included; rows where they are the *actor*
-- are not.** What was done to somebody's account is about them. What they did to other
-- people's accounts while holding `super-admin` is the club's audit trail, and #62 is explicit
-- that an audit trail somebody can read out by leaving is barely better than one they can
-- erase by leaving.
create or replace function identity.export_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := auth.uid();
  v_email text;
  v_profile jsonb;
  v_roles jsonb;
  v_audit jsonb;
begin
  if v_person is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select u.email into v_email
    from auth.users as u
   where u.id = v_person;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  -- Every column of identity.people, named one at a time on purpose. A column added later
  -- and not added here fails entries-free `identity.test.ts`'s column-coverage assertion,
  -- which is the whole point — #62 asks that a new column fail a test rather than quietly
  -- escape the export.
  select jsonb_build_object(
           'name', p.name,
           'gender', p.gender,
           'date_of_birth', p.date_of_birth,
           'address', p.address,
           'created_at', p.created_at,
           'updated_at', p.updated_at
         )
    into v_profile
    from identity.people as p
   where p.id = v_person;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'role', g.role,
               'granted_at', g.granted_at,
               'revoked_at', g.revoked_at
             )
             order by g.granted_at
           ),
           '[]'::jsonb
         )
    into v_roles
    from identity.role_grants as g
   where g.person_id = v_person;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail)
             order by a.at
           ),
           '[]'::jsonb
         )
    into v_audit
    from identity.audit as a
   where a.subject = v_person;

  return jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object('id', v_person, 'email', v_email),
    'profile', coalesce(v_profile, '{}'::jsonb),
    'roles', v_roles,
    'about_this_account', v_audit
  );
end;
$$;

comment on function identity.export_me() is
  'Everything the club holds about the calling account, as one jsonb document. Includes role grants and audit rows the caller cannot read directly, because those tables have no policy. Excludes granted_by and audit rows where the caller was the actor — see the migration header.';

revoke execute on function identity.export_me() from public;
grant execute on function identity.export_me() to authenticated;

-- -----------------------------------------------------------------------------------------
-- identity.delete_me() — the account and the profile, and deliberately nothing else
-- -----------------------------------------------------------------------------------------
-- **It deletes the `auth.users` row and lets the foreign keys do the rest.** `identity.people`
-- is `on delete cascade` from `auth.users`, and `role_grants` is `on delete cascade` from
-- `people`, so one delete takes the account, the profile and the roles. GoTrue's own refresh
-- tokens go with it, which is what ends every session immediately rather than leaving one
-- alive on a device somebody no longer has.
--
-- **What survives, and every one of these is deliberate:**
--
--   * `entries.entrants` — a paid race entry is a financial record with its own retention, and
--     it belongs to a transaction as much as to a person. It is **not** keyed on
--     `identity.people` and this migration must not make it so.
--   * `entries.admin_audit` and `identity.audit` — neither has a foreign key to `people`, on
--     purpose. After a deletion they hold a uuid that resolves to nobody, which is the correct
--     outcome: an audit trail somebody can erase by leaving is not an audit trail.
--   * Medical notes — already deleted a month after the race by the cron. Nothing here
--     changes that, and nothing here should.
--   * `intake.nn_interest` — its own consent and its own record.
--
-- `/account/data/` states all of this **before** the button. Somebody deleting an account in
-- the belief that their race entry disappears has been misled, and they find out at the start
-- line.
--
-- **The last super-admin cannot delete themselves.** `identity.revoke_role()` already refuses
-- to remove the last active super-admin grant, for the reason principles.md gives: no system
-- is reachable by only one person. Deleting the account is the same hole by a different door,
-- so it is refused with the same reason, and the person is told to hand the role over first.
create or replace function identity.delete_me()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_person uuid := auth.uid();
  v_is_last_super_admin boolean;
begin
  if v_person is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  if not exists (select 1 from identity.people as p where p.id = v_person) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  select exists (
           select 1
             from identity.role_grants as mine
            where mine.person_id = v_person
              and mine.role = 'super-admin'
              and mine.revoked_at is null
         )
         and not exists (
           select 1
             from identity.role_grants as others
            where others.role = 'super-admin'
              and others.revoked_at is null
              and others.person_id <> v_person
         )
    into v_is_last_super_admin;

  if v_is_last_super_admin then
    return jsonb_build_object('ok', false, 'reason', 'last_super_admin');
  end if;

  delete from auth.users as u where u.id = v_person;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function identity.delete_me() is
  'Deletes the calling account: the auth.users row, and by cascade the identity.people row and every role grant. Takes no arguments, so there is no way to name somebody else. Refuses if the caller is the last active super-admin. Race entries and both audit trails deliberately survive — see the migration header.';

revoke execute on function identity.delete_me() from public;
grant execute on function identity.delete_me() to authenticated;
