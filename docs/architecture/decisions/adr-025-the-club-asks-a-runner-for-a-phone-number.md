# ADR-025 — The club asks a runner for a phone number, and the race notice says what it holds

**Accepted**, 30 August 2026.

| | |
| --- | --- |
| **Requirement** | [C3](../../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Relates to** | [ADR-020](adr-020-race-category-and-gender-are-two-questions.md), [ADR-028](adr-028-a-place-can-be-given.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md), [ADR-023](adr-023-no-england-athletics-numbers.md) |
| **Supersedes** | Nothing. It **adds the eighteenth entry field** and **ends `/nn/privacy/` being a verbatim document** |
| **Issue** | [#168](https://github.com/southville-running-club/src-website/issues/168), which supersedes [#167](https://github.com/southville-running-club/src-website/issues/167) |

## Context

**The race privacy notice and the entry form disagreed, in both directions at once.**

`/nn/privacy/` said the club collects a **postal address** and an **expected finish time**. It
has never asked anybody for either, and no column in `entries` holds either. It did **not** say
the club collects medical information, a declaration that somebody is visually impaired, how a
runner describes their gender, or anything at all about a guide — and it collects all four.
Two of those are special category data under Article 9.

**The document was already internally inconsistent about the health data.** It names *"Legal
obligations: Health and safety requirements, incident reporting"* as a basis for processing and
*"Medical or emergency services"* as a party it shares with, while its collection list says the
club holds no health information at all. That is a stronger argument than incompleteness: the
notice contradicts itself.

**And it claimed a phone number.** `entries.entrants` held `emergency_contact_phone` — somebody
*else's* number, given for one purpose — and nothing belonging to the runner.

## Decision

### 1. The club asks a runner for their own phone number

**This is a committee decision and the eighteenth field**, taken on 30 August 2026. CLAUDE.md
makes a new personal-data column a stop-and-ask, and it was asked.

**The purpose is stated, because a required field without one is a field people put a made-up
number into.** The club uses it to tell a runner about a change to the race — a start time that
moves, a course that changes, somebody who has not come through registration. The emergency
contact's number does not serve that: it belongs to a third party who agreed to be rung if
something happens to somebody else, and ringing them because the start moved by twenty minutes
is not the thing they agreed to.

**Aligning by collecting more data is the direction
[principles](../principles.md#personal-data-is-minimised-at-the-boundary) argues against, and
that argument was heard.** The cheaper fix was to delete the claim. The club chose the field
because it wanted the field — every race it has put on has wanted a way to reach a runner — and
the notice's existing wording is a coincidence rather than the reason.

### 2. Required of a runner, asked of nobody else

A **guide** is not asked. They already give their own email address and their own emergency
contact under [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md), and a third contact
detail collected from a second person through somebody else's form is one nothing reads.
`entrants.phone` is null on every guide row.

### 3. Where "required" is enforced, and where it deliberately is not

| Path | Required? | Enforced by |
| --- | --- | --- |
| The entry form, `/nn/2026/` | **Yes** | `parseNnEntry` **and** `entries.create_pending_purchase()`, which refuses with `phone_required` |
| Giving a place, `/admin/nn/` | Asked, not required | The form has the box; `create_manual_entry()` stores what it is given |
| Transferring a place | Required by the form | `transfer_entry()` accepts null, so the wrappers keep working |

**There is no `role = 'guide' or phone is not null` check constraint, and its absence is the
load-bearing part of this record.** It is the obvious shape and it breaks two things:

1. **Every row already in the table has a null phone.** It would have to ship `NOT VALID` and
   be validated by hand — a fourth thing owed to
   [the constraints runbook](../../delivery/runbooks/entries-constraints.md).
2. **`transfer_entry()` and `create_manual_entry()` would start refusing.** Both write a runner,
   neither is the entry form, and the Worker that calls them deploys separately from the
   migration. [Expand, migrate, contract](../principles.md#expand-migrate-contract) says every
   schema change keeps the previously deployed code working, and a constraint that refuses the
   transfer the deployed Worker is making does not.

So the column is nullable, `entrants_phone_shaped` constrains what may be *held* — one to forty
characters, the same ceiling the emergency contact's number has — and the requirement lives at
the entry path, where the 250 places and the money are. **Zod is still not the only place the
rule lives**, which is the rule
[Slice E and Slice G](../../delivery/phases.md) exist to keep: the published anon key can post
straight at PostgREST without ever meeting the form, and `phone_required` is what it meets.

### 4. Transferring a place replaces the number rather than carrying it over

The same rule the medical note and the recorded gender already follow, and for the same reason.
A phone number is a fact about the person who gave it; leaving it on the row would file one
person's number under another person's name and print it on the start list beside them.

**`transfer_entry()` grew an eleventh argument rather than a tenth**, because Postgres
identifies a function by its argument *types* and a tenth `text` is already ADR-023's England
Athletics form, which `create or replace` cannot rename. The nine- and ten-argument wrappers
delegate with a null phone, which **clears** the previous runner's number without recording a
new one — so the disclosure is closed on every path the moment the migration lands, and only
the new number waits for the Worker.

### 5. It is readable on the entry, the start list and the exports

Asked for and settled at the same time, because a field the club collects and never surfaces is
a field collected for no purpose.

| | |
| --- | --- |
| `/admin/nn/entry/` | **Yes** — labelled *"Their own number"*, above the emergency contact |
| The printed start list | **Yes** — a line under the runner's name, **not a sixth column** |
| The start-list CSV | **Yes** — a column named `Runner phone`, beside `Emergency phone` |
| The affiliated export | **Yes** — a `Phone` column |
| The medical sheet | **No** |
| The entries table on `/admin/nn/` | **No** — it carries what fits in a column |

**The printed sheet gets a line and not a column, and that is a defect avoided rather than a
preference.** That table already folds four of its five columns below 48rem to clear 320px, and
the folded arrangement cleared a Linux runner by about seven pixels — headroom a scrollbar and
wider font metrics had already eaten once. It has no clipping ancestor, so every excess pixel
becomes document overflow. A sixth column spends that headroom twice over.

**The medical sheet is untouched.** It is a name, a club and an Article 9 note, and adding a
phone number to the one document that is printed in a hall full of people is a change to what
that document *is*.

### 6. `/nn/privacy/` stops being a verbatim document, and the club records that it maintains it

**This is a choice, made knowingly, and it is the half of this record most likely to be
forgotten.** On 30 August 2026 the club asked for the committee's privacy document to be
published word for word. Later the same day it asked for the corrections above. Both cannot be
true, and the club took the edits itself.

**What that permits, and what it does not:**

- **Permitted:** items **inserted into and removed from the collection list**. Nothing else.
- **Not permitted:** rewriting, restyling, reordering or "improving" any sentence on the page;
  changing its structure, its headings or its capitalisation; adding a section.

Anything beyond insertion and deletion of list items goes back to the committee and returns as
new wording. `nn-privacy.spec.ts` still asserts the document's own sentences, which is the only
guard a page like this can have, and it now also asserts the two claims that came out.

## What this changes in earlier records

| | What it said | What is true now |
| --- | --- | --- |
| [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) | The guide gives their own email because a runner is reachable at the address that paid | Still true, and now under-states it: a runner is reachable at that address **and** on their own number. The guide's asymmetry is unchanged and better argued — they give two contact details and a runner gives three |
| [ADR-023](adr-023-no-england-athletics-numbers.md) | `transfer_entry()`'s tenth argument is dead weight and goes at the contract step | Unchanged, and it now has company: the eleven-argument form still carries `p_ea_number` because the type list demanded it. Both go together |
| [Decision 007](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers) | The affiliation reservation belongs on both notices and is on one | **Still unmet, and this record does not close it.** That sentence is new wording rather than a list item, so it stays the committee's to supply — which is exactly the line section 6 draws |

## Consequences

**The notice is accurate in both directions for the first time.** Two claims the club could not
have honoured came out; four things it does hold went in, and the two Article 9 ones are the
half that mattered.

**The guide is named on the notice, and that closes the sharpest gap in it.** They are a second
person whose data is collected through somebody else's form and who may never read this page,
because they did not do the entering. Everything else here was a runner being under-told about
their own data, which the form partly compensates for at the point of collection. That
compensation does not exist for a guide.

**The entry form gains a required field days before the window opens**, which is the shape of
change the club's own change-freeze reasoning exists to avoid. [#168](https://github.com/southville-running-club/src-website/issues/168)
recommended taking the decision now and building after the race; the club chose to build it now,
having read that. The mitigations are that the field is enforced in two layers rather than one,
that no existing path can be refused by it, and that `nn-entry.spec.ts` covers it in all three
browser projects.

**Every entry taken before this migration has a null phone, for ever.** It is not backfillable —
the club never asked — so the start list and both exports will show a blank for those rows.
`fact()` renders nothing at all for a null on the entry page, which is why an old entry shows no
empty row rather than an empty one.

## Exit cost

**One migration and one deploy, and nothing is unrecoverable.** The column is dropped, the form
field comes out, the notice's claim goes back to being deleted rather than made true, and the
three functions revert to the definitions they had. The numbers collected in between would be
deleted rather than archived, which is the same shape as decision 007's exit and the same
answer: the practical exit window is before the first entry is sold.

**The verbatim-document decision is the expensive half to undo**, and it is undone by the
committee supplying a document that already says these things rather than by reverting a file.

## Revisit when

The committee supplies an amended privacy document, at which point section 6 describes a state
that has ended and the page goes back to being reproduced rather than maintained; a nineteenth
field is proposed, which is a new decision and not an extension of this one; the affiliation
reservation is supplied as wording, which closes decision 007's open half; or the club finds it
has never once used a runner's number, which is the evidence that would say the field should not
have been collected.
