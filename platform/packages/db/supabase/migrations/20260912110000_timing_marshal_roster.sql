-- ==========================================================================================
-- A person can be put on an event's marshal roster, and taken off it
-- ==========================================================================================
--
-- Issue #245, under
-- [ADR-036](../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
-- `timing.marshals` shipped with row-level security on, no policy, and nothing that reads or
-- writes it; `timing.marshal.assign` existed and gated nothing. This is both halves.
--
-- ## The roster narrows a permission — it can never grant one
--
-- ADR-036 is explicit that `timing.marshals` is a **scope**: which events somebody holding
-- `timing.crossing.record` may act on, checked *after* the permission and never instead of it.
-- So `assign_marshal()` **refuses** a person who does not hold `timing.crossing.record` rather
-- than writing a row that means nothing. Putting somebody on a roster is not how they become a
-- marshal; granting the role at `/admin/people/`, behind `identity.role.grant`, is — and that
-- is where every other grant on this platform already lives.
--
-- ⚠️ **`identity.has_permission()` cannot answer this question.** It reads `auth.uid()`, so it
-- answers only about the caller, and here the subject is somebody else. The join against
-- `identity.role_grants` and `identity.role_permissions` is written out for that reason and
-- honours `revoked_at`, so a revoked role is not a marshal.
--
-- ## ⚠️ A `timing-admin` is not on every roster by holding the role
--
-- The old application let a global admin bypass the roster entirely. ADR-036 says the roster
-- is checked after the permission **for everybody**, so an admin who is going to stand at the
-- line adds themselves like anybody else. That is one extra click a year and it removes a
-- whole class of "why can this person see that event" question.
--
-- ## What a roster may say about a person
--
-- **A name, and no email address.** A roster is who is at the line, not how to contact them —
-- #245's own wording, and it is the reason `roster_for_event()` joins `identity.people` and
-- never `auth.users`.
--
-- ⚠️ **`identity.people.name` is nullable and nothing writes it yet.** That column's own
-- migration says so: profile columns "are nullable and nothing writes to them until #61". So
-- on today's data this roster renders a list of blanks, and the page built on it has to say
-- "No name recorded" rather than pretend. It is recorded here rather than discovered on the
-- page, and it is why `assignable_marshals()` below does carry an address.
--
-- ## Why the picker carries an email and the roster does not
--
-- **This deviates from #245's wording deliberately, and the argument is safety rather than
-- convenience.** The picker's entire job is to let a volunteer identify one specific person
-- before assigning them; with `people.name` null for everybody, a picker that carried no
-- address would be a list of indistinguishable rows, and the failure mode is **assigning the
-- wrong person to a race roster**. That is worse than the disclosure it avoids: the caller
-- already holds `timing.marshal.assign`, and the same address is already on `/admin/people/`.
--
-- It is still narrow. `assignable_marshals()` returns **only people holding
-- `timing.crossing.record`** — a handful of volunteers — and never the club's people table,
-- which is `identity.person.read`'s to open and a separate permission for a reason.
--
-- ## The first writer of `timing.admin_actions`
--
-- The table has had no writer since it was created. Assigning and unassigning are the first,
-- because they are changes to who may record a crossing on a race that cannot be re-run, and
-- the question "who put them on" has no other answer. `create_event()` still audits nothing,
-- and that stays right: the row existing is the evidence somebody made it.

-- ------------------------------------------------------------------------------------------
-- roster_for_event — who is standing at the line
-- ------------------------------------------------------------------------------------------
-- `null` for both "you may not" and "no such event", exactly as `event_roster()` does and for
-- the same reason: the two must be indistinguishable to somebody probing.
create or replace function timing.roster_for_event(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  -- `identity.has_permission` reads `auth.uid()` from the request's own token, which
  -- `security definer` does not change.
  if not identity.has_permission('timing.marshal.assign') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object('slug', v_event.slug, 'name', v_event.name),
    'marshals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'person_id', m.user_id,
          -- Null until #61 writes it. See the header: the page says "No name recorded"
          -- rather than falling back to an address a roster has no business carrying.
          'name', p.name,
          'assigned_at', m.created_at
        ) order by p.name nulls last, m.created_at
      )
      from timing.marshals m
      left join identity.people p on p.id = m.user_id
      where m.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function timing.roster_for_event(text) from public, anon;
