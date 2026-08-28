# ADR-021 — The club tells a runner what happened, through an outbox rather than a send

**Accepted**, 28 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-018](adr-018-cancelling-an-entry.md) |
| **Issue** | [#73](https://github.com/southville-running-club/src-website/issues/73) |

## Context

**Until this decision, paying £18 for a place produced no email from the club at all.**
`/account/entries/` showed it to anybody who had an account, and Stripe would send a receipt if
somebody had ticked the right box in a dashboard nobody had recorded checking — which, on test
keys, Stripe does not send at all.

Three moments in an entry's life change something a runner needs to know, and none of them said
anything:

- the place was **paid for** — the one they are waiting for;
- the place was **refunded**, which since ADR-018 deletes their entrant record;
- the place was **transferred**, which replaces the runner and re-points the purchase.

Two constraints shape every answer. **The money has already gone** by the time any of these
happen, so a failure to tell somebody is not recoverable by trying again later unless something
remembered to try. And **Resend's free tier caps at 100 emails a day, account-wide**, against a
race with **250 places** — shared with every account confirmation and password reset the site
sends, because there is one Resend account. On the busiest day of the year, a majority of sends
will be refused.

## Decision

**The obligation to send is recorded in the database, in the same transaction as the thing it is
about. Delivery is a separate, retryable job.**

`entries.email_outbox` holds one row per message the club owes. An `after update` trigger on
`entries.entry_purchases` writes it — on the transition into `paid`, on the transition into
`refunded`, and on a change of `purchaser_email` while `paid`, which is what a transfer is. The
Worker's existing five-minute cron claims a batch, sends each through Resend's REST API, and
records the outcome.

### Why the transaction is the whole point

If the commit succeeds, the email is owed, and nothing anywhere can lose that fact. A Worker that
crashes, a Resend outage, a day spent entirely over the cap — each delays delivery and none of
them loses a message. The alternative considered was a `fetch` at the call site with an
idempotency key, which is materially less code and no new grants; it was rejected because its
failure mode is **a runner who paid and was never told**, which from their side is
indistinguishable from the club losing their entry.

### The trigger fires on the transition, not in the three functions

`record_checkout_event()`, `cancel_entry()` and `transfer_entry()` would each have had to be
reproduced in full to add two lines, because each is already re-created by a later migration than
the one that introduced it. The trigger states the rule once, against the state change rather
than the function performing it, which also makes it correct for any future path into the same
state. It is the choice Slice G already made for rule enforcement.

**The idempotency is structural.** `record_checkout_event()` guards its own transition with
`status in ('pending','expired')`, so a webhook Stripe delivers twice updates nothing and the
trigger never fires again. A unique `dedupe_key` is the belt to that braces.

### Two more functions on the `anon` list, and the key is what makes them safe

CLAUDE.md names a fourteenth `anon`-callable function as a stop-and-ask. **This takes it, for two.**

`anon` is the only role a Worker's cron can reach Postgres as — a scheduled invocation has no
session, so `authenticated` is unavailable, and the service role key may never reach a Worker.
That is `expire_pending_holds()`'s situation exactly, with one difference that decides the
design: **`claim_outbox_batch()` returns real email addresses.** So it takes the webhook key and
checks it before reading anything, exactly as `record_checkout_event()` does, and the database
holds only the digest. `record_send_result()` takes the same key and can only write to a row it
was handed the id of.

**It reuses `ENTRIES_WEBHOOK_KEY` rather than installing a second secret**, and that is the
weakest part of this decision. One key opening two doors is one rotation closing both. It is
reused because the alternative is a two-part manual step — a `wrangler secret put` and an
`update` in the SQL editor — landing days before entries open, where installing half of it sends
nothing and says nothing. **A dedicated `outbox` secret is worth taking after entries open.**

### The queue is drained every five minutes, not at 00:01

The ask was a nightly sweep. Resend's daily cap is documented as resetting on a **rolling** basis
and the exact boundary is recorded as unverified, so a single nightly run aimed at midnight would
park a whole day's overflow behind a guess. A drain that runs continuously and stops on the first
`429` starts delivering the moment capacity returns, whenever that is, and passes 00:01 on the
way. It needs no new trigger and no second thing to notice has stopped.

### A rate-limit rejection is not a failed attempt

A message gets three attempts before it is marked `failed`. **A `429` gives the attempt back**,
because the provider never looked at the message. Without that, one busy afternoon would mark the
entire overflow `failed` before the cap had reset — turning a delay into a data-entry job.

### What the outbox does not hold

**One piece of personal data: an email address.** Everything else a message needs is joined from
the live tables at send time, so this table is not a second copy of an entry for retention to
chase. The address is unavoidable for one template: a transfer overwrites `purchaser_email`, so
the person transferred *away from* cannot be re-derived afterwards — which is also why that
message is addressed generically rather than by name.

## Consequences

**The privacy notices name Resend**, on `/nn/privacy/` and on `/privacy/`. The draft carried that
line conditionally — *"remove this line if the confirmation email is not in place for 2026"* — and
it is in place. Fixing `/privacy/` also corrected a sentence that had been wrong since #50:
account emails were attributed to Supabase after GoTrue started sending them through Resend's
SMTP on 26 August 2026.

**The tier is a known risk this ADR deliberately does not close, and the code is identical either
way.** On the free tier a busy entry day exceeds 100 and the remainder arrives the following day;
on a paid one it does not. **The outbox is what makes that difference *late* rather than *lost*,
and it is worth building under either answer** — which is why this decision does not wait on the
club's.

**The club's stated intention, 28 August 2026, is to pay for the first month and monitor** —
around $20, priced in USD. That is an intention rather than a ratified decision, and nothing in
this repository asserts it: the drain stops on `429` whatever the plan is, and
[the entries-open runbook](../../delivery/runbooks/entries-open.md) step 0.7 is where it gets
confirmed or not.

⚠️ **There are two rushes, and "the first month" covers one of them.** Entries open **1 September**
and close **30 October** — a deadline is its own spike, and a place transferred in the fortnight
before the race is another. A plan bought for September alone is back on 100/day for both. The
monitoring that answers this is `/admin/emails/`: if `pending` rows are routinely unsent the next
morning, pay rather than widen the queue.

**Retention is not answered.** A sent row is kept so the admin surface can show what happened, and
nothing deletes it. This table is one of the places the committee's open decision on how long an
entry record is kept will apply.

**What this does not do.** It does not tell anybody their hold lapsed, it does not notify a
volunteer that a runner has *requested* a cancellation or transfer, and it does not send anything
about the interest list. Each is a message with its own argument to make.
