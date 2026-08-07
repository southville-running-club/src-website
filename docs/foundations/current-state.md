# Current state

What exists today, as fact. No proposals, no recommendations, no vendor preferences.

Everything here is either observed directly (the DNS zone, the timing app source, the live
site's redirect behaviour) or taken from the club's own [platform
proposal](../reference/platform-proposal-v8.md). Where a figure is an estimate or a range
from the proposal rather than a measured number, it says so.

This document is the baseline any option has to improve on.

---

## The club and its races

**Southville Running Club**, Bristol. Volunteer-run.

**Pass the Buck** — a two-person team relay around the Ashton Court Estate. Each runner
runs a 5 km lap; the team must complete 10 km inside a **1 hour 20 minute cut-off**.
Winners are the pair with the lowest combined time. **Maximum 100 teams.** Race HQ at
Ashton Park School, start at Ashton Court Mansion. A single physical line acts as start,
handover and finish. Priced by England Athletics registration status: £8 per registered
runner, £10 per non-registered, paid as one transaction per team (£16, £18 or £20). Last
run 8 July 2026.

**Nine prize categories**, which the results logic has to satisfy: 1st and 2nd male pair,
1st and 2nd female pair, 1st and 2nd mixed pair, the pair whose times are closest
together, the pair with the biggest time difference, fastest male and fastest female (each
excluding anyone who has already won). No dogs on the course. Visually impaired runners
are accepted with a guide, in mixed VI / non-VI teams.

**Nightingale Nightmare** — a solo mass-start 10 km at Halloween. One runner per entry,
one gun, one finish crossing each. Age-band categories (Vet 40/50/60, male and female).
**The 2026 date is unconfirmed** — club notes disagree between 25 October and 1 November,
and the race sits on or near the clocks-change weekend. Entry price assumed £8–£10 in the
proposal, unconfirmed.

**People.** One volunteer builds and maintains the platform. A treasurer, race director,
membership secretary and committee hold the non-technical responsibilities.

---

## The website

Runs on **Squarespace** at `southvillerunningclub.co.uk`. Built from scratch by the Web
Manager, rebuilt from an earlier edition, with the Membership Officer assisting.

- **`www` is canonical.** Verified 6 August 2026: the bare domain returns a 301 to
  `https://www.southvillerunningclub.co.uk/`.
- **Plan: Business Plan.** £204 a year, renewing automatically. Subscribed since
  **21 March 2024**. *(Read from the billing page, 7 August 2026.)*
- **The club is on the middle tier and cannot drop below it** — that tier is what permits
  taking payments. The club is buying commerce capability and paying for a website plan to
  get it.
- **Squarespace takes a transaction fee on every payment, on top of card processing.** The
  Business plan carries **2%** if it is a legacy plan and **3%** on the current
  generation; the club subscribed before the 2025 plan overhaul, so legacy at 2% is the
  likelier reading. Commerce tiers charge 0% but cost more per month. See [the flow of
  money](#the-flow-of-money).
- **The processor is Squarespace Payments**, not Stripe. Card processing is **2% + 25p**
  for UK domestic personal cards on this plan tier.
- **Renewal: 21 March 2027.** *(Read from the billing page — earlier notes said "April".)*
- Any committee member can edit a page visually. This is the club's current editing model.
- Race results are published by hand, in a format carried over from the previous year.
- **Squarespace commerce is enabled** — the site has a cart, a checkout, customer accounts
  and a login.

### What is actually on it

**60 URLs**, from the sitemap, 6 August 2026. Far more than a brochure site.

| Area | Pages | Notes |
| --- | --- | --- |
| **Newsletters** | **33**, October 2023 – July 2026 | Monthly. **Authored and sent in Mailchimp**, then mirrored onto the site by hand under `/news-letters/` |
| **Club documents** | ~45 linked documents | Constitution, inclusion, health and safety, risk assessment, disciplinary and grievance, welfare, safeguarding, codes of conduct, plus **~35 sets of AGM and QGM minutes back to 2015** |
| **Membership** | 5 pages | Information, new members, renew, cancel, payment page |
| **Runner information** | 5 pages | New runners, FAQ, running terminology, groups (with a pace guide), kit |
| **Events** | 4 pages | Pass the Buck, results 2025, results 2026, Summer Party 2026 |
| **Store** | 3 pages | Squarespace commerce — a Tickets category, currently a £6.00 Summer Party ticket |
| **Community** | 3 pages | WhatsApp community, SRC committee, about us |
| **Policies** | 3 pages | Privacy policy, code of conduct, disciplinary policy |

Content that will need somewhere to live, beyond pages: a **member discount directory**
(around a dozen local businesses with negotiated rates), a **pace guide** mapping paces to
5K/half/marathon times, a **kit catalogue** with descriptions, prices and a live stock
list, a **12-point WhatsApp code of conduct**, and a **mailing list** subscription.

**Forms currently in use:** new member, cancel membership, and WhatsApp community join.

**Race photographs are not on the site** — the 2026 results page directs people to
Facebook.

### What it actually gets used for

From Squarespace Analytics, read 7 August 2026.

**Audience**, 9 July – 7 August 2026:

| | |
| --- | --- |
| Visits | **1,114** |
| Unique visitors | **926** |
| Pageviews | 2,234 |
| Bounce rate | 57.7% |
| Where they come from | Direct 673, Google 314, Facebook 67, Instagram 30 |
| What they use | **iOS 517, Android 263**, Windows 180, macOS 111 |

**Seventy per cent of visits are from a phone.** That is not a preference to design around
later; it is the club's audience, and it corroborates the [mobile-first
constraint](requirements.md#users) by measurement rather than assumption.

Around **900 people a month** reach the site against roughly 100 subscribers, so most
visitors are not paying anyone anything. **The site's main job is information, not
transaction.**

#### What people actually read

**13,342 pageviews, 1 January – 7 August 2026**, up 12% year on year. Grouped by what the
pages are for:

| | Pageviews | Share |
| --- | --- | --- |
| **Home** | 4,482 | **33.6%** |
| **Race — Pass the Buck and its results** | 2,216 | **16.6%** |
| **Runner information** — new runners, FAQ, groups, terminology | 1,884 | 14.1% |
| **About the club** — about us, committee, WhatsApp community | 1,746 | 13.1% |
| **Newsletters** — index plus 33 issues | 1,234 | 9.2% |
| **Membership** — information, join, pay, renew, cancel | 1,036 | 7.8% |
| **Parties and store** | 485 | 3.6% |
| **Kit** | 141 | **1.1%** |
| **Club documents** | 93 | 0.7% |
| **Policies** | 22 | **0.2%** |

The ten most-visited individual pages:

| Page | Views | Time on page |
| --- | --- | --- |
| Home | 4,482 | 1:10 |
| Pass the Buck | 1,458 | 2:25 |
| About Us | 1,087 | 1:38 |
| New Runners | 1,086 | 1:33 |
| **Pass the Buck Results 2026** | 501 | **6:08** |
| Newsletters (index) | 416 | **0:28** |
| Frequently Asked Questions | 408 | 1:35 |
| Membership information | 365 | 1:44 |
| SRC Summer Party 2026 | 358 | 1:09 |
| New Members | 355 | 1:40 |

Site average time on page is **90 seconds**.

#### Five things the numbers say

**Results are read, not glanced at.** The 2026 results page holds visitors for **6 minutes
8 seconds** — over four times the site average and the longest dwell anywhere on the site.
This is the page currently produced by hand.

**The results archive has a long tail.** All 501 views of the 2026 results fell inside the
last 30 days — it is a post-race spike. But the **2025** results drew 255 views across the
year, only 62 of them in that same window. Last year's results are still being looked up
nine months later, which is what "permanent" means in practice.

**Kit is 1.1% of traffic.** 141 views across seven months, at 1:13. The
[requirements](requirements.md#c15--sell-merchandise-and-tickets) describe kit as the
largest single piece of build in the website.

**Policies and documents are governance, not traffic.** 22 and 93 views respectively. The
documents that *are* opened are read for **four minutes** — a small audience reading
carefully, rather than a large one browsing.

**The newsletter index does not work.** 416 views at **28 seconds** and a 61% bounce —
people arrive and leave. Individual recent issues do better (March 2026: 113 views at
1:43), and the older tail is thin. The archive is used for the last few months, not for
2023.

#### Legacy URLs still receiving traffic

Old paths that still resolve and are still being hit: `/home`, `/members`,
`/runners-information`, `/events`, `/contacts-and-links`, `/store`. Low volume — one to
three views each — but they exist, and [every existing URL still
resolving](requirements.md#c1--publish-club-information-publicly) is a stated condition of
the move.

---

## The club

Founded 2007. **Southville Running Club Limited** — a limited company, with Articles of
Association filed at Companies House.

Sessions every **Tuesday and Thursday**, 6:00pm for a 6:15pm start, at the Southbank Club,
Dean Lane, BS3 1DB. **50p per run**, covering room hire. Open to anyone 18+; membership is
not required to run. Hi-viz is mandatory from October until the clocks go forward.

**Committee and volunteers**, from the site:

| Role | |
| --- | --- |
| Co-Chairs | Kayleigh Doherty, Liam Coleman |
| Club Secretary | Amy Webb |
| **Treasurer** | Dave Unsworth |
| **Membership Officer** | Bindal Shah |
| **Web Manager** | Mark Chesser |
| Co Club Captains | Sophie Patten, Laura Pease |
| Quarter Master | Robin Nash |
| Welfare | Nicholas Mimmack (lead), Clara K |
| Committee Member | Sam Blanning |

**Who builds the platform:** two people. The Web Manager built the current website and
holds Fasthosts access; the Membership Officer built the race-timing system. The rebuild
is a joint effort.

---

## DNS and email

The domain is registered with **Fasthosts**, which is also the authoritative DNS provider.
The zone holds **18 records**, captured 6 August 2026:

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| A | `@` | 198.49.23.144 | Squarespace |
| A | `@` | 198.49.23.145 | Squarespace |
| A | `@` | 198.185.159.144 | Squarespace |
| A | `@` | 198.185.159.145 | Squarespace *(flagged "manually changed")* |
| A | `mail` | 213.171.216.40 | Fasthosts livemail — **the MX target** |
| A | `mailserver` | 213.171.216.40 | Fasthosts livemail |
| A | `smtp` | 213.171.216.50 | Fasthosts outbound |
| A | `webmail` | 213.171.216.231 | Fasthosts webmail |
| A | `mcp` | 213.171.195.10 | Unrelated to the club site — an AI Model Context Protocol endpoint |
| CNAME | `www` | `ext-cust.squarespace.com` | Squarespace |
| CNAME | `9sw9cgfs3d8e53r2xcx5` | `verify.squarespace.com` | Squarespace domain verification |
| CNAME | `livemail1._domainkey` | `…366995.dkim.livemail.co.uk` | DKIM |
| CNAME | `livemail2._domainkey` | `…366995.dkim.livemail.co.uk` | DKIM |
| CNAME | `livemail3._domainkey` | `…366995.dkim.livemail.co.uk` | DKIM |
| CNAME | `livemail4._domainkey` | `…366995.dkim.livemail.co.uk` | DKIM |
| MX | `@` | `mail.southvillerunningclub.co.uk` pri 0 | *(flagged "manually changed")* |
| TXT | `@` | `v=spf1 mx a include:_spf.livemail.co.uk ~all` | SPF |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | DMARC, monitoring only |

No CAA records. No AAAA records. No ALIAS or SRV records.

Cost: **£15.40 a year** for the domain and DNS.

**Facts worth noting because they constrain later choices:**

- **Email is forwarding-only**, through Fasthosts livemail, **forwarding to Gmail
  accounts**. There are addresses on the domain (the Membership Officer publishes one),
  but no mailboxes the club hosts.
- **The MX points at a hostname inside the zone**, so `mail`'s A record is load-bearing
  for all inbound mail.
- **DMARC is `p=none`** — monitoring, no enforcement. Authentication failures degrade
  toward spam folders rather than causing rejection.
- **Two records carry a Fasthosts "manually changed / restore automatic updates" prompt.**
  Restoring the apex would repoint it at 88.208.252.9, Fasthosts' own web hosting.
- Whether Fasthosts or Squarespace holds the **registration** is not established.

---

## The race timing platform

A working, production system. It timed Pass the Buck 2026 end to end: registration import,
walk-in bibs, offline-safe live capture, anomaly resolution, DNS/DNF/DQ status, and
publishable results export.

| | |
| --- | --- |
| Repository | `bindalshah/src-race-timing` — **a personal account, not the club organisation** |
| Framework | Next.js 16.2.4, App Router, TypeScript |
| Hosting | Vercel, free tier, deploys on push to `main` |
| Data | Supabase — PostgreSQL, Realtime, Auth, Storage (`eu-west-2`, London), free tier |
| Public URL | `src-race-timing.vercel.app` — not on the club domain |
| Offline | Progressive web app; capture queued in IndexedDB, synced when online |
| Last commit | 11 July 2026 |

**The data model** — `events` (with a `format` of `relay` or `solo`), `teams` (the unit of
entry, one or two runners), `runners`, `crossings`, `marshals`, `staff_assignments`,
`admin_actions`. Row-level security from the first migration, with public read on events,
teams and crossings.

**Personal data is minimised at the parser boundary.** Date of birth, address, phone,
emergency contact and medical data are dropped during CSV import and never reach the
database; a computed `age_on_day` is stored instead. The raw CSV in storage is the audit
trail.

**What it depends on beyond a database:** live push to browsers for the leaderboard,
magic-link authentication for staff, file storage for import audit trails, and row-level
security. These are separate capabilities that happen to come from one vendor today.

**Known gaps**, from the app's own decision log: the leaderboard's derivation is
relay-shaped; age-band categories do not exist (only pair categories, derived from two
runners' genders); the home page hardcodes `LOCATION_LABEL = "Ashton Court"` and assumes
an evening start; and a true two-marshal end-to-end verification is still outstanding.

---

## Race entries

Taken through **Full On Sport**. Fee is 5.9% + 20p per transaction plus VAT — £1.37–£1.66
per team, 81p–95p per solo.

**Confirmed by the race director: the fee is added on top of the entry price and paid by
runners, not by the club.** At the proposal's illustrative volumes (80 teams, 150 solos)
that is roughly £230–£280 a year, borne by entrants.

Entry data arrives as a CSV for manual import, and carries data-quality problems the
import currently works around.

---

## Membership and money — three separate things

These are routinely conflated, including in the platform proposal. The site is explicit
that they are distinct, and the distinction matters for any design.

### 1. Session fees — 50p per run

Charged per run, covering room hire at the Southbank Club. Payable in cash on the night.

### 2. The £2.50 monthly subscription — **not membership**

An alternative to bringing cash: £2.50 a month for as many sessions as you like. Set up as
a Squarespace donation fund ('Monthly running fee', October 2024).

The site states plainly: *"This £2.50 monthly subscription does not confer membership of
the Club. It is open to members and non-members alike, and can be stopped and started as
often as you wish without any commitment."* Payments are non-refundable and
non-transferable.

Measured from Squarespace Analytics, 7 August 2026:

| Period | Payments | Value |
| --- | --- | --- |
| Calendar 2025 | 697 | £1,742.50 |
| 2026 to 7 August | **705** | **£1,762.50** |
| Last 30 days | 103 | £257.50 |

**The fund has roughly doubled.** 2025 averaged 58 payments a month; 2026 averages 98, and
the last 30 days ran at 103. **2026 has already passed the whole of 2025 with nearly five
months to go.** At the current rate that is **about 1,175 payments a year, or £2,940** —
not the 94 payers and £2,820 carried in the club's proposal.

- **0% of payments use Squarespace's "cover the fees" option.**
- The payment account is **Squarespace Payments** — the club's own processor, not Stripe.
  It was set up informally; the club only ever provided a bank account for deposits.

> **The payers are not necessarily members**, and members are not necessarily among them.
> Anything that treats "the member fund" as a membership list will be wrong.

#### What each payment is worth

**Every £2.50 loses 35p before it reaches the club. That is 14.0%.**

| | Per payment | Per year |
| --- | --- | --- |
| Paid by the member | £2.50 | **£2,940** |
| Card processing — 2% + 25p | −30p | −£353 |
| Squarespace's transaction fee — 2% | −5p | −£59 |
| **The club receives** | **£2.15** | **£2,528** |

**The fixed 25p dominates.** On its own it is 10% of a £2.50 payment, and across 1,175
payments a year it accounts for **£294 of the £353** in card fees. What the club pays is
governed by how often it charges, not by who processes the payment.

At a 3% transaction fee rather than 2%, Squarespace's share rises from £59 to £88 and the
total to £441. Card processing is unaffected either way.

### 3. SRC membership — £4 a year

Confers membership: the WhatsApp community, and discounts at around a dozen local
businesses. Optional — you do not need it to run with the club.

An **England Athletics athlete registration** can be bought alongside. England Athletics'
published fee for 2026–27 is **£23 a year**, renewable by 30 June; club affiliation is
£210 from April 2026. So SRC membership plus EA registration is **£27**.

The site quotes £23 in one place, £24 for the combined total in another, and a £20 renewal
fee in a third — **the figures on the site are stale and inconsistent**, and appear to
predate EA's increase. Club policy is not to issue an EA registration without SRC
membership first.

**Renewals do not happen on the club site** — members are directed to the England
Athletics portal, or to email the Membership Officer. New memberships and cancellations
are web forms.

England Athletics registration is not verified at the point of joining. The Membership
Officer holds the club's member list in the EA myAthletics portal.

---

## The flow of money

### What comes in, and where

Measured from Squarespace Analytics, 7 August 2026. **Two flows go through the website.**

| Flow | Per year | Collected by | Fees borne by |
| --- | --- | --- | --- |
| **£2.50 monthly subscription** | **£2,940** *(current run rate)* | **Squarespace** | **Club** |
| **Party tickets** | **£1,620** *(two events)* | **Squarespace** | **Club** |
| Race entries | ~£2,800 *(proposal's illustrative volumes)* | Full On Sport | **Entrants** |
| SRC membership — £4/yr | Not established | Web forms, then the EA portal | — |
| Kit | Not established | External ordering link | — |
| Session fees — 50p | Not established | Cash on the night | — |

**£4,560 a year passes through the website.** The subscription is about two thirds of it,
and it is the reason the site needs commerce at all.

**A seventh flow existed in 2025 and has stopped.** Track Sessions were sold as weekly
(£3) and monthly (£12) products — **£1,065 across 328 orders** — and have no sales in
2026. Worth recording because it shows the club creates and retires paid products as it
goes, so any replacement must make that easy rather than assume a fixed catalogue.

### Party tickets

**Two events a year**, sold through Squarespace commerce with a cart, checkout and
customer accounts. Both are real, measured events rather than estimates:

| Event | Price | Tickets | Orders | Revenue |
| --- | --- | --- | --- | --- |
| SRC Christmas Party 2025 | £12 | 95 | 86 | **£1,140** |
| SRC Summer Party 2026 | £6 | 80 | 72 | **£480** |
| **A two-party year** | | **175** | **158** | **£1,620** |

Three things follow.

**Christmas is the bigger event by a distance** — £1,140 against £480, at double the
ticket price and more tickets sold. Ticket capability is not a minor convenience; one
evening a year moves more money than four months of subscriptions.

**People buy in pairs.** 175 tickets arrived in 158 orders. That matters because the fixed
25p is charged per *order*, not per ticket, so a larger basket is cheaper to process.

**Tickets are the cheap flow and the subscription is the expensive one:**

| | Per transaction | Fee | Effective rate | Club keeps |
| --- | --- | --- | --- | --- |
| Subscription | £2.50 | 35p | **14.0%** | £2.15 |
| Summer ticket | £6 | 49p | **8.2%** | £5.51 |
| Christmas ticket | £12 | 73p | **6.1%** | £11.27 |

Nothing about the platform differs between them — only the size of the transaction. The
same 25p is 10% of a £2.50 payment and 2% of a £12 ticket.

**Across both parties the club pays £104 in fees on £1,620, of which Squarespace's share
is £32.** Leaving Squarespace saves about £32 a year on tickets. **Ticket sales do not, on
their own, justify a commerce platform** — 158 orders across two evenings is well inside
what a hosted payment link handles.

### What each party takes

On the £4,560 that passes through the site:

| | Per year | Share of gross |
| --- | --- | --- |
| Card processing — Squarespace Payments | £424 | 9.3% |
| Squarespace's transaction fee | £91 | 2.0% |
| **The club receives** | **£4,042** | **88.7%** |

### What the club pays

| Line | Per year | Borne by |
| --- | --- | --- |
| Squarespace subscription | **£204** | Club |
| Squarespace's transaction fee — both flows | **£91** | Club |
| Card processing — both flows | **£424** | Club |
| Domain and DNS | **£15.40** | Club |
| Hosting and database | £0 *(free tiers)* | Club |
| **Club-borne total** | **£734** | |
| Full On Sport entry fees | ~£230–£280 | **Entrants** |

**Squarespace costs the club £295 a year, not £204** — the subscription plus the 2% it
takes on every payment. At a 3% transaction fee it is £341.

**The club spends £719 a year to collect £4,560** — the plan, Squarespace's cut and the
card fees together, or **15.8% of the money raised**. Attributing the whole subscription
to payments is fair on the club's own account of it: the club is on this tier *because* it
is the one that permits taking money, not for the website features.

Volumes are read from Squarespace Analytics on 7 August 2026; rates are the providers'
published rates for this plan tier. **One input remains open** — whether the Business plan
is legacy (2%) or current-generation (3%) — see
[what is not established](#what-is-not-established-about-the-money).

### What is not established about the money

| | Where it is | Who can reach it |
| --- | --- | --- |
| **Whether the Business plan is legacy (2%) or current (3%).** The subscription predates the 2025 plan overhaul, which favours legacy, but the fee line on an invoice would settle it | A Squarespace invoice | Anyone with Squarespace access |
| **Whether VAT is charged on top of processing fees** | A Squarespace invoice | Anyone with Squarespace access |
| **Actual fees and net paid out over 12 months** | Squarespace Payments → Payouts | **Treasurer or Membership Officer** |
| **SRC membership and kit volumes** | Not held in any one system | Membership Officer, Quarter Master |

---

## Accounts and access

| Asset | Who can reach it |
| --- | --- |
| **Squarespace Payments** — every pound the club takes online | Squarespace account holders. **Two-factor authentication is not enabled** *(prompted on the Finance page, 7 August 2026)* |
| **Fasthosts** — domain, DNS, email forwarding | **Web Manager only** |
| **Supabase** — the platform database and results archive | **Membership Officer only** |
| **Vercel** — the timing platform's hosting | **Membership Officer only** |
| **England Athletics portal** — the membership record | **Membership Officer only** |
| Squarespace | Several people, with varying roles |
| Stripe | Treasurer, and the Membership Officer |
| `src-race-timing` repository | A personal GitHub account |
| GitHub organisation | Created under a club account, `srcdmin@gmail.com` *(the typo is in the address itself)* |
| The payment account connected under Squarespace | **Unconfirmed** — set up informally |

**Four systems are reachable by exactly one person each**, and the two volunteers cannot
cover for one another: the domain, DNS and email sit with one; the database, hosting and
membership record sit with the other.

A GitHub organisation exists under the club-owned `srcdmin@gmail.com` account. The
intended shape is a repository for the website core, with separate repositories for the
timing app and Nightingale Nightmare — not fixed.

---

## Manual processes

Work volunteers do that the systems do not. This is the largest cost in the current
arrangement and it appears on no invoice.

| Process | Who | How it works today |
| --- | --- | --- |
| WhatsApp community joining | Membership Officer | Form submission, then **checked by hand against the membership records** |
| New memberships | Membership Officer | Web form, processed manually |
| Cancellations | Membership Officer | Web form, processed manually |
| Membership renewal | Members | **In the England Athletics portal**, not the club's systems |
| Race results publication | Web Manager | **Re-keyed** from the timing system onto a page |
| Race entries | Race organisers | CSV export from the entry platform, imported, data-quality problems worked around |
| Kit orders | Quarter Master | External ordering link; stock tracked by hand on a page |
| Newsletters | Committee | Written in **Mailchimp**, then mirrored onto the site by hand |
| Ticket and running-fee reconciliation | Treasurer | Manual |

**Newsletters are not being kept up to date**, which the club attributes to the manual
mirroring step.

---

## Constraints that already exist

- **The timing platform is proven in production and race-day critical.** Regressing it is
  expensive in a way that cannot be recovered by a rollback on the night.
- **Nightingale Nightmare sits on or near the clocks change.** The timing app already
  treats this as a known hazard and pins `Europe/London` through a single tested code
  path.
- **Governance positions agreed at the QGM:** no payment work before data-protection
  advice and treasurer-controlled payment arrangements are in place; the member fund must
  be re-homed before Squarespace is cancelled.
- **One volunteer.** Every decision is bounded by what one person with a day job can build
  and what a second person could later pick up.
