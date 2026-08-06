# Open questions

Decisions and facts needed before or during delivery. Each has an owner and states what
it blocks. Answered questions move into an [ADR](adr/) or the relevant document and are
struck through here with a link.

---

## Answered

- ~~**Q1 — Hosting: Cloudflare, Vercel, or split?**~~ → **Cloudflare**, on commercial
  grounds. [ADR-0002](adr/0002-hosting-platform.md).
- ~~**Q2 — Repository shape?**~~ → **One repository per service**, each its own Worker.
  [ADR-0006](adr/0006-repository-shape.md).
- ~~**Q3 — Vercel free-tier compliance under the split option?**~~ → Moot; the split
  option was rejected, partly *because* it rested on this unconfirmed reading.
- ~~**Q22 — What does the 2026 sign-up form collect?**~~ → **Name and email**, with
  payments following quickly via a Stripe Payment Link.
  [Plan of attack](plan-of-attack.md#track-b--nightingale-nightmare--the-milestone).
- ~~**Q23 — Does Nightingale Nightmare 2026 need timing and results?**~~ → **No — sign-ups
  only.** Timing is scoped separately and can be pulled forward if the race director wants
  it. This is why the timing app port has no autumn deadline.
- ~~**Which database does Nightingale Nightmare use?**~~ → **Its own Supabase project** to
  start, converging via CSV when it publishes results.
  [ADR-0012](adr/0012-one-supabase-project-many-services.md).
- ~~**Website rebuild or timing port first?**~~ → **Website first**, so OpenNext's rough
  edges are found on a content site rather than on race-critical software.
- ~~**How much of a rethink is the website rebuild?**~~ → **Like-for-like content plus the
  results archive** at cutover; visual redesign afterwards as its own work.
- ~~**Is the bare domain or `www` canonical?**~~ → **`www`.** Verified 6 August 2026: the
  bare domain 301-redirects to `https://www.southvillerunningclub.co.uk/`. Preserved
  through the cutover.
- ~~**What are the service hostnames?**~~ → `nn.`, `timing.`, `beta.`
  ([ADR-0005](adr/0005-dns.md)).
- ~~**Does the timing app take a subdomain or a path?**~~ → **Subdomain**, with a path
  alias possible after the apex is ours. A path would put the website Worker in charge of
  race-day routing.
- ~~**Who can change nameservers at Fasthosts?**~~ → The platform volunteer has access. A
  **second person still needs it** — see Q28.
- ~~**Does the club need Cloudflare Business?**~~ → **No.** ~£1,900/yr, eight to ten times
  the whole platform budget, and it would not enable Workers on club hostnames anyway. A
  club-owned free account plus Workers Paid (~£48/yr) is what is needed.
  [ADR-0002](adr/0002-hosting-platform.md).

## Blocking the website build

**Q4 — Fasthosts account access and domain registration.**
Owner: platform volunteer + committee · **Blocks: DNS delegation, which blocks everything**
Confirm who holds the Fasthosts credentials, that more than one person can reach them,
and whether the domain is registered independently or bundled with Squarespace. Then
export the full zone for audit before anything moves
([ADR-0005](adr/0005-dns.md)).

**Q4b — What does the `mcp` A record serve?**
Owner: platform volunteer · Blocks: nothing; copy it verbatim meanwhile
`mcp.southvillerunningclub.co.uk` → 213.171.195.10, in Fasthosts' IP range, purpose
unknown. It gets replicated as-is because an unused record costs nothing and a missing one
costs an outage — but an unexplained record in a zone the club is taking responsibility for
should be understood before Squarespace is cancelled
([ADR-0005](adr/0005-dns.md)).

**Q28 — Which delegation approach, and who else gets Fasthosts access?**
Owner: platform volunteer + committee · **Blocks: DNS delegation**
Three options with their trade-offs are in
[ADR-0013](adr/0013-delegation-approach.md), deliberately left open. Separately: the
Fasthosts account is the rollback route, and a rollback route only one person can reach is
not a rollback route ([R1](risks.md#r1--key-person-dependency)).

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

**Q29 — How soon after sign-ups do paid entries open?**
Owner: committee + treasurer · Blocks: how urgent the governance gate is
Payments follow the sign-up launch closely, which pulls data-protection advice and the
treasurer's Stripe account forward from winter to now. Taking money for an entry also means
knowing who it is for, and the prize structure needs age categories — so paid entries
effectively require full entry data, and the name-and-email phase is short by design.

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

**Q26 — Does the club take Supabase Pro for the main project?**
Owner: committee · Blocks: the archive's backup story
The free tier pauses after ~a week of inactivity and has no automated backups. For a
permanent public archive that is a decision rather than a contingency. Nightingale
Nightmare's separate project is the more likely to pause, since a race sign-up page goes
quiet for eleven months of the year ([R5](risks.md#r5--supabase-free-tier-pausing),
[ADR-0012](adr/0012-one-supabase-project-many-services.md)).

**Q30 — How long must the parallel-payments window stay open?**
Owner: treasurer · Blocks: the earliest sensible date for the apex cutover
Both payment routes run side by side while the 94 recurring payers move. The window closes
at the apex cutover, because the old fund page lives on the Squarespace site. The escape
hatch — redirecting the old fund path to the `*.squarespace.com` URL — means a slow payer
need not block the website launch, but the treasurer should set the target deliberately
rather than discover it.

## Facts to verify before figures go further than the board

**Q20 — Actual Squarespace invoice amount** (currently stated as a £170–£420 range).
**Q21 — Actual entry volumes** (illustrative figures assume 80 teams and 150 solo entries).
**Q27 — Real Worker bundle size and CPU time**, measured on the Nightingale Nightmare
service, to establish whether the free tier is viable or Workers Paid (~£48/yr) is
required ([R4b](risks.md#r4b--workers-platform-limits)).
