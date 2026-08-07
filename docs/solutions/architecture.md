# Architecture — repositories, database and deployment

Where the code lives, where the data lives, and how each reaches production.

[Platform options](platform-options.md) chose the vendors. This chooses the **shape of the
thing built on them** — which is the next question, and the one that is expensive to
change later because it is the question every file's path answers.

Three decisions and one hazard:

| | |
| --- | --- |
| [**One repository**](#1-one-repository-not-one-per-service), not one per service | The timing app joins it later, deliberately |
| [**One Supabase project**](#2-one-database-separated-by-schema), separated by Postgres schema | Forced by [C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), not chosen for tidiness |
| [**Git-integration deploys**](#4-deployment) for Cloudflare, **CI migrations** for Supabase | Different risk, different answer |
| ⚠️ [**Migration ownership**](#3-who-owns-the-migrations) | Two repositories migrating one database is the one way to break this badly |

---

## What already decided most of this

Two lines written before any of it existed do most of the work here, and they should be
read as binding rather than aspirational.

**The [glossary](../foundations/glossary.md#platform-and-delivery) already defines the
answer:**

> **The platform** — one codebase and one database behind three front doors: the club
> website, the payments/membership surface, and the timing app.

**And [convergence](../foundations/requirements.md#convergence) makes it a requirement
rather than a preference:**

> The end state is one platform. The race-timing system, Nightingale Nightmare and the
> club website are intended to merge — one place, not three things that happen to share a
> club.

So the question is not *whether* to converge. It is **what to converge now and what to
converge later**, and the answer follows from
[risk](../foundations/requirements.md#risk): the timing app is race-day critical and
proven, so it moves last and on purpose.

---

## 1. One repository, not one per service

**No separate repositories per service.** The club builds a monorepo.

### Why not microservices

Worth stating explicitly, because "a repo per thing" is the reflex and it is wrong here:

| Requirement | What it says about this |
| --- | --- |
| [Not scale](../foundations/requirements.md#what-the-club-is-not-asking-for) | ~94 members, ~100 teams, a few hundred spectators on the busiest evening of the year. Service boundaries solve a problem the club does not have |
| [People](../foundations/requirements.md#people) | Two volunteers with day jobs. Every extra repository is another CI configuration, another dependency bump, another README, another place a third person has to look |
| [Convergence](../foundations/requirements.md#convergence) | Splitting now means merging later. Nothing is gained by taking the cost twice |
| [Everything as code](../foundations/requirements.md#everything-is-defined-as-code) | "Patterns established once serve the website, Nightingale Nightmare and the timing platform rather than being solved three times" — that is a monorepo, described |

**Separate repositories are the right answer when separate teams deploy on separate
cadences.** The club is two people who will often be changing the website and the race
site in the same evening.

### The proposed shape

```
src-website/                       ← this repository
├── docs/                          unchanged
├── apps/
│   ├── www/                       the club website          → www Pages project
│   └── nn/                        Nightingale Nightmare     → nn Pages project
├── packages/
│   ├── db/                        migrations, RLS policies, generated types
│   └── shared/                    Zod schemas, glossary types, Europe/London helpers
├── .github/workflows/
└── package.json                   npm workspaces
```

**npm workspaces, not a monorepo tool.** No Turborepo, no Nx, no pnpm. The
[build brief](../delivery/nn-build-brief.md#stack) already picked npm on the grounds that
boring beats better, and two applications do not need a build orchestrator.

**`packages/shared` is where convergence actually happens.** The timing app's
`lib/london-time.ts` exists because [an hour of drift is a real
foot-gun](../reference/timing-app-review.md#what-is-strong) and Nightingale Nightmare sits
on the clocks-change weekend. That module should be shared, not copied — and it is the
strongest single argument for one repository.

### What stays out, for now

**`src-race-timing` stays where it is.** It moves into this repository when the timing app
moves to Cloudflare, not before.

| | |
| --- | --- |
| **Why not now** | [Risk](../foundations/requirements.md#risk) — it is proven in production, race-day critical, and a race cannot be re-run. The [build brief already prohibits touching it](../delivery/nn-build-brief.md#hard-rules) |
| **What it costs to wait** | One duplicated Supabase client configuration and one duplicated timezone helper, until it lands |
| **When it comes in** | With the Cloudflare port, after Nightingale Nightmare 2026 and outside any [change freeze](../foundations/glossary.md#platform-and-delivery) |

Plan step 11 moves it into the club **organisation**, which is the governance fix and is
independent of this. Organisation now; monorepo later.

### This changes plan step 17

[The plan](../delivery/plan.md) currently says *"create the NN repository"*. Under this
decision it becomes **create `apps/nn` in this repository**. The
[build brief's project structure](../delivery/nn-build-brief.md#project-structure) is
otherwise unchanged — the same files, one directory deeper.

**Cloudflare Pages supports this.** A Pages project takes a *root directory* and *build
watch paths*, so one repository serves two Pages projects that build independently. This
is on the [list to confirm](#confirm-before-relying-on-it) rather than assumed.

---

## 2. One database, separated by schema

**One Supabase project. Multiple Postgres schemas. Not one project per application.**

### Why one project is close to forced

This is not a tidiness preference —
[C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
decides it:

> A page per race per year... **derived from timing data rather than re-keyed.**

The results archive has to *read the timing tables*. Two Supabase projects means two
Postgres instances, which means no join — the website would have to call an API,
replicate the data, or re-key it. Re-keying is the thing this programme exists to stop.

Second reason: **the free tier allows two active projects.** Spending both on
production leaves nothing for staging. One production project spends one slot and leaves
the other for a staging project holding no real personal data.

[Decision 002](../decisions/decision-log.md#002--hold-the-clubs-data-in-supabase-on-the-free-tier)
already said *"website and timing data in one project"*. This is that decision's
consequence, worked through.

### Proposed schemas

| Schema | Holds | Written by | Public read |
| --- | --- | --- | --- |
| `public` | **Timing, unchanged** — `events`, `teams`, `runners`, `crossings`, `marshals`, `staff_assignments`, `admin_actions` | Timing app only | Yes, per existing RLS |
| `private` | **Unchanged** — helper functions with pinned `search_path` | Timing app only | No |
| `club` | Members, membership periods, EA registrations, the session-subscription payers, benefits directory, document metadata | Website | No |
| `intake` | Public form submissions: interest registrations, new-member forms, mailing-list requests, WhatsApp community requests | Anyone, via a public form | No |

**Why `intake` is separate from `club`, and it is the most important line in this table.**
Public forms need an RLS policy allowing anonymous `insert`. Getting that policy wrong on
a schema that also holds the membership list is a personal-data incident. Getting it wrong
on a schema that holds only what someone just typed into a public form is a nuisance. **The
schema boundary is the blast radius**, and [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully)
is a condition on everything rather than a feature.

**Nothing in `public` changes.** Not a column, not a policy. The timing app's six tables
and its `private` helpers are treated as another team's database until the port.

### Nightingale Nightmare does not get its own schema for race data

This is a correction worth making early, because the instinct is to mirror the timing app
and it would be wrong.

**Nightingale Nightmare is an event, not a second application.** The
[glossary](../foundations/glossary.md#club-and-races) defines an *event* as one running of
one race in one year, and the [timing-app
review](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know)
found that `events.format` has carried `'relay' | 'solo'` **since the first migration** —
solo is modelled, not hypothetical.

So when Nightingale Nightmare takes real entries, they belong in the **same** event and
entry model as Pass the Buck. Duplicating it would produce two results archives, two bib
schemes and two category systems, and
[C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
asks for one permanent archive across all of them.

**What is genuinely separate is v1.** The [build
brief](../delivery/nn-build-brief.md#scope) scopes Nightingale Nightmare v1 to *name,
email, consent, timestamp* — an expression of interest, which is **not an entry**. It has
no bib, no category, no payment and no event relationship. It belongs in `intake`, and it
resolves the brief's own [open
item](../delivery/nn-build-brief.md#deliberately-left-open) *"where the rows land"*:

> `intake.nn_interest` — a new schema in the existing Supabase project. Not `public`,
> not a second project, and not the timing app's `teams` table.

### Two tables the club must not merge

Flagged because [C4](../foundations/requirements.md#c4--take-payments) says so in terms,
and because a schema built the obvious way gets this wrong:

> The £2.50 subscription **is not membership** and its payers are not a membership list —
> conflating them will produce a wrong data model.

So `club.members` and `club.subscribers` are **distinct tables** with distinct lifecycles.
Roughly 103 people pay the subscription; 94 are members; the sets overlap without being
the same, and the subscription is open to non-members.

### Inherit the PII boundary, do not reinvent it

The timing app **drops date of birth, address, phone, emergency contact and medical
information at the parser boundary**, before anything reaches the database, and computes
`age_on_day` instead of storing a birth date. The [timing-app
review](../reference/timing-app-review.md#runners) calls this "C10 already implemented,
and the pattern any new entry surface should inherit."

Nightingale Nightmare needs age bands, so it needs date of birth *at the moment of entry*
— and should keep storing the derived age rather than the birth date, exactly as Pass the
Buck does.

---

## 3. Who owns the migrations

**This is the hazard, and it deserves its own section because it is the one that bites
silently.**

Supabase tracks applied migrations in a single table per project. **Two repositories
running `supabase db push` against one project will desync** — each CLI sees the other's
migrations as missing, and the failure surfaces at the worst moment, which is when
somebody is trying to ship a fix.

The club is about to have exactly that: `src-race-timing` owns `public`, and this
repository will own `club` and `intake`, both against one database.

### The rule

> **One schema has exactly one owning repository, and no repository ever runs a
> whole-database operation against the shared project.**

In practice:

| | |
| --- | --- |
| `public`, `private` | Migrated from `src-race-timing`, as today |
| `club`, `intake` | Migrated from `packages/db` in this repository |
| **`supabase db reset` against the shared remote** | **Never.** It is a local-only command and treating it otherwise destroys the other application |
| Diffing and pushing | **Schema-scoped**, so neither repository proposes dropping the other's tables |

**Schema-scoped diff and push is the load-bearing assumption here** and it is on the
[list to confirm](#confirm-before-relying-on-it) before any migration runs. If the Supabase
CLI cannot scope reliably, the fallback is to consolidate all migrations into
`packages/db` early — which is the end state anyway, just brought forward at the cost of
touching a race-critical repository sooner than
[risk](../foundations/requirements.md#risk) would like.

### The end state

When the timing app moves into this repository, its migrations move with it and
`packages/db` becomes the single migration home. **The rule above is scaffolding for the
period where two repositories share one database — not the destination.**

### Generated types are how the seam stays honest

`supabase gen types typescript` output is **committed** to `packages/db`, and CI fails if
it is stale. That gives the website compile-time knowledge of the timing schema without
reaching into the timing repository, which is what
[convergence](../foundations/requirements.md#convergence) is asking for at this stage.

---

## 4. Deployment

Two systems, two different answers, and the difference is about credentials.

### Cloudflare — git integration, no credentials in CI

Unchanged from the [build brief](../delivery/nn-build-brief.md#stack):

| | |
| --- | --- |
| **Trigger** | Push to `main` deploys production; every pull request gets a preview deployment |
| **Mechanism** | Cloudflare Pages git integration — Cloudflare pulls from GitHub and builds |
| **Why not `wrangler` from GitHub Actions** | It needs a Cloudflare API token as a repository secret. Git integration needs none, and **a credential that does not exist cannot leak** |
| **Monorepo** | Root directory and build watch paths per Pages project, so `apps/nn` and `apps/www` build independently |
| **Config as code** | `wrangler.jsonc` committed per app if any binding is needed |

Preview deployments are already in the [glossary](../foundations/glossary.md#platform-and-delivery)
as an expected property, and they are what makes *"seen by the other volunteer"* under
[everything as code](../foundations/requirements.md#everything-is-defined-as-code) a real
review rather than reading a diff.

### Supabase — migrations from CI, which does need a credential

There is no equivalent of git integration for a database, so this is the one place a
deploy credential is accepted:

| | |
| --- | --- |
| **Trigger** | Merge to `main` runs `supabase db push` for the schemas this repository owns |
| **Secrets** | `SUPABASE_ACCESS_TOKEN`, project ref, database password — GitHub Actions secrets, never in the repository |
| **On a pull request** | Migrations are validated, **not applied**. A preview deployment pointing at production data is a personal-data problem, not a convenience |
| **Pattern** | [Expand–migrate–contract](../foundations/glossary.md#platform-and-delivery), so the previously deployed version keeps working and rollback stays possible |
| **Race weeks** | No migrations during a [change freeze](../foundations/glossary.md#platform-and-delivery). The timing app's own registration migration [documents its deploy-then-migrate ordering](../reference/timing-app-review.md#what-is-strong) for exactly this reason |

**Accepting a CI credential here is a deliberate asymmetry**, not an oversight of the
Cloudflare rule. The alternative is a volunteer running migrations from a laptop, which is
unreviewed, unlogged, and cannot be [everything as
code](../foundations/requirements.md#everything-is-defined-as-code).

### Environments

| | Project | Holds |
| --- | --- | --- |
| **Production** | The existing project, `eu-west-2` | Real data. Timing in `public`, website in `club` and `intake` |
| **Staging** | The second free-tier project slot | Schema only, seeded with fabricated data. **No real personal data, ever** |

The free tier's two-project ceiling is [already recorded as a
consequence](../decisions/decision-log.md#002--hold-the-clubs-data-in-supabase-on-the-free-tier).
Using one project for production rather than two is what makes a staging environment
affordable at all.

---

## What Cloudflare actually charges for

Recorded here because it comes up every time, and the honest answer is *almost nothing at
this club's size*.

### Free, permanently, at any volume the club will reach

| | Free allowance |
| --- | --- |
| **DNS hosting** | Unlimited queries. The zone stays on the **Free plan** |
| **Pages** — static hosting, bandwidth, requests | Unlimited bandwidth; **500 builds/month**; 100 custom domains per project |
| **Workers / Pages Functions** | 100,000 requests/day, 10 ms CPU per request |
| **R2** object storage | 10 GB, and **no egress charge at all** |
| **Workers KV** | 100,000 reads/day |
| **D1** | 5 GB — not used; data is in Supabase |
| **Zero Trust / Access** | 50 users |
| **TLS certificates, CDN, DDoS protection** | Included |
| **Email Routing** | Free — but **forwarding only, no mailboxes**. It does not replace [Fasthosts](email.md) |

### What costs money

| | Price | Does the club need it? |
| --- | --- | --- |
| **Workers Paid** | **$5/month ≈ £47/yr** — 10 M requests/month, 30 s CPU | **Eventually yes, for race night only.** See below |
| **Pro zone plan** | ~$25/month ≈ £190/yr — WAF, image optimisation, richer analytics | **No. Decline it.** A different product from Workers Paid, and it buys the club nothing |
| **R2 beyond 10 GB** | ~$0.015/GB/month | Only once race photographs exist — 50 GB is about £7/yr |
| **Registrar** | At cost, under £10/yr for `.co.uk` | Only if the domain transfers. [Optional, and later](dns-and-domain.md) |
| Images, Stream, Argo, Load Balancing | Various | No |

**The single trigger for Workers Paid is
[C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators).** A
90-minute race with 300 spectators polling once a second is 1.6 M requests — 16× the daily
free allowance — and deriving a leaderboard exceeds the 10 ms CPU ceiling regardless of
volume. Everything before that point, including the whole website and Nightingale
Nightmare, sits inside the free tier.

**Nothing in the plan before step 54 requires paying Cloudflare anything.**

---

## Cloudflare Pages, in short

Asked for directly, and worth having written down because the club is about to depend on
it.

**What it is:** static file hosting on Cloudflare's network, with a git integration that
builds the site, and an optional `functions/` directory for the dynamic parts.

| | |
| --- | --- |
| **Setup** | Connect the GitHub repository, give it a build command and an output directory. Cloudflare builds and deploys on every push |
| **Production** | Push to `main` |
| **Previews** | Every pull request gets its own URL, automatically |
| **Free address** | `<project>.pages.dev` immediately, before any DNS exists — [plan step 18](../delivery/plan.md) relies on this |
| **Custom domains** | **A subdomain works from third-party DNS via CNAME.** The **apex does not** — it needs Cloudflare nameservers. This is [the one difference that decides Cloudflare vs Netlify](cloudflare-vs-netlify.md) |
| **Functions** | A `functions/` directory, file-routed — `functions/api/signup.ts` serves `/api/signup`. Full Workers runtime, framework-agnostic |
| **Environment variables** | Set per environment (production and preview) in the dashboard; secrets are write-only once saved |
| **Rollback** | Every deployment is retained and can be promoted back from the dashboard |
| **Limits worth knowing** | 500 builds/month, 20,000 files, 25 MB per file, and **Cron Triggers do not work on Pages** — they are a Workers feature |

**Two traps, both already recorded:**

**`@astrojs/cloudflare` v13 dropped Pages support.** The [build
brief's answer](../delivery/nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything)
is static Astro with **no adapter**, plus a plain Pages Function. Do not pin the old
adapter to get server rendering the club does not need.

**Associate the custom domain in the Cloudflare dashboard *before* adding the CNAME.** The
other order produces a 522, and it is in the [plan](../delivery/plan.md) at step 37 for
that reason.

### And the honest caveat

**Cloudflare is steering new projects towards Workers with static assets, and Pages is the
older path.** That is visible in the Astro adapter dropping Pages first.

Pages remains the right choice *now* — it is the only Cloudflare product that serves the
club's subdomain while the zone is still at Fasthosts. **After the nameserver move, the
website should be built on Workers rather than Pages**, and the
[build brief already anticipates this](../delivery/nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything).
[Moving the DNS first](../delivery/dns-first.md) is what makes that available before the
main website build starts, which is another argument for its ordering.

---

## Rejected, so nobody re-litigates them

| | Why not |
| --- | --- |
| **A repository per service** | Two volunteers, no scale requirement, and convergence is a stated goal. Splitting now means merging later |
| **A second Supabase project for the website** | The results archive must read timing data, and two projects cannot join. Also spends the free tier's spare slot that staging needs |
| **A second Supabase project for Nightingale Nightmare** | Same, plus it would fork the event model that already supports solo races |
| **Prisma or Drizzle over the Supabase client** | The timing app uses `@supabase/supabase-js` and RLS does the enforcing. A second data-access idiom for the same database fails [boring](../foundations/requirements.md#people) |
| **Cloudflare D1 for the website** | [Already rejected](platform-options.md#option-b--cloudflare-bundled-pagesworkers--d1--r2--access) — SQLite breaks convergence with a Postgres timing app |
| **Turborepo / Nx / pnpm workspaces** | Two applications. npm workspaces is enough and is the boring option |
| **`wrangler deploy` from GitHub Actions** | Puts a Cloudflare API token in CI for no gain over git integration |
| **Migrations applied by hand from a laptop** | Unreviewed and unlogged. Fails [everything as code](../foundations/requirements.md#everything-is-defined-as-code) |

---

## Confirm before relying on it

Additions to the [validation register](platform-options.md#validation-register). Each
blocks something specific.

| | To confirm | Blocks |
| --- | --- | --- |
| **A1** | **Cloudflare Pages monorepo support** — root directory and build watch paths, so two Pages projects build independently from one repository | The repository shape |
| **A2** | **Supabase CLI schema-scoped diff and push**, so two repositories can migrate one project without desyncing | Any migration against the shared project |
| **A3** | Whether **Durable Objects are available on the Workers free plan**, or require Workers Paid | Worth £190/yr — it is the difference between [C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) costing £47 and Supabase Pro costing £237 |
| **A4** | **Supabase free tier is two active projects per organisation**, so a staging project is genuinely free | The staging environment |
| **A5** | Whether Supabase free-tier **inactivity pausing** applies to a project serving a live public site | Already [item 7](platform-options.md#validation-register); now load-bearing for staging too |

---

## Open questions this raises

Not oversights — genuinely undecided, and each is tracked as an issue.

| | |
| --- | --- |
| **Does this repository get renamed?** | `src-website` holding the race site and eventually the timing app is a misleading name. Renaming is cheap and GitHub redirects; doing it before there are clones is cheaper than after |
| **When does `src-race-timing` come in?** | Proposed: with the Cloudflare port, after November 2026. Needs a date, not a feeling |
| **Astro for `apps/www` as well as `apps/nn`?** | [Platform options recommends it](platform-options.md#framework-which-is-a-separate-question-from-language); it has not been recorded as a decision |
| **Does the website need its own auth, or reuse Supabase Auth?** | [C7](../foundations/requirements.md#c7--authenticate-and-authorise-staff) is answered for staff by the timing app's `staff_assignments`. Members logging in to the website is a different question and may not be needed at all |
| **Where do documents actually live?** | R2 is decided; the naming scheme and the stable-URL contract for [C14](../foundations/requirements.md#c14--publish-newsletters-and-club-documents) are not |
| **What is the backup position?** | The free tier has no automated backups, and [continuity](../foundations/requirements.md#continuity) says a 2026 URL resolves in 2036. A scheduled `pg_dump` to R2 is the obvious answer and has not been decided |
