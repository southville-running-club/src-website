# ADR-026 — An HTML part joins the outbox emails, and the text stays authoritative

**Accepted**, 31 August 2026.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Relates to** | [ADR-021](adr-021-the-club-tells-people-by-outbox.md) |

## Context

`worker/email.ts` has sent plain text only since the outbox was built, and the reason was
written into the file itself rather than into a record here: an HTML part is a second copy of
every sentence that will eventually disagree with the first, and a text-only message from a
verified domain is about as unlikely to be filtered as email gets — which mattered most for
the one message a runner is waiting for. Nothing else in this repository — no other ADR, no
runbook, no pull request body — mentions the choice at all. It existed in one comment.

A design was then supplied for the four sends: a newsprint skin, one card, one stamp, the
same seven colours and three font stacks throughout. Building it means reopening the question
the comment already answered, on purpose rather than by drifting past it.

### The two original reasons, checked rather than assumed

**The duplication risk is real, and stays real.** Two renderings of the same message are two
places for a sentence to disagree with itself the first time either is edited without the
other. This ADR does not remove that risk — it constrains it: the HTML part is computed from
the same `OutboxMessage` the text part reads (`email-skin.ts`'s `renderEntryEmailHtml()`,
called once per `render()` and passed the identical value every text branch sees), never from
the text output itself, and never carries a fact the text part does not also state. What
still differs between the two is presentation only — a stamp, a facts table, a button — not
which facts are asserted.

**The deliverability risk is smaller than the comment implies.** `send.southvillerunningclub.co.uk`
is a dedicated sending subdomain with its own SPF include and DKIM CNAMEs, isolated from the
club's core mail records (`docs/solutions/resend-programmatic-email.md`). A multipart message
from a DKIM-signed, SPF-aligned domain is ordinary transactional practice, not a marketing
send competing for inbox placement. Keeping the text part the one every existing test reads,
and the one a screen reader or a stripped-down client falls back to, keeps essentially all of
the original benefit regardless.

### A third risk the comment never raised

The design needs a remote banner image, and this repository has already written down the
opposite answer for the club's other HTML email. `packages/db/supabase/templates/confirmation.html`
says, of the one HTML message GoTrue sends: *"Keep this plain. No images, no external CSS, no
tracking pixel. A confirmation mail that loads remote assets trains people to accept exactly
what they should not, and half of the mail clients the club's members use would block them
anyway."* A remote `<img>` fetched by a recipient's client discloses to Cloudflare's own logs
that a message was opened, and when — which is an open-tracker in effect, whether or not one
is intended, on emails the standing brief for this work says should carry no tracking of any
kind.

This ADR does not resolve that tension. It records it, because a decision made without
noticing it exists is worse than one that names the trade-off and proceeds anyway.

## Decision

**The four entry emails carry both a `text` and an `html` part. The text part is
authoritative and is not rewritten by this change** — every sentence, every branch on a free
place, every existing test in `tests/unit/email.test.ts` reads exactly as it did. The HTML
part is additive: a second rendering of the same `OutboxMessage`, built by `email-skin.ts`,
sent alongside the text in the same Resend call.

**No new outbox schema, no new template name, no new trigger.** `entries.email_outbox` stores
no message body of either kind — it is a routing and delivery record — so this is a Worker-only
change. The four existing templates (`entry_confirmed`, `entry_refunded`,
`entry_transferred_out`, `entry_transferred_in`) each gain an HTML rendering; no fifth
template is added.

**The banner is served, not embedded.** An absolute HTTPS URL, hosted from `apps/main/public/`
through the existing static-assets binding — not a base64 data URI, which would blow past
Gmail's 102KB clipping limit on its own, and not inlined otherwise. The image-loading privacy
question raised above is not answered by this ADR; see Consequences.

**Escaping is by hand, not by `worker/html.ts`'s tagged template.** That tag exists for
`/admin/nn` and Prettier reflows its contents on every save, which would silently rewrite the
exact whitespace and quoting a design-fidelity test asserts on. `email-skin.ts` calls the same
`escapeHtml()` function at each interpolation point instead, and is not itself tagged `html`.

**A design-fidelity test stands in for "one sentence, not two."** `email-skin.test.ts` renders
all four sends from fixture data and asserts the seven colours, the three font stacks, the six
sizes, the structural measurements (`width="600"`, the stamp's rotation and offset, zero
corner radius anywhere) and that the wrapper — banner, stamp mechanics, footer — is identical
across all four regardless of which body is slotted in. It does not assert the two parts state
the same facts word for word, because they are not meant to: a heading is not a sentence, and
the point of this decision is that a fact may be presented twice while being *sourced* once.

**Email 4 is unaffected and stays out of scope.** The account "confirm your email address"
message is a Supabase Auth template rendered by GoTrue, not by this file, and changing it means
changing `[auth]` in `config.toml` — a stop-and-ask in this repository regardless of anything
decided here.

**No tracking.** No open pixel beyond the banner's own unavoidable load, no click tracking on
any link, no UTM parameters. These remain transactional mail, and the standing brief for this
work says so explicitly.

## Consequences

**The banner-loading privacy question is open, and it is not this ADR's to close.** Every
recipient whose mail client auto-loads remote images will disclose, to the club's own
infrastructure, that they opened the message and roughly when. Blocked-by-default clients
render a placeholder where the banner should be — expected and harmless, but worth knowing
this design accepts. Whether that trade-off is acceptable for a club that has already ruled
the opposite way for account mail is a question for whoever owns the club's privacy posture,
not a build decision. It is not resolved by shipping the banner; it is accepted by shipping it
without being asked, which is a fact worth someone confirming rather than a silence worth
leaving.

**A new bug class exists that did not before: HTML/text drift.** The regression test that
would catch it — asserting the same fact appears in both parts — is not written, because
`email-skin.ts`'s functions each read `OutboxMessage` directly rather than reading the text
render's output, which makes the two parts structurally unable to diverge on *which* facts
they state, only on how those facts are formatted. A future edit to either renderer that adds
a fact the other lacks will not be caught by any test in this repository today.

**The `entry_transferred_out` HTML omits the outgoing runner's name, deliberately, matching
the text part's own reasoning.** `entrant_first_name` at send time is joined from
`entries.entrants` by `purchase_id` alone, and by the time this message is drained the
transfer has already replaced that row with the incoming runner's. A supplied mockup for this
send showed a personalised greeting; it is not reproduced, because the data behind it would
print the wrong person's name.

**Two facts rows from the supplied design are not built: race distance and number-collection
time and place.** No file in `worker/` imports `race.json`, which is where both facts live,
and `entries.claim_outbox_batch()`'s projection does not carry either. Hardcoding either value
in `email-skin.ts` would be exactly the invented-race-fact this repository forbids in a
template. The confirmation email's call-to-action links to the race-day page instead, which is
where both facts already live and cannot go stale independently of it.
