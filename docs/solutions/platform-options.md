# Platform options — named candidates, costed

[Options](options.md) sets out the solution space by category and deliberately names no
candidates. This document does the next step: **named products, real prices, and an honest
assessment of what each one would take to action.**

It answers the three questions
[options](options.md#questions-to-answer-before-any-of-this-is-decided) left open —
commercial-use terms, whether a candidate needs control of the domain's DNS, and bundled
versus assembled — because nothing can be built until they are answered.

**This is analysis, not a decision.** The [decision log](../decisions/decision-log.md)
stays empty until the committee chooses. Read
[requirements](../foundations/requirements.md) first; the criteria used here are the seven
in [options](options.md#how-to-judge).

Companion documents: [DNS and domain](dns-and-domain.md) for the Fasthosts question, and
[Nightingale Nightmare first](../delivery/nn-first-delivery.md) for what gets built first.

**Prices captured August 2026.** Dollar figures converted at **$1 = £0.79**. Where a
figure is inferred rather than read off a vendor's own page it says so, and everything
load-bearing is listed again under [verify before deciding](#verify-before-deciding).

---

## The two questions that eliminate

Before comparing anything on features or elegance, two questions remove candidates
outright.

### 1. Does the free or cheap tier permit taking payments?

The club takes money. This is not a detail — it is the reason the club is on Squarespace's
middle tier in the first place.

| Candidate | Free tier permits commercial use? | Consequence |
| --- | --- | --- |
| **Vercel** | **No.** Hobby is restricted to non-commercial personal use; Vercel's fair-use guidance names *processing payment* and *asking for donations* as commercial | Payments force **Pro at $20/user/month** |
| **Cloudflare** | **Yes.** Workers Free and Pages carry no non-commercial restriction | Free tier is a legitimate permanent home |
| **Netlify** | **Yes.** Netlify states commercial projects may be deployed on the free plan | Free tier is legitimate; see the credit cap below |
| **GitHub Pages** | **No.** Pages terms exclude running an online business or e-commerce site | Disqualified for anything that takes money |
| **AWS / VPS** | **Yes** — it is rented infrastructure, not a hosted tier | No restriction |
| **Render / Railway / Fly.io** | **Yes** — paid from the start, or trivially small free allowances | No restriction |

> **This single line is the most consequential finding in this document.** The club's
> existing pattern — Vercel Hobby — is the one that does not survive contact with the
> club's own requirements. It is fine for the timing platform, which takes no money. It is
> not fine for a website with a £2.50 subscription and race entries on it.

### 2. Can it serve a club hostname without controlling the domain's DNS?

This is the trap
[priorities](../delivery/priorities.md#the-two-week-deadline-is-not-as-tight-as-it-looks)
warned about, and the answer differs *within* a single vendor.

| Candidate | Subdomain (`nn.…`) from external DNS | Apex (`southvillerunningclub.co.uk`) from external DNS |
| --- | --- | --- |
| **Vercel** | Yes — CNAME | Yes — A record at Vercel's address |
| **Netlify** | Yes — CNAME | Yes — A record at Netlify's load balancer |
| **Cloudflare Pages** | **Yes** — CNAME, after associating the domain in the dashboard | **No** — apex requires Cloudflare nameservers |
| **Cloudflare Workers custom domains** | **No** — requires an active Cloudflare zone | **No** |
| **AWS / VPS / container hosts** | Yes — A or CNAME | Yes — A record |

Two things follow, and they matter more than they look.

**Nightingale Nightmare is unblocked on every candidate.** A subdomain needs one additive
CNAME at Fasthosts. Nothing existing is touched, club email cannot break, and deleting the
record restores exactly today's behaviour. The two-week deadline never required a DNS
migration.

**Cloudflare at the apex does require the nameservers to move.** That is a real cost, it
is specific to Cloudflare, and it is analysed properly in [DNS and
domain](dns-and-domain.md). It does not have to happen before Nightingale Nightmare, and
it should not.

Note the split inside Cloudflare: **Pages** accepts a subdomain from third-party DNS,
**Workers custom domains** do not. Anything built for the NN deadline must therefore be a
Pages project while the zone stays at Fasthosts.

---

## Language and framework

**TypeScript, and the case for it is not preference.**

The club's one proven asset is a Next.js 16 / TypeScript race-timing application with
row-level security, an offline capture queue and a tested timezone path.
[Convergence](../foundations/requirements.md#convergence) is a stated requirement: the
website, Nightingale Nightmare and the timing platform end up as one platform. A second
language means a second set of types for the same entities, a second build pipeline, and a
second thing a third volunteer has to learn.

Alternatives, considered and rejected in writing so they are visibly rejected rather than
overlooked:

| | Why it was considered | Why not |
| --- | --- | --- |
| **Go** | Single binary, trivial to self-host, fast | Nothing in the club's stack is Go; loses type sharing with the timing app; smaller pool of people who could pick it up |
| **Python (Django)** | Batteries-included admin would answer committee editing almost for free | Divergent runtime; the Django admin is a strong pull, but it buys one capability at the cost of every other |
| **PHP (Laravel / WordPress)** | Cheapest possible hosting; WordPress solves committee editing outright | Reintroduces exactly what the club is leaving — a database-backed CMS edited by clicking, with a patching burden and no meaningful convergence |
| **Rust / Elixir** | Genuinely good at the realtime part | Fails ["boring" as a hard requirement](../foundations/requirements.md#people) |

### Framework, which is a separate question from language

| | Fit | Trade-off |
| --- | --- | --- |
| **Next.js 16** *(incumbent)* | Already known, already proven, shared types with the timing app | Best on Vercel. Elsewhere it runs through an adapter — `@opennextjs/cloudflare` on Cloudflare, an official plugin on Netlify. Workable, but it is the framework most coupled to the host the club cannot afford |
| **Astro** | Excellent for a content-heavy site: markdown content collections, islands for the interactive parts, first-class adapters for Cloudflare, Netlify and Node | A second framework in the club's world. Mitigated by the fact that the website and the timing app have genuinely different shapes |
| **SvelteKit** | Small, fast, adapter-per-host by design | Third framework family; nobody in the club uses it today |
| **Remix / React Router** | React, runs well on Workers | No advantage over Astro here, and less suited to a mostly-static site |
| **Hono** | Tiny, ideal on Workers | An API framework, not a site framework. Useful *inside* another choice |

**The honest position:** for a site that is 60 pages of content, a document archive and a
results archive — all of which are static by nature — Astro is a better fit than Next.js,
and its markdown content collections are a direct, cheap answer to the ["what lives in
code and what lives in a
database"](../foundations/target-state.md#open-questions-this-raises) question. Policies,
page structure and the pace guide become files in the repository, reviewed by pull
request. Results, newsletters and entries stay in the database.

Using Astro for the website and leaving the timing app on Next.js is a deliberate split
along a real seam, not divergence for its own sake. Both are TypeScript, both share the
same database and the same generated types.

---

## The candidates

Six shapes. Each states what it is, what it costs, what it takes to action, and what
leaving costs.

---

### Option A — Vercel + Supabase (extend the incumbent pattern)

The timing platform already runs this way. The obvious move is to do the website the same
way.

**It is the most expensive option in this document, by a factor of ten.**

| Line | Cost |
| --- | --- |
| Vercel Pro — required the moment the site takes payments, **$20 per member per month** | $40/mo for two members → **£379/yr** |
| Supabase Pro — $25/mo, required to guarantee the archive never pauses | $25/mo → **£237/yr** |
| Domain and DNS at Fasthosts | **£15.40/yr** |
| **Total** | **~£631/yr** |

That is **three times what Squarespace costs today**, to save volunteer time the club
could also save on a £47/yr platform. It fails the [money
constraint](../foundations/requirements.md#money) outright.

**Could the club stay free?** Only by breaking one of its own requirements:

- *One Vercel seat instead of two* — £190/yr, and it recreates a system reachable by one
  person.
- *Vercel Hobby with payments live* — a terms violation, and the failure mode is the
  club's website being suspended rather than a bill.
- *Supabase Free* — 500 MB, two active projects, and **projects pause after a week of
  inactivity**. A live public site generates requests, so pausing is unlikely in practice;
  but "unlikely to pause" is not the same as
  [permanent](../foundations/requirements.md#continuity), and the two-project ceiling is
  already half-used by the timing platform.

**How it gets actioned:** fastest of any option. Both volunteers know it, deployment is a
git push, and the timing app's patterns transfer directly. First week: repository, Next.js
scaffold, CNAME at Fasthosts, deployed. Nothing to learn.

**Exit cost:** low on the hosting side — a Next.js app moves to Netlify or a container
with an adapter change. High on the data side if Supabase Realtime and Auth are used,
which is the [bundling trade-off](options.md#a-structural-observation-before-the-options)
already identified.

**Verdict:** *keep it for the timing platform, where the free tier is legitimate because
no money changes hands.* Do not put the website on it.

---

### Option B — Cloudflare, bundled (Pages/Workers + D1 + R2 + Access)

One vendor for serving, data, files and staff authentication.

| Line | Cost |
| --- | --- |
| Workers Free — 100,000 requests/day, D1 5 GB, R2 10 GB, KV, Durable Objects | **£0** |
| Workers Paid, if ever needed — $5/mo minimum, covers Workers, Pages Functions, KV, D1, Durable Objects | **£47/yr** |
| Cloudflare DNS | **£0** |
| Domain, if transferred to Cloudflare Registrar (at cost) | **under £10/yr** — see [DNS and domain](dns-and-domain.md) |
| **Total** | **£0–£57/yr** |

At roughly 1,900 pageviews a month the club is nowhere near 100,000 requests a day for 364
days of the year, and unlike Vercel's the free tier permits taking payments. **But race
night alone exceeds it** — see [why Cloudflare is free, and when it stops
being](#why-cloudflare-is-free-and-when-it-stops-being). **£47/yr is the figure to plan
on**, not £0.

R2 deserves a specific mention: 10 GB free with **no egress charge**, which is the right
home for the 45 club documents and the images being [rescued from Squarespace's
CDN](../foundations/requirements.md#c14--publish-newsletters-and-club-documents) before
the subscription lapses. Cloudflare's old restriction on serving non-HTML content on free
plans no longer applies to content hosted on its own services.

Cloudflare Access covers
[C7](../foundations/requirements.md#c7--authenticate-and-authorise-staff) free to 50 users
— the club needs single figures.

**What it costs the club that the table does not show:**

- **D1 is SQLite, not Postgres.** The timing platform is Postgres with row-level security
  from its first migration. Choosing D1 means the convergence in
  [requirements](../foundations/requirements.md#convergence) eventually requires rewriting
  the timing app's data layer — re-opening race-tested code, which is precisely what the
  [risk constraint](../foundations/requirements.md#risk) says not to do.
- **Durable Objects are the stickiest dependency in the stack** and would become the
  answer to
  [C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators).
- **Next.js needs an adapter.** Astro does not.

**How it gets actioned:** first week is Cloudflare account (club-owned, both volunteers as
admins), Pages project from the repository, one CNAME at Fasthosts, deployed. D1 schema by
migration file. Wrangler configuration is committed, so infrastructure-as-code is met
natively. Nameservers do not move until the apex does.

**Exit cost:** **the highest of any option.** D1's SQLite dialect, Durable Objects, KV and
the Workers runtime are four vendor-specific things at once, and only R2 is genuinely
commodity.

**Verdict:** *the cheapest option and the one with the worst exit cost.* Recommended only
if the club consciously accepts pinning itself to Cloudflare.

---

### Option C — Cloudflare for serving, Supabase for data *(recommended)*

Split on a clean seam: Cloudflare serves, Supabase holds the data. Two vendors, not five
things assembled.

| Line | Cost |
| --- | --- |
| Cloudflare Workers Paid — **race night needs it**, free covers the rest of the year | **£47/yr** |
| Supabase Free — 500 MB, `eu-west-2` London, already in use | **£0** |
| R2 for documents and images | **£0** within 10 GB, then £0.014/GB/month |
| DNS at Cloudflare | **£0** |
| **Total, planning figure** | **£47/yr** |
| Supabase Pro, **if the live leaderboard is served from Supabase Realtime** | +£237/yr → **£284** |

**Why this is the recommendation:**

1. **It is the only shape where the cheap tier permits taking payments and the data stays
   Postgres.** Vercel fails the first; Cloudflare-bundled fails the second.
2. **Convergence costs nothing.** The timing platform's database, row-level security,
   Realtime and Auth stay exactly where they are, in London, and the website reads from
   the same place. The results archive stops being a transcription job by *reading the
   table that already exists*.
3. **The cost floor survives the payments switch-on.** Every other option's price changes
   the day Stripe goes live. This one does not.
4. **Nightingale Nightmare ships on one additive CNAME**, with no decision foreclosed.
5. **The split is on a real seam.** Serving is close to a commodity and cheap to leave.
   Data is sticky, so it stays with the vendor the club is already proven on.

**Costs knowingly accepted:**

- **Two vendors, two accounts, two sets of credentials** to put a second person on.
- **Supabase Free's ceilings are real** — 500 MB, two projects, pause-on-inactivity. The
  mitigation is to run website and timing data in *one* project, which convergence wants
  anyway. The trigger to move to Pro should be written into the decision record, not
  discovered.
- **Next.js on Cloudflare goes through an adapter.** Choosing Astro for the website
  removes this entirely; keeping Next.js means living with OpenNext.
- **The apex still needs Cloudflare nameservers.** See [DNS and
  domain](dns-and-domain.md).

**How it gets actioned:**

| Week | |
| --- | --- |
| 1 | Club-owned Cloudflare account, both volunteers as admins. Pages project. Astro scaffold. One CNAME at Fasthosts. `nn.southvillerunningclub.co.uk` live |
| 2 | Sign-up form writing to a Supabase table. Second volunteer added to Supabase. Timing repository moved into the club organisation |
| 3–6 | Website content migrated; documents and images pulled off Squarespace's CDN into R2 **while the subscription is still live** |
| Ahead of April | Zone pre-staged in Cloudflare, diffed record by record, nameservers moved, apex cut over |

**Exit cost:** *low on serving* — an Astro site with a Cloudflare adapter becomes an Astro
site with a Netlify or Node adapter in an afternoon; R2 is S3-compatible. *Medium-to-high
on data* — the [Supabase bundling
trade-off](options.md#a-structural-observation-before-the-options) is inherited unchanged,
but it is inherited rather than newly incurred, and the club is already exposed to it
through the timing platform.

---

### Option D — Netlify + Supabase

Identical in shape to Option C, with one significant advantage and one significant flaw.

| Line | Cost |
| --- | --- |
| Netlify Free — commercial use permitted | **£0** |
| Netlify Personal, if the free credit pool is too tight | $9/mo → **£85/yr** |
| Netlify Pro, if two seats are needed | $20/seat/mo → £379/yr |
| Supabase Free | **£0** |
| Domain and DNS at Fasthosts, unchanged | **£15.40/yr** |
| **Total** | **£15–£100/yr** |

**The advantage: the nameservers never have to move.** Netlify serves an apex from a
third-party DNS provider via a plain A record. The whole [DNS
migration](dns-and-domain.md) — with its email risk and its slow rollback — simply does
not arise. For a club whose stated position is that moving away from Fasthosts is *not
ideal*, that is worth real money.

**The flaw: the free plan stops serving traffic when the credit pool runs out.** Netlify's
free tier moved to a shared 300-credit monthly pool (bandwidth at 20 credits/GB,
production deploys 15 credits each), with no auto-recharge. A club site would sit well
inside it in a normal month — but ["permanent" is a hard
requirement](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically),
and a results archive that goes dark because a busy race week plus a run of deploys
exhausted a credit pool fails it. The mitigation is Personal at £85/yr, which is still
comfortably inside the money constraint.

**How it gets actioned:** effectively identical to Option C, minus the DNS project.
Netlify's build-from-git model and adapter story are mature and boring in the good sense.

**Exit cost:** **the lowest of any managed option.** Netlify holds nothing but a build
configuration and a deployment. Everything of value is in Supabase and the repository.

**Verdict:** *the strongest alternative, and the right answer if the club decides against
moving the nameservers.* It trades roughly £85/yr for the entire DNS migration risk. That
is a defensible trade.

---

### Option E — Self-hosted on AWS

Genuine control, UK region, and the operational burden that comes with it.

The shape matters enormously here, because "AWS" spans two orders of magnitude:

| Shape | Cost | Assessment |
| --- | --- | --- |
| **Lightsail VPS** — one 2 GB instance, Postgres and the app on it, `eu-west-2` | $5–7/mo + ~$1 snapshots → **£57–£75/yr** | The only affordable AWS shape |
| **S3 + CloudFront static** | Pennies a month | Fine for pages; the dynamic parts need somewhere else |
| **Amplify Hosting** | Build minutes + GB served; small at club scale | Managed, but the free allowance is time-limited and it is Vercel-shaped pricing without Vercel's ergonomics |
| **Lambda + API Gateway + RDS** | `db.t4g.micro` alone is ~$13/mo → **£123/yr** before anything else | Over budget for the database alone |
| **Aurora Serverless v2** | 0.5 ACU minimum ≈ $43/mo → **£408/yr** | Enterprise-shaped. Disqualified |

So the honest AWS answer is **a £60–£75/yr Lightsail box** — competitive on price, and
then the bill arrives in a currency that is not money.

**What lands on one volunteer:** operating-system patching, TLS renewal, Postgres
upgrades, backup *and a tested restore*, monitoring, disk-full incidents, and being the
person who fixes it on a Sunday. [Requirements](../foundations/requirements.md#people)
makes "a third person can pick this up cold" a hard requirement, and a hand-built box is
the hardest thing in this document to hand over.

**Where it genuinely wins:** total control, `eu-west-2` London for [data
residency](../foundations/requirements.md#c10--hold-personal-data-lawfully), no free-tier
terms to be changed underneath the club, and no vendor able to suspend the site. If the
club's overriding concern were sovereignty rather than volunteer time, this would be the
answer.

**How it gets actioned:** the slowest start of any option — instance, firewall, reverse
proxy, certificates, Postgres, backup job, restore test, deploy pipeline, monitoring.
Realistically a month of evenings before the first page is served in a state anyone should
trust. Terraform or OpenTofu would make it code, which the club requires, and adds its own
learning curve.

**Exit cost:** **the lowest of all** — it is a Linux box running Postgres and a Node
process. Nothing is proprietary.

**Verdict:** *rejected on criterion 3 and criterion 6, not on price.* It fails
["maintainable by one volunteer"](options.md#how-to-judge) and it fails it on the axis the
club can least afford — the same volunteer time the whole programme is meant to recover.
Worth revisiting only if a volunteer genuinely wants to run infrastructure.

---

### Option F — Plain VPS elsewhere (Hetzner, Mythic Beasts, DigitalOcean)

The same trade as Option E, cheaper, with a data-residency wrinkle.

| Provider | Cost | Note |
| --- | --- | --- |
| **Hetzner CX22** | ~€3.79/mo → **£39/yr** | No UK region — Germany or Finland. EU, not UK |
| **Mythic Beasts** | ~£5–10/mo → **£60–£120/yr** | **UK-based, UK-hosted**, well regarded, small and stable |
| **DigitalOcean** | $6/mo → **£57/yr** | London region available |

Adding Dokku or Coolify gives a git-push deploy experience on top, which recovers some of
the ergonomics. It is still a box somebody has to run.

**Verdict:** *same rejection as Option E, for the same reason.* Mythic Beasts is worth
remembering as the option that would satisfy a strict UK-hosting position if one is ever
adopted.

---

### Option G — Container hosts (Render, Railway, Fly.io)

The middle ground: fewer runtime surprises than serverless, less operational burden than a
VPS.

| Provider | Cost | Assessment |
| --- | --- | --- |
| **Render** | Free tier **spins down after 15 minutes idle**, ~1 minute cold start. Pro is a flat $25/mo workspace → **£237/yr** | The free tier's cold start is a poor experience for a permanent archive; Pro is over budget for what it adds |
| **Railway** | Hobby $5/mo minimum → **£47/yr**; the free plan is $1/month of credit | Competitive on price, pleasant to use, smaller and younger than the alternatives |
| **Fly.io** | **No free tier as of 2026** — a trial only. Realistically $5–15/mo → **£47–£142/yr** | Good technology, and the free tier the club might have relied on is gone |

**Verdict:** *no candidate here beats Option C or D on any criterion.* They cost more than
Cloudflare, carry more operational burden than Netlify, and offer nothing the club needs
that those do not. Listed so they are visibly considered.

---

## Side by side

The candidates, so the letters below can be read without scrolling back:

| | | |
| --- | --- | --- |
| **A** | Vercel + Supabase | Extend the incumbent pattern — what the timing app runs on today |
| **B** | Cloudflare, bundled | One vendor for everything: Pages/Workers, D1, R2, Access |
| **C** ⭐ | **Cloudflare + Supabase** | Cloudflare serves, Supabase holds the data. **Recommended** |
| **D** | Netlify + Supabase | Same shape as C, different host. The strongest alternative |
| **E** | AWS Lightsail | Self-hosted on a VPS inside AWS |
| **F** | Plain VPS | Hetzner, Mythic Beasts or DigitalOcean |
| **G** | Container hosts | Render, Railway, Fly.io |

Rows labelled *"on Supabase Pro"* are the same option with the paid data tier, shown
separately because that £237 is the single largest risk to the cost case.

### Platform cost alone

| | Hosting | Data | Domain/DNS | **Per year** | **3 years** |
| --- | --- | --- | --- | --- | --- |
| **Today — Squarespace** | £204 | — | £15.40 | **£219** | **£657** |
| **A — Vercel Pro + Supabase Pro** | £379 | £237 | £15.40 | **£631** | **£1,894** |
| **B — Cloudflare bundled** | £47 | £0 | £0–10 | **£47–57** | **£141–171** |
| **C — Cloudflare + Supabase** ⭐ | £47 | £0 | £0–10 | **£47–57** | **£141–171** |
| **C on Supabase Pro** — as above, paid data tier | £47 | £237 | £0–10 | **£284–294** | **£852–882** |
| **D — Netlify + Supabase** | £0–85 | £0 | £15.40 | **£15–100** | **£45–300** |
| **E — AWS Lightsail** | £57–75 | included | £15.40 | **£72–90** | **£216–270** + ops hours |
| **F — VPS (Hetzner / Mythic)** | £39–120 | included | £15.40 | **£54–135** | **£162–405** + ops hours |
| **G — Railway / Render** | £47–237 | +£0–47 | £15.40 | **£62–300** | **£186–900** |

**That table is not the comparison the club should decide on**, and it took measured
figures to see why.

### Total cost of collecting the club's money

Two things change with the platform that the table above misses.

**Squarespace's transaction fee disappears.** It takes 2% of every payment — **£91 a
year** — and **no other candidate takes a cut at all.** Cloudflare, Netlify, AWS and a VPS
are infrastructure; they do not sit between the club and its money.

**The processor changes too, and it is not a wash.** The club is on **Squarespace
Payments**, which cannot outlive the platform. Its UK rate is **2% + 25p**. Stripe's is
**1.5% + 20p** — lower on both the percentage *and* the fixed fee, and the fixed fee is
what dominates a £2.50 transaction. So leaving Squarespace forces a processor change that
happens to be an improvement.

On measured volumes — 1,175 subscription payments and 158 ticket orders, £4,560 gross:

| | Plan | Platform's cut | Processing | Domain | **Per year** | **Saving** |
| --- | --- | --- | --- | --- | --- | --- |
| **Today — Squarespace + Squarespace Payments** | £204 | £91 | £424 | £15.40 | **£734** | — |
| **C — Cloudflare free + Supabase free** | £0 | £0 | **£0** | £335 | £15.40 | **£350** | £384 |
| **C — Cloudflare Paid + Supabase free** ⭐ *(plan on this)* | £47 | £0 | **£0** | £335 | £15.40 | **£397** | **£337** |
| **C on Supabase Pro** — Cloudflare Paid + paid data tier | £47 | £237 | **£0** | £335 | £15.40 | **£634** | **£100** |
| **D — Netlify Personal + Supabase free** | £85 | £0 | **£0** | £335 | £15.40 | **£435** | £299 |
| **D on Supabase Pro** — Netlify Personal + paid data tier | £85 | £237 | **£0** | £335 | £15.40 | **£672** | £62 |
| **A — Vercel Pro + Supabase Pro** | £379 | £237 | **£0** | £335 | £15.40 | **£966** | **−£232** |
| **C + Bacs Direct Debit on the subscription** | £47 | £0 | **£0** | £85 | £15.40 | **£147** | **£587** |

**Data is a separate column because Supabase is part of every managed option, not just
Vercel's.** Cloudflare and Netlify serve pages; they do not hold the club's relational
data. Collapsing that into "hosting" is how a £0 estimate turns into a £237 bill.

Ex-VAT throughout, so the comparison is like-for-like; VAT applies to both sides and does
not change the ranking.

**Four readings of that table.**

**The platform saving is £337, not £219.** Half of it — £180 — is the platform's cut plus
the better processor rate, neither of which appears in a hosting comparison.

**£0 is not the number to plan on. £47 is.** See [why Cloudflare is free, and when it
stops being](#why-cloudflare-is-free-and-when-it-stops-being) — the free tier does not
survive race night.

**If Supabase Pro becomes necessary, most of the saving goes.** £634 against £734 is a
£100 saving, not £337. **That is the largest financial risk in the recommendation**, and
[what would trigger it](#what-it-costs-as-the-club-grows) should be understood now rather
than discovered on a renewal notice.

**Option A does not merely cost more, it costs more than staying.** Vercel Pro and
Supabase Pro at £966 is **£232 a year worse than Squarespace** while delivering less
commerce capability. That is the clearest possible statement of why the incumbent pattern
cannot carry the website.

**The biggest single lever is still not the platform.** Bacs Direct Debit on the
subscription takes the total to **£147 — a £587 saving**, and £250 of that has nothing to
do with hosting. See [what payments actually cost](#what-payments-actually-cost).

### Why Cloudflare is free, and when it stops being

**£0 is a real number for the website as scoped, and a misleading one to plan on.**

Cloudflare's free tier is not a trial or a loss-leader with a cliff; it is a genuine
allowance, and the club's measured traffic sits far inside it:

| | Free allowance | Club's measured usage |
| --- | --- | --- |
| Requests | 100,000/day | ~1,900 pageviews/**month** |
| Static assets | Unlimited on Pages | 60 pages |
| R2 object storage | 10 GB, **no egress charge** | 45 documents, some images |
| D1 database | 5 GB | Not needed — data is in Supabase |
| Workers KV | 100k reads/day | Trivial |
| Cron Triggers | **5 per account**, on the free plan | One, for the newsletter mirror |
| Zero Trust access | 50 users | Single figures |

Two real limits sit behind that, and one of them binds.

**The 10ms CPU ceiling.** Free Workers get 10 milliseconds of CPU per request. Serving
static Astro output and handling a form POST is comfortably inside it. Anything doing real
computation per request — deriving a leaderboard, hashing a password, generating a PDF —
is not, and the failure mode is a request that dies rather than one that runs slowly.
Workers Paid raises this to 30 seconds.

**Race night breaks it outright.**
[C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) wants a
leaderboard updating within about a second, for a few hundred spectators. Against a
100,000-request daily allowance:

| Polling interval | Requests over a 90-minute race, 300 spectators | |
| --- | --- | --- |
| Every 1s | 1,620,000 | **60× over** |
| Every 5s | 324,000 | **3× over** |
| Every 10s | 162,000 | **over** |
| Every 30s | 54,000 | within — but no longer "live" |

**The free tier survives every day of the year except the one that matters.** Workers Paid
at **$5/month — £47/yr — covers 10 million requests a month**, which turns race night from
a constraint into a non-event, and lifts the CPU ceiling at the same time.

**So £47/yr is the planning figure, and £0 is the pleasant surprise if the club never
needs it.** The recommendation is unchanged either way; £47 is still an order of magnitude
inside the [money constraint](../foundations/requirements.md#money).

### Does this stack actually do everything?

Checked against every capability in
[requirements](../foundations/requirements.md#capabilities), because "it's all free" is
not the same as "it all works".

| | Capability | Where it lands | Honest status |
| --- | --- | --- | --- |
| C1 | Publish club information | Astro pages, markdown in git | ✅ |
| C2 | Results, permanent and automatic | Supabase Postgres → static pages at build, or served by Worker | ✅ |
| C3 | Race sign-ups and entries | Pages Function → Postgres | ✅ |
| C4 | Take payments | Stripe Checkout + webhook to a Worker | ✅ |
| C5 | Timing capture | **Unchanged — stays on Vercel/Supabase** | ✅ not touched |
| C6 | Live leaderboard | Supabase Realtime, or Durable Objects | ⚠️ **the binding constraint — see below** |
| C7 | Staff authentication | Supabase Auth magic links, or Cloudflare Access (free to 50) | ✅ |
| C8 | Send email as the club | Resend or SES — see [email](email.md) | ✅ |
| C9 | File storage | R2, 10 GB free, no egress fee | ✅ |
| C10 | Hold personal data lawfully | Supabase `eu-west-2`, row-level security | ✅ |
| C11 | England Athletics verification | External dependency, unaffected by hosting | ✅ |
| C12 | Membership records | Postgres tables | ✅ |
| C13 | Gate the members' community | Application logic + WhatsApp invite | ⚠️ as weak as the invite link, on any platform |
| C14 | Newsletters and documents | Cron Trigger pulls Mailchimp; documents on R2 | ✅ **but not on Pages** — Cron Triggers are a Workers feature |
| C15 | Merchandise and tickets | Stripe + Postgres | ✅ build effort, not a platform gap |
| C16 | Member benefits directory | Markdown or a table | ✅ |
| C17 | Form submissions | Pages Function → Postgres | ✅ |
| C18 | Reduce manual work | Cron Triggers, webhooks, database reads | ✅ |

**Two genuine caveats, and neither is fatal.**

**Cron Triggers do not run on Pages.** They are a Workers feature. While the zone stays at
Fasthosts the club must use Pages, so the newsletter mirror needs either a GitHub Actions
schedule (free, and arguably better — the schedule lives in the repository as code) or a
separate small Worker on `workers.dev`. Once the nameservers move and the site becomes a
Worker, this disappears.

**C6 is the one capability that shapes the bill.** Three routes, and they cost
differently:

| Route | Cost | Trade-off |
| --- | --- | --- |
| **Supabase Realtime** | Free to **200 concurrent**, then Pro at £237/yr | Zero integration work — the timing app already uses it. 200 is plausibly fewer than a race-night crowd |
| **Durable Objects + WebSockets** | Included in Workers Paid, **£47/yr** | Cheapest robust answer; a new thing to learn, and the stickiest dependency in the stack |
| **Polling every 30s** | Free | Meets the load, misses the "within a second" requirement |

**The cheapest way to keep Supabase on its free tier is to serve the leaderboard from
Cloudflare rather than from Supabase Realtime.** That is a £190/year decision, and it
should be taken deliberately when C6 is built rather than by default.

### What it costs as the club grows

The requirements are [explicit that this is not built for
scale](../foundations/target-state.md#what-this-is-not), so growth here means *more
capability*, not more users. What each future step actually costs:

| Future step | Effect on the bill |
| --- | --- |
| **Nightingale Nightmare added as a second timed race** | £0 — same tables, same hosting |
| **Race photographs** ([C9](../foundations/requirements.md#c9--store-files)) | R2 beyond 10 GB is **£0.014/GB/month** — 50 GB of photos is about **£7/yr**, and R2 charges no egress, which is what makes image hosting expensive elsewhere |
| **Membership system replacing the EA portal round-trip** | £0 — Postgres rows |
| **Kit catalogue with variants and stock** | £0 in infrastructure; the cost is build time, and [1.1% of traffic](../foundations/current-state.md#what-people-actually-read) says re-scope it |
| **Live leaderboard at full crowd** | £47/yr via Workers Paid, **or** £237/yr via Supabase Pro |
| **Committee editing interface** | £0 with a git-backed editor; a hosted CMS would be a new recurring line |
| **Results archive growing every year** | Negligible — a decade of results is a few megabytes |
| **The archive outgrowing Supabase free (500 MB)** | £237/yr. On results and members alone this is **years away**; storing images or logs in Postgres would bring it forward, so do not |

**The shape of the risk:** nothing about *more members, more races or more years* moves
the club off free tiers. **Only two things do — race-night concurrency and putting large
files in the wrong place.** Both are design decisions the club controls, not growth it
cannot.

### Against the seven criteria

Scored 1–5, 5 best. Criteria from [options](options.md#how-to-judge).

| | 1 Cost | 2 Terms | 3 One volunteer | 4 Exit | 5 Fit | 6 Ops | 7 Data | **Total** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A — Vercel + Supabase** | 1 | **1** | 5 | 3 | 5 | 5 | 4 | **24** |
| **B — Cloudflare bundled** | 5 | 5 | 4 | **2** | 2 | 5 | 4 | **27** |
| **C — Cloudflare + Supabase** | 5 | 5 | 4 | 3 | **5** | 5 | 4 | **31** |
| **D — Netlify + Supabase** | 5 | 5 | **5** | 4 | 4 | 5 | 4 | **32** |
| **E — AWS Lightsail** | 4 | 5 | **1** | 5 | 3 | **1** | 5 | **24** |
| **F — VPS elsewhere** | 4 | 5 | **1** | 5 | 3 | **1** | 3 | **22** |
| **G — Container hosts** | 3 | 5 | 4 | 4 | 3 | 4 | 4 | **27** |

Read the scores as a way of showing the working, not as an answer. Two things they make
visible are worth stating plainly.

**Option A loses on terms alone**, before cost is considered — which is unusual, and is
why [the eliminating questions](#the-two-questions-that-eliminate) come first in this
document.

**D scores one point above C, and C is still the recommendation.** That is a real tension,
not an oversight. The seven criteria are the right ones for comparing *hosts*, and on
those Netlify is marginally the better host. What they do not score is a club requirement
that sits outside hosting: [everything defined as
code](../foundations/requirements.md#everything-is-defined-as-code) and [no system
reachable by one person](../foundations/requirements.md#shared-ownership). Cloudflare's
route carries DNS with it and closes both gaps; Netlify's leaves DNS exactly as it is.
Anyone who weighs that differently should reach a different answer, and the scores are
here so they can.

---

## The recommendation

> **Cloudflare Pages for serving, Supabase Postgres in `eu-west-2` for data, R2 for files,
> Stripe for payments. TypeScript throughout: Astro for the website, Next.js retained for
> the timing platform.**
>
> **Fall back to Netlify in place of Cloudflare if the club decides against moving the
> nameservers.** Everything else in the recommendation is unchanged by that choice.

Restated as a decision the committee can take:

| | |
| --- | --- |
| **Requirement served** | All of [C1–C18](../foundations/requirements.md#capabilities); decisively [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically) and the [money constraint](../foundations/requirements.md#money) |
| **Decision** | Serving on Cloudflare Pages; data on Supabase Postgres; files on R2; payments on Stripe; TypeScript, Astro for the site |
| **Platform cost** | **£47/yr** — Workers Paid, which race night requires. Free every other day of the year, and unchanged when payments switch on |
| **Total cost of collecting the club's money** | **£397/yr against £734 today — a £337 saving.** £295 is the plan and Squarespace's cut; £89 is the better processor rate that comes with leaving; £47 is Workers Paid, which race night requires. A further £250 is available from Bacs Direct Debit, independently of this decision |
| **The risk to that figure** | **Supabase Pro at £237/yr would cut the saving to £100.** Avoidable by serving the live leaderboard from Cloudflare rather than Supabase Realtime, and by keeping files in R2 rather than Postgres |
| **Consequences accepted** | Two vendors; Supabase's bundling exposure inherited; the apex requires Cloudflare nameservers; a second framework alongside Next.js |
| **Exit cost** | Serving: an afternoon. Files: S3-compatible, near zero. Data: unchanged from today's exposure |
| **Revisit when** | Cloudflare's free tier gains a commercial-use restriction; Supabase Free's ceilings are reached; or a volunteer arrives who wants to run infrastructure |

### The one question that decides between C and D

**Is the club willing to move authoritative DNS to Cloudflare?**

- **Yes** → Option C. Cheapest, DNS becomes code, £15.40/yr saved, one fewer single point
  of failure. Cost: a carefully staged migration that carries club email with it.
- **No** → Option D. Netlify serves the apex from Fasthosts' DNS, so the migration never
  happens. Cost: about £85/yr and a free tier that can stop serving.

Both are defensible. [DNS and domain](dns-and-domain.md) sets out the risk honestly enough
for that question to be answered rather than guessed.

**Neither choice blocks Nightingale Nightmare**, which is the point of settling it now
rather than under deadline pressure.

---

## What payments actually cost

Included because a cost analysis that ignored it would understate the picture by an order
of magnitude. This does not re-open
[C4](../foundations/requirements.md#c4--take-payments); it prices it.

Volumes are measured — see [the flow of
money](../foundations/current-state.md#the-flow-of-money). The subscription runs at about
**1,175 payments a year (£2,940)**; party tickets add **£1,620 across 158 orders**. Stripe
rows below add 20% VAT, since the club is not VAT-registered and cannot reclaim it.

**On the subscription**, which is where the cost is:

| Arrangement | Fee per payment | **Per year** | Effective rate |
| --- | --- | --- | --- |
| **Today — Squarespace Payments, 2% + 25p, plus Squarespace's 2%** | £0.35 | **£411** | 14.0% |
| Stripe card, **monthly** — 1.5% + 20p | £0.285 | **£335** | 11.4% |
| Stripe card, **annual £30** — 1.5% + 20p | £0.78 | **£76** | 2.6% |
| **Stripe Bacs Direct Debit** — 1%, no fixed fee, capped £4 | £0.03 | **£35** | **1.2%** |

Three things follow from it:

1. **Changing processor barely helps; changing the billing frequency does.** Monthly card
   billing is dominated by the fixed fee — as
   [options](options.md#c4--payments) sets out.
2. **Bacs Direct Debit has no fixed fee, which collapses the problem entirely.** At 3p per
   payment it makes *monthly* billing as cheap as annual, so the club would not have to
   ask ~100 people to switch to paying £30 up front. **This is worth roughly £375 a year —
   more than the entire hosting decision.**
3. **Squarespace's cut is the smallest of the three levers.** Its transaction fee across
   both flows is **£91 of the £516** in total fees — real, and worth removing, but under a
   fifth of the problem. The rest is the fixed fee on a very small, very frequent
   transaction, and that follows the club to any platform unless the billing instrument
   changes too. Worth stating plainly, because "Squarespace takes a cut" is the memorable
   fact and it is not where the money goes.

**Tickets need a different answer from the subscription.** At 6.1% on a £12 ticket they
are already cheap to process, they happen twice a year, and 158 orders is well inside what
a hosted payment link handles with no platform at all. If the subscription moves to Direct
Debit, **the club's remaining commerce requirement is two evenings a year** — which
changes what the website has to be.

Bacs is not free of friction: mandate setup takes several working days, payments settle in
about three, and a failed payment costs £5. Those are operational facts to plan around,
not reasons to dismiss it. **This should be verified directly with Stripe before it is
relied on**, and it should be tested against what the treasurer needs to reconcile.

---

## Verify before deciding

Everything here that is load-bearing and was taken from a secondary source. **None of
these should be relied on until confirmed in writing from the vendor**, per
[options](options.md#questions-to-answer-before-any-of-this-is-decided).

| # | To confirm | Why it matters |
| --- | --- | --- |
| 1 | Vercel's fair-use position on payments and donations on Hobby | It is the reason Option A is rejected |
| 2 | Cloudflare's terms carry no non-commercial restriction on Workers/Pages free | The whole recommendation rests on it |
| 3 | Netlify free plan permits commercial use, and the current credit allowance | Decides whether Option D is £15 or £100/yr |
| 4 | Cloudflare Pages accepts a subdomain custom domain on a zone hosted elsewhere | Decides whether NN ships without a DNS migration |
| 5 | Netlify serves an apex from third-party DNS via A record | The entire advantage of Option D |
| 6 | Stripe Bacs Direct Debit: 1%, capped £4, **no fixed fee**, and any minimum | Worth ~£370/yr |
| 7 | Cloudflare Registrar's actual `.co.uk` renewal price | Currently stated only as "at cost" |
| 8 | Supabase Free's pause behaviour for a project receiving steady public traffic | Decides £0 vs £237/yr |
| 9 | ~~Plan name, processor, volumes~~ — **resolved 7 Aug 2026.** Business plan, £204, renewing **21 March 2027**; processor is **Squarespace Payments**; volumes measured | Recorded in [the flow of money](../foundations/current-state.md#the-flow-of-money) |
| 10 | **Whether the Business plan is legacy (2%) or current (3%)** | Moves Squarespace's cut between £91 and £137/yr. Visible on an invoice |

Items 1–5 block the hosting decision. Items 6–10 do not, and can run in parallel.

---

## What this document does not decide

- **The payments choice.** Priced here, decided in
  [C4](../foundations/requirements.md#c4--take-payments) with the treasurer, behind the
  [governance gates](../foundations/requirements.md#legal-and-governance).
- **Whether the timing platform moves.** It works where it is. This recommendation is
  chosen so that it *can* move later, cheaply, without requiring it.
- **How the committee edits content.** [Deliberately
  deferred](../delivery/priorities.md#what-can-safely-be-decided-later) until it is known
  what they actually ask to change. Astro's markdown collections plus a git-backed editor
  is the cheapest starting point, and adding one later costs nothing now.
- **The domain registrar.** See [DNS and domain](dns-and-domain.md).
