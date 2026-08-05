# Southville Running Club — Running our races on our own platform

**Architecture and cost analysis for the directors**
Prepared by Bindal Shah · July 2026 · v8, for discussion

> **About this document.** This is a faithful transcription of the board proposal PDF
> (`SRC-platform-proposal (2).pdf`) into markdown, so it is diffable, linkable and
> version-controlled alongside the work it describes. Content is unchanged; only the
> layout has been adapted.
>
> It is a **point-in-time record of a proposal**, not a specification. Where this
> document and the working documentation in [`docs/`](../) disagree, the working
> documentation wins — see [Mission and goals](../mission-and-goals.md),
> [Roadmap](../roadmap.md) and the [decision records](../adr/).

---

## Summary

Pass the Buck 2026 was timed start to finish on software the club built and owns.
Marshals captured every crossing on their phones, the leaderboard updated live, and
results went out in the 2025 website format. That system is the foundation for
everything here.

This paper proposes five workstreams on top of it:

1. Restructure the platform so every year's race is its own event and every past result
   is kept permanently.
2. Bring Nightingale Nightmare on as a second annual race, which is configuration rather
   than new software.
3. Replace the Squarespace website with a site we build and host ourselves.
4. Modernise membership — move the £2.50 member fund (94 recurring payers, roughly
   £2,820 a year) off Squarespace, verify joiners against their England Athletics
   registration, and gate the members' WhatsApp group behind a one-time joining link.
5. Take race entries on our own site with card payments through Stripe.

All money questions are consolidated in one section near the end. The headline, updated
now the race director has confirmed that Full On Sport's fee is added on top of the entry
price — paid by runners, not the club: the club's own platform-and-fees bill falls from
roughly £510–£890 a year to roughly £180–£230, and running entries ourselves creates a
further choice worth roughly £150 a year at realistic volumes — hold runners' total
prices level and bank it for club funds, or cut entry prices and hand it to runners.

The remaining honest caveats — migration risk on 94 recurring payers, and a hosting
decision that moves the numbers — are stated where they arise. As agreed at the QGM, no
payment work starts before data-protection advice and treasurer-controlled Stripe
arrangements are in place.

## Where we are today

The timing platform is a web app built on Next.js, hosted on Vercel, with a Supabase
database. It costs the club nothing to run — both services sit inside their free tiers —
and it carried Pass the Buck 2026 end to end: registration import, walk-in bibs,
offline-safe live capture, anomaly resolution, DNS/DNF/DQ status, and publishable results
export.

Around it sit two paid platforms and three money flows. The club website runs on
Squarespace, a recurring subscription. Race entries run through Full On Sport, which
takes a percentage-plus-fixed fee per entry. And members pay £2.50 — recurring or
one-off — into a Squarespace donation fund ('Monthly running fee', set up October 2024)
in place of 50p cash at sessions. The fund's dashboard shows 94 active recurring payers,
every one at exactly £2.50: roughly £2,820 a year of recurring income, a larger line than
the Squarespace subscription itself. It also shows that 0 percent of payments use
Squarespace's 'cover the fees' option, so the club absorbs every fee on that stream
today.

One governance point stands apart from everything else in this paper: a payment account
is already connected under Squarespace, set up informally when the fund was created.
Establishing who owns it, who can access it, and whether the treasurer is on it is worth
doing now — club money flows through it today.

## How it fits together

One codebase, one database, three front doors: the club website, the payments surface,
and the timing app are all faces of the same platform. That is why each additional piece
costs so little — the expensive part exists and has already run a race. Around the
platform sit three external services, each doing one job: Stripe processes cards, Resend
sends the club's emails (membership acknowledgements, entry confirmations, the welcome
carrying the one-time QR), and the WhatsApp members' group is the destination the
single-use link opens. The hosting section later discusses the Vercel-or-Cloudflare
choice for the top layer, which changes nothing else in the picture.

## Workstream 1 — every year's race, kept forever

Today the platform is wired to a single event. The restructuring work (already underway)
makes each running of each race its own event: Pass the Buck 2026, Pass the Buck 2027,
Nightingale Nightmare 2026, and so on, each with its own roster, crossings and results,
nothing ever overwritten. The results archive becomes permanent and public — any past
year, course records, year-on-year comparisons — and a safety rule ensures only one event
can be live for timing at a time, so a marshal's phone can never capture into the wrong
race.

**Cost:** volunteer time only.

## Workstream 2 — Nightingale Nightmare on the same platform

Nightingale Nightmare is a solo mass-start 10 km — one runner per entry, one gun, one
finish crossing each. Simpler than Pass the Buck's relay, and it reuses nearly all the
machinery: countdown, capture, offline queue, leaderboard, anomaly tools, results.

