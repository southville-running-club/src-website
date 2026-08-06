# Plan of attack

How the club gets from "Squarespace, plus a timing app on Vercel" to "everything on
Cloudflare, on our own domain, with Squarespace switched off".

The decisions behind each step are in the [decision records](adr/); the scope of each
workstream is in the [roadmap](roadmap.md). This document is the order.

---

## The gating milestone

**Nightingale Nightmare running on `nn.southvillerunningclub.co.uk`, on Cloudflare.**

Everything is sequenced behind it. Payments come after it. No part of Squarespace migrates
before it. It is the first thing the club will have built and owned end to end on the new
platform, and proving it on a low-stakes race is worth more than any amount of planning.

Two consequences fall out of that choice.

**DNS delegation comes first**, because a Worker can only serve a club hostname if
Cloudflare holds the zone. There is no way around this at any price — see
[ADR-0005](adr/0005-dns.md). Delegation is not migration: records copied across unchanged
leave Squarespace serving and mail flowing.

**The timing app moves last.** Nightingale Nightmare 2026 is sign-ups only, so the next
timed race is Pass the Buck in July 2027. The port has no autumn deadline and should not
invent one.

---

## The sequence

Tracks A, B and C run together. D and E are the quiet season.

```
2026          Aug        Sep        Oct        Nov        Dec  │ 2027  Jan   Feb   Mar ... Jul
             ────────────────────────────────────────────────  │      ─────────────────────
A  DNS       ██ delegate                                       │
B  NN        ░░ build ░░ ██ nn. live ░ payments ░ RACE          │
C  Fund      ░░░░░░░ Stripe links, migrate 94 payers ░░░░░░░░░  │
   Govern.   ░░ DP advice + treasurer Stripe ░░                 │
D  Website                          ░░░░░ build ░░░░░ ██ apex   │  ██ Squarespace off
E  Timing                                            ░░ port ░░ │  ░░ simulate ░░ ██ cut over → PtB 2027
```

### Track A — DNS delegation · blocks everything

Move the authoritative nameservers to Cloudflare; the registration stays at Fasthosts. The
zone is 18 records, documented and annotated in [ADR-0005](adr/0005-dns.md).

**The approach is an open decision** — [ADR-0013](adr/0013-delegation-approach.md) sets out
three options with their trade-offs, the dual-answer window that frames the risk, the
verification schedule and what to do when something goes wrong.

Three things that hold under any option:

- **`mail` must stay DNS-only.** The MX points at a hostname inside the zone; proxy it and
  inbound mail resolves to Cloudflare, which does not speak SMTP.
- **Never click "restore automatic updates"** on the flagged records — it would repoint the
  apex at Fasthosts hosting and take the site down.
- **A second person needs Fasthosts access before the change.** It is the rollback route.

*Done when:* Cloudflare is authoritative, the Squarespace site is unchanged to visitors,
and mail has been sent and received deliberately across a 72-hour watch.

### Track B — Nightingale Nightmare · the milestone

Its own service, its own Worker, its own Supabase project to start
([ADR-0012](adr/0012-one-supabase-project-many-services.md)). Built and demoed on
`*.workers.dev`, so **the build is not blocked by Track A** — only the public launch is.

**Settle the race date first** ([Q8](open-questions.md)). It is 25 October or 1 November,
the notes disagree, and the race sits on the clocks-change weekend — a technical input, not
just a diary entry. It costs nothing to answer and blocks the whole track.

The service grows in phases:

1. **Sign-ups — name and email.** A minimal interest list. Small data footprint, no special
   category data, launchable in weeks.
2. **Payments — a Stripe Payment Link, reconciled by hand.** Stripe hosts the page; the
   treasurer matches payments to sign-ups by email. No checkout to build and no card data
   near us. At ~150 solo entries the manual reconciliation is tedious and entirely
   feasible. Gated on Track C's governance work, not on engineering.
