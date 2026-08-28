-- =========================================================================================
-- The club stops asking for England Athletics numbers, and stops holding the ones it has
-- =========================================================================================
-- Committee decision, 29 August 2026. A runner states that they are affiliated and the club
-- takes their word for it. The £18/£20 split stays exactly as it is, the £2 gap is still
-- ARC's Unattached Runner Levy under Rule 21(2)(b), and the only thing that changes is that
-- nobody is asked for a number and nothing holds one.
--
-- **Two consequences were put to the committee and accepted.** Under Rule 21(2)(b) the club
-- will have no record of *who* claimed affiliation, only that they paid the affiliated £18 —
-- accepted. And the privacy notice now says the club reserves the right to ask a runner to
-- produce their number or other evidence of affiliation, which is what replaces the check
-- this column was for. Both privacy pages carry that sentence in the same commit as this file.
--
-- This is not a re-litigation of the decision. What follows is how it is applied without
-- breaking the Worker that is deployed while it lands.
--
-- =========================================================================================
-- This is the expand step. The contract step is written down and is still owing
-- =========================================================================================
-- `entries.entrants.ea_number` is **not dropped here**, and neither is
-- `entries.fees.requires_ea_number`. Nothing sequences a migration against the Cloudflare
-- deploy, so for some minutes the schema this file produces is read by the Worker built
-- before it. That Worker's `entryShape` in `packages/shared/src/admin.ts` parses `ea_number`
-- and `requires_ea_number` as **required** nullable keys — a missing key is a parse failure,
-- not a null — so dropping either one would take the whole of `/admin/nn/` down mid-deploy,
-- and `read_export()`'s England Athletics file with it.
--
-- So both columns stay, both reads go on emitting their keys, and every value is the empty
-- one: `ea_number` is null on every row and `requires_ea_number` is false on every fee. A
-- Worker from either side of the deploy reads a well-formed answer.
--
-- **The contract step drops both columns, the keys, and `transfer_entry()`'s tenth argument**,
-- once this build is deployed. It is written down in
-- docs/delivery/runbooks/entries-ea-number-contract.md, which is what a volunteer picks up,
-- and it is named in CLAUDE.md so nobody has to find the runbook first.
--
-- =========================================================================================
-- What actually stops the collection, in the order it has to happen
-- =========================================================================================
-- **1. `fees.requires_ea_number` goes false on every fee, and that alone stops collection.**
-- The form asks for a number only when `entries.entry_state()` reports a fee that wants one,
-- and `create_pending_purchase()` writes one only for a fee that wants one — it already
-- normalises a supplied number to null against a fee that does not, in the `case` on
-- `v_fee.requires_ea_number` at the entrant insert. So collection stops **the moment this
-- migration applies**, before anything is deployed: the Worker that is live reads the flag at
-- request time, stops revealing the box, stops requiring the field, and anything a person
-- typed into a cached copy of the page is dropped rather than stored.
--
-- **2. Then the numbers already held are deleted.** In that order, and the order is load-
-- bearing: `assert_entrant_rules()` enforces a biconditional — a fee that requires a number
-- must have one — so nulling the column while any fee still said `true` would raise
-- `check_violation` on every affiliated row. With the flag false the same trigger requires the
-- column to be null, which is exactly what the update is doing.
--
-- **3. Then two check constraints, because "we stopped asking" is not the same as "it cannot
-- happen again".** The mechanism is deliberately *both*, and they close different holes:
--
--   * `entrants_ea_number_not_collected` — `ea_number is null`. One line, on the table that
--     holds the data, true regardless of what any fee row says. This is the guard a reader can
--     see without following a trigger into two other tables, and it is what makes the deletion
--     above permanent rather than a tidy-up somebody can undo with an insert.
--
--   * `fees_ea_number_not_collected` — `requires_ea_number = false`. The biconditional in
--     `assert_entrant_rules()` means a fee marked `true` would refuse every entrant on it,
--     because the entrants constraint forbids the number the trigger would demand. That is a
--     fee nobody can enter on, discovered by a runner at the payment page. This constraint
--     turns that into a migration that fails to apply, in front of the person writing it.
--
-- Neither ships `NOT VALID`. The runbook route in docs/delivery/runbooks/entries-constraints.md
-- exists for constraints whose existing rows nobody here can see; these two are different,
-- because the two `update`s immediately above them are what make every existing row satisfy
-- them. Validating at `add constraint` time is safe here and says more.
--
-- =========================================================================================
-- `fees.affiliated` — a new column, because one column was carrying two facts
-- =========================================================================================
-- `requires_ea_number` meant "ask for a number" and was *also*, by accident of there being
-- nothing else, the only marker of which fee is the affiliated price. Freezing it to false
-- would have taken the second meaning with the first: `read_entry_list()`'s **Affiliated
-- entries** figure would read zero on a race full of affiliated entries, and `read_export()`'s
-- England Athletics file would return an empty list for ever.
--
-- So the two facts are separated. `affiliated` is backfilled from `requires_ea_number` —
-- which is exactly what it meant on every row that exists — and the two reads that care about
-- the affiliated *price* move onto it. It holds no personal data and is not a new question
-- asked of anybody, so it is not the committee decision that adding a personal-data column is.
--
-- **The contract step renames nothing.** `affiliated` is the name that survives;
-- `requires_ea_number` is the one that goes.
--
-- =========================================================================================
-- What is deliberately not touched
-- =========================================================================================
-- **`entries.assert_entrant_rules()`** is left exactly as it is. With every fee false, its
-- first half — a fee that requires a number must have one — is unreachable, and its second
-- half, which refuses a number against a fee that does not want one, is a second lock on the
-- same door as `entrants_ea_number_not_collected`. Rewriting a trigger to delete two branches
-- that can no longer fire is churn in the file that enforces every other entrant rule.
--
-- **`entries.transfer_entry()`** is left exactly as it is, and this migration *fixes* the live
-- defect it was written for as a side effect. Its `ea_number_required` refusal is guarded by
-- `if v_fee.requires_ea_number then`, which is now false for every fee, so the `else` branch
-- runs, `v_ea` is set to null, and an affiliated place can be transferred to a runner who has
-- no number — which it could not be before, on any route. Both the ten-argument form and the
-- nine-argument wrapper behave identically now; the Worker in this commit calls the nine.
--
-- **`entries.entry_state()`** is left exactly as it is. It reports `requires_ea_number`
-- straight off the fee row, which is false everywhere, so the form stops asking with no change
-- to the function.
--
-- **`entries.create_pending_purchase()` and `entries.create_manual_entry()`** are left exactly
-- as they are, for the reason in point 1: both already write null against a fee that does not
-- require a number, which is now every fee.
--
-- No grants change. `anon` may still call the same thirteen functions and `authenticated` the
-- same fourteen; both functions below are replaced in place with their argument lists
-- untouched, so there is no second overload and `create or replace` keeps the privileges.

