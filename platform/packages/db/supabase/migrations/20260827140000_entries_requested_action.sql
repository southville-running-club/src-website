-- A runner can ask; a volunteer decides. Nothing here changes an entry.
--
-- =========================================================================================
-- What this is, and what it deliberately is not
-- =========================================================================================
-- Somebody who can no longer run has had one route to the club: find an address on a page and
-- write an email that says "Mark, 27 August" and nothing a volunteer can act on. This records
-- the ask **against the entry**, so `/admin/nn/` can show which entries somebody wants
-- something done to, with the purchase id already attached.
--
-- **It performs nothing.** Recording that somebody asked for a transfer is not transferring
-- anything, and CLAUDE.md is explicit that transfers, corrections, manual entries, resends and
-- partial refunds are each a stop-and-ask — a decision about changing a record somebody paid
-- for. Cancelling already has its answer in `entries.cancel_entry()` and ADR-018. Transferring
-- does not have one yet, and this migration does not invent it: the admin surface will show
-- the request and offer no button for it.
--
-- =========================================================================================
-- On the purchase row, not in a table of its own
-- =========================================================================================
-- The same argument #73 makes about the confirmation email, and it holds harder here. A
-- separate `entry_requests` table would copy an entry's identity into a second place, need its
-- own row-level security decision, its own negative-case suite and its own retention story —
-- and would introduce a "wrote the request, lost the entry" state that cannot happen when they
-- are one row.
--
-- **No personal data is added.** Three columns: which of two words was asked for, when, and
-- when a volunteer dealt with it. The person is already on the row. That matters because
-- CLAUDE.md makes a column holding personal data a committee decision, and this is deliberately
-- not one.
--
-- The shape copies `attention` / `attention_resolved_at` exactly, because it is the same shape:
-- something a human has to look at, and a mark saying somebody has.

alter table entries.entry_purchases
  add column if not exists requested_action text
    check (requested_action is null or requested_action in ('cancel', 'transfer')),
  add column if not exists requested_at timestamptz,
  add column if not exists request_resolved_at timestamptz;

comment on column entries.entry_purchases.requested_action is
  'What the entrant has asked the club to do with this entry: cancel, transfer, or null for nothing asked. A request, never an action — nothing in this schema acts on it.';

-- **Expand, migrate, contract.** All three are nullable with no default and no backfill, so
-- every deployed Worker that predates them goes on working and a rollback costs nothing. There
-- is no `NOT VALID` constraint here to validate later — the check is on a column that is null
-- in every existing row, so it is valid the moment it is added.

