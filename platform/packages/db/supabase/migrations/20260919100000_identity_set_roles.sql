-- ===========================================================================================
-- identity.set_roles() — several role changes for one person, applied together or not at all
-- ===========================================================================================
-- `/admin/people/` is being rebuilt around switches and one Save (ADR-046). Today the page
-- posts one form per role per person, and each POST is its own `grant_role()` or
-- `revoke_role()` call — which is a deliberate decision recorded in `worker/admin-people.ts`
-- under the heading "One deliberate act per grant, and never a multi-select":
--
--     The alternative — checkboxes and one Save — makes granting somebody the entry list a
--     thing that happens on the way past, and makes an accidental revoke indistinguishable
--     from a deliberate one in the audit trail.
--
-- **That decision is superseded rather than forgotten**, and ADR-046 carries the argument.
-- The short version is that the volunteer doing this is changing several roles at once
-- anyway — handing a new committee member four roles is four page reloads today — and four
-- separate writes with no transaction around them is its own hazard: the third can fail and
-- leave somebody holding two of the four they were meant to get, with nothing on screen
-- saying so.
--
-- What is *not* superseded is the second half of that sentence, about the audit trail. This
-- function writes **one audit row per role changed**, with the same two actions the existing
-- functions write, so a batch of four reads in `identity.audit` exactly as four separate acts
-- did — same actor, same subject, same `detail`, same transaction. ⚠️ **That is also why this
-- migration does not touch `identity.audit`'s `action` check constraint at all.** Widening a
-- restated closed list is the invisible merge conflict `CLAUDE.md` records against
-- `entries.admin_audit.action`, where two branches each restated the list and the one applied
-- second silently dropped the other's addition. Reusing `grant_role` and `revoke_role` means
-- there is no list to restate.
--
-- ## What this function deliberately cannot do
--
-- **It cannot touch `super-admin`.** That role keeps its own path — `grant_role()` and
-- `revoke_role()`, one act, behind the typed-name confirmation the page puts in front of it —
-- and this function refuses a payload that so much as names it. Letting the batch carry it
-- would make the batch the way round the confirmation, which is the shape
-- `entries.transfer_entry()` already had to be taught about when it turned out to be the way
-- round the one-place rule. The last-super-admin guard therefore stays exactly where it is,
-- in `revoke_role()`, and this function cannot reach the state it protects against.
--
-- **It cannot touch `registered`.** Every account gets it from the signup trigger and it
-- grants nothing; `/admin/people/` has never offered a control for it (`NOT_WORTH_A_BUTTON`).
-- A batch that could strip it would let a hand-crafted POST make the table say somebody has
-- no account when they do. The page cannot express it, so neither may the function — the
-- rule belongs here rather than only in the Worker, for the reason Slice G exists.
--
-- ## Staleness, and why an expected set rather than a clock
--
-- Two volunteers on this page at once is the normal case rather than the edge one — the same
-- thing `timing`'s triage list concluded — so the loser of a race is told rather than
-- silently overwritten. The caller sends the set it *rendered*, and a mismatch is refused
-- `stale` **with the fresh set attached**, so the page can redraw what is actually true
-- instead of asking somebody to reload and work out what changed.
--
-- An expected-set comparison rather than a timestamp column, because the question being asked
-- is "is this still what I was looking at" and a set answers that directly. A clock answers
-- "has anything happened since", which is a proxy — and `entries.entry_requests` already
-- chose an owner over a timestamp for the same reason.
--
-- ## Atomicity
--
-- A `plpgsql` function body is one transaction, and nothing here catches an exception and
-- carries on, so the batch is all-or-nothing by construction rather than by arrangement. The
-- advisory lock is what stops two callers interleaving between the staleness check and the
-- writes — without it both read the same current set, both pass, and both write, which the
-- partial unique index on `role_grants` would then refuse in a way neither caller asked for.
-- ===========================================================================================

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
  -- The two roles this function may never carry. Named once, so the refusal below and the
  -- three set-builds underneath cannot drift apart.
  c_reserved constant text[] := array['super-admin', 'registered'];
  v_expected text[];
  v_wanted text[];
  v_current text[];
  v_unknown text;
  v_role text;
  v_changed integer := 0;
begin
  -- **Today's rule, carried across unchanged.** `grant_role()` and `revoke_role()` both ask
  -- `has_role('super-admin')` rather than `has_permission('identity.role.grant')`, and this
  -- asks exactly what they ask so that the batch path and the single path cannot disagree
  -- about who may act.
  --
  -- ⚠️ That is *not* the same question `/admin/people/` asks before rendering its controls,
  -- which is the permission — so `src-admin`, which holds `identity.role.grant` and not
  -- `super-admin`, is offered controls that every one of these functions refuses. That
  -- discrepancy predates this migration and is deliberately not resolved by it: changing who
  -- may change roles is a decision, not a side effect. See ADR-046's "What this leaves open".
  if not identity.has_role('super-admin') then
    return jsonb_build_object('ok', false, 'reason', 'not_authorised');
  end if;

  if not exists (
    select 1 from identity.people as person where person.id = p_person
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_person');
  end if;

  -- Sorted, de-duplicated and null-tolerant, so that a caller sending the same role twice or
  -- in a different order is comparing like with like rather than being told it is stale.
  select coalesce(pg_catalog.array_agg(distinct role order by role), '{}'::text[])
    into v_expected
    from pg_catalog.unnest(coalesce(p_expected, '{}'::text[])) as role;

  select coalesce(pg_catalog.array_agg(distinct role order by role), '{}'::text[])
    into v_wanted
    from pg_catalog.unnest(coalesce(p_wanted, '{}'::text[])) as role;

  -- **Refused rather than filtered out.** Silently dropping `super-admin` from a payload that
  -- named it would answer `ok` to a caller who asked for something that did not happen.
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

  -- One writer per person at a time. `_xact_` so it is released whatever ends the
  -- transaction, including a dropped connection — the reasoning
  -- `entries.create_pending_purchase()` sets out at its own lock.
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

  -- **The fresh set travels with the refusal.** A page told only "stale" has to reload and
  -- leave somebody to work out what moved; a page handed the current set can redraw and say
  -- so. Same shape as the `ok` answer below, so one renderer reads both.
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

  -- `changed` so the page can say "nothing to save" honestly rather than claiming a save that
  -- moved nothing. An empty batch is a success, not a refusal: somebody who flipped a switch
  -- and flipped it back has asked for a state the database is already in.
  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'roles', pg_catalog.to_jsonb(v_wanted)
  );
end;
$$;

comment on function identity.set_roles(uuid, text[], text[]) is
  'Applies several role changes for one person in one transaction, all of them or none. Refuses unless the caller holds super-admin, exactly as grant_role/revoke_role do. Refuses a payload naming super-admin or registered — the first keeps its own confirmed path and its last-holder guard in revoke_role(), the second is the signup trigger''s and /admin/people/ has never offered a control for it. Refuses stale with the current set attached when the expected set no longer matches. Writes one identity.audit row per role changed, with the same two actions the single-act functions write.';

revoke all on function identity.set_roles(uuid, text[], text[]) from public;
grant execute on function identity.set_roles(uuid, text[], text[]) to authenticated;
