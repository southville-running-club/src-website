# Runbook — swapping the Stripe keys between test and live

**One rule, and everything below is either it or a consequence of it:**

> ⚠️ **Nothing may be left `paid` across a key swap.** A payment taken in one mode can only be
> refunded by a key of that mode. The moment the other pair is bound, that payment is stranded —
> the Cancel button on `/admin/nn/` refuses it, and there is no second button.

Serves [Phase 3](../phases.md#phase-3--nightingale-nightmare-live). Reasoning:
[ADR-018](../../architecture/decisions/adr-018-cancelling-an-entry.md), whose fail-safe ordering
is what turns a mode mismatch into a refusal rather than into a deleted entrant.

**Prerequisites:** the Stripe dashboard (both modes), Cloudflare for `wrangler secret put`, and
an account holding `nn-admin` so the entries list can be read and a place cancelled.

---

## Why test and live strand each other

Stripe keeps two object graphs and they share nothing. A `pi_…` created in live mode does not
exist as far as a test-mode key is concerned, and the reverse holds too.

`refundPayment()` in [`worker/stripe.ts`](../../../platform/apps/main/worker/stripe.ts) posts to
`/v1/refunds` naming `payment_intent` — the one stored on the row by the webhook. So the refund
is issued by whichever key is bound **now**, against a payment intent created by whichever key
was bound **then**. If those are different modes, Stripe cannot find the object and refuses.

And the cancel path is **Stripe first, the record second**, deliberately: a refused refund leaves
the entry exactly as it was rather than deleting an entrant whose money never came back. So the
volunteer sees *"Nothing was cancelled"*, the row stays `paid`, and its place stays consumed —
which is the page behaving correctly, and is
[what happened on 27 August 2026](https://github.com/southville-running-club/src-website/issues/118).

**There is no way round it in the club's own database.** `entries.cancel_entry()` is only reached
after a successful refund, and it cannot be called by hand from the Supabase SQL editor either —
it refuses unless `identity.has_permission('nn.entry.cancel')`, which is resolved through
`auth.uid()` and is null for a superuser in the SQL editor. See
[the dead end](#the-dead-end--refunding-by-hand-first) for why the obvious `update` is worse than
it looks.

---

## Before the swap — clear the outgoing mode

**Do this first, every time, even when the swap is only a rehearsal.** It is five minutes now
against a row nobody can ever tidy.

- [ ] **Find everything still `paid`.** In the Supabase SQL editor:

```sql
select p.id,
       p.status,
       p.amount_pence,
       p.paid_at,
       p.purchaser_email,
       p.stripe_payment_intent_id
  from entries.entry_purchases p
  join entries.events e on e.id = p.event_id
 where e.slug = 'nn-2026'
   and p.status = 'paid'
   and p.stripe_payment_intent_id is not null
 order by p.paid_at;
```

- [ ] **Cancel each one** from `/admin/nn/`, per
      [the admin runbook](entries-admin.md#cancelling-an-entry), while the key that took the
      money is still bound. Confirm the refund in Stripe, the row `refunded`, and the place back
      in the count.
- [ ] **Re-run the query.** It must come back empty before you go on.

> **A row with no `stripe_payment_intent_id` is not stranded by a swap** — a complimentary place
> is `paid` at £0 with no payment behind it, and the Cancel button says so rather than offering
> to refund money nobody sent. Those can be left alone.

---

## The swap

- [ ] **Register the incoming mode's endpoint first**, at
      `https://new.southvillerunningclub.co.uk/nn/stripe-webhook`, subscribed to
      `checkout.session.completed` and `checkout.session.expired` **and nothing else**. The live
      endpoint is a separate object from the test one and Stripe shows its signing secret once.
- [ ] **Then both secrets, back to back:**

```bash
npx wrangler secret put STRIPE_SECRET_KEY --env production --config apps/main/wrangler.jsonc
```

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production --config apps/main/wrangler.jsonc
```

**Between the two the pair is mismatched and every delivery fails signature verification.** That
is why the outgoing mode is cleared first and why this is done outside the entry window: a
mismatch reads as an outage rather than as a mismatch. No deploy is needed — a secret takes
effect on the next request.

`ENTRIES_WEBHOOK_KEY` is **not** part of this. It is the club's own key between the Worker and
Postgres, has nothing to do with Stripe's modes, and rotating it here would break payments being
recorded for an unrelated reason.

---

## After the swap — confirm the scopes, on the pair you just bound

- [ ] Checkout Sessions **write**
- [ ] Payment Intents **read**
- [ ] Refunds **write**

**Scopes are per key.** A correctly scoped test key says nothing whatever about the live one, and
the key created on 26 August 2026 was scoped Checkout Sessions write and Payment Intents read
only — Refunds write was added later, and it is not safe to assume both pairs were amended.

⚠️ **A missing Refunds — Write is invisible until somebody presses Cancel on a real entry**, and
at that moment it looks exactly like a mode mismatch. The next section is how to tell them apart.

---

## Telling the two failures apart

Both answer *"Nothing was cancelled — Stripe refused the refund"* on the page, because the page
deliberately never quotes Stripe's own message: an error message can carry the value that was
rejected. The classification is in the Cloudflare observability panel instead, logged by
`describeStripeError()` as `stripe refund failed — <status> type=… code=… param=…`.

| What the log line carries | What it means | What to do |
| --- | --- | --- |
| **404**, `code=resource_missing` | The payment intent does not exist **for the key that is bound**. Almost always the wrong mode | Bind the pair that took the money, cancel, then swap back |
| **403** | The key is the right mode and lacks the permission | Add **Refunds — Write** to that restricted key in the dashboard, then press Cancel again |
| **400**, `code=charge_already_refunded` | Somebody refunded it by hand in the dashboard | [The dead end](#the-dead-end--refunding-by-hand-first) |
| **503** and no Stripe status at all | No `STRIPE_SECRET_KEY` is bound at all | Bind one |

**The dashboard is the authority, not this table.** Open the payment in both modes before acting —
a payment that is visible in live and absent in test settles it in seconds and costs nothing.

---

## Recovering a payment that is already stranded

**This is [#118](https://github.com/southville-running-club/src-website/issues/118) item 7**: a
live-mode payment taken around 11:19 on 27 August 2026, still `paid`, still consuming one of the
250, and refused by the Cancel button ever since the keys were swapped to test.

**Do it through the platform, with the live pair bound.** Not by hand.

- [ ] Confirm the live key carries **Refunds — Write** —
      [above](#after-the-swap--confirm-the-scopes-on-the-pair-you-just-bound)
- [ ] With the live pair bound, find the row on `/admin/nn/` and press **Cancel**
- [ ] Verify all four: the refund appears in Stripe **in live mode**, the row is `refunded`, the
      entrant is gone, and the place is back in the count

**Why through the platform.** `entries.cancel_entry()` does six things in one transaction and five
of them have nothing to do with money: it writes the audit row naming what is about to be
destroyed, deletes the entrant, deletes the medical note with it by cascade, returns any discount
code use, clears the hold, and marks any outstanding request as dealt with. The refund is the one
part a dashboard can do.

> **The window for this is already booked.** It is
> [#112](https://github.com/southville-running-club/src-website/issues/112)'s key swap — the only
> planned occasion on which the live pair is bound with somebody watching. Doing it then costs one
> extra button press; doing it separately costs a second key swap.

---

## The dead end — refunding by hand first

**Refunding the stranded payment in the Stripe dashboard and then pressing Cancel does not work,
and it cannot be made to work afterwards.** Stripe answers the second refund attempt
`400 charge_already_refunded`, `refundPayment()` returns `ok: false`, and the cancel path stops
before it touches the record — correctly, because from its side a refusal is a refusal.

The row is then `paid`, the money is back, and no button will ever reconcile the two.

**The obvious `update` is worse than it looks.** This —

```sql
-- Do not do this. Recorded so that nobody rediscovers it as a good idea.
update entries.entry_purchases
   set status = 'refunded', paid_at = null
 where id = '<the purchase id>';
```

— releases the place, and leaves the entrant row and their medical note in the database for a race
they are not running, with no audit row saying who did it or why. It swaps a visible problem for
an invisible one, and the invisible one is personal data the club has published a promise about.

If a hand refund has already happened, **stop and raise it** rather than patching the row. What is
needed is a deliberate decision about reconciling a purchase whose refund the platform did not
issue, and that is a change to money handling rather than a tidy-up.

---

## What "done" looks like

- The pre-swap query returns no `paid` row with a payment intent, in the mode being left.
- Both secrets on the Worker are the same mode as each other and as the registered endpoint.
- The bound key carries all three scopes.
- One real payment has been taken **and cancelled** since the swap. Nothing short of that proves
  the endpoint, the signature over the raw bytes, the transition to `paid` and the refund path —
  everything else is a component test.
- What was actually done is written down, here or on the issue: what, why, by whom, and when.

**Then leave the live keys installed.** Swapping back to test before entries open would take real
money nowhere.

---

## Related

| | |
| --- | --- |
| [**Opening entries**](entries-open.md#step-2--rehearse-a-real-payment-without-opening-the-window) | The rehearsal this procedure sits inside — test mode first, then live for a pound |
| [**The admin surface**](entries-admin.md#cancelling-an-entry) | What the Cancel button does, and the two messages it can answer with |
| [**A purchase needs a human**](entries-attention.md#reconciliation--the-check-that-finds-what-no-flag-can) | The reconciliation that finds a payment no flag was raised for. **A stranded payment raises no flag** — it is an ordinary `paid` row |
| [**The manual steps**](../../../platform/apps/main/README.md#manual-steps) | Where the four Stripe credentials are tracked |
