# ADR-067: Assign bibs numbers a guide, straight after their runner

**Status:** Accepted
**Date:** 25 October 2026
**Supersedes:** [ADR-061](adr-061-a-guide-wears-a-number-of-their-own.md) **§2 and its first
consequence only** — that the desk writes each guide's number in, and so has to remember to.
Everything else in ADR-061 stands: a guide wears a number of their own, it is the leg-2
override, the clash rules, the step past a number already worn, and a guide's crossing timing
nothing. It also takes the decision ADR-061 listed under *Alternatives considered* as
"a separate decision".

## Context

ADR-061 gave a visually impaired runner's guide a race number of their own on a solo race.
Assign bibs numbers *entries*, so a runner and their guide got one number between them, and the
desk then typed each guide's number into a **Guide's bib** box. ADR-061 left automatic
numbering out because it means choosing which vest a guide gets, and nobody had said.

A maintainer (Bindal) asked on 25 October 2026 for Assign bibs to do it in the same press, so the
desk has nothing to do afterwards. That day is the first of the race-night change freeze, and
the change was taken inside it deliberately.

## Decision

1. **A guide on an entry being numbered gets the number straight after their runner's.** Runner
   `042`, guide `043`, and the next entry `044`. The desk hands over two consecutive vests.
2. **A guide on an entry that already had a number gets the next free number** on the next
   press. That covers a guide added by a late re-import, or one whose number was cleared. The
   number after their runner's is somebody else's by then.
3. **"Never renumbers anybody" is unchanged.** An entry that has a number keeps it. A guide who
   has a number, typed by the desk or given by an earlier press, keeps it. Only a missing number
   is filled in, so a second press with nothing new to number changes nothing.
4. **Every number is still checked against the numbers people are wearing.** The step past an
   override, which ADR-061 added, now lives in one helper, `timing.free_number_from()`, which
   Assign bibs calls for entries and guides alike.
5. **Solo races only.** On a relay, leg 2 is a runner who derives their own bib.
6. **The Guide's bib box stays**, for a guide handed a different vest from the one Assign bibs
   chose.

## Consequences

- **The desk no longer has to remember the guides.** On a race where Assign bibs is pressed
  after the entries are imported, every guide has a number before anybody looks.
- **Entries' numbers are no longer one number apart throughout.** Each guided pair takes two,
  so entry numbers skip one after each guide. Printed vests are handed out by number, so a skip
  costs the desk nothing.
- **The page's message names the guides**, and its range covers their numbers. A press that
  numbers only late guides says so, rather than "nothing was changed".
- **Two helpers are granted to nobody**: `timing.padded_bib()` and `timing.free_number_from()`.
  `add_walk_in()` keeps its own copy of the same step past; folding it onto the helper is tidying
  for after the race, not something to deploy during the freeze.

## Alternatives considered

- **Leave the desk typing guides' numbers** (ADR-061 as written). No deploy during the freeze,
  but a guide left without a number is a guide whose crossing can't be told from their runner's.
- **Number guides after all the entries** (entries `001`–`245`, guides from `246`). Keeps the
  entries' numbers unbroken, but splits each pair across the range, so the desk hands a runner
  and their guide vests from two different piles.

## References

- `platform/packages/db/supabase/migrations/20261025100000_timing_assign_bibs_numbers_guides.sql`
- `platform/packages/db/tests/timing-bibs.test.ts`, the guide block
- [The race-night runbook, step 1.5](../../delivery/runbooks/timing-race-night.md)
