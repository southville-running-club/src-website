# Runbook — selling tickets to a club social

What a volunteer does to put a social on sale, and what to do when something goes wrong.

**Nothing on this page is optional and the order matters.** Step 4 is the one that starts taking
money, and every step before it is what makes that safe.

---

## What ships, and why nothing is on sale

`store.socials` holds one row — `christmas-party-2026` — with **every fact null**: no date, no
time, no venue, no age limit, no capacity, and `sales_open_at` null. There is **no
`ticket_types` row**, so there is no price.

Either of those alone is enough to keep the ticket form hidden. Both are deliberate:

* The 2026 details are **not confirmed by the committee**, and a plausible placeholder in a
  migration would be the club announcing a party it has not agreed.
* `sales_open_at` is the switch, and setting it starts selling tickets unattended.

`/events/christmas-party-2026/` renders "the details for 2026 are still to be confirmed" and
"tickets are not on sale yet", which is true.

---

## 0. Before anything can be sold

### 0.1 — The three Worker secrets

Three, and they are `store`'s own rather than shared with `entries`. That is
[ADR-033](../../architecture/decisions/adr-033-a-ticket-is-not-an-entry.md): one key opening two
doors is one rotation closing both.

```bash
cd platform/apps/main && npx wrangler secret put STORE_ENTRY_KEY
```

```bash
cd platform/apps/main && npx wrangler secret put STORE_WEBHOOK_KEY
```

Generate each with 32 random bytes, and **never commit either**:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 0.2 — Their digests, in the database

The database holds only the SHA-256, never the key. Both ship **null**, which refuses
everything — so until this is done, nothing can hold a ticket and nothing can be marked paid.

```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1],'utf8').digest('hex'))" "$KEY"
```

Then, against production, one `update` per key:

```sql
update store.api_secrets set key_sha256 = '<digest>', updated_at = now() where name = 'entry';
update store.api_secrets set key_sha256 = '<digest>', updated_at = now() where name = 'stripe';
```

### 0.3 — The Stripe endpoint

**A human's job, because it needs the production URL**, exactly like the race webhook's.

In the Stripe dashboard, add an endpoint at:

```
https://new.southvillerunningclub.co.uk/events/stripe-webhook
```

Subscribe it to **`checkout.session.completed`** and nothing else. Take the signing secret it
gives you and set it:

```bash
cd platform/apps/main && npx wrangler secret put STORE_STRIPE_WEBHOOK_SECRET
```

⚠️ **This is a second endpoint, not a second subscription on the race's.** The signing secret is
per endpoint, and `/nn/stripe-webhook` verifies against `STRIPE_WEBHOOK_SECRET` while this one
verifies against `STORE_STRIPE_WEBHOOK_SECRET`. Pointing the race endpoint at this URL, or
sharing one secret, breaks both.

### 0.4 — Verify, with a real signed event

Do not skip this. Until a real Stripe delivery has been seen to reach `paid`, the digest in
step 0.2 is unproven — and a wrong digest looks exactly like a working system right up until
somebody pays.

Send a test event from the Stripe dashboard and check the Worker log. **A `503 not configured`
means a secret is missing; a `400 signature` means the wrong signing secret.** Both are safe
failures: Stripe retries for three days.

---

## 1. Confirm the details

Once the committee has supplied them — and **only then**:

```sql
update store.socials
   set social_date = date '2026-12-05',
       start_time  = time '19:30',
       end_time    = time '01:00',
       venue       = 'The Cock & Tail, Commercial Road',
       minimum_age = 18,
       capacity    = null
 where slug = 'christmas-party-2026';
```

`capacity` null means no limit. Set it to the room's real number if there is one — the count is
in **tickets**, not purchases, so a purchase of four takes four.

**Every value above is an illustration of the shape, not a fact.** Do not run it as written.

The page picks all of this up on the next request. No deploy.

---

## 2. Set the price

```sql
insert into store.ticket_types (social_id, code, label, price_pence)
select id, 'standard', 'Standard ticket', 1200
  from store.socials where slug = 'christmas-party-2026';
```

**Pence, as an integer**, and this is the only definition of the price — there is deliberately
no Stripe Product or Price object. A price held in two systems is a price that will disagree
with itself, and the copy that is wrong will be the one in the dashboard nobody opened.

The form still will not appear: `sales_open_at` is still null.

