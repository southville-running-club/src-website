-- Confirming a payment — the only thing in this platform that may write `paid`.
--
-- Slice A built the schema and granted the anon role nothing on any table. Slice B added the
-- three functions that hold a place and hand somebody to Stripe, and was emphatic that
-- **nothing moved a purchase to `paid`**. This migration is the thing that does, and it is the
-- only one that ever should.
--
-- The money has already left a runner's account by the time any of this runs. That inverts
-- the rule the two slices before it followed. Slice A and Slice B fail **towards taking no
-- money**, because no money had been taken; every failure direction there is "stop, store
-- nothing, charge nothing". Here the charge has happened, so the only safe failure is one
-- that is **loud and retried**. A quiet success is how somebody pays £17 and gets no race.
--
-- ---------------------------------------------------------------------------------------
-- The three decisions in this file, and where each is argued
-- ---------------------------------------------------------------------------------------
--   1. **A payment that arrives after the hold lapsed is still `paid`**, and the exception
--      rides beside it on the row rather than in `status`. No fifth status value, and not one
--      character of `create_pending_purchase` changes. See "the revival", below.
--   2. **Idempotency is the state guard**, not a table of Stripe event ids. See "delivered
--      twice", below.
--   3. **The transition function needs a second factor beyond the anon key**, because the
--      anon key is published in page source and `create_pending_purchase` hands any caller a
--      real purchase id. See "the caller", below — it is the one thing here that Slice B's
--      shape does not already answer, and it is not optional.
--
-- ---------------------------------------------------------------------------------------
-- What is still true after this migration
-- ---------------------------------------------------------------------------------------
-- **The anon role still holds no grant on any table in this schema.** Six callable functions
-- now instead of four, no table privilege at all, and `tests/entries.test.ts`'s refusals —
-- every table, every verb, by error code — still pass untouched. The one new table below is
-- added to that walk in the same commit. **If one of those refusals starts failing after this
-- migration, this migration granted something it should not have.**
--
-- ---------------------------------------------------------------------------------------
-- Expand, migrate, contract
-- ---------------------------------------------------------------------------------------
-- Nothing here removes or narrows anything. Both deploy orders survive, and this is the slice
-- where that matters most, because one of the orders has real money moving through it:
--
--   * **Migration first, Worker later.** Six nullable columns nobody writes, one table nobody
--     reads, and two functions nobody calls. `expire_pending_holds()` returns two extra keys
--     and the deployed Slice B Worker parses its answer with a non-strict Zod object, which
--     strips unknown keys — so it logs exactly the line it logged yesterday.
--   * **Worker first, migration later.** `record_checkout_event` does not exist, PostgREST
--     answers `PGRST202`, and the webhook returns **500**. Stripe retries for three days,
--     which comfortably outlives any deploy, and every payment in that window lands the moment
--     the migration does. Nothing is dropped and nothing is confirmed early.
--
-- The one thing that is **not** expand-safe and is therefore not done: renaming the advisory
-- lock literal. See the note above `record_checkout_event`.

-- ---------------------------------------------------------------------------------------
-- The columns — six, all nullable, none carrying a person
-- ---------------------------------------------------------------------------------------
alter table entries.entry_purchases
  -- **Set when a payment arrived after the row had stopped holding a place.** A statistic the
  -- committee will ask for about the entry window ("how many people paid late?"), and the
  -- first thing to look at when a start list and a bib count disagree. Recorded whether or not
  -- capacity allowed it, because the interesting fact is that it was late, not that it fitted.
  add column revived_at timestamptz,

  -- **Evidence, never a key.** Which Stripe event applied the transition, kept for a
  -- post-mortem. It is emphatically not the idempotency mechanism — see "delivered twice".
  add column stripe_event_id text,

  -- **Non-null means a human has to look at this row**, and until `attention_resolved_at` is
  -- set, the five-minute sweep says so again every five minutes.
  --
  -- One column for every kind of anomaly rather than one column per kind, so that the cron
  -- count, the runbook query, the partial index below and Slice D's confirmation email are all
  -- the same predicate — `attention is not null and attention_resolved_at is null`. A new kind
  -- of anomaly is then a new value in a check list rather than a new column, a new index and
  -- four new places that have to remember it.
  add column attention text,
  add column attention_at timestamptz,
  add column attention_detail jsonb,
  add column attention_resolved_at timestamptz;

