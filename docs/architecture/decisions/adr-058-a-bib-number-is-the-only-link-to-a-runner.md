# ADR-058: A bib number is the only link between a photo and a runner

**Status:** Accepted
**Date:** 20 October 2026
**Records:** decision 1 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)

## Context

Volunteer photographers take photos at Nightingale Nightmare. The club wants each runner to
find their own photos without searching for them, which means something has to decide
which runner is in which photo.

There are four signals that could do it: the number on a runner's bib, the runner's face,
the time they crossed a timing point, and what they were wearing. Only the first is
something the runner was given by the club in order to be identified, and only the first is
already in the club's records as a plain value.

## Decision

**A photo is linked to a runner by a bib number read from the photo, and by nothing else.**

- **No face recognition, and no face detection either.** Not to match, not to group, not to
  crop. No library that finds faces is installed, even for a purpose that sounds harmless.
- **No matching by finish time.** A photo taken near the line at 11:52 is not linked to
  whoever the timing app says finished at 11:52.
- **No matching by clothing or colour.**
- **A bib that is only partly readable stays partly read** (`12?`). It is shown as "Could
  be you" to every runner whose bib fits, and is never in anybody's own set until a person
  confirms it.

## Consequences

- **A runner whose bib was hidden is not found in that photo.** That is accepted. Those
  photos are still copied and uploaded, and whether a runner may look through the photos
  from one spot is Mark's decision for slice 4.
- **Reading is done by a vision model asked only for digits.** It is asked for the digits on
  any race bibs and a confidence for each, and for nothing about the people. Its answers are
  checked against the race's bib list, which reaches the tool as one column of bib numbers.
- **Nothing in the photo pipeline creates biometric data.** Face templates used to identify
  somebody are special category data under UK GDPR Article 9. Not making them removes the
  explicit-consent question, the retention question and the vendor question in one move.
- **Unsure reads are checked by people**, on the laptop or together on the website. That is
  slower than a cleverer matcher and it is the point: a wrong match sends a photo of one
  person to another.

## Alternatives considered

- **Face recognition, with or without a bib.** Rejected. It identifies people from their
  bodies, needs every runner's explicit consent, and would be a second, more sensitive
  record of everybody who ran.
- **Finish-time matching from the timing data.** Rejected. Most photographers are not at the
  finish, camera clocks drift, and it ties every photo to a timing record that is a separate
  disclosure decision (ADR-043).
- **Clothing or colour matching.** Rejected. It is unreliable, and it is a profile of
  somebody's appearance.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decisions 1 and 8, and §14
- [ADR-043](adr-043-a-published-result-carries-a-name-a-category-and-a-time.md): what a
  published result may carry
