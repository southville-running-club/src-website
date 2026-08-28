-- Somebody can ask twice, and the club now holds both asks.
--
-- =========================================================================================
-- The defect
-- =========================================================================================
-- `entry_purchases.requested_action` holds **one** word. `request_entry_action()` overwrites
-- it, so a runner who pressed *Transfer*, thought better of it and pressed *Cancel* left a
-- record saying only that they wanted to cancel — and a volunteer looking at *"transfer asked
-- for"* had no way to know a cancellation had been asked for afterwards.
--
-- **The two asks want opposite things.** One wants a refund and one deliberately does not, so
-- acting on the wrong one either takes a place off somebody who wanted to hand it to a friend
-- or hands on a place somebody wanted their money back for. A record that keeps only the last
-- word is a record that silently loses the disagreement.
--
-- The reason column had the same problem one field along: a second ask replaced the first
-- person's explanation with the second's, and the sentence a volunteer read no longer belonged
-- to the ask it was printed beside.
--
-- =========================================================================================
-- Expand: a table beside the column, not instead of it
-- =========================================================================================
-- `entry_purchases.requested_action`, `requested_at`, `request_reason` and
-- `request_resolved_at` all stay, holding the **most recent** ask, because the **Asked about**
-- filter, `read_entry_list()` and every deployed reader use them. Nothing is dropped and no
-- previously deployed code path changes meaning. The new table is the full history; the
-- columns are the summary that was already there.
--
-- =========================================================================================
-- Resolution is a fact about the entry rather than about one ask
-- =========================================================================================
-- There is no act that answers one ask and leaves another open: a volunteer who cancels or
-- transfers an entry has dealt with everything outstanding on it. So `resolved_at` is set on
-- every open row at once by a trigger watching `entry_purchases.request_resolved_at`.
--
-- **That is what keeps the rule in one place rather than in every function that resolves an
-- ask.** Same reasoning `enqueue_entry_email()` used for being a trigger rather than three
-- edits: it states the rule against the *transition* rather than against whichever function
-- happens to perform it, which is also what makes it correct for any future path.
--
-- ⚠️ **`transfer_entry()` sets `request_resolved_at` and `cancel_entry()` did not**, which is a
-- defect older than this table: a refunded entry went on saying "cancellation asked for" for
-- ever, and the one act that most obviously answers a request was the one act that did not
-- record having answered it. `20260829130000_entries_cancel_resolves_the_request.sql` closes it,
-- and it is a separate migration because the applied migration that last defined `cancel_entry()`
-- may not be edited.

