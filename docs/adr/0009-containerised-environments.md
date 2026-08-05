# ADR-0009 — Containerised local and CI environments

- **Status:** Proposed
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

Two requirements meet here.

**Onboarding.** The club's top risk is that one volunteer holds everything
([R1](../risks.md#r1--key-person-dependency)). A second contributor who needs a day of
setup and a phone call is not really a second contributor.

**Test honesty.** [P5](../principles.md#p5--nothing-merges-untested) is only worth
something if the tests run against a real PostgreSQL with the real migrations applied. A
mocked or in-memory database tests our idea of the database. Row-level security — the
mechanism stopping the website from writing to timing tables
([ADR-0004](0004-postgres-on-supabase.md)) — cannot be tested against a mock at all.

A shared long-lived development database is the usual alternative. It drifts, it holds
stale data, it breaks when two people use it at once, and it tempts someone to copy
production data into it.

## Decision (proposed)

**Local development and CI both run in containers, from the same definition.**

- A `docker compose` definition brings up the application, PostgreSQL, and the Supabase
  local stack where it is needed.
- Migrations are applied **from empty** on every start and on every CI run, so migration
  correctness is exercised continuously rather than assumed.
- Synthetic seed data is generated from fixtures in this repository. **Production
  personal data never enters any other environment**
  ([P8](../principles.md#p8--personal-data-is-a-liability-not-an-asset)).
- The onboarding contract: `git clone`, `docker compose up`, working site with a
  populated results archive, in under ten minutes, on a machine with Docker and a Node
  toolchain and nothing else.

## Consequences

- "It passed CI" means something about the contributor's machine, and "it works locally"
  means something about CI, because they are the same composition.
- RLS policies, constraints and migration ordering are tested for real, including the
  negative cases.
- No shared development database to drift, break or tempt anyone with real data.
- Contributors need Docker, and container startup adds seconds to the inner loop.
  Acceptable; mitigated by keeping the unit-test layer fast and database-free.
- Local containers are not identical to Supabase's managed production — extensions,
  connection pooling and managed features can differ. Anything relying on a
  Supabase-specific behaviour needs a check against a real preview environment, not just
  the local stack. This is a known gap, not a solved problem.
- Seed fixtures are versioned with the schema and must cover the awkward cases —
  duplicate names, missing dates of birth, DNS/DNF/DQ, a clocks-change race, a field
  large enough to be slow.

## Revisit if

Container startup becomes slow enough to hurt the inner loop, or the gap between the
local stack and managed Supabase starts producing bugs that only appear in production.