-- -----------------------------------------------------------------------------------------
-- 1. Which fee is the affiliated price, said in a column of its own
-- -----------------------------------------------------------------------------------------

alter table entries.fees
  add column if not exists affiliated boolean not null default false;

comment on column entries.fees.affiliated is
  'Whether this fee is the price for a runner registered with England Athletics. Backfilled from requires_ea_number on 29 August 2026, when the club stopped asking for the number: the two were one column and were never one fact. Nothing is asked of the entrant on the strength of it — it is what the Affiliated entries figure and the England Athletics export count.';

update entries.fees
   set affiliated = requires_ea_number
 where affiliated is distinct from requires_ea_number;

-- -----------------------------------------------------------------------------------------
-- 2. Stop asking, then delete what is held, in that order
-- -----------------------------------------------------------------------------------------
-- Flipping the flag first is what lets the deletion through assert_entrant_rules(); see the
-- header. It is also what stops collection immediately rather than at the next deploy.

update entries.fees
   set requires_ea_number = false
 where requires_ea_number;

update entries.entrants
   set ea_number = null
 where ea_number is not null;

-- -----------------------------------------------------------------------------------------
-- 3. Make it impossible to write one again
-- -----------------------------------------------------------------------------------------

alter table entries.entrants
  add constraint entrants_ea_number_not_collected check (ea_number is null);

