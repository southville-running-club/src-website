# Plan of attack

How the club gets from "Squarespace plus a timing app on Vercel" to "everything on
Cloudflare, on our own domain, with Squarespace switched off".

Written 5 August 2026, after the decision to make
[Cloudflare the end target](adr/0002-hosting-platform.md). It verifies, corrects and
sequences the migration; the reasoning behind each choice is in the
[decision records](adr/).

---

## The proposed order, and what changed

The plan as put forward:

1. Nightingale Nightmare sign-up page on Cloudflare and Supabase, on a subdomain
2. Port the timing app to Cloudflare, under `southvillerunningclub.co.uk`
3. Rebuild the Squarespace site on Cloudflare
4. Migrate the apex to Cloudflare
5. Payments running on old and new in parallel
6. Migrate recurring payers off Squarespace
7. Turn Squarespace off

**The destination is right and the broad shape holds.** Five things need to move.

### 1. DNS delegation is step zero, not step four

A Cloudflare Workers **Custom Domain requires a full Cloudflare zone** — nameservers
pointed at Cloudflare. The alternative, Cloudflare's partial (CNAME) setup, is a
Business/Enterprise feature. So `nightingale-nightmare.southvillerunningclub.co.uk`
cannot exist while Fasthosts is authoritative.

That inverts the order: **DNS delegation blocks everything else and must go first.**

The reason this looks alarming and is not: **delegating DNS is not migrating the
website.** Replicate every record exactly as it stands and Squarespace keeps serving,
club email keeps flowing, nothing user-visible changes. "The apex migration" is really
two events that belong months apart:

| | Event | When | Rollback |
| --- | --- | --- | --- |
| **A** | Nameservers Fasthosts → Cloudflare, records copied 1:1 | **First** | Slow — NS change back, 24–48 h |
| **B** | Apex records repointed Squarespace → our Worker | **Last** | Fast — record change, seconds |

The risky event is **A**, and the risk is **email**, not the website. Event B — the one
that feels like the big scary migration — is the cheap, instantly reversible one, because
by then we own the records and their TTLs. Full procedure in
[ADR-0010](adr/0010-dns-delegation-to-cloudflare.md).

*The build isn't blocked by this.* Nightingale Nightmare develops on its `*.workers.dev`
address, which needs no DNS. Only its public launch waits.

### 2. The timing app ports **after** Nightingale Nightmare 2026, not before

Today is 5 August. Nightingale Nightmare is 25 October or 1 November — **11 to 12 weeks
away, and the date is still unconfirmed** ([Q8](open-questions.md)). It also sits on the
clocks-change weekend, which makes it the club's most technically hazardous race.

Porting a production-proven, race-day-critical system in that window means its first real
outing on a new host is the hardest race of the year. That is precisely what
[P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not) exists to prevent,
and what the proposal means by "never migrate near an event".

**Time Nightingale Nightmare 2026 on Vercel, where the app is proven.** Port in the quiet
season — November to March — targeting Pass the Buck 2027 in July, with months of soak.

This is a change of *date*, not of direction. Cloudflare is still the destination.

### 3. The member fund starts now, and gates the apex cutover

The fund is the longest-lead item in the programme: **94 people must each personally
re-subscribe**, because recurring mandates cannot be transferred. It needs no website —
Stripe hosts the payment pages — so it is blocked by nothing technical and can start
today.

It was placed fifth. It should be running in parallel from week one.

It also gates more than expected. The fund currently *lives on the Squarespace site*. Cut
the apex over and its page disappears. So:

> **The fund must be re-homed before the apex cutover, not merely before Squarespace is
> cancelled.**

### 4. Nightingale Nightmare sign-ups trip the data-protection gate

