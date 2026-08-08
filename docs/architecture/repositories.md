# Repository architecture

How many repositories, what each owns, and how code that belongs to more than one of them
gets to both.

**Open.** Five candidates below, none recommended. The criteria in
[requirements](../foundations/requirements.md) genuinely conflict, and the trade is the
club's rather than this document's.

---

## What exists today

| | Where | Holds |
| --- | --- | --- |
| `southville-running-club/src-website` | Club organisation | **Documentation only.** No application code |
| `bindalshah/src-race-timing` | **A personal account** | Next.js 16, the race-timing platform. Proven in production |

[Plan](../delivery/plan.md) step 11 moves the second into the club organisation. **That is
a governance fix and is independent of everything below** — it happens whichever shape
wins.

Nothing has been built yet, which makes this the cheapest moment to choose and the most
expensive one to get stuck on.

---

## The question underneath the question

**"How many repositories" is less useful than "what owns what".** Two examples, both of
which cut across every option below.

**A race repository need not own race data.** `src-ptb` and `src-nn` could be *front doors*
— page, sign-up form, entry flow — with the timing platform remaining the sole owner of
events, crossings and results. That is coherent, and it keeps
[C2](../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)'s
single permanent archive intact.

What is **not** coherent is a race repository owning its own copy of the event model.
`events.format` has carried `'relay' | 'solo'`
[since the timing app's first migration](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know),
so duplicating it forks the results archive, the bib scheme and the category system. See
[database](database.md#nightingale-nightmare-is-an-event-not-an-application).

**A schema repository is a boundary, not a service.** The
[migration hazard](database.md#the-hazard-two-repositories-one-migration-history) is a
*repository* problem. Giving schema exactly one owner dissolves it regardless of how many
application repositories exist — which is why option C exists at all.

---

## The five candidates

### A — one monorepo

Everything in one repository, npm workspaces.

```
src-platform/
├── docs/
├── apps/
│   ├── www/          the club website
│   ├── nn/           Nightingale Nightmare
│   ├── ptb/          Pass the Buck            (front door only)
│   └── timing/       the timing platform      (later)
├── packages/
│   ├── db/           schema, migrations, generated types
│   └── shared/       Zod schemas, Europe/London helpers, Supabase client
└── package.json
```

| Buys | Costs |
| --- | --- |
| Shared code is an **import**, not a published package | Access is all-or-nothing — no way to give someone the NN site without the timing platform |
| A migration and the code that needs it land in **one** pull request | Build filtering becomes load-bearing. Confirmed supported, but it is configuration that can be got wrong |
| One CI config, one dependency bump, one README, one place a third person looks | Converges things that may not be ready to converge |
| One place to run the whole test suite | A race-week change freeze freezes the repository, not just the timing app |

### B — a repository per surface

`src-core-website`, `src-nn`, `src-ptb`, `src-race-timing`, `src-db`. Each deploys itself.

| Buys | Costs |
| --- | --- |
| **Blast-radius isolation.** Freeze the timing repository for race season with nothing shared to break | **Shared code has no good answer** — see [below](#the-shared-code-problem) |
| Independent access control per repository | A cross-cutting change is N pull requests, reviewed and merged separately |
| One repository, one Cloudflare project — no build filtering to configure | [Convergence](../foundations/requirements.md#convergence) is deferred, and deferred merges are the ones that never happen |
| Smallest possible checkout for a new contributor | Five READMEs, five CI configs, five dependency-update streams for two volunteers |

### C — hybrid: front doors separate, schema central

A repository per front door, plus **one repository owning all schema**, publishing
generated types as a package the others consume.

| Buys | Costs |
| --- | --- |
| **Dissolves the migration hazard by construction** — one schema owner, one migration history | A migration and its consuming code cannot land atomically |
| Front doors stay independently deployable and independently freezable | Still has the shared-code problem for non-schema code |
| The type package is a real contract, versioned and reviewable | A package publish step, which is infrastructure two volunteers have to keep working |

The atomicity cost is smaller than it sounds:
[expand–migrate–contract](../foundations/glossary.md#platform-and-delivery) is **already
required** by the race-day risk constraint, and it exists precisely so that schema and code
can ship separately.

### D — split by risk

One repository for everything that is not race-critical — website, NN, PtB front doors,
schema — and `src-race-timing` left permanently alone.

| Buys | Costs |
| --- | --- |
| Matches the constraint that actually differs. [Risk](../foundations/requirements.md#risk) applies to the timing app and to nothing else | Leaves the timing app permanently outside, against convergence being a *stated goal* rather than an option |
| Everything new gets monorepo ergonomics from day one | The timing app keeps its own duplicate of the timezone helper indefinitely |
| Nothing has to be decided about the timing app now | "Permanently" tends to mean "until someone re-opens it under time pressure" |

### E — monorepo now, extract if it hurts

Not a shape so much as a stance: start with A, and treat extraction as a normal refactor if
a real problem appears.

| Buys | Costs |
| --- | --- |
| **Splitting later is genuinely easy** — `git filter-repo`, a new remote, done in an afternoon | Requires the discipline to actually notice the problem rather than tolerate it |
| Defers a decision that does not have to be made now, without blocking anything | "We'll split it later" is the same sentence as "we'll merge it later", and one of those is a lie |
| Matches [exit cost](../foundations/requirements.md#exit-cost) as a first-class criterion | |

**The asymmetry that makes E worth listing:** splitting a monorepo later is mechanical.
Merging separate repositories later means reconciling divergent tooling, divergent
conventions and divergent dependency versions. **Both directions are possible; only one is
cheap.**

---

## The shared-code problem

The single most concrete argument in this whole document, and the one that should probably
decide it.

The timing app's `lib/london-time.ts` exists because
[an hour of drift is a real foot-gun](../reference/timing-app-review.md#what-is-strong) —
the module's own comment says so, and the test suite only passes because `TZ=UTC` is
pinned. **Nightingale Nightmare sits on or near the clocks-change weekend.**

That module has to be correct in both places. So do the Zod schemas that validate an entry,
the Supabase client configuration, and the glossary's types — an *event* is one running of
one race in one year, and getting that wrong in a schema is expensive.

| Under | How shared code travels | Honest assessment |
| --- | --- | --- |
| **A, D, E** | A workspace import | **Correct by construction.** One definition, one test suite |
| **C** | Types via a published package; other shared code still unsolved | Half an answer |
| **B** | A published npm package, a git submodule, or copy-and-accept-drift | **All three are worse than an import** |

Publishing an npm package means a registry, a versioning discipline, and a release step —
for two volunteers with day jobs, on a club with [no scale
requirement](../foundations/requirements.md#what-the-club-is-not-asking-for). Git
submodules are famously the thing a third person picks up wrong. Copying accepts drift in
exactly the module whose whole purpose is not drifting.

**If B or D wins, this needs a real answer written down, not good intentions.**

---

## What the criteria say

They do not agree, which is why this is open rather than obvious.

| | Pulls towards | Why |
| --- | --- | --- |
| [People](../foundations/requirements.md#people) | **Fewer** | Two volunteers, day jobs, boring as a hard requirement, a third person picks it up cold. Every extra repository is another CI config and another README |
| [Convergence](../foundations/requirements.md#convergence) | **Fewer** | *"One place, not three things that happen to share a club"* — stated as a goal, not an option |
| [Everything as code](../foundations/requirements.md#everything-is-defined-as-code) | **Fewer** | *"Patterns established once serve the website, NN and the timing platform rather than being solved three times."* That sentence describes a monorepo |
| [Risk](../foundations/requirements.md#risk) | **More separation** | Race-day critical, cannot be re-run — but this applies to **one** repository, not to the shape generally |
| [Exit cost](../foundations/requirements.md#exit-cost) | **Fewer, weakly** | Splitting later is cheap; merging later is the one that never happens |
| [Not scale](../foundations/requirements.md#what-the-club-is-not-asking-for) | **Against splitting for its own sake** | ~94 members, ~100 teams. Service boundaries solve a problem the club does not have |

**Four pull towards fewer repositories. One pulls hard the other way, for one specific
repository.** That shape is C, D or E — and the difference between them is mostly about
what happens to the timing app and when.

---

## What industry practice says, and what it does not

Worth stating because "microservices" and "monorepo" both carry more authority than they
have earned here.

**Monorepos are the mainstream answer for small teams sharing code.** They are what
workspaces exist for, and the tooling — npm workspaces, Cloudflare build watch paths,
per-directory CI — is now boring and well documented.

**Repository-per-service is an organisational pattern, not a technical one.** Its stated
benefit is letting independent teams deploy independently. The club has two people who will
often be changing the website and a race site in the same evening, so the benefit mostly
does not apply — **except for the timing app**, where the independence being bought is
*from race-day risk* rather than from another team. That is a real and unusual reason, and
it is why D exists.

**Nothing here is a scale argument in either direction.** A club of 94 members is far below
the point at which either pattern's scaling properties matter.

---

## If a monorepo wins

| | |
| --- | --- |
| **Tooling** | **npm workspaces.** No Turborepo, no Nx, no pnpm — the [build brief](../delivery/nn-build-brief.md#stack) already picked npm because boring beats better, and two applications do not need a build orchestrator |
| **Cloudflare** | One project per app, each with a **root directory** and **build watch paths** so a website change does not rebuild the race site. [Confirmed supported](https://developers.cloudflare.com/pages/configuration/monorepos/) |
| **Build budget** | The free plan allows **500 builds a month**. Without watch paths every push builds every app, which is how that gets spent on no-ops |
| **CI** | Path-filtered jobs, so a documentation change does not run Playwright |
| **Repository name** | `src-website` becomes misleading. Renaming is cheap and GitHub redirects — **but cheapest now**, before any clones or CI references exist |

## If separate repositories win

| | |
| --- | --- |
| **Shared code** | Needs the answer above, written down before the second repository is created |
| **Schema** | Strongly prefer option C's dedicated repository over letting two application repositories migrate one database. See [database](database.md#migrations) |
| **Conventions** | The [build brief](../delivery/nn-build-brief.md) conventions have to be copied into each repository and will drift. A shared template repository is the usual mitigation and is itself a thing to maintain |
| **Documentation** | Decide whether `docs/` stays central or splits. Splitting it defeats the point of having written it down once |

---

## What this blocks

**[Plan](../delivery/plan.md) step 17 assumes B or D** — it says *"create the NN
repository"*. Under A, C or E it becomes *"create `apps/nn`"*.

Either way the [build brief's project
structure](../delivery/nn-build-brief.md#project-structure) is unchanged — the same files,
possibly one directory deeper. **This is the only thing in this document blocking the
Nightingale Nightmare scaffold**, so it is the part worth answering first even if the rest
stays open.

## Still to answer

| | |
| --- | --- |
| Which shape | The decision itself |
| Where `src-race-timing` ends up, and **when** | A and C absorb it; B and D never do. *"Eventually"* is not a plan — this wants a date or an explicit never |
| Whether this repository is renamed | Only bites under A, C, D or E |
| How shared code travels, **if** B or D | Package, submodule, or accepted drift. All three want writing down |
| Whether `docs/` stays in one place | It is the club's most valuable artefact after the timing app |
