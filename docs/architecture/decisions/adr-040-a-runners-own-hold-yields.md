# ADR-040 — A runner's own abandoned hold yields to their next attempt

**Accepted**, 12 September 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-010](adr-010-webhook-writes-paid.md), [ADR-018](adr-018-cancelling-an-entry.md), [ADR-028](adr-028-a-place-can-be-given.md), [ADR-029](adr-029-holding-a-place-takes-a-key.md) |
| **Amends** | the one-place rules of `20260827090000_entries_one_runner_one_place.sql` and `20260830160000_entries_one_place_per_email.sql` |

## Context

**The report was: "someone has their entry set to Hold expired and now they are no longer
allowed to buy a new one."** Half of that sentence describes something that has never
happened.

Both one-place rules in `entries.create_pending_purchase()` count a place as `paid`, or
`pending` with a hold that has not lapsed. `expired` matches neither. An expired hold has let
somebody enter again since the rules were written, and `entries-rules.test.ts` has asserted it
in two places for as long.

**What actually refused them is the thirty-one minutes before that.** A valid entry holds a
place for thirty-one minutes and goes to Stripe Checkout. Somebody who gets that far and does
not pay — the tab is closed, the card is declined, the phone rings — leaves a `pending` hold
with time still on it. A second attempt inside that window met both rules at once:
`already_entered` from the name rule, `email_already_entered` from the address rule.

The form then told them:

> This runner already has a place in this race. The club has an entry recorded against this
> name and date of birth. **Nothing has been charged and no second place has been taken.**

and pointed them at `/account/entries/`, where there was nothing. The first sentence is false,
the advice leads to an empty page, and the only other route offered is emailing the club. A
person in this state has no way forward on the page and no way to know that waiting half an hour
would fix it.

**The two halves of this reach a volunteer separately, and that is what made it read as a
permanent lock-out.** By the time anybody looks at `/admin/nn/`, the five-minute cron has swept
the hold and the row says "Hold expired". So the refusal is remembered against a status that was
not the one doing the refusing — and the obvious fix, "stop letting an expired entry block a new
one", is a change to code that already behaves that way.

### The reasoning that is not being thrown away

Counting a live hold is deliberate, and it is written down. `hasConfirmedEntry()` in
`apps/main/worker/nn-entry.ts` explains why the page's own notice is narrower than the database
rule:

> **`paid` only.** A `pending` hold is not a place, and telling somebody mid-payment that they
> already have one is how they abandon a checkout they were about to finish. The database rule
> is broader — it counts a live hold too, because two simultaneous submissions must not both
> succeed.

That is right and it stays right. What the rule was missing is the difference between **two
submissions from two people** and **two submissions from one person**. The first is a race the
rule exists to settle. The second is somebody trying again, and refusing it protects nobody.

## Decision

**A submission supersedes a live `pending` hold bought by the same address that names one of
its own people: the hold is expired, its place and any discount use go back, and the entry
proceeds.**

The superseded set is computed under the same per-event advisory lock the rest of the function
takes, and it is excluded from three things: the capacity count, the name rule and the address
rule.

### Both identities have to agree, and each half alone was tried and failed

This is the whole of the care in the change, and neither half is belt-and-braces — each was
added after the other one broke something on its own.

**Keyed on the address alone**, two partners on one shared card collide: the second to submit
expires the first one's hold while they are still on Stripe's page, and they then pay for a place
that has gone back. The address rule of 30 August 2026 is what handles that pair, and it handles
it by refusing the second — which it must go on doing.

**Keyed on the runner alone**, the same damage arrives from further away, and
`entries-guides.test.ts` is what caught it. A visually impaired runner's guide rides on *their*
purchaser's entry, so a **different** person entering with this runner as their guide names them
on a submission that is nothing to do with them. That stranger's submission expired this
person's live hold — and was then accepted, which quietly unenforced a rule of its own: a guide
may not also hold an entry of their own.

So both: the hold's `purchaser_email` equals this submission's, **and** somebody on this
submission is somebody on that hold by first name, last name and date of birth, compared exactly
the way the name rule compares them. A guide counts as much as a runner.

**The consequence is that the decision of 30 August 2026 is untouched.** One address holds one
place; a *second* runner on an address that already holds one is refused exactly as before, and
that trade still costs the couple entering on one card. `CLAUDE.md` says of that rule that if the
cost starts being paid "the answer is to revisit the decision, not to add an exception to the
function" — this is not that exception. It does not let a new person in; it stops a person being
blocked by their own unfinished attempt.

**No existing test needed its fixtures changed**, which is the measure of how narrow that makes
it. Superseding requires both identities and no fixture in the suite supplied both.

