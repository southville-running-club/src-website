# ADR-073: A guide has a time of their own on the results

**Status:** Accepted
**Date:** 2 November 2026
**Supersedes:** [ADR-061](adr-061-a-guide-wears-a-number-of-their-own.md) **§4, for the two
results tables only**: _"A guide's crossing times nothing … the published page [is]
unchanged"_. The entry's own result is still timed from leg 1 alone, and the leaderboard, the
exports and the prize lists are unchanged. It also narrows
[ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md)'s _"a guide will not have a result"_
to what that sentence was arguing about: a guide has no category, no band and no prize.
**Builds on:** [ADR-042](adr-042-publishing-a-result-is-an-act-somebody-takes.md),
[ADR-043](adr-043-a-published-result-carries-a-name-a-category-and-a-time.md) and
[ADR-067](adr-067-assign-bibs-numbers-a-guide.md).

## Context

Nightingale Nightmare was run on 1 November 2026 and its results were published. On
2 November a maintainer (Bindal) asked for the visually impaired runners' **guides** to have a
result as well.

The data was already there and nothing read it:

- `import_from_entries()` puts a visually impaired runner on **leg 1** and their guide on
  **leg 2** of one solo team (ADR-022);
- the guide wears a race number of their own, the leg-2 override (ADR-061), given straight
  after their runner's by Assign bibs (ADR-067);
- the race-night runbook tells marshals to capture a guide's number like anybody's, and the
  trigger matches it to their runner's entry.

`buildResults()` times a solo team from its **leg-1** number alone, which is right for the
entry — the entry's result is the runner's. So each guide's crossing was captured, matched and
then read by nothing.

**Everything a guide's row needs is already in the published answer.** `results_for_event()`
returns every runner on every team, the guide included — with `role`, `gender`,
`result_placement` and `age_on_day` withheld once a race is published — and every crossing. So
this needs no migration, no grant, no new field and no _unpublish, fix, publish_: a deploy
changes how the same answer is drawn.

## Decision

1. **A guide whose own number was captured is listed on a row of their own**: their name,
   their number and their own time, measured like everybody's — from the start that actually
   happened, the earliest capture, a discarded capture ignored — with their entry's DNS, DNF or
   DQ carried onto the row if it has one.
2. **No position.** A guide is in no category and no prize (ADR-022). Placing them would also
   move every runner behind them down one, on a table people have already read, and make the
   page disagree with the results export. Every entry's position is exactly what it was, and the
   caption still counts entries — a guide is on their runner's entry.
3. **No category, and on the published page nothing says "guide".** A row saying so says the
   runner beside them is visually impaired, about a named person, on a page anybody can read —
   Article 9 data (ADR-022, ADR-043). The staff preview at `/timing/events/<slug>/results`
   writes "Guide", as it already does in the Category column.
4. **No capture, no row.** A guide whose number was never captured, or whose only capture was
   discarded, is not listed — a row would read "On course", or once a race is over that no time
   was recorded, about somebody who certainly ran beside a runner the table already lists.
5. **One function draws both tables.** `resultLines()` in
   `packages/shared/src/timing/result-lines.ts` returns the rows in finishing order with the
   positions, and `/nn/<year>/results/` and the staff preview both read it, so they cannot
   disagree about who is listed or who came third. **A guide is recognised by being on leg 2
   of a solo team**, because the published answer withholds `role`; a leg-2 runner the answer
   calls a `runner` is never guessed into a guide.

## Consequences

- ⚠️ **Unlabelled is not undisclosed.** A guide's row sits beside their runner's, at almost
  the same time, wearing the next number, with a dash for its position and its category.
  Somebody who knows how guided running works can draw the inference. What this record does
  not do is _state_ it, and a "Guide" label would.
- ⚠️ **The published answer already discloses it, and that predates this record.**
  `results_for_event()` withholds a guide's `role`, and its own comment argues that is what
  keeps the inference out — but it still returns the guide as **leg 2 of their runner's solo
  team**, and on a solo race nothing but a guide is ever on leg 2. So anybody calling it with
  the published anon key can read off who is guided, and could before this change. It is
  **not changed here**: it is a separate change, and it is not a small one, because this
  page reads exactly that structure — closing it means the answer carrying guides some other
  way, such as rows of their own not attached to a runner. It is written down here so that it
  is not lost.
- **The page changes on deploy, with no republish.** The data did not change, only how it is
  drawn. The published page is cached publicly for sixty seconds (ADR-043), so the rows appear
  within a minute.
- **Not changed, each deliberately:** the live leaderboard, the results CSV and XLSX, the prize
  presenter and the prize export, and the finish time on a runner's photos page
  (`finishTimeForBib()`), so a guide's photos page shows their photos and no time. Each is a
  separate change if somebody wants it. The export lists entries only, and its positions still
  match the page's because a guide is never placed.
- **A guide row never carries the "No time recorded" mark** that #385 added for a runner with
  no crossing on a finished race, because a guide's row only exists when there is a capture.

## Alternatives considered

- **Say "Guide" on the published row.** The clearest table, and it publishes that the runner
  beside them is visually impaired. ADR-022 left whether a published sheet may mark guides to
  the committee, and it is still theirs.
- **Give a guide a position.** What some races do, and it moves every runner behind each guide
  on a table already read, puts somebody in no prize into the finishing order, and makes the
  page disagree with the export.
- **Name the guide on their runner's row** — _"Rhodri Bevan, guided by …"_. One row instead of
  two, and an explicit statement of the disability.
- **Give the guide their runner's time.** Invents a time: the guide's own capture is a fact of
  its own, and they need not have crossed in the same second.
- **List every guide, captured or not.** Every guide would appear, and the ones not captured
  would read "On course" for ever about somebody who finished.

## Revisit when

- **The committee decides whether a published table may mark a guide.** That is ADR-022's
  first open question and it is unanswered.
- **The published answer stops carrying guides as leg 2** — the disclosure above. These rows
  would need another source in the same change.
- **Somebody wants a guide's time on the leaderboard, the exports or their photos page.**

## References

- `platform/packages/shared/src/timing/result-lines.ts` and
  `platform/packages/shared/tests/unit/timing-result-lines.test.ts`
- `platform/apps/main/worker/nn-results.ts` — `guideRow()` and `resultsTable()`
- `platform/apps/timing/app/events/[slug]/results/page.tsx` — `GuideRow` and `PreviewTable`
- `platform/apps/main/tests/worker/admin/nn-results.test.ts` and
  `platform/apps/main/tests/e2e/nn-results.spec.ts`, against `PUBLISHED_GUIDE` in
  `platform/apps/main/tests/timing-fixtures.ts`
