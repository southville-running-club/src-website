# ADR-063: Tags reach the database as a SQL file run by hand

**Status:** Accepted
**Date:** 24 October 2026
**Records:** decision 6 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

Once the copies are in the bucket, the database needs a row per photo and per bib read, so
the website can show runners their photos and the team can check the unsure reads. The
laptop holds all of that in its manifest. Something has to carry it into the `photos`
schema, and the obvious ways to do that all need a credential that can write to the
database from outside it, which this platform does not issue: the service-role key never
leaves Supabase, and nothing here has an import endpoint.

## Decision

**The laptop writes SQL files, and a volunteer runs them in the Supabase SQL editor, the
way the race's own one-off SQL is run.**

- **Every read goes in, checked or not.** A confident whole bib is confirmed; a part read
  or an unsure read goes in unconfirmed, for the website to show as "Could be you" or to
  put in front of a checker. A read a person rejected, and one with no digit at all, is
  left out. Hidden photos are never included.
- **Running a file twice leaves exactly the same rows.** Every write is an upsert whose
  update is skipped when nothing has changed, so a second run does not even move
  `updated_at`. A volunteer unsure whether they ran a file runs it again.
- **It never overwrites the website.** Once a photo has been checked there
  (`photo.checked_by`), its state is left alone; a bib a checker decided
  (`photo_bib.decided_by`) is neither updated nor deleted; and a takedown (`hidden_at`) is
  never written. What the laptop owns it keeps current: the credit, the spot, the
  corrected time and the burst, which it works out again on every run.
- **In parts**, each one transaction. The editor documents a one-minute timeout and no size
  limit, so a part is far smaller than a minute's work.
- **Pinned by a golden file.** The tool's tests assert the writer's exact output for six
  invented photos, and the database tests run that same file against Postgres twice and
  after a simulated website decision. So the writer and the schema cannot drift apart
  without a test going red.

## Consequences

- **Loading tags is a hand step**, written down in
  [the runbook](../../delivery/runbooks/race-photos.md) with what to do when a part fails.
- **The schema's own constraints are the check on the file**: a malformed short ID, a part
  read marked confirmed or a second active link is refused by the database, and the whole
  part rolls back.
- **The website's slices must keep the bargain.** Anything the website decides has to set
  `checked_by` or `decided_by`, or a rerun of the file will treat it as the laptop's.

## Alternatives considered

- **An import endpoint on the Worker.** Rejected. It would be a public address that writes
  photos and needs a key of its own, for an upload done a few times a year.
- **A script holding the service-role key.** Rejected. The service-role key never leaves
  Supabase (principles), and wanting it is the sign that a policy is wrong.
- **One file holding everything, with no idempotence.** Rejected. A volunteer would have to
  know exactly what had already been run, which is the thing nobody remembers on a Sunday
  night.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 6 and §8
- `tools/photos/racephotos/sqlfile.py` and its tests;
  `platform/packages/db/tests/photos.test.ts` and `tests/fixtures/photos-golden.sql`
- [ADR-062](adr-062-the-laptop-uploads-with-a-token-revoked-after-each-upload.md): the upload
  that comes first
