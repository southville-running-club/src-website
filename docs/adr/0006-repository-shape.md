# ADR-0006 — Repository shape: one repository or several

- **Status:** **Accepted — separate repositories, one service each**
- **Date:** 2026-08-05 (proposed), 2026-08-05 (accepted)
- **Owner:** Platform volunteer

## Context

The proposal describes "one codebase, one database, three front doors". Today that is
not the situation: the timing app lives in its own repository and is deployed
independently, and this repository is new and empty.

There is real tension here. Sharing code means the website's understanding of an event,
a result or a category cannot drift from the timing app's. But the timing app is
**proven in production** and safety-critical on race day
([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)), and
anything that makes a website change able to affect it is a risk the club did not have
before.

## Options

### A — Separate repositories, shared database only
The website reads the shared database and duplicates the small amount of domain logic it
needs.

*For:* strongest isolation of the race-day system; simplest pipeline; a website change
cannot break timing. *Against:* duplicated types and logic, which will drift; two
release processes; the shared schema has no single home.

### B — Monorepo containing both applications plus shared packages
One repository, workspaces for `website`, `timing`, and shared `db` / `domain` packages.

*For:* genuinely one codebase; schema and types have one home; a schema change and its
consumers move in one reviewed commit. *Against:* migrating the proven timing app into a
new repository and pipeline is itself a risk and a project; CI must scope deployments by
what changed, or a website commit redeploys the timing app.

### C — Separate repositories plus a shared package for schema and domain types
The middle path: this repository and the timing app stay separate; a third, small,
versioned package owns the database schema, migrations and shared types, consumed by
both.

*For:* removes the drift problem without moving the timing app; the schema gets one
home; blast radius stays small. *Against:* three repositories and a publishing step;
version skew between consumers becomes possible and must be managed.

## Decision

**Option A, with a path to C: one repository per service, each deploying to its own
Cloudflare Worker.**

Events overtook the question. There are now three repositories and a third service:

| Repository | Service | Hosting |
| --- | --- | --- |
| `bindalshah/src-race-timing` | Timing app | Vercel today, Cloudflare later |
| `admin-src/src-website` | Club website | Cloudflare |
| `admin-src/nightingale-nightmare` | Nightingale Nightmare sign-ups, later timing and results | Cloudflare |

Each is an independent Worker on its own hostname, with its own pipeline and its own
release cadence. "One codebase, one database, three front doors" is true of the
**database**, not the source tree — and the database is where it matters.

**The shared-package step (option C) is deferred, not rejected.** It becomes worth its
overhead at the first real instance of schema drift between services. Until then it is
ceremony a one-volunteer club does not need
([P14](../principles.md#p14--prefer-deleting-to-adding)).

Meanwhile the schema has one home: **the timing app's `supabase/migrations/`**, which is
where every migration already lives and where the model was designed. Any service needing
a schema change proposes it there.

### Two conditions that now apply

1. **The timing app must move into the club organisation.** It currently sits in a
   personal account, which contradicts the proposal's own key-person mitigation that
   "code and documentation live in the club's reach on GitHub". Transfer to `admin-src`
   before the port ([R1](../risks.md#r1--key-person-dependency),
   [timing app review](../reference/timing-app-review.md#governance-findings)).
2. **Bib resolution is already duplicated** between TypeScript (`lib/bib.ts`) and SQL
   (`private.resolve_crossing_team_id()`), and the timing app states the two must stay in
   lockstep. That is the drift risk this ADR worried about, already live inside one
   repository. It is the natural first candidate for the shared package.

## Consequences

- A website or Nightingale Nightmare change cannot redeploy or affect the timing app.
  Blast radius stays small, which is the property worth most here
  ([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)).
- A new contributor runs one service locally without standing up the others.
- Database types are duplicated per service until the shared package exists. Accepted
  knowingly; each service generates its own from the same Supabase project, so drift
  shows up as a type error rather than silently.
- Three pipelines to keep current, all near-identical. Worth templating early.
- Cross-service concerns — the schema, RLS roles, shared vocabulary — need a home. That
  home is this repository's [documentation](../), which is why the
  [architecture](../architecture.md) and [glossary](../glossary.md) matter more under
  this shape than they would in a monorepo.

## Revisit if

The same domain logic is written a third time, or a schema change breaks a service
silently rather than loudly. Either is the signal to promote the shared package from
deferred to due.
