-- A complimentary place is confirmed like any other.
--
-- =========================================================================================
-- The defect
-- =========================================================================================
-- `entries.enqueue_entry_email()` is bound `after update on entries.entry_purchases`, and its
-- confirmation branch fires on `old.status in ('pending','expired') and new.status = 'paid'`.
-- That is the right guard for the path it was written for: a real entry is *held* first and
-- the webhook moves it, so the transition into `paid` is always an update.
--
-- `entries.create_manual_entry()` — ADR-021, the place a volunteer gives away — **inserts** a
-- purchase already `status = 'paid'`. There is no update, so the trigger never fires, and no
-- `entry_confirmed` row is ever written.
--
-- **The silence is total.** Nobody chases an email they were never told to expect, so the club
-- finds out when somebody turns up on 1 November unsure whether they have a place. It affects
-- Kinsi's two complimentary places and the free place a visually impaired runner's guide is
-- given — which is to say, every place the club gives rather than sells.
--
-- =========================================================================================
-- A second trigger rather than one function handling both TG_OP cases
-- =========================================================================================
-- [#150] leaves this open and asks whichever is chosen to say why. Two triggers, for two
-- reasons:
--
--   * **All three branches of `enqueue_entry_email()` compare `old` to `new`, and under
--     `after insert` there is no `old`.** Folding an insert case into it means every existing
--     branch has to be read as *"and this one only runs on update"* — a condition that is
--     nowhere in the text and is carried entirely by an early return at the top. A function
--     whose preconditions are stated at the top of itself is one a reader can check.
--
--   * **It restates nothing.** Re-pasting `enqueue_entry_email()` whole to add a branch is the
--     shape CLAUDE.md warns about for a restated closed list, one object along: two branches in
--     flight at once both merge cleanly and the one applied second wins outright. This
--     migration adds a function and a trigger and touches neither the existing function nor the
--     existing trigger, so there is nothing for a concurrent branch to lose.
--
-- Expand only. Nothing the deployed Worker calls changes shape, and no previously deployed code
-- path behaves differently.

-- -----------------------------------------------------------------------------------------
-- entries.enqueue_entry_email_on_insert()
-- -----------------------------------------------------------------------------------------
create or replace function entries.enqueue_entry_email_on_insert()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $function$
begin
  -- **Guarded on `paid`, and that guard is the whole function.** `create_pending_purchase()`
  -- inserts a `pending` row on every real entry — 250 of them if the race fills — and none of
  -- them owes anybody a message yet. Only a purchase that arrives already paid for has skipped
  -- the transition the update trigger watches.
  if new.status = 'paid' then
    insert into entries.email_outbox (purchase_id, template, recipient, dedupe_key)
    values (
      new.id,
      'entry_confirmed',
      new.purchaser_email,
      -- **The same dedupe key the update path uses**, deliberately. The two triggers are
      -- mutually exclusive today — a row is either inserted paid or updated into paid, never
      -- both — but sharing the key means that if some future path ever did both, the second
      -- would collide with the first and send nothing, rather than confirming one place twice.
      'entry_confirmed:' || new.id::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$function$;

comment on function entries.enqueue_entry_email_on_insert() is
  'Writes the confirmation the club owes for a purchase that is inserted already paid — a complimentary place, which skips the pending status the update trigger watches for. Shares the update path''s dedupe key, so no place can be confirmed twice.';

-- Granted to nobody, and reachable only as a trigger. Same reasoning as
-- `enqueue_entry_email()`: a function that writes the club's outgoing mail is not one anybody
-- may call directly.
revoke all on function entries.enqueue_entry_email_on_insert() from public;

drop trigger if exists enqueue_entry_email_after_insert on entries.entry_purchases;

create trigger enqueue_entry_email_after_insert
  after insert on entries.entry_purchases
  for each row
  execute function entries.enqueue_entry_email_on_insert();