"Sign-ups and hold data" means names, dates of birth, emergency contacts, possibly EA
numbers. That is the personal-entrant data
[P13](principles.md#p13--governance-gates-come-before-the-code-they-enable) gates on
advice, and if it takes money it trips the Stripe gate too.

With 11 weeks to race day, there are two honest routes:

- **Minimal (recommended for 2026):** an information page plus expression of interest —
  name and email only, no DOB, no payment, entries still taken through the existing
  channel. Small data footprint, launchable in weeks, upgradeable later.
- **Full entries:** needs the privacy notice, retention policy, lawful basis and Stripe
  arrangements **in place before the first record**. Advice has to be commissioned this
  week to be realistic.

This is a club decision, not a technical one ([Q22](open-questions.md)).

### 5. "Configuration rather than new software" is optimistic

The [timing app review](reference/timing-app-review.md) found Nightingale Nightmare is
better supported than expected — `events.format` has carried `'solo'` since the first
migration, solo bib resolution works, the results export branches on format. But three
real gaps remain: the **leaderboard's derivation is relay-shaped**, **age-band categories
do not exist** (only pair categories, derived from two runners' genders), and two pieces
of **single-event hardcoding** are logged as open in the app's own decision log.

Budget development time for NN timing. Don't budget zero.

---

## Corrected sequence

Five tracks. A, B and C start together; D and E are the quiet season.

```
2026          Aug        Sep        Oct        Nov        Dec  │ 2027  Jan   Feb   Mar ... Jul
             ────────────────────────────────────────────────  │      ─────────────────────
A  DNS       ██ delegate                                       │
B  NN        ░░ build ░░ ██ launch ░░ RACE (timed on Vercel)    │
C  Fund      ░░░░░░░ Stripe links, migrate 94 payers ░░░░░░░░░  │
D  Website                          ░░░░░ build ░░░░░ ██ apex   │  ██ Squarespace off
E  Timing                                      ░░░░ port ░░░░░  │  ░░░ simulate ░░ ██ cut over → PtB 2027
```

### Track A — DNS delegation · August · blocks everything

1. Cloudflare account under club ownership, more than one administrator.
2. Full zone export from Fasthosts. Audit every record — `MX`, `SPF`, `DKIM`, `DMARC`,
   `TXT`, Squarespace verification.
3. Lower TTLs at Fasthosts to 300 s, at least 48 hours ahead.
4. Import to Cloudflare, **every record DNS-only**. `verify.squarespace.com` must stay
   DNS-only or Squarespace domain verification fails and the live site breaks.
5. Verify against Cloudflare's nameservers before delegating; compare record-for-record.
6. Switch nameservers at Fasthosts. Registrar stays Fasthosts.
7. **72-hour watch. Send and receive club email deliberately.** Silence is not success.

*Done when:* Cloudflare is authoritative, the Squarespace site is unchanged to visitors,
and club email demonstrably still works.

*Do not* run this in the week before a race, or during a membership renewal cycle.

### Track B — Nightingale Nightmare · August–October · race 25 Oct / 1 Nov

**Blocked on [Q8](open-questions.md), the race date.** Settle it first — the clocks change
makes it a technical input, not just a diary entry.

1. Decide the data scope (minimal vs full entries — above).
2. Build the sign-up service as a Worker, developing on `*.workers.dev`.
3. Reuse the existing event model: an entry is a `teams` row with one `runners` row,
   `events.format = 'solo'` ([ADR-0012](adr/0012-one-supabase-project-many-services.md)).
   Compute `age_on_day` at the parser boundary; do not persist DOB without advice.
4. After Track A: attach `nightingale-nightmare.southvillerunningclub.co.uk`
   ([ADR-0011](adr/0011-nightingale-nightmare-routing.md)). Link it from the Squarespace
   site; QR code for print.
5. **Time the race on Vercel**, on the existing timing app. Close the three solo gaps
   (leaderboard derivation, age bands, hardcoded location and evening-start copy) in that
   repository, ahead of race day, with a race-simulation pass against **the real race
   date** so the clocks change is exercised.

*Done when:* entrants have signed up on our own domain and the race has been timed and
published.

### Track C — Member fund · start now · gates the apex cutover

Independent of all Cloudflare work. Longest lead time. Governance-gated.

1. **This week, free:** switch on Squarespace's "cover the fees" option — 0% of payments
   use it today.
2. **This week:** establish who owns the payment account connected under Squarespace and
   put it under treasurer oversight ([Q14](open-questions.md)).
3. Establish whether the connected processor is a club Stripe account or Squarespace's
   own — it decides whether saved cards survive ([Q13](open-questions.md)).
4. Club Stripe account under treasurer oversight; refund policy and terms.
5. Create the £2.50 monthly and £30 annual prices as Stripe Payment Links. The annual
   option is what actually cuts the fee rate — 2.2% against 9.5%.
6. Run old and new in parallel. Comms push. **Chase all 94 by name.**
7. Treasurer confirms income has fully moved.

*Done when:* the treasurer confirms it. That confirmation unblocks Track D's cutover.

### Track D — Website rebuild · November 2026 – February 2027

1. Content inventory and complete URL map of the current site ([Q5](open-questions.md)).
2. Ask the committee what they actually need to edit and how often
   ([Q6](open-questions.md)) — that answer shapes what is database-driven.
3. Build on Cloudflare Workers. Deploy to `beta.southvillerunningclub.co.uk`, **noindex**.
4. Race pages and the permanent results archive read from the shared Supabase project,
   read-only ([ADR-0012](adr/0012-one-supabase-project-many-services.md)). Nightingale
   Nightmare 2026's results appear here automatically.
5. Redirects from every existing Squarespace URL, verified against the inventory.
6. Accessibility and performance sign-off.
7. **Apex cutover** — repoint apex and `www` from Squarespace to the site Worker.
   Gated on: Track C confirmed, redirects verified, outside any race window. Rollback is
   a record change, seconds.
8. Watch a week. Then cancel Squarespace ahead of its renewal.

### Track E — Timing app port · November 2026 – March 2027

1. **First, and independent of the port: transfer the repository from the personal
   account to `admin-src`.** The proposal's own key-person mitigation says club code
   lives in the club's reach; today this repository does not
   ([R1](risks.md#r1--key-person-dependency)).
2. Port with `@opennextjs/cloudflare`. Next.js 16 is supported; the app is on 16.2.4, so
   no downgrade. Watch the **3 MB compressed bundle** ceiling and the **10 ms CPU** limit
   on the free plan — budget Workers Paid (~£48/yr).
3. Deploy to a Cloudflare hostname **in parallel**. Vercel stays live throughout.
4. Full manual race simulation on Cloudflare: multiple marshal devices, deliberate
   connectivity loss and recovery, anomaly resolution, walk-in bibs, concurrent
   leaderboard load, and a run against a real race date. Including the **true
   two-marshal end-to-end check** the app's own log records as still outstanding.
5. Cut over. Keep Vercel deployable as rollback until a race has run on Cloudflare.
6. **Target: proven by March 2027**, four months before Pass the Buck 2027.

Three things a port must not break: the IndexedDB offline queue and its idempotent-upsert
contract; the TypeScript/SQL lockstep on bib resolution; and the `Europe/London` pinning
in `lib/london-time.ts`.

---

## Running old and new side by side

Once the zone is delegated, every service gets its own hostname and the apex is left
alone until last. This is what makes the whole programme incremental.

| Hostname | Serves | From |
| --- | --- | --- |
| `southvillerunningclub.co.uk` + `www` | Squarespace, unchanged | today |
| `nightingale-nightmare.` | NN Worker | Track A complete |
| `beta.` *(noindex)* | Rebuilt site Worker | Track D build |
| `timing.` | Timing Worker, parallel to Vercel | Track E |
| `southvillerunningclub.co.uk` + `www` | **Site Worker** | **Track D cutover** |

Every step is one DNS record. Every rollback is one DNS record. No step requires the
previous surface to be switched off first.

---

## Dependencies

```
A. DNS delegation ──┬─→ B4. NN public launch
                    ├─→ D7. Apex cutover
                    └─→ E5. Timing cut over

Q8 (race date) ─────→ B. everything in Nightingale Nightmare
Q22 (data scope) ───→ B2. what the sign-up form collects

C7. Fund income confirmed ──→ D7. Apex cutover ──→ D8. Squarespace off

E1. Repo transfer ──→ E2. Port
```

**The critical path to switching Squarespace off runs through the member fund, not
through any code.** 94 people re-subscribing one at a time is the slowest thing in this
plan, and it starts today.

---

## Priorities, in order

1. **Settle the Nightingale Nightmare date** ([Q8](open-questions.md)). Free, blocks a
   whole track, and the clocks change makes it technical.
2. **Switch on "cover the fees"** and **establish payment-account ownership**. Free, this
   week, pure governance.
3. **Delegate DNS.** Blocks everything Cloudflare.
4. **Start the fund migration.** Longest lead, gates the endgame.
5. **Transfer the timing repository to the club organisation.** One administrative
   action; materially reduces the club's largest risk.
6. **Decide the Nightingale Nightmare data scope** ([Q22](open-questions.md)) — it
   decides whether advice is needed in weeks or months.
7. Build Nightingale Nightmare.
8. Rebuild the website.
9. Port the timing app.

Items 1, 2, 5 and 6 cost nothing and need no code. Three of the four are decisions, not
work.

---

## What this plan deliberately does not do

- **Does not port the timing app before Nightingale Nightmare 2026.** The race is 11
  weeks away and sits on the clocks change.
- **Does not touch the apex until the rebuilt site is proven** and the fund has moved.
- **Does not take payments** on any surface before
  [P13](principles.md#p13--governance-gates-come-before-the-code-they-enable)'s gates are
  satisfied.
- **Does not proxy the live Squarespace site through Cloudflare** to add a path route —
  see [ADR-0011](adr/0011-nightingale-nightmare-routing.md).
- **Does not cancel Squarespace** until the treasurer confirms the income moved and the
  new site has run for a week.
