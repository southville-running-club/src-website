# Open questions

Decisions and facts needed before or during delivery. Each has an owner and states what
it blocks. Answered questions move into an [ADR](adr/) or the relevant document and are
struck through here with a link.

---

## Blocking the website build

**Q1 — Hosting: Cloudflare, Vercel, or split?**
Owner: board / platform volunteer · Blocks: everything in Workstream 3
The site should be built once, on its final home. Three options are on the table with
materially different costs and risks — see
[ADR-0002](adr/0002-hosting-platform.md).

**Q2 — Repository shape: does the website live with the timing app or separately?**
Owner: platform volunteer · Blocks: scaffold, CI, database access design
The proposal says "one codebase, one database, three front doors", but the timing app
and this repository are separate today. See
[ADR-0006](adr/0006-repository-shape.md).

**Q3 — Does the club's Vercel free-tier usage remain compliant under the split option?**
Owner: platform volunteer · Blocks: Q1
The split option rests on a reading of Vercel's terms — that the timing app on the free
tier is non-commercial while entries are taken elsewhere. Worth confirming in writing
before the option is chosen.

**Q4 — Domain registration and the DNS cutover window.**
Owner: platform volunteer + committee · Blocks: Phase 3c
DNS is at Fasthosts today, pointing at Squarespace. Confirm who holds the Fasthosts
account credentials, whether the domain is registered separately or bundled with
Squarespace, and agree a cutover date outside any race window.

**Q5 — What content actually exists on the current Squarespace site?**
Owner: committee · Blocks: content migration
A full inventory of pages and URLs is needed so nothing is lost and every existing link
gets a redirect.

**Q6 — Which parts of the site does the committee genuinely need to edit, and how often?**
Owner: committee · Blocks: the shape of the content model
This is the input that decides how much is database-driven and whether an editing
interface is ever needed. Guessing here produces either a CMS nobody wanted or a site
nobody can update.

**Q7 — Licence for this repository.**
Owner: committee · Blocks: nothing yet, but should be settled before the repo is public
Club-owned code in a public repository needs a stated licence.

---

## Blocking Nightingale Nightmare (Workstream 2)

**Q8 — The 2026 date: 25 October or 1 November?**
Owner: committee · Blocks: scheduling and timezone testing
Notes disagree. The race sits on or near the clocks-change weekend, so this matters
technically as well as operationally — see [R9](risks.md#r9--nightingale-nightmares-date-and-the-clocks-change).

**Q9 — Does entry data include date of birth?**
Owner: committee · Blocks: age-band categories (Vet 40/50/60, male and female)

**Q10 — Are walk-ins allowed?**
Owner: race director · Blocks: bib allocation and registration-desk flow

**Q11 — The overall-versus-veteran prize rule.**
Owner: committee · Blocks: results and prize-list logic

**Q12 — Nightingale Nightmare entry price (assumed £8–£10 solo).**
Owner: committee · Blocks: entries workstream pricing

---

## Blocking membership (Workstream 4)

**Q13 — Is the processor connected under Squarespace a club Stripe account, or Squarespace's own?**
Owner: treasurer · Blocks: the fund migration plan
If it is a club Stripe account, saved customers and cards survive the move. If it is
Squarespace's own processor, everyone signs up afresh. Dave believes the latter, since
the club only ever provided a bank account for deposits. Establish this from the
Squarespace payments settings before planning the migration.

**Q14 — Who owns the payment account currently connected under Squarespace?**
Owner: treasurer · Blocks: nothing technically; governance priority
Set up informally when the fund was created. Club money flows through it today.

**Q15 — England Athletics licence-check API: cost and lead time.**
Owner: membership secretary · Blocks: nothing — a fallback exists
Access is by agreement: apply, sign, receive a key. Assumed free or nominal for an
affiliated club, to be confirmed on application. Apply early because the lead time is
theirs. The myAthletics export fallback works from day one regardless.

**Q16 — Does the club adopt the £30 annual membership price alongside £2.50 monthly?**
Owner: committee · Blocks: the fund migration comms
This is the option that actually cuts the fee rate (~2.2% against ~9.5%).

---

## Blocking race entries (Workstream 5)

**Q17 — Data-protection advice.**
Owner: committee · **Hard gate** — no payment or entry code starts without it

**Q18 — Club Stripe account under treasurer oversight, refund policy, entry terms.**
Owner: treasurer · **Hard gate**

**Q19 — The pricing decision: bank the fee saving, or pass it to runners?**
Owner: board · Blocks: entry pricing configuration
Roughly £150/yr at realistic volumes. The proposal asks the board to make this choice
explicitly rather than by default.

---

## Facts to verify before figures go further than the board

**Q20 — Actual Squarespace invoice amount** (currently stated as a £170–£420 range).
**Q21 — Actual entry volumes** (illustrative figures assume 80 teams and 150 solo entries).
