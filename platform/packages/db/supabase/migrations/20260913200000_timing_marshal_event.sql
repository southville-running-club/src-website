-- ==========================================================================================
-- The one read a marshal is allowed: the race they are standing on the line of
-- ==========================================================================================
--
-- Issue [#203](https://github.com/southville-running-club/src-website/issues/203), under
-- [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
-- and [ADR-036](../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
--
-- ## The gap this closes, which is older than this issue
--
-- ⚠️ **Nothing in this schema answers *"am I on this roster"* to the marshal asking.** #245
-- built four roster functions and every one of them is behind `timing.marshal.assign` — an
-- admin's permission, which a `timing-marshal` does not hold. So `middleware.ts`'s
-- `rosterScoped` branch has been refusing `/timing/marshal/<slug>/` outright since #243, with
-- a comment saying so, because refusing was the only answer that could not be shipped by
-- accident. This is the read that lets it stop refusing.
--
-- **It is one function and not two, deliberately.** A bare `am_i_rostered()` boolean would
-- have been enough for the door, and the screen behind the door needs the race's name, its
-- format and when it started — facts that live on `timing.events`, which a marshal may not
-- read through `event_detail()` either. Two functions would mean two round trips and two
-- places the roster rule is written down. **`event_detail()` is not widened instead**: it is
-- `timing.event.manage`'s, it carries counts and course notes a marshal has no use for, and
-- widening a read is how a surface stops meaning what its permission says.
--
-- ## `format` is the fact the screen cannot work without
--
-- `parseBib()` reads relay bibs leg-first (`147` is leg 1, team 47) and solo bibs whole, so
-- the same string means different things on different races — and the anomaly the marshal is
-- shown at confirm time is derived from it. Getting it from the server is the only way it can
-- be right; a screen that guessed would flag the wrong crossings on the one race where being
-- wrong cannot be undone.
--
-- ## Null for all three refusals, which is this schema's shape
--
-- No permission, no such event, and not on the roster all answer `null` — indistinguishable,
-- so a slug cannot be probed and a roster cannot be enumerated. `lib/reads.ts` turns that into
-- `state: 'none'` and the page says "Not found", which is the same page a stranger gets.

create or replace function timing.marshal_event(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  -- The permission first, then the scope — ADR-036's order, and the same order
  -- `record_crossing()` takes. A `timing-admin` holding `timing.crossing.record` but not
  -- rostered is refused here exactly as a marshal is; they add themselves with
  -- `assign_marshal()`.
  if not identity.has_permission('timing.crossing.record') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  if not exists (
    select 1 from timing.marshals m
     where m.event_id = v_event.id
       and m.user_id = auth.uid()
  ) then
    return null;
  end if;

  -- ⚠️ **No counts, no course notes, no `distance_m`.** Every column here is one the capture
  -- screen renders or reasons from: the name so a marshal can see which race they are on, the
  -- format so bibs parse, and the three instants so the screen can say whether the gun has
  -- gone. Adding a column here is adding it to a surface behind the weakest timing permission
  -- there is.
  return jsonb_build_object(
    'slug', v_event.slug,
    'name', v_event.name,
    'format', v_event.format,
    'start_at', v_event.start_at,
    'actually_started_at', v_event.actually_started_at,
    'finished_at', v_event.finished_at
  );
end;
$$;

revoke all on function timing.marshal_event(text) from public, anon;
grant execute on function timing.marshal_event(text) to authenticated;