---

## 3. Check it on the page

Load `/events/christmas-party-2026/`. It should now show the date, the time, the venue and the
price, and still say tickets are not on sale.

**If it still says "to be confirmed", stop.** The page is reading the database and the database
does not have what you think it has — do not go on to step 4.

---

## 4. Open sales

⚠️ **This is the step that starts taking money.** Steps 0.1 to 0.4 must be done and verified
first: opening the window before the entry key is installed is opening it unprotected, which is
[ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md)'s finding.

```sql
update store.socials
   set sales_open_at  = timestamptz '2026-10-01 07:00+01',
       sales_close_at = timestamptz '2026-11-28 17:00+00'
 where slug = 'christmas-party-2026';
```

**The two do not share a UTC offset**, and that has bitten this platform before: the clocks go
back on 25 October 2026, so a window spanning it is BST at one end and GMT at the other. Write
the offset explicitly rather than letting the session's timezone decide.

Buy one ticket yourself with a real card and check that:

1. Stripe Checkout opens for the right amount.
2. The purchase reaches `paid` in `store.ticket_purchases`.
3. A confirmation email arrives.

Then refund it in the Stripe dashboard.

---

## When somebody says they paid and heard nothing

**Check in this order.**

**Is the purchase `paid`?**

```sql
select status, ticket_no, quantity, amount_pence, attention, created_at, paid_at
  from store.ticket_purchases
 where purchaser_email = 'them@example.com'
 order by created_at desc;
```

* `paid` — the payment is recorded. The problem is the email; carry on below.
* `pending` — the webhook has not landed. Check the Stripe dashboard's delivery log for this
  endpoint. **Do not tell them nothing was charged** until you have looked at Stripe.
* `expired` — the hold lapsed. If Stripe shows a payment anyway, that is a late webhook and it
  will still be recorded when it arrives; the purchase is never refused for being late.

**Is the message owed, and what happened to it?**

```sql
select template, status, attempts, last_error, created_at, sent_at
  from store.email_outbox
 where purchase_id = '<id>';
```

* No row and the purchase is `paid` — a defect. The trigger writes the row in the same
  transaction as the payment, so this should be impossible.
* `pending` with `attempts = 0` — nothing has drained. Check `RESEND_API_KEY` and
  `STORE_WEBHOOK_KEY` are both set on the Worker; the drain returns silently when either is
  missing, and that is deliberate.
* `failed` — three attempts have gone. `last_error` carries a status code and never the
  provider's own text.
* `sent` — the club sent it. Spam folder, almost always.

**Nothing can lose a message; it can only be late.** The row is written with the payment, so
there is always something to look at.

---

## Anything flagged for a human

The five-minute cron logs:

```
store: N ticket purchase(s) need a human, oldest Nh
```

It repeats until somebody clears the flag, which is the whole mechanism — one line at 02:14 is
an artefact nobody sees.

```sql
select id, ticket_no, attention, amount_pence, quantity, created_at
  from store.ticket_purchases
 where attention is not null and attention_resolved_at is null;
```

| `attention` | What happened | What to do |
| --- | --- | --- |
| `amount_mismatch` | Stripe charged a different amount from the one recorded | Reconcile against Stripe. The purchase **is** paid — the flag is about the figure, not the payment |
| `over_capacity` | The payment arrived when the room was full | Somebody has paid and may have no place. Decide whether to honour it or refund by hand |
| `already_refunded` | A payment arrived for something already refunded | Reconcile in Stripe |

Clear it when it is dealt with:

```sql
update store.ticket_purchases set attention_resolved_at = now() where id = '<id>';
```

---

## What this cannot do yet

Stated plainly, so nobody goes looking for a button that is not there —
[ADR-033](../../architecture/decisions/adr-033-a-ticket-is-not-an-entry.md) says why for each.

* **There is no admin page for tickets.** Who is coming is this runbook's queries and Stripe's
  dashboard. Building one wants an eleventh permission, which is a stop-and-ask.
* **There is no cancel or refund button.** Refund in the Stripe dashboard, then set the row's
  status by hand — the `ticket_refunded` email fires from that transition on its own.
* **Nobody's name is held except the buyer's.** The door list is "this person, plus N".
* **Dietary requirements are not stored.** The confirmation email asks people to reply, and the
  answers are in the club's mailbox.
