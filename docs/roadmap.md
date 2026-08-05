# Roadmap

Derived from the [platform proposal v8](reference/platform-proposal-v8.md), July 2026.
Dates are the proposal's; scope here is written as delivery work.

This repository owns **Workstream 3** primarily, and hosts the site that workstreams 4
and 5 attach to. Workstreams 1 and 2 belong to the timing app and are listed for
sequencing context.

---

## Immediate — no cost, no code

These are club-administration actions that unblock everything downstream. They are not
software tasks but they gate software tasks.

- [ ] Switch on Squarespace's "cover the fees" option on the existing member fund.
      Free, immediate, and 0% of payments currently use it.
- [ ] Establish who owns the payment account connected under Squarespace, and put it
      under treasurer oversight. Club money flows through it today.

---

## Workstream 1 — every year's race, kept forever

*Timing app. Already underway. Cost: volunteer time.*

Each running of each race becomes its own event — Pass the Buck 2026, Pass the Buck
2027, Nightingale Nightmare 2026 — with its own roster, crossings and results, nothing
overwritten. A safety rule ensures only one event can be live for timing at a time, so a
marshal's phone cannot capture into the wrong race.

**Dependency for this repo:** the permanent, public results archive the website renders
depends entirely on this data model.

---

## Workstream 2 — Nightingale Nightmare on the same platform

*Timing app. Cost: volunteer time.*

A solo mass-start 10 km: one runner per entry, one gun, one finish crossing each.
Reuses nearly all existing machinery; what is new is configuration — solo entries, plain
sequential bibs, and age-band categories (Vet 40/50/60, male and female), which require
date of birth in the entry data.

Blocked on club answers — see [Open questions](open-questions.md).

---

## Workstream 3 — the new club website *(this repository)*

*Cost: ~£15/yr domain, replacing £170–£420/yr Squarespace.*

Rebuild `southvillerunningclub.co.uk`: about, membership, training sessions, news, and a
page per race drawing information and results directly from the shared database.

**Sequencing constraints, both hard:**

1. The **hosting decision is settled first** ([ADR-0002](adr/0002-hosting-platform.md)),
   so the site is built once on its final home.
2. The **member fund is re-homed before Squarespace is cancelled**
   ([P13](principles.md#p13--governance-gates-come-before-the-code-they-enable)).

### Phase 3a — foundations

- [ ] Settle hosting ([ADR-0002](adr/0002-hosting-platform.md)) and repository shape
      ([ADR-0006](adr/0006-repository-shape.md)).
- [ ] Containerised local + CI environment ([ADR-0009](adr/0009-containerised-environments.md)).
- [ ] Pipeline skeleton: lint, type check, test, build, preview deploy
      ([ADR-0008](adr/0008-github-actions-pipeline.md)).
- [ ] Application scaffold, design tokens, layout, accessibility baseline.
- [ ] Read-only database access layer with row-level security proving the website
      cannot write to timing tables.

### Phase 3b — content and results

- [ ] Static pages: about, membership, training sessions, contact.
- [ ] News.
- [ ] Race pages, database-driven ([P2](principles.md#p2--the-database-is-the-source-of-truth-for-anything-that-changes)).
- [ ] Permanent results archive: every year, stable URLs, course records, year-on-year
      comparison ([P3](principles.md#p3--results-are-permanent-and-append-only)).
- [ ] Full content migration from Squarespace, with redirects from every existing URL.

### Phase 3c — cutover

- [ ] Accessibility and performance sign-off.
- [ ] Repoint DNS at Fasthosts from Squarespace to our hosting
      ([ADR-0005](adr/0005-dns-at-fasthosts.md)), with a tested rollback.
- [ ] Verify the member fund has fully moved and the treasurer has confirmed it.
- [ ] Cancel Squarespace, ahead of its next renewal.

---

## Workstream 4 — membership

*Proposal phase 2, winter 2026/27. Cost: ~£15/yr ongoing.*

Three separable pieces:

**The £2.50 fund.** Moves to Stripe-hosted payment links — no code, no hosting
dependency, can start today. Add a £30 annual price alongside the £2.50 monthly
(the annual option is what actually cuts the fee rate: ~2.2% against ~9.5%). All 94
recurring payers must **actively re-subscribe** — mandates cannot be transferred
silently. Old and new run in parallel; stragglers chased by name; Squarespace cancelled
only on the treasurer's confirmation.

**The England Athletics check.** Apply to EA for licence-check API access early — the
lead time is theirs, not ours. Fallback that works from day one with no dependency: a
periodic export of the club's member list from the myAthletics portal, synced into our
database, making the check a local lookup. Same member experience either way.

**The join flow.** EA check → payment → welcome email (Resend, from a verified club
domain) → **single-use link on our own domain** that our database marks consumed on
first use, then forwards into the members' WhatsApp group.

> Stated honestly: WhatsApp's own invite links are static and shareable, and WhatsApp's
> business tools do not manage group membership. Single-use enforcement is ours, not
> WhatsApp's. Two backstops close the gap — the group is set to admin approval, and the
> underlying invite link is rotated periodically. The gate is practically closed, not
> cryptographically closed, and nobody should believe otherwise.

---

## Workstream 5 — race entries on our own site

*Proposal phase 3, ahead of Pass the Buck 2027 entries opening.*

**Hard gate** ([P13](principles.md#p13--governance-gates-come-before-the-code-they-enable)) —
no build starts until all three are in place:

- [ ] Data-protection advice taken on collecting and retaining entrant personal data,
      covering the EA data-sharing angle.
- [ ] Club Stripe account under treasurer oversight.
- [ ] Written refund policy and entry terms agreed.

Then: an entry form on each race page collecting exactly the fields our timing and
categories need — fixing at source the data-quality problems currently worked around
when importing Full On Sport CSVs — with live EA URN validation driving the price
(£8 EA-registered, £10 non-EA; £16/£18/£20 per team), one Stripe transaction per team,
and the confirmed entry landing directly in the race roster. No export, no import, no
re-keying.

The board makes the pricing call explicitly: hold runners' total prices level and bank
roughly £150/yr, or cut entry prices and hand the saving to runners.

---

## Costs, for reference

| | Today | Delivered (Cloudflare route) |
| --- | --- | --- |
| Website platform (club pays) | £240–£420 | £15–£63 incl domain |
| Member fund fees (club pays) | ~£340–£450 | ~£165 (half on annual) |
| **Club-borne total per year** | **~£510–£890** | **~£180–£230** |
| Entry fees (runners pay) | ~£230–£280 via Full On Sport | ~£85–£95 via Stripe |

Supabase Pro (~£240/yr) sits behind all of these as pre-approved contingency, spent only
if the free tier's pausing behaviour proves a problem. On the Vercel route, add ~£145/yr
to the delivered club-borne figure.

Figures are illustrations at the proposal's stated assumptions and should be re-based on
actual invoices and entry volumes.
