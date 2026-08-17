-- What the admin surface may read, and the four functions that are the whole of it.
--
-- The door is the previous migration's. This is what is behind it: the entries for one event,
-- the interest sign-ups, one entrant's medical note, and the three exports. **Every one of
-- them checks `entries.admin_key_ok()` before it looks at anything at all**, so a caller
-- holding only the published anon key learns nothing — not whether an event exists, not
-- whether an entrant id names a row, not how many people have entered.
--
-- =========================================================================================
-- Minimisation, applied to a read rather than to a write
-- =========================================================================================
-- The principle in this repository is written about *storage* — "sensitive fields are dropped
-- before they reach the database". It applies with the same force to a read, and the
-- deliberate omissions here are the interesting part of the file:
--
--   * **No date of birth ever leaves the database.** The list needs a *category*, which is
--     derived from age and gender, so `age` is computed here — with the identical expression
--     `create_pending_purchase()` uses to enforce the minimum age, so the two cannot disagree
--     — and the band is named by `packages/shared/src/age-category.ts`, which is the one
--     place that mapping lives. A date of birth is a stronger identifier than a birth year
--     and the surface has no use for one.
--
--   * **No email address anywhere in the entries surface.** Not in the list, not in any of
--     the three exports. An organiser checking England Athletics numbers or setting out bibs
--     does not need one, and the entries-attention runbook already has the query for the rare
--     case where somebody must be contacted. The interest list is the exception, and the
--     exception is its entire purpose: the club promised those people one email.
--
--   * **Medical notes are in neither list function.** `admin_entrant_medical()` reads one
--     entrant at a time and writes the audit row that says so, in the same transaction; the
--     medical export is its own kind, with its own audit action. There is no path by which a
--     note is read without a row recording it.
--
--   * **No purchaser name or purchaser email**, which are the *payer* rather than the
--     runner. On a solo race they are usually the same person typed twice, and the runner is
--     the one an organiser needs.
--
-- =========================================================================================
-- Why the on-screen lists are capped and the exports are not
-- =========================================================================================
-- A field of 250 cannot produce a long list of *paid* entries, but abandoned holds are
-- unbounded — `create_pending_purchase()` is granted to anon and every call writes a row. So
-- the two list functions take the most recent 2,000 and **say so in the answer** rather than
-- truncating quietly: `total` is the real count and `returned` is what came back, and the page
-- renders the difference. The exports have no cap at all, because a file with rows missing
-- from it is the failure this whole slice exists to avoid.

-- -----------------------------------------------------------------------------------------
-- entries.admin_entry_list() — the entries for one event
-- -----------------------------------------------------------------------------------------
-- One row per **entrant**, not per purchase: an entrant is who takes a place, and a future
-- paired race puts two of them behind one payment. Everything about the money rides along
-- from the purchase.
--
-- `attention` travels with the row because an over-capacity payment is the one thing on this
-- page that must be impossible to miss — somebody paid for a place the race did not have. The
-- Worker renders it as words and a marker rather than as a colour.
--
-- Sorting and filtering are the Worker's, deliberately. They are enumerated values over at
-- most a couple of hundred rows, and every variant done here would be a branch in SQL that
-- somebody has to read before they can trust the page.
--
-- **`stable`, and it is the audit decision that makes it so.** Nothing here writes: a row per
-- list render would grow on every refresh and bury the two entries that actually matter, so
-- rendering a list is not an audited action. The two functions that read special category data
-- or take a copy out of the platform are `volatile` precisely because they do write one.
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
  -- The capacity predicate, character for character the one `create_pending_purchase()`
  -- counts with: a paid purchase, or a pending one whose hold has not run out. An expired
  -- hold is not holding anything, which is why "12 of 250" can go down as well as up.
  holding as (
    select entrant.id
      from entries.entry_purchases as purchase
      join entries.entrants as entrant on entrant.purchase_id = purchase.id
      join event on event.id = purchase.event_id
     where purchase.status = 'paid'
        or (
          purchase.status = 'pending'
          and (
            purchase.hold_expires_at is null
            or purchase.hold_expires_at > pg_catalog.now()
          )
        )
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
           exists (
             select 1 from entries.entrant_medical as medical
              where medical.entrant_id = entrant.id
           ) as has_medical
      from entries.entrants as entrant
      join entries.entry_purchases as purchase on purchase.id = entrant.purchase_id
      join event on event.id = purchase.event_id
      join entries.fees as fee on fee.id = purchase.fee_id
  ),
  -- Newest first for the cap, so what is dropped is the oldest rather than an arbitrary
  -- slice. The Worker sorts what it is given.
  --
  -- **`entrant_id` is the tiebreaker, and it is what makes "the most recent 2,000" mean one
  -- specific set.** Two entrants created in the same millisecond — a plausible thing at the
  -- moment entries open — would otherwise be ordered by whatever the planner felt like, so the
  -- row that fell off the end could differ between two identical requests.
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
              from entries.entry_purchases as purchase
             where purchase.event_id = event.id
               and purchase.attention is not null
               and purchase.attention_resolved_at is null
          )
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
  'The entries for one event, one row per entrant, for the admin surface. Requires the admin key. No date of birth, no email address and no medical note leaves through this — see the migration header.';

revoke all on function entries.admin_entry_list(text, text) from public;
grant execute on function entries.admin_entry_list(text, text) to anon;