What is new is configuration: solo entries, plain sequential bibs, and age-band
categories (Vet 40/50/60, male and female), which require date of birth in the entry
data. A specification is drafted; the club needs to confirm the 2026 date (notes disagree
between 25 October and 1 November — and because the race sits on or near the
clocks-change weekend, the date matters technically as well as operationally), whether
entry data includes date of birth, whether walk-ins are allowed, and the
overall-versus-veteran prize rule.

**Cost:** volunteer time only.

## Workstream 3 — a new club website, off Squarespace

Rebuild southvillerunningclub.co.uk as our own site: about, membership, training
sessions, news, and a page per race drawing its information and results directly from the
same database as the timing app — results appear automatically, permanently, for every
year. The Squarespace subscription, the club's only recurring website bill, goes away
entirely; the residual cost is domain registration.

The trade-off directors should weigh is editability: Squarespace lets any committee
member edit a page visually, while our own site is initially updated through the
developer. The mitigation is designing the site so frequently-changing content — race
details, dates, results — comes from the database and updates itself, keeping genuinely
static content minimal. A lightweight editing interface can be added later if the
committee needs one.

Sequencing matters here: the member fund below must be re-homed before Squarespace is
cancelled, and the hosting choice should be settled first so the site is built once on
its final home.

## Workstream 4 — membership: the fund, the EA check, and the WhatsApp door

### Moving the £2.50 fund

The fund does not wait for anything else and does not need a website at all. Stripe
offers hosted payment pages (Payment Links) supporting one-off and recurring prices,
created from the dashboard with no code and no hosting.

The migration: create the £2.50 monthly and a new £30 annual price in the club's Stripe
account, put the link where members find the current one, invite the 94 recurring payers
across, and cancel Squarespace only once the treasurer confirms the income has fully
moved. Recurring mandates cannot be transferred silently — each member must actively
re-subscribe — so old and new run in parallel and stragglers get chased by name; there
are only 94 of them.

Two prior facts to establish from the Squarespace payments settings: whether the
connected processor is a club Stripe account (in which case saved customers and cards
survive the move) or Squarespace's own processor (in which case everyone simply signs up
afresh — which Dave believes is the setup, since the club only provided a bank account
for deposits). And one free win available today, before any of this: switch on
Squarespace's 'cover the fees' option, which lets members choose to add a few pence to
cover the charge.

### The new member journey

New joiners get one flow that ends inside the members' WhatsApp group, with two gates on
the way in: are you a valid, active England Athletics-registered member, and have you
paid?

**The EA check.** England Athletics operates a licence-check API that validates a URN
against name and status — it is exactly what race entry systems use to verify
registration at the point of entry. Access is by agreement: the club applies to EA, signs
the agreement, and receives a key; the paper assumes this costs nothing or a nominal
amount for an affiliated club, to be confirmed on application. If access takes time,
there is a fallback that works from day one with no dependency at all: the membership
secretary already has the club's full member list in the EA myAthletics portal, and a
periodic export of it synced into our database makes the check a local lookup. Same
member experience either way; the API simply keeps it current automatically.

**The one-time WhatsApp link, described honestly.** WhatsApp's own group invite links are
static and shareable — anyone holding the link can join — and WhatsApp's business tools
do not manage group membership, so true single-use enforcement at WhatsApp's end is not
possible for anyone. What we build instead is a single-use link on our own domain: the
welcome email (and its QR code, which is just the same link rendered scannably) points at
a token that our database marks consumed on first tap and expires after a set period;
only then does it forward the member into the group. Two backstops close the remaining
gap: the WhatsApp group is set to admin approval so an unexpected joiner still needs a
human yes, and the underlying invite link is rotated periodically so a leaked copy goes
stale. For a running club this is the right level of gating — practically closed, zero
cost, and no WhatsApp integration to maintain.

The welcome email itself is sent through a transactional email service (Resend) from the
club's own address, which requires verifying the domain — a step that slots into the
domain move in workstream 3. Stripe separately sends payment receipts and renewal
notices, so our email carries the welcome, the QR, and the useful links rather than
duplicating receipts.

## Workstream 5 — race entries on our own site

Each race page gains an entry form. The entrant fills in exactly the fields our timing
and categories need — fixing at the source the data-quality problems we currently work
around when importing Full On Sport's CSV — pays by card through Stripe's hosted
checkout, and the confirmed entry lands directly in the race roster. No export, no
import, no re-keying; on race morning the registration desk works from a roster that was
always ours.

