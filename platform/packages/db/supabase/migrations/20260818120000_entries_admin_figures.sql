-- What the admin surface needs to state a figure, rather than count one it was handed.
--
-- The first pass rendered a list. This one renders **the state of the race** — places taken
-- against capacity, fees taken, how many holds came back, how many people wrote a medical note,
-- how many claimed the affiliated price. Every one of those is a number somebody acts on, and
-- there are two ways to get one:
--
--   * count the array `admin_entry_list()` already returns, or
--   * ask the database.
--
-- **The array is capped at the most recent 2,000 and the counts are not**, which is the whole
-- reason this migration exists. `create_pending_purchase()` is granted to anon and every call
-- writes a row, so abandoned holds are unbounded while the field is 250. A page that counted the
-- array would show `taken` and `attention` computed over every row — they always were — beside a
-- fees total and an expired count computed over the most recent 2,000, and the two would silently
-- disagree on a busy race. Numbers that disagree on the same panel are worse than a number that
-- is missing, because somebody sets out bibs from them.
--
-- =========================================================================================
-- Expand, migrate, contract — and this one is purely expand
-- =========================================================================================
-- **One `create or replace` on one function, adding keys to a `jsonb` object.** No new function,
-- no new grant, no column added, nothing removed or renamed. The thirteen functions the anon role
-- may execute are still the same thirteen, with the same signatures, so
-- `packages/db/tests/entries.test.ts`'s exact-set assertion is untouched — deliberately, because
-- a fourteenth is a decision and this is not one.
--
-- Both deploy orders survive, which matters because nothing sequences a migration against the
-- Cloudflare deploy:
--
--   * **Migration first, Worker later.** The deployed Worker parses the answer with Zod, and
--     `z.object` ignores keys it was not told about. The new keys are read by nobody.
--   * **Worker first, migration later.** The new keys are absent, so every one of them is
--     declared `.optional()` in `packages/shared/src/admin.ts` and the panels that need them
--     render a "not known" state rather than a zero. **A zero is the dangerous answer here** —
--     "0 people wrote a medical note" and "this database cannot tell me yet" look identical on a
--     panel and mean opposite things at a first-aid tent.
--
-- =========================================================================================
-- Still `stable`, and still no audit row
-- =========================================================================================
-- Nothing here writes. The first pass's reasoning holds and is worth restating because this
-- function got bigger: **rendering a list is not an audited action.** A row per page render would
-- grow on every refresh and bury the two entries an access review is actually looking for. The
-- functions that read special category data or take a copy out of the platform are `volatile`
-- precisely because they do write one.
--
-- =========================================================================================
-- Minimisation is unchanged, and one addition is worth spelling out
-- =========================================================================================
-- No date of birth, no email address and no medical note leaves through this function — the
-- previous migration's header lists those omissions and none of them moves. `medical_count` is a
-- **count of notes, never a note**, and it is the number the medical panel needs to say whether
-- taking the sheet is worth doing at all. Counting how many exist discloses nothing about what
-- any of them says.

-- -----------------------------------------------------------------------------------------
-- entries.admin_entry_list() — the same rows, and the figures the page states
-- -----------------------------------------------------------------------------------------
-- The `event` object grows; `entries`, `total` and `returned` are unchanged.
--
-- ## The four status counts, and why `held` is not `count(status = 'pending')`
--
-- A `pending` purchase whose hold has run out is not holding anything — its place went back into
-- the pool the instant it lapsed, and `expire_pending_holds()` may not have got round to marking
-- it yet. So `held` counts pending purchases with a **live** hold, character for character the
-- second half of the capacity predicate, and `holds_returned` counts the rest of the pendings
-- alongside the ones already marked `expired`. The two together are every pending row ever
-- written, which is what makes them add up on the page.
--
-- **That is the answer to "is 34 holds expired and returned cheap".** It is one pass over the
-- purchases for this event, in the same query that was already scanning them for `taken` — and
-- it is the figure that explains why "12 of 250" can go *down*, which is otherwise the most
-- alarming thing an organiser sees all week.
--
-- ## `affiliated_missing_ea`, and the state it catches
--
-- **This is reachable, and not by a legacy row.** `packages/shared/src/nn-entry.ts` requires an
-- England Athletics number for any fee with `requires_ea_number`, and drops it for any fee
-- without — but that is the *form's* control. `create_pending_purchase()` takes the entrants as
-- `jsonb` and writes `ea_number` straight through with no check that a fee requiring one got one;
-- the column constraint validates the format of a non-null value and permits null. That function
-- is granted to `anon`, so two ordinary PostgREST calls with the published anon key create an
-- affiliated entrant with no number.
--
-- It is the one committee rule enforced in TypeScript alone. `minimum_age` is re-checked inside
-- `create_pending_purchase()` and is the control; this is not. Until it is, the £2-a-runner
-- affiliation discount can be claimed without the number that justifies it, and this count is
-- what puts that in front of the person doing the England Athletics check.
--
-- ## `medical_delete_after` is computed here, and that is the point
--
-- `entries.events.medical_retention` is the interval the deletion job applies.
-- `race.json`'s `privacy.medicalRetention` is the sentence `/nn/privacy/` publishes, and
-- `packages/db/tests/entries-retention.test.ts` already fails if the two disagree. The medical
-- panel states **a date**, and it has to come from the enforced interval rather than from the
-- published wording: a page that told a volunteer "deleted on 1 December" because a JSON string
-- said "One month" would be reading the promise instead of the mechanism. `event_date +
-- medical_retention` is the mechanism, so it is what the page renders.
create or replace function entries.admin_entry_list(
  p_key text,
  p_event_slug text
) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with authorised as (
    select entries.admin_key_ok(p_key) as ok
  ),
  event as (
    select e.*
      from entries.events as e, authorised
     where authorised.ok
       and e.slug = p_event_slug
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
           exists (
             select 1 from entries.entrant_medical as medical
              where medical.entrant_id = entrant.id
           ) as has_medical
      from entries.entrants as entrant
      join purchase on purchase.id = entrant.purchase_id
      cross join event
      join entries.fees as fee on fee.id = purchase.fee_id
  ),
  -- Newest first for the cap, so what is dropped is the oldest rather than an arbitrary
  -- slice. `entrant_id` is the tiebreaker, which is what makes "the most recent 2,000" mean one
  -- specific set rather than whatever the planner felt like for two rows in the same millisecond.
  rows_capped as (
    select * from rows_all order by created_at desc, entrant_id limit 2000
  )
  select case
    when not (select ok from authorised)
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
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

comment on function entries.admin_entry_list(text, text) is
  'The entries for one event, one row per entrant, plus the figures the admin surface states — places taken, fees taken, holds returned, medical notes held, affiliated claims and the medical deletion date. Requires the admin key. The counts are computed over every purchase; the row array is capped at the most recent 2,000, which is why the two are not derived from each other. No date of birth, no email address and no medical note leaves through this — see the migration headers.';

-- **No grant statement here, deliberately.** `create or replace function` keeps the existing
-- privileges, the anon grant from `20260816091500_entries_admin_reads.sql` still stands, and
-- re-granting would make this migration look like it was widening access when it is not.
