# Decision log

Where choices get recorded once they are made — and, just as importantly, how they get
**re-opened** when the ground shifts.

**Nothing is recorded here yet.** [Requirements](requirements.md) and
[options](options.md) come first; decisions come after. That order is the point of this
branch.

---

## What gets a record

A choice needs one if it:

- picks a vendor, framework, language or infrastructure primitive;
- changes where personal data lives;
- would be expensive or slow to reverse;
- or commits the club to a recurring cost.

Small, reversible choices do not. If reversing it costs an afternoon, just make it.

## The shape of a record

Each decision states:

| Section | What goes in it |
| --- | --- |
| **Requirement** | Which capability from [requirements.md](requirements.md) this serves |
| **Context** | The facts that forced a choice. Numbers where numbers exist |
| **Options** | What was genuinely considered, with the trade-off for each |
| **Decision** | What we are doing, in the present tense |
| **Consequences** | What becomes true — including the costs knowingly accepted |
| **Exit cost** | **What it takes to undo this, and whether the data comes with us** |
| **Revisit when** | The condition that reopens it |

Two of those are unusual and deliberate.

**Exit cost is mandatory.** A club running on free tiers is exposed to terms changing under
it. The defence is not choosing perfectly — it is knowing, for every choice, what leaving
would cost. A decision whose exit cost nobody can state is a decision nobody can safely
review.

**"Revisit when", not "revisit if".** A condition, not a hope. *"When the free tier stops
permitting payments"* is a trigger somebody can notice. *"If it becomes a problem"* is not.

---

## Re-evaluating

The point of separating requirements from options from decisions is that a decision can be
re-opened **without re-doing the thinking underneath it**.

To re-evaluate a choice:

1. **Check the requirement still holds.** Often the surprise is that the requirement moved,
   not the market. A decision that no longer serves a requirement is not a bad decision — it
   is a finished one.
2. **Re-score the options against the same criteria** in [options.md](options.md). Same
   criteria, or the comparison means nothing.
3. **Price the exit** using the record's own exit-cost section. Compare that against what
   staying costs.
4. **Write a new record** that supersedes the old one, naming what it replaces. Never edit
   an accepted decision to change its answer — the history of a choice that turned out badly
   is worth more than a tidy file.

### Triggers worth watching

Conditions that should prompt a re-read regardless of whether anyone feels like it:

- A free tier changes its terms — particularly around commercial use, inactivity, or
  retention.
- A recurring cost appears, or an existing one moves materially.
- A second maintainer arrives. Several trade-offs here are made *because* there is one
  volunteer, and they should be revisited when that stops being true.
- A capability in [requirements.md](requirements.md) is added, removed or changes shape.
- Something breaks in a way a different choice would have prevented.
- The club's data-protection position changes.

### When re-evaluation is not worth it

Re-opening a decision has a cost of its own — attention, and the risk of half-finished
migrations. Not worth it when the exit cost exceeds several years of the saving, when the
current choice is merely inelegant rather than failing a requirement, or when the person
proposing the change will not be the one maintaining the result.

**Boring and settled beats optimal and re-litigated**, for a club maintained by volunteers.
