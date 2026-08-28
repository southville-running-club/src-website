-- ===========================================================================================
-- The email outbox — #73, and the first thing this platform has ever sent a runner
-- ===========================================================================================
-- **Until this migration, buying a place sent nobody anything.** `/account/entries/` and
-- Stripe's own receipt were the whole of it, and the receipt is a dashboard toggle nobody had
-- recorded checking. This is the table that changes that, for three moments in an entry's
-- life: it was paid for, it was refunded, and it moved to somebody else.
--
-- ## Why a table rather than a `fetch` at the call site
--
-- The obvious build is to call Resend from the Worker the moment the webhook writes `paid`.
-- It is rejected for one reason: **by the time that code runs the money has gone**, and a
-- send that fails there is a runner who paid and was never told — which is, from their side,
-- indistinguishable from the club losing their entry. Resend's free tier caps at **100 emails
-- a day account-wide** against **250 places**, so on the one day this matters most a majority
-- of sends would be refused with a `429`. That is not a hypothetical: it is arithmetic.
--
-- So the row is written **in the same transaction as the thing it is about**. If the
-- transaction commits, the email is owed. Nothing can be lost between deciding to send and
-- recording that decision, because they are the same commit. Delivery is a separate, retryable
-- job that runs later and may fail as often as it likes.
--
-- This is the transactional-outbox shape `docs/solutions/resend-programmatic-email.md`
-- designed, built as designed.
--
-- ## What it deliberately does not hold
--
-- **One piece of personal data: an email address.** No name, no date of birth, no medical
-- note, no amount. Everything a message needs beyond the address is joined from the live
-- tables at send time by `claim_outbox_batch()` in the migration that follows this one, so
-- this table never becomes a second copy of an entry that retention has to chase separately.
--
-- The single exception is the address itself, and it is unavoidable for exactly one template:
-- a transfer **overwrites** `entry_purchases.purchaser_email`, so the person being transferred
-- *away from* cannot be re-derived after the fact. Their address is therefore stored, and the
-- message to them is addressed generically rather than by name — which is why no name column
-- exists here even though one would make a nicer email.
--
-- ⚠️ **Retention is not answered here, and it is one of the privacy notice's four open
-- committee decisions** — "how long an entry record is kept". A sent row is kept so the admin
-- surface can show what happened; nothing deletes it yet. When the committee answers that
-- question this table is one of the places the answer applies, and
-- `entries-retention.test.ts` is the shape that would enforce it.

-- -------------------------------------------------------------------------------------------
-- The table
-- -------------------------------------------------------------------------------------------
create table entries.email_outbox (
  id uuid primary key default gen_random_uuid(),

  -- The entry this is about. `on delete cascade` because an outbox row for a purchase that no
  -- longer exists is a message about nothing — and there is no path that deletes a purchase
  -- today, so this is a guard rather than a behaviour.
  purchase_id uuid not null
    references entries.entry_purchases (id) on delete cascade,

  -- **A closed list, checked.** A template name is what the Worker switches on to build a
  -- message, so an unknown one is a row that can never be sent and would sit `pending`
  -- forever. Adding a fifth is a migration, which is the point.
  template text not null check (
    template in (
      'entry_confirmed',
      'entry_refunded',
      'entry_transferred_out',
      'entry_transferred_in'
    )
  ),

  -- citext for the same reason `entry_purchases.purchaser_email` is: an address is not
  -- case-sensitive and the case-insensitivity belongs in the type rather than in every
  -- comparison somebody remembers to write.
  recipient extensions.citext not null
    check (position('@' in recipient::text) > 1),

  -- `pending` → `sent`, or `pending` → `failed` once it has been tried enough times. A
  -- `failed` row is what the admin surface offers a re-send button for; a `pending` one needs
  -- no button because the drain will get to it on its own.
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),

  -- How many times delivery has been attempted. The drain gives up at three and marks the row
  -- `failed`, because past that a malformed address or a template bug is the likely cause and
  -- a fourth attempt fixes neither.
  attempts int not null default 0 check (attempts >= 0),

  -- Resend's own message id, so a delivery can be found in their dashboard from this row.
  provider_message_id text,

  -- **Never the provider's own error message**, for the reason `worker/stripe.ts` gives about
  -- Stripe's: a provider's error text can quote the value it rejected, which is how an email
  -- address ends up somewhere that was never assessed to hold one. The Worker writes a status
  -- and a short code here and nothing else.
  last_error text check (last_error is null or length(last_error) <= 200),

  created_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,

  -- **The idempotency key, and it is what stops a runner being told twice.** A Stripe webhook
  -- retry re-enters `record_checkout_event()`, finds the purchase already `paid`, and updates
  -- nothing — so the trigger below never fires a second time. This unique constraint is the
  -- belt to that braces: even if some future path did re-run the transition, the second
  -- insert is refused rather than duplicated.
  --
  -- It is a text key rather than `unique (purchase_id, template)` because a place can be
  -- transferred more than once, and each transfer legitimately owes two more emails.
  dedupe_key text not null unique
);