The EA check from workstream 4 is load-bearing here, not optional: Pass the Buck already
prices by registration status — £8 per EA-registered runner, £10 per non-EA runner, so
£16, £18 or £20 per team — paid in one transaction covering both members. The entry form
therefore validates each runner's URN live and prices the team accordingly, exactly the
check Full On Sport performs today.

Governance before code, exactly as agreed at the QGM: data-protection advice on
collecting and retaining entrant personal data (names, dates of birth, emergency
contacts), a club Stripe account under treasurer oversight with a written refund policy
and entry terms, and reconciliation designed with the treasurer. None of the build starts
until those are in place.

## The hosting choice — Vercel or Cloudflare

The platform lives on Vercel today. Vercel's free tier prohibits commercial use, so the
moment race entries are taken on our own site, the Pro plan becomes mandatory.
Cloudflare's free tier carries no such restriction: 100,000 dynamic requests a day,
static pages free without limit, and no bandwidth charges on any plan, with a paid tier
at a quarter of Vercel's price for headroom. The member fund forces this decision on
neither platform — its payment pages are hosted by Stripe — so the question is triggered
only by the race-entries build, where the form and payment flow genuinely run on our
site.

The trade is effort and risk. Vercel is the company behind Next.js, our framework;
hosting there is zero-friction. Cloudflare runs Next.js through the OpenNext adapter —
now Cloudflare's officially recommended route, supporting current Next.js versions, and
recently put on a durable footing by the Next.js team's stable adapter interface with
Cloudflare as a named partner — but it remains a translation layer with occasional rough
edges. And the thing that would migrate is safety-critical: the timing app has been
proven, on Vercel, in front of a live race. Moving it is a real project with a full test
cycle including the manual race-simulation checks automated tests cannot replace, and it
should never happen close to an event.

| | Vercel (today) | Cloudflare |
| --- | --- | --- |
| Free tier allows payments | No — Pro plan required | Yes |
| Fixed cost with payments | ~£190 a year | £0 (or ~£48 for paid tier) |
| Bandwidth charges | Above included allowance | None, on any plan |
| Next.js support | First-party, zero-friction | Official adapter; mature but a translation layer |
| Migration effort | None | One project + full race-simulation testing |
| Race-day risk | None — proven in production | Real until re-proven; never migrate near an event |

Three ways to play it: stay on Vercel and pay the fixed cost when entries start
(simplest, dearest); move everything to Cloudflare before the entries build (cheapest,
one well-scheduled migration); or split — website and entries on Cloudflare, timing app
untouched on Vercel's free tier, which captures the saving without touching the proven
race-day system at the price of operating two platforms, and rests on a reading of
Vercel's terms worth confirming. The choice should be made before workstream 3 begins, so
the website is built once. My lean is the second or third option; the numbers in the next
section show why.

## The money

> **Assumptions used throughout**, so the tables can be checked and re-based: Pass the
> Buck priced at £8 per EA-registered runner and £10 per non-EA runner, paid as one
> transaction per team (£16, £18 or £20 depending on the pair); Nightingale Nightmare
> assumed £8–£10 solo, to be confirmed; illustrative volumes of 80 teams and 150 solo
> entries a year; 94 recurring fund payers; exchange rate £0.79 to the dollar, with all
> US-dollar subscription prices moving with it. Figures marked 'read off invoice' should
> be replaced with actuals before this goes further than the board.

### What we pay today

| Line | Basis | Per year |
| --- | --- | --- |
| Squarespace subscription | Plan-dependent; UK annual billing runs ~£173 (Basic), ~£245 (Core), ~£418 (Plus) incl VAT | £170–£420 — read off invoice |
| Member fund fees | 94 payers × £2.50 × 12 = £2,820 volume; Squarespace Payments processing (~2–2.9% + 25–30p, i.e. ~30–37p per £2.50) plus any plan transaction fee | ~£340–£450 |
| Full On Sport fees | 5.9% + 20p per transaction, plus VAT on the fee — £1.37–£1.66 per team, 81p–95p per solo; 80 teams + 150 solos; added on top of the entry price | ~£230–£280 — **paid by entrants, not the club** |
| Domain | Bundled with Squarespace or separate | £0–£20 |
| Hosting and database | Vercel and Supabase free tiers | £0 |
| **Total today, club-borne** | | **~£510–£890** |

Confirmed by the race director: Full On Sport's fee is added on top of the entry price,
so the ~£390 is paid by runners today and the club pays nothing on entries. The
club-borne total reflects that. It also reframes the entries workstream: moving to Stripe
does not cut a club cost — it creates a pot the board can point at either the club or the
runners. The whole-year picture below shows both readings.

