# Delivery and environments

How code gets from a laptop to `southvillerunningclub.co.uk`, and the environments it
passes through on the way.

Governing principles: [P1](principles.md#p1--everything-is-code-nothing-is-clicked),
[P4](principles.md#p4--deployment-is-a-pipeline-never-a-person),
[P5](principles.md#p5--nothing-merges-untested),
[P10](principles.md#p10--every-change-is-reversible).

---

## Environments

Four, and only four. Each is defined in this repository.

| # | Environment | Runs where | Database | Data | Lifetime |
| --- | --- | --- | --- | --- | --- |
| 1 | **Local** | Developer machine, Docker Compose | Local Postgres in a container | Synthetic seed | While you're working |
| 2 | **Test (CI)** | GitHub Actions runner, containers | Ephemeral Postgres, migrated from scratch | Synthetic fixtures | One pipeline run |
| 3 | **Preview** | Hosting platform, per pull request | Shared staging database, or a branch database | Synthetic seed | Life of the PR |
| 4 | **Production** | Hosting platform | Supabase production | Real | Permanent |

**Local and Test are containerised and identical in composition.** The same Compose
definition and the same migrations produce both, so a green CI run means something
about your machine, and a green local run means something about CI.

**No environment other than production holds real personal data.**
See [P8](principles.md#p8--personal-data-is-a-liability-not-an-asset). Seed data is
generated, not sampled.

### Local environment

The target — the contract the containerised setup must meet:

```bash
git clone <repo> && cd src-website
cp .env.example .env.local     # names only; no secrets needed for local
docker compose up              # app + postgres + migrations + seed
```

Ten minutes from clone to a working site with a populated results archive, on a machine
with nothing installed but Docker and a Node toolchain. If it takes longer than that,
that is a bug in the setup, not in the newcomer.

### Test environment (containerised)

CI stands up a real PostgreSQL container, applies **every migration from empty**, loads
fixtures, and runs the suite against it. Not an in-memory stub, not a mock, not a
shared long-lived test database that has drifted.

This is the piece that makes [P5](principles.md#p5--nothing-merges-untested) enforceable:
migrations are exercised on every single run, so "the migration works" is never an
assumption.

### Preview environment

Every pull request gets a deployed URL, so a committee member can look at a change
before it is real. Preview deployments are not indexed by search engines and are not
linked from anywhere public.

### Production

Deployed only from `main`, only by the pipeline, only after the full suite is green.

---

## Branching and change flow

```
feature branch  →  pull request  →  CI (full suite)  →  preview deploy
                                                              │
                                                     human review + approval
                                                              │
                                                        merge to main
                                                              │
                                    CI again → migrations → production deploy
                                                              │
                                                     post-deploy smoke tests
```

- `main` is protected and always deployable.
- Every change arrives by pull request. No direct pushes to `main`, including by the
  person who owns the repo.
- Conventional-style commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
  `test:`) so the changelog is derivable.
- Squash merge, so `main`'s history is one commit per reviewed change.

---

## The pipeline

Every stage runs on pull requests. Stages 8–10 run only on `main`.

| # | Stage | Blocks merge | Notes |
| --- | --- | --- | --- |
| 1 | Lint and format check | Yes | |
| 2 | Type check | Yes | Strict TypeScript, no `any` escape hatches in CI |
| 3 | Unit tests | Yes | |
| 4 | Build | Yes | Production build, not dev |
| 5 | Migrations from empty + integration tests | Yes | Containerised PostgreSQL |
| 6 | End-to-end tests | Yes | Real browser against the built app |
| 7 | Accessibility + link checks | Yes | WCAG 2.2 AA |
| 8 | Preview deploy | — | Comments the URL on the PR |
| 9 | Production migration | — | `main` only; expand-migrate-contract |
| 10 | Production deploy + smoke tests | — | Automatic rollback on smoke failure |

Additional scheduled jobs: dependency and vulnerability scanning, a nightly full-suite
run against production-like data volumes, and an uptime/canary check.

### Database migrations

- Versioned, forward-only, checked into this repository, applied **by the pipeline**.
- Never applied by hand against production
  ([P4](principles.md#p4--deployment-is-a-pipeline-never-a-person)).
- Expand → migrate → contract, in separate releases, so the previously deployed version
  still runs against the new schema and rollback stays possible
  ([P10](principles.md#p10--every-change-is-reversible)).
- Migrations touching historical event data need explicit sign-off
  ([P3](principles.md#p3--results-are-permanent-and-append-only)).

### Secrets

Held in the hosting platform's and GitHub's secret stores, injected at build/run time.
This repository contains an `.env.example` listing **names and purposes only**
([P9](principles.md#p9--secrets-never-enter-the-repository)). Rotation procedure is
documented in the runbook; secrets are rotated when anyone with access leaves a role.

### Rollback

- **Application:** redeploy the previous build. Target: under five minutes, single
  command or single click, documented in the runbook.
- **Database:** forward-fix by preference. Restore-from-backup is the last resort and
  is only viable with Supabase Pro's daily backups — a live input to the
  [contingency decision](risks.md).
- Every release records the commit SHA it deployed, so "what is in production" is
  answerable without guessing.

---

## Change freezes

No production deployment of anything in the shared platform:

- From **72 hours before** a race until results are published and signed off.
- During the entry-opening window for a race, for anything touching entries.

Website-only content changes may be exempted by the race director. Timing-path changes
never are. See [P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not).

---

## Operational ownership

| Concern | Owner |
| --- | --- |
| Pipeline, hosting, database | Platform volunteer(s) |
| Race-day go/no-go and freezes | Race director |
| Payments, refunds, reconciliation | Treasurer |
| Member data and EA verification | Membership secretary |
| Content accuracy | Committee |

Key-person dependency is the club's top risk
([Risks](risks.md)). The counter-measures are in this document by design: everything is
code, everything is documented, everything runs on mainstream services another
developer could pick up.
