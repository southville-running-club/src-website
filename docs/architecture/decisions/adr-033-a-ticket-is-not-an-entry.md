# ADR-033 — A ticket to a club social is not a race entry, and gets its own schema

**Accepted**, 5 September 2026.

| | |
| --- | --- |
| **Requirement** | [C15](../../foundations/requirements.md#c15--sell-merchandise-and-tickets) |
| **Relates to** | [ADR-009](adr-009-entries-in-apps-main.md), [ADR-010](adr-010-webhook-writes-paid.md), [ADR-011](adr-011-a-race-and-its-runnings.md), [ADR-021](adr-021-the-club-tells-people-by-outbox.md), [ADR-029](adr-029-holding-a-place-takes-a-key.md), [ADR-030](adr-030-an-entry-has-a-reference-somebody-can-read-out.md) |
| **Supersedes** | Nothing. It **adds the `store` schema**, an `/events` section, and a second Stripe webhook endpoint |

## Context

The club sells tickets to its socials — the Christmas party is the biggest — and has always
done it through Squarespace commerce, which takes a transaction fee on top of card processing.
Moving that is [Phase 5](../../delivery/phases.md#phase-5--the-new-website) work. This is the
first piece of it: an `/events` section, and one ticketed occasion under it.

**The obvious implementation is a row in `entries.events`.** Everything a ticket needs looks
like it is already built — a window, a price, Checkout, a webhook that writes `paid`, an
outbox that tells somebody. Reusing it would have been a day's work instead of a week's.

It is the wrong answer, and the reason is a fact about the schema rather than a matter of
taste.

## Decision

**A ticket lives in a new `store` schema, with its own tables, its own keys, its own webhook
endpoint and its own outbox.** `entries` is not touched.

### Why not `entries`

`entries.entrants` requires four columns, all `not null`:

| | |
| --- | --- |
| `date_of_birth` | So an age category can be awarded |
| `gender` | The category the club publishes results by |
| `emergency_contact_name` | Somebody is running 10km off road in the dark |
| `emergency_contact_phone` | The same |

Each was argued for individually and each is in the committee-settled field list at
`packages/shared/src/nn-entry.ts`. **A party ticket needs none of them.** So reusing `entries`
meant one of exactly two things:

* **Collect them anyway** — ask somebody buying a £12 party ticket for their date of birth and
  their next of kin. That is a straight breach of *personal data is minimised at the boundary*,
  and it is the kind of breach that looks like good engineering while it is happening.
* **Make the four columns nullable** — which removes, from the live race path, during the entry
  window, the constraints that guarantee every row on a start list has an emergency contact.

Neither is worth a week saved. `entries.events` compounds it: `race_slug`, `event_date`,
`start_time`, `capacity` and `consent_version` are all `not null`, and a party has no race.

### Why it is called a social, and the page is still called Events

**The glossary reserves *event*** — "one running of one race in one year: Pass the Buck 2026".
A Christmas party is not a running of a race, so it may not be an event in the schema however
convenient the word is. `store.socials` is what a running club actually calls the thing.

**The public word is still "Events"**, because `/events` is the address the old Squarespace
site published and Phase 5 keeps its paths, and because that is what a member reads. The
navigation bar has read "Race timing" over an app called `apps/timing` since it was written;
this is the same split one layer down.

### What is reused, and what is deliberately not

Reused, because these are genuinely the same problem:

* **`worker/stripe.ts`** — already generic. It takes a purchase id, an amount and two URLs.
* **`worker/stripe-signature.ts`** — signature verification over raw bytes.
* **`formatEntryReference()`** — one function renders a reference to text, for the reason its
  own header gives. A second implementation is the defect, not the reuse.
* **`formatPence()`** — the same, for money.
* **The outbox *mechanism*** — ADR-021's shape: the obligation written in the same transaction
  as the thing it is about, delivery separate and retryable.

Not reused:

* **`email-skin.ts`.** ADR-026's HTML skin is written against a race entry — a reference, an
  entrant, a race date. Giving it a second shape to branch on is how a design system starts
  branching on which caller it has. Ticket mail is plain text for now, which is the part that
  was authoritative in both anyway. A ticket skin is a separate change.
* **`entries.webhook_secrets`.** `store` holds its own digests, so a compromise of the party
  ticket path is not a compromise of the race payment path, and a rotation of one does not
  close the other. A Stripe webhook endpoint is configured per URL with its own signing secret
  regardless, so `/events/stripe-webhook` could not have shared `/nn/`'s even if sharing had
  been wanted.

### The rules carried over without being re-argued

Each of these was learned expensively on the race path and is applied here from the first
migration rather than after an incident:

* **Holding a ticket takes a key** — ADR-029. `store.create_pending_purchase()` is granted to
  `anon` and holds tickets before money moves, so without a second factor a loop with the
  published anon key takes the whole party for nothing. `entries` shipped that hole and closed
  it four days later; this does not ship it.
* **The webhook is the only writer of `paid`** — ADR-010, including the inverted failure
  direction: our failures answer 5xx and let Stripe retry, and only "this is not Stripe" gets a
  400.
* **A payment that arrives after the hold lapsed is still `paid`**, flagged rather than
  refused. There is no fifth status, because the capacity predicate counts `paid` and a new
  value would be invisible to it.
* **Every unconfirmed fact is a nullable column, never a placeholder in markup**, and null is
  read as *not confirmed* rather than as *no constraint*.
* **A total of zero is refused** — Stripe will not create a zero-total session, so a free
  ticket would hold a place and then fail at the session call with the place still held.

## What this deliberately does not build

Stated so nobody goes looking, and so the next slice knows what it is picking up.

**No admin surface.** Reading who holds a ticket wants an eleventh permission, and
[CLAUDE.md](../../../CLAUDE.md) makes that a stop-and-ask. Until it is taken, the record of who
is coming is the outbox and Stripe's own dashboard. This is the biggest gap, and it is the
first thing to build next.

**No cancellation or refund path.** `store.record_checkout_event()` writes `paid`; nothing
writes `refunded`. The `ticket_refunded` template and its trigger branch exist and are tested,
so the mechanism is ready for the function that will use it.

**No per-attendee names.** A purchase carries a name, an email address and a quantity. A door
list by name is a field beyond what is specified and therefore a committee decision.

**No dietary requirements.** The 2025 party page collected them at booking. An allergy is
health data and a religious diet reveals belief, so both sit under Article 9 — they would need
an explicit condition, a retention period, and items added to both privacy notices before one
could be stored. **The confirmation email asks for them by reply instead**, which puts the
answer in a mailbox the club already runs. `tests/unit/events.test.ts` asserts that no dietary
field reaches the order however it is posted.

**No completion page that reports state.** `/events/<slug>/complete/` makes no claim about the
payment in either direction. Reporting the recorded state would mean an eighth anon-callable
function, and the confirmation email covers the same ground for a ticket. **If that page ever
does report state, the race's rule comes with it**: only a recorded payment may make a positive
claim, and no state may ever make a negative one — a page that says "nothing was charged"
because the webhook is late sends somebody to pay twice.

## Consequences

**A second payment path exists, and it is genuinely separate.** Three new Worker secrets
(`STORE_ENTRY_KEY`, `STORE_WEBHOOK_KEY`, `STORE_STRIPE_WEBHOOK_SECRET`), a second Stripe
endpoint to register by hand, and a second thing to rotate. That is the cost of the blast
radius being small, and it is the right way round while race entries are live.

**`store` is exposed through PostgREST**, added to `[api].schemas` in the same change that
creates it — `identity`'s precedent exactly. Every table has RLS on and neither `anon` nor
`authenticated` holds a grant on any of them, which `packages/db/tests/store.test.ts` asserts
on all five tables and both verbs, by error code. That assertion is what makes exposing the
schema safe rather than merely intended.

**Seven functions are callable by `anon`**, named exactly in that test. An eighth is a decision
somebody takes in a diff — the mechanism `entries.test.ts` already provides, and whose own
count has changed three times.

**The 2026 party publishes only what has been supplied.** At the time this record was written
the row held every fact null; later the same day a club volunteer confirmed **Saturday 12
December 2026 at The Cock & Tail**, booked since January, and those two are now set. The start
time, the age limit and the price are not, and **the 2025 page is not a source for them** — it
ran 7:30pm–1am at £12 and 18+, none of which is a fact about 2026.

There is still no ticket type, so `sales_open_at` and the absent price remain separately
sufficient to keep the form hidden. **That this was one `update` in one dated migration, with no
deploy and no markup touched, is the property the whole arrangement was for** — and it was
exercised within a day of being built.

⚠️ **`STORE_ENTRY_KEY` must be installed and verified before `sales_open_at` is ever set.** The
other order is a ticket window that is open and unprotected. See
[the runbook](../../delivery/runbooks/events-tickets.md).
