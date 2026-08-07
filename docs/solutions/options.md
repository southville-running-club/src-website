# Options

The solution space for each capability, and how to judge between them.

Nothing here is decided. Named products appear as **examples of a category**, not as
recommendations — the categories are the useful part, because they survive a vendor
changing its pricing.

Read [requirements](../foundations/requirements.md) first; this is meaningless without
them.

**Named candidates are now priced in [platform options](platform-options.md)**, which
answers questions 2, 3 and 4 at the foot of this page against real products and real
figures. The domain and DNS question has its own document: [DNS and
domain](dns-and-domain.md).

---

## How to judge

Seven criteria. The first three eliminate; the rest discriminate.

| | Criterion | Why it matters here |
| --- | --- | --- |
| **1** | **Cost at club scale** | Tens of pounds a year. A three-figure recurring line must displace more than it costs |
| **2** | **Terms permit the use** | Free tiers are load-bearing, so commercial-use clauses, inactivity rules and retention limits are architectural facts |
| **3** | **Maintainable by one volunteer** | Mainstream, documented, widely known. A second volunteer must pick it up cold |
| **4** | **Exit cost** | If this doubles in price or disappears, what does leaving cost and is the data portable? |
| **5** | **Fit with what exists** | Divergence from the proven timing platform costs volunteer time and re-opens tested code |
| **6** | **Operational burden** | Backups, patching, uptime, monitoring — all of it lands on the same one person |
| **7** | **Data residency and protection** | UK/EU preference; personal data across several capabilities |

**Criterion 4 deserves more weight than it usually gets.** A small club depending on free
tiers is exposed to terms changing under it. The defence is not picking the perfect vendor
— it is making sure no choice is expensive to unwind.

---

## A structural observation before the options

The capabilities do not map one-to-one onto products.

The current timing platform gets **five capabilities from a single vendor**: relational
storage (C2), live push (C6), authentication (C7), file storage (C9), and the
access-control tooling that C10 relies on.

That bundling is why it is cheap and why it works well. It is also the largest single
point of exit cost in the whole system. The genuine architectural question is not "which
database" — it is:

> **Do we want one vendor providing five capabilities, or five things we assemble?**

| | Bundled | Assembled |
| --- | --- | --- |
| Cost | Lower — one free tier | Higher — several, or self-hosted |
| Setup | Faster | Slower |
| Exit cost | **High** — five things to replace at once | Lower — replace one at a time |
| Operational burden | Lower | Higher |
| One-volunteer fit | Better | Worse |

For a club with one volunteer, bundling is probably right. But it should be a decision
with its exit cost written down, not a default.

**Portability, capability by capability:**

| Capability | How portable is it, really |
| --- | --- |
| Relational data | **Very.** Standard database dump. Data is not the lock-in |
| Access-control rules | **Very**, if expressed in the database itself rather than in vendor tooling |
| File storage | **High.** Object storage is close to a commodity |
| Authentication | **Medium.** Identities and sessions must be migrated; users may have to re-authenticate |
| Live push | **Low.** Protocols are vendor-specific. This is the stickiest thing in the stack |

---

## C1/C2 — Serving pages and results

**What must be true:** serves club-controlled hostnames; terms permit commercial use once
the club takes money; deploys from version control automatically; cheap at club traffic;
static or cached where possible for phones on poor signal.

| Category | Shape | Trade-off |
| --- | --- | --- |
| **Managed application platform** | Push to git, platform builds and serves. *e.g. Vercel, Netlify, Render, Railway* | Least operational burden. Free tiers often restrict commercial use — check first |
| **Edge/serverless platform** | Code runs at edge locations. *e.g. Cloudflare Workers, Deno Deploy* | Very cheap, generous free terms. Runtime limits (CPU, bundle size) become design constraints; framework support may go through an adapter |
| **Container host** | A container, running. *e.g. Fly.io, Railway, Cloud Run* | Fewer runtime surprises, more predictable. Usually a small fixed monthly cost |
| **Plain server** | A VPS the club administers | Cheapest at scale, total control. **Operational burden lands on one volunteer** — patching, TLS, backups, uptime. Fails criterion 3 unless someone genuinely wants it |
| **Static hosting + functions** | Pre-rendered pages plus a few dynamic endpoints. *e.g. GitHub Pages, S3+CDN, any of the above* | Excellent fit for a mostly-static club site; a permanent archive is mostly static by nature. Dynamic bits need somewhere to run |
| **Stay managed-CMS** | Squarespace or similar | Zero build effort, preserves visual editing. Cannot reach the results database — fails C2 outright, which is the point of the exercise |

