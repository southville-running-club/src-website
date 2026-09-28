-- ==========================================================================================
-- The races a marshal is on, for the marshal asking
-- ==========================================================================================
--
-- Under [ADR-036](../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
--
-- ## The gap this closes
--
-- **`/timing` is a marshal's way in and it had nothing to send them to.** Their one permission,
-- `timing.crossing.record`, opens the landing page and the capture screen at
-- `/timing/marshal/<slug>/` — and nothing in this schema answers *"which slugs"* to the marshal
-- asking. `marshal_event()` answers for one slug they already know; `list_events()` and the four
-- roster functions are behind `timing.event.manage` and `timing.marshal.assign`, which are an
-- admin's. So the address of the screen they are standing at the line to use had to reach them
-- by message, and the landing page could only say that it existed.
--
-- ## One read, the same two checks, and nobody else's roster
--
-- The permission first and then the scope, in `marshal_event()`'s order, so the two cannot
-- disagree about who is on a roster: a race this lists is exactly a race `marshal_event()` opens
-- to the same person. **It reads the caller's own `timing.marshals` rows and nobody else's**, so
-- it cannot be used to learn who else is marshalling, or which races exist that the caller is
-- not on.
--
-- ⚠️ **The columns are a subset of `marshal_event()`'s and must stay one.** The slug, the name
-- and the three instants — enough to draw a link and say whether the gun has gone. `format` is
-- left out because the landing page reasons from nothing; the capture screen reads it from
-- `marshal_event()` when it opens. This is the weakest timing permission there is, so a column
-- added here is added to a surface every marshal can read.
--
-- ## Null for no permission, an empty array for no races
--
-- Two different answers, deliberately, as `known_crossings()` does: null means *"you may not"*,
-- and a marshal who has been granted the role but not yet put on a race is an ordinary state
-- the page has a sentence for.

create or replace function timing.my_marshal_events()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
begin
  if not identity.has_permission('timing.crossing.record') then
    return null;
  end if;

  return coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'slug', e.slug,
                 'name', e.name,
                 'start_at', e.start_at,
                 'actually_started_at', e.actually_started_at,
                 'finished_at', e.finished_at
               )
               order by e.start_at desc, e.slug
             )
        from timing.events e
        join timing.marshals m on m.event_id = e.id
       where m.user_id = auth.uid()
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function timing.my_marshal_events() is
  'The races the caller is rostered on, for /timing''s landing page. timing.crossing.record '
  'and the caller''s own timing.marshals rows, in marshal_event()''s order; null without the '
  'permission, [] with no races.';

revoke all on function timing.my_marshal_events() from public, anon;
grant execute on function timing.my_marshal_events() to authenticated;
