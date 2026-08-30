-- An ask knows whose it was, so a transfer stops handing one runner's words to another.
--
-- =========================================================================================
-- The defect, and it is a disclosure rather than a cosmetic one
-- =========================================================================================
-- `entries.transfer_entry()` re-points `purchaser_email` at the new runner and sets
-- `person_id` null. `entries.my_entries()` matches a purchase on exactly those two things —
-- so the moment a place moves, the new runner matches a purchase whose **entire request
-- history belongs to somebody else**, and `entryCard()` renders every row of it:
--
--   > **Asked for** — You asked the club about transferring this place. The club has dealt
--   > with it. *You told the club: <whatever the previous runner typed>*
--
-- Two problems, and the second is the serious one:
--
--   * **The copy is addressed to the wrong person.** "You asked" is false, and "The club has
--     dealt with it" invites them to wonder what was dealt with. A transfer is precisely the
--     case where the reader is not the asker.
--
--   * **It discloses free text one runner wrote to the club, to a different runner.** The
--     reason box is 500 characters of anything — "my father has died", "I am pregnant", a
--     phone number. It is read on `/admin/nn/` and on the asker's own page, and this was a
--     fourth place nobody decided on.
--
-- =========================================================================================
-- The mechanism, decided 30 August 2026 — an owner stamped on the ask
-- =========================================================================================
-- Chosen in [#148] over a `transferred_at` column on `entry_purchases` and over moving the
-- asks aside at transfer time.
--
-- **It is the only one of the three that survives a place changing hands twice.** A
-- clock-based boundary answers *"was this ask made before the transfer"*, which is a proxy;
-- stamping the owner answers *"whose ask was this"*, which is the actual question. The outbox
-- trigger already treats repeat transfers as a real case — its dedupe key carries the address
-- rather than a clock, for exactly this reason — so a mechanism that degraded on the second
-- transfer would be out of step with the schema around it.
--
-- Cost, accepted: a bigger diff than the timestamp, and a backfill decision for rows already
-- written. The backfill is below and it is the interesting part of this file.
--
-- **Not "delete the history on transfer".** Keeping it is right for `/admin/nn/`: it is the
-- record of why the place moved, and it is what the volunteer acted on. What was missing was a
-- boundary on the *runner's* read, and that is all this adds. `read_entry_list()` and
-- `admin_entry_detail()` are untouched and go on returning every ask.
--
-- =========================================================================================
-- Text and lowered, not citext
-- =========================================================================================
-- The same reason `my_entries()` gives for its own `v_email`: with `search_path = ''` the
-- citext equality operator lives in `extensions` and is not resolvable, and a definer function
-- that unpins its search_path to get one operator has given away the property the pin was for.
-- So the stamp is the already-lowered `v_email` the ownership test above resolves, and the
-- comparison is plain text equality.
--
-- Expand only. Both columns are nullable, nothing is dropped, and a Worker deployed ahead of
-- this migration reads the same keys it read before.

-- -----------------------------------------------------------------------------------------
-- The columns
-- -----------------------------------------------------------------------------------------
alter table entries.entry_requests
  add column if not exists owner_email text,
  add column if not exists owner_person_id uuid;

comment on column entries.entry_requests.owner_email is
  'The confirmed address of whoever made this ask. Text rather than citext so it compares under search_path = ''''. Null where the caller''s address was unconfirmed, and on a backfilled row that could not be attributed — such a row is shown to no runner and stays whole on /admin/nn/.';

comment on column entries.entry_requests.owner_person_id is
  'The auth.uid() of whoever made this ask. Stored beside the address because a purchase reaches a person by person_id or by confirmed address, and an ask has to be reachable the same two ways. Null only on a backfilled row, which predates anyone being recorded.';

-- The question `my_entries()` asks of this table now: one purchase, this caller's asks.
create index if not exists entry_requests_owner_idx
  on entries.entry_requests (purchase_id, owner_email);

-- -----------------------------------------------------------------------------------------
-- The backfill, and why it reads the audit trail
-- -----------------------------------------------------------------------------------------
-- Every row already written has no owner, and the obvious backfill — attribute each to its
-- purchase's *current* `purchaser_email` — is exactly the defect, written down: on a purchase
-- that has already been transferred it stamps the previous runner's ask with the new runner's
-- address, which is the disclosure this migration exists to close.
--
-- **`transfer_entry()` records the address it overwrote.** It writes an `admin_audit` row
-- before it changes anything, carrying `previous_email` — precisely because an audit trail that
-- records only the destination cannot answer the question somebody actually asks afterwards.
-- So the previous holder *is* recoverable, and the rule is:
--
--   * An ask with no transfer at or after it belongs to whoever holds the purchase now.
--   * An ask with a transfer after it belongs to the address that transfer moved the place
--     **away from** — the earliest such transfer, so two hops resolve to the right one of the
--     three people involved rather than to the middle one.
--   * An ask that lands in neither case — a transfer recorded with no `previous_email`, which
--     no deployed version writes but which a hand-run repair could — is attributed to
--     **nobody**. It is then invisible on every runner's page and unchanged on `/admin/nn/`,
--     which is the safe direction: the cost is one runner not seeing their own old ask, and the
--     alternative cost is a stranger reading it.
--
-- `owner_person_id` is backfilled only in the first case, and from the purchase's `person_id`
-- rather than from the asker — who is not recorded anywhere for an ask made before this
-- migration. It is null in the ordinary case anyway, since an account is not required to
-- enter; `owner_email` is what carries the attribution for these rows, and `my_entries()`
-- matches on either.
update entries.entry_requests as request
   set owner_email = attribution.owner_email,
       owner_person_id = attribution.owner_person_id
  from (
    select req.id as request_id,
           case
             when moved.previous_email is not null
               then pg_catalog.lower(moved.previous_email)
             when moved.audit_id is null
               then pg_catalog.lower(purchase.purchaser_email::text)
             else null
           end as owner_email,
           case when moved.audit_id is null then purchase.person_id else null end
             as owner_person_id
      from entries.entry_requests as req
      join entries.entry_purchases as purchase on purchase.id = req.purchase_id
      left join lateral (
        select audit.id as audit_id,
               audit.detail ->> 'previous_email' as previous_email
          from entries.admin_audit as audit
         where audit.action = 'transfer_entry'
           and audit.detail ->> 'purchase_id' = purchase.id::text
           and audit.at >= req.requested_at
         order by audit.at
         limit 1
      ) as moved on true
     where req.owner_email is null
       and req.owner_person_id is null
  ) as attribution
 where request.id = attribution.request_id;

-- -----------------------------------------------------------------------------------------
-- entries.request_entry_action(uuid, text, text) — re-pasted whole, stamping the owner
-- -----------------------------------------------------------------------------------------
-- Postgres replaces a function body entire, so this is the version from
-- `20260829140000_entries_request_history.sql` — the newest one that creates it, checked by
-- grepping every migration that names it, which is the rule that file's own header sets out —
-- with the owner stamped on the row it writes and **nothing else touched**. The two-argument
-- wrapper is unchanged and goes on delegating here.
create or replace function entries.request_entry_action(
  p_purchase_id uuid,
  p_action text,
  p_reason text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
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
  -- **Appended, never replaced.** This is the whole of the fix that built this table: a second
  -- ask is a second row, so pressing *Transfer* and then *Cancel* leaves two, in order, each
  -- with the words that were written at the time — and now each with the person who wrote them.
  --
  -- **The owner is the caller, not the purchase.** The first version of this read
  -- `purchaser_email` and `person_id` off the row the update had just matched, on the
  -- reasoning that the two are the same person here by construction. They are — but
  -- `person_id` on a purchase is **null in the ordinary case**, because an account is not
  -- required to enter and is never created by entering, so the overwhelming majority of
  -- entries are claimed by registering afterwards with the same address. Stamping it copied
  -- that null onto every ask, and `owner_person_id` recorded nothing at all. A database test
  -- caught it.
  --
  -- `auth.uid()` is the person who pressed the button, which is what "whose ask was this"
  -- actually means, and it survives somebody later changing the address on their account.
  -- `v_email` is their confirmed address, already resolved above for the ownership test.
  -- Either one is enough for `my_entries()` to match on, which is why both are stored: a
  -- purchase reaches a person by `person_id` **or** by address, and an ask has to be
  -- reachable the same two ways.
  insert into entries.entry_requests (
    purchase_id, action, reason, owner_email, owner_person_id
  )
  values (p_purchase_id, p_action, v_reason, v_email, auth.uid());

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$function$;

comment on function entries.request_entry_action(uuid, text, text) is
  'Records that the signed-in caller has asked the club to cancel or transfer one of their own paid entries, with the reason they gave, appending to entries.entry_requests with the asker stamped on it as well as replacing the summary on the purchase. Authorised by auth.uid() and the caller''s confirmed address, never by the purchase id. Records the ask and performs nothing.';

revoke all on function entries.request_entry_action(uuid, text, text) from public;
grant execute on function entries.request_entry_action(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.my_entries() — so a runner sees their own asks and only their own
-- -----------------------------------------------------------------------------------------
-- Re-pasted whole from `20260829140000_entries_request_history.sql`, the newest migration that
-- creates it. **Two changes and nothing else touched.**
--
-- 1. `requests` is filtered to the asks this caller owns.
--
-- 2. **The three summary keys are derived from those same owned asks rather than read off the
--    purchase columns**, and that half is not optional. `transfer_entry()` clears
--    `requested_action` and deliberately keeps `request_reason` — the record of why the place
--    moved — so filtering only the list would have left the previous runner's 500 characters
--    reachable through `request_reason`, which `asksFor()` in `worker/account.ts` falls back to
--    whenever `requests` is empty. **Filtering the list alone renders nothing today by luck**:
--    the fallback is keyed on `requested_action`, which happens to be null after a transfer.
--    One future path that resolves an ask without clearing that column and the disclosure is
--    back, through the other door. Closing it in the database rather than in the Worker is this
--    repository's own rule — Zod is the form's control, not the system's.
--
-- The keys keep their names and their types, so a Worker deployed ahead of this migration goes
-- on rendering; what changes is that it can no longer be handed somebody else's words.
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
  'Every entry belonging to the signed-in caller, matched on person_id or on their confirmed address, with every ask *they* have made about each one and none that anybody else has. Never anybody else''s entry, never a medical note, and never the words a previous holder of a transferred place wrote to the club.';
