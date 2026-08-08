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
| [Networking](investigations/networking.md) | Hostnames, zones, TLS, routing, environments. **The DNS move is the current priority** |
| [Database](investigations/database.md) | **Mostly settled** — [ADR-002](decisions/adr-002-schema-layout.md). Backups still open |
| [Deployment](investigations/deployment.md) | Workers-or-Pages for the main site still open; Nightingale Nightmare is Pages either way |
| [Local development](investigations/local-development.md) | **Settled** — [ADR-003](decisions/adr-003-local-development-and-pipeline.md), [ADR-004](decisions/adr-004-no-staging-environment.md) |

### Decided

| | |
| --- | --- |
| [**ADR-001**](decisions/adr-001-one-monorepo.md) | One monorepo, npm workspaces. `src-race-timing` joins with the Cloudflare port |
| [**ADR-002**](decisions/adr-002-schema-layout.md) | `public` / `private` / `club` / `intake`. Nightingale Nightmare sign-ups → `intake.nn_interest` |
| [**ADR-003**](decisions/adr-003-local-development-and-pipeline.md) | `localhost` with fabricated data; the pipeline brings up the same stack and runs acceptance tests |
| [**ADR-004**](decisions/adr-004-no-staging-environment.md) | No staging environment. Local plus preview deployments |

### Where decisions live

Two homes, one rule — [decisions/README](decisions/README.md) has the routing table.
Briefly: **club decisions** (vendors, recurring costs, where personal data lives) go in the
[decision log](../decisions/decision-log.md); **build decisions** (schema shape, repository
layout, test strategy) go in [decisions/](decisions/). When in doubt, the decision log.

---

## Open questions

**Nothing architectural is blocking any more.** The four decisions above clear the path to
building Nightingale Nightmare and to moving the DNS. What remains can be answered as it is
reached. Tracked in
[#1](https://github.com/southville-running-club/src-website/issues/1).

### Next, and it is a delivery question rather than an architectural one

**The DNS move.** [Move the DNS first](../delivery/dns-first.md) and
[DNS and domain](../solutions/dns-and-domain.md) cover the reasoning; the runbook is
[plan](../delivery/plan.md) steps 23–36. It is the only change in the programme that
[cannot be quickly un-broken](investigations/networking.md#failure-modes-and-how-fast-each-reverses),
and it carries club email.

> **It does not block Nightingale Nightmare, and Nightingale Nightmare must not wait for
> it.** A subdomain needs [one additive
> CNAME](investigations/networking.md#what-gets-added) at Fasthosts — nothing existing is
> touched, mail cannot break, and deleting the record restores today exactly. With sign-ups
> opening in about two weeks, putting a 48-hour-rollback change in front of a hard date
> would invert the risk logic the rest of the plan is built on.

### Before the main website build

| | Note |
| --- | --- |
| **Workers or Pages for the main site** | Cloudflare says Workers for new projects, and Workers needs the DNS move landed first. Not urgent, but it decides whether the main build starts on the supported path |
| **Declarative schemas or imperative migrations** | Cheaper to choose before there are migrations to convert |
| **Astro for the main website**, as a record | Recommended everywhere, recorded nowhere. Already fixed for Nightingale Nightmare by the build brief |
| **Does the website need member-facing auth at all?** | Answering *no* removes a large amount of build **and** a large amount of personal data |
| **The backup runbook**, with a tested restore | The free tier has **no automated backups**, and continuity says a 2026 URL resolves in 2036. **The largest remaining gap** |
| **Document naming and the stable-URL contract** | A limited company's public record back to 2015. Every scheme chosen later breaks URLs published earlier |
| **A ~£10/yr throwaway domain?** | Now the *only* way to rehearse the DNS move or test mail authentication, since [ADR-004](decisions/adr-004-no-staging-environment.md) declined a staging environment |

### Before the timing platform is touched

| | Note |
| --- | --- |
| **When `src-race-timing` joins the monorepo** | [ADR-001](decisions/adr-001-one-monorepo.md) says with the Cloudflare port, after the 2026 race. **Still wants a date rather than a milestone** |
| **Does it keep deploying from Vercel** during the transition? | It works. Only the hostname has to change first |

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
but new features and optimizations are focused on Workers."* Nightingale Nightmare v1 stays
on Pages regardless — Workers custom domains need an active zone and the club's is still at
Fasthosts — but the main website should not start on the legacy path. **Another argument for
[moving the DNS first](../delivery/dns-first.md).**

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
