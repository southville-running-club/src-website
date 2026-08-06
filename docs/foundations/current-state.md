# Current state

What exists today, as fact. No proposals, no recommendations, no vendor preferences.

Everything here is either observed directly (the DNS zone, the timing app source, the live
site's redirect behaviour) or taken from the club's own
[platform proposal](../reference/platform-proposal-v8.md). Where a figure is an estimate or
a range from the proposal rather than a measured number, it says so.

This document is the baseline any option has to improve on.

---

## The club and its races

**Southville Running Club**, Bristol. Volunteer-run.

**Pass the Buck** — a two-person team relay around the Ashton Court Estate. Each runner
runs a 5 km lap; the team must complete 10 km inside a **1 hour 20 minute cut-off**. Winners
are the pair with the lowest combined time. **Maximum 100 teams.** Race HQ at Ashton Park
School, start at Ashton Court Mansion. A single physical line acts as start, handover and
finish. Priced by England Athletics registration status: £8 per registered runner, £10 per
non-registered, paid as one transaction per team (£16, £18 or £20). Last run 8 July 2026.

**Nine prize categories**, which the results logic has to satisfy: 1st and 2nd male pair,
1st and 2nd female pair, 1st and 2nd mixed pair, the pair whose times are closest together,
the pair with the biggest time difference, fastest male and fastest female (each excluding
anyone who has already won). No dogs on the course. Visually impaired runners are accepted
with a guide, in mixed VI / non-VI teams.

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
- Cost: **£204 a year.**
- **The club is on the middle tier and cannot drop below it** — that tier is what permits
  taking payments. The club is buying commerce capability and paying for a website plan to
  get it.
- **Squarespace takes a fee on every payment, on top of the card processing fee.** This
  applies to the £2.50 running-fee subscription and to event payments.
- **Renewal is in April.** The exact date is not yet established.
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
5K/half/marathon times, a **kit catalogue** with descriptions, prices and a live stock list,
a **12-point WhatsApp code of conduct**, and a **mailing list** subscription.

**Forms currently in use:** new member, cancel membership, and WhatsApp community join.

**Race photographs are not on the site** — the 2026 results page directs people to
Facebook.

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
holds Fasthosts access; the Membership Officer built the race-timing system. The rebuild is
a joint effort.

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
  accounts**. There are addresses on the domain (the Membership Officer publishes one), but
  no mailboxes the club hosts.
- **The MX points at a hostname inside the zone**, so `mail`'s A record is load-bearing for
  all inbound mail.
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
runners' genders); the home page hardcodes `LOCATION_LABEL = "Ashton Court"` and assumes an
evening start; and a true two-marshal end-to-end verification is still outstanding.

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

An alternative to bringing cash: £2.50 a month for as many sessions as you like. Set up as a
Squarespace donation fund ('Monthly running fee', October 2024).

The site states plainly: *"This £2.50 monthly subscription does not confer membership of the
Club. It is open to members and non-members alike, and can be stopped and started as often
as you wish without any commitment."* Payments are non-refundable and non-transferable.

- **94 active recurring payers**, every one at exactly £2.50 — roughly **£2,820 a year**.
- Processing fees roughly **£340–£450 a year**, all absorbed by the club.
- **0% of payments use Squarespace's "cover the fees" option.**
- A payment account is connected under Squarespace, **set up informally**. Whether it is a
  club Stripe account or Squarespace's own processor is not established; the club only ever
  provided a bank account for deposits.

> **The 94 payers are not necessarily members**, and members are not necessarily among
> them. Anything that treats "the member fund" as a membership list will be wrong.

### 3. SRC membership — £4 a year

Confers membership: the WhatsApp community, and discounts at around a dozen local
businesses. Optional — you do not need it to run with the club.

An **England Athletics athlete registration** can be bought alongside. England Athletics'
published fee for 2026–27 is **£23 a year**, renewable by 30 June; club affiliation is £210
from April 2026. So SRC membership plus EA registration is **£27**.

The site quotes £23 in one place, £24 for the combined total in another, and a £20 renewal
fee in a third — **the figures on the site are stale and inconsistent**, and appear to
predate EA's increase. Club policy is not to issue an EA registration without SRC
membership first.

**Renewals do not happen on the club site** — members are directed to the England
Athletics portal, or to email the Membership Officer. New memberships and cancellations are
web forms.

England Athletics registration is not verified at the point of joining. The Membership
Officer holds the club's member list in the EA myAthletics portal.

---

## What the club pays today

| Line | Per year | Borne by |
| --- | --- | --- |
| Squarespace subscription | £170–£420 *(read off invoice)* | Club |
| Member fund processing fees | ~£340–£450 | Club |
| Domain registration | £0–£20 | Club |
| Hosting and database | £0 (free tiers) | Club |
| Full On Sport entry fees | ~£230–£280 | **Entrants** |
| **Club-borne total** | **~£510–£890** | |

Figures other than the fund volume are the proposal's estimates and should be re-based on
actual invoices.

---

## Accounts and access

| Asset | Who can reach it |
| --- | --- |
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

A GitHub organisation exists under the club-owned `srcdmin@gmail.com` account. The intended
shape is a repository for the website core, with separate repositories for the timing app
and Nightingale Nightmare — not fixed.

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
- **Nightingale Nightmare sits on or near the clocks change.** The timing app already treats
  this as a known hazard and pins `Europe/London` through a single tested code path.
- **Governance positions agreed at the QGM:** no payment work before data-protection advice
  and treasurer-controlled payment arrangements are in place; the member fund must be
  re-homed before Squarespace is cancelled.
- **One volunteer.** Every decision is bounded by what one person with a day job can build
  and what a second person could later pick up.
