# ADR-061: Race photos live in one private R2 bucket, in the EU

**Status:** Accepted
**Date:** 24 October 2026
**Records:** decision 4 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

The laptop makes three stripped copies of every race photo
([ADR-060](adr-060-only-stripped-copies-leave-the-laptop.md)), and the website has to
serve them to runners for as long as the club keeps them. They are photos of people, so
where they are stored, who can reach them and for how long are data protection questions
as much as technical ones.

The club already uses R2 for files: Postgres is never the place for them
([principles](../principles.md#files-go-in-r2-never-in-postgres)), and R2's free allowance
charges nothing for reading files out, which is what a page of photos does all day.

## Decision

**One private R2 bucket, `src-race-photos`, created in the EU jurisdiction, with one key
prefix per running.**

- **Private.** No `r2.dev` address and no custom domain. The website reads it through a
  Worker binding (slice 3) and decides per request whether a photo may be shown (slices 3
  and 4).
- **The EU jurisdiction**, so the data stays in the EU. It is chosen when the bucket is
  created and cannot be changed afterwards, so the runbook checks it before the first
  upload.
- **One prefix per running**: `nn-2026/<photo id>/full.jpg`, `medium.jpg` and `thumb.jpg`.
  The photo ID is random, so a key says nothing about who is in the photo, and a running's
  photos can be expired or deleted as a set.
- **A lifecycle rule on the prefix deletes them**, once the committee has decided how long
  photos are kept. Until then there is no rule, and no invented date.

## Consequences

- **Every image a runner sees is a Worker request.** On the free Workers plan the whole site
  shares a daily request allowance, which is why pages load thumbnails lazily (brief §14),
  and which plan the club is on is an open question (brief §15).
- **A takedown is two deletes**: the three objects, and the row the website reads (slice 3).
  The Cache API clears one data centre only, so a removed photo can stay cached for up to
  the hour it is cached for, and copy must not promise instant removal.
- **The bucket must exist before the Worker is bound to it**, or the site's deploys fail.

## Alternatives considered

- **A public bucket or a custom domain on it.** Rejected. Anybody holding a URL could fetch
  any photo, and there would be no way to withhold one before publishing or after a
  takedown.
- **Supabase Storage.** Rejected. It counts against the project's free storage and
  bandwidth, and it would be a second place the club keeps files.
- **A bucket per running.** Rejected for now: one bucket with a prefix per running is one
  token scope, one binding and one runbook. A second bucket can be added if a later race
  needs different terms.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 4, §11 and §14
- [The race photos runbook](../../delivery/runbooks/race-photos.md): making the bucket
- [ADR-062](adr-062-the-laptop-uploads-with-a-token-revoked-after-each-upload.md): how
  copies reach it
