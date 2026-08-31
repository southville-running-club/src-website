# ADR-031 — A non-binary entrant says where their result should be placed

**Accepted**, 31 August 2026. **Renumbered from ADR-029, 31 Aug 2026** — the number was
taken by [ADR-029](adr-029-holding-a-place-takes-a-key.md), and ADR-030 by
[an entry's readable reference](adr-030-an-entry-has-a-reference-somebody-can-read-out.md),
while this branch was in flight.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-020](adr-020-race-category-and-gender-are-two-questions.md), [ADR-025](adr-025-the-club-asks-a-runner-for-a-phone-number.md) |
| **Extends** | [ADR-020](adr-020-race-category-and-gender-are-two-questions.md)'s open gap — "age categories for non-binary runners are still not resolved" — without closing it |

## Context

[ADR-020](adr-020-race-category-and-gender-are-two-questions.md) split one question into two:
`gender`, the closed three-value race category the prize table and the results are grouped by,
and `gender_identity`, optional free text nothing derives anything from. It was explicit about
what it left open:

> Age categories for non-binary runners are still not resolved, and this does not resolve
> them. `ageCategoryFor()` still answers `gender-has-no-categories` … inventing a band
> structure is still the committee's decision and not a build one.

That gap has a real cost on the form as built. Somebody who chose "Non-binary" got an honest
sentence saying the club had not confirmed their category — and no way to change that answer,
ever, no matter what they typed. The race is run under an ARC permit whose prize structure is
two categories, women's and men's. A non-binary runner's result is not *unplaceable*; it is
*unplaced*, and the form never asked which of those two things was true.

**This record does not invent a third category.** That is still the committee's decision, and
it is still open — see *Revisit when*, below. What this record does is narrower: it asks the
entrant directly whether their result should count in one of the two categories that already
exist, or in neither, and it makes "neither" a real answer rather than the form's silent
default.

### Who decided this, and who did not

The mockup this was built from carried a note against the placement question reading "to be
confirmed by the committee". It was removed before this shipped, on the site maintainer's and
Mark's judgement that the question and its wording are fit to ask as written. **The full
committee was not asked, and specifically Kayleigh's copy sign-off and Drew's confirmation
that this does not misstate ARC's affiliation or prize-eligibility rules were both identified
as the normal gate for a change like this and were deliberately not sought for this
iteration.** That is the same honesty this repository already applies to the race director's
own copy — "Supplied by the race director" on `/nn/2026/terms/` says plainly that a page is
published without ratification rather than implying it has some. This paragraph is that
sentence for this feature: shipped on the maintainers' own authority, not the committee's, and
open to being revisited the moment either sign-off is actually sought.

## Decision

**A new nullable column, `entries.entrants.result_placement`, and a resolver function that is
the only place `gender` and it are read together.**

### The column, and what it may hold

```sql
alter table entries.entrants add column result_placement text;

alter table entries.entrants add constraint entrants_result_placement_only_non_binary
  check (result_placement is null or gender = 'non_binary');

alter table entries.entrants add constraint entrants_result_placement_shaped
  check (result_placement is null or result_placement in ('female', 'male'));
```

Null on every female and male entrant, always — the constraint refuses it outright, so the
question can never attach itself to somebody it was not asked of. For a non-binary entrant it
is `'female'`, `'male'`, or null — and null covers two different facts on purpose: "asked and
said neither" and "never asked at all" read the same to everything downstream, because both
mean no band and no prize eligibility. The form's own wording (`resultPlacementMissing`) tells
a person the true one of those two facts, but the *stored* value does not need to, and
manufacturing a third stored state to distinguish them would be a distinction nothing reads.

### `effectiveCategory()` — one function, so nothing downstream grows a third branch

```ts
export function effectiveCategory(gender: Gender, placement: ResultPlacement): 'female' | 'male' | null {
  return gender === 'non_binary' ? placement : gender;
}
```

