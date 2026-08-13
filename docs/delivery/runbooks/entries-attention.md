# Runbook — a purchase needs a human

**Somebody's money is involved in every case below.** Each one means the webhook met something
it could not resolve on its own, took the safest action available, and flagged the row rather
than guessing.

**Prerequisites:** access to the club's Supabase project (SQL editor) and to the Stripe
dashboard. **About ten minutes** per row, most of it deciding rather than typing.

---

## How you find out

Two channels, and only the first is reliable.

| | |
| --- | --- |
| **The Worker log** | Every five minutes the cron writes `entries: N purchase(s) need a human, oldest Hh` to the Cloudflare observability panel. It **repeats until somebody clears the flag** and the age climbs, because a single line at 02:14 is an artefact nobody sees |
| **The row itself** | `attention is not null and attention_resolved_at is null`. Durable, greppable, and still true next month. This is the one to trust |

There is no email and no alerting stack. That is [Slice D](../phases.md), and until it exists
**the log line is the whole of the notification**. Somebody should look at the query below
after entries open, and once a week while the window is open.

---

## The query

Run this in the Supabase SQL editor. It reads nothing personal beyond the purchaser's name and
address, which you need in order to contact them.

```sql
select p.id,
       p.attention,
       p.attention_at,
       p.attention_detail,
       p.status,
       p.amount_pence,
       p.paid_at,
       p.revived_at,
       p.purchaser_name,
       p.purchaser_email,
       p.stripe_payment_intent_id,
       p.stripe_checkout_session_id
  from entries.entry_purchases p
  join entries.events e on e.id = p.event_id
 where p.attention is not null
   and p.attention_resolved_at is null
   and e.slug = 'nn-2026'
 order by p.attention_at;
```

**Clearing a flag is always the last step**, after the thing is actually dealt with:

```sql
update entries.entry_purchases
   set attention_resolved_at = now()
 where id = '<the id>';
```

> **The alarm is silenced by this and by nothing else.** There is no time window and there is
> deliberately no expiry — an alarm that went quiet after a week would go quiet exactly when
> both volunteers were away, which is when an alarm is for.

---

## `over_capacity` — somebody paid and the race was full

**The most important one, and the only one where a runner is waiting on a decision.**

Their hold lapsed, somebody else took the last place, and then their payment arrived. The money
is real and the club is holding it. The purchase is `paid` and **it consumes a place**, so the
field is now one larger than `capacity`.

`attention_detail` carries `{"capacity": 250, "taken": 250, "wanted": 1}` — what the count was
at the moment it went over.

> **"Sold out" now means "oversold and therefore closed".** The number of unresolved
> `over_capacity` rows is exactly how many places over the field is. **A race director reading
> "250 of 250" without running the query above will set out the wrong number of bibs.**

### The two ways out

**Take the extra runner.** Raise `capacity` by exactly the number of unresolved rows:

```sql
update entries.events set capacity = capacity + 1 where slug = 'nn-2026';
```

The count then reads 251 of 251 — it resolves that one person and **sells nothing new**, which
is the whole reason an over-capacity purchase counts as taking a place. Then clear the flag.

**Refund them.** Refund in the Stripe dashboard against the payment intent on the row, then:

```sql
update entries.entry_purchases
   set status = 'refunded', paid_at = null, attention_resolved_at = now()
 where id = '<the id>';
```

`refunded` is not counted, so the place returns the same instant.

> Note the inherited oddity: the `entry_purchases_paid_has_timestamp` constraint forces
> `paid_at` to null on a refund, so refunding **erases when the money arrived**. Stripe keeps
> that. It is the refund slice's problem to fix, and is recorded in the migration rather than
> re-decided quietly.

**Either way, email them.** They have paid and they have heard nothing — the page told them
their payment is confirmed, which is true, and said nothing about capacity because a web page is
the wrong way to find out.

---

## `amount_mismatch` — Stripe's number is not ours

**This should never fire.** The amount was computed by `entries.create_pending_purchase()` from
`entries.fees` and travelled to Stripe as `price_data` in the same request; there is no Stripe
Price object to disagree with it. The currency is checked for the same reason —
`adaptive_pricing` is switched off at session creation so nobody is charged a converted amount.

