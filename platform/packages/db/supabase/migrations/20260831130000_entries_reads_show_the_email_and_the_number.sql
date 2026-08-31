-- ---------------------------------------------------------------------------------------
-- The five reads that carry an entry reference, and the one that gained an email column
-- ---------------------------------------------------------------------------------------
--
-- Two changes, and they touch overlapping functions — so the functions are restated once
-- rather than twice.
--
-- ## 1. `entry_no` reaches every surface that prints a reference — see 20260831120000
--
-- The previous migration added the column and the trigger that fills it. This is what puts it
-- on the wire, in the four places a reference is rendered: `my_entries()` for
-- `/account/entries/`, `admin_entry_detail()` for `/admin/nn/entry/`, `read_entry_list()` for
-- the attention queue on `/admin/nn/`, and the two outbox reads for the emails.
--
-- **Nothing here renders a reference to text.** The event slug, the number and the creation
-- timestamp go out as three facts and `packages/shared/src/entry-reference.ts` is the one place
-- they are put together — for `formatPence()`'s reason, and because the date in a reference is
-- the **London** day and this repository has exactly one path timezone conversion may take.
-- A `to_char` here would be a second one.
--
-- **Both outbox reads keep `purchase_reference` beside the new keys.** The Worker deployed when
-- this migration lands parses it as required, and a message whose shape will not parse is a
-- message nobody ever receives. Expand, migrate, contract: the key goes when the deploy that
-- stopped needing it is out.
--
-- ## 2. `read_entry_list()` returns the email address — issue #183
--
-- `/admin/nn/`'s entries table showed no address at all, so two people with the same name could
-- only be told apart by opening the entry. **No new column is collected and no new audience sees
-- one**: the address is already on `/admin/nn/entry/` and in two of the three exports, behind
-- the same `nn.entry.read` permission. This moves an existing disclosure onto the list, which
-- is a build decision rather than a committee one.
--
-- WARNING: **Which address is "the" address is decided per row, not per purchase**, and the
-- `case` in `rows_all` carries the whole argument. A runner is reachable at `purchaser_email`;
-- a guide is reachable at their own `entrants.email`, because a guide has no purchase of their
-- own. See the comment on the expression itself.
--
-- ADR-024 built `/admin/nn/entry/` precisely because "the facts a volunteer needs on the phone
-- were the ones that did not fit in a column", and the address that paid was named as one of
-- them. **This reverses that for exactly one field**, deliberately: telling two runners apart is
-- something a volunteer does while reading the list rather than after opening a row.

-- -----------------------------------------------------------------------------------------
-- entries.read_entry_list() — the email address, and the entry number
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260829140000_entries_request_history.sql apart from the keys the comments
-- inside name. Granted to nobody; reached through `admin_entry_list()` behind the admin key and
-- through `entry_list()` behind `nn.entry.read`.
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
           -- **The address that paid.** Carried down to the row so the list can show one; see
           -- the header for why a guide's row shows a different column instead.
           p.purchaser_email,
           -- The readable half of the reference. Rendered with the event slug and the creation
           -- date by `packages/shared/src/entry-reference.ts`, never here.
           p.entry_no,
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
           -- ⚠️ **Which address, decided by the row rather than by the purchase.** A runner is
           -- reachable at `entry_purchases.purchaser_email` — the address that paid, and what
           -- `my_entries()` matches on. A **guide** is reachable at `entrants.email`, their own
           -- address, because a guide has no purchase of their own (ADR-022 as amended on
           -- 28 August 2026).
           --
           -- Printing `purchaser_email` against a guide would put the buyer's address beside
           -- somebody else's name, on the page a volunteer rings people from. So the column
           -- resolves per row.
           --
           -- **Null is a real answer and the page renders a dash for it.** A guide entered
           -- before that amendment has no address of their own; falling back to the buyer's
           -- would be the exact defect this `case` exists to prevent.
           --
           -- **A cancelled entry has no entrant at all** — `cancel_entry()` deletes them — so
           -- `role` is null and this takes the `else`. That row shows the address that paid,
           -- which is deliberate: it is the only thing left on the page that identifies a
           -- purchase somebody is ringing about, and it is the address the refund notice went
           -- to. #183.
           case
             when entrant.role = 'guide' then entrant.email::text
             else purchase.purchaser_email::text
           end as email,
           purchase.entry_no,
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
                     -- See `rows_all`: the runner's is the purchase's, the guide's is their
                     -- own, and a cancelled row keeps the address that paid.
                     'email', listed.email,
                     'entry_no', listed.entry_no,
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
  'The entries for one event, with the counts, the figures and the discount codes computed in the same query. Carries the address to reach each row at — the purchaser''s for a runner, the guide''s own for a guide — and the entry number the printed reference is built from. Granted to nobody: reached only through admin_entry_list() or entry_list().';