-- **No constraint ties any of these to `status` or to `paid_at`, and that is deliberate.**
-- The obvious one — "an over-capacity row must be paid" — is a trap. `refunded` requires
-- `paid_at` to be null under `entry_purchases_paid_has_timestamp`, so refunding an
-- over-capacity entry (the club's own documented remedy) would violate it, and the only way
-- through would be to clear the flag as well, destroying the record that the row was ever
-- oversold. A constraint that gets dropped under pressure is worse than one never written.
--
-- The pre-existing oddity is worth naming while it is in view: **`refunded` forces `paid_at`
-- to null**, so a refund erases when the money arrived. That is inherited from Slice A and is
-- the refund slice's problem to fix — not something to re-decide quietly here, in a migration
-- about something else.
alter table entries.entry_purchases
  add constraint entry_purchases_attention_known check (
    attention is null
    or attention in (
      'over_capacity',
      'amount_mismatch',
      'paid_after_refund',
      'session_conflict',
      'no_payment_intent'
    )
  ),
  -- Internal consistency only. This one can never fight the status column, which is why it is
  -- the only one here.
  add constraint entry_purchases_attention_timed check (
    (attention is null) = (attention_at is null)
  ),
  add constraint entry_purchases_attention_detail_object check (
    attention_detail is null or jsonb_typeof(attention_detail) = 'object'
  ),
  add constraint entry_purchases_attention_resolved_is_raised check (
    attention_resolved_at is null or attention is not null
  );

-- Partial, because the interesting rows are a handful against a field of 250 and the query
-- that reads them runs every five minutes forever.
create index entry_purchases_attention_idx
  on entries.entry_purchases (attention_at)
  where attention is not null and attention_resolved_at is null;

comment on column entries.entry_purchases.attention is
  'Non-null means a human must look at this row. One predicate for every anomaly the webhook cannot resolve on its own. Never rendered to a browser — the runner is told by a person, not by a page.';
comment on column entries.entry_purchases.attention_resolved_at is
  'Set by hand when somebody has dealt with it. The alarm is silenced by this and never by the calendar.';
comment on column entries.entry_purchases.revived_at is
  'Set when a payment arrived after this row had stopped holding a place. Recorded whether or not capacity allowed it.';
comment on column entries.entry_purchases.stripe_event_id is
  'Which Stripe event applied the transition. Evidence for a post-mortem, never an idempotency key.';

-- **Corrects Slice A.** That migration's comment says `hold_expires_at` is "null once paid".
-- Nothing ever nulled it, and nothing should: it is the record of the hold that was taken, and
-- `paid_at > hold_expires_at` is precisely what says a payment arrived late. Clearing it would
-- leave a revived row unable to say what it was revived from.
comment on column entries.entry_purchases.hold_expires_at is
  'When the held place lapses. NOT cleared once paid — it is the record of the hold, and paid_at > hold_expires_at is what says a payment arrived after it. Capacity counts a paid row regardless of this value.';

-- ---------------------------------------------------------------------------------------
-- The caller — why a second factor exists, and why it is not optional
-- ---------------------------------------------------------------------------------------
-- Every other function in this schema is granted to `anon` and that is safe, because none of
-- them can be abused with what they accept: `entry_state()` reads public configuration,
-- `create_pending_purchase()` chooses the price itself, `attach_checkout_session()` writes one
-- column once, `expire_pending_holds()` can only move a hold that has already lapsed.
--
-- **A function that writes `paid` is different, and granting it to `anon` alone would be a free
-- race entry.** The anon key is published in page source by design. `create_pending_purchase`
-- is granted to anon and *returns the purchase id and the amount it computed*. So once entries
-- open, two ordinary PostgREST calls with the published key —
--
--     1. create_pending_purchase(...)      -> { purchase_id, amount_pence, ... }
--     2. record_checkout_event(that id, that amount, 'gbp', any session string)
--
-- — would produce a `paid` purchase and a consumed place, for nothing. No uuid guessing, no
-- cleverness, no Stripe involved. The purchase id is not a secret; it is issued on request.
--
-- So the function takes a **key**, and the grant is still `to anon` and nothing else. The
-- Worker holds it as `ENTRIES_WEBHOOK_KEY`, a Worker secret set with `wrangler secret put`,
-- never in this repository, never in `wrangler.jsonc`, never in a `vars` block.
--
-- **The digest is stored, never the key.** A leak of this table yields a SHA-256 of 32 random
-- bytes, which is not a preimage anybody is finding. It is also why the comparison below does
-- not need to be constant time: a perfect timing oracle over PostgREST would reveal the
-- *digest*, which is already assumed public, and leave the attacker exactly where they started.
--
-- **`pg_catalog.sha256(bytea)` is core Postgres.** No extension is added for this.
--
-- The row ships with a **null digest**, which refuses everything. That is the same shape as
-- `STRIPE_SECRET_KEY` being unset: a real, safe state that says "not connected yet" rather
-- than a placeholder that half works. Installing it is one documented manual step in
-- `apps/main/README.md`.
create table entries.webhook_secrets (
  name text primary key,
  key_sha256 text check (key_sha256 is null or key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

comment on table entries.webhook_secrets is
  'The digest of the shared key the webhook presents, never the key. RLS on, no policy, no grant — reachable only from the security definer function below. If tests/entries.test.ts stops refusing this table, a credential digest became readable with a key that is published in page source.';

alter table entries.webhook_secrets enable row level security;

insert into entries.webhook_secrets (name) values ('stripe')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------------------
-- entries.raise_attention() — internal, and granted to nobody at all
-- ---------------------------------------------------------------------------------------
-- **First raise wins**, and that is the whole reason this is a function rather than five
-- copies of an `update`. Stripe retries, so the same anomaly arrives repeatedly; re-stamping
-- `attention_at` on each delivery would reset the age the alarm escalates on, and an anomaly
-- that is permanently "0 hours old" never reads as urgent.
--
-- **No grant, not even to anon.** It is reachable only from `record_checkout_event` below,
-- which runs as this schema's owner because it is `security definer`. A helper that writes an
-- alarm flag has no business being callable by a key in page source.
create or replace function entries.raise_attention(
  p_purchase_id uuid,
  p_reason text,
  p_detail jsonb
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  update entries.entry_purchases
     set attention = p_reason,
         attention_at = pg_catalog.now(),
         attention_detail = p_detail
   where id = p_purchase_id
     and attention is null;
end;
$$;

comment on function entries.raise_attention(uuid, text, jsonb) is
  'Flags a purchase for a human. First raise wins, so a retried delivery cannot reset the age the alarm escalates on. Granted to nobody — reachable only from entries.record_checkout_event().';

revoke all on function entries.raise_attention(uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------------------
-- entries.record_checkout_event() — the one door that writes `paid`
-- ---------------------------------------------------------------------------------------
-- Slice B's shape exactly: `security definer` so it can write tables the caller holds no
-- privilege on, `set search_path = ''` with every reference schema-qualified because an
-- unpinned search_path on a definer function is the standard Postgres escalation, `revoke all
-- from public` first so the grant is the complete list of who may call it.
--
-- **`volatile`, and it is load-bearing here for the same reason it is in
-- `create_pending_purchase`.** Under READ COMMITTED a `stable` function's queries run against
-- the *calling* statement's snapshot — so a second delivery that queued behind the first would
-- read the purchase as it was before the transaction it waited for committed, and the lock
-- would protect nothing. `volatile` takes a fresh snapshot per statement, which is what makes
-- "wait for the lock, then read" mean what it reads like.
--
-- ## The lock, and the literal that must never be tidied
--
-- The advisory lock taken below is **the same lock `create_pending_purchase` takes**, on the
-- same two int4 arguments, computed from the same string. That is not a coincidence to be
-- cleaned up — it is the entire point. The revival path reads the capacity count and then
-- writes, which is the identical count-then-insert race the entry path solved in 2023's
-- shape; if this took a *different* lock it would serialise webhooks against webhooks and
-- nothing else, and a revival and a live entry would each take the last place.
--
-- **`'entries.create_pending_purchase'` is now vocabulary shared by two functions and cannot
-- be renamed.** The literal is what identifies the lock, not the function it was named after.
-- Extracting it into a helper would be tidier and would require `create or replace` over the
-- 330-line function whose per-event lock is the only thing standing between this club and
-- overselling a race that sold out in 2023 — proved under real concurrent connections by
-- `tests/entries-capacity.test.ts`, with a deliberate oversell as its control. That function is
-- not reopened to improve a string. `entries-capacity.test.ts` gains a test that races a
-- revival against a fresh entry, which is what would actually catch somebody tidying one and
-- not the other.
--
-- **The lock is taken before the row is read**, and always, never conditionally. The decision
-- "is this a revival" is itself made under the lock. It is also the lock ordering that cannot
-- deadlock: everything in this schema takes the advisory lock first and the row lock second,
-- so there is no cycle to find.
--
-- ## Delivered twice
--
-- Stripe retries on any non-2xx and can duplicate regardless, so this is written to be applied
-- repeatedly. **The mechanism is the state guard, and there is no table of processed event
-- ids.** Four things already in the schema do the work:
--
--   1. the advisory lock, so two deliveries cannot interleave;
--   2. `select ... for update`, so the second waits for the first to commit — and so the
--      five-minute sweep cannot demote a row this function just paid: `expire_pending_holds`
--      is a bare `update ... where status = 'pending'`, and under READ COMMITTED it
--      re-evaluates that predicate against our committed row and matches nothing;
--   3. `volatile`, so the second delivery reads the committed result rather than a stale
--      snapshot;
--   4. the transition itself, one statement carrying `and status in ('pending', 'expired')`,
--      whose own `row_count` is both the change and the report of whether it happened. A
--      second delivery writes nothing and says so.
--
-- A processed-events table was considered and rejected. It does not close the hole people
-- imagine it closes — a crash between the commit and a side effect — it *widens* it: the event
-- is recorded as processed, Stripe's retry is refused at the door, and nothing ever runs the
-- side effect. Slice D's confirmation email wants a `confirmation_sent_at` marker on the row,
-- swept by the cron that already runs; that is per-purchase, which is the grain the email
-- actually has. And the cost here is specific: a seventh table in a schema whose defining
-- property is that no role holds a table privilege, needing an RLS decision, a retention story
-- nobody has, and an anon-triggered unbounded insert where none exists today.
--
-- ## The revival — a payment that arrives after the hold lapsed
--
-- The hold is 31 minutes. Somebody pays at minute 34. The money is gone from their account and
-- the place is back in the pool. **The payment is never refused**, because refusing leaves the
-- club holding money with nothing against it, which is worse than every alternative.
--
-- `status` becomes `'paid'` — the same value as every other payment — and the exceptional part
-- rides beside it as `attention = 'over_capacity'` when there was no room. Three reasons:
--
--   * **The capacity predicate inside `create_pending_purchase` counts `status = 'paid'`.** A
--     fifth status value would be invisible to it, so an oversold place would read as free and
--     be sold to a *second* person — one person's problem turned into an unrecoverable
--     double-sale on race morning. Keeping one money-status means that function is not
--     reopened at all.
--   * **Counting the place is self-limiting; not counting it compounds.** The committee's most
--     likely remedy is "fine, take 251". If the row does not count, raising capacity to 251
--     opens place 251 to the internet instead of resolving the person who already paid, and
--     the fix re-oversells the race. If it counts, raising capacity to 251 resolves exactly
--     that one person and sells nothing new — and a refund (`refunded`, which is not counted)
--     returns the place the same instant.
--   * A reconciliation that asks "what have we taken" must find this row. It is money the club
--     is holding.
--
-- **The test for "did this row stop holding a place" is the capacity predicate, not
-- `status = 'expired'`.** A `pending` row whose hold lapsed four minutes ago is already gone as
-- far as capacity is concerned, whether or not the five-minute sweep has touched it — Slice B
-- makes "capacity does not depend on this cron having run" an explicit invariant, and keying
-- this on `expired` would quietly make the webhook's correctness depend on a scheduler.
--
-- The consequence to write down, because it is not obvious from any single row: **"sold out"
-- can now mean "oversold and therefore closed"**, and the count of unresolved `over_capacity`
-- rows is exactly how many places over the field is. A race director reading "250 of 250"
-- without running the attention query sets out the wrong number of bibs. That is in the
-- runbook.
--
-- ## The arguments
--
--   p_key                  the shared key, in the clear. Compared as a digest. See above.
--   p_event_type           Stripe's `type`. Only two are acted on; everything else is ignored.
--   p_session_id           the Checkout session, for the mismatch gate and for reconciliation.
--   p_client_reference_id  the purchase id, as the session carried it. Anything that is not a
--                          uuid naming a row of ours is `not_ours` and **not an error** — this
--                          Stripe account may also carry the club's England Athletics portal
--                          payments, and returning an error would make Stripe retry forever on
--                          somebody else's money.
--   p_amount_total         what Stripe says was charged, in pence.
--   p_currency             what Stripe says it was charged in. Checked, because
--                          `adaptive_pricing` is switched off at session creation precisely so
--                          nobody is charged a converted amount, and this is what proves that
--                          setting is still doing its job.
--
-- ## The result
--
--   { "ok": bool, "outcome": text, "applied": bool, "revived": bool, "over_capacity": bool }
--
-- Structured rather than raised, like everything else here: the caller has to decide an HTTP
-- status for Stripe, and "this is somebody else's payment" and "the database is down" must not
-- arrive as the same exception.
-- **Everything after the event type defaults to null**, and that is about the generated
-- TypeScript rather than about SQL. `supabase gen types` models an argument without a default
-- as required and non-nullable, so a caller passing an honest `null` — which Stripe really does
-- send for `client_reference_id` on a session this code never created — would not typecheck.
-- With a default, the key is omitted instead, which is the same call and the pattern
-- `create_pending_purchase`'s `p_discount_code` already uses.
create or replace function entries.record_checkout_event(
  p_key text,
  p_event_type text,
  p_session_id text default null,
  p_client_reference_id text default null,
  p_amount_total int default null,
  p_currency text default null,
  p_payment_intent_id text default null,
  p_stripe_event_id text default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_digest text;
  v_purchase_id uuid;
  v_event_id uuid;
  v_capacity int;
  v_purchase entries.entry_purchases;
  v_session text;
  v_intent text;
  v_event_ref text;
  v_holds boolean;
  v_revived boolean;
  v_taken int;
  v_wanted int;
  v_over boolean;
  v_updated int;
begin
  -- --- the caller, before anything else --------------------------------------------------
  -- Checked before the purchase is looked up, so a wrong key cannot be used to probe which
  -- purchase ids exist.
  select secret.key_sha256 into v_digest
    from entries.webhook_secrets as secret
   where secret.name = 'stripe';

  if v_digest is null
     or p_key is null
     or pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
        ) is distinct from v_digest
  then
    -- `ok: false`, so the Worker answers 5xx and Stripe retries. A key that is wrong because
    -- nobody has installed the digest yet is a deployment state, and the payments in that
    -- window are held by Stripe's retry queue rather than dropped.
    return jsonb_build_object('ok', false, 'outcome', 'unauthorised');
  end if;

  -- --- is this ours at all ----------------------------------------------------------------
  -- Every answer here is `ok: true`: an event about somebody else's payment is an ordinary
  -- thing for this endpoint to receive, and the only wrong response is one that makes Stripe
  -- keep trying.
  begin
    v_purchase_id := p_client_reference_id::uuid;
  exception
    when invalid_text_representation then
      return jsonb_build_object('ok', true, 'outcome', 'not_ours', 'applied', false);
  end;

  if v_purchase_id is null then
    return jsonb_build_object('ok', true, 'outcome', 'not_ours', 'applied', false);
  end if;

  select purchase.event_id into v_event_id
    from entries.entry_purchases as purchase
   where purchase.id = v_purchase_id;

  if not found then
    return jsonb_build_object('ok', true, 'outcome', 'not_ours', 'applied', false);
  end if;

  -- --- the capacity lock, before the row is read and whatever kind of event this is --------
  -- See the note above. The literal is shared with `create_pending_purchase` on purpose.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('entries.create_pending_purchase'),
    pg_catalog.hashtext(v_event_id::text)
  );

  select * into v_purchase
    from entries.entry_purchases as purchase
   where purchase.id = v_purchase_id
     for update;

  if not found then
    return jsonb_build_object('ok', true, 'outcome', 'not_ours', 'applied', false);
  end if;

  v_session := nullif(pg_catalog.btrim(coalesce(p_session_id, '')), '');
  v_intent := nullif(pg_catalog.btrim(coalesce(p_payment_intent_id, '')), '');
  v_event_ref := nullif(pg_catalog.btrim(coalesce(p_stripe_event_id, '')), '');

  -- --- a session that is not the one this purchase was handed ------------------------------
  -- The purchase already names a Checkout session and this event names a different one. That
  -- should be impossible, and if it happens it means two sessions exist against one held place
  -- — so nothing is written and a human is told. Returned as `ok: true`: retrying will deliver
  -- the same disagreement forever.
  if v_purchase.stripe_checkout_session_id is not null
     and v_session is not null
     and v_purchase.stripe_checkout_session_id <> v_session
  then
    perform entries.raise_attention(
      v_purchase_id, 'session_conflict', jsonb_build_object('event_type', p_event_type)
    );
    return jsonb_build_object('ok', true, 'outcome', 'session_mismatch', 'applied', false);
  end if;

  -- --- checkout.session.expired -------------------------------------------------------------
  -- Belt and braces: the five-minute sweep already does this, and both must be safe to run in
  -- either order and repeatedly. **A paid purchase is never demoted by an expiry event** — the
  -- transition is monotone, and a late `expired` for a session that was in fact paid must not
  -- undo it.
  if p_event_type = 'checkout.session.expired' then
    if v_purchase.status = 'paid' then
      return jsonb_build_object('ok', true, 'outcome', 'already_paid', 'applied', false);
    end if;

    update entries.entry_purchases
       set status = 'expired'
     where id = v_purchase_id
       and status = 'pending';

    get diagnostics v_updated = row_count;

    -- `hold_expires_at` is left as it was, exactly as the sweep leaves it: it is the record of
    -- when the place went back.
    return jsonb_build_object(
      'ok', true,
      'outcome', case when v_updated = 1 then 'expired' else 'ignored' end,
      'applied', v_updated = 1
    );
  end if;

  -- --- everything that is not one of the two ----------------------------------------------
  -- Stripe sends more than anybody subscribes to. Ignored with a success, never an error.
  if p_event_type is distinct from 'checkout.session.completed' then
    return jsonb_build_object('ok', true, 'outcome', 'ignored', 'applied', false);
  end if;

  -- --- already applied ----------------------------------------------------------------------
  -- The whole of the idempotency guarantee, and what will stop Slice D sending a second
  -- confirmation email.
  if v_purchase.status = 'paid' then
    return jsonb_build_object('ok', true, 'outcome', 'already_paid', 'applied', false);
  end if;

  -- --- paid after a refund ------------------------------------------------------------------
  -- A webhook does not undo a human. Somebody refunded this and a completed event arrived
  -- afterwards; the row is left exactly as the person who refunded it left it, and they are
  -- told.
  if v_purchase.status = 'refunded' then
    perform entries.raise_attention(v_purchase_id, 'paid_after_refund', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'outcome', 'paid_after_refund', 'applied', false);
  end if;

  -- --- the amount, and the currency ---------------------------------------------------------
  -- **This should never fire.** The amount was computed by `create_pending_purchase` from
  -- `entries.fees` and travelled to Stripe as `price_data` in the same request; there is no
  -- Stripe Price object to disagree with it. If it ever does disagree, something happened that
  -- nobody anticipated, and the answer is to write nothing, flag it, and let a person work out
  -- what. A retry would deliver the same wrong number forever, so this is `ok: true`.
  --
  -- The currency is checked for its own reason: `adaptive_pricing[enabled]=false` is set at
  -- session creation so that nobody is charged a converted amount at a rate nobody here chose,
  -- and this assertion is what proves that setting is still doing its job. A null currency is
  -- rejected rather than assumed — `coalesce(p_currency, '')` never equals 'gbp'.
  if p_amount_total is null
     or p_amount_total <> v_purchase.amount_pence
     or pg_catalog.lower(coalesce(p_currency, '')) <> 'gbp'
  then
    perform entries.raise_attention(
      v_purchase_id,
      'amount_mismatch',
      jsonb_build_object(
        'expected_pence', v_purchase.amount_pence,
        'stripe_pence', p_amount_total,
        'stripe_currency', p_currency
      )
    );

    return jsonb_build_object(
      'ok', true,
      'outcome', 'amount_mismatch',
      'applied', false,
      'expected_pence', v_purchase.amount_pence,
      'stripe_pence', p_amount_total
    );
  end if;

  -- --- did this row still hold a place ------------------------------------------------------
  -- The capacity predicate, not the status. See the note above.
  v_holds := v_purchase.status = 'pending'
             and (
               v_purchase.hold_expires_at is null
               or v_purchase.hold_expires_at > pg_catalog.now()
             );
  v_revived := not v_holds;

  -- How many places this purchase takes. Entrant rows, exactly as `create_pending_purchase`
  -- counts them — the entrant rows are the record of who is taking a place, and
  -- `entrants_per_entry` is configuration that can legitimately change.
  select pg_catalog.count(*)::int into v_wanted
    from entries.entrants as entrant
   where entrant.purchase_id = v_purchase_id;

  -- The same count `create_pending_purchase` takes, **excluding this row**. The exclusion is
  -- load-bearing rather than tidy: in the ordinary case this row is still `pending` with a live
  -- hold, so counting it in both `v_taken` and `v_wanted` would report every single payment as
  -- over capacity. Counted unconditionally on both paths, because one branch fewer is one
  -- branch fewer to get wrong, and the two are provably the same for a live hold.
  select pg_catalog.count(*)::int into v_taken
    from entries.entry_purchases as purchase
    join entries.entrants as entrant on entrant.purchase_id = purchase.id
   where purchase.event_id = v_purchase.event_id
     and purchase.id <> v_purchase_id
     and (
       purchase.status = 'paid'
       or (
         purchase.status = 'pending'
         and (
           purchase.hold_expires_at is null
           or purchase.hold_expires_at > pg_catalog.now()
         )
       )
     );

  select event.capacity into v_capacity
    from entries.events as event
   where event.id = v_purchase.event_id;

  v_over := (v_taken + v_wanted) > v_capacity;

  -- --- the transition, in one guarded statement ---------------------------------------------
  -- `status in ('pending', 'expired')` is the belt to the row lock's braces. Under READ
  -- COMMITTED a concurrent duplicate blocks here, wakes when the first commits, re-evaluates
  -- this predicate against the new row version, and matches nothing — so the guard holds even
  -- if a later author decides the advisory lock made the `for update` redundant.
  --
  -- `paid_at` is `now()`: when the club learned. The moment of the charge lives against the
  -- payment intent in Stripe, which is the authoritative ledger for that, and taking a
  -- timestamp from the payload would be trusting a clock and accepting a value a caller could
  -- choose.
  update entries.entry_purchases
     set status = 'paid',
         paid_at = pg_catalog.now(),
         revived_at = case when v_revived then pg_catalog.now() else revived_at end,
         stripe_payment_intent_id = coalesce(v_intent, stripe_payment_intent_id),
         stripe_checkout_session_id = coalesce(stripe_checkout_session_id, v_session),
         stripe_event_id = coalesce(stripe_event_id, v_event_ref)
   where id = v_purchase_id
     and status in ('pending', 'expired');

  get diagnostics v_updated = row_count;

  if v_updated = 1 and v_over then
    perform entries.raise_attention(
      v_purchase_id,
      'over_capacity',
      jsonb_build_object('capacity', v_capacity, 'taken', v_taken, 'wanted', v_wanted)
    );
  end if;

  -- A paid row with no payment intent cannot be joined to a Stripe payments export, which is
  -- the treasurer's only reconciliation key. Paid anyway — the signature said the money is
  -- real — and flagged, because it is the one row a reconciliation would silently miss.
  if v_updated = 1 and v_intent is null and v_purchase.stripe_payment_intent_id is null then
    perform entries.raise_attention(v_purchase_id, 'no_payment_intent', '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'outcome', case when v_updated = 1 then 'applied' else 'already_paid' end,
    'applied', v_updated = 1,
    'revived', v_revived and v_updated = 1,
    'over_capacity', v_over and v_updated = 1
  );
exception
  -- The unique index on `stripe_checkout_session_id`, which Slice A added with the comment
  -- "so a webhook delivered twice cannot create two purchases". This is where that stops being
  -- aspirational. A collision means one session id is claimed by two purchases; nothing is
  -- written, a human is told, and Stripe is not asked to retry a disagreement that will not
  -- resolve itself.
  when unique_violation then
    perform entries.raise_attention(v_purchase_id, 'session_conflict', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'outcome', 'session_conflict', 'applied', false);
end;
$$;

comment on function entries.record_checkout_event(
  text, text, text, text, int, text, text, text
) is
  'The only object in this platform that writes status = paid. Idempotent by state guard under the same per-event advisory lock the entry path takes. Requires the shared webhook key, because the anon key is published and create_pending_purchase issues purchase ids on request.';

revoke all on function entries.record_checkout_event(
  text, text, text, text, int, text, text, text
) from public;

-- **anon, and the key.** The grant is to the same role every other request uses, because there
-- is no other credential in this platform and inventing one — a second Postgres role reached
-- with a hand-minted JWT — would be the least boring thing in the repository, resting on
-- assumptions about a hosted platform that fail silently. The key is what makes the grant safe.
grant execute on function entries.record_checkout_event(
  text, text, text, text, int, text, text, text
) to anon;

-- ---------------------------------------------------------------------------------------
-- entries.entry_completion_state() — what /nn/entry/complete/ is allowed to learn
-- ---------------------------------------------------------------------------------------
-- **A session id in a URL is not authentication.** It is in the address bar, in browser
-- history, in a screenshot somebody sends a friend, and in a `Referer` header. This function is
-- written as though the string were public, because operationally it is.
--
-- So it returns **one word and nothing else**. Not the name, not the email address, not the
-- entrants, not the amount, not the consents, and above all **not the purchase id** — that is
-- `record_checkout_event`'s key, and the read path and the write path are deliberately keyed on
-- different identifiers so that the first cannot hand anybody the second.
--
-- The amount and the paid-at timestamp were considered and left out. A confirmation reads
-- better with a number on it, and the number is one of three published prices — but *which* of
-- the three a named person paid says whether they are affiliated, and this page is reached by
-- anybody who has the URL. Minimisation applies to a confirmation page as much as to a
-- database column, and the person already knows what they paid.
--
--   paid      the webhook has recorded a payment. The only positive claim this can make.
--   pending   a place is held and no payment has been recorded yet.
--   lapsed    the hold has run out and no payment has been recorded. **Not "nothing was
--             charged"** — see the note in the page. The webhook may simply be late.
--   refunded  somebody at the club refunded it.
--   unknown   no purchase names this session. A made-up session id lands here, and so does an
--             old one, and the two are indistinguishable on purpose.
--
-- `stable` rather than `volatile`: it reads tables and it reads the clock, exactly like
-- `entry_state()`. It writes nothing and takes no lock.
--
-- The `coalesce` around the subquery is not decoration. A scalar subquery that matches no row
-- yields SQL `NULL`, and a null returned where a jsonb object is documented would reach the
-- Worker's parser as an unrecognised shape and degrade a page that has a person waiting on it.
-- A null, empty or unmatched session id all resolve to `unknown` by the same expression.
create or replace function entries.entry_completion_state(p_session_id text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'state',
        case
          when purchase.status = 'paid' then 'paid'
          when purchase.status = 'refunded' then 'refunded'
          when purchase.status = 'pending'
               and (
                 purchase.hold_expires_at is null
                 or purchase.hold_expires_at > pg_catalog.now()
               ) then 'pending'
          -- `expired`, and a `pending` row whose hold has run out but which the five-minute
          -- sweep has not reached. The page must read the same in both, because the difference
          -- between them is a scheduler and not a fact about anybody's payment.
          else 'lapsed'
        end
      )
      from entries.entry_purchases as purchase
      where purchase.stripe_checkout_session_id
            = nullif(pg_catalog.btrim(coalesce(p_session_id, '')), '')
    ),
    jsonb_build_object('state', 'unknown')
  );
$$;

comment on function entries.entry_completion_state(text) is
  'One word about one Checkout session: paid, pending, lapsed, refunded or unknown. Returns no personal data and not the purchase id — a session id in a URL is not authentication.';

revoke all on function entries.entry_completion_state(text) from public;
grant execute on function entries.entry_completion_state(text) to anon;

-- ---------------------------------------------------------------------------------------
-- entries.expire_pending_holds() — the same sweep, now also the alarm
-- ---------------------------------------------------------------------------------------
-- **The `update` is unchanged, character for character.** What is added is a count of the rows
-- waiting for a human, folded into the answer the cron already collects every five minutes.
--
-- Folded rather than given a function of its own, for one reason that outweighs the naming:
-- **every anon-executable object is surface reachable with a key published in page source**,
-- and this costs no extra object and no extra round trip on a job that already runs. The name
-- says "sweep"; the comment says the sweep also reports. That is the cheaper of the two lies.
--
-- Widening the return is expand-safe and was checked rather than assumed:
-- `expirePendingHolds` in `packages/shared/src/entry-purchase.ts` parses with a non-strict Zod
-- object, which **strips unknown keys**, so the deployed Slice B Worker logs exactly the line
-- it logged yesterday against this new version.
--
-- **The alarm is silenced by `attention_resolved_at` and never by the calendar.** A time window
-- here — "anomalies in the last seven days" — would go quiet with an oversold race still
-- oversold if both volunteers were away for a week, which is precisely when an alarm is for.
create or replace function entries.expire_pending_holds()
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_expired int;
  v_attention int;
  v_oldest int;
begin
  update entries.entry_purchases
     set status = 'expired'
   where status = 'pending'
     and hold_expires_at is not null
     and hold_expires_at < pg_catalog.now();

  get diagnostics v_expired = row_count;

  -- The age of the oldest unresolved flag, in whole hours, so a glance at the log line says
  -- whether this is new or has been ignored for two days.
  select pg_catalog.count(*)::int,
         coalesce(
           pg_catalog.max(
             pg_catalog.floor(
               pg_catalog.date_part('epoch', pg_catalog.now() - purchase.attention_at) / 3600
             )
           ),
           0
         )::int
    into v_attention, v_oldest
    from entries.entry_purchases as purchase
   where purchase.attention is not null
     and purchase.attention_resolved_at is null;

  -- `hold_expires_at` is left as it was. It is the record of when the place went back, and
  -- clearing it would leave an `expired` row that cannot say why.
  return jsonb_build_object(
    'expired', v_expired,
    'attention', v_attention,
    'attention_oldest_hours', v_oldest
  );
end;
$$;

comment on function entries.expire_pending_holds() is
  'The five-minute sweep. Moves lapsed pending purchases to expired — housekeeping only, since capacity already excludes a lapsed hold — and counts the rows waiting for a human, which is the alarm channel this platform has.';

revoke all on function entries.expire_pending_holds() from public;
grant execute on function entries.expire_pending_holds() to anon;
