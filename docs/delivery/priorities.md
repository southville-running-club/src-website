# Priorities

What has to happen, in what order, and why.

**There are two fixed dates. Everything else is ordered by dependency, not by calendar.**
Dates invented to fill a plan become commitments nobody agreed to; dependencies are real
and survive the plan slipping.

---

## The two fixed points

### 1. Nightingale Nightmare sign-ups live — two weeks

A page that collects a name and an email address, and keeps them.

Scoped and planned in [Nightingale Nightmare first](nn-first-delivery.md), which also
carries a finding that qualifies the "not on the critical path" conclusion below:
**working back from an October or November race, paid entries want to open in early
September, so the commercial-use terms bite four weeks from now rather than in April.**

### 2. Off Squarespace before it renews — **21 March 2027**

Read from the billing page on 7 August 2026, and it **moves the deadline earlier than the
"April" this document was written against**. The subscription renews automatically, so
doing nothing means paying for another year.

That is the date everything in the second half of this document works backwards from. It
still matters whether the club cancels before renewal or simply lets it lapse — the first
is the harder deadline — but the date itself is now fixed.

**The DNS migration should happen now, not near this date.** [Move the DNS
first](dns-first.md) sets out the case: taking the riskiest change in the programme while
nothing depends on it turns the March apex cutover into a five-minute record edit.