-- -----------------------------------------------------------------------------------------
-- entries.my_entries() — the entry number, for the reference on /account/entries/
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260830110000_entries_requests_know_whose_they_are.sql apart from the one key.
-- The ownership rules, the per-caller request filter and the lateral are untouched.
create or replace function entries.my_entries()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $function$
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
            -- **The readable half of the reference this page prints.** The event slug and
            -- `created_at` below are the other two, and both were already on the wire — which
            -- is why one integer is the whole of what this read gained.
            -- `packages/shared/src/entry-reference.ts` puts the three together; nothing here
            -- renders a reference to text.
            'entry_no', purchase.entry_no,
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
            -- **The caller's own most recent ask, not the purchase's.** See the header: on a
            -- transferred place these columns describe somebody else, and `request_reason`
            -- survives a transfer by design.
            'requested_action', mine.action,
            'request_reason', mine.reason,
            'request_resolved', mine.resolved_at is not null,
            -- **Every ask this caller has made about this entry, in order** — and no ask
            -- anybody else has made about it.
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
               and (
                 (v_email is not null and request.owner_email = v_email)
                 or (
                   request.owner_person_id is not null
                   and request.owner_person_id = auth.uid()
                 )
               )
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
      -- **`limit 1`, so this cannot multiply a row.** A plain join to the same predicate would
      -- return one row per ask, and this caller would see the entry once per time they asked
      -- about it.
      left join lateral (
        select request.action,
               request.reason,
               request.resolved_at
          from entries.entry_requests as request
         where request.purchase_id = purchase.id
           and (
             (v_email is not null and request.owner_email = v_email)
             or (
               request.owner_person_id is not null
               and request.owner_person_id = auth.uid()
             )
           )
         order by request.requested_at desc, request.id
         limit 1
      ) as mine on true
     where purchase.person_id = auth.uid()
        or (
          v_email is not null
          and pg_catalog.lower(purchase.purchaser_email::text) = v_email
        )
    )
  );
end;
$function$;

comment on function entries.my_entries() is
  'Every entry belonging to the signed-in caller, matched on person_id or on their confirmed address, with the entry number its printed reference is built from and with every ask *they* have made about each one and none that anybody else has. Never anybody else''s entry, never a medical note, and never the words a previous holder of a transferred place wrote to the club.';

