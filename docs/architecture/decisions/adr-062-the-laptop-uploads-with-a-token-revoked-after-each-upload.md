# ADR-062: The laptop uploads with a token limited to one bucket and revoked after each upload

**Status:** Accepted
**Date:** 24 October 2026
**Records:** decision 5 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

Copies reach the bucket from one laptop ([ADR-059](adr-059-photos-are-tagged-on-one-laptop.md)),
which needs a credential that can write to R2. The website needs to read the bucket and
delete from it on a takedown. A storage credential is exactly the kind of secret this
repository is built never to hold, and one sitting on a laptop between races is one that
can be lost with the laptop.

## Decision

**The laptop uploads with an R2 API token that can read and write one bucket and nothing
else, kept outside the repository and revoked after each upload. The Worker reaches the
bucket through a binding and holds no storage credential at all.**

- **The token** has Object Read & Write on `src-race-photos` only. It lives in the `[r2]`
  section of the work folder's `config.toml`, which the tool refuses to keep inside any git
  repository, and the tool never prints it: the settings hide it from `repr()`, and an error
  from R2 is reported by its code alone.
- **It is made for one upload and revoked after it**, by the account holder, following
  [the runbook](../../delivery/runbooks/race-photos.md). The next upload gets a new one.
- **The upload is boto3**, pinned, against R2's S3 API at the EU endpoint with region
  `auto`. Each PUT carries `Content-MD5`, which R2 lists for PutObject, and the ETag it
  answers is checked against it. boto3's newer default checksums are switched off, because
  R2 does not list them for a single PutObject.
- **The Worker uses a binding** (slice 3), which is configuration rather than a secret: a
  binding cannot be copied out of the Worker and used anywhere else.

## Consequences

- **Every upload needs the account holder**, for a few minutes, to make a token and then
  revoke it. That is deliberate: it is the price of no long-lived storage credential
  anywhere.
- **The tests never touch the real bucket.** moto, pinned and installed only for the tests,
  stands in for R2's S3 API (brief §13). What moto cannot prove is that R2 accepts the
  upload; the first real upload is that test, and the runbook says what each refusal means.
- **The tool gained its second and third dependencies**, boto3 and botocore. They are only
  ever installed on the tagging laptop.

## Alternatives considered

- **A long-lived token in the laptop's config.** Rejected. It would sit there between races
  and leave with the laptop.
- **Uploading through the Worker.** Rejected. Every photo would cross the Worker twice, cost
  requests the site shares, and need an upload endpoint the public could find.
- **The standard library instead of boto3.** Considered and declined on 23 October 2026:
  it would mean hand-written request signing, which fails only against the real bucket,
  where boto3 is the mainstream client and its signing is Amazon's.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 5, §9 and §11
- [The race photos runbook](../../delivery/runbooks/race-photos.md): steps 6 to 9
- [ADR-061](adr-061-race-photos-live-in-one-private-eu-bucket.md): the bucket