comment on constraint entrants_ea_number_not_collected on entries.entrants is
  'The club stopped asking for England Athletics numbers on 29 August 2026 and does not hold any. The column survives only so the Worker deployed alongside this migration goes on parsing the key; the contract step drops both.';

alter table entries.fees
  add constraint fees_ea_number_not_collected check (requires_ea_number = false);

comment on constraint fees_ea_number_not_collected on entries.fees is
  'No fee may require an England Athletics number. A fee marked true would be one nobody could enter on, because assert_entrant_rules() would demand a number that entrants_ea_number_not_collected forbids — this turns that into a migration that will not apply rather than a runner stuck at the payment page.';

comment on column entries.fees.requires_ea_number is
  'Dead, and false on every row. Kept until the contract step so a Worker deployed before 29 August 2026 goes on finding the key it parses. Which fee is the affiliated price is entries.fees.affiliated.';

comment on column entries.entrants.ea_number is
  'Dead, and null on every row. Kept until the contract step so a Worker deployed before 29 August 2026 goes on finding the key it parses. The club does not ask for or hold England Athletics numbers; the privacy notice reserves the right to ask a runner to produce one instead.';

-- -----------------------------------------------------------------------------------------
-- entries.read_entry_list() — the affiliated count moves onto entries.fees.affiliated
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260829092000_entries_admin_sees_requests.sql apart from the two figures the
-- comments below name. Diffing the two should show nothing else.

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
          -- **Counted off `fee.affiliated` now, not off `fee.requires_ea_number`.** They were
          -- the same column until this migration and they were never the same fact: one is
          -- "this is the price for somebody registered with England Athletics", which the club
          -- still sells and still needs a count of, and the other was "ask them for their
          -- number", which the club has stopped doing. Freezing the second to false would have
          -- taken this figure to zero with it, and a volunteer would have read that as nobody
          -- having entered affiliated.
          'affiliated', (
            select pg_catalog.count(*)::int
              from purchase
              join entries.entrants as entrant on entrant.purchase_id = purchase.id
              join entries.fees as fee on fee.id = purchase.fee_id
             where purchase.status = 'paid'
               and fee.affiliated
          ),
          -- **Zero by construction, and the key survives only for the deploy window.** It
          -- counted affiliated entries carrying no England Athletics number. No entry carries
          -- one any more — `entrants_ea_number_not_collected` forbids it — so the honest answer
          -- to the question is zero for every event, for ever. It is a literal rather than a
          -- count so nobody reads the query and thinks the figure still means something.
          --
          -- It is still emitted because `packages/shared/src/admin.ts` parses it as a required
          -- key, and the Worker deployed when this migration lands is the one that still does.
          -- The contract step drops the key and the parse together; see
          -- docs/delivery/runbooks/entries-ea-number-contract.md.
          'affiliated_missing_ea', 0,

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

