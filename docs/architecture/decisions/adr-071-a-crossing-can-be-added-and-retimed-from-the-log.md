# ADR-071: A crossing can be added and retimed from the timing log

**Status:** Accepted
**Date:** 1 November 2026
**Builds on:** [ADR-034](adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
[ADR-036](adr-036-timing-staff-are-identity-permissions.md) and
[ADR-042](adr-042-publishing-a-result-is-an-act-somebody-takes.md). It reverses a scope
boundary that was written in a page's header comment rather than in an ADR: the timing log's
_"the bib is editable here and the time is not"_.

## Context

Nightingale Nightmare was run on 1 November 2026, the first race timed end to end on this
platform. Afterwards the race control had two things it could not do from any page:

1. **Add a finish nobody captured.** A runner reached the line while no phone recorded them,
   and the marshals wrote the bib and the time on paper — which is the fallback the runbook
   tells them to use. The only way into `timing.crossings` was `record_crossing()`, which
   stamps the moment a marshal taps, asks for a place on the race's roster, and cannot be given a
   time from a sheet of paper after the event.
2. **Correct a time.** `edit_crossing()` has taken a new `captured_at` since #252, but the log's
   form posted the old one back unchanged. The page said why: a `datetime-local` is a wall clock
   with no zone, and this race is run the weekend the clocks go back, so an hour's drift on the
   one value every result is derived from was a real risk. It said that correcting a time
   _"wants a control designed for it rather than one added in passing"_.

A maintainer (Bindal) asked for both on race day, after the race, so that the results could be
right before they are published.

## Decision

1. **The timing log's edit form takes a time as well as a bib.** The box takes a **London clock
   time and nothing else** — `11:47:32` — because that is what the paper says. The **date is the
   race's**: the London day the gun went (`actually_started_at`, else `start_at`), which the page
   draws into the form. Never today's date, which is wrong the morning after, and never the
   browser's zone.
2. **One conversion, in `london-time.ts`.** `londonWallClockInstant()` turns a London date and
   clock into an instant, and **refuses the hour the clocks go back (it happens twice) and the
   hour they go forward (it never happens)** rather than guessing.
3. **A time nobody changed is carried through as the instant it already was.** The bib and the
   time share one form, so every bib correction posts the time box too; re-deriving an instant
   from it would drop the capture's milliseconds.
4. **A plain text box, not `type="time"`.** The iPhone's time picker has no seconds, and the
   paper does. The box accepts `11:47:32`, `11.47.32` and `114732`, which is what a phone's
   number pad can type.
5. **A new function, `timing.add_crossing()`, adds a crossing from the log.** It is behind
   `timing.crossing.resolve` — the permission that already re-bibs and discards captures there —
   and **checks no roster**, because it is a desk copying paper, not a phone at the line. It
   writes `source = 'manual'` (which the column has allowed since the schema was created) and
   `marshal_id = auth.uid()`, and **audits every add** as `crossing_added`.
6. **It refuses what `record_crossing()` deliberately does not.** At the line an anomaly flags
   and never blocks, because the moment is what matters. At a desk there is time to be right. So
   it refuses: no bib; a race whose **results are published** (ADR-042's _unpublish, fix,
   publish_); a time **before the gun** or **after now**; a bib that **already has a crossing
   that counts** (correct that one instead; a discarded one does not count); and a bib **no team
   wears**. That last check is the **bib trigger's own answer**. The row is inserted and rolled
   back inside the function, so the rules for matching a bib to a team are never written a
   second time.
7. **It is idempotent on an id the page draws.** A double press adds once, and the replay is
   recognised before the duplicate check.

## Consequences

- **The thirty-eighth granted `timing` function**, `authenticated` only.
  `packages/db/tests/timing.test.ts` names it.
- **A manually added crossing counts exactly like a captured one** in the leaderboard, the
  preview and the published results. The log marks it **"added by hand"**.
- **After an add, the log opens on the bib that was added**, because the log is ordered newest
  first by crossing time and an 11:47 finish added at teatime would otherwise be buried.
- ⚠️ **`edit_crossing()` is unchanged, and two gaps follow from that.** It does not refuse a
  published race, and it does not refuse a time before the gun or after now. The route refuses
  a corrected time later than now; a time before the gun is shown with the log's existing
  _"recorded before this race started"_ marker. Closing either gap means changing a function the
  deployed Worker calls. That is a separate change, not something to fold into a race-night one.
- **The 2026 change freeze.** `docs/delivery/phases.md` freezes deploys and migrations from the
  week before the race. This change was written on race day, after the race, to put results
  right before publication. **Deploying it before the freeze lifts is a freeze exception**, like
  ADR-067's, and both maintainers have to agree to it.

## Alternatives considered

- **`record_crossing()` with `p_source => 'manual'`.** It asks for the roster, refuses nothing,
  and audits nothing — each right for a phone at the line and wrong for a desk.
- **A `datetime-local` box.** It is a wall clock with no zone, so an hour's drift is easy to
  make. It also asks for a date nobody has on the paper.
- **Fixing the crossing in the Supabase SQL editor.** No audit row, no checks, and a step done
  by hand on a production table on race night.
