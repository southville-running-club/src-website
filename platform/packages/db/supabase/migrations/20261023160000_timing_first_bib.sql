-- ==========================================================================================
-- Assign bibs can be told where to start, and still never renumbers anybody
-- ==========================================================================================
--
-- Asked for by a maintainer on 23 October 2026. **Assign bibs always started at one above the
-- highest number given out, or at 1**, and nothing on the page let the desk choose otherwise. So
-- holding back a block of race numbers — 001 to 010 for guides or invited runners, say — or
-- starting a race whose vests begin at 150 meant typing a bib for every runner by hand.
--
-- **This is the old application's behaviour, which the port dropped.** It asked for a first bib
-- (its tests have a volunteer entering 150/250), and `planBibAssignment()` was copied into
-- `packages/shared` with its `startFrom` option and never called. `timing-bibs.test.ts` holds
-- this function to that one with a start given.
--
-- ## The rule, and it is `planBibAssignment()`'s exactly
--
-- **The first number is `greatest(the number asked for, one above the highest already given
-- out)`.** A start below a number already given out is not an error; it is ignored, because
-- honouring it would mean either renumbering somebody or handing out a number twice. The answer
-- carries `first` and `last`, so the page can say where numbering actually began, and say so
-- plainly when that was not where it was asked to.
--
-- Everything `20261023140000` does stays: the padding to `bib_pad_width`, the step past a number
-- held as an override, the order, the skip of anybody already numbered.
--
-- ## ⚠️ Dropped and re-created, not replaced, and that is the PostgREST trap
--
-- `create or replace` with an extra defaulted parameter creates a **second overload** beside the
-- one-argument function, and PostgREST then refuses every call naming only `p_event_slug` as
-- ambiguous — `entries`' discount-code migration met exactly this. So the one-argument function
-- is dropped and the two-argument one created in the same transaction.
--
-- **Expand only, despite the drop.** The deployed page calls `assign_bibs` with `p_event_slug`
-- alone, which the new function answers through its default, and the answer only gains keys.
-- `timing.test.ts` lists the granted functions by name, so a second overload left behind would
-- show up there as a second `assign_bibs` row.

drop function if exists timing.assign_bibs(text);

create function timing.assign_bibs(p_event_slug text, p_start_from integer default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event_id uuid;
  v_format text;
  v_width smallint;
  v_next integer;
  v_candidate text;
  v_first text;
  v_last text;
  v_team record;
  v_assigned integer := 0;
  v_already integer := 0;
begin
  if not identity.has_permission('timing.registration.import') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select id, format, bib_pad_width into v_event_id, v_format, v_width
    from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- A start of nothing, or one wider than any width a race may be printed at, is a typo rather
  -- than an instruction. Six digits matches `events_bib_pad_width_shaped`.
  if p_start_from is not null and (p_start_from < 1 or p_start_from > 999999) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_start');
  end if;

  -- ⚠️ **New: never below one above the highest number already given out.** That is what keeps
  -- "never renumbers anybody" true whatever is typed into the box.
  select greatest(
           coalesce(p_start_from, 1),
           coalesce(max(t.team_number::integer), 0) + 1
         )
    into v_next
    from timing.teams t
   where t.event_id = v_event_id
     and t.team_number ~ '^[0-9]+$';

  select count(*) into v_already
    from timing.teams t
   where t.event_id = v_event_id and t.team_number is not null;

  for v_team in
    select t.id
      from timing.teams t
     where t.event_id = v_event_id
       and t.team_number is null
     order by t.csv_row_index nulls last, t.created_at, t.id
  loop
    -- Step past a number held as an override — a guide's, or a walk-in's spare (ADR-061).
    loop
      -- ⚠️ Length first: `lpad()` would cut a number longer than the width.
      v_candidate := case
        when v_width is null or length(v_next::text) >= v_width then v_next::text
        else lpad(v_next::text, v_width, '0')
      end;

      exit when not exists (
        select 1
          from timing.teams o
         where o.event_id = v_event_id
           and (
             (v_format = 'solo'
              and (o.bib_leg1 = v_candidate or o.bib_leg2 = v_candidate))
             or
             (v_format = 'relay'
              and (o.bib_leg1 in ('1' || v_candidate, '2' || v_candidate)
                   or o.bib_leg2 in ('1' || v_candidate, '2' || v_candidate)))
           )
      );

      v_next := v_next + 1;
    end loop;

    update timing.teams set team_number = v_candidate where id = v_team.id;
    v_first := coalesce(v_first, v_candidate);
    v_last := v_candidate;
    v_next := v_next + 1;
    v_assigned := v_assigned + 1;
  end loop;

  if v_assigned > 0 then
    insert into timing.admin_actions (event_id, actor_id, action, detail)
    values (
      v_event_id,
      auth.uid(),
      'bibs_assigned',
      jsonb_build_object(
        'assigned', v_assigned,
        'already_assigned', v_already,
        'start_from', p_start_from,
        'first', v_first,
        'last', v_last
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'assigned', v_assigned,
    'already_assigned', v_already,
    'first', v_first,
    'last', v_last
  );
end;
$$;

revoke all on function timing.assign_bibs(text, integer) from public, anon;
grant execute on function timing.assign_bibs(text, integer) to authenticated;
