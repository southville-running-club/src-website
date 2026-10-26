# ADR-069: Runners are emailed their photo links through the photos outbox, a few a day

**Status:** Accepted
**Date:** 25 October 2026
**Records:** decision 9 of the
[race photos brief](../../delivery/nn-photos-brief.md#2-decisions-already-made-do-not-re-litigate)
**Amends:** [ADR-068](adr-068-runners-reach-their-photos-through-a-private-link.md), on one
point: how a link's token is made

## Context

[ADR-068](adr-068-runners-reach-their-photos-through-a-private-link.md) built the runners'
pages and left them unreachable: they answer only to an active link's hash, and nothing made a
link. Decision 9 is that the photo-admin sends every runner theirs from `/admin/photos/`.

Four facts shape how:

- **An email has to carry the token, and the database may hold only its hash.** So the token
  is made where the email is made, and nowhere else.
- **Sending is retried.** Every outbox here (ADR-021, ADR-032) can send an email and fail to
  record that it did, then try again. Resend's idempotency key stops a second copy only if the
  second request is the same request. A token minted fresh on each attempt makes it a
  different request, and the first email's link dies when the second one's becomes active.
- **About 244 runners, against Resend's 100 a day for the whole account**, shared with every
  race and account email, if the club is on the free tier. The repository disagrees with
  itself about whether it is (`email-outbox.ts` says the club pays; CLAUDE.md, ADR-050 and the
  runbooks say the free tier), which is the treasurer's to settle (brief §15).
- **The race's own outbox must not change how it orders or caps mail** (brief §4), and
  `photos` holds no runner's address (brief §3).

## Decision

**The photo-admin's "Send the links" queues one email per runner into a photos outbox of its
own. A drain sends them, at most a set number of first links a day, and each link's token is
derived from a Worker secret and the outbox row rather than drawn at random.**

- **`photos.email_outbox` holds a bib and a reason, never an address.** The address is read
  from `entries` when the row is claimed, through `photos.recipient_for()`, the one place a bib
  becomes an address: a runner's paid purchase's `purchaser_email`, or a guide's own
  `entrants.email` for a guide's own number (ADR-061, ADR-022). A walk-in has none, and two
  addresses for one bib is nobody rather than a guess.
- **Who gets a first link:** every runner with a photo of their own (a confirmed bib on a
  photo not taken down) and an address. A runner whose only photos are "Could be you" gets
  none, because "We found you in [n] photos" does not fit them; that wording is Kayleigh's to
  supply. **Pressing Send twice queues nobody twice**: one `first:<running>:<bib>` key each.
- **The token is `HMAC-SHA256(PHOTOS_LINK_KEY, "photos-link:" + outbox row id)`**, 43
  URL-safe characters as before. A retry makes the same token, so it is the same request and
  Resend sends it once. The key never leaves the Worker, and the database is told only the hash.
- **A link becomes active only once its email has gone**, in `record_send_result()`, which
  replaces the bib's previous link in the same step. A send that fails never takes a working
  link away.
- **First links go out within `photos.event.daily_send_limit`, 80 by default**, counted over a
  rolling 24 hours. Null lifts it, with an update and no deploy. The send's own nudge sends the
  first batch; the five-minute cron sends the rest, then the next day's.
- **The lost-link form at `/nn/<year>/photos/` answers the same whatever it is given.** A
  well-formed address always gets the brief's sentence ("if that address entered…"). A
  matching one queues a new link, at most three a day per bib. New links are claimed before
  first links and are not counted against the limit: they are few, and somebody is waiting.
- **Three new Worker secrets, none shared:** `PHOTOS_ENTRY_KEY` for the form,
  `PHOTOS_WEBHOOK_KEY` for the drain and `PHOTOS_LINK_KEY` for the links. Both database digests
  ship null. With any of the drain's three missing it does nothing.
- **`nn.photo.send`** is the photo-admin's permission for the button (ADR-066 named it). The
  page shows counts and never a runner or an address.
- **The email is text.** The brief's draft subject and three sentences, the link on its own
  line, and a sign-off, for Kayleigh's sign-off. Its Reply-To is the race's own address, so a
  takedown request by reply reaches the race mailbox.

## Consequences

- **Pressing Send in production is a separate decision**, and Mark's: emailing every runner
  (brief §15). Building the button does not take it.
- **About three days to reach everybody at 80 a day.** If the treasurer confirms a paid plan,
  the limit is lifted with one update.
- **If `PHOTOS_LINK_KEY` is rotated, emails already sent keep working**, because their hashes
  are stored. Only a row being retried across the rotation gets a different link, so rotate
  between sends.
- **Anybody holding `PHOTOS_LINK_KEY` and read access to the outbox could make links.** It is a
  Worker secret like the Stripe and Resend keys, held to the same standard, and the outbox is
  readable by nobody but the database's own functions.
- **Every outbox the club runs is now four**, each drained in the same cron. `/admin/emails/`
  shows the race's only; the photos emails' figures are on `/admin/photos/`.
- **The lost-link form's answer does not vary, but its timing may**: a matching address does a
  little more work. That is accepted for a page whose worst disclosure is "this address ran a
  race", already limited to three requests a day per bib and by Cloudflare's C1 rule.

## Alternatives considered

- **Put the photo emails in the race's outbox.** Rejected: it changes how the race's queue
  orders and caps mail (brief §4), and that outbox stores an address in each row.
- **A random token per attempt, and accept the rare dead link.** Rejected: "the link in my
  email does not work" is the support question this feature exists to avoid, and the fix costs
  one secret.
- **Keep the token in the outbox until it is sent.** Rejected: a token is a key, and brief §3
  says it never appears in a database row.
- **Send to everybody at once and let Resend refuse the rest.** Rejected: on the free tier it
  would also refuse every password reset and race email for the rest of that day.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §2 decision 9, §10, §12 slice 5 and §13
- `platform/packages/db/supabase/migrations/20261025140000_photos_links_and_emails.sql`
- `platform/apps/main/worker/photos-outbox.ts`, `worker/nn-photos.ts` (the form) and
  `worker/admin-photos.ts` (the button); `platform/packages/shared/src/photos-links.ts`
- `platform/packages/db/tests/photos-links.test.ts`;
  `platform/apps/main/tests/worker/admin/nn-photos.test.ts` and `photos.test.ts`;
  `platform/apps/main/tests/e2e/nn-photos.spec.ts`
- [The race photos runbook](../../delivery/runbooks/race-photos.md), steps 14 to 17
