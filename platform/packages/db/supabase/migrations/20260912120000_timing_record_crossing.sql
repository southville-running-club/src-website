-- ==========================================================================================
-- A crossing reaches the database through one function, idempotent on the client's id
-- ==========================================================================================
--
-- Issue #251, under
-- [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
-- and [ADR-036](../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
-- `timing.crossings` has had row-level security on, no policy, and no writer since it was
-- created. This is the write path, and it is the contract #203's screen syncs against.
--
-- ## A function rather than a table policy, which is what the old application used
--
-- The old application wrote through a policy on the table with `upsert(onConflict: 'id')`.
-- ADR-035 keeps the upsert *contract* and this schema's rule is that a policy arrives with the
-- surface that needs it — and this surface is better served by a function that authorises
-- inside itself, the way every `entries` write does. A table policy would also have to express
-- "on the roster for this event", which is a join, and a policy that is a join is a rule
-- nobody can read.
--
-- ## ⚠️ `on conflict (id) do nothing`, and why not `do update`
--
-- The client generates the id, so a retry after a lost response presents the same row again.
-- **`do nothing` rather than `do update` is the whole decision**: an admin may have corrected
-- the bib since it first landed, and a marshal's phone draining a queue an hour later must not
-- overwrite that correction with what it recorded at the time. The retry is still a **success**
-- — it answers `ok`, so the queue retires the card rather than retrying for ever.
--
-- **`p_anomaly_flag` and `p_anomaly_reason` are stored verbatim and never recomputed.** They
-- are the client's verdict *at confirm time*, which is the only moment the marshal was looking
-- at the line; re-deriving them here against rows that have since changed would silently
-- rewrite what somebody actually saw. That reasoning is the old application's and it survives.
--
-- ## Timestamps are the client's, and this function does not second-guess them
--
-- `captured_at` is the phone's clock at the tap. Nothing server-side replaces it, because the
-- sync may be minutes or an hour later — `now()` would record when the signal came back, which
-- is not a time anybody ran. The runbook tells marshals to let their phones set time
-- automatically, and that instruction is load-bearing rather than housekeeping.
--
-- ## ⚠️ The roster is checked for everybody, including an admin
--
-- ADR-036: `timing.marshals` is a scope checked **after** the permission, never instead of it,
-- and never bypassed by holding a role. A `timing-admin` holds `timing.crossing.record` and is
-- still refused on an event they are not rostered to — they add themselves, which is
-- [#245](https://github.com/southville-running-club/src-website/issues/245)'s
-- `assign_marshal()`. The old application let a global admin bypass this and that is precisely
-- what is being replaced.
--
-- ## An unknown bib is stored, never refused
--
-- `crossings_resolve_team` already resolves `team_id` from the bib. A bib matching nothing
-- lands with `team_id` null and **no error**: an anomaly flags and never blocks, and a marshal
-- at a finish line cannot stop to argue with a validator. The admin resolves it afterwards,
-- when there is time to be right.
--
-- ## What is deliberately not built
--
-- **No batch form.** #251 lists `record_crossings(jsonb)` for the drain and marks it *optional;
-- measure first*. There is nothing to measure until #203's queue exists, and a batch built
-- ahead of its caller is a second contract to keep working. #203 measures a forty-row drain and
-- adds it if the round trips actually cost something.

-- ------------------------------------------------------------------------------------------
-- record_crossing — one tap, however many times it is sent
-- ------------------------------------------------------------------------------------------
create or replace function timing.record_crossing(
  p_id uuid,
  p_event_slug text,
  p_bib text,
  p_captured_at timestamptz,
  p_source text default 'tap',
  p_anomaly_flag boolean default false,
  p_anomaly_reason text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  -- `identity.has_permission` reads `auth.uid()` from the request's own token, which
  -- `security definer` does not change.
  if not identity.has_permission('timing.crossing.record') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- The scope, checked after the permission and for everybody. See the header.
  if not exists (
    select 1 from timing.marshals m
     where m.event_id = v_event.id
       and m.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_on_roster');
  end if;

  if p_id is null or p_captured_at is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  if p_source is null or p_source not in ('tap', 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_source');
  end if;

  -- ⚠️ `do nothing`, not `do update`. See the header: a retry must not overwrite a bib an
  -- admin has corrected since. `marshal_id` is `auth.uid()` and never a parameter — a client
  -- that could name the marshal could attribute somebody else's work.
  insert into timing.crossings (
    id, event_id, marshal_id, bib, captured_at, source, anomaly_flag, anomaly_reason
  )
  values (
    p_id,
    v_event.id,
    auth.uid(),
    p_bib,
    p_captured_at,
    p_source,
    coalesce(p_anomaly_flag, false),
    p_anomaly_reason
  )
  on conflict (id) do nothing;

  -- `ok` whether or not this call is the one that wrote the row. A retry of something that
  -- landed is a success, and the queue has to be able to retire the card.
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function timing.record_crossing(
  uuid, text, text, timestamptz, text, boolean, text
) from public, anon;
grant execute on function timing.record_crossing(
  uuid, text, text, timestamptz, text, boolean, text
) to authenticated;

-- ------------------------------------------------------------------------------------------
-- known_crossings — what this race already has, so two phones do not both record it
-- ------------------------------------------------------------------------------------------
-- Behind the same two checks as the write. `null` when refused and the same `null` for an
-- event that does not exist, which is every other read in this schema's shape.
--
-- ⚠️ **No marshal identity in the answer.** This is for cross-device duplicate detection, and
-- who recorded a crossing is not a fact a marshal screen needs to do that. It is on
-- `timing.crossings.marshal_id` for an admin resolving an anomaly, and that is a different
-- surface behind a different permission.
create or replace function timing.known_crossings(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
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

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'bib', c.bib,
        'captured_at', c.captured_at,
        'anomaly_flag', c.anomaly_flag
      ) order by c.captured_at
    )
    from timing.crossings c
    where c.event_id = v_event.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function timing.known_crossings(text) from public, anon;
grant execute on function timing.known_crossings(text) to authenticated;