revoke all on function entries.my_entries() from public;
grant execute on function entries.my_entries() to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.admin_entry_detail() — the entry number, for the reference at the head of the page
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260830140000_entries_runner_phone.sql apart from the one key. The purchase id
-- stays on the projection: it is what Stripe's metadata and the audit rows key on.
create or replace function entries.admin_entry_detail(p_purchase_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_purchase entries.entry_purchases;
  v_event entries.events;
  v_fee entries.fees;
  v_discount text;
  v_entrants jsonb;
  v_emails jsonb;
  v_requests jsonb;
  v_audit jsonb;
begin
  if not identity.has_permission('nn.entry.read') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_purchase_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  select * into v_purchase
    from entries.entry_purchases
   where id = p_purchase_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_entry');
  end if;

  select * into v_event from entries.events where id = v_purchase.event_id;
  select * into v_fee from entries.fees where id = v_purchase.fee_id;

  select code.code::text into v_discount
    from entries.discount_codes as code
   where code.id = v_purchase.discount_code_id;

  -- --- the people on it --------------------------------------------------------------------
  -- Ordered so the runner comes before the guide whatever their names are: `role` sorts
  -- `guide` before `runner` alphabetically, which is the wrong way round, so it is asked as a
  -- boolean instead.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'entrant_id', entrant.id,
               'first_name', entrant.first_name,
               'last_name', entrant.last_name,
               -- **The date itself, not only the age.** The age is what the page renders in a
               -- band and what the minimum-age rule is expressed in; the date is what
               -- one-runner-one-place is keyed on and what a volunteer needs when two people
               -- share a name. It is already in this table and already in the medical export.
               'date_of_birth', entrant.date_of_birth,
               -- The same expression `create_pending_purchase()` enforces the minimum age
               -- with: completed years at the event date, so a birthday on race day counts.
               'age', pg_catalog.date_part(
                        'year',
                        pg_catalog.age(
                          v_event.event_date::timestamp,
                          entrant.date_of_birth::timestamp
                        )
                      )::int,
               'gender', entrant.gender,
               'gender_identity', entrant.gender_identity,
               'club', entrant.club,
               -- **No England Athletics number, and this function never had one.** The club
               -- stopped asking for and holding them on 29 August 2026 — ADR-023 — and the
               -- column survives only until the contract step, always null. A new read has no
               -- business selecting a dead column: it would render an empty row on the page
               -- for ever, and would have to be found and removed again when the column goes.
               -- Which fee was the affiliated price is `fees.affiliated`, and it is on the
               -- payment panel as the fee's own label.
               'role', entrant.role,
               'email', entrant.email::text,
               -- **The runner's own number, which this page is the natural home for.** The
               -- list is a table and a table carries what fits in a column; a number somebody
               -- rings on race morning is exactly the kind of fact that did not. Null on a
               -- guide, who is not asked, and null on every entry taken before ADR-025.
               'phone', entrant.phone,
               'emergency_contact_name', entrant.emergency_contact_name,
               'emergency_contact_phone', entrant.emergency_contact_phone,
               'created_at', entrant.created_at,
               -- Whether, never what. The note has one door and that door is audited.
               'has_medical', exists (
                 select 1 from entries.entrant_medical as medical
                  where medical.entrant_id = entrant.id
               )
             )
             order by (entrant.role = 'guide'), entrant.last_name, entrant.id
           ),
           '[]'::jsonb
         )
    into v_entrants
    from entries.entrants as entrant
   where entrant.purchase_id = p_purchase_id;

  -- --- what the club has told them, and what it still owes ----------------------------------
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', outbox.id,
               'template', outbox.template,
               'recipient', outbox.recipient::text,
               'status', outbox.status,
               'attempts', outbox.attempts,
               'last_error', outbox.last_error,
               'created_at', outbox.created_at,
               'sent_at', outbox.sent_at
             )
             order by outbox.created_at
           ),
           '[]'::jsonb
         )
    into v_emails
    from entries.email_outbox as outbox
   where outbox.purchase_id = p_purchase_id;

  -- --- what they have asked for -------------------------------------------------------------
  -- **Every ask, and this page is the only place the full list is legible.** The row on
  -- `/admin/nn/` can say that two asks exist; this is where a volunteer reads what each one
  -- said and when, which is the difference between "they want to cancel" and "they wanted to
  -- transfer on Tuesday, then changed their mind on Thursday".
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
    into v_requests
    from entries.entry_requests as request
   where request.purchase_id = p_purchase_id;

  -- --- what has been done to it -------------------------------------------------------------
  -- **Matched on what the detail names rather than on a foreign key**, because `admin_audit`
  -- has none: it is deliberately not referential, so a row outlives the thing it is about.
  -- Three ways an entry is named — the purchase, one of its entrants, one of its messages —
  -- and all three are asked.
  --
  -- ⚠️ **A medical read on an entrant who has since been deleted cannot be matched**, because
  -- the id it names no longer joins to anything on this purchase. That is a real gap and it is
  -- the price of `cancel_entry()` deleting the runner, which is the more important promise.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'at', audit.at,
               'action', audit.action,
               'actor', audit.actor,
               'detail', audit.detail
             )
             order by audit.at desc, audit.id
           ),
           '[]'::jsonb
         )
    into v_audit
    from entries.admin_audit as audit
   where audit.detail ->> 'purchase_id' = p_purchase_id::text
      or audit.detail ->> 'entrant_id' in (
           select entrant.id::text
             from entries.entrants as entrant
            where entrant.purchase_id = p_purchase_id
         )
      or audit.detail ->> 'outbox_id' in (
           select outbox.id::text
             from entries.email_outbox as outbox
            where outbox.purchase_id = p_purchase_id
         );

  return jsonb_build_object(
    'ok', true,
    'purchase', jsonb_build_object(
      'purchase_id', v_purchase.id,
      -- The readable half of the reference at the head of this page. The slug and `created_at`
      -- were already here; `packages/shared/src/entry-reference.ts` is what puts the three
      -- together. The purchase id stays, because it is what Stripe's metadata and the audit
      -- rows key on and a volunteer reconciling a payment needs it.
      'entry_no', v_purchase.entry_no,
      'event_slug', v_event.slug,
      'event_name', v_event.display_name,
      'event_date', v_event.event_date,
      'status', v_purchase.status,
      'attention', v_purchase.attention,
      'attention_resolved_at', v_purchase.attention_resolved_at,
      'amount_pence', v_purchase.amount_pence,
      'fee_code', v_fee.code,
      'fee_label', v_fee.label,
      'discount_code', v_discount,
      'purchaser_name', v_purchase.purchaser_name,
      'purchaser_email', v_purchase.purchaser_email::text,
      -- Whether it is claimed by an account, never which one. A uuid on a page is a fact
      -- nobody can act on; "they can see this at /account/entries/" is one they can.
      'linked_to_account', v_purchase.person_id is not null,
      -- **Which version of the terms was in force, and not what was agreed to.** See the
      -- header: no read returns `consents`, and this migration does not become the first.
      'consent_version', v_purchase.consent_version,
      'stripe_checkout_session_id', v_purchase.stripe_checkout_session_id,
      'stripe_payment_intent_id', v_purchase.stripe_payment_intent_id,
      'created_at', v_purchase.created_at,
      'hold_expires_at', v_purchase.hold_expires_at,
      'paid_at', v_purchase.paid_at,
      'revived_at', v_purchase.revived_at,
      'requested_action', v_purchase.requested_action,
      'requested_at', v_purchase.requested_at,
      'request_reason', v_purchase.request_reason,
      'request_resolved_at', v_purchase.request_resolved_at
    ),
    'entrants', v_entrants,
    'emails', v_emails,
    'requests', v_requests,
    'audit', v_audit
  );
