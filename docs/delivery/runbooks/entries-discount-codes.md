# Discount codes

**The Left Handed Giant code already exists and nobody has to make it.** It is minted by a
migration and read off `/admin/nn/`. This runbook is how you find it, how you watch it, and what
to do about a second one.

Serves [Phase 3](../phases.md#phase-3--nightingale-nightmare-live). Reasoning:
[`20260828210000_nn_2026_lhg_discount_code.sql`](../../../platform/packages/db/supabase/migrations/20260828210000_nn_2026_lhg_discount_code.sql).

---

## Why there is no code written down here

**`southville-running-club/src-website` is a public repository.** A code committed to a
migration is not an unguessable code, it is a published one — readable by anybody, in the diff,
in the file, and in the history for ever after even if it is removed later. Twenty-two places
would be gone before the club had told Left Handed Giant.

So the migration carries the **generator** and never the value. Every environment mints its own:
a laptop gets one, CI gets one, and production gets the one that counts. **None of them is
anywhere in git.**

**This replaced a runbook that asked a volunteer to generate one by hand and paste an `insert`
into the SQL editor.** That worked and had one cost nobody had priced: nothing displayed the
code, so the password manager was the only copy, and the person who needed to tell Left Handed
Giant what it was had to go and find it there. Now the club reads it off its own admin page.

---

## 1. Find the code

**`/admin/nn/` → the "Discount codes" panel.** You need to be signed in and hold `nn-admin`;
everybody else gets the ordinary 404 the whole surface gives.

The panel shows the code itself, what it takes off, which entry type it applies to, and how many
of the twenty-two have gone. Copy it from there to give it out.

It looks like `LHG-10-3F9A2B7C1D0E` — who it is for, what it takes off, and twelve random
characters. Matching is case-insensitive at both ends, so nobody has to reproduce the case.

**Tell Left Handed Giant it is for the unaffiliated entry.** The code is scoped to that fee and
is refused against the £18 affiliated one, deliberately — a member who is England Athletics
registered enters at the affiliated price, which is already the cheaper of the two.

---

## 2. What it costs the club

10% of £20.00 is exactly £2.00, and **that £2 is the ARC Unattached Runner Levy the club still
has to remit** under Rule 21(2)(b) — decision 006. So the club nets **£16** on each of these
twenty-two rather than £18, and £44 across the allocation.

Agreed, and written here because it is not visible from the row.

---

## 3. Watching it

The panel's `used of 22` is the live figure. If you would rather see it in SQL:

```sql
select code, percent_off, max_uses, uses, max_uses - uses as remaining, active
  from entries.discount_codes;
```

**A use is spent when a place is held and given back when the place is.** A runner who reaches
Stripe and closes the tab spends one for up to 31 minutes; the five-minute cron returns it when
the hold lapses, and `cancel_entry()` returns it on a refund. **So a count that looks too high
in the middle of a rush is not necessarily wrong** — look again after half an hour before doing
anything about it.

**Never edit `uses` by hand to make room.** It is floored at zero and bounded by
`discount_codes_within_max_uses`, and the number is the record of how many places have actually
gone. If the club agrees to more than twenty-two, raise the ceiling, which is the honest change:

```sql
update entries.discount_codes set max_uses = 30 where code like 'LHG-%';
```

---

## 4. Withdrawing a code

```sql
update entries.discount_codes set active = false where code like 'LHG-%';
```

**Never delete the row.** `entry_purchases.discount_code_id` references it, so a purchase bought
under that code would lose the record of why it cost what it cost — and the delete would be
refused anyway. `active = false` refuses every new use and leaves every past one explicable. The
panel shows a withdrawn code as **Withdrawn** rather than hiding it.

A withdrawn code, an exhausted one, a mistyped one and one used against the wrong entry type all
answer identically to the runner: *"That discount code cannot be used with this entry."* That is
deliberate — telling the four apart helps somebody guessing far more than it helps somebody who
made a typo.

---

## 5. A second code, or next year's

**Both are a migration**, following `20260828210000`'s shape: an `insert` that generates the
value rather than containing it, guarded by `where not exists` on the prefix so a re-apply
cannot mint a duplicate.

**Never reuse this year's string for next year's race.** Anybody who kept the 2026 newsletter
would enter cheaply, and `event_id` scopes a code to one running precisely so that cannot
happen by accident.

---

## What this is not for

**A 100% code.** Stripe refuses a zero-total Checkout session and will not charge below £0.30 in
GBP, so a code that zeroes a fee produces a held place that can never be completed. A free place
is **given** from `/admin/nn/` instead — see
[ADR-021](../../architecture/decisions/adr-021-a-place-can-be-given.md) and
[the admin runbook](entries-admin.md#assigning-a-complimentary-place).

**A fixed amount off.** `percent_off` is a percentage and there is no pence-off column. Adding
one is a schema change and a decision, not a row.
