# ADR-024 — One entry point for a running, not one page

**Accepted**, 29 August 2026.

| | |
| --- | --- |
| **Requirement** | [C1](../../foundations/requirements.md#c1--publish-club-information-publicly), [C3](../../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-011](adr-011-a-race-and-its-runnings.md), [ADR-012](adr-012-one-navigation-bar.md), [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md) |
| **Supersedes** | Nothing. It **narrows [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md) at one width on one page** — see *What this changes in earlier records* |

## Context

The race director asked for one page. What the repository supports is one *entry point*, and
the difference is worth stating plainly because it is the thing a reader of this branch will
want explained.

`/nn/2026/` was a hero, a facts list and two form states. Beneath and beside it are three pages
that are live, linked from the bar, asserted in nine spec files and named in
[ADR-011](adr-011-a-race-and-its-runnings.md)'s decision table: `/nn/course/`,
`/nn/2026/race-day/` and `/nn/2026/spectators/`. Absorbing them would retire three URLs.

**No decision record proposes retiring them.** That was checked rather than assumed: there is no
ADR, issue, branch or pull request anywhere in this repository about removing the course page,
and `gh pr list --state open` was empty at the time of writing. An earlier draft of this work
believed otherwise and cited ADR-016 for it; ADR-016 is about identity roles and the word
"course" does not appear in it.

## Decision

### One page carries the whole of what it owns, and summarises what it does not

`/nn/2026/` now holds, in this order: the hero, the entry rail, the race and its facts, a course
summary, race information with the morning schedule **in full**, spooktators, a closing call to
action, and the footer. The three subsidiary pages get a summary section and a link each — three
pages, three summaries, three links, one pattern.

**So it is one entry point rather than one page, and the pull request says so.** A runner
navigating eight addresses now navigates one plus three optional ones, which is the improvement
that was actually available. If the club later wants those three genuinely absorbed, that is a
decision with its own record, taken knowing it retires three URLs.

### The navigation is additive and page-local; the bar is untouched

The four content sections are reachable from a jump-nav that exists **only on this page**.
`NnNav` keeps its seven painted hrefs, identical on all eight campaign pages.

Making the bar's own items in-page anchors was considered and rejected. The bar renders on eight
pages, so its items would have had behaviour that depended on which page you were standing on —
three that scroll and one that loads, or worse, an anchor that points at nothing from
`/nn/privacy/`. Mixed semantics in one control is worse than either pure option.

**The jump-nav is not a second masthead**, and [ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md)
is why that distinction is load-bearing: the defect that record exists to answer is two things
that read alike competing for the top of a page. So the jump-nav is unpinned, has no background
band, no wordmark and no call to action, sits inside the content measure, and is smaller and
lighter. Its current-section marker is a bone rule where the bar's current-page marker is a
`pus` one, so the two cannot be mistaken for siblings.

**Four labels appear twice on this page** — once in the bar, going out to a page, and once in
the jump-nav, going to a section. That is a real cost and the answer is that they are different
destinations with different scopes; the visual subordination is what distinguishes them. Written
down here so the question is answered once rather than at every review.

**The subordination is carried by size, weight and the absence of a band — deliberately not by
colour.** Dimming the links to `color-mix(in srgb, var(--nn-bone) 78%, var(--nn-blood))` measures
5.64:1, and an 85% mix only reaches 6.44:1. This repository's bar for text is AAA. Dimming would
also have reproduced in solid form the `opacity: 0.78` on the masthead's own links, which is on
the ticket list as something this theme should stop doing.

### Legal notices stay separate pages, linked from the footer

`/nn/2026/terms/` and `/nn/privacy/` are linked, not folded in. The terms are year-scoped because
`entry_purchases.consents_version` records which wording somebody ticked against; the privacy
notice is about the race and carries no year. Neither belongs inside a page somebody skims.

### There are no accordions, and the reasoning for the ones there were is kept

Section 5 was to hold five collapsible panels: getting there and parking, what to wear, on the
day, prizes and fancy dress, cake. **Four of those five are `/nn/2026/race-day/`'s own sections**,
so filling them meant copying a page this record deliberately keeps.

They were then to ship **open by default**, because content inside a collapsed `<details>` is not
reliably reachable by find-in-page — Chrome and Edge auto-expand, iOS Safari historically does
not — and roughly seven in ten visitors are on a phone. Somebody searching "parking" on race
morning must not get nothing on a page that holds the answer.

Both positions collapse into the same place. A disclosure widget exists to manage length; a
two-sentence summary has no length to manage. Five `<details open>` holding one paragraph each
are five paragraphs wearing chevrons that never earn a click. **So there are no accordions on
this page at all.**

**The open-by-default reasoning is recorded here rather than deleted**, because somebody will
propose accordions for this page again and the find-in-page argument should not have to be
re-derived. It does not currently apply; it would apply immediately if panels returned.

### A surface rule, and its hard case

The campaign theme has three surfaces and, until now, no written rule about which to use. The
rule the pages already follow, made explicit:

| Surface | For | Because |
| --- | --- | --- |
| The gradient, bare | hero, short factual lists, navigation, footer | glanced at, and the poster is the point |
| A white `.nn-card` | sustained prose, anything filled in, anything that must not be misread | read carefully, often on a phone outdoors |
| The aubergine `.nn-panel` | the one call to action at the foot of a content page | it is the exit and should not look like the content |

**The hard case is stated rather than hidden.** The facts list is a short factual list and is
bare; the race-morning schedule is a short factual list and is carded. The distinction is what
the reader is doing: the facts list answers *what is this race*, and the schedule answers *am I
late*. `race-day.astro` already made that argument — "somebody reads it on a phone, outdoors, in
November, deciding whether they are late". It is a judgement rather than a bright line, and a
brighter line drawn in the wrong place would be worse than a stated seam.

The facts list is **not** carded. It is already assessed and correct, and changing an assessed
block to buy a tidier rule is the wrong trade.

### The entry rail is a summary and a way in, and it ships in the before-open state

The rail carries the fee, the entry window and one button. It is not the form: the interest form
is lifted unchanged and does not fit a 300px column, and a sticky element taller than the
viewport cannot be scrolled to the bottom of — so a rail containing the form would make
`position: sticky` a dead letter in every state.

**It ships visible in the before-open state**, and that generalises well beyond this card. A page
that cannot reach the database must not offer to take money. Every failure — a database that is
down, an event that is missing, a window that has not been resolved — lands on the state that
asks for an email address rather than the state that asks for a card. **Failing towards charging
nobody.**

### On a phone there is one inline call to action, and it is the rail's

Below 860px the hero's primary button is hidden and the rail's survives. The hero keeps its ghost
"Race instructions", so it is not left bare.

The rail's is the one that survives because **it sits beside the fee, and that is the only place
on this page where a price and an action are adjacent.** A card stating £18 with nothing under it
is a question with no answer. The fixed entry bar continues that pairing once the rail scrolls
away, and it reveals when **no inline call to action is on screen** — not when the rail has
passed, which would have put the bar beside the closing block's button at the foot of the page
and reproduced the very duplication this arrangement removes.

An earlier draft of this decision had it the other way round, on the grounds that the hero's
button was the element the Worker rewrites. That was a deployment detail deciding a user-facing
question, and it was wrong: the rewrite hook is an attribute selector that paints every match, so
which button carries it was never a constraint.

## What this changes in earlier records

**[ADR-014](adr-014-the-bar-stays-and-the-notice-is-in-it.md) is narrowed at one width on one
page.** On `/nn/2026/`, below 860px, the masthead is not sticky.

The arithmetic is the reason. ADR-012 unstuck this bar and published the cost — 207px of a 568px
phone, 36% held permanently. ADR-014 stuck it back and corrected that figure as stale: it
described a two-row bar since deleted, and the real cost was 109px. **The bar is 136px now**, and
this page adds a fixed entry bar with a 64px floor: about 200px, 35%, within seven pixels of the
number ADR-012 refused.

**Only this page, because only this page has the second strip.** The other seven campaign pages
have no bottom bar and no arithmetic problem, and ADR-014's requirement — *the navigation should
be reachable from anywhere on a page* — holds unchanged on every one of them. It holds here too,
in the form this page has: a jump-nav to its own sections and a fixed bar carrying the price and
the way in. Above 860px the entry bar is not rendered and the masthead stays stuck exactly as
ADR-014 decided.

The honest cost: one campaign page's chrome behaves differently from its siblings.

**[ADR-011](adr-011-a-race-and-its-runnings.md) is untouched and this record depends on it.** The
consolidation is of one running onto its own address. `/nn/` still names no year, still paints its
year-bearing links at request time, and publishing 2027 is still a row plus a directory.

## Consequences

**The campaign theme diverges from the club's brand guidelines on gradients, and that is now
written down.** `docs/foundations/race-timing-brand-guidelines.md:48` says *"Don't introduce
gradients, glassmorphism, or drop shadows — the brand is flat and confident."* The campaign
theme's whole page background is a radial gradient, taken from the approved mockup, and two
further gradient systems sit on it. **No new gradient is added by this work**, and the existing
one is not removed. The divergence is recorded so the guideline stops being quietly wrong: it
governs the club brand, and one race's campaign, approved as artwork, is the standing exception.

**`noindex` is raised and not decided.** `Base.astro` sets `<meta name="robots" content="noindex">`
on every page, unconditionally, with the comment *"Nothing here is finished, and none of it
should be found in a search yet."* A race page nobody can find becomes a live question once
entries open. The build's recommendation is to leave it until the Squarespace cutover — an
indexed second site competing with the one runners already use is worse than an unindexed one
while both exist — but **this is committee-adjacent and no committee has been asked.** Nothing in
this branch changes it.

**Three copy placeholders await the race director**: the race-information summary, the spooktators
summary and the closing line. They render as a dashed bordered block in mono, which is
deliberately unmistakable — bone text at 8.43:1 with a `pus` rule at 5.44:1, a non-text indicator
against a 3:1 floor. An earlier draft set the text itself in gold, which measures 5.44:1 and
fails this repository's AAA bar for text.

**The campaign theme has its first contrast test.** `nn-contrast.test.ts` resolves both sides of
each pairing out of the stylesheet rather than restating them, so a changed surface or a changed
colour recomputes rather than going quietly vacuous. It does not fix the hand-written table at
the head of `nn-theme.css`, one row of which has already gone stale; it guards the pairs this
work introduced, plus the one that failed in a browser.

## Exit cost

Low, and mostly deletions. The jump-nav, the entry rail, the entry bar and the enhancement
script are additive markup and CSS on one page. `NnNav`, `NnMasthead`'s default behaviour,
`race.json`, the Worker's entry path and all three subsidiary pages are untouched, so reverting
is removing sections rather than reassembling them.

The two things that would not simply revert: `NnSchedule.astro`, which is now shared by two pages
and would want inlining back into `race-day.astro`, and the schedule's own white surface, which
fixes a real defect and should survive any revert of the layout.

## Revisit when

- **The race director asks for the three subsidiary pages to be genuinely absorbed.** That is a
  different decision with a different cost — three retired URLs — and it needs its own record.
- **A second running is published.** Nothing here is year-scoped by construction except the
  content, but the jump-nav and the entry rail have only ever been built once.
- **Accordions are proposed for this page again.** The find-in-page reasoning above still holds
  and should be read before the argument is had a second time.
- **The masthead's height changes.** The 35% figure that narrows ADR-014 is arithmetic on two
  measured numbers, and it is the whole argument for that narrowing.
