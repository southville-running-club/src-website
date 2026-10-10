-- Correcting a runner's name from the Roster — the admin half of ADR-056.
--
-- On race day the desk fixes spellings: "Bernadete" becomes "Bernadette" before the bib goes
-- over the table. Nothing could do that until now — `add_walk_in()` creates a runner and
-- `set_bib_override()` changes a bib, but a name, once imported, was fixed at the import.
--
-- ## Behind `timing.registration.import`, the permission the entry list already uses
--
-- Fixing a name is a change to the entry list, and the person who imports it and adds walk-ins
-- is the person who corrects it. No new permission: ADR-056's `timing.roster.read` is look-up
-- only, deliberately, and a marshal still cannot change a name.
--
-- ## ⚠️ Compare-and-swap, because two desks on one roster is the normal case
--
-- The form carries the name it was drawn with, and the update happens only if the row still
-- holds it. Two laptops correcting the same runner: the second is told
-- `changed_elsewhere` rather than silently overwriting the first — the same shape as
-- `edit_crossing()`, and for the same reason.
--
-- ## The audit row names what changed, not the values
--
-- `admin_actions` records who corrected which runner, when, and which of the two names moved.
-- It does not copy the old and new names into a second table, which would be a second copy of
-- personal data for retention to chase; the runner row is the record of what the name is.

create or replace function timing.rename_runner(
  p_event_slug text,
  p_runner_id uuid,
  p_firstname text,
  p_lastname text,
  p_expected_firstname text,
  p_expected_lastname text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_first text;
  v_last text;
  v_updated integer;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id into v_event_id from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  v_first := nullif(btrim(coalesce(p_firstname, '')), '');
  v_last := nullif(btrim(coalesce(p_lastname, '')), '');
  if v_first is null or v_last is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  -- The runner has to be on this race, so a runner id from another race is refused rather
  -- than renamed through a slug it does not belong to.
  if not exists (
    select 1 from timing.runners r
      join timing.teams t on t.id = r.team_id
     where r.id = p_runner_id and t.event_id = v_event_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_runner');
  end if;

  update timing.runners r
     set firstname = v_first, lastname = v_last
   where r.id = p_runner_id
     and r.firstname = p_expected_firstname
     and r.lastname = p_expected_lastname;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'changed_elsewhere');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event_id,
    auth.uid(),
    'runner_renamed',
    jsonb_build_object(
      'runner_id', p_runner_id,
      'firstname_changed', v_first <> p_expected_firstname,
      'lastname_changed', v_last <> p_expected_lastname
    )
  );

  return jsonb_build_object('ok', true, 'runner_id', p_runner_id);
end;
$$;

comment on function timing.rename_runner(text, uuid, text, text, text, text) is
  'Correct a runner''s name from the Roster (ADR-056). timing.registration.import; '
  'compare-and-swap on the name the form was drawn with; audited without copying the values.';

revoke all on function timing.rename_runner(text, uuid, text, text, text, text)
  from public, anon;
grant execute on function timing.rename_runner(text, uuid, text, text, text, text)
  to authenticated;
