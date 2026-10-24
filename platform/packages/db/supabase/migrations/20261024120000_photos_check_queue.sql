-- Race photos: the shared check queue, publishing, and taking a photo down.
--
-- Race photos brief, slice 3, decision 11 and ADR-065. The laptop tags every photo it can and
-- marks the rest for checking (`needs_check`, or `part_read` for a number it could only read
-- part of). A team of four checks those together at `/admin/photos/check/`, from any computer
-- or tablet, sharing one queue:
--
--   * **Each checker gets the next photo nobody else has open**, held for them for ten
--     minutes. Two checkers asking at the same moment get different photos — `for update skip
--     locked`, not luck — and a hold past its ten minutes frees the photo for the next person.
--   * **Every decision records who made it**, and can be undone by the person who made it.
--   * **Publishing waits until nothing is left to check.**
--
-- =========================================================================================
-- What a decision does, and why it never deletes a row
-- =========================================================================================
-- ⚠️ **The laptop's SQL file runs again after the website has decided things** (ADR-064), and
-- the bargain that keeps the two from fighting is that the file never touches a photo once
-- `photo.checked_by` is set, nor a bib row once `photo_bib.decided_by` is set. So a decision
-- here **marks** rows rather than deleting them:
--
--   * a bib the checker confirms is a confirmed row with `decided_by` set;
--   * a read the checker dismisses — the `12?` they settled as `125`, or anything on a photo
--     with no bib visible — stays, with `dismissed` true and `decided_by` set.
--
-- Deleting a dismissed read would not survive the file: it would insert the read again on the
-- next run, unconfirmed, and the photo would reappear as "Could be you" to every runner it
-- fits. A dismissed row with `decided_by` set is one the file can see and must leave alone.
--
-- A **kept part read** stays unconfirmed and undismissed, with `decided_by` set: it is shown
-- as "Could be you" (slice 4) and is never anybody's own until somebody confirms it (ADR-058).
--
-- =========================================================================================
-- Undo, and the one table this adds
-- =========================================================================================
-- `photos.decision` records each decision with the photo's state **before and after** it, so
-- undoing one restores exactly what was there. It holds checkers' account ids — staff, who
-- are already in `photo.checked_by` and `photo_bib.decided_by` — and nothing about a runner.
-- Undo is refused once anything about the photo has changed since (`changed_since`), so it can
-- never overwrite a later decision or a rerun of the SQL file.
--
-- =========================================================================================
-- Grants
-- =========================================================================================
-- Every function a page calls is granted to `authenticated` and asks
-- `identity.has_permission()` first — the house pattern (`store.admin_ticket_list()`,
-- `timing.resolve_crossing()`). **`anon` may call none of them**, and the helpers below are
-- granted to nobody. `tests/photos.test.ts` names every function and who may call it.

-- =========================================================================================
-- Two additive columns
-- =========================================================================================
-- Expand only: nothing deployed reads `photos`, and the laptop's SQL file names its columns, so
-- a column with a default is invisible to it.
alter table photos.photo_bib
  add column if not exists dismissed boolean not null default false;

alter table photos.photo_bib
  drop constraint if exists photo_bib_dismissed_is_decided,
  add constraint photo_bib_dismissed_is_decided
    check (not dismissed or decided_at is not null);

alter table photos.photo_bib
  drop constraint if exists photo_bib_dismissed_is_not_confirmed,
  add constraint photo_bib_dismissed_is_not_confirmed
    check (not (dismissed and confirmed));

comment on column photos.photo_bib.dismissed is
  'A checker set this read aside: never shown, never anybody''s. Kept rather than deleted so the laptop''s SQL file cannot put it back.';

-- Who published, beside when, for the reason `timing.events.results_published_by` exists:
-- "the photos went up" is a fact somebody may need to ask about.
alter table photos.event
  add column if not exists published_by uuid references auth.users (id) on delete set null;

-- =========================================================================================
-- The decision history
-- =========================================================================================
create table if not exists photos.decision (
  id bigint generated always as identity primary key,
  photo_id uuid not null references photos.photo (id) on delete cascade,
  action text not null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),

  -- The photo's state before and after, as `photos.photo_state()` writes it. Null for a skip
  -- and a takedown, which change no bib and cannot be undone.
  before_state jsonb,
  after_state jsonb,

  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,

  constraint decision_action_shaped check (
    action in ('confirm', 'correct', 'keep_part', 'no_bib', 'skip', 'hide')
  ),
  -- `on delete set null` on both account columns means "by" can go and "when" cannot, which
  -- is the shape `photo_checker_has_a_time` already has.
  constraint decision_undo_has_a_time check (undone_by is null or undone_at is not null),
  constraint decision_states_coherent check (
    (action in ('skip', 'hide')) = (before_state is null and after_state is null)
  )
);

