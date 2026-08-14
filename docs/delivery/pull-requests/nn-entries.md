# Nightingale Nightmare: interest, entry, payment and confirmation

**This is more than should be reviewed at once, and that is a fair criticism rather than a
framing.** Four slices arrived on one branch: the interest form and the `entries` schema, the
entry form, taking money, and confirming it. Each was reviewable on its own and none of them
was offered for review on its own. Subsequent slices will be pushed separately, and the
reading order below is an attempt to make this one tractable rather than an argument that it
is fine.

---

## What it does, in the order it happens

1. **`/nn/` shows one of two forms**, decided per request by `entries.events`, not by a deploy.
   `entries_open_at` is `null` today, so production serves the interest form.
2. **A valid entry holds a place and hands over to Stripe.** One transaction under a per-event
   advisory lock: re-check the window, count the places gone, price it from `entries.fees`,
   write a `pending` purchase with a 31-minute hold. Then a Checkout session for exactly that
   amount and a 303 to it.
3. **`POST /nn/stripe-webhook` moves a purchase to `paid`, and nothing else may.** It verifies
   Stripe's signature over the raw bytes before parsing them.
4. **`/nn/entry/complete/` reports what the club has recorded.** Only `paid` makes a positive
   claim; no state ever makes a negative one.

**Deliberately not done:** no confirmation email, no timing application code, and no real
payment has ever run end to end — `STRIPE_SECRET_KEY` is unset, so production answers 503 and
says so in those words. Registering the Stripe dashboard endpoint is still a human's job,
because it needs the production URL.

---

## Reading order

Six files, in sequence. Each is the one that makes the next legible.

| # | File | Why it is next |
| --- | --- | --- |
| 1 | [ADR-009](../../architecture/decisions/adr-009-entries-in-apps-main.md) | Why entries live in `apps/main` at all. It retired the plan to give them their own repository, and every path below assumes that boundary. |
| 2 | `platform/packages/db/supabase/migrations/20260813094500_create_entries_schema.sql` | Six tables, RLS on every one from its first migration, and the anon role holding no grant on any of them. This is the shape everything else is written against. |
| 3 | `platform/packages/shared/src/nn-entry.ts` | The committee's field list and the only validator. The browser and the Worker run **this same function**, which is why the two can never disagree about what was accepted. |
| 4 | `platform/apps/main/worker/nn-entry.ts` | The request path: which form to show, and what a valid entry does. Read after 2 and 3 and it is mostly wiring; read first and it is not. |
| 5 | [ADR-010](../../architecture/decisions/adr-010-webhook-writes-paid.md) | The three decisions behind the money path, including one the brief did not anticipate. **Read before the code in 6**, which will otherwise look over-built. |
| 6 | `platform/packages/db/supabase/migrations/20260813203000_entries_webhook_confirmation.sql` | `record_checkout_event()` — the key, the state guard, and the transition itself. |

Then, if you read one test, read
`platform/packages/db/tests/entries-capacity.test.ts`: it drives real concurrent connections
and carries a deliberate oversell as its control, so it fails if the lock ever stops working.

---

## The security-relevant decisions

**The anon-executable composition hole, and the key that closed it.** Every other function in
`entries` is safe to grant to `anon` because none can be abused with what it accepts. A
function that writes `paid` is different. The anon key is published in page source by design,
and `create_pending_purchase()` is granted to anon and returns the purchase id *and the amount
it computed*. Two ordinary PostgREST calls with the published key would therefore have bought a
free entry. `record_checkout_event()` is the one function that takes a key.
`ENTRIES_WEBHOOK_KEY` is a **Worker secret**; the database holds only its SHA-256 digest, and
it ships `null`, which refuses everything. `packages/db/tests/entries.test.ts` asserts the exact
set of six functions anon may call, and that a seventh — `raise_attention()` — is granted to
nobody.

**The capacity lock, and why the function is `volatile`.** Overselling is the failure this club
actually had in 2023. Capacity is decided inside `create_pending_purchase()` under a per-event
advisory lock, with `select ... for update`; the `volatile` declaration is what makes the
post-lock read see committed state rather than a snapshot taken before the lock was acquired. A
`stable` function here would be a correct-looking race.

**Expired-but-paid is a flag, not a fifth status.** A payment arriving after the hold lapsed is
never refused: it becomes `paid` — the same value as every other payment — with
`attention = 'over_capacity'` beside it, and it consumes a place. A `paid_over_capacity` status
was the obvious shape and was rejected: the capacity predicate counts `status = 'paid'`, so a
new value would be invisible to it and the oversold place would read as free and be sold twice.
The cost is recorded rather than hidden — "sold out" can now mean "oversold and therefore
closed", and the count of unresolved `over_capacity` rows is exactly how many over the field is.
[The runbook](../runbooks/entries-attention.md) is what a human follows.

**The webhook's failure direction is inverted, and only there.** Everything else in this
repository fails towards taking no money. By the time the webhook runs the money has gone, so
*our* failures answer 5xx and let Stripe retry for three days, and only "this is not Stripe"
gets a 400. A 200 on an outage drops a real payment silently.

---

## Still blocked on the club, not on code

None of it blocks the branch, and everything undecided renders as "to be confirmed" rather than
as a guess:

- **The entry terms.** Not written. The form links to them and the link has nowhere to go yet.
- **The privacy notice's specifics** — the data controller's contact, the address someone
  writes to for removal, and how long the list is kept.
- **Entry open and close times, and the transfer deadline.** `entries_open_at` is `null`, which
  is why production serves the interest form.
- **The free VI guide place cannot be completed.** Stripe refuses a zero-total Checkout session,
  so a guide is told so plainly and given the race address. Fixing it means deciding that an
  unpaid entry counts as paid, which is a committee decision rather than a build one.
- **The 2026 ARC permit number** and **the 2026 race director's name.** Neither appears
  anywhere; the 2023 permit number is not a stand-in.

---

## What to look at hardest

1. **The capacity predicate and the lock**, migration 2 and `entries-capacity.test.ts`. This is
   the one defect that cannot be fixed after the fact: two people cannot be given the same
   place on race morning.
2. **The grant list.** `packages/db/tests/entries.test.ts` asserts exactly which functions
   `anon` may execute. If that test ever needs changing, the change is the review — a
   privilege granted to a key published in page source is the whole of the threat model here.
3. **The webhook's 4xx/5xx split**, `worker/stripe-webhook.ts`. Every branch that answers 2xx
   should be one where the transition is genuinely durable.
4. **`/nn/entry/complete/`'s wording.** No state may make a negative claim. A lapsed hold that
   said "nothing was charged" would be read by somebody whose webhook was merely late, and they
   would pay twice.
5. **The form with JavaScript disabled.** It is the primary path, not a fallback. The
   `no-javascript` Playwright project runs the whole entry suite with scripting off.
