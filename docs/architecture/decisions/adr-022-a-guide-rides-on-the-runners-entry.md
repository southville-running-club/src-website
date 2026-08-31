# ADR-022 — A guide rides on the runner's entry, and takes one of the 250

**Accepted**, 28 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-011](adr-011-a-race-and-its-runnings.md), [ADR-020](adr-020-race-category-and-gender-are-two-questions.md), [ADR-028](adr-028-a-place-can-be-given.md) |

## Context

A visually impaired runner runs with a guide. The guide is on the same unlit course for the same
distance on the same night, and **the course holds 250 people**.

Until now the only way a guide could be recorded was the `vi_guide` fee: a **separate £0 entry**,
which cannot be completed, because Stripe refuses a zero-total Checkout session. So in practice
the club had no record of guides at all, and the 250 was being counted against runners who were
not the only people on the road. Four VI runners were expected for 2026; on the arrangement that
existed, that is four people on the course whom nothing knew about.

The brief asked for **four reserved places**. That is not what the club actually needs and it is
not what this does — see below.

## Decision

**A guide is a second entrant on the runner's own purchase.** One payment, two people, no second
fee. The runner declares on the entry form that they are visually impaired and a guide runs with
them, and enters the guide's details in the same submission.

### Not a reservation

Holding four places back was the brief's shape and it answers a different question. A reservation
has to be sized in advance, has to be released at some point nobody has chosen, and is wrong in
both directions: five VI runners meet a full race with a place held for nobody, and three leave
one unsold. **What the club actually needs is for guides to be counted**, and once they are, no
reservation is required — a VI entry simply takes two of the 250, at the moment it is made,
because it puts two people on the road.

### Three things fell out and none of them needed inventing

- **Capacity was already right.** `create_pending_purchase()` counts entrant *rows* rather than
  purchases multiplied by `entrants_per_entry` — a decision taken in Slice B for a completely
  different reason — so a two-entrant purchase takes two places with no change to the count.
- **The minimum age and one-runner-one-place already applied**, because both loop over every
  element of the entrant payload. A guide under 18 is refused, and a guide who already holds a
  place of their own is refused.
- **Medical notes already worked**, because that argument is positional and the guide is simply
  position two.

The one rule that had to be **added** is that the two cannot be the same person. The existing
one-runner-one-place check compares each entrant against what is *committed*, and both halves of
one submission are written in the same transaction — so nothing in the database could see the
first when it checked the second, and somebody could have entered as their own guide and taken
two places. It is enforced within the payload now, in the database and in the schema module.

### The declaration is a consent, not a fee and not a column

That a runner is visually impaired is data about disability — **special category under UK GDPR
Article 9**, on the same footing as the medical notes. It is recorded the way the medical consent
is: as something ticked, under the event's own `consent_version`.

It is deliberately **not** in `events.required_consents`. That array is what every entry must
agree to; putting a declaration a few people make into it would refuse every entry from everybody
who is not visually impaired. What it does instead is decide how long the entrant list is allowed
to be — which is the whole of what the database reads it for.

It is **not** a boolean on `entrants`, because a column is a thing every read has to remember to
omit, and the reads that must omit it are the exports and the published lists.

### `entrants.role`, and the reads that had to learn about it

`role` is `runner` or `guide`. Three reads were wrong the moment two entrants could share a
purchase, each returning a well-formed answer to a question nobody meant to ask:

- **the entry list would have reported the money twice.** It is purchase-driven with the entrant
  left joined — one row per person, which is right — but `amount_pence` belongs to the purchase,
  so a £20 entry with a guide rendered as two rows of £20.00 while the figures panel, which sums
  over purchases, said £20. The page would have disagreed with itself and the total would have
  been the half that was right;
- **the England Athletics export would have listed every guide.** It exists so a human can
  spot-check affiliated entries against myAthletics, and it selects everybody on a fee that
  requires a number. A guide on a VI runner's affiliated entry is on that fee and carries no
  number, by design — so every guide would have appeared as exactly the thing the list is for
  finding. A check whose false positives are structural is a check somebody stops running;
- **the start list would not have said who was guiding.** Guides belong on it — a marshal at two
  in the morning has to account for everybody on the road — but they are not timed and are in no
  category.

The medical export was correct as it stood and is untouched: a condition on the course is a
condition on the course, and whose entry it was recorded under does not change what a first aider
needs to know.

### A guide is in no category, and nothing changes about categories

`ageCategoryFor()` is untouched. The admin surface and the start list render `Guide` where a
category would go, because a guide will not have a result and putting a band against them would
be inventing one. The non-binary gap [ADR-020](adr-020-race-category-and-gender-are-two-questions.md)
records is unchanged and unaffected.

## Consequences

**A VI entry costs one fee and two places.** That is the intended trade and it should be said out
loud: the club takes £18 or £20 for two people on the course. It is the same arrangement every
guided race uses, and the alternative — charging a guide — is a charge for helping.

**The entry form is longer.** Six more fields and a declaration, all conditional, all present in
the DOM with scripting off. The two recorded layout defects on this form were both caused by
conditional fields moving the control that revealed them, so the guide block sits *after* the
checkbox and the guide's medical notes sit in the medical section under the one consent that
covers both people.

