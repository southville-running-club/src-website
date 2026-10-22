# ADR-060: Only stripped copies of a race photo leave the laptop

**Status:** Accepted
**Date:** 20 October 2026
**Records:** decision 3 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

A JPEG straight off a camera or a phone carries an EXIF block, and often XMP, IPTC and a
comment as well. Between them those hold GPS coordinates, the camera body's serial number,
the owner's name, editing history and a thumbnail of the original. None of it is needed to
show a runner a photo, and some of it identifies the photographer.

The obvious fix, deleting the fields known to be sensitive, fails the first time a camera
writes one nobody listed.

## Decision

**The laptop makes three copies of each photo and only those copies are uploaded.**

- **Three sizes, JPEG:** full (2,400 px long edge), medium (1,200 px) and thumbnail
  (480 px). A photo is never enlarged to reach a size.
- **Orientation is applied first**, then every metadata block is removed. Stripping first
  would leave portrait photos on their side.
- **An allowlist, not a denylist.** Each copy is written from a fresh image that carries
  nothing over, and then checked: a copy may hold a JFIF header, one colour profile and the
  picture, and nothing else. A copy that holds anything else stops the tool rather than
  being uploaded.
- **Colour is converted to sRGB.** A photo with an embedded profile is converted and given a
  generic sRGB profile, so no bytes of the camera's profile survive. A photo with no profile
  is treated as sRGB and gets none.
- **The time taken survives only as a value**, in the manifest now and as a database column
  from slice 2, after the camera's clock has been corrected.
- **The camera serial is read only to group photos by camera** for the clock fix. It is
  hashed together with the make and model into a camera key in memory, and the serial
  itself is never stored, uploaded or written to SQL. A camera that records no serial is
  keyed by the photographer's credit, make and model instead.

## Consequences

- **A runner who downloads their photo gets a picture and a colour profile.** No location,
  no camera, no photographer's name in the file. The credit is shown on the page instead,
  from data.
- **The copies are generated on the laptop's CPU**, and the tool reports their actual sizes
  against the targets of about 1 MB, 300 KB and 50 KB.
- **Pillow's JPEG writer keeps a source image's comment by default.** That is why each copy
  is written from a fresh image and checked afterwards, rather than trusting a save
  argument; the check is what catches the next default nobody knew about.
- **A photo with no recorded time is still copied and uploaded**, without a time. It cannot
  be placed in a burst.

## Alternatives considered

- **Upload originals and strip when serving.** Rejected. The originals' metadata would sit
  in the bucket, and every image view would cost Worker CPU.
- **Keep EXIF but remove GPS and serial.** Rejected. It is a denylist, and the next camera
  adds a field it does not name.
- **Cloudflare Images for resizing.** Rejected for 2026. It would still need the originals
  uploaded, and it is one more product to set up and pay attention to.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 3, §9 steps 3 and 4,
  and §14
- [ADR-059](adr-059-photos-are-tagged-on-one-laptop.md): where the copies are made
