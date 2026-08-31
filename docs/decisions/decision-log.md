# Decision log

Where choices get recorded once they are made — and, just as importantly, how they get
**re-opened** when the ground shifts.

Nine decisions are recorded below. [Requirements](../foundations/requirements.md) and
[options](../solutions/options.md) came first; decisions came after — that order is the
point of this branch, and it is why the reasoning in each record below still points back
to them.

---

## What gets a record

A choice needs one if it:

- picks a vendor, framework, language or infrastructure primitive;
- changes where personal data lives;
- would be expensive or slow to reverse;
- or commits the club to a recurring cost.

Small, reversible choices do not. If reversing it costs an afternoon, just make it.

## The shape of a record

Each decision states:

| Section | What goes in it |
| --- | --- |
| **Requirement** | Which capability from [requirements.md](../foundations/requirements.md) this serves |
| **Context** | The facts that forced a choice. Numbers where numbers exist |
| **Options** | What was genuinely considered, with the trade-off for each |
| **Decision** | What we are doing, in the present tense |
| **Consequences** | What becomes true — including the costs knowingly accepted |
| **Exit cost** | **What it takes to undo this, and whether the data comes with us** |
| **Revisit when** | The condition that reopens it |

Two of those are unusual and deliberate.

**Exit cost is mandatory.** A club running on free tiers is exposed to terms changing
under it. The defence is not choosing perfectly — it is knowing, for every choice, what
leaving would cost. A decision whose exit cost nobody can state is a decision nobody can
safely review.

**"Revisit when", not "revisit if".** A condition, not a hope. *"When the free tier stops
permitting payments"* is a trigger somebody can notice. *"If it becomes a problem"* is
not.

---

## Re-evaluating

The point of separating requirements from options from decisions is that a decision can be
re-opened **without re-doing the thinking underneath it**.

To re-evaluate a choice:

1. **Check the requirement still holds.** Often the surprise is that the requirement
   moved, not the market. A decision that no longer serves a requirement is not a bad
   decision — it is a finished one.
2. **Re-score the options against the same criteria** in
   [options.md](../solutions/options.md). Same criteria, or the comparison means nothing.
3. **Price the exit** using the record's own exit-cost section. Compare that against what
   staying costs.
4. **Write a new record** that supersedes the old one, naming what it replaces. Never edit
   an accepted decision to change its answer — the history of a choice that turned out
   badly is worth more than a tidy file.

### Triggers worth watching

Conditions that should prompt a re-read regardless of whether anyone feels like it:

- A free tier changes its terms — particularly around commercial use, inactivity, or
  retention.
- A recurring cost appears, or an existing one moves materially.
- A second maintainer arrives. Several trade-offs here are made *because* there is one
  volunteer, and they should be revisited when that stops being true.
- A capability in [requirements.md](../foundations/requirements.md) is added, removed or
  changes shape.
- Something breaks in a way a different choice would have prevented.
- The club's data-protection position changes.

### When re-evaluation is not worth it

Re-opening a decision has a cost of its own — attention, and the risk of half-finished
migrations. Not worth it when the exit cost exceeds several years of the saving, when the
current choice is merely inelegant rather than failing a requirement, or when the person
proposing the change will not be the one maintaining the result.

**Boring and settled beats optimal and re-litigated**, for a club maintained by
volunteers.

---

# Records

**001–004 were proposed by the Web Manager, 7–8 August 2026.** This repository does not
carry a separate record of the committee formally ratifying them, but the build has
proceeded on all four for weeks: Cloudflare and Supabase are what production actually runs
on, mailboxes are bought, and the old and new sites have run in parallel throughout. **The
governance gates these were originally recorded ahead of are met** — payment work is
authorised. **005–008 are committee decisions in their own right**, each with its own date
and provenance stated in the record: 005 and 006 on 24 August, 007 on 29 August, 008 on 30
August. Stripe Checkout has been live and taking real money since 27 August.

⚠️ **009 is the first record here the committee did not take, and it says so in its own
provenance rather than only here.** It was taken by the maintainer on 31 August 2026, and it
is a record about *published wording* rather than about vendors, money or personal data: every
one of the four things it publishes was already decided somewhere else and merely not written
on the notice that needed it. **It is still a decision** — a legal notice said one thing on the
30th and says more on the 31st — so it gets a record, and the record is the thing the committee
reads if it wants to overrule any of it. Anything the committee later supplies for either
notice supersedes it on sight.

---

## 001 — Serve the website from Cloudflare, and move the domain's DNS there

