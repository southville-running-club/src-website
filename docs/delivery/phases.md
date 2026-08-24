# The phases

The shape of the programme, end to end. **Start here**, then use [the plan](plan.md) for the
numbered steps and the [runbooks](runbooks/) for the procedures.

| | | Deadline |
| --- | --- | --- |
| **[1](#phase-1--prove-the-hosting-path)** ✅ | ~~Prove the hosting path~~ | **Done 8 Aug 2026** |
| **[2](#phase-2--move-the-nameservers)** ✅ | ~~Nameservers to Cloudflare~~ | **Done 8 Aug 2026** |
| **[3](#phase-3--nightingale-nightmare-live)** | **Nightingale Nightmare live** — sign-ups and Stripe payment | **~22 August 2026** — two weeks |
| **[3b](#phase-3b--member-accounts-before-entries-open)** | **Member accounts** — Supabase Auth, three roles, `/account/` and `/admin/` | Before entries open, **early September** |
| **[4](#phase-4--the-timing-app-on-cloudflare)** | **The timing app on Cloudflare**, same database | **Race-ready by mid-October** |
| **🏁** | **Nightingale Nightmare — race day** | **Sun 1 Nov 2026, 11:00** |
| **[5](#phase-5--the-new-website)** | The new website at `new.<apex>` | From November |
| **[6](#phase-6--move-the-member-payments)** | Member payments move | The long pole — starts during Phase 5 |
| **[7](#phase-7--decommission-squarespace)** | Decommission Squarespace | **Before 21 March 2027** |

**Phases 3 and 4 both complete before the race**, and the race uses the migrated timing app
on Cloudflare, reading the same database as Nightingale Nightmare.
[ADR-008](../architecture/decisions/adr-008-timing-port-before-the-race.md) records why the
port lands *before* the race rather than after, and what makes that the lower-risk answer:
**the [race simulation](#the-gate-on-phase-4) is the sign-off, and the existing Vercel
deployment stays live until it passes.**

---

## The dates that are real

| | When | Why it is fixed |
| --- | --- | --- |
| **NN sign-ups and payment live** | **~22 August 2026** | Entries want to open in early September; the race needs a lead time to fill |
| **Timing app race-ready** | **Mid-October 2026** | Leaves a fortnight for the race simulation and anything it finds |
| **Race day** | **Sunday 1 November 2026, 11:00** | **Confirmed 12 August 2026**, by the club's published campaign artwork. The clocks go back on **Sunday 25 October**, so the race is the following weekend, in GMT |
| **Squarespace renewal** | **21 March 2027** | Automatic. Silence costs £204 |

**Two months separate Phase 3 from race day, and one month separates Phase 4 from it.** The
timing app's own deadline is *race-ready*, not *deployed* — the
[race simulation](#the-gate-on-phase-4) is the gate, and it needs slack behind it.

---

## One database, several schemas

**Everything runs on a single Supabase Postgres project**, separated by schema — the timing
app, Nightingale Nightmare, and eventually the website.

That is [ADR-002](../architecture/decisions/adr-002-schema-layout.md), and it is what makes
[C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
possible: the results archive reads the timing tables directly rather than re-keying them.
Two projects would be two Postgres instances and could not join.

**The detailed schema design is deferred to the next pull request** — including where race
entries and payment records land, and how `intake` promotes into `club`.

---

## Everything is a Worker

Phases 1 and 2 changed what is possible, and the documentation is in line.

| | Before 8 Aug 2026 | **Now** |
| --- | --- | --- |
| Serving a club hostname | **Pages only** — Workers custom domains need an active zone | **Workers** |
| Adding the DNS record | By hand at Fasthosts, in the right order or 522 | **Cloudflare creates it**, with the certificate |
| Next.js on Cloudflare | Impossible on the club domain | **`@opennextjs/cloudflare` on Workers** |

**Static Astro still needs no adapter.** A static build plus one Worker route is the right
shape for NN — it just deploys as a Worker with static assets, and the hostname attaches
itself.

---

## Phase 1 — prove the hosting path

> ## ✅ Done — 8 August 2026
>
> A throwaway project served a page at `nn.southvillerunningclub.co.uk` over HTTPS, then was
> deleted. Its whole purpose was to prove the path before anything depended on it.

**What it established:** Cloudflare could serve a club hostname, the certificate issued
automatically, and the ordering trap was real.

*The pattern is worth repeating — prove the path with something disposable, then build the
real thing knowing the path works.*

---

## Phase 2 — move the nameservers

> ## ✅ Done — 8 August 2026, 15:54 UTC
>
> Delegation is `bonnie.ns.cloudflare.com` / `hans.ns.cloudflare.com`, confirmed at both `.uk`
> registry servers. All 18 records verified identical before and after; nothing proxied; site
> still served by Squarespace; mail routing unchanged through Fasthosts; all four DKIM chains
> resolving to live public keys.
>
> **Outstanding:** the 48-hour window closes 10 August; the Cloudflare zone export needs
> committing; the Fasthosts zone is kept until **8 September** as the rollback.

**What it unblocked:** Workers custom domains, and therefore Phase 4. Also the current Astro
adapter, Cron Triggers, and a Phase 7 apex cutover that is now a record edit.

[What actually happened](runbooks/nameserver-move.md#what-actually-happened-8-august-2026) —
**Cloudflare's scan found 12 of 18 records**, missing all four DKIM CNAMEs.

---

## Phase 3 — Nightingale Nightmare live

**Deadline: ~22 August 2026.**

A public page, a sign-up link, and **payment through Stripe**. This is the club's first
transaction on its own infrastructure.

| | |
| --- | --- |
| **The monorepo and pipeline** | Workspace root, `apps/main`, `packages/db`; local stack, CI, acceptance tests. [ADR-001](../architecture/decisions/adr-001-one-monorepo.md), [ADR-003](../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **A Worker**, git-connected, `main` deploys production | Static Astro plus Worker routes |
| **`new.<apex>/nn`** | A path, not a subdomain. `new.<apex>` is the Worker's custom domain and Cloudflare creates the record — [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) |
| **Sign-up** ✅ | **Built.** Name, email and consent into `intake.nn_interest`, through a column-scoped anonymous-insert grant. A real `<form method="post">` that works with JavaScript disabled, and a privacy notice at `/nn/privacy/` |
| **The race pages** ✅ | **Built**, and now split between the race and one running of it — [ADR-011](../architecture/decisions/adr-011-a-race-and-its-runnings.md). Evergreen at `/nn/` and `/nn/course/`; the confirmed date, the race facts and the entry form at `/nn/2026/`, with `/nn/2026/race-day/` and `/nn/2026/spectators/` beneath it. All of them read from `apps/main/src/content/race.json`. **The first of the race director's confirmed copy landed 24 August 2026** — her opening two paragraphs on `/nn/`, the water station's location, and the guide-places wording in front of the entry form. **The rest of the prose is still a draft pending committee approval** |
| **Two pages renamed, and their addresses did not move** | `/nn/<year>/race-day/` is headed **Race instructions** and `/nn/<year>/spectators/` is **Spooktators**, both the race director's words. The slugs are unchanged deliberately: moving them would cost a redirect [ADR-011](../architecture/decisions/adr-011-a-race-and-its-runnings.md) records this site as having no mechanism for, and buys a reader nothing. The nav `key` is the slug segment, not the label |
| **The bar says "Race info" where that page says "Race instructions"** | **Not a compromise about the words — the bar's height is load-bearing.** "Race instructions" in the navigation adds 48px, a whole second row, at every width from 768px up, and again at 560px. That overflows `scroll-padding-top`, which is the hand-written per-breakpoint token that pays for defect 2 of the three [ADR-012](../architecture/decisions/adr-012-one-navigation-bar.md) unstuck this bar over and [ADR-014](../architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md) stuck it back by answering. A label that wraps the bar re-opens that defect silently: every anchor and every keyboard focus on those screens lands behind the header. **"Race info" measured identical to the old "Race day" at all thirteen widths, and "Spooktators" identical to "Spectators".** The bar has always been allowed to be shorter than the heading — it read "Spectators" over "Watching the race". `site.spec.ts`'s nine-width sweep is the guard, and it is what caught this |
| **Stripe payment — the handoff** ✅ | **Built.** A valid entry holds a place for 31 minutes under a per-event lock, is priced from `entries.fees`, and is handed to Stripe Checkout. Capacity is enforced under real concurrency, and the club never sees a card number |
| **Stripe payment — the confirmation** ✅ | **Built.** `POST /nn/stripe-webhook` verifies Stripe's signature over the raw bytes and is the only thing that writes `paid`. Idempotent under retry and duplicate delivery; a payment arriving after the hold lapsed is taken rather than refused, and flagged when there was no room. `/nn/2026/entry/complete/` reports what the club has recorded. [ADR-010](../architecture/decisions/adr-010-webhook-writes-paid.md) |
| **Reading the entries, and forgetting on time** ✅ | **Built.** `/nn/admin` — the entries for a running with the category derived and an over-capacity payment impossible to miss, the interest list nobody could read until now, and three CSV exports with the medical one deliberately separate. Behind a Worker secret and a key per volunteer, with every medical read and every export recorded. And the five-minute cron now **deletes medical notes a month after the race**, which `/nn/privacy/` has been promising since it was published. [ADR-013](../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) |
| **Registering the Stripe endpoint** | **A human's job, and the last of `apps/main/README.md`'s manual steps.** It needs the production URL — created any earlier and Stripe posts into a 404. The three Worker secrets go on at the same time |
| **Switching the admin surface on** | **A human's job too, and independent of everything above.** A fourth Worker secret and its digest, then one key per volunteer — [the admin runbook](runbooks/entries-admin.md). Until it is done `/nn/admin` 404s at every address, which is the correct state rather than a broken one |
| **A real payment end to end** | Nothing has been paid for yet, in test mode or otherwise. The first real payment is the first full test of the chain, and it should be a committee member's own card in test mode before entries open |

**Procedure:** [the Cloudflare runbook](runbooks/cloudflare-setup.md) covers the hosting
path — the two Workers, one hostname told apart by path. The page, form and payment flow
are [the build brief](nn-build-brief.md)'s.

### Prerequisites for the payment half

These are [club governance requirements](../foundations/requirements.md#legal-and-governance),
so they are prerequisites rather than build tasks — and they sit on the critical path for
22 August:

- [ ] **Data-protection advice** obtained
- [ ] **Treasurer-controlled payment arrangements** in place
- [ ] **Stripe account** under the club identity, with both volunteers able to reach it
- [ ] **Refund policy** written, since money is being taken from the public
- [x] **Entry price confirmed** — **13 August 2026: £15 affiliated, £17 unaffiliated, £0 for a
      visually impaired runner's guide.** Not the £8–£10 this line assumed. They live in
      `entries.fees.price_pence` and nowhere else

Three things the payment half surfaced that are the committee's rather than the build's, and
none of them blocks the rest:

- [ ] **The entry terms.** Not written, and the form's checkbox says so rather than linking to
      a page that does not exist. **They have to land before entries open**
- [ ] **How a free place is taken.** Stripe refuses a zero-total Checkout session outright, so
      a guide's place cannot be completed online. The form says so and gives the race address;
      completing it any other way means deciding that an unpaid entry counts as paid
- [ ] **A rate-limiting rule on `POST /nn/`.** An anonymous caller can hold places, up to the
      whole field, for as long as a hold lasts. A Cloudflare WAF rule is the recommendation
      and it costs no code — a cap in the database would block a legitimate person retrying on
      bad signal, which is a policy decision

**Card data never touches club systems.** Stripe Checkout, hosted by Stripe, with a webhook
recording the result. That is what keeps this inside
[C4](../foundations/requirements.md#c4--take-payments) and out of PCI scope.

### Running alongside, and it should start now

**Rescue everything Squarespace deletes at cancellation** — ~45 documents, 33 newsletters,
every image, plus the seven on Google Drive. Free today, impossible after cancellation, and
depends on nothing.

### What the race pages still need from the committee

None of it blocks the site, which is built and tested. All of it is
[stop-and-ask](../architecture/principles.md#stop-and-ask) territory rather than a build
decision, and everything undecided renders as "to be confirmed" rather than as a guess:

- [ ] **The privacy notice's four open decisions** — who somebody writes to about their
      data, how long an entry record is kept, whether an email address is kept to tell
      people about next year's race, and what is true about photographs. All four are
      `null` under `race.json`'s `privacy` key and render "To be confirmed by the club".
      **The notice itself is written** and covers the entry as well as the interest form
- [ ] **Four rows of the notice were derived from the schema, not approved.** The committee
      approved a draft listing what somebody types; the tables also hold the fee and amount,
      Stripe's references, the consents with their version, and three timestamps. Those rows
      and one lawful basis were added because a notice that omits them under-lists what the
      club processes. They go to the committee with the four above
- [ ] **Whether a submission with the consent box unticked is stored at all.** It is
      currently *required to submit*. The database is deliberately neutral on it, so
      reversing this needs no migration
- [ ] **The 2026 ARC permit number.** Not yet issued. `race.permit` is `null` and the
      2023 number is not a stand-in for it. **ARC Rule 21(2)(a) makes this a required page
      element rather than only a fact the pages happen to lack**: the words "Under ARC Rules"
      and the permit number must appear on any printed matter or electronic communication
      connected with the event, and the website is both. Scoped now so it is not discovered in
      October; blocked on the number
- [ ] **The group warm-up time.** The 2026 schedule is confirmed in four of its five rows —
      registration 09:15, briefing **10:30**, walk to the start **10:40**, start 11:00, moved
      later because the 2023 debrief found the race went off before the marshals were in
      position. The fifth row, a group warm-up at 10:45, cannot stand once the field leaves HQ
      at 10:40 and no replacement has been supplied. **One unresolved row blocks all four**, so
      `race.json` still carries the old schedule rather than half the new one. Three
      hardcoded `10:30`s in `race-day.astro`'s prose go with it when it lands
- [ ] **The entry window.** The race director has proposed **open Tuesday 1 September 2026 at
      07:00, close Friday 30 October 2026 at 17:00** — note the offsets differ, because BST ends
      on 25 October. [The entries-open runbook](runbooks/entries-open.md) makes the window the
      committee's rather than the race director's, and it has not been to them. Publishing the
      close time is also a schema decision and not a copy one: `entry_state()` deliberately does
      not return `entries_close_at`
- [ ] **The 2026 race-day text exists as an email, not as page copy, and that was a decision.**
      The race director's race-day wording — the "all the information you need for the big day"
      opening, the two typos, the "more on that later" forward reference — is **not in this
      repository at all**, and its absence is deliberate rather than an oversight:
      `2026/race-day.astro`'s header note records that the 2023 instructions were a pre-race
      email written to people who had already entered, and `site.spec.ts`'s "the content pages
      state the facts they were given" asserts that "commiserations" never appears on any content
      page. **Putting that text on the page would reverse both**, and is its own slice rather
      than a copy fix. Outstanding with the race director
- [ ] **Four things the spectators rewrite would have dropped** — the no-on-street-parking
      request, fancy dress applying to spectators, the prizegiving, and the page's lede. Her new
      wording is being treated as additive until she confirms whether the cuts were deliberate,
      so the rewrite is held and only the rename has landed
- [ ] **Approval of the rest of the page copy.** What the race director has confirmed is in;
      the prose around it on the four Nightingale Nightmare pages is still a **draft written to
      be edited**, not a decision taken on the committee's behalf
- [ ] **Six questions the content pages could not answer** — map links for the start and
      the finish, which charity the donation tin is for, whether there is a cut-off time,
      dogs and buggies, whether the no-headphones rule has an exception for VI guides, and
      whether there are toilets at the start. Each is a gap on the pages rather than a
      guess, which is the whole reason they are listed here

### Done when

- [ ] `new.<apex>/nn` serves over HTTPS with a valid certificate
- [x] A sign-up writes exactly one row, and the form works **with JavaScript disabled**
- [ ] **A real payment completes end to end**, and the treasurer can see it
- [x] An anonymous client **cannot** read member data — nor read, change or delete the
      interest list, asserted by error code
- [ ] CI green: lint, types, migrations from zero, unit, Worker, Playwright + axe at zero
- [ ] **Club email still works**
- [ ] **Both volunteers** can reach the repository, the Worker, Supabase and Stripe

---

## Phase 3b — member accounts, before entries open

**Decided 24 August 2026** — [decision 005](../decisions/decision-log.md#005--give-the-platform-member-accounts-on-supabase-auth)
and [ADR-015](../architecture/decisions/adr-015-member-accounts-on-supabase-auth.md). Not one
of the original seven phases; it sits between Phase 3 and Phase 4 because the committee decided
accounts come before entries open, and entries want to open in early September.

**Supabase Auth, three roles, `/account/` and `/admin/`.** Roughly seventeen pull requests,
tracked end to end — with the ordering, the break-glass, and the cost of each piece — in
[issue #65](https://github.com/southville-running-club/src-website/issues/65). Nothing in that
series may start before this phase's own first issue,
[#48](https://github.com/southville-running-club/src-website/issues/48), is merged: it is
documentation only, and every other issue inherits its reasoning.

**The two-key admin scheme from Phase 3 is not replaced by this phase.** [#57](https://github.com/southville-running-club/src-website/issues/57)
adds a role-gated path into `/nn/admin` beside it, and if this phase is not finished by early
September, installing the two keys per
[the admin runbook](runbooks/entries-admin.md) remains the way to read entries on race
morning. #65 calls this out explicitly as the break-glass, costing nothing to keep available.

---

## Phase 4 — the timing app on Cloudflare

**Deadline: race-ready by mid-October 2026.** It runs Nightingale Nightmare.

Off Vercel, onto Workers, reading the **same Supabase project** as NN.

| | |
| --- | --- |
| **`@opennextjs/cloudflare`** on Workers | Not Pages — `@cloudflare/next-on-pages` is deprecated and Edge-runtime only |
| **The repository joins the monorepo** | **Move it into the club org *first*, then connect Cloudflare** — doing it after desyncs the git link |
| **`new.<apex>/timing`** | A **route** on the same hostname, not a custom domain. Needs `basePath: '/timing'`, and the service worker scope moves with it — [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) |
| **Same database** | One project, schema-separated. Nothing migrates |

### Do the deployment half first

> ✅ **Done, 9 August 2026** — as `apps/timing`, a hello-world Worker on
> `new.<apex>/timing` (a route, not the subdomain this step originally named; see
> [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md)).

**Stand up a hello-world Worker on the club hostname early** — proving Workers Builds, the
route and Supabase connectivity with a page that has nothing in it. Then the port only
has to prove the application half, and every failure after that is application code.

This cost an afternoon and was the single best thing available for de-risking the
deadline. What remains for Phase 4 is the application half: the port itself, described
below.

### The gate on Phase 4

**A full manual race simulation signs this off** — multiple devices, real connectivity loss,
the real race date. [No test suite replaces
it](../foundations/glossary.md#platform-and-delivery), and the timing app's own logs note the
two-marshal path is still only partially verified.

**Mid-October is the deadline so the simulation has a fortnight behind it.** If the simulation
finds something in the last week, there needs to be room to fix it — and the fallback is the
existing Vercel deployment, which stays available until the simulation passes.

### Three things the port must not break

From the [architecture review](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know),
each learned the hard way:

1. **The IndexedDB offline queue** and its idempotent-upsert contract.
2. **The TypeScript/SQL lockstep** on bib resolution.
3. **`Europe/London` pinning.** The race is the weekend after the clocks change.

### Known work beyond a straight port

| | |
| --- | --- |
| **The live leaderboard** | **Durable Objects, not Supabase Realtime.** Realtime caps at 200 concurrent; hibernatable WebSockets on the free plan make this close to free. A rebuild, not a port |
| **Solo-race gaps** | The leaderboard derivation is relay-shaped; **age-band categories do not exist yet** and NN needs them |
| **Multi-event hardcoding** | `LOCATION_LABEL = "Ashton Court"` and evening-start copy |
| **Bundle size and CPU limits** | 3 MB compressed on free Workers, 10 ms CPU. Unmeasured for this app |

---

## 🏁 Race day — Sunday 1 November 2026

**Confirmed on 12 August 2026**, and the start is 11:00. The clocks go back on Sunday 25
October, so this is the following weekend and the whole day runs in GMT.

Nightingale Nightmare, timed on the club's own platform, on the club's own domain, reading the
club's own database.

**Change freeze from the week before.** No deploys, no migrations, nothing.

---

## Phase 5 — the new website

*From November.*

The old site keeps running throughout; the new one grows beside it at `new.<apex>` with
**paths matching the old site**, so every address is proven long before anything switches.

**The payment page is built first** — and by then Stripe is already proven by Phase 3, which
removes most of its risk. Every *new* subscriber goes to it from that day; the old list grows
by about **45 payments a month**, and this is what turns Phase 6 from a growing problem into a
fixed one.

Then the results archive (16.6% of traffic, and it publishes itself from the timing data), the
main pages (61%), the newsletter mirror, documents, membership forms, and the kit section
**re-scoped before it is built**.

`noindex` across the subdomain until cutover.

---

## Phase 6 — move the member payments

⚠️ **The one part that asks anything of members.** ~103 people, each personally
re-establishing a payment, because Squarespace Payments mandates cannot be transferred.

**A communications exercise measured in months.** The longest part of the programme and the
only part that cannot be sped up by working harder.

**Decide card or Direct Debit before anybody is asked to move** — worth about £250/yr, and
deciding late means asking 103 people twice.

**Starts during Phase 5, not after it.** It needs the payment page, not the finished website.

---

## Phase 7 — decommission Squarespace

**Before 21 March 2027.** Phase 2 already unblocked this — Cloudflare is authoritative, so the
apex cutover is a record change rather than a migration.

**One coordinated moment**, because Squarespace 301-redirects every secondary domain to its
primary. Decide first where the old site goes — `old.<apex>`, or its built-in
`*.squarespace.com` address, which needs no DNS at all.

Then point the apex and `www` at the new site, tidy the SPF record, remove `noindex`, redirect
`new.` → apex, and walk every old address for 404s.

**Confirm five things before cancelling:** the site is rebuilt and serving the apex; every URL
resolves; the member fund has moved; every document, newsletter and image is held by the club;
and the treasurer can reconcile.

---

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After Phase 7 | **£427** |
| With Direct Debit as well | **£177** |

**The money was never the point.** The larger return is the [manual
work](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
this removes.

## Deferred to the next pull request

- ~~**Schema design in detail**~~ — **done.** The `entries` schema, six tables, RLS on every
  one from its first migration. How `intake` promotes into `club` is still open
- ~~**The Stripe data model**~~ — **done.** The reference and never the instrument: a Checkout
  session id and a payment intent id, and no card number, last four or expiry anywhere near
  this database. That is what keeps the club out of PCI scope
- **The webhook** — what confirms a payment, how it authenticates, and what privilege it
  writes with. **Not a licence for a service role key**
- **The confirmation email** — nothing is sent yet, and `/nn/2026/entry/complete/` is worded as
  what the club will do rather than what has happened
- **The backup runbook**, with a tested restore
