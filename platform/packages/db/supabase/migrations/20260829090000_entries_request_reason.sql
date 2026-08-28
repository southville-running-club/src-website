-- Why somebody wants their entry cancelled or transferred, in their own words.
--
-- =========================================================================================
-- What this adds, and why it is not a new decision about personal data
-- =========================================================================================
-- `entries.request_entry_action()` has recorded *which* of two words somebody asked for since
-- the request slice. It has never recorded **why**, and the why is the whole of what a
-- volunteer needs in order to act: "I have broken my ankle" and "my friend wants my place" are
-- the same word on the page and two different afternoons. Without it the club has a list of
-- names and has to write to every one of them to find out what they meant, which is the email
-- round-trip this feature existed to remove.
--
-- **It is one more column on a row that is already about this person, holding text they wrote
-- about their own entry, on a form that says what it is for.** CLAUDE.md makes *collecting a
-- field* a committee decision, and this one was asked for by name. It is optional, it is
-- capped, nothing derives anything from it, and it is deleted with the purchase it belongs to.
-- It is **never exported** — not the start list, not the England Athletics file, not the
-- medical sheet — for the reason `gender_identity` is not: a free-text box is where somebody
-- writes a medical fact without meaning to, and a document read by marshals is the wrong place
-- for it to surface. It is read on `/admin/nn/` and nowhere else.
--
-- =========================================================================================
-- Expand, not replace
-- =========================================================================================
-- The column is nullable with no backfill, so every row already there passes. The function
-- keeps its **two-argument** form as a thin wrapper over the new three-argument one, so a
-- Worker deployed before this migration goes on working and records a reason of null — which
-- is exactly what "did not say" means. Two overloads, neither with a default, so PostgREST
-- resolves by the argument names it is given and there is nothing ambiguous to choose between.

alter table entries.entry_purchases
  add column if not exists request_reason text
    check (
      request_reason is null
      or length(trim(request_reason)) between 1 and 500
    );

comment on column entries.entry_purchases.request_reason is
  'Why the entrant asked the club to cancel or transfer this entry, in their own words, or null because they did not say. Optional, capped at 500 characters, never exported and never published. Replaced when a new request replaces the old one.';

-- -----------------------------------------------------------------------------------------
-- entries.request_entry_action(uuid, text, text) — the runner's half, with a reason
-- -----------------------------------------------------------------------------------------
-- Authorised exactly as the two-argument form is and by nothing the caller passes: `auth.uid()`
-- and the caller's *confirmed* address, character for character the predicate `my_entries()`
-- uses. A purchase id is on a confirmation page and in an email; it is not a credential.
--
-- **The reason is trimmed and an empty one is null**, so a browser posting an untouched
-- textarea records "did not say" rather than "". The 500-character ceiling is enforced by the
-- column's own check as well, which is what makes this the convenience and that the control.
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

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

comment on function entries.request_entry_action(uuid, text, text) is
  'Records that the signed-in caller has asked the club to cancel or transfer one of their own paid entries, with the reason they gave. Authorised by auth.uid() and the caller''s confirmed address, never by the purchase id, which is not a credential. Records the ask and performs nothing.';

revoke all on function entries.request_entry_action(uuid, text, text) from public;
grant execute on function entries.request_entry_action(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- The two-argument form stays, as a wrapper
-- -----------------------------------------------------------------------------------------
-- **This is the expand step and it is the whole of it.** A Worker deployed before this
-- migration calls two arguments; nothing sequences a migration against a Cloudflare deploy, so
-- for the length of a deploy both are live. A wrapper means one body to be wrong in rather than
-- two, and the older caller records exactly what it knows: no reason.
create or replace function entries.request_entry_action(
  p_purchase_id uuid,
  p_action text
) returns jsonb
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select entries.request_entry_action(p_purchase_id, p_action, null::text);
$$;

comment on function entries.request_entry_action(uuid, text) is
  'The reasonless form, kept so a Worker deployed before the reason column goes on working. Delegates to request_entry_action(uuid, text, text) with a null reason.';

revoke all on function entries.request_entry_action(uuid, text) from public;
grant execute on function entries.request_entry_action(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- entries.my_entries() — so the page can say the reason back
-- -----------------------------------------------------------------------------------------
-- Re-pasted whole because Postgres replaces a function body entire. The only change is one
-- key. It is the caller's own words on the caller's own entry, which is the one thing on this
-- row that is theirs to see, and no widening of what this function discloses about anybody
-- else.
--
-- **`read_entry_list()` is deliberately not re-emitted here.** It has carried the request
-- columns into its CTE since they were added and has never emitted them in its rows, so
-- `/admin/nn/` has been rendering a request that is always null — a real defect, and it is
-- closed in the migration beside this one rather than by pasting that 300-line function twice
-- in the same pull request.

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
            -- now the words they used to ask. Both are their own, on their own entry.
            'requested_action', purchase.requested_action,
            'request_reason', purchase.request_reason,
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
