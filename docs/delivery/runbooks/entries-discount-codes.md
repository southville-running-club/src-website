# Issuing a discount code

**One `insert` per code, run by hand, and the code itself never goes in this repository.**
`entries.discount_codes` has been in the schema since Slice A and deliberately empty ever since.
This is how a row gets into it.

Serves [Phase 3](../phases.md#phase-3--nightingale-nightmare-live). Reasoning:
[`20260828140000_entries_discounts_and_guides.sql`](../../../platform/packages/db/supabase/migrations/20260828140000_entries_discounts_and_guides.sql).

---

## Why this is a runbook and not a migration

**`southville-running-club/src-website` is a public repository.** A code committed to a migration
is not an unguessable code, it is a published one — readable by anybody, in the diff, in the file,
and in the history for ever afterwards even if it is removed later. Twenty-two Long Ashton places
would be gone before the club had told Long Ashton the code.

The table's own comment has said this since it was written: bringing a code back is *"one `insert`
rather than a deploy in the middle of a live entry window"*. This is that insert.

**The entropy is the only control.** There is no rate limiting live anywhere yet — the rules in
[`cloudflare-waf-rules.md`](../../reference/cloudflare-waf-rules.md) are written and have not been
created in the dashboard — so nothing slows down somebody trying codes. A short or guessable code
is the whole of the exposure.

---

## 1. Generate the code

Twelve characters from a 32-letter alphabet with `O`, `0`, `I` and `1` removed, so that a code
read aloud down a phone or off a printed newsletter cannot be mistyped into a different valid one.
That is about 60 bits, which is not brute-forceable over HTTP at any rate anybody could sustain.

**A prefix that says whose it is**, because a volunteer looking at `uses` in six weeks needs to
know which code that row is without asking anybody.

```bash
python3 -c "import secrets; a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; print('LHG-2026-' + ''.join(secrets.choice(a) for _ in range(12)))"
```

`secrets`, not `random` — `random` is seeded predictably and is not for this.

**Put it in the club's password manager before you do anything else**, in the shared vault, named
for the code and the year. It cannot be read back out of the database in any useful way once it is
in, and there is deliberately no page that displays it.

---

## 2. Insert the row

Supabase dashboard → SQL editor, against the production project. Substitute the code you just
generated; everything else is as recorded here.

```sql
insert into entries.discount_codes (event_id, code, percent_off, max_uses, fee_id)
select
  event.id,
  'LHG-2026-XXXXXXXXXXXX',
  10,
  22,
  fee.id
from entries.events as event
join entries.fees as fee
  on fee.event_id = event.id and fee.code = 'unaffiliated'
where event.slug = 'nn-2026';
```

| Column | Value | Why |
| --- | --- | --- |
| `code` | the generated string | `citext`, so a runner typing it in any case matches |
| `percent_off` | `10` | 10% of £20.00 is exactly £2.00, and the rounding never fires |
| `max_uses` | `22` | The 22 places agreed with Long Ashton. Null would be unlimited |
| `fee_id` | the **unaffiliated** fee | *"10% off an unaffiliated entry"* is two facts and `percent_off` is only one of them. Without this the code applies to whichever fee the runner picked, and an affiliated entrant takes 10% off £18 |

**The £2 comes out of the club's share, not ARC's.** An unattached runner still owes the Unattached
Runner Levy under Rule 21(2)(b), which the club must remit within 30 days under 21(2)(c) —
decision 006. So the club nets **£16** on a discounted Long Ashton entry rather than £18, and
£44 across all twenty-two. That is the agreed trade; it is written down here because it is not
visible from the row.

---

## 3. Check it took

```sql
select code, percent_off, max_uses, uses, active,
       (select code from entries.fees where id = discount_codes.fee_id) as fee
  from entries.discount_codes;
```

Then **use it once yourself** on a tester entry, before telling anybody it exists. The confirm
step on `/nn/2026/` shows what the code takes off before anything is charged, so this costs
nothing: enter with the code, read the total, and close the tab rather than continuing to payment.
Nothing is held and no use is spent by a preview.

---

## 4. Watching it

```sql
select code, uses, max_uses, max_uses - uses as left
  from entries.discount_codes where active;
```

**A use is spent when a place is held and given back when the place is.** A runner who reaches
Stripe and closes the tab spends one for up to 31 minutes, and the five-minute cron returns it
when the hold lapses; `cancel_entry()` returns it on a refund. So a count that looks too high in
the middle of a rush is not necessarily wrong — check again after half an hour before doing
anything about it.

**Never edit `uses` by hand to make room.** It is floored at zero and bounded by
`discount_codes_within_max_uses`, and the number is the record of how many places have actually
gone. If the club wants more than twenty-two, raise `max_uses`, which is the honest change:

```sql
update entries.discount_codes set max_uses = 30 where code = 'LHG-2026-XXXXXXXXXXXX';
```

---

## 5. Withdrawing a code

```sql
update entries.discount_codes set active = false where code = 'LHG-2026-XXXXXXXXXXXX';
```

**Never delete the row.** `entry_purchases.discount_code_id` references it, so a purchase bought
under that code would lose the record of why it cost what it cost — and the delete would be
refused anyway. `active = false` refuses every new use and leaves every past one explicable.

A withdrawn code, an exhausted one, a mistyped one and one used against the wrong entry type all
answer identically to the runner: *"That discount code cannot be used with this entry."* That is
deliberate — telling the four apart helps somebody guessing far more than it helps somebody who
made a typo.

---

## What this runbook is not for

**A 100% code.** Stripe refuses a zero-total Checkout session and will not charge below £0.30 in
GBP at all, so a code that zeroes a fee produces a held place that can never be completed. A free
place is **given** from `/admin/nn/` instead — see
[ADR-021](../../architecture/decisions/adr-021-a-place-can-be-given.md) and
[the admin runbook](entries-admin.md).

**A fixed amount off.** `percent_off` is a percentage and there is no pence-off column. Adding one
is a schema change and a decision, not a row.

**A code for a race that is not this one.** `event_id` scopes a code to one running. A 2027 code
is a new row against the 2027 event, generated fresh — **never the 2026 string reused**, which
would let anybody who kept last year's newsletter enter cheaply.
