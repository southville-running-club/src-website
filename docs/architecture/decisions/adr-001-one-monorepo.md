# ADR-001 — One monorepo, npm workspaces

**Accepted**, 8 August 2026. Supersedes nothing.

| | |
| --- | --- |
| **Requirement** | [Convergence](../../foundations/requirements.md#convergence), [people](../../foundations/requirements.md#people), [everything as code](../../foundations/requirements.md#everything-is-defined-as-code) |
| **Options** | Five candidates, compared in [repositories](../investigations/repositories.md#the-five-candidates) |

## Context

[Five shapes were on the table](../investigations/repositories.md): one monorepo, a
repository per surface, a hybrid with a dedicated schema repository, a split by risk, and
monorepo-now-extract-later.

Four of the six criteria pulled towards fewer repositories. The one pulling the other way —
[risk](../../foundations/requirements.md#risk) — applies to **one** repository, the timing
platform, rather than to the shape generally.

**The decisive argument was shared code.** The timing app's `lib/london-time.ts` exists
because [an hour of drift is a real
foot-gun](../../reference/timing-app-review.md#what-is-strong), and Nightingale Nightmare
sits near the clocks-change weekend. Under separate repositories that module travels as a
published package, a git submodule, or a copy — and
[all three are worse than an import](../investigations/repositories.md#the-shared-code-problem)
for two volunteers with day jobs.

Two things that would have counted against a monorepo turned out not to:
**[Cloudflare Pages supports monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)**
via root directory and build watch paths, and splitting a monorepo later is mechanical
where merging repositories later is not.

## Decision

**One repository, npm workspaces.** No Turborepo, no Nx, no pnpm.

```
├── docs/
├── apps/
│   ├── nn/            Nightingale Nightmare
│   └── www/           the club website            (later)
├── packages/
│   ├── db/            schema, migrations, generated types
│   └── shared/        Zod schemas, Europe/London helpers, Supabase client
└── package.json
```

**`src-race-timing` stays out for now.** It moves in with the Cloudflare port, after the
2026 race and outside a [change
freeze](../../foundations/glossary.md#platform-and-delivery). [Plan](../../delivery/plan.md)
step 11 moves it into the club **organisation** regardless — that is the governance fix and
does not wait for this.

## Consequences

- **[Plan](../../delivery/plan.md) step 17 changes** from *"create the NN repository"* to
  *"create `apps/nn`"*. The [build brief's project
  structure](../../delivery/nn-build-brief.md#project-structure) is otherwise unchanged —
  same files, one directory deeper.
- **Build watch paths become load-bearing.** The free plan allows **500 builds a month**;
  without path filtering every push builds every app. Configure them when the second app
  lands, not after the allowance is spent.
- **Access is all-or-nothing.** There is no way to give somebody the race site without the
  rest. Acceptable at two volunteers; it is the thing to re-examine if that changes.
- **A race-week [change freeze](../../foundations/glossary.md#platform-and-delivery) freezes
  the repository**, not just the timing app — once the timing app is in it. Not yet an issue.
- **The repository name becomes misleading.** `src-website` will hold the race site and
  eventually the timing platform. Still open, and cheapest to change now.
- One CI configuration, one dependency-update stream, one place a third person looks.

## Exit cost

**Low.** `git filter-repo` extracts a directory with its history into a new repository —
an afternoon, and the deployment follows because each app is already its own Cloudflare
project with its own root directory.

This asymmetry is why the decision is safe: splitting later is mechanical, merging later
means reconciling divergent tooling and conventions.

## Revisit when

- A third maintainer needs access to one app but not the others.
- A race-week change freeze demonstrably blocks website work.
- Build minutes become a real constraint despite watch paths.