*The eliminating question:* **does the free or cheap tier permit taking payments?** This
is what disqualifies the incumbent arrangement and it should be checked in writing for any
candidate, not assumed.

## C2 — Storing the archive

**What must be true:** relational; durable; does not sleep; restorable backups; supports
per-role read/write rules; UK/EU region available.

| Category | Shape | Trade-off |
| --- | --- | --- |
| **Backend-as-a-service** | Database bundled with auth, live push, storage. *e.g. Supabase, Firebase, Appwrite, Nhost* | Meets five capabilities at once, cheapest, fastest. **Highest exit cost** |
| **Managed database only** | Just the database, well run. *e.g. Neon, managed RDS/Cloud SQL, PlanetScale* | Low exit cost, mature. C6, C7 and C9 must then come from somewhere else |
| **Database bundled with the host** | Whatever the application platform offers | One vendor, one bill. Couples the data's fate to the hosting decision — worst of both if either changes |
| **Self-hosted** | The club runs the database | Total control, lowest licence cost. Backups, upgrades and availability become one volunteer's problem |

*Watch for:* **inactivity behaviour.** A permanent archive that sleeps after a quiet week
is not a permanent archive. And **backups** — "we take backups" is not the same as "we
have restored from one".

## C6 — Live push to browsers

The least substitutable capability. Worth its own section because it is what makes the
leaderboard a leaderboard.

| Category | Trade-off |
| --- | --- |
| **Bundled with the data platform** | Zero integration, changes stream straight from the database. Vendor-specific protocol — the stickiest dependency in the stack |
| **Server-sent events from the application** | Standard, portable, one-directional — which is all a leaderboard needs. Needs a host that supports long-lived connections; some serverless platforms do not |
| **Dedicated realtime service** | Purpose-built, scales well. Another vendor, another bill, another thing to learn |
| **Polling** | Boringly simple, works everywhere, no dependency at all. Wasteful, and "within a second" costs a lot of requests |

*Worth stating:* at roughly 100 teams and a few hundred spectators, **polling every few
seconds would work.** It is inelegant and would meet the requirement. That is a useful
reference point, because it means C6 cannot hold the whole architecture hostage.

## C7 — Authentication

Single-figure user count, gating race-critical surfaces.

| Category | Trade-off |
| --- | --- |
| **Bundled with the data platform** | Free, integrated, already working | 
| **Dedicated identity provider** *(e.g. Auth0, Clerk, WorkOS)* | Feature-rich, well documented. Free tiers usually generous at this size; another vendor |
| **Framework-native** *(e.g. Auth.js)* | Portable, self-contained, no vendor. More to build and to get right |
| **Delegated sign-in** *(Google, etc.)* | No credentials to manage at all. Assumes every marshal has an account with the provider |

*The real requirement is narrow:* a handful of people, no passwords to distribute, roles
distinguishable, and **no possibility of a lockout on race morning**.

## C4 — Payments

Two different problems; they may have different answers.

**Recurring membership** — 94 mandates, £2.50 each, none transferable.

| Option | Fee per payment | Per year | Notes |
| --- | --- | --- | --- |
| Current arrangement | ~30–40p (~12–16%) | ~£340–£450 | Club absorbs all of it |
| Card, monthly | ~24p (9.5%) | ~£268 | Fixed per-transaction fee dominates |
| Card, annual | 65p/yr (2.2%) | ~£61 | **The pricing change matters more than the processor** |
| Direct debit | ~1% + fixed, capped | Comparable to card | Mandates outlive cards — no expiry churn |
| Standing order to the club account | **£0** | **£0** | No reconciliation, no central control, members set it up themselves |

*The finding worth carrying:* **moving processor holds the line; moving to annual billing
is what actually cuts the cost.** Any option should be judged on both.

**One-off entries** — from non-members, at the moment of entry, priced by registration
status.

| Category | Trade-off |
| --- | --- |
| **Hosted payment link** | No code, no card data, works today. Manual reconciliation; sits outside the entry flow |
| **Hosted checkout, integrated** | Entry and payment are one flow, confirmed by webhook. Real build; card data still never touches us |
| **Full programmatic integration** | Best experience, complete control over pricing logic. Most build, most governance, most to get wrong |
| **Third-party entry platform** | The current arrangement. Zero build; the club does not own the data, and fees run 8–10% |

