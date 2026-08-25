-- The `entries` admin reads, behind the `nn-admin` role as well as behind the key.
--
-- `/nn/admin` reads names, clubs, ages, England Athletics numbers, emergency contacts and
-- medical notes. It is opened by `ENTRIES_ADMIN_KEY` plus a key per volunteer, and nobody
-- has installed either — so the whole prefix 404s in production today. That was the correct
-- state while the keys were the plan. #51 gave this database roles; this migration makes one
-- of them mean something.
--
-- =========================================================================================
-- Expand only. Nothing here is the contract
-- =========================================================================================
-- Expand, migrate, contract is load-bearing rather than good practice here — nothing
-- sequences a migration against the Cloudflare deploy, so a migration that dropped `p_key`
-- from `entries.admin_entry_list()` would land before or after the Worker that stopped
-- passing it, and either order breaks the surface in the window between.
--
-- So: **every existing signature survives, with its existing grant to `anon`, answering
-- exactly what it answered before.** Four role-checked counterparts appear beside them.
-- Retiring the key scheme is #63, and it comes after race day and separately.
--
--   * **Migration first, Worker later.** Four functions granted to `authenticated` that
--     nothing calls. The deployed Worker has never heard of them.
--   * **Worker first, migration later.** Cannot happen — #58 is what starts calling these,
--     and it is a later pull request. If it somehow did, PostgREST answers `PGRST202` and
--     `packages/shared/src/admin.ts` turns that into `unavailable`, which the surface
--     renders as "not known" rather than as an empty list.
--
-- =========================================================================================
-- One room, two doors — and why the existing four are rewritten rather than copied
-- =========================================================================================
-- Taken literally, "leave the five key-gated functions untouched" means copying two hundred
-- lines of `admin_entry_list()` — the capacity predicate, the four status counts, the age
-- expression, the 2,000-row cap — into a second function and maintaining both. This
-- repository already has a rule about that shape: `entries-rules.test.ts` exists because a
-- rule that lived in Zod and nowhere else was not enforced at all. Two copies of the query
-- that decides who is on a start list is the same hazard wearing a different hat — the day
-- one is fixed and the other is not, two admin pages disagree about how many people are
-- running.
--
-- So the **read** is extracted into a helper granted to nobody, and the two doors are thin
-- wrappers that authorise and then call it. What "untouched" was protecting is preserved
-- exactly, and asserted rather than asserted-about: the four public signatures, their `anon`
-- grants, their answers, and every existing test in
-- `packages/db/tests/entries-admin.test.ts`, which is run unchanged.
--
-- **The authorisation check still comes first, before an event is resolved and before a row
-- is read.** That ordering is `admin_key_ok()`'s discipline and the reason `unauthorised`
-- discloses nothing about whether an event, an entrant or an entry exists. The wrappers keep
-- it: the helper is reached only from the `else` branch, and `case` evaluates one branch.
--
-- The four helpers are granted to **nobody**. They are the read without the door, which is
-- precisely what must not be callable — reachable only from the definer wrappers below,
-- which run as this schema's owner.
--
-- =========================================================================================
-- The audit actor changes, and it still is not a name
-- =========================================================================================
-- `entries.admin_audit.actor` is `text` with `length(trim(actor)) between 1 and 40`. On the
-- role path it becomes `auth.uid()::text` — a UUID is 36 characters, so **no migration to
-- the column is needed**.
--
-- ADR-013's rule survives intact: *"the handle is a role, not a person's name ... a name
-- there would be personal data in a table whose whole purpose is to be kept and read
-- later."* A UUID is pseudonymous, and the mapping to a human lives in `identity.people`,
-- behind row-level security, rather than in a runbook table maintained by hand. That is
-- strictly better than the handle arrangement it sits beside.
--
-- **The rows written under the key scheme keep their handles.** Mixed values in one column
-- is what a migration between identity schemes looks like, and the runbook's "who has read
-- medical data" query returns both kinds — `entries-admin.test.ts` asserts it.
--
-- =========================================================================================
-- `unauthorised`, not `not_authorised`
-- =========================================================================================
-- `identity.grant_role()` answers `not_authorised`; everything in `entries` answers
-- `unauthorised`. The reason string belongs to the schema that returns it, so these four use
-- `entries`' word — which also means `packages/shared/src/admin.ts`'s `readEnvelope()` maps
-- them without a change. A second spelling there would be a second thing to get right in a
-- parser whose whole job is to turn a refusal into a 404.
--
-- =========================================================================================
-- Still no grant and no policy on any table in `entries`
-- =========================================================================================
-- Nothing here adds one, which is the whole reason these are definer functions rather than
-- row-level security on the entry tables. It is the concern ADR-013 raised about Supabase
-- Auth, answered rather than accepted, and `entries.test.ts` asserts it.
--
-- See docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md.

