# ADR-020 — Race category and gender are two questions

**Accepted**, 28 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-011](adr-011-a-race-and-its-runnings.md), [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md) |

## Context

The Nightingale Nightmare entry form asked one question, labelled **Gender**, with three
options: Female, Male, Non-binary. It was required, and its answer went into
`entries.entrants.gender` — the column
[`packages/shared/src/age-category.ts`](../../../platform/packages/shared/src/age-category.ts)
derives a prize band from, the column the start list groups by, and the column the results
will be published under.

So one field was doing two jobs, and it did the second one badly. **A required dropdown of
three labelled "Gender" is a statement that there are three**, made by a running club that
does not believe it and had no reason to say it. It was inherited from the 2023 form rather
than chosen.

The club also already disagreed with itself. `identity.people.gender`, the profile field
`/account/details/` collects, has been **free text with a 60-character ceiling** since
[#61](https://github.com/southville-running-club/src-website/issues/61), and
[`account.ts`](../../../platform/packages/shared/src/account.ts) says why in a comment:

> a closed list of genders is a decision about people the club has not taken

Two forms on one platform asked the same person the same question and only one of them
implied the answer had to come off a list of three.

## Decision

**Two fields.** `gender` stays exactly as it is — three values, required, check-constrained —
and is relabelled to what it has always been: the **race category**. A second column,
`gender_identity`, is optional free text and is where the question about gender is actually
asked.

### Not a longer list, and this is the part worth arguing

The obvious fix is to widen the closed list — add agender, genderfluid, genderqueer, prefer
not to say. It was rejected, because **a longer closed list is the same defect with more
rows**: it is still the club publishing a finite enumeration of which genders exist, and it is
still one somebody can fail to find themselves on. It also makes the problem worse in a way
specific to a race: every value past `female` and `male` is a category with no prize band, so
a list of eight would advertise eight categories and award two.

Both recognised standards do the split instead rather than the list:

| | What it separates |
| --- | --- |
| **GSS/ONS harmonised standard** on gender identity | A binary administrative value, then a separate identity question with a **write-in** — explicitly not a closed enumeration |
| **HL7 Gender Harmony** | *Administrative Gender* — small, closed, for records and processes — from *Gender Identity*, an extensible value set with free text |

Athletics does the same thing in practice without naming it. UK Athletics, England Athletics
and Power of 10 publish results in a binary category; London Marathon, the Great Run series
and parkrun added non-binary **at entry** on top of that. Nobody's results table has eight
columns.

So the split is the industry answer, and the open half is the half that carries "more than
three".

### `gender` keeps its name

It is tempting to rename the column `race_category` and stop the ambiguity at the source.
Rejected on cost, and the cost is not laziness: it is nine function bodies, a check
constraint, a generated type and an expand-migrate-contract sequence across two pull requests,
to fix a name that **is the term of art in the sport** — UKA calls it a gender category and so
does parkrun, and HL7 calls the same idea administrative gender.

The label a runner reads is "Race category". The column keeps the name the domain uses. The
two column comments say which is which, and this record is why.

### It is required, and the other one is optional in earnest

The category has to be answered because the club cannot put somebody in a results table
otherwise. `gender_identity` has no such need attached to it, so it has no such requirement —
**not answering is an answer**, stored as null, and nothing anywhere treats a null as a gap to
chase.

There is deliberately no "prefer not to say" option on either field. On the open one it would
be a stock phrase competing with the empty box that already means it; on the category it would
be a fourth value the results table cannot place.

### Where it may be read

`/admin/nn/`, under the category, and **nowhere else**.

Both halves of that are decisions rather than scope. Collecting a field and surfacing it
nowhere is collecting it for no purpose, which is a data protection problem and not a tidiness
one — so it appears on the one screen a volunteer uses to see who has entered, and
`read_entry_list()` carries it.

`read_export()` deliberately does not. The start list is **paper, handed round a race HQ**, and
read by marshals, helpers and whoever picks it up off a table; the England Athletics export
goes to a governing body that asked for a category; the medical sheet is its own restricted
thing. Publishing somebody's answer onto any of those would out them, in exchange for a
question the form told them was optional and private. `/nn/privacy/` says both halves in
words, and the promise and the behaviour are meant to be checked against each other.

### A transfer clears it

`transfer_entry()` sets it null alongside the England Athletics number and the medical note,
for the reason those two are cleared: **it is a fact about the runner who wrote it**, and
carrying it onto a new person files one person's answer under another person's name — the
worse half of the defect this column exists to fix.

The transfer form does not ask the new runner for theirs. That is a change to the form and to
the function's signature, and it is left as its own decision rather than smuggled in here.

## Consequences

**The entry field list is fifteen, and the committee took that decision.** CLAUDE.md's rule —
*"a fifteenth field is a new decision"* — was met rather than worked around, and this record is
the artefact of it.

**`entries.entrants` holds one more piece of personal data.** It is minimised the way
everything else on that table is: optional at the boundary, `''` normalised to null so "did
not say" is one value rather than two, and never derived from or joined on.

**`/nn/privacy/` grew a row**, and its wording is the enforcement: it says the field is never
published and never used for a category, which is exactly what keeps it out of the exports.

**Amended 30 August 2026.** That row is gone. `/nn/privacy/` was replaced with the
committee's privacy document reproduced verbatim, and that document makes neither promise:
it says "gender" once and "chosen race category" once. So neither this row nor *Where it
may be read* above still describes the published page — a runner is no longer told the
field is never published and never used to derive a category. **The promise still holds
in code**: `admin.spec.ts` asserts the field is absent from every export, against a
*paid* fixture, which is the only kind an export carries. What was lost is the statement
to the person the data is about, not the enforcement of it, and the decision itself is
unchanged.

**The migration is expand-only and there is nothing to contract.** The column is nullable with
a check a null satisfies, so every existing row passes and every deployed Worker keeps working
— a `create_pending_purchase()` call that never mentions the key writes null, which is the
correct answer.

**Age categories for non-binary runners are still not resolved**, and this does not resolve
them. `ageCategoryFor()` still answers `gender-has-no-categories`, the form still says so in
words, and inventing a band structure is still the committee's decision and not a build one.
Splitting the question makes that gap smaller — the runner who could not find themselves in
three options now has somewhere to say so — and it does not close it.

## Exit cost

Low in one direction and not in the other. **Dropping `gender_identity`** is one migration and
the reverse of the form change; the data is not joined on or derived from, so nothing breaks
behind it. **Widening `gender` into a longer closed list later** is the expensive direction and
this record is partly an argument against needing to: it would mean a prize structure to
receive each new value, which is where the real cost is.

## Revisit when

- The committee settles **age categories for non-binary runners**, which is the gap this
  leaves open and the one runners actually meet.
- A **transfer needs to collect** the new runner's answer rather than clearing the old one.
- Enough entries carry an answer that the club wants to **do** something with them, at which
  point what is done with them is a new decision and not an extension of this one.
