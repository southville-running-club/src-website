# Runbook — selling tickets to a club social

What a volunteer does to put a social on sale, and what to do when something goes wrong.

**Nothing on this page is optional and the order matters.** Step 4 is the one that starts taking
money, and every step before it is what makes that safe.

---

## What ships, and why nothing is on sale

`store.socials` holds one row — `christmas-party-2026` — and almost everything about it is now
supplied: **Saturday 12 December 2026 at The Cock & Tail, 7:30pm–1am, 18+**, at **£10**. All of
it was given on 5 September 2026; the booking has been held since January.

**The £10 is confirmed** — decision 010, settled on 6 September 2026 after a day as a
provisional £12.

`capacity` is null, which means no limit — nobody has said what the room holds. **`sales_open_at`
is null**, which is what actually keeps tickets from being sold.

**There are two independent reasons nothing can be sold today**, and both have to be undone
deliberately:

* `sales_open_at` is null, and a null there reads as *never opens* rather than *no lower
  bound*. Setting it starts selling tickets unattended.
* **None of the three Worker secrets is installed**, so even an open window could not hold a
  ticket or record a payment.

`/events/christmas-party-2026/` renders the date, the time, the venue, the price and the age
limit, and says tickets are not on sale — all of which is true.

⚠️ **The age limit is displayed and is not enforced.** Nothing here collects a date of birth to
check it against, and collecting one to sell a party ticket is the minimisation breach this
schema exists to avoid. That is what the club already does — the 2025 page stated 18+ as prose
and the door enforced it. Asking at the point of sale is a `required_consents` entry and needs
wording first.

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

**The date, the venue, the times and the age limit are already set**, in two dated migrations,
so they are in the schema rather than in anybody's `psql` history.

The only thing left is `capacity` — what the room actually holds — and only once somebody has
said:

```sql
update store.socials set capacity = 120 where slug = 'christmas-party-2026';
```

`capacity` null means no limit, which is what it is today. Set it to the room's real number if
there is one — **the count is in tickets, not purchases**, so a purchase of four takes four.

**Every value above is an illustration of the shape, not a fact.** Do not run it as written.

**Every value above is an illustration of the shape, not a fact.** Do not run it as written.

The page picks all of this up on the next request. No deploy.

---

## 2. Confirm the price

**There is already a `standard` ticket type at the confirmed £10.** Changing it is an
`update`, not a second row:

```sql
update store.ticket_types kind
   set price_pence = 1200
  from store.socials social
 where social.id = kind.social_id
   and social.slug = 'christmas-party-2026'
   and kind.code = 'standard';
```

**Pence, as an integer**, and this row is the only definition of the price — there is
deliberately no Stripe Product or Price object. A price held in two systems is a price that will
disagree with itself, and the copy that is wrong will be the one in the dashboard nobody opened.

**Editing this is safe right up until sales open and not after.** `ticket_purchases.
amount_pence` records what was actually charged, precisely so that a later edit here cannot
rewrite somebody's receipt — but somebody who bought at the old price paid the old price, and
that is a conversation rather than a query.

The form still will not appear: `sales_open_at` is still null.

---

## 3. Check it on the page

Load `/events/christmas-party-2026/`. It should now show the date, the time, the venue and the
price, and still say tickets are not on sale.

**If it still says "to be confirmed", stop.** The page is reading the database and the database
does not have what you think it has — do not go on to step 4.

---

## 3b. If the date or the venue ever moves, regenerate the poster

⚠️ **The poster is the one published fact that an `update` cannot fix.** Everything else on
`/events/christmas-party-2026/` is painted from `store.socials`, so changing a fact is a
database write and no deploy — but `apps/main/public/src-christmas-party-2026-1080.webp` has
**Saturday 12 December** and **The Cock & Tail** baked into the artwork.

So a change to either leaves the page correcting itself in text while the picture beside it
goes quietly stale, **and a visitor believes the picture**. That is the worse half of the
failure, which is why this step exists rather than being left to somebody noticing.

The artwork is generated by a script the club holds (`poster.py`), which takes the date and
venue as configuration and also produces a **details-free variant** — use that one if a date
is in doubt rather than publishing a poster that states the wrong day. Re-export at 1080×1080,
convert to WebP at quality 80 (about 105KB, in line with the one other raster this repository
commits), and replace the file.

---

## 4. Open sales

⚠️ **This is the step that starts taking money.** Steps 0.1 to 0.4 must be done and verified
first: opening the window before the entry key is installed is opening it unprotected, which is
[ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md)'s finding.

⚠️ **Check the price on the page is the price that was agreed, before you run this.** It is
£10 and confirmed, so this is a verification rather than a decision — but it is the last moment
it is cheap. **From the moment this `update` lands, that integer is what a card is charged**,
there is deliberately no second copy of it in Stripe to compare against, and repricing after
somebody has bought means they paid the old price:

```sql
select kind.price_pence
  from store.ticket_types kind
  join store.socials social on social.id = kind.social_id
 where social.slug = 'christmas-party-2026';
```

Expect `1000`. If it is anything else, go back to step 2 — **do not open sales and fix the
price afterwards**, because refunding a difference is a partial refund, which this platform
deliberately cannot make.

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
