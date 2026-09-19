-- ===========================================================================================
-- Granting a role asks for the permission, not for the role — ADR-047
-- ===========================================================================================
-- `identity.grant_role()` and `identity.revoke_role()` have asked `has_role('super-admin')`
-- since the schema was created on 24 August 2026. Every other gate on this surface moved to
-- `identity.has_permission()` in #107, under ADR-017 — and `20260826190000`'s own header says
-- so in as many words about the one it moved:
--
--     identity.list_people() was still asking a role, and that is a defect ADR-017 missed.
--     Every other gate on this surface moved to `identity.has_permission()` in #107. This one
--     did not — it still reads `identity.has_role('super-admin')`, which is the fifth string
--     comparison ADR-017 counted and then left behind. Moving it is not a favour to the new
--     role; it is the last of the migration ADR-017 described.
--
-- **It was not the last.** That migration moved `list_people()` and left these two, and the
-- gap has been live ever since.
--
-- ## What made it visible, and why this is not a new decision
--
-- On 6 September 2026 the club created `src-admin`, its master role for directors, and gave it
-- `identity.role.grant` along with seventeen other permissions. Its published description —
-- the one `/admin/people/`'s own legend renders — ends *"and granting roles"*.
--
-- **None of that worked.** The page rendered the controls, because the page asks the
-- permission; every press was refused by these two functions, because they ask the role. A
-- director pressing Grant was told *"You are no longer a super-admin, so that change was not
-- made."* Nothing looks wrong to a `super-admin`, which is why nobody hit it for a fortnight.
--
-- So the club has already decided that directors may grant roles. This migration is the
-- database catching up with a decision taken in `20260906100000`, not a new one.
--
-- ## It grants no capability that was not already held
--
-- `super-admin` carries exactly **two** permissions — `identity.person.read` and
-- `identity.role.grant` — and `src-admin` carries **both of them plus sixteen more**
-- (`identity-permissions.test.ts` asserts the whole matrix). So `super-admin` is a strict
-- subset of `src-admin`, and the obvious worry — that a director could now make themselves a
-- super-admin and gain something — does not arise: there is nothing there to gain. Granting
-- somebody else `super-admin` likewise hands them less than granting them `src-admin` already
-- would.
--
-- ⚠️ **What does change is what a director can _do_**, and that is the point rather than a
-- side effect: before this, an `src-admin` could grant nothing at all.
--
-- ## The last-super-admin guard is left exactly as it is, and is now slightly over-strict
--
-- `revoke_role()` still refuses to remove the last active `super-admin` grant. Its argument was
-- that a club with no super-admin has no service-role key to get back in with — and that is now
-- less true than it was, because an `src-admin` can grant one. **Left alone deliberately:** it
-- is over-strict in the safe direction, and widening it to "the last person who can grant
-- anything" is a different guard with a different failure mode, which is a decision somebody
-- should take on purpose rather than inherit from this migration.
--
-- ## Expand, migrate, contract
--
-- Three `create or replace`s with **identical signatures and identical bodies apart from the
-- gate**, and the change only ever *widens* who is accepted. The deployed Worker calls all
-- three exactly as it did; code rolls back cleanly against this schema, which is what
-- expand-migrate-contract asks. Nothing is dropped and nothing is renamed.
-- ===========================================================================================