-- -----------------------------------------------------------------------------------------
-- The table
-- -----------------------------------------------------------------------------------------
create table if not exists entries.entry_requests (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade` because an ask about a purchase that no longer exists is an ask about
  -- nothing. No path deletes a purchase today, so this is a guard rather than a behaviour.
  purchase_id uuid not null
    references entries.entry_purchases (id) on delete cascade,

  -- The same closed list `entry_purchases.requested_action` carries, and widened the same way:
  -- in a migration somebody reads.
  action text not null check (action in ('cancel', 'transfer')),

  -- **Their own words, capped exactly as the column beside it is.** Never exported — not the
  -- start list, not the England Athletics file, not the medical sheet — for the reason
  -- `gender_identity` is not: a free-text box is where somebody writes a medical fact without
  -- meaning to.
  reason text check (
    reason is null
    or length(trim(reason)) between 1 and 500
  ),

  requested_at timestamptz not null default pg_catalog.now(),

  -- Null while it is outstanding. Set for every open row on this purchase at once, by the
  -- trigger below, at the moment a volunteer deals with the entry.
  resolved_at timestamptz
);

comment on table entries.entry_requests is
  'Every ask somebody has made about their own entry, in order. The purchase columns hold the most recent one; this holds all of them, because a runner who asks to transfer and then to cancel has made two asks that want opposite things.';

create index if not exists entry_requests_purchase_idx
  on entries.entry_requests (purchase_id, requested_at desc);

-- Outstanding asks, which is the only question anybody asks of this table across all entries.
create index if not exists entry_requests_open_idx
  on entries.entry_requests (requested_at)
  where resolved_at is null;

-- **RLS on from the first migration, with no policy at all.** Principles require the first;
-- the second is the access control. Nothing selects this table directly — the reads that
-- return it are definer functions that authorise first, exactly as `email_outbox` is arranged.
alter table entries.entry_requests enable row level security;

-- -----------------------------------------------------------------------------------------
-- The history that already exists
-- -----------------------------------------------------------------------------------------
-- **One row per purchase that carries an ask today.** It is all there is to recover — the
-- column has only ever held the latest — and it is better than starting empty, because
-- otherwise every entry somebody has already asked about would read as never having asked.
insert into entries.entry_requests (purchase_id, action, reason, requested_at, resolved_at)
select purchase.id,
       purchase.requested_action,
       purchase.request_reason,
       coalesce(purchase.requested_at, purchase.created_at),
       purchase.request_resolved_at
  from entries.entry_purchases as purchase
 where purchase.requested_action is not null
   and not exists (
     select 1 from entries.entry_requests as existing
      where existing.purchase_id = purchase.id
   );

-- -----------------------------------------------------------------------------------------
-- entries.resolve_entry_requests() — the trigger that closes them together
-- -----------------------------------------------------------------------------------------
-- **Only on the transition into resolved.** `request_entry_action()` sets
-- `request_resolved_at` back to null when a new ask arrives, which is a new ask rather than a
-- resolution and must not close anything — including the row being written in the same
-- statement.
create or replace function entries.resolve_entry_requests()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
begin
  if new.request_resolved_at is not null
     and new.request_resolved_at is distinct from old.request_resolved_at
  then
    update entries.entry_requests
       set resolved_at = new.request_resolved_at
     where purchase_id = new.id
       and resolved_at is null;
  end if;

  return new;
end;
$function$;

comment on function entries.resolve_entry_requests() is
  'Closes every outstanding ask on a purchase at the moment a volunteer deals with it. A trigger rather than two edits, so cancel_entry() and transfer_entry() need no change and any future path that resolves a request is covered by the same rule.';

-- Granted to nobody, and reachable only as a trigger. Same reasoning as enqueue_entry_email().
revoke all on function entries.resolve_entry_requests() from public;

drop trigger if exists resolve_entry_requests_after_update on entries.entry_purchases;

create trigger resolve_entry_requests_after_update
  after update on entries.entry_purchases
  for each row
  execute function entries.resolve_entry_requests();

-- -----------------------------------------------------------------------------------------
-- entries.request_entry_action(uuid, text, text) — re-pasted whole, with the row it writes
-- -----------------------------------------------------------------------------------------
-- Postgres replaces a function body entire, so this is the version from
-- `20260829090000_entries_request_reason.sql` with one insert added and nothing else touched.
-- The two-argument wrapper is unchanged and goes on delegating here.
create or replace function entries.request_entry_action(
  p_purchase_id uuid,
  p_action text,
  p_reason text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_email text;
  v_reason text;
  v_updated int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_action is null or p_action not in ('cancel', 'transfer') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  v_reason := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');

  -- **Refused rather than truncated.** Silently cutting somebody's explanation in half would
  -- hand a volunteer a sentence that stops mid-word and reads as a database fault.
  if v_reason is not null and pg_catalog.length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'reason_too_long');
  end if;

  select pg_catalog.lower(account.email::text)
    into v_email
    from auth.users as account
   where account.id = auth.uid()
     and account.email_confirmed_at is not null;

  update entries.entry_purchases as purchase
     set requested_action = p_action,
         requested_at = pg_catalog.now(),
         request_reason = v_reason,
         -- Cleared, because this is a new ask. See the migration that introduced the pair.
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
  -- paid entry belonging to somebody else.
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  -- **After the update, and only when it matched.** The ownership test is the update's `where`
  -- clause; writing the history row first would record an ask against an entry the caller may
  -- have no claim to, which is exactly the oracle the single refusal above exists to prevent.
  --
  -- **Appended, never replaced.** This is the whole of the fix: a second ask is a second row,
  -- so pressing *Transfer* and then *Cancel* leaves two, in order, each with the words that
  -- were written at the time.
  insert into entries.entry_requests (purchase_id, action, reason)
  values (p_purchase_id, p_action, v_reason);

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

comment on function entries.request_entry_action(uuid, text, text) is
  'Records that the signed-in caller has asked the club to cancel or transfer one of their own paid entries, with the reason they gave, appending to entries.entry_requests as well as replacing the summary on the purchase. Authorised by auth.uid() and the caller''s confirmed address, never by the purchase id. Records the ask and performs nothing.';

revoke all on function entries.request_entry_action(uuid, text, text) from public;
grant execute on function entries.request_entry_action(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.my_entries() — so a runner sees every ask they have made
-- -----------------------------------------------------------------------------------------
-- Re-pasted whole from `20260829090000_entries_request_reason.sql`, because Postgres replaces
-- a function body entire. One key added and nothing else touched.
--
-- **The person who made two asks is the one most likely to be confused by a page showing
-- one.** They pressed *Transfer*, changed their mind, pressed *Cancel*, and the page went on
-- saying the club had a transfer request — which reads as the second press not having worked.
-- The summary keys stay exactly as they are for the sentence at the top; `requests` is the
-- list underneath it.

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
  -- property the pin was for.
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
            -- **What the entrant has asked for, so the page can say it back to them**, and
            -- the words they used to ask. Both are their own, on their own entry.
            'requested_action', purchase.requested_action,
            'request_reason', purchase.request_reason,
            'request_resolved', purchase.request_resolved_at is not null,
            -- **Every ask, in order, and not only the last one.** See this migration's header:
            -- somebody who asked twice was shown one, which reads as the second press having
            -- done nothing.
            'requests', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'action', request.action,
                    'reason', request.reason,
                    'requested_at', request.requested_at,
                    'resolved_at', request.resolved_at
                  )
                  order by request.requested_at desc, request.id
                ),
                '[]'::jsonb
              )
              from entries.entry_requests as request
             where request.purchase_id = purchase.id
            ),
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

comment on function entries.my_entries() is
  'Every entry belonging to the signed-in caller, matched on person_id or on their confirmed address, with every ask they have made about each one. Never anybody else''s, and never a medical note.';

-- -----------------------------------------------------------------------------------------
-- entries.read_entry_list() — so /admin/nn/ shows every ask rather than the last one
-- -----------------------------------------------------------------------------------------
-- Re-pasted whole from `20260829092000_entries_admin_sees_requests.sql`, because Postgres
-- replaces a function body entire. **One key added and nothing else touched** — no join
-- changed, no CTE altered, no figure recomputed.
--
-- The three summary keys that migration added stay exactly as they are, because the **Asked
-- about** filter and the wording beside the status are built on them and a Worker deployed
-- ahead of this migration must go on rendering. `requests` is the list underneath: every ask
-- on the purchase, newest first, each with the words that were written at the time.
--
-- **A correlated subquery per row rather than a join**, deliberately. The alternative is a
-- fourth join into `rows_all`, which would multiply rows the two capacity CTEs count — and
-- those counts are what the whole figures panel is built from. A page that disagreed with
-- itself about how full the race is would be a far worse defect than this one.

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
                     -- **Every ask, and not only the most recent.** The three keys above are
                     -- the summary the column has always held; this is the history beside it.
                     -- Somebody who pressed *Transfer* and then *Cancel* has asked for two
                     -- opposite things, and a volunteer who can only see the second will act
                     -- on the wrong one about half the time.
                     'requests', (
                       select coalesce(
                         jsonb_agg(
                           jsonb_build_object(
                             'action', request.action,
                             'reason', request.reason,
                             'requested_at', request.requested_at,
                             'resolved_at', request.resolved_at
                           )
                           order by request.requested_at desc, request.id
                         ),
                         '[]'::jsonb
                       )
                       from entries.entry_requests as request
                      where request.purchase_id = listed.purchase_id
                     ),
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
  'Every purchase for one event with its entrants left joined — one row per person — plus every ask that has been made about each, every discount code on the event with how many of it have gone, and the code each entry was bought with. Granted to nobody: reachable only from entries.admin_entry_list() and entries.entry_list().';