-- -----------------------------------------------------------------------------------------
-- entries.admin_interest_list() — the list nobody has ever read
-- -----------------------------------------------------------------------------------------
-- `intake.nn_interest` has been collecting since the sign-up form shipped and there has never
-- been a way to look at it. The club promised those people **one email when entries open**, so
-- the address is the point of the list rather than an incidental field — this is the one place
-- in the admin surface where an email address is shown, and section 2 of the privacy notice
-- already says the club holds it for that purpose.
--
-- **The anon grant on that table is untouched.** It is still `insert (name, email, consent)`
-- and nothing else, with an insert-only policy; a `security definer` function needs no
-- privilege of its own. `packages/db/tests/nn-interest.test.ts`'s refusals pass unchanged.
--
-- **Consent is shown rather than filtered on.** A row with consent withheld is a legitimate
-- stored value and the club must never email it — so it is rendered plainly as "no", where
-- somebody can see it, instead of being silently dropped from a list whose whole use is
-- deciding who to write to. A filtered list would look complete and would not be.
--
-- The function lives in `entries` rather than in `intake` for one reason: the admin door is
-- there, and one schema holding every object that requires the admin key is one place to audit
-- the grants.
create or replace function entries.admin_interest_list(p_key text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with authorised as (
    select entries.admin_key_ok(p_key) as ok
  ),
  rows_capped as (
    select interest.id, interest.name, interest.email, interest.consent, interest.created_at
      from intake.nn_interest as interest, authorised
     where authorised.ok
     -- `id` is the tiebreaker, for the reason the entry list's is: without one, which rows fall
     -- off the end of the cap is not decided by anything.
     order by interest.created_at desc, interest.id
     limit 2000
  )
  select case
    when not (select ok from authorised)
      then jsonb_build_object('ok', false, 'reason', 'unauthorised')
    else jsonb_build_object(
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
    )
  end;
$$;

comment on function entries.admin_interest_list(text) is
  'The interest sign-ups, newest first, for the admin surface. Requires the admin key. Shows consent rather than filtering on it — the club must be able to see who it may not write to.';

revoke all on function entries.admin_interest_list(text) from public;
grant execute on function entries.admin_interest_list(text) to anon;

-- -----------------------------------------------------------------------------------------
-- entries.admin_entrant_medical() — one note, one audit row, one transaction
-- -----------------------------------------------------------------------------------------
-- **The read and the record of the read are the same statement.** That is the whole reason
-- this is a function rather than a column on the list: there is no ordering in which a note is
-- shown and the audit row is not written, and no caller that can choose to skip it.
--
-- The audit row is written on **every authorised call**, including one that finds no note. The
-- interesting fact is that somebody went looking, not what they found.
--
-- `p_actor` is asserted by the Worker from a cookie it signed itself, and is trusted for the
-- same reason `p_key` is: only something holding the admin key could have minted it.
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
declare
  v_first_name text;
  v_last_name text;
  v_club text;
  v_event_slug text;
  v_notes text;
  v_found boolean;
begin
  if not entries.admin_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

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

comment on function entries.admin_entrant_medical(text, text, uuid) is
  'One entrant''s medical note, and the audit row recording who read it, in one transaction. Requires the admin key. Records the read whether or not a note was found.';

revoke all on function entries.admin_entrant_medical(text, text, uuid) from public;
grant execute on function entries.admin_entrant_medical(text, text, uuid) to anon;

-- -----------------------------------------------------------------------------------------
-- entries.admin_export() — three files, three shapes, and the audit row that goes with each
-- -----------------------------------------------------------------------------------------
-- **The columns differ per kind inside this function rather than in the Worker**, which is the
-- point. If it returned everything and let the caller pick, a medical note would travel to the
-- Worker on every export of a start list — minimisation at the boundary means the boundary is
-- here.
--
--   `ea`          the £2 check. Paid entries on a fee that requires an England Athletics
--                 number, with the number. **No emergency contact and no medical note** — the
--                 membership secretary is comparing a list of numbers against a register.
--   `start-list`  race day. Paid entries, with the category and **the emergency contact**,
--                 which is needed at the finish line and nowhere else.
--   `medical`     paid entries that have a note, and the note. **Its own kind, its own audit
--                 action, and deliberately not a column on either of the others** — a printed
--                 sheet of medical information at race HQ is genuinely useful to a first aider
--                 and is the easiest way for special category data to end up in a car park, so
--                 taking one is a separate decision somebody makes on purpose.
--
-- **Paid only, in all three.** A pending hold is somebody halfway through a payment page and an
-- expired one is a place that came back; neither is a runner, and a start list with either on
-- it sets out bibs for people who are not coming. Over-capacity payments **are** included: they
-- are paid, they consume a place, and that person is running unless somebody has refunded them.
--
-- No cap. A file with rows missing is worse than a large file.
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
declare
  v_event entries.events;
  v_rows jsonb;
begin
  if not entries.admin_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

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

comment on function entries.admin_export(text, text, text, text) is
  'One of three exports for one event — ea, start-list or medical — with the audit row recording who took it and how many rows, in the same transaction. Requires the admin key. The columns differ per kind here rather than in the caller, so a medical note never travels for an export that is not about medical notes.';

revoke all on function entries.admin_export(text, text, text, text) from public;
grant execute on function entries.admin_export(text, text, text, text) to anon;