comment on table photos.decision is
  'Every decision made on the check page: who, when, and the photo''s state before and after, so it can be undone. Checkers'' account ids only; nothing about a runner.';

alter table photos.decision enable row level security;

create index if not exists decision_by_photo on photos.decision (photo_id, id desc);

-- =========================================================================================
-- Helpers, granted to nobody
-- =========================================================================================

-- **The one statement of "left to check"**, read by the queue, the progress figures and the
-- publish refusal alike, so the number on the page and the number that refuses publishing
-- cannot drift — the lesson `timing.open_anomaly_count()` recorded.
create or replace function photos.is_unsure(
  p_check_state text,
  p_checked_by uuid,
  p_hidden_at timestamptz
)
  returns boolean
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select p_hidden_at is null
     and p_checked_by is null
     and p_check_state in ('needs_check', 'part_read');
$$;

revoke all on function photos.is_unsure(text, uuid, timestamptz) from public;

create or replace function photos.left_to_check(p_event_slug text)
  returns integer
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select count(*)::integer
    from photos.photo
   where event_slug = p_event_slug
     and photos.is_unsure(check_state, checked_by, hidden_at);
$$;

revoke all on function photos.left_to_check(text) from public;

-- What a decision can change about a photo, as one value: the state, who settled it, and
-- every bib row. Undo compares this against the decision's `after_state` before restoring
-- `before_state`, so it restores only what it is sure it is replacing.
create or replace function photos.photo_state(p_photo_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select jsonb_build_object(
    'check_state', p.check_state,
    'checked_by', p.checked_by,
    'checked_at', p.checked_at,
    'bibs', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'bib_text', b.bib_text,
                  'confidence', b.confidence,
                  'confirmed', b.confirmed,
                  'source', b.source,
                  'decided_by', b.decided_by,
                  'decided_at', b.decided_at,
                  'dismissed', b.dismissed
                )
                order by b.bib_text collate "C")
         from photos.photo_bib b
        where b.photo_id = p.id),
      '[]'::jsonb)
  )
  from photos.photo p
  where p.id = p_photo_id;
$$;

revoke all on function photos.photo_state(uuid) from public;

-- Every number somebody is wearing in this running, from the race's own roster: the bibs a
-- part read could fit. `timing.effective_bib()` is the one rule for which number a leg wears.
create or replace function photos.worn_bibs(p_event_slug text)
  returns setof text
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select distinct bib
    from (
      select timing.effective_bib(
               case when r.leg = 1 then t.bib_leg1 else t.bib_leg2 end,
               t.team_number,
               r.leg,
               e.format
             ) as bib
        from timing.events e
        join timing.teams t on t.event_id = e.id
        join timing.runners r on r.team_id = t.id
       where e.slug = p_event_slug
    ) worn
   where bib is not null;
$$;

revoke all on function photos.worn_bibs(text) from public;

-- The bibs worth offering as buttons for one photo: each unsure whole read as it was read, then
-- every worn bib a part read fits (`12?` fits `120` to `129`, same length, ADR-058). Thirty at
-- most: a part read like `1??` fits a hundred, and the page has a box for typing one.
create or replace function photos.candidate_bibs(p_photo_id uuid)
  returns text[]
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  with unsure as (
    select b.bib_text, b.confidence
      from photos.photo_bib b
     where b.photo_id = p_photo_id
       and not b.confirmed
       and not b.dismissed
  ),
  offered as (
    select u.bib_text as bib, 0 as rank, coalesce(u.confidence, 0) as weight
      from unsure u
     where u.bib_text !~ '\?'
    union all
    select worn.bib, 1, coalesce(u.confidence, 0)
      from unsure u
      cross join lateral photos.worn_bibs(
        (select event_slug from photos.photo where id = p_photo_id)
      ) as worn (bib)
     where u.bib_text ~ '\?'
       and worn.bib ~ ('^' || replace(u.bib_text, '?', '[0-9]') || '$')
  ),
  best as (
    select bib, min(rank) as rank, max(weight) as weight
      from offered
     group by bib
  )
  select coalesce(
    (select array_agg(bib order by rank, weight desc, bib collate "C")
       from (select * from best order by rank, weight desc, bib collate "C" limit 30) top),
    '{}'::text[]);
