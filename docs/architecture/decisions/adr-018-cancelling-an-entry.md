# ADR-018 — An nn-admin may cancel and refund one entry, and nothing else about it

**Accepted**, 26 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-017](adr-017-permissions-are-what-code-checks.md) |
| **Issue** | [#107](https://github.com/southville-running-club/src-website/issues/107) |

## Context

[CLAUDE.md](../../../CLAUDE.md) has said since the admin surface was built:

> **Editing people is still not settled.** No refunds, transfers, corrections, manual entries or
> resends — each is a decision about changing a record somebody paid for.

That was the right place to stop while nothing had ever been paid for. It stops being tenable the
moment the club deliberately creates entries against a live race in order to test the payment
path, because the alternative to a cancel button is **a volunteer with a psql prompt deleting
rows on a Sunday** — which is worse in every direction: unaudited, unrepeatable, available to two
people, and one typo away from deleting somebody real.

So this is the decision, taken for exactly one of those five things.

## Decision

**Somebody holding `nn.entry.cancel` may cancel one purchase.** It is refunded in full through
Stripe, its entrant rows and their medical notes are deleted, the purchase moves to `refunded`,
and the place returns to the race.

### `nn-admin` carries it, and `super-admin` deliberately does not

The first draft of this put `nn.entry.cancel` on `super-admin` alone, reasoning that reading the
entry list and undoing a payment are different kinds of act. **That is true and it still gave the
wrong answer**, because a `super-admin` cannot see the entry list: `nn.entry.read` is
`nn-admin`'s, by [#58](https://github.com/southville-running-club/src-website/pull/58)'s decision
that *a grant is not an inheritance*. Putting cancel there would have meant granting `super-admin`
the read permissions too — so a control intended to be narrower would have been bought by
widening a wider one, and by breaking a property `tests/worker/admin/admin.test.ts` asserts.

So it sits with the reads. `nn-admin` already sees every entrant's emergency contact and every
medical note and can export the lot; cancelling one entry is not the larger power. **It is the
louder one**, and it is made loud by the confirmation page, the audit row and this record —
not by the grant.

### `refunded`, and there is no fifth status

The capacity predicate counts `status = 'paid'`. A new status value would be invisible to it,
which is how an oversold place gets sold twice — the reasoning CLAUDE.md already records for why
`over_capacity` is a flag rather than a state. `refunded` is already in the check constraint and
already not counted.

`paid_at` is cleared with it, because `entry_purchases_paid_has_timestamp` insists the two agree
— and that is right rather than merely necessary: the row no longer asserts that this was paid.

### Stripe first, the database second

This is the part worth arguing, because both orderings fail and they fail differently.

| Order | What a failure leaves behind |
| --- | --- |
| Mark refunded → call Stripe | The place is free, the entrant is deleted, and **the club has kept the money**. Nothing on the row says a refund is owed. |
| Call Stripe → mark refunded | The money is back and the row still says `paid`. **Pressing the button again fixes it.** |

The second is recoverable by doing the same thing again, and that property is bought by one
thing: **the refund is idempotent on the purchase id**, so the retry returns the first refund
rather than issuing a second. It is the same mechanism `createCheckoutSession` already uses to
stop a double-tap creating two payment pages for one held place.

It is also the direction this repository already fails in wherever money is involved — towards
the runner. [ADR-010](adr-010-webhook-writes-paid.md) inverted the failure direction for the
webhook on exactly this reasoning, and this is the same inversion for the same reason: by the
time either runs, the money has already moved.

### The entrant is deleted; the purchase is not

A cancelled entry is not a runner. Keeping somebody's emergency contact and their medical history
after refunding them is holding special category data for a purpose nobody could state, and the
retention promise `/nn/privacy/` publishes does not cover it.

The purchase row stays, because it is the club's record of a transaction. That is what
`entry_purchases.event_id`'s `on delete restrict` has always been about, and it is what makes the
audit row point at something afterwards.

### Two POSTs, and the first one changes nothing

The control on the entry list posts to a confirmation page naming the amount; the confirmation
carries the CSRF token that the second POST must echo. A single-click destructive control on a
table of two hundred rows is a mis-tap away from refunding a stranger, and unlike everything else
on this surface there is no undo — re-entering is a fresh purchase at whatever the price is that
day.

The confirmation **does not name the entrant**, deliberately. It is reached by a POST carrying a
purchase id; rendering the name would mean a second read of personal data to decorate a button.

### The audit row is written before anything is destroyed

`entries.record_admin_action()`, in the same transaction, with `auth.uid()` as the actor and the
previous status, the amount, the number of entrants and the Stripe refund reference as the
detail. An audit trail that only records what succeeded is a record of the times nothing went
wrong.

The actor stays a UUID rather than a name, which is [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md)'s
rule and its amendment's: *"a name there would be personal data in a table whose whole purpose is
to be kept and read later."*

## Consequences

**The club can now undo exactly one thing.** Transfers, corrections, manual entries, resends and
partial refunds are each still their own decision, and CLAUDE.md is updated to say which one
moved rather than to delete the paragraph.

**A second Stripe call exists, and it moves money outward.** `refundPayment` in
`worker/stripe.ts`, with the same no-SDK, no-message-logging discipline as the first. It sends no
amount, because omitting it refunds the full charge and a figure computed here would be a second
opinion about what was paid.

**A refund needs the Stripe secret, and refuses without it.** A purchase with a payment intent
cannot be cancelled while no key is configured — the row would say the money went back when it
did not. This is the deployed state today, and the message names the missing secret.

**A `pending` or `expired` purchase cancels with no Stripe call at all**, because it never reached
a card. `cancellable_purchase()` returns a null payment intent and the Worker skips the refund.

**A refund that Stripe reports as `pending` counts as success.** Card refunds are routinely
pending for days and still certain; treating that as a failure would leave the entry uncancelled
with the money already on its way back. Only `failed` and `canceled` stop the cancellation.
