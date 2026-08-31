# ADR-030 — An entry has a reference somebody can read out loud

**Accepted**, 31 August 2026.

| | |
| --- | --- |
| **Requirement** | [C3](../../foundations/requirements.md#c3--accept-race-sign-ups-and-entries) |
| **Relates to** | [ADR-021](adr-021-the-club-tells-people-by-outbox.md), [ADR-024](adr-024-one-entry-in-full.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) |
| **Supersedes** | The reasoning in `worker/account.ts` that made the **purchase id** the printed reference. That code comment named this change and deferred it |
| **Issue** | Asked for on 31 August 2026 while #172, #179 and #183 were in flight |

## Context

**Four surfaces print a reference and all four printed a UUID.**

| | |
| --- | --- |
| `/account/entries/` | Under the heading **Reference** |
| The four outbox emails | *"Your reference is …"*, and *"Your confirmation number is …"* |
| `/admin/nn/entry/` | At the head of the page |
| `/admin/nn/`'s attention queue | The last four characters of one, because a whole one would not fit |

`11111111-2222-3333-4444-555555555555` is unique, it already exists, and it is what
`/admin/nn/`, the Stripe metadata and every `admin_audit` row key on — which is why it was
chosen. **It is also 36 characters of hexadecimal, and the club's volunteers read it down a
phone.** The comment in `worker/account.ts` that chose it said so at the time:

> A shorter, quotable code would be kinder over the phone and is a new column, which is a
> decision rather than a rendering choice.

That is the decision, and this is it. The queue on `/admin/nn/` is the sharpest evidence: it
printed `…5555` and carried a footnote explaining that the names were in the table below,
because the reference it had could not be shown whole.

## Decision

### 1. A per-event entry number, issued on insert

`entries.entry_purchases.entry_no`, filled by a `before insert` trigger from a high-water mark
on `entries.events.next_entry_no`.

**A trigger rather than a line in each writing function.** Two functions insert a purchase today
— `create_pending_purchase()` and `create_manual_entry()` — and a third would silently write a
null. The trigger is what makes the column something to rely on rather than to hope for; the
complimentary places ADR-028 gives away are numbered by it without anything else changing.

**A counter column rather than `max(entry_no) + 1`.** A reference already emailed to somebody
may never come to mean a different entry, and `max() + 1` cannot promise that: delete the
highest-numbered purchase and the next insert takes its number back. Nothing deletes a purchase
today — `cancel_entry()` deletes the *entrants* and leaves the purchase as the financial record
it is — but a restore, a fixture teardown and a future erasure request all can, and the failure
would be silent and permanent. The counter's `update … returning` also takes a row lock, which
is what serialises two concurrent inserts, so this needs no advisory lock of its own.

**`row_number()` over the table is the third wrong answer.** It is a rendering of the current
table rather than a fact about a row, so two reads of the same entry could disagree.

### 2. The string is `NN2026-0042-01092026`, and one function builds it

The event, the number padded to four digits, and the **London** day the entry was made.

`packages/shared/src/entry-reference.ts` is the only place those three become text — the reason
`formatPence()` exists. A reference is quoted back at the club, so every surface printing one
has to print the same characters; a second implementation is how `£18.00` becomes `££18.00`
somewhere.

**No SQL renders it.** The date in a reference is the London day, and this repository has exactly
one path timezone conversion may take (`packages/shared/src/london-time.ts`). A `to_char` in a
migration would be a second one — and 00:30 BST on 1 September is 23:30 UTC on 31 August, so the
two would disagree on the day for one hour in twenty-four.

**The number alone identifies the entry.** That is what makes the other two parts safe to carry:
somebody who garbles the date over the phone has still named a unique row. The event is there
because the club will run more than one race; the date because it is the first thing a volunteer
wants to know about an entry they are being asked about.

### 3. The purchase id stays, on exactly one page

`/admin/nn/entry/` prints both: the reference a runner quotes, and the id beneath it. That page
is where a payment is reconciled with the Stripe dashboard open, and Stripe's metadata and the
audit rows key on the id. Every other surface prints the reference alone.

## Consequences

**Accepted:** an abandoned checkout keeps its number, so the numbers on paid entries have gaps.
The number identifies a record rather than ranking a runner, and no page presents it as *"you
are entry 42 of 250"*. Naming it `entry_no` and never sorting by it is what keeps that true.

**Accepted:** the reference is shorter and therefore easier to guess. It authorises nothing —
`request_entry_action()` re-derives ownership from the session and never from the reference it
is handed, and *"not yours"*, *"not there"* and *"not paid"* all answer `no_such_entry`. That was
already the design; being shorter changes nothing about it.

**Accepted:** every entry taken before this migration keeps the reference it was emailed, because
the backfill numbers them in creation order and `formatEntryReference()` falls back to the
purchase id when there is no number. **No reference already in somebody's inbox is invalidated.**

**Expand, not migrate.** `entry_no` is nullable; the two outbox reads keep `purchase_reference`
on the wire beside the new keys, because the Worker deployed when the migration lands parses it
as required and a message whose shape will not parse is a message nobody receives.

## Exit cost

Small. Drop the column, the counter and the trigger; the render function's fallback already
produces the old reference. The four surfaces need no change at all.

## Revisit when

The club runs a race where an entry number is meaningful to a runner — a numbered place, a
ballot position — at which point the gaps this design accepts stop being harmless.