comment on table entries.email_outbox is
  'One row per email the club owes somebody about an entry. Written in the same transaction as the thing it is about, so a committed entry always has its message recorded; delivery is a separate retryable job. Holds an email address and nothing else personal.';

-- A partial index, because the drain only ever asks one question — what is still owed — and
-- the answer is a handful of rows against a table that grows by one per entry forever.
create index email_outbox_pending_idx
  on entries.email_outbox (created_at)
  where status = 'pending';

-- What the admin surface orders by.
create index email_outbox_created_at_idx
  on entries.email_outbox (created_at desc);

-- **RLS on from the first migration, with no policy at all.** Principles require the first;
-- the second is the access control. Nothing selects this table directly — not `anon`, not
-- `authenticated` — and every read below goes through a function that authorises first. A
-- table holding a list of the club's email addresses is not one to open by policy and hope
-- the policy is right.
alter table entries.email_outbox enable row level security;

-- -------------------------------------------------------------------------------------------
-- entries.enqueue_entry_email() — the trigger that owes the message
-- -------------------------------------------------------------------------------------------
-- **A trigger rather than three edits to three functions**, and the reason is not brevity.
-- `record_checkout_event()`, `cancel_entry()` and `transfer_entry()` are each large, each
-- already re-created by a later migration than the one that introduced it, and each would have
-- to be reproduced in full here to add two lines. A trigger states the rule once, against the
-- transition rather than against the function that happens to perform it — which is also what
-- makes it correct for any future path that moves a purchase into the same state.
--
-- It is the same choice Slice G made for rule enforcement: a trigger where the rule spans
-- tables or transitions, a check constraint where it is static.
--
-- **`after update`, so it cannot fire for a transition that then rolls back.**
create or replace function entries.enqueue_entry_email()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
begin
  -- --- the place was paid for -------------------------------------------------------------
  -- The same guard `record_checkout_event()` uses for its own `applied` answer: only the
  -- transition *into* `paid` from a live or lapsed hold owes anybody a message. A webhook
  -- delivered twice updates no row and never reaches here.
  if old.status in ('pending', 'expired') and new.status = 'paid' then
    insert into entries.email_outbox (purchase_id, template, recipient, dedupe_key)
    values (
      new.id,
      'entry_confirmed',
      new.purchaser_email,
      'entry_confirmed:' || new.id::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  -- --- the place was refunded -------------------------------------------------------------
  -- ⚠️ **`cancel_entry()` deletes the entrants**, so by the time this row is drained there is
  -- no runner to name. That is why the refund template addresses the purchaser rather than the
  -- entrant, and why the address comes from the purchase — which survives — rather than from a
  -- join that would find nothing.
  if old.status = 'paid' and new.status = 'refunded' then
    insert into entries.email_outbox (purchase_id, template, recipient, dedupe_key)
    values (
      new.id,
      'entry_refunded',
      new.purchaser_email,
      'entry_refunded:' || new.id::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  -- --- the place moved to somebody else -----------------------------------------------------
  -- **Two messages, and the one to the previous runner is the reason this is a trigger.**
  -- `transfer_entry()` re-points `purchaser_email` at the new person, so `old.purchaser_email`
  -- is the only place the previous address still exists at the moment it is needed. A send
  -- built at any later point could not address them at all.
  --
  -- `status = 'paid'` on both sides because a transfer only ever moves a paid place; without
  -- it, any future correction to an address on a pending purchase would send two emails about
  -- a transfer that did not happen.
  --
  -- **The dedupe key carries the address rather than a clock**, because a place may
  -- legitimately change hands more than once and each move owes its own pair of messages — so
  -- `(purchase_id, template)` alone would silently swallow the second transfer and the person
  -- it moved to would never be told they had a place.
  --
  -- An address rather than `clock_timestamp()`: it is deterministic, it needs no clock inside
  -- a trigger, and the one case it collides on is a place moving back to somebody who has
  -- already been told about it — where sending nothing is the better answer anyway.
  if old.status = 'paid'
     and new.status = 'paid'
     and new.purchaser_email is distinct from old.purchaser_email
  then
    insert into entries.email_outbox (purchase_id, template, recipient, dedupe_key)
    values
      (
        new.id,
        'entry_transferred_out',
        old.purchaser_email,
        'entry_transferred_out:' || new.id::text || ':' || old.purchaser_email::text
      ),
      (
        new.id,
        'entry_transferred_in',
        new.purchaser_email,
        'entry_transferred_in:' || new.id::text || ':' || new.purchaser_email::text
      )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$function$;

comment on function entries.enqueue_entry_email() is
  'Writes the email the club owes for a purchase transition: confirmed on the move into paid, refunded on the move into refunded, and two transfer messages when a paid purchase changes hands. Runs in the transaction that made the change, so a committed entry always has its message recorded.';

-- Granted to nobody, and reachable only as a trigger. Same reasoning as `raise_attention()`:
-- a function that writes the club's outgoing mail is not one anybody may call directly.
revoke all on function entries.enqueue_entry_email() from public;

create trigger enqueue_entry_email_after_update
  after update on entries.entry_purchases
  for each row
  execute function entries.enqueue_entry_email();
