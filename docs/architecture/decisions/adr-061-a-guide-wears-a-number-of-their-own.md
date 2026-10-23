# ADR-061: A guide wears a race number of their own

**Status:** Accepted
**Date:** 23 October 2026
**Builds on:** [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md) (a guide rides on the
runner's entry) and [ADR-039](adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md)
(_"A guide gets a bib"_), which said a guide wears a bib and not which one.

## Context

A visually impaired runner may enter with a guide, who takes one of the 250 places and runs the
course beside them. `import_from_entries()` puts the guide on their runner's team as **leg 2**,
because a team is the unit of entry and the guide is on the same entry.

The bib rules were written before that, for a solo race where leg 2 "has no meaning":

- `effective_bib()` and `bib.ts` gave leg 2 the team's own number on a solo race, so the Roster
  showed a guide wearing their runner's bib;
- `set_bib_override()` refused leg 2 on a solo race outright, so the desk could not record any
  other number for a guide;
- the registration page showed one bib box per entry.

So whatever a guide actually wore on Nightingale Nightmare, the timing app could only say they
wore their runner's number. If the desk handed a guide the next vest, that number was the
**next entry's**. The guide's crossing would then have been credited to a different runner,
possibly with the guide's time, and that runner's own crossing flagged as a duplicate.

## Decision

**A guide wears a race number of their own** — supplied by a maintainer (Bindal) on 23 October
2026, nine days before the race.

1. **It is the leg-2 override.** On a solo race leg 2 derives nothing: a guide's bib is the
   number written in for them, or none yet. `resolve_crossing_team_id()` already matched a leg-2
   override on either format, so a crossing on the guide's number lands on their entry without
   touching the trigger.
2. **The desk writes it in**, from a **Guide's bib** box on the registration page or the guide's
   row on the Roster. `set_bib_override()` takes leg 2 on a solo race for an entry with a guide
   on it, and refuses:
   - the runner's own number (`bib_taken`, `same_team`);
   - a number another entry wears;
   - for any other entry, a number a guide wears.

   A leg-2 number can always be cleared, so one left behind by a guide who has come off the entry
   is never stranded.
3. **Assign bibs and a walk-in step past any number already written in as an override.** A
   guide's number is in the same 001–250 range as everybody's, and the runbook re-runs Assign
   bibs after late entries. The same gap existed, unnoticed, for a walk-in handed a spare vest.
4. **A guide's crossing times nothing.** A solo result is timed from leg 1's bib alone, so the
   leaderboard, the exports and the published page are unchanged. The published page still
   never says who is a guide (ADR-043).
5. **`event_roster()` says which runner is a guide**, so the registration page can label the
   box. That page is behind `timing.registration.import`, a narrower audience than the Roster's,
   which already shows "(guide)".

## Consequences

- **The desk has to give each guide a number.** Until it does, the guide's row on the Roster
  reads "—" and the registration page says _"Not given yet"_. Before this they silently read as
  wearing their runner's number. The runbook's step 1.5 says to do it.
- **The bib rule changed on purpose.** `derivedBib()` was ported unchanged from the old
  application, which had no guides; its solo leg 2 now answers null. `timing-bib.test.ts` and
  `timing-bibs.test.ts` hold TypeScript and SQL to the new answer together.
- **An override can outlive its guide.** The import never touches overrides, so a guide who
  comes off an entry leaves their number on it. That number still resolves to the entry and is
  still refused to anybody else until somebody clears it from the registration page, which keeps
  the box visible while a number is held.

## Alternatives considered

- **The guide wears their runner's number, or a "GUIDE" vest with no number.** Needed no code,
  and the club's answer ruled it out.
- **Assign bibs numbers guides too.** One press for everybody, but it decides which vest a guide
  gets: the one after their runner, or one from the end of the range. Nobody has said which, and
  whichever it chose would renumber every entry after the first guide in the field. A box with a
  guard is the smaller change before the freeze. If the desk wants it automatic, that is a
  separate decision.
- **A column of its own for a guide's bib.** The leg-2 override already exists, is opaque, and is
  what the trigger resolves. A second column would be a second place the same number could live.

## References

- `platform/packages/db/supabase/migrations/20261023140000_timing_guide_bib.sql`
- `platform/packages/shared/src/timing/bib.ts`
- `platform/apps/timing/app/events/[slug]/registration/page.tsx`
- [The race-night runbook, step 1.5](../../delivery/runbooks/timing-race-night.md)
