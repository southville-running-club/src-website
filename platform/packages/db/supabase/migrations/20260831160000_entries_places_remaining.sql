-- A places-remaining count, read-only and anon-callable.
--
-- =========================================================================================
-- Why this is a new function rather than a new key on entry_state()
-- =========================================================================================
-- `entries.entry_state()` is `stable` and touches only `entries.events` and `entries.fees` —
-- two small tables with no personal data, which is why it is safe to call on every render of
-- every masthead page. Counting places taken means scanning `entries.entry_purchases` joined
-- to `entries.entrants`, which grows with every entry the race takes. Folding that into
-- `entry_state()` would put a heavier read on the one function every `/nn/*` page already
-- calls, including pages that show no capacity figure at all.
--
-- So this is its own function, called from its own endpoint (`worker/index.ts`), which is
-- not on the personalised-HTML render path at all — see that Worker's own comment on why a
-- page painted per viewer must never be cached, which is exactly the trap a places-remaining
-- count would otherwise walk back into. The endpoint answers the same figure to everybody and
-- carries a short `Cache-Control`, deliberately, because a few seconds of staleness on "how
-- many places are left" is a trade this page can make and a signed-in viewer's own entry
-- state cannot.
--
-- =========================================================================================
-- The count itself is `create_pending_purchase()`'s, read rather than re-derived
-- =========================================================================================
-- Same predicate, same two statuses: `paid`, or a `pending` hold that has not lapsed. A
-- second, slightly different definition of "taken" would be the trap CLAUDE.md already
-- names once in this file's history — a restated rule drifting from the rule it was
-- restated from. No advisory lock: a display figure does not need to serialise against a
-- concurrent purchase, and the write path re-checks capacity under its own lock regardless,
-- so this function being a moment stale changes nothing about whether an entry succeeds.
create function entries.places_remaining(p_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'capacity', event.capacity,
    'remaining', greatest(
      0,
      event.capacity - (
        select pg_catalog.count(*)::int
          from entries.entry_purchases as purchase
          join entries.entrants as entrant on entrant.purchase_id = purchase.id
         where purchase.event_id = event.id
           and (
             purchase.status = 'paid'
             or (
               purchase.status = 'pending'
               and (
                 purchase.hold_expires_at is null
                 or purchase.hold_expires_at > pg_catalog.now()
               )
             )
           )
      )
    )
  )
  from entries.events as event
  where event.slug = p_slug;
$$;

comment on function entries.places_remaining(text) is
  'A places-taken snapshot for one event: capacity and how many are left, by the same paid-or-live-pending count create_pending_purchase() enforces capacity with. Read-only, no personal data, no advisory lock — a display figure, not a reservation. Called from a dedicated cacheable endpoint, never from the personalised entry-page render.';

revoke all on function entries.places_remaining(text) from public;
grant execute on function entries.places_remaining(text) to anon, authenticated;
