# ADR-068: Runners reach their photos through a private link, and a part read is only ever "Could be you"

**Status:** Accepted
**Date:** 25 October 2026
**Records:** decisions 7 and 8 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

Once the photos are tagged and checked
([ADR-065](adr-065-unsure-photos-are-checked-together-on-the-website.md)), each runner needs
to find theirs. The obvious ways are a public search by bib, which lets anybody see anybody's
photos by typing a number, and runner accounts, which most runners do not have and would not
make for a set of photos. A bib is the only link between a photo and a runner
([ADR-058](adr-058-a-bib-number-is-the-only-link-to-a-runner.md)), and a part read like `12?`
fits ten runners at once.

## Decision

**A runner reaches their photos only through a private link, emailed to the address they
entered with. A part-read photo is "Could be you" to every runner it fits, and is never
anybody's own until a person confirms a whole bib.**

- **The link is a key.** `/nn/<year>/photos/p/<token>/`, where the token is 32 random bytes in
  URL-safe base64. `photos.link` holds only its SHA-256; the Worker hashes the token and asks
  with the hash. One active link per bib per running; a replaced link stops working.
- **Four functions `anon` may call**, because a runner is signed out — `runner_photos`,
  `runner_photo`, `servable_photo` and `photos_ready` — each answering nothing without an
  active link's hash or a published running, and every refusal the same `null`, so a link
  cannot be used to learn whether it once worked.
- **What a page shows.** Their own photos (a confirmed row for their bib), then "Could be you"
  (an unconfirmed row their bib fits, on a photo no longer waiting to be checked), with the
  bib and, once results are published, the finish time. Never a photo taken down, never another
  runner's bib, and no first name until Mark agrees one may be shown.
- **"That's me" opens an email and changes nothing.** So does asking for a photo to be taken
  down. Both go to the race's own reply address, held on its entries record.
- **Every private page sends `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`
  and `X-Robots-Tag: noindex`**, carries no analytics, and answers a bad link with one friendly
  page, never a 500.
- **The images** come from the bucket through the Worker's binding, only once the photos are
  published and never once a photo is taken down, cached for an hour in the viewer's own
  browser with an ETag, and downloadable under their photo ID.

## Consequences

- **No public bib search for 2026**, which is the decision rather than a gap. Somebody without
  their email has slice 5's lost-link form, which sends a new link to the address they entered
  with.
- **A photo taken down can linger for up to an hour in a browser that already had it.** Nothing
  on the pages promises instant removal (brief §14).
- **Every image view is a Worker request**, against the free plan's 100,000 a day shared with
  the whole site, which is why thumbnails load lazily.
- **Whether a runner may look through a spot, and whether the page greets them by first name,
  are still Mark's** (brief §15). Neither is built; both would be additions, not changes.
- **The pages wear the race's look and leave out the club's navigation bar**, as the race pages
  do: its links are coloured for a white page and came out 1.06:1 on the race theme.

## Alternatives considered

- **A public search by bib.** Rejected for 2026: anybody could see anybody's photos by typing a
  number, and a part read would show one runner's photo to ten strangers.
- **Runner accounts.** Rejected: most runners have none, and asking for one to see a few photos
  is a wall rather than a door.
- **Showing a part read as the runner's own.** Rejected (ADR-058): `12?` fits ten people, and a
  photo of one of them in nine strangers' sets is a privacy failure, not a convenience.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decisions 7 and 8, §10, §13 and §14
- `platform/packages/db/supabase/migrations/20261025120000_photos_runner_pages.sql`
- `platform/apps/main/worker/nn-photos.ts`; `platform/packages/shared/src/photos-runner.ts`
- `platform/packages/db/tests/photos-runner.test.ts`;
  `platform/apps/main/tests/worker/admin/nn-photos.test.ts`;
  `platform/apps/main/tests/e2e/nn-photos.spec.ts`
