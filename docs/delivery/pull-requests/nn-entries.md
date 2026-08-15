# Nightingale Nightmare: interest, entry, payment, confirmation, the privacy notice and the routes

**This is more than should be reviewed at once, and that is a fair criticism rather than a
framing.** Six slices arrived on one branch: the interest form and the `entries` schema, the
entry form, taking money, confirming it, the privacy notice all of that made necessary, and
the route split between the race and one running of it. Each was reviewable on its own and
none of them was offered for review on its own. Subsequent slices will be pushed separately,
and the reading order below is an attempt to make this one tractable rather than an argument
that it is fine.

**The privacy notice is the part with a deadline attached.** Entries cannot open without it:
the form takes a date of birth, an emergency contact, medical information and a card payment,
and until this branch the notice it links to described a three-field mailing list.

---

## What it does, in the order it happens

1. **The race and one running of it are different pages.** `/nn/` and `/nn/course/` are
   evergreen and name no year; `/nn/2026/` carries the date, the facts and the entry form,
   with race day and spectators beneath it. `/nn/` finds the current running by asking the
   database, so publishing 2027 is a row rather than an edit —
   [ADR-011](../../architecture/decisions/adr-011-a-race-and-its-runnings.md).
2. **Each page shows one of two states**, decided per request by `entries.events`, not by a
   deploy. `entries_open_at` is `null` today, so production serves the interest form on
   `/nn/` and "entries are not open yet" on `/nn/2026/`.
3. **A valid entry holds a place and hands over to Stripe.** One transaction under a per-event
   advisory lock: re-check the window, count the places gone, price it from `entries.fees`,
   write a `pending` purchase with a 31-minute hold. Then a Checkout session for exactly that
   amount and a 303 to it.
4. **`POST /nn/stripe-webhook` moves a purchase to `paid`, and nothing else may.** It verifies
   Stripe's signature over the raw bytes before parsing them.
5. **`/nn/2026/entry/complete/` reports what the club has recorded.** Only `paid` makes a
   positive claim; no state ever makes a negative one.
6. **`/nn/privacy/` says what all of that collects**, in nine sections and three tables, from
   both forms' links. It is written from the schema rather than from the form — see below.

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
| 7 | [ADR-011](../../architecture/decisions/adr-011-a-race-and-its-runnings.md) | Why the routes split, which pages are evergreen and why, what happened to the old addresses, and the one column the split needed. Read last: it moves things 2–6 describe. |

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
set of functions anon may call, and that `raise_attention()` is granted to nobody.

**The seventh anon-executable function, and why it is not a widening.** ADR-011 needed `/nn/`
to find the current running without naming a year, so `entries.current_entry_state()` was
added and granted to `anon` — taking that list from six to seven. It returns exactly what
`entry_state()` returns, for an event the caller could have named itself, since the slug is in
the page's own URL; the test asserts the two answers are **equal**, so a field added to one and
not the other fails. What it adds is that the caller no longer has to know the slug, which is
the thing that would otherwise be written into markup as a year.

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

## The privacy notice, and the one place it departs from what was approved

The committee approved a draft. It is committed at
[`docs/delivery/nn-2026-privacy-notice-DRAFT.md`](../nn-2026-privacy-notice-DRAFT.md), left as
approved, with a table at the top recording exactly what changed in the build and why.

**The departure worth a reviewer's time is the first one.** The draft's "what we collect" table
listed the fourteen fields somebody types. `entries.entry_purchases` also holds the fee and the
amount, Stripe's session and payment-intent references, the consents with their
`consent_version`, and `created_at` / `hold_expires_at` / `paid_at`. None was listed, and none
is typed — so the draft's closing sentence, *"we do not collect anything about you that you
have not typed into the form"*, was not true of the system it described.