$$;

revoke all on function photos.candidate_bibs(uuid) from public;

-- One photo as the check page needs it.
create or replace function photos.photo_for_checking(p_photo_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id,
    'event_slug', p.event_slug,
    'short_id', p.short_id,
    'photographer', p.photographer,
    'spot', p.spot,
    'taken_at', p.taken_at,
    'width', p.width,
    'height', p.height,
    'check_state', p.check_state,
    'held_until', p.held_until,
    'reads', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'bib_text', b.bib_text,
                  'confidence', b.confidence,
                  'confirmed', b.confirmed
                )
                order by b.confirmed desc, b.confidence desc nulls last, b.bib_text collate "C")
         from photos.photo_bib b
        where b.photo_id = p.id
          and not b.dismissed),
      '[]'::jsonb),
    'candidates', to_jsonb(photos.candidate_bibs(p.id))
  )
  from photos.photo p
  where p.id = p_photo_id;
$$;

revoke all on function photos.photo_for_checking(uuid) from public;

-- =========================================================================================
-- The next photo to check
-- =========================================================================================
-- Returns the photo this checker already holds, if they hold one (a reload is not a second
-- photo), and otherwise holds and returns the next unsure photo nobody else holds or whose
-- hold has run out. **Photos this checker skipped come last**, so Skip moves them on rather
-- than handing the same photo straight back; somebody else may know the number.
create or replace function photos.next_photo()
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not identity.has_permission('nn.photo.check') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select p.id into v_id
    from photos.photo p
   where p.held_by = auth.uid()
     and p.held_until > now()
     and photos.is_unsure(p.check_state, p.checked_by, p.hidden_at)
   order by p.held_until desc
   limit 1
   for update of p;

  if v_id is null then
    -- ⚠️ **`skip locked` is the whole of "two checkers never get the same photo".** Without
    -- it the second caller waits for the first's transaction and then takes the same row,
    -- because the row it waited on still looked free when it started waiting.
    select p.id into v_id
      from photos.photo p
     where photos.is_unsure(p.check_state, p.checked_by, p.hidden_at)
       and (p.held_by is null or p.held_until <= now())
     order by
       exists (
         select 1 from photos.decision d
          where d.photo_id = p.id
            and d.action = 'skip'
            and d.decided_by = auth.uid()
       ),
       p.taken_at nulls last,
       p.short_id
     limit 1
     for update of p skip locked;
  end if;

  if v_id is null then
    return jsonb_build_object('ok', true, 'photo', null);
  end if;

  update photos.photo
     set held_by = auth.uid(),
         held_until = now() + interval '10 minutes'
   where id = v_id;

  return jsonb_build_object('ok', true, 'photo', photos.photo_for_checking(v_id));
end;
$$;

comment on function photos.next_photo() is
  'The check queue: the photo this checker holds, or the next unsure one nobody holds, held for them for 10 minutes. Behind nn.photo.check.';

revoke all on function photos.next_photo() from public, anon;
grant execute on function photos.next_photo() to authenticated;