-- -----------------------------------------------------------------------------------------
-- entries.read_export() — the England Athletics file loses its number and keeps its job
-- -----------------------------------------------------------------------------------------
-- **The file survives, without the column it was named after.** It existed to evidence the £2
-- check: a human reading down affiliated entries against the club's myAthletics access.
-- Nothing can be checked against a number nobody holds any more — but the club still needs to
-- know how many affiliated entries there were, which is a question about ARC's levy rather
-- than about any runner, and this is the only place that answers it as a document somebody can
-- keep. So the rows stay, the `ea_number` key stays and is null on every one of them for the
-- deploy window, and the CSV the Worker builds from them has no number column at all.
--
-- Verbatim from 20260828142000_entries_reads_know_about_guides.sql apart from the two places
-- the comments below name.
create or replace function entries.read_export(
  p_actor text,
  p_event_slug text,
  p_kind text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_event entries.events;
  v_rows jsonb;
begin
  if p_kind is null or p_kind not in ('ea', 'start-list', 'medical') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
  end if;

  select * into v_event from entries.events where slug = p_event_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if p_kind = 'ea' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 -- **Null for every row, and the key stays only for the deploy window.** The
                 -- club has stopped asking for the number, so there is none to put here; the
                 -- Worker deployed when this migration lands parses `ea_number` as a required
                 -- nullable key and a missing one would fail the parse and take the export
                 -- down. The contract step drops the key and the column together.
                 -- `null::text`, not a bare `null`: jsonb_build_object is variadic "any", so
                 -- an untyped null is `unknown` and Postgres refuses the call with "could not
                 -- determine polymorphic type". The cast is what makes it a JSON null.
                 'ea_number', null::text,
                 'fee_label', fee.label,
                 'amount_pence', purchase.amount_pence
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
      join entries.fees as fee on fee.id = purchase.fee_id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid'
       -- **`fee.affiliated`, because `fee.requires_ea_number` is false everywhere now.**
       -- Selecting on the old column would have returned an empty file for ever, and an
       -- export that is silently always empty is worse than one that has been removed.
       and fee.affiliated
       -- **Guides are not on this list, and leaving them on it would break the list's job.**
       -- A guide rides on a visually impaired runner's entry, which may well be the affiliated
       -- one, while paying nothing themselves — so counting them here would overstate how many
       -- affiliated entries were sold, which is the whole of what this file is now for.
       and entrant.role <> 'guide';

  elsif p_kind = 'start-list' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 -- Age and gender, not a category: the band is named by
                 -- packages/shared/src/age-category.ts and by nothing else.
                 'age', pg_catalog.date_part(
                          'year',
                          pg_catalog.age(
                            v_event.event_date::timestamp,
                            entrant.date_of_birth::timestamp
                          )
                        )::int,
                 'gender', entrant.gender,
                 -- **Guides are on this sheet and are marked on it.** They are on the road,
                 -- so a marshal at two in the morning has to be able to account for them —
                 -- but they are not being timed and are in no category, and a name with
                 -- nothing beside it is the one shape that helps nobody.
                 'role', entrant.role,
                 'emergency_contact_name', entrant.emergency_contact_name,
                 'emergency_contact_phone', entrant.emergency_contact_phone
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid';

  else
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'last_name', entrant.last_name,
                 'first_name', entrant.first_name,
                 'club', entrant.club,
                 'notes', medical.notes
               )
               order by entrant.last_name, entrant.first_name, entrant.id
             ),
             '[]'::jsonb
           )
      into v_rows
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
      join entries.entrant_medical as medical on medical.entrant_id = entrant.id
     where purchase.event_id = v_event.id
       and purchase.status = 'paid';
  end if;

  -- **The count and never the contents.** Written in the same transaction as the read, so an
  -- export cannot leave this database without a row saying who took it and how big it was.
  --
  -- **The medical export records `medical_export`, not `export`.** The question an access
  -- review asks is "who has read medical data", and the person who downloaded every note is a
  -- larger disclosure than the person who clicked one. With a single `export` value that query
  -- has to know to look inside `detail ->> 'kind'` — and the runbook's did not, so the file was
  -- invisible while the single note was not. The kind is still recorded either way; the action
  -- is what makes the two medical reads findable together.
  perform entries.record_admin_action(
    p_actor,
    case when p_kind = 'medical' then 'medical_export' else 'export' end,
    jsonb_build_object(
      'event', v_event.slug,
      'kind', p_kind,
      'rows', pg_catalog.jsonb_array_length(v_rows)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'display_name', v_event.display_name,
      'event_date', v_event.event_date
    ),
    'rows', v_rows
  );
end;
$$;


comment on function entries.read_export(text, text, text) is
  'One of the three exports for one event, with the audit row, and with no authorisation check of its own. The England Athletics file is now a list of who paid the affiliated price, selected on entries.fees.affiliated and carrying no number — the club stopped asking for those on 29 August 2026. Guides are excluded from it, because they pay nothing, and marked on the start list, where they belong. Granted to nobody — reachable only from entries.admin_export() and entries.export().';
