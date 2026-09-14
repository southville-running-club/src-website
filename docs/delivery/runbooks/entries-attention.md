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
| **The entries list** | [`/admin/nn/`](entries-admin.md) counts unresolved flags at the top of the page and says in words when the field is over capacity. **It is somewhere to look rather than something that tells you**, and it is opened by holding `nn-admin` rather than by installing a key |

There is still no email and no alerting stack, so **the log line is the whole of the
notification** and the admin page is where you go once something has prompted you.

### ⏰ The interim, agreed 30 August 2026 — an open issue, and it is not the answer

**[#20](https://github.com/southville-running-club/src-website/issues/20) is the gap that this
box closes, and it closes it badly on purpose.** The alarm fires when **somebody has paid and
has no place**. The mechanism is right — durable on the row, repeating, the age climbing — and
its last hop is a `console.error` in a panel a person has to *decide* to open. On the morning
entries open, nobody is deciding to open it.

**A daily calendar reminder was proposed on the day and rejected.** A recurring alert that fires
whether or not anything is wrong trains the person receiving it to dismiss it, which is the
failure mode the warning at the foot of this box names — so the club would have been buying that
cost outright rather than risking it.

So, for the entry window and no longer:

- [ ] **[#162](https://github.com/southville-running-club/src-website/issues/162) is open**, and
      it stays open from 1 September until entries close on 30 October. It carries
      [the query below](#the-query), so the thing to run is in the thing that reminds you
- [ ] **It is checked daily** while the window is open. **The issue is the reminder** — it is
      closed when the window closes, and closing it early deletes the reminder
- [ ] **On the first day, check it twice** — once mid-morning and once at the end of the day.
      The opening hours are when a payment is most likely to land against a full or racing field

**Why this rather than something better.** Option 3 on #20 — the cron sending "N purchases need
a human" through the outbox that #73 built — is the real answer and the machinery now exists:
`RESEND_API_KEY` is bound and the five-minute cron already sends. It was **not** taken before
Tuesday because it is new sending behaviour on the send path the confirmation emails depend on,
introduced two days before the club's first public transaction, against a 100-a-day cap it would
also consume. **That is a schedule decision rather than a design one, and it should be built
once the window has settled** — at which point this section is deleted rather than amended.

⚠️ **A reminder is not an alarm and this file should not pretend otherwise.** It fires whether or
not anything is wrong, so the failure mode is a person who stops reading it. If it is still here
in November, that is the thing that went wrong.

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

**Refund them.** Press **Cancel** on the row from
[`/admin/nn/`](entries-admin.md#cancelling-an-entry), which refunds through Stripe, deletes the
entrant and their medical note, writes the audit row, and returns the place — all in the one
step the button is built for. `refunded` is not counted, so the place returns the same instant.
Clearing the `attention` flag is then the last step, as above.

> ⚠️ **Do not refund in the Stripe dashboard first and patch the row by hand.** Refunding by
> hand and then pressing Cancel does not work — Stripe answers the second refund attempt with an
> error and the button stops before it touches the record — and the `update` that looks like the
> fix leaves the entrant and their medical note in the database for a race they are not running,
> with no audit row saying who did it or why. [The dead
> end](entries-stripe-keys.md#the-dead-end--refunding-by-hand-first) has the full account. If a
> hand refund has already happened here, stop and raise it rather than patching the row.

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

## Holds against payments — the check that finds a field being held hostage

**A flag is raised by the webhook and a reconciliation needs Stripe to have taken money. This
one needs neither**, because the failure it looks for is places disappearing with **no payment
attempted at all** — [#178](https://github.com/southville-running-club/src-website/issues/178).

Holding a place takes a key since
[ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md), so the
anonymous flood that motivated this check is closed. What is *not* closed is a distributed
attempt through the Worker, and that is deliberately not solved — see the ADR's consequences.
So the shape stays worth watching on a busy day.

```sql
select count(*) filter (where p.status = 'paid')                        as paid,
       count(*) filter (where p.status = 'pending'
                          and p.hold_expires_at > now())                as live_holds,
       count(*) filter (where p.status = 'pending'
                          and p.hold_expires_at > now()
                          and p.stripe_checkout_session_id is null)     as holds_never_sent,
       e.capacity
  from entries.entry_purchases p
  join entries.events e on e.id = p.event_id
 where e.slug = 'nn-2026'
 group by e.capacity;
```

**What each column is telling you:**

| | |
| --- | --- |
| `live_holds` climbing while `paid` does not | Ordinary on a sell-out morning for a few minutes — people take a while on the payment page. Sustained for more than one hold period, it is not ordinary |
| `holds_never_sent` more than a handful | **The tell.** A hold with no Checkout session was created and then nothing happened — nobody was ever sent to Stripe. A flood looks exactly like this, and a genuine rush does not |
| `live_holds + paid` at `capacity` with `paid` low | The field is full of holds nobody is paying for |

**What to do.** Holds lapse on their own after 31 minutes and the five-minute cron releases
them, so this is a denial of service that has to be *sustained* — it is not permanent damage,
and there is nothing to undo. Confirm the shape, then look at `/admin/nn/` filtered to **Held**
to see whether the rows are plausible people. If they are not, this is Cloudflare's problem
rather than the database's: the rule to reach for is a tighter per-IP limit on `POST /nn/` in
[the WAF rules](../../reference/cloudflare-waf-rules.md), which now applies to this path
because the Worker is the only way in.

⚠️ **Do not shorten the 31-minute hold to clear it faster.** It is Stripe's floor rather than
the club's — the Checkout session's `expires_at` is set to the same timestamp — so cutting it
makes every real submission in flight fail at once.

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

---

## The webhook key travels as an RPC argument — one check still owed

**This is not an attention flag and nothing here is on fire.** It is in this runbook because it
is the page somebody already has open when the webhook is misbehaving, and because the one
action it can call for — rotating `ENTRIES_WEBHOOK_KEY` — is the one written down two tables up.

**What the database holds is the digest; what the *call* carries is the key.**
`ENTRIES_WEBHOOK_KEY` is the **first argument** of `entries.record_checkout_event()`, so on
every delivery the Worker sends it in the JSON body of a
`POST /rest/v1/rpc/record_checkout_event`, PostgREST binds it into a statement, and Postgres
executes that statement. `entries.webhook_secrets` still holds only a SHA-256 digest and that
has never been in doubt — but *"the database never holds the key"* is a claim about the table at
rest, and a reviewer reads it as a claim about the path. Issue
[#21](https://github.com/southville-running-club/src-website/issues/21) is where that was
spotted, and [ADR-010](../../architecture/decisions/adr-010-webhook-writes-paid.md#decision-3--the-transition-function-takes-a-key-and-the-grant-is-still-anon)
is qualified accordingly.

**Every key this platform presents as an RPC argument has the same property**, so this section is
not only about the webhook one: `ENTRIES_ENTRY_KEY` ([ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md)),
`ENTRIES_ADMIN_KEY` ([ADR-013](../../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md))
and `store`'s `STORE_ENTRY_KEY` and `STORE_WEBHOOK_KEY` all travel as `p_key`. Whatever the
answer below turns out to be, it is the same answer for all five.

### What has been checked, and what has not

| | State | |
| --- | --- | --- |
| **Postgres statement logs** | ✅ **Checked 30 August 2026 — the key does not reach them** | `log_statement = ddl` captures DDL only, and an RPC call is a function invocation rather than a `CREATE`/`ALTER`/`DROP`. `log_min_duration_statement = -1` disables duration logging outright, which was **the one to worry about**: a call queued behind the per-event advisory lock is exactly the call that is slow, and slow is what duration logging selects for. `log_parameter_max_length_on_error = 0` keeps bind parameters out of error messages. `log_parameter_max_length = -1` looks alarming and has nothing to act on — it means *log parameters in full*, for statements that are already being logged, and by the two rows above none of these ever is |
| **Supabase API request logs** | ⏳ **Owed** | Whether Supabase captures the request **body** of `POST /rest/v1/rpc/record_checkout_event`, and for how long, is platform behaviour rather than a database setting. **It cannot be read from SQL**, which is why it is not answered here |

⚠️ **The checked half is a point-in-time answer about settings this repository does not pin.**
`log_statement` and `log_min_duration_statement` are Supabase runtime configuration; a platform
change to either reopens the first two routes silently, with nothing in this repository going
red. That is an argument for rotating the key after the entry window regardless of what the
second row comes back as.

### Doing the check that is owed

**Who:** either volunteer — it needs the production Supabase login and nothing else. **Roughly
ten minutes.**

1. Supabase dashboard → **Logs → API**.
2. Search for **the first ~12 characters of the key only**. ⚠️ **Do not paste the whole live
   secret into a log search box** — that is its own small exposure, and a prefix is enough to
   answer the question.
3. Narrow to `POST /rest/v1/rpc/record_checkout_event` and read one entry in full: the question
   is whether the **request body** is there at all, not only whether the search matched.

⚠️ **Freshness decides whether a clean answer means anything.** Free-tier log retention is
short, so search within a day or two of a real delivery — a search run in a quiet week can come
back clean because there is nothing left to search, which is a false negative that reads exactly
like an answer. `/admin/nn/` filtered to **Paid** gives the date of the most recent one.

⚠️ **This was parked against [#112](https://github.com/southville-running-club/src-website/issues/112)
step 8, and #112 is closed.** The live-key swap it was waiting for happened on 7 September 2026,
so the check is doable now and has no issue holding it any more. That is why it is written here
rather than left in a comment thread.

### If the body is captured

**Rotate the key. Do not redesign the call.** PostgREST puts RPC arguments in the body by
construction, so there is no header-shaped fix that does not change how the function
authenticates — a second Postgres role and a hand-minted JWT, which ADR-010 considered and
rejected for reasons that have not changed.

Rotation is **manual step 3** in
[the manual steps](../../../platform/apps/main/README.md#manual-steps): a new
`wrangler secret put ENTRIES_WEBHOOK_KEY`, then the matching `update` on
`entries.webhook_secrets`, **in that order**. The window between the two answers 5xx on every
delivery and Stripe retries for three days, so nothing is lost — the failure to avoid is doing
one half and forgetting the other, which is the `503 retry unauthorised` row in the table above.
The verification query that settles which half is in place is
[beside the manual steps](../../../platform/apps/main/README.md#what-is-actually-bound--measured-30-august-2026).

**Rotate after the entry window rather than during it.** The exposure is a second factor on one
function, behind TLS, in logs gated by the same Supabase login as the database itself — it does
not justify a rotation window in the middle of a race selling 250 places.
