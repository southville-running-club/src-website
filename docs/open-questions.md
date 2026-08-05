# Open questions

Decisions and facts needed before or during delivery. Each has an owner and states what
it blocks. Answered questions move into an [ADR](adr/) or the relevant document and are
struck through here with a link.

---

## Answered

- ~~**Q1 — Hosting: Cloudflare, Vercel, or split?**~~ → **Cloudflare**, decided 5 August
  2026 on commercial grounds. [ADR-0002](adr/0002-hosting-platform.md).
- ~~**Q2 — Repository shape?**~~ → **One repository per service**, each its own Worker.
  [ADR-0006](adr/0006-repository-shape.md).
- ~~**Q3 — Vercel free-tier compliance under the split option?**~~ → Moot; the split
  option was rejected, partly *because* it rested on this unconfirmed reading.

## Blocking the website build

**Q4 — Fasthosts account access and domain registration.**
Owner: platform volunteer + committee · **Blocks: DNS delegation, which blocks everything**
Confirm who holds the Fasthosts credentials, that more than one person can reach them,
and whether the domain is registered independently or bundled with Squarespace. Then
export the full zone for audit before anything moves
([ADR-0010](adr/0010-dns-delegation-to-cloudflare.md)).

**Q4b — What is in the DNS zone today, exactly?**
Owner: platform volunteer · Blocks: DNS delegation
Every record must be replicated, not just the website ones. `MX`, `SPF`, `DKIM`, `DMARC`,
every `TXT`, Squarespace's verification records. Who provides club email, and through
what? A missed record stops club email silently
([R4c](risks.md#r4c--dns-delegation-and-club-email)).

**Q4c — Who owns the Cloudflare account?**
Owner: committee · Blocks: DNS delegation
It becomes critical club infrastructure the moment it is authoritative for the domain. It
should be club-owned with more than one administrator, before it holds anything
([R1](risks.md#r1--key-person-dependency)).

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

**Q8 — The 2026 date: 25 October or 1 November?** ⚠️ **Highest priority in the programme**
Owner: committee · Blocks: the entire Nightingale Nightmare track
Notes disagree. The race sits on or near the clocks-change weekend, so this matters
technically as well as operationally — see [R9](risks.md#r9--nightingale-nightmares-date-and-the-clocks-change).
With roughly eleven weeks to go, every dependent decision is compressed until this lands.
It costs nothing to answer.

**Q22 — What does the 2026 sign-up form collect: expression of interest, or full entries?**
Owner: committee · Blocks: whether data-protection advice is needed in weeks or months
"Sign-ups and hold data" means names, dates of birth, emergency contacts, possibly EA
numbers — the personal-entrant data that
[P13](principles.md#p13--governance-gates-come-before-the-code-they-enable) gates on
advice. Two honest routes: a minimal expression of interest (name and email, no DOB, no
payment, entries still taken through the existing channel), launchable in weeks; or full
entries, needing the privacy notice, retention policy and lawful basis in place **before
the first record**. See the [plan of attack](plan-of-attack.md).

**Q23 — Does Nightingale Nightmare 2026 need live timing and results at all?**
Owner: race director · Blocks: how much timing-app work lands before October
The proposal implies yes, the brief implies sign-ups first. It decides whether the three
solo gaps — leaderboard derivation, age bands, single-event hardcoding — are October work
or 2027 work. See the [timing app review](reference/timing-app-review.md).

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

## Platform governance

**Q24 — When does `src-race-timing` transfer to the `admin-src` organisation?**
Owner: platform volunteer + committee · Blocks: nothing technically; should precede the port
The club's race-day-critical software currently sits in a personal GitHub account, which
contradicts the proposal's own key-person mitigation. One administrative action
([R1](risks.md#r1--key-person-dependency)).

**Q25 — Who owns the Supabase, Vercel, Stripe and Resend accounts, and who else can reach them?**
Owner: committee · Blocks: nothing technically; a standing exposure
The same question as Q4c and Q24, applied to every account the platform depends on.

**Q26 — Does the club take Supabase Pro now that three services share one project?**
Owner: committee · Blocks: the archive's backup story
The free tier pauses after ~a week of inactivity and has no automated backups. With one
service that was contingency; with three and a permanent public archive it starts looking
like a decision ([R5](risks.md#r5--supabase-free-tier-pausing),
[ADR-0012](adr/0012-one-supabase-project-many-services.md)).

## Facts to verify before figures go further than the board

**Q20 — Actual Squarespace invoice amount** (currently stated as a £170–£420 range).
**Q21 — Actual entry volumes** (illustrative figures assume 80 teams and 150 solo entries).
**Q27 — Real Worker bundle size and CPU time**, measured on the Nightingale Nightmare
service, to establish whether the free tier is viable or Workers Paid (~£48/yr) is
required ([R4b](risks.md#r4b--workers-platform-limits)).
