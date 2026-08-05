# ADR-0006 — Repository shape: one repository or several

- **Status:** **Proposed — blocking**
- **Date:** 2026-08-05
- **Owner:** Platform volunteer
- **Blocks:** Application scaffold, pipeline design, shared type strategy

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

**Not yet made.** Option C looks like the best fit for the risk profile — the drift
problem solved without disturbing a production-proven system — but this should be
decided by whoever will actually maintain the release process, and it interacts with
[ADR-0002](0002-hosting-platform.md), since the split-hosting option makes separate
deployment pipelines necessary anyway.

Whatever is chosen must satisfy:

- A website change can never redeploy or otherwise affect the timing app without an
  explicit, reviewed decision.
- The database schema and its migrations have exactly one home.
- A new contributor can run the website locally without standing up the timing app.

## Consequences

Deferred until decided. Recorded now because the scaffold cannot be written without it,
and because reversing this after code exists is expensive.

## Revisit if

The chosen shape starts costing more in ceremony than it saves in safety.
