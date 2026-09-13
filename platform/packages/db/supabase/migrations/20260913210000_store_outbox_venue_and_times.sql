-- ---------------------------------------------------------------------------------------------
-- store.claim_outbox_batch() — hand the drain the venue and the times as well
-- ---------------------------------------------------------------------------------------------
-- **Why this exists: the ticket confirmation gains an HTML part, and it has a Where cell.**
-- ADR-041 makes the change ADR-033 deferred when it shipped ticket mail as plain text, and the
-- skin it introduces states four facts about the occasion: when, where, how many tickets, and
-- what was paid. Three of those the drain already had. The venue it did not, and
-- the start and end times it did not, because the text part never named them.
--
-- **The columns already exist on `store.socials`** — `venue`, `start_time`, `end_time`, all
-- supplied on 5 September 2026 and all already rendered on `/events/christmas-party-2026/`.
-- Nothing new is collected and nothing new is held. What changes is only that the drain can see
-- three columns it was not previously handed.
--
-- ⚠️ **This drops and recreates rather than `create or replace`, and it has to.** Postgres
-- refuses `create or replace function` when the return type changes — `42P13`, *"cannot change
-- return type of existing function"* — and adding a column to a `returns table` is exactly that.
-- The drop and the create are in one migration, so they are one transaction: there is no window
-- in which the function is absent.
--
-- **The deployed Worker is safe across this**, which is the expand-migrate-contract question
-- that matters. `claim_outbox_batch` is called by `apps/main/worker/store-outbox.ts`, which
-- parses each row with a non-strict Zod object — unknown keys are stripped, not refused — so a
-- Worker that predates this migration goes on working against the wider row and simply ignores
-- the three new values. Roll the code back, roll the schema forward.
--
-- ⚠️ **A drop takes the grants with it.** `grant execute ... to anon, authenticated` below is
-- not tidiness: without it the drain loses the privilege it has always had and every ticket
-- email silently stops sending, with the outbox filling up behind it and nothing in any log
-- saying why. `packages/db/tests/store.test.ts` asserts the anon list by name, which is what
-- makes a forgotten grant fail in CI rather than in somebody's inbox.
--
-- **Still guarded by the `stripe` key.** This function hands back real email addresses, so the
-- second factor is the whole reason it can be granted to `anon` at all. The guard is unchanged
-- and is the first statement in the body, before anything is read.

drop function if exists store.claim_outbox_batch(text, int);

create function store.claim_outbox_batch(p_key text, p_limit int default 10)
  returns table (
    id uuid,
    template text,
    recipient text,
    attempts int,
    ticket_no int,
    social_slug text,
    social_name text,
    social_date date,
    -- The three this migration adds. Nullable, because a social may be booked before its room
    -- or its hours are settled — which is the state `christmas-party-2026` itself shipped in.
    venue text,
    start_time time,
    end_time time,
    purchase_created_at timestamptz,
    purchase_id uuid,
    amount_pence int,
    quantity int,
    purchaser_name text,
    reply_to text
  )
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
begin
  if not store.key_ok('stripe', p_key) then
    return;
  end if;

  return query
  update store.email_outbox as outbox
     set attempts = outbox.attempts + 1,
         last_attempt_at = pg_catalog.now()
    from store.ticket_purchases as purchase
    join store.socials as social on social.id = purchase.social_id
   where outbox.id in (
           select candidate.id
             from store.email_outbox as candidate
            where candidate.status = 'pending'
            order by candidate.created_at
            limit greatest(coalesce(p_limit, 10), 1)
            for update skip locked
         )
     and purchase.id = outbox.purchase_id
  returning
    outbox.id,
    outbox.template,
    outbox.recipient::text,
    outbox.attempts,
    purchase.ticket_no,
    social.slug,
    social.display_name,
    social.social_date,
    social.venue,
    social.start_time,
    social.end_time,
    purchase.created_at,
    purchase.id,
    purchase.amount_pence,
    purchase.quantity,
    purchase.purchaser_name,
    social.reply_to;
end;
$$;

comment on function store.claim_outbox_batch(text, int) is
  'Claim up to p_limit pending ticket emails, incrementing attempts under a skip-locked hold, and return everything a message needs joined from the live tables. Takes the stripe key, because it hands back real email addresses. Widened on 13 September 2026 with venue, start_time and end_time for ADR-041''s HTML part.';

grant execute on function store.claim_outbox_batch(text, int) to anon, authenticated;
