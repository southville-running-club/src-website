# Working in this repository

The Southville Running Club platform. Two volunteers with day jobs maintain all of it, and
that single fact decides most of what follows.

---

## Before anything else

**Read [`docs/architecture/principles.md`](docs/architecture/principles.md).** It is short,
it is the part that is not under discussion, and it ends with the triggers that mean _stop
and ask a human_. Everything below assumes it.

Then, if you are writing code, [`platform/README.md`](platform/README.md).

---

## Stop and ask — do not resolve these by inference

These end the task. Say what you have found and wait. Guessing is worse than pausing,
because a wrong guess here is expensive in money, in law, or in a race that cannot be
re-run.

- **A factual claim about a race** that has not been supplied — date, price, distance,
  location, start time. **The trigger that is actually still live here is one column:
  `entries.events.entries_open_at`.** Almost everything else this bullet used to guard is
  now confirmed and quotable — read on for what and where — so do not let the length below
  suggest more is still open than really is. The Nightingale Nightmare date _is_ confirmed — **Sunday 1 November
  2026, start 11:00** — along with the distance, the race HQ, the schedule, the prizes and
  the spectating points; all of them live in `apps/main/src/content/race.json`. **The entry
  fees are confirmed too** — **£18 affiliated, £20 unaffiliated** since 24 August 2026, £0 for
  a visually impaired runner's guide — and they live in `entries.fees`, never in markup. **The
  £2 gap is ARC's, not the club's**: it is the Unattached Runner Levy the promoter must impose
  under Rule 21(2)(b) and remit to ARC within 30 days under 21(2)(c), so the club nets £18
  either way — decision 006. **So is the minimum age: 18 on race day**, in
  `entries.events.minimum_age`. **The 2026 ARC permit number is confirmed and published** —
  **`ARC/26/0842`**, issued 27 August 2026 — and it lives in `race.json`'s `permit`, never in
  markup. ARC require it on entry forms and advertising material, so it is quoted **three
  times**: the facts list on `/nn/2026/`, the foot of the entry form, and — since #142 —
  `/nn/2026/terms/`, where it is part of the race director's own copy. The first two are the
  two ARC ask for. It is **year-scoped like the date** and may not appear on `/nn/` or
  `/nn/privacy/`. **`site.spec.ts` asserts that only for `/nn/`**, not for `/nn/privacy/` —
  the rule is real and the guard is narrower than it reads. Note also that
  `/nn/privacy/` says the words _"ARC permit"_ in prose, deliberately, so it is the _number_
  that is year-scoped rather than the phrase. The 2023 number is still not a substitute for any future year's. **Still
  unconfirmed, and it may not appear anywhere:** the 2026 race director's name. **The
  transfer deadline is confirmed** — **3pm on 16th October** — supplied by the race director
  on 28 August 2026 with the entry terms, and it lives in `race.json`'s `transferDeadline`,
  read only by `/nn/2026/terms/`. It is a _date_, not a mechanism: `transfer_entry()`
  enforces nothing about it, and no code anywhere reads it.
  **The entry window is ratified now** — agreed by the committee over
  WhatsApp on **Monday 24 August 2026**, the same day the race director proposed it —
  **opens Tuesday 1 September 2026
  07:00 BST, closes Friday 30 October 2026 17:00 GMT** — and it is published on `/nn/2026/`
  from `race.json`'s `entriesOpen`. The clocks go back between the two, so they do **not**
  share a UTC offset: 06:00Z and 17:00Z. **Ratifying the window is not opening it, and the two
  halves are in different states on purpose.** `entries_close_at` is applied and is inert on
  its own — `entry_state()` tests `entries_open_at is null` as an explicit branch before it
  compares anything, so a null open date means _never opens_ rather than _no lower bound_.
  ⚠️ **`entries_open_at` is set and the race is selling — this file said otherwise until
  7 September 2026, and that staleness was read and reported from.** Confirmed against
  production that day: `GET /nn/2026/places-remaining/` answered
  `{"capacity":250,"remaining":140}`, so **110 places were sold**, and `/nn/2026/` serves the
  entry form rather than the interest form. Everything that gated the window is therefore
  done — the live Stripe keys, the webhook digest verified by a real signed event, and
  `ENTRIES_ENTRY_KEY` installed. **The exact date each was performed is not recorded here**;
  only that all of them were, because the window could not have opened otherwise.

  **The lesson is the one `apps/main/README.md`'s own step 1 already carries**: _"a status
  column nobody revisits is worse than no status column"_. Four rows in that table and this
  paragraph all said "pending" about things that had been live for days, and an agent asked
  what was left to do answered from them. So the _times_ are quotable
  anywhere; the _column_ is a stop-and-ask. Do not invent a fact, do not infer one from a phase
  document, and do not put a plausible placeholder in markup.