**The processor is Squarespace Payments, not Stripe.** That is worse for the migration
than the alternative would have been: the processor leaves with the platform, so **every
one of the ~103 monthly mandates has to be recreated somewhere else**. There is no club
Stripe account to fall back on, and creating one is itself a lead-time item. See [the flow
of money](../foundations/current-state.md#the-flow-of-money).

---

## The two-week deadline is not as tight as it looks

A sign-up form is a small thing: a page, somewhere to keep a name and an email, a
hostname, and a deploy. That is days of work, not two weeks.

What could have made it tight was coupling it to a DNS migration. **It does not have to
be.**

Some hosting platforms can only serve a hostname if they are also authoritative for the
whole domain — which turns "where do we put a page" into "who runs our email DNS". Others
accept a **single CNAME record added at the existing DNS provider**, which is purely
additive: it creates a new name and touches nothing that already exists. It cannot break
mail, and it cannot break the current site.

**The platform the club already uses works the second way.** So
`nn.southvillerunningclub.co.uk` is reachable within the deadline by adding one record —
no nameserver move, no zone migration, nothing existing modified. If that record turns out
to be wrong, deleting it restores exactly today's behaviour.

This is worth stating plainly because the opposite conclusion was reached earlier by
reasoning from a vendor's constraints rather than from the requirement. **"The nameservers
must move" was never a property of the problem** — it was a property of one candidate
solution. Choosing that candidate is still open; inheriting its constraints before
choosing it is not.

### What the two weeks actually needs

| | Question |
| --- | --- |
| The page | Static or near-static. What does the club want it to say? |
| The data | Somewhere durable to keep name and email. Free tiers are ample at this size |
| The hostname | One CNAME at the existing DNS provider, if the host supports it |
| The deploy | Push to version control, host builds. Existing pattern |

**A free tier is appropriate here specifically because this phase takes no money.**
Several platforms restrict free tiers to non-commercial use, and a name-and-email interest
list is not commercial use. That exemption ends the moment entries are paid for — which is
a useful forcing function, because it puts the hosting decision at the same point as the
payments decision rather than before it.

### What this phase must not do

- **Must not collect more than it needs.** Name and email carry a light data-protection
  burden. Dates of birth, emergency contacts and registration numbers do not.
- **Must not take money.** That trips the governance gates and the commercial-use terms in
  the same step.
- **Must not require a decision that is still open.** Anything chosen here should be cheap
  to change, because it is being chosen under time pressure.

---

## Working backwards from 21 March 2027

Switching Squarespace off requires three things to be true at once. Each has its own
chain.

```
                                 ┌─ website rebuilt, proven, apex moved ─┐
Squarespace can be switched off ─┼─ member fund fully moved ─────────────┤
                                 └─ every existing URL still resolves ───┘
```

### The chain that decides the date

**The member fund is the long pole.** Around **103 people** must each personally
re-establish a payment; mandates cannot be transferred, and because the processor is
Squarespace Payments they cannot survive the platform either. That is a communications
exercise measured in weeks-to-months, and it is the only item here that cannot be
accelerated by working harder.

**The number is growing, which shortens the runway.** The fund ran at 58 payments a month
across 2025 and 103 in the last 30 days. Every month of delay adds people who will have to
be asked to move.

There is a tension worth naming early. The club's preference is a **programmatic payment
integration on its own website**. That is the better end state — one flow, automatic
reconciliation, no manual matching. But it creates a dependency chain:

```
fund moved  →  needs a website with payments built in
            →  needs the website rebuilt
            →  needs the hosting decision made
            →  needs the requirements settled
```

Against a March deadline, that is a lot of links. The alternative is to **move the fund
first using hosted payment pages that need no website at all**, and replace them with the
programmatic integration afterwards. The fund migration then starts immediately and runs
in parallel with everything else, and March stops depending on the build.

That is a genuine choice, not a foregone one:

| | Programmatic first | Hosted pages first, programmatic later |
| --- | --- | --- |
| Fund can start moving | Once the website is built | **Immediately** |
| March deadline depends on | The whole build chain | Only the website rebuild |
| Members asked to act | Once | Once — the payment itself does not move again if the same processor is kept |
| Total work | Less | Slightly more |
| Risk to the deadline | **High** | Low |

The middle path worth considering: **hosted pages now, on the processor the club intends
to keep**, so members' payments are already in the right place and the later programmatic
work changes the interface rather than the money.

### The escape hatch

The old fund page lives on the Squarespace site, so the apex cutover removes it. If the
fund has not fully moved by then, the old route can be kept alive by redirecting its path
to the Squarespace-hosted address directly. **This means a slow-moving payer cannot hold
the website launch hostage** — worth having in reserve even if it is never used.

---

## What the usage data says about priority

[Target state](../foundations/target-state.md#how-we-will-know-it-worked) said site usage
"decides what is worth rebuilding and what can quietly be dropped". It is now
[measured](../foundations/current-state.md#what-people-actually-read), and it does not
agree with where the effort was heading.

| Area | Share of traffic | Where it sits in the plan today |
| --- | --- | --- |
| Home | 33.6% | — |
| **Race and results** | **16.6%**, longest dwell on the site at 6:08 | A capability, not a headline |
| Runner information | 14.1% | Assumed to be simple content |
| About the club | 13.1% | Assumed to be simple content |
| Newsletters | 9.2% | Automation planned |
| Membership | 7.8% | Significant build |
| Parties and store | 3.6% | Significant build |
| **Kit** | **1.1%** | **"The largest single piece of build in the website"** |
| Documents and policies | 0.9% | Migration required for governance |

**Three corrections follow.**

**Results should be treated as the flagship, not as a capability.** It is the most engaged
page on the site by a distance, it is currently typed out by hand, and last year's results
are still being read nine months on. Automating it removes a manual process *and* improves
the thing people most want. Nothing else on the list does both.

**Kit is over-specified relative to demand.** 141 views in seven months against a build
involving variants, sizes, stock and buy-back. That does not mean skip it — the Quarter
Master's manual work is real and
[C15](../foundations/requirements.md#c15--sell-merchandise-and-tickets) stands — but a
full catalogue is disproportionate to 1.1% of traffic, and a simpler order form may serve
the same purpose. This is worth re-scoping before it is built, not after.

**Documents and policies need hosting, not a product.** 0.9% of traffic, but the documents
that are opened are read for four minutes. Get them off Squarespace's CDN, give them
stable URLs, and stop. No browsing experience, no search.

**One thing the data endorses:** the site is overwhelmingly an information surface — 900
visitors a month against ~100 subscribers, 70% on a phone. A fast, static, mobile-first
site serves the measured audience better than a commerce platform does, which is
consistent with [what the platform analysis
recommends](../solutions/platform-options.md#the-recommendation) for entirely separate
reasons.

---

## Everything else, in dependency order

No dates. Each item lists what must be true before it starts.

### Decisions that block building

| | Needs first |
| --- | --- |
| **Settle the requirements** — is [requirements.md](../foundations/requirements.md) right and complete? | Nothing |
| **Decide bundled or assembled** — one vendor for five capabilities, or several | Requirements |
| **Choose hosting** | Requirements; commercial-use terms confirmed per candidate; whether each candidate needs control of the domain's DNS |
| **Choose the data platform** | Requirements; the bundled-or-assembled decision |
| **Choose payments** | Requirements; what the treasurer needs to reconcile |
| **Decide DNS** | The hosting choice — this is a consequence of it, not a precondition |

### Actions that block nothing and cost nothing

These should happen regardless of any decision above, because they are free and they
reduce risk immediately:

- **Switch on the "cover the fees" option** on the existing fund. Nobody uses it today and
  the club absorbs every fee.
- **Establish who owns the payment account** connected under Squarespace. Club money flows
  through something set up informally.
- **Establish who holds every account** — domain, hosting, database, payments — and get a
  second person onto each. Every one of them is currently a single point of failure.
- **Move the timing repository into the club organisation.** One administrative action.
- ~~Confirm the Squarespace renewal date~~ — **done: 21 March 2027, auto-renewing.** What
  cancelling before it requires is still open.
- **Turn on two-factor authentication for Squarespace Payments.** It is not enabled, and
  that account receives every pound the club takes online.
- **Settle the Nightingale Nightmare race date.** It blocks race planning, and the
  clocks-change weekend makes it a technical input.
- **Apply for England Athletics verification access.** The lead time belongs to them, and
  a fallback exists meanwhile, so applying early costs nothing.
- **Find out what the `mcp` DNS record serves**, before the club takes responsibility for
  the zone.

### Work that follows

| | Needs first |
| --- | --- |
| Nightingale Nightmare sign-ups | A host, somewhere to store data, a hostname |
| Nightingale Nightmare payments | Governance gates satisfied; a payment choice |
| Member fund migration | A payment choice; treasurer arrangements |
| Website rebuild | Hosting and data choices; a content inventory; committee input on what needs editing |
| Results archive | The website; read access to timing data |
| Apex cutover | The website proven; redirects verified; the fund handled |
| Squarespace cancellation | The apex moved; the fund confirmed moved |
| Timing platform migration | A hosting choice; and it happens away from any race, with a full race simulation |
| Nightingale Nightmare timing and results | The timing work; the race date |

---

## What is genuinely on the critical path

Only two things:

1. **The member fund**, because 94 people acting individually cannot be compressed, and
   nothing about switching Squarespace off can happen without it.
2. **The website rebuild**, because the apex cannot move until it exists and is proven.

Everything else has slack. That is worth knowing, because it means effort spent elsewhere
does not buy an earlier April.

**Nightingale Nightmare is not on the critical path to April** — it has its own deadline
and its own dependencies, and it should be built so that decisions taken for it are cheap
to revisit.

**But its own deadline arrives first.** If NN takes entry money, it needs a host whose
terms permit payment by early September — which makes the hosting choice due months before
April. [Nightingale Nightmare
first](nn-first-delivery.md#the-finding-commercial-use-bites-in-weeks-not-in-april) sets
out the schedule and the fallback that removes the dependency if the club wants it.

---

## What can safely be decided later

Deliberately deferring a decision is only safe if deferring it is *cheaper* than deciding
it early and wrongly. These qualify:

- **The permanent home of the timing platform.** It works where it is. Moving it is a
  project with a race-simulation gate, and no race depends on it moving.
- **How the club sends email.** One of the cheapest capabilities to change; it should not
  influence larger decisions.
- **File storage.** Close to a commodity; low exit cost whichever way it goes.
- **Whether to build an editing interface for the committee.** Better answered by
  observing what they actually ask to change after launch than by guessing beforehand.
- **Race photographs.** Brings its own data-protection questions; nothing depends on it.

And one that emphatically **cannot** safely be deferred: **who else can reach the club's
accounts.** It costs nothing, it blocks nothing, and it is the only item here that gets
worse purely with the passage of time.
