# ADR-023 — The club holds no England Athletics number, and one column stops meaning two things

**Accepted**, 29 August 2026.

| | |
| --- | --- |
| **Requirement** | [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [C11](../../foundations/requirements.md#c11--verify-england-athletics-registration) |
| **Relates to** | [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md), [ADR-020](adr-020-race-category-and-gender-are-two-questions.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) |
| **Supersedes** | Nothing wholly. It **narrows three accepted records** — see *What this changes in earlier records* |
| **Club decision** | [007](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers) |

## Context

**The committee decided on 29 August 2026 that the club asks for no England Athletics number
and holds none.** A runner states that they are affiliated and the club takes their word for
it. That decision is not this record's to make or to re-argue; it is
[decision 007](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers),
with the ARC Rule 21(2)(b) consequence stated there and accepted there.

**This record is about what the build does with it**, and there are two things in it that were
not obvious from the decision:

1. `entries.entrants.ea_number` cannot simply be dropped, because nothing sequences a migration
   against the Cloudflare deploy.
2. `entries.fees.requires_ea_number` was carrying **two facts**, and only one of them was
   supposed to stop being true.

## Decision

### The column is emptied and constrained, not dropped — this is the expand step

`ea_number` stays on `entries.entrants` and `requires_ea_number` stays on `entries.fees`. Both
are forced to their empty value — null on every entrant, false on every fee — and both reads
that emit them go on emitting them.

**The reason is the deploy window.** `packages/shared/src/admin.ts`'s `entryShape` parses
`ea_number` and `requires_ea_number` as *required* nullable keys, so a missing key is a parse
failure rather than a null. The Worker built before this change is the one reading the schema
for the minutes between `db push` and the Cloudflare deploy; dropping either column would take
the whole of `/admin/nn/` down in that window, and the England Athletics export with it. Roll
code back, roll schema forward — the rule in
[principles](../principles.md#expand-migrate-contract), applied to the case it was written for.

**The contract step is owed and is written down** in
[the contract runbook](../../delivery/runbooks/entries-ea-number-contract.md): it drops both
columns, the keys in `read_entry_list()` and `read_export()`, the `affiliated_missing_ea`
figure, and `transfer_entry()`'s ten-argument form.

### Two check constraints, and both are load-bearing

| | |
| --- | --- |
| `entrants_ea_number_not_collected` | `ea_number is null`. On the table that holds the data, true regardless of what any fee row says |
| `fees_ea_number_not_collected` | `requires_ea_number = false`. No fee may ask for one |

**Neither is redundant.** `assert_entrant_rules()` already enforced a biconditional — a fee that
requires a number must have one, and a fee that does not must not — so with every fee false, the
trigger alone would refuse a number. Relying on that would have left the rule spread across a
trigger reading two other tables, and it would have failed *quietly in the wrong direction*: a
fee marked `requires_ea_number` would then demand a number the entrants constraint forbids, which
is a fee **nobody can enter on**, discovered by a runner at the payment page. The fees constraint
turns that into a migration that will not apply, in front of whoever wrote it.

The entrants one is a **check constraint** rather than the trigger deliberately, and that is
tested: `session_replication_role = replica` suppresses user triggers and does not touch check
constraints, so the escape hatch that seeded a pre-enforcement fixture cannot write a number
either.

Neither ships `NOT VALID`. [The constraints runbook](../../delivery/runbooks/entries-constraints.md)
exists for constraints whose existing rows nobody here can see; these two are different, because
the `update`s immediately above them in the same migration are what make every existing row
satisfy them.

### `entries.fees.affiliated` — one column was carrying two facts

`requires_ea_number` meant *"ask this runner for a number"* and was **also**, by accident of
there being nothing else, the only marker of *"this is the affiliated price"*. The two look like
one fact and are not, and freezing the column would have taken the second meaning with the
first:

- `/admin/nn/`'s **Affiliated entries** figure would read zero on a race full of affiliated
  entries; and
- the England Athletics export would return an empty file for ever, which is worse than a
  removed one because nothing says it stopped working.

So `affiliated` is a new boolean on `entries.fees`, backfilled from `requires_ea_number` —
which is exactly what it meant on every row that exists — and the two reads that care about the
*price* move onto it. It holds no personal data and asks nobody anything, so it is not the
committee decision that
[adding a personal-data column is](../principles.md#personal-data-is-minimised-at-the-boundary).

**`affiliated` is the name that survives.** The contract step drops `requires_ea_number`; it
renames nothing.

### The `ea` export keeps its name and loses its subject

The file existed to evidence the £2 check: a human reading numbers against the club's myAthletics
access. There is nothing to check now — and the file is kept anyway, without the number column,
because **the club still has to be able to say how many affiliated entries there were.** That is
the count ARC Rule 21(2)(b)'s Unattached Runner Levy is assessed against under decision 006, and
this is the only place that answers it as a document a treasurer can keep.

The `ea` kind is **not renamed**. It is named in
[the admin runbook](../../delivery/runbooks/entries-admin.md) and it is a value in
`entries.admin_audit.action`'s closed list; renaming it would widen a restated closed list for no
gain, which is [a merge hazard CLAUDE.md spends a paragraph on](../../../CLAUDE.md). The button
says *"Download the affiliated list"*, which is what a volunteer reads.

## What this changes in earlier records

**None of these is edited**, per the rule that an accepted ADR's answer is not rewritten. Each
keeps its reasoning; what changed underneath it is recorded here.

| | What it said | What is true now |
| --- | --- | --- |
| [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md) | *"The admin surface reads names, clubs, ages, England Athletics numbers, emergency contacts…"* | The list is one item shorter. The argument — that reading people is a decision, made in a diff — is unchanged, and one fewer field being readable does not weaken it |
| [ADR-020](adr-020-race-category-and-gender-are-two-questions.md) | Reasons about `gender_identity` by analogy to the number, and notes `transfer_entry()` clears both | The analogy still holds for the medical note, which is the stronger half of it. `transfer_entry()` has no number to clear |
| [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) | A guide carries no number, is excluded from the England Athletics export, and the affiliated fee must stay usable by a visually impaired runner | **All three still hold and one of them got easier.** Nobody carries a number, so the guide's exclusion from the export is now about not overstating the affiliated *count* rather than about a missing number reading as a defect |

## Consequences

**A live defect is fixed as a side effect, and it is worth naming.** `transfer_entry()` cleared
the previous runner's number — rightly; a number identifies whoever registered it — and
`assert_entrant_rules()` refused that on an affiliated entry. So **every affiliated transfer
raised `check_violation` and reached a volunteer as "the club's database could not be
reached"**, on a database doing exactly what it was told. Asking the new runner for a number of
their own is what closed that, and it is now unnecessary: no fee requires one, the function's
`else` branch nulls the column, and an affiliated place transfers like any other. The
`ea_number_required` refusal is unreachable and goes with the tenth argument at the contract
step.

**The entry form loses its only field conditional on a fee.** Two hard-won layout rules came out
of that field and both are kept as comments where the field was — *a conditional field goes
after the group it is a condition of, never inside it*, and *a container's message belongs to
that container, not to a field nested inside it*. Neither is about England Athletics; both are
about the next conditional field somebody adds.

**Nothing about the money changes.** £18 and £20, and the £2 gap is still ARC's.

## Exit cost

**An afternoon in the schema, and unrecoverable in the data.** The columns are still there and
the constraints are two `drop constraint` statements away, deliberately — that is the whole
point of this being the expand step. What cannot be undone is the deletion: the numbers already
held are set null rather than archived, so restoring the field means asking every entrant again
by email. See decision 007's exit cost, which is the one that matters.

## Revisit when

The contract step is run, at which point this record describes something already done and the
runbook is the live document; or England Athletics publishes a verification API, which is the
only thing that would make the number worth holding and would reopen decision 007 rather than
this record.