**The VI declaration is rendered nowhere at all**, which is stricter than the pattern
`gender_identity` set. No read returns a purchase's `consents` — not `read_entry_list()`, not any
of the three exports — so it is stored as the lawful basis for holding the guide's data and never
surfaced as a fact about a person on a screen.

**What a volunteer actually sees is the guide's row**, and that is the operational fact anyway:
an entry with a guide on it is an entry with two people on the road, which is what planning needs.
Nothing needs a disability flag rendered next to somebody's name to know that.

## Amended, 28 August 2026 — what a guide is actually asked

Three corrections, all in the same direction: **ask a guide what the club needs and nothing
else.** The original decision reused the runner's field list wholesale, which was the quick
answer rather than the considered one.

**The race category is no longer asked.** `gender` is what the club awards prizes in and
publishes results by — [ADR-020](adr-020-race-category-and-gender-are-two-questions.md) — and a
guide is in **no** category: not timed, not placed, rendered as `Guide` wherever a band would
go. Asking was collecting an answer nothing could ever use, which is the minimisation rule read
backwards. `entrants.gender` drops its `not null` and gains
`entrants_gender_unless_guide`, which allows null **exactly when the row is a guide** — a runner
with no category is refused as loudly as it ever was.

**The email address is asked, and should have been from the start.** A runner is reachable
through `entry_purchases.purchaser_email`, the address that paid. A guide has no purchase of
their own, so the club was putting a second person on an unlit course at night with **no way to
reach them** — and would have found that out on the day. `entrants.email` is a new column
holding personal data, which is a committee decision, and it was taken with this one.

**The VI guide entry type is gone from the form.** With a guide riding on the runner's entry, an
entry type of their own was a choice that led nowhere — and it was the only thing on the page
that reached a £0 total, which Stripe refuses. The `vi_guide` **fee row survives**, because a
purchase could reference it and because the refusal it triggers is still the backstop against a
crafted request and a discount code that zeroes a fee. It simply has no card.

**What this cost elsewhere, recorded because it is the honest part:** the free-place refusal can
no longer be reached through a browser, so its acceptance test was deleted and its coverage moved
to the Worker layer, where the fee code can still be posted directly. A test that could only be
driven through a control that no longer exists is not coverage.

**Two questions are deliberately left open for the committee**, and neither is answered here:

1. **A guide on the published start list discloses that their partner is visually impaired.**
   Guides must be on that sheet for race safety, so this is a real disclosure the club is making,
   not a hypothetical one. Whether the printed sheet should mark them differently — or whether the
   published version should differ from the marshals' version — is a decision about people rather
   than about rendering.
2. **The privacy notice must say what is done with the VI declaration and the guide's data.** It
   is derived from the schema, and a notice that omits them under-lists what the club processes.
   Its four existing open decisions are still `null`.

**`vi_guide` stays as a fee** and is not removed. It is the shape a guide entering separately
would take, it is still on the constraint, and removing it would be a contraction with no expand
in front of it. It remains uncompletable on its own for the Stripe reason, which
[ADR-028](adr-028-a-place-can-be-given.md) is the answer to.

## Recorded, 30 August 2026 — there was a fourth read, and it was written the same day

The decision above names **three** reads that were wrong the moment two entrants could share a
purchase. There were four. `entries.claim_outbox_batch()` — the outbox drain, which decides whose
name greets somebody in an email about their entry — left joined `entries.entrants` on
`purchase_id` alone, so it returned one message **twice** with a different name on each copy and
nothing choosing between them. **A runner could be greeted by their guide's name.** #170, fixed
in `20260830150000_entries_outbox_greets_the_runner.sql`.

Nothing above changes. This is recorded here because *why it was missed* is the useful part, and
it is not carelessness:

- **It was written the same day.** `20260828142000_entries_reads_know_about_guides.sql` taught
  three reads about guides; `20260828170100_entries_email_outbox_drain.sql` landed hours later
  and introduced a fourth. The sweep was done against the reads that existed when the sweep was
  written, and the drain was not one of them.
- **The failure looks like success.** The three reads above all fail *visibly* — a page
  disagreeing with its own total, a spot-check list full of structural false positives, a start
  list missing a marker. The drain fails silently: the provider's idempotency key is the message
  id, so the duplicate send is suppressed, exactly one email leaves, and no counter moves. There
  is no artefact to look at and be troubled by.
- **Every fixture had one entrant.** `entries-email-outbox.test.ts` inserted exactly one person
  per purchase throughout, so no test could have seen it. That was the second half of the defect
  and is closed with the first.

The rule the four have in common is worth stating plainly, because a fifth read will be written:
**anything that joins `entries.entrants` to a purchase must say what it wants from the join.**
One row per purchase, one row per person, or one row per *runner* are three different questions,
and the join answers whichever one it was asked. Write `role <> 'guide'` — the form the rest of
this schema uses, and the one that keeps sending to somebody if the roles list is ever widened —
and, where the read must return one row per purchase, bound it to one rather than trusting an
`order by` on a column the duplicate rows share.