-- =========================================================================================
-- The reads, without the door. Granted to nobody
-- =========================================================================================

-- -----------------------------------------------------------------------------------------
-- entries.read_entry_list() — the body that was inside admin_entry_list()
-- -----------------------------------------------------------------------------------------
-- Lifted from `20260818120000_entries_admin_figures.sql` with the `authorised` CTE and its
-- `case` branch removed, and nothing else changed. The comments came with it, because they
-- explain the query rather than the door.
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

comment on function entries.read_entry_list(text) is
  'The entries and figures for one event, with no authorisation check of its own. Granted to nobody — reachable only from entries.admin_entry_list() and entries.entry_list(), which are the two doors into it.';

revoke all on function entries.read_entry_list(text) from public;

-- -----------------------------------------------------------------------------------------
-- entries.read_interest_list() — the body that was inside admin_interest_list()
-- -----------------------------------------------------------------------------------------
create or replace function entries.read_interest_list()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with rows_capped as (
    select interest.id, interest.name, interest.email, interest.consent, interest.created_at
      from intake.nn_interest as interest
     -- `id` is the tiebreaker, for the reason the entry list's is: without one, which rows fall
     -- off the end of the cap is not decided by anything.
     order by interest.created_at desc, interest.id
     limit 2000
  )
  select jsonb_build_object(
    'ok', true,
    'total', (
      select pg_catalog.count(*)::int from intake.nn_interest
    ),
    'returned', (select pg_catalog.count(*)::int from rows_capped),
    'consented', (
      select pg_catalog.count(*)::int from intake.nn_interest where consent
    ),
    'interest', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', listed.id,
                   'name', listed.name,
                   'email', listed.email,
                   'consent', listed.consent,
                   'created_at', listed.created_at
                 )
                 order by listed.created_at desc, listed.id
               )
          from rows_capped as listed
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function entries.read_interest_list() is
  'The interest sign-ups, with no authorisation check of its own. Granted to nobody — reachable only from entries.admin_interest_list() and entries.interest_list().';

revoke all on function entries.read_interest_list() from public;

-- -----------------------------------------------------------------------------------------
-- entries.read_entrant_medical() — the read, and the audit row, still one statement
-- -----------------------------------------------------------------------------------------
-- **`p_actor` is still an argument here, and that is not a hole.** This function is granted
-- to nobody: the only two callers are the wrappers below, and each supplies the actor its own
-- door established — the handle from `admin_keys` on the key path, `auth.uid()::text` on the
-- role path. Neither is chosen by the caller.
create or replace function entries.read_entrant_medical(
  p_actor text,
  p_entrant_id uuid
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_first_name text;
  v_last_name text;
  v_club text;
  v_event_slug text;
  v_notes text;
  v_found boolean;
begin
  if p_entrant_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select entrant.first_name, entrant.last_name, entrant.club, event.slug, medical.notes
    into v_first_name, v_last_name, v_club, v_event_slug, v_notes
    from entries.entrants as entrant
    join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
    join entries.events as event on event.id = purchase.event_id
    left join entries.entrant_medical as medical on medical.entrant_id = entrant.id
   where entrant.id = p_entrant_id;

  v_found := found;

  -- **Recorded before the answer is returned, and whether or not there was a note.** A read
  -- that found nothing is still somebody having looked.
  perform entries.record_admin_action(
    p_actor,
    'medical_note',
    jsonb_build_object(
      'entrant_id', p_entrant_id,
      'found', v_found,
      'had_note', v_notes is not null
    )
  );

  if not v_found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'entrant_id', p_entrant_id,
    'event_slug', v_event_slug,
    'first_name', v_first_name,
    'last_name', v_last_name,
    'club', v_club,
    -- Null means the entrant gave no note, or withheld the separate medical consent — the two
    -- are the same absence, because a withheld consent means nothing was ever stored.
    'notes', v_notes
  );
end;
$$;

comment on function entries.read_entrant_medical(text, uuid) is
  'One entrant''s medical note and the audit row recording who read it, in one transaction, with no authorisation check of its own. Granted to nobody — reachable only from entries.admin_entrant_medical() and entries.entrant_medical(), each of which supplies the actor its own door established.';

revoke all on function entries.read_entrant_medical(text, uuid) from public;

-- -----------------------------------------------------------------------------------------
-- entries.read_export() — three files, three shapes, and the audit row that goes with each
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
       and fee.requires_ea_number;

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
  'One of the three exports for one event, with the audit row, and with no authorisation check of its own. Granted to nobody — reachable only from entries.admin_export() and entries.export().';