**Nothing was written.** The purchase is still `pending` or `expired` and is **not paid**.
`attention_detail` carries `expected_pence`, `stripe_pence` and `stripe_currency`.

If it ever fires, do not clear it until somebody has worked out *why* — this is the row that
says an assumption in the build is wrong. Compare against the payment in the Stripe dashboard,
then either refund it there or, if the payment is genuinely correct and ours,

```sql
update entries.entry_purchases
   set status = 'paid', paid_at = now(), attention_resolved_at = now()
 where id = '<the id>';
```

and **write down what happened**, because the next person to meet this will have this note and
nothing else.

---

## `paid_after_refund` — a completed event arrived for something already refunded

A webhook does not undo a person. The row is left exactly as whoever refunded it left it.

Check the Stripe dashboard: either the refund and the payment are the same transaction and the
event was simply late (clear the flag), or there are genuinely two payments and one needs
refunding.

---

## `session_conflict` — two Checkout sessions against one place

The purchase already names a different Checkout session from the one in the event, or two
purchases claim one session id. **Nothing was written.**

This means two payment pages exist against one held place, which should be impossible. Look at
both sessions in Stripe. If only one was paid, apply it by hand as in `amount_mismatch` above.
If both were, one needs refunding.

---

## `no_payment_intent` — paid, but not reconcilable

The purchase **is** paid — the signature said the money is real, and refusing it would have been
the wrong trade. But Stripe sent no payment intent id, so this row cannot be joined to a Stripe
payments export, which is the treasurer's only reconciliation key.

Find the payment in the Stripe dashboard by the Checkout session id on the row, then:

```sql
update entries.entry_purchases
   set stripe_payment_intent_id = '<pi_...>', attention_resolved_at = now()
 where id = '<the id>';
```

---

## Reconciliation — the check that finds what no flag can

A flag is raised by the webhook. **If the webhook never ran, there is no flag** — and that is
the failure this check exists for: a payment Stripe took and this platform never heard about.

Export **Payments** from the Stripe dashboard for the entry window. Every payment carries
`purchase_id` in its metadata, because `payment_intent_data[metadata]` is set at session
creation — Stripe does *not* copy Checkout session metadata onto the payment, which is why that
is set explicitly. Then, for anything the export shows and the club does not:

```sql
select p.id, p.status, p.amount_pence, p.purchaser_email, p.stripe_payment_intent_id
  from entries.entry_purchases p
  join entries.events e on e.id = p.event_id
 where e.slug = 'nn-2026'
   and p.id = any($1::uuid[]);   -- the purchase_ids from the export
```

A row that is `pending` or `expired` against a payment Stripe says succeeded is a lost webhook.
Check Stripe's **event delivery log** first — it will show the failed attempts and lets you
resend them, which is always the better fix than applying it by hand.

---

## What to do if the webhook is failing entirely

Symptoms: Stripe's delivery log shows 5xx on every attempt, and the club's table shows nothing
moving to `paid`.

| Answer | What it means | What to do |
| --- | --- | --- |
| **503 `not configured`** | `STRIPE_WEBHOOK_SECRET` or `ENTRIES_WEBHOOK_KEY` is not set on the Worker | Set it — see [the manual steps](../../../platform/apps/main/README.md#manual-steps) |
| **503 `retry unauthorised`** | The Worker's key does not match the digest in the database. **Usually a half-finished rotation** | Re-run step 3 of the manual steps with the key that is actually on the Worker |
| **503 `retry unavailable`** | The migration has not landed, or Postgres is unreachable | Check the deploy; Stripe holds the events |
| **400** | Stripe cannot prove itself, which normally means the endpoint's signing secret was rotated in the dashboard and not on the Worker | `wrangler secret put STRIPE_WEBHOOK_SECRET` with the current one |

**Nothing is lost while this is happening.** Stripe retries for roughly three days and its
delivery log lets you resend by hand afterwards. The 5xx is deliberate: the alternative — a 200
— would tell Stripe the payment was recorded when it was not.