### `pending` only, and a `paid` place still refuses them

A confirmed place is a place. Superseding one would refund nothing, tell nobody, and quietly
sell the same runner a second entry out of 250 — which is the exact harm both rules exist to
prevent. `refunded` and already-`expired` rows never blocked anybody.

A hold whose thirty-one minutes have already run out is matched even though it does not block,
because handing its place and its discount use back now rather than at the next sweep costs
nothing.

### One runner still cannot hold two places at once

The old hold is expired before the new one is written, in the same transaction, under the same
lock. So the invariant the rules were protecting survives exactly; only its casualty changes.

### A preview computes it and writes nothing

`p_preview => true` runs every rule and returns before the first write, and it has to answer
what a real submission a moment later would answer. So it excludes the same holds from the same
three places, and expires none of them.

## Consequences

**A runner who abandons a checkout can enter again immediately**, which is the point.

⚠️ **A superseded hold may already have a Stripe Checkout session attached, and paying it later
is a late payment against a place that has gone back.** This is not a new state: a hold that
lapses on its own has always been able to take one, `paid` still wins because the webhook never
refuses money, and the place is flagged `over_capacity` if there is no room for it —
[the attention runbook](../../delivery/runbooks/entries-attention.md) is the queue a volunteer
already watches daily while entries are open. **The change makes that window arrive sooner; it
does not create it**, and the alternative is a runner who cannot enter at all.

**A replaced hold and a hold that timed out are indistinguishable on `/admin/nn/`.** Both read
"Hold expired". That is deliberate rather than lazy: both mean no money was taken and no place is
held, which is the whole of what a volunteer needs from a row with nobody coming. A column
recording *why* a hold ended is a schema change with one reader, and nobody has asked for it.

**Two residual refusals survive, both narrow and both deliberate.** Somebody who comes back
**as a different runner** on the same address — most plausibly having mistyped their own name the
first time — still meets `email_already_entered` until the hold lapses; and somebody who comes
back as the same runner from a **different** address still meets `already_entered`. Each is one
half of the key failing to match, which is the same care that stops a stranger expiring a hold. A
signed-in runner cannot reach the second at all, because their address comes from their session
rather than from the form.

**`create_manual_entry()` and `transfer_entry()` are not changed.** Both are a volunteer acting
on one record with the person in front of them, not somebody stuck on a form at midnight. A
volunteer who meets `already_entered` while giving a place away can see the live hold on
`/admin/nn/` and wait half an hour — and superseding a hold from the admin surface without saying
so is the kind of silent write [ADR-024](adr-024-one-entry-in-full.md) and
[ADR-028](adr-028-a-place-can-be-given.md) were both careful not to add.

**Three test fixtures gained a `hold_expires_at`**, in `entries.test.ts`, where raw inserts
wrote `pending` rows with none. The constraint below is what made them fail, and one of them is
worth naming: *"refuses a paid purchase with no paid_at"* began failing on
`entry_purchases_hold_when_pending` instead of on
`entry_purchases_paid_has_timestamp` — the same shape of error, a different constraint, and it
reads as the rule under test being broken when it is the fixture that is.

**One latent defect is closed alongside it**, because it lives in the same predicate.
`entries.entry_purchases` never had the constraint `store.ticket_purchases` was given on its first
day: a `pending` row with a null `hold_expires_at` reads as a hold that never lapses — blocking
that runner and that address for the rest of the year — and `expire_pending_holds()`, which only
expires holds that have a date, could never clear it. Nothing writes one today.
`entry_purchases_hold_when_pending` ships `NOT VALID`, per this repository's rule for a new check
constraint, and [the constraints runbook](../../delivery/runbooks/entries-constraints.md) owns
validating it with the other four.

**Taken on the maintainers' own authority.** It is a defect on the entry form during the entry
window, not a change to what the club collects, charges or promises. It is recorded here because
it narrows a rule two migrations argued for in writing, and because the next person to read those
migrations needs to find this.

## Revisit when

- **A third one-place rule is proposed**, or either existing one is widened. The superseded set is
  excluded from the two that exist by name; a third would have to decide for itself.
- **Either residual refusal above is actually reported.** The same-runner-different-address one is
  the likelier, and the honest fix for it is not to loosen this key — it is for the form to say
  what is actually happening, which the current wording cannot because it does not know.
- **Anybody asks why a hold ended.** That is the column this decision declined to add.
- **A late payment against a superseded hold actually happens.** The attention queue will show
  it. If it happens more than once, the question worth asking is whether the Checkout session
  should be expired at Stripe when its hold is — which is an API call this platform does not
  currently make for any hold, lapsed or replaced.
