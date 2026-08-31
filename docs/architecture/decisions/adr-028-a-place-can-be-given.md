# ADR-028 — A place can be given, not only sold

**Accepted**, 28 August 2026. **Renumbered twice.** First from ADR-021 on 31 August 2026 —
merged the same day as [ADR-021, *the club tells a runner what happened, through an
outbox*](adr-021-the-club-tells-people-by-outbox.md), which claimed the number first, so
this file collided with it and moved to ADR-026. That number then collided a second time,
with an unrelated ADR-026 (*an HTML part joins the outbox emails*) that merged to `main`
independently while this file's rename was still only on a branch — since a merged number
beats an unmerged one, this file is the one renumbered again, to **ADR-028**. If something
elsewhere still cites "ADR-021" or "ADR-026" meaning *a place can be given*, it means this
document.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-017](adr-017-permissions-are-what-code-checks.md), [ADR-018](adr-018-cancelling-an-entry.md) |
| **Amends** | [ADR-010](adr-010-webhook-writes-paid.md) |

## Context

The club has two places to give to Kinsi. The brief asked for them as a **100% discount code**,
alongside a 10% code for 22 Left Handed Giant places, and the two look like the same feature at
different percentages. They are not.

**Stripe refuses a zero-total Checkout session**, and will not charge below £0.30 in GBP at all.
`apps/main/worker/nn-entry.ts` has carried a backstop for this since the entry path was written —
*"a hundred-per-cent discount code would zero a fee that is not itself free"* — which holds a
place, charges nothing, and tells the person their entry cannot be completed. So the Left Handed Giant
code works because it is 10% off something; two free places cannot, because they are 100% off
everything.

This is the same wall a **visually impaired runner's guide** has been stuck behind since the form
was built. The `vi_guide` fee is £0, and a £0 entry has never been completable, so the form has
always told guides to email the club instead.

The alternative to deciding this is a volunteer with a psql prompt inserting rows on a Sunday,
which [ADR-018](adr-018-cancelling-an-entry.md) already rejected for cancellations in the same
words: unaudited, unrepeatable, available to two people, and one typo from something real.

**[CLAUDE.md](../../../CLAUDE.md) lists manual entries as a stop-and-ask.** It was asked and it
was answered. This record is that answer, and it is deliberately narrow: transfers, corrections,
resends and partial refunds are each still a stop-and-ask, and none of them is built here.

## Decision

**Somebody holding `nn.entry.create` may assign one complimentary place from `/admin/nn/`.** It
is recorded as a `paid` purchase at £0 on a new `complimentary` fee, with its entrants and any
guide, in one transaction under the per-event advisory lock, with an audit row written before the
entry.

### A free place is given, not sold at a price of nothing

The rejected design was a 100%-off code on the public form. It fails on more than Stripe:

- **it hands out free entries to whoever has the string.** A discount code is written on a
  newsletter and forwarded; a 10% code that leaks costs the club £2 a time, and a 100% code that
  leaks costs a place out of 250 and the whole entry fee with it;
- **it puts the power in the wrong place.** Giving away a place is a club decision about a
  specific person, not a rule the form applies to anybody who types the right thing.

So the power sits behind a role, on a page behind a session, with a row in `entries.admin_audit`
naming who gave it and why.

### It stays `paid`, and there is no fifth status

A given place is `paid` with `amount_pence = 0`. "Given" is not a new status, for the reason
[ADR-010](adr-010-webhook-writes-paid.md) refused one: **the capacity predicate counts
`status = 'paid'`**, so a value it did not know about would make a given place invisible to the
count and let the same place be sold to somebody else. The `complimentary` fee is what records
how the place got there; the status records that it is taken.

### What this amends in ADR-010

ADR-010 says the Stripe webhook is the only thing that may write `paid`, and its reason is exact:
the redirect back from Stripe is not proof of payment, so **nothing a browser can reach** may
promote a purchase. That reasoning does not reach this function, because there is no payment to
be proof of — nothing was charged, nothing can arrive late, and there is no state in which the
row's truth depends on something Stripe has not said yet.