### Per-payment fees compared

Stripe's published UK rates: 1.5% + 20p per standard UK card (2.5% + 20p for EEA cards,
3.25% + 20p international — our entrants are overwhelmingly UK). No monthly fee; a
disputed payment costs about £20 regardless of outcome, which the refund-policy
prerequisite exists to keep rare. Stripe's charity discount applies to donations only —
registration and ticket fees are explicitly excluded — so standard rates are the right
planning numbers.

| Payment | Full On Sport fee | Stripe fee | Saving |
| --- | --- | --- | --- |
| PtB team, £16 (EA + EA) | ~£1.37 (8.6%) | 44p (2.8%) | ~93p |
| PtB team, £18 (EA + non-EA) | ~£1.51 (8.4%) | 47p (2.6%) | ~£1.04 |
| PtB team, £20 (non + non) | ~£1.66 (8.3%) | 50p (2.5%) | ~£1.16 |
| NN solo, £8 | ~81p (10.1%) | 32p (4.0%) | ~49p |
| NN solo, £10 | ~95p (9.5%) | 35p (3.5%) | ~60p |

Two structural points. Percentage pain is worst on Nightingale Nightmare's small solo
entries — FOS's effective rate touches 10% at £8. And Pass the Buck's
one-payment-per-team shape halves the number of fixed 20p fees; the new entry form keeps
that shape, one transaction covering both members exactly as today.

| Member fund route | Fee per payment | Per year, 94 payers |
| --- | --- | --- |
| Squarespace fund (today) | ~30p–40p (~12–16%) | ~£340–£450 |
| Stripe, £2.50 monthly | ~24p (9.5%) | ~£268 |
| Stripe, half moved to £30 annual | 65p a year on annual | ~£165 |
| Stripe, all on £30 annual | 65p a year (2.2%) | ~£61 |

Small payments are fee-heavy everywhere because the fixed 20p dominates. Moving platform
holds the line; the £30 annual option is what actually cuts the rate, and every member
who takes it saves the club money at no cost to themselves.

### Fixed annual costs by scenario

| Item | Website only | + entries, Vercel | + entries, Cloudflare |
| --- | --- | --- | --- |
| Domain registration | ~£15 | ~£15 | ~£15 |
| Hosting | £0 | ~£190 (Pro) | £0–£48 |
| Supabase database | £0 | £0 | £0 |
| Email (Resend), QR/token, EA check | £0 | £0 | £0 |
| Supabase Pro contingency | (£240) | (£240) | (£240) |
| **Total fixed** | **~£15** | **~£205** | **~£15–£63** |

The contingency: Supabase's free tier pauses projects after about a week of inactivity
and has no automated backups; the Pro tier (~£240 a year) removes pausing and adds daily
backups. Quiet months between races are when pausing could bite a permanent archive, so
treat £240 as pre-approved insurance to be spent only if needed — public traffic on the
new website may well keep the project active for free. Vercel Pro's figure is the seat
fee only: it includes usage allowances (a terabyte of transfer, millions of invocations)
that club traffic will never approach, so overage risk is effectively nil.

### The whole-year picture

| | Today | Fully delivered (Cloudflare) |
| --- | --- | --- |
| Website platform (club pays) | £240–£420 | £15–£63 incl domain |
| Member fund fees (club pays) | ~£340–£450 | ~£165 (half on annual) |
| **Club-borne total per year** | **~£510–£890** | **~£180–£230** (~£420–£470 with contingency) |
| Entry fees (runners pay, 80 teams + 150 solos) | ~£230–£280 via FOS | ~£85–£95 via Stripe — a ~£140–£185 pot for the board to allocate |

Two readings of the same numbers. Club-borne costs fall by roughly £300 to £700 a year
regardless. On entries, the roughly £150-a-year gap between FOS and Stripe fees (at these
volumes) belongs to whoever the board chooses: hold runners' total prices at today's
level and the club banks about £1 per team and 50–60p per solo — roughly £150 a year — or
drop the headline prices and give entrants the saving. On the Vercel route instead, add
~£145 a year to the delivered club-borne column. Figures are illustrations at the stated
assumptions, to be re-based on actual invoices and entry volumes.

### Break-even on race entries

Because FOS fees are borne by entrants, the club gains on entries only if the board holds
runners' total prices level and keeps the difference — about £1 per team and 50–60p per
solo before hosting, a blended ~70p per paid transaction at the assumed mix. The table
shows the pot created and what is left after fixed hosting; if the board instead cuts
prices, the club side is simply the hosting line and the benefit lands with entrants:

