-- The admin surface can finally see what somebody asked for.
--
-- =========================================================================================
-- The defect
-- =========================================================================================
-- `entries.request_entry_action()` has recorded which of two words somebody asked for since the
-- request slice, and `read_entry_list()` has carried `requested_action` and `request_resolved_at`
-- into its `rows_all` CTE ever since. **Neither has ever been emitted in the rows it returns.**
--
-- So `/admin/nn/` renders `entry.requestedAction` as null on every row, whatever anybody asked
-- for: the wording beside the status never appears, and the **Asked about** filter matches
-- nothing and always has. A volunteer pressing it sees an empty table and concludes nobody has
-- asked the club for anything — which is the same failure the **Refunded** filter had before
-- #116, one column along, and it fails in the same direction: towards *everything is fine*.
--
-- **A request nobody can see is worse than no request at all**, because the runner who made it
-- has been told the club has it.
--
-- =========================================================================================
-- Re-pasted whole, from the newest definition
-- =========================================================================================
-- Postgres replaces a function body entire, so this is `20260828210000_nn_2026_lhg_discount_code`'s
-- version — discount codes, guides and all — with three keys added and nothing else touched.
-- `request_reason` is the column added beside it in this pull request: the words somebody used,
-- which is what a volunteer deciding between a refund and a transfer actually needs.
--
-- **Read here and on `/account/entries/` and nowhere else.** Not the start list, not the England
-- Athletics file, not the medical sheet — for the reason `gender_identity` is not exported: a
-- free-text box is where somebody writes a medical fact without meaning to, and a document read
-- by marshals is the wrong place for it to surface.