- **Collecting a field beyond what is already specified.** **Trigger: a field not already in
  `packages/shared/src/nn-entry.ts`.** The list below is the history of how it grew to
  eighteen fields, kept so the reasoning for each is findable — not something to re-read in
  full before recognising the trigger. Adding a database column that
  holds personal data is a committee decision. The committee has settled the _entry_ field
  list — it is `packages/shared/src/nn-entry.ts` — and **the fifteenth was taken on 28 August
  2026**: `gender_identity`, optional free text, in
  [ADR-020](docs/architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md).
  A sixteenth is a new decision. **Race category and gender are two questions now**, and the
  split is the decision rather than a wording change: `gender` is the closed list of three the
  club awards prizes in and publishes results by — labelled **"Race category"** on the form —
  and `gender_identity` beside it is the open question, on no list, that nothing derives,
  groups, sorts or publishes by. **Widening `gender` is a decision about prize lists**, because
  every value past `female` and `male` is a category with no band to receive it; that gap is
  still open — a genuine third prize category is still the committee's decision, not a build
  one, restated by [ADR-031](docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)
  rather than closed by it. **What ADR-031 changed on 31 August 2026 is narrower**: a
  non-binary entrant is now asked which of the two _existing_ categories, if either, their
  result should count in — see the entry field list below — and `ageCategoryFor()` answers
  `not-placed` rather than `gender-has-no-categories` for the entrant who was asked and said
  neither, or was never asked at all. `gender_identity` is on `/admin/nn/` and **nowhere else** — not
  the start list, not the three exports, never published — and `admin.spec.ts` asserts that
  absence against a _paid_ fixture, which is the only kind an export carries. **The sixteenth
  was taken on 28 August 2026 and it is a person rather than a field**: a visually impaired
  runner may declare so and enter their **guide** on the same entry —
  [ADR-022](docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md). The
  declaration is a `vi` **consent** rather than a column, because it is data about disability
  and Article 9 puts it on the medical note's footing; the guide is a second row in
  `entries.entrants` with `role = 'guide'`, and they **take one of the 250**, which is what the
  club actually needed and is why nothing is reserved. A guide pays nothing, is in no prize
  category, is **excluded from the affiliated export** — because they pay nothing, so counting
  them would overstate how many affiliated entries were sold — and is **marked on the start
  list**. (Nobody carries an England Athletics number any more; see the entry below.) The `vi`
  declaration itself is rendered **nowhere** — no
  read returns a purchase's `consents`, so it is stored as the lawful basis for holding the
  guide's data and never as a fact on a screen; what a volunteer sees is the guide's row, which
  is the operational fact anyway. **Amended 28 August 2026**, and both halves are decisions: a
  guide is asked for their **own email address** — `entrants.email`, the seventeenth field,
  because a runner is reachable through the address that paid and a guide has no purchase of
  their own — and is **not** asked their race category, because a guide is in none. So
  `entrants.gender` is nullable behind `entrants_gender_unless_guide`, which permits that for a
  guide and for nothing else, and a runner without one is refused as loudly as ever. **The VI
  guide entry type is off the form**; the `vi_guide` fee row survives as the backstop's
  subject. **The eighteenth was taken on 30 August 2026 and it is the runner's own phone
  number** — [ADR-025](docs/architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md)
  and [decision 008](docs/decisions/decision-log.md#008--ask-a-runner-for-a-phone-number-and-make-the-race-notice-say-what-is-actually-held),
  argued in #168. It exists because `/nn/privacy/` claimed a phone number the club did not hold:
  what `entrants` held was `emergency_contact_phone`, **somebody else's** number given for one
  thing, and ringing it because the start moved by twenty minutes is not that thing. The stated
  purpose is telling a runner about a change to the race. **A guide is not asked** — they give
  their own email address and their own emergency contact already. **Required of a runner in two
  layers and in a check constraint in neither**: `parseNnEntry` refuses a blank box and
  `create_pending_purchase()` refuses a payload with `phone_required`, while
  `entrants.phone` is nullable behind `entrants_phone_shaped`, which only says what may be
  _held_. A `role = 'guide' or phone is not null` constraint is the obvious shape and it would
  refuse the transfer and the given place the **deployed** Worker is making, which is what
  expand-migrate-contract forbids — so `transfer_entry()` and `create_manual_entry()` both take
  a null. `transfer_entry()` gained an **eleventh** argument rather than a tenth, because a
  tenth `text` is already ADR-023's England Athletics form and `create or replace` cannot rename
  a parameter; its wrappers delegate with a null phone, which **clears** the previous runner's
  number rather than carrying it across. It is on `/admin/nn/entry/`, the printed start list, the
  start-list CSV and the affiliated export, and **not** on the entries table or the medical
  sheet. **The nineteenth was taken on 31 August 2026 and it is where a non-binary entrant's
  result should count** — `entrants.result_placement` —
  [ADR-031](docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md).
  Null for every female and male entrant, behind `entrants_result_placement_only_non_binary`,
  which refuses it outright for anybody else; for a non-binary entrant it is `'female'`,
  `'male'`, or null, behind `entrants_result_placement_shaped`. **Not a third prize category** —
  the race is still run under two, women's and men's, and that gap is still the committee's to
  close and is still open. What this closes is narrower: before it, a non-binary entrant's
  category was permanently "not confirmed" with no way to change that; now they are asked
  directly which of the two existing categories, if either, their result should count in, and
  every band calculation reads that answer and `gender` through one resolver,
  `effectiveCategory()` in `age-category.ts`, so nothing downstream grew a third branch.
  **Taken on the maintainers' own authority, not the committee's** — the ADR says so in as many
  words. It is on `/admin/nn/entry/`, as a "Placement" fact shown only for a non-binary entrant,
  and feeds the start-list export's raw row so `startListCategory()` can resolve the one
  "Category" column both the printed sheet and the CSV already show — but it is not its own
  column on either document, and it is not on the affiliated or medical exports, which carry no
  race category at all. **Cleared by a transfer, exactly like `gender_identity`** — the new
  runner's own placement is not asked, matching the gap ADR-020 already left open for `gender`
  and `gender_identity` at a transfer. **The admin manual-entry and transfer forms do not
  collect it at all**, which is a stated scope boundary rather than an oversight: a volunteer
  using either has no way to set where a non-binary runner's result should count, and would have
  to ask separately. **A twentieth field is a new decision.**
- **One field has come off the list, which had never happened before — the England Athletics
  number, on 29 August 2026.** **Trigger: asking for the number again is a new decision, not a
  revert.** The club asks for none and holds none: a runner states that they
  are affiliated and the club takes their word for it —
  [decision 007](docs/decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers)
  and [ADR-023](docs/architecture/decisions/adr-023-no-england-athletics-numbers.md). **The
  £18/£20 split and the £2 levy are untouched**; only the number stopped being asked for. Under
  ARC Rule 21(2)(b) the club has no record of _who_ claimed affiliation, only that they paid the
  affiliated £18 — put to the committee and accepted — and what replaces the check is a sentence
  reserving the club's right to ask somebody to produce their number or other evidence of
  affiliation. **That sentence is required on both privacy notices and it is on both of them
  since 31 August 2026.** Decision 007 makes it a requirement of the decision rather than a
  nicety, and `/nn/privacy/`'s own header names ADR-023 as asking for both — but it was on
  `/privacy/` alone from **30 August 2026**, when the club asked for `/nn/privacy/` to be the
  committee's document word for word and everything the club had added to it came out. It went
  back on the race notice as a **collection-list item carrying `/privacy/`'s own words**, not as
  new wording — decision 009, issue #179 item 5 and #167.
  **Which fee is the affiliated price is
  `entries.fees.affiliated` now**, a column that says only that; `requires_ea_number` was
  carrying both facts and is false everywhere behind `fees_ea_number_not_collected`.
  `entrants.ea_number` is null everywhere behind `entrants_ea_number_not_collected`. **Both
  columns are still there and that is the expand step** — the deployed Worker parses those keys
  as required, so dropping them mid-deploy would take `/admin/nn/` down. **The contract step is
  owed**, and it is
  [the contract runbook](docs/delivery/runbooks/entries-ea-number-contract.md). **Asking for a
  number again is a new decision**, not a revert.
- **`/nn/privacy/` was the committee's document word for word for part of one day, and the club
  maintains it now.** **Trigger: any edit to that page beyond inserting or deleting an item in
  one of its lists.** No sentence may be rewritten, restyled or reordered, and no section
  added — the detail below is why, and what the one exception (a list item) actually permits.
  ⚠️ **The exception was "the collection list" until 31 August 2026 and is "a list" now**, in
  that list's own voice: decision 009 put an Article 9(2)(a) condition into section 4's list of
  legal bases as well as the affiliation item into section 2's. Prose is still untouchable.
  **Rewritten on 30 August 2026**, when the club asked for that document to be
  published verbatim; until then the page merged it with the notice it replaced. **Later the same
  day the club took edits to it itself** — #168 and
  [ADR-025](docs/architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md) —
  because the collection list claimed a **postal address** and an **expected finish time** that
  nobody is asked for, and omitted the medical box, the visually impaired declaration, gender
  identity and the guide entirely, which are four things it holds and two of which are Article 9.
  The document was contradicting itself about the health data: it names health and safety as a
  basis and medical services as a party it shares with.
  ⚠️ **What that permits is items inserted into and removed from one of the page's lists and
  nothing else.** No sentence on that page may be rewritten, restyled, reordered or "improved",
  and no section may be added; the structure, headings and capitalisation are the committee's.
  Anything beyond insertion and deletion of list items still goes back to them and returns as new
  wording. **The affiliation sentence decision 007 asks for went in on 31 August 2026** as a
  section 2 item carrying `/privacy/`'s own words, and an **Article 9(2)(a) condition** went into
  section 4's list of legal bases the same day — decision 009, #179 items 4 and 5. That is what
  widened the exception from _the collection list_ to _a list_.
  **It renders no "To be confirmed by the club" marker at all** — `nn-privacy.spec.ts` has
  `OPEN_DECISIONS = 0`, and **`/privacy/` has none either since 31 August 2026**: how long an
  account is kept and whether deleting one deletes a race entry are both answered, and
  `privacy.spec.ts`'s `OPEN_DECISIONS = 0` now guards an answer reverting to the marker rather
  than a marker being filled in. ⚠️ **Those two answers must not be read as one act.** The
  self-service button on `/account/data/` leaves a paid entry alone; an **erasure request** is a
  human decision and `/nn/privacy/` section 7 says it cancels the race entry. The wording on
  `/privacy/` names that separation deliberately, and
  [the data-requests runbook](docs/delivery/runbooks/data-requests.md) still owns the second.
  **Four values are interpolated from `race.json`** — the controller, the company number, the
  contact address and the date — because `/privacy/` reads the same four and the two notices may
  never disagree about who the controller is; each renders the document's own words. **What came
  out on 30 August is load-bearing elsewhere**, so the page's own header comment records it: no
  medical-note retention period, no medical box, visually impaired declaration or guide by name,
  no named processors, no registered office, and **no schema-derived list of what the entry tables
  hold** — the fee and amount, Stripe's references, the consents with their version and the
  timestamps are all off the page. **One open decision survives and is published nowhere:**
  whether an email address is kept to tell people about next year's race, still `null` in
  `race.json`'s `emailRetention`, which nothing reads. `entryRetention` is settled prose that
  nothing reads either, the `photographs` key is gone, and `medicalRetention` is kept only for
  `entries-retention.test.ts`. **A second list edit was taken on 31 August 2026 and it is the
  only deletion so far** — the _"IP address, browser type, device information, and cookies for
  website functionality and analytics"_ bullet, which was untrue: there is no analytics code in
  `apps/main` and `GET /nn/2026/` sets no cookie, which is what `/privacy/` tells account holders.
  Issue [#179](https://github.com/southville-running-club/src-website/issues/179) item 1.
  **`race.json`'s `privacy.lastUpdated` is this page's own revision date now, not the committee
  document's** — the two stopped being the same thing on 30 August, and section 9 promises a date
  that moves when the page changes, so **every edit to what is rendered here moves it in the same
  commit**. Item 3. **`privacy.json`'s `lastUpdated` is the same rule for `/privacy/`**, and it
  moved to 31 August on the same day for the same reason. ⚠️ **All five of that issue's items are
  closed now, and the last three were closed by the club rather than by the committee** —
  decision 009, which says so in its own provenance and is superseded on sight by anything the
  committee later supplies. **None of the three was new wording**: two were sentences already
  published elsewhere on this site and the third describes a consent the entry form already
  takes.
- **Taking payment and confirming it are both connected, and neither is a stop-and-ask any
  more.** **Trigger: a partial refund, a correction to a paid entry, or a resend outside the
  outbox** — the built payment path itself (an ordinary Checkout entry, a full-refund
  cancellation) is not one of these any longer; read on for what still is. A valid entry holds a place and goes to Stripe Checkout; the webhook at
  `POST /nn/stripe-webhook` is what moves a purchase to `paid`, and it is the only thing that
  may. **Four Worker secrets** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `ENTRIES_WEBHOOK_KEY` and, since #178, `ENTRIES_ENTRY_KEY` without which no place can be held
  at all — never in this repository, never in `wrangler.jsonc`, never in a `vars`
  block. A real key on a machine belongs in `apps/main/.dev.vars`, which is gitignored.
  **Registering the Stripe dashboard endpoint is still a human's job**, and it is step 5 of
  the manual steps in `apps/main/README.md` (test-mode order; the live-key swap, step 15, is
  the one that is last before entries open) because it needs the production URL.
- **Granting the anon role anything on a table, or adding a function it may execute.**
  **Trigger: any table grant to `anon`, or a sixteenth function beyond the fifteen named in
  `packages/db/tests/entries.test.ts`.** The
  fifteen it may call are named, exactly, in `packages/db/tests/entries.test.ts` — **the count
  has already changed once** (it was thirteen before the outbox's two drain functions were
  added), which is the argument for reading the test rather than trusting a number in prose —
  and that list is there to make a sixteenth a decision somebody takes in a diff rather than a
  side effect. **Reading people is settled** — the admin surface is
  [ADR-013](docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) and its
  amendment: originally a Worker secret plus a key per person, and **since #57 and #58 the
  `nn-admin` role**, checked by `identity.has_permission()` since #107 and by
  `identity.has_role()` before it. Sixteen functions are granted to `authenticated` now, and
  `entries.test.ts` names them with the argument for each. **Cancelling an entry is settled and
  nothing else about editing one is.** Somebody holding `nn.entry.cancel` — which `nn-admin`
  carries and `super-admin` deliberately does not — may refund one purchase in full, which
  deletes its entrants and returns the place —
  [ADR-018](docs/architecture/decisions/adr-018-cancelling-an-entry.md). **Giving a place away
  is settled too, and it came off this list on 28 August 2026** —
  [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md). Somebody holding
  `nn.entry.create` may assign a **complimentary** place from `/admin/nn/`: a `paid` purchase at
  £0 on a £0 fee, audited, under the same advisory lock, re-checking capacity, the minimum age
  and one-runner-one-place. It is the answer to the two Kinsi places and to the visually
  impaired guide's free place, both of which Stripe refuses to charge for. **Transfers beyond
  the one that exists, corrections, resends and partial refunds are each still a
  stop-and-ask**, and each is a decision about changing a record somebody paid for. **A
  partial refund is not merely undecided — `refundPayment()` cannot make one.**
  `worker/stripe.ts` sends no `amount` on the `POST /v1/refunds` call: omitting it refunds the
  full charge, and the file's own comment calls that "the only refund this platform offers — a
  partial one is a different decision." So `cancel_entry()` always refunds in full or nothing,
  and the `entry_refunded` email reflects only those two states — there is no wording anywhere
  for a partial amount, because the code path that would need it does not exist.
  **`formatPence()` (`packages/shared/src/entry-state.ts`) is the one function meant to render
  money to text**, returning the `£` and the pound-pence formatting together — including
  `'Free'` for zero — rather than a bare number a caller adds a symbol to. **One place re-derives
  it by hand instead of calling it**: `NnEntryForm.astro`'s running-total script, a client
  `<script>` in an Astro island, re-implements the same `£`/`.00`/`'Free'` shape rather than
  importing `formatPence` — behaviourally identical today, tracked as the sixth instance of this
  pattern by [#175](https://github.com/southville-running-club/src-website/issues/175), still
  open. Every _other_ `£` anywhere in this repository, checked by grep, is inside a comment; the
  three CSV exports carry an amount as a raw pence integer with no symbol; no SQL renders money
  to text. A template that writes its own `£` beside a call to `formatPence()` doubles it —
  `££18.00`, and `£Free` on a given place. The presentation belongs to the one function that
  already produces it — the caller in `NnEntryForm.astro` is the one place that still does not.
  ⚠️ **Four of #175's six sites closed on 14 September 2026 and the two in `NnEntryForm.astro`
  did not, deliberately.** The issue's own advice was _"none should land before entries open; two
  are on the entry form"_ — which has inverted: entries opened on 1 September and the race is
  selling, so the two sites on the form that takes the money are now the riskiest of the six
  rather than the safest, and they wait for a quiet window or for the window to close on 30
  October. So the paragraph above still stands exactly as written. **What came out of the other
  four is `plural()` — `packages/shared/src/plural.ts`, this rule applied to a count and a
  noun** — and, because the rule was not enough on its own, `outboxAttemptsWords()` in
  `admin-outbox.ts`: sharing the conditional stops a surface re-deriving it, and only sharing
  the **noun** stops a third surface picking a third word. `/admin/emails/` and
  `/admin/nn/entry/` had rendered one `email_outbox.attempts` row as _"3 attempts"_ and _"Failed
  after 3 tries"_. The club's word is **attempt**, which is the one
  [the email runbook](docs/delivery/runbooks/entries-email.md) already used throughout.
- **A seventh role, or a twelfth permission.** **Trigger: exactly what the heading says** —
  the **six** roles and **eleven** permissions are asserted in
  `packages/db/tests/identity-permissions.test.ts`, and a seventh or twelfth is a decision, not
  a side effect. **This said five and ten until 6 September 2026**, when the club took both at
  once: `store.ticket.read` and `src-admin`.
  ⚠️ **`src-admin` is a master role and the first this platform has had**, which is a departure
  from everything the rest of this list describes — `super-admin` is deliberately _not_ a
  wildcard. What keeps it honest is that it holds its eleven permissions as **eleven explicit
  rows** rather than as a branch in `identity.has_permission()`: a wildcard would grant the
  _twelfth_ permission too, the day somebody added it, without anybody deciding. So the
  assertion file fails on every new permission until a human writes down whether directors get
  it, and **that recurring cost is the feature rather than the price**. Since #107 a role is a bundle of permissions and
  code checks the permission, never a role name —
  [ADR-017](docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md). **The ninth
  and tenth arrived on 29 August 2026 and they are a borrow being paid back**: `nn.email.read`
  and `nn.email.resend`, so `/admin/emails/` stops asking `nn.entry.read` and `nn.entry.cancel`
  about email. Nobody gained or lost anything on the day — `nn-admin` carries all four — and
  what changed is that the two can be granted apart. The five
  roles and the ten permissions are asserted exactly in
  `packages/db/tests/identity-permissions.test.ts`, which is what replaced `identity.roles`'
  check constraint and does the same job: it makes an addition a decision somebody takes in a
  diff. Adding a role is a migration and no deploy — `/admin/people/` reads
  `identity.grantable_roles()`. **`people-admin` is the fifth and it is what the mechanism was
  built for** — one permission, `identity.person.read`, which opens `/admin/people/` to be read
  and nothing else on the surface. Reading the club's people and changing what they may do are
  two permissions, and `super-admin` holds both because granting a role means finding somebody
  in that list first.
- **Any DNS change that is not an additive record.**
- **Anything that would need the Supabase service role key.** If a build appears to want
  one, the row-level security policy is wrong and _that_ is the thing to fix.
- **Any change touching the _old_ timing platform** — the `bindalshah/src-race-timing`
  repository, or the `public` and `private` schemas it owns. ⚠️ **The `timing` schema in this
  repository is not that, and is ordinary work**: under
  [ADR-034](docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
  the platform is being rewritten here rather than moved, so writing `timing` tables, the
  ported logic in `packages/shared/src/timing/` and `apps/timing` needs no permission this
  list does not already give. Reaching into the old one still does.
- **Anything that would put a credential in the repository.**
- **Changing `[auth]` in `packages/db/supabase/config.toml`.** It ships to production on
  every merge that touches a migration, and there is **no partial apply** — a rejected value
  takes `site_url`, the redirect allowlist, `enable_signup` and the captcha secret down with it
  while `db push`, which runs first, goes on succeeding. That is issue #79, and it cost four
  red deploys. `enable_signup` is **on**, as of #49 and decision 005; **no email-template block
  may be declared at all** while the project is on the free tier's default mail provider.
- Discovering that a **free tier's terms differ** from what is recorded.

---

## The shape of the place

```
docs/         Documentation. The root is documentation; nothing builds here
platform/     The npm workspace — apps/, packages/, all tooling
dev           The one command for local work. Run it from the root
```

**`npm` at the repository root will fail.** There is no `package.json` there, deliberately.
Use `./dev`, or `cd platform` first.

```bash
./dev up      # rebuild the database, then the whole site on http://localhost:8787
              # --keep-data skips the rebuild, when the schema is already current
./dev test    # the Worker and acceptance tests, then everything stopped
./dev e2e     # one Playwright spec on one engine — the fast loop; --linux runs CI's own
              # browser image, for when a laptop passes something CI would fail
./dev check   # rebuild the database, then lint, types, generated types, unit and database
              # tests — the same six steps as CI's "Lint, types and tests" job
./dev smoke   # a handful of live assertions against production; --live is explicit about it
./dev reset   # rebuild the database from zero without starting the site
./dev down    # stop the Workers and the database
./dev logs    # tail the Worker and Stripe-stub logs from the last ./dev up
```

**`up`, `test` and `check` all rebuild the database**, because `supabase start` applies
migrations only to a volume it creates — so on any machine that has run this before, the three
otherwise meant three different schemas. It costs tens of seconds and the local data, which is
only ever the seed and invented fixtures.

⚠️ **They rebuild the database and they do not re-read `config.toml`, and `./dev down` does not
either.** `[api].schemas` reaches PostgREST as `PGRST_DB_SCHEMAS` on the container, set when
`supabase start` **creates** it — so a stack booted on one branch keeps that branch's schema
list across every `./dev up`, `./dev reset` and `./dev down` that follows, including after a
checkout that changes the file. The symptom is a suite that fails with **`PGRST106 Invalid
schema: <name>`** naming a schema the working tree plainly exposes, on a branch that did not
touch the file — which reads as a broken migration or a bad merge, and is neither. Compare the
two directly before believing anything else:

```bash
grep '^schemas' platform/packages/db/supabase/config.toml
docker inspect $(docker ps --format '{{.Names}}' | grep rest) --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_DB_SCHEMAS
```

**`npx supabase stop` from `platform/packages/db`, then `./dev up`** is what actually recreates
it. It cost fifteen red database tests on 13 September 2026, on a branch whose diff was two
functions and a skin.

One hostname, several paths — the same locally and in production:

|            |                                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | The club website — `apps/main`                                                                                                                                                                                                                                                                                         |
| `/nn`      | Nightingale Nightmare — `apps/main`. **`/nn/<year>/results/` is locked behind `nn.results.read` until the race's results are published**, and answers 404 to everybody else, the signed-out public included. Publication is an explicit act — ADR-042 — so finishing a race does not do it. **Since #242 the page opens to the public the moment it happens**: cacheable for sixty seconds, indexable, and linked from `/nn/` and `/nn/<year>/` — and from neither before, because a link to a 404 is a claim about a record |
| `/events`  | Tickets to the club's socials — `apps/main`. **The schema calls these `store.socials`, never events**: the glossary reserves _event_ for one running of one race in one year. The path and the navigation label say "Events" because that is what the old Squarespace site published and what a member reads — ADR-033 |
| `/account` | Sign up, sign in, sign out, the password pages, and **`/account/entries/`** — what the club has recorded about the races this person has entered. `apps/main`                                                                                                                                                          |
| `/admin`   | The club's back office — the entries, the interest list, the exports and the roles page. `apps/main`, behind a session and a staff role, and **404 at every address to anybody who has neither**. `/nn/admin/*` redirects here                                                                                         |
| `/timing`  | Race timing — `apps/timing`, a different Worker. **Staff-only since 11 September 2026**: it answers 404 to anybody without a `timing.*` permission, the signed-out public included, and is linked from nowhere. `/timing/health` stays public for the smoke test                                                       |

---

## Non-negotiable

Breaking one of these is a defect, not a judgement call. The full reasoning is in
[principles](docs/architecture/principles.md); this is the short list.

**Row-level security is the access control.** There is no API tier between the browser and
Postgres. RLS on every table from its first migration, no exceptions, no "we will add it
later". The anon key is public and belongs in client code; the service role key never
reaches a browser, a Worker, or this repository.

**Timestamps are stored UTC and displayed `Europe/London`**, through
`packages/shared/src/london-time.ts` and nothing else. ESLint bans bare `toLocale*String`
repository-wide. Nightingale Nightmare is raced the weekend after the clocks change; an
hour of drift is a real foot-gun, not a theoretical one.

**Personal data is minimised at the boundary.** Sensitive fields are dropped _before_ they
reach the database, never stored and filtered later. Date of birth becomes a computed age.

**Expand, migrate, contract.** Every schema change keeps the previously deployed code
working. Roll code back; roll schema forward. This is load-bearing rather than good
practice here — nothing sequences the migration against the Cloudflare deploy.

**The _old_ timing platform is not touched by website work.** Not its tables, not its
policies, not its repository. That includes the `private` schema, which is why `entries`' one
helper function lives in `entries` with a pinned `search_path` rather than where the old
platform keeps its own.

⚠️ **"until the port happens deliberately" is what this used to end with, and the port is
happening**: [ADR-034](docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
rewrites it here rather than moving it, and
[ADR-035](docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md) puts the
new tables in a `timing` schema — **not `public`, and there is no `private` schema here**. The
sentence above is about the platform still running on Vercel; the schema in this repository is
ordinary work under the same rules as `entries` and `store`.

**Zero accessibility violations**, not "few". Any threshold above zero becomes the new
normal within a month.

---

## How to work here

**Run local tests and CI/pipeline checks through a Haiku subagent, not the main session.**
When a task needs `./dev check`, `./dev test`, or a look at a GitHub Actions run (`gh run
list` / `gh run view --log-failed`), spawn it as a background `Agent` call with
`model: "haiku"` rather than running it inline or in the main model. Have that agent report
only a terse pass/fail summary — failing step/test names and error snippets, not full logs —
so the expensive raw output never reaches the main session's context. Do this automatically,
without asking first; it is a standing instruction, not a per-task choice.

**Scope the check to what changed, not the whole repository.** The `local-verify` skill
(`.claude/skills/local-verify/`) is the standing procedure for this: a scoped `vitest run`
or a single Playwright spec on one engine while iterating, the full `./dev check`/`./dev
test` reserved for a final pass before opening the pull request. It composes with the rule
above rather than replacing it — the full run still goes through a Haiku subagent when it
runs at all.

**`./dev e2e` is the loop; `./dev test` is the gate.** One spec on one engine, seconds rather
than minutes — and it exports the three Supabase variables a scoped Playwright run needs, without
which the fixtures throw `supabaseKey is required` from a file the failing test never mentions.
`nn-entry.spec.ts` and `nn-signup.spec.ts` need `--config=playwright.config.serial.ts`; asked for
without it, Playwright reports **no tests found**, which reads as a pass.

⚠️ **A green Mac does not mean a green CI, and `./dev e2e --linux` is how you find out before
pushing.** Both volunteers are on macOS; CI is Linux, and the font metrics differ — so every
assertion about position, wrapping or overflow can be honestly green on one and red on the other.
It has now cost three separate sessions:

- the radio-focus divergence and the CSV download behaviour, both already in the traps below;
- `element is not stable` across a whole project, which took two wrong hypotheses to place;
- `keeps the entry type that was chosen in view` — **0.1px on a Mac, 214px on the runner.**

`./dev e2e --linux` runs the browsers inside `mcr.microsoft.com/playwright:v1.62.1-noble`, the
image and version CI installs, while the Workers and the database stay on the host and are
reached through `host.docker.internal`. It reproduced that 214px exactly, on a Mac, in twenty-one
seconds. **Use it before pushing anything that touches layout, a stylesheet, or an assertion
about where something is** — and when CI fails something a laptop passed, reach for it first
rather than reasoning about what the runner might be doing.

It is not a replacement for `./dev test`: it runs the browsers only, against a build and a
database the host already has. First run pulls about 2GB; after that it is seconds slower than
the native one.

**Every change by pull request.** Both volunteers review.

**One change per pull request, and since 15 August 2026 that is mechanical rather than
tidiness.** The repository is **squash-only**, so every commit in a branch collapses into one
on `main`. Two unrelated things in one pull request become one commit that cannot be reverted
or bisected apart afterwards, and a careful commit-by-commit branch arrives as a single entry —
so **the reasoning belongs in the pull request body and the commit message, not in the shape of
the branch.** Settings and the full trade are in
[the GitHub runbook](docs/delivery/runbooks/github-setup.md#3b-merge-behaviour--squash-only).

**Documentation ships with the change it describes**, not afterwards. If you change
behaviour that a README or ADR describes, change it in the same commit. A document that is
wrong is worse than one that is missing, because it is trusted.

**The race director's copy is transcribed verbatim, and `/nn/2026/terms/` is the strictest
case.** Her prose is already published on `/nn/`, on the two renamed pages and in front of the
entry form, and it keeps her spelling — "10km off road" unhyphenated, "spooktators" lower case,
an ampersand. **The entry terms and race rules go further: nothing on that page may be edited
for style at all.** The capitalisation is inconsistent, the ordinals and the 24-hour clock
disagree with the rest of the site, and one clause slips into the third person mid-sentence.
It stays. That page is the document somebody agrees to be bound by when they tick the box on
`/nn/2026/`, so a tidy-up is a silent amendment to a legal instrument rather than a copy edit —
and `entry_purchases.consents_version` records which wording a person ticked against. Spotted
problems go back to her as a batch and return as new copy with a new version line at the foot
of the page. **The committee has not ratified those terms**, which is why the line reads
"Supplied by the race director" and why two tests assert that no ratification is claimed.

**Never edit an accepted ADR to change its answer.** Write a new one that supersedes it and
say what it replaces. The history of a choice that turned out badly is worth more than a
tidy file.

**Use [the glossary](docs/foundations/glossary.md)'s words exactly.** An _event_ is one
running of one race in one year; a _race_ is the recurring thing; a _team_ is the unit of
entry even when it holds one runner. Getting this wrong in a schema is expensive.

**Any step done by hand is written down** — what, why, by whom, and how to redo it. That is
what makes the manual exceptions legitimate rather than merely convenient.

**Boring beats optimal.** Every unusual choice is a tax on somebody who has not been hired.
If you reach for a tool because it is better, check first whether the mainstream one is
good enough — it usually is, and a third volunteer will already know it.

**Markdown wraps at roughly 90 characters.** Tables and URLs excepted.

### Writing tests

Four layers, and each tests something the layer below cannot: unit, database against a real
Postgres, the Workers runtime via Miniflare, and Playwright with axe.

**`./dev check` runs the first two; `./dev test` runs the other two** — the Miniflare layer
needs a build, which is why it waits for `test` rather than `check`. Between them the two
commands run every layer CI does, which was not true until a green laptop sent a red pull
request.

⚠️ **It stopped being true a second time, and the same way: `./dev check` was missing CI's
"Generated types are current" step until 12 September 2026.** `database.types.ts` is
generated, so any migration adding a function or a column makes it stale — and a green
`./dev check` could still send a red pull request, on a file nobody thought they had touched.
It runs `db:types:check` now, in CI's own order. **The general rule that keeps costing time:
a step CI runs and `./dev` does not is a divergence that fails in the expensive direction**,
because the laptop is where it is cheap to find out.

⚠️ **And a scoped run is not this gate.** `vitest run <one file>` while iterating is the loop;
`./dev check` is what says the branch is green. Scoping to a new test file hid a sibling
assertion — `timing.test.ts`'s list of granted functions, which went red on CI the moment a
migration added three — and 17 passing tests read exactly like 1,838 passing tests until the
runner disagreed.

**The negative case is usually the one that matters.** That an anonymous client _cannot_
read `club` proves more than that a member can. Assert the specific error, not merely that
something failed — a test that passes because the table does not exist yet is a test that
has stopped testing.

⚠️ **One refused call per transaction, or every refusal after the first is `25P02`.** A
`42501` aborts the transaction it was raised in, so a second refused call in the same
`begin` comes back _current transaction is aborted_ whatever its own grant says — and an
expectation naming `42501` can then never observe it, on a grant that is perfectly correct.
It failed the database layer once already, on `timing.test.ts`'s anonymous-caller test for
`publish_results()` and `unpublish_results()` asserted together. **An aborted transaction
refuses everything, which reads as every grant holding at once**, so this is the rule above
one step further on rather than a separate one.

**Fixtures are deterministic and invented.** Fixed UUIDs, fixed timestamps, addresses at
`example.com`. No production data on a laptop, ever. Include the awkward states — consent
withheld, an apostrophe in a name, the repeated hour on the clocks-change weekend — because
those are what break rendering.

---

## Traps that have already cost time

Each of these cost an hour or more, and none is obvious from the outside. Grouped into
**environment, build and tooling** versus **layout, tests and cross-browser** — the two
kinds recur through the section rather than sitting in one block each, so a heading marks
every switch between them.

### Environment, build and tooling

**`opennextjs-cloudflare build` runs one of `apps/timing`'s own npm scripts.** Naming that
script `opennextjs-cloudflare build` makes it invoke itself. It recursed 205 levels and took
a laptop down. `build:next` exists solely to be what OpenNext calls, and the duplication is
the guard.

**A leading underscore on an App Router folder silently deletes the route.** `_health/` is the
conventional spelling for an endpoint that is not a page on more or less every other platform,
and in `apps/timing` it is a **private folder**: Next opts it out of routing entirely, so
`app/_health/route.ts` builds clean, deploys clean, and 404s — with nothing anywhere saying
why. The timing app's health endpoint is `app/health/route.ts` for that reason, and the comment
at the top of it says so. `apps/main` is Astro plus a Worker and has no such rule, which is
what makes the pair easy to get wrong: the same name is fine on one side of the hostname and
invisible on the other.

**So the two health endpoints are spelled differently on purpose** — `/_health` in `apps/main`
and `/timing/health` in `apps/timing` — and **the underscore on the Astro side is load-bearing
too, for the opposite reason.** `trailingSlash` is `'always'`, so a page at
`src/pages/health.astro` would serve at `/health/` while the Worker went on answering
`/health`, because it matches before the assets binding. Two live addresses one character
apart, no error and no failing test, and a runner looking for the club's advice on training
gets a database report. This is a running club; `/health/` is a page somebody will want.

**A stale `.next/types` fails `npm run typecheck` on a route that is perfectly correct, and
CI cannot reproduce it.** Next generates a union of the app's routes at build time, and
`<Link href>` is checked against it. Add a page under `apps/timing/app/` and link to it without
rebuilding, and `tsc` says
`Type '`/events/${string}/start`' is not assignable to type 'UrlObject | RouteImpl<…>'` — about
a route that exists, from a link that is right. **With no `.next/types` at all the check is
permissive**, which is why CI — a fresh checkout that lint-and-typechecks _before_ it builds —
goes green on the same commit, and why `./dev check`, which also does not build, only fails on
a machine that has built once before. `npm run build:next --workspace apps/timing` and run it
again. The tell is that the type it refuses and the type it wants read identically.

**An ambient `NODE_ENV=development` breaks the Next.js build**, reporting it as
`Cannot read properties of null (reading 'useContext')` while prerendering a page nobody
wrote. Every build script pins `NODE_ENV=production`.

**Two copies of React or Next in the workspace break the build** in ways that read as
application bugs. After changing a version, `npm dedupe` and check there is one copy.

**Keep `routes` under `env.production`.** At the top level, `wrangler dev` rewrites
`request.url` to the custom domain and a plain `wrangler deploy` would put localhost config
on a live hostname.

**`TIMING_ORIGIN` must never appear in `env.production`.** Its absence is what makes
`/timing` Cloudflare's job at the edge rather than an extra proxy hop.

**Detach background servers properly** — `nohup`, redirected streams, closed stdin. A child
holding the terminal makes the parent never return.

**Prettier reformats the contents of a template tagged `html`, and it is not configurable.**
`worker/html.ts` is the auto-escaping template the admin pages are built with — the one place in
this repository that builds markup in a Worker, because a list of entries is a variable number of
rows and there is deliberately no `setInnerContent(..., { html: true })` anywhere here. Formatting
the file reflows the markup inside every `` html`…` ``: nested elements are indented onto their own
lines, and `attr='x'` becomes `attr="x"`. Harmless in a browser, and it means **a sentence written
across a line break arrives with a newline in the middle of it**, so `toContain('over its field')`
fails on markup that is perfectly correct. That is the `{' '}` trap one framework along. The tests
squash whitespace before matching; the tag keeps its name because readable markup is worth more
than exact-output assertions.

### Layout, tests and cross-browser

**A visually-hidden span inside a horizontally scrolling table makes the whole page scroll
sideways.** `overflow` only clips a descendant whose containing block is inside the scroller, and
`.admin-visually-hidden` is `position: absolute` — so with no positioned ancestor its containing
block was the _page_, it was laid out at the far edge of a 793px-wide table, and the document
scrolled at 320px while the table scrolled correctly and the spans stayed invisible. Nothing
looked wrong; the page just slid left under a thumb. `position: relative` on `.admin-scroll`
makes it the containing block, measured 783 → 320. The same is waiting for any absolutely
positioned thing inside any scroller.

**A component whose colours were computed against a surface it does not carry breaks silently
the first time it is moved.** `NnSchedule` was written inside `race-day.astro`'s `.nn-card`, and
every colour in it assumes white: the time is `--nn-blood` at a computed 9.01:1 _on that card_,
and the row divider is `--nn-card-muted`, picked to be an almost-invisible 1.12:1 line _on that
card_. Rendering the same markup on `/nn/2026/`'s gradient inverted both — the divider became the
loudest thing in the block, and the time became `#8f1b0f` on the radial's `#8f1b0f` centre stop.
**1:1 by identity: not hard to read, absent** — and `background-attachment: fixed` means the
block scrolls through the gradient's whole range rather than sitting at one value, so it passes
_through_ identity rather than merely near it. Nothing went red, because nothing was looking:
`brand.test.ts` covers the club palette and `admin-contrast.test.ts` covers the admin washes, and
**neither reads `nn-theme.css`** — every ratio in that file's opening table is its author's word,
and one row has already gone stale. The fix is that the component carries its own surface and
gives it back via a `.nn-card` descendant rule where one already exists, so the two call sites
cannot disagree because neither is asked. **A surface variant passed by the call site is the
wrong answer**: a prop the caller has to get right is exactly how this arrived. `NnRaceSummary`'s
`.nn-arrows` is the second instance of the same pattern, still latent — `blood` markers and a
`card-muted` divider, surviving only because both its call sites happen to sit inside cards.
`nn-contrast.test.ts` now resolves both sides of each pairing out of the stylesheet, so a moved
surface recomputes rather than going quietly vacuous. **Compute the pair before writing the
colour**: two of that page's intended colours failed a 7:1 bar and were redesigned before they
shipped, and neither would have been caught by looking, because both looked fine.
**A 320px overflow check that measures straight off `toBeVisible()` is measuring a page with no
CSS on it.** `document.documentElement.scrollWidth > clientWidth` was asserted directly, once, in
eight places, and it failed about one run in three across `nn-signup.spec.ts` and
`nn-entry.spec.ts` — two files, one assertion, and a re-run of the identical build always green.
**DOMContentLoaded waits for scripts, not for `<link rel="stylesheet">`**, so on a page with no
blocking script — every page here in the `no-javascript` project, and the deferred-module case
everywhere else — `readyState` reaches `interactive` with both sheets still in flight. An outcome
block the Worker has revealed is _visible_ at that moment, so `toBeVisible()` resolves; and
**reading a layout property is not gated on render-blocking**, so `page.evaluate` then forces a
synchronous layout of a bare document. Caught in the act it reads `overflow=19 client=320
ready=interactive sheets=[]`, with one offender: `a left=8 right=339.13` holding the club's
47-character address, because `a[href^='mailto:'] { overflow-wrap: anywhere }` lives in `base.css`
and `base.css` has not arrived. `left=8` is the browser's default `body { margin }`, which is the
tell — **`sheets=[]` and a left edge of 8 mean the measurement is the defect rather than the
layout.** The styled page does not overflow at any width from 300 to 320, with or without the
fonts. **This repository had already met it and paid for it twice**: `nn-privacy.spec.ts` and
`privacy.spec.ts` each carried a two-pass reload loop naming _"an element laying out at its
intrinsic width before the stylesheet applied, about one run in four"_ — the right diagnosis and
a re-run for a fix. All eight go through `apps/main/tests/sideways-scroll.ts` now, which waits
for a **defined state** — every render-blocking stylesheet applied, `document.fonts.status`
settled, and the width unchanged across three samples — and never for the assertion to come
good. **The polling has to be on Playwright's side**: `page.waitForFunction` installs its loop
_in the page_, so with
`javaScriptEnabled: false` it never runs and every call times out at ten seconds, which is how the
first version of this fix failed. `page.evaluate` works there; `requestAnimationFrame` callbacks
do not. The helper names the offending element on failure, which is what turned this from three
runs and an afternoon into four minutes.

⚠️ **The fourth instance does not measure anything, which is what made it hard to recognise as
this.** 14 September 2026, issue [#289](https://github.com/southville-running-club/src-website/issues/289):
one failure in a full `./dev test`, on `mobile-safari` alone, in `nn-consolidated.spec.ts`'s
_"opens its section menu without JavaScript"_ — a spec the branch being gated does not touch,
green 14 of 14 on a scoped re-run of the same engine and green in CI on the same commit. Nothing
in it reads a layout property; what it does is **branch** on one. The jump-nav has two
presentations — an inline list above 860px, a closed `<details>` below it — and which one is on
screen is a question only `nn-theme.css` can answer. `isVisible()` is a **single read with no
retry**, and it is what chooses the branch: taken before the sheet applies it chooses against a
document that has no presentation, the click that opens the menu never happens, and the
`toBeVisible()` after it is asserting about the presentation the page is not in. **The final
`expect` retries, which is why this was rare rather than constant** — and rare is the expensive
kind, because it fails a gate on a branch that cannot have caused it and costs a re-run and a
diagnosis before anybody believes that. `expectStyledLayout()` in `sideways-scroll.ts` is the
same wait with an assertion in front of the caller's own read: a wait that falls through on
timeout has somewhere to land when what follows it is a measurement, and nowhere at all when
what follows it is a branch. **The rule generalises past overflow** — a read that decides _what
to assert_ is as meaningless on a bare document as one that measures it, and it fails more
quietly.

**The three browser engines do not agree on what an attachment is, and one of them only
disagrees on Linux.** Given `content-type: text/csv` and `content-disposition: attachment`,
Chromium downloads it — the `download` event fires and `response.body()` is _unreadable_, because
the bytes went to the downloads directory. macOS WebKit downloads it too, which is why
`waitForEvent('download')` passed nine local runs in a row. **WebKit on a Linux runner renders it
in the tab**: no download event ever fires, the page navigates to the endpoint, and the CSV is
the body. Only CI saw it, exactly like the radio-focus bug, and it was the one red test in the
first pipeline run of the admin slice. **Assert an attachment on the response, not on the
download** — the status, the content type and the filename are what is specified and every
engine agrees on them; for the bytes use `page.request`, which shares the context's cookies and
hands back a readable body everywhere. Reproduced in
`mcr.microsoft.com/playwright:v1.62.1-noble`. `nn-admin.spec.ts`'s two export tests are the
shape to copy.

### Environment, build and tooling, again

**Two pull requests merged out of timestamp order stop `db push` dead, and every symptom
points somewhere else.** `supabase db push` refuses to insert a migration _before_ one already
applied on the remote, so a branch whose migrations are timestamped earlier than a branch that
merged first takes the whole deploy down — `Found local migration files to be inserted before
the last migration on remote database`, and **nothing is applied at all**, including the dozen
migrations that came after. It happened on 29 August 2026: #134 carried `20260828140000`,
`141000` and `142000`, while #131 and #133 — timestamped `170000` and `190000` — merged first.
Nine migrations were stranded and `deploy-db.yml` failed on every run for six hours.

**What it looks like from the site is not a broken deploy.** The Worker deployed fine, so it
calls functions the database has not got, PostgREST answers `PGRST202`, and every client here
maps a PostgREST error to _"the club's database could not be reached — try again in a moment"_.
Both halves of that are false: the database is healthy, and retrying can never help. What a
volunteer saw was **"That could not be read"** on the transfer form and **"That could not be
recorded just now"** on a runner's own cancellation, on a platform where cancelling still
worked — because `cancel_entry()` predated the break. **The tell is that only the newest
functions fail**, and the place to look is the `deploy-db` workflow rather than the code.
`missingFunctionCause()` in `packages/shared/src/admin.ts` names it now, and both pages say
"the site is ahead of its database" instead of asking somebody to wait for something that will
not arrive. **`--include-all` is what applies the stranded migrations**, and it is safe only
after checking that nothing already applied is re-created by one of them — a migration versioned
earlier but applied later silently reverts whatever a later-versioned one already changed.

⚠️ **Rebasing onto a merged migration means renumbering past it — every time, and whatever the
migration contains.** This happened again on 29 August 2026, in the pull request that added the
paragraph above. Four migrations were rebased onto a branch that had landed `20260829120000`;
three were renumbered past it and the fourth was left at `20260829100000`, on the reasoning that
it clobbered nothing — which was true, and irrelevant. **`db push` refuses on version order
alone**, it refuses the _whole push_, and every deploy after it fails identically until somebody
renumbers. There are two questions and they are not the same one:

- _Will `db push` accept it?_ — is every version later than the remote's newest. Nothing else.
- _Will applying it revert something?_ — does it re-create an object a later-versioned
  migration already changed. This is the one that needs reading the diffs.

Answering the second and skipping the first is what a clean-looking rebase invites, because the
second is the interesting question and the first feels like bookkeeping. **`ls` the migrations
directory after any rebase and check the branch's own files sort last.**

**A restated closed list is a merge conflict git cannot see.** `entries.admin_audit.action`,
`entries.fees.code` and the status checks are widened by `drop constraint if exists` followed by
`add constraint` **restating the whole list** — which is right for reviewability and is a trap
for two branches in flight at once. Both merge cleanly, both pass review, and the one applied
second silently drops whatever the first added. It happened on 28 August 2026:
`entries_complimentary_places` added `create_manual_entry` and `entries_admin_outbox` added
`resend_email`, and after both, giving a place **failed on the audit row it writes before
writing the entry** — the transaction rolled back, so nothing was half-created, but the feature
was dead and the error said nothing about why.
`20260828200000_entries_audit_actions_reunited.sql` is the third statement of that list and
exists only because of this. **Neither earlier migration is wrong and neither may be edited** —
both are applied, and editing an applied migration changes what a fresh `db reset` produces
without changing what any existing database holds. **What caught it was a test that gives a
place and asserts it exists**, not one asserting the constraint's text: a test that restated the
list would have gone stale in exactly the same way. So when you widen one of these, grep for
every other migration that names the same constraint before assuming your list is complete.

**A `case` expression inside a PL/pgSQL `if` condition does not compile, and the error names
the wrong thing.** PL/pgSQL ends an `if` condition at the **first `then` token it meets**, so
`if x <> case when y then 'a' else 'b' end then` is read as the expression `x <> case when y` —
which is incomplete, and Postgres says `syntax error at end of input` while pointing at the
`case`. Nothing in that message mentions `if`, `then`, or the fact that the condition was
truncated, and the statement reads as perfectly ordinary SQL. It cost a full apply-and-bisect
cycle in `20260828140000_entries_discounts_and_guides.sql`, where the whole 800-line migration
failed on one line in the middle of a function body. **Assign it to a variable first** —
`v_expected := case when … end;` then `if x <> v_expected then` — which is what that migration
does and says why. Parenthesising works too, because the scanner tracks paren depth, but the
variable is what a reader can see the reason for. `check_function_bodies` catches this at
`create function` time, so a migration will not deploy half-applied; what it costs is the
minutes spent believing the `case` is wrong.

**A CSV's byte-order mark is invisible to `Response.text()`.** `TextDecoder` strips a leading
U+FEFF by default, so a test that decodes the body reports a mark that is on the wire as missing —
and one written the other way round would pass on a file that opens as mojibake in Excel on every
Windows machine the club owns. Assert on the bytes (`EF BB BF`), or decode with `ignoreBOM: true`.

**The Worker was not typechecked at all until Slice E**, and the reason was one line:
`worker/tsconfig.json` had named `@cloudflare/workers-types` since the skeleton and nothing ever
installed it, so `tsc -p worker` failed at the first import and no script ran it — while
`astro check`, which is what `npm run typecheck` calls, excludes `worker/` by its own tsconfig.
Nothing covered the code that takes the money. It is wired in now as `typecheck:worker`, and it
found a real defect on its first run.

### Layout, tests and cross-browser, again

**A CSS `@view-transition` breaks the sign-up form with JavaScript disabled.** Four lines,
no JavaScript, and after the form's POST/422 the `::view-transition` overlay swallows the
click on the error summary's link — silently, so the person just finds that nothing happens.
Reproduced 5/5, gone 3/3 with the rule removed, and it passes with scripting _on_, which is
what makes it easy to ship. `nn-signup.spec.ts`'s "links from the summary to the field it is
about" is the guard. Full note at the foot of `packages/shared/styles/nn-theme.css`.

**The account forms have that summary too since 30 August 2026, and it is a second guard on the
same trap.** They always _announced_ their errors — `aria-invalid`, `aria-describedby`, a
`role="alert"` — so this was never a zero-violations breach; what was missing is the navigable
list of links. It is `errorSummary()` in `worker/account.ts`, rendered as the **first child of
each form** rather than above it, because `/account/sign-in/` has two forms with separate error
objects and a container's message belongs to that container. `account.spec.ts`'s "lists every
problem and links to the field it is about" runs **without** `@requires-js`, which is the half
that would catch a `@view-transition` here. #152.

⚠️ **`hidden` does not stop a control being validated, and it took the entry form down for
every signed-in runner.** A signed-in person's address comes from their session, so the Worker
hides the two `[data-nn-entry-typed-email]` fields and shows a fixed line instead — but the
`required` inputs stayed in the DOM, empty and invalid. The browser will not submit a form
holding an invalid control it cannot focus, so it refused, logged `An invalid form control with
name='email' is not focusable` to a console nobody has open, and **sent nothing**. No request in
`wrangler tail`, no row in `entry_purchases`, no log line, no error on the page: the button
simply did nothing. Found on production on 31 August 2026 while rehearsing a tester payment,
hours before entries were due to open, and the only reason it was found at all is that somebody
was watching a Worker log for an unrelated reason. **`disabled` is the attribute that does both
halves** — skipped by constraint validation _and_ left out of the submission, which is exactly
what the POST handler already documented for itself: _"a submission from that page carries
neither"_. **It is not a JavaScript problem and there is no JavaScript fix**: HTML5 constraint
validation is the browser's, so the `no-javascript` project meets it identically and the
attribute has to come from the same server-side rewrite that hides the field. **The general
rule: a control you hide must also be disabled, or it still votes on whether the form may be
submitted.** `tester.test.ts` guards it at the layer that serves the markup, in both directions
— signed in it must be `disabled`, signed out it must not be, because disabling it
unconditionally would drop the address from every signed-out entry.

**A message that appears on `focusout` can swallow the click that caused it.** The England
Athletics box **is off the form since 29 August 2026** and the rule it cost is not — the next
conditional field re-creates the shape exactly, which is why this stays. It was a `.field`
_inside_ the affiliated `.nn-fee` card, so `fieldOf` — which took
`closest(container)` and then the first `[data-entry-error]` beneath it — answered `eaNumber`
for the affiliated **radio**. Leaving that radio made the England Athletics box complain about
a number nobody had been asked for, and it did so _between the press and the release of the
click_: 67px of message, above the other two cards, pushing them 72px down out from under the
pointer, so no `click` ever reached the radio and **the entry type could not be changed at
all**. **Only CI saw it, and that is the trap** — macOS and iOS WebKit leave a radio unfocused
when it is clicked, while the GTK/WPE WebKit that `playwright install webkit` puts on a Linux
runner focuses it, so `focusout` never fires on a laptop. Chromium at 1280px survives on luck:
the shift is small enough that the release still lands on the card's own `<label>`, which
forwards the click. Reproduced on Linux WebKit in `mcr.microsoft.com/playwright:v1.62.1-noble`
and in Chromium at 320px. `nn-entry.spec.ts`'s "shows a running total once an entry type is
chosen" is the guard — it asserts that leaving a fee radio produces no message anywhere now
that there is no box to complain — and the rule is the general one: **a container's message
belongs to that container, not to a field nested inside it.**

**A conditional field that collapses moves the control that revealed it.** The same England
Athletics box — likewise gone, likewise still the rule — the same nesting, one layer up: it sat
_inside_ the affiliated card, so changing
to another entry type collapsed 277px from **above** the two cards below it. At 320px the card
somebody had just chosen went from y=271 to y=-7 — they tapped it, and the feedback for their
own tap was the page throwing them somewhere else. It is a plain `.field` under all three cards
now, where showing and hiding it moves only what is below and the cards do not move at all:
measured Δ0 in WebKit and Δ1px in Chromium — a pre-existing sub-pixel border swap — across all
48 combinations of engine, width, transition and input method. **Put a conditional field after
the group it is a condition of, rather than inside it.** The adjacency that buys is worth less
than the stability it costs, and the field's own hint can say what the nesting was saying.
`nn-entry.spec.ts`'s "keeps the entry type that was chosen in view when the fee changes" is the
guard, and it runs in all three projects. **The guide's six fields are the shape's third
outing** and are built the way this paragraph says: after the checkbox that reveals them, never
around it.

**A field's own validation message can shove a _later_ field out from under the click that was
about to answer it, and turning a `<select>` into radios is what makes that visible.** Measured
directly: leaving the phone number field with three spaces — invalid, the same way every other
"required but blank" test on this form gets past `required` — reveals "Enter your own phone
number." above the race-category question, shifting it down by about 28px, roughly one radio
row. A `<select>`'s `selectOption()` never cared; `.check()` on a radio resolves a click
coordinate first and is fragile to exactly this, which is why ADR-031's radios are what
surfaced a race that was already there. Reproduced 2 of 3 runs on `[mobile-safari]` only, same
`locator.check: Clicking the checkbox did not change its state` each time, gone 3 of 3 after
the fix below — the asymmetry with Chromium matches every other WebKit-only instance of this
shape already in this file. **Distinct from the England Athletics precedent above**: that was a
_conditional_ field's own reveal moving _itself_ or an adjacent _sibling_; this is an
_unconditional_, ordinary field's validation message — present on every field on this form —
shifting something _below_ it that the very next action is about to click. Moving the message
does not fix it, because the same race exists for any field pair filled in visual order; the
fix instead makes the reveal finish before the next click starts, rather than racing it as a
side effect of that click's own implicit blur. `fillEntry()`'s shared helper in
`nn-entry.spec.ts` now does `await phone.blur()` as its own awaited step immediately after
filling the phone field and before checking the race-category radio — for all ~23 tests that
call it, not only the one that first caught this, since the same shape of race is latent for
any field left in an invalid state right before an adjacent click, whether or not a current
test happens to exercise it.

**A navigation label is not free text, because the bar's height is what pays for a defect.** The
Nightingale Nightmare bar was unstuck by [ADR-012](docs/architecture/decisions/adr-012-one-navigation-bar.md)
over three defects and stuck again by [ADR-014](docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md),
which answers defect 2 — arrow-keyed radios landing behind the bar in WebKit at 320px — with
`scroll-padding-top`: a hand-written token per breakpoint that has to clear the bar's height at
**every** width. So a longer label is a layout change rather than a copy one. Renaming "Race day"
to **"Race instructions"** added **48px** — a whole second row — at every width from 768px to
1440px and again at 560px, putting the bar over its inset, which lands every anchor and every
keyboard focus behind the header. Nothing looks wrong; the page just stops scrolling to the thing
it was asked to scroll to. The page is still _headed_ "Race instructions" and the bar says **"Race
info"**, which measured identical to "Race day" at all thirteen widths — the bar has always been
allowed to be shorter than the heading, and read "Spectators" over "Watching the race" from the
day it was written. **"Spooktators" was free.** `site.spec.ts`'s nine-width sweep is the only
reason any of this was seen, and a check at 1280px and 320px would have passed every broken
version of it.

**A leak assertion that matches a bare numeric string against rendered HTML is unreliable, and it
fails towards passing.** Markup is full of arbitrary digits that belong to nobody: every inline
SVG here carries `xmlns="http://www.w3.org/2000/svg"`, and the path data under it is thousands of
coordinates. So `expect(html).not.toContain('2000')` can **never** pass on any page that renders
the club wordmark — while `not.toContain('1700')` passed for months, not because the amount was
absent but because that particular number happened not to collide. **The guard was testing
whether the current value clashed with decoration, not whether it leaked.** Two rules, and both
are needed: **strip decorative markup before matching** —
`(await page.content()).replace(/<svg[\s\S]*?<\/svg>/g, '')`, because decoration cannot hold
personal data — and **derive the expected value from the fixture rather than writing a literal**,
because a literal stops testing silently the moment the value moves. Deriving without stripping
fails loudly on the namespace; stripping without deriving goes quietly vacuous, which is the
worse of the two because the line still looks like coverage.
`nn-entry-complete.spec.ts`'s "a real session id reveals nothing about anybody either" is the
shape to copy.

### Environment, build and tooling, once more

**`osascript -e 'quit app "Docker"'` can return cleanly while `com.docker.backend` keeps
running**, and `open -a Docker` then reattaches to the same wedged instance rather than starting
a new one. The symptom is every `docker` command answering `500 Internal Server Error … check if
the server supports the requested API version`, which reads as a CLI/daemon version mismatch and
is not one — the backend is alive and the Linux VM behind it is dead. Two things give it away:
asking for a different API version changes the version in the message and not the 500, and
`pgrep -fl com.docker` shows backend processes older than the restart. **`pkill -f
com.docker.backend` before `open -a Docker` is what actually restarts it** — fifteen seconds,
against an hour of retrying `./dev check`. A laptop that sleeps mid-`./dev` is the reliable way
into this state, because it kills the Supabase containers under a daemon that stays up.

**A second `./dev test` on the same machine kills the first, and the symptom is a flaky suite
rather than a collision.** `stop_workers` kills by command-line pattern, machine-wide, with no
notion of which run owns what — `pkill -f "wrangler dev --port 8787"`, then a bare `pkill -f
workerd` — and `cmd_test` calls it _early_, right after the build. Those patterns are exactly
what Playwright's `webServer` block starts, so a run dispatched before the first has finished
takes the live run's servers out from under it: a handful of tests pass and the rest die on
SIGTERM, with nothing in the output naming the other run. The single `.dev/test.log` and the one
Supabase volume go the same way, so the transcript read afterwards is a mixture of both runs.
**The tell is `pgrep -fl 'dev test'` answering twice**, one of the two older than the failures
on screen. **Wait for the run that was dispatched** — this is the sharp edge of running tests
through a subagent, because a background run that looks slow is exactly what makes somebody
start another.

⚠️ **A merely _busy_ machine fails `./dev test` differently, and the signature reads as a
runtime bug rather than as load.** No second run is needed — parallel work of any kind is
enough. Measured on 30 August 2026 on one unchanged tree, twice each: run alongside a
ten-agent documentation sweep, the Worker layer died with **`Worker exited unexpectedly`
twice over and a Vite server timeout after 10000ms**, reporting **4 of 6 files and 105
tests**. Run alone on the same commit, the same command reported **11 files and 348 tests**
and the ordinary `.dev.vars` failure below. **Both numbers are real and only the second one
means anything.**

The trap is that the loaded signature names the `@cloudflare/vitest-pool-workers` pool and a
Vite timeout, so it invites a hunt through `vitest.worker.*.config.ts` for a configuration
fault that is not there — while the truncated count looks like a suite that shrank rather
than one that was killed. **The tell is a file count lower than eleven**, and the fix is to
stop everything else and run it again. Sequence the work rather than overlapping it: this is
the reason a test run and a subagent fan-out must not be dispatched in the same breath, and
`./dev check` is not exempt — it rebuilds the database under whatever else is reading it.

**`./dev test` fails one Worker test on any machine that has a Stripe key, and it is the
machine rather than the branch.** `tests/worker/admin/tester.test.ts`'s "gets the tester entry
type back still chosen" asserts **503** — the branch the Worker takes when no
`STRIPE_SECRET_KEY` is bound, where the submission was good and nothing was stored and nothing
was charged. `platform/apps/main/.dev.vars` is gitignored and holds exactly that key on any
machine somebody has set one up on, so the Worker reaches Stripe Checkout instead and answers
**303**. `AssertionError: expected 303 to be 503` under `vitest.worker.admin.config.ts` is the
whole signature, and it reads as a regression in the entry path when nothing has regressed:
**CI passes because CI has no `.dev.vars`.** The cost is not one test — `cmd_test` stops at the
Worker layer, so Playwright and axe never run at all and the acceptance layer reports nothing,
which is the half somebody was waiting on. **Moving `.dev.vars` aside and running again** is the
CI environment reproduced — and ⚠️ **that step belongs to a volunteer, never to an agent.** A
session working here does not move, rename, copy or read that file. It runs `./dev test`,
reports the `303` against the `503` as a fact about the machine, and says plainly that the
acceptance layer did not run — then stops. Closing the acceptance half of a definition of done
is a hand-run by one of the two people who own the key.

**The prohibition and the remedy are not in conflict, and reading them as one cost a round trip
on 30 August 2026.** "Never touch `.dev.vars`" scopes the _actor_, not the file: the file is
movable, and the person moving it is the one who put a live key on the machine. An agent that
works around this by renaming the file has taken a decision about a credential that was never
its own to take; an agent that reports the failure and halts has done the whole of its job.
**Do not retry and do not edit the test**: the failure is deterministic, and the test is
asserting the right thing about the right branch. When a volunteer does run it, rename the file
rather than copying it, so a live key is never on disk twice, and check its digest when you put
it back.

**`git fetch` fast-forwards local `main` here, so "branch off `main`" is not stable across a
fetch.** A session can read `main`, plan against it, fetch for some unrelated reason, and then
branch from a different commit than the one it inspected — with nothing in the output saying
the base moved. **The cost is a branch silently based on a different tree than the one that was
reviewed**, and it is worst where it is hardest to see: a diff that applies cleanly to either
base, a suite that went green against the older one, and a pull request carrying a verification
that no longer means what it claims. It has happened here — a branch cut from `main`, a fetch a
few steps later, and `main` by then two commits ahead, with those two adding `entries`
migrations underneath a branch whose green run predated them. **Re-check `git rev-parse main`
immediately before `git checkout -b`, and put the base SHA in the first commit message**, so
the tree a change was verified against is recorded rather than inferred.

**A UK phone number is eleven digits starting `0`, with no ten-digit exception, and a brief
that floats one is contradicting its own worked example.** The usability brief PR C shipped
against said to accept "11 digits beginning 0, or 10 digits beginning 0 for the handful of
old area codes that are genuinely 10" — and then, as its own example of a number that must be
_rejected_ as too short, gave `07700 90012`, which is itself ten digits. Both cannot be true
without a lookup table of which ten-digit numbers are genuinely valid, which is exactly the
dependency the same brief forbids (`libphonenumber` or equivalent). Eleven digits, no
exception, is the only reading that satisfies the brief's own example, and it matches the UK
numbering plan since the "phONEday" reforms anyway — a genuinely valid modern UK number is
never ten digits. `normalisePhone()` in `packages/shared/src/nn-entry.ts` carries the full
argument.

**`+44 (0)7700 900123` is a real, common way to write a UK number for an international
reader, and a normaliser that treats `+44` as always followed by ten digits will refuse it.**
The bracketed 0 is the trunk prefix — dialled at home, dropped abroad — and it survives
punctuation-stripping as an eleventh digit sitting right after the country code, which reads
as one digit too many unless it is explicitly recognised and dropped.
`packages/db/tests/entries-rules.test.ts` already used this exact shape as a fixture before
this was noticed, at the database layer, which does not validate phone shape at all — so
nothing failed until a form-level normaliser was checked against it.

---

## How the entries system behaves

**This used to be titled "What is not built yet."** Everything below is built — entries,
payment, the admin surface, the outbox, member accounts. ⚠️ **The one thing this section used
to end with as "genuinely not built" was the timing platform**, which is neither this section's
subject nor unbuilt any more; it has a section of its own as of 14 September 2026 —
[how the timing app behaves](#how-the-timing-app-behaves).

### Email and the outbox

**The confirmation email is built — #73 and
[ADR-021](docs/architecture/decisions/adr-021-the-club-tells-people-by-outbox.md).** The club
sends four messages about an entry, and **the obligation to send one is written in the same
transaction as the thing it is about**: an `after update` trigger on `entries.entry_purchases`
writes a row into `entries.email_outbox` when a place is paid for, refunded, or transferred —
two rows for a transfer, because the person it moved _away from_ has an address that exists
nowhere else once `purchaser_email` is overwritten. Delivery is separate and retryable, and
**since [ADR-032](docs/architecture/decisions/adr-032-an-email-is-sent-when-it-is-owed.md) it
happens as soon as the message is owed rather than at the next tick of a clock**:
`nudgeOutbox()` in `worker/index.ts` runs the drain from `ctx.waitUntil()` after the Stripe
webhook and after any POST under `/admin/`, which between them are every path that can enqueue
one. **The five-minute cron still calls the same drain and is now the retry net** — `waitUntil`
is a best effort and a `429` stops a batch, so anything left `pending` is picked up within five
minutes. ⚠️ **Removing that call makes a failed send permanent**, which is the one outcome the
outbox exists to rule out; and the cron may not be deleted for two further reasons that are
nothing to do with email — it also expires pending holds and applies the **published** medical
retention promise. **Nothing can lose a message**; it can only be late. **The outbox holds one piece of personal
data, an email address** — everything else a message needs is joined from the live tables at
send time, so it is not a second copy of an entry for retention to chase.

**Each of the four now carries an HTML part as well as text, since 31 August 2026 —
[ADR-026](docs/architecture/decisions/adr-026-an-html-part-joins-the-outbox-emails.md)
reverses the plain-text-only decision `worker/email.ts` had carried in a comment rather than a
record.** The text part is unchanged and stays authoritative; `worker/email-skin.ts` renders
the HTML from the same `OutboxMessage` the text reads, never from the text's own output, so the
two can disagree in presentation but never in which facts they state. It is a newsprint skin —
one card, one stamp, seven colours, three font stacks — with the design fidelity enforced by
`tests/unit/email-skin.test.ts` rather than left to review by eye. **The campaign banner is a
served image, not embedded**, at `apps/main/public/nn-email-banner-1080x566.png`; the file must
be committed before its URL resolves, which is a plain git step rather than a manual one. **The
Reply-To address moved off Gmail the same day** —
`20260831090000_entries_nn_reply_to_club_domain.sql` updates `entries.events.from_address` to
`nightingalenightmare@southvillerunningclub.co.uk`, the club-domain alias whose delivery into
`info@` was proven on 28 August 2026.

**There are two triggers, because a given place skips the transition the first one watches.**
`enqueue_entry_email()` is `after update` and its confirmation branch fires on
`pending`/`expired` → `paid` — which is right for a place that is _held_ and then paid for, and
never fires for one `create_manual_entry()` **inserts** already `paid`. So Kinsi's two
complimentary places and every visually impaired runner's guide were given a place and told
nothing at all, and the silence was total: nobody chases an email they were never told to
expect. `enqueue_entry_email_on_insert()` is the `after insert` half, guarded on
`new.status = 'paid'` — the 250 `pending` rows a full race inserts owe nobody anything — and it
**shares the update path's dedupe key**, so no place can be confirmed twice. A second trigger
rather than a fifth branch: all three existing branches compare `old` to `new`, and under
`after insert` there is no `old`. #150.

⚠️ **Two of the four templates quote an amount, and a given place is £0.** The confirmation said
_"we have received your payment of £0.00"_ and the cancellation said _"we have refunded £0.00 to
the card you paid with"_ — which names a card nobody gave, and sends somebody to check a
statement for a refund that is not coming. `worker/email.ts` branches on `amountPence === 0` for
both, and `tests/unit/email.test.ts` asserts the wording each way. Nothing else about the message
differs, because nothing else about the place does.

**A cancellation of a purchase that was never `paid` enqueues nothing, and that is written
rather than accidental.** `cancel_entry()` refuses only a purchase already `refunded`, so it
will take a `pending` or `expired` one to `refunded` — and the refund branch guards on
`old.status = 'paid'`. Right on the facts, since nothing was paid and so nothing was refunded,
and still silent; `entries-email-outbox.test.ts` asserts it both ways so the silence stays a
decision.

**Account mail has a reply line but still no `Reply-To` header, and the split is deliberate.**
GoTrue sends confirmations, magic links and password resets with no `Reply-To` field at all — it
has none — from a Resend _sending_ subdomain with no MX, so a reply bounces. The **confirmation**
is the one message whose body already lives in a file, `supabase/templates/confirmation.html`
declared at `auth.email.template.confirmation`, so it now names `info@southvillerunningclub.co.uk`
in prose. **Prose and not a `mailto:`**, because that file's own rule is one call to action and no
second link. Giving the other three a reply line means declaring new `[auth.email.template.*]`
blocks, which is the class of change that failed `supabase config push` on every merge from
25 August 2026 — so it waits for the Send Email Hook, **after 1 November**. #99, and the sharpest
case (_"I didn't change my password"_) is on the far side of that line.

⚠️ **Resend's free tier is 100 emails a day, account-wide, against 250 places** — shared with
every account email the site sends. On a busy entry day the queue will exceed it and the
remainder arrives the next day. That is a **decision the club took deliberately** over roughly
$20/month, not an oversight, and it is why the outbox exists at all.
[The runbook](docs/delivery/runbooks/entries-email.md) is what a volunteer reads when somebody
says they never heard anything, and **`/admin/emails/` is where they look** — the queue, the
figures, and a re-send button on a failed message. **It is in the navigation bar and has its own
two permissions since 29 August 2026**: `nn.email.read` opens the page and `nn.email.resend`
opens the buttons, gated the way `/admin/people/` is. It was built borrowing `nn.entry.read` and
`nn.entry.cancel`, which that migration's own header called the wrong answer — the write half
worst of all, because "may refund an entry somebody paid for" is a strange thing to have to hold
in order to answer _"I never got my confirmation"_. **A message that has already
been sent cannot be re-sent** — the club cannot un-send an email, and "I never got it" is far
more often a spam folder. ⚠️ **"Sent today" on that page counts entry emails only**: account
mail shares the Resend account and is not in the outbox, so the club's real usage against the
daily cap is higher than the figure shown, and the page says so.

### Rate limiting

**One rate-limiting rule is live, and it is the whole of the Cloudflare layer.**
`[auth.rate_limit]` in `packages/db/supabase/config.toml` is chosen rather than defaulted, with
a comment per value and `tests/unit/config.test.ts` asserting each — **and the trap that decides
those numbers is that "per IP address" is not the runner's address**: every GoTrue call the
account area makes is server-side, so a per-IP limit behind the Worker is a project-wide limit
and a tight number is a cap on the whole club. The per-person layer is Cloudflare's, recorded as
a reviewable artefact in `docs/reference/cloudflare-waf-rules.md`, and since **25 August 2026**
that layer is **C1**: one combined rule over every `POST` under `/account/`, `/admin/` and
`/nn/` except `/nn/stripe-webhook`, at **3 requests per 10 seconds, Block, 10-second
mitigation**. The race forms' rule and the four account rules are still in that table as **E1**
and **A1**–**A4**, and **not one of them was ever created**, because **the free plan allows
exactly one rate-limiting rule** — but the rule count was never the binding constraint. **The
plan caps both the period and the mitigation at 10 seconds**, which is the length A1 and A3
were argued from, so what exists is a burst brake on the entry form and close to nothing
against credential stuffing. **Whether the account endpoints justify a paid plan is the first
money question this platform has raised, and it is open.** The runbooks are `accounts-open.md`,
whose step 0.1 is what created C1 and whose remaining stop condition is step 0.3 — **nobody has
watched the rule fire** — and `entries-open.md`, whose step 0.1 was reconciled to C1 on 30
August 2026: it now says plainly not to go looking for E1, since it does not exist and never
will, and that C1's `/nn/` coverage is what already meets this step.

### The admin surface

**There is a staff backend at `/admin/`, and everything under it answers 404 to anybody who may
not be there.** Signed out, a plain `registered`, the wrong role, an address nobody built — all the
same ordinary not-found page, because a 403 discloses that the address exists. `/admin/nn/` reads
the entries for a running, the interest sign-ups, one medical note at a time, three CSV exports
and a printable start list; `/admin/people/` is who holds what, and where a role is granted. The
way in is an account holding `nn-admin`, `people-admin` or `super-admin`, checked per request
through `identity.my_roles()` and `identity.my_permissions()` —
[the admin runbook](docs/delivery/runbooks/entries-admin.md) has the addresses and the bootstrap.
**The sections are gated on permissions and the door is gated on roles**, and the split is
deliberate: `isStaff()` answers "is this person staff", which `nn-tester` must fail even though
it holds a permission. **`/admin/people/` has two readings and it is one page**: reading it is
`identity.person.read` and the controls on it are `identity.role.grant`, so a `people-admin` gets
the same table with no third column and a POST refused with the same 404.

**The two-key scheme is retired in the Worker, and the break-glass changed with it.** #58 moved
the surface off `/nn/admin` — every one of those addresses now redirects, 301 for a GET and 308
for a POST, because they were in a published runbook. Installing `ENTRIES_ADMIN_KEY` and a key
per volunteer opens nothing any more. **The thing to keep available is a second person holding
`nn-admin`**, which takes a minute at `/admin/people/` and no deploy. #57 left the four key-gated
database functions in place and #63 removes them; `worker/admin-session.ts` and `adminSignIn()`
are unreferenced and go with them.

**It is in the club brand, and `nn-theme.css` must never reach it.** A tool rather than a
page a runner reads, and it will serve Pass the Buck — so every colour is a `--colour-*` name and
there is not one hex value in `packages/shared/styles/nn-admin.css`, which
`packages/shared/tests/unit/admin-contrast.test.ts` asserts along with the contrast of every wash
the surface mixes. **The audit trail is on it now, scoped to one entry** —
[ADR-024](docs/architecture/decisions/adr-024-one-entry-in-full.md), which reverses the position
that it deliberately was not. Half the old argument expired with the two-key scheme — nothing
here is anon-callable any more, and `entries.admin_entry_detail()` is granted to `authenticated`
behind `nn.entry.read` — and the other half was that it is a decision, which this is. **It
returns only the rows that name one purchase**, so it is the history of a record rather than a
log of what each volunteer has been doing; there is still no way to read `admin_audit` as a
list, and adding one is a separate decision. The actor stays the pseudonym ADR-013 made it.

**There is a page per entry, behind every row** — `POST /admin/nn/entry/`. The list is a table
and a table can only carry what fits in a column, so the facts a volunteer needs on the phone
were the ones that did not fit: which address paid, when it settled, Stripe's references, the
emergency contact, the emails owed, every ask made, and what has been done to it. It is a
**purchase** rather than an entrant, for the reason the list is; it writes **no audit row**,
because it discloses what the list and the exports already do to the same permission; and it
returns **whether** there is a medical note and never the note, and `consent_version` and never
`consents`.

**A cancelled entry stays on `/admin/nn/`, with no runner on it.** `cancel_entry()` deletes the
entrants — deliberately, so the club stops holding personal data for a race somebody is not
running — and `read_entry_list()` inner-joined them, so a refunded purchase could not appear on
that page at all: the **Refunded** filter could never match a row, and a volunteer clicking it
concluded there had been no refunds. The list is purchase-driven with the entrant left joined
now, and a row with no runner reads "No runner recorded", exactly as `/account/entries/` has
always rendered the same purchase. **The counts were already right** — they read the purchase
grain — and **`holding` and the three exports keep their inner joins**, because capacity is
measured in runners and a start list has nobody to put on it. #116.

**The medical notes are deleted a month after the race, and every page that says so derives the
period.** `entries.events.medical_retention` is what the five-minute cron applies;
`packages/shared/src/medical-retention.ts` is the one module allowed to turn that interval into
words, through `medicalRetentionWording()` and the lower-cased `medicalRetentionClause()`;
`race.json`'s `privacy.medicalRetention` holds the wording and
`packages/db/tests/entries-retention.test.ts` fails unless it is what the interval generates.
**Changing either one alone goes red.**

⚠️ **This paragraph said "nothing published is tied to the enforced interval any more" and that
was never true** — issue #172, closed 31 August 2026. It was written about `/nn/privacy/`, which
did stop publishing a period when it became the committee's document word for word. **Two other
live pages went on stating one**, in hand-typed prose that imported nothing: `/nn/2026/` — _the
page the medical consent is ticked on_ — and `/account/data/`. They had already drifted from each
other in register, "one month" against "a month", which is the tell that nothing held them to a
source. Both derive it now:

|                  | Source                                                                          | Held by                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/nn/2026/`      | `entry_state()`'s `medical_retention`, painted onto the form by the Worker      | `entries-retention.test.ts` asserts `entry_state()` carries the column; `nn-entry-open.test.ts` asserts the words reach the markup |
| `/account/data/` | `current_entry_state('nn')`, one RPC on that page                               | `account.spec.ts` asserts the whole clause                                                                                         |
| `/admin/nn/`     | `read_entry_list()`'s figures, via `retentionWords()`                           | Was already derived                                                                                                                |
| `/nn/privacy/`   | **Publishes no period**, and that is the committee's document rather than a gap | `nn-privacy.spec.ts`                                                                                                               |

So the chain reaches a runner again. `race.json`'s key is still read by no page — it is what the
database test compares against — and publishing a period on `/nn/privacy/` again would still mean
asking the committee for wording _and_ establishing a tie of its own.

### Routing: a race and its runnings

**A race is the recurring thing; an event is one running of it in one year, and the routes say
so** — [ADR-011](docs/architecture/decisions/adr-011-a-race-and-its-runnings.md). Evergreen:
`/nn/` (the race, and the interest form), `/nn/privacy/` — and `/nn/course/`, whose
content is on `/nn/` now and whose address 301s there. The 2026 running:
`/nn/2026/` (the date, the facts, the entry form), `/nn/2026/race-day/`,
`/nn/2026/spectators/`, `/nn/2026/entry/complete/`. Plus a column-scoped anonymous-insert
policy on `intake.nn_interest`.

**`/nn/` never names a year, and nothing in its markup may.** It asks
`entries.current_entry_state('nn')` — the forthcoming running of race `nn`, else the most
recent past one — and the Worker paints every link to a year page onto it. Publishing 2027 is a
row in `entries.events` plus that year's content pages, with no edit to `/nn/` and none to the
Worker. `/nn/<year>/` is the event `nn-<year>`, and `worker/routing.ts` owns that convention as
two functions that are inverses of each other.

### The entry form and discount codes

**Entries are built here, in `apps/main`** — [ADR-009](docs/architecture/decisions/adr-009-entries-in-apps-main.md)
retired the plan to give them a repository of their own. **Both forms are on `/nn/2026/`**, and
a hidden `form` field is what tells them apart — this paragraph used to say the opposite on both
counts and was wrong on both. `/nn/` carries no form at all; a POST there falls past every
predicate to the assets binding and answers **405**. The page carries two states and the Worker
reveals one, decided per request rather than by a deploy.
⚠️ **`entries.events.entries_open_at` is set and production serves the entry form** — 110 of
250 places sold as at 7 September 2026. This paragraph said the opposite until then; see the
stop-and-ask list above for how that was confirmed and why it mattered. `entries_close_at` is set and changes none of that. **The shipped-visible half is the
safe default rather than an arbitrary one**: a page that cannot reach the database must not
offer to take money, so every failure lands on the state that asks for an email address.

**A valid entry holds a place and goes to Stripe Checkout.** One transaction under a
per-event advisory lock: **check the entry key**, re-check the window, count the places gone,
price it from `entries.fees`, refuse a total of zero, write a `pending` purchase with a
31-minute hold. Then a Checkout session for
exactly that amount and a 303 to it.

**The Left Handed Giant code exists, is minted by a migration, and is read off `/admin/nn/`.** 10%
off an unaffiliated entry, **25 places since 30 August 2026** — it was minted at 22 and raised by
`20260830120000_nn_2026_lhg_twenty_five_places.sql`, because raising a cap cannot conflict with
places already taken — `LHG-10-` plus twelve random characters. **The migration
carries the generator and never the value**, so every environment mints its own and none is in
this public repository — and `/admin/nn/`'s "Discount codes" panel is the only place it can be
read, which is how somebody finds out what to tell Left Handed Giant. The entries table carries a
**Code** column so who used it is a column you read down. See
[the runbook](docs/delivery/runbooks/entries-discount-codes.md).

**A discount code is priced before anything is held, and the code itself is never in this
repository.** `entries.discount_codes` was built in Slice A and left empty; it takes rows now,
and `fee_id` is new — _"10% off an unaffiliated entry"_ is two facts and `percent_off` was only
one of them, so a code scoped to a fee is refused against any other. **This repository is
public**, so a code in a migration is a published code: rows are inserted by hand from
[the runbook](docs/delivery/runbooks/entries-discount-codes.md), twelve characters from a
32-letter alphabet, and **the entropy is the only control** because no rate limiting is live
anywhere yet. A submission carrying a code is priced by `create_pending_purchase(p_preview =>
true)`, which runs every rule and **returns before the first write** — no place held, no use
spent — and the person confirms the total before Stripe. That is a ninth argument rather than a
fourteenth anon-callable function, and it is why this is **the one migration that drops a
function**: an extra defaulted parameter creates a second overload, and PostgREST would refuse
every call naming the original eight as ambiguous. **A use is returned when the place is** —
`expire_pending_holds()` on a lapsed hold, `cancel_entry()` on a refund — because it only ever
incremented before, so 25 abandoned checkouts would have exhausted the whole allocation with
nobody entered. **A 100% code is not the way to give a free place**: Stripe refuses a zero-total
session and will not charge below £0.30, which is what [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md) is the answer to.

### Rules enforced in the database

**Every rule is enforced in the database, and Zod is never the only place one lives.** Slice E
found `create_pending_purchase` writing `ea_number` without ever consulting
`fees.requires_ea_number` — so two PostgREST calls with the published anon key bought an
affiliated place with no England Athletics number, £2 under. Zod required it; **Zod is the
form's control, not the system's**. Slice G audited every rule by _attempting the bypass_ with
an anonymous client and found eight more, the worst being that the entry terms were not
enforced at all: `p_consents = {}` was accepted and stored as `{}`. All nine are closed — a
check constraint where the rule is static, a trigger where it spans tables, and the function
where a person needs words about it (`consents_missing`). **The England Athletics rule that
started all of this no longer exists**: the club stopped asking on 29 August 2026, so what
`entries-rules.test.ts` attempts there is the opposite bypass — post a number straight at
PostgREST with the published key and assert it reaches no column.
`packages/db/tests/entries-rules.test.ts` re-attempts each bypass and asserts the **specific**
refusal, because a Postgres error is not a refusal: a broken function refuses everything, which
reads as every rule holding at once. **The tenth rule is "one entry per runner", and it is the
first one a person is meant to meet.** The form claimed it in prose from the day it was written
and nothing enforced it, so somebody who already had a place could pay again and take a second
one out of 250 — #115. `create_pending_purchase()` now refuses with `already_entered`, keyed on
**first name, last name and date of birth**. ⚠️ **What it counts as a place changed on
12 September 2026 and the old answer is the one people remember**: it was `paid`, or `pending`
with a hold that had not lapsed. It is **`paid`** now, plus a live hold belonging to _somebody
else_ — because a live hold naming one of this submission's own people is **superseded** rather
than counted, which is [ADR-040](docs/architecture/decisions/adr-040-a-runners-own-hold-yields.md).
An expired hold and a cancelled entry have always let somebody try again; what did not was the
thirty-one minutes before a hold lapsed, and **that was the reported bug**. Somebody who reached
Stripe and did not pay was refused by both one-place rules and told _"this runner already has a
place in this race"_, which was false, with the page's only advice pointing at an empty
`/account/entries/`. By the time a volunteer looked, the sweep had run and `/admin/nn/` said
"Hold expired" — so the refusal got remembered against a status that never refused anything, and
"stop letting an expired entry block a new one" was a fix to code that already did that. **The
superseded hold is expired, its place and its discount use go back, and the runner's next
attempt goes through.** ⚠️ **It takes the address _and_ the runner together, and each half alone
was tried and broke something** — the address alone lets one partner on a shared card expire the
other's live hold mid-checkout, and the runner alone let a **stranger** do it by entering with
that person as their visually impaired guide, which `entries-guides.test.ts` caught as an
accepted duplicate. So only the person coming back to their own abandoned checkout supersedes
anything, **no existing test needed its fixtures changed**, and `create_manual_entry()` and
`transfer_entry()` are deliberately unchanged. **Not
`purchaser_email`** — that was the original decision, and it has been overruled; see the rule
below. The check sits inside the per-event advisory lock, and
**every database fixture that enters more than once now carries a serial on the surname**,
because a suite whose runners are all the same person cannot hold two places any more.

**The eleventh rule is "one place per email address", and it reverses a written decision.**
`20260827090000`'s own header argued the address was the wrong key because _one card
legitimately pays for a partner, and refusing that would cost a real runner a place_. The club
overruled that on **30 August 2026**, and
`20260830160000_entries_one_place_per_email.sql` refuses a second live place on one address
with `email_already_entered` — on the entry path **and** in `transfer_entry()`, because
otherwise the transfer form is the way round the entry form. ⚠️ **The cost is accepted rather
than solved**: a couple on one card, a parent entering two children, and anybody entering for
somebody with no address of their own are refused at the moment they pay. **If that starts
happening the answer is to revisit the decision, not to add an exception to the function.**
⚠️ **ADR-040 is not that exception, and the distinction is the whole of why it was written the
way it was.** It narrows which _rows_ both rules count — a live hold whose purchaser is this
submission's own, naming one of this submission's own people — and it lets nobody new in: a
**different** runner on an address that already holds a place is refused exactly as they were on
30 August 2026, and the couple on one card still pay the full cost of that rule.
**`create_manual_entry()` is deliberately exempt** — giving a place away is a volunteer
deciding one at a time, and the club's complimentary places and a visually impaired runner's
guide are exactly what a blanket address rule would refuse. **Name and date of birth stay**:
the two rules overlap and neither subsumes the other, so `already_entered` still catches the
same runner re-submitting under a different address. **The fixtures carry a serial on the
address now as well as on the surname**, for the same reason.

**A signed-in buyer's `purchaser_email` comes from their session, not from the form.** It came
straight off the form for everybody, so somebody signed in could type any address — and every
consequence lands where they cannot see it: the confirmation, the refund notice, both sides of
a transfer and Stripe's receipt all go to `purchaser_email`, and `my_entries()` matches on
`person_id` **or** that address, so a typo hands the second arm to a stranger. The entry still
appeared on their own account through `person_id`, which is what made it invisible. The Worker
reads the confirmed address with `auth.getUser()` on the POST and ignores the box. **With the
rule above, the two together mean somebody signed in holds one place and cannot enter on
anybody else's behalf** — they sign out, or the club gives the place from `/admin/nn/`. **Which consents an event requires is
`events.required_consents`**, not a constant — the set differs between races. **Four check
constraints ship `NOT VALID`** and protect every new write; validating them against the rows
already there is [a runbook](docs/delivery/runbooks/entries-constraints.md), because a
validated `ADD CONSTRAINT` fails the migration if one existing row disagrees and nobody here
can see production's.

### The webhook and payment confirmation

**`POST /nn/stripe-webhook` is the only thing that writes `paid`, and nothing else may.** The
redirect back from Stripe is not proof of payment — a tab can be closed before it fires, and the
return URL is one anybody can type. The webhook verifies Stripe's signature over the **raw
bytes** before parsing them, and the transition is idempotent by state guard under the same
per-event advisory lock the entry path takes. [ADR-010](docs/architecture/decisions/adr-010-webhook-writes-paid.md)
records the three decisions it took.

**The failure direction is inverted there, and only there.** Everything else in this repository
fails towards taking no money. By the time the webhook runs, the money has gone — so _our_
failures answer 5xx and let Stripe retry for three days, and only "this is not Stripe" gets a 400. A 200 on an outage drops a real payment.

**A payment that arrives after the hold lapsed is still `paid`.** It is never refused. If there
was no room it is `paid` with `attention = 'over_capacity'`, it consumes a place, and the
five-minute cron shouts about it until a human clears the flag —
[the runbook](docs/delivery/runbooks/entries-attention.md). There is deliberately **no fifth
status**: the capacity predicate counts `status = 'paid'`, and a new value would be invisible to
it and let an oversold place be sold twice.

**`/nn/<year>/entry/complete/` reports what the club has recorded, and only `paid` makes a
positive claim.** No state ever makes a negative one — a lapsed hold must never say "nothing was
charged", because the webhook may simply be late and somebody who believes it pays twice.

### Database grants: anon and authenticated

**The anon role still holds no grant on any table in `entries`.** It may call **sixteen**
functions and nothing else — the eight the entry and payment path needs, the six the admin
surface added, and the two the outbox's drain added later:

|                          |                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Public configuration** | `entry_state()`, `current_entry_state()`, `entry_completion_state()`, `places_remaining()`                                         |
| **The entry path**       | `create_pending_purchase()` — **takes a key**, since #178 — and `attach_checkout_session()`                                        |
| **Housekeeping**         | `expire_pending_holds()`, `delete_expired_medical_notes()`                                                                         |
| **Payment**              | `record_checkout_event()` — **takes a key**                                                                                        |
| **The admin surface**    | `admin_sign_in()`, `admin_entry_list()`, `admin_interest_list()`, `admin_entrant_medical()`, `admin_export()` — **all take a key** |
| **The outbox drain**     | `claim_outbox_batch()`, `record_send_result()` — **both take the webhook key**                                                     |

**Do not trust this table's count going forward** — it has already changed three times (from
seven, to thirteen, to fifteen, to sixteen) and `packages/db/tests/entries.test.ts` is what
actually asserts the current list by name; read that rather than this table when it matters.

**Six are granted to nobody**: `raise_attention()` writes the flag that says a purchase needs a
human, `admin_key_ok()` answers whether a string is the admin key, and `record_admin_action()`
writes the audit trail. Each would be a hole on its own — an alarm anybody could forge, an oracle
for the key, an audit trail anybody could fill — and all three are reachable only from the
definer functions that call them. **The other three are Slice G's rule enforcement** —
`assert_entrant_rules()`, `assert_medical_consent()` and `assert_purchase_consents()` — reachable
only from their triggers, and each reads a purchase, an entrant or a medical consent.

`packages/db/tests/entries.test.ts` asserts that exact set. If it fails, something granted a
privilege to a key that is published in page source. **Adding to that list is a decision, and the
test is what forces it to be made in a diff** — it has happened twice: `current_entry_state()`,
which discloses nothing `entry_state()` does not, and the admin surface's six, argued in
[ADR-013](docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md).

**`authenticated` is a second list: six, then eleven in #107, then twelve, then fourteen, then
sixteen** — the last being `admin_entry_detail()`, ADR-024's — **and eighteen now**, the
seventeenth an intermediate addition this paragraph never named and the eighteenth
`places_remaining()`, granted alongside `anon` for the reason `entry_state()` and
`current_entry_state()` already are: it answers the same public figure whichever role is
asking. `packages/db/tests/entries.test.ts` is the assertion that is actually load-bearing
here; this prose is a summary of it, not the other way round. It is a role
anybody who registers holds, so every function on it authorises inside itself and the grant only
says "you may ask". `create_pending_purchase()` and `attach_checkout_session()` are there because
a signed-in caller reaches PostgREST as `authenticated` rather than as `anon` — **not** because a
signed-in caller may do more. `my_entries()` is scoped to `auth.uid()` and the caller's confirmed
address; `cancellable_purchase()` and `cancel_entry()` refuse without `nn.entry.cancel`.

### Entry requests: asking to cancel or transfer

**A twelfth arrived with the entry-request slice, and it is the first one a runner rather
than a volunteer calls.** `request_entry_action()` records that somebody has asked the club
to cancel or transfer one of their own paid entries, and **performs neither** — cancelling is
`cancel_entry()` behind `nn.entry.cancel`, and transferring has no implementation at all.
Ownership is re-derived from `auth.uid()` and the caller's confirmed address, **never from
the purchase id it is given**: that is printed on the confirmation page and on
`/account/entries/`, and it is not a credential. "Not yours", "not there" and "not paid" all
answer `no_such_entry`, so a reference cannot be used to learn whether it names somebody
else's entry.

**Transferring a place is built, and it means one thing: the runner changes and nothing
else does.** `transfer_entry()` replaces the entrant, re-points `purchaser_email` at the new
person and sets `person_id` **null** — the state a signed-out purchase sits in, so the entry
appears on their account the moment that address registers and confirms. **No account is
created**, for the reason the entry path gives. **No money moves**, so the place never returns
to the pool and cannot be taken by somebody else in between. It **deletes the previous
runner's medical note**: a note belongs to whoever wrote it, and carrying one across would file
a stranger's condition under a new name. And it
**re-applies the minimum age and one-runner-one-place**, so a transfer cannot be the way round
either. It reuses `nn.entry.cancel` rather than adding a permission of its own; a dedicated
`nn.entry.transfer` is the cleaner answer and is still a decision nobody has taken. **The
eighth permission exists now and it is not this one** — `nn.entry.create`, which gives a place
away rather than moving one, and which was argued as its own permission precisely because
adding a runner to a course with a hard limit is a different power from undoing an entry
somebody bought. See [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md).

**A request is not a status, and that is load-bearing.** `requested_action` is its own column
beside `attention` rather than a sixth value of `status`, because the capacity predicate
counts `status = 'paid'` — an entry somebody has asked to cancel still holds its place until
a volunteer acts, and a new status would make that place invisible to the count and sellable
twice.

**And a request is a list, not a word, since 29 August 2026.** `requested_action` held one, so a
runner who pressed _Transfer_, thought better of it and pressed _Cancel_ left a record saying
only the second — and the two want opposite things, so a volunteer seeing one of them acts on
the wrong one about half the time. `entries.entry_requests` is the append-only record of every
ask; the columns stay, holding the most recent, because the **Asked about** filter and every
deployed reader use them. **Resolution is a fact about the entry rather than about one ask** —
there is no act that answers one and leaves another open — so a trigger on
`request_resolved_at` closes every open row at once, which is what lets `cancel_entry()` and
`transfer_entry()` stay exactly as they are. **An ask knows whose it is, since 30 August 2026, and that closed a disclosure.**
`transfer_entry()` re-points `purchaser_email` and nulls `person_id`; `my_entries()` matches a
purchase on exactly those two things — so the runner a place moved **to** was shown the whole
request history of the runner it came **from**, addressed to them in the second person, free
text and all. The reason box is 500 characters of anything. `entry_requests.owner_email` and
`owner_person_id` are stamped at ask time and `my_entries()` filters on them — chosen over a
`transferred_at` column because it is **the only mechanism that survives a place changing hands
twice**: a clock answers _"was this made before the transfer"_, which is a proxy, and an owner
answers _"whose was it"_, which is the question. **The three summary keys are derived from the
owned asks too, not read off the purchase columns**, and that half is not optional —
`transfer_entry()` keeps `request_reason` deliberately, and `asksFor()` falls back to those
columns, so filtering only the list rendered nothing _by luck_. **`/admin/nn/` is untouched and
still sees every ask**, because it is the record of why the place moved. #148, ADR pending.

**Nothing in the schema acts on a request**, and the admin surface deliberately offers
no transfer button until the club asked for one — see the paragraph above, which is what
that ask turned into. **The email half is built now, and it is not this** — #73 sends on what a
volunteer _does_, never on what a runner asks for. Requesting a cancellation still tells nobody
by email; the message goes when somebody acts on it.

### Admin filtering, and the runner's own record

**`/admin/nn/` filters on sets, and by default leaves out everybody who is not running** —
`fee:tester`, `status:refunded` and `status:expired`, which on a race that fills are most of the
rows and none of the work. **An explicit `?status=` overrules the default and never overrules a
`hide=` somebody chose**: without that split, pressing the **Hold expired** chip returned an
empty table, which is a filter that can never match and is exactly how the Refunded filter once
convinced a volunteer there had been no refunds. Two lines under the chips name what is missing
and link to the view including it.

**The page also counts the field by category** — the four bands, the two honest non-answers, and
guides beside them rather than inside one. Counted off the rows rather than asked of the
database, because the band a runner falls in is named by `packages/shared/src/age-category.ts`
and by nothing else.

**There is an Email column since 31 August 2026, and which address it shows is decided per row
rather than per purchase.** A runner's is `entry_purchases.purchaser_email`; a **guide's** is
their own `entrants.email`, because a guide has no purchase of their own — so
`read_entry_list()` resolves it in a `case` and the page prints what it resolved. **Showing the
buyer's address beside a guide's name is the one wrong answer**, on the page a volunteer rings
people from, and a null is rendered as a dash rather than filled from anywhere else. A cancelled
entry has no entrant at all and keeps the address that paid, which is the address the refund
notice went to. It is `admin-col-wide admin-break`, so it folds into the runner cell below 48rem
with the other five — an address is the longest value in the table and a fourth column at 320px
is what starts the whole page sliding sideways. ADR-024 named the address that paid as one of
the facts that did not fit in a column and built `/admin/nn/entry/` for them; **this reverses
that for one field**, because telling two runners of the same name apart is done while reading
the list. No new column is collected and no new audience sees one — it is already on the entry
page and in two exports behind the same permission.
[#183](https://github.com/southville-running-club/src-website/issues/183).

**The medical sheet has a printable page as well as a CSV**, at `POST /admin/nn/medical-sheet/`
— the same read and the same `medical_export` audit row. The start list has had one since it was
written; the more sensitive of the two documents had only a file, and what a machine does with a
downloaded `.csv` is not the club's to control.

**A request carries the reason somebody gave**, in `entry_purchases.request_reason`: optional,
capped at 500 characters, read on `/admin/nn/` and on the asker's own `/account/entries/` and
**nowhere else** — never exported, for the reason `gender_identity` is not. `/account/entries/`
states the club's position on refunds _above_ the box rather than after the button: not the first
answer, looked at case by case.

**An affiliated place transfers like any other now, and it could not before.**
`transfer_entry()` cleared the previous runner's England Athletics number unconditionally, which
`assert_entrant_rules()` refused on an affiliated entry — so **every affiliated transfer raised a
`check_violation` that reached a volunteer as _"the club's database could not be reached"_**, on a
database that was perfectly healthy. Asking the new runner for a number of their own was what
closed that, as a tenth argument with the nine-argument form kept as a wrapper. The club then
stopped asking for numbers at all, so no fee requires one, the refusal is unreachable and the
argument is dead weight — **both go at the contract step**, which is the one still owing.

The rest of the filtering: Status and entry
type are multi-select, carried as repeated query parameters so a filtered view is a URL
somebody can send to the other volunteer; an empty set means every value. Exclusion is
`hide`, namespaced — `hide=fee:tester`, `hide=status:refunded` — and `hide=none` is how
"leave nothing out" is written, because absent and empty would otherwise mean opposite
things. A tester's place is still real and still counted; it is simply not what somebody
opens that page to look at.

**`/account/entries/`'s open view shows confirmed places and nothing else.** A lapsed attempt
beside a real ticket makes the page look broken, so a ticket is the only thing on that view.
Same rule as `/nn/<year>/entry/complete/`, which may not make a negative claim either, applied
to a list. Every entry carries a reference, because somebody emailing the club had nothing to
name one by.

**That reference is `NN2026-0042-01092026` since 31 August 2026, and it was a 36-character
purchase id** — [ADR-030](docs/architecture/decisions/adr-030-an-entry-has-a-reference-somebody-can-read-out.md).
`entries.entry_purchases.entry_no` is a per-event number issued by a `before insert` trigger from
a high-water mark on `entries.events.next_entry_no` — a **trigger** because two functions insert a
purchase and a third would write a null, and a **counter** rather than `max() + 1` because a
reference already emailed to somebody may never come to mean a different entry. ⚠️
**`formatEntryReference()` in `packages/shared/src/entry-reference.ts` is the one place those
parts become text**, for `formatPence()`'s reason: the string is quoted back at the club, so
`/account/entries/`, the four outbox emails, `/admin/nn/entry/` and the attention queue have to
print the same characters. **No SQL renders it** — the date in it is the London day, and this
repository has exactly one path timezone conversion may take. The **purchase id stays on
`/admin/nn/entry/` and nowhere else**, because that is where a payment is reconciled and Stripe's
metadata and every audit row key on it. `entry_no` is nullable and the render function falls back
to the id, which is the expand step and is why no reference already in somebody's inbox is
invalidated.

⚠️ **What may never be dropped is the note that replaces them.** Hiding a lapsed hold with
nothing in its place shows an empty page to somebody whose payment succeeded while the webhook
was late — they read that as nothing having been taken, and enter again. So when there is no
confirmed place and there _is_ a lapsed one, the open view carries a note that names the state,
says in full that a payment can arrive after the page that took it gave up and to get in touch
rather than entering twice, and links to where the entry is filed. **The note is the pay-twice
guard, not a signpost**: it carries that sentence itself rather than deferring it to the card,
because the card is now one click away and the default address is where doing nothing lands.

**A cancelled entry has a view of its own since 30 August 2026, and the rule above is why it
needed one.** Showing non-confirmed entries only when there are none confirmed meant a runner
who cancelled one entry and kept another had **no record of the cancellation on the club's site
at all**. `?show=cancelled` is the second view — **a URL filter rather than tabs or a second
page**, for the reason `/admin/nn/`'s filters are: it works with scripting off, and a filtered
view is a URL somebody can send while helping a runner work out what happened. An empty
Cancelled view says **"Nothing here"** and never _"you have never cancelled an entry"_, which is
a claim about a record. #148.

**A lapsed hold is filed under Cancelled, and that reverses the position this paragraph used to
state.** It sat underneath _whichever_ view was open, shown only when there were no confirmed
places — which meant `?show=cancelled` with nothing cancelled said "Nothing here" and then
rendered a not-completed entry directly beneath it. Asked for and decided on 30 August 2026: a
not-completed entry goes in the Cancelled view. ⚠️ **It is not a cancellation, and the heading
can therefore be wrong about it in the expensive direction** — the webhook may be late, the
place may in fact be paid for, and a runner who believes their entry is gone enters again. Two
things pay for that and **neither may be removed without putting the other back**: the card's
own status sentence still says only what it knows (_not completed in time; if you were charged,
get in touch before entering again_), and the open view carries the note described above. The
lapsed card is rendered quiet and _after_ the refunds, because a refund happened and a lapsed
hold merely failed to complete.

### The tester role, and the Stripe key swap

**Two functions in `entries` now answer differently depending on who is asking, and that is new.**
`entry_state()` hides a fee whose `requires_permission` the caller does not hold, and
`create_pending_purchase()` admits a `pre_open` event for a caller holding `nn.entry.before_open`.
Both resolve that through `auth.uid()` and **never through anything the caller passes** — a
parameter would be a free early entry for anybody who reads the page source. `entries_close_at`
and `active` are never bypassed. `packages/db/tests/entries-tester.test.ts` re-attempts every one
of those bypasses anonymously and as a signed-in person holding nothing.

**Seven functions take a key, and the key is what makes an anon grant safe.** Without one, two
ordinary PostgREST calls with the published anon key would buy a free entry, because
`create_pending_purchase()` issues purchase ids on request — and the five admin reads would hand
anybody the club's entry list. `ENTRIES_WEBHOOK_KEY` and `ENTRIES_ADMIN_KEY` are **Worker
secrets**; `entries.webhook_secrets` holds only their SHA-256 digests, and both ship null, which
refuses everything. ⚠️ **That is the table at rest and not the whole path, and issue
[#21](https://github.com/southville-running-club/src-website/issues/21) is where the difference
was written down.** A key a function *takes* arrives as an **argument** — in an RPC body, bound
into a statement — so "the database holds only the digest" is true of the table and is not a
claim about where the value has been. **Postgres statement logging was checked on 30 August 2026
and captures none of it**; whether Supabase's API request logs retain the body is **unverified**,
and [the attention runbook](docs/delivery/runbooks/entries-attention.md#the-webhook-key-travels-as-an-rpc-argument--one-check-still-owed)
owns that check, who does it, and the rotation it would call for. **Not a redesign** — moving the
key out of the argument list means a second Postgres role and a hand-minted JWT, which ADR-010
weighed and declined.

⚠️ **The seventh arrived on 31 August 2026 and it is `create_pending_purchase()` itself —
[ADR-029](docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md), issue #178.** That
sentence above was always about two halves and only the confirming one was ever built. Holding a
place is granted to `anon` — it must be, a signed-out runner reaches PostgREST as `anon` — and it
holds a place _before_ any money moves, with a live `pending` hold counting against the 250. So a
loop with the key printed in every page's source took the whole field in **half a second, for
nothing**: measured at 249 holds in 0.5s, with the next real runner refused `sold_out`.
Cloudflare's C1 never saw it, because PostgREST is a different origin from the Worker.
`ENTRIES_ENTRY_KEY` is the third Worker secret and a **third row** in `webhook_secrets` — one key
opening two doors is one rotation closing both. **The anon grant list is unchanged at thirteen**;
what changed is how many of the thirteen demand a key, and `entries.test.ts` asserts that second
list too. **The digest ships null and refuses everything**, so the entries-open runbook's
[step 0.8](docs/delivery/runbooks/entries-open.md#08--the-entry-key-must-be-installed-and-verified)
installs it **before** `entries_open_at` is set — the other order is a window that is open and
unprotected. **A £0 total is refused in the database too** (`free_place`), which the Worker
already did and the database did not; `vi_guide` deliberately keeps its price and its place in
`entry_state()`, because gating the fee would close nothing the key does not and would retire the
Worker's own free-place backstop with it.

**`delete_expired_medical_notes()` is the one anon-callable function that takes no key, and that
is deliberate.** It can only delete what `/nn/privacy/` has published a promise to delete, it
takes no arguments and returns a count — and gating it would make a legal retention obligation
stop being kept on any day the admin key was not installed.

**Somebody holding `nn-tester` can enter before entries open, and that is how the payment path
gets tested without touching `entries_open_at`.** The role carries one permission,
`nn.entry.before_open`, and it opens exactly one thing: `/nn/2026/` shows the entry form with a
notice saying why, and `create_pending_purchase()` admits a `pre_open` event. There is a £1
**Tester** fee on `nn-2026` gated by the same permission — invisible in `entry_state()` and
refused with `invalid_fee` by anybody else — so a real card can prove the club's live Stripe
account for a pound. **£1 rather than a penny because Stripe will not charge below £0.30 in
GBP** — a fee under that floor passes the free-place guard, holds a place, and only then fails
at the session call. **The Worker signs those two calls with the person's own token**, through
`createUserClient`, because the whole thing resolves through `auth.uid()`; a signed-out visitor's
path is unchanged and costs nothing extra. A tester's entry is a **real** entry: it consumes a
place, appears in `/admin/nn/`, in the exports and on the start list, and it is removed with the
cancel button rather than excluded from the thing it is testing.

**Production runs on Stripe _test_ keys until entries open, and that is safe rather than
sloppy** — the only person who can reach Checkout before 1 September is somebody the club granted
`nn-tester` to. Swapping `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to live keys is the last
manual step before the window opens, and it is in the entries-open runbook.

⚠️ **Nothing may be left `paid` across that swap, and this has already cost one real payment.**
Stripe's two modes are separate object graphs, so a key of one mode cannot refund a payment
intent of the other — and the cancel path is Stripe first, the record second, so a mode mismatch
answers _"Nothing was cancelled"_ on a database that is perfectly healthy and leaves the place
consumed for ever. A live payment taken on 27 August 2026 is still stranded that way (#118 item
7), and the only occasion it can be cancelled at all is while the live pair is bound. **The
failure is indistinguishable on the page from a restricted key missing Refunds — Write**, which
is a second per-key fact that cannot be inferred from the other pair; the Worker log's status and
Stripe `code=` are what tell them apart. Both, and the reason a hand refund in the dashboard
makes the row permanently unreconcilable, are in
[the key-swap runbook](docs/delivery/runbooks/entries-stripe-keys.md).

### Sessions

**`/account/entries/` is what tells a runner they have a place**, alongside the confirmation
email #73 sends and Stripe's own receipt. It reads `entries.my_entries()`, which matches on
`person_id` — set when the buyer happened to be signed in — **or** on a `purchaser_email` equal to
the caller's confirmed address. **An account is not required to enter and is never created by
entering**: auto-creating one would write an unconfirmed `auth.users` row and grant it the signup
role, which is a false statement in the table whose job is to say who somebody is.

**A session ends on its own — thirty minutes idle, twelve hours absolute** —
[ADR-019](docs/architecture/decisions/adr-019-a-session-ends-on-its-own.md). It used to be
thirty days, which was Supabase's default rather than a decision, and one cookie jar opens
`/account/` and `/admin/` alike. **A session is three cookies now, not two**: `src_ax` carries
the absolute deadline, and a session arriving without a readable one is ended rather than given
one — so every fixture and every hand-built `Cookie` header that means "signed in" has to say
all three. **Only an authentication mints a deadline**; a refresh carries the existing one
forward, and the Worker cross-checks it against the authentication time GoTrue signs into the
access token's `amr` claim, which is the half a stolen cookie jar cannot forge. Reaching either
deadline calls Supabase's `/logout`, so an expiry revokes rather than forgets. **GoTrue does
both of these itself on a Pro plan and the club is on the free tier** — putting them in
`[auth]` anyway would be refused, and there is no partial apply.

**A free place cannot be completed through the entry form, and that gap is answered rather
than open.** Stripe refuses a zero-total Checkout session, so a discount code can never
produce a £0 entry on its own. The answer is [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md),
28 August 2026: somebody holding `nn.entry.create` assigns a **complimentary** place from
`/admin/nn/` — a `paid` purchase at £0 on a £0 fee, audited, under the same advisory lock,
re-checking capacity, the minimum age and one-runner-one-place. It is what the two Kinsi
places and a visually impaired runner's guide's place both use now.

### What is genuinely not built

**Nothing, on the entries path.** Everything above is built, live and selling places. What this
subsection used to hold was two hundred lines about the *timing* platform, under a heading that
was accurate when none of it existed — read
[how the timing app behaves](#how-the-timing-app-behaves) below instead, which is where that
moved on 14 September 2026 and which carries its own "not built" list.

**The section after that one is the same kind of thing and is also built and live**: `store`,
tickets to the club's socials, added 5 September 2026. It has its own list of what it
deliberately does not do yet, which is worth reading before assuming a missing button is a
defect.

---

## How the timing app behaves

**A race is timed here now, end to end.** Under
[ADR-034](docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
the platform is **rewritten in this repository** rather than moved, so writing `timing` tables,
the ported logic in `packages/shared/src/timing/` and `apps/timing` is ordinary work. Reaching
into `bindalshah/src-race-timing` is still a stop-and-ask.

⚠️ **This was a bullet list under "What is genuinely not built" until 14 September 2026, and the
shape was the problem rather than the contents.** Rungs 0 to 4 of
[#257](https://github.com/southville-running-club/src-website/issues/257) are complete; a heading
saying otherwise is exactly the staleness this file keeps paying for elsewhere.

### The two rules the rest of it follows from

**1. Finishing a race is not publishing it, and neither is a cut-off.** `finished_at` is a label
`timing.event.manage` sets and can unset, gating nothing — `record_crossing()`, the resolution
functions and `set_race_status()` are all untouched by it, because the last runner crosses after
somebody has called the race over. Publication is a second act by
`timing.result.publish`, refused `not_finished` while the label is absent and `open_anomalies`
while anything is on the triage list.
[ADR-042](docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
**A correction after publication is _unpublish, fix, publish_**, and `/nn/<year>/results/`
answers 404 to the public in between rather than serving a table somebody is editing.

**2. Every address under `/timing` is refused unless a row says otherwise, and a page never
refuses itself.** `lib/access.ts` is the table of which permission each address demands;
`middleware.ts` is the one place that enforces it; an address with no row is refused rather than
opened. Nothing here is anon-callable except the two functions the published results page needs,
and `/timing/health` is public so the smoke test can read it. ADR-036, ADR-037, and #243 for the
measurement that says a page here provably cannot refuse.

⚠️ **So there are two not-found answers under `/timing` and they carry two different status
codes** — [ADR-044](docs/architecture/decisions/adr-044-a-missing-race-under-timing-answers-200.md),
and a test asserting the wrong one of them has already been written and failed on all three
engines. A **refusal** is rewritten to an address matching no route, so Next serves its
_prerendered_ not-found page with a real **404**. A caller who **holds the permission and names a
race that does not exist** gets past the door, the page's own read answers `none`, and the page
renders `app/not-found-body.tsx` with a **200** — because `notFound()` from a dynamic render is
the blank shell #243 measured, so a page with nothing to show renders, and a render is a 200. The
**one exception is `/timing/marshal/<slug>/`**, which answers 404 for a missing race because its
door already reads the roster and that read answers existence on the way past. **The bodies are
identical and only the status differs**: one component renders both, and `timing.spec.ts`'s
`expectNotFoundPage` asserts the status, the heading and the sentence for all ten. Making the two
agree everywhere means the door learning whether a slug names a race, which is a second Supabase
call on every event page view and a thirty-sixth granted `timing` function — declined, with the
conditions that would change that in the record.

### Running one: the runbook is the document, not this file

⚠️ **[The race-night runbook](docs/delivery/runbooks/timing-race-night.md) is what somebody
follows on the day**, in six phases from the change freeze to the morning after — the roster, the
entry list, the start, what a marshal's card states mean, finishing, publishing, and a correction
afterwards. [Getting in](docs/delivery/runbooks/timing-access.md) is the other one: nobody carries
over from the old platform, and a granted marshal who is not on a race's roster gets the ordinary
404.

**Do not restate either of them here.** What belongs in this file is the reasoning a change has
to not break; what belongs there is the order somebody presses things in, and the two go stale at
different rates.

### The surfaces, and what each of them decided

- the **`timing` schema** — six tables, RLS on with no policy (ADR-035);
- the **pure logic**, ported with its assertions, in `packages/shared/src/timing/` — bibs,
  anomalies, results, awards, categories and the registration parser;
- **`apps/timing`**, no longer a holding page: `/timing/events/` lists the races and
  `/timing/events/<slug>/` is one race's hub (#247), and `/timing/events/<slug>/marshals/` is
  the roster (#245) — each address behind its **own** permission, mapped in
  `apps/timing/lib/access.ts` and enforced in `middleware.ts`, never checked by the page
  (ADR-036, ADR-037, and #243 for why a page here provably cannot refuse). ⚠️ **The roster page
  is also the first thing under `/timing` that writes anything**, and the shape it set is a
  plain `<form method="post">` answered by a route handler and a 303 — not a Server Action —
  because every spec here runs in a `no-javascript` project; `EVENT_SECTION_ACTIONS` in that
  same file is what gates the address a form posts to;
- **`/timing/events/<slug>/start/`** — the countdown, the one full-width button and the clock
  after it (#250), behind `timing.event.manage`. ⚠️ **`timing.start_event()` is idempotent by
  its own `where actually_started_at is null`**, not by anything a caller does: the second of
  two presses is answered `already_started` **carrying the winning time**, so the losing device
  shows the same moment rather than an error. `timing.clear_start()` undoes a false start and
  is **refused the moment any crossing exists**, because a split is measured against
  `coalesce(actually_started_at, start_at)`. A clock reaching zero starts nothing — `now()` is
  stored and `start_at` is never read;
- **`/timing/marshal/<slug>/`** — the capture screen (#203), behind `timing.crossing.record`
  **and** a `timing.marshals` row for that race. ⚠️ **It is the one surface on this platform
  that genuinely needs JavaScript**, because an offline queue in IndexedDB has nothing to
  degrade to — so its no-script fallback is a _sentence_, server-rendered, telling a marshal to
  write the bib and the time on paper. **The queue model is the decision everything else
  follows from**: a full-width button timestamps immediately and the bib is typed afterwards on
  a keypad, because at the line the scarce resource is the moment rather than the marshal's
  attention. An anomaly **flags and never blocks**, frozen at confirm time and never recomputed.
  The rules are pure and unit-tested in `apps/timing/lib/queue-state.ts` — `RETRY_CAP = 10`, a
  thirty-second drain, `failed` as a state of its own so an offline tap never looks like an
  error, and a reload reconcile that reads the ids back rather than guessing. ⚠️ **Nothing the
  database says is ever rendered on a card**: `lib/sync-outcomes.ts` picks the club's own
  wording, which is what the old application's `[object Object]` came from. The browser never
  holds an access token — it posts to `…/sync` on the timing Worker, which calls
  `record_crossing()` with the cookie session (#244) — and `public/sw.js` caches the screen so a
  reload with no signal does not strand somebody on a course;
- **`/timing/events/<slug>/anomalies/` and `/crossings/`** — the two surfaces where a human
  turns a flagged capture into a fact (#252), both behind `timing.crossing.resolve`, which had
  existed since `20260911100000` and gated nothing until then. ⚠️ **The triage list is a union
  of two populations and the second is the one a flag-only query hides**: a _flagged_ capture,
  and an **orphan** whose bib matched no team — `record_crossing()` stores an unknown bib and
  never refuses one, so nothing marks those. ⚠️ **Every write is a compare-and-swap, because two
  volunteers on one triage list is the normal case rather than the edge one**, and the loser is
  told rather than silently overwritten. `resolve_crossing()` latches on `resolved_at is null`;
  `edit_crossing()` **cannot**, because a row that was never flagged carries that null for ever,
  so it swaps on the values the editor was looking at — which is why they are two functions
  rather than one. An edit sets the bib and lets the trigger re-derive the team, and **an edited
  bib that still matches nothing legitimately stays an orphan**, which the page says out loud.
  A discard is reversible and `buildResults()` already excludes one, falling through to the next
  undiscarded capture for that bib;
- **`/timing/events/<slug>/status/` and `/finish/`** — DNS, DNF and DQ, and calling a race
  finished (#253), both behind `timing.event.manage`. ⚠️ **A status is a label on top of
  crossings and never a change to one**: DNS suppresses every derived time, and **DNF and DQ keep
  leg A**, because a captured fact stays captured. ⚠️ **`set_race_status()` audits the reversal
  as well as the setting** — the old application audited a disqualification and not its lifting,
  which is exactly backwards for the runner disputing it — and writes no audit row at all when
  nothing moved, because pressing "clear" on an unmarked runner is not a decision. ⚠️ **Finishing
  is reversible, a label, and never a gate**: `record_crossing()`, the resolution functions and
  `set_race_status()` are all untouched by `finished_at`, because the last runner's crossing
  arrives after the race director has called it, and the finish page says so under the button.
  `finish_event()` is idempotent by its own `where` like `start_event()`, answering the losing
  press with the winning time;
- **`/timing/events/<slug>/danger-zone/`** — wiping a rehearsal (#254), behind
  `timing.event.manage`. ⚠️ **`reset_event()` takes the race's own slug as a second argument and
  refuses without it**, because the typed confirmation _is_ the modal — there is no dialog on top
  of it, which would be a reflex and would also be a scripted control on a platform where every
  spec runs in a `no-javascript` project — and a control only the page enforces is no control at
  all against a POST that skipped it. ⚠️ **It deletes crossings first and teams second, and the
  order is load-bearing**: `crossings.team_id` is `on delete set null`, so teams-first
  manufactures exactly the orphans the reset exists to remove. That and clearing **`finished_at`
  as well as `actually_started_at`** are the two corrections the old application recorded against
  its own version. It **refuses a race whose results are published** — #241's column — leaves
  `marshals` and `admin_actions` alone, counts before the DML, and **audits even when it removes
  nothing**, because the intent is the auditable fact;
- **`/nn/<year>/results/`**, which reads `timing.results_for_event()` — behind
  `nn.results.read` until the race's results are published, and **open to the public after**
  (#242, [ADR-043](docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md)).
  ⚠️ **A published result carries a name, a category and a time and no exact age**:
  `results_for_event()` returns `age_on_day` as null once a race is published, **by publication
  rather than by permission**, so every caller gets the same answer — which is the only
  arrangement in which the page can carry a `public` `Cache-Control` at all. The consequence is
  that the published table shows `Women` / `Men` and the **preview** shows the band,
  `Women's Vet 60`; whether a band may be published is the club's decision and it is open.
  **The category is `effectiveCategory()`'s answer through `placementFor()`** — ADR-031's
  placement, never `gender` alone and never `timing.teams.category`, which
  `import_from_entries()` does not write. ⚠️ **A response that sets a cookie is never publicly
  cached**, whatever the race's state, because `readSession()` can rotate a refresh token on
  the way out;
- **`timing.results_published_at()`**, the **second** `anon`-callable function in this schema
  — one bit, so `/nn/` and `/nn/<year>/` can paint a link to the results without
  `results_for_event()` returning the whole field to answer it. ADR-042's *"and the only one"*
  is superseded by ADR-043 on that point and by nothing else; `timing.test.ts` pins the granted
  list by name and grantee, so a third is still a decision somebody takes in a diff;
- **the publication state machine** — `timing.events.results_published_at` and
  `results_published_by`, written by `timing.publish_results()` and cleared by
  `timing.unpublish_results()`, both behind `timing.result.publish` and both audited (#241,
  [ADR-042](docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md)).
  ⚠️ **Finishing a race does not publish it**, and publishing is refused `not_finished` while
  `finished_at` is null and `open_anomalies` while anything is on `timing.open_anomalies()`'s
  list — capture never blocks, and publication is the one moment a suspect row must not pass
  through silently. ⚠️ **The `open_anomalies` refusal restates that function's predicate and
  must stay identical to it**: the literal reading of #241 would also catch a capture with no
  bib, which the triage list deliberately excludes, and publication would then be blocked by a
  row no screen shows. ⚠️ **`results_for_event()`'s grant to `anon` is the first in this
  schema** — safe because the function answers `null` for an unpublished race whoever asks, and
  because `anon` still holds no grant on any `timing` **table**; `timing.test.ts` pins both.
  **A correction after publication is _unpublish, fix, publish_**, and the page goes back to 404
  in between rather than serving a table somebody is editing;
- **`/timing/events/<slug>/results/` and `/timing/events/<slug>/prizes/`** — the preview
  somebody reads before pressing publish, the two buttons that call the functions above, the
  prize presenter and four exports (#205), all behind `timing.result.publish`.
  ⚠️ **They read `timing.results_preview()` and not `results_for_event()`, and that is not
  tidiness.** `identity-permissions.test.ts` says in as many words that `timing-admin`
  deliberately does **not** hold `nn.results.read` — *"running a race and seeing its results
  before they are public are different powers"* — so the public read answers `null` to the very
  person the preview page is for. ⚠️ **The preview carries two runner columns the public answer
  may never carry**: `role`, because a guide's discloses by inference that their runner is
  visually impaired (ADR-022), and `result_placement`, because ADR-031's raw answer is not the
  published category derived from it. Both are needed to get a prize list right — without
  `role`, `awards.ts` cannot exclude a guide and one wins a band, discovered at the
  presentation. ⚠️ **The open-anomaly predicate has one statement fewer than before, not one
  more**: `timing.open_anomaly_count()` is granted to nobody and is what `publish_results()`,
  `event_detail()` and the preview all read, so the number on the page and the number in the
  refusal cannot drift. `event_detail()`'s count was the third copy and was **narrower** — it
  ignored orphans, so the race hub read *"0 open anomalies"* beside a publish button refusing
  for open anomalies. ⚠️ **An export rides on `timing.result.publish` and has no permission of
  its own**, unlike `nn.entry.export`: the entries export carries emergency contacts, ages and
  medical flags, and this one carries a name, a bib, a category and a time — exactly what the
  button beside it makes public to everybody. Revisit it the day an export grows a field
  publication does not. ⚠️ **The presenter's "pass to next" exclusions and its two spot draws
  live in the URL**, because the old application held them in component state and a refresh lost
  them mid-ceremony; the prize export re-reads the same choices rather than recomputing, so the
  file cannot name a different winner than the one who was handed the prize. **Every cell of the
  `.xlsx` is an `inlineStr`**, which is the only thing that stops Excel reading a bib of `0311`
  as `311`.
- **`/timing/events/<slug>/leaderboard/`** — the live board, on **Durable Objects** (#204,
  ADR-034), behind **either** `timing.event.manage` **or** `timing.crossing.resolve`, which is
  the only two-permission row in `lib/access.ts` and is ADR-038's own pair.
  ⚠️ **Staff-only in 2026, and [C6](docs/foundations/requirements.md#c6--show-live-race-progress-to-spectators)
  is therefore not met** — the old application's `/live/<slug>` was fully anonymous and
  spectators watched it at Ashton Court; ADR-038 declines that, because a live leaderboard _is_
  provisional results published continuously, and records the lost capability rather than
  re-scoping it. ⚠️ **It reads `timing.leaderboard()`, a third function returning the same shape
  as `results_for_event()` and `results_preview()`** — three audiences, differing by a permission
  and a column list, and `20260914150000`'s header carries the table. It carries `runners.role`,
  which the published answer withholds (ADR-043), because on a solo race a guide shares a team
  with the runner they guide and a board with no `role` prints a guide as though they had a time;
  it deliberately carries **no `result_placement`**, because it computes no prize band.
  ⚠️ **The Durable Object holds no race data at all** — it broadcasts _"something changed"_ and
  every screen re-reads the snapshot over the ordinary permissioned HTTP path, so there is one
  read, one set of permissions and one place a disclosure decision is taken. That is also what
  keeps this the slice ADR-034 cuts: the derivation is pure, in
  `packages/shared/src/timing/leaderboard.ts`, and deleting the transport leaves a
  server-rendered board that does not refresh itself. ⚠️ **The socket is the one address under
  `/timing` that `middleware.ts` never sees** — a `101` response carrying a `webSocket` cannot
  survive Next's response pipeline, so `apps/timing/worker-entry.js` answers it before OpenNext
  is asked, reading its permission out of the same `lib/access.ts` table. ⚠️ **`main` in
  `wrangler.jsonc` is `worker-entry.js` and no longer `.open-next/worker.js`**, because a Durable
  Object class has to be exported from the Worker's entry module and OpenNext's is generated on
  every build; that file re-exports OpenNext's three cache classes as well, and dropping any of
  them would break the day somebody configures an incremental cache. **The no-JavaScript
  fallback is the board itself** — a client component is server-rendered, so scripting off gets a
  correct snapshot plus a sentence saying to reload, which is deliberately unlike the marshal
  capture screen, whose fallback is only a sentence because an IndexedDB queue has nothing to
  degrade to.

⚠️ **Publication is reachable end to end as of 14 September 2026, and both halves of this
paragraph were written believing the other half was missing.** #205 built the preview and the
publish button; #242 opened `/nn/<year>/results/` to a signed-out visitor. Each said *"what is
genuinely not built is"* the other, and both merged the same afternoon. A `timing-admin` now
previews a race, presses publish, and the public reads it at a permanent address.

### What is genuinely not built

**What is genuinely not built is the race simulation** —
[#207](https://github.com/southville-running-club/src-website/issues/207), which is a human
running the thing rather than a change to it. ⚠️ **"the live leaderboard" is what this said
until #204**, on 14 September 2026, and before that **"nothing resolves an anomaly" until #252,
"nothing marks a DNS, DNF or DQ, nothing finishes a race" until #253, "publication" flatly until
#241, "nothing wipes a rehearsal" until #254, "the publish button" until #205 and "the public
page" until #242** — nine such lines have gone stale in five days, which is the pattern rather
than the exception, and two of them went stale in the same hour as each other. **The leaderboard
was also the one slice ADR-034 said it would cut if the transport did not work**, so this line
moving is worth more than the others: the Durable Object is bound, the class is exported from the
Worker's own entrypoint, and `wrangler deploy --dry-run` resolves the binding. What #207 decides
now is whether it holds up on a field of real phones, not whether it can be built.

### Sharp things already paid for here

⚠️ **`reopen_event()` is refused while results are published, and that guard arrived with #241
rather than with the function.** #253 asked for it; `20260913240000` declined it because
`timing.events` had **no `results_published_at` column** and named #241 as its owner, which is
what `20260914100000` paid. It answers `published`, distinctly from `not_finished`, because
reopening clears `finished_at` and publication was conditional on it being set — a published,
unfinished race is a state the state machine has no arrow into. **This paragraph said the
opposite until 14 September 2026.** ⚠️ **`reset_event()` never deferred its own guard**, and the
difference is worth keeping straight: refusing a published race is the one thing that function
exists to do, so #254 read the column from the start and its migration is timestamped after
#241's — whereas `reopen_event()` was a whole feature that did not need the guard to be useful.

⚠️ **"No countdown screen" is what this said until #250**, and **"there is no marshal capture
screen" is what it said until #203** — twice in two days, which is the
pattern rather than the exception. ⚠️ **"Nothing captures a crossing" was already half wrong
before that**: `timing.record_crossing()` landed with #251 and nothing called it for a day.
The roster page (#245) decides _who may_ capture on a race, which is ADR-036's scope checked
after the permission; #203 is what a rostered marshal captures _on_.

⚠️ **Two check constraints on `timing.crossings` arrived with #252 and the issue said they
already existed.** They did not: `20260911140000` declared `resolved_at` and `resolved_action`
as two bare nullable columns with nothing tying them together and no value check on the second.
`crossings_resolution_coherent` makes them null together or set together — a capture that is
resolved without saying _how_ means nothing — and `crossings_resolved_action_shaped` pins the
three actions. **They are validated rather than `NOT VALID`**, unlike `entries`' four, because
`timing` holds no production data at all and there is no row to disagree. The constraint found a
test fixture writing an incoherent row on its first run, which is the argument for it.

⚠️ **The door stopped refusing `rosterScoped` addresses outright on 13 September 2026, and the
flag is still there.** `middleware.ts` refused `/timing/marshal/…` on sight while nothing could
answer _"am I on this roster"_ for the marshal asking — #245's four roster functions are all
behind `timing.marshal.assign`, an admin's permission. `timing.marshal_event()` is that read:
the same two checks `record_crossing()` makes, in the same order, answering `null`
indistinguishably for no permission, no such race and not rostered. It also carries the race's
`format`, because a relay bib is read leg-first and a solo bib whole, and a screen that guessed
would flag the wrong crossings. ⚠️ **A refusal at that door reaches the screen as a 404
carrying HTML**, which is what a lapsed session and an un-rostered marshal both look like — so
the sentence the screen shows names both possibilities rather than guessing between them.

⚠️ **The entry list is built as of #202**, at `/timing/events/<slug>/registration/` behind
`timing.registration.import`: the club's own entries import in one press
(`timing.import_from_entries()`, ADR-039 and the critical path for Nightingale Nightmare), a
Full On Sport CSV uploads for Pass the Buck's archive and for a race entered somewhere else,
and #249's page half — a bib per leg, an override control and "Assign bibs" — is on the same
screen along with the walk-in desk form. ⚠️ **Nothing about an uploaded file is kept, and that
is a stop-and-ask left open rather than an answer.** #202 says files go in R2 and never in
Postgres, _and that whether the raw file is kept at all is a data-minimisation question to
answer before the first upload_ — it has not been answered, so the route handler parses in
memory and lets the file go. **Which is why the preview is a second submit of the same form**
rather than a stored parse, and why the findings cross the redirect as a severity, a finding
kind and row numbers, re-worded in the club's own voice by
`apps/timing/lib/registration-outcomes.ts`: the parser's own messages name runners and quote
their email addresses, and a query string is not somewhere personal data may go.

⚠️ **`timing` holds exactly one row of production data since 14 September 2026, and it is the
race** — `nn-2026`, put in `timing.events` by `20260914160000_timing_nn_2026_event.sql` under
[#288](https://github.com/southville-running-club/src-website/issues/288), because **nothing in
the app can create an event**: `timing.create_event()` is behind `timing.event.manage` and is
called by nothing, so the row is a reviewed commit, and a create form is owed to Pass the Buck
([#206](https://github.com/southville-running-club/src-website/issues/206)) rather than to this
race. This paragraph said *"every table is empty"* until then. **Everything else is still
empty**: no team, no runner and no crossing, so the results page renders "Nothing has been
captured for this race yet" to the few people who may open it at all, and the row itself is
inert — not started, not finished, not published. ⚠️ **What that retires is the argument three
`timing` migrations used for shipping a check constraint `validated` rather than `NOT VALID`** —
*"there is no row to disagree"* — which is true of every table but `events` now. The current
state, and what is deliberately deferred, is in [the phases](docs/delivery/phases.md).

---

## How tickets to a club social behave

**A fourth schema arrived on 5 September 2026 and it is `store`** —
[ADR-033](docs/architecture/decisions/adr-033-a-ticket-is-not-an-entry.md). It sells tickets to
the club's socials, starting with the Christmas party, and it is deliberately **not** part of
`entries`.

**Why it is not a row in `entries.events`, because that is the first thing anybody will try.**
`entries.entrants` requires `date_of_birth`, `gender`, `emergency_contact_name` and
`emergency_contact_phone` — all four `not null`, each argued for individually, each in the
committee-settled list at `packages/shared/src/nn-entry.ts`. A party ticket needs none of them,
so reuse meant either **collecting them anyway** (a straight breach of _personal data is
minimised at the boundary_, and one that looks like good engineering while it is happening) or
**making four columns nullable on the live race path during the entry window**. Neither is worth
a week saved.

⚠️ **The word `event` is reserved and this schema may not use it.** The glossary says an event is
one running of one race in one year, so the table is `store.socials`. **The path and the
navigation label are still "Events"**, because that is the old Squarespace address Phase 5 keeps
and the plain word a member reads — the same split as the bar reading "Race timing" over
`apps/timing`. A table, column or function named `event` in `store` is a defect; so is one named
`social` in `entries`.

### What ships, and why it sells nothing

**`store.socials` holds one row — `christmas-party-2026` — and it is now nearly fully
supplied**: **Saturday 12 December 2026 at The Cock & Tail, 7:30pm–1am, 18+**, at **£10**. All
of it came from a club volunteer on 5 September 2026, in two dated migrations
(`20260905110000` and `20260905120000`), and **every value is a column rather than markup** —
which is why confirming each was an `update` and no deploy.

**The £10 is confirmed** — decision 010, settled on 6 September 2026 after a day as a
provisional £12. It lives in `store.ticket_types.price_pence` and nowhere else: it is passed as
`price_data` at Checkout, so there is deliberately no Stripe Price object to disagree with it.
Repricing is an `update` and no deploy, and **the practical window for it closes the day sales
open** — `ticket_purchases.amount_pence` records what was actually charged, so an edit cannot
rewrite a receipt, but somebody who bought at the old price paid it.

⚠️ **`minimum_age` is displayed and enforced nowhere.** Nothing in `store` collects a date of
birth to check it against, and collecting one to sell a party ticket is the minimisation breach
this schema exists to avoid — the 2025 page stated 18+ as prose and the door enforced it.
Asking at the point of sale is a `required_consents` entry and needs wording first.

**The club is going live on Friday 18 September 2026** — the page visible _and_ tickets on
sale, both that day, 85 days before the party. ⚠️ **That lands inside the Nightingale
Nightmare entry window** (open until 17:00 on 30 October), so everything for it deploys
alongside live race entries and the out-of-order-migration trap is the one to watch: a `db push`
refused on version order takes the _whole_ push down, and the symptom reaching a volunteer is
race entries answering "the club's database could not be reached". The dated schedule, the
on-the-day order and the rehearsal are in
[the runbook](docs/delivery/runbooks/events-tickets.md).

⚠️ **There is deliberately no tester mechanism for `store`, and it is not an oversight.** The
race needs `nn-tester` and a £1 fee because a test entry consumes one of 250 places; a party
ticket does not, because `capacity` is null. So the rehearsal is a real purchase on the day,
refunded afterwards — and a member who finds the page in the meantime has simply bought a
ticket at the right price.

⚠️ **A social is invisible until somebody publishes it, and that is a fourth lock rather than
a replacement for the other three.** `store.socials.published` defaults to **false**, so the
party ships hidden: `/events/christmas-party-2026/` answers **404** and the link on `/events/`
is hidden, leaving "Nothing is coming up just now". Publishing is one `update` and no deploy.

**`social_state()` answers nothing for an unpublished, inactive or absent social — the three
are deliberately indistinguishable**, so nobody can probe for an occasion the club has not
announced, and `create_pending_purchase()` refuses one as `no_such_social` for the same reason.
⚠️ **The Worker must not treat that as an outage**: `fetchSocialState` returns `missing` versus
`unavailable`, and only `missing` 404s. A page that 404'd on an unreachable database would
delete itself for the length of the outage.

**`seed.sql` publishes it locally** so the acceptance suite can test the page it renders;
that file never runs against production, and `store.test.ts` asserts the _column default_
rather than the current row.

**`capacity` is null, meaning no limit**, and `sales_open_at` is null, which is what actually
keeps tickets from being sold — along with none of the three Worker secrets being installed,
which is a second, independent reason. `packages/db/tests/store.test.ts` asserts every supplied
value as an exact object, asserts the window is still shut, and asserts that a hold is refused
even with a valid ticket code.

### The grants, and what makes an eighth a decision

**The anon role holds no grant on any of the five tables** — `socials`, `ticket_types`,
`ticket_purchases`, `api_secrets`, `email_outbox`. It may call **seven functions** and nothing
else:

|                          |                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------- |
| **Public configuration** | `social_state()`                                                                |
| **The ticket path**      | `create_pending_purchase()` — **takes a key** — and `attach_checkout_session()` |
| **Housekeeping**         | `expire_pending_holds()`                                                        |
| **Payment**              | `record_checkout_event()` — **takes a key**                                     |
| **The outbox drain**     | `claim_outbox_batch()`, `record_send_result()` — **both take a key**            |

Three more are granted to **nobody** and are reachable only from the definer functions and
triggers that call them: `key_ok()` (an oracle for the key if it were callable),
`issue_ticket_no()` and `enqueue_ticket_email()`.

`packages/db/tests/store.test.ts` names that exact split, walks all five tables in both verbs by
error code, and asserts RLS on with no policy anywhere. **An eighth anon-callable function is a
decision somebody takes in a diff** — the same mechanism `entries.test.ts` provides, and whose
own count has already changed three times. Do not trust a count in this prose; read the test.

### Three secrets, and they are this schema's own

`STORE_ENTRY_KEY`, `STORE_WEBHOOK_KEY` and `STORE_STRIPE_WEBHOOK_SECRET`, none of them shared
with `entries`.

⚠️ **`STRIPE_SECRET_KEY` is not one of the three and IS shared with the race path**, which this
paragraph used to leave to inference. There is one club Stripe account, so there is one secret
key — `processTicketOrder` calls the same `stripeConfig(env)` the entry path does, and a ticket
payment lands where a race entry does. **The consequence is that test-to-live is one decision
for both**: tickets cannot charge a real card until that key is live, and making it live puts
the race on live keys in the same moment. Production is on **sandbox** values today (README
step 2, "Done — sandbox value"; step 15, the swap, is pending), and
[the key-swap runbook](docs/delivery/runbooks/entries-stripe-keys.md) carries the rule that
nothing may be left `paid` across it. **One key opening two doors is one rotation closing both**, and a compromise of
the party ticket path must not be a compromise of the race payment path. A Stripe webhook
endpoint carries its own signing secret per URL anyway, so `/events/stripe-webhook` could not
have shared `/nn/`'s even if sharing had been wanted.

All three ship absent and both digests in `store.api_secrets` ship **null**, which refuses
everything — the safe direction. ⚠️ **`STORE_ENTRY_KEY` must be installed and verified before
`sales_open_at` is ever set**: the other order is a ticket window that is open and unprotected,
which is ADR-029's finding applied here before it was needed rather than four days after.
[The runbook](docs/delivery/runbooks/events-tickets.md) owns that ordering.

### What is carried over from the race path without being re-argued

Each was learned expensively on `entries` and is applied here from the first migration:
`POST /events/stripe-webhook` is **the only writer of `paid`**, with the same inverted failure
direction (our failures answer 5xx and let Stripe retry; only "this is not Stripe" gets a 400);
a payment arriving after the hold lapsed is **still `paid`**, flagged rather than refused, with
no fifth status for it to disappear into; the obligation to send an email is written in the same
transaction as the payment (ADR-021) and drained from `ctx.waitUntil()` with the cron as the
retry net (ADR-032); `formatEntryReference()` and `formatPence()` are reused rather than
re-implemented, because a second implementation of either is the defect their own headers warn
about.

**The quantity picker renders its totals server-side**, in `quantityOptionLabel()`, which is the
one place `formatPence` is called for this page. That deliberately avoids becoming the seventh
instance of the client-side `£`-rebuilding pattern [#175](https://github.com/southville-running-club/src-website/issues/175)
already tracks — and it works with scripting off.

### What is deliberately not built, so nobody goes looking

- ~~No admin surface.~~ **Built on 6 September 2026** — `/admin/events/`, behind
  `store.ticket.read`. See the section below.
- **No cancellation or refund path.** Nothing writes `refunded`. The `ticket_refunded` template
  and its trigger branch exist and are tested, so the mechanism is ready for the function that
  will use it.
- **No per-attendee names.** A purchase carries a name, an email address and a quantity. A door
  list by name is a field beyond what is specified, and therefore a committee decision.
- **No dietary requirements, and that is a recorded decision rather than an omission.** The 2025
  party page collected them at booking. An allergy is health data and a religious diet reveals
  belief, so both are Article 9 — an explicit condition, a retention period and items on both
  privacy notices would all be needed first. **The confirmation email asks for them by reply**,
  which puts the answer in a mailbox the club already runs. `tests/unit/events.test.ts` asserts
  that no dietary field reaches the order however it is posted.
- ~~No HTML part on the two ticket emails.~~ **The confirmation has one since 13 September
  2026** — [ADR-041](docs/architecture/decisions/adr-041-the-ticket-confirmation-gets-a-skin-of-its-own.md),
  the change ADR-033 deferred when it called a ticket skin "a separate change". It is a **second
  skin**, `worker/ticket-email-skin.ts`, and not a widened `email-skin.ts` — which is the thing
  ADR-033 actually ruled out and which still knows nothing about a ticket. The text part is
  unchanged and stays authoritative: both render from the same `TicketOutboxMessage` and never
  from each other, so the two may differ in presentation and never in the facts.
  **`ticket_refunded` is still text alone**, deliberately — no cancellation design was supplied,
  the skin returns `null` for it, and that message sends as text rather than not at all.
  ⚠️ **The banner is attached as a `cid:` image, not hotlinked**, which is ADR-026's open-tracker
  position rather than a new one; **which artwork is keyed by slug** in `SOCIAL_BANNERS`, and a
  slug that is not in that map gets no banner and still gets its email.
- **The completion page reports no state at all.** It makes no positive claim about the payment
  and — the half that costs money — **no negative one**. ⚠️ If it ever does report state, the
  race's rule comes with it: only a recorded payment may make a positive claim, because a page
  saying "nothing was charged" while the webhook is merely late sends somebody to pay twice.

### The admin surface, and the master role that reads it

**`/admin/events/` is two pages**, behind **`store.ticket.read`** — the eleventh permission,
taken 6 September 2026, which closed the gap ADR-033 named as this schema's biggest. The index
is every social with what has been sold against it; `/admin/events/<slug>/` is one social's
buyers. It shows a name, an email address and a quantity, which is **everything `store` holds
about a buyer**: unlike `/admin/nn/`, which had to decide what not to render, this page renders
the row.

**Two functions, both granted to `authenticated` and both authorising inside themselves.** The
anon list is unchanged at seven — `packages/db/tests/store.test.ts` asserts `anon` is refused
`42501` on the grant, before the permission is ever asked.

⚠️ **`admin_social_list()` is its own function rather than a group-by over the ticket rows**,
and the reason is the case that matters: **a social with no tickets sold would not appear at
all**. That is the state every social starts in and exactly when somebody is checking whether
sales have started — a page that vanishes an occasion the moment it has no sales is empty
precisely when it is needed.

⚠️ **The section is gated in `worker/admin.ts` before it dispatches**, like the three beside
it, and here that ordering is load-bearing rather than tidy: the function returns _nothing_
rather than raising when the permission is missing, so an ungated page would render an empty
table reading "nobody has bought a ticket yet" — disclosing the page, and stating something
false about the club's records to somebody who cannot check it.

**Non-`paid` rows are shown and labelled**, for the reason `/admin/nn/` learned expensively: a
volunteer asking _"did Alex get a ticket"_ needs to see an abandoned checkout to answer it.

**There is no export and no audit table**, both deliberately. `nn.entry.export` is its own
permission because a file leaves the building, so a ticket CSV is a twelfth permission and a
separate decision; and ADR-024 already decided that reading a _list_ writes no audit row,
because it discloses what the same permission already opens.

### One config change went with it

**`store` is in `[api].schemas` in `packages/db/supabase/config.toml`**, added in the same change
that creates the schema — `identity`'s precedent exactly. Without it PostgREST answers
`PGRST106 Invalid schema: store` to every call, which is what the ticket form's first test run
actually reported. ⚠️ It is the `[api]` block rather than `[auth]`, so it is not the stop-and-ask
— but **the whole file still ships to production on the next merge that touches a migration with
no partial apply**, so the ordering matters: `db push` runs first and creates the schema this
line names.

### The navigation gained a fifth label, and that was free

`SITE_NAV` in `packages/shared/src/brand.ts` now has five entries. **Adding one here is not the
layout change that renaming a label in the Nightingale bar is** — `.site-nav` is deliberately
**not** sticky, so no `scroll-padding-top` token is keeping step with its height and nothing
measures it; `base.css` says so at `.site-nav`. It wraps. The same edit one bar along once added
48px and put every anchor and every keyboard focus behind the header.

**`Events` carries a submenu, and it is CSS only.** `SiteNavItem.children` is an optional list
on that one entry; both renderers emit a nested `<ul>` and neither decides when it opens —
`base.css` does, on `:hover` and `:focus-within`. **That is not a preference: every test in this
suite runs in a `no-javascript` project**, so a scripted menu would not open there at all.
Focusing the parent link reveals the list, which is what then makes its own links tabbable, and
that ordinary tab order is why it needs no `aria-expanded` to be operable.

Three things about it are load-bearing:

- **The parent stays a real link to `/events/`**, which lists the same pages. The menu is a
  shortcut and never the only route — which is what makes it safe to hide outright below 48rem,
  where there is no hover to open it with and the bar is already two rows.
- ⚠️ **`position: relative` on the `<li>`.** An absolutely positioned box whose containing block
  is the _page_ is laid out against the document, and a panel wider than the viewport then makes
  the whole page scroll sideways, silently. This repository has already paid for exactly that
  once, with a visually-hidden span inside a scrolling admin table.
- **The list is a constant, not a database read.** The alternative is `store.social_state()` on
  every page view — `/`, `/privacy/`, every account page — to paint a menu. It costs nothing
  extra in practice, because a social already needs its own content page and is therefore
  already a deploy.
