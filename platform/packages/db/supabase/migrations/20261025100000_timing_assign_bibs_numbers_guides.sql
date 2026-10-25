-- ==========================================================================================
-- Assign bibs numbers a guide too: straight after their runner, or next free if late
-- ==========================================================================================
--
-- [ADR-067](../../../../docs/architecture/decisions/adr-067-assign-bibs-numbers-a-guide.md).
-- **Decided by a maintainer on 25 October 2026**, the first day of the race-night change freeze,
-- and deliberately deployed inside it.
--
-- ADR-061 gave a visually impaired runner's guide a race number of their own on a solo race,
-- held as the entry's leg-2 override, and left **the desk** to type each one into a Guide's bib
-- box after pressing Assign bibs. It named numbering guides automatically as a separate decision,
-- because it means choosing which vest a guide gets. This is that decision:
--
--   * **A guide on an entry being numbered gets the number straight after their runner's.**
--     Runner `042`, guide `043`, and the next entry `044`, so the desk hands a pair of
--     consecutive vests over together.
--   * **A guide on an entry that already had a number** — a guide added by a late re-import, or
--     whose number was cleared — **gets the next free number** on the next press. The one after
--     their runner's is somebody else's by then.
--
-- ## "Never renumbers anybody" holds, and it is the same rule as before
--
-- A team that already has a number keeps it, and a guide who already has a number — typed by
-- the desk or given by an earlier press — keeps it. Only a missing number is ever filled in, so
-- a second press with nothing new to number changes nothing at all.
--
-- **Every number handed out is still checked against the numbers people are already
-- wearing**, team numbers and overrides alike, so a guide's number can never be anybody else's.
-- Team numbers handed out are always above every number already taken; overrides are what the
-- step past has to look for, and now it does that through one helper rather than three copies
-- of the same loop.
--
-- ## Solo races only
--
-- A guide is leg 2 of their runner's team only on a solo race (ADR-022, ADR-039). On a relay,
-- leg 2 is a runner who derives their own bib, so nothing here touches a relay.
--
-- ## Expand only
--
-- `assign_bibs()` is replaced with its signature unchanged, and its answer gains one key,
-- `guides_numbered`, which the deployed page ignores. Two helpers are new and granted to nobody.
-- `add_walk_in()` is untouched: it keeps its own copy of the step past, which folding onto the
-- helper below is tidying for after the race, not something to deploy during the freeze.

-- ------------------------------------------------------------------------------------------
-- padded_bib — a number written at the race's width
-- ------------------------------------------------------------------------------------------
-- ⚠️ **Length first: Postgres' `lpad()` truncates**, so `lpad('1000', 3, '0')` would be `'100'`,
-- somebody else's number. Null width pads nothing. The same expression `assign_bibs()` and
-- `add_walk_in()` have carried inline since `20261023120000`.

create or replace function timing.padded_bib(p_number integer, p_width smallint)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case
    when p_width is null or length(p_number::text) >= p_width then p_number::text
    else lpad(p_number::text, p_width, '0')
  end;
$$;

-- Granted to nobody, like `effective_bib()`: reachable from the definer function below only.
revoke all on function timing.padded_bib(integer, smallint) from public;

-- ------------------------------------------------------------------------------------------
-- free_number_from — the first number at or above a start that nobody on the race is wearing
-- ------------------------------------------------------------------------------------------
-- "Wearing" means held as an override on either leg: the candidate's own bib on a solo race,
-- and its two leg-first bibs on a relay — `20261023140000`'s rule, unchanged. A team's *derived*
-- number cannot collide, because the caller only ever asks from above the highest team number.
--
-- **Volatile on purpose**, not `stable`: it is called several times in one run of
-- `assign_bibs()`, after that run has written overrides of its own, and each call has to see them.

create or replace function timing.free_number_from(
  p_event_id uuid,
  p_format text,
  p_width smallint,
  p_from integer
)
  returns integer
  language plpgsql
  set search_path = timing, pg_catalog
as $$
declare
  v_number integer := p_from;
  v_bib text;
begin
  loop
    v_bib := timing.padded_bib(v_number, p_width);

    exit when not exists (
      select 1
        from timing.teams o
       where o.event_id = p_event_id
         and (
           (p_format = 'solo'
            and (o.bib_leg1 = v_bib or o.bib_leg2 = v_bib))
           or
           (p_format = 'relay'
            and (o.bib_leg1 in ('1' || v_bib, '2' || v_bib)
                 or o.bib_leg2 in ('1' || v_bib, '2' || v_bib)))
         )
    );

    v_number := v_number + 1;
  end loop;

  return v_number;