Four rows were added to section 2 and one lawful basis to section 3, derived from the tables.
**Nobody approved them**, and they go to the committee with the four open decisions. The
alternative was publishing a notice that under-lists what the club processes, which is a defect
in a notice rather than a conservative choice.

Three smaller corrections, all in the same direction: "and nothing more" about what Stripe
returns was softened (the substance — the club never sees a card — is verified and unchanged);
the Resend line came out, on the draft's own instruction, there being no confirmation email;
and *"We keep everything inside the UK and the European Economic Area"* was **cut rather than
asserted** — nothing in this repository supports it and it sits badly beside naming Stripe, a
US processor, in the same list. That one is the gap the build could not close, and it belongs
with whoever checks this professionally.

**Five claims were checked against the code before any of it was written**, and all five hold:
medical notes are refused rather than silently dropped when the consent box is unticked, then
dropped again at the boundary and a third time in SQL; they live in `entries.entrant_medical`,
so the one-month deletion is a `delete` and not a column-scoped update; no card field exists
anywhere in the schema or the Workers; `eu-west-2` is on record in `packages/db/README.md`.

**The tables are real tables** — `<th scope="col">` and `<th scope="row">` — and two columns at
most. The retention table's third column is folded into the second cell, which loses no words
and was empty in two of its five rows anyway. `table-layout: fixed` and `overflow-wrap` are
what make 320px safe rather than the breakpoint; below 30rem the rows stack and every ARIA role
is restated by hand, because making a `tr` a block is what drops the implicit ones in every
engine.

`nn-privacy.spec.ts` is 12 tests in all three browser projects, including `no-javascript`. The
one to read is **the marker count**: four `null`s in `race.json`, four "To be confirmed by the
club" on the page. Filling one in fails that test until it is updated, which is the moment
somebody confirms the new value came from the committee rather than from a hurry.

---

## Still blocked on the club, not on code

None of it blocks the branch, and everything undecided renders as "to be confirmed" rather than
as a guess:

- **The entry terms.** Not written, and **the checkbox deliberately does not link to them** —
  a consent control pointing at a page that is not there is worse than an honest absence, so
  it carries a hint saying the terms are still to be confirmed. `nn-entry.spec.ts` holds the
  agreements section to exactly one link, which is the privacy notice.
- **The privacy notice's four open decisions** — who somebody writes to about their data, how
  long an entry record is kept, whether an email address is kept to tell people about next
  year's race, and what is true about photographs. All four are `null` under `race.json`'s
  `privacy` key and render "To be confirmed by the club".
- **Four rows of the notice were derived from the schema rather than approved.** The approved
  draft listed what somebody types; the tables also hold the fee and amount, Stripe's
  references, the consents with their version, and three timestamps. Those four rows and one
  lawful basis were written from the schema because a notice that omits them under-lists what
  the club processes. They go to the committee with the four decisions above.
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
4. **`/nn/2026/entry/complete/`'s wording.** No state may make a negative claim. A lapsed hold that
   said "nothing was charged" would be read by somebody whose webhook was merely late, and they
   would pay twice.
5. **The form with JavaScript disabled.** It is the primary path, not a fallback. The
   `no-javascript` Playwright project runs the whole entry suite with scripting off.
6. **Whether `/nn/privacy/` section 2 matches the tables.** Read it against
   `20260813094500_create_entries_schema.sql` rather than against the form. If a column holds
   something about a person and the notice does not name it, that is the defect this section
   was rewritten to fix, and it is the one a reviewer can catch and a test cannot.

---

## How it was verified

`./dev check` and `./dev test`, twice each: **417 unit and database tests, 338 acceptance
tests**, zero axe violations across the six pages, and both documentation link checkers clean.
The acceptance suite drives three browser projects — Chromium, WebKit and Chromium with
JavaScript disabled — against the real Workers runtime with a stubbed Stripe.

**No real payment has ever run end to end.** `STRIPE_SECRET_KEY` is unset, so production
answers 503 and says so in those words.