create or replace function entries.read_entry_list(p_event_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with event as (
    select e.*
      from entries.events as e
     where e.slug = p_event_slug
  ),
  -- Every purchase against this event, once, with the two derived facts the counts below need.
  -- Pulled out rather than repeated so "a live hold" is written exactly once in this function.
  purchase as (
    select p.id,
           p.status,
           p.amount_pence,
           p.attention,
           p.attention_resolved_at,
           p.fee_id,
           p.discount_code_id,
           p.created_at,
           p.paid_at,
           p.revived_at,
           p.hold_expires_at,
           p.requested_action,
           p.request_reason,
           p.request_resolved_at,
           (
             p.status = 'pending'
             and (p.hold_expires_at is null or p.hold_expires_at > pg_catalog.now())
           ) as hold_live
      from entries.entry_purchases as p
      join event on event.id = p.event_id
  ),
  -- The capacity predicate, character for character the one `create_pending_purchase()` counts
  -- with: a paid purchase, or a pending one whose hold has not run out.
  holding as (
    select entrant.id
      from purchase
      join entries.entrants as entrant on entrant.purchase_id = purchase.id
     where purchase.status = 'paid'
        or purchase.hold_live
  ),
  rows_all as (
    select entrant.id as entrant_id,
           purchase.id as purchase_id,
           entrant.first_name,
           entrant.last_name,
           entrant.club,
           -- **The same expression `create_pending_purchase()` enforces the minimum age
           -- with.** Completed years at `event_date`, so a birthday on race day counts. The
           -- band it falls in is named in TypeScript, by the one module that owns that rule.
           pg_catalog.date_part(
             'year',
             pg_catalog.age(
               event.event_date::timestamp,
               entrant.date_of_birth::timestamp
             )
           )::int as age,
           entrant.gender,
           -- **The one read of this column anywhere.** Null for most rows, because most people
           -- will not answer an optional question, and the page renders nothing when it is.
           entrant.gender_identity,
           -- **Which of the two people on this purchase the row is.** A visually
           -- impaired runner and their guide are two rows of one entry, and
           -- `amount_pence` below is a fact about the *purchase* — so without this
           -- the page renders £20.00 twice and a volunteer reading down the column
           -- counts £40. The figures panel sums over purchases and always did, so
           -- the page would have disagreed with itself and the total would have been
           -- the half that was right.
           --
           -- Null for a cancelled entry, because the entrant is left joined and
           -- `cancel_entry()` deletes them. That row already renders as "No runner
           -- recorded"; a role for nobody would be a fourth thing to explain.
           entrant.role,
           entrant.ea_number,
           -- **The code this entry was bought with, or null.** Left joined, because most
           -- entries carry none — and resolved to the code itself rather than left as an id,
           -- because the page shows it beside the amount and an id means nothing to a
           -- volunteer looking for who used the Left Handed Giant allocation.
           discount.code::text as discount_code,
           fee.code as fee_code,
           fee.label as fee_label,
           fee.requires_ea_number,
           purchase.amount_pence,
           purchase.status,
           purchase.attention,
           purchase.attention_resolved_at,
           purchase.created_at,
           purchase.paid_at,
           purchase.revived_at,
           -- **So the page can say how long a held place has left**, which is the difference
           -- between "somebody is paying right now" and "this place is about to come back". The
           -- status alone cannot tell those apart: a `pending` row whose hold has lapsed is still
           -- `pending` until the five-minute sweep reaches it. Not personal data, and the one
           -- fact on the row that is about the clock rather than about a person.
           purchase.hold_expires_at,
           -- **Which entries somebody has asked the club to do something about**, and whether a
           -- volunteer has marked it dealt with. The pair travels together for the same reason
           -- `attention` and `attention_resolved_at` do: a flag with no way to clear it becomes
           -- a flag nobody looks at.
           purchase.requested_action,
           purchase.request_reason,
           purchase.request_resolved_at is not null as request_resolved,
           exists (
             select 1 from entries.entrant_medical as medical
              where medical.entrant_id = entrant.id
           ) as has_medical
      -- **Purchase-driven, with the entrant left joined.** It was entrant-driven, and that is
      -- what made a cancelled entry vanish from the page entirely: `cancel_entry()` deletes
      -- the entrants, so an inner join here had nothing to match and the purchase stopped
      -- existing as far as `/admin/nn/` was concerned. The row is the *purchase* — it is what
      -- has a status, an amount and a Stripe reference — and the runner is a fact about it
      -- that a refund legitimately removes.
      from purchase
      left join entries.entrants as entrant on entrant.purchase_id = purchase.id
      cross join event
      join entries.fees as fee on fee.id = purchase.fee_id
      left join entries.discount_codes as discount on discount.id = purchase.discount_code_id
  ),
  -- Newest first for the cap, so what is dropped is the oldest rather than an arbitrary
  -- slice. `entrant_id` is the tiebreaker, which is what makes "the most recent 2,000" mean one
  -- specific set rather than whatever the planner felt like for two rows in the same millisecond.
  rows_capped as (
    -- `entrant_id` is null for a cancelled entry now, so it can no longer be the whole
    -- tiebreaker. `purchase_id` behind it keeps "the most recent 2,000" meaning one specific
    -- set rather than whatever the planner felt like for two rows in the same millisecond.
    select * from rows_all
     order by created_at desc, entrant_id nulls last, purchase_id
     limit 2000
  )
  select case
    when not exists (select 1 from event)
      then jsonb_build_object('ok', false, 'reason', 'no_such_event')
    else jsonb_build_object(
      'ok', true,
      'event', (
        select jsonb_build_object(
          'slug', event.slug,
          'display_name', event.display_name,
          'event_date', event.event_date,
          'capacity', event.capacity,
          'taken', (select pg_catalog.count(*)::int from holding),
          'attention', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.attention is not null
               and purchase.attention_resolved_at is null
          ),

          -- ---------------------------------------------------------------------------------
          -- The entry window, for the bar at the top of the page
          -- ---------------------------------------------------------------------------------
          -- **Both are null for Nightingale Nightmare today**, and that is a decision the club
          -- has not taken rather than a gap in this function. The page says so in those words;
          -- it does not invent a closing time, because a published claim about when a race
          -- closes is exactly the kind a runner arranges a weekend around.
          'entries_open_at', event.entries_open_at,
          'entries_close_at', event.entries_close_at,

          -- ---------------------------------------------------------------------------------
          -- Where the race stands
          -- ---------------------------------------------------------------------------------
          'paid', (
            select pg_catalog.count(*)::int from purchase where purchase.status = 'paid'
          ),
          -- Paid, flagged, and nobody has cleared the flag. A subset of `paid` rather than a
          -- fifth status — there deliberately is no fifth status, because the capacity predicate
          -- counts `status = 'paid'` and a new value would be invisible to it.
          'over_capacity', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.status = 'paid'
               and purchase.attention = 'over_capacity'
               and purchase.attention_resolved_at is null
          ),
          'held', (select pg_catalog.count(*)::int from purchase where purchase.hold_live),
          -- Every hold that is no longer holding: marked `expired`, or still `pending` with a
          -- lapsed hold because the sweep has not reached it. Both are places that came back.
          'holds_returned', (
            select pg_catalog.count(*)::int
              from purchase
             where purchase.status = 'expired'
                or (purchase.status = 'pending' and not purchase.hold_live)
          ),
          'refunded', (
            select pg_catalog.count(*)::int from purchase where purchase.status = 'refunded'
          ),
          -- **Paid only.** A pending hold is somebody halfway through a payment page and an
          -- expired one is a place that came back; neither is money the club has. Stripe's own
          -- figure is the authority on what actually settled, net of card fees, and the page
          -- says so rather than implying this is a bank balance.
          'fees_pence', (
            select coalesce(pg_catalog.sum(purchase.amount_pence), 0)::bigint
              from purchase
             where purchase.status = 'paid'
          ),

          -- ---------------------------------------------------------------------------------
          -- The two panels
          -- ---------------------------------------------------------------------------------
          -- A count of notes, never a note. Paid entries only: the medical sheet is a race-day
          -- document and a lapsed hold is not a runner.
          'medical_count', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.entrant_medical as medical on medical.entrant_id = entrant.id
             where purchase.status = 'paid'
          ),
          'affiliated', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.fees as fee on fee.id = purchase.fee_id
             where purchase.status = 'paid'
               and fee.requires_ea_number
          ),
          -- The state described in this migration's header: a fee that requires a number, and no
          -- number. Reachable through `create_pending_purchase()`, which does not check it.
          'affiliated_missing_ea', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.fees as fee on fee.id = purchase.fee_id
             where purchase.status = 'paid'
               and fee.requires_ea_number
               and entrant.ea_number is null
          ),

          -- ---------------------------------------------------------------------------------
          -- Retention — the mechanism, not the published sentence
          -- ---------------------------------------------------------------------------------
          'medical_retention', event.medical_retention::text,
          'medical_delete_after', (event.event_date + event.medical_retention)::date
        )
        from event
      ),
      -- ---------------------------------------------------------------------------------
      -- The codes on offer, and how much of each is left
      -- ---------------------------------------------------------------------------------
      -- **The whole point of putting them here rather than in a runbook nobody opens.** A code
      -- is generated by a migration and exists only in this database — it is deliberately not
      -- in the repository, which is public — so this read is the only way anybody finds out
      -- what it is in order to tell the club it belongs to.
      --
      -- `uses` is the live count and it goes **down** as well as up: a lapsed hold and a
      -- refund each give a use back. So a number that looks wrong in the middle of a rush is
      -- probably a hold that has not expired yet.
      --
      -- Safe to return here for the same reason every name on this page is: `read_entry_list`
      -- is granted to nobody and is reachable only behind `nn.entry.read`.
      'discount_codes', coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'code', code.code::text,
                     'percent_off', code.percent_off,
                     'max_uses', code.max_uses,
                     'uses', code.uses,
                     'active', code.active,
                     -- Which fee it applies to, or null for any. "10% off an unaffiliated
                     -- entry" is two facts and the page has to be able to say both.
                     'fee_code', fee.code
                   )
                   order by code.code::text
                 )
            from entries.discount_codes as code
            left join entries.fees as fee on fee.id = code.fee_id
           where code.event_id = (select id from event)
        ),
        '[]'::jsonb
      ),
      'total', (select pg_catalog.count(*)::int from rows_all),
      'returned', (select pg_catalog.count(*)::int from rows_capped),
      'entries', coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'entrant_id', listed.entrant_id,
                     'purchase_id', listed.purchase_id,
                     'first_name', listed.first_name,
                     'last_name', listed.last_name,
                     'club', listed.club,
                     'age', listed.age,
                     'gender', listed.gender,
                     'gender_identity', listed.gender_identity,
                     'role', listed.role,
                     -- ⚠️ **The defect this migration closes.** These three have been selected
                     -- into `rows_all` since requests were added and emitted by nothing, so
                     -- `/admin/nn/` rendered every row's request as null: the wording beside
                     -- the status never appeared and the **Asked about** filter could never
                     -- match. A volunteer clicking it concluded nobody had asked for anything.
                     --
                     -- Exactly the shape of the refunded-filter defect one column along — and
                     -- a request nobody can see is worse than no request at all, because the
                     -- person who made it believes the club has it.
                     'requested_action', listed.requested_action,
                     'request_reason', listed.request_reason,
                     'request_resolved', listed.request_resolved,
                     'ea_number', listed.ea_number,
                     'discount_code', listed.discount_code,
                     'fee_code', listed.fee_code,
                     'fee_label', listed.fee_label,
                     'requires_ea_number', listed.requires_ea_number,
                     'amount_pence', listed.amount_pence,
                     'status', listed.status,
                     'attention', listed.attention,
                     'attention_resolved', listed.attention_resolved_at is not null,
                     'has_medical', listed.has_medical,
                     'created_at', listed.created_at,
                     'paid_at', listed.paid_at,
                     'hold_expires_at', listed.hold_expires_at,
                     'revived', listed.revived_at is not null
                   )
                   order by listed.last_name, listed.first_name, listed.entrant_id
                 )
            from rows_capped as listed
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

comment on function entries.read_entry_list(text) is
  'Every purchase for one event with its entrants left joined — one row per person — plus every discount code on the event with how many of it have gone, and the code each entry was bought with. The codes are here because they exist nowhere else: a code is minted by a migration and never written into this repository, so this read is how somebody finds out what it is. Granted to nobody: reachable only from entries.admin_entry_list() and entries.entry_list().';