-- =========================================================================================
-- Record a decision
-- =========================================================================================
-- `confirm` (a bib chosen from the buttons) and `correct` (a bib typed in) take one or more
-- whole bibs and settle the photo as those; `keep_part` keeps its unsure reads as "Could be
-- you"; `no_bib` sets every unsure read aside; `skip` hands the photo back to the queue.
--
-- **The first decision wins.** A checker whose hold ran out may find somebody else decided the
-- photo first, and they are told so (`already_decided`) rather than overwriting it. Making
-- the same decision again changes nothing and says so (`unchanged`), which is what a
-- resubmitted form or a double tap does.
create or replace function photos.decide(
  p_photo_id uuid,
  p_action text,
  p_bibs text[] default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_photo photos.photo%rowtype;
  v_bibs text[];
  v_before jsonb;
  v_after jsonb;
  v_last photos.decision%rowtype;
  v_bib text;
begin
  if not identity.has_permission('nn.photo.check') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  if p_action is null
     or p_action not in ('confirm', 'correct', 'keep_part', 'no_bib', 'skip') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  if p_action in ('confirm', 'correct') then
    select coalesce(array_agg(distinct btrim(bib) order by btrim(bib)), '{}')
      into v_bibs
      from unnest(coalesce(p_bibs, '{}')) as bib
     where btrim(bib) <> '';

    if cardinality(v_bibs) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'bib_required');
    end if;

    if exists (select 1 from unnest(v_bibs) as bib where bib !~ '^[0-9]{1,8}$') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_bib');
    end if;
  end if;

  select * into v_photo from photos.photo where id = p_photo_id for update;

  if not found or v_photo.hidden_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_photo');
  end if;

  if p_action = 'skip' then
    update photos.photo
       set held_by = null, held_until = null
     where id = p_photo_id
       and held_by = auth.uid();

    insert into photos.decision (photo_id, action, decided_by)
    values (p_photo_id, 'skip', auth.uid());

    return jsonb_build_object('ok', true, 'action', 'skip');
  end if;

  if v_photo.checked_by is not null then
    select * into v_last
      from photos.decision
     where photo_id = p_photo_id
       and action in ('confirm', 'correct', 'keep_part', 'no_bib')
       and undone_at is null
     order by id desc
     limit 1;

    -- The same decision again — a resubmitted form, a double tap — changes nothing.
    if found
       and (v_last.action = p_action
            or (v_last.action in ('confirm', 'correct') and p_action in ('confirm', 'correct')))
       and (p_action not in ('confirm', 'correct')
            or v_last.after_state -> 'confirmed_by_decision' = to_jsonb(v_bibs)) then
      return jsonb_build_object('ok', true, 'action', p_action, 'unchanged', true);
    end if;

    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if not photos.is_unsure(v_photo.check_state, v_photo.checked_by, v_photo.hidden_at) then
    -- Tagged or settled on the laptop: not this page's to change.
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  if p_action = 'keep_part'
     and not exists (
       select 1 from photos.photo_bib
        where photo_id = p_photo_id and not confirmed and not dismissed and bib_text ~ '\?'
     ) then
    return jsonb_build_object('ok', false, 'reason', 'nothing_part_read');
  end if;

  v_before := photos.photo_state(p_photo_id);

  if p_action in ('confirm', 'correct') then
    -- Every unsure read that is not one of the chosen bibs is set aside.
    update photos.photo_bib
       set dismissed = true, decided_by = auth.uid(), decided_at = now()
     where photo_id = p_photo_id
       and not confirmed
       and not dismissed
       and bib_text <> all (v_bibs);

    -- Each chosen bib is confirmed: an unsure read of it becomes the person's, and one nobody
    -- read is added. A bib the laptop had already confirmed is left as the laptop's.
    foreach v_bib in array v_bibs loop
      insert into photos.photo_bib
        (photo_id, bib_text, confidence, confirmed, source, decided_by, decided_at)
      values (p_photo_id, v_bib, null, true, 'person', auth.uid(), now())
      on conflict (photo_id, bib_text) do update
         set confirmed = true,
             dismissed = false,
             source = 'person',
             decided_by = auth.uid(),
             decided_at = now()
       where not photos.photo_bib.confirmed;
    end loop;

    update photos.photo
       set check_state = 'checked'
     where id = p_photo_id;
  elsif p_action = 'keep_part' then
    update photos.photo_bib
       set decided_by = auth.uid(), decided_at = now()
     where photo_id = p_photo_id
       and not confirmed
       and not dismissed;

    update photos.photo
       set check_state = 'part_read'
     where id = p_photo_id;
  else
    -- no_bib: nothing unsure is anybody's. A bib the laptop was sure of stays.
    update photos.photo_bib
       set dismissed = true, decided_by = auth.uid(), decided_at = now()
     where photo_id = p_photo_id
       and not confirmed
       and not dismissed;

    update photos.photo
       set check_state = 'checked'
     where id = p_photo_id;
  end if;

  update photos.photo
     set checked_by = auth.uid(),
         checked_at = now(),
         held_by = null,
         held_until = null,
         updated_at = now()
   where id = p_photo_id;

  v_after := photos.photo_state(p_photo_id);

  insert into photos.decision (photo_id, action, decided_by, before_state, after_state)
  values (
    p_photo_id,
    p_action,
    auth.uid(),
    v_before,
    -- The chosen bibs ride along, so a repeat of the same decision can be recognised.
    v_after || jsonb_build_object('confirmed_by_decision', coalesce(to_jsonb(v_bibs), 'null'))
  );

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