-- -----------------------------------------------------------------------------------------
-- identity.grant_role()
-- -----------------------------------------------------------------------------------------
create or replace function identity.grant_role(p_person uuid, p_role text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_permission('identity.role.grant') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if not exists (select 1 from identity.roles as role where role.slug = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;

  if not exists (select 1 from identity.people as person where person.id = p_person) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  if exists (
    select 1
      from identity.role_grants as g
     where g.person_id = p_person
       and g.role = p_role
       and g.revoked_at is null
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_granted');
  end if;

  insert into identity.role_grants (person_id, role, granted_by)
  values (p_person, p_role, auth.uid());

  perform identity.record_identity_audit(
    auth.uid(), 'grant_role', p_person, jsonb_build_object('role', p_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function identity.grant_role(uuid, text) is
  'Grants one role to one person. Refuses unless the caller holds identity.role.grant — a permission since ADR-047, and has_role(''super-admin'') before it. Writes identity.audit in the same transaction, so a grant cannot happen unlogged.';

-- -----------------------------------------------------------------------------------------
-- identity.revoke_role()
-- -----------------------------------------------------------------------------------------
create or replace function identity.revoke_role(p_person uuid, p_role text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_permission('identity.role.grant') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if p_role = 'super-admin'
     and exists (
       select 1
         from identity.role_grants as g
        where g.person_id = p_person
          and g.role = 'super-admin'
          and g.revoked_at is null
     )
     and (
       select pg_catalog.count(*)
         from identity.role_grants as g
        where g.role = 'super-admin'
          and g.revoked_at is null
     ) <= 1
  then
    return jsonb_build_object('ok', false, 'reason', 'last_super_admin');
  end if;

  update identity.role_grants as g
     set revoked_at = pg_catalog.now()
   where g.person_id = p_person
     and g.role = p_role
     and g.revoked_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_granted');
  end if;

  perform identity.record_identity_audit(
    auth.uid(), 'revoke_role', p_person, jsonb_build_object('role', p_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function identity.revoke_role(uuid, text) is
  'Revokes one role from one person. Refuses unless the caller holds identity.role.grant — a permission since ADR-047 — and refuses to remove the last active super-admin grant, which is left in place deliberately even though an src-admin can now grant one.';

-- -----------------------------------------------------------------------------------------
-- identity.set_roles() — ADR-046's batch, on the same gate as the two above
-- -----------------------------------------------------------------------------------------
-- The whole contract is in `20260919100000`'s header; only the first `if` changes here. It
-- asked the role because the two functions beside it did, and the point of that was that the
-- batch path and the single path could not disagree about who may act. That still holds — all
-- three move together.
create or replace function identity.set_roles(
  p_person uuid,
  p_expected text[],
  p_wanted text[]
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  c_reserved constant text[] := array['super-admin', 'registered'];
  v_expected text[];
  v_wanted text[];
  v_current text[];
  v_unknown text;
  v_role text;
  v_changed integer := 0;
begin
  if not identity.has_permission('identity.role.grant') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if not exists (
    select 1 from identity.people as person where person.id = p_person
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  select coalesce(pg_catalog.array_agg(distinct role order by role), '{}'::text[])
    into v_expected
    from pg_catalog.unnest(coalesce(p_expected, '{}'::text[])) as role;

  select coalesce(pg_catalog.array_agg(distinct role order by role), '{}'::text[])
    into v_wanted
    from pg_catalog.unnest(coalesce(p_wanted, '{}'::text[])) as role;

  if v_expected && c_reserved or v_wanted && c_reserved then
    return jsonb_build_object('ok', false, 'reason', 'reserved_role');
  end if;

  select role into v_unknown
    from pg_catalog.unnest(v_wanted) as role
   where not exists (
     select 1 from identity.roles as r where r.slug = role
   )
   limit 1;

  if v_unknown is not null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('identity.set_roles'),
    pg_catalog.hashtext(p_person::text)
  );

  select coalesce(pg_catalog.array_agg(g.role order by g.role), '{}'::text[])
    into v_current
    from identity.role_grants as g
   where g.person_id = p_person
     and g.revoked_at is null
     and not (g.role = any (c_reserved));

  if v_current is distinct from v_expected then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stale',
      'roles', pg_catalog.to_jsonb(v_current)
    );
  end if;

  for v_role in
    select role from pg_catalog.unnest(v_wanted) as role
     where not (role = any (v_current))
  loop
    insert into identity.role_grants (person_id, role, granted_by)
    values (p_person, v_role, auth.uid());

    perform identity.record_identity_audit(
      auth.uid(), 'grant_role', p_person, jsonb_build_object('role', v_role)
    );

    v_changed := v_changed + 1;
  end loop;

  for v_role in
    select role from pg_catalog.unnest(v_current) as role
     where not (role = any (v_wanted))
  loop
    update identity.role_grants as g
       set revoked_at = pg_catalog.now()
     where g.person_id = p_person
       and g.role = v_role
       and g.revoked_at is null;

    perform identity.record_identity_audit(
      auth.uid(), 'revoke_role', p_person, jsonb_build_object('role', v_role)
    );

    v_changed := v_changed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'roles', pg_catalog.to_jsonb(v_wanted)
  );
end;
$$;

comment on function identity.set_roles(uuid, text[], text[]) is
  'Applies several role changes for one person in one transaction, all of them or none. Refuses unless the caller holds identity.role.grant, exactly as grant_role/revoke_role do. Refuses a payload naming super-admin or registered. Refuses stale with the current set attached. Writes one identity.audit row per role changed.';
