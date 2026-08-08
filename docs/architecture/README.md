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
| [**Investigations**](investigations/) | Options, trade-offs and research. **Nothing decided** | You are about to argue about one of them |
| [**Decisions**](decisions/) | Records of what was chosen, and why | You want to know why something is the way it is |

The flow is one way: an investigation narrows to a decision, and a decision that stops being
contested becomes a principle. **Nothing skips a tier** — a principle nobody can trace back
to a requirement or a decision is just somebody's preference that survived.

### Investigations

| | Status |
| --- | --- |
| [Repositories](investigations/repositories.md) | **Open** — five candidates, criteria genuinely conflict |
| [Networking](investigations/networking.md) | Hostnames, zones, TLS, routing, environments |
| [Database](investigations/database.md) | Project topology, schemas, RLS, migrations, backups |
| [Deployment](investigations/deployment.md) | Cloudflare and Supabase. **Time-sensitive** — the Pages/Workers change |
| [Local development](investigations/local-development.md) | The local stack, the test suite, validating without the club domain |

### Where decisions live

Two homes, one rule — [decisions/README](decisions/README.md) has the routing table.
Briefly: **club decisions** (vendors, recurring costs, where personal data lives) go in the
[decision log](../decisions/decision-log.md); **build decisions** (schema shape, repository
layout, test strategy) go in [decisions/](decisions/). When in doubt, the decision log.

---

## Open questions

Everything unresolved across the five investigations, grouped by **when it has to be
answered** rather than by topic. Tracked in
[#1](https://github.com/southville-running-club/src-website/issues/1).

### Blocking now

| | Why it blocks | Where |
| --- | --- | --- |
| **Repository shape** — one of five | **The Nightingale Nightmare scaffold cannot start.** [Plan](../delivery/plan.md) step 17 says *"create the NN repository"*, which presumes one of the answers | [repositories](investigations/repositories.md) |
| **Where NN v1 sign-ups land** | The form cannot persist anything. Proposed: `intake.nn_interest` | [database](investigations/database.md#nightingale-nightmare-is-an-event-not-an-application) |
| **The race date** | Not architectural, but it blocks race planning and it is the committee's first ask | [plan](../delivery/plan.md) step 16 |

### Before the website build starts

| | Note | Where |
| --- | --- | --- |
| **Workers or Pages for the main site** | **Time-sensitive.** Cloudflare says Workers for new projects; Workers needs the DNS move to have landed | [deployment](investigations/deployment.md#pages-or-workers) |
| **Who owns migrations** | Follows from repository shape. Two repositories pushing to one project desync silently | [database](investigations/database.md#migrations) |
| **Declarative schemas or imperative migrations** | Cheaper to choose before there are migrations to convert | [database](investigations/database.md#declarative-schemas-are-probably-the-better-tool) |
| **Astro for the main website** | Recommended everywhere, recorded nowhere | [platform options](../solutions/platform-options.md#framework-which-is-a-separate-question-from-language) |
| **Does the website need member-facing auth at all?** | Answering *no* removes a large amount of build **and** a large amount of personal data. Answering it late means building around an assumption | [#1](https://github.com/southville-running-club/src-website/issues/1) |
| **A ~£10/yr throwaway domain?** | The only way to rehearse the DNS move and test mail authentication. The one change that cannot be quickly un-broken | [local development](investigations/local-development.md#what-cannot-be-tested-without-a-real-domain) |
| **The backup runbook** | Free tier has **no automated backups**, and continuity says a 2026 URL resolves in 2036. **The largest gap in the data architecture** | [database](investigations/database.md#backups) |
| **Document naming and the stable-URL contract** | A limited company's public record back to 2015. Every scheme chosen later breaks URLs published earlier | [#1](https://github.com/southville-running-club/src-website/issues/1) |

### Before the timing platform is touched

| | Note | Where |
| --- | --- | --- |
| **Where `src-race-timing` ends up, and when** | Two shapes absorb it, two never do. *"Eventually"* is not a plan — this wants a date or an explicit never | [repositories](investigations/repositories.md) |
| **Does it keep deploying from Vercel** during the transition? | It works. Only the hostname has to change first | [deployment](investigations/deployment.md) |
| **How shared code travels**, if repositories stay split | The `Europe/London` module has to be correct in two places. Package, submodule, or accepted drift — **all three worse than an import** | [repositories](investigations/repositories.md#the-shared-code-problem) |

### Can wait, but should not be forgotten

| | |
| --- | --- |
| **Is there a staging environment at all?** | A free project [pauses after a week idle](investigations/database.md#what-the-free-tier-actually-allows), and the two-project limit is **per person, not per club** |
| **Is this repository renamed?** | Cheapest before anyone has clones. Only bites under some shapes |
| **Does `docs/` stay in one place** if repositories split? | Splitting it defeats the point of writing it once |
| **Retention policy per table** | [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) requires one; nothing is written |
| **Are `intake` rows ever promoted into `club`?** | An interest registration becoming a member is a real flow with a lawful-basis question |
| **Does Pass the Buck get a subdomain?** | `nn.` exists because that race had no presence at all. PtB already has one |
| **What the transactional sending subdomain is called** | Cosmetic, but permanent |
| **DNS as code — Terraform or OpenTofu**, and in which repository | [Plan](../delivery/plan.md) step 36 |
| **Whether the registrar moves to Cloudflare** | [Governance, not technical](../solutions/dns-and-domain.md) |
| **Who holds the billing relationship** | Both volunteers can reach the accounts; only one can hold a card |
| **Does CI enforce the stale-types check from day one?** | Cheap early, annoying to retrofit |
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
