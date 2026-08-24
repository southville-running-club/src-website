# Validating the entries constraints

**One command per constraint, run once, after somebody has looked at the table.** It converts
four `NOT VALID` check constraints into ordinary validated ones. Nothing is broken until it is
done, and nothing breaks if it is never done — this is the second half of a deliberate two-step,
not a repair.

Serves [Phase 3](../phases.md#phase-3--nightingale-nightmare-live). Reasoning:
[`20260823140000_entries_rules_enforced.sql`](../../../platform/packages/db/supabase/migrations/20260823140000_entries_rules_enforced.sql).

---

## Why there is a second step at all

Slice G moved nine rules out of Zod and into the database. Four of them are ordinary check
constraints, and a check constraint can be added two ways:

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
     'entry_purchases_purchaser_email_shape',
     'entrants_date_of_birth_plausible',
     'entrants_emergency_phone_has_digits'
   )
 order by conname;
```

All four `convalidated` must be `true`.

- [ ] Record what you did, when, and what step 1 reported, in
      [`apps/main/README.md`](../../../platform/apps/main/README.md)'s manual steps — that is
      what makes a manual exception legitimate rather than merely convenient.

---

## What this runbook does not cover

**The triggers need nothing.** The five contextual rules — the England Athletics number against
its fee, the medical note against its consent, the consents against the event, the date of birth
against the race date, the leg against the event's size — are enforced by triggers, and a trigger
only ever sees a write. There is nothing to scan, nothing that can fail on deploy, and nothing to
validate afterwards.

It is also their limitation, and it is precisely why the four constraints exist alongside them:
**a trigger cannot tell you the rows you already have are fine.** That is the sentence this
runbook exists to be able to say.

---

## Reversing it

`validate constraint` cannot be undone, but it does not need to be: the constraint's *effect* is
identical before and after, and dropping it is the ordinary way back.

```sql
alter table entries.entry_purchases drop constraint entry_purchases_consents_are_boolean;
```

Dropping one is a decision about a rule the club has, so it belongs in a migration and a pull
request like any other — not in this editor. The only reason to run it here is an incident.
