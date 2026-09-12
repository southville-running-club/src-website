# Validating the entries constraints

**One command per constraint, run once, after somebody has looked at the table.** It converts
**five** `NOT VALID` check constraints into ordinary validated ones. Nothing is broken until it
is done, and nothing breaks if it is never done — this is the second half of a deliberate
two-step, not a repair.

⚠️ **It was four until 12 September 2026**, and `entry_purchases_hold_when_pending` is the fifth.
It arrived with a different change rather than with Slice G, so the four-then-five split runs
through this whole document: the *reasoning* below is Slice G's, and the fifth's is its own.
`packages/db/tests/entries-rules.test.ts` asserts the list by name and is what makes a sixth
appear here rather than be forgotten.

Serves [Phase 3](../phases.md#phase-3--nightingale-nightmare-live). Reasoning:
[`20260823140000_entries_rules_enforced.sql`](../../../platform/packages/db/supabase/migrations/20260823140000_entries_rules_enforced.sql)
for the first four, and
[`20260912130000_entries_a_runners_own_hold_yields.sql`](../../../platform/packages/db/supabase/migrations/20260912130000_entries_a_runners_own_hold_yields.sql)
plus [ADR-040](../../architecture/decisions/adr-040-a-runners-own-hold-yields.md) for the
fifth.

---

## Why there is a second step at all

Slice G moved nine rules out of Zod and into the database. Four of them are ordinary check
constraints — and one more joined them later, for the same reason and by the same rule — and a
check constraint can be added two ways:

| | What it does | What it costs |
| --- | --- | --- |
| Ordinary `add constraint` | Enforces on every future write **and reads every existing row to prove they comply** | Takes ACCESS EXCLUSIVE, and **fails the migration if one row disagrees** |
| `add constraint … not valid` | Enforces on every future write, and **does not look at the existing rows** | Nothing. The constraint is live immediately |

**They were added `not valid`, and the reason is that nobody could see the production rows.**
A migration that fails on deploy does not fail politely for entries alone — it fails the deploy,
and on this platform Workers Builds triggers on the push rather than on a green CI run, so the
schema and the code go out unsequenced. A constraint that turns out to disagree with one row
written by hand eighteen months ago is not the way to discover that.

The reasoning said there should be no rows at all: `entries_open_at` is null in production, and
`create_pending_purchase` returns `closed` when it is null, so nothing can have reached the
tables through the entry path. **That is an argument, not a look at the table.** This runbook is
the look.

**Validating changes no behaviour.** Every write has been checked since the migration landed.
What validation adds is the guarantee that the rows already there comply too — which is what
lets a later reader trust the constraint as a statement about the whole table rather than about
its recent history.

---

## Step 0 — before you start

- [ ] The migration `20260823140000_entries_rules_enforced.sql` has been applied to the
      project you are about to run this against. `supabase migration list` says so.
- [ ] So has `20260912130000_entries_a_runners_own_hold_yields.sql`, which adds the fifth. If
      only the first is applied, skip the fifth constraint everywhere below — it is not there
      to validate, and `validate constraint` on a constraint that does not exist errors.
- [ ] You are in the **Supabase SQL editor for the production project**, or connected with
      `psql`. This needs no service role key and no application credential.
- [ ] You have five minutes. There is no half-done state, but there is no point stopping in
      the middle either.

---

## Step 1 — ask whether it will succeed

**Read-only. Run this first, always.** It reports one row per constraint with the number of
existing rows that disagree with it.

```sql
select 'entry_purchases_consents_are_boolean' as constraint_name,
       count(*) as violating_rows
  from entries.entry_purchases
 where jsonb_path_exists(consents, '$.* ? (@.type() != "boolean")')
union all
select 'entry_purchases_purchaser_email_shape',
       count(*)
  from entries.entry_purchases
 where purchaser_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
union all
select 'entrants_date_of_birth_plausible',
       count(*)
  from entries.entrants
 where date_of_birth < date '1900-01-01'
union all
select 'entrants_emergency_phone_has_digits',
       count(*)
  from entries.entrants
 where length(regexp_replace(emergency_contact_phone, '[^0-9]', '', 'g')) < 7
union all
-- The fifth. A pending purchase holds a place, so it has to say when the place goes back.
select 'entry_purchases_hold_when_pending',
       count(*)
  from entries.entry_purchases
 where status = 'pending' and hold_expires_at is null
order by 1;
```

**Every `violating_rows` must be 0.** Then continue to step 2.

### If any of them is not 0

**Stop, and do not "fix" the rows.** Every one of these tables holds either somebody's personal
data or the record of a payment, and a row that disagrees with one of these rules is evidence
about how it got there. It is a question for both volunteers together, and it wants answering
before anything is edited:

- **`consents_are_boolean`** — a purchase whose record of what somebody agreed to is not a
  yes or a no. It cannot have come from the form.
- **`purchaser_email_shape`** — an address the confirmation will never reach.
- **`date_of_birth_plausible`** — almost certainly a typed year, and it changes an age category.
- **`emergency_phone_has_digits`** — the number somebody would be rung on.
- **`hold_when_pending`** — ⚠️ **this one is not a typo or an import, it is a live defect.** A
  `pending` purchase with no `hold_expires_at` is a hold that never lapses: it counts against
  the 250 for ever, `expire_pending_holds()` can never reach it because that function only
  expires holds that have a date, and until 12 September 2026 it also blocked that runner and
  that address from entering again permanently. **Do not leave it alone.** Find out which
  purchase it is, whether it was ever paid, and whether somebody has been trying to enter — the
  runner is the person to ask. Setting the row to `expired` hands the place back; doing that
  before understanding it discards the evidence of how the row got there.

Leave the constraint `not valid`. It is still protecting every new write, which is the half that
matters most, and the rows are still there to be understood.

---

## Step 2 — validate

One statement per constraint. Run them one at a time and read each result.

```sql
alter table entries.entry_purchases validate constraint entry_purchases_consents_are_boolean;
alter table entries.entry_purchases validate constraint entry_purchases_purchaser_email_shape;
alter table entries.entrants validate constraint entrants_date_of_birth_plausible;
alter table entries.entrants validate constraint entrants_emergency_phone_has_digits;
alter table entries.entry_purchases validate constraint entry_purchases_hold_when_pending;
```

**`validate constraint` takes only SHARE UPDATE EXCLUSIVE.** It does not block reads and it does
not block writes, so this is safe to run in the middle of an open entry window. It scans the
table once; on a field of 250 that is instant.

If one of them errors, it will name the constraint and say a row violates it. That is step 1's
question arriving late — go back to it.

---

## Step 3 — confirm

```sql
select conname, convalidated
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
 where n.nspname = 'entries'
   and conname in (
     'entry_purchases_consents_are_boolean',
     'entry_purchases_hold_when_pending',
     'entry_purchases_purchaser_email_shape',
     'entrants_date_of_birth_plausible',
     'entrants_emergency_phone_has_digits'
   )
 order by conname;
```

All five `convalidated` must be `true` — four, if the fifth's migration is not applied yet.

- [ ] Record what you did, when, and what step 1 reported, in
      [`apps/main/README.md`](../../../platform/apps/main/README.md)'s manual steps — that is
      what makes a manual exception legitimate rather than merely convenient.

---

## What this runbook does not cover

**The triggers need nothing.** The contextual rules — the medical note against its consent, the
consents against the event, the date of birth against the race date, the entrant against the
event's minimum age, the leg against the event's size — are enforced by triggers, and a trigger
only ever sees a write. (There was a sixth, the England Athletics number against its fee. The
club [stopped asking for numbers](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers)
on 29 August 2026, and what replaced it is a plain check constraint that ships **validated** —
the migration empties the column immediately above it, so there is nothing here to scan.) There is nothing to scan, nothing that can fail on deploy, and nothing to
validate afterwards.

It is also their limitation, and it is precisely why the five constraints exist alongside them:
**a trigger cannot tell you the rows you already have are fine.** That is the sentence this
runbook exists to be able to say.

---

## Reversing it

`validate constraint` cannot be undone, but it does not need to be: the constraint's *effect* is
identical before and after, and dropping it is the ordinary way back.

```sql
alter table entries.entry_purchases drop constraint entry_purchases_hold_when_pending;
alter table entries.entry_purchases drop constraint entry_purchases_consents_are_boolean;
```

Dropping one is a decision about a rule the club has, so it belongs in a migration and a pull
request like any other — not in this editor. The only reason to run it here is an incident.
