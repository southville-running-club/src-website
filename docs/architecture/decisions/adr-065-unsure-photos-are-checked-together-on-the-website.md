# ADR-065: Unsure race photos are checked together on the website

**Status:** Accepted
**Date:** 24 October 2026
**Records:** decision 11 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

The laptop tags every photo whose bib it can read with confidence, and marks the rest for a
person: `needs_check` for a read it was unsure of, `part_read` for a number it could only read
part of (`12?`). After a race that is a few hundred photos, and the laptop's own check screen
([ADR-059](adr-059-photos-are-tagged-on-one-laptop.md)) puts all of them in front of one
person at one keyboard. Four volunteers (Bindal, Andrew, Adrian and Ross) offered to share the
work, from whatever computer, tablet or phone each has, on the evening after the race.

Sharing a queue between four people has three ways to go wrong: two people deciding the same
photo, a photo nobody gets to because somebody opened it and walked away, and a decision
nobody can account for or take back.

## Decision

**The unsure photos are checked together at `/admin/photos/check/`, one shared queue, by
anybody holding `nn.photo.check`
([ADR-066](adr-066-two-narrow-roles-for-race-photos.md)).**

- **Each checker gets the next photo nobody else has open, held for them for ten minutes.**
  `photos.next_photo()` takes it with `for update skip locked`, so two checkers asking at the
  same moment get two different photos, and a hold that runs out frees the photo for the next
  person. A reload gives the same photo back rather than a second one.
- **Every decision records who made it**: confirm a bib from the buttons, type a different one
  (or several, for a photo with several runners), keep a part read as "Could be you", no bib
  visible, skip, or take the photo down. Each decision is a row in `photos.decision` holding the
  photo's state before and after it, and **the person who made it can undo it** while nothing
  about the photo has changed since.
- **The first decision wins.** A checker whose hold ran out and who submits after somebody else
  is told so and changes nothing; the same decision made twice — a resubmitted form, a double
  tap — changes nothing and says so.
- **A decision marks bib rows and never deletes them.** A read set aside keeps a `dismissed`
  flag with the checker's account on it. The laptop's SQL file never touches a row a person
  decided ([ADR-064](adr-064-tags-reach-the-database-as-a-sql-file-run-by-hand.md)), so a
  deleted read would come back on its next run as "Could be you"; a dismissed one cannot.
- **Publishing waits until nothing is left to check.** "Left to check" is one statement,
  `photos.is_unsure()`, read by the queue, the progress figures and the refusal in
  `photos.publish()` alike, so the number on the page and the number that refuses cannot drift.
- **The page is the laptop's, made for many hands**: one photo, large, the bibs that fit as
  numbered buttons (from the race's own roster), the same keys as the laptop's check screen, and
  buttons big enough for a thumb. Every control is a submit button, so it works by touch and with
  scripting off; the keys only press them.

## Consequences

- **Photos where the laptop saw no bib are not in the queue**, and so do not hold up
  publishing. They can still be found through a spot (slice 4) by somebody looking for
  themselves.
- **A checker's account id is held against each decision**, in `photo.checked_by`,
  `photo_bib.decided_by` and `photos.decision`. These are staff, and nothing about a runner is
  held: the schema still holds no runner's name or email address.
- **Slice 4 must read the marks**: a confirmed row is a runner's own photo, an unconfirmed row
  that is not dismissed is "Could be you", and a dismissed row is shown to nobody.
- **There is no unpublish.** A photo that should not be seen is taken down; withdrawing a whole
  running's photos is a decision nobody has asked for yet.

## Alternatives considered

- **Check everything on the laptop.** Rejected: it is one person at one keyboard for a few
  hundred photos, the evening after a race, with three volunteers offering to help.
- **A queue with no holds, first to submit wins.** Rejected: four people would be shown the same
  photo at the same time and three of them would waste the look.
- **Deleting a dismissed read.** Rejected for the reason above: the laptop's next SQL file would
  put it back.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 11, §8, §10 and §13
- `platform/packages/db/supabase/migrations/20261024120000_photos_check_queue.sql`
- `platform/packages/db/tests/photos-check.test.ts`;
  `platform/apps/main/tests/worker/admin/photos.test.ts`
- [The race photos runbook](../../delivery/runbooks/race-photos.md), steps 10 to 13