end;
$function$;

revoke all on function entries.admin_entry_detail(uuid) from public;
grant execute on function entries.admin_entry_detail(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.claim_outbox_batch() — the three facts the emails' reference is built from
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260830150000_entries_outbox_greets_the_runner.sql apart from the three keys.
-- The key check, the claim, the bound and the one-entrant lateral are untouched.
create or replace function entries.claim_outbox_batch(
  p_key text,
  p_limit int default 10
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_digest text;
  v_rows jsonb;
begin
  -- --- the caller, before anything else --------------------------------------------------
  -- Checked first, so a wrong key cannot be used to learn whether anything is queued.
  select secret.key_sha256 into v_digest
    from entries.webhook_secrets as secret
   where secret.name = 'stripe';

  if v_digest is null
     or p_key is null
     or pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
        ) is distinct from v_digest
  then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  -- **Bounded, and not by the caller's optimism.** A batch larger than this is a burst at a
  -- provider that rate-limits, and the drain runs every five minutes anyway.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    p_limit := 10;
  end if;

  with claimed as (
    select outbox.id
      from entries.email_outbox as outbox
     where outbox.status = 'pending'
     order by outbox.created_at
     limit p_limit
     for update skip locked
  ),
  marked as (
    update entries.email_outbox as outbox
       set attempts = outbox.attempts + 1,
           last_attempt_at = pg_catalog.now()
      from claimed
     where outbox.id = claimed.id
    returning
      outbox.id,
      outbox.template,
      outbox.recipient,
      outbox.purchase_id,
      outbox.attempts
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', marked.id,
               'template', marked.template,
               'recipient', marked.recipient::text,
               'attempts', marked.attempts,
               -- **The purchase id is the reference a runner quotes**, and it is already
               -- printed on the confirmation page and on `/account/entries/`. It is not a
               -- credential — `request_entry_action()`'s comment says so explicitly — so
               -- putting it in an email discloses nothing new.
               'purchase_reference', marked.purchase_id::text,
               -- **The three the readable reference is built from**, beside the id rather than
               -- instead of it: the Worker deployed when this migration lands still parses
               -- `purchase_reference` as a required key, and a message it cannot parse is a
               -- message nobody receives. `packages/shared/src/email-outbox.ts` prefers these
               -- when they are all present and falls back to the id when they are not, which
               -- is what makes this an expand step rather than a swap.
               'entry_no', purchase.entry_no,
               'event_slug', event.slug,
               'purchase_created_at', purchase.created_at,
               'event_name', event.display_name,
               'event_date', pg_catalog.to_char(event.event_date, 'FMDay FMDD FMMonth YYYY'),
               'amount_pence', purchase.amount_pence,
               -- **Null after a refund or a transfer, and every template must cope.**
               -- `cancel_entry()` deletes the entrants and `transfer_entry()` replaces them,
               -- so the runner a message is about may no longer exist by the time it is sent.
               -- A left join and a nullable name, rather than an inner join that would make
               -- the row undrainable and leave it pending forever.
               'entrant_first_name', entrant.first_name,
               -- The race's own monitored address. It becomes `Reply-To` rather than `From`:
               -- Resend may only send as the verified subdomain, and this is a Gmail.
               'reply_to', event.from_address
             )
             order by marked.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from marked
    join entries.entry_purchases as purchase on purchase.id = marked.purchase_id
    join entries.events as event on event.id = purchase.event_id
    -- **One entrant per message, chosen rather than stumbled upon.** See the header: a plain
    -- left join on `purchase_id` fans a message out across every person on the entry, and a
    -- guide's name could be the one that reached the runner. The lateral is what makes the
    -- row count structural — one message, one greeting, whatever the roles list grows into and
    -- however many people a future event puts on one purchase.
    left join lateral (
      select entrant.first_name
        from entries.entrants as entrant
       where entrant.purchase_id = purchase.id
         and entrant.role <> 'guide'
       order by entrant.created_at, entrant.id
       limit 1
    ) as entrant on true;

  return jsonb_build_object('ok', true, 'messages', v_rows);
end;
$function$;

comment on function entries.claim_outbox_batch(text, int) is
  'Claims up to p_limit pending messages, counting the attempt in the same statement, and returns everything a send needs: the recipient, the template, the greeting name, and the three facts the printed reference is built from. Takes the webhook key, because it returns real email addresses and anon is the only role a cron can reach Postgres as.';

revoke all on function entries.claim_outbox_batch(text, int) from public;
grant execute on function entries.claim_outbox_batch(text, int) to anon;

-- -----------------------------------------------------------------------------------------
-- entries.admin_outbox_list() — the same three, so /admin/emails/ names a message the way the
-- message itself does
-- -----------------------------------------------------------------------------------------
-- Verbatim from 20260829130000_identity_email_permissions.sql apart from the keys named inside.
-- **A volunteer answering "I never got my confirmation" is holding the reference the runner is
-- reading out**, so the queue has to name a message by the same string the email quoted.
create or replace function entries.admin_outbox_list(
  p_limit int default 200
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_figures jsonb;
begin
  if not identity.has_permission('nn.email.read') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    p_limit := 200;
  end if;

  select jsonb_build_object(
           'pending', pg_catalog.count(*) filter (where outbox.status = 'pending')::int,
           'sent', pg_catalog.count(*) filter (where outbox.status = 'sent')::int,
           'failed', pg_catalog.count(*) filter (where outbox.status = 'failed')::int,
           'sent_today', pg_catalog.count(*) filter (
             where outbox.status = 'sent'
               and outbox.sent_at at time zone 'Europe/London'
                   >= pg_catalog.date_trunc(
                        'day', pg_catalog.now() at time zone 'Europe/London'
                      )
           )::int,
           -- **The oldest thing still owed**, which is what says whether the queue is moving.
           -- Null when nothing is pending, rather than zero — "nothing waiting" and "something
           -- waiting no time at all" are different sentences on the page.
           'oldest_pending_at', pg_catalog.min(outbox.created_at)
             filter (where outbox.status = 'pending')
         )
    into v_figures
    from entries.email_outbox as outbox;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', row.id,
               'template', row.template,
               'recipient', row.recipient::text,
               'status', row.status,
               'attempts', row.attempts,
               'last_error', row.last_error,
               'created_at', row.created_at,
               'sent_at', row.sent_at,
               'purchase_reference', row.purchase_id::text,
               -- Beside the id, never instead of it — see `claim_outbox_batch()` above for why
               -- the old key stays on the wire through the deploy window.
               'entry_no', row.entry_no,
               'event_slug', row.event_slug,
               'purchase_created_at', row.purchase_created_at,
               'event_name', row.event_name
             )
             order by row.created_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from (
      select outbox.id,
             outbox.template,
             outbox.recipient,
             outbox.status,
             outbox.attempts,
             outbox.last_error,
             outbox.created_at,
             outbox.sent_at,
             outbox.purchase_id,
             purchase.entry_no,
             purchase.created_at as purchase_created_at,
             event.slug as event_slug,
             event.display_name as event_name
        from entries.email_outbox as outbox
        join entries.entry_purchases as purchase on purchase.id = outbox.purchase_id
        join entries.events as event on event.id = purchase.event_id
       order by outbox.created_at desc
       limit p_limit
    ) as row;

  return jsonb_build_object('ok', true, 'figures', v_figures, 'messages', v_rows);
end;
$function$;

revoke all on function entries.admin_outbox_list(int) from public;
grant execute on function entries.admin_outbox_list(int) to authenticated;
