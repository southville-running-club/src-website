# ADR-059: Race photos are tagged on one laptop, before anything is uploaded

**Status:** Accepted
**Date:** 20 October 2026
**Records:** decision 2 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

A photographer's original files carry more than the picture: where it was taken, the
camera's serial number, and sometimes the photographer's name. The club needs bib numbers
read from every one of them, camera clocks corrected, and copies made, before any of it is
put in front of a runner.

That work could happen in the cloud after an upload, or on a machine somebody in the club
controls before one. A Worker that read photos would need a storage credential and a
vision model key, and image work is heavy for a Worker's per-request CPU limit.

## Decision

**All tagging happens on one laptop, in a Python tool at `tools/photos/`, before anything
is uploaded.**

- **Raw photos never leave the laptop and the photographers' Drive folders.** The tool
  reads them from a work folder and writes copies beside them.
- **The work folder and its config live outside the repository**, and the tool refuses to
  run when the work folder, its config or the folder of originals is inside any git
  repository.
- **The vision model is sent the medium copy only**, with no metadata.
- **The race's bib list reaches the laptop as one column of bib numbers.** A `bibs.csv` with
  any other column is refused rather than trimmed, so names and email addresses never reach
  the tool.
- **Camera clocks are fixed on the laptop**, on a local review page served on 127.0.0.1
  only. Upload refuses while any camera has neither a correction nor a decision to keep its
  time as recorded.
- **Progress is kept in a SQLite manifest in the work folder**, saved after every photo, so
  an interrupted run carries on and a second run adds nothing.

## Consequences

- **One machine holds the originals during tagging.** Bindal's Mac is the tagging laptop
  for 2026. Andrew is the backup and may run the tool on his own machine, which is why it
  supports Python 3.11 and newer rather than only the version on Bindal's Mac.
- **Bib reading is never done on the website.** The website's part (slices 3 to 5) is
  checking the unsure reads together, publishing, and serving the copies.
- **The tool has a dependency the rest of the repository does not**: Pillow, pinned, in a
  virtual environment under `tools/photos/.venv/`.
- **The review page is local**, so checking on the laptop is optional and offline. The
  team's main checking happens on the website, where four people can share one queue.

## Alternatives considered

- **Upload the originals and tag in a Worker.** Rejected. The originals' metadata would
  reach the cloud, the Worker would need a storage credential and a model key, and image
  work is heavy for a Worker's CPU limit.
- **Each photographer tags their own photos.** Rejected. One setup per photographer
  instead of one, and the bib list and model key on every one of their machines.
- **A hosted photo-tagging service.** Rejected. It sends every original to a third party,
  adds a vendor with its own retention terms, and usually charges per photo.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decisions 2 and 9, and §9
- [ADR-058](adr-058-a-bib-number-is-the-only-link-to-a-runner.md): what a photo is linked by
