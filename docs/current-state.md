# Current state

What exists today, as fact. No proposals, no recommendations, no vendor preferences.

Everything here is either observed directly (the DNS zone, the timing app source, the live
site's redirect behaviour) or taken from the club's own
[platform proposal](reference/platform-proposal-v8.md). Where a figure is an estimate or
a range from the proposal rather than a measured number, it says so.

This document is the baseline any option has to improve on.

---

## The club and its races

**Southville Running Club**, Bristol. Volunteer-run.

**Pass the Buck** — a two-person relay at Ashton Court. Roughly 100 teams. A single
physical line acts as start, handover and finish. Priced by England Athletics registration
status: £8 per registered runner, £10 per non-registered, paid as one transaction per team
(£16, £18 or £20). Last run 8 July 2026.

**Nightingale Nightmare** — a solo mass-start 10 km at Halloween. One runner per entry,
one gun, one finish crossing each. Age-band categories (Vet 40/50/60, male and female).
**The 2026 date is unconfirmed** — club notes disagree between 25 October and 1 November,
and the race sits on or near the clocks-change weekend. Entry price assumed £8–£10 in the
proposal, unconfirmed.

**People.** One volunteer builds and maintains the platform. A treasurer, race director,
membership secretary and committee hold the non-technical responsibilities.

---

## The website

Runs on **Squarespace** at `southvillerunningclub.co.uk`.

- **`www` is canonical.** Verified 6 August 2026: the bare domain returns a 301 to
  `https://www.southvillerunningclub.co.uk/`.
- Cost: **£170–£420 a year** depending on plan. The proposal marks this "read off invoice"
  — the actual figure is unverified.
- **Renewal is in April.** The exact date is not yet established.
- Any committee member can edit a page visually. This is the club's current editing model.
- Race results are published by hand, in a format carried over from the previous year.

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
| A | `mcp` | 213.171.195.10 | **Purpose unknown** |
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

**Facts worth noting because they constrain later choices:**

- **Email is forwarding-only**, through Fasthosts livemail.
- **The MX points at a hostname inside the zone**, so `mail`'s A record is load-bearing for
  all inbound mail.
- **DMARC is `p=none`** — monitoring, no enforcement. Authentication failures degrade
  toward spam folders rather than causing rejection.
- **Two records carry a Fasthosts "manually changed / restore automatic updates" prompt.**
  Restoring the apex would repoint it at 88.208.252.9, Fasthosts' own web hosting.
- **The `mcp` record's purpose is unknown.**
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

## Membership

Members pay **£2.50** into a Squarespace donation fund ('Monthly running fee', created
October 2024), in place of 50p cash at sessions.

- **94 active recurring payers**, every one at exactly £2.50 — roughly **£2,820 a year**.
- Processing fees roughly **£340–£450 a year**, all absorbed by the club.
- **0% of payments use Squarespace's "cover the fees" option.**
- A payment account is connected under Squarespace, **set up informally**. Whether it is a
  club Stripe account or Squarespace's own processor is not established; the club only ever
  provided a bank account for deposits.

England Athletics registration is not currently verified at the point of joining. The
membership secretary holds the club's member list in the EA myAthletics portal.

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

Not fully established, and material to any decision about resilience:

| Asset | Who holds it |
| --- | --- |
| Fasthosts (domain, DNS, email) | The platform volunteer has access; whether anyone else does is unconfirmed |
| Squarespace | Unconfirmed |
| The connected payment account | **Unconfirmed** — set up informally |
| Supabase project | Unconfirmed |
| Vercel account | Unconfirmed |
| `src-race-timing` repository | A personal GitHub account |

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