| | |
| --- | --- |
| **Requirement** | [C1](../foundations/requirements.md#c1--publish-club-information-publicly), [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), and the [money constraint](../foundations/requirements.md#money) |
| **Context** | The incumbent pattern — Vercel Hobby — [prohibits commercial use](../solutions/platform-options.md#1-does-the-free-or-cheap-tier-permit-taking-payments), and paying for it properly costs more than staying on Squarespace. Cloudflare's terms permit payments on the free tier. Serving the apex requires Cloudflare to be authoritative for the zone |
| **Options** | Compared in [platform options](../solutions/platform-options.md#the-complete-cost-picture); the final two head-to-head in [Cloudflare or Netlify](../solutions/cloudflare-vs-netlify.md) |
| **Decision** | Cloudflare serves the site. Authoritative DNS moves from Fasthosts to Cloudflare, following the [staged runbook](../solutions/dns-and-domain.md#what-moving-the-apex-to-cloudflare-actually-involves). Registration stays at Fasthosts for now |
| **Plan** | **Workers Paid, $5/month (~£47/yr). The Cloudflare zone stays on the Free plan** — the Pro zone plan is a different product at ~£190/yr and buys the club nothing |
| **Consequences** | DNS becomes code and lands in a club-owned account both volunteers can reach — closing the last click-operated single point of failure. Accepts a one-off migration that carries club email, reversible only over 48 hours. Until the nameservers move, anything on the club domain must be a **Pages** project, not a Worker |
| **Exit cost** | **Low on serving** — static output moves to Netlify in an afternoon. **Moderate on DNS** — moving the zone back is another nameserver change with the same care |
| **Revisit when** | Cloudflare's free tier gains a commercial-use restriction; or a Cloudflare outage affects the club materially |

## 002 — Hold the club's data in Supabase, on the free tier

| | |
| --- | --- |
| **Requirement** | [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), [C12](../foundations/requirements.md#c12--maintain-membership-records), and [convergence](../foundations/requirements.md#convergence) |
| **Context** | The timing platform already runs on Supabase Postgres in `eu-west-2`. Keeping Postgres means the website and the timing platform converge without re-opening race-tested code. Cloudflare D1 would cost the same and break that |
| **Decision** | Supabase Postgres, `eu-west-2`, **free tier**. Website and timing data in one project |
| **Consequences accepted** | 500 MB, and **Realtime capped at 200 concurrent connections**. Inherits the existing bundling exposure rather than creating a new one |
| **Binding design constraint** | **The live race leaderboard must be served from Cloudflare — Durable Objects or equivalent — not Supabase Realtime.** A race-night crowd would exceed 200 connections and force Supabase Pro at £237/yr. This decision only holds if [C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) is built that way |
| **Also** | Files go to R2, never into Postgres. That is the other way to reach the free-tier ceiling |
| **Exit cost** | **Low for the data itself** — a standard Postgres dump. Higher if Supabase Auth and Realtime become load-bearing |
| **Revisit when** | The database approaches 500 MB; Realtime concurrency is needed beyond 200; or the free tier's terms change |

## 003 — Buy mailboxes from Fasthosts

| | |
| --- | --- |
| **Requirement** | [C8](../foundations/requirements.md#c8--send-email-as-the-club), and [shared ownership](../foundations/requirements.md#shared-ownership) |
| **Context** | Club mail is forwarding-only into personal Gmail accounts, so replies leave from a volunteer's address, forwarding breaks SPF, and no archive is club-held. **Cloudflare sells no mailbox product**, so moving DNS there does not answer this |
| **Options** | [Email](../solutions/email.md#options) — costed at two mailboxes and at six role addresses, because per-user pricing and flat-rate pricing diverge sharply |
| **Decision** | **Fasthosts Standard Email**, ~£26–£33/yr, two role mailboxes, used through Gmail *Send mail as* so replies leave from the club address SPF-aligned. Transactional mail stays separate, on Resend, from a dedicated sending subdomain |
| **Why not Migadu** | **Migadu was proposed first and dropped the same day.** Its flat-rate model fits a committee of many roles and few people, and £15 looked decisive — but Micro sends only **20 messages a day**, which is exactly what the club would be buying it for, and Mini costs £71. **Fasthosts needs no MX change**, and removing a second mail-affecting change from a programme that already has one is worth more than £15/yr |
| **Consequences** | **No MX change — the club's mail routing does not move.** Fasthosts remains a vendor, which it is anyway as registrar. Mailboxes are bought *before* the nameserver move, so Fasthosts configures its own records while it still controls the zone and the club copies one settled, verified zone into Cloudflare |
| **Exit cost** | **Low.** Export mailboxes, repoint MX. Standard IMAP, no lock-in |
| **Revisit when** | Fasthosts will not state its sending limits, or they are worse than 20/day; a third mailbox costs more than a whole Migadu plan; or the registrar moves away from Fasthosts, at which point the consolidation argument disappears |

## 004 — Run the new site alongside the old, and switch in one moment

| | |
| --- | --- |
| **Requirement** | [Continuity](../foundations/requirements.md#continuity) — *"the old site runs until the club is satisfied with the new one. They coexist; there is no big-bang switchover"* |
| **Context** | The member fund is the critical path: ~103 people must personally re-establish a payment, and **the list grows by about 45 payments a month.** A plan that migrates everyone at the end is migrating a larger number than a plan that starts early |
| **Decision** | The new site is built at **`new.southvillerunningclub.co.uk`, with paths mirroring the old site**, and runs alongside Squarespace throughout. **The payment page is built first**, and every new subscriber is sent to it from that day on |
| **Why the payment page first** | **It stops the old list growing.** Every month it is live is roughly 45 people who never join the list that has to be migrated. Nothing else in the plan changes a growing problem into a fixed one |
| **Consequences accepted** | `noindex` on `new.` until cutover, or the club's search results split — 314 visits a month arrive from Google. **Two payment sources reconciled** while the fund migrates; time-box it. `new.` must redirect to the apex afterwards so bookmarks are not stranded |
| **The cutover** | **One coordinated moment.** Squarespace **301-redirects every secondary domain to its primary**, so the old site cannot be reachable at `old.` while it still serves `www` — the primary-domain change and the apex repoint happen together, or the old site is simply left on its built-in `*.squarespace.com` address, which needs no DNS at all |
| **Exit cost** | **Near zero.** `new.` is a subdomain; abandoning it costs a DNS record |
| **Revisit when** | Parallel running has lasted long enough that reconciling two payment sources is a burden |

## 005 — Give the platform member accounts, on Supabase Auth

| | |
| --- | --- |
| **Requirement** | [C7](../foundations/requirements.md#c7--authenticate-and-authorise-staff), [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), and [people](../foundations/requirements.md#people) |
| **Context** | Nothing on the platform signs in. The one surface that reads people, `/nn/admin`, is opened by two shared keys rather than an account — the answer [ADR-013](../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) already named as the one to reach *"the day the platform genuinely has members."* That day is now: entries want to open in early September, and the club wants a role-gated way to read them that is not a shared secret. [`principles.md`](../architecture/principles.md#stop-and-ask) has carried *"does the website need member-facing authentication?"* as a stop-and-ask since the skeleton, and [this folder's README](../architecture/decisions/README.md#what-is-waiting-to-be-recorded-here) has listed it as waiting since issue #1 |
| **Options** | Keep the two-key scheme and add more keys — cannot express partial permission, and cannot be self-service. Cloudflare Access in front of `/admin` — the best answer to identity on the list, refused in ADR-013 for having no equivalent in Miniflare or on a laptop, which stays true here. Roll our own accounts — password hashing, reset tokens, session rotation, maintained by two volunteers, and the widest possible miss on *boring beats optimal* |
| **Decision** | **Supabase Auth (GoTrue)**, already running locally with zero users. Email and password, Google, and magic link — all three ways in. Three roles and no more: `super-admin`, `nn-admin`, `member`. `admin@southvillerunningclub.co.uk` is bootstrapped to `super-admin` by migration, registering like anybody else. A new, exposed schema, `identity`, holds the person record and role — **not `club`**, which stays unexposed for the future membership list. `/account/` is what a member sees; `/admin/` is the staff backend. An account is a person; membership ([C12](../foundations/requirements.md#c12--maintain-membership-records)) stays a later, separate thing. Cloudflare Turnstile guards every unauthenticated account form |
| **Consequences** | Three costs knowingly accepted, each recorded in full in [ADR-015](../architecture/decisions/adr-015-member-accounts-on-supabase-auth.md): the account area requires JavaScript, breaking progressive enhancement for the first time; the session cookie moves from `SameSite=Strict` to `Lax`, because a magic link and an OAuth callback are both cross-site top-level navigations, so CSRF becomes real work rather than a cost `Strict` absorbed for free; and the `[auth]` block in `packages/db/supabase/config.toml` stops being inert, since `deploy-db.yml` already pushes it to production on every merge touching a migration. The two-key scheme in ADR-013 is not replaced — it stays available as a break-glass path until #63 retires it, after race day and after the change freeze lifts |
| **Exit cost** | **Low for the rows** — `identity` is a standard Postgres schema, exported like any other. **Moderate for the mechanism** — leaving Supabase Auth means re-issuing every session and re-registering every account elsewhere, and Google/magic-link sign-in would need re-wiring against a new provider. Turnstile is a single client call and swaps cheaply |
| **Revisit when** | Supabase Auth's free-tier terms change around emails sent per hour or accounts held; a fourth role is proposed, which is a migration and a decision on its own; or the two-key scheme is retired and this becomes the only door, at which point its own exit cost is worth re-pricing |

---

## 006 — Price the 2026 entry at £18 and £20, and treat the £2 gap as ARC's money

| | |
| --- | --- |
| **Requirement** | [C3](../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C4](../foundations/requirements.md#c4--take-payments), [C11](../foundations/requirements.md#c11--verify-england-athletics-registration) |
| **Context** | The schema seeded £15 affiliated and £17 unaffiliated with the entries tables on 13 August 2026, and `CLAUDE.md` has carried them as confirmed since. The race director confirmed **£18 and £20** on 24 August 2026. A guide's place stays £0. **This record exists rather than an ADR** because [the ADR folder's own rule](../architecture/decisions/README.md#two-decision-homes-and-which-one-a-choice-belongs-in) puts money, anything the committee ratifies, and anything whose reversal costs money on this side of the line — and its tiebreak is *"when in doubt, the decision log"* |
| **Options** | **Leave £15/£17** — no longer what the race director has confirmed, and the number is published to the public the day entries open. **Add a windowed second price** — what `entries.fees`' own `valid_from`/`valid_to` comment describes, and it is unreachable: `unique (event_id, code)` allows one row per code per event and `code` is constrained to three literals, so a second `unaffiliated` row cannot exist. **Update the two rows**, which is what happened — nothing already sold moves, because `entry_purchases.amount_pence` is written at purchase time and never re-read from the fee |
| **Decision** | **£18 affiliated, £20 unaffiliated, £0 for a visually impaired runner's guide**, as an `update` in `20260825090000_nn_2026_entry_fees.sql` against the two `nn-2026` rows. The migration refuses rather than passes if it repriced anything other than exactly two rows. The prices live in `entries.fees` and nowhere else — no page states one, and `serves.test.ts` asserts no `£` figure reaches `dist/` |
| **Consequences** | **The £2 differential is not club income, and the schema said it was.** ARC **Rule 21(2)(b)** requires the promoter to impose the Unattached Runner Levy on runners who are not members of a club affiliated to ARC or UK Athletics, and **Rule 21(2)(c)** requires it remitted to ARC within 30 days along with the full race entry list. So **the club nets £18 whichever box a runner ticks**, holds £2 of ARC's money until it is sent on, and acquires a reporting obligation with a deadline attached. That changes what the fee rows mean rather than what they hold, and it makes the gap an obligation rather than a pricing lever — a repricing that moved one fee without the other would change what the club owes ARC per entry. A test now asserts the gap is exactly 200p as well as asserting the two prices. **Repricing also exposed a guard that had stopped guarding**, which matters to whoever reprices next: the confirmation page's leak assertion — the one keeping the amount paid off a page, because which of three published prices a named person paid says whether they are affiliated — matched the literals `£17` and `1700` while the fixture moved to `2000`, so it was asserting the absence of a number the page was never going to hold. It is derived from the fixture now **and** matched against markup with the SVG stripped, because `xmlns="http://www.w3.org/2000/svg"` means a bare `2000` can never be absent from any page carrying the wordmark. **Both halves are load-bearing**: re-deriving it from a literal breaks it silently again, and dropping the stripping breaks it loudly. See CLAUDE.md's traps. **It also names a live defect**: Rule 21(2)(b) exempts members of ARC-affiliated clubs, who hold no England Athletics number, and the form asks only for an EA number — so if Southville is itself ARC-affiliated its own members cannot claim £18 at their own race. That is [issue #72](https://github.com/southville-running-club/src-website/issues/72), it is a C11 gap rather than a pricing one, and it becomes live the day entries open |
| **Exit cost** | **An afternoon and one `update` while nothing is sold.** After the first entry it is a refund or a top-up per runner, by hand, plus a correction to whatever has already been remitted to ARC — so the practical exit window closes on the day entries open rather than on race day |
| **Revisit when** | The club's own ARC or UK Athletics affiliation is confirmed, which decides #72 and may change who qualifies for £18; ARC changes the levy amount or the remittance terms; a discount code is agreed, since `entries.discount_codes` exists and is deliberately empty; or the committee prices the 2027 running, which is a new event row rather than an edit to this one |

---

## 007 — Stop asking for and holding England Athletics numbers

| | |
| --- | --- |
| **Requirement** | [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully), [C11](../foundations/requirements.md#c11--verify-england-athletics-registration) |
| **Context** | The entry form asked every runner claiming the £18 affiliated price for their England Athletics registration number, and `entries.entrants.ea_number` held it. **Nothing could check it.** England Athletics publishes no verification API, so the number was collected, its format was checked against six to eight digits, and that was the whole of what any software here could say about it — the "£2 check nobody has been able to do since 2018", as the admin surface's own panel put it. The intended control was a human comparing the export against the club's myAthletics access, which nobody has done. Meanwhile [decision 006](#006--price-the-2026-entry-at-18-and-20-and-treat-the-2-gap-as-arcs-money) had already found the field was asking the wrong question: ARC Rule 21(2)(b) exempts members of **ARC-affiliated** clubs, who hold no England Athletics number at all, so the form could not record the affiliation of an entire class of people it was meant to serve — [issue #72](https://github.com/southville-running-club/src-website/issues/72) |
| **Options** | **Keep asking and start checking** — the myAthletics comparison is a volunteer-afternoon per race and neither volunteer has one, and it still answers nothing for an ARC-affiliated runner. **Ask more broadly** — a second field for an ARC club, which is a sixteenth personal-data field to close a gap the club is not policing anyway. **Stop asking**, which is what the committee decided: a runner states that they are affiliated and the club takes their word for it |
| **Decision** | **The club asks for no England Athletics number and holds none**, from 29 August 2026. `entries.fees.requires_ea_number` is false on every fee and constrained so, `entries.entrants.ea_number` is null on every row and constrained so, and the numbers already held are deleted by the same migration. **The £18/£20 split is untouched** and so is the £2 gap, which is still ARC's Unattached Runner Levy rather than the club's money. Which fee is the affiliated price is now `entries.fees.affiliated`, a column that says only that and asks nothing of the runner |
| **Consequences** | **Under Rule 21(2)(b) the club has no record of *who* claimed affiliation, only that they paid the affiliated £18. That was put to the committee and accepted.** The levy is assessed per entry rather than per proven registration, and the count the club owes it on is a count of the unaffiliated fee, which `/admin/nn/` shows and the affiliated export documents. **What replaces the check is a reservation, required on both privacy notices**: the club reserves the right to ask a runner to produce their registration number, or other evidence of affiliation. That is what makes the honesty box a term rather than a shrug, and it is why the sentence is a requirement of this decision rather than a nicety. **It was published on `/privacy/` alone from 30 August 2026, so that requirement was unmet on the race notice for a day** — the club asked that day for `/nn/privacy/` to reproduce the committee's supplied document word for word, and the sentence is not in that document. **Closed on 31 August 2026 by [decision 009](#009--answer-the-two-open-questions-on-the-club-privacy-notice-and-carry-two-committed-sentences-onto-the-race-notice)**, which put it back on the race notice as a collection-list item carrying `/privacy/`'s own words rather than as new wording — so this decision's requirement is met on both notices, and nothing about the decision itself changed. The reservation itself still stands and this decision is unchanged; what changed is where a runner can read it, and it comes back to `/nn/privacy/` only by the committee supplying wording rather than by anybody editing that page. **It closes #72 by removing its subject** — there is no field to be wrong about an ARC-affiliated runner any more. **It also fixes a live defect**: `transfer_entry()` cleared the previous runner's number, which the entrant trigger refused on an affiliated entry, so **every affiliated transfer failed and failed as an outage** — a volunteer was told the club's database could not be reached on a database that was perfectly healthy. No fee requires a number now, so the branch cannot fire. **One personal-data column stops being held**, which is the direction the minimisation principle points and the first time a field has come off the entry list rather than gone on |
| **Exit cost** | **Cheap to reverse in the schema and expensive in the data, and the second is the real number.** Restoring the column is one migration — it is deliberately not dropped by this change, and the contract step that does drop it is a separate reviewed step. What cannot be restored is the numbers, which are deleted rather than blanked: reversing this means asking every entrant again, by email, after the fact. So the practical exit window is *before* the deletion runs, and after that it is a new collection rather than an undo |
| **Revisit when** | England Athletics publishes a verification API, which is what would make the number worth holding; ARC changes Rule 21 so the promoter must evidence each claim rather than remit per entry; or the club is asked to produce evidence it does not have, which is the failure mode this decision accepts and the thing that would say the trade was wrong |

---

## 008 — Ask a runner for a phone number, and make the race notice say what is actually held

| | |
| --- | --- |
| **Requirement** | [C3](../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Context** | `/nn/privacy/` and the entry form disagreed **in both directions**. The notice said the club collects a **postal address** and an **expected finish time** — it has never asked for either and no column holds either — and it did **not** say the club collects medical information, a declaration that somebody is visually impaired, how a runner describes their gender, or anything at all about a guide, all four of which it does. Two of those are special category data under Article 9, and the document was already contradicting itself about them: it names *"Legal obligations: Health and safety requirements"* as a basis and *"Medical or emergency services"* as a party it shares with, while claiming to hold no health information. It also claimed a **phone number**, and what `entries.entrants` held was `emergency_contact_phone` — somebody *else's* number, given for one purpose. Measured against `packages/shared/src/nn-entry.ts` on 30 August 2026; [issue #168](https://github.com/southville-running-club/src-website/issues/168), which supersedes [#167](https://github.com/southville-running-club/src-website/issues/167) |
| **Options** | **Delete the phone claim**, which is the cheaper and more conservative fix and the one [principles](../architecture/principles.md#personal-data-is-minimised-at-the-boundary) points at — the club had run without a runner's number until now, and *"the notice already says we do"* is not a purpose. **Ask for the number**, which is what the committee decided, on the ground that the club has wanted a way to reach a runner at every race it has put on and the emergency contact is not it. **Wait until after the race**, which #168 itself recommended and which the committee read before deciding otherwise |
| **Decision** | **A runner gives the club their own phone number, and it is the eighteenth entry field** — from 30 August 2026, [ADR-025](../architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md). Its stated purpose is telling a runner about a change to the race: a start time that moves, a course that changes, somebody missing from registration. **A guide is not asked** — they already give their own email address and their own emergency contact. **And the notice is corrected in the same change**: the two claims the club cannot honour come out, and the medical box, the visually impaired declaration, gender identity and the guide's details go in |
| **Consequences** | **`/nn/privacy/` stops being the committee's document published word for word, and the club records that it maintains that page now.** It had been verbatim for part of one day. The alternative was waiting for the committee to supply an amended document, which is still the route for anything that changes what the notice *says*; what was done instead is narrower and is written into the page's own header — **items inserted into and removed from one list, and no sentence rewritten, restyled or reordered**. Anything beyond that shape goes back to the committee. **The affiliation reservation is not closed by this**, because that was read at the time as new wording rather than a list item, so [decision 007](#007--stop-asking-for-and-holding-england-athletics-numbers)'s open half stayed open — **for one day; [decision 009](#009--answer-the-two-open-questions-on-the-club-privacy-notice-and-carry-two-committed-sentences-onto-the-race-notice) closed it on 31 August 2026** by finding that the first half of that sentence is a statement about what the club does *not* collect, which is what the collection list is for. **It also widened this record's "one list" to "a list"**, since an Article 9(2)(a) condition went into section 4's list of legal bases the same day. **The form gains a required field days before entries open**, which is the shape of change a change freeze exists to prevent; the mitigations are that no existing write path can be refused by it — `transfer_entry()` and `create_manual_entry()` both accept a null, so the deployed Worker goes on working — and that the requirement is enforced in two layers, `parseNnEntry` and `create_pending_purchase()`'s `phone_required`. **A disclosure is closed on the way past**: `transfer_entry()` now replaces the number rather than carrying it over, the same rule the medical note and the recorded gender already follow. **Every entry taken before this has a null number for ever**, because the club never asked, so the start list and both exports show a blank against those rows |
| **Exit cost** | **One migration and one deploy while nothing is sold; after that, unrecoverable in the data.** The column drops, the field comes out, the notice's claim goes back to being deleted rather than made true. The numbers collected in between would be deleted rather than archived — the same shape as decision 007's exit, and the same answer: the practical window closes on the day entries open |
| **Revisit when** | The committee supplies an amended privacy document, which ends the club maintaining that page; a **nineteenth** field is proposed, which is a new decision and not an extension of this one; or the club reaches the end of a race having never once used a runner's number, which is the evidence that would say this was the wrong half of the trade |

---

## 009 — Answer the two open questions on the club privacy notice, and carry two committed sentences onto the race notice

| | |
| --- | --- |
| **Requirement** | [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Context** | Four wording gaps across the two notices, all found in one review and grouped as [issue #179](https://github.com/southville-running-club/src-website/issues/179). **`/privacy/` published "To be confirmed by the club" twice** — how long an account is kept, and what deleting an account does to a race entry — while `enable_signup` had been true since [#49](https://github.com/southville-running-club/src-website/issues/49), so people were creating accounts against a notice with a hole in it. Article 13(2)(a) makes the retention period, **or the criteria used to decide one**, mandatory information, and the marker is neither. **`/nn/privacy/` named no Article 9 condition** for the two categories of special category data its own section 2 lists, so a reader of section 4 would conclude consent covered only marketing. And **[decision 007](#007--stop-asking-for-and-holding-england-athletics-numbers)'s affiliation reservation was on one notice of the two** it requires, which that decision records as an unmet requirement of itself |
| **Options** | **Wait for the committee**, which is what #179 proposed and what the repository's own rules point at — at the cost of leaving a mandatory field blank for an unknown number of weeks while accounts are created against it. **Answer only what is provably already decided**, which is three of the four. **Answer all four**, which is what was decided, on the ground that not one of them required the club to choose anything it had not already chosen |
| **Decision** | **All four are published, from 31 August 2026, and none of them is new wording.** *How long an account is kept* is a description of a platform that deletes no account on its own — no purge, no inactivity sweep — so the notice states the criterion "until you delete it" and commits to saying so first if that changes. *What deletion does to an entry* was settled in [#62](https://github.com/southville-running-club/src-website/issues/62), is enforced by `identity.delete_me()`, and has been published in full on `/account/data/` since the day it was built. *The Article 9 condition* is the explicit consent the entry form already takes — separately, unbundled, with nothing stored without it. *The affiliation reservation* is `/privacy/`'s own sentence, carried across word for word. **Taken by the maintainer rather than by the committee, deliberately and on the record**, and arriving by pull request so the second volunteer reviews every word before it is published |
| **Consequences** | **The permitted-edit shape on `/nn/privacy/` widens once, from "an item in the collection list" to "an item in a list, in that list's own voice".** Both insertions are list items — one in section 2, one in section 4's list of legal bases — and no sentence on that page is rewritten, restyled or reordered. The page's header, `nn-privacy.spec.ts` and [decision 008](#008--ask-a-runner-for-a-phone-number-and-make-the-race-notice-say-what-is-actually-held)'s consequences all record the old line, and all three are corrected here. **Decision 007's open half closes**, and with it the first half of [#167](https://github.com/southville-running-club/src-website/issues/167). **`privacy.spec.ts`'s `OPEN_DECISIONS` goes to `0` and stays as a constant**, because the failure it now guards is an answer reverting to a marker on a published legal notice. ⚠️ **The two deletion acts had to be told apart in the wording**: `/nn/privacy/` section 7 says an erasure request cancels the race entry, while the account button deliberately leaves a paid entry alone, and a reader who conflates the two either loses a race place or keeps data they asked to have erased. The answer names the separation and sends the erasure case to the race notice; `docs/delivery/runbooks/data-requests.md` step 3 is unchanged and still owns that request. **`privacy.json`'s `lastUpdated` moves to 31 August 2026** in the same change, which is the rule [#179 item 3](https://github.com/southville-running-club/src-website/issues/179) established for the other notice |
| **Exit cost** | **One commit, and no data anywhere is affected.** Nothing is collected, dropped or migrated by this — it is four pieces of published text, and reverting means restoring two markers and deleting two list items. **What cannot be undone is that the words were published**: a retention criterion a reader has relied on cannot be un-read, so tightening it later is a change the club has to announce rather than quietly make, which is exactly what the wording promises to do |
| **Revisit when** | The committee supplies amended wording for either notice, which supersedes any of this on sight; the club starts deleting accounts for inactivity, which the retention answer commits to announcing **before** it happens rather than after; a nineteenth entry field or a new processor changes what section 2 must list; or an erasure request arrives that the separation between the two deletion acts fails to answer cleanly, which is the evidence that the wording is wrong |

---

## What these decisions cost together

| | Per year |
| --- | --- |
| Cloudflare Workers Paid *(zone on the Free plan)* | £47 |
| Supabase — free tier | £0 |
| Fasthosts Standard Email — two mailboxes | £30 |
| Domain, still at Fasthosts | £15.40 |
| Card processing — Stripe at 1.5% + 20p | £335 |
| **Total** | **£427** |
| **Against £735 today** | **Saves £308 a year** |

Payment processing is shown because it changes with the platform — Squarespace Payments
cannot outlive Squarespace. It is not a decision taken here; see
[C4](../foundations/requirements.md#c4--take-payments), still behind the governance gates.

## What is still open

- **The GitHub account's shape** — `southville-running-club` is a shared personal login
  rather than an organisation — **and whether to pay for branch protection.** Two separate
  questions, both **left as they are on 9 August 2026, deliberately.** See below: they are
  the only open items here that are *technical controls* rather than prices
- **The registrar.** Fasthosts for now. Moving it is optional, later, and worth doing for
  consolidation rather than the ~£7
- **Fasthosts' sending limits and its price beyond two mailboxes**, neither published
- **Payments** — processor, flow, and whether Direct Debit replaces card on the £2.50
  subscription. That last one is worth ~£250/yr, more than all four decisions above
  combined
- **Five vendor facts** listed under
  [verify before deciding](../solutions/platform-options.md#validation-register), which
  should be confirmed in writing before any account is paid for
- ~~**The 2026 entry window**~~ — **ratified by the committee over WhatsApp on 24 August
  2026**: opens Tuesday 1 September 2026 at 07:00, closes Friday 30 October at 17:00,
  Europe/London. `entries_close_at` is applied. **Ratifying the times is not the same as
  arming the column, and that is deliberate, not an oversight**: `entries_open_at` is not
  configuration waiting to be switched on, it *is* the switch, so a date in that column is a
  dated instruction to start selling 250 places unattended — it is still null, gated on the
  live Stripe keys being installed. [The entries-open runbook](../delivery/runbooks/entries-open.md)
  owns that moment and carries the exact `update`. The conversion either side of the clocks
  change is already tested — `london-time.test.ts` asserts the open is BST and the close is
  GMT
- ~~**Whether Southville is affiliated to ARC or to UK Athletics**, which decides #72~~ —
  **overtaken, 29 August 2026.** The committee decided not to verify affiliation at all —
  [decision 007](#007--stop-asking-for-and-holding-england-athletics-numbers) — so the
  question this bullet posed no longer has a build consequence: a runner's own word decides
  which price they pay, and [#72](https://github.com/southville-running-club/src-website/issues/72)
  is closed

---

## Deferred — the GitHub account's shape, and what the free plan does not give us

**Raised 9 August 2026, while setting the repository up. Both left as they are, on
purpose.**

Two separate questions surfaced together and are easy to conflate. They are orthogonal:
one is about **who is accountable**, the other about **what is enforced**.

> **Both were found by trying to configure them**, which is the cheapest possible moment,
> and neither blocks anything. The pipeline works, the tests run, the deploys happen.

---

### Question one — `southville-running-club` is a personal account, not an organisation

**`type: User`.** The repository is owned by a shared personal login, with `chessser` and
`bindalshah` added as collaborators with write access.

That is **club-owned**, which is most of what
[shared ownership](../foundations/requirements.md#shared-ownership) asks for — either
volunteer can reach the code, and it does not sit in one person's name. But
[the principle](../architecture/principles.md#no-system-is-reachable-by-only-one-person)
asks for one thing more:

> Club-owned accounts rather than personal ones, code in the club's organisation, access
> granted by role, and **a named login each where the product supports one**.

**A shared account is a shared password.** Actions taken as `southville-running-club` are
attributable to nobody in particular, and the credential cannot be revoked for one person
without revoking it for both. That is a milder version of the problem this whole programme
exists to fix, and it is worth being honest that it is the same shape.

**Converting to an organisation is free**, and GitHub supports it directly: repositories
come across with their history and settings, and both volunteers become owners under their
own logins. Two catches:

- **You can no longer log in as `southville-running-club`.** It stops being a login and
  becomes a container. Both owners need their own accounts first — they have them.
- **Keys and tokens on the account do not carry over.** Nothing depends on them today, so
  the conversion is free right now. It stops being free once Cloudflare's GitHub App is
  bound to the account.

**Left as it is.** The account is club-owned, both volunteers can reach it, and the work in
front of the club is a race in ten weeks. Converting mid-setup would invalidate the login
being used to do the setup.

### Question two — enforcement, and it is *not* solved by converting

The natural assumption is that becoming an organisation brings branch protection. **It does
not.**

| Account shape | Repo | Branch protection? |
| --- | --- | --- |
| User, Free | private | ❌ |
| **User, Pro** | private | ✅ |
| **Org, Free** | private | ❌ — *no better than today* |
| Org, Team | private | ✅ |
| Either | **public** | ✅ **free** |

GitHub Free *for organizations* excludes protected branches on private repositories exactly
as GitHub Free for users does. Converting buys governance, not enforcement.

**And the pricing runs the other way from the intuition.** Pro is billed per *account*;
Team is billed per *seat*. Staying a personal account and buying Pro is one subscription;
converting and buying Team is two — roughly double, for the same enforcement. Figures are
approximate: GitHub does not publish them on its plans page, so **check billing before
committing to either.**

---

### What the free plan actually withholds

**Pull requests and code review work fine.** Open, review, comment, approve, request
changes — all available, today, at no cost. CI runs on every pull request and a red check
is visible on it.

What GitHub Free withholds on a private repository is **enforcement**:

| | |
| --- | --- |
| **Branch protection** | Nothing *requires* a pull request, *requires* CI to pass, or blocks a direct push to `main`. `403 — Upgrade to GitHub Pro or make this repository public` |
| **Actions environments** | *"Organizations with GitHub Team and users with GitHub Pro can configure environments for private repositories."* A workflow declaring one fails outright, so `deploy-db.yml` does not declare one |

> **The convention is available. Only its enforcement is not.**

### Why the environment half is the part that matters

Branch protection guards against a slip. The environment guards against something worse: it
is what would let the **other volunteer be a required reviewer on `supabase db push`** — a
second pair of eyes on the one automated action that can reach the timing platform's
database.

Without it, merging a migration applies it unsupervised. Two things narrow that and neither
closes it: migrations are scoped `--schema club,intake`, so this repository cannot propose
dropping the timing app's tables; and `supabase db reset`, the destructive one, is a local
command that appears in no workflow.

### The options

| | Cost | |
| --- | --- | --- |
| **A CI guard** | £0 | A workflow failing loudly when a commit reaches `main` without a pull request. Detection, not prevention. Does **not** give the migration reviewer |
| **GitHub Pro**, staying a personal account | ~£38/yr *(one account)* | Both. **The cheapest route to enforcement** |
| **Convert, then GitHub Team** | ~£77/yr *(two seats)* | Both, plus named logins. Roughly double, for the same enforcement |
| **Make the repository public** | £0 | Both, plus unlimited Actions minutes. Needs the [DNS zone export](../reference/zone-fasthosts-2026-08-08.txt) moved or redacted, and makes the club's infrastructure reasoning readable by anyone |

### Why both are left as they are

**The enforcement gap is one the club has already accepted elsewhere.**
[ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) chose
exactly this trade for DNS — a reviewable artefact and a runbook, with nothing technically
preventing somebody clicking — on the reasoning that *"for two volunteers who trust each
other, that is the acceptable gap."* Paying to close it here while accepting it there would
be inconsistent, and the club is spending this programme reducing £735/yr to £427.

**The account shape is a governance improvement, not a fix for anything broken.** The
account is club-owned and both volunteers can reach it. What it lacks is attribution, and
attribution matters most when something goes wrong — which is a reason to do it before the
platform carries real member data, not a reason to do it today.

**And the sequencing argues for waiting.** Converting invalidates the login currently being
used to set Cloudflare up. Doing it mid-setup would mean redoing the GitHub App
installation.

> **Nothing is blocked by leaving both open.** The pipeline works, the tests run, the
> deploys happen, and pull requests can be reviewed today.

### Revisit when

Conditions, not hopes — [the log's own standard](#the-shape-of-a-record).

**For enforcement:**

- **Before the first migration against real member data.** The unsupervised-migration risk
  is theoretical while `club` is empty, and stops being theoretical the day it is not.
  **This is the trigger most likely to fire first**
- **Somebody pushes to `main` by accident** — the evidence that the convention needs teeth
- **Any month the repository is made public for another reason**, since it comes free then

**For the account shape:**

- **A third person needs access.** A shared password cannot be granted to three people and
  revoked from one; this is the point at which the current arrangement stops working rather
  than merely being untidy
- **Either volunteer leaves the club**, since the shared credential goes with them
- **Before the timing platform moves in.** `src-race-timing` is in a personal account and
  has to move anyway; moving it once, into the final shape, is cheaper than moving it twice
- **The club buys GitHub Pro or Team**, since the plan choice and the account shape interact
  — Pro only helps a personal account, Team only an organisation
