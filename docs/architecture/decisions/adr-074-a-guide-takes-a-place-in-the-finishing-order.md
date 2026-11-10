# ADR-074: A guide takes a place in the finishing order

**Status:** Accepted
**Date:** 10 November 2026
**Supersedes:** [ADR-073](adr-073-a-guide-has-a-time-of-their-own.md) **§2, "No position"**, and
the consequence that went with it: _"The export lists entries only, and its positions still match
the page's because a guide is never placed."_ Everything else in ADR-073 stands: a guide's row
exists only when their own number was captured, carries no category, and on the published page
never says "guide".
**Builds on:** [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md),
[ADR-042](adr-042-publishing-a-result-is-an-act-somebody-takes.md) and
[ADR-043](adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).

## Context

Since ADR-073 (2 November 2026), a visually impaired runner's guide whose own number was captured
has a row of their own on `/nn/<year>/results/` and on the staff preview: their name, number and
time, with a dash for the position and a dash for the category.

Between 7 and 10 November the 2026 results were reconciled against the bib recorder's finish
sheets and the timekeeper's stopwatch. The people doing that read the two rows with a time and no
position as results the club had lost, which is what an unnumbered finisher looks like to anybody
not holding ADR-073. A maintainer (Bindal) asked for the guides to have a position.

ADR-073 gave three reasons for the dash. Each has an answer:

- **"A guide is in no category and no prize."** True, and unchanged. A place in the finishing
  order is not a prize. Prizes are worked out by `awards.ts` from the entries alone, and it never
  reads a guide's line. A guide still has no category and no band.
- **"Placing them would move every runner behind them down one, on a table people have already
  read."** True, and that cost is accepted. The 2026 table is being corrected and republished
  anyway (_unpublish, fix, publish_, ADR-042), which moves more places than the guides do. From
  the next race on, a table is published with guides placed from the start, so nobody reads one
  version and then another.
- **"It would make the page disagree with the results export."** Only because the export counted
  entries alone. It now builds its rows from the same `resultLines()` the page draws with, guide
  rows included, so the two cannot disagree.

**Taken on the maintainers' own authority**, as ADR-031 was. It changes how a finishing order is
numbered, not what any record holds, and it states nothing new about anybody.

## Decision

1. **A guide who finished takes a place in the one finishing count**, numbered exactly as every
   entry is: in time order, with no gap and no unnumbered row. A guide whose entry did not start,
   did not finish or was disqualified gets no number, which is the entries' own rule.
2. **Nothing else about the guide's row changes.** Their own number and their own time, no
   category, no row without a capture. The published page still never says "guide"; the staff
   preview still does.
3. **The results export lists the guide too.** A row with their place, number, name and time, and
   no category and no team, because the file goes to people outside the club and a row marked as
   a guide says their runner is visually impaired (ADR-022). A solo entry's row now names its
   leg-1 runner only, so nobody is listed twice.
4. **Prizes are unchanged.** `awards.ts` ranks entries by category and band, and a guide is in
   none.
5. **The caption still counts entries.** A guide is on their runner's entry.

## Consequences

- **Every finisher behind a guide is one place lower than under ADR-073**, on the page, the
  preview and the export alike. On a solo race a guide usually crosses straight after their
  runner, so the runner keeps their place and the guide takes the next one.
- **The published page changes on deploy, with no republish.** Places are drawn from the stored
  crossings, not stored themselves, and the page is cached for sixty seconds (ADR-043). Deploy it
  when the club is ready for a published table's places to move: on 2026, the same window as the
  reconciliation's corrections.
- ⚠️ **ADR-073's warning still applies, a little more strongly.** A numbered row next to their
  runner's, at almost the same time, wearing the next number, is the same inference ADR-073
  described: anybody who knows how guided running works can draw it. Nothing on the page states
  it.
- **The live leaderboard is unchanged** and still lists entries only, so during a race its places
  can differ from the published table behind a guide. It is staff-only and provisional by
  definition, and changing it is a separate change.
- **`resultLines()` is now read by three things** — the published page, the staff preview and
  the export — so a fourth table that numbers finishers should read it too rather than counting
  its own way.

## Alternatives considered

- **Keep the dash, and explain it in a note above the table.** Honest about the rule, and the
  note would have to say why a row has no place, which comes close to saying who is a guide.
- **Place guides on the page and leave the export as entries only**, with gaps in its Position
  column where each guide sits. One file fewer to change, and a file whose numbering skips reads
  as rows missing to whoever receives it.
- **Number guides in a sequence of their own**, such as `G1`. Marks the row as different, which
  is the disclosure this repository keeps declining.

## Revisit when

- **The committee decides whether a published table may mark a guide** — ADR-022's open question,
  which this record does not answer.
- **A governing body's rule for guided runners says otherwise** for a race the club puts on.
- **The leaderboard is changed to show guides**, when its places should come from `resultLines()`
  too.

## References

- `platform/packages/shared/src/timing/result-lines.ts` — `resultLines()` and
  `GuideLine.position`
- `platform/packages/shared/src/timing/result-export.ts` — `buildExportRows()`
- `platform/apps/main/worker/nn-results.ts` — `guideRow()`
- `platform/apps/timing/app/events/[slug]/results/page.tsx` — `GuideRow`
- `platform/packages/shared/tests/unit/timing-result-lines.test.ts`,
  `platform/packages/shared/tests/unit/timing-result-export.test.ts`,
  `platform/apps/main/tests/worker/admin/nn-results.test.ts` and
  `platform/apps/main/tests/e2e/nn-results.spec.ts`