| Paid transactions per year (teams + solos) | Gross pot (~70p each) | Net on Vercel (~£190 fixed) | Net on Cloudflare (£0–£48) |
| --- | --- | --- | --- |
| 150 | ~£105 | ~£85 behind | ~£57–£105 ahead |
| 230 (illustrative current) | ~£160 | ~£30 behind | ~£112–£160 ahead |
| 350 | ~£245 | ~£55 ahead | ~£197–£245 ahead |

At real prices this table is decisive on hosting: the Vercel route does not pay for
itself on entries at anything like current volumes, while Cloudflare is ahead from the
first entries. The entries workstream's non-financial case — data quality, data
ownership, one roster from entry to finish line — is unchanged either way.

## Risks, honestly stated

**Key-person dependency.** The platform is built and maintained by one volunteer.
Mitigations: a written runbook for the race director is already planned, code and
documentation live in the club's reach on GitHub, and everything runs on mainstream
services another developer could pick up. This risk exists today and grows with each
workstream; it is the strongest argument for boring design and current documentation.

**Member fund migration.** All 94 recurring payers must actively re-subscribe — roughly
£2,800 a year exposed during the switch, and a ten percent shortfall (~£280) would
outweigh the fee savings. Parallel running, a proper comms push, chasing stragglers by
name, and cancelling Squarespace only on the treasurer's confirmation are therefore
requirements, not niceties.

**Data protection.** Taking entries and memberships means holding personal data — names,
dates of birth, EA numbers, emergency contacts — under the club's own responsibility.
Manageable at our size, but proper advice, a retention policy, and a privacy notice come
before the first record is taken. Note the EA check adds a data-sharing angle (validating
a member's URN against EA's records) that the advice should cover.

**Payment operations.** Refund requests, failed payments, the occasional dispute. Small
volume, but someone must own it: the design puts the treasurer in that seat with tooling
to reconcile Stripe payouts against entries and memberships.

**WhatsApp gating limits.** The one-time link is enforced by our token, not by WhatsApp;
a determined leak is caught by admin approval and link rotation, not prevented outright.
Stated so nobody believes the gate is stronger than it is.

**Hosting migration.** If the Cloudflare route is chosen, the migration window is a risk
in itself — mitigated by doing it in the quiet season, running Vercel in parallel until
Cloudflare is proven, and completing the full manual race-simulation checks before any
event depends on it.

**Website editability.** Less convenient than Squarespace for ad-hoc edits; mitigated by
database-driven content, covered in workstream 3.

**Nightingale Nightmare's date.** The race sits at the clocks-change boundary — a genuine
technical hazard for a timing system, and the reason to settle the date question early
and test against the real date.

## Recommendation

**Immediately, at no cost:** switch on the 'cover the fees' option on the existing
Squarespace fund, and establish who owns the payment account connected under Squarespace,
putting it under treasurer oversight.

**Phase 1, now to autumn 2026:** complete the multi-event restructuring and run
Nightingale Nightmare 2026 on the platform, once the club confirms the open questions
(date, entry-data fields, walk-ins, prize rule). Apply to England Athletics for
licence-check API access in parallel — the lead time is theirs, not ours. *Cost: nil.*

**Phase 2, winter 2026/27:** settle the hosting question, then build and launch the new
club website on its final home and move the domain. In parallel, re-home the member fund
onto Stripe payment pages with the £30 annual option, migrate the 94 recurring payers,
stand up the join flow (EA check, welcome email, one-time WhatsApp link), and have the
treasurer confirm income has fully moved. Only then cancel Squarespace, ahead of its next
renewal. *Cost: ~£15 a year ongoing.* The QGM's Proposal A discussion already supports
the website move; the hosting choice is the new decision.

**Phase 3, ahead of entries opening for Pass the Buck 2027:** race entries with Stripe,
strictly conditional on the prerequisites — data-protection advice taken, club Stripe
account under treasurer oversight, refund policy and entry terms agreed — and with the
board's pricing choice made explicitly: pass the fee saving to runners as cheaper
entries, or hold total prices level and bank roughly £150 a year for club funds at
realistic volumes. *Cost: ~2.5–4% per transaction replacing ~8.5–10% (borne by whoever
the pricing choice says), plus the fixed hosting line from the scenario table — which at
these entry prices the break-even table shows only the Cloudflare route recovers.*

Approved in this shape, the club ends up with a permanent results archive, two annual
races on infrastructure it owns, a membership journey that verifies EA registration and
closes the WhatsApp door behind a paid join, a website costing a tenth of the current
one, and an entry system that keeps the data and — on the right hosting — essentially all
of the fee saving inside the club.