-- =========================================================================================
-- entries.request_entry_action() — the runner's half
-- =========================================================================================
-- **Authorised exactly as `my_entries()` is, and by nothing the caller passes.** A purchase id
-- is not a credential: it is on the confirmation page, in an email, and now on
-- `/account/entries/`. So ownership is re-derived here from `auth.uid()` and the caller's
-- *confirmed* address, character for character the predicate `my_entries()` uses. Anything
-- else would let somebody who had seen a reference cancel a stranger's race.
--
-- **Refuses on a purchase that is not `paid`.** There is nothing to ask about an entry the
-- club has not recorded a place for, and letting a lapsed hold carry a request would put rows
-- on the volunteers' list that resolve themselves.
--
-- **Idempotent, and the last word wins.** Pressing the button twice is one request; changing
-- from cancel to transfer replaces it. Neither creates a second row, because there are no rows
-- to create.
create or replace function entries.request_entry_action(
  p_purchase_id uuid,
  p_action text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_email text;
  v_updated int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_action is null or p_action not in ('cancel', 'transfer') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  select pg_catalog.lower(account.email::text)
    into v_email
    from auth.users as account
   where account.id = auth.uid()
     and account.email_confirmed_at is not null;

  update entries.entry_purchases as purchase
     set requested_action = p_action,
         requested_at = pg_catalog.now(),
         -- **Cleared, because this is a new ask.** A volunteer who dealt with a cancellation
         -- request last week must see a transfer request this week rather than a resolved mark
         -- sitting over it.
         request_resolved_at = null
   where purchase.id = p_purchase_id
     and purchase.status = 'paid'
     and (
       purchase.person_id = auth.uid()
       or (
         v_email is not null
         and pg_catalog.lower(purchase.purchaser_email::text) = v_email
       )
     );

  get diagnostics v_updated = row_count;

  -- **One refusal for "not yours" and "not there" and "not paid".** Distinguishing them would
  -- turn this into an oracle: somebody holding a reference could learn whether it names a real,
  -- paid entry belonging to somebody else. `admin_entry_list()` makes the same trade.
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

comment on function entries.request_entry_action(uuid, text) is
  'Records that the signed-in caller has asked the club to cancel or transfer one of their own paid entries. Authorised by auth.uid() and the caller''s confirmed address, never by the purchase id, which is not a credential. Records the ask and performs nothing.';

revoke all on function entries.request_entry_action(uuid, text) from public;

-- **`authenticated` only, and never `anon`.** There is nothing for a signed-out caller to
-- authorise against — the whole predicate is `auth.uid()`, which is null for `anon`, so a grant
-- there would be a function that always refuses, sitting on the list that
-- `packages/db/tests/entries.test.ts` exists to keep short.
grant execute on function entries.request_entry_action(uuid, text) to authenticated;


-- =========================================================================================
-- The two reads that have to carry it
-- =========================================================================================
-- **A request nobody can see is a worse feature than no request at all**, because the person
-- who made it believes the club has it. So both readers are re-emitted here: `my_entries()` so
-- the runner sees their own ask reflected back, and `read_entry_list()` so `/admin/nn/` can
-- show which entries somebody wants something done to.
--
-- Neither widens what it discloses about anybody else. The runner sees their own request on
-- their own row; the admin surface already returns every field on these purchases to somebody
-- holding `nn.entry.read`.

create or replace function entries.my_entries()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  -- **`text`, lowered, rather than `citext`.** With `search_path = ''` the citext equality
  -- operator — which lives in `extensions`, not `pg_catalog` — is not resolvable, and a
  -- definer function that unpins its search_path to get one operator has given away the
  -- property the pin was for. The same trap `create_pending_purchase()` documents on the
  -- discount code, and the same answer.
  v_email text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  select pg_catalog.lower(account.email::text)
    into v_email
    from auth.users as account
   where account.id = auth.uid()
     and account.email_confirmed_at is not null;

  return jsonb_build_object(
    'ok', true,
    'entries', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'purchase_id', purchase.id,
            'event_slug', event.slug,
            'event_name', event.display_name,
            'event_date', event.event_date,
            'start_time', event.start_time,
            'status', purchase.status,
            'amount_pence', purchase.amount_pence,
            'fee_label', fee.label,
            'purchaser_name', purchase.purchaser_name,
            'paid_at', purchase.paid_at,
            'created_at', purchase.created_at,
            -- **What the entrant has asked for, so the page can say it back to them.** Null
            -- until they press a button. It is their own request on their own entry, which is
            -- the one thing on this row that is theirs to see and no widening of what this
            -- function discloses about anybody else.
            'requested_action', purchase.requested_action,
            'request_resolved', purchase.request_resolved_at is not null,
            'entrants', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'first_name', entrant.first_name,
                    'last_name', entrant.last_name,
                    'club', entrant.club
                  )
                  order by entrant.leg, entrant.last_name
                ),
                '[]'::jsonb
              )
              from entries.entrants as entrant
             where entrant.purchase_id = purchase.id
            )
          )
          -- Newest first. Somebody with three years of entries wants this year's at the top.
          order by event.event_date desc, purchase.created_at desc
        ),
        '[]'::jsonb
      )
      from entries.entry_purchases as purchase
      join entries.events as event on event.id = purchase.event_id
      join entries.fees as fee on fee.id = purchase.fee_id
     where purchase.person_id = auth.uid()
        or (
          v_email is not null
          and pg_catalog.lower(purchase.purchaser_email::text) = v_email
        )
    )
  );
end;
$$;

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
           p.created_at,
           p.paid_at,
           p.revived_at,
           p.hold_expires_at,
           p.requested_action,
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
           entrant.ea_number,
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
                     'ea_number', listed.ea_number,
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
