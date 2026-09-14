# ADR-042 — Publishing a result is an act somebody takes, and finishing a race is not it

**Accepted**, 14 September 2026. **Supersedes** the mechanism sketched in
`20260911180000_nn_results_read.sql`'s header — *"the club later publish[es] results by
widening who holds the permission"* — and nothing else in that migration.

| | |
| --- | --- |
| **Requirement** | [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C7](../../foundations/requirements.md#c7--authenticate-and-authorise-staff) |
| **Issue** | [#241](https://github.com/southville-running-club/src-website/issues/241), rung 4 of [#257](https://github.com/southville-running-club/src-website/issues/257) |
| **Supersedes** | One sentence of an applied migration's header. The permission, the role and the read it created all stand |

## Context

**The club's rule has been quoted in this repository for three days and implemented by
nothing.** [#257](https://github.com/southville-running-club/src-website/issues/257) opens with
it: *results are not open to the public until the race has finished, and finishing does not
publish them*. [ADR-038](adr-038-the-leaderboard-is-staff-only-in-2026.md) reasons from it to
make the live leaderboard staff-only. `CLAUDE.md` states it. And until this record there was
**no state a race could be in that meant "published"** — `timing.result.publish` was a
permission held by two roles and checked by no function, and `timing.events.finished_at` was
written by nothing until #253.

**The mechanism the schema imagined was widening the permission**, and that is what this record
rejects. `20260911180000`'s header says the design *"lets the club later publish results by
widening who holds the permission, without anything in the Worker changing"* — granting
`nn.results.read` to the world, in effect. It is a tidy idea and it is the wrong shape:

- **A permission is a fact about a person; publication is a fact about a race.** Widening
  `nn.results.read` publishes every race at once, for ever, including the one being rehearsed
  next week and the one from 2027 that has not been run.
- **It cannot be undone for one race.** A correction after publication means taking one year's
  table down while it is fixed, which a person-shaped switch cannot express.
- **It destroys the preview.** `nn-results` exists so somebody can read a table *before* the
  public does. If the public holds the same permission, there is no "before" left.

**Finishing is not publication, and the two are already different permissions.**
`timing.event.manage` calls a race over — a label the race director sets and can unset,
gating nothing, because the last runner's crossing arrives after somebody has said it is over
(`20260913240000`). `timing.result.publish` is held by `timing-admin` and `src-admin` and, until
now, opened nothing. The gap between the two acts is where somebody reads the table before the
internet does, which is the whole reason the club asked for two acts.

**Publication also has to be refused while the data is still in doubt.** #252 built the triage
list, and its second population is the one that hides: an **orphan** — a bib that matched no
team — which `record_crossing()` stores and nothing flags, because a validator at the line loses
the moment. Capture never blocks. Publication is the one moment a suspect row must not pass
through silently.

## Decision

**A race's results are published by an explicit act, recorded on the race, refused until the
race is finished and refused while anything is on the triage list.**

1. **`timing.events.results_published_at` and `results_published_by`** are the state. Null
   means unpublished, which every race is until somebody acts.
2. **`timing.publish_results(slug)`**, behind `timing.result.publish`, sets them. It refuses
   `not_finished` while `finished_at` is null and `open_anomalies` while any crossing is on
   `timing.open_anomalies()`'s list, and it is idempotent by its own `where`, answering a second
   press with the winning time rather than an error.
3. **`timing.unpublish_results(slug)`**, same permission, clears them. A correction after
   publication is **unpublish, fix, publish**, and the page goes back to 404 in between rather
   than serving a table somebody is editing.
4. **Both are audited to `timing.admin_actions`, including the withdrawal.**
5. **`timing.results_for_event()` answers `anon` and `authenticated` alike once
   `results_published_at` is set**, and `nn.results.read` holders before it. That is the first
   `anon` grant in the `timing` schema.

**`nn.results.read` goes back to meaning exactly what its own description says** — seeing a
race's results *before* they are published — and is never widened to publish anything.

## Consequences

- **The first `anon` grant in `timing`, and the only one.** Three properties make it safe and
  all three are asserted in `packages/db/tests/timing.test.ts`: the function answers `null`
  unless the race is published, so the grant discloses nothing publication has not already made
  public; `anon` still holds no grant on any **table** here, with RLS on and no policy anywhere;
  and the answer's shape is unchanged — no email address, no club, and now no publisher either.
- ⚠️ **The refusal ordering inside `results_for_event()` had to change, and it discloses
  nothing.** The event is read before the permission is consulted, because the event's own state
  is half of who may read it. Both paths still answer a bare `null`, so "no such race" and "not
  published to you" stay indistinguishable — which is the property `/nn/<year>/results/` 404s
  on.
- ⚠️ **The `open_anomalies` refusal restates `timing.open_anomalies()`'s predicate, and it must
  stay identical to it.** The literal reading of #241 — *"any crossing … has no team"* — also
  catches a capture with **no bib at all**, which the triage list deliberately excludes as
  something an admin cannot resolve from a desk. Refusing over one would block publication on a
  row no screen shows and nobody can clear: the anomalies page empty, the publish button saying
  otherwise, and both of them right. The test file asserts the parity in both directions.
- **`finished_at` gates this and still gates nothing else.** `record_crossing()`, the resolution
  functions and `set_race_status()` are untouched by it, exactly as `20260913240000` insists.
- **`reset_event()` is refused once published**, which is
  [#254](https://github.com/southville-running-club/src-website/issues/254)'s change against this
  record's column, written concurrently.
- **The button belongs to [#205](https://github.com/southville-running-club/src-website/issues/205)
  and the public page to [#242](https://github.com/southville-running-club/src-website/issues/242).**
  Until those, these two functions are called from a SQL client or a test, which is the ordinary
  state of a rung on this ladder rather than a gap.
- **`CLAUDE.md`'s `/nn/<year>/results/` line changes in the same commit**, and so does
  `apps/main/worker/nn-results.ts`'s header, which carried the *"the club has not decided"*
  sentence.

## Alternatives considered

**Widening `nn.results.read` when the club is ready.** The mechanism `20260911180000` imagined.
Rejected for the three reasons in Context — it publishes every race at once, it cannot be undone
for one of them, and it leaves no preview. It is also invisible: nothing on a race would record
that it had been published, or when, or by whom.

**A `published` boolean.** Cheaper to read and it answers none of the questions somebody asks
after the fact. *When* a result became public is the thing an appeal turns on, and a timestamp
costs the same column.

**A lifecycle enum on the event — `capturing | finished | published`.** One column instead of
three. Rejected because two of those states are already columns that mean something on their own
and are set by different permissions, so an enum would have to be kept in step with both — and
because `finished_at` is deliberately reversible and non-gating, which an enum's ordering
implies it is not.

**Refusing `unpublish_results()` while an anomaly is open.** Symmetry, and exactly wrong: an
anomaly discovered *after* publication is when somebody needs to take the page down most, and a
guard there would trap the club on the published wrong answer.

## Exit cost

**Low.** Two nullable columns and two functions; nothing else in the schema reads either, and
the previously deployed Worker is unaffected because both ship null and every race is
unpublished the moment the migration applies. Undoing the decision means dropping two functions
and a grant.

## Revisit when

- **The club asks for results to appear automatically when a race is finished.** That is one
  line — a call to `publish_results()` from `finish_event()` — and it is a decision about the
  club's rule rather than about this mechanism, so it goes in a record of its own.
- **A second race publishes on a different rule.** Pass the Buck's archive is imported rather
  than captured, and whether an imported year is "published" on arrival is a question #206 will
  meet.
- **Publication needs to be scheduled** — *"go public at 6pm"* rather than *"go public now"*. The
  column would hold a future timestamp and the read's comparison would become `<= now()`; that
  is a small change and a real decision about whether a race can be published before anybody has
  looked at it.