What survives unchanged is everything ADR-010 was actually protecting: a purchase that went to
Stripe is still promoted only by a signature-verified webhook over the raw bytes, still under the
same advisory lock, still idempotent by state guard. **This adds a second writer of `paid` that
never touches the payment path**, rather than loosening the one that does.

### `nn.entry.create` is an eighth permission rather than a reuse

`transfer_entry()` reused `nn.entry.cancel` and said why: changing who holds an existing place is
within a hair of the power to undo one. **Giving a place away is not.** It is the power to add a
runner to a course with a hard limit on bodies, and it is the only thing on this surface that
makes the club's money go down rather than changing a record. It is the permission you would want
to grant a partnership coordinator and withhold from everybody else, and a bundled permission
cannot be withheld.

It sits on `nn-admin` and **not** on `super-admin`, for the reason
[#58](https://github.com/southville-running-club/src-website/pull/58) established and ADR-018
restated: a super-admin cannot see the entry list, so granting them this would have meant granting
`nn.entry.read` too — a narrower control bought by widening a wider one.

### Every rule that applies to a bought place applies to a given one

`entries.create_manual_entry()` re-checks capacity under the advisory lock, the minimum age, and
one-runner-one-place. **None of them is a rule about money**, and a place that skipped them would
be a real person turned round on the day, or a runner with two places, or a seventeen-year-old on
a road at night.

The one rule that deliberately does *not* apply is the entry window. `entries_open_at` and
`entries_close_at` say when the public may buy; a partnership place agreed in July and a
replacement given the week before the race are both ordinary. `active` still holds.

### The consent says how it was obtained

`assert_purchase_consents()` refuses a purchase that has not agreed the event's
`required_consents`, and it is right to. But **a volunteer ticking that box is not the runner
agreeing**, and a record that cannot tell the two apart states something false about a person.

So the volunteer ticks it explicitly — it is not assumed, and the function refuses without it
exactly as the public path does — and the stored object carries `recorded_by_admin: true` beside
it. The agreement itself is the club's to obtain out of band, before the place is given. The form
says so, and so does the runbook.

**No medical information travels on this path at all.** The public form asks the runner and
stores it under their own consent; a volunteer typing somebody's condition into a form on their
behalf is a worse arrangement than that person telling the first aiders directly, and it would
mean recording an Article 9 consent nobody gave.

## Consequences

**A guide's free place is completable for the first time**, by the same route. The form's "please
email us" notice is still true — that is now how it gets done.

**Capacity is the thing to watch.** The 250 is a number of bodies on a road, and given places come
out of it like any other. A club that gives away thirty has thirty fewer to sell, and nothing
warns about that beyond the figures panel, which counts them correctly.

**Nothing is emailed to the runner, and that is now a gap rather than an absence.** When this
was written there was no send path at all. [#73](https://github.com/southville-running-club/src-website/issues/73)
landed one — `entries.enqueue_entry_email()` — but it is an `after update` trigger guarded on
`old.status in ('pending', 'expired') and new.status = 'paid'`, and a given place is an
**insert** straight to `paid`. So it does not fire, no `entry_confirmed` message is queued, and
the volunteer still has to tell the person themselves. The outcome page and the runbook say so.

**Whether it should fire is a decision nobody has taken.** The trigger's own comment says it is
"correct for any future path that moves a purchase into the same state", and this is such a path
in spirit and not in mechanism. Making it queue the same `entry_confirmed` template is probably
right — a runner given a place has a confirmed entry like anybody else — but it changes what #73
sends and to whom, so it belongs in a diff somebody takes on purpose rather than in this one.

**`person_id` is null on a given place**, exactly as on a signed-out purchase, so the entry
appears on the runner's account the moment that address registers and confirms. Writing the
volunteer's id there would file the club's gift under the volunteer's own name.

**A given place can be cancelled** through the existing button. It has no payment intent, so the
Stripe refund is skipped — the path already handled that — and the confirmation now says "Cancel
this entry" rather than offering to refund money nobody paid.

**What is still a stop-and-ask:** transfers beyond the existing one, corrections to a record
somebody paid for, resends, and partial refunds.
