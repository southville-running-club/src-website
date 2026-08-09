# Decision log

Where choices get recorded once they are made — and, just as importantly, how they get
**re-opened** when the ground shifts.

**Nothing is recorded here yet.** [Requirements](../foundations/requirements.md) and
[options](../solutions/options.md) come first; decisions come after. That order is the
point of this branch.

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

Proposed by the Web Manager, 7–8 August 2026. **Not yet ratified by the committee** — the
[governance gates](../foundations/requirements.md#legal-and-governance) still stand, and
nothing here authorises payment work.

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

- **Whether to pay for GitHub Team**, ~£70–90/yr for two seats. **Deferred 9 August 2026,
  deliberately.** See below — it is the only open item here that is a *technical control*
  rather than a price
- **The registrar.** Fasthosts for now. Moving it is optional, later, and worth doing for
  consolidation rather than the ~£7
- **Fasthosts' sending limits and its price beyond two mailboxes**, neither published
- **Payments** — processor, flow, and whether Direct Debit replaces card on the £2.50
  subscription. That last one is worth ~£250/yr, more than all four decisions above
  combined
- **Five vendor facts** listed under
  [verify before deciding](../solutions/platform-options.md#validation-register), which
  should be confirmed in writing before any account is paid for

---

## Deferred — GitHub Team, and what the free plan does not give us

**Raised 9 August 2026, while setting the repository up. Not decided.**

`src-website` is **private on GitHub Free**, and that withholds two things. Both were
discovered by trying to configure them, which is the cheapest possible moment.

### What is actually missing

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
| **GitHub Team** | ~£70–90/yr | Both. Verify the exact figure before committing — it is not published on the plans page |
| **Make the repository public** | £0 | Both, plus unlimited Actions minutes. Needs the [DNS zone export](../reference/zone-fasthosts-2026-08-08.txt) moved or redacted, and makes the club's infrastructure reasoning readable by anyone |

### Why it is deferred rather than taken

The club is spending this programme reducing £735/yr to £427. A new recurring cost needs to
earn its place, and the gap it closes is one the club has **already accepted elsewhere**:
[ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) chose
exactly this trade for DNS — a reviewable artefact and a runbook, with nothing technically
preventing somebody clicking — on the reasoning that *"for two volunteers who trust each
other, that is the acceptable gap."*

**Nothing is blocked by leaving it open.** The pipeline works, the tests run, and the
deploys happen.

### Revisit when

- **Before the first migration against real member data.** The unsupervised-migration risk
  is theoretical while `club` is empty and stops being theoretical the day it is not
- **A third maintainer arrives**, so enforcement starts to matter more than trust — the same
  trigger ADR-005 names
- **Somebody pushes to `main` by accident**, which is the evidence that the convention needs
  teeth
- **Any month the repository is made public for another reason**, since it comes free then