*Constraint on all of them:* card data must never touch club systems, and none of this
begins before the governance gates are satisfied.

## C5 — Timing capture

**This exists and works.** The requirement is not to regress it.

Any option that touches it inherits three properties that were learned the hard way: the
offline queue with idempotent retry, exact-string bib resolution kept in step between
application and database, and timezone pinning through a single tested path.

The realistic options are *keep it where it is*, *move it and re-prove it with a full race
simulation*, or *rewrite it* — which is not a serious option and is listed only so it is
visibly rejected.

## C5/C1 — DNS

**What must be true:** points club hostnames at whatever serves them; carries the existing
mail records without loss; changes are reasonably fast to make and to reverse.

| Category | Trade-off |
| --- | --- |
| **Registrar's own DNS** | Where it is today. One account, no migration, no risk. May not support what a chosen host requires |
| **Dedicated DNS provider** | Fast propagation, good tooling, often free. A migration that carries club email with it |
| **Host-integrated DNS** | Some hosts require their DNS to serve their hostnames. Convenient and coupling — the hosting decision becomes the DNS decision |

*The trap to check before choosing a host:* **some platforms can only serve a hostname if
they are also authoritative for the domain.** That turns "where do we host" into "who runs
our email DNS", which is a much larger question. Establish it per candidate before
committing.

*Two properties of any DNS change:* moving nameservers is invisible if records are copied
exactly, and slow to reverse. Changing a record once the provider is settled is fast to do
and fast to reverse. **The first is riskier than the second**, which is the opposite of
how it usually feels.

## C8 — Email

| Category | Trade-off |
| --- | --- |
| **Transactional email service** *(e.g. Resend, Postmark, SES, Mailgun)* | Built for deliverability, free tiers cover club volume. Needs DNS records; another vendor |
| **Existing mail provider's SMTP** | Already paid for, already authenticated. Not built for application mail; rate limits bite |
| **Bundled with the data or hosting platform** | Nothing extra to set up. Often poor deliverability defaults |

*Low stakes and easily swapped* — one of the cheapest capabilities to change later, so it
should not influence larger decisions.

**Priced against named providers in [email](email.md)**, which also separates this from
the distinct problem of the club's *human* mailboxes — today forwarded into personal Gmail
accounts, which is why replies do not come from the club.

## C9 — File storage

Object storage is close to a commodity, with near-identical interfaces. **Genuinely low
exit cost** whichever is chosen. Options: bundled with the data platform, bundled with the
host, or a dedicated object store.

## C11 — England Athletics verification

| Option | Trade-off |
| --- | --- |
| **Official interface** | Always current, authoritative. Depends on an external body's agreement and lead time, which the club does not control |
| **Periodic export from the club's member list** | Works from day one with no dependency. Goes stale between refreshes; only covers club members |
| **Manual check** | No build at all. Does not scale past a small field and cannot price an entry live |

*Sequencing note:* the official interface has a lead time belonging to somebody else, so
applying early costs nothing. The export fallback means nothing is blocked while waiting.

---

## Questions to answer before any of this is decided

Questions 2, 3 and 4 are answered against named candidates in [platform
options](platform-options.md); question 7 belongs to [DNS and domain](dns-and-domain.md).

1. **What is the actual Squarespace renewal date**, and does "off by April" mean cancelled
   before renewal or simply not renewed?
2. **For each hosting candidate: do the terms permit taking payments** on the tier the
   club would use? —
   *[answered](platform-options.md#1-does-the-free-or-cheap-tier-permit-taking-payments);
   the incumbent's free tier does not*
3. **For each hosting candidate: can it serve a club hostname without controlling the
   domain's DNS?** —
   *[answered](platform-options.md#2-can-it-serve-a-club-hostname-without-controlling-the-domains-dns);
   a subdomain, yes on every candidate; the apex, not on Cloudflare*
4. **Does the club want capabilities bundled or assembled?** — the largest architectural
   question here. *[A two-vendor split is
   proposed](platform-options.md#option-c--cloudflare-for-serving-supabase-for-data-recommended):
   serving separate from data*
5. **What does the treasurer need for reconciliation?** It constrains C4 more than fees
   do.
6. **Who holds every account**, and can more than one person reach each?
7. **What does the `mcp` DNS record serve?**
8. **What is the Nightingale Nightmare 2026 date?**
