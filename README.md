# Southville Running Club — Website Platform

This repository holds the Southville Running Club (SRC) public website: source,
infrastructure definition, database migrations, tests, and deployment pipeline.

The club currently runs <https://www.southvillerunningclub.co.uk/> on Squarespace.
This repository exists to replace that with a site the club builds, owns, hosts and
controls entirely in code.

## Status

**Documentation and planning only.** No application code has been written yet.

**Hosting is settled: Cloudflare** ([ADR-0002](docs/adr/0002-hosting-platform.md)), on
commercial grounds. The first piece of work is not code — it is
[delegating DNS to Cloudflare](docs/adr/0010-dns-delegation-to-cloudflare.md), which
blocks every club hostname that a Worker will serve.

## Start here

| If you want to know… | Read |
| --- | --- |
| **What happens next, and in what order** | **[Plan of attack](docs/plan-of-attack.md)** |
| Why this exists and what "done" looks like | [Mission and goals](docs/mission-and-goals.md) |
| The rules everything here must follow | [Foundational principles](docs/principles.md) |
| How the pieces fit together | [Architecture](docs/architecture.md) |
| Environments, pipeline, how code reaches production | [Delivery and environments](docs/delivery-and-environments.md) |
| What we test and what blocks a merge | [Testing strategy](docs/testing-strategy.md) |
| The five workstreams as scope | [Roadmap](docs/roadmap.md) |
| What could go wrong | [Risk register](docs/risks.md) |
| What the club still has to decide | [Open questions](docs/open-questions.md) |
| Why a decision was made | [Decision records](docs/adr/) |
| How the existing timing app works | [Timing app review](docs/reference/timing-app-review.md) |
| The board proposal this all derives from | [Platform proposal v8](docs/reference/platform-proposal-v8.md) |
| Domain vocabulary | [Glossary](docs/glossary.md) |

Working in this repo — conventions, workflow, definition of done:
[CONTRIBUTING.md](CONTRIBUTING.md). Instructions for AI coding agents:
[CLAUDE.md](CLAUDE.md).

## The wider platform

The website is one service among several sharing a single PostgreSQL database, so race
information and results published here are the same records the timing app writes.

| Service | Repository | Hosting |
| --- | --- | --- |
| Club website | this repository | Cloudflare |
| Nightingale Nightmare | `admin-src/nightingale-nightmare` | Cloudflare |
| Race timing — live, proven at Pass the Buck 2026 | `src-race-timing` | Vercel today, Cloudflare later |
| Payments and membership | later | Stripe-hosted first |

Each is its own Worker on its own hostname
([ADR-0006](docs/adr/0006-repository-shape.md)). See
[Architecture](docs/architecture.md).

## Licence

Not yet decided — see [open questions](docs/open-questions.md).