Every place that used to read `gender` alone to band an age category — the form's live
preview, `entries.admin_entry_detail()`, `read_entry_list()`, `read_export()`'s start-list
branch, and `nn-admin.ts`'s `bandOf()`/`categoryLabel()` — reads `effectiveCategory(gender,
result_placement)` instead. **None of those call sites gained a conditional.** They already
had a two-valued-or-null question to answer; the resolver is what keeps answering it in two
values, so `ageCategoryFor()`'s own signature and every band calculation inside it are
untouched. `NoCategoryReason` is renamed from the single `gender-has-no-categories` to
`'not-placed' | 'younger-than-any-category'`, because a female or male runner is now
categorically never in the first state — it is reachable only through a non-binary entrant's
own answer or its absence, which is a different fact than "this list has no non-binary row".

### Radios, not a select

The `<select>` labelled "Race category" that showed "Male" was replaced with three radio
buttons — "Men's", "Women's", "Non-binary" — because a runner reads all three options at once
on a radio group and answers with a genuine choice, rather than picking whichever the box
happened to be scrolled to. The placement follow-up is the same shape: three radios, the third
("Do not place me in either") carrying its own hint that says the consequence in words —
*"You get a finish time and a medal. You are left out of the category rankings and the
prizes."*

**Ships visible, hidden by JavaScript, exactly like the medical textarea and the guide's
fields.** With scripting off, every entrant meets the placement question underneath the race
category one; the server enforces that an answer from a female or male entrant is never read,
and requires one from a non-binary entrant through the same `superRefine` shape
`assert_entrant_rules()` mirrors at the database layer. Neither ships hidden and waits for
JavaScript to reveal it — that would make the question invisible to the primary path this
platform is built to keep working.

### A transfer clears it, exactly like `gender_identity`

`transfer_entry()` sets `result_placement` null in the same statement it nulls
`gender_identity` — for the same reason ADR-020 gave: it is a fact about the runner who
answered it, and carrying it onto whoever the place moves to would file one person's answer
under another person's name. The transfer form does not ask the new runner's placement, for
the same reason ADR-020 left the equivalent gap open rather than smuggling a form change into
this record: it is a change to the transfer function's own signature, and it is not this
decision's to make quietly.

### Where it is read, and where it is deliberately not

`/admin/nn/entry/`, as a "Placement" fact, shown only for a non-binary entrant — the same
narrow surface ADR-020 gave `gender_identity`. It also feeds the raw row `read_export()`
returns for the **start-list** export, but not as its own column: `startListCategory()`
resolves it into the one "Category" column both the printed sheet and the CSV already show,
through the same `effectiveCategory()` the form's own preview uses, so the two documents cannot
disagree about which band a runner is in. It is not on the **affiliated** export or the
**medical** export — neither carries `gender` either, and this is no different.

### Scoped out, on purpose

The admin **manual-entry** form and the admin **transfer** form do not collect a placement.
`create_manual_entry()` writes null; `transfer_entry()` clears it. A volunteer assigning a
complimentary place or moving somebody's entry cannot currently set where a non-binary
runner's result should count — they would have to ask the runner and follow up separately.
That is a real gap and it is left open rather than answered here, matching how ADR-020 left the
transfer form's own equivalent gap for a later decision.

## Consequences

**The entry field list is nineteen.** `result_placement` is the field CLAUDE.md's own rule —
"a nineteenth field is a new decision" — was written to catch, and this record is that
decision, taken on the authority this record's *Who decided this* section states plainly
rather than on the committee's.

**Nothing downstream grew a third branch.** `effectiveCategory()` is the one place `gender`
and `result_placement` are read together; every consumer still answers a two-valued-or-null
question exactly as before.

**A non-binary runner now has a route to a real category**, where before the answer was
permanently "not confirmed" regardless of what they typed. The prize structure itself is
unchanged — still two categories — and a runner who says "neither" is told the consequence in
the same sentence that asks the question.

**The migration is expand-only.** The column is nullable and both constraints are satisfied by
null, so every existing row passes and a Worker deployed before this migration — which never
mentions the new key — writes null, which is the correct answer for it.

**Age categories for non-binary runners, as their own prize band, are still not resolved, and
this still does not resolve them** — the same line ADR-020 closed with, restated because it is
still true. What changed is narrower: a runner who does not fit either existing category now
has a way to say so that leads somewhere, instead of a form that could only ever tell them the
club had not decided.

## Exit cost

Low. The column is nullable behind two check constraints a null already satisfies; dropping it
is one migration, and nothing outside `effectiveCategory()` reads it, so nothing else changes
shape behind it. `NoCategoryReason`'s two values would need to be re-merged back into one, which
is a one-line change to `ageCategoryFor()` and to the form's own wording.

## Revisit when

- **The committee is actually asked**, and either confirms this wording and mechanism or asks
  for something different — the gap this record's *Who decided this* section states plainly.
- **The committee settles a genuine third prize category**, which is the same open condition
  ADR-020 named and which this record does not close.
- **A transfer, or the admin manual-entry form, needs to collect a placement** rather than
  clearing or omitting it.