3. **Timing and results.** Later. The timing app already models solo events, but the
   leaderboard's derivation is relay-shaped and age-band categories do not exist — see the
   [roadmap](roadmap.md#workstream-2--nightingale-nightmare-on-the-same-platform).
4. **Photos.** Later still, and it brings its own data-protection question: photographs of
   identifiable people are personal data.

**Phase 1 is short by design.** Taking £10 for an entry means knowing who it is for, and
the prize structure needs age categories — so paid entries effectively require full entry
data. Plan for that rather than being surprised by it.

*Done when:* entrants have signed up on the club's own domain, on the club's own platform.

### Track C — Payments and governance · start now

Two strands, both long-lead, both blocked on people rather than code.

**Governance — begins immediately, in parallel with the Nightingale Nightmare build.**
Payments follow the sign-up launch closely, which pulls this forward from winter. It cannot
be rushed, which is exactly why it starts before it is needed
([P13](principles.md#p13--governance-gates-come-before-the-code-they-enable)):

- Data-protection advice on collecting and retaining entrant data, covering the England
  Athletics data-sharing angle.
- A club Stripe account under treasurer oversight.
- Written refund policy and entry terms.

**The member fund — the longest lead item in the programme.** All 94 recurring payers must
personally re-subscribe; mandates cannot be transferred. It needs no website at all, so
nothing technical blocks it.

- **This week, free:** switch on Squarespace's "cover the fees" option — 0% of payments use
  it today. And establish who owns the payment account connected under Squarespace, putting
  it under treasurer oversight ([Q14](open-questions.md)).
- Establish whether the connected processor is a club Stripe account or Squarespace's own;
  it decides whether saved cards survive ([Q13](open-questions.md)).
- Create the £2.50 monthly and £30 annual prices as Stripe Payment Links. **The annual
  option is what actually cuts the fee rate** — 2.2% against 9.5%.
- Run both routes in parallel. Because Stripe hosts the payment pages, the new route is
  independent of both websites and genuinely runs alongside the old one.
- Comms push. **Chase all 94 by name.**

**The parallel window closes at the apex cutover**, not at Squarespace cancellation — the
old fund page lives on the Squarespace site and the cutover removes it. The escape hatch: a
redirect from the old fund path to the `*.squarespace.com` URL, which keeps the old route
alive afterwards. That way a slow-moving payer cannot hold the website launch hostage.

*Done when:* the treasurer confirms the income has fully moved.

### Track D — Website rebuild · before the timing port

Deliberately ahead of Track E, so OpenNext's rough edges are found on a content site rather
than on race-critical software.

1. Content inventory and a complete URL map of the current site ([Q5](open-questions.md)).
2. Ask the committee what they actually need to edit, and how often
   ([Q6](open-questions.md)). That answer decides how much is database-driven — it is the
   mitigation for the editing trade-off accepted in
   [ADR-0010](adr/0010-leaving-squarespace.md).
3. Build on Workers. Deploy to `beta.southvillerunningclub.co.uk`, **noindex**.
4. **Like-for-like content, plus the results archive.** Existing pages ported faithfully;
   visual redesign comes afterwards as its own piece of work. The database-driven race pages
   and the permanent archive ship *at* cutover — they are the reason for the move, not an
   improvement on it.
5. Redirects from every existing Squarespace URL, verified against the inventory.
6. Accessibility and performance sign-off.
7. **Apex cutover.** Repoint the apex and `www` from Squarespace to the site Worker, keeping
   **`www` canonical** — the bare domain 301s to it today and every printed link depends on
   that. A record change inside Cloudflare, reversible in seconds.
8. Watch a week. Then cancel Squarespace ahead of its renewal.

### Track E — Timing app port · quiet season

1. **First, and independent of everything else: transfer the repository from the personal
   account to `admin-src`.** The proposal's own key-person mitigation says club code lives
   in the club's reach; today it does not ([R1](risks.md#r1--key-person-dependency)).
2. Port with `@opennextjs/cloudflare`. Next.js 16 is supported and the app is on 16.2.4, so
   no downgrade. Watch the 3 MB compressed bundle ceiling and the 10 ms CPU limit — budget
   Workers Paid.
3. Deploy to `timing.` **in parallel.** Vercel stays live throughout.
4. Full manual race simulation on Cloudflare: multiple marshal devices, deliberate
   connectivity loss and recovery, anomaly resolution, walk-in bibs, concurrent leaderboard
   load, and a run against a real race date. Including the **true two-marshal end-to-end
   check** the app's own log records as still outstanding.
5. Cut over. Keep Vercel deployable as rollback until a race has run on Cloudflare.
6. **Proven well before Pass the Buck 2027.**

Three things a port must not break: the IndexedDB offline queue and its idempotent-upsert
contract; the TypeScript/SQL lockstep on bib resolution; and the `Europe/London` pinning in
`lib/london-time.ts`. See the [timing app review](reference/timing-app-review.md).

---

## Running old and new side by side

Every service takes its own hostname and the apex is left alone until last. This is what
makes the programme incremental rather than a single leap.

| Hostname | Serves | From |
| --- | --- | --- |
| `southvillerunningclub.co.uk` + `www` | Squarespace, unchanged | today |
| `nn.` | Nightingale Nightmare Worker | Track A complete |
| `beta.` *(noindex)* | Rebuilt site Worker | Track D build |
| `timing.` | Timing Worker, parallel to Vercel | Track E |
| `southvillerunningclub.co.uk` + `www` | **Site Worker** | **Track D cutover** |

Every step is one DNS record. Every rollback is one DNS record. No step requires the
previous surface to be switched off first.

---

## Dependencies

```
A. DNS delegation ──┬─→ B. NN public launch on nn.   ← the gating milestone
                    ├─→ D. Apex cutover
                    └─→ E. Timing cut over

Q8 (race date) ─────→ B. everything in Nightingale Nightmare

C. Governance ──────→ B2. NN payments
                └───→ Any entry or membership payment anywhere

C. Fund income confirmed ──→ D7. Apex cutover ──→ D8. Squarespace off
                                  ↑
                            (or the fund redirect, if the fund is still moving)

E1. Repo transfer ──→ E2. Port
```

**The critical path to switching Squarespace off runs through the member fund, not through
any code.** Ninety-four people re-subscribing one at a time is the slowest thing here, and
it starts today.

---

## Priorities

1. **Settle the Nightingale Nightmare date** ([Q8](open-questions.md)). Free, blocks a
   whole track, and the clocks change makes it technical.
2. **Switch on "cover the fees"** and **establish payment-account ownership.** Free, this
   week, pure governance.
3. **Commission data-protection advice and set up the treasurer's Stripe account.** Long
   lead, and payments follow the sign-up launch closely.
4. **Choose the delegation approach** ([ADR-0013](adr/0013-delegation-approach.md)) and get
   a second person onto the Fasthosts account.
5. **Transfer the timing repository to the club organisation.** One administrative action;
   materially reduces the club's largest risk.
6. **Delegate DNS.**
7. Build Nightingale Nightmare.
8. Migrate the member fund.
9. Rebuild the website.
10. Port the timing app.

Items 1, 2 and 5 cost nothing and need no code. Items 3 and 4 are decisions with lead
times, which is why they sit above the building.

---

## What this plan deliberately does not do

- **Does not migrate any part of Squarespace** until Nightingale Nightmare is running on an
  SRC domain on Cloudflare.
- **Does not port the timing app before the website.** Rough edges get found on a content
  site, not on race-critical software.
- **Does not take payments** on any surface before
  [P13](principles.md#p13--governance-gates-come-before-the-code-they-enable)'s gates are
  satisfied.
- **Does not proxy the live Squarespace site through Cloudflare** to add a path route —
  see [ADR-0011](adr/0011-nightingale-nightmare-routing.md).
- **Does not put the timing app on a path** under the apex, which would make a website
  deploy able to break race-day routing.
- **Does not cancel Squarespace** until the treasurer confirms the income moved and the new
  site has run for a week.