revoke all on function entries.read_export(text, text, text) from public;

-- =========================================================================================
-- The first door: the admin key. Same signatures, same grants, same answers
-- =========================================================================================
-- **No grant statement anywhere below.** `create or replace function` keeps the existing
-- privileges, the `anon` grants from `20260816091500_entries_admin_reads.sql` still stand,
-- and re-granting would make this migration read as though it were widening access when it
-- is doing the opposite of that.
--
-- Each is now the door and nothing else. Every existing test in
-- `packages/db/tests/entries-admin.test.ts` runs against these unchanged, which is what makes
-- "the key path keeps working" a fact rather than an intention.

create or replace function entries.admin_entry_list(
  p_key text,
  p_event_slug text
) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case
    when not entries.admin_key_ok(p_key)
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
    else entries.read_entry_list(p_event_slug)
  end;
$$;

create or replace function entries.admin_interest_list(p_key text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case
    when not entries.admin_key_ok(p_key)
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
    else entries.read_interest_list()
  end;
$$;

create or replace function entries.admin_entrant_medical(
  p_key text,
  p_actor text,
  p_entrant_id uuid
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not entries.admin_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  return entries.read_entrant_medical(p_actor, p_entrant_id);
end;
$$;

create or replace function entries.admin_export(
  p_key text,
  p_actor text,
  p_event_slug text,
  p_kind text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not entries.admin_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  return entries.read_export(p_actor, p_event_slug, p_kind);
end;
$$;

-- =========================================================================================
-- The second door: the nn-admin role. Granted to `authenticated`, and to nothing else
-- =========================================================================================
-- **No counterpart to `admin_sign_in()`.** Signing in is `/account/`'s job now, and a second
-- way to mint a session is the thing #63 exists to remove rather than something to add.
--
-- Every one of the four:
--
--   * checks `identity.has_role('nn-admin')` **first**, before an event is resolved and
--     before a row is read;
--   * takes **no key and no actor** — both now come from the JWT rather than from an
--     argument the caller chooses;
--   * refuses with the same whole answer the key path gives, so a caller cannot learn from
--     the refusal whether an event, an entrant or an entry exists.
--
-- `identity.has_role()` is reachable from here because these run as this schema's owner —
-- the same property that lets them read `entries.entrants` without a grant. A caller holding
-- only `member` never gets past the first line.

create or replace function entries.entry_list(p_event_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case
    when not identity.has_role('nn-admin')
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
    else entries.read_entry_list(p_event_slug)
  end;
$$;

comment on function entries.entry_list(text) is
  'The entries and figures for one event, for a signed-in caller holding nn-admin. The role counterpart to entries.admin_entry_list(); both read entries.read_entry_list(), so the two doors cannot disagree about who is on a start list.';

revoke all on function entries.entry_list(text) from public;
grant execute on function entries.entry_list(text) to authenticated;

create or replace function entries.interest_list()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case
    when not identity.has_role('nn-admin')
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
    else entries.read_interest_list()
  end;
$$;

comment on function entries.interest_list() is
  'The interest sign-ups, for a signed-in caller holding nn-admin. The role counterpart to entries.admin_interest_list().';

revoke all on function entries.interest_list() from public;
grant execute on function entries.interest_list() to authenticated;

-- **`auth.uid()::text` is the actor, and it is read here rather than passed in.** That is the
-- whole difference between this and the key path: there, the Worker asserts a handle from a
-- cookie it signed itself; here, the audit row names the subject of a JWT GoTrue issued, and
-- no caller can choose it.
create or replace function entries.entrant_medical(p_entrant_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_role('nn-admin') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  return entries.read_entrant_medical(auth.uid()::text, p_entrant_id);
end;
$$;

comment on function entries.entrant_medical(uuid) is
  'One entrant''s medical note and the audit row recording who read it, for a signed-in caller holding nn-admin. The actor is auth.uid(), which is pseudonymous and maps to a human only through identity.people — see ADR-013 on why that column is never a name.';

revoke all on function entries.entrant_medical(uuid) from public;
grant execute on function entries.entrant_medical(uuid) to authenticated;

create or replace function entries.export(p_event_slug text, p_kind text)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not identity.has_role('nn-admin') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  return entries.read_export(auth.uid()::text, p_event_slug, p_kind);
end;
$$;

comment on function entries.export(text, text) is
  'One of the three exports for one event, with the audit row, for a signed-in caller holding nn-admin. The role counterpart to entries.admin_export().';

revoke all on function entries.export(text, text) from public;
grant execute on function entries.export(text, text) to authenticated;
