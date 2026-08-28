-- What the admin surface and the three exports do with a guide.
--
-- ---------------------------------------------------------------------------------------
-- Why this migration exists at all
-- ---------------------------------------------------------------------------------------
-- `20260828140000_entries_discounts_and_guides.sql` lets one purchase carry two entrants.
-- Every read on the admin surface was written when that could not happen, and three of them
-- are wrong in a way no existing test would have caught, because each returns a perfectly
-- well-formed answer to a question nobody meant to ask.
--
-- **1. The entry list would report the money twice.** `read_entry_list()` is purchase-driven
-- with the entrant left joined — one row per person — which is right: both of them are on the
-- course and both belong on the page. But `amount_pence` is a fact about the *purchase*, so a
-- £20 entry with a guide on it renders as two rows of £20.00 and a volunteer reading down the
-- column counts £40. The figures panel is unaffected — `fees_pence` sums over purchases and
-- always did — so **the page would have disagreed with itself, and the total would have been
-- the half that was right.**
--
-- The fix is `role` on the row, not arithmetic in the database. The amount stays the
-- purchase's, because that is what it is; the page renders it against the runner and renders
-- the guide's row as the free place it is. The database reports the fact and the page decides
-- the rendering, which is the arrangement everywhere else here.
--
-- **2. The England Athletics export would list every guide.** It exists for one job: a human
-- spot-checking affiliated entries against the club's myAthletics access, because nothing in
-- this platform can verify a number. It selects everybody on a fee that `requires_ea_number` —
-- and a guide on a visually impaired runner's affiliated entry is on that fee while carrying
-- no number, deliberately, since nothing was charged for them. So every guide would arrive
-- looking exactly like the thing the list is for finding: an affiliated entry with no number
-- against it. A check whose false positives are structural is a check somebody stops running.
--
-- **3. The start list would not say who is guiding.** Guides belong on it — they are on the
-- road, and the sheet is what a marshal reads at two in the morning — but a guide is not being
-- timed and is in no category, and a name with nothing beside it is the one shape that helps
-- nobody.
--
-- **The medical export is correct as it stands and is deliberately not touched.** It joins
-- `entrant_medical`, so it returns a note when a guide wrote one and nothing when they did
-- not, which is exactly right: a condition on the course is a condition on the course, and
-- whose entry it was recorded under does not change what a first aider needs to know.
--
-- ---------------------------------------------------------------------------------------
-- No grant changes, and no signature changes
-- ---------------------------------------------------------------------------------------
-- Both functions are replaced in place with their argument lists untouched, so there is no
-- second overload for PostgREST to choose between and `create or replace` keeps the existing
-- privileges. `read_export()` is still granted to nobody — reachable only from
-- `entries.admin_export()` and `entries.export()` — and `read_entry_list()` is unchanged in
-- who may call it. The list of functions `anon` may call is still thirteen.
--
-- **Expand, migrate, contract.** `role` is an added key on a jsonb row. A previously deployed
-- Worker reads the keys it knows and ignores it; a Worker deployed ahead of this migration
-- finds it absent and renders every row as a runner, which is what every row was until
-- yesterday. Both orders are safe.
--
-- Each function below is the previous definition **verbatim**, with only the lines this file
-- describes changed. Diffing it against the migration named above should show nothing else.

-- -----------------------------------------------------------------------------------------
-- entries.read_entry_list() — the row says which of the two people it is
-- -----------------------------------------------------------------------------------------
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
                     'gender_identity', listed.gender_identity,
                     'role', listed.role,
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

comment on function entries.read_entry_list(text) is
  'Every purchase for one event with its entrants left joined — one row per person, so a visually impaired runner and their guide are two rows of one purchase and a cancelled entry is a row with no runner. Carries entrants.role, so the page renders the amount against the runner rather than twice. Granted to nobody: reachable only from entries.admin_entry_list() and entries.entry_list().';

-- -----------------------------------------------------------------------------------------
-- entries.read_export() — guides off the affiliation check, and marked on the start list
-- -----------------------------------------------------------------------------------------
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
                 'ea_number', entrant.ea_number,
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
       and fee.requires_ea_number
       -- **Guides are not on this list, and leaving them on it would break the list's job.**
       -- This file is what a human checks against the club's myAthletics access, because
       -- nothing in this platform can verify a number. A guide riding on a visually impaired
       -- runner's affiliated entry is on a fee that requires one and carries none — by
       -- design, since nothing was charged for them and the number exists to justify the
       -- rebate. So every guide would appear as exactly the thing this list is for finding,
       -- and a check whose false positives are structural is a check somebody stops running.
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
  'One of the three exports for one event, with the audit row, and with no authorisation check of its own. Guides are excluded from the England Athletics check — they carry no number by design — and marked on the start list, where they belong. Granted to nobody — reachable only from entries.admin_export() and entries.export().';
