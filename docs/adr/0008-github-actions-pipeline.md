# ADR-0008 — GitHub Actions for the pipeline

- **Status:** Proposed
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

[P4](../principles.md#p4--deployment-is-a-pipeline-never-a-person) requires that code
reach production only through an automated pipeline, and
[P5](../principles.md#p5--nothing-merges-untested) requires the full suite to run on
every pull request against a containerised environment.

The code lives in the club's GitHub organisation, which is also part of the answer to
key-person risk ([R1](../risks.md#r1--key-person-dependency)) — the club can reach it.

Both candidate hosting platforms offer their own Git-connected build-and-deploy. Using
the platform's own pipeline is less to configure but couples the delivery process to the
hosting choice, which is exactly the thing still under debate in
[ADR-0002](0002-hosting-platform.md), and which the club may change again.

## Decision (proposed)

**GitHub Actions owns the pipeline**: lint, type check, unit tests, build, containerised
integration tests, end-to-end tests, accessibility and performance checks, migrations and
deployment. The hosting platform is a deployment target invoked by the pipeline, not the
thing that decides when to deploy.

Branch protection on `main` requires all checks green plus a review before merge, and
applies to everyone including administrators.

Preview deployments per pull request may use the hosting platform's native integration
where it is simpler, since previews are disposable.

## Consequences

- The delivery process survives a hosting change. Migrating hosts becomes swapping a
  deploy step, not rebuilding CI.
- Containerised services (PostgreSQL, migrations, browsers) are straightforward on
  GitHub-hosted runners — the requirement that pushed away from platform-native builds
  in the first place.
- Free minutes are ample at club scale; public repositories get unlimited minutes.
- Some duplication against the hosting platform's own build step, and slightly more
  configuration to maintain than "connect the repo and forget".
- Deployment credentials live in GitHub secrets and are rotated when role-holders change
  ([P9](../principles.md#p9--secrets-never-enter-the-repository)).
- Workflows are code in this repository and reviewed like any other change.

## Revisit if

GitHub Actions' free allowance stops covering the club, or the chosen host's native
pipeline gains containerised-test support good enough that maintaining both stops making
sense.
