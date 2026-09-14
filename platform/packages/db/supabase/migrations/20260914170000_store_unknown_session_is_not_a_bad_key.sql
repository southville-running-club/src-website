-- ---------------------------------------------------------------------------------------------
-- store.record_checkout_event() — an unrecognised session is an answer, not a refusal
-- ---------------------------------------------------------------------------------------------
-- **The defect: a Stripe event for a session this database does not know came back as
-- `bad_key`, and the Worker turned that into a 503.** Two things follow from it, and the second
-- is the expensive one.
--
-- `record_checkout_event()` returned `(false, 'no_such_session')` for a session it could not
-- find. `recordTicketCheckoutEvent()` in `packages/shared/src/social-ticket.ts` tests `ok`
-- before it looks at `result` — reasonably, since `ok = false` had meant exactly one thing —
-- and so reported `bad_key`. `store-webhook.ts` answers 503 for that, because a key the
-- database will not accept is the club's own configuration and Stripe should retry until
-- somebody fixes it.
--
--   1. **Stripe retries for three days on something that can never succeed.** A session this
--      database has never seen will still not exist tomorrow. Harmless, and noise in a delivery
--      log that is meant to be readable.
--   2. ⚠️ **The log line names the wrong cause, and it names a credential.** What a volunteer
--      reads is `store.record_checkout_event unavailable — bad_key`, which sends them to
--      re-check the digest in `store.api_secrets` — a digest that is very probably correct.
--      Measured on 13 September 2026: the endpoint's own test event produced exactly this, and
--      the two causes were indistinguishable from outside.
--
-- **The race path has always had this right, and it is the precedent rather than an
-- invention.** `entries.record_checkout_event()` answers `('ok', true, 'outcome', 'not_ours')`
-- for a session it does not recognise, and its own migration says why in as many words: *"a
-- uuid naming a row of ours is `not_ours` and not an error"*. `ok = false` there is reserved
-- for `unauthorised`. This makes `store` agree with it.
--
-- **`create or replace`, not a drop.** The return type is unchanged — `(ok boolean, result
-- text)` — so the grants survive and there is nothing to re-grant.
--
-- ## Both deploy orders are safe, which is what makes this shippable on its own
--
-- **New database, old Worker** — the case that exists the moment this migration lands, since
-- nothing sequences it against the Cloudflare deploy. The deployed `recordTicketCheckoutEvent`
-- already has a branch for `ok = true, result = 'no_such_session'`: it was written for the
-- separate case of a verified event carrying no session id at all, and it maps to a **200**
-- with the body `no such session`. So an old Worker against this database does the right thing
-- immediately, which is the only reason this can be a migration-first change.
--
-- **Old database, new Worker** — a rollback. The Worker's classifier is being changed in the
-- same pull request to read `result` rather than infer from `ok`, so it recognises
-- `(false, 'no_such_session')` as a final answer too. Neither half depends on the other.
--
-- **Nothing else about the function changes.** The key check is still the first statement, an
-- unknown session still writes nothing, and a real session still takes the advisory lock and
-- the state guard. `packages/db/tests/store-tickets.test.ts` gains the case that was missing:
-- nothing anywhere asserted what an unknown session answers, which is why this shipped.

create or replace function store.record_checkout_event(
  p_key text,
  p_session_id text,
  -- **Defaulted, because Stripe may genuinely not send either.** A defaulted parameter is also
  -- what makes the generated TypeScript type optional rather than a required non-nullable
  -- string, which is the difference between the Worker passing `undefined` and having to lie.
  p_payment_intent text default null,
  p_amount_total int default null,
  p_event_type text default 'checkout.session.completed'
)
  returns table (ok boolean, result text)
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_purchase store.ticket_purchases%rowtype;
  v_social_capacity int;
  v_sold int;
  v_attention text;
begin
  if not store.key_ok('stripe', p_key) then
    return query select false, 'bad_key';
    return;
  end if;

  select * into v_purchase
    from store.ticket_purchases as purchase
   where purchase.stripe_checkout_session_id = p_session_id;

  if not found then
    -- **`true`, because this is an answer rather than a refusal — changed 13 September 2026.**
    -- The event is genuinely Stripe's and there is nothing here to match it to: most often a
    -- session created against another environment, or the endpoint's own test event. Nothing
    -- was written and no retry can change that, so the Worker answers 200 and Stripe stops
    -- asking. `ok = false` is now reserved for the key being refused, which is the only thing
    -- a human can act on. `entries.record_checkout_event()` has always answered its equivalent
    -- this way — see `not_ours`, and its own migration's *"not an error"*.
    return query select true, 'no_such_session';
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_purchase.social_id::text, 0)
  );

  -- Re-read under the lock, so two deliveries of the same event cannot both see `pending`.
  select * into v_purchase
    from store.ticket_purchases as purchase
   where purchase.id = v_purchase.id
     for update;

  if v_purchase.status = 'paid' then
    -- **Idempotent, and this is the ordinary case rather than an error.** Stripe retries for
    -- three days; a second delivery of a payment already recorded is a success.
    return query select true, 'already_paid';
    return;
  end if;

  if v_purchase.status = 'refunded' then
    update store.ticket_purchases
       set attention = 'already_refunded'
     where id = v_purchase.id
       and attention is null;

    return query select true, 'already_refunded';
    return;
  end if;

  if p_amount_total is not null and p_amount_total <> v_purchase.amount_pence then
    v_attention := 'amount_mismatch';
  end if;

  select social.capacity into v_social_capacity
    from store.socials as social
   where social.id = v_purchase.social_id;

  if v_social_capacity is not null then
    select coalesce(sum(other.quantity), 0) into v_sold
      from store.ticket_purchases as other
     where other.social_id = v_purchase.social_id
       and other.status = 'paid'
       and other.id <> v_purchase.id;

    if v_sold + v_purchase.quantity > v_social_capacity then
      v_attention := coalesce(v_attention, 'over_capacity');
    end if;
  end if;

  update store.ticket_purchases
     set status = 'paid',
         paid_at = pg_catalog.now(),
         hold_expires_at = null,
         stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
         attention = coalesce(attention, v_attention)
   where id = v_purchase.id;

  return query select true, 'paid';
end;
$$;

comment on function store.record_checkout_event(text, text, text, int, text) is
  'The only writer of paid. Idempotent by state guard, under the social''s advisory lock. Never refuses a payment that has already been taken. ok = false means the stripe key was refused and nothing else: an unrecognised session is (true, no_such_session), matching entries.record_checkout_event()''s not_ours.';
