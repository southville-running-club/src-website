# Architecture

How the platform is put together — the settled rules, the open investigations, and the
decisions taken between them.

[Platform options](../solutions/platform-options.md) chose the vendors. This folder chooses
the **shape of the thing built on them**, which is a different question with different
trade-offs.

**Everything here is TypeScript**, per
[convergence](../foundations/requirements.md#convergence). Assumed throughout rather than
re-argued.

---

## Three tiers, and the difference matters

| | | Read it when |
| --- | --- | --- |
| [**Principles**](principles.md) | **The as-is.** What is already true and stays true | **Before writing any code.** If you read one thing here, read this |
| [**Investigations**](investigations/) | Options, trade-offs and research. **The working, not the answer** | You are about to argue about one of them, or want to know why a decision went the way it did |
| [**Decisions**](decisions/) | Records of what was chosen, and why | You want to know why something is the way it is |

The flow is one way: an investigation narrows to a decision, and a decision that stops being
contested becomes a principle. **Nothing skips a tier** — a principle nobody can trace back
to a requirement or a decision is just somebody's preference that survived.

### Investigations

| | Status |
| --- | --- |
| [Repositories](investigations/repositories.md) | **Settled** — [ADR-001](decisions/adr-001-one-monorepo.md), one monorepo |
| [Networking](investigations/networking.md) | **The zone moved to Cloudflare on 8 Aug 2026.** Hostnames, TLS, routing, and the proxy rule that now has two halves |
| [Database](investigations/database.md) | **Mostly settled** — [ADR-002](decisions/adr-002-schema-layout.md). Backups still open |
| [Deployment](investigations/deployment.md) | **Settled** — Workers throughout, since the nameservers moved on 8 Aug 2026 |
| [Local development](investigations/local-development.md) | **Settled** — [ADR-003](decisions/adr-003-local-development-and-pipeline.md), [ADR-004](decisions/adr-004-no-staging-environment.md) |
| [Infrastructure as code](investigations/infrastructure-as-code.md) | **Settled** — [ADR-005](decisions/adr-005-manual-with-a-reviewable-artefact.md). Counts the work, and concludes no tool earns its keep yet |

### Decided

| | |
| --- | --- |
| [**ADR-001**](decisions/adr-001-one-monorepo.md) | One monorepo, npm workspaces. `src-race-timing` joins with the Cloudflare port |
| [**ADR-002**](decisions/adr-002-schema-layout.md) | `public` / `private` / `club` / `intake`. Nightingale Nightmare sign-ups → `intake.nn_interest` |
| [**ADR-003**](decisions/adr-003-local-development-and-pipeline.md) | `localhost` with fabricated data; the pipeline brings up the same stack and runs acceptance tests |
| [**ADR-004**](decisions/adr-004-no-staging-environment.md) | No staging environment. Local plus preview deployments |
| [**ADR-005**](decisions/adr-005-manual-with-a-reviewable-artefact.md) | DNS stays manual against a committed zone file. **Automate by change frequency, not by category** |

### Where decisions live

Two homes, one rule — [decisions/README](decisions/README.md) has the routing table.
Briefly: **club decisions** (vendors, recurring costs, where personal data lives) go in the
[decision log](../decisions/decision-log.md); **build decisions** (schema shape, repository
layout, test strategy) go in [decisions/](decisions/). When in doubt, the decision log.

---

## Open questions

**Nothing architectural is blocking any more.** The five decisions above, plus the completed
nameserver move, clear the path to building. What remains can be answered as it is reached.
Tracked in [#1](https://github.com/southville-running-club/src-website/issues/1).

### ✅ The DNS move is done

**8 August 2026.** The zone is on Cloudflare, which was the last infrastructural blocker —
Workers custom domains are now available, so
[Phases 4 and 6](../delivery/phases.md) are unblocked and everything new is a Worker.

**Next was code**, not architecture:
[Phase 3](../delivery/phases.md#phase-3--nightingale-nightmare-live) — the
workspace root, then the skeleton, then a Worker on the club domain writing to Supabase.
**That skeleton now exists** — `apps/main` (not the `apps/nn` sketched here; see
[ADR-006](decisions/adr-006-apps-main-and-hostnames-as-code.md) and
[ADR-007](decisions/adr-007-one-hostname-paths-not-subdomains.md)) and `apps/timing`, both
serving a hello-world page from Postgres. What is left of Phase 3 is the sign-up form
itself, per [the build brief](../delivery/nn-build-brief.md).

### Before the main website build

| | Note |
| --- | --- |
| ~~Workers or Pages for the main site~~ | ✅ **Settled — Workers.** The nameserver move on 8 Aug 2026 removed the constraint that forced Pages |
| **Declarative schemas or imperative migrations** | Cheaper to choose before there are migrations to convert |
| **Astro for the main website**, as a record | Recommended everywhere, recorded nowhere. Already fixed for Nightingale Nightmare by the build brief |
| **Does the website need member-facing auth at all?** | Answering *no* removes a large amount of build **and** a large amount of personal data |
| **The backup runbook**, with a tested restore | The free tier has **no automated backups**, and continuity says a 2026 URL resolves in 2036. **The largest remaining gap** |
| **Document naming and the stable-URL contract** | A limited company's public record back to 2015. Every scheme chosen later breaks URLs published earlier |
| ~~A ~£10/yr throwaway domain to rehearse the DNS move?~~ | **Moot — the move is done**, and the pre-flight testing (`/etc/resolver` against a pending zone) proved sufficient. Still the only way to test **mail authentication** without touching production |

### Before the timing platform is touched — **now on the critical path**

| | Note |
| --- | --- |
| **`src-race-timing` joins the monorepo in [Phase 4](../delivery/phases.md#phase-4--the-timing-app-on-cloudflare)** | **Race-ready by mid-October**, because it runs Nightingale Nightmare. **Move it into the club org *before* connecting Cloudflare**, or the git link desyncs |
| **Age-band categories do not exist yet** | The leaderboard derivation is relay-shaped, and NN is a solo race with Vet 40/50/60. **New work, not a port** |
| **The live leaderboard** | Durable Objects rather than Supabase Realtime — a rebuild, and worth £237/yr |
| **Bundle size and CPU limits** | 3 MB compressed on free Workers, 10 ms CPU. Unmeasured for this app |

### Can wait, but should not be forgotten

| | |
| --- | --- |
| **Is this repository renamed?** | It will hold the race sites and eventually the timing platform. Cheapest before anyone has clones |
| **Retention policy per table** | [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) requires one; nothing is written |
| **Are `intake` rows ever promoted into `club`?** | An interest registration becoming a member is a real flow with a lawful-basis question |
| **Does Pass the Buck get a subdomain?** | `nn.` exists because that race had no presence at all. PtB already has one |
| **What the transactional sending subdomain is called** | Cosmetic, but permanent |
| **DNS as code — Terraform or OpenTofu**, and where | [Plan](../delivery/plan.md) step 36 |
| **Whether the registrar moves to Cloudflare** | [Governance, not technical](../solutions/dns-and-domain.md) |
| **Who holds the billing relationship** | Both volunteers can reach the accounts; only one can hold a card |
| **Does CI run on a schedule** as well as on pull requests? | Catches dependency rot and free-tier changes before a race week does |

---

## What the research changed

Four things in the existing documentation turned out to be wrong or out of date. Two move
money.

**Cloudflare now tells new projects to use Workers, not Pages.** *"Pages continues to work,
but new features and optimizations are focused on Workers."* This was the finding that made
the nameserver move urgent — Workers custom domains need an active zone, so while the zone sat
at Fasthosts the club was boxed into Pages. **The nameservers moved on 8 August 2026 and
everything new is a Worker.**

**The live leaderboard may not need Workers Paid at all.** The £47/yr in
[platform options](../solutions/platform-options.md#why-cloudflare-is-free-and-when-it-stops-being)
is priced by *polling* — 300 spectators once a second, 16× the daily free allowance. That
measures the wrong architecture. SQLite-backed Durable Objects are on the free plan,
**outgoing WebSocket messages are not billed**, incoming bill at 20:1, and hibernation stops
duration accruing. A whole race night is roughly **320 requests** against 100,000 a day. The
£237 Supabase Realtime ceiling still binds; the Cloudflare side is insurance rather than a
requirement.

**Both blocking verifications passed.** Cloudflare Pages supports monorepos (root directory
plus build watch paths), and the Supabase CLI scopes to named schemas
(`--schema club,intake`) — which was the load-bearing assumption behind two repositories
sharing one database.

**Supabase branching is Pro-only**, so there is no free preview database to mirror
Cloudflare's preview deployments. Hence [local
development](investigations/local-development.md) as a document in its own right: **the
laptop is the test environment.**