comment on function photos.decide(uuid, text, text[]) is
  'Record a check decision — confirm, correct, keep_part, no_bib or skip — and who made it. The first decision wins; the same one again changes nothing. Behind nn.photo.check.';

revoke all on function photos.decide(uuid, text, text[]) from public, anon;
grant execute on function photos.decide(uuid, text, text[]) to authenticated;

-- =========================================================================================
-- Undo
-- =========================================================================================
-- The checker's own last decision on a photo, and only while nothing has changed since: the
-- photo goes back in the queue, held for them, exactly as it was.
create or replace function photos.undo_decision(p_photo_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_last photos.decision%rowtype;
  v_now jsonb;
  v_bib jsonb;
begin
  if not identity.has_permission('nn.photo.check') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  perform 1 from photos.photo where id = p_photo_id and hidden_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_photo');
  end if;

  select * into v_last
    from photos.decision
   where photo_id = p_photo_id
     and action in ('confirm', 'correct', 'keep_part', 'no_bib')
     and undone_at is null
   order by id desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_undo');
  end if;

  if v_last.decided_by is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  v_now := photos.photo_state(p_photo_id);

  if v_now is distinct from (v_last.after_state - 'confirmed_by_decision') then
    return jsonb_build_object('ok', false, 'reason', 'changed_since');
  end if;

  delete from photos.photo_bib where photo_id = p_photo_id;

  for v_bib in select * from jsonb_array_elements(v_last.before_state -> 'bibs') loop
    insert into photos.photo_bib
      (photo_id, bib_text, confidence, confirmed, source, decided_by, decided_at, dismissed)
    values (
      p_photo_id,
      v_bib ->> 'bib_text',
      (v_bib ->> 'confidence')::numeric,
      (v_bib ->> 'confirmed')::boolean,
      v_bib ->> 'source',
      (v_bib ->> 'decided_by')::uuid,
      (v_bib ->> 'decided_at')::timestamptz,
      (v_bib ->> 'dismissed')::boolean
    );
  end loop;

  update photos.photo
     set check_state = v_last.before_state ->> 'check_state',
         checked_by = (v_last.before_state ->> 'checked_by')::uuid,
         checked_at = (v_last.before_state ->> 'checked_at')::timestamptz,
         held_by = auth.uid(),
         held_until = now() + interval '10 minutes',
         updated_at = now()
   where id = p_photo_id;

  update photos.decision
     set undone_at = now(), undone_by = auth.uid()
   where id = v_last.id;

  return jsonb_build_object('ok', true, 'action', v_last.action);
end;
$$;

comment on function photos.undo_decision(uuid) is
  'Undo the caller''s own last decision on a photo, if nothing has changed since. Behind nn.photo.check.';

revoke all on function photos.undo_decision(uuid) from public, anon;
grant execute on function photos.undo_decision(uuid) to authenticated;

-- =========================================================================================
-- Progress
-- =========================================================================================
-- One row per running with photos: the figures `/admin/photos/` shows.
create or replace function photos.progress()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
begin
  if not identity.has_permission('nn.photo.read') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  return jsonb_build_object(
    'ok', true,
    'events', coalesce(
      (select jsonb_agg(row_to_json(figures) order by figures.slug collate "C")
         from (
           select
             e.slug,
             -- The running's own name, from the race's record rather than from markup.
             (select t.name from timing.events t where t.slug = e.slug) as name,
             e.published_at,
             count(p.id) filter (where p.hidden_at is null) as photos,
             count(p.id) filter (where p.hidden_at is not null) as hidden,
             count(p.id) filter (where p.hidden_at is null and p.check_state = 'tagged') as tagged,
             count(p.id) filter (where p.hidden_at is null and p.check_state = 'checked') as checked,
             count(p.id) filter (where p.hidden_at is null and p.check_state = 'part_read') as part_read,
             count(p.id) filter (where p.hidden_at is null and p.check_state = 'no_bib_seen') as no_bib_seen,
             count(p.id) filter (where photos.is_unsure(p.check_state, p.checked_by, p.hidden_at)) as left_to_check,
             count(p.id) filter (
               where photos.is_unsure(p.check_state, p.checked_by, p.hidden_at)
                 and p.held_until > now()
             ) as held_now,
             count(p.id) filter (where p.hidden_at is null and p.checked_by is not null) as checked_here
           from photos.event e
           left join photos.photo p on p.event_slug = e.slug
           group by e.slug, e.published_at
         ) figures),
      '[]'::jsonb)
  );
end;
$$;

comment on function photos.progress() is
  'How the race photos are going, per running. Behind nn.photo.read.';

revoke all on function photos.progress() from public, anon;
grant execute on function photos.progress() to authenticated;

-- =========================================================================================
-- Publish
-- =========================================================================================
-- Refused while anything is left to check (decision 11), and while there is nothing to show.
-- Publishing again is a no-op that says so. **There is no unpublish here**: a photo that must
-- not be seen is taken down, which is what a runner's request needs, and pulling a whole
-- running's photos is a decision nobody has asked for yet.
create or replace function photos.publish(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_event photos.event%rowtype;
  v_left integer;
begin
  if not identity.has_permission('nn.photo.publish') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from photos.event where slug = p_event_slug for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if v_event.published_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'published_at', v_event.published_at);
  end if;

  v_left := photos.left_to_check(p_event_slug);
  if v_left > 0 then
    return jsonb_build_object('ok', false, 'reason', 'left_to_check', 'left', v_left);
  end if;

  if not exists (
    select 1 from photos.photo where event_slug = p_event_slug and hidden_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_photos');
  end if;

  update photos.event
     set published_at = now(), published_by = auth.uid()
   where slug = p_event_slug
  returning * into v_event;

  return jsonb_build_object('ok', true, 'already', false, 'published_at', v_event.published_at);
end;
$$;

comment on function photos.publish(text) is
  'Publish a running''s photos, once nothing is left to check. Behind nn.photo.publish.';

revoke all on function photos.publish(text) from public, anon;
grant execute on function photos.publish(text) to authenticated;

-- =========================================================================================
-- Take a photo down
-- =========================================================================================
-- By short ID, because that is what a runner replies with. Sets `hidden_at` and answers the
-- photo's id and running, so the Worker can delete its three copies from R2. **It answers the
-- id for a photo already hidden too**, so a takedown whose deletion failed half way is
-- finished by doing it again rather than being stuck as "already hidden" with files left.
create or replace function photos.take_down(p_event_slug text, p_short_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_photo photos.photo%rowtype;
  v_already boolean;
begin
  if not identity.has_permission('nn.photo.hide') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_photo
    from photos.photo
   where event_slug = p_event_slug
     and short_id = upper(btrim(p_short_id))
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_photo');
  end if;

  v_already := v_photo.hidden_at is not null;

  if not v_already then
    update photos.photo
       set hidden_at = now(), held_by = null, held_until = null, updated_at = now()
     where id = v_photo.id;

    insert into photos.decision (photo_id, action, decided_by)
    values (v_photo.id, 'hide', auth.uid());
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_photo.id,
    'event_slug', v_photo.event_slug,
    'short_id', v_photo.short_id,
    'already', v_already
  );
end;
$$;

comment on function photos.take_down(text, text) is
  'Take a photo down by short ID: hidden at once, and its id returned so its three copies can be deleted from storage. Behind nn.photo.hide.';

revoke all on function photos.take_down(text, text) from public, anon;
grant execute on function photos.take_down(text, text) to authenticated;

-- =========================================================================================
-- An unpublished image, for a checker
-- =========================================================================================
-- Where the Worker finds a photo's copies in R2, for the admin-only image route. Nothing for a
-- photo that does not exist or has been taken down, whoever asks.
create or replace function photos.photo_for_admin_image(p_photo_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_photo photos.photo%rowtype;
begin
  if not identity.has_permission('nn.photo.check') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_photo from photos.photo where id = p_photo_id and hidden_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_photo');
  end if;

  return jsonb_build_object(
    'ok', true,
    'event_slug', v_photo.event_slug,
    'short_id', v_photo.short_id
  );
end;
$$;

comment on function photos.photo_for_admin_image(uuid) is
  'Where an unpublished photo''s copies are, for the admin image route. Nothing once taken down. Behind nn.photo.check.';

revoke all on function photos.photo_for_admin_image(uuid) from public, anon;
grant execute on function photos.photo_for_admin_image(uuid) to authenticated;
