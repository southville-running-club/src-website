# ADR-032 — An email is sent when it is owed, not when the cron next runs

**Accepted**, 31 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Amends** | [ADR-021](adr-021-the-club-tells-people-by-outbox.md) — the section *"The queue is drained every five minutes, not at 00:01"* |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-018](adr-018-cancelling-an-entry.md), [ADR-026](adr-026-an-html-part-joins-the-outbox-emails.md) |

## Context

ADR-021 recorded two decisions in one section and only one of them was ever argued.

**The first was that the obligation to send is written in the same transaction as the thing it
is about.** That is the outbox, and it is not in question here. It is what makes a Worker
crash, a Resend outage or a day spent over the cap into *late* rather than *lost*.

**The second was that a five-minute cron is what drains it.** That was never argued on its
merits — it was argued against a *nightly* sweep, which was the ask at the time. The cron
already existed for `expire_pending_holds()`, so the outbox rode on it and no separate
question was put about how long a runner should wait.

The consequence is that **a confirmation can sit `pending` for up to five minutes behind a
payment that has already completed**, and that showed up during manual testing on 31 August
2026 as email that appeared not to have been sent at all. The queue was empty, nothing had
failed, `/admin/emails/` said `0 waiting, 0 failed`, and the messages were simply not due yet.

Two things that shaped ADR-021 have since changed:

- **The club will pay for Resend.** The 100/day free-tier cap was half of ADR-021's reasoning
  and it is no longer a constraint the design has to be built around.
- **The delay was asked about directly**, and the answer wanted is that an email goes when it
  is needed.

## Decision

**A message is sent as soon as the request that owed it finishes. The cron becomes the retry
net rather than the delivery mechanism.**

`nudgeOutbox()` in `worker/index.ts` calls `ctx.waitUntil(drainEmailOutbox(env))` after the
response has been produced, on the two request paths that can enqueue a message:

| Path | What it enqueues |
| --- | --- |
| `POST /nn/stripe-webhook` | `entry_confirmed`, on the transition into `paid` |
| `POST` under `/admin/` | `entry_refunded`; `entry_transferred_out` **and** `entry_transferred_in`; `entry_confirmed` for a given place |

Everything else about the outbox is unchanged: the trigger, the transaction, the `dedupe_key`,
the templates, the batch size, and `claim_outbox_batch()` itself.

### The cron keeps the drain, and removing it was refused

The request was to remove the five-minute schedule entirely. **Two of the three jobs on that
schedule are not email**, and neither may be dropped:

- `expire_pending_holds()` releases lapsed holds back into the 250 and raises `attention` when
  somebody may have paid and have no place.
- `sweepExpiredMedicalNotes()` is what keeps the retention promise **published on
  `/nn/privacy/`**. It is a legal obligation, not a convenience.

The third, `drainEmailOutbox()`, stays too — as the net rather than the mechanism. `waitUntil`
is a best effort: an isolate can be evicted before it finishes, and a `429` stops a batch by
design. Without the cron, either of those makes a failed send **permanent**, which is the one
outcome the outbox exists to rule out. On the normal path it now finds an empty queue and makes
one call that returns nothing.

### Why `waitUntil` rather than awaiting the send

The response goes back first. On the webhook this is load-bearing rather than cosmetic —
[ADR-010](adr-010-webhook-writes-paid.md) has our failures answering 5xx so Stripe retries, and
a slow answer is itself a retry trigger. A confirmation email is not worth putting timing
pressure on the one request that records that money arrived. On the admin surface it is
courtesy: a volunteer pressing *Cancel* should not wait on somebody else's email.

### Concurrency is safe structurally, not by luck

Two drains can now overlap — a nudge against the cron, or two nudges against each other on a
busy entry day. Neither can double-send:

- `claim_outbox_batch()` selects `for update skip locked`, so overlapping runs take disjoint
  rows.
- Resend's `Idempotency-Key` is the outbox row id, so even a genuine double claim cannot
  produce two emails.

This is also why the admin nudge fires on **every** POST rather than only the three that
enqueue. A POST that enqueued nothing costs one query that comes back empty, which is cheaper
than threading a "did that write a row?" flag back out through every branch of `handleAdmin()`
and getting it wrong the first time somebody adds a fourth action.

## Consequences

**A runner is told within seconds instead of within five minutes.** That is the whole point.

⚠️ **Resend's default API rate limit is 2 requests per second.** Under the cron this was
unreachable — ten sequential sends every five minutes. With a nudge per webhook, a burst of
payments on entry-day morning can reach it. A `429` is handled exactly as before: the batch
stops, the rows stay `pending` with their attempt returned, and the cron delivers them within
five minutes. **The rate limit should be raised with Resend alongside the volume tier**, and
until it is, the worst case is the behaviour this ADR replaces rather than anything worse.

**`/admin/emails/` becomes quieter and harder to observe.** Messages now move to `sent` almost
immediately, so the `pending` state that made the queue legible during testing is rarely
visible. This is the intended outcome and it raises the value of surfacing
`provider_message_id`, which is stored and still rendered nowhere.

**The cost of a Worker eviction mid-`waitUntil` is now real but bounded.** The row stays
`pending` and the cron sends it. The observable symptom is a message that took five minutes,
which is what every message took before this decision.
