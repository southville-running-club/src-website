-- ---------------------------------------------------------------------------------------
-- entries.entry_purchases.entry_no — a reference somebody can read out loud
-- ---------------------------------------------------------------------------------------
--
-- ## What was wrong with the one we had
--
-- The reference printed on `/account/entries/`, quoted in all four outbox emails and shown at
-- the head of `/admin/nn/entry/` is the purchase id: `11111111-2222-3333-4444-555555555555`.
-- It is unique, it already exists, and it is what `/admin/nn/` and the Stripe metadata both key
-- on — which is why it was chosen. It is also 36 characters of hexadecimal, and the club's
-- volunteers read it down a phone.
--
-- `worker/account.ts` said so itself when it picked the id: *"a shorter, quotable code would be
-- kinder over the phone and is a new column, which is a decision rather than a rendering
-- choice"*. This is that column, and that decision. See ADR-030.
--
-- ## What the number is
--
-- **A per-event counter, assigned when the purchase row is written.** `NN2026-0042-01092026` is
-- what a runner sees: the event, the number, and the London day the entry was made. The event
-- and the date are derived at render time by `packages/shared/src/entry-reference.ts` from facts
-- that were already on the wire; the only new fact in the database is the number.
--
-- **It counts purchases, not places, and it is not a position in a field.** An abandoned
-- checkout keeps its number, so the paid entries have gaps in theirs — which is honest, because
-- the number identifies a record rather than ranking a runner. Nothing derives from it, nothing
-- sorts by it, and no page presents it as "you are entry 42 of 250".
--
-- ## Why a counter column rather than `max(entry_no) + 1`
--
-- ⚠️ **A reference already emailed to somebody may never come to mean a different entry**, and
-- `max() + 1` cannot promise that: delete the highest-numbered purchase and the next insert
-- takes its number back. Nothing deletes a purchase today — `cancel_entry()` deletes the
-- *entrants* and leaves the purchase as the financial record it is — but a restore, a fixture
-- teardown and a future erasure request all can, and the failure is silent and permanent.
--
-- `entries.events.next_entry_no` is a high-water mark that only ever goes up. The trigger's
-- `update … returning` takes a row lock on the event for the rest of the transaction, which is
-- also what serialises two concurrent inserts — so this needs no advisory lock of its own, and
-- the one the entry path already holds is unaffected. **`row_number()` over the table is the
-- third wrong answer**: it is a rendering of the current table rather than a fact about a row,
-- so two reads of the same entry could disagree.
--
-- ## Why a trigger rather than a line in each writing function
--
-- Two functions insert here today — `create_pending_purchase()` and `create_manual_entry()` —
-- and a third would silently write a null. A `before insert` trigger covers every path there
-- will ever be, which is what lets the column be relied on rather than merely hoped for.
--
-- ## Expand, not migrate
--
-- **`entry_no` is nullable and stays nullable.** The deployed Worker knows nothing about it, and
-- every read added in the next migration treats it as optional — a purchase with no number
-- renders the purchase id, exactly as every reference did until today. `not null` is the
-- contract step and it is not owed yet.

alter table entries.entry_purchases
  add column if not exists entry_no int;

comment on column entries.entry_purchases.entry_no is
  'Per-event sequence number, assigned on insert and never re-issued. The readable half of the reference a runner quotes — see packages/shared/src/entry-reference.ts. Nullable only for rows written before this column existed; nothing derives from it and nothing sorts by it.';

alter table entries.events
  add column if not exists next_entry_no int not null default 1;

comment on column entries.events.next_entry_no is
  'The next entry number this event will issue. A high-water mark that only goes up, so a number is never re-issued after the purchase holding it is deleted. Written only by entries.assign_entry_number().';

-- **Backfilled by creation order, which is the order the trigger will go on using.** So the
-- numbers on the entries taken before today are the ones they would have had, and a reference
-- printed on an email sent last week still resolves.
--
-- `id` is the tiebreaker for two purchases written in the same millisecond, for the reason
-- `read_entry_list()` gives its own cap one: "the oldest first" has to mean one specific order
-- rather than whatever the planner felt like.
with numbered as (
  select id,
         row_number() over (
           partition by event_id
           order by created_at, id
         ) as seq
    from entries.entry_purchases
)
update entries.entry_purchases as purchase
   set entry_no = numbered.seq
  from numbered
 where numbered.id = purchase.id
   and purchase.entry_no is null;

-- The high-water mark starts above whatever the backfill just issued.
update entries.events as event
   set next_entry_no = coalesce(
         (
           select pg_catalog.max(purchase.entry_no) + 1
             from entries.entry_purchases as purchase
            where purchase.event_id = event.id
         ),
         1
       );

-- **Unique per event, and the index is the guarantee rather than the trigger.** The trigger
-- issues the number; this is what makes a duplicate impossible even if some future path writes
-- one itself. A null does not conflict with anything, which is what lets the column stay
-- nullable through the expand step.
create unique index if not exists entry_purchases_event_number_idx
  on entries.entry_purchases (event_id, entry_no);

create or replace function entries.assign_entry_number()
  returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  -- **Never overwrites one.** Nothing sets it today; a restore or a backfill that does must be
  -- able to, because a reference already emailed to somebody is not this trigger's to change.
  if new.entry_no is not null then
    return new;
  end if;

  -- The row lock this takes is what serialises two concurrent inserts on one event, and it is
  -- held for the rest of the transaction. See the header for why the counter is here rather
  -- than derived from the purchases themselves.
  update entries.events
     set next_entry_no = next_entry_no + 1
   where id = new.event_id
  returning next_entry_no - 1 into new.entry_no;

  return new;
end;
$$;

comment on function entries.assign_entry_number() is
  'Issues the next per-event entry number on insert, from entries.events.next_entry_no. Granted to nobody: it is reachable only as a trigger.';

-- Granted to nobody, like `raise_attention()` and `enqueue_entry_email()`. A trigger function is
-- not something a caller may reach, and `create function` grants execute to `public` by default.
revoke all on function entries.assign_entry_number() from public;

-- **`before insert`, so the value is in the row that is written** rather than in a second
-- update afterwards — which would fire `enqueue_entry_email()`'s `after update` trigger for a
-- reason that has nothing to do with anybody being paid.
drop trigger if exists entry_purchases_assign_number on entries.entry_purchases;
create trigger entry_purchases_assign_number
  before insert on entries.entry_purchases
  for each row
  execute function entries.assign_entry_number();