grant execute on function timing.roster_for_event(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- assignable_marshals — the people who could stand at a line, and nobody else
-- ------------------------------------------------------------------------------------------
-- Scoped to the permission rather than to the club: this is not `identity.list_people()` with
-- a filter, it is a different and much smaller question. See the header for why this one
-- carries an address and the roster does not.
create or replace function timing.assignable_marshals()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
begin
  if not identity.has_permission('timing.marshal.assign') then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object('person_id', p.id, 'name', p.name, 'email', u.email)
      order by u.email
    )
    from identity.people p
    join auth.users u on u.id = p.id
    where exists (
      select 1
        from identity.role_grants g
        join identity.role_permissions rp on rp.role = g.role
       where g.person_id = p.id
         and g.revoked_at is null
         and rp.permission = 'timing.crossing.record'
    )
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.assignable_marshals() from public, anon;
grant execute on function timing.assignable_marshals() to authenticated;

-- ------------------------------------------------------------------------------------------
-- assign_marshal — putting somebody on one race, and only one race
-- ------------------------------------------------------------------------------------------
create or replace function timing.assign_marshal(p_event_slug text, p_person_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.marshal.assign') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if p_person_id is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- See the header: the roster narrows a permission and cannot grant one. Written out rather
  -- than delegated to `identity.has_permission()`, which only ever answers about the caller.
  if not exists (
    select 1
      from identity.role_grants g
      join identity.role_permissions rp on rp.role = g.role
     where g.person_id = p_person_id
       and g.revoked_at is null
       and rp.permission = 'timing.crossing.record'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_marshal');
  end if;

  insert into timing.marshals (event_id, user_id)
  values (v_event.id, p_person_id)
  on conflict (event_id, user_id) do nothing;

  -- Audited whether or not the row was new. "Somebody asked for this person to be on this
  -- roster" is the fact worth keeping, and a second ask is not a different intention.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'marshal_assigned',
    jsonb_build_object('person_id', p_person_id, 'event_slug', v_event.slug)
  );

  return jsonb_build_object('ok', true, 'slug', v_event.slug, 'person_id', p_person_id);
end;
$$;

revoke all on function timing.assign_marshal(text, uuid) from public, anon;
grant execute on function timing.assign_marshal(text, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------
-- unassign_marshal — taking somebody off, without touching what they recorded
-- ------------------------------------------------------------------------------------------
-- ⚠️ **A roster change is not a deleted person, and the crossings prove it.**
-- `timing.crossings.marshal_id` references `auth.users` with `on delete set null`, which is
-- for an account that is gone. Removing a row from `timing.marshals` touches none of that:
-- every crossing that person recorded stays exactly as it was, still attributed. Somebody
-- taken off a roster at 11:40 has not un-seen the runners who crossed at 11:30.
create or replace function timing.unassign_marshal(p_event_slug text, p_person_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_removed integer;
begin
  if not identity.has_permission('timing.marshal.assign') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  delete from timing.marshals
   where event_id = v_event.id
     and user_id = p_person_id;

  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    -- Not an error and not a success: the caller asked to remove somebody who was not there,
    -- and a page that said "done" would be claiming it had changed something.
    return jsonb_build_object('ok', false, 'reason', 'not_on_roster');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'marshal_unassigned',
    jsonb_build_object('person_id', p_person_id, 'event_slug', v_event.slug)
  );

  return jsonb_build_object('ok', true, 'slug', v_event.slug, 'person_id', p_person_id);
end;
$$;

revoke all on function timing.unassign_marshal(text, uuid) from public, anon;
grant execute on function timing.unassign_marshal(text, uuid) to authenticated;
