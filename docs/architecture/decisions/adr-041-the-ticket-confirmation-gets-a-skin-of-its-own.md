# ADR-041 — The ticket confirmation gets a skin of its own, and the text stays authoritative

**Accepted**, 13 September 2026.

| | |
| --- | --- |
| **Requirement** | [C15](../../foundations/requirements.md#c15--sell-merchandise-and-tickets) |
| **Relates to** | [ADR-021](adr-021-the-club-tells-people-by-outbox.md), [ADR-026](adr-026-an-html-part-joins-the-outbox-emails.md), [ADR-032](adr-032-an-email-is-sent-when-it-is-owed.md), [ADR-033](adr-033-a-ticket-is-not-an-entry.md) |
| **Supersedes** | Nothing. It **completes** the change [ADR-033](adr-033-a-ticket-is-not-an-entry.md) deferred when it said ticket mail was *"plain text for now"* and *"a ticket skin is a separate change"* |

## Context

`store` shipped on 5 September 2026 sending two plain-text messages: `ticket_confirmed` when a
payment is recorded, `ticket_refunded` when one is reversed. ADR-033 listed `email-skin.ts`
among the things it deliberately did **not** reuse, and the reason was specific: ADR-026's skin
is written against a race entry — a reference, an entrant, a race date — and giving it a second
shape to branch on is how a design system starts branching on which caller it has.

That ruled out *reusing the race skin*. It did not rule out a skin; the same paragraph called
one "a separate change". A design has now been supplied for the confirmation — a landscape
recomposition of the party poster, a two-by-two ticket stub, a perforated tear line, bunting
above and below — so this is that separate change being made.

**The Christmas party goes on sale on Friday 18 September**, which is what makes the timing
deliberate rather than opportunistic: the confirmation is the ticket, and the first one the club
sends should be the one it means to send.

## Decision

**A second skin, `apps/main/worker/ticket-email-skin.ts`.** `email-skin.ts` is untouched and
still knows nothing about a ticket. The two files share a repository and no code.

**The text part is unchanged and stays authoritative**, exactly as ADR-026 has it for the race.
`renderTicketEmailHtml()` reads the same `TicketOutboxMessage` that `ticketEmailBody()` reads and
never that function's output, so the two can differ in presentation and can never differ in which
facts they state. Where a fact needs formatting, both call the same function — `ticketEmailDate()`
for the day, `formatPence()` for the money, `formatEntryReference()` upstream for the reference —
which is why that first one became an export rather than being written a second time.

**Only the confirmation.** `ticket_refunded` returns `null` from the skin and sends as text
alone. No cancellation treatment was supplied, and inventing one to sit beside a supplied
confirmation is a decision for whoever owns the design rather than for the file rendering it. A
`null` is a state the drain already handles, so nothing breaks and nothing is guessed.

**The banner is attached, not hotlinked** — ADR-026's answer to the same question, applied here
rather than re-argued. A remote `<img>` in an email is an HTTP request the reader's client makes
when they open it, and there is nothing the club wants to learn from one. It also means the
artwork appears on first open rather than behind a "display images" prompt, which is most of the
value of having artwork at all. The supplied template used an `https://` reference; this is the
one place the implementation departs from it, and the reason is the club's own recorded position
on open trackers.

**Which artwork, by slug, in a constant** — `SOCIAL_BANNERS` in `store-outbox.ts`. A social
already needs its own content page and is therefore already a deploy, so the artwork arriving in
the same commit costs nothing that was not already being paid. This is the same trade `SITE_NAV`'s
submenu takes, and the alternative is a file path in a database column that nothing validates,
failing as a broken image in somebody's inbox rather than as a missing file at review. **A slug
that is not in the map gets no banner and still gets its email.**

**The start and end times join the card**, which the supplied design did not have. A ticket
bought in September is read again in December by somebody working out when to turn up, and the
club holds the answer in a column already — `7:30pm–1am`, rendered by the same
`formatSocialTimes()` the page uses, so the two cannot disagree. This is the only thing added to
the design rather than transcribed from it.

## Consequences

**`store.claim_outbox_batch()` returns three more columns** — `venue`, `start_time`, `end_time`
— because the Where cell and the times line need them and the text part never did.
`20260913210000_store_outbox_venue_and_times.sql` drops and recreates the function, which
`create or replace` cannot do when a return type changes (`42P13`), and re-grants execute to
`anon` and `authenticated` in the same migration. **Nothing new is collected and nothing new is
held**: all three columns were supplied on 5 September and are already on the party's own page.

**The rollback direction is covered.** The Worker parses the claimed row with a non-strict Zod
object and the three new keys are `.nullish()`, so a Worker that predates the migration ignores
the wider row, and a Worker that postdates it meets a narrower row and drops three facts from one
message rather than refusing the whole batch. Roll the code back, roll the schema forward.

**`fetchBannerAttachment()` moved to `email-attachment.ts`** and takes the file, the MIME type
and the content id as an argument. Two callers needing the same reader is where one copy becomes
the right answer; the alternative was `store-outbox.ts` importing from the race's email module,
or a second `base64` loop with its own reason to be written the way it is.

**The design is asserted rather than reviewed by eye**, which is ADR-026's practice and matters
more here: an HTML email cannot be opened in a browser the way a page can, so nothing in the
ordinary loop looks at it, and every property it promises is invisible until somebody has already
been sent one. `tests/unit/ticket-email-skin.test.ts` covers the facts it states, that it states
none the text does not, that no `{{placeholder}}` survived the port, that a name written to break
out of the markup cannot, that a missing date or venue reads as an honest non-answer rather than
as `null`, that the image is left out entirely when the file cannot be read, and that the garland
and tear line are table cells rather than images.

**Escaping is the load-bearing one.** A purchaser's name is free text somebody typed into a form,
and this file builds strings with template literals rather than through `worker/html.ts`'s tag —
so nothing escapes on the author's behalf and every interpolation calls `escapeHtml` explicitly.

**Resend's daily cap is unchanged** and so is the message count. An attached 158KB JPEG makes
each confirmation larger; nothing about the free tier's 100-a-day limit counts bytes.

## What was considered and rejected

**Widening `email-skin.ts` to render both.** The thing ADR-033 ruled out, for the reason it
gave. Two skins that share nothing are cheaper to hold in the head than one that branches.

**A hosted banner URL, as the supplied template had it.** Rejected on ADR-026's open-tracker
ground, above.

**A `banner_path` column on `store.socials`.** Rejected: a path in a column is validated by
nothing, and its failure mode is a broken image in a paying member's inbox.

**Giving `ticket_refunded` a treatment too.** Deferred, deliberately and visibly, rather than
designed here. It is the same shape of deferral ADR-033 made about this file, and it should be
closed the same way — with a design, by whoever owns one.