end;
$$;

revoke all on function timing.free_number_from(uuid, text, smallint, integer) from public;

-- ------------------------------------------------------------------------------------------
-- assign_bibs — number the field, and every guide in it
-- ------------------------------------------------------------------------------------------
-- Unchanged from `20261023160000` apart from the guides, marked below: the padding, the step
-- past a number already worn, the optional first number and its "never below one already given
-- out", the order, and the skip of anybody already numbered all stay.
--
-- **Two passes, in this order.** First every unnumbered entry, each guide straight after their
-- runner. Then every guide on an entry that already had a number and still has none, each the
-- next free number. New entries' pairs stay together that way, and a late guide never splits
-- one.
--
-- **`first` and `last` now span every number handed out**, guides included, because they are
-- what the page quotes as the range of vests the desk is about to give out.

create or replace function timing.assign_bibs(p_event_slug text, p_start_from integer default null)
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
  v_bib text;
  v_first text;
  v_last text;
  v_team record;
  v_assigned integer := 0;
  v_guides integer := 0;
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

  if p_start_from is not null and (p_start_from < 1 or p_start_from > 999999) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_start');
  end if;

  -- Never below one above the highest number already given out — "never renumbers anybody".
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

  -- Pass 1: the unnumbered entries, in the order they have always been numbered.
  for v_team in
    select t.id,
           -- ⚠️ New: a guide still waiting for a number, on a solo race (ADR-067).
           (v_format = 'solo'
            and nullif(btrim(coalesce(t.bib_leg2, '')), '') is null
            and exists (
              select 1 from timing.runners r
               where r.team_id = t.id and r.leg = 2 and r.role = 'guide'
            )) as guide_waiting
      from timing.teams t
     where t.event_id = v_event_id
       and t.team_number is null
     order by t.csv_row_index nulls last, t.created_at, t.id
  loop
    v_next := timing.free_number_from(v_event_id, v_format, v_width, v_next);
    v_bib := timing.padded_bib(v_next, v_width);
    update timing.teams set team_number = v_bib where id = v_team.id;
    v_first := coalesce(v_first, v_bib);
    v_last := v_bib;
    v_next := v_next + 1;
    v_assigned := v_assigned + 1;

    -- ⚠️ New: the guide, straight after their runner — or the next free number, if somebody is
    -- already wearing that one.
    if v_team.guide_waiting then
      v_next := timing.free_number_from(v_event_id, v_format, v_width, v_next);
      v_bib := timing.padded_bib(v_next, v_width);
      update timing.teams set bib_leg2 = v_bib where id = v_team.id;
      v_last := v_bib;
      v_next := v_next + 1;
      v_guides := v_guides + 1;
    end if;
  end loop;

  -- ⚠️ New, pass 2: a guide on an entry numbered before this press, still with no number of
  -- their own. The next free number each, in the same order as pass 1. An entry numbered in
  -- pass 1 has already had its guide seen to, so it never matches here.
  if v_format = 'solo' then
    for v_team in
      select t.id
        from timing.teams t
       where t.event_id = v_event_id
         and t.team_number is not null
         and nullif(btrim(coalesce(t.bib_leg2, '')), '') is null
         and exists (
           select 1 from timing.runners r
            where r.team_id = t.id and r.leg = 2 and r.role = 'guide'
         )
       order by t.csv_row_index nulls last, t.created_at, t.id
    loop
      v_next := timing.free_number_from(v_event_id, v_format, v_width, v_next);
      v_bib := timing.padded_bib(v_next, v_width);
      update timing.teams set bib_leg2 = v_bib where id = v_team.id;
      v_first := coalesce(v_first, v_bib);
      v_last := v_bib;
      v_next := v_next + 1;
      v_guides := v_guides + 1;
    end loop;
  end if;

  if v_assigned > 0 or v_guides > 0 then
    insert into timing.admin_actions (event_id, actor_id, action, detail)
    values (
      v_event_id,
      auth.uid(),
      'bibs_assigned',
      jsonb_build_object(
        'assigned', v_assigned,
        'guides_numbered', v_guides,
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
    'guides_numbered', v_guides,
    'already_assigned', v_already,
    'first', v_first,
    'last', v_last
  );
end;
$$;

revoke all on function timing.assign_bibs(text, integer) from public, anon;
grant execute on function timing.assign_bibs(text, integer) to authenticated;
